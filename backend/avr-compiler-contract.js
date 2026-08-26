"use strict";

const AVR_COMPILE_CONTRACT = "uartdebug-avr-compile/v1";
const AVR_COMPILE_SERVER_VERSION = "20260826-verification-contract-v1";
const AVR_COMPILE_HEALTH_SERVICE = "uartdebug-avr-compiler";
const AVR_COMPILE_FAILURE_STAGES = Object.freeze([
  "request",
  "project",
  "compile",
  "link",
  "objcopy",
  "server",
]);

function createCompileEnvelope(fields = {}) {
  return {
    compile_contract: AVR_COMPILE_CONTRACT,
    compile_server_version: AVR_COMPILE_SERVER_VERSION,
    ...fields,
  };
}

function hasExpectedCompileEnvelope(value) {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    value.compile_contract === AVR_COMPILE_CONTRACT &&
    value.compile_server_version === AVR_COMPILE_SERVER_VERSION
  );
}

function isCompileSuccessEnvelope(value) {
  return (
    hasExpectedCompileEnvelope(value) &&
    value.ok === true &&
    typeof value.mcu === "string" &&
    /^[a-z0-9-]{2,32}$/.test(value.mcu) &&
    typeof value.hex_name === "string" &&
    /^[^\\/:*?"<>|\x00-\x1f]{1,96}\.hex$/i.test(value.hex_name) &&
    isIntelHexPayload(value.hex)
  );
}

function isCompileFailureEnvelope(value) {
  return (
    hasExpectedCompileEnvelope(value) &&
    value.ok === false &&
    AVR_COMPILE_FAILURE_STAGES.includes(value.stage) &&
    [value.stderr, value.error].some(
      (text) => typeof text === "string" && text.trim().length > 0
    )
  );
}

function isIntelHexPayload(value) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    Buffer.byteLength(value, "utf8") > 2 * 1024 * 1024
  ) {
    return false;
  }
  const lines = value.trim().split(/\r?\n/);
  if (!lines.length || lines.length > 100_000) return false;
  for (const line of lines) {
    if (!/^:[0-9a-fA-F]{10,}$/.test(line) || (line.length - 1) % 2) {
      return false;
    }
    const bytes = [];
    for (let index = 1; index < line.length; index += 2) {
      bytes.push(Number.parseInt(line.slice(index, index + 2), 16));
    }
    if (bytes.length !== bytes[0] + 5) return false;
    if (bytes.reduce((sum, byte) => sum + byte, 0) % 256 !== 0) return false;
  }
  return lines.at(-1).toUpperCase() === ":00000001FF";
}

module.exports = {
  AVR_COMPILE_CONTRACT,
  AVR_COMPILE_FAILURE_STAGES,
  AVR_COMPILE_HEALTH_SERVICE,
  AVR_COMPILE_SERVER_VERSION,
  createCompileEnvelope,
  hasExpectedCompileEnvelope,
  isCompileFailureEnvelope,
  isCompileSuccessEnvelope,
  isIntelHexPayload,
};
