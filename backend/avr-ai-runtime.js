"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { MAX_COMPILE_REPAIR_ATTEMPTS } = require("./avr-ai-limits");
const {
  AVR_COMPILE_FAILURE_STAGES,
  AVR_COMPILE_HEALTH_SERVICE,
  hasExpectedCompileEnvelope,
  isCompileFailureEnvelope,
  isCompileSuccessEnvelope,
} = require("./avr-compiler-contract");

const DEFAULT_MODEL = "gpt-6.1-sol";
const DEFAULT_REASONING_EFFORT = "medium";
const DEFAULT_TIMEOUT_MS = 120000;
const DEFAULT_MAX_OUTPUT_TOKENS = 24000;
const DEFAULT_MIN_METERED_OUTPUT_TOKENS = 8000;
const DEFAULT_COMPILE_URL = "http://127.0.0.1:8082/api/avr/compile";
const DEFAULT_COMPILE_TIMEOUT_MS = 65000;
const DEFAULT_COMPILE_HEALTH_TIMEOUT_MS = 5000;
const DEFAULT_COMPILE_REPAIR_ATTEMPTS = MAX_COMPILE_REPAIR_ATTEMPTS;
const MAX_COMPILE_DIAGNOSTIC_LENGTH = 24 * 1024;
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const OPENAI_INPUT_TOKENS_URL =
  "https://api.openai.com/v1/responses/input_tokens";
const ALLOWED_REASONING_EFFORTS = new Set([
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);
const REPAIRABLE_COMPILE_STAGES = new Set(["project", "compile", "link"]);
const KNOWN_COMPILE_FAILURE_STAGES = new Set(AVR_COMPILE_FAILURE_STAGES);

class AiServiceError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "AiServiceError";
    this.status = status;
    this.code = code;
  }
}

function getRuntimeConfig(environment = process.env) {
  const apiKey = readCredentialSecret(
    environment,
    "openai_api_key",
    "OPENAI_API_KEY",
    "OPENAI_API_KEY_FILE",
  );
  const accessToken = readCredentialSecret(
    environment,
    "ai_access_token",
    "AI_ACCESS_TOKEN",
    "AI_ACCESS_TOKEN_FILE",
  );
  const model =
    normalizeShortText(environment.OPENAI_MODEL, 96) || DEFAULT_MODEL;
  const configuredEffort = normalizeShortText(
    environment.OPENAI_REASONING_EFFORT,
    16,
  ).toLowerCase();
  const reasoningEffort =
    ALLOWED_REASONING_EFFORTS.has(configuredEffort) &&
    !(model.startsWith("gpt-6.1-sol") && configuredEffort === "none")
      ? configuredEffort
      : DEFAULT_REASONING_EFFORT;
  const maxOutputTokens = readInteger(
    environment.OPENAI_MAX_OUTPUT_TOKENS,
    1000,
    128000,
    DEFAULT_MAX_OUTPUT_TOKENS,
  );
  const minMeteredOutputTokens = readInteger(
    environment.AI_ACCESS_MIN_OUTPUT_TOKENS,
    1000,
    maxOutputTokens,
    Math.min(DEFAULT_MIN_METERED_OUTPUT_TOKENS, maxOutputTokens),
  );

  return {
    enabled: readBoolean(environment.AI_ENABLED, false),
    configured: !!apiKey,
    apiKey,
    requireAccessToken: readBoolean(environment.AI_REQUIRE_ACCESS_TOKEN, false),
    accessConfigured: !!accessToken,
    accessToken,
    safetyIdentifier: accessToken
      ? `ud_${sha256(accessToken).slice(0, 40)}`
      : "",
    model,
    reasoningEffort,
    timeoutMs: readInteger(
      environment.OPENAI_TIMEOUT_MS,
      5000,
      300000,
      DEFAULT_TIMEOUT_MS,
    ),
    maxOutputTokens,
    minMeteredOutputTokens,
    compileVerificationEnabled: readBoolean(
      environment.AI_COMPILE_VERIFY_ENABLED,
      true,
    ),
    compileUrl:
      normalizeCompileUrl(environment.AI_COMPILE_URL) || DEFAULT_COMPILE_URL,
    compileTimeoutMs: readInteger(
      environment.AI_COMPILE_TIMEOUT_MS,
      1000,
      120000,
      DEFAULT_COMPILE_TIMEOUT_MS,
    ),
    compileHealthUrl:
      normalizeCompileUrl(environment.AI_COMPILE_HEALTH_URL) ||
      deriveCompileHealthUrl(
        normalizeCompileUrl(environment.AI_COMPILE_URL) || DEFAULT_COMPILE_URL,
      ),
    compileHealthTimeoutMs: readInteger(
      environment.AI_COMPILE_HEALTH_TIMEOUT_MS,
      500,
      15000,
      DEFAULT_COMPILE_HEALTH_TIMEOUT_MS,
    ),
    compileRepairAttempts: readInteger(
      environment.AI_COMPILE_MAX_REPAIR_ATTEMPTS,
      0,
      MAX_COMPILE_REPAIR_ATTEMPTS,
      DEFAULT_COMPILE_REPAIR_ATTEMPTS,
    ),
  };
}

