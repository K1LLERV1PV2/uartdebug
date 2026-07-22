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
  });
  assert.deepEqual(core.parseDocumentationMarker("  //### Timer setup  "), {
    level: 3,
    title: "Timer setup",
    key: "timer setup",
  });
});

test("does not treat preprocessor syntax or malformed comments as markers", () => {
  const falsePositives = [
    "//#define BAUD_RATE 9600",
    "// # Heading",
    "int value; //# Heading",
    "///# Heading",
    "//####### Too deep",
    "//#   ",
  ];

  for (const line of falsePositives) {
    assert.equal(core.parseDocumentationMarker(line), null, line);
  }
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
