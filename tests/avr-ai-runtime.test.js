"use strict";

const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const {
  assertCompilerReady,
  verifyGeneratedProjectCompilation,
  requestOpenAi,
  requestOpenAiInputTokenCount,
  extractOpenAiMetering,
  parseStructuredOutput,
} = require("../backend/avr-ai-runtime");
const { createCompileEnvelope, AVR_COMPILE_HEALTH_SERVICE } = require("../backend/avr-compiler-contract");

async function localServer(t, handler) {
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve, reject) => {
    server.closeAllConnections();
    server.close(error => error ? reject(error) : resolve());
  }));
  return `http://127.0.0.1:${server.address().port}`;
}

const generated = { source: { name: "main.c", content: "int main(void) { return 0; }" } };
const endpoints = [
  {
    name: "compiler readiness", timeoutCode: "compiler_health_timeout",
    run: (fetchImpl, timeoutMs) => assertCompilerReady({ compileFetchImpl: fetchImpl, healthUrl: "http://compiler/health", timeoutMs }),
    valid: createCompileEnvelope({ ok: true, service: AVR_COMPILE_HEALTH_SERVICE }),
    expected: true, malformedCode: "compiler_contract_mismatch",
  },
  {
    name: "compiler verification", timeoutCode: "compiler_timeout",
    run: (fetchImpl, timeoutMs) => verifyGeneratedProjectCompilation({
      compileFetchImpl: fetchImpl, compileUrl: "http://compiler/compile", timeoutMs, generated, mcu: "attiny1624",
    }),
    valid: createCompileEnvelope({ ok: true, mcu: "attiny1624", hex: ":00000001FF\n", hex_name: "main.hex" }),
    expected: { ok: true, compilerStage: "complete" }, malformedCode: "compiler_invalid_response",
  },
  {
    name: "OpenAI generation", timeoutCode: "openai_timeout",
    run: (fetchImpl, timeoutMs) => requestOpenAi({ fetchImpl, apiKey: "test-only", timeoutMs, requestBody: {} }),
    valid: { status: "completed", output: [] }, expected: { status: "completed", output: [] },
    malformedCode: null,
  },
  {
    name: "OpenAI input-token check", timeoutCode: "openai_token_count_timeout",
    run: (fetchImpl, timeoutMs) => requestOpenAiInputTokenCount({ fetchImpl, apiKey: "test-only", timeoutMs, requestBody: {} }),
    valid: { input_tokens: 321 }, expected: 321, malformedCode: "openai_token_count_invalid",
  },
];

for (const endpoint of endpoints) {
  test(`${endpoint.name} times out while a real HTTP response body remains incomplete`, { timeout: 5000 }, async t => {
    for (const status of [200, 503]) {
      await t.test(`HTTP ${status}`, async t => {
        const base = await localServer(t, (req, res) => {
          req.resume();
          res.writeHead(status, { "Content-Type": "application/json" });
          res.write('{"incomplete":');
        });
        let receivedHeaders = false;
        const fetchImpl = async (_url, options) => {
          const response = await fetch(base, options);
          receivedHeaders = true;
          return response;
        };
        await assert.rejects(endpoint.run(fetchImpl, 500), error =>
          error.status === 504 && error.code === endpoint.timeoutCode);
        assert.equal(receivedHeaders, true, "exercise body receipt rather than connection establishment");
      });
    }
  });
}

test("runtime requests retain successful and malformed JSON contracts and clear completed deadlines", async () => {
  for (const endpoint of endpoints) {
    let signal;
    const validFetch = async (_url, options) => {
      signal = options.signal;
      return { ok: true, status: 200, json: async () => endpoint.valid };
    };
    assert.deepEqual(await endpoint.run(validFetch, 25), endpoint.expected, endpoint.name);
    await new Promise(resolve => setTimeout(resolve, 40));
    assert.equal(signal.aborted, false, `${endpoint.name} must clear its completed deadline`);
    const malformedFetch = async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError("Unexpected token"); } });
    if (endpoint.malformedCode) {
      await assert.rejects(endpoint.run(malformedFetch, 1000), error => error.code === endpoint.malformedCode);
    } else {
      assert.equal(await endpoint.run(malformedFetch, 1000), null);
    }
  }
});

