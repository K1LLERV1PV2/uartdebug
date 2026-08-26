"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { OAuth2Client } = require("google-auth-library");

const SCHEMA_VERSION = 2;
const DEVICE_COOKIE = "__Host-ud_device";
const SESSION_COOKIE = "__Host-ud_session";
const INSTALLATION_SECRET_HEADER = "x-uartdebug-installation";
const ACCOUNT_WORKSPACE_TYPES = Object.freeze(["chats", "files", "instruction"]);
const ACCOUNT_WORKSPACE_SCHEMA_VERSIONS = Object.freeze({
  chats: 1,
  files: 2,
  instruction: 1,
});
const WORKSPACE_AUTHORSHIP_VALUES = new Set(["original", "human", "ai"]);
const MAX_WORKSPACE_AUTHORSHIP_LINES = 20_000;
const ACCOUNT_WORKSPACE_MAX_BYTES = Object.freeze({
  chats: 1024 * 1024,
  files: 4 * 1024 * 1024,
  instruction: 256 * 1024,
});
const CREDIT_NANO_USD = 1_000_000;
const DEFAULT_PRICE_CATALOG_VERSION = "2026-08-24";
const DEFAULT_MODEL = "gpt-5.6-terra";
const LONG_CONTEXT_THRESHOLD = 272_000;
const OAUTH_TRANSACTION_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const DEVICE_COOKIE_TTL_SECONDS = 400 * 24 * 60 * 60;
const RESERVATION_TTL_MS = 5 * 60 * 1000;

const PRICE_CATALOGS = Object.freeze({
  [DEFAULT_PRICE_CATALOG_VERSION]: Object.freeze({
    [DEFAULT_MODEL]: Object.freeze({
      inputNanoUsdPerToken: 2_000,
      cachedInputNanoUsdPerToken: 200,
      cacheWriteNanoUsdPerToken: 2_500,
      outputNanoUsdPerToken: 12_000,
      longContextThreshold: LONG_CONTEXT_THRESHOLD,
      longInputNanoUsdPerToken: 4_000,
      longCachedInputNanoUsdPerToken: 400,
      longCacheWriteNanoUsdPerToken: 5_000,
      longOutputNanoUsdPerToken: 18_000,
    }),
  }),
});
const MODEL_PRICES = PRICE_CATALOGS[DEFAULT_PRICE_CATALOG_VERSION];

class AiAccessError extends Error {
  constructor(status, code, message, options = {}) {
    super(message, options);
    this.name = "AiAccessError";
    this.status = status;
    this.code = code;
  }
}

class AiAccessService {
  constructor(options = {}) {
    this.environment = options.environment || process.env;
    this.now = options.now || (() => Date.now());
    this.random = options.randomBytes || options.random || crypto.randomBytes;
    this.googleAuthRequired = readStrictBoolean(
      firstDefined(options.googleAuthRequired, this.environment.AI_GOOGLE_AUTH_REQUIRED),
      false,
      "AI_GOOGLE_AUTH_REQUIRED"
    );
    this.googleAuthEnabled = readStrictBoolean(
      firstDefined(options.googleAuthEnabled, this.environment.AI_GOOGLE_AUTH_ENABLED),
      this.googleAuthRequired,
      "AI_GOOGLE_AUTH_ENABLED"
    );
    if (this.googleAuthRequired && !this.googleAuthEnabled) {
      throw new TypeError(
        "AI_GOOGLE_AUTH_REQUIRED cannot be enabled while AI_GOOGLE_AUTH_ENABLED is disabled."
      );
    }
    this.googleClientId = readSecretOption(
      options.googleClientId,
      this.environment,
      "GOOGLE_OAUTH_CLIENT_ID",
      "google_oauth_client_id"
    );
    this.googleClientSecret = readSecretOption(
      options.googleClientSecret,
      this.environment,
      "GOOGLE_OAUTH_CLIENT_SECRET",
      "google_oauth_client_secret"
    );
    this.identitySecret = readSecretOption(
      options.identitySecret,
      this.environment,
      "AI_IDENTITY_SECRET",
      "ai_identity_secret"
    );
    this.sessionSecret = readSecretOption(
      options.sessionSecret,
      this.environment,
      "AI_SESSION_SECRET",
      "ai_session_secret"
    );
    this.publicBaseUrl = normalizeBaseUrl(
      firstDefined(options.publicBaseUrl, this.environment.AI_PUBLIC_BASE_URL)
    );
    this.redirectUri = this.publicBaseUrl
      ? new URL("/api/avr/ai/auth/google/callback", this.publicBaseUrl).toString()
      : "";
    this.databasePath = String(
      firstDefined(options.databasePath, this.environment.AI_ACCESS_DB_PATH, ":memory:")
    ).trim();
    this.allowInMemoryDatabaseForTests =
      options.allowInMemoryDatabaseForTests === true;
    this.hasPersistentDatabasePath = Boolean(
      firstDefined(options.databasePath, this.environment.AI_ACCESS_DB_PATH)
    );
    this.priceCatalogVersion = normalizeIdentifier(
      firstDefined(
        options.priceCatalogVersion,
        this.environment.AI_PRICE_CATALOG_VERSION,
        DEFAULT_PRICE_CATALOG_VERSION
      ),
      80
    );
    this.freeDeviceGrantNanoUsd = parseCreditsToNanoUsd(
      firstDefined(
        options.freeDeviceGrantCredits,
        this.environment.AI_FREE_DEVICE_GRANT_CREDITS,
        "0"
      )
    );
    this.maxGlobalInFlight = readInteger(
      firstDefined(
        options.maxGlobalInFlight,
        this.environment.AI_ACCESS_MAX_GLOBAL_IN_FLIGHT,
        this.environment.AI_MAX_CONCURRENT
      ),
      1,
      100,
      2
    );
    this.maxDeviceInFlight = readInteger(
      firstDefined(
        options.maxDeviceInFlight,
        this.environment.AI_ACCESS_MAX_DEVICE_IN_FLIGHT
      ),
      1,
      20,
      1
    );
    this.oauthTransactionTtlMs = readInteger(
      options.oauthTransactionTtlMs,
      60_000,
      60 * 60 * 1000,
      OAUTH_TRANSACTION_TTL_MS
    );
    this.sessionTtlMs = readInteger(
      options.sessionTtlMs,
      60_000,
      400 * 24 * 60 * 60 * 1000,
      SESSION_TTL_MS
    );
    this.reservationTtlMs = readInteger(
      options.reservationTtlMs,
      10_000,
      60 * 60 * 1000,
      RESERVATION_TTL_MS
    );

    if (!this.priceCatalogVersion) {
      throw new TypeError("AI_PRICE_CATALOG_VERSION is invalid.");
    }
    if (!PRICE_CATALOGS[this.priceCatalogVersion]) {
      throw new TypeError(
        `AI_PRICE_CATALOG_VERSION ${this.priceCatalogVersion} is not supported.`
      );
    }
    if (!this.databasePath) {
      throw new TypeError("AI_ACCESS_DB_PATH is invalid.");
    }
    if (
      this.googleAuthEnabled &&
      this.databasePath === ":memory:" &&
      !this.allowInMemoryDatabaseForTests
    ) {
      throw new TypeError(
        "Google auth requires a persistent AI_ACCESS_DB_PATH; use allowInMemoryDatabaseForTests only in tests."
      );
    }
    if (!options.database && this.databasePath !== ":memory:") {
      fs.mkdirSync(path.dirname(path.resolve(this.databasePath)), {
        recursive: true,
        mode: 0o700,
      });
    }
    this.database = options.database || new DatabaseSync(this.databasePath);
    this.ownsDatabase = !options.database;
    configureDatabase(this.database, this.databasePath);
    migrateDatabase(this.database);
    seedPriceCatalog(
      this.database,
      this.priceCatalogVersion,
      PRICE_CATALOGS[this.priceCatalogVersion]
    );

    this.oauthClient = options.oauthClient || null;
    if (!this.oauthClient && this.googleClientId && this.googleClientSecret && this.redirectUri) {
      this.oauthClient = new OAuth2Client(
        this.googleClientId,
        this.googleClientSecret,
        this.redirectUri
      );
    }
  }

  get configuration() {
    const missing = [];
    if (!this.googleClientId) missing.push("GOOGLE_OAUTH_CLIENT_ID");
    if (!this.googleClientSecret && !this.oauthClient) {
      missing.push("GOOGLE_OAUTH_CLIENT_SECRET");
    }
    if (!isStrongSecret(this.identitySecret)) missing.push("AI_IDENTITY_SECRET");
    if (!isStrongSecret(this.sessionSecret)) missing.push("AI_SESSION_SECRET");
    if (!this.publicBaseUrl) missing.push("AI_PUBLIC_BASE_URL");
    if (!this.hasPersistentDatabasePath && this.databasePath === ":memory:") {
      missing.push("AI_ACCESS_DB_PATH");
    }
    if (!this.oauthClient) missing.push("google_oauth_client");
    return {
      enabled: this.googleAuthEnabled,
      required: this.googleAuthRequired,
      configured: missing.length === 0,
      missing,
      redirectUri: this.redirectUri,
      priceCatalogVersion: this.priceCatalogVersion,
    };
  }

  async getPublicStatus(req, res) {
    const config = this.configuration;
    let session = null;
    let budget = null;

    if (this.googleAuthEnabled) {
      this._deleteExpiredAuthSessions(this._now());
    }
    if (this.googleAuthEnabled && config.configured) {
      const device = this._resolveDevice(req, res, { create: false });
      if (device) {
        session = this._resolveSession(req, res, device.id);
        if (session) budget = this._readBudget(device.id, session.account_hash);
      }
    }

    const payload = {
      ok: true,
      mode: this.googleAuthEnabled ? "google" : "public",
      configured: !this.googleAuthEnabled || config.configured,
      authEnabled: this.googleAuthEnabled,
      authRequired: this.googleAuthRequired,
      authConfigured: config.configured,
      authenticated: Boolean(session),
      user: session ? { emailMasked: session.masked_email } : null,
      quota: budget ? toPublicQuota(budget) : null,
      account: session ? { maskedEmail: session.masked_email } : null,
      budget: budget ? toDiagnosticBudget(budget) : null,
      loginPath: "/api/avr/ai/auth/google/start",
      logoutPath: "/api/avr/ai/auth/logout",
    };
    sendJson(res, 200, payload);
    return payload;
  }

  authenticateAccountWorkspaceRequest(req, res) {
    if (!this.googleAuthEnabled) {
      throw new AiAccessError(
        401,
        "google_sign_in_required",
        "Sign in with Google to use account workspace storage."
      );
    }

    this._deleteExpiredAuthSessions(this._now());
    this._assertConfigured();
    const device = this._resolveDevice(req, res, { create: false });
    const session = device ? this._resolveSession(req, res, device.id) : null;
    if (!session) {
      throw new AiAccessError(
        401,
        "google_sign_in_required",
        "Sign in with Google to use account workspace storage."
      );
    }

    return Object.freeze({
      accountHash: session.account_hash,
      accountKey: this._identityHash(
        "account-workspace-client",
        session.account_hash
      ),
      deviceId: device.id,
    });
  }

  readAccountWorkspace(context) {
    const accountHash = readWorkspaceAccountHash(context);
    return {
      accountKey: readWorkspaceAccountKey(context),
      documents: Object.fromEntries(
        ACCOUNT_WORKSPACE_TYPES.map((dataType) => [
          dataType,
          this._readAccountWorkspaceRecord(accountHash, dataType),
        ])
      ),
    };
  }

