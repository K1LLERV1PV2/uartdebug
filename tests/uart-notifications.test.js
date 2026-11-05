"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { parseHTML } = require("../frontend/markdown-runtime/node_modules/linkedom");

function loadTerminal(serial) {
  const { document } = parseHTML(fs.readFileSync(path.join(__dirname, "../public/uart.html"), "utf8"));
  const notices = [];
  const dismissed = [];
  const window = {
    addEventListener() {},
    UartDebugNotifications: {
      notify(options) { notices.push({ ...options }); return `notice-${notices.length}`; },
      dismiss(id) { dismissed.push(id); },
    },
  };
  const context = vm.createContext({
    window, document, navigator: serial ? { serial } : {},
    setTimeout, clearTimeout, setInterval, clearInterval, TextEncoder,
    localStorage: { getItem() { return null; }, setItem() {} },
    console: { ...console, error() {}, warn() {} },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../public/uart.js"), "utf8"), context, { filename: "uart.js" });
  context.initializeElements();
  return { context, document, notices, dismissed };
}

test("UART errors become notifications while TX and RX retain serial data only", () => {
  const { context, document, notices } = loadTerminal({});
  const sent = document.getElementById("terminalSent");
  const received = document.getElementById("terminalReceived");
  context.addToTerminal("error", "Send failed: adapter disconnected", sent);
  assert.equal(sent.children.length, 0);
  assert.equal(notices.length, 1);
  assert.equal(notices[0].message, "Send failed: adapter disconnected");
  assert.equal(notices[0].tone, "error");
  context.addToTerminal("sent", "Hello\r\n", sent);
  context.addToTerminal("received", "Reply", received);
  assert.equal(sent.children.length, 1);
  assert.equal(received.children.length, 1);
  assert.match(sent.textContent, /Hello/);
  assert.equal(received.textContent, "Reply");
  assert.equal(notices.length, 1, "ordinary serial bytes must never create notifications");
});

test("Web Serial support and port selection guidance use the shared notification surface", () => {
  const unsupported = loadTerminal();
  unsupported.context.checkWebSerialSupport();
  assert.equal(unsupported.notices.length, 1);
  assert.equal(unsupported.notices[0].key, "serial-unavailable");
  assert.equal(unsupported.notices[0].tone, "warning");
  assert.equal(unsupported.document.getElementById("connectBtn").disabled, true);

  const supported = loadTerminal({});
  supported.context.showSerialPortHint();
  assert.equal(supported.notices[0].key, "uart-port-selection");
  supported.context.hideSerialPortHint();
  assert.deepEqual(supported.dismissed, ["notice-1"]);
});

test("UART selection and open failures are visible without being written into a terminal", async () => {
  for (const stage of ["selection", "open"]) {
    const { context, document, notices } = loadTerminal({
      async requestPort() {
        if (stage === "selection") throw new Error("Permission denied");
        return { async open() { throw new Error("Adapter busy"); } };
      },
    });
    assert.equal(await context.connectSerial(), false);
    assert.equal(notices.length, 1);
    assert.equal(notices[0].tone, "error");
    assert.doesNotMatch(notices[0].message, /Permission denied|Adapter busy/);
    assert.match(notices[0].diagnostics, stage === "selection" ? /Permission denied/ : /Adapter busy/);
    assert.equal(document.querySelectorAll(".terminal-line").length, 0);
    assert.equal(vm.runInContext("port", context), null);
  }
});

test("one-shot and loop HEX sends share strict validation and preserve every whitespace-separated byte", async () => {
  const { context, document, notices } = loadTerminal({});
  const writes = [];
  context.testWriter = { async write(value) { writes.push(Array.from(value)); } };
  context.getTxMode = () => "hex";
  vm.runInContext("port = {}; writer = testWriter;", context);
  for (const send of [context.sendData, context.sendDataLoop]) {
    document.getElementById("terminalInput").value = "AB\tCD\n 00";
    await send();
    assert.deepEqual(writes.at(-1), [0xAB, 0xCD, 0]);
    for (const invalid of ["AB ?? CD", "A BC", "0xAB", "ABC", "AB,CD"]) {
      const before = writes.length;
      document.getElementById("terminalInput").value = invalid;
      await send();
      assert.equal(writes.length, before, invalid);
      assert.equal(notices.at(-1).tone, "warning");
      assert.match(notices.at(-1).details, /complete HEX bytes/);
    }
  }
});

test("ASCII sending keeps its existing line endings and writer failures have a sending summary", async () => {
  const { context, document, notices } = loadTerminal({});
  const writes = [];
  context.testWriter = { async write(value) { writes.push(Array.from(value)); } };
  vm.runInContext("port = {}; writer = testWriter;", context);
  document.getElementById("terminalInput").value = " hello ";
  await context.sendData();
  await context.sendDataLoop();
  assert.equal(Buffer.from(writes[0]).toString(), " hello \r\n");
  assert.equal(Buffer.from(writes[1]).toString(), "hello\r\n");
  context.testWriter.write = async () => { throw new Error("WritableStream internal failure"); };
  await context.sendData();
  assert.equal(notices.at(-1).message, "The data could not be sent.");
  assert.doesNotMatch(notices.at(-1).message, /format|WritableStream/);
  assert.match(notices.at(-1).diagnostics, /WritableStream internal failure/);
});

test("a read failure or closed stream releases the connection and disables UART controls", async () => {
  for (const failed of [true, false]) {
    const { context, document, notices } = loadTerminal({});
    const calls = [];
    context.testPort = { async close() { calls.push("close"); } };
    context.testReader = { async read() {
      if (failed) throw new Error("Adapter unplugged");
      return { done: true };
    }, async cancel() { calls.push("cancel"); }, releaseLock() { calls.push("reader released"); } };
    context.testWriter = { releaseLock() { calls.push("writer released"); } };
    vm.runInContext("port=testPort; reader=testReader; writer=testWriter; updateConnectionStatus(true);", context);
    await context.readLoop();
    assert.deepEqual(calls, ["cancel", "reader released", "writer released", "close"]);
    assert.equal(vm.runInContext("port === null && reader === null && writer === null", context), true);
    assert.equal(document.getElementById("connectBtn").classList.contains("connected"), false);
    assert.equal(document.getElementById("sendBtn").disabled, true);
    assert.equal(notices.at(-1).message, "The serial connection was lost.");
    if (failed) assert.match(notices.at(-1).diagnostics, /Adapter unplugged/);
  }
});

test("partial connection setup and a cancelled pending open release only their captured resources", async () => {
  let closeCount = 0, released = 0;
  const selected = { async open() {}, async close() { closeCount++; },
    readable: { getReader() { return { async cancel() {}, releaseLock() { released++; } }; } },
    writable: { getWriter() { throw new Error("Writer setup failed"); } },
  };
  const partial = loadTerminal({ async requestPort() { return selected; } });
  assert.equal(await partial.context.connectSerial(), false);
  assert.equal(closeCount, 1); assert.equal(released, 1);
  assert.equal(vm.runInContext("port === null && reader === null && writer === null", partial.context), true);

  let opened;
  const pendingPort = { open: () => new Promise(resolve => { opened = resolve; }), async close() { closeCount++; } };
  const pending = loadTerminal({ async requestPort() { return pendingPort; } });
  const connecting = pending.context.connectSerial();
  while (!opened) await Promise.resolve();
  await pending.context.disconnectSerial();
  opened();
  assert.equal(await connecting, false);
  assert.equal(closeCount, 2);
  assert.equal(vm.runInContext("port === null", pending.context), true);
  assert.equal(pending.notices.length, 0);
});

test("an old read completion cannot disconnect its replacement connection", async () => {
  const { context, document, notices } = loadTerminal({});
  let rejectRead;
  context.oldPort = {};
  context.oldReader = { read: () => new Promise((resolve, reject) => { rejectRead = reject; }) };
  vm.runInContext("port=oldPort;reader=oldReader;", context);
  const reading = context.readLoop();
  context.newPort = {};
  context.newReader = {};
  vm.runInContext("port=newPort;reader=newReader;writer={};updateConnectionStatus(true);", context);
  rejectRead(new Error("Old stream failed late"));
  await reading;
  assert.equal(vm.runInContext("port===newPort && reader===newReader", context), true);
  assert.equal(document.getElementById("connectBtn").classList.contains("connected"), true);
  assert.equal(notices.length, 0);
});

test("stopping the generator during an awaited write produces no error or mutation of a replacement stream", async () => {
  for (const replace of [false, true]) {
    const { context, notices } = loadTerminal({});
    let release;
    context.testWriter = { write: () => new Promise(resolve => { release = resolve; }) };
    vm.runInContext("writer=testWriter;generatorStream={payload:new Uint8Array([1,2]),index:0,loop:true,logged:false,sending:false,label:'old'};", context);
    const sending = context.sendGeneratorByte();
    context.stopLoopSend();
    if (replace) vm.runInContext("generatorStream={payload:new Uint8Array([3,4]),index:0,loop:true,logged:false,sending:false,label:'new'};", context);
    release(); await sending;
    assert.equal(notices.length, 0);
    if (replace) assert.equal(vm.runInContext("generatorStream.index===0 && !generatorStream.logged", context), true);
  }
});

test("invalid loop input stops the repeating timer before any data is transmitted", () => {
  const { context, document, notices } = loadTerminal({});
  const cleared = [];
  context.setInterval = () => 17;
  context.clearInterval = timer => cleared.push(timer);
  context.getTxMode = () => "hex";
  vm.runInContext("writer={write(){throw new Error('Must not transmit invalid HEX');}};", context);
  document.getElementById("terminalInput").value = "AB ?? CD";
  context.startLoopSend();
  assert.equal(vm.runInContext("loopInterval", context), null);
  assert.deepEqual(cleared, [17]);
  assert.equal(notices.at(-1).tone, "warning");
});

test("successful UART connection and disconnection notify without injecting log data", async () => {
  let closes = 0;
  const port = {
    async open() {}, async close() { closes += 1; },
    getInfo() { return { usbVendorId: 0x0403, usbProductId: 0x6001 }; },
    readable: { getReader() { return { async cancel() {}, releaseLock() {} }; } },
    writable: { getWriter() { return { releaseLock() {} }; } },
  };
  const { context, document, notices } = loadTerminal({ async requestPort() { return port; } });
  context.readLoop = () => {};
  assert.equal(await context.connectSerial(), true);
  assert.equal(notices.length, 1);
  assert.equal(notices[0].tone, "success");
  assert.match(notices[0].message, /Connected to .* baud\./);
  await context.disconnectSerial();
  assert.equal(notices.length, 2);
  assert.equal(notices[1].message, "Serial adapter disconnected.");
  assert.equal(document.querySelectorAll(".terminal-line").length, 0);
  assert.equal(closes, 1);
});
