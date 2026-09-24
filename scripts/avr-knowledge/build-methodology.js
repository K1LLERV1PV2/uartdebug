"use strict";
// Deterministic maintenance index. Original texts remain separate from guidance.
const fs = require("node:fs");
const path = require("node:path");
const { createMethodologyIndex, hash } = require("../../backend/avr-methodology");
const root = path.resolve(__dirname, "../../backend/ai/knowledge/attiny162x/1.3.0");
const folder = path.join(root, "methodology");
const sources = JSON.parse(fs.readFileSync(path.join(root, "reference/colleague-sources.json"), "utf8"));
const files = fs.readdirSync(folder).filter((name) => name.endsWith(".md")).sort();
const expected = ["coding-style", "documentation", "gpio", "interrupts", "project-workflow", "rtc", "tca", "tcb", "usart"];
if (JSON.stringify(files.map((name) => name.slice(0, -3))) !== JSON.stringify(expected)) throw Error("Incomplete methodology topics");
const documents = files.map((file) => {
  const text = fs.readFileSync(path.join(folder, file), "utf8");
  return { id: `methodology-${file.slice(0, -3)}`, file: `methodology/${file}`,
    title: /^#\s+(.+)$/m.exec(text)?.[1] || file, sha256: hash(text),
    alwaysIncluded: file === "coding-style.md", kind: "methodology", text };
});
const topic = (sourcePath) => {
  const peripheral = /\/(GPIO|Interrupts|RTC|TCA|TCB|USART)\//.exec(sourcePath)?.[1]?.toLowerCase();
  return peripheral ? [`methodology-${peripheral}`] : ["methodology-coding-style", "methodology-project-workflow", "methodology-documentation"];
};
const originals = sources.documents.map((doc) => {
  if (hash(doc.text) !== doc.sha256 || Buffer.byteLength(doc.text) !== doc.bytes) throw Error(`Original source changed: ${doc.sourcePath}`);
  return { ...doc, kind: "colleague-source", title: path.posix.basename(doc.sourcePath), relatedMethodology: topic(doc.sourcePath) };
});
const index = createMethodologyIndex({ documents, originals, version: "1.3.0" });
const data = {
  schemaVersion: 1, version: "1.3.0", archiveSha256: sources.archiveSha256,
  originalCorpus: "reference/colleague-sources.json",
  documents: documents.map(({text, ...doc}) => ({ ...doc, sectionCount: index.documents.find((item) => item.id === doc.id).sections.length })),
  originals: originals.map(({text, ...doc}) => doc),
  reviewFiles: fs.readdirSync(path.join(folder, "provenance")).filter((name) => name.endsWith(".json")).sort().map((name) => `methodology/provenance/${name}`),
};
if (data.reviewFiles.length !== 3) throw Error("Methodology reviews are missing");
// Keep adoption decisions traceable to exact archive members and line ranges.
for (const file of data.reviewFiles) {
  const review = JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
  const reviewedSources = review.sources || review.sourceInventory;
  const archiveDigest = review.sourceArchive?.sha256 || review.sourceArchiveSha256;
  if (archiveDigest !== sources.archiveSha256) throw Error(`Review archive mismatch: ${file}`);
  for (const source of reviewedSources) {
    const member = sources.inventory.find((item) => item.path === source.path);
    if (!member || source.sha256 !== member.sha256 || (source.bytes && source.bytes !== member.bytes)) throw Error(`Review source mismatch: ${file}/${source.path}`);
    const original = sources.documents.find((item) => item.sourcePath === source.path);
    if (original && source.lineCount !== original.text.split(/\r\n|\r|\n/).length - (original.text.endsWith("\n") ? 1 : 0)) throw Error(`Review source line count mismatch: ${source.path}`);
  }
  const groups = review.ruleGroups || review.decisions || review.groups;
  if (new Set(groups.map((group) => group.id)).size !== groups.length) throw Error(`Duplicate review decision: ${file}`);
  for (const group of groups) {
    for (const range of group.sources || group.sourceRefs || group.sourceRanges) {
      const source = reviewedSources.find((item) => item.id === range.sourceId);
      const first = range.firstLine || range.lineStart || range.startLine;
      const last = range.lastLine || range.lineEnd || range.endLine;
      if (!source || !Number.isInteger(first) || !Number.isInteger(last) || first < 1 || last < first || last > source.lineCount || (range.sourceSha256 && range.sourceSha256 !== source.sha256)) throw Error(`Review range mismatch: ${file}/${group.id}`);
    }
  }
  for (const document of review.documents || []) {
    if (typeof document === "object" && document.sha256 && hash(fs.readFileSync(path.join(folder, document.file))) !== document.sha256) throw Error(`Reviewed document drift: ${document.file}`);
  }
}
const content = JSON.stringify(data, null, 2) + "\n";
const target = path.join(folder, "catalog.json");
if (process.argv.includes("--verify")) {
  if (fs.readFileSync(target, "utf8") !== content) throw Error("Methodology catalog drift");
} else fs.writeFileSync(target, content);
console.log(`Methodology: ${documents.length} maintained topics, ${originals.length} complete original texts, ${index.documents.reduce((total, doc) => total + doc.sections.length, 0)} readable sections`);