  writeAccountWorkspace(context, rawDataType, rawInput) {
    const accountHash = readWorkspaceAccountHash(context);
    const accountKey = readWorkspaceAccountKey(context);
    const dataType = normalizeAccountWorkspaceType(rawDataType);
    const input = normalizeAccountWorkspaceWrite(dataType, rawInput);
    if (input.expectedAccountKey !== accountKey) {
      throw new AiAccessError(
        409,
        "account_workspace_account_mismatch",
        "The signed-in account changed before this workspace could be saved. Reload the account workspace before saving again."
      );
    }
    const now = this._now();
    let record;

    this._transaction(() => {
      const existing = this.database
        .prepare(
          `SELECT revision, created_at
             FROM account_workspace_snapshots
            WHERE account_hash = ? AND data_type = ?`
        )
        .get(accountHash, dataType);
      const currentRevision = Number(existing?.revision || 0);
      if (input.baseRevision !== currentRevision) {
        throw new AiAccessError(
          409,
          "account_data_revision_conflict",
          "The account workspace changed in another session. Reload it before saving again."
        );
      }

      const revision = currentRevision + 1;
      if (existing) {
        this.database
          .prepare(
            `UPDATE account_workspace_snapshots
                SET revision = ?, schema_version = ?, payload_json = ?,
                    payload_bytes = ?, updated_at = ?
              WHERE account_hash = ? AND data_type = ? AND revision = ?`
          )
          .run(
            revision,
            input.schemaVersion,
            input.payloadJson,
            input.payloadBytes,
            now,
            accountHash,
            dataType,
            currentRevision
          );
      } else {
        this.database
          .prepare(
            `INSERT INTO account_workspace_snapshots
               (account_hash, data_type, revision, schema_version,
                payload_json, payload_bytes, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            accountHash,
            dataType,
            revision,
            input.schemaVersion,
            input.payloadJson,
            input.payloadBytes,
            now,
            now
          );
      }

      record = {
        revision,
        schemaVersion: input.schemaVersion,
        updatedAt: now,
        data: input.data,
      };
    });

    return {
      type: dataType,
      accountKey: readWorkspaceAccountKey(context),
      document: record,
    };
  }

  async beginGoogleLogin(req, res) {
    this._assertAuthEnabled();
    const createdAt = this._now();
    this._deleteExpiredAuthSessions(createdAt);
    this._assertConfigured();
    const device = this._resolveDevice(req, res, { create: true });
    const state = this._randomToken(32);
    const nonce = this._randomToken(32);
    const codeVerifier = this._randomToken(48);
    const codeChallenge = crypto
      .createHash("sha256")
      .update(codeVerifier, "utf8")
      .digest("base64url");
    const expiresAt = createdAt + this.oauthTransactionTtlMs;

    this._transaction(() => {
      this.database
        .prepare("DELETE FROM oauth_transactions WHERE expires_at <= ?")
        .run(createdAt);
      this._deleteOrphanDevices(
        createdAt - this.oauthTransactionTtlMs,
        device.id
      );
      this.database
        .prepare(
          `INSERT INTO oauth_transactions
            (state_hash, device_id, nonce_hash, code_verifier, redirect_uri, created_at, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          this._identityHash("oauth-state", state),
          device.id,
          this._identityHash("oauth-nonce", nonce),
          codeVerifier,
          this.redirectUri,
          createdAt,
          expiresAt
        );
    });

    const authorizationUrl = this.oauthClient.generateAuthUrl({
      access_type: "online",
      redirect_uri: this.redirectUri,
      scope: ["openid", "email"],
      prompt: "select_account",
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    });
    const result = { ok: true, redirectUrl: authorizationUrl };
    if (acceptsJson(req)) {
      sendJson(res, 200, result);
    } else {
      sendRedirect(res, authorizationUrl);
    }
    return result;
  }

  async completeGoogleLogin(req, res, requestUrl) {
    this._assertAuthEnabled();
    this._assertConfigured();
    const url = parseUrl(requestUrl, this.publicBaseUrl);
    const state = url.searchParams.get("state") || "";
    const code = url.searchParams.get("code") || "";
    const oauthError = url.searchParams.get("error") || "";
    if (!state || (!code && !oauthError)) {
      throw new AiAccessError(
        400,
        "oauth_callback_invalid",
        "The Google sign-in response is invalid."
      );
    }

    const now = this._now();
    const stateHash = this._identityHash("oauth-state", state);
    const callbackDeviceId = this._verifyDeviceCookie(
      readCookie(req, DEVICE_COOKIE)
    );
    let transaction;
    this._transaction(() => {
      this.database
        .prepare("DELETE FROM oauth_transactions WHERE expires_at <= ?")
        .run(now);
      this._deleteExpiredAuthSessions(now);
      transaction = this.database
        .prepare(
          `SELECT state_hash, device_id, nonce_hash, code_verifier, redirect_uri,
                  created_at, expires_at
             FROM oauth_transactions
            WHERE state_hash = ?`
        )
        .get(stateHash);
      if (!transaction) return;
      if (
        !callbackDeviceId ||
        !safeEqual(callbackDeviceId, transaction.device_id)
      ) {
        throw new AiAccessError(
          400,
          "oauth_device_mismatch",
          "The Google sign-in request does not belong to this device."
        );
      }
      this.database
        .prepare("DELETE FROM oauth_transactions WHERE state_hash = ?")
        .run(stateHash);
    });
    if (!transaction) {
      throw new AiAccessError(
        400,
        "oauth_transaction_invalid",
        "The Google sign-in request expired or was already used."
      );
    }
    if (oauthError) {
      throw new AiAccessError(
        401,
        "google_sign_in_denied",
        "Google sign-in was not completed."
      );
    }
    let tokenResponse;
    try {
      tokenResponse = await this.oauthClient.getToken({
        code,
        codeVerifier: transaction.code_verifier,
        redirect_uri: transaction.redirect_uri,
      });
    } catch {
      throw new AiAccessError(
        502,
        "google_token_exchange_failed",
        "Google sign-in could not be verified."
      );
    }
    const idToken = tokenResponse?.tokens?.id_token || tokenResponse?.id_token || "";
    if (!idToken) {
      throw new AiAccessError(
        502,
        "google_id_token_missing",
        "Google sign-in did not return an identity token."
      );
    }

    let payload;
    try {
      const ticket = await this.oauthClient.verifyIdToken({
        idToken,
        audience: this.googleClientId,
      });
      payload = ticket?.getPayload?.() || null;
    } catch {
      throw new AiAccessError(
        401,
        "google_identity_invalid",
        "The Google identity token is invalid."
      );
    }
    if (
      !payload ||
      !payload.sub ||
      !payload.nonce ||
      !safeEqual(
        this._identityHash("oauth-nonce", String(payload.nonce)),
        transaction.nonce_hash
      )
    ) {
      throw new AiAccessError(
        401,
        "google_identity_invalid",
        "The Google identity token is invalid."
      );
    }
    if (
      typeof payload.email !== "string" ||
      !payload.email.trim() ||
      payload.email_verified !== true
    ) {
      throw new AiAccessError(
        401,
        "google_email_unverified",
        "A verified Google email address is required."
      );
    }

    const device = this.database
      .prepare("SELECT id FROM devices WHERE id = ?")
      .get(transaction.device_id);
    if (!device) {
      throw new AiAccessError(
        400,
        "oauth_device_invalid",
        "The device associated with this sign-in no longer exists."
      );
    }
    const accountHash = this._identityHash("google-sub", String(payload.sub));
    const emailMasked = maskEmail(payload.email);
    const sessionToken = this._randomToken(32);
    const sessionHash = this._sessionHash(sessionToken);
    const expiresAt = now + this.sessionTtlMs;

    this._transaction(() => {
      const existingAccount = this.database
        .prepare(
          `SELECT 1 AS found
             FROM google_accounts
            WHERE account_hash = ?`
        )
        .get(accountHash);
      if (existingAccount) {
        this.database
          .prepare(
            `UPDATE google_accounts
                SET masked_email = ?, last_seen_at = ?
              WHERE account_hash = ?`
          )
          .run(emailMasked, now, accountHash);
      } else {
        const sourceBudget = this._readDeviceBudget(device.id);
        const initialAccountGrantNanoUsd = Math.min(
          this.freeDeviceGrantNanoUsd,
          Number(sourceBudget?.remaining_nano_usd || 0)
        );
        this.database
          .prepare(
            `INSERT INTO google_accounts
               (account_hash, masked_email, grant_source_device_id,
                grant_nano_usd, spent_nano_usd, created_at, last_seen_at)
             VALUES (?, ?, ?, ?, 0, ?, ?)`
          )
          .run(
            accountHash,
            emailMasked,
            device.id,
            initialAccountGrantNanoUsd,
            now,
            now
          );
      }
      this.database
        .prepare(
          `INSERT INTO device_account_links
             (device_id, account_hash, created_at, last_seen_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(device_id, account_hash) DO UPDATE SET
             last_seen_at = excluded.last_seen_at`
        )
        .run(device.id, accountHash, now, now);
      this.database
        .prepare(
          `INSERT INTO auth_sessions
             (session_hash, device_id, account_hash, created_at, last_seen_at, expires_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(sessionHash, device.id, accountHash, now, now, expiresAt);
    });

    this._setDeviceCookie(res, device.id);
    setCookie(res, SESSION_COOKIE, sessionToken, {
      maxAge: Math.floor(this.sessionTtlMs / 1000),
    });
    const successUrl = new URL("/avr", this.publicBaseUrl);
    successUrl.searchParams.set("ai_auth", "success");
    sendRedirect(res, successUrl.toString());
    return {
      redirectUrl: successUrl.toString(),
      user: { emailMasked },
    };
  }

  async logout(req, res) {
    if (isStrongSecret(this.sessionSecret)) {
      const token = readCookie(req, SESSION_COOKIE);
      if (token) {
        this.database
          .prepare("DELETE FROM auth_sessions WHERE session_hash = ?")
          .run(this._sessionHash(token));
      }
    }
    clearCookie(res, SESSION_COOKIE);
    const payload = { ok: true, authenticated: false, user: null };
    sendJson(res, 200, payload);
    return payload;
  }

  async authorizeAiRequest(req, res, metadata = {}) {
    const suppliedRequestId = normalizeOptionalRequestId(metadata?.requestId);
    if (!this.googleAuthEnabled) {
      return {
        authorized: true,
        mode: "public",
        reservationId: null,
        requestId: suppliedRequestId || null,
        priceCatalogVersion: this.priceCatalogVersion,
      };
    }
    const accessConfiguration = this.configuration;
    this._deleteExpiredAuthSessions(this._now());
    if (!accessConfiguration.configured) {
      if (!this.googleAuthRequired) {
        return {
          authorized: true,
          mode: "public",
          reservationId: null,
          requestId: suppliedRequestId || null,
          priceCatalogVersion: this.priceCatalogVersion,
        };
      }
      this._assertConfigured();
    }
    const device = this._resolveDevice(req, res, { create: false });
    const session = device ? this._resolveSession(req, res, device.id) : null;
    if (!session) {
      if (!this.googleAuthRequired) {
        return {
          authorized: true,
          mode: "public",
          reservationId: null,
          requestId: suppliedRequestId || null,
          priceCatalogVersion: this.priceCatalogVersion,
        };
      }
      throw new AiAccessError(
        401,
        "google_sign_in_required",
        "Sign in with Google to use the AI assistant."
      );
    }
    const reservationId = this._randomToken(24);
    const boundRequestId = suppliedRequestId || `internal:${reservationId}`;
    const now = this._now();
    const expiresAt = now + this.reservationTtlMs;
    let budget;

    this._transaction(() => {
      this.database
        .prepare(
          `DELETE FROM inflight_requests
            WHERE state IN ('authorized', 'reserved') AND expires_at <= ?`
        )
        .run(now);
      this.database
        .prepare(
          `UPDATE inflight_requests SET state = 'needs_reconciliation'
            WHERE state = 'provider_started' AND expires_at <= ?`
        )
        .run(now);
      budget = this._readBudget(device.id, session.account_hash);
      if (!budget || budget.remaining_nano_usd <= 0) {
        throw new AiAccessError(
          429,
          "free_quota_exhausted",
          "The free AI credit budget for this device has been used."
        );
      }
      const globalCount = Number(
        this.database
          .prepare(
            `SELECT COUNT(*) AS count FROM inflight_requests
              WHERE state IN ('authorized', 'reserved', 'provider_started')
                AND expires_at > ?`
          )
          .get(now).count
      );
      if (globalCount >= this.maxGlobalInFlight) {
        throw new AiAccessError(
          429,
          "ai_busy",
          "The AI assistant is busy. Try again shortly."
        );
      }
      const deviceCount = Number(
        this.database
          .prepare(
            `SELECT COUNT(*) AS count FROM inflight_requests
              WHERE device_id = ?
                AND state IN ('authorized', 'reserved', 'provider_started')
                AND expires_at > ?`
          )
          .get(device.id, now).count
      );
      if (deviceCount >= this.maxDeviceInFlight) {
        throw new AiAccessError(
          429,
          "device_ai_busy",
          "This device already has an AI request in progress."
        );
      }
      if (
        suppliedRequestId &&
        (this.database
          .prepare("SELECT 1 AS found FROM usage_ledger WHERE request_id = ?")
          .get(suppliedRequestId) ||
          this.database
            .prepare("SELECT 1 AS found FROM inflight_requests WHERE request_id = ?")
            .get(suppliedRequestId))
      ) {
        throw new AiAccessError(
          409,
          "request_id_conflict",
          "The request identifier is already associated with recorded AI usage."
        );
      }
      this.database
        .prepare(
          `INSERT INTO inflight_requests
             (reservation_id, request_id, device_id, source_device_id,
              account_hash, reserved_nano_usd, actual_nano_usd,
              state, provider, provider_response_id,
              created_at, expires_at)
           VALUES (?, ?, ?, ?, ?, 0, NULL, 'authorized', NULL, NULL, ?, ?)`
        )
        .run(
          reservationId,
          boundRequestId,
          device.id,
          session.grant_source_device_id,
          session.account_hash,
          now,
          expiresAt
        );
    });

    return {
      authorized: true,
      mode: "google",
      reservationId,
      requestId: boundRequestId,
      deviceId: device.id,
      sourceDeviceId: session.grant_source_device_id,
      accountHash: session.account_hash,
      safetyIdentifier: `ud_${device.id}`,
      priceCatalogVersion: this.priceCatalogVersion,
      remainingNanoUsd: budget.remaining_nano_usd,
      remainingCredits: nanoUsdToCredits(budget.remaining_nano_usd),
    };
  }

  async bindAiRequest(context, { requestId } = {}) {
    const normalizedRequestId = normalizeOptionalRequestId(requestId, {
      required: true,
    });
    if (!context || context.mode === "public") {
      if (context && typeof context === "object") {
        context.requestId = normalizedRequestId;
      }
      return { bound: false, mode: "public", requestId: normalizedRequestId };
    }
    if (!context.reservationId) {
      throw new AiAccessError(
        500,
        "invalid_access_context",
        "The AI access context is invalid."
      );
    }
    let result;
    this._transaction(() => {
      const inflight = this.database
        .prepare(
          `SELECT request_id, state FROM inflight_requests
            WHERE reservation_id = ?`
        )
        .get(context.reservationId);
      if (!inflight) {
        throw new AiAccessError(
          409,
          "access_reservation_missing",
          "The AI access reservation is missing or no longer valid."
        );
      }
      if (inflight.request_id === normalizedRequestId) {
        result = { bound: true, duplicate: true, requestId: normalizedRequestId };
        return;
      }
      if (inflight.state !== "authorized") {
        throw new AiAccessError(
          409,
          "request_binding_state_conflict",
          "The request identifier cannot change after budget reservation."
        );
      }
      const conflict = this.database
        .prepare(
          `SELECT reservation_id FROM inflight_requests
            WHERE request_id = ? AND reservation_id <> ?`
        )
        .get(normalizedRequestId, context.reservationId);
      const recordedConflict = this.database
        .prepare("SELECT 1 AS found FROM usage_ledger WHERE request_id = ?")
        .get(normalizedRequestId);
      if (conflict || recordedConflict) {
        throw new AiAccessError(
          409,
          "request_id_conflict",
          "The request identifier is already associated with another AI request."
        );
      }
      const updated = this.database
        .prepare(
          `UPDATE inflight_requests SET request_id = ?
            WHERE reservation_id = ? AND state = 'authorized'`
        )
        .run(normalizedRequestId, context.reservationId);
      if (Number(updated.changes) !== 1) {
        throw new AiAccessError(
          409,
          "request_binding_state_conflict",
          "The request identifier could not be bound to this AI request."
        );
      }
      result = { bound: true, duplicate: false, requestId: normalizedRequestId };
    });
    context.requestId = normalizedRequestId;
    return result;
  }

  async reserveAiBudget(
    context,
    { model, inputTokens, maxOutputTokens, minOutputTokens = 1024 } = {}
  ) {
    if (!context || context.mode === "public") {
      return {
        reserved: false,
        mode: "public",
        maxOutputTokens: readUsageInteger(maxOutputTokens),
        reservedNanoUsd: 0,
        reservedCredits: 0,
        quota: null,
      };
    }
    if (
      !context.reservationId ||
      !context.deviceId ||
      !context.accountHash
    ) {
      throw new AiAccessError(
        500,
        "invalid_access_context",
        "The AI access context is invalid."
      );
    }
    const normalizedInputTokens = readUsageInteger(inputTokens);
    const normalizedMaxOutputTokens = readRequiredUsageInteger(
      maxOutputTokens,
      "maxOutputTokens"
    );
    const normalizedMinOutputTokens = readUsageInteger(minOutputTokens);
    if (normalizedMaxOutputTokens < normalizedMinOutputTokens) {
      throw new AiAccessError(
        400,
        "output_budget_invalid",
        "maxOutputTokens cannot be lower than minOutputTokens."
      );
    }
    const catalogModel = resolveCatalogModel(model);
    const price = readCatalogPrice(
      this.database,
      catalogModel,
      this.priceCatalogVersion
    );
    if (!price) {
      throw new AiAccessError(
        503,
        "model_price_unavailable",
        "The AI model price is not configured."
      );
    }
    const longContext = normalizedInputTokens > price.longContextThreshold;
    const tier = longContext ? "long_context" : "standard";
    const inputRate = longContext
      ? price.longCacheWriteNanoUsdPerToken
      : price.cacheWriteNanoUsdPerToken;
    const outputRate = longContext
      ? price.longOutputNanoUsdPerToken
      : price.outputNanoUsdPerToken;
    const inputCostNanoUsd = multiplyCost(
      normalizedInputTokens,
      inputRate
    );
    const minimumOutputCostNanoUsd = multiplyCost(
      normalizedMinOutputTokens,
      outputRate
    );
    const minimumRequiredNanoUsd = addCosts(
      inputCostNanoUsd,
      minimumOutputCostNanoUsd
    );
    let result;

    this._transaction(() => {
      const inflight = this.database
        .prepare(
          `SELECT reservation_id, request_id, device_id, source_device_id,
                  account_hash, state,
                  reserved_nano_usd, reservation_model, reservation_tier,
                  reservation_input_tokens, reservation_max_output_tokens
             FROM inflight_requests
            WHERE reservation_id = ?`
        )
        .get(context.reservationId);
      if (
        !inflight ||
        inflight.device_id !== context.deviceId ||
        inflight.account_hash !== context.accountHash ||
        (context.sourceDeviceId &&
          inflight.source_device_id !== context.sourceDeviceId)
      ) {
        throw new AiAccessError(
          409,
          "access_reservation_missing",
          "The AI access reservation is missing or no longer valid."
        );
      }
      if (inflight.state === "needs_reconciliation") {
        throw new AiAccessError(
          503,
          "budget_reconciliation_required",
          "This AI usage reservation requires reconciliation."
        );
      }
      if (inflight.state === "reserved") {
        const storedMaxOutputTokens = Number(
          inflight.reservation_max_output_tokens
        );
        if (
          inflight.reservation_model !== catalogModel ||
          inflight.reservation_tier !== tier ||
          Number(inflight.reservation_input_tokens) !== normalizedInputTokens ||
          storedMaxOutputTokens < normalizedMinOutputTokens ||
          storedMaxOutputTokens > normalizedMaxOutputTokens
        ) {
          throw new AiAccessError(
            409,
            "budget_already_reserved",
            "This AI request already has a different budget reservation."
          );
        }
        const currentBudget = this._readBudget(
          context.deviceId,
          context.accountHash
        );
        result = {
          reserved: true,
          duplicate: true,
          requestId: inflight.request_id,
          sourceDeviceId: inflight.source_device_id,
          model: catalogModel,
          tier,
          inputTokens: normalizedInputTokens,
          maxOutputTokens: storedMaxOutputTokens,
          reservedNanoUsd: Number(inflight.reserved_nano_usd),
          reservedCredits: nanoUsdToCredits(Number(inflight.reserved_nano_usd)),
          quota: toPublicQuota(currentBudget),
        };
        return;
      }
      if (inflight.state !== "authorized") {
        throw new AiAccessError(
          409,
          "budget_reservation_state_conflict",
          "AI credits can only be reserved for a newly authorized request."
        );
      }

      const available = this._readBudget(
        context.deviceId,
        context.accountHash
      );
      if (!available || available.remaining_nano_usd < minimumRequiredNanoUsd) {
        throw new AiAccessError(
          429,
          "free_quota_insufficient",
          "The remaining free AI credits cannot cover this request."
        );
      }
      const affordableOutputTokens = Math.floor(
        (available.remaining_nano_usd - inputCostNanoUsd) / outputRate
      );
      const cappedMaxOutputTokens = Math.min(
        normalizedMaxOutputTokens,
        affordableOutputTokens
      );
      if (cappedMaxOutputTokens < normalizedMinOutputTokens) {
        throw new AiAccessError(
          429,
          "free_quota_insufficient",
          "The remaining free AI credits cannot cover this request."
        );
      }
      const reservedNanoUsd = addCosts(
        inputCostNanoUsd,
        multiplyCost(cappedMaxOutputTokens, outputRate)
      );
      const updated = this.database
        .prepare(
          `UPDATE inflight_requests
              SET state = 'reserved', reserved_nano_usd = ?,
                  reservation_model = ?, reservation_tier = ?,
                  reservation_input_tokens = ?, reservation_max_output_tokens = ?
            WHERE reservation_id = ? AND state = 'authorized'`
        )
        .run(
          reservedNanoUsd,
          catalogModel,
          tier,
          normalizedInputTokens,
          cappedMaxOutputTokens,
          context.reservationId
        );
      if (Number(updated.changes) !== 1) {
        throw new AiAccessError(
          409,
          "budget_reservation_state_conflict",
          "The AI credit reservation state changed before it could be saved."
        );
      }
      const updatedBudget = this._readBudget(
        context.deviceId,
        context.accountHash
      );
      result = {
        reserved: true,
        duplicate: false,
        requestId: inflight.request_id,
        sourceDeviceId: inflight.source_device_id,
        model: catalogModel,
        tier,
        inputTokens: normalizedInputTokens,
        maxOutputTokens: cappedMaxOutputTokens,
        reservedNanoUsd,
        reservedCredits: nanoUsdToCredits(reservedNanoUsd),
        quota: toPublicQuota(updatedBudget),
      };
    });

    context.budgetReserved = true;
    context.sourceDeviceId = result.sourceDeviceId;
    context.reservedNanoUsd = result.reservedNanoUsd;
    context.maxOutputTokens = result.maxOutputTokens;
    return result;
  }

  async extendAiBudgetReservation(
    context,
    {
      model,
      additionalInputTokens,
      additionalMaxOutputTokens,
      minAdditionalOutputTokens = 1024,
    } = {}
  ) {
    if (!context || context.mode === "public") {
      return {
        reserved: false,
        mode: "public",
        additionalMaxOutputTokens: readUsageInteger(
          additionalMaxOutputTokens
        ),
        quota: null,
      };
    }
    if (!context.reservationId || !context.deviceId || !context.accountHash) {
      throw new AiAccessError(
        500,
        "invalid_access_context",
        "The AI access context is invalid."
      );
    }
    const normalizedAdditionalInputTokens = readUsageInteger(
      additionalInputTokens
    );
    const normalizedAdditionalMaxOutputTokens = readRequiredUsageInteger(
      additionalMaxOutputTokens,
      "additionalMaxOutputTokens"
    );
    const normalizedMinAdditionalOutputTokens = readUsageInteger(
      minAdditionalOutputTokens
    );
    if (
      normalizedAdditionalMaxOutputTokens <
      normalizedMinAdditionalOutputTokens
    ) {
      throw new AiAccessError(
        400,
        "output_budget_invalid",
        "additionalMaxOutputTokens cannot be lower than minAdditionalOutputTokens."
      );
    }
    const catalogModel = resolveCatalogModel(model);
    const price = readCatalogPrice(
      this.database,
      catalogModel,
      this.priceCatalogVersion
    );
    if (!price) {
      throw new AiAccessError(
        503,
        "model_price_unavailable",
        "The AI model price is not configured."
      );
    }

    let result;
    this._transaction(() => {
      const inflight = this.database
        .prepare(
          `SELECT request_id, device_id, source_device_id, account_hash,
                  state, reserved_nano_usd, reservation_model,
                  reservation_input_tokens, reservation_max_output_tokens
             FROM inflight_requests
            WHERE reservation_id = ?`
        )
        .get(context.reservationId);
      if (
        !inflight ||
        inflight.device_id !== context.deviceId ||
        inflight.account_hash !== context.accountHash ||
        (context.sourceDeviceId &&
          inflight.source_device_id !== context.sourceDeviceId)
      ) {
        throw new AiAccessError(
          409,
          "access_reservation_missing",
          "The AI access reservation is missing or no longer valid."
        );
      }
      if (inflight.state === "needs_reconciliation") {
        throw new AiAccessError(
          503,
          "budget_reconciliation_required",
          "This AI usage reservation requires reconciliation."
        );
      }
      if (inflight.state !== "provider_started") {
        throw new AiAccessError(
          409,
          "budget_extension_state_conflict",
          "An AI budget can only be extended after the provider call starts."
        );
      }
      if (inflight.reservation_model !== catalogModel) {
        throw new AiAccessError(
          409,
          "reserved_model_mismatch",
          "The AI budget extension uses a different model."
        );
      }

      const cumulativeInputTokens = addUsageCounts(
        Number(inflight.reservation_input_tokens),
        normalizedAdditionalInputTokens
      );
      const previousMaxOutputTokens = Number(
        inflight.reservation_max_output_tokens
      );
      const longContext = cumulativeInputTokens > price.longContextThreshold;
      const tier = longContext ? "long_context" : "standard";
      const additionalLongContext =
        normalizedAdditionalInputTokens > price.longContextThreshold;
      const inputRate = additionalLongContext
        ? price.longCacheWriteNanoUsdPerToken
        : price.cacheWriteNanoUsdPerToken;
      const outputRate = additionalLongContext
        ? price.longOutputNanoUsdPerToken
        : price.outputNanoUsdPerToken;
      const inputCostNanoUsd = multiplyCost(
        normalizedAdditionalInputTokens,
        inputRate
      );
      const currentBudget = this._readBudget(
        context.deviceId,
        context.accountHash
      );
      const availableAdditionalNanoUsd = Number(
        currentBudget?.remaining_nano_usd || 0
      );
      const minimumRequiredNanoUsd = addCosts(
        inputCostNanoUsd,
        multiplyCost(normalizedMinAdditionalOutputTokens, outputRate)
      );
      if (availableAdditionalNanoUsd < minimumRequiredNanoUsd) {
        throw new AiAccessError(
          429,
          "free_quota_insufficient",
          "The remaining free AI credits cannot cover an automatic compiler repair."
        );
      }
      const affordableAdditionalOutputTokens = Math.floor(
        (availableAdditionalNanoUsd - inputCostNanoUsd) / outputRate
      );
      const allowedAdditionalMaxOutputTokens = Math.min(
        normalizedAdditionalMaxOutputTokens,
        affordableAdditionalOutputTokens
      );
      if (
        allowedAdditionalMaxOutputTokens <
        normalizedMinAdditionalOutputTokens
      ) {
        throw new AiAccessError(
          429,
          "free_quota_insufficient",
          "The remaining free AI credits cannot cover an automatic compiler repair."
        );
      }
      const cumulativeMaxOutputTokens = addUsageCounts(
        previousMaxOutputTokens,
        allowedAdditionalMaxOutputTokens
      );
      const reservedNanoUsd = addCosts(
        Number(inflight.reserved_nano_usd),
        addCosts(
          inputCostNanoUsd,
          multiplyCost(allowedAdditionalMaxOutputTokens, outputRate)
        )
      );
      const updated = this.database
        .prepare(
          `UPDATE inflight_requests
              SET reserved_nano_usd = ?, reservation_tier = ?,
                  reservation_input_tokens = ?,
                  reservation_max_output_tokens = ?
            WHERE reservation_id = ? AND state = 'provider_started'`
        )
        .run(
          reservedNanoUsd,
          tier,
          cumulativeInputTokens,
          cumulativeMaxOutputTokens,
          context.reservationId
        );
      if (Number(updated.changes) !== 1) {
        throw new AiAccessError(
          409,
          "budget_extension_state_conflict",
          "The AI budget reservation changed before it could be extended."
        );
      }
      const updatedBudget = this._readBudget(
        context.deviceId,
        context.accountHash
      );
      result = {
        reserved: true,
        requestId: inflight.request_id,
        model: catalogModel,
        tier,
        additionalInputTokens: normalizedAdditionalInputTokens,
        additionalMaxOutputTokens: allowedAdditionalMaxOutputTokens,
        cumulativeInputTokens,
        cumulativeMaxOutputTokens,
        reservedNanoUsd,
        reservedCredits: nanoUsdToCredits(reservedNanoUsd),
        quota: toPublicQuota(updatedBudget),
      };
    });

    context.reservedNanoUsd = result.reservedNanoUsd;
    context.maxOutputTokens = result.cumulativeMaxOutputTokens;
    return result;
  }

  async markAiProviderStarted(context) {
    if (!context || context.mode === "public") return false;
    if (!context.reservationId) {
      throw new AiAccessError(
        500,
        "invalid_access_context",
        "The AI access context is invalid."
      );
    }
    let started = false;
    this._transaction(() => {
      const inflight = this.database
        .prepare(
          "SELECT state FROM inflight_requests WHERE reservation_id = ?"
        )
        .get(context.reservationId);
      if (!inflight) {
        throw new AiAccessError(
          409,
          "access_reservation_missing",
          "The AI access reservation is missing or no longer valid."
        );
      }
      if (inflight.state === "provider_started") {
        started = true;
        return;
      }
      if (inflight.state !== "reserved") {
        throw new AiAccessError(
          409,
          "budget_not_reserved",
          "AI credits must be reserved before contacting the provider."
        );
      }
      this.database
        .prepare(
          `UPDATE inflight_requests
              SET state = 'provider_started'
            WHERE reservation_id = ? AND state = 'reserved'`
        )
        .run(context.reservationId);
      started = true;
    });
    context.providerStarted = true;
    return started;
  }

  async recordAiUsage(
    context,
    {
      requestId,
      provider,
      responseId,
      providerResponseId,
      model,
      usage,
      responses,
    } = {}
  ) {
    if (!context || context.mode === "public") {
      return {
        recorded: false,
        mode: "public",
        costNanoUsd: 0,
        costCredits: 0,
        quota: null,
      };
    }
    if (!context.reservationId || !context.deviceId || !context.accountHash) {
      throw new AiAccessError(
        500,
        "invalid_access_context",
        "The AI access context is invalid."
      );
    }
    const normalizedRequestId = normalizeIdentifier(requestId, 160);
    if (!normalizedRequestId) {
      throw new AiAccessError(
        500,
        "usage_request_id_missing",
        "AI usage could not be recorded without a request identifier."
      );
    }
    const composite = normalizeCompositeProviderUsage(responses, {
      provider,
      responseId: firstDefined(providerResponseId, responseId),
      model,
      usage,
    });
    const normalizedProvider = composite.provider;
    const normalizedProviderResponseId = composite.providerResponseId;
    if (!normalizedProvider || !normalizedProviderResponseId) {
      throw new AiAccessError(
        500,
        "provider_usage_id_missing",
        "AI usage could not be recorded without a provider response identifier."
      );
    }
    const catalogModel = composite.model;
    const price = readCatalogPrice(
      this.database,
      catalogModel,
      this.priceCatalogVersion
    );
    if (!price) {
      throw new AiAccessError(
        503,
        "model_price_unavailable",
        "The AI model price is not configured."
      );
    }
    const normalizedUsage = composite.usage;
    const calculated = composite.segments
      ? calculateCompositeUsageCost(composite.segments, price)
      : calculateUsageCostNanoUsd(normalizedUsage, price);
    const now = this._now();
    let result;
    let reconciliation = null;

    this._transaction(() => {
      const existingRows = this.database
        .prepare(
          `SELECT request_id, provider, provider_response_id, device_id,
                  source_device_id, account_hash, model,
                  price_catalog_version, cost_nano_usd,
                  tier, input_tokens, cached_input_tokens, cache_write_tokens,
                  output_tokens, reasoning_tokens, total_tokens
             FROM usage_ledger
            WHERE request_id = ?
               OR (provider = ? AND provider_response_id = ?)`
        )
        .all(
          normalizedRequestId,
          normalizedProvider,
          normalizedProviderResponseId
        );
      if (existingRows.length) {
        const existing = existingRows[0];
        if (
          existingRows.length > 1 ||
          existing.device_id !== context.deviceId ||
          (context.sourceDeviceId &&
            existing.source_device_id !== context.sourceDeviceId) ||
          existing.account_hash !== context.accountHash ||
          existing.model !== catalogModel ||
          existing.price_catalog_version !== this.priceCatalogVersion ||
          existing.tier !== calculated.tier ||
          Number(existing.cost_nano_usd) !== calculated.costNanoUsd ||
          Number(existing.input_tokens) !== normalizedUsage.inputTokens ||
          Number(existing.cached_input_tokens) !==
            normalizedUsage.cachedInputTokens ||
          Number(existing.cache_write_tokens) !==
            normalizedUsage.cacheWriteTokens ||
          Number(existing.output_tokens) !== normalizedUsage.outputTokens ||
          Number(existing.reasoning_tokens) !==
            normalizedUsage.reasoningTokens ||
          Number(existing.total_tokens) !== normalizedUsage.totalTokens ||
          (existing.request_id === normalizedRequestId &&
            (existing.provider !== normalizedProvider ||
              existing.provider_response_id !== normalizedProviderResponseId))
        ) {
          throw new AiAccessError(
            409,
            "usage_request_conflict",
            "The AI usage request identifier is already in use."
          );
        }
        const duplicateReservation = this.database
          .prepare(
            `SELECT state FROM inflight_requests WHERE reservation_id = ?`
          )
          .get(context.reservationId);
        if (
          duplicateReservation &&
          duplicateReservation.state !== "needs_reconciliation"
        ) {
          this.database
            .prepare("DELETE FROM inflight_requests WHERE reservation_id = ?")
            .run(context.reservationId);
        }
        const existingBudget = this._readBudget(
          context.deviceId,
          context.accountHash
        );
        result = {
          recorded: false,
          duplicate: true,
          provider: existing.provider,
          providerResponseId: existing.provider_response_id,
          sourceDeviceId: existing.source_device_id,
          model: existing.model,
          tier: existing.tier,
          priceCatalogVersion: existing.price_catalog_version,
          costNanoUsd: Number(existing.cost_nano_usd),
          costCredits: nanoUsdToCredits(Number(existing.cost_nano_usd)),
          remainingNanoUsd: existingBudget.remaining_nano_usd,
          remainingCredits: nanoUsdToCredits(existingBudget.remaining_nano_usd),
          quota: toPublicQuota(existingBudget),
        };
        return;
      }

      const duplicateInflight = this.database
        .prepare(
          `SELECT reservation_id, state
             FROM inflight_requests
            WHERE provider = ? AND provider_response_id = ?
              AND reservation_id <> ?`
        )
        .get(
          normalizedProvider,
          normalizedProviderResponseId,
          context.reservationId
        );
      if (duplicateInflight) {
        throw new AiAccessError(
          409,
          duplicateInflight.state === "needs_reconciliation"
            ? "budget_reconciliation_required"
            : "provider_response_conflict",
          "This provider response is already associated with another request."
        );
      }

      const inflight = this.database
        .prepare(
          `SELECT request_id, device_id, source_device_id, account_hash,
                  state, reserved_nano_usd,
                  reservation_model, reservation_tier,
                  reservation_input_tokens, reservation_max_output_tokens
             FROM inflight_requests
            WHERE reservation_id = ?`
        )
        .get(context.reservationId);
      if (
        !inflight ||
        inflight.device_id !== context.deviceId ||
        inflight.account_hash !== context.accountHash ||
        (context.sourceDeviceId &&
          inflight.source_device_id !== context.sourceDeviceId)
      ) {
        throw new AiAccessError(
          409,
          "access_reservation_missing",
          "The AI access reservation is missing or no longer valid."
        );
      }
      if (inflight.state === "needs_reconciliation") {
        throw new AiAccessError(
          503,
          "budget_reconciliation_required",
          "This AI usage reservation requires reconciliation."
        );
      }
      if (inflight.state !== "provider_started") {
        throw new AiAccessError(
          409,
          "provider_not_started",
          "Provider usage cannot be charged before the provider call is marked as started."
        );
      }
      if (inflight.reservation_model !== catalogModel) {
        throw new AiAccessError(
          409,
          "reserved_model_mismatch",
          "Provider usage does not match the reserved AI model."
        );
      }
      if (
        inflight.request_id !== normalizedRequestId &&
        !String(inflight.request_id).startsWith("internal:")
      ) {
        throw new AiAccessError(
          409,
          "usage_request_conflict",
          "Provider usage does not match the bound AI request identifier."
        );
      }
      if (inflight.request_id !== normalizedRequestId) {
        const requestConflict = this.database
          .prepare(
            `SELECT reservation_id FROM inflight_requests
              WHERE request_id = ? AND reservation_id <> ?`
          )
          .get(normalizedRequestId, context.reservationId);
        if (requestConflict) {
          throw new AiAccessError(
            409,
            "usage_request_conflict",
            "The AI usage request identifier is already in use."
          );
        }
      }
      const reservedNanoUsd = Number(inflight.reserved_nano_usd);
      if (
        calculated.costNanoUsd > reservedNanoUsd ||
        calculated.tier !== inflight.reservation_tier ||
        normalizedUsage.inputTokens > Number(inflight.reservation_input_tokens) ||
        normalizedUsage.outputTokens >
          Number(inflight.reservation_max_output_tokens)
      ) {
        const budgetBeforeLock = this._readBudget(
          context.deviceId,
          context.accountHash
        );
        const deviceAvailableNanoUsd = budgetBeforeLock
          ? Math.max(
              0,
              budgetBeforeLock.device_grant_nano_usd -
                budgetBeforeLock.device_spent_nano_usd -
                budgetBeforeLock.device_reserved_nano_usd
            )
          : 0;
        const sourceAvailableNanoUsd = budgetBeforeLock
          ? Math.max(
              0,
              budgetBeforeLock.source_grant_nano_usd -
                budgetBeforeLock.source_spent_nano_usd -
                budgetBeforeLock.source_reserved_nano_usd
            )
          : 0;
        const accountAvailableNanoUsd = budgetBeforeLock
          ? Math.max(
              0,
              budgetBeforeLock.account_grant_nano_usd -
                budgetBeforeLock.account_spent_nano_usd -
                budgetBeforeLock.account_reserved_nano_usd
            )
          : 0;
        const lockedNanoUsd = addCosts(
          reservedNanoUsd,
          Math.max(
            deviceAvailableNanoUsd,
            sourceAvailableNanoUsd,
            accountAvailableNanoUsd
          )
        );
        this.database
          .prepare(
            `UPDATE inflight_requests
                SET state = 'needs_reconciliation', reserved_nano_usd = ?,
                    actual_nano_usd = ?, provider = ?, provider_response_id = ?,
                    request_id = ?
              WHERE reservation_id = ?`
          )
          .run(
            lockedNanoUsd,
            calculated.costNanoUsd,
            normalizedProvider,
            normalizedProviderResponseId,
            normalizedRequestId,
            context.reservationId
          );
        reconciliation = {
          actualNanoUsd: calculated.costNanoUsd,
          reservedNanoUsd,
          lockedNanoUsd,
        };
        return;
      }

      this.database
        .prepare(
          `INSERT INTO usage_ledger
             (request_id, provider, provider_response_id, device_id,
              source_device_id, account_hash, model, price_catalog_version,
              tier, input_tokens, cached_input_tokens, cache_write_tokens,
              output_tokens, reasoning_tokens, total_tokens,
              cost_nano_usd, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          normalizedRequestId,
          normalizedProvider,
          normalizedProviderResponseId,
          context.deviceId,
          inflight.source_device_id,
          context.accountHash,
          catalogModel,
          this.priceCatalogVersion,
          calculated.tier,
          normalizedUsage.inputTokens,
          normalizedUsage.cachedInputTokens,
          normalizedUsage.cacheWriteTokens,
          normalizedUsage.outputTokens,
          normalizedUsage.reasoningTokens,
          normalizedUsage.totalTokens,
          calculated.costNanoUsd,
          now
        );
      const chargedDevices = this.database
        .prepare(
          `UPDATE devices
              SET spent_nano_usd = spent_nano_usd + ?, last_seen_at = ?
            WHERE id = ? OR id = ?`
        )
        .run(
          calculated.costNanoUsd,
          now,
          context.deviceId,
          inflight.source_device_id
        );
      const expectedDeviceCharges =
        context.deviceId === inflight.source_device_id ? 1 : 2;
      if (Number(chargedDevices.changes) !== expectedDeviceCharges) {
        throw new AiAccessError(
          500,
          "usage_device_charge_failed",
          "AI usage could not be charged to every device budget."
        );
      }
      const chargedAccount = this.database
        .prepare(
          `UPDATE google_accounts
              SET spent_nano_usd = spent_nano_usd + ?, last_seen_at = ?
            WHERE account_hash = ?`
        )
        .run(calculated.costNanoUsd, now, context.accountHash);
      if (Number(chargedAccount.changes) !== 1) {
        throw new AiAccessError(
          500,
          "usage_account_charge_failed",
          "AI usage could not be charged to the Google account budget."
        );
      }
      const settledReservation = this.database
        .prepare("DELETE FROM inflight_requests WHERE reservation_id = ?")
        .run(context.reservationId);
      if (Number(settledReservation.changes) !== 1) {
        throw new AiAccessError(
          500,
          "usage_reservation_settlement_failed",
          "AI usage could not settle its credit reservation."
        );
      }
      const updatedBudget = this._readBudget(
        context.deviceId,
        context.accountHash
      );
      result = {
        recorded: true,
        duplicate: false,
        provider: normalizedProvider,
        providerResponseId: normalizedProviderResponseId,
        sourceDeviceId: inflight.source_device_id,
        model: catalogModel,
        tier: calculated.tier,
        priceCatalogVersion: this.priceCatalogVersion,
        costNanoUsd: calculated.costNanoUsd,
        costCredits: nanoUsdToCredits(calculated.costNanoUsd),
        remainingNanoUsd: updatedBudget.remaining_nano_usd,
        remainingCredits: nanoUsdToCredits(updatedBudget.remaining_nano_usd),
        quota: toPublicQuota(updatedBudget),
      };
    });
    if (reconciliation) {
      const error = new AiAccessError(
        503,
        "usage_exceeds_reservation",
        "Provider usage exceeded its reserved AI credit budget and requires reconciliation."
      );
      error.actualNanoUsd = reconciliation.actualNanoUsd;
      error.reservedNanoUsd = reconciliation.reservedNanoUsd;
      error.lockedNanoUsd = reconciliation.lockedNanoUsd;
      throw error;
    }
    return result;
  }

  async releaseAiRequest(context, outcome = {}) {
    if (!context?.reservationId) return false;
    let released = false;
    this._transaction(() => {
      const inflight = this.database
        .prepare(
          "SELECT state FROM inflight_requests WHERE reservation_id = ?"
        )
        .get(context.reservationId);
      if (!inflight) return;
      if (
        outcome.providerRejected === true &&
        ["reserved", "provider_started"].includes(inflight.state)
      ) {
        const deleted = this.database
          .prepare("DELETE FROM inflight_requests WHERE reservation_id = ?")
          .run(context.reservationId);
        released = Number(deleted.changes) > 0;
        return;
      }
      if (
        inflight.state === "authorized" ||
        (inflight.state === "reserved" && outcome.providerCalled !== true)
      ) {
        const deleted = this.database
          .prepare("DELETE FROM inflight_requests WHERE reservation_id = ?")
          .run(context.reservationId);
        released = Number(deleted.changes) > 0;
        return;
      }
      if (
        inflight.state === "provider_started" ||
        (inflight.state === "reserved" && outcome.providerCalled === true)
      ) {
        this.database
          .prepare(
            `UPDATE inflight_requests
                SET state = 'needs_reconciliation'
              WHERE reservation_id = ?`
          )
          .run(context.reservationId);
      }
    });
    return released;
  }

  _readAccountWorkspaceRecord(accountHash, dataType) {
    const row = this.database
      .prepare(
        `SELECT revision, schema_version, payload_json, payload_bytes, updated_at
           FROM account_workspace_snapshots
          WHERE account_hash = ? AND data_type = ?`
      )
      .get(accountHash, dataType);
    if (!row) {
      return {
        revision: 0,
        schemaVersion: ACCOUNT_WORKSPACE_SCHEMA_VERSIONS[dataType],
        updatedAt: null,
        data: null,
      };
    }

    const payloadJson = String(row.payload_json || "");
    const payloadBytes = Buffer.byteLength(payloadJson, "utf8");
    if (
      payloadBytes !== Number(row.payload_bytes) ||
      payloadBytes > ACCOUNT_WORKSPACE_MAX_BYTES[dataType]
    ) {
      throw new AiAccessError(
        500,
        "account_data_corrupt",
        "The stored account workspace is invalid."
      );
    }

    let data;
    try {
      data = JSON.parse(payloadJson);
    } catch {
      throw new AiAccessError(
        500,
        "account_data_corrupt",
        "The stored account workspace is invalid."
      );
    }
    let normalized;
    try {
      normalized = normalizeAccountWorkspaceData(dataType, data);
    } catch {
      throw new AiAccessError(
        500,
        "account_data_corrupt",
        "The stored account workspace is invalid."
      );
    }
    if (
      normalized.payloadJson !== payloadJson ||
      Number(row.schema_version) !== normalized.schemaVersion
    ) {
      throw new AiAccessError(
        500,
        "account_data_corrupt",
        "The stored account workspace is invalid."
      );
    }

    return {
      revision: Number(row.revision),
      schemaVersion: Number(row.schema_version),
      updatedAt: Number(row.updated_at),
      data: normalized.data,
    };
  }

  close() {
    if (this.ownsDatabase && this.database) {
      this.database.close();
      this.database = null;
    }
  }

  _assertConfigured() {
    const config = this.configuration;
    if (!config.configured) {
      throw new AiAccessError(
        503,
        "google_auth_not_configured",
        "Google access for the AI assistant is not configured on the server."
      );
    }
  }

  _assertAuthEnabled() {
    if (!this.googleAuthEnabled) {
      throw new AiAccessError(
        404,
        "google_auth_disabled",
        "Google sign-in is not enabled."
      );
    }
  }

  _resolveDevice(req, res, { create }) {
    const now = this._now();
    const installationSecret = getHeader(req, INSTALLATION_SECRET_HEADER).trim();
    const installationHash = isValidInstallationSecret(installationSecret)
      ? this._identityHash("installation", installationSecret)
      : "";
    let device = null;

    if (installationHash) {
      device = this.database
        .prepare(
          `SELECT devices.id, devices.grant_nano_usd, devices.spent_nano_usd
             FROM installation_aliases
             JOIN devices ON devices.id = installation_aliases.device_id
            WHERE installation_aliases.alias_hash = ?`
        )
        .get(installationHash);
    }
    if (!device) {
      const cookieValue = readCookie(req, DEVICE_COOKIE);
      const deviceId = this._verifyDeviceCookie(cookieValue);
      if (deviceId) {
        device = this.database
          .prepare(
            "SELECT id, grant_nano_usd, spent_nano_usd FROM devices WHERE id = ?"
          )
          .get(deviceId);
      }
    }
    if (!device && create) {
      for (let attempt = 0; attempt < 4 && !device; attempt += 1) {
        const id = this._randomToken(24);
        try {
          this.database
            .prepare(
              `INSERT INTO devices
                 (id, grant_nano_usd, spent_nano_usd, created_at, last_seen_at)
               VALUES (?, ?, 0, ?, ?)`
            )
            .run(id, this.freeDeviceGrantNanoUsd, now, now);
          device = {
            id,
            grant_nano_usd: this.freeDeviceGrantNanoUsd,
            spent_nano_usd: 0,
          };
        } catch (error) {
          if (!String(error?.message || "").includes("UNIQUE")) throw error;
        }
      }
      if (!device) {
        throw new AiAccessError(
          500,
          "device_creation_failed",
          "A device identity could not be created."
        );
      }
    }
    if (!device) return null;

    this._transaction(() => {
      this.database
        .prepare("UPDATE devices SET last_seen_at = ? WHERE id = ?")
        .run(now, device.id);
      if (installationHash) {
        this.database
          .prepare(
            `INSERT INTO installation_aliases
               (alias_hash, device_id, created_at, last_seen_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(alias_hash) DO UPDATE SET
               last_seen_at = excluded.last_seen_at`
          )
          .run(installationHash, device.id, now, now);
      }
    });
    this._setDeviceCookie(res, device.id);
    return device;
  }

  _resolveSession(req, res, deviceId) {
    const sessionToken = readCookie(req, SESSION_COOKIE);
    if (!sessionToken) return null;
    const sessionHash = this._sessionHash(sessionToken);
    const now = this._now();
    const session = this.database
      .prepare(
        `SELECT auth_sessions.session_hash, auth_sessions.device_id,
                auth_sessions.account_hash, auth_sessions.expires_at,
                google_accounts.masked_email,
                google_accounts.grant_source_device_id
           FROM auth_sessions
           JOIN google_accounts
             ON google_accounts.account_hash = auth_sessions.account_hash
          WHERE auth_sessions.session_hash = ?`
      )
      .get(sessionHash);
    if (!session || session.expires_at <= now || session.device_id !== deviceId) {
      if (session) {
        this.database
          .prepare("DELETE FROM auth_sessions WHERE session_hash = ?")
          .run(sessionHash);
      }
      clearCookie(res, SESSION_COOKIE);
      return null;
    }
    this.database
      .prepare("UPDATE auth_sessions SET last_seen_at = ? WHERE session_hash = ?")
      .run(now, sessionHash);
    return session;
  }

  _readDeviceBudget(deviceId) {
    const row = this.database
      .prepare(
        `SELECT devices.grant_nano_usd,
                devices.spent_nano_usd,
                COALESCE((
                  SELECT SUM(inflight_requests.reserved_nano_usd)
                    FROM inflight_requests
                   WHERE (
                     inflight_requests.device_id = devices.id OR
                     inflight_requests.source_device_id = devices.id
                   )
                     AND inflight_requests.state IN
                       ('reserved', 'provider_started', 'needs_reconciliation')
                ), 0) AS reserved_nano_usd
           FROM devices
          WHERE devices.id = ?`
      )
      .get(deviceId);
    if (!row) return null;
    const grantNanoUsd = Number(row.grant_nano_usd);
    const spentNanoUsd = Number(row.spent_nano_usd);
    const reservedNanoUsd = Number(row.reserved_nano_usd);
    return {
      grant_nano_usd: grantNanoUsd,
      spent_nano_usd: spentNanoUsd,
      reserved_nano_usd: reservedNanoUsd,
      remaining_nano_usd: Math.max(
        0,
        grantNanoUsd - spentNanoUsd - reservedNanoUsd
      ),
    };
  }

  _readBudget(deviceId, accountHash) {
    const row = this.database
      .prepare(
        `SELECT current_device.id AS device_id,
                source_device.id AS source_device_id,
                current_device.grant_nano_usd AS device_grant_nano_usd,
                current_device.spent_nano_usd AS device_spent_nano_usd,
                source_device.grant_nano_usd AS source_grant_nano_usd,
                source_device.spent_nano_usd AS source_spent_nano_usd,
                account.grant_nano_usd AS account_grant_nano_usd,
                account.spent_nano_usd AS account_spent_nano_usd,
                COALESCE((
                  SELECT SUM(inflight_requests.reserved_nano_usd)
                    FROM inflight_requests
                   WHERE (
                     inflight_requests.device_id = current_device.id OR
                     inflight_requests.source_device_id = current_device.id
                   )
                     AND inflight_requests.state IN
                       ('reserved', 'provider_started', 'needs_reconciliation')
                ), 0) AS device_reserved_nano_usd,
                COALESCE((
                  SELECT SUM(inflight_requests.reserved_nano_usd)
                    FROM inflight_requests
                   WHERE (
                     inflight_requests.device_id = source_device.id OR
                     inflight_requests.source_device_id = source_device.id
                   )
                     AND inflight_requests.state IN
                       ('reserved', 'provider_started', 'needs_reconciliation')
                ), 0) AS source_reserved_nano_usd,
                COALESCE((
                  SELECT SUM(inflight_requests.reserved_nano_usd)
                    FROM inflight_requests
                   WHERE inflight_requests.account_hash = account.account_hash
                     AND inflight_requests.state IN
                       ('reserved', 'provider_started', 'needs_reconciliation')
                ), 0) AS account_reserved_nano_usd,
                MIN(
                  MAX(0, current_device.grant_nano_usd - current_device.spent_nano_usd -
                    COALESCE((
                      SELECT SUM(inflight_requests.reserved_nano_usd)
                        FROM inflight_requests
                       WHERE (
                         inflight_requests.device_id = current_device.id OR
                         inflight_requests.source_device_id = current_device.id
                       )
                         AND inflight_requests.state IN
                           ('reserved', 'provider_started', 'needs_reconciliation')
                    ), 0)),
                  MAX(0, source_device.grant_nano_usd - source_device.spent_nano_usd -
                    COALESCE((
                      SELECT SUM(inflight_requests.reserved_nano_usd)
                        FROM inflight_requests
                       WHERE (
                         inflight_requests.device_id = source_device.id OR
                         inflight_requests.source_device_id = source_device.id
                       )
                         AND inflight_requests.state IN
                           ('reserved', 'provider_started', 'needs_reconciliation')
                    ), 0)),
                  MAX(0, account.grant_nano_usd - account.spent_nano_usd -
                    COALESCE((
                      SELECT SUM(inflight_requests.reserved_nano_usd)
                        FROM inflight_requests
                       WHERE inflight_requests.account_hash = account.account_hash
                         AND inflight_requests.state IN
                           ('reserved', 'provider_started', 'needs_reconciliation')
                    ), 0))
                ) AS remaining_nano_usd
           FROM devices AS current_device
           JOIN google_accounts AS account ON account.account_hash = ?
           JOIN devices AS source_device
             ON source_device.id = account.grant_source_device_id
          WHERE current_device.id = ?`
      )
      .get(accountHash, deviceId);
    if (!row) return null;
    const deviceGrantNanoUsd = Number(row.device_grant_nano_usd);
    const deviceSpentNanoUsd = Number(row.device_spent_nano_usd);
    const sourceGrantNanoUsd = Number(row.source_grant_nano_usd);
    const sourceSpentNanoUsd = Number(row.source_spent_nano_usd);
    const accountGrantNanoUsd = Number(row.account_grant_nano_usd);
    const accountSpentNanoUsd = Number(row.account_spent_nano_usd);
    const remainingNanoUsd = Number(row.remaining_nano_usd);
    const availableBeforeReservationsNanoUsd = Math.min(
      Math.max(0, deviceGrantNanoUsd - deviceSpentNanoUsd),
      Math.max(0, sourceGrantNanoUsd - sourceSpentNanoUsd),
      Math.max(0, accountGrantNanoUsd - accountSpentNanoUsd)
    );
    const effectiveSpentNanoUsd = Math.max(
      deviceSpentNanoUsd,
      sourceSpentNanoUsd,
      accountSpentNanoUsd
    );
    const reservedNanoUsd = Math.max(
      0,
      availableBeforeReservationsNanoUsd - remainingNanoUsd
    );
    const grantNanoUsd = addCosts(
      effectiveSpentNanoUsd,
      addCosts(reservedNanoUsd, remainingNanoUsd)
    );
    return {
      grant_nano_usd: grantNanoUsd,
      spent_nano_usd: effectiveSpentNanoUsd,
      reserved_nano_usd: reservedNanoUsd,
      remaining_nano_usd: remainingNanoUsd,
      device_id: row.device_id,
      source_device_id: row.source_device_id,
      device_grant_nano_usd: deviceGrantNanoUsd,
      device_spent_nano_usd: deviceSpentNanoUsd,
      source_grant_nano_usd: sourceGrantNanoUsd,
      source_spent_nano_usd: sourceSpentNanoUsd,
      account_grant_nano_usd: accountGrantNanoUsd,
      account_spent_nano_usd: accountSpentNanoUsd,
      device_reserved_nano_usd: Number(row.device_reserved_nano_usd),
      source_reserved_nano_usd: Number(row.source_reserved_nano_usd),
      account_reserved_nano_usd: Number(row.account_reserved_nano_usd),
    };
  }

  _deleteOrphanDevices(olderThan, excludeDeviceId = "") {
    this.database
      .prepare(
        `DELETE FROM devices
          WHERE created_at < ? AND id <> ?
            AND NOT EXISTS (
              SELECT 1 FROM oauth_transactions
               WHERE oauth_transactions.device_id = devices.id
            )
            AND NOT EXISTS (
              SELECT 1 FROM device_account_links
               WHERE device_account_links.device_id = devices.id
            )
            AND NOT EXISTS (
              SELECT 1 FROM google_accounts
               WHERE google_accounts.grant_source_device_id = devices.id
            )
            AND NOT EXISTS (
              SELECT 1 FROM auth_sessions
               WHERE auth_sessions.device_id = devices.id
            )
            AND NOT EXISTS (
              SELECT 1 FROM inflight_requests
               WHERE inflight_requests.device_id = devices.id
                  OR inflight_requests.source_device_id = devices.id
            )
            AND NOT EXISTS (
              SELECT 1 FROM usage_ledger
               WHERE usage_ledger.device_id = devices.id
                  OR usage_ledger.source_device_id = devices.id
            )`
      )
      .run(olderThan, excludeDeviceId);
  }

  _deleteExpiredAuthSessions(now) {
    const expired = this.database
      .prepare("SELECT 1 AS found FROM auth_sessions WHERE expires_at <= ? LIMIT 1")
      .get(now);
    if (!expired) return 0;
    const deleted = this.database
      .prepare("DELETE FROM auth_sessions WHERE expires_at <= ?")
      .run(now);
    return Number(deleted.changes);
  }

  _setDeviceCookie(res, deviceId) {
    const signature = this._identityHash("device-cookie", `v1.${deviceId}`);
    setCookie(res, DEVICE_COOKIE, `${deviceId}.${signature}`, {
      maxAge: DEVICE_COOKIE_TTL_SECONDS,
    });
  }

  _verifyDeviceCookie(value) {
    if (!value || !isStrongSecret(this.identitySecret)) return "";
    const parts = String(value).split(".");
    if (parts.length !== 2 || !/^[A-Za-z0-9_-]{20,160}$/.test(parts[0])) return "";
    const expected = this._identityHash("device-cookie", `v1.${parts[0]}`);
    return safeEqual(parts[1], expected) ? parts[0] : "";
  }

  _identityHash(domain, value) {
    return keyedHash(this.identitySecret, domain, value);
  }

  _sessionHash(value) {
    return keyedHash(this.sessionSecret, "session", value);
  }

  _randomToken(byteLength) {
    const value = this.random(byteLength);
    const buffer = Buffer.isBuffer(value)
      ? value
      : value instanceof Uint8Array
        ? Buffer.from(value)
        : Buffer.from(String(value || ""), "utf8");
    if (!buffer.length) throw new Error("The random source returned no data.");
    return buffer.toString("base64url");
  }

  _now() {
    const value = Number(this.now());
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TypeError("The clock must return a non-negative integer timestamp.");
    }
    return value;
  }

  _transaction(callback) {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = callback();
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        this.database.exec("ROLLBACK");
      } catch {
        // Preserve the original failure.
      }
      throw error;
    }
  }
}

