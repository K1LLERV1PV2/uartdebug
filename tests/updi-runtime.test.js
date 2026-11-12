"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { parseHTML } = require("../frontend/markdown-runtime/node_modules/linkedom");

const VALID_HEX = ":0100000000FF\n:00000001FF";

function loadRuntime({ serial, bridge = {}, exposeActions = false } = {}) {
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
  const notifications = new Map();
  const notificationKeys = new Map();
  const notificationCalls = [];
  const diagnostics = [];
  let nextNotificationId = 0;
  const notificationApi = {
    notify(options) {
      const id = options.id || notificationKeys.get(options.key) || `notice-${++nextNotificationId}`;
      const record = { ...(notifications.get(id) || {}), ...options, id };
      notifications.set(id, record);
      if (options.key) notificationKeys.set(options.key, id);
      notificationCalls.push({ ...options, id });
      return id;
    },
    append(id, text, patch = {}) {
      const record = notifications.get(id);
      if (!record) throw new Error(`Unknown notification: ${id}`);
      Object.assign(record, patch);
      if (text) record.details = [record.details, String(text)].filter(Boolean).join("\n");
      return id;
    },
  };
  const window = {
    UartDebugNotifications: notificationApi,
    __UARTDEBUG_AVR_PROGRAMMING_UPDI_BRIDGE__: bridge,
    addEventListener(type, listener) {
      windowListeners.set(type, listener);
    },
  };
  const navigator = serial ? { serial } : {};
  let source = fs.readFileSync(path.join(__dirname, "../public/updi-test.js"), "utf8");
  if (exposeActions) source = source.replace(
    'document.addEventListener("DOMContentLoaded", boot);',
    'window.testActions = { runUpdiAction, appendLog }; document.addEventListener("DOMContentLoaded", boot);'
  );
  vm.runInNewContext(
    source,
    { window, document, navigator, Event, TextDecoder, setTimeout, clearTimeout,
      console: { ...console, info: (...values) => diagnostics.push(values.map(String).join(" ")) } },
    { filename: "updi-test.js" }
  );
  document.dispatchEvent(new Event("DOMContentLoaded"));
  return {
    document,
    window,
    runtime: window.__UARTDEBUG_AVR_PROGRAMMING_UPDI__,
    notifications,
    notificationCalls,
    diagnostics,
    dispatchArtifact: (detail) => windowListeners.get("ud-updi-hex-artifact")({ detail }),
  };
}

function createUpdiSerialMock(deviceId = 0x1e942a) {
  const listeners = new Map();
  const mock = { failWrites: false, opened: 0, closed: 0, memoryWrites: 0 };
  let pointer = 0;
  let repeat = 1;
  let queue = [];
  let pendingRead = null;
  const push = (bytes) => {
    const result = { done: false, value: Uint8Array.from(bytes) };
    if (pendingRead) {
      const resolve = pendingRead;
      pendingRead = null;
      resolve(result);
    } else queue.push(result);
  };
  const memoryByte = (address) => {
    if (address >= 0x1100 && address <= 0x1102) {
      return (deviceId >> ((0x1102 - address) * 8)) & 0xff;
    }
    return address === 0x0f01 ? 0x10 : 0;
  };
  mock.port = {
    getInfo: () => ({ usbVendorId: 0x0403, usbProductId: 0x6001 }),
    open: async () => { mock.opened += 1; queue = []; repeat = 1; },
    close: async () => { mock.closed += 1; },
    readable: { getReader: () => ({
      read: () => queue.length ? Promise.resolve(queue.shift()) : new Promise(resolve => { pendingRead = resolve; }),
      cancel: async () => { if (pendingRead) { pendingRead({ done: true }); pendingRead = null; } },
      releaseLock() {},
    }) },
    writable: { getWriter: () => ({
      async write(bytes) {
        if (mock.failWrites) throw new Error("UPDI communication failed");
        const payload = [...bytes];
        const response = [];
        const command = payload[0] === 0x55 ? payload[1] : null;
        if (command === 0x69) {
          pointer = payload[2] | (payload[3] << 8);
          response.push(0x40);
        } else if (command === 0xa0) {
          repeat = payload[2] + 1;
        } else if (command === 0x24) {
          for (let index = 0; index < repeat; index += 1) response.push(memoryByte(pointer++));
          repeat = 1;
        } else if (command === 0xe6) {
          response.push(...Buffer.from("tinyAVR N:0O:0 32MHz", "ascii"));
        } else if (command !== null && (command & 0xf0) === 0x80) {
          response.push((command & 0x0f) === 0x0b ? 0x08 : 0x10);
        } else if (command === 0x64 || command === 0x65) {
          mock.memoryWrites += 1;
          throw new Error("Unexpected programming write");
        }
        if (!mock.suppressEcho || response.length) push([...(mock.suppressEcho ? [] : payload), ...response]);
      },
      releaseLock() {},
    }) },
  };
  mock.selectedPort = mock.port;
  mock.serial = {
    requestPort: async () => mock.selectedPort,
    addEventListener: (type, listener) => listeners.set(type, listener),
  };
  mock.disconnect = (port = mock.port) => listeners.get("disconnect")?.({ target: port });
  return mock;
}

