"use strict";

const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { parse } = require("yaml");

const INDEX_PATH = "Index/Knowledge.sqlite";
const PIN_MAP = "Hardware_References/ATtiny162x_DataSheet/03_IO_Multiplexing/IO_Multiplexing.yaml";
const RULES = Object.freeze([
  "AGENTS.md",
  "Rules/01_Main_Project_Structure.md",
  "Rules/02_Taget_Projects.md",
  "Rules/03_YAML_Format.md",
  "Rules/04_Additional_Rules.md",
]);
const MAX_INDEX_BYTES = 24 * 1024 * 1024;
const MAX_INDEX_ROWS = 30000;
const LOCATION_KINDS = new Set(["file", "markdown_heading", "yaml"]);
const HEADER_PATHS = Object.freeze(Object.fromEntries([1624, 1626, 1627].map(number => [
  `ATtiny${number}`, `Software_References/Device_Headers/iotn${number}.h`,
])));
const REFERENCE_ROOTS = new Set([
  "Hardware_References", "Software_References", "AppNotes_And_Examples",
  "Common_Solutions", "External_Devices", "Reference_Projects", "Supplementary_References",
]);

function readable(file) {
  return REFERENCE_ROOTS.has(file.split("/")[0]) && /\.(?:md|ya?ml|json|c|h|svg)$/i.test(file) &&
    !/(?:^|\/)Problems(?: Ver\.[^/]*)?(?: \([^/]+\))?\.md$/i.test(file);
}

function loadIndex(root, files) {
  if (!files[INDEX_PATH]?.bytes || files[INDEX_PATH].bytes > MAX_INDEX_BYTES) {
    throw Error("The UartDebug3 knowledge index is missing or exceeds its size limit.");
  }
  const db = new DatabaseSync(path.join(root, INDEX_PATH), { readOnly: true });
  try {
    db.exec("PRAGMA trusted_schema = OFF");
    const format = db.prepare("SELECT value FROM metadata WHERE key = 'format'").get();
    if (format?.value !== "AVR.global.index/0.1") throw Error("Unsupported UartDebug3 knowledge index format.");
    const rows = (sql) => {
      const result = db.prepare(`${sql} LIMIT ${MAX_INDEX_ROWS + 1}`).all();
      if (result.length > MAX_INDEX_ROWS) throw Error("The UartDebug3 knowledge index exceeds its row limit.");
      return result;
    };
    const inputs = new Set();
    for (const { path: file, sha256 } of rows("SELECT path, sha256 FROM inputs")) {
      if (!Object.hasOwn(files, file) || files[file].sha256 !== sha256) {
        throw Error(`The UartDebug3 knowledge index is stale: ${file}`);
      }
      inputs.add(file);
    }
    if (!inputs.has("Index/Catalog.yaml") || !inputs.has(PIN_MAP) ||
        Object.values(HEADER_PATHS).some(file => !inputs.has(file))) {
      throw Error("The UartDebug3 index is missing required device sources.");
    }
    const entries = new Map();
    for (const entry of rows("SELECT id, title, kind, status FROM items ORDER BY id")) {
      if ([entry.id, entry.title, entry.kind, entry.status].some(value =>
        typeof value !== "string" || !value || value.length > 1000) || entries.has(entry.id) || Object.hasOwn(files, entry.id)) {
        throw Error("The UartDebug3 index contains an invalid topic.");
      }
      entries.set(entry.id, { ...entry, locations: [], aliases: [] });
    }
    const documentPaths = new Set();
    for (const row of rows("SELECT item_id, path, selector_kind, selector FROM locations ORDER BY item_id, path, selector_kind, selector")) {
      const entry = entries.get(row.item_id);
      if (!entry || !inputs.has(row.path) || !LOCATION_KINDS.has(row.selector_kind) ||
          typeof row.selector !== "string" || row.selector.length > 1000) {
        throw Error("The UartDebug3 index contains an invalid or unpinned document location.");
      }
      if (!readable(row.path)) continue;
      documentPaths.add(row.path);
      entry.locations.push({ documentId: row.path, kind: row.selector_kind, selector: row.selector });
    }
    for (const row of rows("SELECT item_terms.item_id, term_aliases.value FROM item_terms JOIN term_aliases USING (term_id) ORDER BY item_terms.item_id, term_aliases.value")) {
      const entry = entries.get(row.item_id);
      if (!entry || typeof row.value !== "string" || !row.value || row.value.length > 300) {
        throw Error("The UartDebug3 index contains an invalid topic alias.");
      }
      entry.aliases.push(row.value);
    }
    if (!documentPaths.size) throw Error("The UartDebug3 knowledge index has no readable documents.");
    return { documentPaths: [...documentPaths].sort(), topics: [...entries.values()].filter(entry => entry.locations.length) };
  } finally {
    db.close();
  }
}

function loadV3Materials({ root, manifest, read, document, deriveDevices }) {
  const index = loadIndex(root, manifest.files);
  const initialRules = RULES.map(document);
  const additionalRules = Object.keys(manifest.files)
    .filter(file => /^Rules\/\d+_[^/]+\.md$/i.test(file) && !RULES.includes(file));
  for (const file of additionalRules) initialRules.push(document(file));
  const ruleNumber = file => Number(/^Rules\/(\d+)_/.exec(file)?.[1] || 0);
  const numbers = initialRules.map(rule => ruleNumber(rule.path));
  if (numbers.some(number => !Number.isSafeInteger(number)) || new Set(numbers).size !== initialRules.length ||
      initialRules.some(rule => !rule.text.trim()) ||
      initialRules.reduce((total, rule) => total + rule.bytes, 0) > 256 * 1024) {
    throw Error("The UartDebug3 rule order or initial context size is invalid.");
  }
  initialRules.sort((a, b) => ruleNumber(a.path) - ruleNumber(b.path));
  const pinMap = parse(read(PIN_MAP), { maxAliasCount: 0 });
  const devices = deriveDevices(pinMap, {
    devices: Object.entries(HEADER_PATHS).map(([mcu, file]) => {
      const instances = [...read(file).matchAll(/^#define\s+(\w+)\s+\(\*\((\w+)_t\s*\*\)\s*0x[0-9a-f]+\)/gim)]
        .map(([, name, module]) => ({ name, module }));
      if (!instances.length) throw Error(`No device instances found in ${file}.`);
      return { mcu, instances };
    }),
  });
  if (devices.some(device => !device.packages.length ||
      device.packages.some(name => !Object.keys(device.pinouts[name].pins).length))) {
    throw Error("The UartDebug3 pin map does not cover every device.");
  }
  const paths = new Set([
    ...initialRules.map(rule => rule.path), "Index/README.md", "Index/Catalog.yaml", ...index.documentPaths,
    ...Object.keys(manifest.files).filter(file => file.startsWith("Rules/") && /\.md$/i.test(file)),
  ]);
  return {
    id: "uartdebug3-materials", initialRules, initialKnowledge: [], documents: [...paths].map(document),
    devices, deviceHeaders: HEADER_PATHS, indexTopics: index.topics, corpus: { documents: [] },
    reviewedFacts: { facts: [] }, dfpRegisters: null, localDocuments: [], referenceCatalog: [],
    sourceManifest: { index: INDEX_PATH, sha256: manifest.files[INDEX_PATH].sha256, indexedTopics: index.topics.length },
    coverage: ["Pinned UartDebug3 knowledge index and reviewed repository references"],
    verification: "repository-sha256-integrity; compilation and hardware testing are separate",
  };
}

module.exports = { loadV3Materials, RULES, INDEX_PATH, PIN_MAP };
