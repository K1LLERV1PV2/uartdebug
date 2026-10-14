"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createAvrAiService,
  normalizeRequest,
} = require("../backend/avr-ai-service");
const {
  getRuntimeConfig,
  parseStructuredOutput,
  extractOpenAiMetering,
  mergeOpenAiMetering,
} = require("../backend/avr-ai-runtime");
const {
  createCompileEnvelope,
  AVR_COMPILE_HEALTH_SERVICE,
} = require("../backend/avr-compiler-contract");
const environment = {
  AI_ENABLED: "1",
  OPENAI_API_KEY: "test-only",
  AI_COMPILE_VERIFY_ENABLED: "0",
  AI_COMPILE_MAX_REPAIR_ATTEMPTS: "0",
};
const canvas = () => ({
  schemaVersion: 2,
  revision: 7,
  markdown:
    "# Project led\n\nProject version - Ver.1.0\n\n## Hardware requirements\nATtiny1624, SOIC-14, LED PA3.\n\n## Software requirements\nSet PA3 high.",
  locale: "en",
  annotations: [],
  target: { mcu: "attiny1624", packageName: "SOIC-14" },
});
const input = (operation = "generate") => ({
  operation,
  canvas: canvas(),
  mcu: "attiny1624",
  packageName: "SOIC-14",
});
const source = (user = "") =>
  `// Project: led\n// Project version: Ver.1.0\n#include <xc.h>\n\n//+ Begin AI includes and defines\n//- End AI includes and defines\n\n//+ Begin AI global functions and variables\n//- End AI global functions and variables\n\n//+ Begin user global functions and variables\n${user}\n//- End user global functions and variables\n\nint main(void)\n{\n    //+ Begin AI local variables and initialization\n    PORTA.OUTSET = PIN3_bm;\n    PORTA.DIRSET = PIN3_bm;\n    //- End AI local variables and initialization\n\n    //+ Begin user local variables and initialization\n    //- End user local variables and initialization\n\n    while (1)\n    {\n        //+ Begin AI cyclic code\n        //- End AI cyclic code\n\n        //+ Begin user cyclic code\n        //- End user cyclic code\n    }\n    return 0;\n}\n`;
const resources = () =>
  'microcontroller:\n  model: ATtiny1624\n  package: SOIC-14\nhardware_resources:\n  led:\n    pin: PA3\n    direction: output\nsoftware_dependencies:\n  includes:\n    - "#include <xc.h>"\n';
const generated = () => ({
  action: "generate",
  message: "Code ready.",
  canvas: { markdown: canvas().markdown, locale: "en", annotations: [] },
  project: {
    title: "led",
    summary: "Sets PA3 high.",
    version: "Ver.1.0",
    source: { name: "led.c", content: source() },
    guide: null,
    resources: { name: "led.yaml", content: resources() },
  },
});
const clarify = () => ({
  action: "clarify",
  message: "Specify the LED pin.",
  canvas: { markdown: canvas().markdown, locale: "en", annotations: [] },
  project: null,
});
const knowledge = () => ({
  id: "UartDebug2",
  version: "a".repeat(40),
  repository: "Sergey-Bulanov/UartDebug2",
  manifest: { files: {} },
  initialRules: [
    "AGENTS.md",
    "Project_Rules/AGENTS_Add_On.md",
    "Project_Rules/Project_Description.md",
    "Project_Rules/Base_project_rules.md",
  ].map((path) => ({ path, text: `Canonical ${path}.` })),
  initialKnowledge: [
    {
      path: "MCU_Knowledge_Base/00_README.md",
      text: "Canonical local reading map.",
    },
  ],
  devices: [
    {
      mcu: "ATtiny1624",
      packages: ["SOIC-14"],
      pinouts: { "SOIC-14": { pins: { PA3: 13, PB1: 8 } } },
    },
  ],
  corpus: { documents: [] },
  reviewedFacts: { facts: [] },
  dfpRegisters: { devices: [] },
});
const envelope = (value) => ({
  id: "resp_test",
  model: "gpt-6.1-sol",
  status: "completed",
  output: [
    {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: JSON.stringify(value) }],
    },
  ],
  usage: { input_tokens: 120, output_tokens: 30, total_tokens: 150 },
});
const response = (value, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => value,
});
const service = (options = {}) =>
  createAvrAiService({
    environment,
    loadKnowledge: knowledge,
    resolveKnowledge: ({ mcu, packageName }) => ({
      supported: mcu === "attiny1624" && packageName === "SOIC-14",
      context: "Canonical local knowledge.",
      manifest: { id: "UartDebug2", version: "a".repeat(40), mcu, packageName },
    }),
    fetch: async () => response(envelope(generated())),
    ...options,
  });