function detectionBridge() {
  return {
    detectedKey: "",
    setDetectedTargetKey(key) { this.detectedKey = key; },
  };
}

test("UPDI reports HEX diagnostics through notifications without a compile log", () => {
  const { runtime, document, notifications } = loadRuntime({ serial: {} });
  assert.ok(runtime);
  assert.equal(document.getElementById("canvasUpdiSection"), null);
  assert.equal(document.getElementById("probeLog"), null);
  assert.ok(document.querySelectorAll("#mcuSelect option").length > 1);
  assert.equal(document.getElementById("detectChipBtn").disabled, false);
  assert.equal(document.getElementById("programHexBtn").disabled, false);

  assert.equal(document.getElementById("compileLog"), null);
  runtime.loadHexFile(VALID_HEX, "firmware.hex");
  assert.equal(runtime.hasLoadedImage(), true);
  assert.equal(notifications.size, 1);
  const notice = [...notifications.values()][0];
  assert.match(notice.message, /HEX loaded from file: firmware\.hex/);
  assert.match(notice.details, /Payload: 1 bytes/);
  assert.match(notice.details, /File: firmware\.hex/);
  runtime.clearLoadedHex();
  assert.equal(runtime.hasLoadedImage(), false);
  runtime.clearLog();
  assert.equal(notifications.size, 1, "clearing the active operation must preserve notification history");
});

test("compiled HEX events continue to load and clear the UPDI artifact", () => {
  const { runtime, dispatchArtifact, notifications } = loadRuntime({ serial: {} });
  dispatchArtifact({ hexText: VALID_HEX, fileName: "compiled.hex", source: "compiled" });
  assert.equal(runtime.hasLoadedImage(), true);
  assert.equal(notifications.size, 0, "refreshing a cached artifact must not create an unread operation");
  dispatchArtifact({ hexText: "", source: "compiled" });
  assert.equal(runtime.hasLoadedImage(), false);
  dispatchArtifact({ hexText: "invalid", fileName: "bad.hex", source: "compiled" });
  assert.equal(runtime.hasLoadedImage(), false);
  assert.equal(notifications.size, 1);
  assert.equal([...notifications.values()][0].tone, "error");
});

test("compiled HEX metadata joins its compilation record and validation failures remain visible", () => {
  const { runtime, dispatchArtifact, notifications, window } = loadRuntime({ serial: {} });
  const id = window.UartDebugNotifications.notify({ title: "Compilation", message: "Build completed", details: "Compiler output", tone: "success", pending: false });
  dispatchArtifact({ hexText: VALID_HEX, fileName: "compiled.hex", source: "compiled", notificationId: id });
  assert.equal(runtime.hasLoadedImage(), true);
  assert.equal(notifications.size, 1);
  assert.match(notifications.get(id).details, /Compiler output/);
  assert.match(notifications.get(id).details, /HEX loaded: compiled\.hex, 1 B/);
  assert.match(notifications.get(id).details, /HEX synced from canvas: compiled\.hex/);
  assert.equal(notifications.get(id).title, "Compilation");
  assert.equal(notifications.get(id).tone, "success");
  dispatchArtifact({ hexText: "invalid", fileName: "bad.hex", source: "compiled", notificationId: id });
  assert.equal(runtime.hasLoadedImage(), false);
  assert.equal(notifications.size, 2, "a rejected artifact needs its own visible error instead of becoming successful compile metadata");
  assert.equal(notifications.get(id).tone, "success");
  const error = [...notifications.values()].find(record => record.id !== id);
  assert.equal(error.tone, "error");
  assert.match(error.message, /Compiled HEX sync failed/);
});

