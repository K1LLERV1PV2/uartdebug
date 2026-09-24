"use strict";

const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");

const {
  AI_SERVER_VERSION,
  createAiHttpServer,
} = require("../backend/ai-server");
const { AiAccessError } = require("../backend/ai-access-service");
const { AiServiceError } = require("../backend/avr-ai-service");

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
        rules: { packageId: "rules-v1" }, knowledge: { corpusVersion: "pilot-v1" },
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
  assert.equal(body.knowledge.corpusVersion, "pilot-v1");
  assert.match(body.requestId, /^[a-f0-9-]{36}$/i);
});

test("retired chat generation and public skill routes return 404 without invoking services", async (t) => {
  const unexpected = () => { throw new Error("A retired route invoked a service."); };
  const server = createAiHttpServer({
    environment: {},
    aiService: { authorizeAccessToken: unexpected, getStatus: unexpected, getSkills: unexpected, respond: unexpected, generate: unexpected, processCanvas: unexpected },
    accessService: { authorizeAiRequest: unexpected },
    log: { info() {}, warn() {} },
  });
  const baseUrl = await listen(server);
  t.after(() => close(server));
  for (const [route, method] of [["respond", "POST"], ["generate", "POST"], ["skills", "GET"]]) {
    const response = await fetch(`${baseUrl}/api/avr/ai/${route}`, { method, headers: { Origin: baseUrl } });
    assert.equal(response.status, 404);
    assert.equal((await response.json()).code, "not_found");
  }
});

test("missing local knowledge fails preflight before any paid access reservation", async (t) => {
  let authorizations = 0;
  let generations = 0;
  const server = createAiHttpServer({
    environment: {},
    aiService: {
      authorizeAccessToken: () => true,
      validateRequestInput() {},
      getStatus: async () => ({ ok: false, enabled: true, configured: true, rules: { packageId: "canvas-v2" }, knowledge: null, knowledgeError: "knowledge_invalid" }),
      processCanvas: async () => { generations += 1; },
    },
    accessService: { authorizeAiRequest: async () => { authorizations += 1; } },
    log: { info() {}, warn() {} },
  });
  const baseUrl = await listen(server);
  t.after(() => close(server));
  const response = await fetch(`${baseUrl}/api/avr/ai/canvas`, {
    method: "POST", headers: { Origin: baseUrl, "Content-Type": "application/json" },
    body: JSON.stringify({ canvas: { schemaVersion: 2, revision: 0, locale: "en", markdown: "Blink PA3", annotations: [] } }),
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "knowledge_invalid");
  assert.equal(authorizations, 0);
  assert.equal(generations, 0);
});

test("redirects a failed Google callback back to the AVR assistant", async (t) => {
  const server = createAiHttpServer({
    environment: {},
    aiService: {},
    accessService: {
      async completeGoogleLogin() {
        throw new AiAccessError(
          401,
          "google_sign_in_denied",
          "Google sign-in was not completed."
        );
      },
    },
    log: { info() {}, warn() {} },
  });
  const baseUrl = await listen(server);
  t.after(() => close(server));

  const response = await fetch(
    `${baseUrl}/api/avr/ai/auth/google/callback?state=test&error=access_denied`,
    { redirect: "manual" }
  );
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(
    response.headers.get("location"),
    "/avr?ai_auth=error&ai_auth_code=google_sign_in_denied"
  );
  assert.equal(await response.text(), "");
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
        rules: { packageId: "rules-v1" }, knowledge: { corpusVersion: "pilot-v1" },
      };
    },
    async processCanvas() {
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

  const wrongType = await fetch(`${baseUrl}/api/avr/ai/canvas`, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain",
      Origin: baseUrl,
    },
    body: "{}",
  });
  assert.equal(wrongType.status, 415);

  const invalidJson = await fetch(`${baseUrl}/api/avr/ai/canvas`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: baseUrl,
    },
    body: "{",
  });
  assert.equal(invalidJson.status, 400);
  assert.equal(generateCalls, 0);

  const validJson = await fetch(`${baseUrl}/api/avr/ai/canvas`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: baseUrl,
    },
    body: JSON.stringify({ prompt: "Blink" }),
  });
  assert.equal(validJson.status, 200);
  assert.equal(generateCalls, 1);

  const secondValidJson = await fetch(`${baseUrl}/api/avr/ai/canvas`, {
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
        rules: { packageId: "rules-v1" }, knowledge: { corpusVersion: "pilot-v1" },
      };
    },
    async processCanvas() {
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

  const unauthorized = await fetch(`${baseUrl}/api/avr/ai/canvas`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseUrl },
    body: JSON.stringify({ prompt: "Blink" }),
  });
  assert.equal(unauthorized.status, 401);

  const oversized = await fetch(`${baseUrl}/api/avr/ai/canvas`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: baseUrl,
      "X-UartDebug-AI-Token": "owner-token",
    },
    body: JSON.stringify({ prompt: "x".repeat(1025 * 1024) }),
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
        rules: { packageId: "rules-v1" }, knowledge: { corpusVersion: "pilot-v1" },
      };
    },
    async processCanvas() {
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
    fetch(`${baseUrl}/api/avr/ai/canvas`, {
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

test("passes the complete canvas and its clarification through the HTTP boundary", async (t) => {
  const canvas = {
    schemaVersion: 2, revision: 2, locale: "en", markdown: "# Processes\n\nUse TCA0.\n",
    annotations: [], target: { mcu: "attiny1624", packageName: "SOIC-14" },
  };
  const annotation = {
    id: "period-question", kind: "question", anchor: { quote: "Use TCA0.", line: 3 },
    message: "What timer period is required?", status: "open", answer: "",
  };
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
        rules: { packageId: "rules-v1" }, knowledge: { corpusVersion: "pilot-v1" },
      };
    },
    async processCanvas(body) {
      assert.deepEqual(body.canvas, canvas);
      assert.equal(body.mcu, "attiny1624");
      assert.equal(body.packageName, "SOIC-14");
      return {
        ok: true,
        action: "clarify", canvas: { ...canvas, annotations: [annotation] }, project: null,
        message: "Specify the timer period on the canvas.",
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
      `${baseUrl}/api/avr/ai/canvas`,
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
    request.end(
      JSON.stringify({
        canvas, mcu: "attiny1624", packageName: "SOIC-14",
      })
    );
  });
  const chunks = [];
  for await (const chunk of response) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));

  assert.equal(response.statusCode, 200);
  assert.equal(body.action, "clarify");
  assert.deepEqual(body.canvas, { ...canvas, annotations: [annotation] });
  assert.equal(body.project, null);
  assert.equal(body.message, "Specify the timer period on the canvas.");
  assert.match(body.requestId, /^[a-f0-9-]{36}$/i);
});