const health = () =>
  response(
    createCompileEnvelope({ ok: true, service: AVR_COMPILE_HEALTH_SERVICE }),
  );
const compile = (ok = true, extra = {}) =>
  response(
    createCompileEnvelope(
      ok
        ? {
            ok: true,
            mcu: "attiny1624",
            hex_name: "firmware.hex",
            hex: ":00000001FF\n",
            ...extra,
          }
        : {
            ok: false,
            stage: "compile",
            stderr: "undeclared symbol",
            ...extra,
          },
    ),
    ok ? 200 : 400,
  );

test("optional access credentials remain server-side and fail closed", () => {
  const s = service({
    environment: {
      ...environment,
      AI_REQUIRE_ACCESS_TOKEN: "1",
      AI_ACCESS_TOKEN: "secret-test",
    },
  });
  assert.equal(s.authorizeAccessToken("wrong"), false);
  assert.equal(s.authorizeAccessToken("secret-test"), true);
  assert.equal(service().authorizeAccessToken(""), true);
});

test("malformed canvas and conflicting selected target fail before provider work", async () => {
  const s = service();
  for (const raw of [
    { prompt: "legacy chat" },
    { ...input(), mcu: "attiny1627" },
  ])
    await assert.rejects(s.processCanvas(raw), (e) => e.status === 400);
});

test("compiler readiness is required before any paid call", async () => {
  let calls = 0;
  const s = service({
    environment: { ...environment, AI_COMPILE_VERIFY_ENABLED: "1" },
    compileHealthFetch: async () => response({}, 503),
    fetch: async () => {
      calls++;
      return response(envelope(generated()));
    },
  });
  await assert.rejects(
    s.processCanvas(input()),
    (e) => e.code === "compiler_unavailable",
  );
  assert.equal(calls, 0);
});

test("compiler failures trigger a bounded synchronized repair and accumulate usage", async () => {
  const requests = [],
    events = [];
  let attempts = 0;
  const s = service({
    environment: {
      ...environment,
      AI_COMPILE_VERIFY_ENABLED: "1",
      AI_COMPILE_MAX_REPAIR_ATTEMPTS: "2",
    },
    compileHealthFetch: async () => health(),
    compileFetch: async (_url, r) => {
      assert.equal(JSON.parse(r.body).mcu, "attiny1624");
      return compile(++attempts > 1);
    },
    fetch: async (_url, r) => {
      requests.push(JSON.parse(r.body));
      return response(envelope(generated()));
    },
  });
  const result = await s.processCanvas(input(), {
    onProgress: (event) => events.push(event),
  });
  assert.equal(result.verification.status, "passed");
  assert.equal(result.verification.compileAttempts, 2);
  assert.equal(result.verification.repairAttempts, 1);
  assert.equal(result._metering.usage.totalTokens, 300);
  assert.equal(requests[1].tools.length, 0);
  assert.match(JSON.stringify(requests[1].input), /compilerDiagnostics/);
  assert.ok(
    events.some((e) => e.id === "compilation" && e.status === "failed"),
  );
});

test("compiler target mismatch and exhausted repairs never return a project", async () => {
  for (const [compileFetch, code] of [
    [
      async () => compile(true, { mcu: "attiny1627" }),
      "compiler_target_mismatch",
    ],
    [async () => compile(false), "generated_project_does_not_compile"],
  ]) {
    const s = service({
      environment: { ...environment, AI_COMPILE_VERIFY_ENABLED: "1" },
      compileHealthFetch: async () => health(),
      compileFetch,
    });
    await assert.rejects(
      s.processCanvas(input()),
      (e) => e.code === code && e._metering.usage.totalTokens === 150,
    );
  }
});

