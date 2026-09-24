"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createAvrAiService,
  AiServiceError,
} = require("../backend/avr-ai-service");
const {
  parseStructuredOutput,
  extractOpenAiMetering,
  mergeOpenAiMetering,
} = require("../backend/avr-ai-runtime");
const {
  createCompileEnvelope,
  AVR_COMPILE_HEALTH_SERVICE,
} = require("../backend/avr-compiler-contract");
const { DOCUMENT_ROOTS } = require("../backend/avr-documentation-lookup");
const environment = {
  AI_ENABLED: "1",
  OPENAI_API_KEY: "test-only",
  AI_COMPILE_VERIFY_ENABLED: "0",
  AI_COMPILE_MAX_REPAIR_ATTEMPTS: "0",
};
const input = () => ({
  canvas: {
    schemaVersion: 2,
    revision: 7,
    markdown: "# LED\nSet PA3 high.",
    locale: "en",
    annotations: [],
    target: { mcu: "attiny1624", packageName: "SOIC-14" },
  },
  mcu: "attiny1624",
  packageName: "SOIC-14",
});
const resource = () => ({
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
  description: "LED output",
});
const generated = () => ({
  action: "generate",
  message: "Project ready.",
  canvas: { markdown: input().canvas.markdown, locale: "en", annotations: [] },
  project: {
    title: "LED",
    summary: "Sets PA3 high.",
    version: "1.0.0",
    source: {
      name: "led.c",
      content:
        "#define F_CPU 3333333UL\n#include <xc.h>\n//# LED\nint main(void) { PORTA.OUTSET = PIN3_bm; PORTA.DIRSET = PIN3_bm; for (;;) {} }\n",
    },
    guide: {
      name: "led.md",
      locale: "en",
      content:
        "# LED\nConnect the LED to PA3 through a suitable resistor.\n<!-- uartdebug:verification -->\n",
      verificationMessages: {
        passed: "Compiled successfully with XC8 for the selected target.",
        skipped: "Compiler verification was skipped.",
        hardwareNotTested: "Physical hardware has not been tested.",
      },
    },
    spec: {
      schemaVersion: 1,
      language: "en",
      microcontroller: { model: "ATtiny1624", package: "SOIC-14" },
      clock: { hz: 3333333 },
      resources: [resource()],
      includes: ["xc.h"],
      description: "Set PA3 high.",
    },
  },
});
const clarify = () => ({
  action: "clarify",
  message: "Specify the LED pin.",
  canvas: {
    markdown: input().canvas.markdown,
    locale: "en",
    annotations: [
      {
        id: "pin",
        kind: "question",
        anchor: { quote: "LED", line: 1 },
        message: "Which pin?",
        status: "open",
        answer: "",
      },
    ],
  },
  project: null,
});
const envelope = (value) => ({
  id: "resp_test",
  model: "gpt-5.6-terra",
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

test("status advertises local target/packages and no legacy skill catalog", async () => {
  const s = service();
  const status = await s.getStatus();
  assert.equal(status.ready, true);
  assert.equal(status.contract, "uartdebug-canvas/v1");
  assert.equal(status.knowledge.devices.length, 3);
  assert.equal(status.rules.packageId, "uartdebug-canvas-2026-09-24.1");
  assert.equal(s.getSkills, undefined);
  assert.equal(
    (await service({ environment: {} }).getStatus()).configured,
    false,
  );
});
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
test("missing/unsupported targets return canvas annotations without provider or compiler work", async () => {
  let calls = 0;
  const s = service({
    fetch: async () => {
      calls++;
      throw Error("unexpected");
    },
  });
  const missing = input();
  missing.packageName = "";
  missing.canvas.target.packageName = "";
  assert.equal((await s.processCanvas(missing)).kind, "canvas");
  const unsupported = input();
  unsupported.mcu = unsupported.canvas.target.mcu = "attiny85";
  assert.equal(
    (await s.processCanvas(unsupported)).canvas.annotations[0].kind,
    "error",
  );
  assert.equal(calls, 0);
});
test("malformed canvas and conflicting selected target fail before provider work", async () => {
  const s = service();
  for (const raw of [
    { prompt: "legacy chat" },
    { ...input(), mcu: "attiny1627" },
  ])
    await assert.rejects(s.processCanvas(raw), (e) => e.status === 400);
});
test("clarification edits the same revisioned canvas without creating files", async () => {
  const result = await service({
    fetch: async () => response(envelope(clarify())),
  }).processCanvas(input());
  assert.equal(result.kind, "canvas");
  assert.equal(result.baseRevision, 7);
  assert.equal(result.canvas.revision, 8);
  assert.equal(result.canvas.annotations[0].id, "pin");
  assert.equal(result.project, undefined);
  assert.equal(result._metering.usage.totalTokens, 150);
});
test("generation returns C, localized guide and server-serialized YAML in one project", async () => {
  let body;
  const result = await service({
    fetch: async (_url, request) => {
      body = JSON.parse(request.body);
      return response(envelope(generated()));
    },
  }).processCanvas(input());
  assert.equal(result.kind, "project");
  assert.equal(result.operation, "create");
  assert.deepEqual(
    result.project.files.map((f) => f.role),
    ["source", "guide", "specification"],
  );
  assert.match(result.project.files[2].content, /PA3/);
  assert.equal(result.project.aiSpecRef, undefined);
  assert.equal(result.verification.hardware, "not-tested");
  assert.equal(body.store, false);
  assert.equal(body.text.format.strict, true);
  assert.match(body.instructions, /local knowledge/i);
  assert.equal(body.input.length, 1);
  assert.equal(body.tools[0].name, "read_avr_documentation");
});
test("updates preserve project identity, source/guide/YAML names and locale", async () => {
  const raw = input();
  raw.currentProject = {
    instanceId: "instance-1",
    id: "original-id",
    sourceName: "led.c",
    guideName: "led.md",
    source: generated().project.source.content,
    guide: generated().project.guide.content,
    specification: { name: "hardware.yaml", content: "schemaVersion: 1" },
  };
  const result = await service().processCanvas(raw);
  assert.equal(result.operation, "update");
  assert.equal(result.targetInstanceId, "instance-1");
  assert.equal(result.project.id, "original-id");
  assert.equal(result.project.files[2].name, "hardware.yaml");
  const renamed = generated();
  renamed.project.source.name = "different.c";
  await assert.rejects(
    service({ fetch: async () => response(envelope(renamed)) }).processCanvas(
      raw,
    ),
    (e) => e.status === 502,
  );
});
test("resource conflicts, clock mismatch and unsafe W1C writes are blocked before compile", async () => {
  for (const mutate of [
    (p) => p.spec.resources.push({ ...resource(), id: "second" }),
    (p) => (p.spec.clock.hz = 20000000),
    (p) =>
      (p.source.content += "\nvoid bad(void) { TCA0.SINGLE.INTFLAGS |= 1; }"),
  ]) {
    const data = generated();
    mutate(data.project);
    let compileCalls = 0;
    const s = service({
      fetch: async () => response(envelope(data)),
      compileFetch: async () => {
        compileCalls++;
        return compile();
      },
    });
    await assert.rejects(
      s.processCanvas(input()),
      (e) => e.status === 502 && e._metering.usage.totalTokens === 150,
    );
    assert.equal(compileCalls, 0);
  }
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
      bad.project.spec.resources[0].pin = "PA0";
      return response(envelope(bad));
    },
  });
  let extension = 0;
  await assert.rejects(
    s.processCanvas(input(), {
      reserveBudget: async () => ({ maxOutputTokens: 9000 }),
      extendBudget: async () => {
        extension++;
        return { additionalMaxOutputTokens: 9000 };
      },
    }),
    (e) => e._usageUncertain && e._metering.usage.totalTokens === 150,
  );
  assert.equal(extension, 1);
});
test("documentation function results continue Responses with prior output and same budget accounting", async () => {
  let calls = 0,
    web = 0;
  const requests = [];
  const s = service({
    environment: { ...environment, AI_EXTERNAL_DOCUMENTATION_ENABLED: "0" },
    documentationFetch: async () => {
      web++;
      throw Error("external disabled");
    },
    fetch: async (_url, r) => {
      requests.push(JSON.parse(r.body));
      calls++;
      return response(
        calls === 1
          ? {
              ...envelope(null),
              output: [
                {
                  type: "function_call",
                  name: "read_avr_documentation",
                  call_id: "call-doc",
                  arguments: JSON.stringify({
                    url: DOCUMENT_ROOTS[0] + "index.html",
                    query: "USART BAUD",
                    gap: "Need the missing register details for this mode.",
                  }),
                },
              ],
            }
          : envelope(clarify()),
      );
    },
  });
  const result = await s.processCanvas(input());
  assert.equal(result.kind, "canvas");
  assert.equal(result._metering.usage.totalTokens, 300);
  assert.equal(web, 0);
  assert.ok(
    requests[1].input.some(
      (item) =>
        item.type === "function_call_output" && item.call_id === "call-doc",
    ),
  );
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

test("a malformed clarification can be repaired into a valid question without forced generation", async () => {
  let calls = 0;
  const bad = clarify();
  bad.canvas.annotations[0].anchor.quote = "absent quote";
  const result = await service({
    environment: { ...environment, AI_COMPILE_MAX_REPAIR_ATTEMPTS: "1" },
    fetch: async () => response(envelope(++calls === 1 ? bad : clarify())),
  }).processCanvas(input());
  assert.equal(result.kind, "canvas");
  assert.equal(calls, 2);
  assert.equal(result.canvas.annotations[0].kind, "question");
});
test("normalized resource specification is the one serialized to YAML", async () => {
  const result = await service({
    validateProjectSpec: (spec) => ({
      valid: true,
      errors: [],
      warnings: [],
      normalized: { ...spec, description: "Canonical resource specification" },
    }),
  }).processCanvas(input());
  assert.match(
    result.project.files[2].content,
    /Canonical resource specification/,
  );
});

test("non-ASCII source names still receive a valid browser project identifier", async () => {
  const output = generated();
  output.project.source.name = "Светодиод.c";
  const result = await service({
    fetch: async () => response(envelope(output)),
  }).processCanvas(input());
  assert.match(result.project.id, /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/);
});

test("the server renders verification only after compilation and hides internal templates", async () => {
  for (const enabled of [false, true]) {
    const result = await service({
      environment: {
        ...environment,
        AI_COMPILE_VERIFY_ENABLED: enabled ? "1" : "0",
      },
      compileHealthFetch: async () => health(),
      compileFetch: async () => compile(),
    }).processCanvas(input());
    const guide = result.project.files.find((file) => file.role === "guide");
    assert.match(
      guide.content,
      enabled
        ? /Compiled successfully with XC8/
        : /Compiler verification was skipped/,
    );
    assert.match(guide.content, /Physical hardware has not been tested/);
    assert.doesNotMatch(guide.content, /uartdebug:verification/);
    assert.equal(guide.verificationMessages, undefined);
  }
});

test("timing verification distinguishes microseconds from milliseconds", async () => {
  const output = generated();
  output.project.source.content = output.project.source.content.replace(
    "3333333UL",
    "20000000UL",
  );
  output.project.spec.clock.hz = 20000000;
  output.project.spec.resources.push({
    ...resource(),
    id: "tick",
    kind: "timer",
    pin: null,
    direction: null,
    instance: "TCA0",
    periodUs: 500000,
    prescaler: 256,
  });
  const result = await service({
    fetch: async () => response(envelope(output)),
  }).processCanvas(input());
  const timing = result.verification.calculations[0];
  assert.equal(timing.per, 39062);
  assert.equal(timing.actualPeriodUs, 500006.4);
  assert.ok(Math.abs(timing.actualPeriodMs - 500.0064) < 1e-9);
});
