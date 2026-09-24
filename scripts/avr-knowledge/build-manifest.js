"use strict";

// Maintenance command; reads only tracked facts/recipes and pins their hashes.
// node scripts/avr-knowledge/build-manifest.js [--verify]
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const root = path.resolve(__dirname, "../..");
const directory = path.join(root, "backend/ai/knowledge/attiny162x/1.3.0");
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const read = (name) => JSON.parse(fs.readFileSync(path.join(directory, name), "utf8"));
const originals = read("reference/sources.json").sources;
const corpus = read("reference/corpus.json");
const reviewed = read("reference/reviewed-facts.json").facts;
const registers = read("reference/dfp-registers.json");
const methodology = read("methodology/catalog.json");
const facts = JSON.parse(fs.readFileSync(path.join(directory, "devices.json"), "utf8"));
const compilerEvidence = JSON.parse(fs.readFileSync(path.join(directory, "compiler-evidence.json"), "utf8"));
if (hash(fs.readFileSync(path.join(__dirname, "fixtures", compilerEvidence.fixture))) !== compilerEvidence.sourceSha256) throw new Error("Compiler fixture changed; obtain fresh evidence before repinning");
const pitEvidence = read("compiler-evidence-rtc-pit.json");
if (hash(fs.readFileSync(path.join(__dirname, "fixtures", pitEvidence.fixture))) !== pitEvidence.sourceSha256 || pitEvidence.runs.length !== 3 || pitEvidence.runs.some((run) => !run.ok)) throw new Error("RTC/PIT fixture needs valid compiler evidence");
const methodologyEvidence = ["compiler-evidence-gpio-handoff.json", "compiler-evidence-methodology-forward.json"];
for (const file of methodologyEvidence) {
  const evidence = read(file);
  if (hash(fs.readFileSync(path.join(__dirname, "fixtures", evidence.fixture))) !== evidence.sourceSha256 ||
      JSON.stringify(evidence.runs.map((run) => run.mcu)) !== JSON.stringify(["attiny1624", "attiny1626", "attiny1627"]) ||
      evidence.runs.some((run) => !run.ok || run.httpStatus !== 200 || run.compileContract !== "uartdebug-avr-compile/v1" || !/^[a-f0-9]{64}$/.test(run.hexSha256))) {
    throw Error(`Methodology fixture needs valid compiler evidence: ${file}`);
  }
}
const definitions = [
  ["avr-project", ["01_Minimum"], []],
  ["avr-clock", ["02_CPU_Clock", "03_Delay-Based_Blink"], []],
  ["avr-gpio", ["03_Delay-Based_Blink", "04_Timer_Interrupt_Blink"], []],
  ["avr-timer", ["04_Timer_Interrupt_Blink"], []],
  ["avr-rtc-pit", [], []],
  ["avr-uart-polling", ["05_UART_Basic_Transmission", "06_UART_Basic_Receive"], []],
  ["avr-printf", ["07_Printf_Redirect_USART0", "08_Printf_Redirect_USART1"], []],
  ["avr-uart-tx-interrupt", ["09_UART0_Interrupt_Transmission", "10_UART1_Interrupt_Transmission"], []],
];
const files = {};
function pinDirectory(relative = "") {
  for (const entry of fs.readdirSync(path.join(directory, relative), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, "en"))) {
    const name = relative ? `${relative}/${entry.name}` : entry.name;
    if (name === "manifest.json") continue;
    if (entry.isSymbolicLink()) throw new Error(`Symlink in knowledge bundle: ${name}`);
    if (entry.isDirectory()) pinDirectory(name);
    else files[name] = hash(fs.readFileSync(path.join(directory, name)));
  }
}
pinDirectory();
for (const document of methodology.documents) if (files[document.file] !== document.sha256) throw Error(`Methodology manifest mismatch: ${document.id}`);
const colleagueReview = read("reference/colleague-review.json");
const retained = colleagueReview.retainedOriginal;
if (!/^[a-f0-9]{64}$/.test(colleagueReview.sourceArchive.sha256) || !retained.file.startsWith("reference/colleague/") || files[retained.file] !== retained.sha256 || fs.statSync(path.join(directory, retained.file)).size !== retained.bytes || colleagueReview.derivedFixture.sha256 !== pitEvidence.sourceSha256) throw new Error("Colleague source/derivative provenance mismatch");
for (const source of originals) {
  if (files[source.file] !== source.sha256 || fs.statSync(path.join(directory, source.file)).size !== source.bytes) throw new Error(`Original source changed: ${source.id}`);
}
for (const document of corpus.documents) {
  const source = originals.find((source) => source.id === document.sourceId);
  if (!source || document.sha256 !== source.sha256 || document.pageCount !== source.pageCount || document.pages.length !== source.pageCount) throw new Error(`PDF coverage mismatch: ${document.id}`);
  for (const [index, page] of document.pages.entries()) {
    if (page.page !== index + 1 || !page.text.trim() || page.sectionIds.some((id) => !document.sections.some((section) => section.id === id))) throw new Error(`Invalid PDF page: ${document.id}/${index + 1}`);
  }
  for (const section of document.sections) {
    if (section.startPage < 1 || section.endPage < section.startPage || section.endPage > source.pageCount) throw new Error(`Invalid section bounds: ${section.id}`);
  }
}
if (registers.packSha256 !== facts.packSha256) throw new Error("DFP register archive mismatch");
for (const device of registers.devices) {
  const selected = facts.devices.find((item) => item.mcu === device.mcu);
  if (!selected || selected.provenance.atdf.sha256 !== device.atdfSha256 || selected.provenance.header.sha256 !== device.headerSha256) throw new Error(`DFP member mismatch: ${device.mcu}`);
}
for (const fact of reviewed) {
  const document = corpus.documents.find((item) => item.sourceId === fact.sourceId);
  if (!document || !fact.pages?.length || fact.pages.some((page) => !Number.isInteger(page) || page < 1 || page > document.pageCount)) throw new Error(`Invalid reviewed fact provenance: ${fact.id}`);
  if (fact.verification !== "reviewed-against-pdf") throw new Error(`Unsupported review status: ${fact.id}`);
}
const lineage = [];
for (const folder of new Set(definitions.flatMap(([, folders]) => folders))) {
  for (const base of ["public/avr-mini-projects", "backend/ai/mini-projects"]) {
    for (const name of fs.readdirSync(path.join(root, base, folder)).filter((name) => name.endsWith(".c") || name.includes("_AI_"))) {
      const relative = `${base}/${folder}/${name}`;
      lineage.push({ path: relative, sha256: hash(fs.readFileSync(path.join(root, relative))), role: name.endsWith(".c") ? "legacy-example" : "legacy-integration-guidance" });
    }
  }
}
const manifest = {
  schemaVersion: 1, id: "uartdebug-attiny162x", version: "1.3.0", reviewedAt: "2026-09-24",
  coverage: ["Full original DS40002234B (575 pages), DS80000902F (16 pages) and ATtiny DFP 3.4.278 retained with SHA256", "Complete PDF page text and bookmark index, machine-extracted table grids and formula/figure/constraint candidates with page provenance", "Complete ATDF register, bitfield and value-group attributes for ATtiny1624/1626/1627; selected compiler-compatible symbols and package routes", "Reviewed silicon errata and recipe-critical PDF facts; eight recipes derived from ten tutorials and the reviewed colleague update", "Nine maintained coding/workflow/peripheral methodology topics with adoption decisions and all 40 original MD/YAML texts preserved as source data", "Approved generation: OSC20M/prescaler, GPIO, TCA0 SINGLE normal overflow, boot-only INT32K RTC/PIT, UART normal 8N1 polling, stdio redirection, bounded DRE TX"],
  excluded: ["other AVR models/families", "semantic/visual verification of every PDF table, formula and diagram", "electrical or new hardware validation", "approved generation for ADC/SPI/TWI/PWM, fuse/UPDI repurposing, sleep and advanced USART modes"],
  verification: { sources: "Complete hash-locked originals; full machine extraction; separately reviewed PDF facts", compiler: "exact-composed-fixture-passed-xc8-service-for-1624-1626-1627", compilerEvidence: "compiler-evidence.json", hardware: "reported-in-mini-projects-only", limitations: "Complete reference access does not expand approved generation modes. Only exact fixture bytes have compiler evidence; generated firmware still requires its own compile. Legacy tutorials report ATtiny1624/SOIC-14; no new hardware claim for composed firmware or 1626/1627. Source DFP 3.4.278 differs from compiler DFP 3.3.272; only selected shared symbols were compared." },
  sources: originals,
  methodologyEvidence,
  reference: { corpus: "reference/corpus.json", registers: "reference/dfp-registers.json", reviewedFacts: "reference/reviewed-facts.json", colleagueReview: "reference/colleague-review.json", methodology: "methodology/catalog.json", colleagueSources: methodology.originalCorpus, methodologyTopicCount: methodology.documents.length, originalMethodologyCount: methodology.originals.length, pageCount: corpus.documents.reduce((total, doc) => total + doc.pageCount, 0), sectionCount: corpus.documents.reduce((total, doc) => total + doc.sections.length, 0), reviewedFactCount: reviewed.length },
  recipes: definitions.map(([id, folders]) => ({ id, description: fs.readFileSync(path.join(directory, `recipes/${id}/SKILL.md`), "utf8").match(/^description: (.+)$/m)[1].trim(), file: `recipes/${id}/SKILL.md`, sourceIds: originals.map((source) => source.id), reviewedFactIds: reviewed.filter((fact) => fact.recipeIds?.includes(id)).map((fact) => fact.id), lineage: folders, verification: "reviewed-recipe-with-bounded-composition-compile-evidence", compilerEvidence: id === "avr-rtc-pit" ? "compiler-evidence-rtc-pit.json" : "compiler-evidence.json" })),
  lineage,
  files,
};
const target = path.join(directory, "manifest.json");
const content = `${JSON.stringify(manifest, null, 2)}\n`;
if (process.argv.includes("--verify")) {
  if (fs.readFileSync(target, "utf8") !== content) throw new Error("Knowledge manifest drift; review facts, recipes and lineage before repinning");
  console.log("Knowledge manifest and tutorial lineage verified");
} else {
  fs.writeFileSync(target, content);
  console.log("Wrote pinned knowledge manifest");
}
