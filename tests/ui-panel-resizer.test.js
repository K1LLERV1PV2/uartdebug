"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const { eventSurface, resizeEnvironment } = require("./helpers/panel-resizer-harness");

function setup(options = {}) {
  const environment = resizeEnvironment();
  const { document, window, handle } = environment;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../public/ui-controls.js"), "utf8"), { window, document });
  const moves = [], finishes = [], keys = [];
  window.UartDebugControls.bindPanelResizer(handle, {
    axis: "x", start: () => ({ initial: 300 }),
    move: (delta, state) => moves.push(state.initial + delta),
    finish: (_, event) => finishes.push(event.type),
    key: command => keys.push({ ...command }),
    ...options,
  });
  return { ...environment, controls: window.UartDebugControls, moves, finishes, keys };
}

test("panel drag focuses its handle without jumping and tracks only the primary pointer", () => {
  const { handle, pointer, document, controls, moves, finishes } = setup();
  handle.emit("pointerdown", pointer(1, 100, { isPrimary: false }));
  handle.emit("pointerdown", pointer(1, 100, { button: 2 }));
  assert.equal(controls.isPanelResizing(), false);
  assert.equal(handle.focusCount, 0);
  handle.emit("pointerdown", pointer(1, 103));
  assert.equal(handle.focusCount, 1);
  assert.deepEqual(moves, [], "pressing the edge of a separator must not change its position");
  handle.emit("pointerdown", pointer(2, 500));
  document.emit("pointermove", pointer(2, 500));
  document.emit("pointerup", pointer(2, 500));
  document.emit("pointercancel", pointer(2, 500));
  assert.deepEqual(moves, []);
  assert.deepEqual(finishes, []);
  document.emit("pointermove", pointer(1, 143));
  document.emit("pointerup", pointer(1, 150));
  assert.deepEqual(moves, [340, 347]);
  assert.deepEqual(finishes, ["pointerup"]);
  assert.equal(controls.isPanelResizing(), false);
});

test("panel drag falls back to document events when pointer capture is rejected", () => {
  const { handle, pointer, document, moves, finishes, controls } = setup();
  handle.setPointerCapture = () => { throw new Error("Capture unavailable"); };
  handle.emit("pointerdown", pointer(0, 100));
  document.emit("pointermove", pointer(0, 160));
  document.emit("pointerup", pointer(0, 180));
  assert.deepEqual(moves, [360, 380]);
  assert.deepEqual(finishes, ["pointerup"]);
  assert.equal(controls.isPanelResizing(), false);
  assert.equal(document.listeners.has("pointermove"), false);
});

test("every cancellation source clears capture, handle, cursor and listeners exactly once", () => {
  for (const type of ["pointercancel", "lostpointercapture", "blur", "resize"]) {
    const { handle, pointer, document, window, controls, finishes, released, moves } = setup();
    handle.releasePointerCapture = id => {
      released.push(id);
      handle.emit("lostpointercapture", pointer(id, 900));
    };
    handle.emit("pointerdown", pointer(7, 100));
    document.emit("pointermove", pointer(7, 120));
    assert.equal(controls.isPanelResizing(), true);
    const target = type === "pointercancel" ? document : type === "lostpointercapture" ? handle : window;
    target.emit(type, type === "blur" || type === "resize" ? {} : pointer(7, 900));
    document.emit("pointerup", pointer(7, 900));
    assert.deepEqual(moves, [320], `${type} must not apply a cancellation position`);
    assert.deepEqual(finishes, [type]);
    assert.deepEqual(released, [7]);
    assert.equal(controls.isPanelResizing(), false);
    assert.equal(handle.classes.size, 0);
    assert.equal(document.body.classes.size, 0);
    assert.equal(document.listeners.has("pointermove"), false);
    assert.equal(document.listeners.has("pointerup"), false);
    assert.equal(document.listeners.has("pointercancel"), false);
    assert.equal(handle.listeners.has("lostpointercapture"), false);
    assert.equal(window.listeners.has("blur"), false);
    assert.equal(window.listeners.has("resize"), false);
  }
});

test("horizontal and vertical separators share keyboard endpoints and shift acceleration", () => {
  for (const axis of ["x", "y"]) {
    const { handle, keys } = setup({ axis });
    const arrows = axis === "x" ? ["ArrowLeft", "ArrowRight"] : ["ArrowUp", "ArrowDown"];
    for (const detail of [{ key: "Home" }, { key: "End" }, { key: arrows[0] }, { key: arrows[1], shiftKey: true }]) {
      assert.equal(handle.emit("keydown", detail).defaultPrevented, true);
    }
    assert.deepEqual(keys, [
      { direction: 0, endpoint: "start", accelerated: false },
      { direction: 0, endpoint: "end", accelerated: false },
      { direction: -1, endpoint: null, accelerated: false },
      { direction: 1, endpoint: null, accelerated: true },
    ]);
    assert.equal(handle.emit("keydown", { key: axis === "x" ? "ArrowUp" : "ArrowLeft" }).defaultPrevented, false);
    assert.equal(handle.emit("keydown", { key: "Home", ctrlKey: true }).defaultPrevented, false);
    assert.equal(keys.length, 4);
  }
});

test("one separator owns the gesture across handles and callback errors release it", () => {
  const { handle, pointer, document, controls, finishes } = setup({ move: () => { throw new Error("Layout failed"); } });
  const second = eventSurface();
  let otherStarts = 0;
  controls.bindPanelResizer(second, { axis: "y", start: () => { otherStarts++; }, move() {} });
  handle.emit("pointerdown", pointer(3, 100));
  second.emit("pointerdown", pointer(4, 100));
  assert.equal(otherStarts, 0);
  assert.throws(() => document.emit("pointermove", pointer(3, 200)), /Layout failed/);
  assert.equal(controls.isPanelResizing(), false);
  assert.equal(document.body.classes.size, 0);
  assert.equal(finishes.length, 1);
  second.emit("pointerdown", pointer(4, 100));
  assert.equal(otherStarts, 1);
  document.emit("pointercancel", pointer(4, 100));
});
