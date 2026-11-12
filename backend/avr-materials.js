"use strict";

// The private repository is an immutable source mirror. Derived indexes and
// deployment metadata belong next to it, never inside its directory tree.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { parse: parseYaml } = require("yaml");
const { loadV3Materials, RULES: REQUIRED_RULES_V3 } = require("./avr-materials-v3");

const LEGACY_REPOSITORY = "Sergey-Bulanov/UartDebug2";
const REPOSITORY = "Sergey-Bulanov/UartDebug3";
const supportedRepository = (value) => value === REPOSITORY || value === LEGACY_REPOSITORY;
const DEVICE_ROOT = "MCU_Knowledge_Base/AVR/tinyAVR_2_series/ATtiny1624_1626_1627";
const REQUIRED_RULES = Object.freeze([
  "AGENTS.md",
  "Project_Rules/AGENTS_Add_On.md",
  "Project_Rules/Project_Description.md",
  "Project_Rules/Base_project_rules.md",
]);
const INITIAL_KNOWLEDGE = Object.freeze([
  "MCU_Knowledge_Base/00_README.md",
  "MCU_Knowledge_Base/AVR/00_README.md",
  "MCU_Knowledge_Base/AVR/AVR_Programming_General_Rules.md",
  "MCU_Knowledge_Base/AVR/tinyAVR_2_series/00_README.md",
  "MCU_Knowledge_Base/AVR/Software_References/AVR42787/00_README.md",
]);
const MAX_SOURCE_BYTES = 512 * 1024 * 1024;
const MAX_INITIAL_BYTES = 160 * 1024;
const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const cache = new Map();
const PROJECT_CATALOG_FILENAME = "project-catalog.json";
const MAX_PROJECT_CATALOG_BYTES = 64 * 1024 * 1024;
const catalogCache = new Map();

function materialsRoot(input = {}) {
  const requested = typeof input === "string" ? input : input.root || input.materialsRoot;
  return path.resolve(requested || process.env.AI_MATERIALS_ROOT ||
    (process.platform === "win32" ? path.join(__dirname, "../../UartDebug3") :
      "/var/lib/uartdebug-ai/materials/current/repository"));
}

function safeRelative(file) {
  return typeof file === "string" && file.length > 0 && file.length <= 1000 &&
    !file.includes("\\") && !file.includes("\0") && !path.posix.isAbsolute(file) &&
    !/^[A-Za-z]:/.test(file) && file.split("/").every((part) => part && part !== "." && part !== "..");
}

function enumerate(root, directory = "") {
  const files = [];
  for (const item of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
    if (!directory && item.name === ".git") continue;
    const relative = directory ? `${directory}/${item.name}` : item.name;
    if (!safeRelative(relative) || item.isSymbolicLink()) throw Error(`Invalid material path: ${relative}`);
    if (item.isDirectory()) files.push(...enumerate(root, relative));
    else if (item.isFile()) files.push(relative);
    else throw Error(`Invalid material entry: ${relative}`);
  }
  return files.sort();
}

function fileDigest(filename) {
  const descriptor = fs.openSync(filename, "r");
  const digest = crypto.createHash("sha256");
  const buffer = Buffer.allocUnsafe(256 * 1024);
  let bytes = 0;
  try {
    for (;;) {
      const count = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (!count) break;
      digest.update(buffer.subarray(0, count));
      bytes += count;
    }
  } finally { fs.closeSync(descriptor); }
  return { sha256: digest.digest("hex"), bytes };
}

function titleOf(text, file) {
  return /^#{1,3}\s+(.+)$/m.exec(text)?.[1]?.trim() || path.posix.basename(file);
}

function defaultReadable(file) {
  if (file === "AGENTS.md" || file.startsWith("Project_Rules/")) return /\.md$/i.test(file);
  return (file.startsWith("MCU_Knowledge_Base/") || file.startsWith("Reusable_Target_Projects/")) &&
    !/(?:^|\/)Problems(?: Ver\.[^/]*)?(?: \([^/]+\))?\.md$/i.test(file) && /\.(?:md|yaml|yml|json|c|h|svg)$/i.test(file);
}

