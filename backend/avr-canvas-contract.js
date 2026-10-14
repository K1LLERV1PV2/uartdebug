"use strict";

const YAML = require("yaml");
const MAX_CANVAS_BYTES = 128 * 1024;
const MAX_ANNOTATIONS = 100;
const safeId = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;
const localePattern = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/i;
const object = (properties) => ({
  type: "object",
  additionalProperties: false,
  properties,
  required: Object.keys(properties),
});
const text = (maxLength, minLength = 0) => ({
  type: "string",
  minLength,
  maxLength,
});
const nullable = (schema) => ({ anyOf: [schema, { type: "null" }] });
const enumeration = (...values) => ({ type: "string", enum: values });
const fileSchema = object({ name: text(96, 1), content: text(128 * 1024, 1) });
const CANVAS_OUTPUT_SCHEMA = object({
  action: enumeration("clarify", "generate", "describe"),
  message: text(2000, 1),
  canvas: object({
    markdown: text(MAX_CANVAS_BYTES),
    locale: text(35, 2),
    annotations: { type: "array", items: { type: "string" }, maxItems: 0 },
  }),
  project: nullable(
    object({
      title: text(96, 1),
      summary: text(1000),
      version: text(32, 1),
      source: nullable(fileSchema),
      guide: nullable(
        object({
          name: text(96, 1),
          locale: text(35, 2),
          content: text(120 * 1024, 1),
        }),
      ),
      resources: nullable(fileSchema),
    }),
  ),
});

class CanvasContractError extends Error {
  constructor(message, generated = false) {
    super(message);
    this.name = "CanvasContractError";
    this.status = generated ? 502 : 400;
    this.code = generated ? "invalid_generated_canvas" : "invalid_canvas";
  }
}