// Headers do not complete a request: keep the deadline active while JSON is
// received too. Callers retain their own HTTP and malformed-body contracts.
async function fetchJsonWithTimeout(fetchImpl, url, options, timeoutMs, readStream = null) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...options, signal: controller.signal });
    if (readStream && response.ok && String(response.headers?.get?.("content-type") || "").split(";")[0].trim().toLowerCase() === "text/event-stream") {
      return { response, body: await readStream(response), invalidJson: false };
    }
    let body = null;
    let invalidJson = false;
    try {
      body = await response.json();
    } catch (error) {
      controller.signal.throwIfAborted();
      if (error?.name === "AbortError") throw error;
      invalidJson = true;
    }
    return { response, body, invalidJson };
  } catch (error) {
    controller.signal.throwIfAborted();
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function assertCompilerReady({ compileFetchImpl, healthUrl, timeoutMs }) {
  if (typeof compileFetchImpl !== "function") {
    throw new AiServiceError(
      503,
      "compiler_unavailable",
      "The AVR compiler service is unavailable.",
    );
  }
  let result;
  try {
    result = await fetchJsonWithTimeout(compileFetchImpl, healthUrl, {
      method: "GET",
      headers: { Accept: "application/json" },
    }, timeoutMs);
  } catch (error) {
    throw new AiServiceError(
      error?.name === "AbortError" ? 504 : 503,
      error?.name === "AbortError"
        ? "compiler_health_timeout"
        : "compiler_unavailable",
      error?.name === "AbortError"
        ? "The AVR compiler readiness check timed out."
        : "The AVR compiler service is unavailable.",
    );
  }
  const { response, body } = result;
  if (!response.ok) {
    throw new AiServiceError(
      503,
      "compiler_unavailable",
      "The AVR compiler service is unavailable.",
    );
  }
  if (
    !hasExpectedCompileEnvelope(body) ||
    body.ok !== true ||
    body.service !== AVR_COMPILE_HEALTH_SERVICE
  ) {
    throw new AiServiceError(
      503,
      "compiler_contract_mismatch",
      "The AVR compiler service contract does not match this AI service.",
    );
  }
  return true;
}

async function verifyGeneratedProjectCompilation({
  compileFetchImpl,
  compileUrl,
  timeoutMs,
  generated,
  mcu,
}) {
  let result;
  try {
    result = await fetchJsonWithTimeout(compileFetchImpl, compileUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: generated.source.name,
        code: generated.source.content,
        project_files: [generated.source],
        mcu,
        optimize: "O1",
      }),
    }, timeoutMs);
  } catch (error) {
    throw new AiServiceError(
      error?.name === "AbortError" ? 504 : 503,
      error?.name === "AbortError"
        ? "compiler_timeout"
        : "compiler_unavailable",
      error?.name === "AbortError"
        ? "The AVR compiler check timed out."
        : "The AVR compiler service is unavailable.",
    );
  }
  const { response, body, invalidJson } = result;
  if (invalidJson) {
    throw new AiServiceError(
      503,
      "compiler_invalid_response",
      "The AVR compiler service returned an invalid response.",
    );
  }

  if (!hasExpectedCompileEnvelope(body)) {
    throw new AiServiceError(
      503,
      "compiler_contract_mismatch",
      "The AVR compiler service contract does not match this AI service.",
    );
  }

  if (response.ok) {
    if (!isCompileSuccessEnvelope(body)) {
      throw new AiServiceError(
        503,
        "compiler_invalid_response",
        "The AVR compiler service returned an invalid response.",
      );
    }
    if (
      String(body.mcu || "")
        .trim()
        .toLowerCase() !== mcu
    ) {
      throw new AiServiceError(
        503,
        "compiler_target_mismatch",
        "The AVR compiler checked a different MCU target.",
      );
    }
    return { ok: true, compilerStage: "complete" };
  }

  const rawStage = normalizeShortText(body?.stage, 32).toLowerCase();
  if (
    !Number.isInteger(response.status) ||
    response.status < 400 ||
    response.status > 599 ||
    !isCompileFailureEnvelope(body) ||
    !KNOWN_COMPILE_FAILURE_STAGES.has(rawStage)
  ) {
    throw new AiServiceError(
      503,
      "compiler_invalid_response",
      "The AVR compiler service returned an invalid response.",
    );
  }

  const diagnostics = normalizeCompilerDiagnostics(body);
  if (
    response.status >= 500 ||
    diagnostics.compilerStage === "server" ||
    diagnostics.compilerStage === "objcopy" ||
    /(?:executable was not found|\bENOENT\b|spawn .* not found)/i.test(
      diagnostics.stderr,
    )
  ) {
    throw new AiServiceError(
      503,
      "compiler_unavailable",
      "The AVR compiler service is unavailable.",
    );
  }
  if (
    diagnostics.compilerStage === "request" &&
    /unsupported MCU target/i.test(diagnostics.stderr)
  ) {
    throw new AiServiceError(
      400,
      "unsupported_mcu",
      `The selected MCU ${mcu} is not supported by the AVR compiler.`,
    );
  }
  if (!REPAIRABLE_COMPILE_STAGES.has(diagnostics.compilerStage)) {
    throw new AiServiceError(
      503,
      "compiler_invalid_response",
      "The AVR compiler service returned a non-repairable request failure.",
    );
  }
  return {
    ok: false,
    compilerStage: diagnostics.compilerStage,
    diagnostics,
  };
}