test("OpenAI HTTP error classification survives malformed response bodies", async () => {
  for (const [status, expectedCode, expectedStatus] of [
    [401, "openai_auth_failed", 503], [429, "openai_rate_limited", 429], [500, "openai_request_failed", 502],
  ]) {
    const fetchImpl = async () => ({ ok: false, status, json: async () => { throw new SyntaxError("Not JSON"); } });
    await assert.rejects(requestOpenAi({ fetchImpl, apiKey: "test-only", timeoutMs: 1000, requestBody: {} }), error => {
      assert.equal(error.status, expectedStatus);
      assert.equal(error.code, expectedCode);
      assert.equal(error._providerRejected === true, status < 500);
      return true;
    });
    await assert.rejects(requestOpenAiInputTokenCount({ fetchImpl, apiKey: "test-only", timeoutMs: 1000, requestBody: {} }), error =>
      error.status === expectedStatus && error.code === (status === 429 ? "openai_rate_limited" : "openai_token_count_failed"));
  }
});

const eventFrame = event => `data: ${JSON.stringify(event)}\r\n\r\n`;
const completed = text => ({ id: "resp_stream_test", model: "gpt-6.1-sol", status: "completed",
  output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }],
  usage: { input_tokens: 9, output_tokens: 4, total_tokens: 13 } });

test("native provider SSE delivers only a decoded top-level public message before completion", async t => {
  let release, sawPreview;
  const gate = new Promise(resolve => { release = resolve; });
  const previewArrived = new Promise(resolve => { sawPreview = resolve; });
  const prefix = '{"project":{"message":"PRIVATE NESTED CODE"},"action":"reply","message":"Hel';
  const suffix = 'lo \\"world\\"\\n\\uD83D\\uDE03 \\\\ path","canvas":null}';
  const authoritative = completed(prefix + suffix);
  const base = await localServer(t, async (req, res) => {
    req.resume();
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(eventFrame({ type: "response.reasoning_text.delta", delta: "PRIVATE REASONING" }));
    res.write(eventFrame({ type: "response.function_call_arguments.delta", delta: "PRIVATE TOOL ARGUMENTS" }));
    res.write(eventFrame({ type: "response.output_text.delta", delta: prefix }));
    await gate;
    // Both the SSE frames and JSON escapes cross arbitrary transport boundaries.
    const wire = Array.from({ length: Math.ceil(suffix.length / 3) }, (_, i) =>
      eventFrame({ type: "response.output_text.delta", delta: suffix.slice(i * 3, i * 3 + 3) })).join("");
    for (let i = 0; i < wire.length; i += 7) res.write(wire.slice(i, i + 7));
    res.end(eventFrame({ type: "response.completed", response: authoritative }));
  });
  let settled = false;
  const deltas = [], actions = [], resets = [];
  const result = requestOpenAi({ fetchImpl: (_url, init) => {
    assert.equal(JSON.parse(init.body).stream, true);
    return fetch(base, init);
  }, apiKey: "test-only", timeoutMs: 2000, requestBody: { model: "gpt-6.1-sol" },
  onMessageReset: () => resets.push("reset"), onAction: action => actions.push(action),
  onMessageDelta: delta => { deltas.push(delta); sawPreview(); } }).finally(() => { settled = true; });
  try {
    await previewArrived;
    assert.equal(settled, false);
    assert.equal(deltas.join(""), "Hel");
    assert.deepEqual(actions, ["reply"]);
  } finally { release(); }
  assert.deepEqual(await result, authoritative);
  assert.deepEqual(resets, ["reset"]);
  assert.equal(deltas.join(""), 'Hello "world"\n😃 \\ path');
  assert.doesNotMatch(deltas.join(""), /PRIVATE/);
  assert.equal(extractOpenAiMetering(authoritative, "gpt-6.1-sol", { strict: true }).usage.totalTokens, 13);
});

test("stream delivery failures do not discard authoritative usage or interrupt the provider", async t => {
  const output = completed(JSON.stringify({ action: "reply", message: "Ready", canvas: null, project: null }));
  const base = await localServer(t, (req, res) => {
    req.resume(); res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8" });
    res.end(eventFrame({ type: "response.output_text.delta", delta: output.output[0].content[0].text }) +
      eventFrame({ type: "response.completed", response: output }));
  });
  const fail = () => { throw Error("Browser disconnected"); };
  const result = await requestOpenAi({ fetchImpl: (_url, init) => fetch(base, init), apiKey: "test-only", timeoutMs: 2000,
    requestBody: {}, onMessageReset: fail, onMessageDelta: fail, onAction: fail });
  assert.deepEqual(result, output);
  assert.equal(extractOpenAiMetering(result, "gpt-6.1-sol", { strict: true }).usage.totalTokens, 13);
});