test("exact token count reserves budget before provider work", async () => {
  const order = [];
  const s = service({
    fetch: async (url, r) => {
      if (url.endsWith("/input_tokens")) {
        order.push("count");
        return response({ input_tokens: 1000 });
      }
      order.push("provider");
      assert.equal(JSON.parse(r.body).max_output_tokens, 9000);
      return response(envelope(generated()));
    },
  });
  await s.processCanvas(input(), {
    reserveBudget: async (quote) => {
      order.push("reserve");
      assert.equal(quote.inputTokens, 1000);
      return { maxOutputTokens: 9000 };
    },
    markProviderCalled: () => order.push("mark"),
  });
  assert.deepEqual(order, ["count", "reserve", "mark", "provider"]);
});

test("missing usage on a metered paid response is uncertain; explicit 4xx is not", async () => {
  for (const rejected of [false, true]) {
    const s = service({
      fetch: async (url) =>
        url.endsWith("/input_tokens")
          ? response({ input_tokens: 1000 })
          : rejected
            ? response({ error: {} }, 429)
            : response({ ...envelope(generated()), usage: undefined }),
    });
    await assert.rejects(
      s.processCanvas(input(), {
        reserveBudget: async () => ({ maxOutputTokens: 9000 }),
      }),
      (e) =>
        rejected
          ? e.code === "openai_rate_limited" && e._usageUncertain !== true
          : e.code === "openai_usage_invalid" && e._usageUncertain === true,
    );
  }
});

test("repair extends the reservation and retains earlier usage when the next call fails", async () => {
  let calls = 0;
  const s = service({
    environment: { ...environment, AI_COMPILE_MAX_REPAIR_ATTEMPTS: "1" },
    fetch: async (url) => {
      if (url.endsWith("/input_tokens"))
        return response({ input_tokens: 1000 });
      calls++;
      if (calls === 2) throw Error("network");
      const bad = generated();
      bad.project.resources.content = "invalid: true";
      return response(envelope(bad));
    },
  });
  let extension = 0;
  await assert.rejects(
    s.processCanvas(input(), {
      reserveBudget: async () => ({ maxOutputTokens: 9000 }),
      extendBudget: async (quote) => {
        extension++;
        assert.equal(quote.completedMetering.responseId, "resp_test");
        assert.equal(quote.completedMetering.usage.totalTokens, 150);
        return { additionalMaxOutputTokens: 9000 };
      },
    }),
    (e) => e._usageUncertain && e._metering.usage.totalTokens === 150,
  );
  assert.equal(extension, 1);
});

test("budget denial preserves the actual continuation stage and paid usage", async () => {
  for (const documentation of [true, false]) {
    const bad = generated();
    bad.project.resources.content = "invalid: true";
    const first = documentation
      ? {
          ...envelope(null),
          output: [
            {
              type: "function_call",
              name: "read_avr_documentation",
              call_id: "catalog",
              arguments: JSON.stringify({
                operation: "catalog",
                query: "",
                documentId: "",
                sectionId: "",
                page: 0,
                url: "",
                gap: "",
              }),
            },
          ],
        }
      : envelope(bad);
    const s = service({
      environment: { ...environment, AI_COMPILE_MAX_REPAIR_ATTEMPTS: "1" },
      fetch: async (url) =>
        response(
          url.endsWith("/input_tokens") ? { input_tokens: 1000 } : first,
        ),
    });
    await assert.rejects(
      s.processCanvas(input(), {
        reserveBudget: async () => ({ maxOutputTokens: 9000 }),
        extendBudget: async () => {
          throw Object.assign(
            new Error("Insufficient credits for the next AI step."),
            { status: 429, code: "free_quota_insufficient" },
          );
        },
      }),
      (error) => {
        assert.equal(error.code, "free_quota_insufficient");
        assert.equal(
          error.diagnostic.stage,
          documentation ? "documentation-continuation" : "validation-repair",
        );
        assert.equal(
          error.diagnostic.causeCode,
          documentation ? null : "invalid_generated_canvas",
        );
        assert.equal(error.diagnostic.providerCalls, 1);
        assert.equal(error._metering.usage.totalTokens, 150);
        assert.equal(error._usageUncertain, undefined);
        return true;
      },
    );
  }
});

