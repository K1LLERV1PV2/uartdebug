"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { parseHTML } = require("../frontend/markdown-runtime/node_modules/linkedom");

const VALID_HEX = ":0100000000FF\n:00000001FF";

function loadRuntime({ serial, bridge = {} } = {}) {
  const { document, Event } = parseHTML(
    fs.readFileSync(path.join(__dirname, "../public/avr.html"), "utf8")
  );
  const mcuSelect = document.getElementById("mcuSelect");
  // Linkedom does not implement the browser's writable select.value property.
  let selectedValue = "auto";
  Object.defineProperty(mcuSelect, "value", {
    configurable: true,
    get: () => selectedValue,
    set: (value) => { selectedValue = String(value); },
  });
  const windowListeners = new Map();
  const window = {
    __UARTDEBUG_AVR_PROGRAMMING_UPDI_BRIDGE__: bridge,
    addEventListener(type, listener) {
      windowListeners.set(type, listener);
    },
  };
  const navigator = serial ? { serial } : {};
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, "../public/updi-test.js"), "utf8"),
    { window, document, navigator, Event, setTimeout, clearTimeout, console },
    { filename: "updi-test.js" }
  );
  document.dispatchEvent(new Event("DOMContentLoaded"));
  return {
    document,
    window,
    runtime: window.__UARTDEBUG_AVR_PROGRAMMING_UPDI__,
    dispatchArtifact: (detail) => windowListeners.get("ud-updi-hex-artifact")({ detail }),
  };
}

test("UPDI starts on the AVR page without the removed More tools", () => {
  const { runtime, document, window } = loadRuntime({ serial: {} });
  assert.ok(runtime);
  assert.equal(runtime, window.__UARTDEBUG_CANVAS_UPDI__);
  assert.equal(document.getElementById("canvasUpdiSection"), null);
  assert.equal(document.getElementById("probeLog"), null);
  assert.ok(document.querySelectorAll("#mcuSelect option").length > 1);
  assert.equal(document.getElementById("detectChipBtn").disabled, false);
  assert.equal(document.getElementById("programHexBtn").disabled, false);

  const log = document.getElementById("compileLog");
  log.textContent = "Compilation completed.";
  runtime.loadHexFile(VALID_HEX, "firmware.hex");
  assert.equal(runtime.hasLoadedImage(), true);
  assert.match(log.textContent, /Compilation completed\.\n/);
  assert.match(log.textContent, /HEX loaded: firmware\.hex, 1 B/);
  runtime.clearLoadedHex();
  assert.equal(runtime.hasLoadedImage(), false);
  runtime.clearLog();
  assert.equal(log.textContent, "");
});

test("compiled HEX events continue to load and clear the UPDI artifact", () => {
  const { runtime, dispatchArtifact } = loadRuntime({ serial: {} });
  dispatchArtifact({ hexText: VALID_HEX, fileName: "compiled.hex", source: "compiled" });
  assert.equal(runtime.hasLoadedImage(), true);
  dispatchArtifact({ hexText: "", source: "compiled" });
  assert.equal(runtime.hasLoadedImage(), false);
  dispatchArtifact({ hexText: "invalid", fileName: "bad.hex", source: "compiled" });
  assert.equal(runtime.hasLoadedImage(), false);
});

test("unsupported Web Serial disables Detect and Flash without requiring a warning modal", () => {
  const { runtime, document } = loadRuntime();
  assert.ok(runtime);
  assert.equal(document.getElementById("detectChipBtn").disabled, true);
  assert.match(document.getElementById("detectChipBtn").title, /Web Serial API is unavailable/);
  assert.equal(document.getElementById("programHexBtn").disabled, true);
});

test("detection errors reach the caller and restore the device controls", async () => {
  const { runtime, document } = loadRuntime({
    serial: { requestPort: async () => { throw new Error("No port selected by the user"); } },
  });
  await assert.rejects(runtime.ensureSignature({ force: true }), /No port selected/);
  assert.equal(document.getElementById("detectChipBtn").disabled, false);
  assert.equal(document.getElementById("programHexBtn").disabled, false);
  assert.equal(document.getElementById("adapterStatusText").textContent, "Adapter error");
  assert.match(document.getElementById("compileLog").textContent, /Reading signature\.\.\. failed/);
});

