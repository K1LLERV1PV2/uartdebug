"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  CANVAS_OUTPUT_SCHEMA,
  GUIDE_VERIFICATION_MARKER,
  CanvasContractError,
  normalizeCanvas,
  validateCanvasOutput,
  serializeProjectSpec,
} = require("../backend/avr-canvas-contract");

function canvas(overrides = {}) {
  return {
    schemaVersion: 2,
    revision: 8,
    markdown: "# Задача\nМигать светодиодом на PA3.",
    locale: "ru",
    annotations: [],
    target: { mcu: "attiny1624", packageName: "SOIC-14" },
    ...overrides,
  };
}

function annotation(overrides = {}) {
  return {
    id: "question-1",
    kind: "question",
    anchor: { quote: "Мигать светодиодом", line: 2 },
    message: "Какой период мигания?",
    status: "open",
    answer: "",
    ...overrides,
  };
}

function resource(overrides = {}) {
  return {
    id: "led",
    kind: "gpio",
    pin: "PA3",
    direction: "output",
    instance: null,
    route: null,
    txPin: null,
    rxPin: null,
    baud: null,
    periodUs: null,
    prescaler: null,
    description: "Светодиод",
    ...overrides,
  };
}

function spec() {
  return {
    schemaVersion: 1,
    language: "ru",
    microcontroller: { model: "ATtiny1624", package: "SOIC-14" },
    clock: { hz: 3333333 },
    resources: [resource()],
    includes: ["avr/io.h"],
    description: "Мигание светодиода",
  };
}

function generation() {
  return {
    action: "generate",
    message: "Готово",
    canvas: { markdown: canvas().markdown, locale: "ru", annotations: [] },
    project: {
      title: "Светодиод",
      summary: "Мигание на PA3",
      version: "1.0.0",
      source: {
        name: "blink.c",
        content: "//# Мигание\nint main(void) { for (;;) {} }\n",
      },
      guide: {
        name: "blink.ru.md",
        locale: "ru",
        content: `# Мигание\nПодключите светодиод к PA3.\n\n${GUIDE_VERIFICATION_MARKER}\n`,
        verificationMessages: {
          passed: "Исходный код прошёл проверку серверным компилятором.",
          skipped: "Проверка серверным компилятором не выполнялась.",
          hardwareNotTested: "Этот проект не проверялся на физическом устройстве.",
        },
      },
      spec: spec(),
    },
  };
}

test("the output schema uses strict complete objects at every nesting level", () => {
  function visit(schema) {
    if (schema.type === "object") {
      assert.equal(schema.additionalProperties, false);
      assert.deepEqual(schema.required, Object.keys(schema.properties));
      Object.values(schema.properties).forEach(visit);
    }
    if (schema.items) visit(schema.items);
    if (schema.anyOf) schema.anyOf.forEach(visit);
  }
  visit(CANVAS_OUTPUT_SCHEMA);
  assert.equal(CANVAS_OUTPUT_SCHEMA.properties.project.anyOf[1].type, "null");
});

test("legacy instructions migrate without obsolete skill references or data loss", () => {
  const migrated = normalizeCanvas({
    schemaVersion: 1,
    revision: 4,
    markdown: "# Project\r\n",
    skillRefs: [{ id: "unused", version: "1" }],
  });
  assert.deepEqual(migrated, {
    schemaVersion: 2,
    revision: 4,
    markdown: "# Project\n",
    locale: "",
    annotations: [],
  });
});

test("canvas normalization preserves target, answers and valid authorship", () => {
  const input = canvas({
    annotations: [annotation({ answer: "Раз в секунду" })],
    authorship: { schemaVersion: 1, lines: ["human", "ai"], updatedAt: 20 },
  });
  assert.deepEqual(normalizeCanvas(input), input);
  const withStaleAnchor = canvas({
    annotations: [
      annotation({ anchor: { quote: "Deleted by user", line: 100 } }),
    ],
  });
  assert.equal(normalizeCanvas(withStaleAnchor).annotations.length, 1);
});

test("invalid revisions, duplicate annotation IDs and unanswered resolutions are rejected", () => {
  for (const input of [
    canvas({ revision: -1 }),
    canvas({ revision: Number.MAX_SAFE_INTEGER }),
    canvas({ annotations: [annotation(), annotation()] }),
    canvas({ annotations: [annotation({ status: "resolved" })] }),
    canvas({ annotations: [annotation({ id: "../../escape" })] }),
    canvas({ annotations: [annotation({ id: 123 })] }),
    canvas({ markdown: "x\0" }),
    canvas({ locale: "../../en" }),
  ])
    assert.throws(
      () => normalizeCanvas(input),
      (error) => error instanceof CanvasContractError && error.status === 400,
    );
});