function normalizeCompilerDiagnostics(raw) {
  const compilerStage = normalizeShortText(raw?.stage, 32).toLowerCase();
  const failedFile = normalizeShortText(raw?.failed_file, 96);
  const stdout = normalizeCompilerDiagnosticText(raw?.stdout, 8192);
  const stderr = normalizeCompilerDiagnosticText(
    raw?.stderr || raw?.error,
    16 * 1024,
  );
  const diagnostics = {
    compilerStage: compilerStage || "compile",
    ...(failedFile ? { failedFile } : {}),
    ...(stdout ? { stdout } : {}),
    stderr: stderr || "The compiler rejected the generated source.",
  };
  const serialized = JSON.stringify(diagnostics);
  if (Buffer.byteLength(serialized, "utf8") <= MAX_COMPILE_DIAGNOSTIC_LENGTH) {
    return diagnostics;
  }
  return {
    compilerStage: diagnostics.compilerStage,
    ...(failedFile ? { failedFile } : {}),
    stderr: normalizeCompilerDiagnosticText(
      diagnostics.stderr,
      MAX_COMPILE_DIAGNOSTIC_LENGTH / 2,
    ),
  };
}

function normalizeCompilerDiagnosticText(value, maxBytes) {
  if (typeof value !== "string") return "";
  const normalized = value
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .trim();
  if (Buffer.byteLength(normalized, "utf8") <= maxBytes) return normalized;
  let end = Math.min(normalized.length, maxBytes);
  while (
    end > 0 &&
    Buffer.byteLength(normalized.slice(0, end), "utf8") > maxBytes
  ) {
    end -= 1;
  }
  return `${normalized.slice(0, end)}\n[compiler diagnostics truncated]`;
}