test("unregistered tool names are rejected without side effects", async () => {
  const s = service({
    fetch: async () =>
      response({
        ...envelope(null),
        output: [
          {
            type: "function_call",
            name: "exec_shell",
            call_id: "call-bad",
            arguments: "{}",
          },
        ],
      }),
  });
  await assert.rejects(
    s.processCanvas(input()),
    (e) => e.code === "documentation_limit_reached",
  );
});

test("Responses parsing rejects refusals/incomplete JSON; accounting validates totals", () => {
  assert.deepEqual(parseStructuredOutput(envelope({ a: 1 })), { a: 1 });
  assert.throws(
    () =>
      parseStructuredOutput({
        status: "incomplete",
        incomplete_details: { reason: "max_output_tokens" },
      }),
    (e) => e.code === "ai_output_limit_reached",
  );
  assert.throws(
    () =>
      parseStructuredOutput({
        output: [
          { type: "message", content: [{ type: "refusal", refusal: "no" }] },
        ],
      }),
    (e) => e.code === "ai_refusal",
  );
  assert.throws(
    () => parseStructuredOutput({ output_text: "invalid" }),
    (e) => e.code === "invalid_ai_response",
  );
  assert.throws(
    () =>
      extractOpenAiMetering(
        {
          ...envelope({}),
          usage: { input_tokens: 1, output_tokens: 2, total_tokens: 99 },
        },
        "test",
        { strict: true },
      ),
    (e) => e.code === "openai_usage_invalid",
  );
  assert.equal(
    mergeOpenAiMetering(
      extractOpenAiMetering(envelope({})),
      extractOpenAiMetering(envelope({})),
    ).usage.totalTokens,
    300,
  );
});

