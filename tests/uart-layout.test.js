"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { eventSurface, resizeEnvironment } = require("./helpers/panel-resizer-harness");

function createLayoutHarness() {
  const environment = resizeEnvironment();
  const { document, window, handle } = environment;
  const split = eventSurface();
  split.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 600 });
  const tx = eventSurface(); tx.id = "uartTxSession";
  const rx = eventSurface(); rx.id = "uartRxSession";
  document.querySelector = (selector) => selector.includes('"tx"') ? tx : rx;
  const writes = [];
  const sandbox = {
    document, window, console,
    localStorage: { getItem: () => null, setItem: (key, value) => writes.push({ key, value }) },
    requestAnimationFrame: () => 1, cancelAnimationFrame() {},
  };
  const context = vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../public/ui-controls.js"), "utf8"), context);
  const source = fs.readFileSync(path.join(__dirname, "../public/uart.js"), "utf8");
  vm.runInContext(`${source}\nwindow.layoutHooks = {
    setup(split, handle, tx, rx) { uartSessionsSplit = split; terminalLayoutResizer = handle; uartSessions = [tx, rx]; },
    initializeTerminalLayout,
    snapshot() { return JSON.parse(JSON.stringify(terminalLayoutState)); }
  };`, context);
  const hooks = window.layoutHooks;
  hooks.setup(split, handle, tx, rx);
  hooks.initializeTerminalLayout();
  const sizes = () => [hooks.snapshot().sizes.tx, hooks.snapshot().sizes.rx];
  return { ...environment, hooks, sizes, split, writes };
}

test("UART splitter follows only its captured pointer and persists one completion", () => {
  const { hooks, pointer, sizes, document, window, handle, captured, released, writes } = createLayoutHarness();
  handle.emit("pointerdown", pointer(0, 400));
  assert.deepEqual(sizes(), [50, 50], "grabbing the separator must not jump to the pointer position");
  assert.equal(captured.has(0), true);
  handle.emit("pointerdown", pointer(2, 700));
  document.emit("pointermove", pointer(2, 700));
  document.emit("pointerup", pointer(2, 700));
  document.emit("pointercancel", pointer(2, 700));
  assert.deepEqual(sizes(), [50, 50]);
  assert.equal(writes.length, 0);
  document.emit("pointermove", pointer(0, 550));
  document.emit("pointerup", pointer(0, 580));
  assert.deepEqual(sizes(), [68, 32]);
  assert.deepEqual(released, [0]);
  assert.equal(writes.length, 1);
  assert.equal(document.listeners.has("pointermove"), false);
  assert.equal(window.listeners.has("blur"), false);
  assert.equal(handle.listeners.has("lostpointercapture"), false);
  document.emit("pointercancel", pointer(0, 680));
  assert.equal(writes.length, 1);
});

test("UART uses shared cancellation for capture loss, blur, pointercancel and window resize", () => {
  for (const type of ["lostpointercapture", "blur", "pointercancel", "resize"]) {
    const { pointer, sizes, document, window, split, handle, released, writes } = createLayoutHarness();
    handle.emit("pointerdown", pointer(7, 610));
    document.emit("pointermove", pointer(7, 710));
    const target = type === "lostpointercapture" ? handle : type === "pointercancel" ? document : window;
    target.emit(type, type === "blur" || type === "resize" ? {} : pointer(7, 900));
    document.emit("pointerup", pointer(7, 900));
    assert.deepEqual(sizes(), [60, 40]);
    assert.equal(split.classes.has("is-terminal-resizing"), false);
    assert.equal(document.body.classes.size, 0);
    assert.deepEqual(released, [7]);
    assert.equal(writes.length, 1);
    assert.equal(document.listeners.has("pointercancel"), false);
  }
});

test("UART splitter reports bounds and applies Home and End to opposite endpoints", () => {
  const { hooks, sizes, handle, writes } = createLayoutHarness();
  assert.equal(handle.attributes.get("aria-valuemin"), "22");
  assert.equal(handle.attributes.get("aria-valuemax"), "78");
  assert.equal(handle.attributes.get("aria-valuenow"), "50");
  assert.equal(handle.attributes.get("aria-controls"), "uartTxSession");
  const key = (value, detail) => handle.emit("keydown", { key: value, ...detail });
  assert.equal(key("Home").defaultPrevented, true);
  assert.deepEqual(sizes(), [22, 78]);
  assert.equal(handle.attributes.get("aria-valuenow"), "22");
  assert.equal(key("End").defaultPrevented, true);
  assert.deepEqual(sizes(), [78, 22]);
  assert.equal(handle.attributes.get("aria-valuetext"), "TX 78%, RX 22%");
  assert.equal(key("ArrowLeft").defaultPrevented, true);
  assert.deepEqual(sizes(), [74, 26]);
  assert.equal(key("ArrowLeft", { shiftKey: true }).defaultPrevented, true);
  assert.deepEqual(sizes(), [66, 34]);
  assert.equal(key("a").defaultPrevented, false);
  assert.equal(writes.length, 4);
});

test("UART drag works without pointer capture and ignores secondary or disabled handles", () => {
  const { pointer, sizes, document, split, handle, writes } = createLayoutHarness();
  handle.setPointerCapture = () => { throw new Error("No capture"); };
  handle.emit("pointerdown", pointer(1, 500, { isPrimary: false }));
  assert.equal(handle.focusCount, 0);
  handle.emit("pointerdown", pointer(1, 500));
  assert.equal(handle.focusCount, 1);
  document.emit("pointermove", pointer(1, 350));
  document.emit("pointerup", pointer(1, 300));
  assert.deepEqual(sizes(), [30, 70]);
  assert.equal(writes.length, 1);
  split.getBoundingClientRect = () => ({ width: 0 });
  handle.emit("pointerdown", pointer(2, 500));
  assert.equal(handle.focusCount, 1);
});
