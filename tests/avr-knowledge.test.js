"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { loadKnowledge, resolveKnowledge, calculateTimerPeriod, calculateUsartBaud, calculateRtcPitPeriod, RTC_PIT_PERIOD_CYCLES } = require("../backend/avr-knowledge");
const { loadMaterials, createProjectCatalog, REQUIRED_RULES, INITIAL_KNOWLEDGE, defaultReadable, exampleSource } = require("../backend/avr-materials");
const { createDocumentationLookup } = require("../backend/avr-documentation-lookup");
const { validateSource, parseProjectResources, projectIdentity } = require("../backend/avr-canvas-contract");
const { createMaterialsFixture } = require("./helpers/avr-materials-fixture");

test("canonical mirror verifies every file including excluded notes and binary sources", (t) => {
  const fixture = createMaterialsFixture(t);
  const knowledge = loadKnowledge({ root: fixture.root });
  assert.equal(knowledge.repository, "Sergey-Bulanov/UartDebug2");
  assert.equal(knowledge.version, fixture.manifest.commit);
  assert.equal(knowledge.files.length, Object.keys(fixture.files).length);
  assert.deepEqual(knowledge.initialRules.map((doc) => doc.path), REQUIRED_RULES);
  assert.deepEqual(knowledge.initialKnowledge.map((doc) => doc.path), INITIAL_KNOWLEDGE);
  assert.ok(Object.isFrozen(knowledge));
  assert.strictEqual(loadKnowledge(fixture.root), knowledge);
  assert.equal(fs.existsSync(path.join(fixture.root, "manifest.json")), false);
  assert.equal(knowledge.devices[0].pinouts["SOIC-14"].pins.PB1, 8);
  assert.deepEqual(knowledge.devices[1].packages, ["SOIC-20", "SSOP-20", "VQFN-20"]);
});
test("changed source after loading cannot remain cached behind an unchanged manifest", (t) => {
  const fixture = createMaterialsFixture(t);
  loadMaterials({ root: fixture.root });
  fs.writeFileSync(path.join(fixture.root, "Notes/private.md"), "changed note");
  assert.throws(() => loadMaterials({ root: fixture.root }), /integrity mismatch/);
});
test("missing and extra mirror files fail closed", (t) => {
  const fixture = createMaterialsFixture(t);
  fs.unlinkSync(path.join(fixture.root, "Notes/private.md"));
  assert.throws(() => loadMaterials({ root: fixture.root }), /inventory differs/);
  fs.writeFileSync(path.join(fixture.root, "Notes/private.md"), fixture.files["Notes/private.md"]);
  fs.writeFileSync(path.join(fixture.root, "untracked.txt"), "extra");
  assert.throws(() => loadMaterials({ root: fixture.root }), /inventory differs/);
});
test("unsafe manifest paths and wrong repository identity are rejected", (t) => {
  const fixture = createMaterialsFixture(t);
  fixture.manifest.files["../escape.md"] = { sha256: "0".repeat(64), bytes: 1 };
  fs.writeFileSync(fixture.manifestPath, JSON.stringify(fixture.manifest));
  assert.throws(() => loadMaterials({ root: fixture.root }), /inventory/);
  delete fixture.manifest.files["../escape.md"];
  fixture.manifest.repository = "other/repository";
  fs.writeFileSync(fixture.manifestPath, JSON.stringify(fixture.manifest));
  assert.throws(() => loadMaterials({ root: fixture.root }), /manifest/);
});
test("required reading is never silently truncated or replaced by an old bundle", (t) => {
  const fixture = createMaterialsFixture(t, { "AGENTS.md": "x".repeat(170000) });
  assert.throws(() => loadKnowledge({ root: fixture.root }), /initial context budget/);
  const empty = fs.mkdtempSync(path.join(fixture.directory, "empty-"));
  assert.throws(() => loadKnowledge({ root: empty }), /manifest|inventory/);
});
test("invalid UTF-8 technical source and inconsistent PDF extraction evidence fail closed", (t) => {
  const invalid = createMaterialsFixture(t, { "MCU_Knowledge_Base/AVR/GPIO.md": Buffer.from([0xff, 0xfe, 0x61]) });
  assert.throws(() => loadMaterials({ root: invalid.root }), /encoded data|encoding|UTF-8/i);
  const corrupt = createMaterialsFixture(t, {
    "MCU_Knowledge_Base/AVR/tinyAVR_2_series/ATtiny1624_1626_1627/ATtiny162x_Datasheet_Errata_Extracted_Content.json":
      JSON.stringify({ schemaVersion: 1, documents: [{ id: "datasheet", sourceFile: "raw/source.pdf", sha256: "a".repeat(64), pageCount: 2, pages: [] }] }),
  });
  assert.throws(() => loadMaterials({ root: corrupt.root }), /extraction coverage or digest mismatch/);
});
test("root release snapshot can change without retaining previous source text", (t) => {
  const first = createMaterialsFixture(t);
  const second = createMaterialsFixture(t, { "MCU_Knowledge_Base/AVR/GPIO.md": "# GPIO\nNew canonical generation.\n" });
  second.manifest.commit = "2".repeat(40);
  fs.writeFileSync(second.manifestPath, JSON.stringify(second.manifest));
  const old = loadMaterials({ root: first.root });
  const current = loadMaterials({ root: second.root });
  assert.equal(old.version, "1".repeat(40));
  assert.equal(current.version, "2".repeat(40));
  assert.match(current.documents.find((doc) => doc.id.endsWith("GPIO.md")).text, /New canonical/);
  assert.doesNotMatch(old.documents.find((doc) => doc.id.endsWith("GPIO.md")).text, /New canonical/);
});
test("notes, temporary material, problem ledgers and unselected target projects never enter lookup", async (t) => {
  const fixture = createMaterialsFixture(t);
  const knowledge = loadMaterials({ root: fixture.root });
  assert.ok(knowledge.files.includes("Notes/private.md"), "mirror retains all repository files");
  assert.ok(knowledge.documents.every((doc) => defaultReadable(doc.path)));
  const lookup = createDocumentationLookup({ knowledge, enabled: false });
  for (const name of ["Notes/private.md", "MCU_Knowledge_Base/Problems.md", "Target_Projects/Project_One/Project_One.md", "Temporary_References/tmp/pdfs/scratch.md"]) {
    assert.equal((await lookup.lookup({ operation: "read", documentId: name })).code, "local_document_unknown");
  }
  const result = await lookup.lookup({ operation: "search", query: "SECRET_NOTE SECRET_TARGET SECRET_PROBLEM SECRET_TEMP" });
  assert.equal(result.code, "local_documentation_not_found");
});
test("resolver uses current maps and selected pin facts without the obsolete recipe restrictions", (t) => {
  const fixture = createMaterialsFixture(t);
  const knowledge = loadMaterials({ root: fixture.root });
  const result = resolveKnowledge({ mcu: "attiny1624", packageName: "soic14", knowledge });
  assert.equal(result.supported, true);
  assert.match(result.context, /"PB1":8/);
  for (const file of INITIAL_KNOWLEDGE) assert.ok(result.context.includes(fixture.files[file]));
  assert.ok(!result.context.includes(fixture.files["Notes/private.md"]));
  assert.doesNotMatch(result.context, /only GPIO|approved recipes|avr-project@|methodology-coding-style/);
  assert.equal(resolveKnowledge({ mcu: "ATmega328P", packageName: "DIP28", knowledge }).supported, false);
  assert.equal(resolveKnowledge({ mcu: "ATtiny1624", knowledge }).supported, false);
});
test("catalog publishes unified prepared projects and selected targets without exposing the source tree", (t) => {
  const fixture = createMaterialsFixture(t);
  const knowledge = loadMaterials({ root: fixture.root });
  const catalog = createProjectCatalog(knowledge);
  assert.equal(catalog.listProjects({ includeTargets: false }).length, 1);
  assert.equal(catalog.listProjects().length, 2);
  assert.ok(catalog.listProjects().every((item) => !Object.hasOwn(item, "files") && !Object.hasOwn(item, "canvas")));
  const project = catalog.readProject("example-01_Minimum");
  assert.equal(project.contract, "uartdebug-project/v2");
  assert.equal(project.canvasName, "01_Minimum.md");
  assert.deepEqual(project.canvas.target, { mcu: "ATtiny1624", packageName: "SOIC-14" });
  assert.deepEqual(project.files.map((file) => file.role), ["source", "guide", "specification"]);
  assert.match(project.files[0].content, /\/\/\+ User: application loop/);
  assert.match(project.files[0].content, /while \(1\)/);
  assert.match(project.files[1].content, /does not assert build/);
  assert.match(project.files[2].content, /hardware_resources:/);
  const resources = parseProjectResources(project.files[2].content, { target: { mcu: "ATtiny1624", packageName: "SOIC-14" } });
  assert.doesNotThrow(() => validateSource(project.files[0].content, resources, "", projectIdentity(project.canvas.markdown)));
  assert.equal(catalog.readProject("target-Project_One", { includeTargets: false }), null);
  const target = catalog.readProject("target-Project_One");
  assert.equal(target.canvas.markdown, fixture.files["Target_Projects/Project_One/Project_One.md"]);
  assert.deepEqual(target.canvas.target, { mcu: "ATtiny1624", packageName: "SOIC-14" });
  assert.equal(target.files[0].content, fixture.files["Target_Projects/Project_One/Project_One.c"]);
  assert.equal(catalog.readProject("../../AGENTS.md"), null);
  target.files[0].content = "changed";
  assert.notEqual(catalog.readProject("target-Project_One").files[0].content, "changed");
});

