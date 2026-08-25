"use strict";

const http = require("http");
const crypto = require("crypto");
const {
  AiServiceError,
  createAvrAiService,
} = require("./avr-ai-service");
const {
  AiAccessError,
  createAiAccessService,
} = require("./ai-access-service");

const AI_SERVER_VERSION = "20260825-workspace-public-auth-v1";
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8083;
const MAX_REQUEST_BYTES = 1024 * 1024;
const DEFAULT_MAX_CONCURRENT = 2;
const DEFAULT_AUTH_START_WINDOW_MS = 10 * 60 * 1000;
const DEFAULT_AUTH_START_MAX_PER_IP = 10;
const DEFAULT_AUTH_START_MAX_GLOBAL = 1000;
const MAX_PUBLIC_SKILLS = 64;
const MAX_PUBLIC_SKILL_MARKDOWN_BYTES = 64 * 1024;
const MAX_PUBLIC_SKILL_PACK_BYTES = 512 * 1024;

function createAiHttpServer(options = {}) {
  const environment = options.environment || process.env;
  const aiService =
    options.aiService ||
    createAvrAiService({
      environment,
      serverDirectory: options.serverDirectory || __dirname,
      fetch: options.fetch,
    });
  const accessService =
    options.accessService ||
    createAiAccessService({
      environment,
      fetch: options.fetch,
      now: options.nowDate,
      randomBytes: options.randomBytes,
    });
  const ownsAccessService = !options.accessService;
  const now = options.now || (() => Date.now());
  const log = options.log || console;
  const allowedOrigins = new Set(
    String(environment.ALLOWED_ORIGINS || "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean)
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
  const authStartLimiter = createFixedWindowLimiter({
    now,
    windowMs: readInteger(
      environment.AI_AUTH_START_WINDOW_MS,
      60_000,
      60 * 60 * 1000,
      DEFAULT_AUTH_START_WINDOW_MS
    ),
    maxPerKey: readInteger(
      environment.AI_AUTH_START_MAX_PER_IP,
      1,
      1000,
      DEFAULT_AUTH_START_MAX_PER_IP
    ),
    maxGlobal: readInteger(
      environment.AI_AUTH_START_MAX_GLOBAL,
      1,
      100_000,
      DEFAULT_AUTH_START_MAX_GLOBAL
    ),
  });
  let concurrentRequests = 0;

  const server = http.createServer(async (req, res) => {
    const startedAt = now();
    const requestId = crypto.randomUUID();
    applySecurityHeaders(res, requestId);

    const requestUrl = parseRequestUrl(req);
    if (!requestUrl) {
      return sendJson(res, 400, {
        ok: false,
        code: "invalid_request_url",
        message: "Invalid request URL.",
        requestId,
      });
    }

    if (
      !isGoogleOAuthCallback(req, requestUrl) &&
      !isAllowedRequest(req, allowedOrigins)
    ) {
      return sendJson(res, 403, {
        ok: false,
        code: "origin_not_allowed",
        message: "Origin is not allowed.",
        requestId,
      });
    }

    if (req.method === "GET" && requestUrl.pathname === "/health") {
      return sendText(res, 200, `ok ${AI_SERVER_VERSION}\n`);
    }

    if (
      req.method === "GET" &&
      requestUrl.pathname === "/api/avr/ai/skills"
    ) {
      try {
        if (typeof aiService.getSkills !== "function") {
          throw new AiServiceError(
            503,
            "skill_catalog_unavailable",
            "The AI skill catalog is unavailable."
          );
        }
        const catalog = normalizePublicSkillCatalog(await aiService.getSkills());
        return sendJson(res, 200, {
          ok: true,
          ...catalog,
          requestId,
        });
      } catch (error) {
        const normalized = normalizeServiceError(error);
        return sendJson(res, normalized.status, {
          ok: false,
          code: normalized.code,
          message: normalized.message,
          requestId,
        });
      }
    }

    if (
      req.method === "GET" &&
      requestUrl.pathname === "/api/avr/ai/auth/session"
    ) {
      return handleAccessEndpoint(
        res,
        requestId,
        () => accessService.getPublicStatus(req, res),
        200
      );
    }

    if (
      req.method === "GET" &&
      requestUrl.pathname === "/api/avr/ai/auth/google/start"
    ) {
      const authLimit = authStartLimiter.consume(getClientAddress(req));
      if (!authLimit.allowed) {
        res.setHeader("Retry-After", String(authLimit.retryAfterSeconds));
        return sendJson(res, 429, {
          ok: false,
          code: "google_auth_rate_limited",
          message: "Too many Google sign-in attempts. Try again later.",
          requestId,
        });
      }
      return handleAccessEndpoint(res, requestId, () =>
        accessService.beginGoogleLogin(req, res)
      );
    }

    if (
      req.method === "GET" &&
      requestUrl.pathname === "/api/avr/ai/auth/google/callback"
    ) {
      return handleAccessEndpoint(
        res,
        requestId,
        () => accessService.completeGoogleLogin(req, res, requestUrl),
        204,
        { redirectErrorsToAvr: true }
      );
    }

    if (
      req.method === "POST" &&
      requestUrl.pathname === "/api/avr/ai/auth/logout"
    ) {
      return handleAccessEndpoint(
        res,
        requestId,
        () => accessService.logout(req, res),
        200
      );
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

      let accessContext;
      try {
        accessContext = await accessService.authorizeAiRequest(req, res, {
          requestId,
        });
      } catch (error) {
        const normalized = normalizeAccessError(error);
        return sendJson(res, normalized.status, {
          ok: false,
          code: normalized.code,
          message: normalized.message,
          requestId,
        });
      }

      concurrentRequests += 1;
      let providerCalled = false;
      let providerRejected = false;
      let usageRecorded = false;
      try {
        const respond = aiService.respond || aiService.generate;
        if (typeof respond !== "function") {
          throw new AiServiceError(
            503,
            "ai_unavailable",
            "The AI assistant is unavailable."
          );
        }
        const result = await respond.call(aiService, requestBody, {
          requestId,
          safetyIdentifier: accessContext?.safetyIdentifier || "",
          reserveBudget:
            accessContext?.mode === "google" &&
            typeof accessService.reserveAiBudget === "function"
              ? (quote) => accessService.reserveAiBudget(accessContext, quote)
              : undefined,
          async markProviderCalled() {
            if (
              accessContext?.mode === "google" &&
              typeof accessService.markAiProviderStarted === "function"
            ) {
              await accessService.markAiProviderStarted(accessContext);
            }
            providerCalled = true;
          },
        });
        const metering = result?._metering || null;
        const publicResult = { ...result };
        delete publicResult._metering;
        let quota = null;
        if (metering) {
          const recorded = await accessService.recordAiUsage(accessContext, {
            requestId,
            ...metering,
          });
          usageRecorded = true;
          quota = recorded?.quota || null;
        }
        log.info?.(
          `[avr-ai] request=${requestId} status=200 duration_ms=${Math.max(
            0,
            now() - startedAt
          )}`
        );
        return sendJson(res, 200, {
          ...publicResult,
          ...(quota ? { quota } : {}),
          requestId,
        });
      } catch (error) {
        providerRejected = error?._providerRejected === true;
        if (error?._metering) {
          try {
            await accessService.recordAiUsage(accessContext, {
              requestId,
              ...error._metering,
            });
            usageRecorded = true;
          } catch (meteringError) {
            log.error?.(
              `[avr-ai] request=${requestId} usage_record_failed code=${
                meteringError?.code || "unknown"
              }`
            );
          }
        }
        const normalized =
          error instanceof AiAccessError
            ? normalizeAccessError(error)
            : normalizeServiceError(error);
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
        try {
          await accessService.releaseAiRequest(accessContext, {
            providerCalled,
            providerRejected,
            usageRecorded,
          });
        } catch (error) {
          log.error?.(
            `[avr-ai] request=${requestId} access_release_failed code=${
              error?.code || "unknown"
            }`
          );
        }
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
  server.on("close", () => {
    if (!ownsAccessService || typeof accessService.close !== "function") return;
    try {
      accessService.close();
    } catch (error) {
      log.error?.(
        `[avr-ai] access_close_failed code=${error?.code || "unknown"}`
      );
    }
  });

  return server;
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

function isGoogleOAuthCallback(req, requestUrl) {
  return (
    req.method === "GET" &&
    requestUrl.pathname === "/api/avr/ai/auth/google/callback"
  );
}

async function handleAccessEndpoint(
  res,
  requestId,
  handler,
  successStatus = 204,
  { redirectErrorsToAvr = false } = {}
) {
  try {
    const result = await handler();
    if (res.writableEnded) return;
    if (result?.redirectUrl) {
      res.statusCode = Number(result.status) || 302;
      res.setHeader("Location", result.redirectUrl);
      return res.end();
    }
    return sendJson(res, successStatus, {
      ok: true,
      ...(result && typeof result === "object" ? result : {}),
      requestId,
    });
  } catch (error) {
    if (res.writableEnded) return;
    const normalized = normalizeAccessError(error);
    if (redirectErrorsToAvr) {
      const query = new URLSearchParams({
        ai_auth: "error",
        ai_auth_code: normalized.code,
      });
      res.statusCode = 303;
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Location", `/avr?${query.toString()}`);
      return res.end();
    }
    return sendJson(res, normalized.status, {
      ok: false,
      code: normalized.code,
      message: normalized.message,
      requestId,
    });
  }
}

function getFirstHeaderValue(value) {
  const text = Array.isArray(value) ? value[0] : String(value || "");
  return text.split(",")[0].trim();
}

function getClientAddress(req) {
  const realIp = getFirstHeaderValue(req?.headers?.["x-real-ip"]);
  if (realIp) return realIp.slice(0, 128);
  const forwarded = String(req?.headers?.["x-forwarded-for"] || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (forwarded.length) return forwarded.at(-1).slice(0, 128);
  return String(req?.socket?.remoteAddress || "unknown").slice(0, 128);
}

function createFixedWindowLimiter({ now, windowMs, maxPerKey, maxGlobal }) {
  const entries = new Map();
  let globalWindowStartedAt = null;
  let globalCount = 0;

  return {
    consume(rawKey) {
      const timestamp = Number(now());
      if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
        throw new TypeError("The rate-limit clock must return a timestamp.");
      }
      if (
        globalWindowStartedAt == null ||
        timestamp - globalWindowStartedAt >= windowMs
      ) {
        globalWindowStartedAt = timestamp;
        globalCount = 0;
        entries.clear();
      }

      if (globalCount >= maxGlobal) {
        return {
          allowed: false,
          retryAfterSeconds: Math.max(
            1,
            Math.ceil((globalWindowStartedAt + windowMs - timestamp) / 1000)
          ),
        };
      }

      const key = String(rawKey || "unknown").slice(0, 128);
      let entry = entries.get(key);
      if (!entry || timestamp - entry.startedAt >= windowMs) {
        entry = { startedAt: timestamp, count: 0 };
        entries.set(key, entry);
      }
      if (entry.count >= maxPerKey) {
        return {
          allowed: false,
          retryAfterSeconds: Math.max(
            1,
            Math.ceil((entry.startedAt + windowMs - timestamp) / 1000)
          ),
        };
      }

      entry.count += 1;
      globalCount += 1;
      return { allowed: true, retryAfterSeconds: 0 };
    },
  };
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

function normalizePublicSkillCatalog(rawCatalog) {
  if (
    !rawCatalog ||
    typeof rawCatalog !== "object" ||
    Array.isArray(rawCatalog) ||
    Number(rawCatalog.schemaVersion) !== 1 ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,47}$/.test(
      String(rawCatalog.catalogVersion || "")
    ) ||
    !/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(
      String(rawCatalog.locale || "")
    ) ||
    !/^[a-f0-9]{64}$/.test(String(rawCatalog.digest || "")) ||
    !Array.isArray(rawCatalog.skills) ||
    rawCatalog.skills.length > MAX_PUBLIC_SKILLS
  ) {
    throw new AiServiceError(
      503,
      "skill_catalog_invalid",
      "The AI skill catalog is invalid."
    );
  }

  const ids = new Set();
  let totalMarkdownBytes = 0;
  const skills = rawCatalog.skills.map((rawSkill) => {
    if (!rawSkill || typeof rawSkill !== "object" || Array.isArray(rawSkill)) {
      throwInvalidPublicSkillCatalog();
    }
    const id = String(rawSkill.id || "").trim();
    const version = String(rawSkill.version || "").trim();
    const title = normalizePublicSkillText(rawSkill.title, 96);
    const summary = normalizePublicSkillText(rawSkill.summary, 300);
    if (
      !/^[a-z0-9][a-z0-9-]{0,63}$/.test(id) ||
      ids.has(id) ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,47}$/.test(version) ||
      typeof rawSkill.markdown !== "string"
    ) {
      throwInvalidPublicSkillCatalog();
    }
    const markdown = rawSkill.markdown.replace(/\r\n?/g, "\n");
    const markdownBytes = Buffer.byteLength(markdown, "utf8");
    if (
      !markdown.trim() ||
      markdown.includes("\u0000") ||
      markdownBytes > MAX_PUBLIC_SKILL_MARKDOWN_BYTES ||
      !/^#{1,6}[ \t]+\S/m.test(markdown) ||
      /<(?:script|style|iframe|object|embed|link|meta|img|svg)\b/i.test(
        markdown
      ) ||
      /(?:javascript|data):/i.test(markdown)
    ) {
      throwInvalidPublicSkillCatalog();
    }
    totalMarkdownBytes += markdownBytes;
    if (totalMarkdownBytes > MAX_PUBLIC_SKILL_PACK_BYTES) {
      throwInvalidPublicSkillCatalog();
    }
    ids.add(id);
    return { id, version, title, summary, markdown };
  });

  return {
    schemaVersion: 1,
    catalogVersion: String(rawCatalog.catalogVersion),
    locale: String(rawCatalog.locale),
    count: skills.length,
    digest: String(rawCatalog.digest),
    skills,
  };
}

function normalizePublicSkillText(value, maxBytes) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.includes("\u0000") ||
    Buffer.byteLength(value, "utf8") > maxBytes
  ) {
    throwInvalidPublicSkillCatalog();
  }
  return value.trim();
}

function throwInvalidPublicSkillCatalog() {
  throw new AiServiceError(
    503,
    "skill_catalog_invalid",
    "The AI skill catalog is invalid."
  );
}

function normalizeAccessError(error) {
  if (error instanceof AiAccessError) {
    return {
      status: Number(error.status) || 500,
      code: error.code || "ai_access_error",
      message: error.message || "AI access could not be verified.",
    };
  }
  return {
    status: 500,
    code: "ai_access_error",
    message: "AI access could not be verified.",
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
};