test("clarification preserves revision and must anchor questions in the resulting text", () => {
  const output = {
    action: "clarify",
    message: "Нужно уточнение",
    canvas: {
      markdown: canvas().markdown,
      locale: "ru",
      annotations: [annotation()],
    },
    project: null,
  };
  const result = validateCanvasOutput(output, { canvas: canvas() });
  assert.equal(result.canvas.revision, 8);
  assert.deepEqual(result.canvas.target, canvas().target);
  assert.equal(result.canvas.annotations[0].id, "question-1");
  output.canvas.annotations[0].anchor.quote = "Несуществующий текст";
  assert.throws(
    () => validateCanvasOutput(output, { canvas: canvas() }),
    /quote text present/,
  );
});

test("generation returns synchronized C, documentation and a structured specification", () => {
  const output = generation();
  const result = validateCanvasOutput(output, {
    canvas: canvas(),
    mcu: "attiny1624",
    packageName: "SOIC-14",
  });
  assert.deepEqual(result.project, output.project);
  assert.equal(result.canvas.locale, "ru");
  assert.equal(result.canvas.revision, 8);
  assert.equal(Object.hasOwn(result.project, "aiSpec"), false);
});

test("the model cannot silently remove a question, forge an answer or generate with blockers", () => {
  const input = canvas({ annotations: [annotation()] });
  assert.throws(
    () => validateCanvasOutput(generation(), { canvas: input }),
    /preserve annotation/,
  );
  const forged = generation();
  forged.canvas.annotations = [
    annotation({ status: "resolved", answer: "Invented by model" }),
  ];
  assert.throws(
    () => validateCanvasOutput(forged, { canvas: input }),
    /user answers/,
  );
  const blocked = generation();
  blocked.canvas.annotations = [annotation()];
  assert.throws(
    () => validateCanvasOutput(blocked, { canvas: input }),
    /Resolve open/,
  );
  const newlyForged = generation();
  newlyForged.canvas.annotations = [
    annotation({ status: "resolved", answer: "Model's invented answer" }),
  ];
  assert.throws(
    () => validateCanvasOutput(newlyForged, { canvas: canvas() }),
    /await the user's answer/,
  );
});

test("answered questions can be resolved without losing identifiers or user text", () => {
  const answered = annotation({ answer: "Каждую секунду" });
  const output = generation();
  output.canvas.annotations = [{ ...answered, status: "resolved" }];
  const result = validateCanvasOutput(output, {
    canvas: canvas({ annotations: [answered] }),
  });
  assert.equal(result.canvas.annotations[0].answer, "Каждую секунду");
  assert.equal(result.canvas.annotations[0].status, "resolved");
});

test("action and project presence must agree and unexpected schema fields fail closed", () => {
  for (const change of [
    (output) => {
      output.action = "clarify";
    },
    (output) => {
      output.project = null;
    },
    (output) => {
      output.project.aiSpec = {};
    },
    (output) => {
      output.project.spec.microcontroller.extra = true;
    },
    (output) => {
      delete output.project.spec.clock;
    },
  ]) {
    const output = generation();
    change(output);
    assert.throws(
      () => validateCanvasOutput(output, { canvas: canvas() }),
      (error) => error instanceof CanvasContractError && error.status === 502,
    );
  }
});

test("selected hardware and language cannot drift during generation", () => {
  for (const change of [
    (project) => {
      project.spec.microcontroller.model = "ATtiny1627";
    },
    (project) => {
      project.spec.microcontroller.package = "VQFN-20";
    },
    (project) => {
      project.guide.locale = "en";
    },
    (project) => {
      project.spec.language = "en";
    },
  ]) {
    const output = generation();
    change(output.project);
    assert.throws(
      () => validateCanvasOutput(output, { canvas: canvas() }),
      CanvasContractError,
    );
  }
});

test("a new canvas infers Russian from its content and may persist an incomplete target selection", () => {
  const input = canvas({
    locale: "",
    target: { mcu: "attiny1624", packageName: "" },
  });
  assert.deepEqual(normalizeCanvas(input).target, input.target);
  const output = generation();
  const result = validateCanvasOutput(output, { canvas: input });
  assert.equal(result.canvas.locale, "ru");
  assert.equal(result.project.guide.locale, "ru");
  assert.equal(result.project.spec.language, "ru");
  assert.throws(
    () => validateCanvasOutput(output, { canvas: canvas({ locale: "en" }) }),
    /explicitly selected language/,
  );
  assert.equal(
    normalizeCanvas(
      canvas({ target: { mcu: "", packageName: "" }, locale: "" }),
    ).locale,
    "",
  );
});

test("updates preserve file identities and documentation markers", () => {
  assert.throws(
    () =>
      validateCanvasOutput(generation(), {
        canvas: canvas(),
        currentProject: { sourceName: "existing.c" },
      }),
    /sourceName/,
  );
  const output = generation();
  output.project.guide.content = "# Other heading\n";
  assert.throws(
    () => validateCanvasOutput(output, { canvas: canvas() }),
    /missing the source heading/,
  );
});

