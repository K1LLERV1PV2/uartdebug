"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createAvrAiService } = require("../backend/avr-ai-service");
const { normalizeCanvas, CanvasContractError } = require("../backend/avr-canvas-contract");
const {
  PROJECT_STAGES, PROJECT_STAGE_NAMES, buildProjectPolicy, localizedMessage,
} = require("../backend/avr-project-policy");

const ENVIRONMENT = {
  AI_ENABLED: "1", OPENAI_API_KEY: "integration-test-only",
  AI_COMPILE_VERIFY_ENABLED: "0", AI_COMPILE_MAX_REPAIR_ATTEMPTS: "0",
};
const RULE_PATHS = [
  "AGENTS.md", "Project_Rules/AGENTS_Add_On.md",
  "Project_Rules/Project_Description.md", "Project_Rules/Base_project_rules.md",
];
const KNOWLEDGE_TEXT = "REQUIRED_LOCAL_MAP: follow the selected device route.";
const RULES = RULE_PATHS.map((path, index) => ({
  path,
  text: `ORIGINAL_RULE_${index}\n${`Правило ${index}: unchanged source.\n`.repeat(500)}END_RULE_${index}`,
}));
const RESOURCES = 'microcontroller:\n  model: ATtiny1624\n  package: SOIC-14\nhardware_resources: {}\nsoftware_dependencies:\n  includes:\n    - "#include <xc.h>"\n';

function source(user = "") {
  const region = (name, content = "", indent = "") =>
    `${indent}//+ Begin ${name}\n${content ? `${content}\n` : ""}${indent}//- End ${name}`;
  return [
    "// Project name: led", "// Project version: Ver.1.0", "#include <xc.h>", "",
    region("AI includes and defines"), "",
    region("AI global functions and variables"), "",
    region("user global functions and variables", user), "",
    "int main(void)", "{",
    region("AI local variables and initialization", "", "    "), "",
    region("user local variables and initialization", "", "    "), "",
    "    while (1)", "    {",
    region("AI cyclic code", "", "        "), "",
    region("user cyclic code", "", "        "),
    "    }", "    return 0;", "}", "",
  ].join("\n");
}

function input(operation = "generate", locale = "en") {
  return {
    operation, mcu: "attiny1624", packageName: "SOIC-14",
    canvas: {
      schemaVersion: 2, revision: 3, locale, annotations: [],
      target: { mcu: "attiny1624", packageName: "SOIC-14" },
      markdown: "# Project led\n\nProject version - Ver.1.0\n\n## Hardware requirements\nATtiny1624, SOIC-14.\n\n## Software requirements\nRun the main loop.\n",
    },
  };
}
function currentProject(content = source()) {
  return {
    instanceId: "integration-led", id: "selected-led", title: "led",
    version: "Ver.1.0", canvasName: "led.md", projectPath: "Target_Projects/led Ver.1.0",
    sourceName: "led.c", source: content,
    specification: { name: "led.yaml", content: RESOURCES },
    guideName: "led (description).md", guide: "", guideLocale: "",
  };
}
function output(request) {
  const result = {
    action: PROJECT_STAGES[request.operation].action, message: "Stage complete.",
    canvas: { markdown: request.canvas.markdown, locale: request.canvas.locale, annotations: [] },
    project: null,
  };
  if (request.operation !== "analyze") {
    result.project = {
      title: "led", version: "Ver.1.0", summary: "Runs the main loop.",
      source: null, resources: null, guide: null,
    };
    if (request.operation === "generate") {
      result.project.source = { name: "led.c", content: request.currentProject?.source || source() };
      result.project.resources = { name: "led.yaml", content: RESOURCES };
    } else {
      result.project.guide = {
        name: "led (description).md", locale: request.canvas.locale,
        content: "# led\n\nThe supplied C program runs the main loop.\n",
      };
    }
  }
  return result;
}
function harness({ respond = output } = {}) {
  const requests = [];
  const knowledge = {
    id: "UartDebug2", version: "a".repeat(40), repository: "Sergey-Bulanov/UartDebug2",
    manifest: { commit: "a".repeat(40), files: {} }, initialRules: RULES,
    initialKnowledge: [{ path: "MCU_Knowledge_Base/00_README.md", text: KNOWLEDGE_TEXT }],
    devices: [
      { mcu: "ATtiny1624", packages: ["SOIC-14"], pinouts: { "SOIC-14": { pins: { PA3: 13 } } } },
      { mcu: "ATtiny1626", packages: ["SOIC-20"], pinouts: { "SOIC-20": { pins: {} } } },
    ],
    corpus: { documents: [] }, reviewedFacts: { facts: [] }, dfpRegisters: { devices: [] },
  };
  const service = createAvrAiService({
    environment: ENVIRONMENT, loadKnowledge: () => knowledge,
    fetch: async (_url, options) => {
      const body = JSON.parse(options.body);
      requests.push(body);
      const request = JSON.parse(body.input[0].content);
      return {
        ok: true, status: 200,
        json: async () => ({
          id: "resp_project_integration", model: "gpt-6.1-sol", status: "completed",
          output: [{ type: "message", role: "assistant", content: [{
            type: "output_text", text: JSON.stringify(respond(request)),
          }] }],
          usage: { input_tokens: 100, output_tokens: 25, total_tokens: 125 },
        }),
      };
    },
    documentationFetch: async () => { throw Error("Unexpected external documentation request"); },
  });
  return { service, requests };
}
async function assertPreflight(request, key) {
  const { service, requests } = harness();
  const result = await service.processCanvas(request);
  assert.equal(requests.length, 0, key);
  assert.equal(result.kind, "canvas", key);
  assert.equal(result.project, undefined, key);
  assert.equal(result.message, localizedMessage(key, request.canvas.locale), key);
  assert.equal(result.canvas.markdown, request.canvas.markdown, key);
  return result;
}

