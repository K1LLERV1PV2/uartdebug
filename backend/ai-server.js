"use strict";

const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const {
  AiServiceError,
  createAvrAiService,
} = require("./avr-ai-service");

const AI_SERVER_VERSION = "20260821-avr-ai-chat-v1";
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8083;
const MAX_REQUEST_BYTES = 384 * 1024;
const DEFAULT_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_REQUESTS_PER_WINDOW = 5;
const DEFAULT_DAILY_LIMIT = 50;
const DEFAULT_MAX_CONCURRENT = 2;

function createAiHttpServer(options = {}) {
  const environment = options.environment || process.env;
  const aiService =
    options.aiService ||
    createAvrAiService({
      environment,
      serverDirectory: options.serverDirectory || __dirname,
      fetch: options.fetch,
    });
  const now = options.now || (() => Date.now());
  const log = options.log || console;
  const allowedOrigins = new Set(
    String(environment.ALLOWED_ORIGINS || "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean)
  );
  const windowMs = readInteger(
    environment.AI_RATE_WINDOW_MS,
    1000,
    24 * 60 * 60 * 1000,
    DEFAULT_WINDOW_MS
  );
  const requestsPerWindow = readInteger(
    environment.AI_RATE_REQUESTS,
    1,
    1000,
    DEFAULT_REQUESTS_PER_WINDOW
  );
  const dailyLimit = readInteger(
    environment.AI_DAILY_LIMIT,
    1,
    100000,
    DEFAULT_DAILY_LIMIT
  );
  const maxConcurrent = readInteger(
    environment.AI_MAX_CONCURRENT,
    1,
    20,
    DEFAULT_MAX_CONCURRENT
  );
  const requireBrowserOrigin = !readBoolean(
    environment.AI_ALLOW_NO_ORIGIN,
    false
  );
  const budgetFile =
    options.budgetFile === false
      ? ""
      : String(
          options.budgetFile ||
            environment.AI_BUDGET_FILE ||
            (environment.AI_DRAFTS_DIR
              ? path.join(environment.AI_DRAFTS_DIR, "daily-budget.json")
              : "")
        ).trim();
  const rateBuckets = new Map();
  let dailyBucket = loadDailyBucket(budgetFile, now());
  let concurrentRequests = 0;

  const server = http.createServer(async (req, res) => {
    const startedAt = now();
    const requestId = crypto.randomUUID();
    applySecurityHeaders(res, requestId);

    if (!isAllowedRequest(req, allowedOrigins)) {
      return sendJson(res, 403, {
        ok: false,
        code: "origin_not_allowed",
        message: "Origin is not allowed.",
        requestId,
      });
    }

    const requestUrl = parseRequestUrl(req);
    if (!requestUrl) {
      return sendJson(res, 400, {
        ok: false,
        code: "invalid_request_url",
        message: "Invalid request URL.",
        requestId,
      });
    }

    if (req.method === "GET" && requestUrl.pathname === "/health") {
      return sendText(res, 200, `ok ${AI_SERVER_VERSION}\n`);
    }

    if (
      req.method === "GET" &&
      requestUrl.pathname === "/api/avr/ai/status"
    ) {
      try {
        const status = await aiService.getStatus();
        return sendJson(res, 200, {
          ...status,
          aiServerVersion: AI_SERVER_VERSION,
          requestId,
        });
      } catch {
        return sendJson(res, 503, {
          ok: false,
          code: "ai_status_unavailable",
          message: "AI status is temporarily unavailable.",
          aiServerVersion: AI_SERVER_VERSION,
          requestId,
        });
      }
    }

    if (
      req.method === "POST" &&
      ["/api/avr/ai/respond", "/api/avr/ai/generate"].includes(
        requestUrl.pathname
      )
    ) {
      if (
        requireBrowserOrigin &&
        !String(req.headers.origin || "").trim()
      ) {
        return sendJson(res, 403, {
          ok: false,
          code: "origin_required",
          message: "A same-origin browser request is required.",
          requestId,
        });
      }
      if (!isJsonRequest(req)) {
        return sendJson(res, 415, {
          ok: false,
          code: "json_required",
          message: "Content-Type must be application/json.",
          requestId,
        });
      }

      const accessToken = String(
        req.headers["x-uartdebug-ai-token"] || ""
      ).trim();
      if (
        typeof aiService.authorizeAccessToken !== "function" ||
        !aiService.authorizeAccessToken(accessToken)
      ) {
        return sendJson(res, 401, {
          ok: false,
          code: "owner_access_required",
          message: "A valid owner access code is required.",
          requestId,
        });
      }

      let requestBody;
      try {
        requestBody = await readJsonBody(req, MAX_REQUEST_BYTES);
      } catch (error) {
        const status = error?.code === "body_too_large" ? 413 : 400;
        return sendJson(res, status, {
          ok: false,
          code: error?.code || "invalid_json",
          message:
            status === 413
              ? "Request body is too large."
              : "Invalid JSON request body.",
          requestId,
        });
      }

      try {
        const validateInput =
          aiService.validateRequestInput || aiService.validateGenerationInput;
        if (typeof validateInput === "function") {
          validateInput.call(aiService, requestBody);
        }
        const status = await aiService.getStatus();
        if (!status.enabled) {
          throw new AiServiceError(
            503,
            "ai_disabled",
            "The AI assistant is currently disabled."
          );
        }
        if (status.accessRequired && !status.accessConfigured) {
          throw new AiServiceError(
            503,
            "owner_access_not_configured",
            "Owner access is not configured on the server."
          );
        }
        if (!status.configured) {
          throw new AiServiceError(
            503,
            "api_key_not_configured",
            "The OpenAI API key is not configured on the server."
          );
        }
        if (!status.rules) {
          throw new AiServiceError(
            503,
            status.rulesError || "rules_unavailable",
            "The active AI rules are unavailable."
          );
        }
      } catch (error) {
        const normalized = normalizeServiceError(error);
        return sendJson(res, normalized.status, {
          ok: false,
          code: normalized.code,
          message: normalized.message,
          requestId,
        });
      }

      if (concurrentRequests >= maxConcurrent) {
        res.setHeader("Retry-After", "10");
        return sendJson(res, 429, {
          ok: false,
          code: "ai_busy",
          message: "The AI assistant is busy. Try again shortly.",
          requestId,
        });
      }

      const clientKey = getClientKey(req);
      const limitResult = takeRateLimit({
        clientKey,
        now: now(),
        rateBuckets,
        windowMs,
        requestsPerWindow,
        dailyBucket,
        dailyLimit,
      });
      dailyBucket = limitResult.dailyBucket;
      if (!limitResult.allowed) {
        res.setHeader("Retry-After", String(limitResult.retryAfterSeconds));
        return sendJson(res, 429, {
          ok: false,
          code: limitResult.code,
          message: "AI request limit reached. Try again later.",
          requestId,
        });
      }
      try {
        persistDailyBucket(budgetFile, dailyBucket);
      } catch {
        return sendJson(res, 503, {
          ok: false,
          code: "budget_store_unavailable",
          message: "The AI usage budget cannot be updated.",
          requestId,
        });
      }

      concurrentRequests += 1;
      try {
        const respond = aiService.respond || aiService.generate;
        if (typeof respond !== "function") {
          throw new AiServiceError(
            503,
            "ai_unavailable",
            "The AI assistant is unavailable."
          );
        }
        const result = await respond.call(aiService, requestBody);
        log.info?.(
          `[avr-ai] request=${requestId} status=200 duration_ms=${Math.max(
            0,
            now() - startedAt
          )}`
        );
        return sendJson(res, 200, { ...result, requestId });
      } catch (error) {
        const normalized = normalizeServiceError(error);
        log.warn?.(
          `[avr-ai] request=${requestId} status=${normalized.status} code=${
            normalized.code
          } duration_ms=${Math.max(0, now() - startedAt)}`
        );
        return sendJson(res, normalized.status, {
          ok: false,
          code: normalized.code,
          message: normalized.message,
          requestId,
        });
      } finally {
        concurrentRequests = Math.max(0, concurrentRequests - 1);
      }
    }

    return sendJson(res, 404, {
      ok: false,
      code: "not_found",
      message: "Not found.",
      requestId,
    });
  });

  server.on("clientError", (error, socket) => {
    if (socket.writable) {
      socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
    }
  });

  return server;
}

function takeRateLimit({
  clientKey,
  now,
  rateBuckets,
  windowMs,
  requestsPerWindow,
  dailyBucket,
  dailyLimit,
}) {
  const dayKey = getUtcDayKey(now);
  const currentDaily =
    dailyBucket.key === dayKey ? dailyBucket : { key: dayKey, count: 0 };
  if (currentDaily.count >= dailyLimit) {
    return {
      allowed: false,
      code: "daily_limit_reached",
      retryAfterSeconds: secondsUntilNextUtcDay(now),
      dailyBucket: currentDaily,
    };
  }

  const previous = rateBuckets.get(clientKey);
  const bucket =
    previous && now - previous.startedAt < windowMs
      ? previous
      : { startedAt: now, count: 0 };
  if (bucket.count >= requestsPerWindow) {
    return {
      allowed: false,
      code: "rate_limit_reached",
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((bucket.startedAt + windowMs - now) / 1000)
      ),
      dailyBucket: currentDaily,
    };
  }

  bucket.count += 1;
  currentDaily.count += 1;
  rateBuckets.set(clientKey, bucket);
  pruneRateBuckets(rateBuckets, now, windowMs);
  return {
    allowed: true,
    dailyBucket: currentDaily,
    retryAfterSeconds: 0,
  };
}