function mergeOpenAiMetering(left, right) {
  if (!left) return right;
  if (!right) return left;
  const usage = {};
  for (const key of [
    "inputTokens",
    "cachedInputTokens",
    "cacheWriteTokens",
    "outputTokens",
    "reasoningTokens",
    "totalTokens",
  ]) {
    const total =
      BigInt(left.usage?.[key] || 0) + BigInt(right.usage?.[key] || 0);
    if (total > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new AiServiceError(
        502,
        "openai_usage_invalid",
        "The AI provider returned usage information that is too large.",
      );
    }
    usage[key] = Number(total);
  }
  return {
    provider: right.provider || left.provider,
    responseId: right.responseId || left.responseId,
    model: right.model || left.model,
    usage,
    responses: [
      ...(Array.isArray(left.responses)
        ? left.responses
        : [toOpenAiMeteringResponse(left)]),
      ...(Array.isArray(right.responses)
        ? right.responses
        : [toOpenAiMeteringResponse(right)]),
    ],
  };
}

function toOpenAiMeteringResponse(metering) {
  return {
    provider: metering.provider,
    responseId: metering.responseId,
    model: metering.model,
    usage: { ...metering.usage },
  };
}

function toPublicProgress(stages, status) {
  return {
    schemaVersion: 1,
    status,
    stages: stages.map((stage) => ({ ...stage })),
  };
}

async function emitProgressEvent(requestContext, stage) {
  if (typeof requestContext?.onProgress !== "function") return;
  try {
    await requestContext.onProgress({
      schemaVersion: 1,
      ...stage,
    });
  } catch {
    // Progress delivery is best-effort. Provider usage and compiler work must
    // still be settled if a streaming client disconnects.
  }
}

async function deliverPreview(callback, value) {
  if (typeof callback !== "function") return;
  try { await callback(value); } catch {
    // A disconnected browser must not interrupt provider usage settlement.
  }
}

// Decode only the public top-level JSON message/action strings. Other strings
// (source, resource YAML, nested messages and tool arguments) never leave here.
function createMessagePreview() {
  let depth = 0, string = false, escaped = false, unicode = "", unicodeLeft = 0;
  let keyExpected = false, valueExpected = false, key = "", capture = null, token = "";
  let broken = false, ended = false, high = "", messageBytes = 0, total = 0;
  return {
    push(text) {
      let delta = "", action = null;
      const unit = value => {
        if (capture !== "message") {
          if (capture && token.length < 128) token += value;
          return;
        }
        const code = value.charCodeAt(0);
        if (high) {
          if (code >= 0xdc00 && code <= 0xdfff) { value = high + value; high = ""; }
          else { high = ""; broken = true; return; }
        } else if (code >= 0xd800 && code <= 0xdbff) { high = value; return; }
        else if (code >= 0xdc00 && code <= 0xdfff || value === "\0") { broken = true; return; }
        messageBytes += Buffer.byteLength(value);
        if (messageBytes <= 32 * 1024) delta += value;
      };
      for (const character of text.split("")) {
        if (broken || ended) break;
        if (++total > 512 * 1024) { broken = true; break; }
        if (string) {
          if (unicodeLeft) {
            if (!/[0-9a-f]/i.test(character)) { broken = true; break; }
            unicode += character;
            if (!--unicodeLeft) { unit(String.fromCharCode(Number.parseInt(unicode, 16))); unicode = ""; }
          } else if (escaped) {
            escaped = false;
            if (character === "u") { unicodeLeft = 4; unicode = ""; }
            else {
              const escapes = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
              if (!Object.hasOwn(escapes, character)) { broken = true; break; }
              unit(escapes[character]);
            }
          } else if (character === "\\") escaped = true;
          else if (character === '"') {
            string = false;
            if (capture === "key") { key = token; keyExpected = false; }
            else {
              valueExpected = false;
              if (capture === "action" && ["reply", "clarify", "generate", "describe"].includes(token)) action = token;
            }
            capture = null;
          } else if (character.charCodeAt(0) < 0x20) broken = true;
          else unit(character);
        } else if (character === '"') {
          string = true; token = "";
          capture = depth === 1 ? keyExpected ? "key" : valueExpected && ["message", "action"].includes(key) ? key : null : null;
        } else if (character === "{" || character === "[") {
          depth++;
          if (depth === 1) keyExpected = character === "{";
        } else if (character === "}" || character === "]") {
          if (--depth <= 0) ended = true;
        } else if (depth === 1 && character === ":") valueExpected = true;
        else if (depth === 1 && character === ",") { keyExpected = true; valueExpected = false; key = ""; }
      }
      return { delta, action };
    },
  };
}