test("all stages receive complete original rules once, knowledge, then one authoritative selected-stage policy", async () => {
  for (const operation of PROJECT_STAGE_NAMES) {
    const request = input(operation);
    if (operation === "describe") request.currentProject = currentProject();
    const { service, requests } = harness();
    const result = await service.processCanvas(request);
    assert.equal(requests.length, 1, operation);
    const instructions = requests[0].instructions;
    let previousEnd = -1;
    for (const rule of RULES) {
      assert.equal(instructions.split(rule.text).length, 2, rule.path);
      const position = instructions.indexOf(rule.text);
      assert.ok(position > previousEnd, rule.path);
      previousEnd = position + rule.text.length;
    }
    const knowledgePosition = instructions.indexOf(KNOWLEDGE_TEXT);
    const policy = buildProjectPolicy();
    assert.equal(instructions.split(policy).length, 2, operation);
    assert.ok(knowledgePosition > previousEnd, operation);
    assert.ok(instructions.indexOf(policy) > knowledgePosition, operation);
    assert.ok(instructions.endsWith(`Selected stage: ${operation}. ${JSON.stringify(PROJECT_STAGES[operation])}`));
    assert.equal(result.canvas.markdown, request.canvas.markdown);
    if (operation === "analyze") {
      assert.equal(result.kind, "canvas");
      assert.equal(result.project, undefined);
      assert.doesNotMatch(result.canvas.markdown, /\[(?:AI|ИИ)\.\d+\]/);
    } else {
      assert.equal(result.kind, "project");
      assert.deepEqual(result.project.files.map((file) => file.role),
        operation === "generate" ? ["source", "specification"] : ["guide"]);
    }
  }
});

test("UI selection cannot override ambiguous hardware and target preflights are localized before provider work", async () => {
  for (const locale of ["en-US", "ru-RU"]) {
    for (const hardware of ["ATtiny1624 or ATtiny1626, SOIC-14.", "ATtiny1624, SOIC-14 or SOIC-20."]) {
      const request = input("generate", locale);
      request.canvas.markdown = request.canvas.markdown.replace("ATtiny1624, SOIC-14.", hardware);
      await assertPreflight(request, "targetAmbiguous");
    }
    const conflicting = input("generate", locale);
    conflicting.canvas.markdown = conflicting.canvas.markdown.replace("ATtiny1624, SOIC-14.", "ATtiny1626, SOIC-20.");
    await assertPreflight(conflicting, "targetConflict");
    const missing = input("generate", locale);
    missing.mcu = missing.packageName = "";
    missing.canvas.target = { mcu: "", packageName: "" };
    missing.canvas.markdown = missing.canvas.markdown.replace("ATtiny1624, SOIC-14.", "Target not specified.");
    await assertPreflight(missing, "targetMissing");
    const unsupported = input("generate", locale);
    unsupported.mcu = "atmega328p";
    unsupported.packageName = "DIP-28";
    unsupported.canvas.target = { mcu: unsupported.mcu, packageName: unsupported.packageName };
    unsupported.canvas.markdown = unsupported.canvas.markdown.replace("ATtiny1624, SOIC-14.", "ATmega328P, DIP-28.");
    await assertPreflight(unsupported, "targetUnsupported");
  }
});