test("status reports the canonical project contract and requested model", async () => {
  const status = await service().getStatus();
  assert.equal(status.ready, true);
  assert.equal(status.contract, "uartdebug-project/v2");
  assert.equal(status.model, "gpt-6.1-sol");
  assert.deepEqual(status.stages, ["analyze", "generate", "describe"]);
  assert.equal(status.externalDocumentation.enabled, false);
  assert.match(status.rules.packageId, /^UartDebug2@/);
});
test("empty specifications and empty selected project drafts reach analysis without a target or compiler", async () => {
  const raw = input("analyze");
  raw.canvas.markdown = "";
  raw.mcu = raw.canvas.target.mcu = "";
  raw.packageName = raw.canvas.target.packageName = "";
  raw.currentProject = { instanceId: "draft-1", source: "", guide: "" };
  let calls = 0;
  const result = await service({
    environment: { ...environment, AI_COMPILE_VERIFY_ENABLED: "1" },
    compileHealthFetch: async () => {
      throw Error("Analysis must not call compiler");
    },
    fetch: async (_url, request) => {
      calls++;
      const body = JSON.parse(request.body);
      assert.equal(JSON.parse(body.input[0].content).operation, "analyze");
      for (const document of knowledge().initialRules)
        assert.ok(body.instructions.includes(document.text));
      return response(
        envelope({
          ...clarify(),
          canvas: {
            markdown:
              "> ###### *[AI.1] Question.*\n>\n> What project name and version should be used?",
            locale: "en",
            annotations: [],
          },
        }),
      );
    },
  }).processCanvas(raw);
  assert.equal(calls, 1);
  assert.equal(result.kind, "canvas");
  assert.equal(result.baseRevision, 7);
  assert.equal(result.canvas.revision, 8);
  assert.deepEqual(result.canvas.annotations, []);
  assert.match(result.canvas.markdown, /\[AI\.1\]/);
});
test("generation returns only C and hidden canonical YAML while preserving the specification", async () => {
  const result = await service().processCanvas(input());
  assert.equal(result.kind, "project");
  assert.equal(result.stage, "generate");
  assert.deepEqual(
    result.project.files.map((file) => file.role),
    ["source", "specification"],
  );
  assert.equal(result.project.files[1].hidden, true);
  assert.equal(result.project.canvasName, "led.md");
  assert.equal(result.project.projectPath, "Target_Projects/led Ver.1.0");
  assert.equal(result.canvas.markdown, canvas().markdown);
  assert.equal(result.verification.hardware, "not-tested");
});
test("updates retain instance identity and existing logical output names", async () => {
  const raw = input();
  raw.currentProject = {
    instanceId: "instance-1",
    id: "existing-id",
    sourceName: "led.c",
    guideName: "led (description).md",
    source: source(),
    guide: "Existing description",
    specification: { name: "led.yaml", content: resources() },
  };
  const result = await service().processCanvas(raw);
  assert.equal(result.operation, "update");
  assert.equal(result.targetInstanceId, "instance-1");
  assert.equal(result.project.id, "existing-id");
  assert.equal(result.project.files.length, 2);
  const renamed = generated();
  renamed.project.source.name = "other.c";
  await assert.rejects(
    service({ fetch: async () => response(envelope(renamed)) }).processCanvas(
      raw,
    ),
    (error) => error.status === 502,
  );
});
test("description uses the actual current C and cannot change C, YAML or specification", async () => {
  const raw = input("describe");
  raw.currentProject = {
    instanceId: "instance-1",
    id: "existing-id",
    sourceName: "led.c",
    guideName: "led (description).md",
    source: source("int user_counter;"),
    guide: "",
  };
  const described = {
    ...generated(),
    action: "describe",
    project: {
      ...generated().project,
      source: null,
      resources: null,
      guide: {
        name: "led (description).md",
        locale: "en",
        content:
          "# LED\nThe actual code configures PA3 and preserves user_counter.",
      },
    },
  };
  const result = await service({
    environment: { ...environment, AI_COMPILE_VERIFY_ENABLED: "1" },
    compileHealthFetch: async () => {
      throw Error("Description must not compile");
    },
    fetch: async (_url, request) => {
      assert.match(JSON.parse(request.body).input[0].content, /user_counter/);
      return response(envelope(described));
    },
  }).processCanvas(raw);
  assert.equal(result.stage, "describe");
  assert.deepEqual(
    result.project.files.map((file) => file.role),
    ["guide"],
  );
  assert.equal(result.verification.status, "not-requested");
  assert.equal(result.canvas.markdown, raw.canvas.markdown);
  const drift = structuredClone(described);
  drift.project.source = generated().project.source;
  await assert.rejects(
    service({ fetch: async () => response(envelope(drift)) }).processCanvas(
      raw,
    ),
  );
});
test("missing generation identity and target clarify without spending a provider call", async () => {
  let calls = 0;
  const s = service({
    fetch: async () => {
      calls++;
      throw Error("Unexpected paid call");
    },
  });
  for (const raw of [
    { ...input(), canvas: { ...canvas(), markdown: "" } },
    {
      ...input(),
      mcu: "",
      canvas: {
        ...canvas(),
        markdown: canvas().markdown.replace(
          "ATtiny1624, SOIC-14,",
          "Unspecified target,",
        ),
        target: { mcu: "", packageName: "SOIC-14" },
      },
    },
    {
      ...input(),
      mcu: "attiny85",
      canvas: {
        ...canvas(),
        target: { mcu: "attiny85", packageName: "SOIC-14" },
      },
    },
  ]) {
    const result = await s.processCanvas(raw);
    assert.equal(result.kind, "canvas");
    assert.equal(result.canvas.markdown, raw.canvas.markdown);
  }
  assert.equal(calls, 0);
});
test("canonical guidance replaces the old artificial peripheral allowlist", async () => {
  const output = generated();
  output.project.source.content = output.project.source.content.replace(
    "PORTA.OUTSET = PIN3_bm;",
    "ADC0.CTRLA = 1;\n    TCB0.CTRLA = 1;",
  );
  const result = await service({
    fetch: async () => response(envelope(output)),
  }).processCanvas(input());
  assert.equal(result.kind, "project");
});
test("W1C read-modify-write, broken YAML and user C changes fail before compilation", async () => {
  const raw = input();
  raw.currentProject = {
    instanceId: "instance-1",
    sourceName: "led.c",
    source: source("int user_counter;"),
    guide: "",
  };
  for (const mutate of [
    (output) => {
      output.project.source.content = source("int user_counter = 4;");
    },
    (output) => {
      output.project.resources.content = "microcontroller: {}";
    },
    (output) => {
      output.project.source.content = source("int user_counter;").replace(
        "PORTA.OUTSET = PIN3_bm;",
        "TCA0.SINGLE.INTFLAGS |= 1;",
      );
    },
  ]) {
    const output = generated();
    mutate(output);
    let compilations = 0;
    await assert.rejects(
      service({
        environment: { ...environment, AI_COMPILE_VERIFY_ENABLED: "1" },
        compileHealthFetch: async () => health(),
        compileFetch: async () => {
          compilations++;
          return compile();
        },
        fetch: async () => response(envelope(output)),
      }).processCanvas(raw),
      (error) =>
        error.status === 502 && error._metering.usage.totalTokens === 150,
    );
    assert.equal(compilations, 0);
  }
});
test("tool continuation preserves local provenance and usage without network", async () => {
  let calls = 0;
  const result = await service({
    documentationFetch: async () => {
      throw Error("No network");
    },
    fetch: async (_url, request) => {
      const body = JSON.parse(request.body);
      if (++calls === 1)
        return response({
          ...envelope(null),
          output: [
            {
              type: "function_call",
              name: "read_avr_documentation",
              call_id: "catalog",
              arguments: JSON.stringify({
                operation: "catalog",
                query: "",
                documentId: "",
                sectionId: "",
                page: 0,
                url: "",
                gap: "",
              }),
            },
          ],
        });
      const tool = body.input.find(
        (item) => item.type === "function_call_output",
      );
      assert.equal(tool.call_id, "catalog");
      assert.equal(JSON.parse(tool.output).ok, true);
      return response(envelope(generated()));
    },
  }).processCanvas(input());
  assert.equal(calls, 2);
  assert.equal(result._metering.usage.totalTokens, 300);
});