function streamError() {
  return new AiServiceError(502, "openai_stream_invalid", "The AI response stream ended unexpectedly. Try again.");
}

async function readOpenAiStream(response, { onMessageDelta, onAction }) {
  if (!response.body?.getReader) throw streamError();
  const reader = response.body.getReader(), decoder = new TextDecoder();
  const preview = createMessagePreview();
  let buffer = "", data = [], eventBytes = 0, totalBytes = 0, terminal = null, textKey = null;
  const processData = async () => {
    if (!data.length) return;
    const payload = data.join("\n"); data = []; eventBytes = 0;
    if (payload === "[DONE]") return;
    let event;
    try { event = JSON.parse(payload); } catch { throw streamError(); }
    if (["response.completed", "response.incomplete", "response.failed"].includes(event?.type)) {
      if (!event.response || typeof event.response !== "object") throw streamError();
      terminal = event.response;
    } else if (event?.type === "error") throw streamError();
    else if (event?.type === "response.output_text.delta" && typeof event.delta === "string") {
      const item = `${event.output_index ?? 0}:${event.content_index ?? 0}:${event.item_id ?? ""}`;
      if (textKey !== null && item !== textKey) return;
      textKey = item;
      const update = preview.push(event.delta);
      if (update.action) await deliverPreview(onAction, update.action);
      if (update.delta) await deliverPreview(onMessageDelta, update.delta);
    }
    // Reasoning events and tool argument deltas are intentionally ignored.
  };
  const line = async value => {
    if (value.endsWith("\r")) value = value.slice(0, -1);
    if (!value) return processData();
    if (value.startsWith("data:")) {
      const fragment = value.slice(5).replace(/^ /, "");
      eventBytes += Buffer.byteLength(fragment);
      if (eventBytes > 2 * 1024 * 1024) throw streamError();
      data.push(fragment);
    }
  };
  try {
    while (!terminal) {
      const { value, done } = await reader.read();
      if (done) {
        buffer += decoder.decode();
        if (buffer) await line(buffer);
        await processData();
        break;
      }
      totalBytes += value.byteLength;
      if (totalBytes > 64 * 1024 * 1024) throw streamError();
      buffer += decoder.decode(value, { stream: true });
      let newline;
      while (!terminal && (newline = buffer.indexOf("\n")) !== -1) {
        const next = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        await line(next);
      }
      if (Buffer.byteLength(buffer) > 2 * 1024 * 1024) throw streamError();
    }
    if (!terminal) throw streamError();
    return terminal;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function beginProgressStage(requestContext, stages, fields) {
  const labels = {
    generation: "Preparing the response",
    documentation: "Reading local documentation",
    validation: "Checking the response and project requirements",
    compilation: "Compiling the program",
    repair: "Correcting the response after checks",
  };
  const stage = {
    label: labels[fields.id] || "Processing the request",
    ...fields,
    status: "in_progress",
  };
  stages.push(stage);
  await emitProgressEvent(requestContext, { ...stage });
  return stage;
}

async function finishProgressStage(requestContext, stage, status, fields = {}) {
  Object.assign(stage, fields, { status });
  await emitProgressEvent(requestContext, { ...stage });
  return stage;
}

function attachProgressToError(error, stages) {
  if (!error || (typeof error !== "object" && typeof error !== "function")) {
    return error;
  }
  try {
    Object.defineProperty(error, "progress", {
      configurable: true,
      enumerable: false,
      value: toPublicProgress(stages, "failed"),
    });
  } catch {}
  return error;
}

function attachUncertainProviderUsage(error) {
  if (!error || (typeof error !== "object" && typeof error !== "function")) {
    return error;
  }
  try {
    Object.defineProperty(error, "_usageUncertain", {
      configurable: true,
      enumerable: false,
      value: true,
    });
  } catch {}
  return error;
}

async function requestOpenAi({ fetchImpl, apiKey, timeoutMs, requestBody, onMessageDelta, onMessageReset, onAction, resetAtStart = false }) {
  let result;
  const streaming = typeof onMessageDelta === "function";
  let resetSent = false;
  const sendDelta = async delta => {
    if (!resetSent) { await deliverPreview(onMessageReset); resetSent = true; }
    await deliverPreview(onMessageDelta, delta);
  };
  if (streaming && resetAtStart) { await deliverPreview(onMessageReset); resetSent = true; }

  try {
    result = await fetchJsonWithTimeout(fetchImpl, OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(streaming ? { ...requestBody, stream: true } : requestBody),
    }, timeoutMs, streaming ? response => readOpenAiStream(response, { onMessageDelta: sendDelta, onAction }) : null);
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new AiServiceError(
        504,
        "openai_timeout",
        "The AI request timed out.",
      );
    }
    if (error instanceof AiServiceError) throw error;
    throw new AiServiceError(
      502,
      "openai_unavailable",
      "The OpenAI API is temporarily unavailable.",
    );
  }
  const { response, body: responseJson } = result;

  if (!response.ok) {
    const status =
      response.status === 429 ? 429 : response.status >= 500 ? 502 : 503;
    const code =
      response.status === 429
        ? "openai_rate_limited"
        : response.status === 401 || response.status === 403
          ? "openai_auth_failed"
          : "openai_request_failed";
    const error = new AiServiceError(
      status,
      code,
      code === "openai_rate_limited"
        ? "The AI service rate limit was reached. Try again later."
        : code === "openai_auth_failed"
          ? "The server's OpenAI API credentials were rejected."
          : "The OpenAI API could not complete this request.",
    );
    if (
      response.status >= 400 &&
      response.status < 500 &&
      response.status !== 408
    ) {
      Object.defineProperty(error, "_providerRejected", {
        configurable: true,
        enumerable: false,
        value: true,
      });
    }
    throw error;
  }

  if (streaming && String(response.headers?.get?.("content-type") || "").split(";")[0].trim().toLowerCase() !== "text/event-stream") {
    const preview = createMessagePreview();
    for (const item of responseJson?.output || []) for (const content of item?.content || []) {
      if (item.type !== "message" || content.type !== "output_text" || typeof content.text !== "string") continue;
      const update = preview.push(content.text);
      if (update.action) await deliverPreview(onAction, update.action);
      if (update.delta) await sendDelta(update.delta);
    }
  }
  return responseJson;
}