function fail(message, generated = false) {
  throw new CanvasContractError(message, generated);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function boundedText(
  value,
  name,
  maxBytes,
  { empty = true, generated = false } = {},
) {
  if (
    typeof value !== "string" ||
    (!empty && !value.trim()) ||
    value.includes("\0") ||
    Buffer.byteLength(value, "utf8") > maxBytes
  ) {
    fail(`${name} must be valid text within ${maxBytes} bytes.`, generated);
  }
  return value.replace(/\r\n?/g, "\n");
}

function normalizeLocale(value, generated = false) {
  if (
    typeof value !== "string" ||
    value.length > 35 ||
    !localePattern.test(value)
  ) {
    fail("The canvas language must be a valid language tag.", generated);
  }
  return value;
}

function normalizeAnnotations(
  annotations,
  markdown,
  { generated = false, requireAnchors = false } = {},
) {
  if (!Array.isArray(annotations) || annotations.length > MAX_ANNOTATIONS)
    fail("The canvas annotations are invalid.", generated);
  const ids = new Set();
  return annotations.map((annotation) => {
    if (
      !isObject(annotation) ||
      typeof annotation.id !== "string" ||
      !safeId.test(annotation.id) ||
      ids.has(annotation.id) ||
      Object.keys(annotation).some(
        (key) =>
          !["id", "kind", "anchor", "message", "status", "answer"].includes(
            key,
          ),
      ) ||
      !["question", "information", "error"].includes(annotation.kind) ||
      !["open", "resolved"].includes(annotation.status) ||
      !isObject(annotation.anchor) ||
      Object.keys(annotation.anchor).some(
        (key) => !["quote", "line"].includes(key),
      )
    ) {
      fail(
        "Canvas annotations must have unique identifiers, valid kinds, statuses and anchors.",
        generated,
      );
    }
    ids.add(annotation.id);
    const quote = boundedText(
      annotation.anchor.quote,
      "annotation.anchor.quote",
      8000,
      { empty: false, generated },
    );
    const line = annotation.anchor.line == null ? null : annotation.anchor.line;
    if (line !== null && (!Number.isSafeInteger(line) || line < 1))
      fail("Annotation line must be a positive integer or null.", generated);
    if (
      requireAnchors &&
      annotation.status === "open" &&
      !markdown.includes(quote)
    ) {
      fail(
        "Open annotations must quote text present on the resulting canvas.",
        generated,
      );
    }
    const answer = boundedText(
      annotation.answer ?? "",
      "annotation.answer",
      32000,
      { generated },
    );
    if (
      annotation.kind === "question" &&
      annotation.status === "resolved" &&
      !answer.trim()
    ) {
      fail("A resolved question must retain the user's answer.", generated);
    }
    return {
      id: annotation.id,
      kind: annotation.kind,
      anchor: { quote, line },
      message: boundedText(annotation.message, "annotation.message", 32000, {
        empty: false,
        generated,
      }),
      status: annotation.status,
      answer,
    };
  });
}

// Legacy instructions can be opened as a canvas without keeping obsolete skill references.
// Input anchors may become stale while the user edits; generation must relocate open anchors.
function normalizeCanvas(input) {
  if (
    !isObject(input) ||
    ![1, 2].includes(input.schemaVersion) ||
    !Number.isSafeInteger(input.revision) ||
    input.revision < 0 ||
    input.revision >= Number.MAX_SAFE_INTEGER
  ) {
    fail("The canvas must include a supported schema and a valid revision.");
  }
  const markdown = boundedText(
    input.markdown,
    "canvas.markdown",
    MAX_CANVAS_BYTES,
  );
  const canvas = {
    schemaVersion: 2,
    revision: input.revision,
    markdown,
    locale: input.locale ? normalizeLocale(input.locale) : "",
    annotations: normalizeAnnotations(input.annotations ?? [], markdown),
  };
  if (input.target != null) {
    if (
      !isObject(input.target) ||
      Object.keys(input.target).some(
        (key) => !["mcu", "packageName"].includes(key),
      )
    )
      fail("The canvas target is invalid.");
    canvas.target = {
      mcu: boundedText(input.target.mcu ?? "", "canvas.target.mcu", 40),
      packageName: boundedText(
        input.target.packageName ?? "",
        "canvas.target.packageName",
        48,
      ),
    };
  }
  if (input.authorship != null) {
    const authorship = input.authorship;
    if (
      !isObject(authorship) ||
      Object.keys(authorship).some(
        (key) => !["schemaVersion", "lines", "updatedAt"].includes(key),
      ) ||
      authorship.schemaVersion !== 1 ||
      !Array.isArray(authorship.lines) ||
      authorship.lines.length !== markdown.split("\n").length ||
      authorship.lines.length > 20000 ||
      authorship.lines.some(
        (value) => !["original", "human", "ai"].includes(value),
      ) ||
      !Number.isSafeInteger(authorship.updatedAt) ||
      authorship.updatedAt <= 0
    ) {
      fail("Canvas authorship metadata is invalid.");
    }
    canvas.authorship = {
      schemaVersion: 1,
      lines: [...authorship.lines],
      updatedAt: authorship.updatedAt,
    };
  }
  return canvas;
}

function assertSchema(value, schema, path = "output") {
  if (schema.anyOf) {
    for (const alternative of schema.anyOf) {
      try {
        assertSchema(value, alternative, path);
        return;
      } catch (error) {
        if (!(error instanceof CanvasContractError)) throw error;
      }
    }
    fail(`${path} does not match any permitted value.`, true);
  }
  const matchesType =
    schema.type === "null"
      ? value === null
      : schema.type === "object"
        ? isObject(value)
        : schema.type === "array"
          ? Array.isArray(value)
          : schema.type === "integer"
            ? Number.isSafeInteger(value)
            : typeof value === schema.type;
  if (!matchesType || (schema.enum && !schema.enum.includes(value)))
    fail(`${path} has an invalid value.`, true);
  if (schema.type === "object") {
    if (
      Object.keys(value).some(
        (key) => !Object.hasOwn(schema.properties, key),
      ) ||
      schema.required.some((key) => !Object.hasOwn(value, key))
    ) {
      fail(`${path} has missing or unsupported fields.`, true);
    }
    for (const [key, child] of Object.entries(schema.properties))
      assertSchema(value[key], child, `${path}.${key}`);
  } else if (schema.type === "array") {
    if (value.length > schema.maxItems)
      fail(`${path} has too many entries.`, true);
    value.forEach((item, index) =>
      assertSchema(item, schema.items, `${path}[${index}]`),
    );
  } else if (schema.type === "string") {
    if (
      value.includes("\0") ||
      value.length < schema.minLength ||
      value.length > schema.maxLength ||
      (schema.minLength > 0 && !value.trim())
    )
      fail(`${path} has invalid text.`, true);
  } else if (
    schema.type === "integer" &&
    (value < schema.minimum || value > schema.maximum)
  ) {
    fail(`${path} is outside the supported range.`, true);
  }
}

function validateFileName(name, extension) {
  if (
    !name ||
    Buffer.byteLength(name, "utf8") > 96 ||
    /[\\/:*?"<>|\x00-\x1f]/.test(name) ||
    name.endsWith(".") ||
    name.endsWith(" ") ||
    !extension.test(name) ||
    /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)
  ) {
    fail(
      "Generated file names must be safe local file names with the correct extension.",
      true,
    );
  }
}

function projectIdentity(markdown) {
  const names = [
    ...markdown.matchAll(/^#\s+(?:Проект|Project)\s+(.+?)\s*$/gim),
  ].map((match) => match[1].trim());
  const versions = [
    ...markdown.matchAll(
      /^(?:Версия проекта|Project version)\s*[-:]\s*(Ver\.\d+\.\d+)\s*$/gim,
    ),
  ].map((match) => match[1]);
  if (
    !names.length ||
    new Set(names).size !== 1 ||
    !versions.length ||
    new Set(versions).size !== 1
  )
    return null;
  return { title: names[0], version: versions[0].replace(/^ver\./i, "Ver.") };
}

function projectOutputNames(markdown, identity, currentProject = null) {
  const cNames = [
    ...markdown.matchAll(
      /^(?:Файл программы C|C program file|C source file)\s*[-:]\s*(.+?)\s*$/gim,
    ),
  ].map((match) => match[1]);
  const resourceNames = [
    ...markdown.matchAll(
      /^(?:Файл ресурсов проекта|Project resources file|Resource file)\s*[-:]\s*(.+?)\s*$/gim,
    ),
  ].map((match) => match[1]);
  if (
    (cNames.length || resourceNames.length) &&
    (cNames.length !== 1 || resourceNames.length !== 1)
  )
    fail(
      "Confirmed alternative output names must be one complete C/YAML pair.",
      true,
    );
  const sourceName =
    cNames[0] ||
    (currentProject?.source?.trim()
      ? currentProject.sourceName
      : `${identity.title}.c`);
  const resourcesName =
    resourceNames[0] ||
    (currentProject?.specification?.content?.trim()
      ? currentProject.specification.name
      : `${identity.title}.yaml`);
  validateFileName(sourceName, /\.c$/i);
  validateFileName(resourcesName, /\.yaml$/i);
  return { sourceName, resourcesName };
}

function parseProjectResources(content, target = {}) {
  boundedText(content, "project.resources.content", 128 * 1024, {
    empty: false,
    generated: true,
  });
  const document = YAML.parseDocument(content, {
    uniqueKeys: true,
    schema: "core",
    customTags: [],
  });
  if (document.errors.length || document.warnings.length)
    fail(
      "Project resources must be valid YAML without duplicate keys or custom tags.",
      true,
    );
  let resources;
  try {
    resources = document.toJS({ maxAliasCount: 0 });
  } catch {
    fail("Project resources cannot contain aliases or recursive values.", true);
  }
  if (!isObject(resources))
    fail("Project resources must be a YAML mapping.", true);
  const required = [
    "microcontroller",
    "hardware_resources",
    "software_dependencies",
  ];
  const keys = Object.keys(resources);
  if (
    required.some((key) => !isObject(resources[key])) ||
    required.some(
      (key, index) =>
        index && keys.indexOf(key) <= keys.indexOf(required[index - 1]),
    )
  )
    fail(
      "Resource YAML requires microcontroller, hardware_resources and software_dependencies mappings in that order.",
      true,
    );
  const device = resources.microcontroller;
  for (const [key, expected] of [
    ["model", target.mcu],
    ["package", target.packageName],
  ]) {
    if (
      typeof device[key] !== "string" ||
      !device[key].trim() ||
      (expected && device[key].toLowerCase() !== expected.toLowerCase())
    )
      fail(
        "Resource YAML must preserve the exact selected microcontroller and package.",
        true,
      );
  }
  const includes = resources.software_dependencies.includes;
  if (
    !Array.isArray(includes) ||
    includes.length > 64 ||
    !includes.includes("#include <xc.h>") ||
    includes.some(
      (line) =>
        typeof line !== "string" ||
        !/^#include\s*[<"][A-Za-z0-9_][A-Za-z0-9_./-]*\.h[>"]$/.test(line) ||
        line.includes("..") ||
        line.includes("//"),
    )
  )
    fail(
      "Resource dependencies require complete include directives, including #include <xc.h>.",
      true,
    );
  validateHardwarePins(
    resources.hardware_resources,
    target.device,
    device.package,
  );
  return resources;
}

function validateHardwarePins(hardware, device, packageName) {
  if (!device) return;
  const pinout = Object.entries(device.pinouts || {}).find(
    ([name]) => name.toLowerCase() === packageName.toLowerCase(),
  )?.[1]?.pins;
  if (!pinout) fail("The selected package pin map is unavailable.", true);
  const pending = [hardware];
  while (pending.length) {
    const entry = pending.pop();
    if (Array.isArray(entry)) {
      pending.push(...entry);
      continue;
    }
    if (!isObject(entry)) continue;
    const present = (key) => Object.hasOwn(entry, key) && entry[key] !== null;
    if (!["pin_symbol", "package_pin", "port_pin"].some(present)) {
      pending.push(...Object.values(entry));
      continue;
    }
    let symbol = null;
    if (present("pin_symbol")) {
      if (
        typeof entry.pin_symbol !== "string" ||
        !Object.hasOwn(pinout, entry.pin_symbol)
      )
        fail(
          "A declared pin_symbol is unavailable in the selected device package.",
          true,
        );
      symbol = entry.pin_symbol;
    }
    const coordinates = symbol && /^P([A-Z])(\d+)$/.exec(symbol);
    let port = null;
    if (present("port")) {
      if (
        typeof entry.port !== "string" ||
        !/^(?:PORT)?[A-Z]$/.test(entry.port)
      )
        fail(
          "A declared port must use its canonical port letter or PORT name.",
          true,
        );
      port = entry.port.replace(/^PORT/, "");
      if (symbol && (!coordinates || coordinates[1] !== port))
        fail("The declared port disagrees with pin_symbol.", true);
    }
    if (present("port_pin")) {
      if (
        !Number.isSafeInteger(entry.port_pin) ||
        entry.port_pin < 0 ||
        entry.port_pin > 7 ||
        (symbol && (!coordinates || Number(coordinates[2]) !== entry.port_pin))
      )
        fail("The declared port_pin disagrees with the device pin.", true);
      if (!symbol && port) {
        symbol = `P${port}${entry.port_pin}`;
        if (!Object.hasOwn(pinout, symbol))
          fail(
            "The declared port and port_pin are unavailable in this package.",
            true,
          );
      }
    }
    if (present("package_pin")) {
      const physical = entry.package_pin;
      if (
        !Number.isSafeInteger(physical) ||
        physical <= 0 ||
        !Object.values(pinout).includes(physical) ||
        (symbol && pinout[symbol] !== physical)
      )
        fail(
          "The declared package_pin disagrees with the selected package pin map.",
          true,
        );
    }
    pending.push(...Object.values(entry));
  }
}

// Read actual line comments only. Markers inside string literals or block comments are data.
function sourceWithoutLiterals(source) {
  return source.replace(
    /\/\*[\s\S]*?\*\/|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'/g,
    (value) => value.replace(/[^\n]/g, " "),
  );
}
function codeRegions(source) {
  const lines = sourceWithoutLiterals(source).split("\n");
  const original = source.split("\n");
  const regions = [];
  let open = null;
  const keyOf = (label) =>
    label
      .replace(/^(?:начало|конец|begin|start|end)\s+/i, "")
      .trim()
      .toLowerCase();
  for (const [line, value] of lines.entries()) {
    const marker = /^\s*\/\/([+-])\s*(.+?)\s*$/.exec(value);
    if (!marker) continue;
    if (marker[1] === "+") {
      if (open) fail("Permanent C code regions must not be nested.", true);
      open = { key: keyOf(marker[2]), label: marker[2], start: line };
    } else {
      if (!open || keyOf(marker[2]) !== open.key)
        fail("Permanent C code region markers must form matching pairs.", true);
      if (regions.some((region) => region.key === open.key))
        fail("Permanent C code regions must be unique.", true);
      regions.push({
        ...open,
        end: line,
        user: /(?:пользоват|\buser\b)/i.test(open.label),
        content: original.slice(open.start + 1, line).join("\n"),
      });
      open = null;
    }
  }
  if (open) fail("Permanent C code region markers are incomplete.", true);
  return regions;
}
function validateSource(
  source,
  resources,
  currentSource = "",
  identity = null,
) {
  boundedText(source, "project.source.content", 64 * 1024, {
    empty: false,
    generated: true,
  });
  if (identity) {
    const information = source
      .slice(0, source.search(/^\s*#\s*include/m))
      .split("\n");
    const name = information
      .map(
        (line) =>
          /^\s*\/\/\s*(?:Project(?: name)?|Имя проекта)\s*:\s*(.+?)\s*$/i.exec(
            line,
          )?.[1],
      )
      .filter(Boolean);
    const version = information
      .map(
        (line) =>
          /^\s*\/\/\s*(?:Project version|Версия проекта)\s*:\s*(Ver\.\d+\.\d+)\s*$/i.exec(
            line,
          )?.[1],
      )
      .filter(Boolean);
    if (
      name.length !== 1 ||
      name[0] !== identity.title ||
      version.length !== 1 ||
      version[0] !== identity.version
    )
      fail(
        "C project information must preserve the specification's name and version.",
        true,
      );
  }
  const clean = sourceWithoutLiterals(source);
  const executable = clean.replace(/\/\/[^\n]*/g, "");
  if (
    !/^\s*#\s*include\s*<xc\.h>/.test(executable) ||
    !/\bint\s+main\s*\(\s*void\s*\)/.test(executable) ||
    !/\bwhile\s*\(\s*1\s*\)/.test(executable)
  )
    fail(
      "C must start with #include <xc.h>, define int main(void) and preserve the main while (1) loop.",
      true,
    );
  if (/\/\/X(?:\s|$)/m.test(clean))
    fail("Temporary //X instructions must not remain in generated C.", true);
  const regions = codeRegions(source);
  if (
    regions.filter((region) => region.user).length < 3 ||
    regions.filter((region) => !region.user).length < 4
  )
    fail("C must preserve the canonical AI and user insertion regions.", true);
  const previous = codeRegions(currentSource);
  for (const region of previous.filter((entry) => entry.user)) {
    const next = regions.find(
      (entry) => entry.key === region.key && entry.user,
    );
    if (!next || next.content !== region.content)
      fail(
        "Generated updates must preserve every user C region exactly.",
        true,
      );
  }
  const sourceCode = source.replace(
    /\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'/g,
    (value) =>
      value.startsWith("/*") || value.startsWith("//")
        ? value.replace(/[^\n]/g, " ")
        : value,
  );
  const includes = [
    ...sourceCode.matchAll(/^\s*#\s*include\s*([<"][^>"\n]+[>"])/gm),
  ].map((match) => `#include ${match[1]}`);
  if (
    includes.filter((line) => line === "#include <xc.h>").length !== 1 ||
    JSON.stringify([...new Set(includes)].sort()) !==
      JSON.stringify(
        [...new Set(resources.software_dependencies.includes)].sort(),
      )
  )
    fail("C includes and resource YAML dependencies must agree exactly.", true);
  if (/\.\s*(?:PIT)?INTFLAGS\s*\|=/.test(executable))
    fail("Clear W1C INTFLAGS with assignment, not read-modify-write.", true);
}

function validateCanvasOutput(raw, options = {}) {
  assertSchema(raw, CANVAS_OUTPUT_SCHEMA);
  const input = normalizeCanvas(options.canvas);
  const operation = options.operation || "analyze";
  const locale = normalizeLocale(raw.canvas.locale, true);
  if (input.locale && input.locale.toLowerCase() !== locale.toLowerCase())
    fail("Preserve the explicitly selected project language.", true);
  const markdown = boundedText(
    raw.canvas.markdown,
    "canvas.markdown",
    MAX_CANVAS_BYTES,
    { generated: true },
  );
  if (
    operation === "analyze" &&
    !input.markdown.trim() &&
    !/^[ \t]*>[ \t]*#{6}[ \t]+\*\[[^\]\r\n]{1,40}\][ \t]+[^\r\n]+\*[ \t]*\r?\n(?:[ \t]*>[ \t]*\r?\n)*[ \t]*>[ \t]*\S[^\r\n]*/m.test(markdown)
  )
    fail(
      "Reviewing an empty draft must put initial questions in canonical inline Markdown remark blocks on that draft, not only in the service message. This stage explicitly authorizes those remarks before project identity is confirmed.",
      true,
    );
  if (operation !== "analyze" && markdown !== input.markdown)
    fail(
      "Code generation and description must preserve the specification exactly.",
      true,
    );
  if (raw.action === "clarify") {
    if (raw.project !== null)
      fail("Clarification must not contain project files.", true);
  } else {
    if (
      !raw.project ||
      (raw.action === "generate"
        ? operation !== "generate"
        : operation !== "describe")
    )
      fail("The response does not match the authorized project stage.", true);
    const project = raw.project;
    validateFileName(`${project.title}.md`, /\.md$/i);
    const identity = projectIdentity(input.markdown);
    if (
      !identity ||
      project.title !== identity.title ||
      project.version !== identity.version
    )
      fail(
        "Use the exact project name and Ver.X.Y from the specification.",
        true,
      );
    if (raw.action === "generate") {
      if (!project.source || !project.resources || project.guide !== null)
        fail("Code generation must return C and resource YAML only.", true);
      validateFileName(project.source.name, /\.c$/i);
      validateFileName(project.resources.name, /\.yaml$/i);
      const names = projectOutputNames(
        input.markdown,
        identity,
        options.currentProject,
      );
      if (
        project.source.name !== names.sourceName ||
        project.resources.name !== names.resourcesName
      )
        fail("Preserve existing or canonical output file names.", true);
      const resources = parseProjectResources(
        project.resources.content,
        options,
      );
      validateSource(
        project.source.content,
        resources,
        options.currentProject?.source || "",
        identity,
      );
    } else {
      if (
        project.source !== null ||
        project.resources !== null ||
        !project.guide ||
        !options.currentProject?.source?.trim()
      )
        fail(
          "Description must use existing C and return documentation only.",
          true,
        );
      validateFileName(project.guide.name, /\.md$/i);
      normalizeLocale(project.guide.locale, true);
      const hasDescription = !!options.currentProject.guide?.trim();
      const expectedLocale =
        hasDescription && options.currentProject.guideLocale
          ? options.currentProject.guideLocale
          : locale;
      const expectedName = hasDescription
        ? options.currentProject.guideName
        : `${identity.title} (description).md`;
      if (project.guide.locale.toLowerCase() !== expectedLocale.toLowerCase())
        fail(
          "Preserve the selected description language or use the specification language for a new description.",
          true,
        );
      if (project.guide.name !== expectedName)
        fail("Use the existing or canonical description filename.", true);
    }
  }
  return {
    ...raw,
    canvas: {
      schemaVersion: 2,
      revision: input.revision,
      markdown,
      locale,
      annotations: [],
      ...(input.target ? { target: input.target } : {}),
    },
  };
}

module.exports = {
  CANVAS_OUTPUT_SCHEMA,
  CanvasContractError,
  normalizeCanvas,
  validateCanvasOutput,
  projectIdentity,
  projectOutputNames,
  parseProjectResources,
  codeRegions,
  validateSource,
};
