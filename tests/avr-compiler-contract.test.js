"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  AVR_COMPILE_CONTRACT,
  AVR_COMPILE_SERVER_VERSION,
  createCompileEnvelope,
  hasExpectedCompileEnvelope,
  isCompileFailureEnvelope,
  isCompileSuccessEnvelope,
} = require("../backend/avr-compiler-contract");
const {
  inspectCompilerReadiness,
} = require("../backend/avr-compiler-readiness");

test("compiler envelopes share one strict contract and version", () => {
  const envelope = createCompileEnvelope({ ok: true, mcu: "attiny1624" });
  assert.equal(envelope.compile_contract, AVR_COMPILE_CONTRACT);
  assert.equal(envelope.compile_server_version, AVR_COMPILE_SERVER_VERSION);
  assert.equal(hasExpectedCompileEnvelope(envelope), true);
  assert.equal(
    hasExpectedCompileEnvelope({
      ...envelope,
      compile_server_version: "unexpected-version",
    }),
    false
  );
  assert.equal(
    isCompileSuccessEnvelope(
      createCompileEnvelope({
        ok: true,
        mcu: "attiny1624",
        hex_name: "firmware.hex",
        hex: ":00000001FF\n",
      })
    ),
    true
  );
  assert.equal(
    isCompileSuccessEnvelope(
      createCompileEnvelope({
        ok: true,
        mcu: "attiny1624",
        hex_name: "firmware.hex",
        hex: ":00000001FE\n",
      })
    ),
    false
  );
  assert.equal(
    isCompileFailureEnvelope(
      createCompileEnvelope({
        ok: false,
        stage: "compile",
        stderr: "main.c: error: invalid expression",
      })
    ),
    true
  );
});

test("compiler readiness fails closed without tools or a readable device pack", () => {
  const available = new Set(["/tools/xc8-cc", "/tools/avr-objcopy", "/dfp"]);
  const directories = new Set(["/dfp"]);
  const deniedModes = new Map();
  const fakeFileSystem = {
    constants: { X_OK: 1, R_OK: 2 },
    accessSync(candidate, mode) {
      if (!available.has(candidate)) throw new Error("missing");
      if ((deniedModes.get(candidate) || 0) & mode) {
        throw new Error("permission denied");
      }
    },
    statSync(candidate) {
      return {
        isDirectory: () => directories.has(candidate),
        isFile: () => available.has(candidate) && !directories.has(candidate),
      };
    },
  };

  assert.deepEqual(
    inspectCompilerReadiness({
      fileSystem: fakeFileSystem,
      xc8Cc: "/tools/xc8-cc",
      avrObjcopy: "/tools/avr-objcopy",
      dfpPath: "/dfp",
    }),
    {
      ready: true,
      checks: { compiler: true, objcopy: true, devicePack: true },
    }
  );

  available.delete("/tools/avr-objcopy");
  assert.deepEqual(
    inspectCompilerReadiness({
      fileSystem: fakeFileSystem,
      xc8Cc: "/tools/xc8-cc",
      avrObjcopy: "/tools/avr-objcopy",
      dfpPath: "/dfp",
    }),
    {
      ready: false,
      checks: { compiler: true, objcopy: false, devicePack: true },
    }
  );

  available.add("/tools/avr-objcopy");
  directories.add("/tools/xc8-cc");
  assert.deepEqual(
    inspectCompilerReadiness({
      fileSystem: fakeFileSystem,
      xc8Cc: "/tools/xc8-cc",
      avrObjcopy: "/tools/avr-objcopy",
      dfpPath: "/dfp",
    }),
    {
      ready: false,
      checks: { compiler: false, objcopy: true, devicePack: true },
    },
    "an executable directory must not be accepted as the compiler binary"
  );

  directories.delete("/tools/xc8-cc");
  deniedModes.set("/dfp", fakeFileSystem.constants.X_OK);
  assert.deepEqual(
    inspectCompilerReadiness({
      fileSystem: fakeFileSystem,
      xc8Cc: "/tools/xc8-cc",
      avrObjcopy: "/tools/avr-objcopy",
      dfpPath: "/dfp",
    }),
    {
      ready: false,
      checks: { compiler: true, objcopy: true, devicePack: false },
    },
    "a readable but non-traversable device-pack directory is unusable"
  );
});