test("real canonical loader supplies rules once and pins tool reads to the request snapshot", async (t) => {
  const { createMaterialsFixture } = require("./helpers/avr-materials-fixture");
  const first = createMaterialsFixture(t);
  const second = createMaterialsFixture(t, {
    "MCU_Knowledge_Base/AVR/GPIO.md":
      "# GPIO\n\nDifferent next release content.",
  });
  const liveEnvironment = { ...environment, AI_MATERIALS_ROOT: first.root };
  let calls = 0;
  const s = createAvrAiService({
    environment: liveEnvironment,
    fetch: async (_url, request) => {
      const body = JSON.parse(request.body);
      for (const [file, content] of Object.entries(first.files).filter(
        ([file]) => file === "AGENTS.md" || file.startsWith("Project_Rules/"),
      ))
        assert.equal(body.instructions.split(content).length, 2, file);
      assert.doesNotMatch(
        body.instructions,
        /SECRET_NOTE|SECRET_PROBLEM|SECRET_TEMP|SECRET_TARGET/,
      );
      if (++calls === 1) {
        liveEnvironment.AI_MATERIALS_ROOT = second.root;
        return response({
          ...envelope(null),
          output: [
            {
              type: "function_call",
              name: "read_avr_documentation",
              call_id: "gpio",
              arguments: JSON.stringify({
                operation: "read",
                documentId: "MCU_Knowledge_Base/AVR/GPIO.md",
                sectionId: "",
                page: 0,
                url: "",
                query: "DIRSET",
                gap: "",
              }),
            },
          ],
        });
      }
      const output = JSON.parse(
        body.input.find((item) => item.type === "function_call_output").output,
      );
      assert.equal(output.ok, true);
      assert.match(JSON.stringify(output), /ATOMIC_RESTORESTATE/);
      assert.doesNotMatch(JSON.stringify(output), /Different next release/);
      return response(envelope(clarify()));
    },
  });
  const result = await s.processCanvas(input("analyze"));
  assert.equal(result.kind, "canvas");
  assert.equal(calls, 2);
  assert.equal(
    result.references[0].documentId,
    "MCU_Knowledge_Base/AVR/GPIO.md",
  );
  assert.equal(
    result.references[0].sha256,
    first.manifest.files["MCU_Knowledge_Base/AVR/GPIO.md"].sha256,
  );
});