function readWorkspaceAccountHash(context) {
  const accountHash = String(context?.accountHash || "");
  if (!accountHash) {
    throw new AiAccessError(
      500,
      "invalid_account_context",
      "The authenticated account context is invalid."
    );
  }
  return accountHash;
}

function readWorkspaceAccountKey(context) {
  const accountKey = String(context?.accountKey || "");
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(accountKey)) {
    throw new AiAccessError(
      500,
      "invalid_account_context",
      "The authenticated account context is invalid."
    );
  }
  return accountKey;
}

function normalizeAccountWorkspaceType(value) {
  const dataType = String(value || "").trim().toLowerCase();
  if (!ACCOUNT_WORKSPACE_TYPES.includes(dataType)) {
    throw new AiAccessError(
      404,
      "account_data_type_not_found",
      "The requested account workspace data type does not exist."
    );
  }
  return dataType;
}

function normalizeAccountWorkspaceWrite(dataType, rawInput) {
  if (!isPlainJsonObject(rawInput)) {
    throw new AiAccessError(
      400,
      "invalid_account_data",
      "The account workspace request must be a JSON object."
    );
  }
  if (
    Object.keys(rawInput).some(
      (key) => !["baseRevision", "expectedAccountKey", "data"].includes(key)
    )
  ) {
    throw new AiAccessError(
      400,
      "invalid_account_data",
      "The account workspace request contains unsupported fields."
    );
  }
  const baseRevision = Number(rawInput.baseRevision);
  if (!Number.isSafeInteger(baseRevision) || baseRevision < 0) {
    throw new AiAccessError(
      400,
      "invalid_account_revision",
      "baseRevision must be a non-negative integer."
    );
  }
  const expectedAccountKey = String(rawInput.expectedAccountKey || "");
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(expectedAccountKey)) {
    throw new AiAccessError(
      400,
      "expected_account_key_required",
      "expectedAccountKey must identify the account workspace being saved."
    );
  }
  return {
    baseRevision,
    expectedAccountKey,
    ...normalizeAccountWorkspaceData(dataType, rawInput.data),
  };
}

