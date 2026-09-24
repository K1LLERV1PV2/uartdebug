"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function createLayoutHarness() {
  function surface() {
    const listeners = new Map();
    const classes = new Set();
    const attributes = new Map();
    return {
      listeners, classes, attributes, dataset: {}, style: { setProperty() {} },
      addEventListener(type, listener) { listeners.set(type, listener); },
      removeEventListener(type, listener) { if (listeners.get(type) === listener) listeners.delete(type); },
      setAttribute(name, value) { attributes.set(name, String(value)); },
      classList: { add: (...names) => names.forEach((name) => classes.add(name)), remove: (...names) => names.forEach((name) => classes.delete(name)) },
    };
  }
  const document = surface();
  document.body = surface();
  const window = surface();
  const split = surface();
  split.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 600 });
  const tx = surface(); tx.id = "uartTxSession";
  const rx = surface(); rx.id = "uartRxSession";
  document.querySelector = (selector) => selector.includes('"tx"') ? tx : rx;
  const handle = surface();
  const captured = new Set();
  const released = [];
  handle.setPointerCapture = (id) => captured.add(id);
  handle.hasPointerCapture = (id) => captured.has(id);
  handle.releasePointerCapture = (id) => { captured.delete(id); released.push(id); };
  const writes = [];
  const sandbox = {
    document, window, console,
    localStorage: { getItem: () => null, setItem: (key, value) => writes.push({ key, value }) },
    requestAnimationFrame: () => 1, cancelAnimationFrame() {},
  };
  const source = fs.readFileSync(path.join(__dirname, "../public/uart.js"), "utf8");
  vm.runInNewContext(`${source}\nwindow.layoutHooks = {
    setup(split, handle, tx, rx) { uartSessionsSplit = split; terminalLayoutResizer = handle; uartSessions = [tx, rx]; },
    initializeTerminalLayout, handleTerminalResizePointerDown, handleTerminalResizePointerMove,
    handleTerminalResizePointerUp, cancelTerminalResize, handleTerminalResizeKey,
    snapshot() { return JSON.parse(JSON.stringify(terminalLayoutState)); }
  };`, sandbox);
  const hooks = window.layoutHooks;
  hooks.setup(split, handle, tx, rx);
  hooks.initializeTerminalLayout();
  const pointer = (id, x) => ({ pointerId: id, button: 0, clientX: x, clientY: 300, preventDefault() {} });
  const sizes = () => [hooks.snapshot().sizes.tx, hooks.snapshot().sizes.rx];
  return { hooks, pointer, sizes, document, window, split, handle, captured, released, writes };
}

test("UART splitter follows only its captured pointer and persists one completion", () => {
  const { hooks, pointer, sizes, document, window, handle, captured, released, writes } = createLayoutHarness();
  hooks.handleTerminalResizePointerDown(pointer(0, 400));
  assert.deepEqual(sizes(), [40, 60]);
  assert.equal(captured.has(0), true);
  hooks.handleTerminalResizePointerDown(pointer(2, 700));
  hooks.handleTerminalResizePointerMove(pointer(2, 700));
  hooks.handleTerminalResizePointerUp(pointer(2, 700));
  hooks.cancelTerminalResize(pointer(2, 700));
  assert.deepEqual(sizes(), [40, 60]);
  assert.equal(writes.length, 0);
  hooks.handleTerminalResizePointerMove(pointer(0, 650));
  hooks.handleTerminalResizePointerUp(pointer(0, 680));
  assert.deepEqual(sizes(), [68, 32]);
  assert.deepEqual(released, [0]);
  assert.equal(writes.length, 1);
  assert.equal(document.listeners.has("pointermove"), false);
  assert.equal(window.listeners.has("blur"), false);
  assert.equal(handle.listeners.has("lostpointercapture"), false);
  hooks.cancelTerminalResize(pointer(0, 680));
  assert.equal(writes.length, 1);
});

test("UART splitter clears resize state on capture loss and window blur", () => {
  const { hooks, pointer, sizes, document, window, split, handle, released, writes } = createLayoutHarness();
  hooks.handleTerminalResizePointerDown(pointer(7, 610));
  handle.listeners.get("lostpointercapture")(pointer(7, 610));
  assert.equal(split.classes.has("is-terminal-resizing"), false);
  assert.equal(document.body.classes.has("is-terminal-layout-active"), false);
  assert.equal(writes.length, 1);
  hooks.handleTerminalResizePointerDown(pointer(8, 730));
  window.listeners.get("blur")({ type: "blur" });
  assert.deepEqual(sizes(), [73, 27]);
  assert.deepEqual(released, [7, 8]);
  assert.equal(writes.length, 2);
  assert.equal(document.listeners.has("pointercancel"), false);
});

test("UART splitter reports bounds and applies Home and End to opposite endpoints", () => {
  const { hooks, sizes, handle, writes } = createLayoutHarness();
  assert.equal(handle.attributes.get("aria-valuemin"), "22");
  assert.equal(handle.attributes.get("aria-valuemax"), "78");
  assert.equal(handle.attributes.get("aria-valuenow"), "50");
  assert.equal(handle.attributes.get("aria-controls"), "uartTxSession");
  let prevented = 0;
  const key = (value) => hooks.handleTerminalResizeKey({ key: value, preventDefault() { prevented += 1; } });
  key("Home");
  assert.deepEqual(sizes(), [22, 78]);
  assert.equal(handle.attributes.get("aria-valuenow"), "22");
  key("End");
  assert.deepEqual(sizes(), [78, 22]);
  assert.equal(handle.attributes.get("aria-valuetext"), "TX 78%, RX 22%");
  key("ArrowLeft");
  assert.deepEqual(sizes(), [74, 26]);
  key("a");
  assert.equal(prevented, 3);
  assert.equal(writes.length, 3);
});