test("catalog shares project identity and latest compatible file resolution with the browser", (t) => {
  const fixture = createMaterialsFixture(t, {
    "Target_Projects/Project_One/Project_One.md": "```markdown\n# Project Example\nProject version - Ver.9.9\n```\n\n# Project Project_One\n\nProject version - Ver.1.0\n\n## Hardware requirements\nATtiny1624 SOIC-14.\n\n## Software requirements\nUse the latest compatible code.\n",
    "Target_Projects/Project_One/Project_One Ver.1.0.2-a(3).c": "latest compatible code",
    "Target_Projects/Project_One/Project_One Ver.1.0.2-a(2).c": "older copy",
    "Target_Projects/Project_One/Project_One Ver.2.0.9.c": "incompatible code",
    "Target_Projects/Project_One/Project_One (description) Ver.1.0.2 (ru).md": "# Описание программы\nАктуальный код.",
    "Target_Projects/Project_One/AGENTS.md": "# Local rules\r\nExact project scope.\r\n",
    "Target_Projects/Project_One/00_README.md": "Read the project's code before its description.",
  });
  const project = createProjectCatalog(loadMaterials({ root: fixture.root })).readProject("target-Project_One");
  assert.equal(project.version, "Ver.1.0");
  assert.equal(project.files.find((file) => file.role === "source").name, "Project_One Ver.1.0.2-a(3).c");
  assert.equal(project.files.find((file) => file.role === "source").content, "latest compatible code");
  assert.equal(project.files.find((file) => file.role === "guide" && file.locale === "ru").content, "# Описание программы\nАктуальный код.");
  assert.deepEqual(project.projectDocuments, [
    { name: "00_README.md", content: "Read the project's code before its description." },
    { name: "AGENTS.md", content: "# Local rules\r\nExact project scope.\r\n" },
  ]);
});