function normalizeAccountWorkspaceData(dataType, rawData) {
  if (!isPlainJsonObject(rawData)) {
    throw new AiAccessError(
      400,
      "invalid_account_data",
      "Account workspace data must be a JSON object."
    );
  }
  const schemaVersion = Number(rawData.schemaVersion);
  if (schemaVersion !== ACCOUNT_WORKSPACE_SCHEMA_VERSIONS[dataType]) {
    throw new AiAccessError(
      400,
      "invalid_account_data_schema",
      `Unsupported ${dataType} workspace schema.`
    );
  }
  if (
    dataType !== "instruction" &&
    ["projectInstruction", "projectInstructionDocument", "instructionDocument"].some(
      (key) => Object.prototype.hasOwnProperty.call(rawData, key)
    )
  ) {
    throw new AiAccessError(
      400,
      "project_instruction_storage_forbidden",
      "Project instruction is not part of account chat or file storage."
    );
  }

  if (dataType === "chats") validateAccountChats(rawData);
  if (dataType === "files") validateAccountFiles(rawData);
  if (dataType === "instruction") validateAccountInstruction(rawData);

  let payloadJson;
  try {
    payloadJson = JSON.stringify(rawData);
  } catch {
    throw new AiAccessError(
      400,
      "invalid_account_data",
      "Account workspace data must be valid JSON."
    );
  }
  const payloadBytes = Buffer.byteLength(payloadJson, "utf8");
  if (payloadBytes > ACCOUNT_WORKSPACE_MAX_BYTES[dataType]) {
    throw new AiAccessError(
      413,
      "account_data_too_large",
      `The ${dataType} workspace exceeds its storage limit.`
    );
  }

  return {
    data: rawData,
    schemaVersion,
    payloadJson,
    payloadBytes,
  };
}

