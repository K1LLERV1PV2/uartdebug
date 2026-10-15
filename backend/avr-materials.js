"use strict";

// The private repository is an immutable source mirror. Derived indexes and
// deployment metadata belong next to it, never inside its directory tree.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { parse: parseYaml, stringify: stringifyYaml } = require("yaml");
const { resolveProjectFiles, parseProjectFilename, inferLocale, normalizeProjectDocuments } = require("./avr-project-format");

const REPOSITORY = "Sergey-Bulanov/UartDebug2";
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

function materialsRoot(input = {}) {
  const requested = typeof input === "string" ? input : input.root || input.materialsRoot;
  return path.resolve(requested || process.env.AI_MATERIALS_ROOT ||
    (process.platform === "win32" ? path.join(__dirname, "../../UartDebug2") :
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
  if (manifest.schemaVersion !== 1 || manifest.repository !== REPOSITORY ||
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
    const kind = file === "AGENTS.md" || file.startsWith("Project_Rules/") ? "project-rule" :
      file.endsWith("00_README.md") ? "knowledge-map" :
        file.startsWith("Reusable_Target_Projects/") ? "reusable-example" : "reference";
    return { id: file, path: file, sourcePath: file, title: titleOf(text, file), kind,
      text, sha256: manifest.files[file].sha256, bytes: manifest.files[file].bytes,
      revision: manifest.commit, mediaType: file.endsWith(".json") ? "application/json" :
        /\.ya?ml$/.test(file) ? "application/yaml" : "text/plain" };
  };
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
  const value = freeze({ root, manifest, repository: REPOSITORY, version: manifest.commit,
    id: "uartdebug2-materials", initialRules, initialKnowledge, documents, corpus: localCorpus,
    dfpRegisters, reviewedFacts, sourceManifest, devices: deriveDevices(pins, dfpRegisters),
    files: names, totalBytes, localDocuments: [],
    coverage: ["Pinned repository reference material; consult device and document applicability"],
    verification: "repository-sha256-integrity; compilation and hardware testing are separate",
    referenceCatalog: localCorpus.documents.map(({ pages, sections, ...metadata }) => ({ ...metadata, sectionCount: sections?.length || 0 })),
  });
  cache.clear();
  cache.set(manifestKey, { value, fingerprint });
  return value;
}

function maskedC(source) {
  // Keep source positions while ignoring braces in comments and literals.
  return source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'/g,
    (match) => match.replace(/[^\n]/g, " "));
}
function blockEnd(masked, opening) {
  let depth = 0;
  for (let index = opening; index < masked.length; index++) {
    if (masked[index] === "{") depth++;
    else if (masked[index] === "}" && --depth === 0) return index;
  }
  throw Error("Prepared example has an incomplete C block");
}
function exampleSource(source, name) {
  const normalized = source.replace(/\r\n?/g, "\n");
  const masked = maskedC(normalized);
  const main = /\bint\s+main\s*\(\s*void\s*\)\s*\{/.exec(masked);
  if (!main) throw Error(`Prepared example has no standalone main: ${name}`);
  const opening = main.index + main[0].lastIndexOf("{");
  const closing = blockEnd(masked, opening);
  const bodyMask = masked.slice(opening + 1, closing);
  const loop = /\bwhile\s*\(\s*1\s*\)\s*\{/.exec(bodyMask);
  if (!loop) throw Error(`Prepared example has no application loop: ${name}`);
  const loopOpening = opening + 1 + loop.index + loop[0].lastIndexOf("{");
  const loopClosing = blockEnd(masked, loopOpening);
  if (!/^\s*return\s+0\s*;\s*$/.test(masked.slice(loopClosing + 1, closing)) || masked.slice(closing + 1).trim()) {
    throw Error(`Prepared example has unexpected code after its application loop: ${name}`);
  }
  let prefix = normalized.slice(0, main.index);
  const xcInclude = /^\s*#\s*include\s*<xc\.h>[^\n]*(?:\n|$)/m;
  if (!xcInclude.test(prefix)) throw Error(`Prepared example requires xc.h: ${name}`);
  prefix = prefix.replace(xcInclude, "");
  const lines = prefix.split("\n");
  let directiveEnd = 0;
  for (let index = 0; index < lines.length; index++) {
    if (/^\s*#/.test(lines[index])) {
      while (/\\\s*$/.test(lines[index]) && index + 1 < lines.length) index++;
      directiveEnd = index + 1;
    }
  }
  const includes = lines.slice(0, directiveEnd).join("\n").trim();
  const globals = lines.slice(directiveEnd).join("\n").trim();
  const initialization = normalized.slice(opening + 1, opening + 1 + loop.index).trim();
  const cyclic = normalized.slice(loopOpening + 1, loopClosing).trim();
  const indent = (value) => value ? value.split("\n").map((line) => line ? `    ${line.trimEnd().replace(/^\s{0,4}/, "")}` : "").join("\n") + "\n" : "";
  const region = (owner, area, content, indentation = "") =>
    `${indentation}//+ ${owner}: ${area}\n${content ? content + "\n" : ""}${indentation}//- ${owner}: ${area}`;
  return [
    `// Project name: ${name}\n// Project version: Ver.1.0`,
    "#include <xc.h>",
    region("AI", "includes and defines", includes),
    region("AI", "global functions and variables", globals),
    region("User", "global functions and variables", ""),
    `int main(void)\n{\n${region("AI", "initialization", indent(initialization).trimEnd(), "    ")}\n\n${region("User", "initialization", "", "    ")}\n\n    while (1)\n    {\n${region("AI", "application loop", indent(cyclic).split("\n").map((line) => line ? `    ${line}` : "").join("\n").trimEnd(), "        ")}\n\n${region("User", "application loop", "", "        ")}\n    }\n\n    return 0;\n}`,
  ].join("\n\n") + "\n";
}

function exampleDescription(map, name, summary) {
  const number = Number(name.slice(0, 2));
  const section = (heading) => {
    const start = map.indexOf(`## ${heading}\n`);
    if (start < 0) return "";
    const end = map.indexOf("\n## ", start + 4);
    return map.slice(start, end < 0 ? undefined : end).trim();
  };
  const hardware = section("Hardware connections and observation");
  const observation = hardware.split("\n").find((line) => new RegExp(`^\\| 0?${number} \\|`).test(line))?.split("|").slice(2, -1).join("|").trim() || "";
  const rows = hardware.split("\n").filter((line) => {
    if (!line.startsWith("|")) return false;
    return ((number === 3 || number === 4) && line.startsWith("| LED output")) ||
      ([5, 6, 7, 9].includes(number) && line.startsWith("| USART0 TX")) ||
      (number === 6 && line.startsWith("| USART0 RX")) ||
      ([8, 10].includes(number) && line.startsWith("| USART1 TX"));
  });
  const hardwareRows = rows.length ? "| Signal | MCU pin | SOIC-14 pin | Connection |\n|---|---|---|---|\n" + rows.join("\n") : "";
  const integration = section("Integration requirements");
  const bullet = integration.split("\n").find((line) => {
    const match = /^- \*\*(\d+)(?:-(\d+))?:\*\*/.exec(line);
    return match && number >= Number(match[1]) && number <= Number(match[2] || match[1]);
  }) || "";
  const shared = integration.split("\n\n")[1] || "";
  const buffer = number >= 9 ? integration.slice(integration.indexOf("### Buffer and byte-order rules")).trim() : "";
  const clock = number >= 3 ? section("Clock and software-delay assumptions") : "";
  const filteredClock = clock ? clock.split("\n\n").filter((paragraph, index) =>
    index === 0 || index === 1 || (index === 2 && [3, 5, 7, 8, 9, 10].includes(number)) || (index === 3 && number === 4)).join("\n\n") : "";
  return [
    `# Code description of project ${name}\n\nProject version - Ver.1.0\n\n${summary}`,
    "This is an educational project derived from a pinned prepared example. The implementation is retained inside the common AI and user regions. The catalog does not assert build, simulation or hardware verification; compile and check the selected project independently.",
    hardwareRows ? `## Hardware connection\n\nThe physical pin numbers apply to ATtiny1624 in SOIC-14 and the stated default routes.\n\n${hardwareRows}` : "",
    number >= 5 ? "Use a common GND and compatible logic levels. Set the observation adapter to asynchronous 115200 8N1. UPDI programming and USART communication use separate adapters and COM ports in the source demonstration." : "",
    observation ? `## Observation\n\n${observation}` : "",
    filteredClock,
    `## Integration requirements\n\n${shared}\n\n${bullet}`,
    buffer,
    "## Applicability and verification\n\nVerify registers, masks, vectors, package pins, clocks, electrical connections and installed compiler/library behavior against the selected device, data sheet and applicable errata before adapting this pattern. The original demonstration's reports do not verify this derived project or a changed board.",
  ].filter(Boolean).join("\n\n") + "\n";
}

function exampleResources(name, pinout, source) {
  const number = Number(name.slice(0, 2));
  const literal = (key) => {
    const match = new RegExp(`^\\s*#\\s*define\\s+${key}\\s+(\\d+)(?:[uUlL]*)\\s*$`, "m").exec(source);
    if (!match || !Number.isSafeInteger(Number(match[1]))) throw Error(`Prepared example requires a reviewed literal ${key}: ${name}`);
    return Number(match[1]);
  };
  const result = {};
  if (number === 2) {
    const selected = /\bCPU_(?:Max_)?Clock_(\d+)MHz_(NoOutputSignal|Out)\s*\(\s*\)\s*;/.exec(source.slice(source.indexOf("int main")));
    if (!selected) throw Error(`Prepared clock example has no selected reviewed setup: ${name}`);
    const hz = Number(selected[1]) * 1000000;
    result.clock = { source: "OSC20M", nominal_cpu_frequency_hz: hz,
      clkout: selected[2] === "Out", selected_function: selected[0].replace(/\s*\(.*$/, "") };
  }
  if (number >= 3) result.clock = { required_cpu_frequency_hz: literal("F_CPU"),
    calculation_macro: "F_CPU", assumption: "F_CPU describes calculations; verify that the actual CPU clock matches it" };
  if (number === 3 || number === 4) result.gpio = { led: { pin_symbol: "PB1",
    package_pin: pinout.PB1 || null, direction: "output", active_level: "high", initial_state: "off" } };
  if (number === 4) {
    result.timer = { instance: "TCA0", mode: "SINGLE normal", prescaler: literal("TCA_PRESCALER"),
      requested_interval_us: literal("TCA_PERIOD_US"), period_expression: "TCA_PER_VALUE" };
    result.interrupts = { vector: "TCA0_OVF_vect", source: "TCA0 overflow" };
  }
  if (number >= 5) {
    const instance = number === 8 || number === 10 ? "USART1" : "USART0";
    const tx = instance === "USART1" ? "PA1" : "PB2";
    result.usart = { instance, route: "DEFAULT", mode: "asynchronous", baud: literal("BAUD_RATE"),
      frame: "8N1", tx_pin: tx, tx_package_pin: pinout[tx] || null,
      transmission: number >= 9 ? "DRE interrupt" : "polling" };
    if (number === 6) Object.assign(result.usart, { rx_pin: "PB3", rx_package_pin: pinout.PB3 || null,
      reception: "polling", receive_error_handling: false });
    if (number >= 9) result.interrupts = { vector: `${instance}_DRE_vect`, source: `${instance} data register empty` };
  }
  return result;
}

function createProjectCatalog(knowledge = loadMaterials()) {
  const projects = new Map();
  const read = (file) => {
    if (!Object.hasOwn(knowledge.manifest.files, file)) throw Error(`Unknown project material: ${file}`);
    return new TextDecoder("utf-8", { fatal: true }).decode(fs.readFileSync(path.join(knowledge.root, file)));
  };
  const register = (project, kind, provenance) => {
    const descriptor = { id: project.id, title: project.title, displayName: project.title,
      summary: project.summary, version: project.version, kind, defaultLocale: project.defaultLocale,
      canvasName: project.canvasName, projectPath: project.projectPath };
    projects.set(project.id, { descriptor, project: { ...project, schemaVersion: 1,
      contract: "uartdebug-project/v2", provenance } });
  };
  const exampleDirectory = "MCU_Knowledge_Base/AVR/User_Examples/";
  const exampleMap = read(`${exampleDirectory}00_README.md`);
  const summaries = new Map([...exampleMap.matchAll(/^\| \[([^\]]+)\.c\]\([^)]*\) \|[^|]*\| (.+) \|$/gm)]
    .map((match) => [match[1], match[2]]));
  for (const file of knowledge.files.filter((item) => item.startsWith(exampleDirectory) && /^\d\d_[^/]+\.c$/.test(item.slice(exampleDirectory.length)))) {
    const name = path.posix.basename(file, ".c");
    const original = read(file);
    const summary = summaries.get(name) || original.match(/^\/\/\s*(.+)/m)?.[1] || name;
    const source = exampleSource(original, name);
    const includes = [...source.matchAll(/^\s*#\s*include\s*[<"][^>"\n]+[>"]/gm)].map((match) => match[0].trim());
    const device = knowledge.devices.find((item) => item.mcu === "ATtiny1624");
    if (!device?.packages.includes("SOIC-14")) throw Error("Prepared example target is missing from the canonical pin map");
    const resources = exampleResources(name, device.pinouts["SOIC-14"].pins, original);
    const yaml = stringifyYaml({ microcontroller: { model: device.mcu, package: "SOIC-14" },
      hardware_resources: resources, software_dependencies: { includes } });
    const canvas = `# Project ${name}\n\nProject version - Ver.1.0\n\n## Hardware requirements\n\n- Microcontroller: ${device.mcu}.\n- Package: SOIC-14.\n- Follow the hardware connections and clock assumptions in the code description.\n\n## Software requirements\n\n${summary}\n`;
    const guide = exampleDescription(exampleMap, name, summary);
    register({ id: `example-${name}`, title: name, summary, version: "Ver.1.0", defaultLocale: "en",
      canvasName: `${name}.md`, projectPath: `Target_Projects/${name}`,
      canvas: { markdown: canvas, locale: "en", target: { mcu: device.mcu, packageName: "SOIC-14" } }, files: [
        { role: "source", name: `${name}.c`, content: source },
        { role: "guide", name: `${name} (description).md`, content: guide, locale: "en", label: "English" },
        { role: "specification", name: `${name}.yaml`, content: yaml },
      ] }, "example", { repository: knowledge.repository, commit: knowledge.version,
        sourcePath: file, sha256: knowledge.manifest.files[file].sha256, derived: true });
  }
  const targetDirectories = [...new Set(knowledge.files.filter((file) => file.startsWith("Target_Projects/") && file.split("/").length === 3).map((file) => file.split("/")[1]))];
  for (const directory of targetDirectories) {
    const projectPath = `Target_Projects/${directory}`;
    const projectEntries = knowledge.files.filter((file) => file.startsWith(`${projectPath}/`) && file.split("/").length === 3 && /\.(?:md|c|yaml)$/i.test(file))
      .map((file) => ({ name: path.posix.basename(file), content: read(file), path: file }));
    if (!projectEntries.some((entry) => /\.md$/i.test(entry.name) && !["AGENTS.md", "00_README.md"].includes(entry.name))) continue;
    let selected;
    try {
      selected = resolveProjectFiles(projectEntries);
    } catch (error) {
      throw Error(`Canonical target project ${projectPath}: ${error.message}`);
    }
    const specPath = selected.specification.path;
    const name = selected.identity?.title || directory.replace(/ Ver\.\d+\.\d+$/, "");
    const markdown = read(specPath);
    const files = [];
    const locale = inferLocale(markdown);
    for (const [role, entry] of [["source", selected.source], ["specification", selected.resources], ...selected.guides.map((guide) => ["guide", guide])]) {
      if (entry) files.push({ role, name: entry.name, content: entry.content,
        ...(role === "guide" ? { locale: parseProjectFilename(entry.name).variant || inferLocale(entry.content, locale) } : {}) });
    }
    const resources = selected.resources ? parseYaml(selected.resources.content) : null;
    const target = resources?.microcontroller && typeof resources.microcontroller.model === "string" &&
      typeof resources.microcontroller.package === "string" ?
      { mcu: resources.microcontroller.model, packageName: resources.microcontroller.package } : undefined;
    register({ id: `target-${directory}`, title: name, summary: "Target project supplied in the materials repository.",
      version: selected.identity?.version || "", defaultLocale: locale,
      canvasName: path.posix.basename(specPath), projectPath, canvas: { markdown, locale, ...(target ? { target } : {}) }, files,
      projectDocuments: normalizeProjectDocuments(projectEntries.filter((entry) => ["AGENTS.md", "00_README.md"].includes(entry.name))) },
    "target", { repository: knowledge.repository, commit: knowledge.version, sourcePath: specPath,
      sha256: knowledge.manifest.files[specPath].sha256, derived: false });
  }
  return {
    listProjects: ({ includeTargets = true } = {}) => [...projects.values()].filter((item) => includeTargets || item.descriptor.kind !== "target").map((item) => ({ ...item.descriptor })),
    readProject: (id, { includeTargets = true } = {}) => {
      const selected = projects.get(id);
      return !selected || (!includeTargets && selected.descriptor.kind === "target") ? null : structuredClone(selected.project);
    },
  };
}

module.exports = { REPOSITORY, DEVICE_ROOT, REQUIRED_RULES, INITIAL_KNOWLEDGE,
  materialsRoot, safeRelative, defaultReadable, loadMaterials, fileDigest, sha256,
  createProjectCatalog, exampleSource, exampleDescription, exampleResources, maskedC };
