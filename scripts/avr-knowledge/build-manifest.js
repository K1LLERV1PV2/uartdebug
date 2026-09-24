"use strict";

// Maintenance command; reads only tracked facts/recipes and pins their hashes.
// node scripts/avr-knowledge/build-manifest.js [--verify]
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const root = path.resolve(__dirname, "../..");
const directory = path.join(root, "backend/ai/knowledge/attiny162x/1.0.0");
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const documents = JSON.parse(fs.readFileSync(path.join(directory, "documents.json"), "utf8"));
const facts = JSON.parse(fs.readFileSync(path.join(directory, "devices.json"), "utf8"));
const compilerEvidence = JSON.parse(fs.readFileSync(path.join(directory, "compiler-evidence.json"), "utf8"));
if (hash(fs.readFileSync(path.join(__dirname, "fixtures", compilerEvidence.fixture))) !== compilerEvidence.sourceSha256) throw new Error("Compiler fixture changed; obtain fresh evidence before repinning");
const definitions = [
  ["avr-project", ["01_Minimum"], []],
  ["avr-clock", ["02_CPU_Clock", "03_Delay-Based_Blink"], ["clkctrl-a", "clkctrl-b"]],
  ["avr-gpio", ["03_Delay-Based_Blink", "04_Timer_Interrupt_Blink"], []],
  ["avr-timer", ["04_Timer_Interrupt_Blink"], []],
  ["avr-uart-polling", ["05_UART_Basic_Transmission", "06_UART_Basic_Receive"], ["usart-rx", "usart-baud", "usart-baud-register", "usart-status"]],
  ["avr-printf", ["07_Printf_Redirect_USART0", "08_Printf_Redirect_USART1"], ["usart-status"]],
  ["avr-uart-tx-interrupt", ["09_UART0_Interrupt_Transmission", "10_UART1_Interrupt_Transmission"], ["usart-status"]],
];
const files = {};
for (const name of ["devices.json", "documents.json", "compiler-evidence.json", "MICROCHIP-LICENSE.txt", ...definitions.map(([id]) => `recipes/${id}/SKILL.md`)]) files[name] = hash(fs.readFileSync(path.join(directory, name)));
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
  schemaVersion: 1, id: "uartdebug-attiny162x", version: "1.0.0", reviewedAt: "2026-09-24",
  coverage: ["ATtiny1624/1626/1627 package pinouts, memory, selected DFP symbols and USART routes", "OSC20M/prescaler, basic GPIO, TCA0 SINGLE normal overflow, UART normal 8N1 polling, stdio redirection, bounded DRE TX", "selected official HTML factual digests; errata revision provenance only"],
  excluded: ["other AVR models/families", "complete datasheet and errata coverage", "electrical validation", "ADC/SPI/TWI/PWM", "fuse/UPDI repurposing", "sleep and advanced USART modes"],
  verification: { sources: "DFP extracted with SHA256; selected HTML reviewed as factual digests", compiler: "exact-composed-fixture-passed-xc8-service-for-1624-1626-1627", compilerEvidence: "compiler-evidence.json", hardware: "reported-in-mini-projects-only", limitations: "Only exact fixture bytes have new compiler evidence; generated firmware still requires its own compile. Legacy tutorials report ATtiny1624/SOIC-14; no new hardware claim for composed firmware or 1626/1627." },
  sources: [
    { id: facts.sourceId, title: "Microchip ATtiny Device Family Pack 3.4.278", url: "https://packs.download.microchip.com/Microchip.ATtiny_DFP.3.4.278.atpack", sha256: facts.packSha256, digestScope: "downloaded-pack-bytes", verification: "extracted-official-atdf-and-xc8-header", license: "Apache-2.0; see MICROCHIP-LICENSE.txt" },
    ...documents.map((document) => ({ id: document.sourceId, title: document.title, url: document.url, sha256: hash(document.text), digestScope: "curated-local-digest-not-raw-html", verification: document.snapshotKind === "provenance-only" ? "revision-provenance-only" : "selected-facts-reviewed-official-html", rawSourceSha256: null })),
  ],
  recipes: definitions.map(([id, folders, sourceIds]) => ({ id, description: fs.readFileSync(path.join(directory, `recipes/${id}/SKILL.md`), "utf8").match(/^description: (.+)$/m)[1].trim(), file: `recipes/${id}/SKILL.md`, sourceIds: [facts.sourceId, ...sourceIds], lineage: folders, verification: "reviewed-recipe-with-bounded-composition-compile-evidence", compilerEvidence: "compiler-evidence.json" })),
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
