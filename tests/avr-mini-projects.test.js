"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const core = require("../public/avr-mini-projects.js");

test("exports schema version and installs the browser UMD global", () => {
  assert.equal(core.SCHEMA_VERSION, 1);

  const source = fs.readFileSync(
    path.join(__dirname, "../public/avr-mini-projects.js"),
    "utf8"
  );
  const context = { window: {} };
  vm.runInNewContext(source, context);

  assert.equal(
    context.window.UartDebugAvrMiniProjectCore.SCHEMA_VERSION,
    1
  );
  assert.equal(
    typeof context.window.UartDebugAvrMiniProjectCore
      .extractShortProjectDescription,
    "function"
  );
});

test("extracts card copy only from the first paragraph under the exact H2", () => {
  const markdown = [
    "```md",
    "## Short Project Description",
    "Ignored fenced text.",
    "```",
    "",
    "### Short Project Description",
    "Ignored H3 text.",
    "",
    "## Short Project Description",
    "",
    "First line",
    "continues here.",
    "",
    "A second paragraph is not card copy.",
  ].join("\n");

  assert.equal(
    core.extractShortProjectDescription(markdown),
    "First line continues here."
  );
  assert.equal(
    core.extractShortProjectDescription("# Short Project Description\nWrong level."),
    ""
  );
});

test("normalizes a legacy one-file mini-project", () => {
  const definition = core.normalizeDefinition({
    id: "minimum",
    fileName: "01_Minimum.c",
    content: "int main(void) {\r\n  return 0;\r\n}",
  });

  assert.equal(definition.schemaVersion, 1);
  assert.equal(definition.id, "minimum");
  assert.equal(definition.title, "minimum");
  assert.equal(definition.files.source.role, "source");
  assert.equal(definition.files.source.name, "01_Minimum.c");
  assert.equal(
    definition.files.source.content,
    "int main(void) {\n  return 0;\n}"
  );
  assert.equal(definition.files.source.mediaType, "text/x-c");
  assert.equal(definition.files.guide, undefined);
  assert.deepEqual(definition.guides, []);
  assert.equal(definition.defaultLocale, "");
});

test("normalizes future array schema and distinguishes both Markdown roles", () => {
  const definition = core.normalizeDefinition({
    schemaVersion: 1,
    id: "uart-tx",
    title: "UART TX",
    summary: "Transmit bytes.",
    version: "2.0",
    files: [
      { name: "05_UART_TX.c", content: "int main(void) {}" },
      { name: "05_UART_TX.md", content: "# UART TX" },
      {
        name: "05_UART_TX.agent.md",
        content: "schema_version: 1",
        mediaType: "text/yaml",
      },
    ],
  });

  assert.equal(definition.files.source.name, "05_UART_TX.c");
  assert.equal(definition.files.guide.name, "05_UART_TX.md");
  assert.equal(definition.files.aiSpec.name, "05_UART_TX.agent.md");
  assert.equal(definition.files.aiSpec.role, "aiSpec");
  assert.equal(definition.version, "2.0");
});

test("infers attached project naming conventions and Markdown AI media type", () => {
  const definition = core.normalizeDefinition({
    id: "01_Minimum",
    files: [
      { name: "01_Minimum_1.2.3-d.c", content: "int main(void) {}" },
      {
        name: "01_Minimum_help_1.2.3-d.md",
        content: "# Minimum",
        locale: "en_us",
      },
      {
        name: "01_Minimum_AI_1.2.3-d.md",
        content: "# AI instructions",
      },
    ],
  });

  assert.equal(definition.files.guide.role, "guide");
  assert.equal(definition.files.guide.locale, "en-US");
  assert.equal(definition.files.aiSpec.role, "aiSpec");
  assert.equal(definition.files.aiSpec.mediaType, "text/markdown");
  assert.equal(core.inferFileRole("demo_AI_notes.md"), "aiSpec");
  assert.equal(core.inferFileRole("demo_help_ru.md"), "guide");
});

test("normalizes object schema keyed by canonical roles and aliases", () => {
  const definition = core.normalizeDefinition({
    id: "clock",
    files: {
      code: { name: "clock.c", content: "void setup(void) {}" },
      docs: { name: "clock.md", content: "# Clock" },
      aiSpec: {
        role: "yaml",
        name: "clock.api.md",
        content: "id: clock",
      },
    },
  });

  assert.deepEqual(Object.keys(definition.files), ["source", "guide", "aiSpec"]);
  assert.equal(core.normalizeRole("AI-spec"), "aiSpec");
  assert.equal(core.normalizeRole("documentation"), "guide");
  assert.equal(core.normalizeRole("constructor"), null);
  assert.equal(core.normalizeRole("__proto__"), null);
  assert.equal(core.inferFileRole("main.c"), "source");
  assert.equal(core.inferFileRole("README.md"), "guide");
  assert.equal(core.inferFileRole("project.yaml.md"), "aiSpec");
  assert.equal(core.inferFileRole({ role: "agent", name: "notes.md" }), "aiSpec");
  assert.equal(definition.guides.length, 1);
  assert.strictEqual(definition.files.guide, definition.guides[0]);
});