async function requestOpenAiInputTokenCount({
  fetchImpl,
  apiKey,
  timeoutMs,
  requestBody,
}) {
  let result;

  try {
    result = await fetchJsonWithTimeout(fetchImpl, OPENAI_INPUT_TOKENS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(toInputTokenCountRequest(requestBody)),
    }, timeoutMs);
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new AiServiceError(
        504,
        "openai_token_count_timeout",
        "The AI input-token check timed out.",
      );
    }
    throw new AiServiceError(
      502,
      "openai_token_count_unavailable",
      "The AI input-token check is temporarily unavailable.",
    );
  }
  const { response, body: responseJson } = result;
  if (!response.ok) {
    throw new AiServiceError(
      response.status === 429 ? 429 : response.status >= 500 ? 502 : 503,
      response.status === 429
        ? "openai_rate_limited"
        : "openai_token_count_failed",
      response.status === 429
        ? "The AI service rate limit was reached. Try again later."
        : "The AI input-token check could not be completed.",
    );
  }

  const inputTokens = Number(responseJson?.input_tokens);
  if (!Number.isSafeInteger(inputTokens) || inputTokens < 0) {
    throw new AiServiceError(
      502,
      "openai_token_count_invalid",
      "The AI input-token check returned an invalid result.",
    );
  }
  return inputTokens;
}

function toInputTokenCountRequest(requestBody) {
  return {
    model: requestBody.model,
    instructions: requestBody.instructions,
    input: requestBody.input,
    reasoning: requestBody.reasoning,
    parallel_tool_calls: requestBody.parallel_tool_calls,
    tool_choice: requestBody.tool_choice,
    tools: requestBody.tools,
    text: requestBody.text,
  };
}