test("streams progress and terminal result or error events as NDJSON", async (t) => {
  let calls = 0;
  const streamedQuota = {
    unit: "AI Credit",
    granted: 100,
    spent: 4,
    remaining: 96,
  };
  const accessService = {
    async authorizeAiRequest() {
      return { mode: "google", reservationId: "stream-reservation" };
    },
    async recordAiUsage() {
      return { quota: streamedQuota };
    },
    async releaseAiRequest() {},
  };
  const aiService = {
    authorizeAccessToken() {
      return true;
    },
    validateRequestInput() {},
    async getStatus() {
      return {
        ok: true,
        enabled: true,
        configured: true,
        accessRequired: false,
        accessConfigured: false,
        rules: { packageId: "rules-v1" }, knowledge: { corpusVersion: "pilot-v1" },
        compilerVerification: { enabled: true, ready: true },
      };
    },
    async processCanvas(body, context) {
      calls += 1;
      assert.equal(context.compilerReady, true);
      await context.onProgress({
        schemaVersion: 1,
        id: "generation",
        status: "in_progress",
        attempt: 1,
      });
      await context.onProgress({
        schemaVersion: 1,
        id: "generation",
        status: calls === 1 ? "completed" : "failed",
        attempt: 1,
      });
      if (calls === 2) {
        const error = new AiServiceError(502, "generation_failed", "Failed.");
        Object.defineProperty(error, "progress", {
          value: {
            schemaVersion: 1,
            status: "failed",
            stages: [
              { id: "generation", status: "failed", attempt: 1 },
            ],
          },
        });
        throw error;
      }
      return {
        ok: true,
        kind: "answer",
        message: `Answer: ${body.prompt}`,
        _metering: {
          provider: "openai",
          responseId: "resp_stream",
          model: "gpt-5.6-terra",
          usage: {
            inputTokens: 10,
            cachedInputTokens: 0,
            cacheWriteTokens: 0,
            outputTokens: 2,
            reasoningTokens: 0,
            totalTokens: 12,
          },
        },
      };
    },
  };
  const server = createAiHttpServer({
    environment: {},
    aiService,
    accessService,
    log: { info() {}, warn() {} },
  });
  const baseUrl = await listen(server);
  t.after(() => close(server));

  const post = async (prompt) => {
    const response = await fetch(`${baseUrl}/api/avr/ai/canvas`, {
      method: "POST",
      headers: {
        Accept: "application/x-ndjson",
        "Content-Type": "application/json",
        Origin: baseUrl,
      },
      body: JSON.stringify({ prompt }),
    });
    const events = (await response.text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    return { response, events };
  };

  const success = await post("One");
  assert.match(
    success.response.headers.get("content-type"),
    /^application\/x-ndjson/
  );
  assert.equal(success.response.headers.get("x-accel-buffering"), "no");
  assert.deepEqual(
    success.events.map((event) => event.type),
    ["progress", "progress", "result"]
  );
  assert.deepEqual(success.events[0].progress, {
    schemaVersion: 1,
    status: "in_progress",
    stages: [
      {
        id: "generation",
        status: "in_progress",
        attempt: 1,
      },
    ],
  });
  assert.equal(success.events[2].status, 200);
  assert.equal(success.events[2].data.message, "Answer: One");
  assert.deepEqual(success.events[2].data.quota, streamedQuota);
  assert.equal(success.events[2].data._metering, undefined);
  assert.match(success.events[2].data.requestId, /^[a-f0-9-]{36}$/i);

  const failure = await post("Two");
  assert.deepEqual(
    failure.events.map((event) => event.type),
    ["progress", "progress", "error"]
  );
  assert.equal(failure.events[2].status, 502);
  assert.equal(failure.events[2].data.code, "generation_failed");
  assert.equal(failure.events[2].data.progress.status, "failed");
});

test("routes Google access endpoints and records metering without exposing it", async (t) => {
  const calls = [];
  const accessContext = {
    mode: "google",
    deviceId: "device-1",
    accountId: "account-1",
    safetyIdentifier: "ud_user_deadbeef",
  };
  const metering = {
    provider: "openai",
    responseId: "resp_1",
    model: "gpt-5.6-terra",
    usage: {
      inputTokens: 10,
      cachedInputTokens: 2,
      cacheWriteTokens: 0,
      outputTokens: 3,
      reasoningTokens: 1,
      totalTokens: 13,
    },
  };
  const accessService = {
    async getPublicStatus() {
      calls.push("session");
      return {
        mode: "google",
        configured: true,
        authenticated: true,
        user: { emailMasked: "d***@example.com" },
        quota: { unit: "AI Credit", granted: 100, spent: 2, remaining: 98 },
      };
    },
    async beginGoogleLogin() {
      calls.push("start");
      return { redirectUrl: "https://accounts.google.com/o/oauth2/v2/auth" };
    },
    async completeGoogleLogin() {
      calls.push("callback");
      return { redirectUrl: "/avr?ai_auth=success" };
    },
    async logout() {
      calls.push("logout");
      return { authenticated: false };
    },
    async authorizeAiRequest() {
      calls.push("authorize");
      return accessContext;
    },
    async reserveAiBudget(context, quote) {
      calls.push("reserve");
      assert.equal(context, accessContext);
      assert.deepEqual(quote, {
        model: "gpt-5.6-terra",
        inputTokens: 10,
        maxOutputTokens: 24_000,
        minOutputTokens: 8_000,
      });
      return { maxOutputTokens: 12_000 };
    },
    async extendAiBudgetReservation(context, quote) {
      calls.push("extend");
      assert.equal(context, accessContext);
      assert.deepEqual(quote, {
        model: "gpt-5.6-terra",
        additionalInputTokens: 5,
        additionalMaxOutputTokens: 12_000,
        minAdditionalOutputTokens: 8_000,
      });
      return { additionalMaxOutputTokens: 10_000 };
    },
    async recordAiUsage(context, record) {
      calls.push("record");
      assert.equal(context, accessContext);
      assert.match(record.requestId, /^[a-f0-9-]{36}$/i);
      assert.deepEqual(
        {
          provider: record.provider,
          responseId: record.responseId,
          model: record.model,
          usage: record.usage,
        },
        metering
      );
      return {
        quota: { unit: "AI Credit", granted: 100, spent: 3, remaining: 97 },
      };
    },
    async releaseAiRequest(context, outcome) {
      calls.push("release");
      assert.equal(context, accessContext);
      assert.deepEqual(outcome, {
        providerCalled: true,
        providerRejected: false,
        usageRecorded: true,
      });
    },
  };
  const aiService = {
    authorizeAccessToken() {
      return true;
    },
    validateRequestInput() {},
    async getStatus() {
      return {
        ok: true,
        enabled: true,
        configured: true,
        accessRequired: false,
        rules: { packageId: "rules-v1" }, knowledge: { corpusVersion: "pilot-v1" },
      };
    },
    async processCanvas(body, context) {
      assert.equal(body.prompt, "Meter this");
      assert.match(context.requestId, /^[a-f0-9-]{36}$/i);
      assert.equal(context.safetyIdentifier, "ud_user_deadbeef");
      const reservation = await context.reserveBudget({
        model: "gpt-5.6-terra",
        inputTokens: 10,
        maxOutputTokens: 24_000,
        minOutputTokens: 8_000,
      });
      assert.equal(reservation.maxOutputTokens, 12_000);
      const extension = await context.extendBudget({
        model: "gpt-5.6-terra",
        additionalInputTokens: 5,
        additionalMaxOutputTokens: 12_000,
        minAdditionalOutputTokens: 8_000,
      });
      assert.equal(extension.additionalMaxOutputTokens, 10_000);
      context.markProviderCalled();
      return {
        ok: true,
        kind: "answer",
        message: "Metered",
        _metering: metering,
      };
    },
  };
  const server = createAiHttpServer({
    environment: {},
    aiService,
    accessService,
    log: { info() {}, warn() {}, error() {} },
  });
  const baseUrl = await listen(server);
  t.after(() => close(server));

  const session = await fetch(`${baseUrl}/api/avr/ai/auth/session`);
  assert.equal(session.status, 200);
  assert.equal((await session.json()).user.emailMasked, "d***@example.com");

  const start = await fetch(`${baseUrl}/api/avr/ai/auth/google/start`, {
    redirect: "manual",
  });
  assert.equal(start.status, 302);
  assert.equal(
    start.headers.get("location"),
    "https://accounts.google.com/o/oauth2/v2/auth"
  );

  const callback = await fetch(
    `${baseUrl}/api/avr/ai/auth/google/callback?state=test&code=test`,
    { headers: { "Sec-Fetch-Site": "cross-site" }, redirect: "manual" }
  );
  assert.equal(callback.status, 302);
  assert.equal(callback.headers.get("location"), "/avr?ai_auth=success");

  const logout = await fetch(`${baseUrl}/api/avr/ai/auth/logout`, {
    method: "POST",
    headers: { Origin: baseUrl },
  });
  assert.equal(logout.status, 200);
  assert.equal((await logout.json()).authenticated, false);

  const response = await fetch(`${baseUrl}/api/avr/ai/canvas`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseUrl },
    body: JSON.stringify({ prompt: "Meter this" }),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.message, "Metered");
  assert.equal(body._metering, undefined);
  assert.equal(body.quota.remaining, 97);
  assert.deepEqual(calls, [
    "session",
    "start",
    "callback",
    "logout",
    "authorize",
    "reserve",
    "extend",
    "record",
    "release",
  ]);
});