function validateAccountChats(data) {
  const allowedKeys = new Set(["schemaVersion", "activeChatId", "chats"]);
  if (Object.keys(data).some((key) => !allowedKeys.has(key)) || !Array.isArray(data.chats)) {
    throwInvalidAccountData("The chat workspace structure is invalid.");
  }
  if (data.chats.length > 100) {
    throwInvalidAccountData("The chat workspace contains too many chats.");
  }

  const ids = new Set();
  const messageIds = new Set();
  for (const chat of data.chats) {
    if (
      !isPlainJsonObject(chat) ||
      Object.keys(chat).some(
        (key) =>
          ![
            "id",
            "title",
            "titleSource",
            "titleLocked",
            "createdAt",
            "updatedAt",
            "messages",
          ].includes(key)
      )
    ) {
      throwInvalidAccountData("Each chat must be a JSON object.");
    }
    const id = normalizeBoundedWorkspaceText(chat.id, 96, { required: true });
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/.test(id) || ids.has(id)) {
      throwInvalidAccountData("Chat identifiers must be unique and URL-safe.");
    }
    ids.add(id);
    normalizeBoundedWorkspaceText(chat.title, 256, { required: false });
    if (
      chat.titleSource != null &&
      !["auto", "manual"].includes(chat.titleSource)
    ) {
      throwInvalidAccountData("Chat title metadata is invalid.");
    }
    if (chat.titleLocked != null && typeof chat.titleLocked !== "boolean") {
      throwInvalidAccountData("Chat title metadata is invalid.");
    }
    validateRequiredWorkspaceTimestamp(chat.createdAt);
    validateRequiredWorkspaceTimestamp(chat.updatedAt);
    if (chat.updatedAt < chat.createdAt) {
      throwInvalidAccountData("Chat timestamps are invalid.");
    }
    if (!Array.isArray(chat.messages)) {
      throwInvalidAccountData("Each chat must contain a messages array.");
    }
    for (const message of chat.messages) {
      if (
        !isPlainJsonObject(message) ||
        Object.keys(message).some(
          (key) =>
            ![
              "id",
              "role",
              "content",
              "title",
              "createdAt",
              "editedAt",
            ].includes(key)
        ) ||
        !["user", "assistant"].includes(String(message.role || ""))
      ) {
        throwInvalidAccountData("Chat messages must have a user or assistant role.");
      }
      const messageId = normalizeBoundedWorkspaceText(message.id, 128, {
        required: true,
      });
      if (
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(messageId) ||
        messageIds.has(messageId)
      ) {
        throwInvalidAccountData("Chat message identifiers must be unique and URL-safe.");
      }
      messageIds.add(messageId);
      normalizeBoundedWorkspaceText(message.content, 128 * 1024, {
        required: true,
      });
      normalizeBoundedWorkspaceText(message.title, 512, { required: false });
      validateRequiredWorkspaceTimestamp(message.createdAt);
      if (message.editedAt != null) {
        validateRequiredWorkspaceTimestamp(message.editedAt);
        if (message.editedAt < message.createdAt) {
          throwInvalidAccountData("Chat message timestamps are invalid.");
        }
      }
    }
  }

  if (data.activeChatId != null) {
    const activeChatId = normalizeBoundedWorkspaceText(data.activeChatId, 96, {
      required: true,
    });
    if (!ids.has(activeChatId)) {
      throwInvalidAccountData("activeChatId must identify a stored chat.");
    }
  }
}