function extractOpenAiMetering(responseJson, fallbackModel = "", options = {}) {
  const strict = options === true || options?.strict === true;
  if (
    strict &&
    (!responseJson?.usage || typeof responseJson.usage !== "object")
  ) {
    throw new AiServiceError(
      502,
      "openai_usage_invalid",
      "The AI provider did not return valid usage information.",
    );
  }
  const usage =
    responseJson?.usage && typeof responseJson.usage === "object"
      ? responseJson.usage
      : {};
  const inputDetails =
    usage.input_tokens_details && typeof usage.input_tokens_details === "object"
      ? usage.input_tokens_details
      : {};
  const outputDetails =
    usage.output_tokens_details &&
    typeof usage.output_tokens_details === "object"
      ? usage.output_tokens_details
      : {};

  const responseId = normalizeProviderIdentifier(responseJson?.id, 160);
  const model =
    normalizeProviderIdentifier(responseJson?.model, 96) ||
    normalizeProviderIdentifier(fallbackModel, 96);
  const normalizedUsage = {
    inputTokens: normalizeUsageCount(usage.input_tokens, { strict }),
    cachedInputTokens: normalizeUsageCount(inputDetails.cached_tokens),
    cacheWriteTokens: normalizeUsageCount(inputDetails.cache_write_tokens),
    outputTokens: normalizeUsageCount(usage.output_tokens, { strict }),
    reasoningTokens: normalizeUsageCount(outputDetails.reasoning_tokens),
    totalTokens: normalizeUsageCount(usage.total_tokens, { strict }),
  };
  if (
    strict &&
    (!responseId ||
      !model ||
      normalizedUsage.cachedInputTokens + normalizedUsage.cacheWriteTokens >
        normalizedUsage.inputTokens ||
      normalizedUsage.reasoningTokens > normalizedUsage.outputTokens ||
      normalizedUsage.totalTokens !==
        normalizedUsage.inputTokens + normalizedUsage.outputTokens)
  ) {
    throw new AiServiceError(
      502,
      "openai_usage_invalid",
      "The AI provider did not return valid usage information.",
    );
  }

  return {
    provider: "openai",
    responseId,
    model,
    usage: normalizedUsage,
  };
}

function attachMeteringToError(error, metering) {
  if (!error || (typeof error !== "object" && typeof error !== "function")) {
    return error;
  }
  try {
    Object.defineProperty(error, "_metering", {
      configurable: true,
      enumerable: false,
      value: metering,
    });
  } catch {
    // Preserve the original service failure even if the error is immutable.
  }
  return error;
}

function normalizeUsageCount(value, options = {}) {
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0) {
    if (options.strict) {
      throw new AiServiceError(
        502,
        "openai_usage_invalid",
        "The AI provider did not return valid usage information.",
      );
    }
    return 0;
  }
  return Math.min(count, 1_000_000_000_000);
}

function normalizeProviderIdentifier(value, maxLength) {
  if (typeof value !== "string") return "";
  const normalized = value.trim();
  if (!normalized || Buffer.byteLength(normalized, "utf8") > maxLength) {
    return "";
  }
  return normalized;
}

function normalizeSafetyIdentifier(value) {
  const normalized = normalizeProviderIdentifier(value, 64);
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(normalized)
    ? normalized
    : "";
}