function deriveDevices(pinTable, dfp) {
  const packages = {
    tssop_soic_14: ["SOIC-14", "TSSOP-14"],
    ssop_soic_20: ["SOIC-20", "SSOP-20"],
    vqfn_20: ["VQFN-20"],
    vqfn_24: ["VQFN-24"],
  };
  return (dfp.devices || []).map((device) => {
    const pinouts = {};
    for (const [column, metadata] of Object.entries(pinTable.package_columns || {})) {
      if (metadata.device !== device.mcu) continue;
      const pins = {};
      for (const [name, pin] of Object.entries(pinTable.pins || {})) {
        const number = pin.package_pins?.[column];
        if (Number.isSafeInteger(number) && number > 0) pins[name] = number;
      }
      for (const packageName of packages[column] || []) pinouts[packageName] = { pins };
    }
    return { mcu: device.mcu, packages: Object.keys(pinouts), pinouts,
      instances: device.instances, modules: device.modules };
  });
}

function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value)) freeze(item);
  }
  return value;
}

function loadMaterials(input = {}) {
  const requestedRoot = materialsRoot(input);
  const root = fs.realpathSync(requestedRoot);
  const manifestPath = path.resolve(typeof input === "object" && input.manifestPath || path.join(root, "../manifest.json"));
  const manifestBytes = fs.readFileSync(manifestPath);
  const manifestKey = `${root}:${sha256(manifestBytes)}`;
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  if (manifest.schemaVersion !== 1 || !supportedRepository(manifest.repository) ||
      !/^[a-f0-9]{40}$/.test(manifest.commit || "") ||
      !manifest.files || typeof manifest.files !== "object" || Array.isArray(manifest.files)) {
    throw Error("Invalid AVR materials manifest");
  }
  const names = Object.keys(manifest.files).sort();
  if (!names.length || names.length > 10000 || names.some((file) => !safeRelative(file))) throw Error("Invalid AVR materials inventory");
  const actual = enumerate(root);
  if (actual.length !== names.length || actual.some((file, index) => file !== names[index])) {
    throw Error("AVR materials inventory differs from the pinned repository");
  }
  const fingerprint = names.map((file) => {
    const stat = fs.lstatSync(path.join(root, file));
    if (!stat.isFile() || stat.isSymbolicLink()) throw Error(`Invalid material entry: ${file}`);
    return `${file}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}:${stat.ino}`;
  }).join("\n");
  const existing = cache.get(manifestKey);
  if (existing?.fingerprint === fingerprint) return existing.value;
  let totalBytes = 0;
  for (const file of names) {
    const expected = manifest.files[file];
    if (!expected || !/^[a-f0-9]{64}$/.test(expected.sha256 || "") ||
        !Number.isSafeInteger(expected.bytes) || expected.bytes < 0) throw Error(`Invalid material digest: ${file}`);
    totalBytes += expected.bytes;
    if (totalBytes > MAX_SOURCE_BYTES) throw Error("AVR materials exceed the source size limit");
    const actualDigest = fileDigest(path.join(root, file));
    if (actualDigest.bytes !== expected.bytes || actualDigest.sha256 !== expected.sha256) {
      throw Error(`AVR materials integrity mismatch: ${file}`);
    }
  }
  const read = (file) => {
    if (!Object.hasOwn(manifest.files, file)) throw Error(`Required AVR material missing: ${file}`);
    return new TextDecoder("utf-8", { fatal: true }).decode(fs.readFileSync(path.join(root, file)));
  };
  const document = (file) => {
    const text = read(file);
    const kind = file === "AGENTS.md" || /^(?:Project_Rules|Rules)\//.test(file) ? "project-rule" :
      file.endsWith("00_README.md") || file.startsWith("Index/") ? "knowledge-map" :
        file.startsWith("Reusable_Target_Projects/") ? "reusable-example" : "reference";
    return { id: file, path: file, sourcePath: file, title: titleOf(text, file), kind,
      text, sha256: manifest.files[file].sha256, bytes: manifest.files[file].bytes,
      revision: manifest.commit, mediaType: file.endsWith(".json") ? "application/json" :
        /\.ya?ml$/.test(file) ? "application/yaml" : "text/plain" };
  };
  const base = { root, manifest, manifestSha256: sha256(manifestBytes),
    repository: manifest.repository, version: manifest.commit, files: names, totalBytes };
  if (manifest.repository === REPOSITORY) {
    const value = freeze({ ...base, ...loadV3Materials({ root, manifest, read, document, deriveDevices }) });
    cache.clear();
    cache.set(manifestKey, { value, fingerprint });
    return value;
  }
  const initialRules = REQUIRED_RULES.map(document);
  const initialKnowledge = INITIAL_KNOWLEDGE.map(document);
  if ([...initialRules, ...initialKnowledge].reduce((sum, item) => sum + item.bytes, 0) > MAX_INITIAL_BYTES) {
    throw Error("Required AVR reading exceeds the initial context budget");
  }
  const parse = (file) => JSON.parse(read(`${DEVICE_ROOT}/${file}`));
  const dfpRegisters = parse("ATtiny162x_DFP_3.4.278_Extracted_Device_Definitions.json");
  const corpus = parse("ATtiny162x_Datasheet_Errata_Extracted_Content.json");
  const reviewedFacts = parse("ATtiny162x_Reviewed_Technical_Facts.json");
  const sourceManifest = parse("ATtiny162x_Primary_Sources_Manifest.json");
  const pins = parseYaml(read(`${DEVICE_ROOT}/DS40002234B_Datasheet_Chapters/03_IO_Multiplexing_and_Considerations/ATtiny162x_Pin_Multiplexing.yaml`));
  if (dfpRegisters.schemaVersion !== 1 || !Array.isArray(dfpRegisters.devices) ||
      corpus.schemaVersion !== 1 || !Array.isArray(corpus.documents) ||
      reviewedFacts.schemaVersion !== 1 || !Array.isArray(reviewedFacts.facts)) {
    throw Error("Invalid canonical AVR reference schema");
  }
  // Preserve extraction provenance while providing current mirror paths.
  const localCorpus = { ...corpus, documents: corpus.documents.map((item) => ({
    ...item, sourceFile: `${DEVICE_ROOT}/${item.sourceFile}`,
    materialPath: `${DEVICE_ROOT}/ATtiny162x_Datasheet_Errata_Extracted_Content.json`,
  })) };
  for (const item of localCorpus.documents) {
    const expected = manifest.files[item.sourceFile];
    if (!expected || expected.sha256 !== item.sha256 || !Number.isSafeInteger(item.pageCount) || item.pageCount < 1 ||
        !Array.isArray(item.pages) || item.pages.length !== item.pageCount ||
        item.pages.some((page, index) => page.page !== index + 1 || typeof page.text !== "string")) {
      throw Error(`Canonical PDF extraction coverage or digest mismatch: ${item.id}`);
    }
  }
  const documents = names.filter(defaultReadable).filter((file) => !file.endsWith("ATtiny162x_Datasheet_Errata_Extracted_Content.json") &&
    !file.endsWith("ATtiny162x_DFP_3.4.278_Extracted_Device_Definitions.json")).map(document);
  const value = freeze({ ...base,
    id: "uartdebug2-materials", initialRules, initialKnowledge, documents, corpus: localCorpus,
    dfpRegisters, reviewedFacts, sourceManifest, devices: deriveDevices(pins, dfpRegisters),
    localDocuments: [],
    coverage: ["Pinned repository reference material; consult device and document applicability"],
    verification: "repository-sha256-integrity; compilation and hardware testing are separate",
    referenceCatalog: localCorpus.documents.map(({ pages, sections, ...metadata }) => ({ ...metadata, sectionCount: sections?.length || 0 })),
  });
  cache.clear();
  cache.set(manifestKey, { value, fingerprint });
  return value;
}

