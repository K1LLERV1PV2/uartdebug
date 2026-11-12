"use strict";

const YAML = require("yaml");
const { createHash } = require("node:crypto");
const projectFormat = require("./avr-project-format");
const { PROJECT_STAGES } = require("./avr-project-policy");
const MAX_CANVAS_BYTES = 128 * 1024;
const MAX_ANNOTATIONS = 100;
const safeId = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;
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
  action: enumeration(
    ...new Set(Object.values(PROJECT_STAGES).map((stage) => stage.action)),
  ),
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
      version: text(32),
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
const CHAT_OUTPUT_SCHEMA = object({
  ...CANVAS_OUTPUT_SCHEMA.properties,
  action: enumeration("reply", "clarify", "generate", "describe"),
  message: text(32 * 1024, 1),
  canvas: nullable(CANVAS_OUTPUT_SCHEMA.properties.canvas),
});
const TASK_DIALOGUE_KINDS = ["question", "requirement", "decision", "note", "next"];
const TASK_DIALOGUE_OUTPUT_SCHEMA = object({
  ...CHAT_OUTPUT_SCHEMA.properties,
  canvas: nullable(object({
    ...CANVAS_OUTPUT_SCHEMA.properties.canvas.properties,
    acknowledged: { type: "array", maxItems: 12, items: text(15, 4) },
    dialogue: {
      type: "array", maxItems: 12,
      items: object({
        kind: enumeration(...TASK_DIALOGUE_KINDS),
        block: text(48),
        replaces: text(15),
        message: text(6000, 1),
        options: { type: "array", maxItems: 4, items: text(280, 1) },
      }),
    },
  })),
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
    !projectFormat.isLocaleTag(value)
  ) {
    fail("The canvas language must be a valid language tag.", generated);
  }
  return value;
}

// Read live, one-level remarks, excluding quoted examples and Markdown code.
function inlineRemarks(markdown) {
  const lines = markdown.split("\n");
  const remarks = [];
  let fence = null;
  for (let index = 0; index < lines.length; index += 1) {
    let content = lines[index];
    let depth = 0;
    let quote;
    while ((quote = /^ {0,3}>[ \t]?/.exec(content))) {
      depth += 1;
      content = content.slice(quote[0].length);
    }
    if (fence && depth < fence.depth) fence = null;
    if (fence) {
      const closing = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(content);
      if (
        depth === fence.depth &&
        closing?.[1][0] === fence.marker[0] &&
        closing[1].length >= fence.marker.length
      )
        fence = null;
      continue;
    }
    let fenceContent = content;
    let listMarker;
    while (
      (listMarker = /^ {0,3}(?:[-+*]|[0-9]{1,9}[.)])[ \t]+/.exec(fenceContent))
    )
      fenceContent = fenceContent.slice(listMarker[0].length);
    const opening = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(fenceContent);
    if (opening && !(opening[1][0] === "`" && opening[2].includes("`"))) {
      fence = { marker: opening[1], depth };
      continue;
    }
    if (depth !== 1) continue;
    const heading =
      /^ {0,3}#{6}[ \t]+\*\[((?:AI|ИИ)\.[0-9]{1,30})\][ \t]+([^*\r\n]+)\.\*[ \t]*$/.exec(content);
    if (!heading) continue;
    let bodyIndex = index + 1;
    while (/^ {0,3}>[ \t]*$/.test(lines[bodyIndex] || "")) bodyIndex += 1;
    const body = /^ {0,3}>[ \t]?(\S.*)$/.exec(lines[bodyIndex] || "")?.[1];
    remarks.push({
      id: heading[1],
      type: heading[2],
      hasBody: !!body && !body.startsWith(">") && !body.startsWith("###### "),
    });
  }
  return remarks;
}