test("unsupported Web Serial disables Detect and Flash and reports a toast warning", () => {
  const { runtime, document, notifications } = loadRuntime();
  assert.ok(runtime);
  assert.equal(document.getElementById("detectChipBtn").disabled, true);
  assert.match(document.getElementById("detectChipBtn").title, /Web Serial API is unavailable/);
  assert.equal(document.getElementById("programHexBtn").disabled, true);
  assert.equal([...notifications.values()][0].tone, "warning");
  assert.equal([...notifications.values()][0].key, "serial-unavailable");
});

test("detection errors reach the caller and restore the device controls", async () => {
  const { runtime, document, notifications, diagnostics } = loadRuntime({
    serial: { requestPort: async () => { throw new Error("No port selected by the user"); } },
  });
  await assert.rejects(runtime.ensureSignature({ force: true }), /No port selected/);
  assert.equal(document.getElementById("detectChipBtn").disabled, false);
  assert.equal(document.getElementById("programHexBtn").disabled, false);
  assert.equal(document.getElementById("adapterStatusText").textContent, "Adapter error");
  assert.equal(notifications.size, 1);
  const notice = [...notifications.values()][0];
  assert.match(diagnostics.join("\n"), /Reading signature\.\.\. failed/);
  assert.doesNotMatch(notice.details, /^\s*at\s|Error:/m);
  assert.match(notice.message, /Chip detection failed/);
  assert.equal(notice.tone, "error");
  assert.equal(notice.pending, false);
});

test("flash failures are rejected instead of reporting a successful flash", async () => {
  const { runtime, document, notifications, diagnostics } = loadRuntime({
    serial: { requestPort: async () => { throw new Error("Adapter unavailable"); } },
  });
  await assert.rejects(runtime.programHex(), /Load a valid Intel HEX/);
  runtime.loadHexFile(VALID_HEX, "firmware.hex");
  await assert.rejects(runtime.programHex(), /Adapter unavailable/);
  const failed = [...notifications.values()].find(notice => /Flash MCU failed/.test(notice.message));
  assert.ok(failed);
  assert.match(diagnostics.join("\n"), /Programming flash\.\.\. failed: Adapter unavailable/);
  assert.doesNotMatch(diagnostics.join("\n"), /Flash verified|FLASH OK/);
  assert.equal(failed.tone, "error");
  assert.equal(document.getElementById("programHexBtn").disabled, false);
});

test("UPDI reuses a parent compilation record instead of creating a Detect notification", async () => {
  const { runtime, window, notifications, diagnostics } = loadRuntime({
    serial: { requestPort: async () => { throw new Error("No adapter"); } },
  });
  const id = window.UartDebugNotifications.notify({ title: "Compilation", message: "Compiling...", details: "Compiler preflight completed.", pending: true });
  await assert.rejects(runtime.ensureSignature({ force: true, notificationId: id }), error => {
    assert.equal(error.uartDebugNotificationId, id);
    return /No adapter/.test(error.message);
  });
  assert.equal(notifications.size, 1);
  assert.equal(notifications.get(id).title, "Compilation");
  assert.equal(notifications.get(id).pending, false);
  assert.equal(notifications.get(id).tone, "error");
  assert.match(notifications.get(id).details, /^Compiler preflight completed\.[\s\S]*Reading signature\.\.\.[\s\S]*Requesting serial port[\s\S]*failed: No adapter/);
  assert.match(diagnostics.join("\n"), /No adapter/);
});