function validateAccountFiles(data) {
  const allowedKeys = new Set([
    "schemaVersion",
    "files",
    "fileGroups",
    "miniProjects",
    "current",
    "authorship",
  ]);
  if (
    Object.keys(data).some((key) => !allowedKeys.has(key)) ||
    !isPlainJsonObject(data.files) ||
    !isPlainJsonObject(data.fileGroups) ||
    !isPlainJsonObject(data.miniProjects)
  ) {
    throwInvalidAccountData("The file workspace structure is invalid.");
  }
  const fileEntries = Object.entries(data.files);
  if (
    fileEntries.length > 256 ||
    Object.keys(data.fileGroups).length > 256 ||
    Object.keys(data.miniProjects).length > 128
  ) {
    throwInvalidAccountData("The file workspace contains too many entries.");
  }
  for (const [name, content] of fileEntries) {
    if (
      !name ||
      name.length > 96 ||
      name === "." ||
      name === ".." ||
      ["__proto__", "prototype", "constructor"].includes(name.toLowerCase()) ||
      /[\\/:*?"<>|\x00-\x1f]/.test(name) ||
      typeof content !== "string"
    ) {
      throwInvalidAccountData("The file workspace contains an invalid file.");
    }
  }
  if (data.authorship != null) {
    if (!isPlainJsonObject(data.authorship)) {
      throwInvalidAccountData("The file authorship metadata is invalid.");
    }
    for (const [name, authorship] of Object.entries(data.authorship)) {
      if (!Object.prototype.hasOwnProperty.call(data.files, name)) {
        throwInvalidAccountData(
          "File authorship must identify an existing stored file."
        );
      }
      validateWorkspaceAuthorship(authorship, data.files[name]);
    }
  }
  if (
    data.current != null &&
    (typeof data.current !== "string" ||
      !Object.prototype.hasOwnProperty.call(data.files, data.current))
  ) {
    throwInvalidAccountData("The current file must identify a stored file.");
  }
}

function validateAccountInstruction(data) {
  const allowedKeys = new Set([
    "schemaVersion",
    "revision",
    "markdown",
    "skillRefs",
    "authorship",
  ]);
  if (
    Object.keys(data).some((key) => !allowedKeys.has(key)) ||
    !Number.isSafeInteger(data.revision) ||
    data.revision < 0 ||
    data.revision >= Number.MAX_SAFE_INTEGER ||
    typeof data.markdown !== "string" ||
    data.markdown.includes("\u0000") ||
    Buffer.byteLength(data.markdown, "utf8") > 128 * 1024 ||
    !Array.isArray(data.skillRefs) ||
    data.skillRefs.length > 64
  ) {
    throwInvalidAccountData("The Project instruction structure is invalid.");
  }

  const skillIds = new Set();
  for (const reference of data.skillRefs) {
    if (
      !isPlainJsonObject(reference) ||
      Object.keys(reference).some((key) => !["id", "version"].includes(key))
    ) {
      throwInvalidAccountData("The Project instruction skill references are invalid.");
    }
    const id = String(reference.id || "").trim();
    const version = String(reference.version || "").trim();
    if (
      !/^[a-z0-9][a-z0-9-]{0,63}$/.test(id) ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,47}$/.test(version) ||
      skillIds.has(id)
    ) {
      throwInvalidAccountData("The Project instruction skill references are invalid.");
    }
    skillIds.add(id);
  }
  if (data.authorship != null) {
    validateWorkspaceAuthorship(data.authorship, data.markdown);
  }
}

function validateWorkspaceAuthorship(authorship, content) {
  if (
    !isPlainJsonObject(authorship) ||
    Object.keys(authorship).some(
      (key) => !["schemaVersion", "lines", "updatedAt"].includes(key)
    ) ||
    Number(authorship.schemaVersion) !== 1 ||
    !Array.isArray(authorship.lines) ||
    authorship.lines.length > MAX_WORKSPACE_AUTHORSHIP_LINES
  ) {
    throwInvalidAccountData("Workspace authorship metadata is invalid.");
  }
  const expectedLines = String(content).replace(/\r\n?/g, "\n").split("\n");
  if (
    authorship.lines.length !== expectedLines.length ||
    authorship.lines.some(
      (author) =>
        typeof author !== "string" || !WORKSPACE_AUTHORSHIP_VALUES.has(author)
    )
  ) {
    throwInvalidAccountData("Workspace authorship lines are invalid.");
  }
  validateRequiredWorkspaceTimestamp(authorship.updatedAt);
}