test("tool-only and terminal unsuccessful SSE preserve their envelopes without leaking reasoning", async t => {
  for (const kind of ["tool", "incomplete", "failed", "refusal"]) {
    await t.test(kind, async t => {
      const output = completed("unused");
      if (kind === "tool") output.output = [{ type: "function_call", name: "read_avr_documentation", arguments: '{"private":"tool"}' }];
      if (kind === "incomplete") { output.status = "incomplete"; output.incomplete_details = { reason: "max_output_tokens" }; }
      if (kind === "failed") { output.status = "failed"; output.error = { message: "Internal provider detail" }; }
      if (kind === "refusal") output.output[0].content = [{ type: "refusal", refusal: "Private refusal detail" }];
      const base = await localServer(t, (req, res) => {
        req.resume(); res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.end(eventFrame({ type: "response.reasoning_text.delta", delta: "PRIVATE" }) + eventFrame({
          type: `response.${output.status}`, response: output,
        }));
      });
      const deltas = [];
      const result = await requestOpenAi({ fetchImpl: (_url, init) => fetch(base, init), apiKey: "test-only", timeoutMs: 2000,
        requestBody: {}, onMessageDelta: delta => deltas.push(delta) });
      assert.deepEqual(result, output);
      assert.deepEqual(deltas, []);
      assert.equal(extractOpenAiMetering(result, "gpt-6.1-sol", { strict: true }).usage.totalTokens, 13);
      if (kind !== "tool") assert.throws(() => parseStructuredOutput(result), error =>
        error.code === ({ incomplete: "ai_output_limit_reached", failed: "ai_response_failed", refusal: "ai_refusal" })[kind]);
    });
  }
});

test("SSE requests keep the whole-body deadline and reject truncated, malformed or oversized frames", async t => {
  for (const kind of ["timeout", "truncated", "malformed", "oversized"]) {
    await t.test(kind, async t => {
      const base = await localServer(t, (req, res) => {
        req.resume(); res.writeHead(200, { "Content-Type": "text/event-stream" });
        if (kind === "timeout") res.write('data: {"type":');
        else if (kind === "truncated") res.end(eventFrame({ type: "response.output_text.delta", delta: '{"message":"Partial' }));
        else if (kind === "malformed") res.end("data: broken JSON\n\n");
        else res.end("data: " + "x".repeat(2 * 1024 * 1024 + 1) + "\n\n");
      });
      await assert.rejects(requestOpenAi({ fetchImpl: (_url, init) => fetch(base, init), apiKey: "test-only", timeoutMs: 100,
        requestBody: {}, onMessageDelta() {} }), error => error.code === (kind === "timeout" ? "openai_timeout" : "openai_stream_invalid"));
    });
  }
});

test("split UTF-8 transport and split surrogate deltas retain public text while invalid escapes never leak artifacts", async () => {
  for (const invalid of [false, true]) {
    const text = invalid ? '{"action":"reply","message":"Public prefix\\qPRIVATE ARTIFACT"}'
      : '{"action":"reply","message":"Привет 😃"}';
    const output = completed(text);
    const wire = Buffer.from(eventFrame({ type: "response.output_text.delta", delta: text }) +
      eventFrame({ type: "response.completed", response: output }));
    let offset = 0;
    const deltas = [];
    const result = await requestOpenAi({ fetchImpl: async () => new Response(new ReadableStream({
      pull(controller) {
        if (offset === wire.length) return controller.close();
        controller.enqueue(wire.subarray(offset, offset + 2)); offset = Math.min(wire.length, offset + 2);
      },
    }), { headers: { "Content-Type": "text/event-stream" } }), apiKey: "test-only", timeoutMs: 1000,
    requestBody: {}, onMessageDelta: delta => deltas.push(delta) });
    assert.equal(extractOpenAiMetering(result, "gpt-6.1-sol", { strict: true }).usage.totalTokens, 13);
    assert.equal(deltas.join(""), invalid ? "Public prefix" : "Привет 😃");
    if (invalid) assert.throws(() => parseStructuredOutput(result), error => error.code === "invalid_ai_response");
  }
});