test("a chatty flash operation retains timestamped page logs in one notification and closes its port", async () => {
  let closed = 0;
  const port = {
    open: async () => {}, close: async () => { closed += 1; }, getInfo: () => ({ usbVendorId: 0x0403, usbProductId: 0x6001 }),
    readable: { getReader: () => ({ read: async () => ({ done: true }), cancel: async () => {}, releaseLock() {} }) },
    writable: { getWriter: () => ({ write: async () => {}, releaseLock() {} }) },
  };
  const { window, runtime, notifications, notificationCalls, diagnostics } = loadRuntime({
    serial: { requestPort: async () => port }, exposeActions: true,
  });
  await window.testActions.runUpdiAction("Programming flash...", async () => {
    for (let index = 0; index < 80; index += 1) window.testActions.appendLog(`Verifying page ${index + 1}/80...`);
  });
  assert.equal(notifications.size, 1);
  assert.equal(notificationCalls.length, 2, "only the operation start and final result publish a toast");
  const record = [...notifications.values()][0];
  assert.equal(record.pending, false);
  assert.equal(record.tone, "success");
  assert.match(record.details, /^\[\d{2}:\d{2}:\d{2}\] Programming flash\.\.\./);
  assert.match(record.details, /Verifying page 1\/80/);
  assert.match(record.details, /Verifying page 80\/80/);
  assert.match(record.details, /Port closed\.$/);
  assert.equal(record.details.split("\n").every(line => /^\[\d{2}:\d{2}:\d{2}\] /.test(line)), true);
  assert.match(diagnostics.join("\n"), /Verifying page 1\/80/);
  assert.match(diagnostics.join("\n"), /Verifying page 80\/80/);
  assert.match(diagnostics.join("\n"), /Port closed/);
  assert.equal(closed, 1);
  assert.equal(runtime.isBusy(), false);
});

test("a real signature echo timeout retains the visible connection timeline without JavaScript stacks", async () => {
  const mock = createUpdiSerialMock();
  mock.suppressEcho = true;
  const { runtime, notifications, diagnostics } = loadRuntime({ serial: mock.serial });
  await assert.rejects(runtime.ensureSignature({ force: true }), /Timed out waiting for echo of 1 byte/);
  assert.equal(notifications.size, 1);
  const notice = [...notifications.values()][0];
  const expected = ["Reading signature...", "Requesting serial port...", "Opening port with 115200 / 8E2...",
    "Port selected:", "Reading signature... failed: Timed out waiting for echo of 1 byte(s).",
    "Stage: communicating over UPDI.", "Port closed."];
  let previous = -1;
  for (const fragment of expected) {
    const index = notice.details.indexOf(fragment);
    assert.ok(index > previous, `retain stage in order: ${fragment}`);
    previous = index;
  }
  assert.equal(notice.details.split("\n").every(line => /^\[\d{2}:\d{2}:\d{2}\] /.test(line)), true);
  assert.doesNotMatch(notice.details, /^\s*at\s|https?:\/\/|updi-test\.js:\d+:\d+/m);
  assert.equal(Object.hasOwn(notice, "diagnostics"), false);
  assert.match(diagnostics.join("\n"), /at waitForBuffer/);
  assert.equal(mock.closed, 1);
});

test("connection stages are visible while awaiting port selection and opening", async () => {
  const mock = createUpdiSerialMock();
  let selectPort;
  let openPort;
  mock.serial.requestPort = () => new Promise(resolve => { selectPort = resolve; });
  mock.port.open = () => new Promise(resolve => { openPort = resolve; });
  const { window, notifications } = loadRuntime({ serial: mock.serial, exposeActions: true });
  const action = window.testActions.runUpdiAction("Reading signature...", async () => {});
  const notice = [...notifications.values()][0];
  assert.match(notice.details, /Reading signature\.\.\.[\s\S]*Requesting serial port\.\.\.$/);
  assert.doesNotMatch(notice.details, /Opening port/);
  selectPort(mock.port);
  await new Promise(resolve => setImmediate(resolve));
  assert.match(notice.details, /Opening port with 115200 \/ 8E2\.\.\.$/);
  assert.doesNotMatch(notice.details, /Port selected/);
  openPort();
  await action;
  assert.match(notifications.get(notice.id).details, /Port selected:[\s\S]*Port closed\.$/);
});

