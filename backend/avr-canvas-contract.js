"use strict";

const {
  extractDocumentationMarkers,
  extractMarkdownHeadings,
} = require("./avr-documentation-markers");
const { RTC_PIT_PERIOD_CYCLES } = require("./avr-knowledge");

const MAX_CANVAS_BYTES = 128 * 1024;
const MAX_ANNOTATIONS = 100;
const GUIDE_VERIFICATION_MARKER = "<!-- uartdebug:verification -->";
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
const integer = (minimum = 1) => ({
  type: "integer",
  minimum,
  maximum: Number.MAX_SAFE_INTEGER,
});
const enumeration = (...values) => ({ type: "string", enum: values });
const array = (items, maxItems) => ({ type: "array", items, maxItems });

const annotationSchema = object({
  id: text(96, 1),
  kind: enumeration("question", "information", "error"),
  anchor: object({ quote: text(2000, 1), line: nullable(integer()) }),
  message: text(8000, 1),
  status: enumeration("open", "resolved"),
  answer: text(8000),
});
const described = (schema, description) => ({ ...schema, description });
function resourceVariant(kind, fields, description) {
  const unused = {
    type: "null",
    description: `Not applicable to ${kind}; return null.`,
  };
  return {
    ...object({
      id: described(
        text(64, 1),
        "Stable ASCII resource identifier; start with a letter and use letters, digits, underscores or hyphens.",
      ),
      kind: enumeration(kind),
      pin: unused,
      direction: unused,
      instance: unused,
      route: unused,
      txPin: unused,
      rxPin: unused,
      baud: unused,
      periodUs: unused,
      prescaler: unused,
      clockSource: unused,
      periodCycles: unused,
      ...fields,
      description: described(
        text(4000),
        "Purpose and relevant configuration in the canvas language.",
      ),
    }),
    description,
  };
}
const resourceSchema = {
  anyOf: [
    resourceVariant(
      "gpio",
      {
        pin: described(
          text(16, 1),
          "Allocated port pin, such as PA3; must exist in the selected package.",
        ),
        direction: enumeration("input", "output"),
      },
      "A GPIO resource uses only pin and direction; all peripheral fields are null.",
    ),
    resourceVariant(
      "uart",
      {
        instance: enumeration("USART0", "USART1"),
        route: described(
          enumeration("DEFAULT", "ALT1"),
          "USART pin routing selection from the device profile; match txPin and rxPin to this route.",
        ),
        txPin: described(
          nullable(text(16, 1)),
          "TXD port pin for the selected USART route, or null when transmission is unused.",
        ),
        rxPin: described(
          nullable(text(16, 1)),
          "RXD port pin for the selected USART route, or null when reception is unused. At least one of txPin and rxPin must be set.",
        ),
        baud: described(
          integer(),
          "Requested UART baud rate in bits per second.",
        ),
      },
      "A UART resource uses instance, route, txPin, rxPin and baud. pin, direction, periodUs and prescaler must be null.",
    ),
    resourceVariant(
      "timer",
      {
        pin: described(
          nullable(text(16, 1)),
          "An optional pin owned by this timer resource; normally null for interrupt timing. Never duplicate a separate GPIO allocation.",
        ),
        instance: enumeration("TCA0"),
        periodUs: described(
          integer(),
          "Requested TCA0 SINGLE overflow period in microseconds.",
        ),
        prescaler: described(
          integer(),
          "TCA0 prescaler divisor: 1, 2, 4, 8, 16, 64, 256 or 1024.",
        ),
      },
      "TCA0 SINGLE normal overflow timer. Use instance, periodUs and prescaler, with an optional owned pin. route MUST be null: SINGLE is a timer mode, not a routing value. direction, txPin, rxPin and baud must also be null.",
    ),
    resourceVariant(
      "rtc-pit",
      {
        instance: enumeration("RTC"),
        clockSource: enumeration("INT32K"),
        periodCycles: described(
          { type: "integer", enum: RTC_PIT_PERIOD_CYCLES },
          "PIT interval in nominal 32768 Hz RTC clocks; selects RTC_PERIOD_CYC<n>_gc. No CPU clock or RTC counter prescaler is involved.",
        ),
        periodUs: described(
          nullable(integer()),
          "Nominal PIT interval rounded to the nearest microsecond, or null. When supplied it must match periodCycles * 1000000 / 32768 rounded to the nearest integer.",
        ),
      },
      "Boot-only RTC PIT periodic interrupts using INT32K. Reserves RTC clock configuration and RTC_PIT_vect. Use a separate GPIO resource for the output pin; pin, direction, route, txPin, rxPin, baud and prescaler must be null. RTC counter, calibration, sleep and runtime reconfiguration are not supported.",
    ),
  ],
};
const specSchema = object({
  schemaVersion: { type: "integer", enum: [1] },
  language: text(35, 2),
  microcontroller: object({ model: text(40, 1), package: text(48, 1) }),
  clock: object({ hz: described(nullable(integer()), "Actual configured CPU/peripheral clock in Hz, or null to leave the CPU clock unchanged without claiming its frequency. Null is allowed only for GPIO and RTC PIT projects without CPU-dependent delays.") }),
  resources: array(resourceSchema, 100),
  includes: array(text(128, 1), 64),
  description: text(16000, 1),
});
const projectSchema = object({
  title: text(96, 1),
  summary: text(1000, 1),
  version: text(32, 1),
  source: object({ name: text(96, 1), content: text(64 * 1024, 1) }),
  guide: object({
    name: text(96, 1),
    locale: text(35, 2),
    content: described(
      text(120 * 1024, 1),
      `Guide Markdown in guide.locale. Include exactly one literal ${GUIDE_VERIFICATION_MARKER} where the server will insert actual verification results. Do not write compilation or hardware-test claims elsewhere.`,
    ),
    verificationMessages: object({
      passed: described(
        text(1000, 1),
        "One short sentence in guide.locale meaning: The generated source passed server compiler verification. This is a template, not a claim that compilation has already happened.",
      ),
      skipped: described(
        text(1000, 1),
        "One short sentence in guide.locale meaning: Server compiler verification was not performed.",
      ),
      hardwareNotTested: described(
        text(1000, 1),
        "One short sentence in guide.locale meaning: This generated project has not been tested on physical hardware.",
      ),
    }),
  }),
  spec: specSchema,
});