test("records provider usage when a paid AI response fails validation", async (t) => {
  const calls = [];
  const accessContext = { mode: "google", reservationId: "reservation-1" };
  const metering = {
    provider: "openai",
    responseId: "resp_invalid_paid",
    model: "gpt-5.6-terra",
    usage: {
      inputTokens: 200,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 10,
      reasoningTokens: 4,
      totalTokens: 210,
    },
  };
  const accessService = {
    async authorizeAiRequest() {
      calls.push("authorize");
      return accessContext;
    },
    async recordAiUsage(context, record) {
      calls.push("record");
      assert.equal(context, accessContext);
      assert.deepEqual(
        {
          provider: record.provider,
          responseId: record.responseId,
          model: record.model,
          usage: record.usage,
        },
        metering
      );
      return { quota: { unit: "AI Credit", remaining: 99 } };
    },
    async releaseAiRequest(context, outcome) {
      calls.push("release");
      assert.equal(context, accessContext);
      assert.deepEqual(outcome, {
        providerCalled: true,
        providerRejected: false,
        usageRecorded: true,
      });
    },
  };
  const aiService = {
    authorizeAccessToken() {
      return true;
    },
    validateRequestInput() {},
    async getStatus() {
      return {
        enabled: true,
        configured: true,
        accessRequired: false,
        rules: { packageId: "rules-v1" }, knowledge: { corpusVersion: "pilot-v1" },
      };
    },
    async processCanvas(_body, context) {
      context.markProviderCalled();
      const error = new AiServiceError(
        502,
        "invalid_ai_response",
        "The paid provider response was invalid."
      );
      Object.defineProperty(error, "_metering", { value: metering });
      Object.defineProperty(error, "progress", {
        value: {
          schemaVersion: 1,
          status: "failed",
          stages: [
            { id: "generation", status: "completed", attempt: 1 },
            { id: "compilation", status: "failed", attempt: 1 },
          ],
        },
      });
      throw error;
    },
  };
  const server = createAiHttpServer({
    environment: {},
    aiService,
    accessService,
    log: { info() {}, warn() {}, error() {} },
  });
  const baseUrl = await listen(server);
  t.after(() => close(server));

  const response = await fetch(`${baseUrl}/api/avr/ai/canvas`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseUrl },
    body: JSON.stringify({ prompt: "Return an invalid response" }),
  });
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.equal(body.code, "invalid_ai_response");
  assert.equal(body._metering, undefined);
  assert.equal(body.progress.status, "failed");
  assert.equal(body.progress.stages[1].id, "compilation");
  assert.deepEqual(calls, ["authorize", "record", "release"]);
});