function validateProjectCatalog(catalog, manifest, manifestSha256) {
  if (catalog?.schemaVersion !== 1 || !supportedRepository(manifest.repository) || catalog.repository !== manifest.repository ||
      catalog.commit !== manifest.commit || catalog.manifestSha256 !== manifestSha256 ||
      !Array.isArray(catalog.projects) || catalog.projects.length > 5000) {
    throw Error("Prepared project catalog does not match the materials release; prepare it before activation");
  }
  const ids = new Set();
  for (const project of catalog.projects) {
    const provenance = project?.provenance;
    if (project?.schemaVersion !== 1 || project.contract !== "uartdebug-project/v2" ||
        typeof project.id !== "string" || !project.id || ids.has(project.id) ||
        !["example", "target"].includes(project.kind) ||
        typeof project.title !== "string" || !project.title || typeof project.summary !== "string" ||
        typeof project.version !== "string" || typeof project.defaultLocale !== "string" ||
        !safeRelative(project.projectPath) || !/^Target_Projects\/[^/]+$/.test(project.projectPath) ||
        !safeRelative(project.canvasName) || project.canvasName.includes("/") || !/\.md$/i.test(project.canvasName) ||
        typeof project.canvas?.markdown !== "string" || typeof project.canvas?.locale !== "string" ||
        !Array.isArray(project.files) || !provenance || provenance.repository !== manifest.repository ||
        provenance.commit !== manifest.commit || !safeRelative(provenance.sourcePath) ||
        !/^[a-f0-9]{64}$/.test(provenance.sha256 || "") ||
        provenance.sha256 !== manifest.files[provenance.sourcePath]?.sha256 ||
        provenance.derived !== (project.kind === "example")) {
      throw Error("Invalid prepared project catalog entry");
    }
    ids.add(project.id);
    const names = new Set();
    for (const file of project.files) {
      const extensions = { source: /\.c$/i, guide: /\.md$/i, specification: /\.ya?ml$/i };
      if (!extensions[file?.role]?.test(file.name) || !safeRelative(file.name) || file.name.includes("/") ||
          typeof file.content !== "string" || names.has(file.name)) throw Error("Invalid prepared project file");
      names.add(file.name);
    }
  }
  return catalog;
}