function normalizeBoundedWorkspaceText(value, maxBytes, { required }) {
  if (typeof value !== "string") {
    if (!required && value == null) return "";
    throwInvalidAccountData("Account workspace text is invalid.");
  }
  const text = value.trim();
  if (
    (required && !text) ||
    value.includes("\u0000") ||
    Buffer.byteLength(value, "utf8") > maxBytes
  ) {
    throwInvalidAccountData("Account workspace text is invalid.");
  }
  return text;
}

function validateRequiredWorkspaceTimestamp(value) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throwInvalidAccountData("Account workspace timestamps are invalid.");
  }
}

function isPlainJsonObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function throwInvalidAccountData(message) {
  throw new AiAccessError(400, "invalid_account_data", message);
}

function createAiAccessService(options = {}) {
  return new AiAccessService(options);
}

function configureDatabase(database, databasePath) {
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA busy_timeout = 5000");
  if (databasePath !== ":memory:") {
    database.exec("PRAGMA journal_mode = WAL");
    database.exec("PRAGMA synchronous = FULL");
  }
}

function migrateDatabase(database) {
  const version = Number(database.prepare("PRAGMA user_version").get().user_version);
  if (version > SCHEMA_VERSION) {
    throw new Error(
      `AI access database schema ${version} is newer than supported schema ${SCHEMA_VERSION}.`
    );
  }
  if (version === SCHEMA_VERSION) return;

  database.exec("BEGIN IMMEDIATE");
  try {
    if (version < 1) {
      database.exec(`
        CREATE TABLE devices (
          id TEXT PRIMARY KEY,
          grant_nano_usd INTEGER NOT NULL CHECK (grant_nano_usd >= 0),
          spent_nano_usd INTEGER NOT NULL DEFAULT 0 CHECK (spent_nano_usd >= 0),
          created_at INTEGER NOT NULL,
          last_seen_at INTEGER NOT NULL
        ) STRICT;

        CREATE TABLE installation_aliases (
          alias_hash TEXT PRIMARY KEY,
          device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
          created_at INTEGER NOT NULL,
          last_seen_at INTEGER NOT NULL
        ) STRICT;

        CREATE TABLE google_accounts (
          account_hash TEXT PRIMARY KEY,
          masked_email TEXT NOT NULL,
          grant_source_device_id TEXT NOT NULL
            REFERENCES devices(id) ON DELETE RESTRICT,
          grant_nano_usd INTEGER NOT NULL CHECK (grant_nano_usd >= 0),
          spent_nano_usd INTEGER NOT NULL DEFAULT 0 CHECK (spent_nano_usd >= 0),
          created_at INTEGER NOT NULL,
          last_seen_at INTEGER NOT NULL
        ) STRICT;

        CREATE INDEX google_accounts_grant_source_idx
          ON google_accounts(grant_source_device_id);

        CREATE TRIGGER google_accounts_grant_source_immutable
          BEFORE UPDATE OF grant_source_device_id ON google_accounts
          FOR EACH ROW
          WHEN NEW.grant_source_device_id <> OLD.grant_source_device_id
        BEGIN
          SELECT RAISE(ABORT, 'grant_source_device_id is immutable');
        END;

        CREATE TABLE device_account_links (
          device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
          account_hash TEXT NOT NULL REFERENCES google_accounts(account_hash) ON DELETE CASCADE,
          created_at INTEGER NOT NULL,
          last_seen_at INTEGER NOT NULL,
          PRIMARY KEY (device_id, account_hash)
        ) WITHOUT ROWID, STRICT;

        CREATE TABLE oauth_transactions (
          state_hash TEXT PRIMARY KEY,
          device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
          nonce_hash TEXT NOT NULL,
          code_verifier TEXT NOT NULL,
          redirect_uri TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL
        ) STRICT;

        CREATE TABLE auth_sessions (
          session_hash TEXT PRIMARY KEY,
          device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
          account_hash TEXT NOT NULL REFERENCES google_accounts(account_hash) ON DELETE CASCADE,
          created_at INTEGER NOT NULL,
          last_seen_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL
        ) STRICT;

        CREATE INDEX auth_sessions_device_idx ON auth_sessions(device_id);
        CREATE INDEX auth_sessions_expiry_idx ON auth_sessions(expires_at);

        CREATE TABLE price_catalog (
          model TEXT NOT NULL,
          version TEXT NOT NULL,
          input_nano_usd_per_token INTEGER NOT NULL,
          cached_input_nano_usd_per_token INTEGER NOT NULL,
          cache_write_nano_usd_per_token INTEGER NOT NULL,
          output_nano_usd_per_token INTEGER NOT NULL,
          long_context_threshold INTEGER NOT NULL,
          long_input_nano_usd_per_token INTEGER NOT NULL,
          long_cached_input_nano_usd_per_token INTEGER NOT NULL,
          long_cache_write_nano_usd_per_token INTEGER NOT NULL,
          long_output_nano_usd_per_token INTEGER NOT NULL,
          PRIMARY KEY (model, version)
        ) WITHOUT ROWID, STRICT;

        CREATE TABLE usage_ledger (
          id INTEGER PRIMARY KEY,
          request_id TEXT NOT NULL UNIQUE,
          provider TEXT NOT NULL,
          provider_response_id TEXT NOT NULL,
          device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE RESTRICT,
          source_device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE RESTRICT,
          account_hash TEXT NOT NULL REFERENCES google_accounts(account_hash) ON DELETE RESTRICT,
          model TEXT NOT NULL,
          price_catalog_version TEXT NOT NULL,
          tier TEXT NOT NULL CHECK (tier IN ('standard', 'long_context')),
          input_tokens INTEGER NOT NULL,
          cached_input_tokens INTEGER NOT NULL,
          cache_write_tokens INTEGER NOT NULL,
          output_tokens INTEGER NOT NULL,
          reasoning_tokens INTEGER NOT NULL,
          total_tokens INTEGER NOT NULL,
          cost_nano_usd INTEGER NOT NULL CHECK (cost_nano_usd >= 0),
          created_at INTEGER NOT NULL,
          UNIQUE (provider, provider_response_id)
        ) STRICT;

        CREATE INDEX usage_ledger_device_idx ON usage_ledger(device_id, created_at);
        CREATE INDEX usage_ledger_source_device_idx
          ON usage_ledger(source_device_id, created_at);

        CREATE TABLE inflight_requests (
          reservation_id TEXT PRIMARY KEY,
          request_id TEXT NOT NULL UNIQUE,
          device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
          source_device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE RESTRICT,
          account_hash TEXT NOT NULL REFERENCES google_accounts(account_hash) ON DELETE CASCADE,
          reserved_nano_usd INTEGER NOT NULL DEFAULT 0 CHECK (reserved_nano_usd >= 0),
          actual_nano_usd INTEGER CHECK (actual_nano_usd IS NULL OR actual_nano_usd >= 0),
          state TEXT NOT NULL DEFAULT 'authorized'
            CHECK (state IN (
              'authorized', 'reserved', 'provider_started', 'needs_reconciliation'
            )),
          reservation_model TEXT,
          reservation_tier TEXT CHECK (
            reservation_tier IS NULL OR reservation_tier IN ('standard', 'long_context')
          ),
          reservation_input_tokens INTEGER,
          reservation_max_output_tokens INTEGER,
          provider TEXT,
          provider_response_id TEXT,
          created_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL,
          UNIQUE (provider, provider_response_id)
        ) STRICT;

        CREATE INDEX inflight_requests_device_idx ON inflight_requests(device_id);
        CREATE INDEX inflight_requests_source_device_idx
          ON inflight_requests(source_device_id);
        CREATE INDEX inflight_requests_expiry_idx ON inflight_requests(expires_at);
        PRAGMA user_version = 1;
      `);
    }
    if (version < 2) {
      database.exec(`
        CREATE TABLE account_workspace_snapshots (
          account_hash TEXT NOT NULL
            REFERENCES google_accounts(account_hash) ON DELETE CASCADE,
          data_type TEXT NOT NULL
            CHECK (data_type IN ('chats', 'files', 'instruction')),
          revision INTEGER NOT NULL CHECK (revision > 0),
          schema_version INTEGER NOT NULL CHECK (schema_version > 0),
          payload_json TEXT NOT NULL,
          payload_bytes INTEGER NOT NULL CHECK (payload_bytes >= 0),
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (account_hash, data_type)
        ) WITHOUT ROWID, STRICT;

        PRAGMA user_version = 2;
      `);
    }
    database.exec("COMMIT");
  } catch (error) {
    try {
      database.exec("ROLLBACK");
    } catch {
      // Preserve the migration error.
    }
    throw error;
  }
}

function seedPriceCatalog(database, version, modelPrices) {
  const statement = database.prepare(
    `INSERT INTO price_catalog
       (model, version, input_nano_usd_per_token,
        cached_input_nano_usd_per_token, cache_write_nano_usd_per_token,
        output_nano_usd_per_token, long_context_threshold,
        long_input_nano_usd_per_token, long_cached_input_nano_usd_per_token,
        long_cache_write_nano_usd_per_token, long_output_nano_usd_per_token)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(model, version) DO NOTHING`
  );
  for (const [model, price] of Object.entries(modelPrices)) {
    statement.run(
      model,
      version,
      price.inputNanoUsdPerToken,
      price.cachedInputNanoUsdPerToken,
      price.cacheWriteNanoUsdPerToken,
      price.outputNanoUsdPerToken,
      price.longContextThreshold,
      price.longInputNanoUsdPerToken,
      price.longCachedInputNanoUsdPerToken,
      price.longCacheWriteNanoUsdPerToken,
      price.longOutputNanoUsdPerToken
    );
    const stored = readCatalogPrice(database, model, version);
    if (
      !stored ||
      Object.keys(price).some((key) => stored[key] !== price[key])
    ) {
      throw new Error(
        `Stored price catalog ${version}/${model} does not match the supported immutable catalog.`
      );
    }
  }
}

function readCatalogPrice(database, model, version) {
  const row = database
    .prepare(
      `SELECT input_nano_usd_per_token, cached_input_nano_usd_per_token,
              cache_write_nano_usd_per_token, output_nano_usd_per_token,
              long_context_threshold, long_input_nano_usd_per_token,
              long_cached_input_nano_usd_per_token,
              long_cache_write_nano_usd_per_token,
              long_output_nano_usd_per_token
         FROM price_catalog
        WHERE model = ? AND version = ?`
    )
    .get(model, version);
  if (!row) return null;
  return {
    inputNanoUsdPerToken: Number(row.input_nano_usd_per_token),
    cachedInputNanoUsdPerToken: Number(row.cached_input_nano_usd_per_token),
    cacheWriteNanoUsdPerToken: Number(row.cache_write_nano_usd_per_token),
    outputNanoUsdPerToken: Number(row.output_nano_usd_per_token),
    longContextThreshold: Number(row.long_context_threshold),
    longInputNanoUsdPerToken: Number(row.long_input_nano_usd_per_token),
    longCachedInputNanoUsdPerToken: Number(
      row.long_cached_input_nano_usd_per_token
    ),
    longCacheWriteNanoUsdPerToken: Number(
      row.long_cache_write_nano_usd_per_token
    ),
    longOutputNanoUsdPerToken: Number(row.long_output_nano_usd_per_token),
  };
}

function normalizeCompositeProviderUsage(responses, fallback) {
  if (!Array.isArray(responses) || responses.length <= 1) {
    return {
      provider: normalizeIdentifier(fallback.provider || "openai", 48)
        .toLowerCase(),
      providerResponseId: normalizeIdentifier(fallback.responseId, 160),
      model: resolveCatalogModel(fallback.model),
      usage: normalizeUsage(fallback.usage),
      segments: null,
    };
  }
  if (responses.length > 3) {
    throw new AiAccessError(
      500,
      "usage_counts_invalid",
      "AI usage contains too many provider responses."
    );
  }
  const segments = responses.map((response) => {
    const provider = normalizeIdentifier(response?.provider || "openai", 48)
      .toLowerCase();
    const responseId = normalizeIdentifier(
      firstDefined(response?.providerResponseId, response?.responseId),
      160
    );
    const model = resolveCatalogModel(response?.model);
    if (!provider || !responseId || !model) {
      throw new AiAccessError(
        500,
        "provider_usage_id_missing",
        "AI usage could not be recorded without provider response identifiers."
      );
    }
    return {
      provider,
      responseId,
      model,
      usage: normalizeUsage(response?.usage),
    };
  });
  const providers = new Set(segments.map((segment) => segment.provider));
  const models = new Set(segments.map((segment) => segment.model));
  const responseIds = new Set(segments.map((segment) => segment.responseId));
  if (
    providers.size !== 1 ||
    models.size !== 1 ||
    responseIds.size !== segments.length
  ) {
    throw new AiAccessError(
      500,
      "usage_counts_invalid",
      "Composite AI usage contains inconsistent provider responses."
    );
  }
  const usage = {
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
  };
  for (const segment of segments) {
    for (const key of Object.keys(usage)) {
      usage[key] = addUsageCounts(usage[key], segment.usage[key]);
    }
  }
  const provider = segments[0].provider;
  const digest = crypto
    .createHash("sha256")
    .update(
      JSON.stringify(
        segments.map((segment) => [segment.provider, segment.responseId])
      ),
      "utf8"
    )
    .digest("hex");
  return {
    provider,
    providerResponseId: `bundle:${digest}`,
    model: segments[0].model,
    usage,
    segments,
  };
}