const CANVAS_OUTPUT_SCHEMA = object({
  action: enumeration("clarify", "generate"),
  message: text(2000, 1),
  canvas: object({
    markdown: text(MAX_CANVAS_BYTES, 1),
    locale: text(35, 2),
    annotations: array(annotationSchema, MAX_ANNOTATIONS),
  }),
  project: nullable(projectSchema),
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

function validateProject(
  project,
  { canvas, mcu, packageName, currentProject },
) {
  validateFileName(project.source.name, /\.c$/i);
  validateFileName(project.guide.name, /\.md$/i);
  boundedText(project.source.content, "project.source.content", 64 * 1024, {
    empty: false,
    generated: true,
  });
  // Leave room for the two localized verification sentences inserted by the server.
  boundedText(project.guide.content, "project.guide.content", 120 * 1024, {
    empty: false,
    generated: true,
  });
  normalizeLocale(project.guide.locale, true);
  normalizeLocale(project.spec.language, true);
  if (
    project.guide.locale.toLowerCase() !== canvas.locale.toLowerCase() ||
    project.spec.language.toLowerCase() !== canvas.locale.toLowerCase()
  ) {
    fail(
      "Generated documentation and specification must use the canvas language.",
      true,
    );
  }
  const expectedMcu = mcu || canvas.target?.mcu;
  const expectedPackage = packageName || canvas.target?.packageName;
  if (
    expectedMcu &&
    project.spec.microcontroller.model.toLowerCase() !==
      expectedMcu.toLowerCase()
  )
    fail(
      "The generated specification changes the selected microcontroller.",
      true,
    );
  if (
    expectedPackage &&
    project.spec.microcontroller.package.toLowerCase() !==
      expectedPackage.toLowerCase()
  )
    fail("The generated specification changes the selected package.", true);
  for (const [key, generated] of [
    ["sourceName", project.source.name],
    ["guideName", project.guide.name],
  ]) {
    const existing = currentProject?.[key];
    if (existing && existing !== generated)
      fail(`Generated updates must preserve the current ${key}.`, true);
  }
  const ids = new Set();
  for (const resource of project.spec.resources) {
    if (!safeId.test(resource.id) || ids.has(resource.id))
      fail("Resource identifiers must be unique and URL-safe.", true);
    ids.add(resource.id);
    for (const field of ["pin", "txPin", "rxPin"]) {
      if (resource[field] !== null && !/^P[A-Z][0-7]$/.test(resource[field]))
        fail(
          "Resource pins must use their device port names, for example PA3.",
          true,
        );
    }
    if (resource.kind === "gpio" && (!resource.pin || !resource.direction))
      fail("GPIO resources require a pin and direction.", true);
    if (
      resource.kind === "uart" &&
      (!resource.instance ||
        !resource.baud ||
        (!resource.txPin && !resource.rxPin))
    )
      fail(
        "UART resources require an instance, baud rate and at least one signal pin.",
        true,
      );
    if (
      resource.kind === "timer" &&
      (!resource.instance || !resource.periodUs || !resource.prescaler)
    )
      fail("Timer resources require an instance, period and prescaler.", true);
    if (resource.kind === "rtc-pit" &&
        (resource.instance !== "RTC" || resource.clockSource !== "INT32K" || !resource.periodCycles))
      fail("RTC PIT requires RTC, INT32K and a supported fixed cycle period.", true);
  }
  const headings = new Set(
    extractMarkdownHeadings(project.guide.content).map(
      (heading) => `${heading.level}:${heading.key}`,
    ),
  );
  for (const marker of extractDocumentationMarkers(project.source.content)) {
    if (!headings.has(`${marker.level}:${marker.key}`))
      fail(`The guide is missing the source heading "${marker.title}".`, true);
  }
  if (project.guide.content.split(GUIDE_VERIFICATION_MARKER).length !== 2) {
    fail(
      "The guide must contain exactly one verification placeholder for actual server results.",
      true,
    );
  }
  return {
    ...project,
    source: {
      ...project.source,
      content: project.source.content.replace(/\r\n?/g, "\n"),
    },
    guide: {
      ...project.guide,
      content: project.guide.content.replace(/\r\n?/g, "\n"),
    },
  };
}

function validateCanvasOutput(raw, options = {}) {
  assertSchema(raw, CANVAS_OUTPUT_SCHEMA);
  const input = normalizeCanvas(options.canvas);
  const locale = normalizeLocale(raw.canvas.locale, true);
  if (input.locale && input.locale.toLowerCase() !== locale.toLowerCase()) {
    fail(
      "The generated canvas must preserve its explicitly selected language.",
      true,
    );
  }
  const markdown = boundedText(
    raw.canvas.markdown,
    "canvas.markdown",
    MAX_CANVAS_BYTES,
    { generated: true, empty: false },
  );
  const annotations = normalizeAnnotations(raw.canvas.annotations, markdown, {
    generated: true,
    requireAnchors: true,
  });
  const byId = new Map(
    annotations.map((annotation) => [annotation.id, annotation]),
  );
  const previousIds = new Set(
    input.annotations.map((annotation) => annotation.id),
  );
  for (const annotation of annotations) {
    if (
      annotation.kind === "question" &&
      !previousIds.has(annotation.id) &&
      (annotation.answer || annotation.status === "resolved")
    ) {
      fail("A new question must await the user's answer.", true);
    }
  }
  for (const previous of input.annotations) {
    const updated = byId.get(previous.id);
    if (
      !updated ||
      updated.kind !== previous.kind ||
      updated.answer !== previous.answer
    )
      fail(
        "Generated canvas edits must preserve annotation identifiers, kinds and user answers.",
        true,
      );
  }
  if ((raw.action === "clarify") !== (raw.project === null))
    fail(
      "Clarification must have no project; generation must provide a complete project.",
      true,
    );
  if (
    raw.action === "generate" &&
    annotations.some(
      (annotation) =>
        annotation.status === "open" &&
        ["question", "error"].includes(annotation.kind),
    )
  ) {
    fail(
      "Resolve open questions and errors before generating a project.",
      true,
    );
  }
  const canvas = {
    schemaVersion: 2,
    revision: input.revision,
    markdown,
    locale,
    annotations,
    ...(input.target ? { target: input.target } : {}),
  };
  return {
    action: raw.action,
    message: raw.message,
    canvas,
    project:
      raw.project === null
        ? null
        : validateProject(raw.project, { ...options, canvas }),
  };
}

// JSON quoted strings are valid YAML 1.2 scalars and cannot inject tags, keys or comments.
function serializeProjectSpec(spec) {
  assertSchema(spec, specSchema, "spec");
  function lines(value, indent, parentKey = "") {
    const prefix = " ".repeat(indent);
    if (Array.isArray(value)) {
      return value.flatMap((entry) =>
        isObject(entry)
          ? [`${prefix}-`, ...lines(entry, indent + 2)]
          : [`${prefix}- ${JSON.stringify(entry)}`],
      );
    }
    return Object.entries(value).flatMap(([key, entry]) => {
      // The strict model schema uses explicit nulls; human-facing YAML omits
      // fields that do not apply to this resource.
      if (entry === null) return parentKey === "clock" && key === "hz" ? [`${prefix}${key}: null`] : [];
      if (Array.isArray(entry) && entry.length === 0)
        return [`${prefix}${key}: []`];
      return isObject(entry) || Array.isArray(entry)
        ? [`${prefix}${key}:`, ...lines(entry, indent + 2, key)]
        : [`${prefix}${key}: ${JSON.stringify(entry)}`];
    });
  }
  // Canonical property order is defined by the contract, independent of model JSON order.
  function order(value, schema) {
    if (schema.anyOf) {
      const alternative = schema.anyOf.find((candidate) => {
        try {
          assertSchema(value, candidate, "spec");
          return true;
        } catch (error) {
          if (!(error instanceof CanvasContractError)) throw error;
          return false;
        }
      });
      if (!alternative)
        fail("The specification has no matching schema variant.", true);
      return order(value, alternative);
    }
    if (schema.type === "object")
      return Object.fromEntries(
        Object.entries(schema.properties).map(([key, child]) => [
          key,
          order(value[key], child),
        ]),
      );
    if (schema.type === "array")
      return value.map((entry) => order(entry, schema.items));
    return value;
  }
  return `${lines(order(spec, specSchema), 0).join("\n")}\n`;
}

module.exports = {
  CANVAS_OUTPUT_SCHEMA,
  GUIDE_VERIFICATION_MARKER,
  CanvasContractError,
  normalizeCanvas,
  validateCanvasOutput,
  serializeProjectSpec,
};