test("normalizes localized guides and keeps files.guide as the default guide", () => {
  const definition = core.normalizeDefinition({
    id: "localized",
    defaultLocale: "ru-RU",
    files: {
      source: { name: "localized.c", content: "int main(void) {}" },
      guide: [
        {
          name: "localized_help_en.md",
          content: "# Guide",
          locale: "en",
          label: "English",
        },
        {
          name: "localized_help_ru.md",
          content: "# Руководство",
          locale: "ru-ru",
          label: "Русский",
          assetBaseUrl: "/projects/localized/",
        },
      ],
    },
  });

  assert.equal(definition.defaultLocale, "ru-RU");
  assert.deepEqual(
    definition.guides.map((guide) => guide.locale),
    ["en", "ru-RU"]
  );
  assert.equal(definition.files.guide.name, "localized_help_ru.md");
  assert.equal(definition.files.guide.label, "Русский");
  assert.equal(
    definition.files.guide.assetBaseUrl,
    "/projects/localized/"
  );
});

test("accepts top-level guides and safely preserves asset and AI reference metadata", () => {
  const assets = [
    {
      name: "diagram.png",
      mediaType: "image/png",
      path: "assets/diagram.png",
    },
  ];
  const aiSpecRef = {
    path: "server/01_Minimum_AI.md",
    mediaType: "text/markdown",
  };
  const definition = core.normalizeDefinition({
    id: "metadata",
    fileName: "metadata.c",
    content: "int main(void) {}",
    defaultLocale: "en",
    guides: [
      {
        name: "metadata_help.md",
        content: "# Help",
        assets: { local: { name: "local.png" } },
      },
    ],
    assets,
    aiSpecRef,
  });

  assert.equal(definition.guides[0].locale, "en");
  assert.strictEqual(definition.files.guide, definition.guides[0]);
  assert.deepEqual(definition.assets, assets);
  assert.deepEqual(definition.aiSpecRef, aiSpecRef);
  assert.notStrictEqual(definition.assets, assets);
  assert.notStrictEqual(definition.aiSpecRef, aiSpecRef);
  assert.notStrictEqual(definition.guides[0].assets, definition.assets);
  assert.deepEqual(definition.guides[0].assets, {
    local: { name: "local.png" },
  });

  const unsafeRef = JSON.parse('{"__proto__":{"polluted":true}}');
  assert.throws(
    () =>
      core.normalizeDefinition({
        id: "unsafe-metadata",
        fileName: "unsafe.c",
        content: "",
        aiSpecRef: unsafeRef,
      }),
    /unsafe key/i
  );
  assert.equal({}.polluted, undefined);
});

test("rejects ambiguous localized guide defaults", () => {
  assert.throws(
    () =>
      core.normalizeDefinition({
        id: "bad-locale",
        defaultLocale: "de",
        files: [
          { name: "bad-locale.c", content: "" },
          { name: "bad-locale_help_en.md", content: "", locale: "en" },
          { name: "bad-locale_help_ru.md", content: "", locale: "ru" },
        ],
      }),
    /no matching guide/i
  );

  assert.throws(
    () =>
      core.normalizeDefinition({
        id: "duplicate-locale",
        files: [
          { name: "duplicate-locale.c", content: "" },
          { name: "one_help.md", content: "", locale: "en" },
          { name: "two_help.md", content: "", locale: "EN" },
        ],
      }),
    /duplicate guide locale/i
  );
});

test("rejects missing or duplicate source files", () => {
  assert.throws(
    () =>
      core.normalizeDefinition({
        id: "missing-source",
        files: [{ name: "guide.md", content: "# Guide" }],
      }),
    /missing a source/i
  );

  assert.throws(
    () =>
      core.normalizeDefinition({
        id: "duplicate-source",
        files: [
          { name: "one.c", content: "" },
          { role: "source", name: "two.c", content: "" },
        ],
      }),
    /duplicate source/i
  );
});

