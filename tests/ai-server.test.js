"use strict";

const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");

const {
  AI_SERVER_VERSION,
  createAiHttpServer,
  takeRateLimit,
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
  assert.equal(body.model, "gpt-5.6-terra");
  assert.equal(body.rules.packageId, "rules-v1");
  assert.match(body.requestId, /^[a-f0-9-]{36}$/i);
});

test("requires JSON and never sends a malformed request to the AI service", async (t) => {
  let generateCalls = 0;
  const aiService = {
    authorizeAccessToken(token) {
      return token === "owner-token";
    },
    async getStatus() {
      return {
        ok: true,
        enabled: true,
        configured: true,
        accessConfigured: true,
        rules: { packageId: "rules-v1" },
      };
    },
    async generate() {
      generateCalls += 1;
      return { ok: true };
    },
  };
  const server = createAiHttpServer({
    environment: { AI_DAILY_LIMIT: "1" },
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
      "X-UartDebug-AI-Token": "owner-token",
    },
    body: "{}",
  });
  assert.equal(wrongType.status, 415);

  const invalidJson = await fetch(`${baseUrl}/api/avr/ai/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: baseUrl,
      "X-UartDebug-AI-Token": "owner-token",
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
      "X-UartDebug-AI-Token": "owner-token",
    },
    body: JSON.stringify({ prompt: "Blink" }),
  });
  assert.equal(validJson.status, 200);
  assert.equal(generateCalls, 1);
});

test("requires owner access and returns 413 without resetting an oversized request", async (t) => {
  const aiService = {
    authorizeAccessToken(token) {
      return token === "owner-token";
    },
    async getStatus() {
      return {
        ok: true,
        enabled: true,
        configured: true,
        accessConfigured: true,
        rules: { packageId: "rules-v1" },
      };
    },
    async generate() {
      return { ok: true };
    },
  };
  const server = createAiHttpServer({
    environment: {},
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

test("enforces both per-client and daily generation limits", () => {
  const rateBuckets = new Map();
  let dailyBucket = { key: "2026-07-23", count: 0 };
  const base = Date.parse("2026-07-23T12:00:00.000Z");

  for (let index = 0; index < 2; index += 1) {
    const result = takeRateLimit({
      clientKey: "client-a",
      now: base,
      rateBuckets,
      windowMs: 60000,
      requestsPerWindow: 2,
      dailyBucket,
      dailyLimit: 3,
    });
    assert.equal(result.allowed, true);
    dailyBucket = result.dailyBucket;
  }

  const perClient = takeRateLimit({
    clientKey: "client-a",
    now: base,
    rateBuckets,
    windowMs: 60000,
    requestsPerWindow: 2,
    dailyBucket,
    dailyLimit: 3,
  });
  assert.equal(perClient.allowed, false);
  assert.equal(perClient.code, "rate_limit_reached");

  const differentClient = takeRateLimit({
    clientKey: "client-b",
    now: base,
    rateBuckets,
    windowMs: 60000,
    requestsPerWindow: 2,
    dailyBucket,
    dailyLimit: 3,
  });
  assert.equal(differentClient.allowed, true);
  dailyBucket = differentClient.dailyBucket;

  const daily = takeRateLimit({
    clientKey: "client-c",
    now: base,
    rateBuckets,
    windowMs: 60000,
    requestsPerWindow: 2,
    dailyBucket,
    dailyLimit: 3,
  });
  assert.equal(daily.allowed, false);
  assert.equal(daily.code, "daily_limit_reached");
});

test("handles an AI generation response through the HTTP boundary", async (t) => {
  const aiService = {
    authorizeAccessToken(token) {
      return token === "owner-token";
    },
    async getStatus() {
      return {
        ok: true,
        enabled: true,
        configured: true,
        accessConfigured: true,
        rules: { packageId: "rules-v1" },
      };
    },
    async generate(body) {
      assert.equal(body.prompt, "Blink");
      return { ok: true, project: { id: "generated-1" } };
    },
  };
  const server = createAiHttpServer({
    environment: { AI_RATE_REQUESTS: "10", AI_DAILY_LIMIT: "10" },
    aiService,
    log: { info() {}, warn() {} },
  });
  const baseUrl = await listen(server);
  t.after(() => close(server));

  const response = await new Promise((resolve, reject) => {
    const request = http.request(
      `${baseUrl}/api/avr/ai/generate`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: baseUrl,
          "X-UartDebug-AI-Token": "owner-token",
        },
      },
      resolve
    );
    request.on("error", reject);
    request.end(JSON.stringify({ prompt: "Blink" }));
  });
  const chunks = [];
  for await (const chunk of response) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));

  assert.equal(response.statusCode, 200);
  assert.equal(body.project.id, "generated-1");
  assert.match(body.requestId, /^[a-f0-9-]{36}$/i);
});