test("rate limits only the technical Google OAuth start endpoint", async (t) => {
  let startCalls = 0;
  const accessService = {
    async beginGoogleLogin() {
      startCalls += 1;
      return { redirectUrl: "https://accounts.google.com/o/oauth2/v2/auth" };
    },
  };
  const aiService = {
    authorizeAccessToken() {
      return true;
    },
    async getStatus() {
      return { ok: true, enabled: true, configured: true, rules: {}, knowledge: { corpusVersion: "pilot-v1" } };
    },
  };
  const server = createAiHttpServer({
    environment: {
      AI_AUTH_START_MAX_PER_IP: "2",
      AI_AUTH_START_MAX_GLOBAL: "20",
      AI_AUTH_START_WINDOW_MS: "60000",
    },
    aiService,
    accessService,
    log: { info() {}, warn() {}, error() {} },
  });
  const baseUrl = await listen(server);
  t.after(() => close(server));

  const start = () =>
    fetch(`${baseUrl}/api/avr/ai/auth/google/start`, {
      headers: { "X-Real-IP": "203.0.113.8" },
      redirect: "manual",
    });
  assert.equal((await start()).status, 302);
  assert.equal((await start()).status, 302);
  const limited = await start();
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("retry-after"), "60");
  assert.equal((await limited.json()).code, "google_auth_rate_limited");
  assert.equal(startCalls, 2);
});