test("guide verification uses one server-owned placeholder and complete localized templates", () => {
  const output = generation();
  const result = validateCanvasOutput(output, { canvas: canvas() });
  assert.deepEqual(result.project.guide.verificationMessages, output.project.guide.verificationMessages);
  assert.equal(result.project.guide.content.split(GUIDE_VERIFICATION_MARKER).length, 2);
  for (const content of [
    output.project.guide.content.replace(GUIDE_VERIFICATION_MARKER, ""),
    `${output.project.guide.content}\n${GUIDE_VERIFICATION_MARKER}`,
  ]) {
    const invalid = generation();
    invalid.project.guide.content = content;
    assert.throws(() => validateCanvasOutput(invalid, { canvas: canvas() }), /exactly one verification placeholder/);
  }
  for (const field of ["passed", "skipped", "hardwareNotTested"]) {
    const invalid = generation();
    delete invalid.project.guide.verificationMessages[field];
    assert.throws(() => validateCanvasOutput(invalid, { canvas: canvas() }), (error) => error instanceof CanvasContractError && error.status === 502);
  }
});

test("unsafe names and incomplete peripheral resources are rejected", () => {
  for (const name of ["../blink.c", "C:blink.c", "NUL.c", "blink.txt"]) {
    const output = generation();
    output.project.source.name = name;
    assert.throws(
      () => validateCanvasOutput(output, { canvas: canvas() }),
      /file names/,
    );
  }
  for (const entry of [
    resource({ pin: null }),
    resource({ pin: "PA99" }),
    resource({ kind: "uart" }),
    resource({ kind: "timer" }),
  ]) {
    const output = generation();
    output.project.spec.resources = [entry];
    assert.throws(
      () => validateCanvasOutput(output, { canvas: canvas() }),
      CanvasContractError,
    );
  }
});

test("YAML serialization is canonical and quotes multiline, tag and key-like user text", () => {
  const specification = spec();
  specification.description = 'yes\nclock: 0\n!!js/function "unsafe"';
  const yaml = serializeProjectSpec(specification);
  assert.ok(
    yaml.startsWith(
      'schemaVersion: 1\nlanguage: "ru"\nmicrocontroller:\n  model: "ATtiny1624"\n',
    ),
  );
  assert.ok(
    yaml.includes(
      'description: "yes\\nclock: 0\\n!!js/function \\"unsafe\\""\n',
    ),
  );
  assert.ok(yaml.includes('resources:\n  -\n    id: "led"\n'));
  assert.doesNotMatch(
    yaml,
    /\b(?:baud|instance|route|txPin|rxPin|periodUs|prescaler): null/,
  );
  assert.ok(yaml.endsWith("\n"));
  const reverse = Object.fromEntries(Object.entries(specification).reverse());
  assert.equal(serializeProjectSpec(reverse), yaml);
});

test("resource schema constrains each peripheral to its applicable fields", () => {
  const gpio = resource();
  const uart = resource({ id: "serial", kind: "uart", pin: null, direction: null, instance: "USART0", route: "ALT1", txPin: "PA1", baud: 9600 });
  const timer = resource({ id: "tick", kind: "timer", pin: null, direction: null, instance: "TCA0", periodUs: 1000000, prescaler: 256 });
  for (const entry of [gpio, uart, timer, { ...timer, pin: "PB1" }]) {
    const output = generation();
    output.project.spec.resources = [entry];
    assert.equal(validateCanvasOutput(output, { canvas: canvas() }).project.spec.resources[0].kind, entry.kind);
  }
  for (const entry of [
    { ...timer, route: "SINGLE" },
    { ...timer, direction: "output" },
    { ...timer, baud: 9600 },
    { ...gpio, instance: "TCA0" },
    { ...gpio, route: "DEFAULT" },
    { ...uart, pin: "PA1" },
    { ...uart, route: "ALTERNATE" },
    { ...uart, periodUs: 1000 },
  ]) {
    const output = generation();
    output.project.spec.resources = [entry];
    assert.throws(() => validateCanvasOutput(output, { canvas: canvas() }), (error) => error instanceof CanvasContractError && error.status === 502);
    assert.throws(() => serializeProjectSpec(output.project.spec), CanvasContractError);
  }
});

test("YAML serialization selects the peripheral variant before canonical ordering", () => {
  const specification = spec();
  const timer = resource({ id: "tick", kind: "timer", pin: null, direction: null, instance: "TCA0", periodUs: 1000000, prescaler: 256 });
  specification.resources = [Object.fromEntries(Object.entries(timer).reverse())];
  const yaml = serializeProjectSpec(specification);
  assert.match(yaml, /resources:\n  -\n    id: "tick"\n    kind: "timer"\n    instance: "TCA0"\n    periodUs: 1000000\n    prescaler: 256\n/);
  assert.doesNotMatch(yaml, /\b(?:route|direction|baud|txPin|rxPin):/);
});