test("catalog reports unresolved file identities instead of silently selecting unrelated code", (t) => {
  const fixture = createMaterialsFixture(t, { "Target_Projects/Project_One/Unconfirmed.c": "wrong code" });
  assert.throws(() => createProjectCatalog(loadMaterials({ root: fixture.root })), /Canonical target project Target_Projects\/Project_One:.*complete alternative/);
});
test("prepared project regions preserve functional C and braces inside comments and strings", () => {
  const source = '#include <xc.h>\n#define F_CPU 3333333UL\nvoid init(void) { /* } */ }\nint main(void) { init(); while (1) { puts("}"); } return 0; }\n';
  const result = exampleSource(source, "Pattern");
  assert.match(result, /void init\(void\) \{ \/\* } \*\/ \}/);
  assert.match(result, /puts\("}"\);/);
  assert.match(result, /#define F_CPU 3333333UL/);
  assert.equal((result.match(/#include <xc.h>/g) || []).length, 1);
  assert.equal((result.match(/\/\/\+ /g) || []).length, 7);
  assert.equal((result.match(/\/\/- /g) || []).length, 7);
  assert.throws(() => exampleSource("#include <xc.h>\nint main(void) { return 0; }", "bad"), /application loop/);
});
test("timer and baud arithmetic retains checked integer precision", () => {
  const timer = calculateTimerPeriod({ clockHz: 20000000, periodUs: 500000, prescaler: 1024 });
  assert.equal(timer.per, 9765);
  assert.equal(calculateUsartBaud({ clockHz: 20000000, baud: 115200 }).value, 694);
  assert.throws(() => calculateTimerPeriod({ clockHz: 20000000, periodUs: Number.MAX_SAFE_INTEGER, prescaler: 1 }), RangeError);
  assert.throws(() => calculateUsartBaud({ clockHz: 3333333, baud: 300000 }), RangeError);
  assert.throws(() => calculateUsartBaud({ clockHz: 20000000, baud: 1 }), RangeError);
  for (const periodCycles of RTC_PIT_PERIOD_CYCLES) assert.equal(calculateRtcPitPeriod({ periodCycles }).periodSymbol, `RTC_PERIOD_CYC${periodCycles}_gc`);
  assert.equal(calculateRtcPitPeriod({ periodCycles: 4096 }).nominalPeriodUs, 125000);
});