test("generation can use the unambiguous target confirmed in specification text", async () => {
  const raw = input();
  raw.mcu = raw.canvas.target.mcu = "";
  raw.packageName = raw.canvas.target.packageName = "";
  const result = await service().processCanvas(raw);
  assert.equal(result.kind, "project");
  assert.equal(result.verification.mcu, "attiny1624");
  assert.equal(result.verification.packageName, "SOIC-14");
  assert.equal(result.canvas.markdown, raw.canvas.markdown);
});

test("compiler outages do not disable specification analysis or actual-code descriptions", async () => {
  const status = await service({
    environment: { ...environment, AI_COMPILE_VERIFY_ENABLED: "1" },
    compileHealthFetch: async () => response({}, 503),
  }).getStatus();
  assert.equal(status.ready, true);
  assert.equal(status.compilerVerification.ready, false);
  assert.equal(status.compilerVerification.error, "compiler_unavailable");
});

test("GPT-6.1 Sol rejects unsupported none reasoning while retaining supported levels", () => {
  for (const model of ["gpt-6.1-sol", "gpt-6.1-sol-2026-10-01"]) {
    assert.equal(
      getRuntimeConfig({ OPENAI_MODEL: model, OPENAI_REASONING_EFFORT: "none" })
        .reasoningEffort,
      "medium",
    );
    for (const effort of ["low", "medium", "high", "xhigh", "max"]) {
      assert.equal(
        getRuntimeConfig({
          OPENAI_MODEL: model,
          OPENAI_REASONING_EFFORT: effort,
        }).reasoningEffort,
        effort,
      );
    }
  }
  assert.equal(
    getRuntimeConfig({
      OPENAI_MODEL: "gpt-5.6-terra",
      OPENAI_REASONING_EFFORT: "none",
    }).reasoningEffort,
    "none",
  );
});