function pruneRateBuckets(rateBuckets, now, windowMs) {
  if (rateBuckets.size < 1000) return;
  for (const [key, bucket] of rateBuckets) {
    if (now - bucket.startedAt >= windowMs) rateBuckets.delete(key);
  }
}

function getUtcDayKey(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function secondsUntilNextUtcDay(timestamp) {
  const current = new Date(timestamp);
  const next = Date.UTC(
    current.getUTCFullYear(),
    current.getUTCMonth(),
    current.getUTCDate() + 1
  );
  return Math.max(1, Math.ceil((next - timestamp) / 1000));
}

function applySecurityHeaders(res, requestId) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
  );
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Request-Id", requestId);
}

function isAllowedRequest(req, allowedOrigins) {
  const fetchSite = String(req.headers["sec-fetch-site"] || "").toLowerCase();
  if (fetchSite === "cross-site") return false;

  const origin = String(req.headers.origin || "").trim();
  if (!origin) return true;
  if (allowedOrigins.has(origin)) return true;

  try {
    const originUrl = new URL(origin);
    const forwardedHost = getFirstHeaderValue(req.headers["x-forwarded-host"]);
    const host = forwardedHost || String(req.headers.host || "").trim();
    return !!host && originUrl.host === host;
  } catch {
    return false;
  }
}

