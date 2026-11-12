"use strict";

// Run only while importing or explicitly preparing a materials release.
// The private repository remains byte-for-byte intact; output is a sibling file.
const fs = require("node:fs");
const path = require("node:path");
const { parse: parseYaml, stringify: stringifyYaml } = require("yaml");
const { resolveProjectFiles, parseProjectFilename, inferLocale, normalizeProjectDocuments } = require("./avr-project-format");
const { loadMaterials, REPOSITORY, PROJECT_CATALOG_FILENAME, validateProjectCatalog } = require("./avr-materials");

// These ten historical C-only examples were reviewed with fixed hardware and
// observation notes. New examples need explicit project metadata, not a guess
// based on a numeric filename prefix.
const REVIEWED_EXAMPLES = ["01_Minimum", "02_CPU_Clock", "03_Delay-Based_Blink", "04_Timer_Interrupt_Blink",
  "05_USART_Basic_Transmission", "06_USART_Basic_Receive", "07_Printf_Redirect_USART0",
  "08_Printf_Redirect_USART1", "09_USART0_Interrupt_Transmission", "10_USART1_Interrupt_Transmission"];
function reviewedExampleNumber(name) {
  const index = REVIEWED_EXAMPLES.indexOf(name);
  if (index < 0) throw Error(`Unreviewed example requires a canonical project or reviewed import adapter: ${name}`);
  return index + 1;
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
  const number = reviewedExampleNumber(name);
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
  const number = reviewedExampleNumber(name);
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

function buildCatalogProjects(knowledge) {
  // UartDebug3's app-note examples are documentation, and its ordinary target
  // projects are private. This release contains no reviewed website templates.
  if (knowledge.repository === REPOSITORY) return [];
  const projects = new Map();
  const read = (file) => {
    if (!Object.hasOwn(knowledge.manifest.files, file)) throw Error(`Unknown project material: ${file}`);
    return new TextDecoder("utf-8", { fatal: true }).decode(fs.readFileSync(path.join(knowledge.root, file)));
  };
  const register = (project, kind, provenance) => {
    if (projects.has(project.id)) throw Error(`Duplicate prepared project: ${project.id}`);
    projects.set(project.id, { ...project, schemaVersion: 1, kind,
      contract: "uartdebug-project/v2", provenance });
  };
  const exampleDirectory = "MCU_Knowledge_Base/AVR/User_Examples/";
  const exampleMap = read(`${exampleDirectory}00_README.md`);
  const summaries = new Map([...exampleMap.matchAll(/^\| \[([^\]]+)\.c\]\([^)]*\) \|[^|]*\| (.+) \|$/gm)]
    .map((match) => [match[1], match[2]]));
  for (const file of knowledge.files.filter((item) => item.startsWith(exampleDirectory) && /^\d\d_[^/]+\.c$/.test(item.slice(exampleDirectory.length)))) {
    const name = path.posix.basename(file, ".c");
    reviewedExampleNumber(name);
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
  return [...projects.values()];
}

function prepareProjectCatalog(input = {}) {
  const knowledge = loadMaterials(input);
  const catalog = validateProjectCatalog({ schemaVersion: 1, repository: knowledge.repository,
    commit: knowledge.version, manifestSha256: knowledge.manifestSha256,
    projects: buildCatalogProjects(knowledge) }, knowledge.manifest, knowledge.manifestSha256);
  const destination = path.join(knowledge.root, "..", PROJECT_CATALOG_FILENAME);
  const temporary = `${destination}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(catalog) + "\n", { flag: "wx", mode: 0o640 });
    fs.renameSync(temporary, destination);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
  return { path: destination, commit: catalog.commit, projects: catalog.projects.length };
}

module.exports = { prepareProjectCatalog, buildCatalogProjects,
  exampleSource, exampleDescription, exampleResources, maskedC };