test("UPDI retains useful log text and device addresses while keeping source paths and stack frames in the console", async () => {
  const mock = createUpdiSerialMock();
  const { window, notifications, diagnostics } = loadRuntime({ serial: mock.serial, exposeActions: true });
  const failure = new Error("Write rejected at /var/www/uartdebug/updi-test.js:1832:7\n    at writer (http://127.0.0.1:8765/updi-test.js?v=test:1832:7)\n    at Array.map (<anonymous>)");
  await assert.rejects(window.testActions.runUpdiAction("Programming flash...", async () => {
    window.testActions.appendLog("Signature: 0x1E942A; Writing page 2/80 at 0x8040...");
    throw failure;
  }), /Write rejected/);
  const notice = [...notifications.values()][0];
  assert.match(notice.details, /Signature: 0x1E942A; Writing page 2\/80 at 0x8040/);
  assert.match(notice.details, /Programming flash\.\.\. failed: Write rejected at \[source location\]/);
  assert.match(notice.details, /Port closed\.$/);
  assert.doesNotMatch(notice.details, /https?:\/\/|\/var\/www|updi-test\.js|\bat writer\b|\bat Array\.map\b/);
  assert.match(diagnostics.join("\n"), /http:\/\/127\.0\.0\.1:8765\/updi-test\.js/);
  assert.match(diagnostics.join("\n"), /\/var\/www\/uartdebug\/updi-test\.js/);
});

test("a serial port close failure retains its warning and never reports Port closed", async () => {
  for (const failed of [false, true]) {
    const mock = createUpdiSerialMock();
    mock.port.close = async () => { throw new Error("The port is still busy"); };
    const { window, notifications } = loadRuntime({ serial: mock.serial, exposeActions: true });
    const action = window.testActions.runUpdiAction("Programming flash...", async () => {
      window.testActions.appendLog("Verifying page 80/80...");
      if (failed) throw new Error("Verification failed at 0x8040");
    });
    if (failed) await assert.rejects(action, /Verification failed/);
    else await action;
    const notice = [...notifications.values()][0];
    assert.match(notice.details, /Verifying page 80\/80/);
    assert.match(notice.details, /Port close warning: The port is still busy$/);
    assert.doesNotMatch(notice.details, /Port closed\./);
    assert.equal(notice.tone, failed ? "error" : "warning");
    if (!failed) assert.equal(notice.message, "Operation completed, but the serial port could not be closed.");
  }
});

test("an echo timeout during flash never claims that the signature was not read", async () => {
  const mock = createUpdiSerialMock();
  const { window, notifications } = loadRuntime({ serial: mock.serial, exposeActions: true });
  await assert.rejects(window.testActions.runUpdiAction("Programming flash...", async () => {
    window.testActions.appendLog("Signature read; writing page 2...");
    throw new Error("Timed out waiting for echo of 1 byte(s).");
  }), /Timed out/);
  const notice = [...notifications.values()][0];
  assert.match(notice.message, /Flash MCU failed/);
  assert.match(notice.details, /Signature read; writing page 2/);
  assert.match(notice.details, /Programming flash\.\.\. failed: Timed out/);
  assert.match(notice.details, /communicating over UPDI/);
  assert.doesNotMatch(notice.details, /signature has not|establishing|diagnostics.*below/i);
  assert.equal(mock.closed, 1);
});

