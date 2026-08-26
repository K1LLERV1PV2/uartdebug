"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  ACCOUNT_WORKSPACE_MAX_BYTES,
  AI_ACCESS_SCHEMA_VERSION,
  AiAccessError,
  CREDIT_NANO_USD,
  DEVICE_COOKIE,
  INSTALLATION_SECRET_HEADER,
  LONG_CONTEXT_THRESHOLD,
  MODEL_PRICES,
  SESSION_COOKIE,
  calculateUsageCostNanoUsd,
  createAiAccessService,
} = require("../backend/ai-access-service");

class MockResponse {
  constructor() {
    this.headers = new Map();
    this.statusCode = 200;
    this.writableEnded = false;
    this.body = "";
  }

  setHeader(name, value) {
    this.headers.set(String(name).toLowerCase(), value);
  }

  getHeader(name) {
    return this.headers.get(String(name).toLowerCase());
  }

  end(body = "") {
    this.body = String(body || "");
    this.writableEnded = true;
  }
}

class MockOAuthClient {
  constructor() {
    this.authorizationRequests = [];
    this.identities = new Map();
    this.verifyCalls = [];
    this.tokenCalls = [];
  }

  generateAuthUrl(options) {
    this.authorizationRequests.push({ ...options });
    const url = new URL("https://accounts.google.test/o/oauth2/v2/auth");
    url.searchParams.set("state", options.state);
    url.searchParams.set("nonce", options.nonce);
    url.searchParams.set("code_challenge", options.code_challenge);
    url.searchParams.set("code_challenge_method", options.code_challenge_method);
    return url.toString();
  }

  setIdentity(code, identity) {
    const authorization = this.authorizationRequests.at(-1);
    this.identities.set(code, {
      ...identity,
      nonce: authorization.nonce,
    });
  }

  async getToken(options) {
    this.tokenCalls.push({ ...options });
    if (!this.identities.has(options.code)) throw new Error("unknown code");
    return {
      tokens: {
        id_token: `raw-id-token-${options.code}`,
        access_token: `raw-access-token-${options.code}`,
        refresh_token: `raw-refresh-token-${options.code}`,
      },
    };
  }

  async verifyIdToken(options) {
    this.verifyCalls.push({ ...options });
    const code = String(options.idToken).replace("raw-id-token-", "");
    const payload = this.identities.get(code);
    if (!payload) throw new Error("unknown token");
    return { getPayload: () => ({ ...payload }) };
  }
}

function makeService(options = {}) {
  const oauthClient = options.oauthClient || new MockOAuthClient();
  const service = createAiAccessService({
    environment: {},
    googleAuthRequired: true,
    googleClientId: "google-client-id.apps.googleusercontent.com",
    googleClientSecret: "google-client-secret",
    identitySecret: "identity-secret-for-tests-0123456789abcdef",
    sessionSecret: "session-secret-for-tests--0123456789abcdef",
    publicBaseUrl: "https://uartdebug.test",
    databasePath: ":memory:",
    allowInMemoryDatabaseForTests: true,
    freeDeviceGrantCredits: "10",
    oauthClient,
    now: () => 1_800_000_000_000,
    ...options,
  });
  return { service, oauthClient };
}

function request(cookie = "", headers = {}) {
  return {
    headers: {
      ...(cookie ? { cookie } : {}),
      ...headers,
    },
  };
}