test("explicit UI device selection completes a target omitted from Markdown without rewriting the specification", async () => {
  const request = input();
  request.canvas.markdown = request.canvas.markdown.replace("ATtiny1624, SOIC-14.", "An external LED is connected to PA3.");
  const { service, requests } = harness();
  const result = await service.processCanvas(request);
  assert.equal(requests.length, 1);
  assert.equal(result.kind, "project");
  assert.equal(result.canvas.markdown, request.canvas.markdown);
  assert.deepEqual(result.canvas.target, request.canvas.target);
  const providerInput = JSON.parse(requests[0].input[0].content);
  assert.deepEqual(providerInput.canvas.target, request.canvas.target);
  assert.match(result.project.files.find((file) => file.name === "led.yaml").content,
    /model: ATtiny1624\n  package: SOIC-14/);
});

test("identity, missing source and unconfirmed output-name failures preserve the specification without paid work", async () => {
  for (const locale of ["en", "ru"]) {
    const unidentified = input("generate", locale);
    unidentified.canvas.markdown = "# Draft\n";
    await assertPreflight(unidentified, "identity");
    await assertPreflight(input("describe", locale), "source");
    const mismatched = input("generate", locale);
    mismatched.currentProject = { ...currentProject(), sourceName: "unconfirmed.c" };
    await assertPreflight(mismatched, "outputNames");
    const incompletePair = input("generate", locale);
    incompletePair.canvas.markdown += "\nC program file - alternative.c\n";
    await assertPreflight(incompletePair, "outputNames");
  }
});

test("damaged, absent or missing regions and real pending user instructions are clarified before generation", async () => {
  const cases = [
    [source().replace("//- End AI cyclic code", ""), "damagedMarkers"],
    ["#include <xc.h>\nint main(void) { while (1) {} return 0; }\n", "damagedMarkers"],
    [source().replace(/\s*\/\/[+-] (?:Begin|End) user cyclic code/g, ""), "damagedMarkers"],
    [source("//X Replace this user declaration.\nint user_counter;"), "userRegions"],
    [source("int user_counter; // !X Remove this variable."), "userRegions"],
  ];
  for (const locale of ["en", "ru"]) {
    for (const [content, key] of cases) {
      const request = input("generate", locale);
      request.currentProject = currentProject(content);
      await assertPreflight(request, key);
    }
  }
});

test("instruction lookalikes in user strings and block comments remain unchanged through generation", async () => {
  const user = [
    'const char *marker = "//X replace user code";',
    'const char *other = "// !X delete declaration";',
    'const char *example = "//+ Begin fake user area\\n//- End fake user area";',
    "/* //X this is quoted documentation, not an instruction */",
  ].join("\n");
  const request = input();
  request.currentProject = currentProject(source(user));
  const { service, requests } = harness();
  const result = await service.processCanvas(request);
  assert.equal(requests.length, 1);
  assert.equal(result.kind, "project");
  assert.equal(result.project.files.find((file) => file.role === "source").content, request.currentProject.source);
});