function validateRemarkLocale(markdown, input, locale) {
  const remarks = inlineRemarks(markdown);
  const language = locale.toLowerCase().split("-")[0];
  const labels = projectFormat.remarkLabels(locale);
  const types = ["en", "ru"].includes(language)
    ? [labels.question, labels.information, labels.error]
    : null;
  const existingIds = new Set(inlineRemarks(input.markdown).map(({ id }) => id));
  const largestNumber = [...existingIds].reduce((largest, id) => {
    const number = BigInt(id.split(".")[1]);
    return number > largest ? number : largest;
  }, 0n);
  const prefix = labels.prefix;
  for (const remark of remarks) {
    if (types && !types.includes(remark.type))
      fail(
        `Inline remark headings must use the canvas language (${locale}): ${types.join(", ")}. Translate the type label, preserving existing remark IDs and user answers.`,
        true,
      );
    if (
      !existingIds.has(remark.id) &&
      (!new RegExp(`^${prefix}\\.[1-9][0-9]*$`).test(remark.id) ||
        BigInt(remark.id.split(".")[1]) <= largestNumber)
    )
      fail(
        `New inline remarks must use [${prefix}.N] for canvas language ${locale}. Preserve complete existing IDs and references; allocate new numbers after the largest existing number across prefixes.`,
        true,
      );
  }
  return remarks;
}