test("cancelling UPDI port selection is neutral and leaves no adapter error", async () => {
  const { runtime, document, notifications } = loadRuntime({ serial: {
    requestPort: async () => { const error = new Error("The user dismissed the chooser."); error.name = "NotFoundError"; throw error; },
  } });
  await assert.rejects(runtime.ensureSignature({ force: true }), error => error.name === "NotFoundError");
  const notice = [...notifications.values()][0];
  assert.equal(notice.tone, "info");
  assert.equal(notice.message, "No serial port was selected.");
  assert.match(notice.details, /Requesting serial port[\s\S]*Reading signature\.\.\. cancelled:/);
  assert.doesNotMatch(notice.details, /Opening port|Port closed|\bat /);
  assert.equal(document.getElementById("adapterStatusText").textContent, "No port selection");
  assert.equal(runtime.isBusy(), false);
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
  const busyStates = [];
  const { runtime, document } = loadRuntime({
    serial: { requestPort: () => new Promise((resolve, reject) => { rejectPort = reject; }) },
    bridge: {
      refreshCompileControls() {
        refreshCalls += 1;
        busyStates.push(runtime.isBusy());
        document.getElementById("compileBtn").disabled = runtime.isBusy() || !currentFile.endsWith(".c");
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
  assert.ok(refreshCalls >= 2, "both busy and settled device states refresh the shared controls");
  assert.equal(busyStates[0], true);
  assert.equal(busyStates.at(-1), false);
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
          document.getElementById("compileBtn").disabled = runtime.isBusy() || building || !source.endsWith(".c");
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

test("UPDI does not request another port while a device operation is in progress", async () => {
  let requests = 0;
  let rejectPort;
  const { runtime, document } = loadRuntime({
    serial: { requestPort: () => {
      requests += 1;
      return new Promise((resolve, reject) => { rejectPort = reject; });
    } },
  });
  runtime.loadHexFile(VALID_HEX, "firmware.hex");
  const detecting = runtime.ensureSignature({ force: true });
  const rejected = assert.rejects(detecting, /Adapter unavailable/);
  assert.equal(document.getElementById("detectChipBtn").disabled, true);
  assert.equal(document.getElementById("programHexBtn").disabled, true);
  await runtime.programHex();
  assert.equal(requests, 1);
  rejectPort(new Error("Adapter unavailable"));
  await rejected;
  assert.equal(runtime.isBusy(), false);
  assert.equal(document.getElementById("detectChipBtn").disabled, false);
  assert.equal(document.getElementById("programHexBtn").disabled, false);
});

test("a real signature read replaces Auto and a manual target with the detected chip", async () => {
  for (const selected of ["auto", "attiny1614"]) {
    const mock = createUpdiSerialMock();
    const bridge = detectionBridge();
    const { runtime, document } = loadRuntime({ serial: mock.serial, bridge });
    const select = document.getElementById("mcuSelect");
    select.value = selected;
    let changes = 0;
    select.addEventListener("change", () => { changes += 1; });
    const info = await runtime.ensureSignature({ force: true });
    assert.equal(info.matchedTargetKey, "attiny1624");
    assert.equal(runtime.getSignatureInfo(), info);
    assert.equal(bridge.detectedKey, "attiny1624");
    assert.equal(select.value, "attiny1624");
    assert.equal(changes, 0, "detection synchronizes its result without impersonating a user target change");
    assert.equal(document.getElementById("avrDevicePanelViewport").dataset.state, "detected");
    const portButton = document.getElementById("detectChipBtn");
    assert.equal(portButton.contains(document.getElementById("adapterStatusText")), false);
    assert.equal(portButton.querySelector("[data-detect-default]").textContent, "Connected");
    assert.equal(portButton.classList.contains("is-connected"), true,
      "the original detect button retains its connected state");
    assert.equal(portButton.getAttribute("aria-label"), "Read chip signature again");
    assert.equal(mock.closed, 1, "detection is a completed snapshot, not a permanently open connection");
    assert.equal(await runtime.ensureSignature(), info);
    assert.equal(mock.opened, 1, "an explicitly cached signature read does not reopen the port");
    assert.match(document.getElementById("programHexBtn").textContent, /ATtiny1624/);
    assert.equal(select.dataset.controlStatus, "");
    assert.equal(select.dataset.connectionState, "ready");
    assert.equal(select.querySelector('option[value="auto"]').textContent, "Auto detect");
    for (const option of document.querySelectorAll("#mcuSelect option")) {
      assert.equal(option.disabled, option.value !== "attiny1624", "only the actual chip remains selectable while its snapshot is valid");
    }
    select.value = "attiny1614";
    select.dispatchEvent(new document.defaultView.Event("change"));
    assert.equal(select.value, "attiny1624", "a later manual selection cannot override a still-valid physical result");
  }
});

test("a failed chip recheck clears physical caches and preserves the last project target", async () => {
  const mock = createUpdiSerialMock();
  const bridge = detectionBridge();
  const { runtime, document } = loadRuntime({ serial: mock.serial, bridge });
  document.getElementById("mcuSelect").value = "attiny1614";
  await runtime.ensureSignature({ force: true });
  mock.failWrites = true;
  await assert.rejects(runtime.ensureSignature({ force: true }), /UPDI communication failed/);
  assert.equal(runtime.getSignatureInfo(), null);
  assert.equal(bridge.detectedKey, "");
  assert.equal(document.getElementById("mcuSelect").value, "attiny1624");
  assert.equal(document.getElementById("avrDevicePanelViewport").dataset.state, "error");
  assert.equal(document.getElementById("mcuSelect").dataset.controlStatus, "Chip error");
  assert.equal(document.getElementById("chipStatusText"), null);
  assert.ok(Array.from(document.querySelectorAll("#mcuSelect option")).every(option => !option.disabled),
    "failed detection unlocks offline target choices without discarding the saved chip");
});

test("port changes and disconnects invalidate only the current adapter's chip snapshot", async () => {
  const first = createUpdiSerialMock();
  const second = createUpdiSerialMock(0x1e9422);
  const bridge = detectionBridge();
  const { runtime, document } = loadRuntime({ serial: first.serial, bridge });
  document.getElementById("mcuSelect").value = "attiny1614";
  await runtime.ensureSignature({ force: true });
  first.selectedPort = second.port;
  await runtime.preparePortPermission({ useCached: false });
  assert.equal(runtime.getSignatureInfo(), null);
  assert.equal(bridge.detectedKey, "");
  await runtime.ensureSignature();
  assert.equal(bridge.detectedKey, "attiny1614");
  first.disconnect(first.port);
  assert.equal(bridge.detectedKey, "attiny1614", "an unrelated adapter disconnect must not erase the current result");
  first.disconnect(second.port);
  assert.equal(runtime.getSignatureInfo(), null);
  assert.equal(bridge.detectedKey, "");
  assert.equal(document.getElementById("mcuSelect").value, "attiny1614");
  assert.equal(document.getElementById("avrDevicePanelViewport").dataset.state, "error");
});

test("a pending recheck clears the physical snapshot without erasing the project chip", async () => {
  const mock = createUpdiSerialMock();
  const bridge = detectionBridge();
  const { runtime, document } = loadRuntime({ serial: mock.serial, bridge });
  await runtime.ensureSignature({ force: true });
  let rejectPort;
  mock.serial.requestPort = () => new Promise((resolve, reject) => { rejectPort = reject; });
  const pending = runtime.ensureSignature({ force: true, useCached: false });
  const rejected = assert.rejects(pending, /Port selection cancelled/);
  assert.equal(runtime.getSignatureInfo(), null);
  assert.equal(bridge.detectedKey, "");
  assert.equal(document.getElementById("mcuSelect").value, "attiny1624");
  assert.equal(document.getElementById("avrDevicePanelViewport").dataset.state, "detecting");
  rejectPort(new Error("Port selection cancelled"));
  await rejected;
  assert.equal(document.getElementById("mcuSelect").value, "attiny1624");
});

for (const source of ["file", "compiled"]) {
  test(`Flash rejects ${source} HEX built for a different chip before any erase or programming write`, async () => {
    const mock = createUpdiSerialMock();
    const bridge = detectionBridge();
    const { runtime, document, notifications, dispatchArtifact } = loadRuntime({ serial: mock.serial, bridge });
    document.getElementById("mcuSelect").value = "attiny1614";
    if (source === "compiled") dispatchArtifact({ hexText: VALID_HEX, fileName: "firmware.hex", source, targetMcu: "attiny1614" });
    else runtime.loadHexFile(VALID_HEX, "firmware.hex");
    await assert.rejects(runtime.programHex(), error => {
      assert.equal(error.updiTargetValidation, true);
      return /ATtiny1614/.test(error.message) && /ATtiny1624/.test(error.message);
    });
    assert.equal(mock.memoryWrites, 0, "target validation must run before chip erase or flash writes");
    assert.equal(document.getElementById("mcuSelect").value, "attiny1624");
    assert.equal(runtime.getSignatureInfo().matchedTargetKey, "attiny1624");
    assert.equal(bridge.detectedKey, "attiny1624");
    assert.equal(document.getElementById("avrDevicePanelViewport").dataset.state, "detected");
    const failure = [...notifications.values()].find(record => /ATtiny1614/.test(record.message) && /ATtiny1624/.test(record.message));
    assert.equal(failure.tone, "error");
    assert.equal(failure.pending, false);
  });
}

test("compiled HEX without a build target cannot be flashed by inferring it from a later detection", async () => {
  const mock = createUpdiSerialMock();
  const { runtime, document, dispatchArtifact } = loadRuntime({ serial: mock.serial, bridge: detectionBridge() });
  dispatchArtifact({ hexText: VALID_HEX, fileName: "old-cache.hex", source: "compiled" });
  await assert.rejects(runtime.programHex(), error => error.updiTargetValidation === true && /target|compil/i.test(error.message));
  assert.equal(mock.memoryWrites, 0, "legacy targetless compiled artifacts must stop before erase");
  assert.equal(document.getElementById("mcuSelect").value, "attiny1624");
});
