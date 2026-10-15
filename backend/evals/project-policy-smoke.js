"use strict";

// Opt-in paid integration check. Never run this from ordinary CI.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const YAML = require("yaml");
const { createAvrAiService } = require("../avr-ai-service");
const { loadKnowledge } = require("../avr-knowledge");
const { codeRegions } = require("../avr-canvas-contract");
const { specificationText } = require("../avr-project-format");
const { buildProjectPolicy } = require("../avr-project-policy");

const markdown = `# Project PolicyCheck

Project version - Ver.1.0

## Hardware requirements
ATtiny1624, SOIC-14, VDD 3.3 V. PA3 (physical pin 13) drives an external active-high LED through a suitable current-limiting resistor. Use the power-on-reset internal clock defaults. No interrupts or other connected components are required.

## Software requirements
Set PA3 high once during initialization and keep it high in the forever while (1) loop. No delays, communication, sleep, or further functionality. Use the canonical AI and user insertion regions. All implementation decisions above are confirmed.

## Formatting example (not project requirements)
\`\`\`markdown
# Project WrongExample
Project version - Ver.9.9
## Hardware requirements
ATtiny1627, VQFN-24
C program file - Wrong.c
Project resources file - Wrong.yaml
\`\`\`
`;
const documents = [{ name: "AGENTS.md", content:
  "# Selected project rules\nInitialize the LED output latch before enabling the output driver. Keep code identifiers stable and explain this program in the selected artifact language.\n" }];
const outputDirectory = process.env.PROJECT_POLICY_EVAL_OUTPUT;
const selectedCases = new Set((process.env.PROJECT_POLICY_EVAL_CASES || "review,empty-ru,generate,describe").split(","));

async function main() {
  if (process.env.AI_ENABLED !== "1")
    throw Error("Set AI_ENABLED=1 explicitly to authorize this paid integration check.");
  if (outputDirectory) fs.mkdirSync(outputDirectory, { recursive: true, mode: 0o700 });
  const knowledge = loadKnowledge({ root: process.env.AI_MATERIALS_ROOT });
  let auditedProviderRequests = 0;
  const service = createAvrAiService({
    fetch: async (url, options) => {
      const body = JSON.parse(options.body);
      if (body.instructions) {
        const policyIndex = body.instructions.indexOf(buildProjectPolicy());
        assert.ok(policyIndex >= 0, "Complete integration policy is missing");
        for (const rule of knowledge.initialRules) {
          const start = body.instructions.indexOf(rule.text);
          assert.ok(start >= 0 && start + rule.text.length < policyIndex, rule.path);
          assert.equal(body.instructions.lastIndexOf(rule.text), start, rule.path);
        }
        auditedProviderRequests += 1;
      }
      return fetch(url, options);
    },
  });
  const currentProject = { instanceId: "policy-eval", title: "PolicyCheck", version: "Ver.1.0",
    canvasName: "PolicyCheck.md", sourceName: "PolicyCheck.c", source: "", guide: "",
    guideName: "PolicyCheck (description).md", projectDocuments: documents };
  const canvas = { schemaVersion: 2, revision: 0, markdown, locale: "en", annotations: [],
    target: { mcu: "attiny1624", packageName: "SOIC-14" } };
  const base = { canvas, mcu: "attiny1624", packageName: "SOIC-14", currentProject };
  async function run(name, input, validate) {
    if (!selectedCases.has(name)) return null;
    console.log(JSON.stringify({ started: name }));
    const result = await service.processCanvas(input, { requestId: `project-policy-eval-${name}` });
    if (outputDirectory)
      fs.writeFileSync(path.join(outputDirectory, `${name}.json`), JSON.stringify({ input, result }, null, 2));
    validate(result);
    console.log(JSON.stringify({ passed: true, name, kind: result.kind,
      verification: result.verification?.status, usage: result._metering?.usage }));
    return result;
  }
  await run("review", { ...base, operation: "analyze" }, (result) => {
    assert.equal(result.kind, "canvas");
    assert.ok(!result.project);
    assert.equal(specificationText(result.canvas.markdown), specificationText(markdown));
  });
  await run("empty-ru", { operation: "analyze", canvas: { schemaVersion: 2, revision: 0,
    markdown: "", locale: "ru-RU", annotations: [] }, currentProject: null }, (result) => {
    assert.equal(result.kind, "canvas");
    assert.match(result.canvas.markdown, /^> ###### \*\[ИИ\.1\] Вопрос\.\*/m);
    assert.match(result.canvas.markdown, /[А-Яа-яЁё]/);
  });
  let generated = await run("generate", { ...base, operation: "generate" }, (result) => {
    assert.equal(result.kind, "project");
    assert.equal(result.canvas.markdown, markdown);
    assert.equal(result.project.title, "PolicyCheck");
    assert.equal(result.project.version, "Ver.1.0");
    assert.deepEqual(result.project.projectDocuments, documents);
    const source = result.project.files.find((file) => file.role === "source");
    const resources = result.project.files.find((file) => file.role === "specification");
    assert.equal(source.name, "PolicyCheck.c");
    assert.equal(resources.name, "PolicyCheck.yaml");
    assert.equal(result.verification.status, "passed");
    assert.equal(result.verification.hardware, "not-tested");
    assert.doesNotMatch(source.content, /WrongExample|Wrong\.c|ATtiny1627/);
    assert.equal(YAML.parse(resources.content).microcontroller.model.toLowerCase(), "attiny1624");
    assert.ok(source.content.indexOf("PORTA.OUTSET") < source.content.indexOf("PORTA.DIRSET"));
  });
  if (selectedCases.has("describe")) {
    if (!generated && outputDirectory) {
      const saved = JSON.parse(fs.readFileSync(path.join(outputDirectory, "generate.json"), "utf8"));
      assert.equal(saved.input.canvas.markdown, markdown);
      generated = saved.result;
    }
    assert.ok(generated, "Describe requires Generate or its saved evaluation result");
    const source = generated.project.files.find((file) => file.role === "source").content;
    const region = codeRegions(source).find((entry) => entry.user && /global/i.test(entry.key));
    assert.ok(region, "User globals region is required");
    const lines = source.split("\n");
    lines.splice(region.start + 1, 0, "volatile unsigned int user_policy_counter = 17u;");
    await run("describe", { ...base, operation: "describe", currentProject: { ...currentProject,
      source: lines.join("\n"), guideLocale: "ru", guide:
      "# Описание кода\n\nОпишите фактический код и назначение пользовательской переменной user_policy_counter.\n" } }, (result) => {
      assert.equal(result.kind, "project");
      assert.equal(result.canvas.markdown, markdown);
      assert.deepEqual(result.project.files.map((file) => file.role), ["guide"]);
      const guide = result.project.files[0];
      assert.equal(guide.locale, "ru");
      assert.equal(guide.name, "PolicyCheck (description).md");
      assert.match(guide.content, /[А-Яа-яЁё]/);
      assert.match(guide.content, /user_policy_counter/);
      assert.doesNotMatch(guide.content, /WrongExample|ATtiny1627/);
    });
  }
  console.log(JSON.stringify({ passed: true, model: service.getRuntimeConfig().model,
    sourceCommit: knowledge.version, auditedProviderRequests }));
}

main().catch((error) => {
  console.error(JSON.stringify({ passed: false, code: error.code || "eval_failed", message: error.message }));
  process.exitCode = 1;
});