test("unrestricted canonical searches retain material source provenance", async (t) => {
  const { createMaterialsFixture } = require("./helpers/avr-materials-fixture");
  const fixture = createMaterialsFixture(t);
  let calls = 0;
  const result = await createAvrAiService({
    environment: { ...environment, AI_MATERIALS_ROOT: fixture.root },
    fetch: async (_url, request) => {
      const body = JSON.parse(request.body);
      if (++calls === 1)
        return response({
          ...envelope(null),
          output: [
            {
              type: "function_call",
              name: "read_avr_documentation",
              call_id: "search",
              arguments: JSON.stringify({
                operation: "search",
                documentId: "",
                sectionId: "",
                page: 0,
                query: "ATOMIC_RESTORESTATE",
                url: "",
                gap: "",
              }),
            },
          ],
        });
      const lookup = JSON.parse(
        body.input.find((item) => item.type === "function_call_output").output,
      );
      assert.ok(lookup.materialResults.length > 0);
      return response(envelope(clarify()));
    },
  }).processCanvas(input("analyze"));
  assert.ok(
    result.references.some(
      (reference) =>
        reference.documentId === "MCU_Knowledge_Base/AVR/GPIO.md" &&
        reference.sha256 ===
          fixture.manifest.files["MCU_Knowledge_Base/AVR/GPIO.md"].sha256 &&
        reference.startLine > 0,
    ),
  );
});
test("canonical section continuations can finish beyond the old ten-step limit with metering intact", async () => {
  const material = knowledge();
  const text =
    "# Peripheral guide\n\n" +
    Array.from(
      { length: 13 },
      (_, index) =>
        `## Section ${index}\n\n${"Technical reference detail. ".repeat(330)}\n`,
    ).join("\n");
  material.documents = [
    {
      id: "MCU_Knowledge_Base/AVR/Peripheral.md",
      path: "MCU_Knowledge_Base/AVR/Peripheral.md",
      sourcePath: "MCU_Knowledge_Base/AVR/Peripheral.md",
      text,
      title: "Peripheral guide",
      kind: "reference",
      sha256: "a".repeat(64),
    },
  ];
  let providerCalls = 0,
    documentationCalls = 0;
  const result = await service({
    loadKnowledge: () => material,
    fetch: async (_url, request) => {
      const body = JSON.parse(request.body);
      providerCalls++;
      const outputs = body.input.filter(
        (item) => item.type === "function_call_output",
      );
      const previous = outputs.length
        ? JSON.parse(outputs.at(-1).output)
        : null;
      if (previous) assert.equal(previous.ok, true);
      if (previous && !previous.nextSectionId)
        return response(envelope(generated()));
      documentationCalls++;
      return response({
        ...envelope(null),
        output: [
          {
            type: "function_call",
            name: "read_avr_documentation",
            call_id: `section-${documentationCalls}`,
            arguments: JSON.stringify({
              operation: "read",
              documentId: material.documents[0].id,
              sectionId: previous?.nextSectionId || "",
              page: 0,
              query: "",
              url: "",
              gap: "",
            }),
          },
        ],
      });
    },
  }).processCanvas(input());
  assert.equal(result.kind, "project");
  assert.ok(documentationCalls > 10);
  assert.equal(result._metering.usage.totalTokens, providerCalls * 150);
  assert.ok(
    result.references.some(
      (reference) => reference.sectionTitle === "Section 12",
    ),
  );
});
test("empty description placeholders do not determine the new filename or documentation language", async () => {
  const raw = input("describe");
  raw.canvas.locale = "ru";
  raw.currentProject = {
    instanceId: "draft-1",
    sourceName: "led.c",
    source: source(),
    guideName: "Untitled project (description).md",
    guideLocale: "en",
    guide: "",
  };
  const output = {
    ...generated(),
    action: "describe",
    canvas: { ...generated().canvas, locale: "ru" },
    project: {
      ...generated().project,
      source: null,
      resources: null,
      guide: {
        name: "led (description).md",
        locale: "ru",
        content: "# Код светодиода\nPA3 настроен как выход.",
      },
    },
  };
  const result = await service({
    fetch: async () => response(envelope(output)),
  }).processCanvas(raw);
  assert.equal(result.project.files[0].name, "led (description).md");
  assert.equal(result.project.files[0].locale, "ru");
  assert.equal(result.canvas.locale, "ru");
  const wrong = structuredClone(output);
  wrong.project.guide.name = raw.currentProject.guideName;
  await assert.rejects(
    service({ fetch: async () => response(envelope(wrong)) }).processCanvas(
      raw,
    ),
  );
});
test("a nonempty selected description retains its explicit language and filename", async () => {
  const raw = input("describe");
  raw.canvas.locale = "ru";
  raw.currentProject = {
    instanceId: "existing-1",
    sourceName: "led.c",
    source: source(),
    guideName: "led (en).md",
    guideLocale: "en",
    guide: "Existing English description.",
  };
  const output = {
    ...generated(),
    action: "describe",
    canvas: { ...generated().canvas, locale: "ru" },
    project: {
      ...generated().project,
      source: null,
      resources: null,
      guide: {
        name: "led (en).md",
        locale: "en",
        content: "# LED\nPA3 is configured as output.",
      },
    },
  };
  const result = await service({
    fetch: async (_url, request) => {
      assert.equal(
        JSON.parse(JSON.parse(request.body).input[0].content).currentProject
          .guideLocale,
        "en",
      );
      return response(envelope(output));
    },
  }).processCanvas(raw);
  assert.equal(result.project.files[0].locale, "en");
  const wrong = structuredClone(output);
  wrong.project.guide.locale = "ru";
  await assert.rejects(
    service({ fetch: async () => response(envelope(wrong)) }).processCanvas(
      raw,
    ),
  );
});

test("generation checks canonical physical pin claims before compiler work", async () => {
  const invalid = generated();
  invalid.project.resources.content = resources().replace(
    "    pin: PA3",
    "    pin_symbol: PB1\n    package_pin: 14\n    port: B\n    port_pin: 1",
  );
  let compilations = 0;
  await assert.rejects(
    service({
      environment: { ...environment, AI_COMPILE_VERIFY_ENABLED: "1" },
      compileHealthFetch: async () => health(),
      compileFetch: async () => {
        compilations++;
        return compile();
      },
      fetch: async () => response(envelope(invalid)),
    }).processCanvas(input()),
    (error) => error.status === 502 && /package_pin/.test(error.message),
  );
  assert.equal(compilations, 0);
});