test("flash failures are rejected instead of reporting a successful flash", async () => {
  const { runtime, document } = loadRuntime({
    serial: { requestPort: async () => { throw new Error("Adapter unavailable"); } },
  });
  await assert.rejects(runtime.programHex(), /Load a valid Intel HEX/);
  runtime.loadHexFile(VALID_HEX, "firmware.hex");
  await assert.rejects(runtime.programHex(), /Adapter unavailable/);
  const log = document.getElementById("compileLog").textContent;
  assert.match(log, /Flash programming failed: Adapter unavailable/);
  assert.doesNotMatch(log, /Flash verified|FLASH OK/);
  assert.equal(document.getElementById("programHexBtn").disabled, false);
});

test("Compile stays disabled during UPDI and restores its previous state after failure", async () => {
  for (const initiallyDisabled of [false, true]) {
    let rejectPort;
    const { runtime, document } = loadRuntime({
      serial: { requestPort: () => new Promise((resolve, reject) => { rejectPort = reject; }) },
    });
    const compile = document.getElementById("compileBtn");
    compile.disabled = initiallyDisabled;
    runtime.loadHexFile(VALID_HEX, "firmware.hex");
    const flashing = runtime.programHex();
    const rejection = assert.rejects(flashing, /Adapter unavailable/);
    assert.equal(runtime.isBusy(), true);
    assert.equal(compile.disabled, true);
    rejectPort(new Error("Adapter unavailable"));
    await rejection;
    assert.equal(runtime.isBusy(), false);
    assert.equal(compile.disabled, initiallyDisabled);
  }
});

test("Compile restoration rechecks the current file instead of enabling a non-C file", async () => {
  let rejectPort;
  let currentFile = "main.c";
  let refreshCalls = 0;
  const { runtime, document } = loadRuntime({
    serial: { requestPort: () => new Promise((resolve, reject) => { rejectPort = reject; }) },
    bridge: {
      refreshCompileControls() {
        refreshCalls += 1;
        assert.equal(runtime.isBusy(), false);
        document.getElementById("compileBtn").disabled = !currentFile.endsWith(".c");
      },
    },
  });
  const compile = document.getElementById("compileBtn");
  compile.disabled = false;
  const detecting = runtime.ensureSignature({ force: true });
  const rejection = assert.rejects(detecting, /No port selected/);
  currentFile = "README.md";
  rejectPort(new Error("No port selected"));
  await rejection;
  assert.equal(refreshCalls, 1);
  assert.equal(compile.disabled, true);
});

test("Compile can recover when its source or running build changes during Detect", async () => {
  for (const change of ["source", "build", "pending-build"]) {
    let rejectPort;
    let source = change === "source" ? "README.md" : "main.c";
    let building = change !== "source";
    const { runtime, document } = loadRuntime({
      serial: { requestPort: () => new Promise((resolve, reject) => { rejectPort = reject; }) },
      bridge: {
        refreshCompileControls() {
          document.getElementById("compileBtn").disabled = building || !source.endsWith(".c");
        },
      },
    });
    const compile = document.getElementById("compileBtn");
    compile.disabled = true;
    const detecting = runtime.ensureSignature({ force: true });
    const rejection = assert.rejects(detecting, /No port selected/);
    if (change === "source") source = "main.c";
    else if (change === "build") building = false;
    rejectPort(new Error("No port selected"));
    await rejection;
    assert.equal(compile.disabled, change === "pending-build");
  }
});

test("UPDI keeps the UART connection guard after removing the modal", async () => {
  let requestedPort = false;
  const { runtime, document } = loadRuntime({
    serial: { requestPort: async () => { requestedPort = true; } },
    bridge: { isCanvasSerialConnected: () => true },
  });
  runtime.loadHexFile(VALID_HEX, "firmware.hex");
  assert.equal(document.getElementById("detectChipBtn").disabled, true);
  assert.equal(document.getElementById("programHexBtn").disabled, true);
  await assert.rejects(runtime.programHex(), /Disconnect UART/);
  assert.equal(requestedPort, false);
});