function calculateCompositeUsageCost(segments, price) {
  let costNanoUsd = 0;
  let inputTokens = 0;
  for (const segment of segments) {
    inputTokens = addUsageCounts(inputTokens, segment.usage.inputTokens);
    costNanoUsd = addCosts(
      costNanoUsd,
      calculateUsageCostNanoUsd(segment.usage, price).costNanoUsd
    );
  }
  return {
    costNanoUsd,
    tier:
      inputTokens > price.longContextThreshold
        ? "long_context"
        : "standard",
  };
}

function calculateUsageCostNanoUsd(usage, price = MODEL_PRICES[DEFAULT_MODEL]) {
  const normalized = normalizeUsage(usage);
  const categorizedInput =
    normalized.cachedInputTokens + normalized.cacheWriteTokens;
  if (categorizedInput > normalized.inputTokens) {
    throw new AiAccessError(
      500,
      "usage_counts_invalid",
      "Cached and cache-write tokens cannot exceed total input tokens."
    );
  }
  const longContext = normalized.inputTokens > price.longContextThreshold;
  const rates = longContext
    ? {
        input: price.longInputNanoUsdPerToken,
        cached: price.longCachedInputNanoUsdPerToken,
        cacheWrite: price.longCacheWriteNanoUsdPerToken,
        output: price.longOutputNanoUsdPerToken,
      }
    : {
        input: price.inputNanoUsdPerToken,
        cached: price.cachedInputNanoUsdPerToken,
        cacheWrite: price.cacheWriteNanoUsdPerToken,
        output: price.outputNanoUsdPerToken,
      };
  const uncachedInputTokens = normalized.inputTokens - categorizedInput;
  const cost =
    BigInt(uncachedInputTokens) * BigInt(rates.input) +
    BigInt(normalized.cachedInputTokens) * BigInt(rates.cached) +
    BigInt(normalized.cacheWriteTokens) * BigInt(rates.cacheWrite) +
    BigInt(normalized.outputTokens) * BigInt(rates.output);
  if (cost > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new AiAccessError(
      500,
      "usage_cost_too_large",
      "The calculated AI usage cost is too large to record safely."
    );
  }
  return {
    costNanoUsd: Number(cost),
    tier: longContext ? "long_context" : "standard",
    rates,
    usage: normalized,
  };
}

function normalizeUsage(usage) {
  const source = usage && typeof usage === "object" ? usage : {};
  const inputDetails =
    source.input_tokens_details && typeof source.input_tokens_details === "object"
      ? source.input_tokens_details
      : {};
  const outputDetails =
    source.output_tokens_details && typeof source.output_tokens_details === "object"
      ? source.output_tokens_details
      : {};
  const inputTokens = readUsageInteger(
      firstDefined(source.inputTokens, source.input_tokens, source.input)
    );
  const outputTokens = readUsageInteger(
    firstDefined(source.outputTokens, source.output_tokens, source.output)
  );
  const normalized = {
    inputTokens,
    cachedInputTokens: readUsageInteger(
      firstDefined(
        source.cachedInputTokens,
        source.cached_input_tokens,
        source.cached,
        inputDetails.cached_tokens
      )
    ),
    cacheWriteTokens: readUsageInteger(
      firstDefined(
        source.cacheWriteTokens,
        source.cache_write_tokens,
        source.cacheWrite,
        inputDetails.cache_write_tokens
      )
    ),
    outputTokens,
    reasoningTokens: readUsageInteger(
      firstDefined(
        source.reasoningTokens,
        source.reasoning_tokens,
        outputDetails.reasoning_tokens
      )
    ),
    totalTokens:
      source.totalTokens != null || source.total_tokens != null
        ? readUsageInteger(firstDefined(source.totalTokens, source.total_tokens))
        : addUsageCounts(inputTokens, outputTokens),
  };
  if (
    normalized.reasoningTokens > normalized.outputTokens ||
    normalized.totalTokens !==
      addUsageCounts(normalized.inputTokens, normalized.outputTokens)
  ) {
    throw new AiAccessError(
      500,
      "usage_counts_invalid",
      "AI token usage contains inconsistent totals."
    );
  }
  return normalized;
}

function readUsageInteger(value) {
  if (value == null || value === "") return 0;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new AiAccessError(
      500,
      "usage_counts_invalid",
      "AI token usage must contain non-negative integers."
    );
  }
  return number;
}

function readRequiredUsageInteger(value, fieldName) {
  if (value == null || value === "") {
    throw new AiAccessError(
      400,
      "usage_limit_missing",
      `${fieldName} must be provided as a non-negative integer.`
    );
  }
  return readUsageInteger(value);
}

function addUsageCounts(left, right) {
  const total = BigInt(left) + BigInt(right);
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new AiAccessError(
      500,
      "usage_counts_invalid",
      "AI token usage is too large to record safely."
    );
  }
  return Number(total);
}

function multiplyCost(tokens, rate) {
  const cost = BigInt(tokens) * BigInt(rate);
  if (cost > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new AiAccessError(
      500,
      "usage_cost_too_large",
      "The calculated AI usage cost is too large to record safely."
    );
  }
  return Number(cost);
}

function addCosts(left, right) {
  const cost = BigInt(left) + BigInt(right);
  if (cost > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new AiAccessError(
      500,
      "usage_cost_too_large",
      "The calculated AI usage cost is too large to record safely."
    );
  }
  return Number(cost);
}

function resolveCatalogModel(model) {
  const normalized = normalizeIdentifier(model || DEFAULT_MODEL, 160);
  if (normalized === DEFAULT_MODEL || normalized.startsWith(`${DEFAULT_MODEL}-`)) {
    return DEFAULT_MODEL;
  }
  return normalized;
}

function parseCreditsToNanoUsd(value) {
  const text = String(value ?? "0").trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(text)) {
    throw new TypeError("AI_FREE_DEVICE_GRANT_CREDITS must be a non-negative decimal.");
  }
  const [whole, fraction = ""] = text.split(".");
  const nanoUsd =
    BigInt(whole) * BigInt(CREDIT_NANO_USD) +
    BigInt(fraction.padEnd(6, "0"));
  if (nanoUsd > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new TypeError("AI_FREE_DEVICE_GRANT_CREDITS is too large.");
  }
  return Number(nanoUsd);
}

function nanoUsdToCredits(value) {
  return Number(value) / CREDIT_NANO_USD;
}

function toPublicQuota(budget) {
  return {
    unit: "AI Credit",
    granted: nanoUsdToCredits(budget.grant_nano_usd),
    spent: nanoUsdToCredits(budget.spent_nano_usd),
    reserved: nanoUsdToCredits(budget.reserved_nano_usd || 0),
    remaining: nanoUsdToCredits(budget.remaining_nano_usd),
  };
}

function toDiagnosticBudget(budget) {
  return {
    grantNanoUsd: budget.grant_nano_usd,
    spentNanoUsd: budget.spent_nano_usd,
    reservedNanoUsd: budget.reserved_nano_usd || 0,
    remainingNanoUsd: budget.remaining_nano_usd,
    grantCredits: nanoUsdToCredits(budget.grant_nano_usd),
    spentCredits: nanoUsdToCredits(budget.spent_nano_usd),
    reservedCredits: nanoUsdToCredits(budget.reserved_nano_usd || 0),
    remainingCredits: nanoUsdToCredits(budget.remaining_nano_usd),
    deviceRemainingCredits: nanoUsdToCredits(
      Math.max(
        0,
        budget.device_grant_nano_usd -
          budget.device_spent_nano_usd -
          (budget.device_reserved_nano_usd || 0)
      )
    ),
    sourceDeviceRemainingCredits: nanoUsdToCredits(
      Math.max(
        0,
        budget.source_grant_nano_usd -
          budget.source_spent_nano_usd -
          (budget.source_reserved_nano_usd || 0)
      )
    ),
    accountRemainingCredits: nanoUsdToCredits(
      Math.max(
        0,
        budget.account_grant_nano_usd -
          budget.account_spent_nano_usd -
          (budget.account_reserved_nano_usd || 0)
      )
    ),
  };
}

function maskEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  const separator = email.lastIndexOf("@");
  if (separator <= 0 || separator === email.length - 1) return "Google account";
  const local = email.slice(0, separator);
  const domain = email.slice(separator + 1);
  const dot = domain.lastIndexOf(".");
  const domainName = dot > 0 ? domain.slice(0, dot) : domain;
  const suffix = dot > 0 ? domain.slice(dot) : "";
  return `${local[0]}***@${domainName[0] || "*"}***${suffix}`;
}

function keyedHash(secret, domain, value) {
  if (!isStrongSecret(secret)) {
    throw new AiAccessError(
      503,
      "google_auth_not_configured",
      "Google access for the AI assistant is not configured on the server."
    );
  }
  return crypto
    .createHmac("sha256", secret)
    .update(`${domain}\0${String(value)}`, "utf8")
    .digest("base64url");
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""), "utf8");
  const b = Buffer.from(String(right || ""), "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function setCookie(res, name, value, { maxAge }) {
  if (!res?.setHeader) return;
  appendHeader(
    res,
    "Set-Cookie",
    `${name}=${value}; Path=/; Max-Age=${Math.max(
      0,
      Math.floor(maxAge)
    )}; HttpOnly; Secure; SameSite=Lax`
  );
}

function clearCookie(res, name) {
  setCookie(res, name, "", { maxAge: 0 });
}

function appendHeader(res, name, value) {
  const current = res.getHeader?.(name);
  if (current == null) {
    res.setHeader(name, value);
  } else if (Array.isArray(current)) {
    res.setHeader(name, [...current, value]);
  } else {
    res.setHeader(name, [String(current), value]);
  }
}

function readCookie(req, name) {
  const header = getHeader(req, "cookie");
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    const value = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return "";
    }
  }
  return "";
}

function getHeader(req, name) {
  const headers = req?.headers || {};
  const value = headers[name] ?? headers[name.toLowerCase()] ?? "";
  return Array.isArray(value) ? String(value[0] || "") : String(value || "");
}

function acceptsJson(req) {
  return getHeader(req, "accept")
    .split(",")
    .some((entry) => entry.trim().split(";", 1)[0].toLowerCase() === "application/json");
}

function isValidInstallationSecret(value) {
  return Buffer.byteLength(String(value || ""), "utf8") >= 16 &&
    Buffer.byteLength(String(value || ""), "utf8") <= 512;
}

function sendJson(res, status, payload) {
  if (!res || res.writableEnded) return;
  if (typeof res.status === "function" && typeof res.json === "function") {
    res.status(status).json(payload);
    return;
  }
  const body = `${JSON.stringify(payload)}\n`;
  res.statusCode = status;
  res.setHeader?.("Content-Type", "application/json; charset=utf-8");
  res.setHeader?.("Cache-Control", "no-store");
  res.setHeader?.("Content-Length", Buffer.byteLength(body));
  res.end?.(body);
}

function sendRedirect(res, location) {
  if (!res || res.writableEnded) return;
  if (typeof res.redirect === "function") {
    res.redirect(302, location);
    return;
  }
  res.statusCode = 302;
  res.setHeader?.("Location", location);
  res.setHeader?.("Cache-Control", "no-store");
  res.setHeader?.("Content-Length", "0");
  res.end?.();
}

function readSecretOption(optionValue, environment, envName, credentialName) {
  if (optionValue != null) return normalizeSecret(optionValue);
  if (environment[envName]) return normalizeSecret(environment[envName]);
  const directory = String(environment.CREDENTIALS_DIRECTORY || "").trim();
  if (!directory) return "";
  try {
    return normalizeSecret(fs.readFileSync(path.join(directory, credentialName), "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return "";
    throw error;
  }
}

function normalizeSecret(value) {
  return Buffer.isBuffer(value) ? value.toString("utf8").trim() : String(value || "").trim();
}

function isStrongSecret(value) {
  return Buffer.byteLength(String(value || ""), "utf8") >= 32;
}

function normalizeBaseUrl(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  try {
    const url = new URL(text);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return "";
    url.hash = "";
    url.search = "";
    return url.toString();
  } catch {
    return "";
  }
}

function parseUrl(value, baseUrl) {
  try {
    if (value instanceof URL) return value;
    return new URL(String(value || ""), baseUrl || "http://127.0.0.1");
  } catch {
    throw new AiAccessError(
      400,
      "oauth_callback_invalid",
      "The Google sign-in response is invalid."
    );
  }
}

function normalizeIdentifier(value, maxBytes) {
  const text = String(value || "").trim();
  if (!text || Buffer.byteLength(text, "utf8") > maxBytes) return "";
  return text;
}

function normalizeOptionalRequestId(value, { required = false } = {}) {
  if (value == null || value === "") {
    if (!required) return "";
    throw new AiAccessError(
      400,
      "request_id_missing",
      "A request identifier is required."
    );
  }
  const normalized = normalizeIdentifier(value, 160);
  if (
    !normalized ||
    normalized.startsWith("internal:") ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    throw new AiAccessError(
      400,
      "request_id_invalid",
      "The request identifier is invalid."
    );
  }
  return normalized;
}

function readStrictBoolean(value, fallback, name) {
  if (value == null || value === "") return fallback;
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === "1" || normalized === "true") return true;
  if (normalized === "0" || normalized === "false") return false;
  throw new TypeError(`${name} must be 0, 1, true, or false.`);
}

function readInteger(value, min, max, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max
    ? parsed
    : fallback;
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

module.exports = {
  ACCOUNT_WORKSPACE_MAX_BYTES,
  ACCOUNT_WORKSPACE_SCHEMA_VERSIONS,
  AI_ACCESS_SCHEMA_VERSION: SCHEMA_VERSION,
  AiAccessError,
  AiAccessService,
  CREDIT_NANO_USD,
  DEFAULT_MODEL,
  DEFAULT_PRICE_CATALOG_VERSION,
  DEVICE_COOKIE,
  INSTALLATION_SECRET_HEADER,
  LONG_CONTEXT_THRESHOLD,
  MODEL_PRICES,
  PRICE_CATALOGS,
  SESSION_COOKIE,
  calculateUsageCostNanoUsd,
  createAiAccessService,
  maskEmail,
  nanoUsdToCredits,
  normalizeUsage,
  parseCreditsToNanoUsd,
};