function validateV3TaskDialogue(markdown, previousMarkdown) {
  const previous = projectFormat.v3Dialogue(previousMarkdown);
  const replies = projectFormat.v3Dialogue(markdown);
  const previousIds = new Set(previous.map(reply => reply.id));
  const legacyIds = new Set(inlineRemarks(previousMarkdown).map(remark => remark.id));
  if (inlineRemarks(markdown).some(remark => !legacyIds.has(remark.id))) {
    fail("Write new questions directly in the task using UartDebug3 AI-N dialogue.", true);
  }
  const ids = new Set();
  let nextNumber = Math.max(0, ...previous.map(reply => Number(reply.id.slice(3)))) + 1;
  for (const reply of replies) {
    if (ids.has(reply.id)) fail("The task dialogue must use unique AI-N identifiers.", true);
    ids.add(reply.id);
    if (previousIds.has(reply.id)) {
      if (!reply.valid && !previous.some(old => old.id === reply.id && !old.valid && old.text === reply.text)) {
        fail("Keep the answer or follow-up marker directly after its AI-N reply.", true);
      }
      continue;
    }
    if (!reply.valid || Number(reply.id.slice(3)) !== nextNumber++) {
      fail("Use the next AI-N identifier and place the answer marker directly after its reply.", true);
    }
  }
  return replies;
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

function normalizeTaskDialogue(value) {
  try { return projectFormat.normalizeTaskDialogue(value); }
  catch { fail("The task discussion is invalid or exceeds its size limit."); }
}

function applyTaskDialogue(raw, acknowledged, input, operation, markdown, message) {
  const existing = input.dialogue ?? [];
  if (operation !== "analyze" && (raw.length || acknowledged.length)) fail("Only a task edit may change discussion blocks.", true);
  if (existing.length + raw.filter(record => !record.replaces).length > MAX_ANNOTATIONS)
    fail("The task discussion has reached its limit.", true);
  const byId = new Map(existing.map(record => [record.id, record]));
  const resolved = new Set(acknowledged);
  const handoff = message?.trim() === "Your turn.";
  for (const id of resolved) {
    const record = byId.get(id);
    if (!record || record.submitted || !["question", "next"].includes(record.kind) ||
        (!record.answer.trim() && (!message?.trim() || handoff))) {
      fail("Acknowledge only an open question that the user answered in the task or their latest chat message.", true);
    }
  }
  const replacements = new Map();
  const headings = projectFormat.v3TaskHeadings(markdown).filter(heading => !heading.service);
  let nextNumber = Math.max(0, ...existing.map(record => Number(record.id.slice(3))),
    ...projectFormat.v3Dialogue(input.markdown).map(record => Number(record.id.slice(3))));
  const appended = [];
  for (const record of raw) {
    const count = record.options.length;
    const options = record.options.map(option => boundedText(option, "dialogue option", 1120, { empty: false, generated: true }).trim());
    if ((record.kind === "next" && (count !== 3 || record.block)) ||
        (record.kind === "question" && count < 2) ||
        (["requirement", "decision", "note"].includes(record.kind) && count !== 0) ||
        new Set(options).size !== options.length) {
      fail("Questions need two to four distinct choices. Next-step questions use the three workflow choices in order. Notes, agreed requirements and decisions have no choices.", true);
    }
    const matching = record.block ? headings.filter(heading => heading.number === record.block) : [];
    if (record.block && matching.length !== 1) fail("Use an existing numbered task heading for each attached discussion block.", true);
    const heading = matching[0];
    const agreed = ["requirement", "decision"].includes(record.kind);
    if (agreed && (!heading || heading.level !== 3)) {
      fail("Attach each agreed requirement or technical decision to a numbered third-level task fragment.", true);
    }
    const text = boundedText(record.message, "dialogue message", 24000, { empty: false, generated: true });
    if (record.replaces) {
      const prior = byId.get(record.replaces);
      if (!prior || prior.kind !== "question" || prior.options.length || prior.answer.trim() || prior.submitted ||
          record.kind !== "question" || replacements.has(prior.id) || resolved.has(prior.id)) {
        fail("Only an unanswered imported question without options may be updated with choices.", true);
      }
      replacements.set(prior.id, { ...prior, options });
      continue;
    }
    if (agreed && !existing.some(item =>
      item.kind === "question" && resolved.has(item.id) &&
      projectFormat.findV3TaskHeading(headings, item.anchor)?.line === heading.line)) {
      fail("An agreed requirement or decision must acknowledge the user's answer to a proposal attached to that fragment.", true);
    }
    appended.push({
      id: "AI-" + (++nextNumber), kind: record.kind,
      anchor: heading ? { title: heading.title, number: heading.number, level: heading.level, parents: heading.parents } : { title: "", number: "", level: 0 },
      message: text,
      options, answer: "", choice: null, submitted: false,
    });
  }
  const openNextSteps = existing.filter(record => record.kind === "next" && !record.submitted && !resolved.has(record.id)).length;
  const addedNextSteps = appended.filter(record => record.kind === "next").length;
  if (addedNextSteps && openNextSteps + addedNextSteps > 1) fail("Reuse the existing open next-step question.", true);
  if (operation === "generate") {
    const step = existing.findLast(record => record.kind === "next" && !record.submitted);
    if (handoff && step?.choice > 0) {
      fail("The user's current next-step choice asks to add a task block or pause. Continue that choice without generating code.", true);
    }
    if (step?.answer.trim() && (step.choice == null || step.choice === 0)) resolved.add(step.id);
  }
  const result = [...existing.map(record => resolved.has(record.id) ? { ...record, submitted: true } :
    replacements.get(record.id) || record), ...appended];
  try { return normalizeTaskDialogue(result); }
  catch { fail("The resulting task discussion is invalid or exceeds its size limit.", true); }
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
    locale: input.locale && String(input.locale).toLowerCase() !== "und"
      ? normalizeLocale(input.locale)
      : "",
    annotations: normalizeAnnotations(input.annotations ?? [], markdown),
    ...(input.dialogue !== undefined ? { dialogue: normalizeTaskDialogue(input.dialogue) } : {}),
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

const projectIdentity = projectFormat.projectIdentity;
function projectOutputNames(markdown, identity, currentProject = null) {
  try {
    return projectFormat.projectOutputNames(markdown, identity, currentProject);
  } catch (error) {
    fail(error.message, true);
  }
}

function parseResourceMapping(content) {
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
  return resources;
}

function parseProjectResources(content, target = {}) {
  const resources = parseResourceMapping(content);
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

const V3_MODEL_ELEMENT_KINDS = [
  "resource", "parameter", "register", "algorithm", "variable", "constant",
  "define", "include", "build_option", "setting", "function", "isr",
];
const V3_CODE_OBJECT_KINDS = [
  "function", "isr", "declaration", "define", "include", "pragma", "region", "other",
];

function validateV3Model(content, { identity, markdown, source, device, mcu, packageName, dialogue = [] }) {
  const model = parseResourceMapping(content);
  const invalid = (path, reason) => {
    const error = new CanvasContractError(`Model ${path} ${reason}.`, true);
    error.modelPath = path;
    throw error;
  };
  for (const key of ["consistency_checks", "project", "code"]) {
    if (!isObject(model[key])) invalid(key, "must be a mapping");
  }
  for (const key of ["blocks", "shared"]) {
    if (!Array.isArray(model[key])) invalid(key, "must be a list");
  }
  if (!Array.isArray(model.code.objects)) invalid("code.objects", "must be a list");
  if (Object.keys(model).join(",") !== "consistency_checks,project,blocks,shared,code") {
    fail("Use the UartDebug3 consistency_checks, project, blocks, shared and code sections.", true);
  }
  const project = model.project;
  if (project.name !== identity.title) invalid("project.name", "must match the task heading");
  if (typeof project.microcontroller !== "string" || project.microcontroller.toLowerCase() !== mcu.toLowerCase())
    invalid("project.microcontroller", "must match the selected microcontroller");
  if (typeof project.package !== "string" || project.package.toLowerCase() !== packageName.toLowerCase())
    invalid("project.package", "must match the selected package");
  const digest = value => createHash("sha256").update(value).digest("hex");
  const sourceHash = digest(source);
  const tasks = [];
  const headings = projectFormat.v3TaskHeadings(markdown);
  const canonicalNumbers = projectFormat.v3TaskHeadingNumberError(headings) === null;
  const headingsByLine = new Map(headings.map(heading => [heading.line, heading]));
  const repliesByLine = new Map(projectFormat.v3Dialogue(markdown).map(reply => [reply.startLine, reply]));
  const approvedLines = new Set();
  let pendingQuestion = false;
  for (const record of dialogue) {
    if (record.kind !== "decision" && record.kind !== "question") continue;
    const heading = record.anchor?.level ? projectFormat.findV3TaskHeading(headings, record.anchor) : null;
    if (record.kind === "decision" && heading?.level === 3) approvedLines.add(heading.line);
    if (record.kind === "question" && !record.submitted && !record.answer?.trim() && (!record.anchor?.level || heading))
      pendingQuestion = true;
  }
  let task;
  let fragment;
  for (const line of new Set([...headingsByLine.keys(), ...repliesByLine.keys()].sort((a, b) => a - b))) {
    const heading = headingsByLine.get(line);
    if (heading?.level === 2) {
      task = heading.service ? null : { heading, fragments: [] };
      if (task) tasks.push(task);
      fragment = null;
    } else if (heading?.level === 3 && task) {
      fragment = { heading, agreed: approvedLines.has(line) };
      task.fragments.push(fragment);
    }
    const reply = repliesByLine.get(line);
    if (fragment && reply?.valid && reply.marker === "+:" && !reply.answered &&
        !/^(?:Техническое решение|Technical decision|Technical solution)\.?\s*$/iu.test(reply.text)) {
      fragment.agreed = true;
    }
  }
  if (!tasks.length || tasks.some(task => !task.fragments.length || task.fragments.some(fragment => !fragment.agreed)) ||
      pendingQuestion ||
      [...repliesByLine.values()].some(reply => !reply.valid || reply.marker === "?:" || reply.answered)) {
    fail("Resolve and record the technical decisions for every task fragment before generation.", true);
  }
  if (model.blocks.length !== tasks.length) invalid("blocks", "must match the number of approved task blocks");
  const ids = new Map();
  const refs = [];
  const pins = [];
  const matchesHeading = (title, heading) => title === (canonicalNumbers ? heading.title : heading.rawTitle);
  const identify = (value, kind, path) => {
    if (!isObject(value)) invalid(path, "must be a mapping");
    if (typeof value.id !== "string" || !/^[a-z][a-z0-9_]*$/.test(value.id))
      invalid(`${path}.id`, "must use a lowercase identifier matching [a-z][a-z0-9_]*");
    if (ids.has(value.id)) invalid(`${path}.id`, "must be unique in the information model");
    ids.set(value.id, kind);
  };
  const collectReferences = (values, path, kind = null) => {
    if (values === undefined) return;
    if (!Array.isArray(values)) invalid(path, "must be a list of identifiers");
    for (const [index, ref] of values.entries()) {
      const itemPath = `${path}[${index}]`;
      if (typeof ref !== "string") invalid(itemPath, "must be an identifier");
      refs.push({ ref, kind, path: itemPath });
    }
  };
  const element = (value, kind, path) => {
    identify(value, kind, path);
    if (!V3_MODEL_ELEMENT_KINDS.includes(value.kind))
      invalid(`${path}.kind`, `must be one of ${V3_MODEL_ELEMENT_KINDS.join(", ")}`);
    if (typeof value.purpose !== "string" || !value.purpose.trim())
      invalid(`${path}.purpose`, "must describe the element's purpose");
    if (!isObject(value.data)) invalid(`${path}.data`, "must be a mapping");
    if (!Array.isArray(value.origins) || !value.origins.length)
      invalid(`${path}.origins`, "must be a nonempty list of task or code origins");
    for (const [index, origin] of value.origins.entries()) {
      const originPath = `${path}.origins[${index}]`;
      if (!isObject(origin)) invalid(originPath, "must be a mapping");
      if (!["task", "code"].includes(origin.kind)) invalid(`${originPath}.kind`, "must be task or code");
      if (typeof origin.ref !== "string" || !origin.ref.startsWith(origin.kind + ":"))
        invalid(`${originPath}.ref`, `must be ${origin.kind}:<id>`);
      if (typeof origin.contribution !== "string" || !origin.contribution.trim())
        invalid(`${originPath}.contribution`, "must describe what the origin contributed");
      refs.push({ ref: origin.ref.slice(origin.kind.length + 1), kind: origin.kind === "task" ? "fragment" : "code",
        path: `${originPath}.ref` });
    }
    collectReferences(value.depends_on, `${path}.depends_on`);
    collectReferences(value.code_refs, `${path}.code_refs`, "code");
    if (value.kind === "resource" && (value.data.port_pin != null || value.data.package_pin != null)) {
      if (typeof value.data.port_pin !== "string" || !/^P[A-Z][0-7]$/.test(value.data.port_pin))
        invalid(`${path}.data.port_pin`, "must be the exact port pin symbol");
      if (!Number.isSafeInteger(value.data.package_pin))
        invalid(`${path}.data.package_pin`, "must be the exact package pin number");
      pins.push({ pin_symbol: value.data.port_pin, package_pin: value.data.package_pin });
    }
  };
  for (const [index, block] of model.blocks.entries()) {
    const blockPath = `blocks[${index}]`;
    identify(block, "block", blockPath);
    if (!matchesHeading(block.title, tasks[index].heading))
      invalid(`${blockPath}.title`, "must follow the approved task headings and order");
    if (!Array.isArray(block.fragments) || block.fragments.length !== tasks[index].fragments.length)
      invalid(`${blockPath}.fragments`, "must match the list of approved task fragments");
    for (const [fragmentIndex, fragment] of block.fragments.entries()) {
      const path = `${blockPath}.fragments[${fragmentIndex}]`;
      identify(fragment, "fragment", path);
      const solution = fragment.solution;
      if (!matchesHeading(fragment.title, tasks[index].fragments[fragmentIndex].heading))
        invalid(`${path}.title`, "must follow the approved task headings and order");
      if (fragment.proposed_revision) invalid(`${path}.proposed_revision`, "must be resolved before generation");
      if (!isObject(solution)) invalid(`${path}.solution`, "must contain the approved solution");
      if (solution.status !== "approved") invalid(`${path}.solution.status`, "must be approved for generation");
      if (!Array.isArray(solution.elements) || !solution.elements.length)
        invalid(`${path}.solution.elements`, "must contain the detailed approved solution elements");
      collectReferences(solution.shared_refs, `${path}.solution.shared_refs`, "shared");
      for (const [elementIndex, entry] of solution.elements.entries())
        element(entry, "element", `${path}.solution.elements[${elementIndex}]`);
    }
  }
  for (const [index, value] of model.shared.entries()) {
    const path = `shared[${index}]`;
    element(value, "shared", path);
    if (value.status !== "approved") invalid(`${path}.status`, "must be approved for generation");
    collectReferences(value.used_by, `${path}.used_by`, "fragment");
  }
  for (const [index, value] of model.code.objects.entries()) {
    const path = `code.objects[${index}]`;
    identify(value, "code", path);
    if (!V3_CODE_OBJECT_KINDS.includes(value.kind))
      invalid(`${path}.kind`, `must be one of ${V3_CODE_OBJECT_KINDS.join(", ")}`);
    if (!isObject(value.checked) && !isObject(value.observed))
      invalid(path, "must have a checked snapshot or an observed record");
  }
  for (const { ref, kind, path } of refs) {
    if (!ids.has(ref) || kind && ids.get(ref) !== kind)
      invalid(path, `must refer to an existing ${kind || "model"} identifier`);
  }
  if (model.code.observed_sha256 !== null && model.code.observed_sha256 !== sourceHash)
    invalid("code.observed_sha256", "must match the checksum of the returned C or be null");
  for (const key of ["task_matches_model", "code_matches_model"]) {
    const check = model.consistency_checks[key];
    if (!isObject(check) || check.status !== "not_checked" || check.sha256 !== null || check.scope !== null) {
      invalid(`consistency_checks.${key}`, "must use not_checked with null scope and checksum");
    }
  }
  validateHardwarePins(pins, device, packageName);
}

function validateHardwarePins(hardware, device, packageName) {
  if (!device) return;
  const pinout = Object.entries(device.pinouts || {}).find(
    ([name]) => name.toLowerCase() === packageName.toLowerCase(),
  )?.[1]?.pins;
  if (!pinout) fail("The selected package pin map is unavailable.", true);
  const pending = [{ entry: hardware, port: null, symbol: null, namedPin: false }];
  while (pending.length) {
    const {
      entry,
      port: enclosingPort,
      symbol: enclosingSymbol,
      namedPin,
    } = pending.pop();
    if (Array.isArray(entry)) {
      pending.push(
        ...entry.map((value) => ({
          entry: value,
          port: enclosingPort,
          symbol: enclosingSymbol,
          namedPin,
        })),
      );
      continue;
    }
    if (!isObject(entry)) continue;
    // Canonical nested pin keys identify the same pin as explicit coordinates.
    // Other resource keys remain opaque so future peripherals keep their shape.
    for (const [key, value] of Object.entries(entry)) {
      const portKey = /^PORT([A-Z])$/.exec(key);
      const pinKey = /^P[A-Z]\d+$/.test(key);
      pending.push({
        entry: value,
        port: portKey ? portKey[1] : enclosingPort,
        symbol: portKey ? null : pinKey ? key : enclosingSymbol,
        namedPin: pinKey,
      });
    }
    const present = (key) => Object.hasOwn(entry, key) && entry[key] !== null;
    if (
      !namedPin &&
      !["pin_symbol", "package_pin", "physical_pin", "port_pin"].some(present)
    ) {
      continue;
    }
    let symbol = enclosingSymbol;
    if (symbol && !Object.hasOwn(pinout, symbol))
      fail(
        "A nested pin key is unavailable in the selected device package.",
        true,
      );
    if (present("pin_symbol")) {
      if (
        typeof entry.pin_symbol !== "string" ||
        !Object.hasOwn(pinout, entry.pin_symbol)
      )
        fail(
          "A declared pin_symbol is unavailable in the selected device package.",
          true,
        );
      if (symbol && symbol !== entry.pin_symbol)
        fail(
          "The declared pin_symbol disagrees with its enclosing pin key.",
          true,
        );
      symbol = entry.pin_symbol;
    }
    const coordinates = symbol && /^P([A-Z])(\d+)$/.exec(symbol);
    let port = enclosingPort;
    if (present("port")) {
      if (
        typeof entry.port !== "string" ||
        !/^(?:PORT)?[A-Z]$/.test(entry.port)
      )
        fail(
          "A declared port must use its canonical port letter or PORT name.",
          true,
        );
      if (port && port !== entry.port.replace(/^PORT/, ""))
        fail("The declared port disagrees with its enclosing PORT key.", true);
      port = entry.port.replace(/^PORT/, "");
    }
    if (symbol && port && (!coordinates || coordinates[1] !== port))
      fail(
        "The declared port disagrees with pin_symbol or its enclosing pin key.",
        true,
      );
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
    if (
      present("package_pin") &&
      present("physical_pin") &&
      entry.package_pin !== entry.physical_pin
    )
      fail("The declared package_pin and physical_pin must agree.", true);
    for (const key of ["package_pin", "physical_pin"].filter(present)) {
      const physical = entry[key];
      if (
        !Number.isSafeInteger(physical) ||
        physical <= 0 ||
        !Object.values(pinout).includes(physical) ||
        (symbol && pinout[symbol] !== physical)
      )
        fail(
          `The declared ${key} disagrees with the selected package pin map.`,
          true,
        );
    }
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
function userCodeEditsRequested(source) {
  return codeRegions(source).some((region) =>
    region.user && /\/\/X(?:\s|$)|\/\/[^\n]*!X(?:\s|$)/m.test(
      sourceWithoutLiterals(region.content),
    ),
  );
}
function validateSource(
  source,
  resources,
  currentSource = "",
  identity = null,
  projectV3 = false,
) {
  boundedText(source, "project.source.content", 64 * 1024, {
    empty: false,
    generated: true,
  });
  if (identity) {
    const information = source
      .slice(0, source.search(/^[ \t\v\f\r]*#[ \t\v\f\r]*include/m))
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
    !projectV3 && (regions.filter((region) => region.user).length < 3 ||
    regions.filter((region) => !region.user).length < 4)
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
    ...sourceCode.matchAll(/^[ \t\v\f\r]*#[ \t\v\f\r]*include[ \t\v\f\r]*([<"][^>"\r\n]+[>"])/gm),
  ].map((match) => `#include ${match[1]}`);
  if (
    includes.filter((line) => line === "#include <xc.h>").length !== 1 ||
    (!projectV3 && JSON.stringify([...new Set(includes)].sort()) !==
      JSON.stringify(
        [...new Set(resources.software_dependencies.includes)].sort(),
      ))
  )
    fail("C includes and resource YAML dependencies must agree exactly.", true);
  if (/\.\s*(?:PIT)?INTFLAGS\s*\|=/.test(executable))
    fail("Clear W1C INTFLAGS with assignment, not read-modify-write.", true);
}

function validateCanvasOutput(raw, options = {}) {
  assertSchema(raw, options.structuredDialogue ? TASK_DIALOGUE_OUTPUT_SCHEMA :
    options.conversation ? CHAT_OUTPUT_SCHEMA : CANVAS_OUTPUT_SCHEMA);
  if (options.conversation) {
    boundedText(raw.message, "message", 32 * 1024, { generated: true });
    if (!raw.message.trim()) fail("A conversation response must contain a message.", true);
  }
  if (options.conversation && raw.action === "reply") {
    if (raw.canvas !== null || raw.project !== null)
      fail("A conversational reply must not change project artifacts.", true);
    return raw;
  }
  if (options.conversation && raw.canvas === null)
    fail("An artifact action must include its complete specification snapshot.", true);
  const input = normalizeCanvas(options.canvas);
  const operation = options.operation || "analyze";
  if (!Object.hasOwn(PROJECT_STAGES, operation))
    fail("Choose an authorized project stage.", true);
  const locale = normalizeLocale(raw.canvas.locale, true);
  if (input.locale && input.locale.toLowerCase() !== locale.toLowerCase())
    fail("Preserve the explicitly selected project language.", true);
  const markdown = boundedText(
    raw.canvas.markdown,
    "canvas.markdown",
    MAX_CANVAS_BYTES,
    { generated: true },
  );
  const taskDialogue = options.dialogueV3 || options.projectV3;
  if (options.structuredDialogue && ["analyze", "generate"].includes(operation)) {
    const oldIds = new Set([
      ...inlineRemarks(input.markdown).map(item => item.id),
      ...projectFormat.v3Dialogue(input.markdown).map(item => item.id),
    ]);
    if ([...inlineRemarks(markdown), ...projectFormat.v3Dialogue(markdown)].some(item => !oldIds.has(item.id))) {
      fail("Put new assistant discussion in canvas.dialogue, outside the editable Markdown.", true);
    }
    const agreedQuotes = value => (value.match(/^ {0,3}>[ \t]*\x60{3}text[ \t]*\n {0,3}>[ \t]*(?:Согласованный текст задания|Agreed task text)\.[ \t]*$/gmi) || []).length;
    if (agreedQuotes(markdown) > agreedQuotes(input.markdown)) {
      fail("Put newly agreed requirement quotes in canvas.dialogue with kind requirement.", true);
    }
    if (markdown !== input.markdown) {
      const badHeading = projectFormat.v3TaskHeadingNumberError(markdown);
      if (badHeading) {
        fail(badHeading.expected
          ? `Task heading at line ${badHeading.line + 1} must end with block number ${badHeading.expected}.`
          : `Check the heading hierarchy at line ${badHeading.line + 1}. Use a parent heading and leave the continuation heading unnumbered.`, true);
      }
    }
  }
  const dialogue = options.structuredDialogue
    ? applyTaskDialogue(raw.canvas.dialogue, raw.canvas.acknowledged, input, operation, markdown, options.message)
    : input.dialogue;
  const remarks = operation === "analyze"
    ? taskDialogue ? validateV3TaskDialogue(markdown, input.markdown) : validateRemarkLocale(markdown, input, locale)
    : [];
  if (
    operation === "analyze" &&
    !options.conversation && !taskDialogue &&
    !input.locale &&
    !input.markdown.trim() &&
    locale.toLowerCase().split("-")[0] !== "en"
  )
    fail("An empty draft without a selected language must use English.", true);
  if (
    operation === "analyze" &&
    !options.conversation && !taskDialogue &&
    !input.markdown.trim() &&
    !remarks.some((remark) => remark.hasBody)
  )
    fail(
      "Reviewing an empty draft must put initial questions in canonical inline Markdown remark blocks on that draft, not only in the service message. This stage explicitly authorizes those remarks before project identity is confirmed.",
      true,
    );
  if (operation === "analyze" && taskDialogue && !options.structuredDialogue && (!options.conversation || options.requestSource === "review") &&
      !input.markdown.trim() && !remarks.some(reply => reply.valid && reply.marker === "?:")) {
    fail("Ask the initial setup questions directly in the empty task using AI-N and ?:.", true);
  }
  if (operation !== "analyze" && !(options.conversation && operation === "generate" && !options.projectV3) && markdown !== input.markdown)
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
      raw.action !== PROJECT_STAGES[operation].action
    )
      fail("The response does not match the authorized project stage.", true);
    const project = raw.project;
    const outputRoles = ["source", "resources", "guide"].filter((role) => project[role] !== null);
    const expectedRoles = PROJECT_STAGES[operation].outputRoles;
    if (
      outputRoles.length !== expectedRoles.length ||
      outputRoles.some((role) => !expectedRoles.includes(role))
    )
      fail(`This stage must return only ${expectedRoles.join(" and ")}.`, true);
    validateFileName(`${project.title}.md`, /\.md$/i);
    const projectMarkdown = options.conversation && operation === "generate" ? markdown : input.markdown;
    const identity = options.projectV3 ? projectFormat.v3ProjectIdentity(projectMarkdown) : projectIdentity(projectMarkdown);
    if (
      !identity ||
      project.title !== identity.title ||
      project.version !== identity.version
    )
      fail(
        options.projectV3 ? "Use the exact UartDebug3 task heading and an empty version." :
          "Use the exact project name and Ver.X.Y from the specification.",
        true,
      );
    if (raw.action === "generate") {
      validateFileName(project.source.name, /\.c$/i);
      validateFileName(project.resources.name, /\.yaml$/i);
      let names;
      try {
        names = options.projectV3
          ? projectFormat.v3ProjectOutputNames(identity, options.currentProject)
          : projectOutputNames(projectMarkdown, identity, options.currentProject);
      } catch (error) { fail(error.message, true); }
      if (
        project.source.name !== names.sourceName ||
        project.resources.name !== names.resourcesName
      )
        fail("Preserve existing or canonical output file names.", true);
      let resources;
      if (options.projectV3) {
        const target = projectFormat.v3ProjectTarget(projectMarkdown);
        if (!target || target.mcu !== options.mcu || target.packageName.toLowerCase() !== options.packageName.toLowerCase()) {
          fail("Record the exact selected microcontroller and package in the task header.", true);
        }
        if (/\r/.test(project.source.content)) fail("Use LF line endings in generated C so its checked bytes remain stable.", true);
        validateV3Model(project.resources.content, { ...options, identity, markdown, dialogue, source: project.source.content });
      } else resources = parseProjectResources(project.resources.content, options);
      validateSource(
        project.source.content,
        resources,
        options.currentProject?.source || "",
        options.projectV3 ? null : identity,
        options.projectV3,
      );
    } else {
      if (!options.currentProject?.source?.trim())
        fail(
          "Description must use existing C and return documentation only.",
          true,
        );
      validateFileName(project.guide.name, /\.md$/i);
      normalizeLocale(project.guide.locale, true);
      const hasDescription = !!options.currentProject.guide?.trim();
      const selectedLocale = options.currentProject.guideLocale;
      const expectedLocale = hasDescription
        ? selectedLocale && selectedLocale.toLowerCase() !== "und"
          ? selectedLocale
          : null
        : locale;
      const expectedName = hasDescription
        ? options.currentProject.guideName
        : identity.title + (options.projectV3 ? ".Description.md" : " (description).md");
      if (
        project.guide.locale.toLowerCase() === "und" ||
        (expectedLocale && project.guide.locale.toLowerCase() !== expectedLocale.toLowerCase())
      )
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
      ...(dialogue !== undefined ? { dialogue } : {}),
      ...(input.target ? { target: input.target } : {}),
    },
  };
}

module.exports = {
  CANVAS_OUTPUT_SCHEMA,
  CHAT_OUTPUT_SCHEMA,
  TASK_DIALOGUE_OUTPUT_SCHEMA,
  CanvasContractError,
  normalizeCanvas,
  validateCanvasOutput,
  projectIdentity,
  projectOutputNames,
  parseProjectResources,
  codeRegions,
  userCodeEditsRequested,
  validateSource,
};