function createProjectCatalog(input = {}) {
  const root = fs.realpathSync(materialsRoot(input));
  const manifestPath = path.resolve(input.manifestPath || path.join(root, "../manifest.json"));
  const catalogPath = path.join(root, "..", PROJECT_CATALOG_FILENAME);
  const records = [manifestPath, catalogPath].map((file) => {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_PROJECT_CATALOG_BYTES) {
      throw Error("Invalid prepared project catalog file");
    }
    return `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}:${stat.ino}`;
  });
  const key = `${root}:${manifestPath}:${records.join(":")}`;
  if (catalogCache.has(key)) return catalogCache.get(key);
  const decode = (bytes) => new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const manifestBytes = fs.readFileSync(manifestPath);
  const manifest = JSON.parse(decode(manifestBytes));
  if (manifest.schemaVersion !== 1 || !supportedRepository(manifest.repository) ||
      !/^[a-f0-9]{40}$/.test(manifest.commit || "") || !manifest.files || typeof manifest.files !== "object" || Array.isArray(manifest.files)) {
    throw Error("Invalid AVR materials manifest");
  }
  const catalog = validateProjectCatalog(JSON.parse(decode(fs.readFileSync(catalogPath))), manifest, sha256(manifestBytes));
  const projects = new Map(catalog.projects.map(({ kind, ...project }) => [project.id, { kind, project }]));
  const descriptor = ({ kind, project }) => ({ id: project.id, title: project.title, displayName: project.title,
    summary: project.summary, version: project.version, kind, defaultLocale: project.defaultLocale,
    canvasName: project.canvasName, projectPath: project.projectPath });
  const result = {
    listProjects: ({ includeTargets = true } = {}) => [...projects.values()]
      .filter((item) => includeTargets || item.kind !== "target").map(descriptor),
    readProject: (id, { includeTargets = true } = {}) => {
      const selected = projects.get(id);
      return !selected || (!includeTargets && selected.kind === "target") ? null : structuredClone(selected.project);
    },
  };
  catalogCache.clear();
  catalogCache.set(key, result);
  return result;
}


module.exports = { REPOSITORY, LEGACY_REPOSITORY, DEVICE_ROOT, REQUIRED_RULES, REQUIRED_RULES_V3, INITIAL_KNOWLEDGE,
  materialsRoot, safeRelative, defaultReadable, loadMaterials, fileDigest, sha256,
  createProjectCatalog, PROJECT_CATALOG_FILENAME, validateProjectCatalog };
