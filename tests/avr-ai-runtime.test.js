"use strict";

const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const {
  assertCompilerReady,
  verifyGeneratedProjectCompilation,
  requestOpenAi,
  requestOpenAiInputTokenCount,
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