test("caps Google OAuth starts globally without calling the access service", async (t) => {
  let startCalls = 0;
  const accessService = {
    async beginGoogleLogin() {
      startCalls += 1;
      return { redirectUrl: "https://accounts.google.com/o/oauth2/v2/auth" };
    },
  };
  const aiService = {
    authorizeAccessToken() {
      return true;
    },
    async getStatus() {
      return { ok: true, enabled: true, configured: true, rules: {}, knowledge: { corpusVersion: "pilot-v1" } };
    },
  };
  const server = createAiHttpServer({
    environment: {
      AI_AUTH_START_MAX_PER_IP: "10",
      AI_AUTH_START_MAX_GLOBAL: "2",
      AI_AUTH_START_WINDOW_MS: "60000",
    },
    aiService,
    accessService,
    log: { info() {}, warn() {}, error() {} },
  });
  const baseUrl = await listen(server);
  t.after(() => close(server));

  const start = (address) =>
    fetch(`${baseUrl}/api/avr/ai/auth/google/start`, {
      headers: { "X-Real-IP": address },
      redirect: "manual",
    });
  assert.equal((await start("203.0.113.1")).status, 302);
  assert.equal((await start("203.0.113.2")).status, 302);
  const limited = await start("203.0.113.3");
  assert.equal(limited.status, 429);
  assert.equal((await limited.json()).code, "google_auth_rate_limited");
  assert.equal(startCalls, 2);
});

test("passes an explicit provider rejection to reservation cleanup", async (t) => {
  const accessContext = { mode: "google", reservationId: "reservation-rejected" };
  let releaseOutcome = null;
  const accessService = {
    async authorizeAiRequest(_req, _res, metadata) {
      assert.match(metadata.requestId, /^[a-f0-9-]{36}$/i);
      return accessContext;
    },
    async releaseAiRequest(context, outcome) {
      assert.equal(context, accessContext);
      releaseOutcome = outcome;
    },
  };
  const aiService = {
    authorizeAccessToken() {
      return true;
    },
    validateRequestInput() {},
    async getStatus() {
      return {
        enabled: true,
        configured: true,
        accessRequired: false,
        rules: { packageId: "rules-v1" }, knowledge: { corpusVersion: "pilot-v1" },
      };
    },
    async processCanvas(_body, context) {
      await context.markProviderCalled();
      const error = new AiServiceError(
        429,
        "openai_rate_limited",
        "The AI service rate limit was reached. Try again later."
      );
      Object.defineProperty(error, "_providerRejected", { value: true });
      throw error;
    },
  };
  const server = createAiHttpServer({
    environment: {},
    aiService,
    accessService,
    log: { info() {}, warn() {}, error() {} },
  });
  const baseUrl = await listen(server);
  t.after(() => close(server));

  const response = await fetch(`${baseUrl}/api/avr/ai/canvas`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseUrl },
    body: JSON.stringify({ prompt: "Retry later" }),
  });
  assert.equal(response.status, 429);
  assert.deepEqual(releaseOutcome, {
    providerCalled: true,
    providerRejected: true,
    usageRecorded: false,
  });
});