test("rejects invalid file names and non-string content", () => {
  assert.throws(
    () =>
      core.normalizeDefinition({
        id: "bad-name",
        fileName: "../main.c",
        content: "",
      }),
    /file name is invalid/i
  );

  assert.throws(
    () =>
      core.normalizeDefinition({
        id: "bad-content",
        fileName: "main.c",
        content: { code: "int main(void) {}" },
      }),
    /content must be a string/i
  );
});

test("enforces the three-file role extensions", () => {
  assert.throws(
    () =>
      core.normalizeDefinition({
        id: "wrong-source",
        files: [
          { role: "source", name: "firmware.md", content: "" },
          { role: "guide", name: "guide.md", content: "# Guide" },
        ],
      }),
    /source file must use the \.c extension/i
  );

  assert.throws(
    () =>
      core.normalizeDefinition({
        id: "wrong-guide",
        files: [
          { role: "source", name: "firmware.c", content: "" },
          { role: "guide", name: "guide.c", content: "# Guide" },
        ],
      }),
    /guide file must use the \.md extension/i
  );
});

test("parses documentation markers with one through six hashes", () => {
  assert.deepEqual(core.parseDocumentationMarker("//# Overview"), {
    level: 1,
    title: "Overview",
    key: "overview",
    start: 0,
    end: 12,
  });
  assert.deepEqual(core.parseDocumentationMarker("  //### Timer setup  "), {
    level: 3,
    title: "Timer setup",
    key: "timer setup",
    start: 2,
    end: 21,
  });
});

test("finds inline documentation markers and returns only the comment range", () => {
  const line = "uint8_t value = 1; //# Register value";
  const marker = core.parseDocumentationMarker(line);

  assert.deepEqual(marker, {
    level: 1,
    title: "Register value",
    key: "register value",
    start: line.indexOf("//#"),
    end: line.length,
  });
  assert.equal(line.slice(marker.start, marker.end), "//# Register value");

  const afterLiterals = 'puts("//# Hidden"); char slash = \'/\'; //## Visible';
  const visible = core.parseDocumentationMarker(afterLiterals);
  assert.equal(visible.title, "Visible");
  assert.equal(afterLiterals.slice(visible.start, visible.end), "//## Visible");

  const afterBlock = "/* //# Hidden */ int enabled = 1; //### Enabled state";
  const enabled = core.parseDocumentationMarker(afterBlock);
  assert.equal(enabled.level, 3);
  assert.equal(enabled.title, "Enabled state");
  assert.equal(afterBlock.slice(enabled.start), "//### Enabled state");
});

test("does not treat preprocessor syntax or malformed comments as markers", () => {
  const falsePositives = [
    "//#define BAUD_RATE 9600",
    "// # Heading",
    "///# Heading",
    "//####### Too deep",
    "//#   ",
    'const char *text = "//# Inside a string";',
    "char hash = '#'; /* //# Inside a block comment */",
    "/* unterminated //# block comment",
    "// ordinary comment //# Nested marker",
    'const char *escaped = "quote: \\\" //# Still in string";',
  ];

  for (const line of falsePositives) {
    assert.equal(core.parseDocumentationMarker(line), null, line);
  }
});

test("stateful marker scanning ignores markers inside multiline block comments", () => {
  const scanner = core.createDocumentationMarkerScanner();
  const lines = [
    "/* explanation starts",
    "//# Hidden inside block",
    "*/ uint8_t enabled = 1; //## Visible after block",
  ];

  assert.equal(scanner.parseLine(lines[0]), null);
  assert.equal(scanner.parseLine(lines[1]), null);
  const visible = scanner.parseLine(lines[2]);
  assert.equal(visible.title, "Visible after block");
  assert.equal(lines[2].slice(visible.start), "//## Visible after block");

  scanner.reset();
  assert.equal(scanner.parseLine("//# Visible after reset").title, "Visible after reset");
});

test("extracts Markdown headings and creates markup-insensitive matching keys", () => {
  const headings = core.extractMarkdownHeadings(`
# **UART Setup!**
## [Clock &amp; Prescaler](https://example.test/clock) ##

Interrupt flow
--------------

\`\`\`c
# Not a documentation heading
\`\`\`
`);

  assert.deepEqual(headings, [
    { level: 1, title: "**UART Setup!**", key: "uart setup" },
    {
      level: 2,
      title: "[Clock &amp; Prescaler](https://example.test/clock)",
      key: "clock prescaler",
    },
    { level: 2, title: "Interrupt flow", key: "interrupt flow" },
  ]);

  const marker = core.parseDocumentationMarker("//# UART setup");
  assert.equal(marker.key, headings[0].key);
  assert.equal(
    core.normalizeHeadingKey("**Прерывания:** [TCA0](https://example.test)"),
    core.normalizeHeadingKey("прерывания — TCA0")
  );
});
