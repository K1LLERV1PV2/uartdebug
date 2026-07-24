"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  AiServiceError,
  createAvrAiService,
  loadActiveRulePack,
  parseStructuredOutput,
  validateGeneratedBundle,
} = require("../backend/avr-ai-service");

const repoRoot = path.join(__dirname, "..");
const rulePackRoot = path.join(repoRoot, "backend", "ai", "rule-packs");
const miniProjectCatalogPath = path.join(
  repoRoot,
  "backend",
  "ai",
  "mini-projects",
  "catalog.json"
);

function makeGeneratedBundle() {
  return {
    title: "Blink status LED",
    summary: "Blinks a status LED using a timer.",
    version: "1.0.0-d",
    source: {
      name: "BlinkStatus.c",
      content:
        "//# Overview\nint main(void) {\n  for (;;) {}\n  return 0;\n}\n",
    },
    guide: {
      name: "BlinkStatus_help.md",
      locale: "en",
      content: "# Overview\n\nThis mini-project blinks a status LED.\n",
    },
    aiSpec: {
      name: "BlinkStatus_AI.md",
      content: "# AI Integration Guide\n\nPrivate implementation constraints.\n",
    },
  };
}

test("loads the checked-in immutable rule pack and verifies its hashes", async () => {
  const rules = await loadActiveRulePack(rulePackRoot);

  assert.equal(rules.packageId, "uartdebug-rules-2026-07-23.2");
  assert.equal(rules.projectVersion, "1.2");
  assert.equal(rules.generatorContract, "uartdebug-mini-project/v1");
  assert.match(rules.digest, /^[a-f0-9]{64}$/);
  assert.equal(rules.runtimeFiles.length, 8);
  assert.doesNotMatch(rules.prompt, /codex\/AGENTS\.md/);
  assert.match(rules.prompt, /03_DEVELOPMENT_RULES\.md/);
  assert.match(rules.prompt, /templates\/mini-project\.c/);
});

test("reports a present rule pack but stays unconfigured without a key", async () => {
  const service = createAvrAiService({
    environment: { AI_ENABLED: "1" },
    rulePackRoot,
    miniProjectCatalogPath,
  });

  const status = await service.getStatus();
  assert.equal(status.ok, true);
  assert.equal(status.enabled, true);
  assert.equal(status.configured, false);
  assert.equal(status.ready, false);
  assert.equal(status.model, "gpt-5.6-terra");
  assert.equal(status.accessConfigured, false);
  assert.equal(status.rules.packageId, "uartdebug-rules-2026-07-23.2");
});

test("uses Responses structured output, stores only the private AI file, and returns two public files", async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "uartdebug-ai-test-"));
  t.after(() => fs.rm(tempRoot, { recursive: true, force: true }));
  const draftRoot = path.join(tempRoot, "drafts");
  const capturedRequests = [];
  const responsePayload = {
    output: [
      {
        type: "message",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text: JSON.stringify(makeGeneratedBundle()),
          },
        ],
      },
    ],
  };
  const fakeFetch = async (url, request) => {
    capturedRequests.push({ url, request, body: JSON.parse(request.body) });
    return {
      ok: true,
      status: 200,
      async json() {
        return responsePayload;
      },
    };
  };
  const generatedUuids = [
    "11111111-2222-4333-8444-555555555555",
    "66666666-7777-4888-8999-aaaaaaaaaaaa",
  ];
  const service = createAvrAiService({
    environment: {
      AI_ENABLED: "1",
      OPENAI_API_KEY: "test-key",
      AI_ACCESS_TOKEN: "owner-test-token",
      OPENAI_MODEL: "gpt-5.6-terra",
    },
    rulePackRoot,
    miniProjectCatalogPath,
    draftRoot,
    fetch: fakeFetch,
    now: () => new Date("2026-07-23T12:00:00.000Z"),
    randomUUID: () => generatedUuids.shift(),
  });

  const result = await service.generate({
    prompt: "Create a timer-driven status LED example.",
    mcu: "attiny1624",
    locale: "en",
    baseProjectId: "01_Minimum",
  });

  const capturedRequest = capturedRequests[0];
  assert.equal(capturedRequest.url, "https://api.openai.com/v1/responses");
  assert.equal(capturedRequest.body.store, false);
  assert.equal(capturedRequest.body.model, "gpt-5.6-terra");
  assert.equal(capturedRequest.body.text.format.type, "json_schema");
  assert.equal(capturedRequest.body.text.format.strict, true);
  assert.match(capturedRequest.body.safety_identifier, /^ud_[a-f0-9]{40}$/);
  assert.match(
    capturedRequest.body.instructions,
    /TRUSTED MINI-PROJECT AI REFERENCE 01_Minimum/
  );
  assert.equal(result.project.files.length, 2);
  assert.deepEqual(
    result.project.files.map((file) => file.role),
    ["source", "guide"]
  );
  assert.equal(result.project.aiSpecRef.id, "20260723-11111111-2222-4333-8444-555555555555");
  assert.equal(JSON.stringify(result).includes("Private implementation constraints"), false);

  const privateSpecPath = path.join(
    draftRoot,
    result.project.aiSpecRef.id,
    "BlinkStatus_AI.md"
  );
  assert.match(
    await fs.readFile(privateSpecPath, "utf8"),
    /Private implementation constraints/
  );
  const storedNames = await fs.readdir(
    path.join(draftRoot, result.project.aiSpecRef.id)
  );
  assert.deepEqual(storedNames.sort(), ["BlinkStatus_AI.md", "manifest.json"]);

  await service.generate({
    prompt: "Change the timer interval.",
    mcu: "attiny1624",
    locale: "en",
    currentProject: {
      id: result.project.id,
      title: result.project.title,
      source: result.project.files[0].content,
      guide: result.project.files[1].content,
      aiSpecRef: result.project.aiSpecRef,
    },
  });
  assert.match(
    capturedRequests[1].body.instructions,
    /BEGIN TRUSTED MINI-PROJECT AI REFERENCE draft:20260723-11111111/
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      JSON.parse(capturedRequests[1].body.input).currentProject,
      "aiSpecRef"
    ),
    false
  );
});