test("does not release metered provider work when a later call is rejected", async (t) => {
  const accessContext = {
    mode: "google",
    reservationId: "reservation-metered-before-rejection",
  };
  let releaseOutcome = null;
  let recordCalls = 0;
  const accessService = {
    async authorizeAiRequest() {
      return accessContext;
    },
    async recordAiUsage(context, record) {
      assert.equal(context, accessContext);
      assert.equal(record.responseId, "resp_initial_generation");
      recordCalls += 1;
      throw new Error("temporary settlement failure");
    },
    async releaseAiRequest(context, outcome) {
      assert.equal(context, accessContext);
      releaseOutcome = outcome;
    },
  };
  const aiService = {
    authorizeAccessToken() {
      return true;
    },
    validateRequestInput() {},
    async getStatus() {
      return {
        enabled: true,
        configured: true,
        accessRequired: false,
        rules: { packageId: "rules-v1" }, knowledge: { corpusVersion: "pilot-v1" },
      };
    },
    async processCanvas(_body, context) {
      await context.markProviderCalled();
      const error = new AiServiceError(
        429,
        "openai_rate_limited",
        "The repair request was rejected by the AI provider."
      );
      Object.defineProperty(error, "_providerRejected", { value: true });
      Object.defineProperty(error, "_metering", {
        value: {
          provider: "openai",
          responseId: "resp_initial_generation",
          model: "gpt-5.6-terra",
          usage: {
            inputTokens: 1000,
            cachedInputTokens: 0,
            cacheWriteTokens: 0,
            outputTokens: 200,
            reasoningTokens: 0,
            totalTokens: 1200,
          },
        },
      });
      throw error;
    },
  };
  const server = createAiHttpServer({
    environment: {},
    aiService,
    accessService,
    log: { info() {}, warn() {}, error() {} },
  });
  const baseUrl = await listen(server);
  t.after(() => close(server));

  const response = await fetch(`${baseUrl}/api/avr/ai/canvas`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseUrl },
    body: JSON.stringify({ prompt: "Repair it" }),
  });
  assert.equal(response.status, 429);
  assert.equal(recordCalls, 1);
  assert.deepEqual(releaseOutcome, {
    providerCalled: true,
    providerRejected: false,
    usageRecorded: false,
  });
});

test("leaves an uncertain repair reservation unresolved instead of partially settling it", async (t) => {
  const accessContext = {
    mode: "google",
    reservationId: "reservation-uncertain-repair",
  };
  let releaseOutcome = null;
  let recordCalls = 0;
  const accessService = {
    async authorizeAiRequest() {
      return accessContext;
    },
    async recordAiUsage() {
      recordCalls += 1;
      throw new Error("uncertain usage must not be partially recorded");
    },
    async releaseAiRequest(context, outcome) {
      assert.equal(context, accessContext);
      releaseOutcome = outcome;
    },
  };
  const aiService = {
    authorizeAccessToken() {
      return true;
    },
    validateRequestInput() {},
    async getStatus() {
      return {
        enabled: true,
        configured: true,
        accessRequired: false,
        rules: { packageId: "rules-v1" }, knowledge: { corpusVersion: "pilot-v1" },
      };
    },
    async processCanvas(_body, context) {
      await context.markProviderCalled();
      const error = new AiServiceError(
        502,
        "openai_usage_invalid",
        "The AI provider did not return valid usage information."
      );
      Object.defineProperty(error, "_usageUncertain", { value: true });
      Object.defineProperty(error, "_metering", {
        value: {
          provider: "openai",
          responseId: "resp_initial_before_repair",
          model: "gpt-5.6-terra",
          usage: {
            inputTokens: 1000,
            cachedInputTokens: 0,
            cacheWriteTokens: 0,
            outputTokens: 200,
            reasoningTokens: 0,
            totalTokens: 1200,
          },
        },
      });
      throw error;
    },
  };
  const server = createAiHttpServer({
    environment: {},
    aiService,
    accessService,
    log: { info() {}, warn() {}, error() {} },
  });
  const baseUrl = await listen(server);
  t.after(() => close(server));

  const response = await fetch(`${baseUrl}/api/avr/ai/canvas`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseUrl },
    body: JSON.stringify({ prompt: "Repair it" }),
  });
  assert.equal(response.status, 502);
  assert.equal(recordCalls, 0);
  assert.deepEqual(releaseOutcome, {
    providerCalled: true,
    providerRejected: false,
    usageRecorded: false,
  });
});

