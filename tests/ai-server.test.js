"use strict";

const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");

const {
  AI_SERVER_VERSION,
  createAiHttpServer,
} = require("../backend/ai-server");

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
}

test("serves safe AI status metadata and health from a separate server", async (t) => {
  const aiService = {
    authorizeAccessToken() {
      return true;
    },
    async getStatus() {
      return {
        ok: true,
        enabled: true,
        configured: false,
        accessRequired: false,
        ready: false,
        model: "gpt-5.6-terra",
        rules: { packageId: "rules-v1" },
      };
    },
  };
  const server = createAiHttpServer({
    environment: {},
    aiService,
    log: { info() {}, warn() {} },
  });
  const baseUrl = await listen(server);
  t.after(() => close(server));

  const health = await fetch(`${baseUrl}/health`);
  assert.equal(health.status, 200);
  assert.equal(await health.text(), `ok ${AI_SERVER_VERSION}\n`);

  const status = await fetch(`${baseUrl}/api/avr/ai/status`);
  assert.equal(status.status, 200);
  assert.equal(status.headers.get("cache-control"), "no-store");
  const body = await status.json();
  assert.equal(body.configured, false);
  assert.equal(body.accessRequired, false);
  assert.equal(body.model, "gpt-5.6-terra");
  assert.equal(body.rules.packageId, "rules-v1");
  assert.match(body.requestId, /^[a-f0-9-]{36}$/i);
});

test("requires JSON and does not apply legacy request or daily quotas", async (t) => {
  let generateCalls = 0;
  const aiService = {
    authorizeAccessToken(token) {
      return token === "";
    },
    async getStatus() {
      return {
        ok: true,
        enabled: true,
        configured: true,
        accessRequired: false,
        accessConfigured: false,
        rules: { packageId: "rules-v1" },
      };
    },
    async generate() {
      generateCalls += 1;
      return { ok: true };
    },
  };
  const server = createAiHttpServer({
    environment: {
      AI_RATE_REQUESTS: "1",
      AI_DAILY_LIMIT: "1",
    },
    aiService,
    log: { info() {}, warn() {} },
  });
  const baseUrl = await listen(server);
  t.after(() => close(server));

  const wrongType = await fetch(`${baseUrl}/api/avr/ai/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain",
      Origin: baseUrl,
    },
    body: "{}",
  });
  assert.equal(wrongType.status, 415);

  const invalidJson = await fetch(`${baseUrl}/api/avr/ai/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: baseUrl,
    },
    body: "{",
  });
  assert.equal(invalidJson.status, 400);
  assert.equal(generateCalls, 0);

  const validJson = await fetch(`${baseUrl}/api/avr/ai/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: baseUrl,
    },
    body: JSON.stringify({ prompt: "Blink" }),
  });
  assert.equal(validJson.status, 200);
  assert.equal(generateCalls, 1);

  const secondValidJson = await fetch(`${baseUrl}/api/avr/ai/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: baseUrl,
    },
    body: JSON.stringify({ prompt: "Blink again" }),
  });
  assert.equal(secondValidJson.status, 200);
  assert.equal(generateCalls, 2);
});

test("supports opt-in owner access and returns 413 without resetting an oversized request", async (t) => {
  const aiService = {
    authorizeAccessToken(token) {
      return token === "owner-token";
    },
    async getStatus() {
      return {
        ok: true,
        enabled: true,
        configured: true,
        accessRequired: true,
        accessConfigured: true,
        rules: { packageId: "rules-v1" },
      };
    },
    async generate() {
      return { ok: true };
    },
  };
  const server = createAiHttpServer({
    environment: { AI_REQUIRE_ACCESS_TOKEN: "1" },
    aiService,
    log: { info() {}, warn() {} },
  });
  const baseUrl = await listen(server);
  t.after(() => close(server));

  const unauthorized = await fetch(`${baseUrl}/api/avr/ai/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseUrl },
    body: JSON.stringify({ prompt: "Blink" }),
  });
  assert.equal(unauthorized.status, 401);

  const oversized = await fetch(`${baseUrl}/api/avr/ai/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: baseUrl,
      "X-UartDebug-AI-Token": "owner-token",
    },
    body: JSON.stringify({ prompt: "x".repeat(385 * 1024) }),
  });
  assert.equal(oversized.status, 413);
  assert.equal((await oversized.json()).code, "body_too_large");
});

test("keeps the concurrency safeguard without limiting sequential requests", async (t) => {
  let calls = 0;
  let markFirstStarted;
  let releaseFirst;
  const firstStarted = new Promise((resolve) => {
    markFirstStarted = resolve;
  });
  const aiService = {
    authorizeAccessToken() {
      return true;
    },
    async getStatus() {
      return {
        ok: true,
        enabled: true,
        configured: true,
        accessRequired: false,
        rules: { packageId: "rules-v1" },
      };
    },
    async respond() {
      calls += 1;
      if (calls === 1) {
        await new Promise((resolve) => {
          releaseFirst = resolve;
          markFirstStarted();
        });
      }
      return { ok: true, kind: "answer", message: "Ready" };
    },
  };
  const server = createAiHttpServer({
    environment: {
      AI_MAX_CONCURRENT: "1",
      AI_RATE_REQUESTS: "1",
      AI_DAILY_LIMIT: "1",
    },
    aiService,
    log: { info() {}, warn() {} },
  });
  const baseUrl = await listen(server);
  t.after(() => close(server));

  const post = (prompt) =>
    fetch(`${baseUrl}/api/avr/ai/respond`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: baseUrl,
      },
      body: JSON.stringify({ prompt }),
    });

  const firstRequest = post("First");
  await firstStarted;

  try {
    const concurrent = await post("Concurrent");
    assert.equal(concurrent.status, 429);
    assert.equal((await concurrent.json()).code, "ai_busy");
  } finally {
    releaseFirst();
  }
  assert.equal((await firstRequest).status, 200);

  const sequential = await post("Sequential");
  assert.equal(sequential.status, 200);
  assert.equal(calls, 2);
});

test("handles a conversational AI response through the HTTP boundary", async (t) => {
  const aiService = {
    authorizeAccessToken(token) {
      return token === "";
    },
    async getStatus() {
      return {
        ok: true,
        enabled: true,
        configured: true,
        accessRequired: false,
        accessConfigured: false,
        rules: { packageId: "rules-v1" },
      };
    },
    async respond(body) {
      assert.equal(body.prompt, "What is TCA0?");
      return {
        ok: true,
        kind: "answer",
        message: "TCA0 is a 16-bit timer/counter.",
      };
    },
  };
  const server = createAiHttpServer({
    environment: {},
    aiService,
    log: { info() {}, warn() {} },
  });
  const baseUrl = await listen(server);
  t.after(() => close(server));

  const response = await new Promise((resolve, reject) => {
    const request = http.request(
      `${baseUrl}/api/avr/ai/respond`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: baseUrl,
        },
      },
      resolve
    );
    request.on("error", reject);
    request.end(JSON.stringify({ prompt: "What is TCA0?" }));
  });
  const chunks = [];
  for await (const chunk of response) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));

  assert.equal(response.statusCode, 200);
  assert.equal(body.kind, "answer");
  assert.equal(body.message, "TCA0 is a 16-bit timer/counter.");
  assert.match(body.requestId, /^[a-f0-9-]{36}$/i);
});