function setCookies(response) {
  const value = response.getHeader("set-cookie");
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function cookieHeader(response) {
  return setCookies(response)
    .map((cookie) => cookie.split(";", 1)[0])
    .join("; ");
}

function cookieValue(response, name) {
  const prefix = `${name}=`;
  const cookie = setCookies(response).find((item) => item.startsWith(prefix));
  return cookie ? cookie.slice(prefix.length).split(";", 1)[0] : "";
}

async function signIn(service, oauthClient, { cookie = "", code, sub, email }) {
  const startResponse = new MockResponse();
  const start = await service.beginGoogleLogin(request(cookie), startResponse);
  assert.equal(startResponse.statusCode, 302);
  const state = new URL(start.redirectUrl).searchParams.get("state");
  oauthClient.setIdentity(code, {
    sub,
    email,
    email_verified: true,
  });
  const callbackResponse = new MockResponse();
  await service.completeGoogleLogin(
    request(cookieHeader(startResponse)),
    callbackResponse,
    `https://uartdebug.test/api/avr/ai/auth/google/callback?state=${encodeURIComponent(
      state
    )}&code=${encodeURIComponent(code)}`
  );
  assert.equal(callbackResponse.statusCode, 302);
  return {
    cookie: cookieHeader(callbackResponse),
    callbackResponse,
    startResponse,
  };
}

test("public mode authorizes without Google or persistent identity configuration", async (t) => {
  const service = createAiAccessService({ environment: {}, databasePath: ":memory:" });
  t.after(() => service.close());

  const context = await service.authorizeAiRequest(request(), new MockResponse());
  assert.equal(context.authorized, true);
  assert.equal(context.mode, "public");

  const response = new MockResponse();
  const status = await service.getPublicStatus(request(), response);
  assert.equal(response.statusCode, 200);
  assert.equal(status.mode, "public");
  assert.equal(status.authRequired, false);
  assert.equal(status.authenticated, false);
  assert.equal(status.configured, true);
});

test("Google login uses state, nonce, PKCE and secure host-only cookies", async (t) => {
  const { service, oauthClient } = makeService();
  t.after(() => service.close());

  const login = await signIn(service, oauthClient, {
    code: "first-code",
    sub: "raw-google-subject-123",
    email: "person@example.com",
  });
  const startCookie = setCookies(login.startResponse).find((cookie) =>
    cookie.startsWith(`${DEVICE_COOKIE}=`)
  );
  const sessionCookie = setCookies(login.callbackResponse).find((cookie) =>
    cookie.startsWith(`${SESSION_COOKIE}=`)
  );
  for (const cookie of [startCookie, sessionCookie]) {
    assert.match(cookie, /; Path=\//);
    assert.match(cookie, /; HttpOnly/);
    assert.match(cookie, /; Secure/);
    assert.match(cookie, /; SameSite=Lax/);
    assert.doesNotMatch(cookie, /; Domain=/i);
  }
  assert.equal(oauthClient.authorizationRequests[0].code_challenge_method, "S256");
  assert.match(oauthClient.authorizationRequests[0].code_challenge, /^[\w-]{43}$/);
  assert.ok(oauthClient.authorizationRequests[0].nonce);
  assert.ok(oauthClient.authorizationRequests[0].state);
  assert.equal(
    oauthClient.verifyCalls[0].audience,
    "google-client-id.apps.googleusercontent.com"
  );
  assert.ok(oauthClient.tokenCalls[0].codeVerifier);

  const account = service.database
    .prepare("SELECT account_hash, masked_email FROM google_accounts")
    .get();
  assert.notEqual(account.account_hash, "raw-google-subject-123");
  assert.equal(account.masked_email, "p***@e***.com");
  const storedSession = service.database
    .prepare("SELECT session_hash FROM auth_sessions")
    .get();
  assert.notEqual(
    storedSession.session_hash,
    cookieValue(login.callbackResponse, SESSION_COOKIE)
  );
  const serializedRows = JSON.stringify({
    account,
    storedSession,
    oauth: service.database.prepare("SELECT * FROM oauth_transactions").all(),
  });
  assert.doesNotMatch(serializedRows, /raw-(?:id|access|refresh)-token/);
  assert.doesNotMatch(serializedRows, /raw-google-subject-123/);
});

test("Google login returns JSON for same-origin fetch while setting device identity", async (t) => {
  const { service } = makeService();
  t.after(() => service.close());
  const response = new MockResponse();
  const result = await service.beginGoogleLogin(
    request("", {
      accept: "application/json",
      [INSTALLATION_SECRET_HEADER]: "json-login-installation-secret",
    }),
    response
  );
  assert.equal(response.statusCode, 200);
  assert.equal(response.getHeader("location"), undefined);
  assert.equal(JSON.parse(response.body).redirectUrl, result.redirectUrl);
  assert.match(result.redirectUrl, /^https:\/\/accounts\.google\.test\//);
  assert.ok(cookieValue(response, DEVICE_COOKIE));
  assert.equal(
    service.database
      .prepare("SELECT COUNT(*) AS count FROM installation_aliases")
      .get().count,
    1
  );
});

test("Google callback is bound to the signed device cookie before token exchange", async (t) => {
  const { service, oauthClient } = makeService();
  t.after(() => service.close());
  const startResponse = new MockResponse();
  const start = await service.beginGoogleLogin(request(), startResponse);
  const state = new URL(start.redirectUrl).searchParams.get("state");
  oauthClient.setIdentity("stolen-code", {
    sub: "stolen-flow-subject",
    email: "stolen@example.com",
    email_verified: true,
  });

  await assert.rejects(
    service.completeGoogleLogin(
      request(),
      new MockResponse(),
      `https://uartdebug.test/api/avr/ai/auth/google/callback?state=${encodeURIComponent(
        state
      )}&code=stolen-code`
    ),
    (error) =>
      error instanceof AiAccessError &&
      error.status === 400 &&
      error.code === "oauth_device_mismatch"
  );
  assert.equal(oauthClient.tokenCalls.length, 0);
  assert.equal(
    service.database
      .prepare("SELECT COUNT(*) AS count FROM oauth_transactions")
      .get().count,
    1
  );
  assert.equal(
    service.database
      .prepare("SELECT COUNT(*) AS count FROM device_account_links")
      .get().count,
    0
  );
});

test("two Google accounts on one device share the device budget", async (t) => {
  const { service, oauthClient } = makeService({
    freeDeviceGrantCredits: "0.25",
  });
  t.after(() => service.close());

  const first = await signIn(service, oauthClient, {
    code: "account-one",
    sub: "google-account-one",
    email: "one@example.com",
  });
  const firstContext = await service.authorizeAiRequest(
    request(first.cookie),
    new MockResponse()
  );
  await service.reserveAiBudget(firstContext, {
    model: "gpt-5.6-terra",
    inputTokens: 100,
    maxOutputTokens: 0,
    minOutputTokens: 0,
  });
  await service.markAiProviderStarted(firstContext);
  const metering = await service.recordAiUsage(firstContext, {
    requestId: "request-one",
    provider: "openai",
    responseId: "resp-account-one",
    model: "gpt-5.6-terra-2026-08-01",
    usage: {
      inputTokens: 100,
      cacheWriteTokens: 100,
      outputTokens: 0,
    },
  });
  await service.releaseAiRequest(firstContext);
  assert.equal(metering.costNanoUsd, 250_000);
  assert.equal(metering.remainingCredits, 0);

  const second = await signIn(service, oauthClient, {
    cookie: first.cookie,
    code: "account-two",
    sub: "google-account-two",
    email: "two@example.com",
  });
  assert.equal(
    service.database.prepare("SELECT COUNT(*) AS count FROM devices").get().count,
    1
  );
  assert.equal(
    service.database
      .prepare("SELECT COUNT(*) AS count FROM device_account_links")
      .get().count,
    2
  );
  await assert.rejects(
    service.authorizeAiRequest(request(second.cookie), new MockResponse()),
    (error) =>
      error instanceof AiAccessError &&
      error.status === 429 &&
      error.code === "free_quota_exhausted"
  );

  const secondAccountOnNewDevice = await signIn(service, oauthClient, {
    cookie: "",
    code: "account-two-new-device",
    sub: "google-account-two",
    email: "two@example.com",
  });
  await assert.rejects(
    service.authorizeAiRequest(
      request(secondAccountOnNewDevice.cookie),
      new MockResponse()
    ),
    (error) =>
      error instanceof AiAccessError && error.code === "free_quota_exhausted"
  );
  const secondAccount = service.database
    .prepare("SELECT grant_nano_usd FROM google_accounts WHERE masked_email = ?")
    .get("t***@e***.com");
  assert.equal(secondAccount.grant_nano_usd, 0);
});

test("pre-linked accounts keep sharing their immutable source-device grant", async (t) => {
  const { service, oauthClient } = makeService({
    freeDeviceGrantCredits: "1",
    maxGlobalInFlight: 4,
  });
  t.after(() => service.close());

  const firstSourceLogin = await signIn(service, oauthClient, {
    code: "prelinked-source-account-one",
    sub: "prelinked-account-one",
    email: "prelinked-one@example.com",
  });
  await signIn(service, oauthClient, {
    cookie: firstSourceLogin.cookie,
    code: "prelinked-source-account-two",
    sub: "prelinked-account-two",
    email: "prelinked-two@example.com",
  });
  const prelinkedAccounts = service.database
    .prepare(
      `SELECT account_hash, grant_source_device_id, grant_nano_usd
         FROM google_accounts ORDER BY account_hash`
    )
    .all();
  assert.equal(prelinkedAccounts.length, 2);
  assert.equal(
    prelinkedAccounts[0].grant_source_device_id,
    prelinkedAccounts[1].grant_source_device_id
  );
  assert.equal(prelinkedAccounts[0].grant_nano_usd, 1_000_000);
  assert.equal(prelinkedAccounts[1].grant_nano_usd, 1_000_000);
  const sourceDeviceId = prelinkedAccounts[0].grant_source_device_id;

  const firstMovedLogin = await signIn(service, oauthClient, {
    code: "prelinked-account-one-moved",
    sub: "prelinked-account-one",
    email: "prelinked-one@example.com",
  });
  const secondMovedLogin = await signIn(service, oauthClient, {
    code: "prelinked-account-two-moved",
    sub: "prelinked-account-two",
    email: "prelinked-two@example.com",
  });
  const firstContext = await service.authorizeAiRequest(
    request(firstMovedLogin.cookie),
    new MockResponse()
  );
  const secondContext = await service.authorizeAiRequest(
    request(secondMovedLogin.cookie),
    new MockResponse()
  );
  assert.equal(firstContext.sourceDeviceId, sourceDeviceId);
  assert.equal(secondContext.sourceDeviceId, sourceDeviceId);
  assert.notEqual(firstContext.deviceId, sourceDeviceId);
  assert.notEqual(secondContext.deviceId, sourceDeviceId);
  assert.notEqual(firstContext.deviceId, secondContext.deviceId);

  const firstReservation = await service.reserveAiBudget(firstContext, {
    model: "gpt-5.6-terra",
    inputTokens: 0,
    maxOutputTokens: 50,
    minOutputTokens: 0,
  });
  const secondReservation = await service.reserveAiBudget(secondContext, {
    model: "gpt-5.6-terra",
    inputTokens: 0,
    maxOutputTokens: 50,
    minOutputTokens: 0,
  });
  assert.equal(firstReservation.reservedNanoUsd, 600_000);
  assert.equal(secondReservation.maxOutputTokens, 33);
  assert.equal(secondReservation.reservedNanoUsd, 396_000);

  await service.markAiProviderStarted(firstContext);
  await service.recordAiUsage(firstContext, {
    requestId: "prelinked-metering-one",
    provider: "openai",
    responseId: "resp-prelinked-one",
    model: "gpt-5.6-terra",
    usage: { inputTokens: 0, outputTokens: 50 },
  });
  await service.markAiProviderStarted(secondContext);
  await service.recordAiUsage(secondContext, {
    requestId: "prelinked-metering-two",
    provider: "openai",
    responseId: "resp-prelinked-two",
    model: "gpt-5.6-terra",
    usage: { inputTokens: 0, outputTokens: 33 },
  });

  const sourceDevice = service.database
    .prepare("SELECT grant_nano_usd, spent_nano_usd FROM devices WHERE id = ?")
    .get(sourceDeviceId);
  assert.equal(sourceDevice.grant_nano_usd, 1_000_000);
  assert.equal(sourceDevice.spent_nano_usd, 996_000);
  assert.equal(
    service.database
      .prepare(
        `SELECT COUNT(*) AS count FROM usage_ledger
          WHERE source_device_id = ?`
      )
      .get(sourceDeviceId).count,
    2
  );

  const finalContext = await service.authorizeAiRequest(
    request(firstMovedLogin.cookie),
    new MockResponse()
  );
  await assert.rejects(
    service.reserveAiBudget(finalContext, {
      model: "gpt-5.6-terra",
      inputTokens: 0,
      maxOutputTokens: 1,
      minOutputTokens: 1,
    }),
    (error) =>
      error instanceof AiAccessError &&
      error.status === 429 &&
      error.code === "free_quota_insufficient"
  );
  await service.releaseAiRequest(finalContext, { providerCalled: false });
});

test("one Google account cannot get a second grant from a new device", async (t) => {
  const { service, oauthClient } = makeService({
    freeDeviceGrantCredits: "0.25",
  });
  t.after(() => service.close());

  const first = await signIn(service, oauthClient, {
    code: "same-account-first-device",
    sub: "same-google-account",
    email: "same@example.com",
  });
  const firstContext = await service.authorizeAiRequest(
    request(first.cookie),
    new MockResponse()
  );
  await service.reserveAiBudget(firstContext, {
    model: "gpt-5.6-terra",
    inputTokens: 100,
    maxOutputTokens: 0,
    minOutputTokens: 0,
  });
  await service.markAiProviderStarted(firstContext);
  await service.recordAiUsage(firstContext, {
    requestId: "account-budget-request",
    provider: "openai",
    responseId: "resp-account-budget",
    model: "gpt-5.6-terra",
    usage: { inputTokens: 100, cacheWriteTokens: 100 },
  });
  await service.releaseAiRequest(firstContext);

  const second = await signIn(service, oauthClient, {
    cookie: "",
    code: "same-account-second-device",
    sub: "same-google-account",
    email: "same@example.com",
  });
  assert.equal(
    service.database.prepare("SELECT COUNT(*) AS count FROM devices").get().count,
    2
  );
  await assert.rejects(
    service.authorizeAiRequest(request(second.cookie), new MockResponse()),
    (error) =>
      error instanceof AiAccessError && error.code === "free_quota_exhausted"
  );
});

test("installation secret alias restores an existing device", async (t) => {
  const { service } = makeService();
  t.after(() => service.close());
  const secret = "installation-secret-with-adequate-entropy";
  const firstResponse = new MockResponse();
  await service.beginGoogleLogin(
    request("", { [INSTALLATION_SECRET_HEADER]: secret }),
    firstResponse
  );
  const firstDeviceCookie = cookieValue(firstResponse, DEVICE_COOKIE);

  const restoredResponse = new MockResponse();
  await service.getPublicStatus(
    request("", { [INSTALLATION_SECRET_HEADER]: secret }),
    restoredResponse
  );
  assert.equal(cookieValue(restoredResponse, DEVICE_COOKIE), firstDeviceCookie);
  const alias = service.database
    .prepare("SELECT alias_hash FROM installation_aliases")
    .get();
  assert.notEqual(alias.alias_hash, secret);
});

test("logout invalidates the opaque session and clears its cookie", async (t) => {
  const { service, oauthClient } = makeService();
  t.after(() => service.close());
  const login = await signIn(service, oauthClient, {
    code: "logout-code",
    sub: "logout-subject",
    email: "logout@example.com",
  });
  const context = await service.authorizeAiRequest(
    request(login.cookie),
    new MockResponse()
  );
  await service.releaseAiRequest(context);

  const response = new MockResponse();
  await service.logout(request(login.cookie), response);
  const deletionCookie = setCookies(response).find((cookie) =>
    cookie.startsWith(`${SESSION_COOKIE}=`)
  );
  assert.match(deletionCookie, /Max-Age=0/);
  assert.match(deletionCookie, /HttpOnly; Secure; SameSite=Lax/);
  assert.equal(
    service.database.prepare("SELECT COUNT(*) AS count FROM auth_sessions").get()
      .count,
    0
  );
  await assert.rejects(
    service.authorizeAiRequest(request(login.cookie), new MockResponse()),
    (error) => error instanceof AiAccessError && error.status === 401
  );
});

test("cost calculation uses exact nanoUSD arithmetic and token categories", () => {
  const result = calculateUsageCostNanoUsd({
    inputTokens: 1_200,
    cachedInputTokens: 800,
    cacheWriteTokens: 100,
    outputTokens: 55,
  });
  assert.equal(result.tier, "standard");
  assert.equal(
    result.costNanoUsd,
    300 * 2_000 + 800 * 200 + 100 * 2_500 + 55 * 12_000
  );
  assert.equal(result.costNanoUsd, 1_670_000);
  assert.equal(result.costNanoUsd / CREDIT_NANO_USD, 1.67);
});

test("effective quota fields remain arithmetically consistent across device and account history", async (t) => {
  const { service, oauthClient } = makeService({ freeDeviceGrantCredits: "1" });
  t.after(() => service.close());
  const login = await signIn(service, oauthClient, {
    code: "mixed-quota-history",
    sub: "mixed-quota-account",
    email: "mixed@example.com",
  });
  service.database.prepare("UPDATE devices SET spent_nano_usd = 700000").run();
  service.database
    .prepare(
      "UPDATE google_accounts SET grant_nano_usd = 500000, spent_nano_usd = 100000"
    )
    .run();
  const status = await service.getPublicStatus(
    request(login.cookie),
    new MockResponse()
  );
  const { granted, spent, reserved, remaining } = status.quota;
  assert.ok(Math.abs(granted - (spent + reserved + remaining)) < 1e-12);
  assert.equal(granted, 1);
  assert.equal(spent, 0.7);
  assert.equal(reserved, 0);
  assert.equal(remaining, 0.3);
  assert.equal(status.budget.deviceRemainingCredits, 0.3);
  assert.equal(status.budget.accountRemainingCredits, 0.4);
});

test("long-context pricing starts above 272000 input tokens", () => {
  const boundary = calculateUsageCostNanoUsd({
    inputTokens: LONG_CONTEXT_THRESHOLD,
    outputTokens: 1,
  });
  assert.equal(boundary.tier, "standard");
  assert.deepEqual(boundary.rates, {
    input: MODEL_PRICES["gpt-5.6-terra"].inputNanoUsdPerToken,
    cached: MODEL_PRICES["gpt-5.6-terra"].cachedInputNanoUsdPerToken,
    cacheWrite: MODEL_PRICES["gpt-5.6-terra"].cacheWriteNanoUsdPerToken,
    output: MODEL_PRICES["gpt-5.6-terra"].outputNanoUsdPerToken,
  });

  const above = calculateUsageCostNanoUsd({
    inputTokens: LONG_CONTEXT_THRESHOLD + 1,
    outputTokens: 1,
  });
  assert.equal(above.tier, "long_context");
  assert.equal(
    above.costNanoUsd,
    (LONG_CONTEXT_THRESHOLD + 1) * 4_000 + 18_000
  );
});

test("usage above its reservation fails closed for reconciliation", async (t) => {
  const { service, oauthClient } = makeService({
    freeDeviceGrantCredits: "0.01",
  });
  t.after(() => service.close());
  const login = await signIn(service, oauthClient, {
    code: "last-request",
    sub: "last-request-account",
    email: "last@example.com",
  });
  const context = await service.authorizeAiRequest(
    request(login.cookie),
    new MockResponse(),
    { requestId: "last-metered-request" }
  );
  await service.reserveAiBudget(context, {
    model: "gpt-5.6-terra",
    inputTokens: 1,
    maxOutputTokens: 0,
    minOutputTokens: 0,
  });
  await service.markAiProviderStarted(context);
  await assert.rejects(
    service.recordAiUsage(context, {
      requestId: "last-metered-request",
      provider: "openai",
      responseId: "resp-over-reservation",
      model: "gpt-5.6-terra",
      usage: { inputTokens: 2 },
    }),
    (error) =>
      error instanceof AiAccessError &&
      error.code === "usage_exceeds_reservation" &&
      error.actualNanoUsd === 4_000 &&
      error.reservedNanoUsd === 2_500
  );
  assert.equal(
    service.database.prepare("SELECT COUNT(*) AS count FROM usage_ledger").get()
      .count,
    0
  );
  const inflight = service.database
    .prepare(
      `SELECT request_id, state, reserved_nano_usd, actual_nano_usd
         FROM inflight_requests`
    )
    .get();
  assert.equal(inflight.state, "needs_reconciliation");
  assert.equal(inflight.request_id, "last-metered-request");
  assert.equal(inflight.reserved_nano_usd, 10_000);
  assert.equal(inflight.actual_nano_usd, 4_000);
  assert.equal(await service.releaseAiRequest(context, { providerCalled: true }), false);
});

test("reservations prevent one account from double-spending across two devices", async (t) => {
  const { service, oauthClient } = makeService({
    freeDeviceGrantCredits: "1",
    maxGlobalInFlight: 4,
  });
  t.after(() => service.close());
  const first = await signIn(service, oauthClient, {
    code: "reserve-account-device-one",
    sub: "shared-reservation-account",
    email: "shared@example.com",
  });
  const firstContext = await service.authorizeAiRequest(
    request(first.cookie),
    new MockResponse()
  );
  const firstReservation = await service.reserveAiBudget(firstContext, {
    model: "gpt-5.6-terra",
    inputTokens: 0,
    maxOutputTokens: 50,
    minOutputTokens: 0,
  });
  assert.equal(firstReservation.reservedNanoUsd, 600_000);

  const second = await signIn(service, oauthClient, {
    cookie: "",
    code: "reserve-account-device-two",
    sub: "shared-reservation-account",
    email: "shared@example.com",
  });
  const secondContext = await service.authorizeAiRequest(
    request(second.cookie),
    new MockResponse()
  );
  const secondReservation = await service.reserveAiBudget(secondContext, {
    model: "gpt-5.6-terra",
    inputTokens: 0,
    maxOutputTokens: 50,
    minOutputTokens: 0,
  });
  assert.equal(secondReservation.maxOutputTokens, 33);
  assert.equal(secondReservation.reservedNanoUsd, 396_000);
  assert.equal(secondReservation.quota.remaining, 0.004);
  const reserved = service.database
    .prepare(
      `SELECT SUM(reserved_nano_usd) AS total
         FROM inflight_requests WHERE state = 'reserved'`
    )
    .get();
  assert.equal(reserved.total, 996_000);
  await service.releaseAiRequest(firstContext, { providerCalled: false });
  await service.releaseAiRequest(secondContext, { providerCalled: false });
});

test("reservation dynamically caps output to the affordable token count", async (t) => {
  const { service, oauthClient } = makeService({ freeDeviceGrantCredits: "1" });
  t.after(() => service.close());
  const login = await signIn(service, oauthClient, {
    code: "dynamic-output-cap",
    sub: "dynamic-output-account",
    email: "dynamic@example.com",
  });
  const context = await service.authorizeAiRequest(
    request(login.cookie),
    new MockResponse()
  );
  const binding = await service.bindAiRequest(context, {
    requestId: "http-dynamic-output-cap",
  });
  assert.equal(binding.bound, true);
  assert.equal(context.requestId, "http-dynamic-output-cap");
  const reservation = await service.reserveAiBudget(context, {
    model: "gpt-5.6-terra",
    inputTokens: 100,
    maxOutputTokens: 100,
    minOutputTokens: 10,
  });
  assert.equal(reservation.maxOutputTokens, 62);
  assert.equal(reservation.requestId, "http-dynamic-output-cap");
  assert.equal(reservation.reservedNanoUsd, 994_000);
  assert.equal(reservation.quota.reserved, 0.994);
  assert.equal(reservation.quota.remaining, 0.006);
  assert.ok(
    Math.abs(
      reservation.quota.granted -
        (reservation.quota.spent +
          reservation.quota.reserved +
          reservation.quota.remaining)
    ) < 1e-12
  );
  await service.releaseAiRequest(context, { providerCalled: false });
});

test("extends a provider-started reservation for compiler repair and records aggregate usage", async (t) => {
  const { service, oauthClient } = makeService({
    freeDeviceGrantCredits: "20",
  });
  t.after(() => service.close());
  const login = await signIn(service, oauthClient, {
    code: "compiler-repair-budget",
    sub: "compiler-repair-account",
    email: "repair@example.com",
  });
  const context = await service.authorizeAiRequest(
    request(login.cookie),
    new MockResponse(),
    { requestId: "compiler-repair-request" }
  );
  await service.reserveAiBudget(context, {
    model: "gpt-5.6-terra",
    inputTokens: 100,
    maxOutputTokens: 100,
    minOutputTokens: 10,
  });
  await service.markAiProviderStarted(context);

  const extension = await service.extendAiBudgetReservation(context, {
    model: "gpt-5.6-terra-2026-08-01",
    additionalInputTokens: 50,
    additionalMaxOutputTokens: 200,
    minAdditionalOutputTokens: 100,
  });
  assert.equal(extension.additionalMaxOutputTokens, 200);
  assert.equal(extension.cumulativeInputTokens, 150);
  assert.equal(extension.cumulativeMaxOutputTokens, 300);
  const inflight = service.database
    .prepare(
      `SELECT state, reservation_input_tokens,
              reservation_max_output_tokens, reserved_nano_usd
         FROM inflight_requests WHERE reservation_id = ?`
    )
    .get(context.reservationId);
  assert.equal(inflight.state, "provider_started");
  assert.equal(inflight.reservation_input_tokens, 150);
  assert.equal(inflight.reservation_max_output_tokens, 300);
  assert.equal(inflight.reserved_nano_usd, extension.reservedNanoUsd);

  const recorded = await service.recordAiUsage(context, {
    requestId: "compiler-repair-request",
    provider: "openai",
    responseId: "resp-compiler-repair",
    model: "gpt-5.6-terra-2026-08-01",
    usage: {
      inputTokens: 150,
      outputTokens: 250,
      totalTokens: 400,
    },
  });
  assert.equal(recorded.recorded, true);
  assert.equal(
    service.database
      .prepare("SELECT COUNT(*) AS count FROM inflight_requests")
      .get().count,
    0
  );
});

test("charges compiler-repair provider responses at their individual context tiers", async (t) => {
  const { service, oauthClient } = makeService({
    freeDeviceGrantCredits: "2000",
  });
  t.after(() => service.close());
  const login = await signIn(service, oauthClient, {
    code: "composite-provider-usage",
    sub: "composite-provider-account",
    email: "composite@example.com",
  });
  const context = await service.authorizeAiRequest(
    request(login.cookie),
    new MockResponse(),
    { requestId: "composite-provider-request" }
  );
  await service.reserveAiBudget(context, {
    model: "gpt-5.6-terra",
    inputTokens: 150_000,
    maxOutputTokens: 0,
    minOutputTokens: 0,
  });
  await service.markAiProviderStarted(context);
  await service.extendAiBudgetReservation(context, {
    model: "gpt-5.6-terra",
    additionalInputTokens: 150_000,
    additionalMaxOutputTokens: 0,
    minAdditionalOutputTokens: 0,
  });

  const result = await service.recordAiUsage(context, {
    requestId: "composite-provider-request",
    responses: [
      {
        provider: "openai",
        responseId: "resp-composite-one",
        model: "gpt-5.6-terra-2026-08-01",
        usage: { inputTokens: 150_000, outputTokens: 0 },
      },
      {
        provider: "openai",
        responseId: "resp-composite-two",
        model: "gpt-5.6-terra-2026-08-01",
        usage: { inputTokens: 150_000, outputTokens: 0 },
      },
    ],
  });
  assert.equal(result.tier, "long_context");
  assert.equal(result.costNanoUsd, 600_000_000);
  const ledger = service.database
    .prepare(
      `SELECT provider_response_id, tier, input_tokens, cost_nano_usd
         FROM usage_ledger WHERE request_id = ?`
    )
    .get("composite-provider-request");
  assert.equal(
    ledger.provider_response_id,
    "bundle:18:resp-composite-one18:resp-composite-two"
  );
  assert.equal(ledger.tier, "long_context");
  assert.equal(ledger.input_tokens, 300_000);
  assert.equal(ledger.cost_nano_usd, 600_000_000);
});

test("reservation denies a request whose input and minimum output do not fit", async (t) => {
  const { service, oauthClient } = makeService({
    freeDeviceGrantCredits: "0.3",
  });
  t.after(() => service.close());
  const login = await signIn(service, oauthClient, {
    code: "insufficient-reservation",
    sub: "insufficient-account",
    email: "insufficient@example.com",
  });
  const context = await service.authorizeAiRequest(
    request(login.cookie),
    new MockResponse()
  );
  await assert.rejects(
    service.reserveAiBudget(context, {
      model: "gpt-5.6-terra",
      inputTokens: 100,
      maxOutputTokens: 100,
      minOutputTokens: 10,
    }),
    (error) =>
      error instanceof AiAccessError &&
      error.status === 429 &&
      error.code === "free_quota_insufficient"
  );
  assert.equal(
    service.database
      .prepare("SELECT state FROM inflight_requests WHERE reservation_id = ?")
      .get(context.reservationId).state,
    "authorized"
  );
  assert.equal(await service.releaseAiRequest(context, { providerCalled: false }), true);
});

test("actual usage reconciles a reservation and provider response is idempotent", async (t) => {
  const { service, oauthClient } = makeService({ freeDeviceGrantCredits: "2" });
  t.after(() => service.close());
  const login = await signIn(service, oauthClient, {
    code: "successful-reconciliation",
    sub: "successful-reconciliation-account",
    email: "metering@example.com",
  });
  const context = await service.authorizeAiRequest(
    request(login.cookie),
    new MockResponse()
  );
  const reservation = await service.reserveAiBudget(context, {
    model: "gpt-5.6-terra",
    inputTokens: 100,
    maxOutputTokens: 20,
    minOutputTokens: 10,
  });
  assert.equal(reservation.reservedNanoUsd, 490_000);
  await service.markAiProviderStarted(context);
  const recorded = await service.recordAiUsage(context, {
    requestId: "metering-request-one",
    provider: "openai",
    responseId: "resp-provider-idempotent",
    model: "gpt-5.6-terra-2026-08-01",
    usage: {
      inputTokens: 100,
      outputTokens: 10,
      reasoningTokens: 3,
      totalTokens: 110,
    },
  });
  assert.equal(recorded.recorded, true);
  assert.equal(recorded.costNanoUsd, 320_000);
  assert.equal(recorded.quota.reserved, 0);
  assert.equal(recorded.quota.remaining, 1.68);
  assert.equal(
    service.database.prepare("SELECT COUNT(*) AS count FROM inflight_requests").get()
      .count,
    0
  );
  const ledger = service.database
    .prepare(
      `SELECT provider, provider_response_id, reasoning_tokens, total_tokens,
              cost_nano_usd
         FROM usage_ledger`
    )
    .get();
  assert.equal(ledger.provider, "openai");
  assert.equal(ledger.provider_response_id, "resp-provider-idempotent");
  assert.equal(ledger.reasoning_tokens, 3);
  assert.equal(ledger.total_tokens, 110);
  assert.equal(ledger.cost_nano_usd, 320_000);

  const duplicate = await service.recordAiUsage(context, {
    requestId: "metering-request-retry",
    provider: "openai",
    responseId: "resp-provider-idempotent",
    model: "gpt-5.6-terra",
    usage: {
      inputTokens: 100,
      outputTokens: 10,
      reasoningTokens: 3,
      totalTokens: 110,
    },
  });
  assert.equal(duplicate.recorded, false);
  assert.equal(duplicate.duplicate, true);
  assert.equal(
    service.database.prepare("SELECT COUNT(*) AS count FROM usage_ledger").get()
      .count,
    1
  );
  await assert.rejects(
    service.recordAiUsage(context, {
      requestId: "metering-request-conflict",
      provider: "openai",
      responseId: "resp-provider-idempotent",
      model: "gpt-5.6-terra",
      usage: {
        inputTokens: 100,
        outputTokens: 11,
        reasoningTokens: 3,
        totalTokens: 111,
      },
    }),
    (error) =>
      error instanceof AiAccessError && error.code === "usage_request_conflict"
  );
});

test("provider-started failure keeps its reservation for reconciliation", async (t) => {
  const { service, oauthClient } = makeService({ freeDeviceGrantCredits: "1" });
  t.after(() => service.close());
  const login = await signIn(service, oauthClient, {
    code: "provider-failure",
    sub: "provider-failure-account",
    email: "failure@example.com",
  });
  const context = await service.authorizeAiRequest(
    request(login.cookie),
    new MockResponse()
  );
  await service.reserveAiBudget(context, {
    model: "gpt-5.6-terra",
    inputTokens: 0,
    maxOutputTokens: 10,
    minOutputTokens: 0,
  });
  await service.markAiProviderStarted(context);
  await assert.rejects(
    service.reserveAiBudget(context, {
      model: "gpt-5.6-terra",
      inputTokens: 0,
      maxOutputTokens: 10,
      minOutputTokens: 0,
    }),
    (error) =>
      error instanceof AiAccessError &&
      error.status === 409 &&
      error.code === "budget_reservation_state_conflict"
  );
  assert.equal(
    await service.releaseAiRequest(context, { providerCalled: true }),
    false
  );
  const inflight = service.database
    .prepare("SELECT state, reserved_nano_usd FROM inflight_requests")
    .get();
  assert.equal(inflight.state, "needs_reconciliation");
  assert.equal(inflight.reserved_nano_usd, 120_000);
  const nextContext = await service.authorizeAiRequest(
    request(login.cookie),
    new MockResponse()
  );
  assert.equal(nextContext.mode, "google");
  await service.releaseAiRequest(nextContext, { providerCalled: false });
});

test("an explicitly rejected provider request releases its reservation", async (t) => {
  const { service, oauthClient } = makeService({ freeDeviceGrantCredits: "1" });
  t.after(() => service.close());
  const login = await signIn(service, oauthClient, {
    code: "provider-rejected",
    sub: "provider-rejected-account",
    email: "rejected@example.com",
  });
  const context = await service.authorizeAiRequest(
    request(login.cookie),
    new MockResponse()
  );
  await service.reserveAiBudget(context, {
    model: "gpt-5.6-terra",
    inputTokens: 0,
    maxOutputTokens: 10,
    minOutputTokens: 0,
  });
  await service.markAiProviderStarted(context);
  assert.equal(
    await service.releaseAiRequest(context, {
      providerCalled: true,
      providerRejected: true,
    }),
    true
  );
  assert.equal(
    service.database.prepare("SELECT COUNT(*) AS count FROM inflight_requests").get()
      .count,
    0
  );
});

test("expired provider-started work stops consuming the global concurrency slot", async (t) => {
  let now = 1_800_000_000_000;
  const { service, oauthClient } = makeService({
    now: () => now,
    freeDeviceGrantCredits: "1",
    maxGlobalInFlight: 1,
    reservationTtlMs: 10_000,
  });
  t.after(() => service.close());
  const first = await signIn(service, oauthClient, {
    code: "stale-provider-first",
    sub: "stale-provider-first-account",
    email: "first@example.com",
  });
  const firstContext = await service.authorizeAiRequest(
    request(first.cookie),
    new MockResponse()
  );
  await service.reserveAiBudget(firstContext, {
    model: "gpt-5.6-terra",
    inputTokens: 0,
    maxOutputTokens: 10,
    minOutputTokens: 0,
  });
  await service.markAiProviderStarted(firstContext);

  now += 10_001;
  const second = await signIn(service, oauthClient, {
    code: "stale-provider-second",
    sub: "stale-provider-second-account",
    email: "second@example.com",
  });
  const secondContext = await service.authorizeAiRequest(
    request(second.cookie),
    new MockResponse()
  );
  assert.equal(secondContext.mode, "google");
  const stale = service.database
    .prepare(
      "SELECT state FROM inflight_requests WHERE reservation_id = ?"
    )
    .get(firstContext.reservationId);
  assert.equal(stale.state, "needs_reconciliation");
  await service.releaseAiRequest(secondContext, { providerCalled: false });
});

test("usage accounting rejects inconsistent total and reasoning counters", () => {
  assert.throws(
    () =>
      calculateUsageCostNanoUsd({
        inputTokens: 10,
        outputTokens: 5,
        reasoningTokens: 6,
        totalTokens: 15,
      }),
    (error) =>
      error instanceof AiAccessError && error.code === "usage_counts_invalid"
  );
  assert.throws(
    () =>
      calculateUsageCostNanoUsd({
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 16,
      }),
    (error) =>
      error instanceof AiAccessError && error.code === "usage_counts_invalid"
  );
});

test("status GET does not create devices and staged Google auth remains optional", async (t) => {
  const { service, oauthClient } = makeService({
    googleAuthEnabled: true,
    googleAuthRequired: false,
  });
  t.after(() => service.close());
  const anonymousStatus = await service.getPublicStatus(
    request(),
    new MockResponse()
  );
  assert.equal(anonymousStatus.mode, "google");
  assert.equal(anonymousStatus.authRequired, false);
  assert.equal(anonymousStatus.authenticated, false);
  assert.equal(
    service.database.prepare("SELECT COUNT(*) AS count FROM devices").get().count,
    0
  );
  assert.equal(
    (await service.authorizeAiRequest(request(), new MockResponse())).mode,
    "public"
  );

  const login = await signIn(service, oauthClient, {
    code: "staged-google-auth",
    sub: "staged-google-account",
    email: "staged@example.com",
  });
  const authenticatedStatus = await service.getPublicStatus(
    request(login.cookie),
    new MockResponse()
  );
  assert.equal(authenticatedStatus.mode, "google");
  assert.equal(authenticatedStatus.authenticated, true);
  const context = await service.authorizeAiRequest(
    request(login.cookie),
    new MockResponse()
  );
  assert.equal(context.mode, "google");
  await service.releaseAiRequest(context, { providerCalled: false });
});

test("status cleanup removes expired sessions without creating another device", async (t) => {
  let now = 1_800_000_000_000;
  const { service, oauthClient } = makeService({ now: () => now });
  t.after(() => service.close());
  await signIn(service, oauthClient, {
    code: "expiring-session",
    sub: "expiring-session-account",
    email: "expires@example.com",
  });
  assert.equal(
    service.database.prepare("SELECT COUNT(*) AS count FROM auth_sessions").get()
      .count,
    1
  );
  now += 30 * 24 * 60 * 60 * 1000 + 1;
  await service.getPublicStatus(request(), new MockResponse());
  assert.equal(
    service.database.prepare("SELECT COUNT(*) AS count FROM auth_sessions").get()
      .count,
    0
  );
  assert.equal(
    service.database.prepare("SELECT COUNT(*) AS count FROM devices").get().count,
    1
  );
});

test("OAuth cleanup removes expired orphan devices without deleting the current device", async (t) => {
  let now = 1_800_000_000_000;
  const { service } = makeService({ now: () => now });
  t.after(() => service.close());
  const currentStart = new MockResponse();
  await service.beginGoogleLogin(
    request("", {
      [INSTALLATION_SECRET_HEADER]: "current-installation-secret",
    }),
    currentStart
  );
  await service.beginGoogleLogin(
    request("", {
      [INSTALLATION_SECRET_HEADER]: "expired-installation-secret",
    }),
    new MockResponse()
  );
  assert.equal(
    service.database.prepare("SELECT COUNT(*) AS count FROM devices").get().count,
    2
  );

  now += 10 * 60 * 1000 + 1;
  await service.beginGoogleLogin(
    request(cookieHeader(currentStart)),
    new MockResponse()
  );
  assert.equal(
    service.database.prepare("SELECT COUNT(*) AS count FROM devices").get().count,
    1
  );
  assert.equal(
    service.database
      .prepare("SELECT COUNT(*) AS count FROM oauth_transactions")
      .get().count,
    1
  );
});

test("Google auth enforcement flags reject unsafe or contradictory values", () => {
  assert.throws(
    () =>
      createAiAccessService({
        environment: { AI_GOOGLE_AUTH_REQUIRED: "tru" },
        databasePath: ":memory:",
      }),
    /AI_GOOGLE_AUTH_REQUIRED must be 0, 1, true, or false/
  );
  assert.throws(
    () =>
      createAiAccessService({
        environment: { AI_GOOGLE_AUTH_ENABLED: "yes" },
        databasePath: ":memory:",
      }),
    /AI_GOOGLE_AUTH_ENABLED must be 0, 1, true, or false/
  );
  assert.throws(
    () =>
      createAiAccessService({
        environment: {},
        googleAuthEnabled: false,
        googleAuthRequired: true,
        databasePath: ":memory:",
      }),
    /cannot be enabled while AI_GOOGLE_AUTH_ENABLED is disabled/
  );
});

test("Google-enabled mode requires persistent SQLite unless tests opt in explicitly", () => {
  assert.throws(
    () =>
      createAiAccessService({
        environment: {},
        googleAuthEnabled: true,
        databasePath: ":memory:",
      }),
    /requires a persistent AI_ACCESS_DB_PATH/
  );
  const service = createAiAccessService({
    environment: {},
    googleAuthEnabled: true,
    databasePath: ":memory:",
    allowInMemoryDatabaseForTests: true,
  });
  service.close();
});

test("unknown price catalog versions fail before seeding current rates", () => {
  assert.throws(
    () =>
      createAiAccessService({
        environment: { AI_PRICE_CATALOG_VERSION: "future-unreviewed-prices" },
        databasePath: ":memory:",
      }),
    /AI_PRICE_CATALOG_VERSION future-unreviewed-prices is not supported/
  );
});

test("Google mode reports missing server configuration as a typed 503", async (t) => {
  const service = createAiAccessService({
    environment: { AI_GOOGLE_AUTH_REQUIRED: "1" },
    databasePath: ":memory:",
    allowInMemoryDatabaseForTests: true,
  });
  t.after(() => service.close());
  await assert.rejects(
    service.authorizeAiRequest(request(), new MockResponse()),
    (error) =>
      error instanceof AiAccessError &&
      error.status === 503 &&
      error.code === "google_auth_not_configured"
  );
});

test("account workspace snapshots persist independently without spending AI credits", async (t) => {
  const { service, oauthClient } = makeService();
  t.after(() => service.close());
  const login = await signIn(service, oauthClient, {
    code: "workspace-code",
    sub: "workspace-account",
    email: "workspace@example.com",
  });
  service.database.exec(
    "UPDATE google_accounts SET spent_nano_usd = grant_nano_usd; UPDATE devices SET spent_nano_usd = grant_nano_usd;"
  );

  const context = service.authenticateAccountWorkspaceRequest(
    request(login.cookie),
    new MockResponse()
  );
  assert.equal(typeof context.accountHash, "string");
  assert.match(context.accountKey, /^[A-Za-z0-9_-]{32,128}$/);
  const empty = service.readAccountWorkspace(context);
  assert.equal(empty.accountKey, context.accountKey);
  assert.deepEqual(Object.keys(empty.documents), ["chats", "files", "instruction"]);
  assert.equal(empty.documents.chats.revision, 0);
  assert.equal(empty.documents.files.data, null);
  assert.equal(empty.documents.instruction.schemaVersion, 1);

  const chats = {
    schemaVersion: 1,
    activeChatId: "chat-1",
    chats: [
      {
        id: "chat-1",
        title: "First chat",
        titleSource: "auto",
        titleLocked: false,
        createdAt: 1,
        updatedAt: 3,
        messages: [
          {
            id: "message-1",
            role: "user",
            content: "Question",
            title: "",
            createdAt: 1,
          },
          {
            id: "message-2",
            role: "assistant",
            content: "Answer",
            title: "",
            createdAt: 2,
            editedAt: 3,
          },
        ],
      },
    ],
  };
  const files = {
    schemaVersion: 2,
    files: { "main.c": "int main(void) { return 0; }\n" },
    fileGroups: {},
    miniProjects: {},
    current: "main.c",
    authorship: {
      "main.c": {
        schemaVersion: 1,
        lines: ["original", "human"],
        updatedAt: 3,
      },
    },
  };
  const instruction = {
    schemaVersion: 1,
    revision: 4,
    markdown: "# Project\n",
    skillRefs: [{ id: "initialization", version: "1.0.0" }],
    authorship: {
      schemaVersion: 1,
      lines: ["original", "ai"],
      updatedAt: 4,
    },
  };

  assert.equal(
    service.writeAccountWorkspace(context, "chats", {
      baseRevision: 0,
      expectedAccountKey: context.accountKey,
      data: chats,
    }).document.revision,
    1
  );
  assert.equal(
    service.writeAccountWorkspace(context, "files", {
      baseRevision: 0,
      expectedAccountKey: context.accountKey,
      data: files,
    }).document.revision,
    1
  );
  assert.equal(
    service.writeAccountWorkspace(context, "instruction", {
      baseRevision: 0,
      expectedAccountKey: context.accountKey,
      data: instruction,
    }).document.revision,
    1
  );

  const stored = service.readAccountWorkspace(context);
  assert.deepEqual(stored.documents.chats.data, chats);
  assert.deepEqual(stored.documents.files.data, files);
  assert.deepEqual(stored.documents.instruction.data, instruction);
  assert.equal(stored.documents.chats.revision, 1);
  assert.equal(stored.documents.files.revision, 1);
  assert.equal(stored.documents.instruction.revision, 1);
});

test("account workspace is isolated by Google account and rejects stale revisions", async (t) => {
  const { service, oauthClient } = makeService();
  t.after(() => service.close());
  const first = await signIn(service, oauthClient, {
    code: "workspace-first",
    sub: "workspace-first-account",
    email: "first@example.com",
  });
  const secondDevice = await signIn(service, oauthClient, {
    code: "workspace-second-device",
    sub: "workspace-first-account",
    email: "first@example.com",
  });
  const other = await signIn(service, oauthClient, {
    code: "workspace-other",
    sub: "workspace-other-account",
    email: "other@example.com",
  });
  const firstContext = service.authenticateAccountWorkspaceRequest(
    request(first.cookie),
    new MockResponse()
  );
  const secondDeviceContext = service.authenticateAccountWorkspaceRequest(
    request(secondDevice.cookie),
    new MockResponse()
  );
  const otherContext = service.authenticateAccountWorkspaceRequest(
    request(other.cookie),
    new MockResponse()
  );
  const data = { schemaVersion: 1, activeChatId: null, chats: [] };

  service.writeAccountWorkspace(firstContext, "chats", {
    baseRevision: 0,
    expectedAccountKey: firstContext.accountKey,
    data,
  });
  assert.equal(firstContext.accountKey, secondDeviceContext.accountKey);
  assert.notEqual(firstContext.accountKey, otherContext.accountKey);
  assert.deepEqual(
    service.readAccountWorkspace(secondDeviceContext).documents.chats.data,
    data
  );
  assert.equal(service.readAccountWorkspace(otherContext).documents.chats.data, null);
  assert.throws(
    () =>
      service.writeAccountWorkspace(secondDeviceContext, "chats", {
        baseRevision: 0,
        expectedAccountKey: secondDeviceContext.accountKey,
        data,
      }),
    (error) =>
      error instanceof AiAccessError &&
      error.status === 409 &&
      error.code === "account_data_revision_conflict"
  );
  assert.throws(
    () =>
      service.writeAccountWorkspace(firstContext, "files", {
        baseRevision: 0,
        expectedAccountKey: firstContext.accountKey,
        data: {
          schemaVersion: 2,
          files: {},
          fileGroups: {},
          miniProjects: {},
          current: null,
          instructionDocument: { schemaVersion: 1 },
        },
      }),
    (error) =>
      error instanceof AiAccessError &&
      error.code === "project_instruction_storage_forbidden"
  );
});

test("account workspace validates authentication, schemas, and payload limits", async (t) => {
  const { service, oauthClient } = makeService();
  t.after(() => service.close());
  assert.throws(
    () =>
      service.authenticateAccountWorkspaceRequest(request(), new MockResponse()),
    (error) => error instanceof AiAccessError && error.status === 401
  );
  const login = await signIn(service, oauthClient, {
    code: "workspace-limits",
    sub: "workspace-limits-account",
    email: "limits@example.com",
  });
  const context = service.authenticateAccountWorkspaceRequest(
    request(login.cookie),
    new MockResponse()
  );
  const emptyChats = { schemaVersion: 1, activeChatId: null, chats: [] };
  assert.throws(
    () =>
      service.writeAccountWorkspace(context, "chats", {
        baseRevision: 0,
        data: emptyChats,
      }),
    (error) =>
      error instanceof AiAccessError &&
      error.status === 400 &&
      error.code === "expected_account_key_required"
  );
  assert.throws(
    () =>
      service.writeAccountWorkspace(context, "chats", {
        baseRevision: 0,
        expectedAccountKey: "other_account_key_123456789012345678901234567890",
        data: emptyChats,
      }),
    (error) =>
      error instanceof AiAccessError &&
      error.status === 409 &&
      error.code === "account_workspace_account_mismatch"
  );
  assert.throws(
    () =>
      service.writeAccountWorkspace(context, "chats", {
        baseRevision: 0,
        expectedAccountKey: context.accountKey,
        data: {
          schemaVersion: 1,
          activeChatId: "chat-strict",
          chats: [
            {
              id: "chat-strict",
              title: "Strict",
              createdAt: 1,
              updatedAt: 1,
              messages: [
                {
                  id: "message-strict",
                  role: "user",
                  content: "Question",
                  title: "",
                  createdAt: 1,
                  unsupported: true,
                },
              ],
            },
          ],
        },
      }),
    (error) =>
      error instanceof AiAccessError &&
      error.status === 400 &&
      error.code === "invalid_account_data"
  );
  assert.throws(
    () =>
      service.writeAccountWorkspace(context, "chats", {
        baseRevision: 0,
        expectedAccountKey: context.accountKey,
        data: {
          schemaVersion: 1,
          activeChatId: "chat-metadata",
          chats: [
            {
              id: "chat-metadata",
              title: "Metadata",
              titleSource: "visitor",
              createdAt: 1,
              updatedAt: 1,
              messages: [],
            },
          ],
        },
      }),
    (error) =>
      error instanceof AiAccessError && error.code === "invalid_account_data"
  );
  assert.throws(
    () =>
      service.writeAccountWorkspace(context, "files", {
        baseRevision: 0,
        expectedAccountKey: context.accountKey,
        data: {
          schemaVersion: 2,
          files: { "main.c": "line one\nline two" },
          fileGroups: {},
          miniProjects: {},
          current: "main.c",
          authorship: {
            "missing.c": {
              schemaVersion: 1,
              lines: ["human"],
              updatedAt: 1,
            },
          },
        },
      }),
    (error) =>
      error instanceof AiAccessError && error.code === "invalid_account_data"
  );
  assert.throws(
    () =>
      service.writeAccountWorkspace(context, "instruction", {
        baseRevision: 0,
        expectedAccountKey: context.accountKey,
        data: {
          schemaVersion: 1,
          revision: 0,
          markdown: "# Instruction\n",
          skillRefs: [],
          authorship: {
            schemaVersion: 1,
            lines: ["human"],
            updatedAt: 1,
          },
        },
      }),
    (error) =>
      error instanceof AiAccessError && error.code === "invalid_account_data"
  );
  const largeMessages = Array.from({ length: 9 }, (_, index) => ({
    id: `large-message-${index}`,
    role: index % 2 ? "assistant" : "user",
    content: "x".repeat(120 * 1024),
    title: "",
    createdAt: index + 1,
  }));
  assert.throws(
    () =>
      service.writeAccountWorkspace(context, "chats", {
        baseRevision: 0,
        expectedAccountKey: context.accountKey,
        data: {
          schemaVersion: 1,
          activeChatId: "large-chat",
          chats: [
            {
              id: "large-chat",
              title: "Large",
              createdAt: 1,
              updatedAt: 10,
              messages: largeMessages,
            },
          ],
        },
      }),
    (error) =>
      error instanceof AiAccessError &&
      error.status === 413 &&
      error.code === "account_data_too_large"
  );
  assert.throws(
    () =>
      service.writeAccountWorkspace(context, "instruction", {
        baseRevision: 0,
        expectedAccountKey: context.accountKey,
        data: {
          schemaVersion: 1,
          revision: 0,
          markdown: "x".repeat(128 * 1024 + 1),
          skillRefs: [],
        },
      }),
    (error) => error instanceof AiAccessError && error.status === 400
  );
  assert.equal(ACCOUNT_WORKSPACE_MAX_BYTES.chats, 1024 * 1024);
  assert.equal(ACCOUNT_WORKSPACE_MAX_BYTES.files, 4 * 1024 * 1024);
  assert.equal(ACCOUNT_WORKSPACE_MAX_BYTES.instruction, 256 * 1024);
});

test("AI access database migrates to schema 2 with account workspace storage", (t) => {
  const temporaryDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "uartdebug-ai-schema-")
  );
  const databasePath = path.join(temporaryDirectory, "ai-access.sqlite");
  const initial = makeService({ databasePath }).service;
  initial.database.exec(
    "DROP TABLE account_workspace_snapshots; PRAGMA user_version = 1;"
  );
  initial.close();

  const { service } = makeService({ databasePath });
  t.after(() => {
    service.close();
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  });
  assert.equal(AI_ACCESS_SCHEMA_VERSION, 2);
  assert.equal(
    Number(service.database.prepare("PRAGMA user_version").get().user_version),
    2
  );
  const table = service.database
    .prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'account_workspace_snapshots'"
    )
    .get();
  assert.match(String(table?.sql || ""), /instruction/);
});