test("serves independently revisioned account workspace snapshots", async (t) => {
  const calls = [];
  const emptyRecord = (schemaVersion) => ({
    revision: 0,
    schemaVersion,
    updatedAt: null,
    data: null,
  });
  const accessService = {
    authenticateAccountWorkspaceRequest(req) {
      calls.push(["authenticate", req.method]);
      return {
        accountHash: "private-account-hash",
        accountKey: "public_account_key_12345678901234567890",
        deviceId: "device",
      };
    },
    readAccountWorkspace(context) {
      calls.push(["read", context.accountHash]);
      return {
        accountKey: context.accountKey,
        documents: {
          chats: emptyRecord(1),
          files: emptyRecord(2),
          instruction: emptyRecord(1),
        },
      };
    },
    writeAccountWorkspace(context, type, body) {
      calls.push(["write", context.accountHash, type, body.baseRevision]);
      return {
        type,
        accountKey: context.accountKey,
        document: {
          revision: body.baseRevision + 1,
          schemaVersion: body.data.schemaVersion,
          updatedAt: 123,
          data: body.data,
        },
      };
    },
  };
  const server = createAiHttpServer({
    environment: {},
    aiService: {},
    accessService,
    log: { info() {}, warn() {} },
  });
  const baseUrl = await listen(server);
  t.after(() => close(server));

  const readResponse = await fetch(
    `${baseUrl}/api/avr/ai/account/workspace`
  );
  assert.equal(readResponse.status, 200);
  const readBody = await readResponse.json();
  assert.equal(readBody.ok, true);
  assert.equal(readBody.documents.files.schemaVersion, 2);
  assert.equal(readBody.documents.instruction.revision, 0);
  assert.equal(
    readBody.accountKey,
    "public_account_key_12345678901234567890"
  );
  assert.equal("accountHash" in readBody, false);

  const instruction = {
    schemaVersion: 1,
    revision: 2,
    markdown: "# Project\n",
    skillRefs: [],
  };
  const writeResponse = await fetch(
    `${baseUrl}/api/avr/ai/account/workspace/instruction`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Origin: baseUrl,
      },
      body: JSON.stringify({
        baseRevision: 0,
        expectedAccountKey: "public_account_key_12345678901234567890",
        data: instruction,
      }),
    }
  );
  assert.equal(writeResponse.status, 200);
  const writeBody = await writeResponse.json();
  assert.equal(writeBody.ok, true);
  assert.equal(writeBody.type, "instruction");
  assert.equal(writeBody.document.revision, 1);
  assert.deepEqual(writeBody.document.data, instruction);
  assert.deepEqual(calls, [
    ["authenticate", "GET"],
    ["read", "private-account-hash"],
    ["authenticate", "PUT"],
    ["write", "private-account-hash", "instruction", 0],
  ]);
});

test("account workspace writes require same-origin JSON and preserve revision conflicts", async (t) => {
  let authenticateCalls = 0;
  let writeCalls = 0;
  const accessService = {
    authenticateAccountWorkspaceRequest() {
      authenticateCalls += 1;
      return {
        accountHash: "account",
        accountKey: "account_key_123456789012345678901234567890",
        deviceId: "device",
      };
    },
    writeAccountWorkspace() {
      writeCalls += 1;
      throw new AiAccessError(
        409,
        "account_data_revision_conflict",
        "The account workspace changed in another session."
      );
    },
  };
  const server = createAiHttpServer({
    environment: {},
    aiService: {},
    accessService,
    log: { info() {}, warn() {} },
  });
  const baseUrl = await listen(server);
  t.after(() => close(server));
  const body = JSON.stringify({
    baseRevision: 0,
    expectedAccountKey: "account_key_123456789012345678901234567890",
    data: { schemaVersion: 1, activeChatId: null, chats: [] },
  });

  const missingOrigin = await fetch(
    `${baseUrl}/api/avr/ai/account/workspace/chats`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body,
    }
  );
  assert.equal(missingOrigin.status, 403);
  assert.equal(authenticateCalls, 0);

  const wrongType = await fetch(
    `${baseUrl}/api/avr/ai/account/workspace/chats`,
    {
      method: "PUT",
      headers: { "Content-Type": "text/plain", Origin: baseUrl },
      body,
    }
  );
  assert.equal(wrongType.status, 415);
  assert.equal(authenticateCalls, 0);

  const conflict = await fetch(
    `${baseUrl}/api/avr/ai/account/workspace/chats`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body,
    }
  );
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).code, "account_data_revision_conflict");
  assert.equal(authenticateCalls, 1);
  assert.equal(writeCalls, 1);
});

