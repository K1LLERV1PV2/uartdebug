"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const {
  CANVAS_OUTPUT_SCHEMA,
  CanvasContractError,
  normalizeCanvas,
  validateCanvasOutput,
  parseProjectResources,
  codeRegions,
  validateSource,
  projectIdentity,
} = require("../backend/avr-canvas-contract");
function canvas(overrides = {}) {
  return {
    schemaVersion: 2,
    revision: 8,
    markdown:
      "# Project blink\n\nProject version - Ver.1.0\n\n## Hardware requirements\nATtiny1624, SOIC-14, PA3 LED.\n\n## Software requirements\nSet PA3 high.",
    locale: "en",
    annotations: [],
    target: { mcu: "attiny1624", packageName: "SOIC-14" },
    ...overrides,
  };
}
function annotation(overrides = {}) {
  return {
    id: "question-1",
    kind: "question",
    anchor: { quote: "PA3 LED", line: 5 },
    message: "Which pin?",
    status: "open",
    answer: "",
    ...overrides,
  };
}
function source(user = "") {
  return `// Project name: blink\n// Project version: Ver.1.0\n#include <xc.h>\n//+ Begin AI includes\n//- End AI includes\n//+ Begin AI globals\n//- End AI globals\n//+ Begin user globals\n${user}\n//- End user globals\nint main(void) {\n//+ Begin AI initialization\nPORTA.DIRSET = PIN3_bm;\n//- End AI initialization\n//+ Begin user initialization\n//- End user initialization\nwhile (1) {\n//+ Begin AI cyclic\n//- End AI cyclic\n//+ Begin user cyclic\n//- End user cyclic\n}\nreturn 0;\n}\n`;
}
function yaml() {
  return 'microcontroller:\n  model: ATtiny1624\n  package: SOIC-14\nhardware_resources: {}\nsoftware_dependencies:\n  includes:\n    - "#include <xc.h>"\n';
}
function generation() {
  return {
    action: "generate",
    message: "Code ready.",
    canvas: { markdown: canvas().markdown, locale: "en", annotations: [] },
    project: {
      title: "blink",
      summary: "GPIO output",
      version: "Ver.1.0",
      source: { name: "blink.c", content: source() },
      guide: null,
      resources: { name: "blink.yaml", content: yaml() },
    },
  };
}
const options = (operation = "generate", overrides = {}) => ({
  operation,
  canvas: canvas(),
  mcu: "attiny1624",
  packageName: "SOIC-14",
  ...overrides,
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
    authorship: {
      schemaVersion: 1,
      lines: canvas()
        .markdown.split("\n")
        .map(() => "human"),
      updatedAt: 20,
    },
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

test("the response schema keeps complete strict objects without a fixed peripheral allowlist", () => {
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
  assert.equal(
    CANVAS_OUTPUT_SCHEMA.properties.canvas.properties.annotations.maxItems,
    0,
  );
});
test("empty analysis can ask canonical inline questions without artificial seed text", () => {
  const raw = {
    action: "clarify",
    message: "Specify a project.",
    canvas: {
      markdown:
        "> ###### *[AI.1] Question.*\n>\n> What project should be developed?",
      locale: "en",
      annotations: [],
    },
    project: null,
  };
  const result = validateCanvasOutput(
    raw,
    options("analyze", {
      canvas: canvas({
        markdown: "",
        locale: "",
        target: { mcu: "", packageName: "" },
      }),
    }),
  );
  assert.match(result.canvas.markdown, /\[AI\.1\]/);
  assert.equal(result.project, null);
  assert.deepEqual(result.canvas.annotations, []);
});
test("stage boundaries prohibit generation during analysis and specification edits during generation", () => {
  assert.throws(() => validateCanvasOutput(generation(), options("analyze")));
  const edited = generation();
  edited.canvas.markdown += "\nAI changed requirements.";
  assert.throws(() => validateCanvasOutput(edited, options()));
  const raw = { ...generation(), action: "clarify", project: null };
  raw.canvas.markdown += "\nChanged before asking.";
  assert.throws(() => validateCanvasOutput(raw, options()));
});
test("generation matches name/version from the specification and exact selected hardware", () => {
  assert.equal(
    validateCanvasOutput(generation(), options()).project.source.name,
    "blink.c",
  );
  assert.deepEqual(projectIdentity("# Проект LED\nВерсия проекта - Ver.2.3"), {
    title: "LED",
    version: "Ver.2.3",
  });
  assert.equal(projectIdentity("# Project LED\nProject version - 2.3"), null);
  for (const mutate of [
    (raw) => {
      raw.project.title = "other";
    },
    (raw) => {
      raw.project.version = "Ver.9.0";
    },
    (raw) => {
      raw.project.resources.content = yaml().replace(
        "ATtiny1624",
        "ATtiny1627",
      );
    },
    (raw) => {
      raw.project.source.name = "../blink.c";
    },
    (raw) => {
      raw.project.source.name = "CON.c";
    },
    (raw) => {
      raw.canvas.locale = "ru";
    },
  ]) {
    const raw = generation();
    mutate(raw);
    assert.throws(() => validateCanvasOutput(raw, options()));
  }
});
test("resource YAML uses canonical mappings and preserves complete dependencies and extra fields", () => {
  const content =
    yaml().replace(
      "hardware_resources: {}",
      "hardware_resources:\n  ADC0:\n    mode: single",
    ) + "application:\n  note: preserved\n";
  const resources = parseProjectResources(content, {
    mcu: "attiny1624",
    packageName: "SOIC-14",
  });
  assert.equal(resources.hardware_resources.ADC0.mode, "single");
  assert.equal(resources.application.note, "preserved");
  for (const content of [
    "microcontroller: {}\nhardware_resources: {}",
    yaml().replace('"#include <xc.h>"', '"xc.h"'),
    yaml().replace("hardware_resources: {}", "hardware_resources: []"),
    yaml() + "microcontroller: {}\n",
    yaml().replace(
      "hardware_resources: {}",
      "hardware_resources: &shared {}\ncopy: *shared",
    ),
    yaml().replace("hardware_resources: {}", "hardware_resources: !unsafe {}"),
  ])
    assert.throws(() => parseProjectResources(content));
});
test("user C regions are preserved exactly; damaged, nested and temporary markers are rejected", () => {
  const previous = source("int user_counter = 2;");
  const raw = generation();
  raw.project.source.content = previous.replace(
    "PORTA.DIRSET = PIN3_bm;",
    "PORTA.DIRSET = PIN4_bm;",
  );
  assert.doesNotThrow(() =>
    validateCanvasOutput(
      raw,
      options("generate", {
        currentProject: { sourceName: "blink.c", source: previous },
      }),
    ),
  );
  raw.project.source.content = raw.project.source.content.replace(
    "user_counter = 2",
    "user_counter = 3",
  );
  assert.throws(() =>
    validateCanvasOutput(
      raw,
      options("generate", {
        currentProject: { sourceName: "blink.c", source: previous },
      }),
    ),
  );
  for (const value of [
    source().replace("//- End AI globals", "//- End other"),
    source().replace(
      "//- End AI globals",
      "//+ Begin nested\n//- End nested\n//- End AI globals",
    ),
    source() + "//X temporary instructions\n",
  ])
    assert.throws(() => validateSource(value, parseProjectResources(yaml())));
});
test("markers inside C literals and block comments are ignored and quoted includes remain usable", () => {
  const value = source(
    'const char *text = "//+ Begin fake user region\\n//- End fake user region";\n/*\n//+ Begin fake\n//- End fake\n*/',
  );
  assert.equal(codeRegions(value).length, 7);
  assert.doesNotThrow(() =>
    validateSource(value, parseProjectResources(yaml())),
  );
  const quoted = value.replace(
    "#include <xc.h>",
    '#include <xc.h>\n#include "user.h"',
  );
  const resources = parseProjectResources(yaml());
  resources.software_dependencies.includes.push('#include "user.h"');
  assert.doesNotThrow(() => validateSource(quoted, resources));
  const continued = source(
    'const char *text = "hello\\\n//+ Begin fake user region";',
  );
  assert.equal(codeRegions(continued).length, 7);
});
test("descriptions use actual C and cannot carry resource or source changes", () => {
  const raw = generation();
  raw.action = "describe";
  raw.project.source = null;
  raw.project.resources = null;
  raw.project.guide = {
    name: "blink (description).md",
    locale: "en",
    content: "# GPIO\nPA3 is configured as output.",
  };
  const opts = options("describe", {
    currentProject: {
      sourceName: "blink.c",
      source: source(),
      guideName: "blink (description).md",
      guide: "",
    },
  });
  assert.equal(
    validateCanvasOutput(raw, opts).project.guide.name,
    "blink (description).md",
  );
  assert.throws(() => validateCanvasOutput(raw, options("describe")));
  raw.project.source = generation().project.source;
  assert.throws(() => validateCanvasOutput(raw, opts));
});

test("confirmed alternative output names use one complete safe pair from the specification", () => {
  const specification = canvas().markdown.replace(
    "Project version - Ver.1.0",
    "Project version - Ver.1.0\nC program file - firmware.c\nProject resources file - allocations.yaml",
  );
  const raw = generation();
  raw.canvas.markdown = specification;
  raw.project.source.name = "firmware.c";
  raw.project.resources.name = "allocations.yaml";
  assert.doesNotThrow(() =>
    validateCanvasOutput(
      raw,
      options("generate", { canvas: canvas({ markdown: specification }) }),
    ),
  );
  for (const invalid of [
    specification.replace("\nProject resources file - allocations.yaml", ""),
    specification.replace("allocations.yaml", "../allocations.yaml"),
    specification + "\nC program file - another.c",
  ]) {
    const broken = structuredClone(raw);
    broken.canvas.markdown = invalid;
    assert.throws(() =>
      validateCanvasOutput(
        broken,
        options("generate", { canvas: canvas({ markdown: invalid }) }),
      ),
    );
  }
});

test("canonical pin declarations agree with the selected physical package without constraining unrelated resource shapes", () => {
  const device = {
    pinouts: {
      "SOIC-14": { pins: { PB1: 8, PA3: 13 } },
      "VQFN-20": { pins: { PB1: 14, PC2: 5 } },
    },
  };
  const target = { mcu: "attiny1624", packageName: "SOIC-14", device };
  const content = yaml().replace(
    "hardware_resources: {}",
    "hardware_resources:\n  gpio:\n    led:\n      pin_symbol: PB1\n      package_pin: 8\n      port: B\n      port_pin: 1\n  future_peripheral:\n    port: opaque_bus_label\n    arbitrary_modes:\n      - mode: custom\n",
  );
  assert.doesNotThrow(() => parseProjectResources(content, target));
  assert.doesNotThrow(() =>
    parseProjectResources(content.replace("port: B", "port: PORTB"), target),
  );
  assert.doesNotThrow(() =>
    parseProjectResources(
      content.replace("      package_pin: 8\n", ""),
      target,
    ),
  );
  assert.doesNotThrow(() =>
    parseProjectResources(
      content.replace("      pin_symbol: PB1\n", ""),
      target,
    ),
  );
  assert.doesNotThrow(() => parseProjectResources(yaml(), target));
  for (const invalid of [
    content.replace("pin_symbol: PB1", "pin_symbol: PC2"),
    content.replace("package_pin: 8", "package_pin: 14"),
    content.replace("port: B", "port: A"),
    content.replace("port_pin: 1", "port_pin: 3"),
    content.replace("port_pin: 1", "port_pin: 8"),
    content.replace("pin_symbol: PB1", "pin_symbol: PA3"),
  ])
    assert.throws(() => parseProjectResources(invalid, target));
  const differentPackage = content.replace(
    "package: SOIC-14",
    "package: VQFN-20",
  );
  assert.throws(() =>
    parseProjectResources(differentPackage, {
      ...target,
      packageName: "VQFN-20",
    }),
  );
  assert.doesNotThrow(() =>
    parseProjectResources(
      differentPackage.replace("package_pin: 8", "package_pin: 14"),
      { ...target, packageName: "VQFN-20" },
    ),
  );
});