function parseRequestUrl(req) {
  try {
    return new URL(req.url || "/", "http://127.0.0.1");
  } catch {
    return null;
  }
}

function getClientKey(req) {
  const remote = String(req.socket.remoteAddress || "unknown");
  const realIp = isLoopbackAddress(remote)
    ? getFirstHeaderValue(req.headers["x-real-ip"])
    : "";
  const candidate = realIp || remote;
  return candidate.replace(/[^A-Fa-f0-9:.,_-]/g, "").slice(0, 96) || "unknown";
}

function isLoopbackAddress(value) {
  const address = String(value || "").toLowerCase();
  return (
    address === "127.0.0.1" ||
    address === "::1" ||
    address === "::ffff:127.0.0.1"
  );
}

function getFirstHeaderValue(value) {
  const text = Array.isArray(value) ? value[0] : String(value || "");
  return text.split(",")[0].trim();
}

function isJsonRequest(req) {
  const contentType = String(req.headers["content-type"] || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  return contentType === "application/json";
}

function readJsonBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let finished = false;

    const fail = (code) => {
      if (finished) return;
      finished = true;
      const error = new Error(code);
      error.code = code;
      reject(error);
    };

    req.on("data", (chunk) => {
      if (finished) return;
      total += chunk.length;
      if (total > maxBytes) {
        fail("body_too_large");
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (finished) return;
      finished = true;
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        const error = new Error("invalid_json");
        error.code = "invalid_json";
        reject(error);
      }
    });
    req.on("error", () => fail("invalid_json"));
  });
}

function normalizeServiceError(error) {
  if (error instanceof AiServiceError) {
    return {
      status: Number(error.status) || 500,
      code: error.code || "ai_error",
      message: error.message || "AI generation failed.",
    };
  }
  return {
    status: 500,
    code: "internal_error",
    message: "Internal AI service error.",
  };
}

function sendJson(res, status, body) {
  if (res.writableEnded) return;
  const payload = `${JSON.stringify(body)}\n`;
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Length", Buffer.byteLength(payload));
  res.end(payload);
}

function sendText(res, status, body) {
  if (res.writableEnded) return;
  res.statusCode = status;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Content-Length", Buffer.byteLength(body));
  res.end(body);
}

function readInteger(value, min, max, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max
    ? parsed
    : fallback;
}

function readBoolean(value, fallback) {
  if (value == null || value === "") return fallback;
  return /^(?:1|true|yes|on)$/i.test(String(value).trim());
}

function loadDailyBucket(budgetFile, timestamp) {
  const fallback = { key: getUtcDayKey(timestamp), count: 0 };
  if (!budgetFile) return fallback;
  try {
    const stored = JSON.parse(fs.readFileSync(budgetFile, "utf8"));
    if (
      stored?.key === fallback.key &&
      Number.isInteger(stored.count) &&
      stored.count >= 0
    ) {
      return { key: stored.key, count: stored.count };
    }
  } catch {}
  return fallback;
}

function persistDailyBucket(budgetFile, dailyBucket) {
  if (!budgetFile) return;
  const directory = path.dirname(budgetFile);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporaryFile = `${budgetFile}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(
      temporaryFile,
      `${JSON.stringify({
        schemaVersion: 1,
        key: dailyBucket.key,
        count: dailyBucket.count,
      })}\n`,
      { encoding: "utf8", mode: 0o600, flag: "wx" }
    );
    fs.renameSync(temporaryFile, budgetFile);
  } catch (error) {
    try {
      fs.rmSync(temporaryFile, { force: true });
    } catch {}
    throw error;
  }
}

if (require.main === module) {
  const host = String(process.env.HOST || process.env.BIND_HOST || DEFAULT_HOST);
  const port = readInteger(process.env.PORT, 1, 65535, DEFAULT_PORT);
  const server = createAiHttpServer();
  server.listen(port, host, () => {
    console.log(
      `[avr-ai] ${AI_SERVER_VERSION} listening on ${host}:${port}`
    );
  });
}

module.exports = {
  AI_SERVER_VERSION,
  createAiHttpServer,
  takeRateLimit,
};