test("only two explicitly supplied local project documents enter the selected input and survive output", async () => {
  for (const projectDocuments of [
    [{ name: "../AGENTS.md", content: "outside" }],
    [{ name: "notes.md", content: "unsupported" }],
    [{ name: "AGENTS.md", content: "first" }, { name: "AGENTS.md", content: "duplicate" }],
  ]) {
    const request = input();
    request.currentProject = { ...currentProject(), projectDocuments };
    const { service, requests } = harness();
    await assert.rejects(service.processCanvas(request), (error) =>
      error.status === 400 && error.code === "invalid_current_project");
    assert.equal(requests.length, 0);
  }
  const request = input();
  const projectDocuments = [
    { name: "AGENTS.md", content: "SELECTED_LOCAL_RULE: retain the user counter." },
    { name: "00_README.md", content: "SELECTED_LOCAL_MAP: this browser project only." },
  ];
  request.currentProject = { ...currentProject(), projectDocuments };
  const { service, requests } = harness();
  const result = await service.processCanvas(request);
  assert.equal(requests.length, 1);
  const providerInput = JSON.parse(requests[0].input[0].content);
  assert.deepEqual(providerInput.currentProject.projectDocuments, projectDocuments);
  assert.deepEqual(result.project.projectDocuments, projectDocuments);
  assert.equal(result.targetInstanceId, request.currentProject.instanceId);
  assert.equal(result.operation, "update");
  for (const document of projectDocuments)
    assert.ok(!requests[0].instructions.includes(document.content));
  assert.doesNotMatch(requests[0].instructions, /Repository project rules \(Target_Projects\//);
  assert.deepEqual(result.project.files.map((file) => file.name), ["led.c", "led.yaml"]);
});

test("an existing description with undetermined language can select its own known language independently of the canvas", async () => {
  const request = input("describe", "en");
  request.currentProject = {
    ...currentProject(), guideName: "led (description) (es).md", guideLocale: "und",
    guide: "# Descripción del programa\n\nEl programa ejecuta continuamente el bucle principal.\n",
  };
  const { service, requests } = harness({
    respond: (providerInput) => {
      const result = output(providerInput);
      result.project.guide = {
        name: request.currentProject.guideName, locale: "es",
        content: "# Descripción del programa\n\nEl código C actual ejecuta continuamente el bucle principal.\n",
      };
      return result;
    },
  });
  const result = await service.processCanvas(request);
  assert.equal(requests.length, 1);
  const providerInput = JSON.parse(requests[0].input[0].content);
  assert.equal(providerInput.currentProject.guideLocale, "und");
  assert.equal(providerInput.currentProject.guide, request.currentProject.guide);
  assert.equal(result.canvas.locale, "en");
  assert.equal(result.project.files[0].name, request.currentProject.guideName);
  assert.equal(result.project.files[0].locale, "es");
  const unresolved = harness({
    respond: (providerInput) => {
      const result = output(providerInput);
      result.project.guide.name = request.currentProject.guideName;
      result.project.guide.locale = "und";
      return result;
    },
  });
  await assert.rejects(unresolved.service.processCanvas(request), (error) =>
    error.code === "invalid_generated_canvas" && /description language/.test(error.message));
  assert.equal(unresolved.requests.length, 1);
  const russian = input("describe", "en");
  russian.currentProject = {
    ...currentProject(), guideLocale: "ru-x-default",
    guide: "# Описание программы\n\nПрограмма выполняет основной цикл.\n",
  };
  const privateTag = harness({
    respond: (providerInput) => {
      const result = output(providerInput);
      result.project.guide.locale = "ru-x-default";
      result.project.guide.content = "# Описание программы\n\nТекущий код выполняет основной цикл.\n";
      return result;
    },
  });
  const russianResult = await privateTag.service.processCanvas(russian);
  assert.equal(privateTag.requests.length, 1);
  assert.equal(russianResult.canvas.locale, "en");
  assert.equal(russianResult.project.files[0].locale, "ru-x-default");
  assert.equal(russianResult.project.files[0].name, russian.currentProject.guideName);
});

test("unknown canvas language stays unknown and Russian remarks do not choose an English specification's preflight language", async () => {
  const request = input("generate", "und");
  assert.equal(normalizeCanvas(request.canvas).locale, "");
  assert.throws(() => normalizeCanvas({ ...request.canvas, locale: 123 }), CanvasContractError);
  assert.equal(normalizeCanvas({ ...request.canvas, locale: "ru-x-default" }).locale, "ru-x-default");
  assert.throws(() => normalizeCanvas({ ...request.canvas, locale: "ru-x" }), CanvasContractError);
  request.canvas.markdown = request.canvas.markdown.replace("Project version - Ver.1.0\n", "") +
    "\n> ###### *[ИИ.1] Вопрос.*\n>\n> Укажите версию проекта.\n";
  const result = await assertPreflight(request, "identity");
  assert.equal(result.canvas.locale, "");
  assert.doesNotMatch(result.message, /[А-Яа-яЁё]/);
  const russianReview = input("analyze", "ru-x-default");
  const privateTag = harness({
    respond: (providerInput) => {
      const result = output(providerInput);
      result.canvas.markdown += "\n> ###### *[ИИ.1] Информация.*\n>\n> Проверка выполнена.\n";
      return result;
    },
  });
  const reviewed = await privateTag.service.processCanvas(russianReview);
  assert.equal(privateTag.requests.length, 1);
  assert.equal(reviewed.canvas.locale, "ru-x-default");
  assert.match(reviewed.canvas.markdown, /\[ИИ\.1\] Информация/);
});