test("account workspace writes reject a stale account key before persistence", async (t) => {
  let writeCalls = 0;
  const accessService = {
    authenticateAccountWorkspaceRequest() {
      return {
        accountHash: "new-account-hash",
        accountKey: "new_account_key_123456789012345678901234567890",
        deviceId: "device",
      };
    },
    writeAccountWorkspace() {
      writeCalls += 1;
      return {};
    },
  };
  const server = createAiHttpServer({
    environment: {},
    aiService: {},
    accessService,
    log: { info() {}, warn() {} },
  });
  const baseUrl = await listen(server);
  t.after(() => close(server));

  const response = await fetch(
    `${baseUrl}/api/avr/ai/account/workspace/chats`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: JSON.stringify({
        baseRevision: 0,
        expectedAccountKey: "old_account_key_123456789012345678901234567890",
        data: { schemaVersion: 1, activeChatId: null, chats: [] },
      }),
    }
  );
  assert.equal(response.status, 409);
  assert.equal(
    (await response.json()).code,
    "account_workspace_account_mismatch"
  );
  assert.equal(writeCalls, 0);
});

test("rate limits account workspace writes without spending AI credits", async (t) => {
  let writeCalls = 0;
  const accountKey = "account_key_123456789012345678901234567890";
  const accessService = {
    authenticateAccountWorkspaceRequest() {
      return { accountHash: "rate-limited-account", accountKey, deviceId: "device" };
    },
    writeAccountWorkspace(_context, type, body) {
      writeCalls += 1;
      return {
        type,
        accountKey,
        document: {
          revision: body.baseRevision + 1,
          schemaVersion: 1,
          updatedAt: 1,
          data: body.data,
        },
      };
    },
  };
  const server = createAiHttpServer({
    environment: {
      AI_ACCOUNT_WORKSPACE_WRITES_PER_ACCOUNT: "2",
      AI_ACCOUNT_WORKSPACE_WRITE_WINDOW_MS: "60000",
    },
    aiService: {},
    accessService,
    log: { info() {}, warn() {} },
  });
  const baseUrl = await listen(server);
  t.after(() => close(server));
  const save = () =>
    fetch(`${baseUrl}/api/avr/ai/account/workspace/chats`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: JSON.stringify({
        baseRevision: 0,
        expectedAccountKey: accountKey,
        data: { schemaVersion: 1, activeChatId: null, chats: [] },
      }),
    });

  assert.equal((await save()).status, 200);
  assert.equal((await save()).status, 200);
  const limited = await save();
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get("retry-after")) >= 1);
  assert.equal((await limited.json()).code, "account_workspace_rate_limited");
  assert.equal(writeCalls, 2);
});

test("account instruction HTTP body limit is enforced before persistence", async (t) => {
  let writeCalls = 0;
  const accessService = {
    authenticateAccountWorkspaceRequest() {
      return {
        accountHash: "account",
        accountKey: "account_key_123456789012345678901234567890",
        deviceId: "device",
      };
    },
    writeAccountWorkspace() {
      writeCalls += 1;
      return {};
    },
  };
  const server = createAiHttpServer({
    environment: {},
    aiService: {},
    accessService,
    log: { info() {}, warn() {} },
  });
  const baseUrl = await listen(server);
  t.after(() => close(server));
  const response = await fetch(
    `${baseUrl}/api/avr/ai/account/workspace/instruction`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: JSON.stringify({
        baseRevision: 0,
        expectedAccountKey: "account_key_123456789012345678901234567890",
        data: {
          schemaVersion: 1,
          revision: 0,
          markdown: "x".repeat(300 * 1024),
          skillRefs: [],
        },
      }),
    }
  );
  assert.equal(response.status, 413);
  assert.equal((await response.json()).code, "body_too_large");
  assert.equal(writeCalls, 0);
});