test("rejects a static AI reference whose content hash does not match its catalog", async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "uartdebug-ai-reference-"));
  t.after(() => fs.rm(tempRoot, { recursive: true, force: true }));
  const referenceDirectory = path.join(tempRoot, "project");
  const catalogPath = path.join(tempRoot, "catalog.json");
  await fs.mkdir(referenceDirectory);
  await fs.writeFile(
    path.join(referenceDirectory, "project_AI.md"),
    "# Private reference\n",
    "utf8"
  );
  await fs.writeFile(
    catalogPath,
    JSON.stringify({
      schemaVersion: 1,
      projects: [
        {
          id: "project",
          version: "1",
          file: "project/project_AI.md",
          mediaType: "text/markdown",
          sha256: "0".repeat(64),
        },
      ],
    }),
    "utf8"
  );

  let fetchCalled = false;
  const service = createAvrAiService({
    environment: {
      AI_ENABLED: "1",
      OPENAI_API_KEY: "test-key",
      AI_ACCESS_TOKEN: "owner-test-token",
    },
    rulePackRoot,
    miniProjectCatalogPath: catalogPath,
    draftRoot: path.join(tempRoot, "drafts"),
    fetch: async () => {
      fetchCalled = true;
      throw new Error("unexpected fetch");
    },
  });

  await assert.rejects(
    service.generate({
      prompt: "Use the reference.",
      mcu: "attiny1624",
      locale: "en",
      baseProjectId: "project",
    }),
    (error) =>
      error instanceof AiServiceError &&
      error.code === "reference_catalog_invalid"
  );
  assert.equal(fetchCalled, false);
});

test("rejects generated source markers without matching guide headings", () => {
  const bundle = makeGeneratedBundle();
  bundle.source.content = "int x = 0; //# Missing section\n";

  assert.throws(
    () => validateGeneratedBundle(bundle),
    (error) =>
      error instanceof AiServiceError &&
      error.status === 502 &&
      error.code === "invalid_generated_project"
  );
});

test("uses the same marker rules as the browser for strings, block comments, spacing, and fenced headings", () => {
  const accepted = makeGeneratedBundle();
  accepted.source.content = [
    'const char *text = "//# Not a link";',
    "/* //# Not a link either */",
    "int value = 0; //# Real *section*",
    "",
  ].join("\n");
  accepted.guide.content = "# Real section\n";
  assert.doesNotThrow(() => validateGeneratedBundle(accepted));

  const noSpace = makeGeneratedBundle();
  noSpace.source.content = "int value = 0; //#Not a browser link\n";
  noSpace.guide.content = "# Something else\n";
  assert.doesNotThrow(() => validateGeneratedBundle(noSpace));

  const fenced = makeGeneratedBundle();
  fenced.source.content = "int value = 0; //# Hidden\n";
  fenced.guide.content = "```md\n# Hidden\n```\n";
  assert.throws(
    () => validateGeneratedBundle(fenced),
    /missing the heading/i
  );
});

test("parses REST Responses output and rejects a refusal", () => {
  assert.deepEqual(
    parseStructuredOutput({
      output: [
        {
          type: "message",
          content: [
            { type: "output_text", text: '{"ok":' },
            { type: "output_text", text: "true}" },
          ],
        },
      ],
    }),
    { ok: true }
  );

  assert.throws(
    () =>
      parseStructuredOutput({
        output: [
          {
            type: "message",
            content: [{ type: "refusal", refusal: "No" }],
          },
        ],
      }),
    /declined/i
  );

  assert.throws(
    () =>
      parseStructuredOutput({
        status: "incomplete",
        incomplete_details: { reason: "max_output_tokens" },
        output: [],
      }),
    (error) =>
      error instanceof AiServiceError &&
      error.code === "ai_output_limit_reached"
  );
});