function parseStructuredOutput(responseJson) {
  if (!responseJson || typeof responseJson !== "object") {
    throw new AiServiceError(
      502,
      "invalid_ai_response",
      "The AI service returned an invalid response.",
    );
  }

  if (responseJson.status === "failed") {
    throw new AiServiceError(502, "ai_response_failed", "The AI service could not complete this response. Try again.");
  }

  if (responseJson.status === "incomplete") {
    const reason = String(responseJson.incomplete_details?.reason || "");
    throw new AiServiceError(
      reason === "content_filter" ? 422 : 502,
      reason === "max_output_tokens"
        ? "ai_output_limit_reached"
        : reason === "content_filter"
          ? "ai_content_filtered"
          : "incomplete_ai_response",
      reason === "max_output_tokens"
        ? "The AI response reached its output limit. Try a narrower request."
        : reason === "content_filter"
          ? "The AI response was stopped by a content filter."
          : "The AI service returned an incomplete response.",
    );
  }

  const outputItems = Array.isArray(responseJson.output)
    ? responseJson.output
    : [];
  let outputText = "";
  for (const item of outputItems) {
    if (!item || item.type !== "message" || !Array.isArray(item.content)) {
      continue;
    }
    for (const content of item.content) {
      if (content?.type === "refusal") {
        throw new AiServiceError(
          422,
          "ai_refusal",
          "The AI service declined this generation request.",
        );
      }
      if (content?.type === "output_text" && typeof content.text === "string") {
        outputText += content.text;
      }
    }
  }

  if (!outputText && typeof responseJson.output_text === "string") {
    outputText = responseJson.output_text;
  }
  if (!outputText) {
    throw new AiServiceError(
      502,
      "empty_ai_response",
      "The AI service returned no project data.",
    );
  }
  if (Buffer.byteLength(outputText, "utf8") > 512 * 1024) {
    throw new AiServiceError(
      502,
      "invalid_ai_response",
      "The AI service response is too large.",
    );
  }

  try {
    return JSON.parse(outputText);
  } catch {
    throw new AiServiceError(
      502,
      "invalid_ai_response",
      "The AI service returned malformed project data.",
    );
  }
}

function normalizeShortText(value, maxLength) {
  if (value == null) return "";
  const text = String(value).trim();
  return text.length <= maxLength ? text : text.slice(0, maxLength);
}

function normalizeSecret(value) {
  return typeof value === "string" ? value.trim() : "";
}

function readCredentialSecret(
  environment,
  credentialName,
  environmentName,
  fileEnvironmentName,
) {
  const credentialDirectory = normalizeShortText(
    environment.CREDENTIALS_DIRECTORY,
    512,
  );
  const configuredFile = normalizeShortText(
    environment[fileEnvironmentName],
    512,
  );
  const credentialFile =
    configuredFile ||
    (credentialDirectory ? path.join(credentialDirectory, credentialName) : "");

  if (credentialFile) {
    try {
      return normalizeSecret(fs.readFileSync(credentialFile, "utf8"));
    } catch {
      return "";
    }
  }

  return normalizeSecret(environment[environmentName]);
}

function timingSafeSecretEqual(expected, provided) {
  const expectedBuffer = Buffer.from(normalizeSecret(expected), "utf8");
  const providedBuffer = Buffer.from(normalizeSecret(provided), "utf8");
  if (
    !expectedBuffer.length ||
    expectedBuffer.length !== providedBuffer.length
  ) {
    return false;
  }
  return crypto.timingSafeEqual(expectedBuffer, providedBuffer);
}

function readBoolean(value, fallback) {
  if (value == null || value === "") return fallback;
  return /^(?:1|true|yes|on)$/i.test(String(value).trim());
}

function normalizeCompileUrl(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  try {
    const url = new URL(text);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) {
      throw new Error("invalid compiler URL");
    }
    return url.toString();
  } catch {
    throw new AiServiceError(
      503,
      "compiler_configuration_invalid",
      "The AVR compiler service URL is invalid.",
    );
  }
}

function deriveCompileHealthUrl(compileUrl) {
  const url = new URL(compileUrl);
  url.pathname = "/health";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function readInteger(value, min, max, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max
    ? parsed
    : fallback;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

module.exports = {
  AiServiceError,
  getRuntimeConfig,
  assertCompilerReady,
  verifyGeneratedProjectCompilation,
  mergeOpenAiMetering,
  toPublicProgress,
  beginProgressStage,
  finishProgressStage,
  emitProgressEvent,
  attachProgressToError,
  attachUncertainProviderUsage,
  requestOpenAi,
  requestOpenAiInputTokenCount,
  extractOpenAiMetering,
  attachMeteringToError,
  parseStructuredOutput,
  normalizeSafetyIdentifier,
  normalizeProviderIdentifier,
  timingSafeSecretEqual,
};
