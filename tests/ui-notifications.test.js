"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { parseHTML } = require("../frontend/markdown-runtime/node_modules/linkedom");

const storageKey = "ud_notifications_session_v1";

function loadNotifications({ saved = new Map(), storageThrows = false, motion = false, reducedMotion = false } = {}) {
  const { document, window: domWindow, Event } = parseHTML(
    '<html><body><button id="bell" data-notifications-open></button><span data-notifications-latest></span></body></html>'
  );
  document.readyState = "loading";
  const nativeMatches = domWindow.Element.prototype.matches;
  domWindow.Element.prototype.matches = function (selector) {
    return selector === ":hover, :focus-within" ? false : nativeMatches.call(this, selector);
  };
  domWindow.Element.prototype.getClientRects = function () { return this.hidden ? [] : [{ width: 1, height: 1 }]; };
  if (motion) domWindow.Element.prototype.getBoundingClientRect = () => ({ height: 70 });
  const frames = new Map();
  const timers = new Map();
  const listeners = new Map();
  let nextId = 0;
  let clock = 0;
  const requestAnimationFrame = callback => { const id = ++nextId; frames.set(id, callback); return id; };
  const setTimeout = (callback, delay = 0) => { const id = ++nextId; timers.set(id, { callback, due: clock + delay }); return id; };
  const window = { requestAnimationFrame, addEventListener(type, callback) { listeners.set(type, callback); },
    matchMedia: () => ({ matches: reducedMotion }),
    getComputedStyle: () => ({ opacity: "1", transform: "none", marginTop: "8px" }) };
  const sandbox = {
    window, document, console: { ...console, info: (...values) => diagnostics.push(values.map(String).join(" ")) }, requestAnimationFrame, setTimeout,
    clearTimeout: id => timers.delete(id),
    sessionStorage: {
      getItem(key) { if (storageThrows) throw new Error("Storage denied"); return saved.get(key) || null; },
      setItem(key, value) { if (storageThrows) throw new Error("Storage denied"); saved.set(key, String(value)); },
    },
  };
  const diagnostics = [];
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../public/ui-controls.js"), "utf8"), sandbox);
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../public/ui-notifications.js"), "utf8"), sandbox);
  document.dispatchEvent(new Event("DOMContentLoaded"));
  const flushFrames = () => {
    const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback());
  };
  const advance = milliseconds => {
    clock += milliseconds;
    for (const [id, timer] of [...timers]) if (timer.due <= clock) { timers.delete(id); timer.callback(); }
    flushFrames();
  };
  return { document, api: window.UartDebugNotifications, saved, advance, flushFrames, listeners, diagnostics,
    MutationObserver: domWindow.MutationObserver };
}

test("keyed notification updates keep one toast and preserve omitted fields", () => {
  const { api, document, flushFrames } = loadNotifications();
  const id = api.notify({ key: "build", title: "Compilation", message: "Compiling", details: "Initial output", source: "main.c", pending: true });
  assert.equal(api.notify({ key: "build", title: "Compilation", message: "Compiling", details: "Initial output", source: "main.c", pending: true }), id);
  api.append(id, "Second diagnostic", { message: "Checking result" });
  assert.equal(document.querySelectorAll(".notification-toast").length, 1);
  assert.equal(api.getAll().length, 1);
  let record = api.getAll()[0];
  assert.match(record.details, /Initial output\nSecond diagnostic/);
  assert.equal(record.message, "Checking result");
  api.notify({ id, details: "" });
  record = api.getAll()[0];
  assert.equal(record.details, "");
  assert.equal(record.title, "Compilation");
  assert.equal(record.message, "Checking result");
  assert.equal(record.pending, true);
  api.notify({ id, message: "Build completed", tone: "success", pending: false });
  flushFrames();
  assert.equal(document.querySelector(".notification-toast").dataset.tone, "success");
  assert.equal(document.querySelector(".notification-toast-open > span").textContent, "Build completed");
  assert.equal(document.querySelector("[data-notifications-latest]").textContent, "Build completed");
});

test("notification history and visible toasts are bounded independently", () => {
  const { api, document, flushFrames } = loadNotifications();
  for (let index = 0; index < 105; index += 1) api.notify({ key: `item-${index}`, title: `Notice ${index}`, message: `Message ${index}` });
  flushFrames();
  const records = api.getAll();
  assert.equal(records.length, 100);
  assert.equal(records[0].title, "Notice 5");
  assert.equal(document.querySelectorAll(".notification-toast").length, 3);
  records[0].title = "Mutated copy";
  assert.equal(api.getAll()[0].title, "Notice 5");
  api.dismiss(records.at(-1).id);
  assert.equal(document.querySelectorAll(".notification-toast").length, 2);
  assert.equal(api.getAll().length, 100, "dismissing a toast must preserve its history entry");
});

test("fresh operation starts retain separate history entries while each operation updates by ID", () => {
  const { api } = loadNotifications();
  const first = api.notify({ key: null, title: "Compilation", message: "Compiling", pending: true });
  api.notify({ id: first, message: "Build completed", tone: "success", pending: false });
  const second = api.notify({ key: null, title: "Compilation", message: "Compiling", pending: true });
  assert.notEqual(first, second);
  api.append(second, "Compilation failed", { message: "Build failed", tone: "error", pending: false });
  assert.equal(api.getAll().length, 2);
  assert.equal(api.getAll().find(record => record.id === first).tone, "success");
  assert.equal(api.getAll().find(record => record.id === second).tone, "error");
});

test("dismissing a pending toast suppresses its progress updates until the final result", () => {
  const { api, document } = loadNotifications();
  const id = api.notify({ key: null, title: "Flash MCU", message: "Writing page 1", pending: true });
  assert.equal(document.querySelectorAll(".notification-toast").length, 1);
  api.dismiss(id);
  api.append(id, "Page 1 verified", { message: "Writing page 2" });
  assert.equal(document.querySelectorAll(".notification-toast").length, 0);
  api.notify({ id, message: "Writing page 3", pending: true });
  assert.equal(document.querySelectorAll(".notification-toast").length, 0);
  assert.equal(api.getAll().length, 1);
  assert.match(api.getAll()[0].details, /Page 1 verified/);
  api.notify({ id, message: "Flash programmed and verified", tone: "success", pending: false });
  assert.equal(document.querySelectorAll(".notification-toast").length, 1);
  assert.equal(document.querySelector(".notification-toast-open > span").textContent, "Flash programmed and verified");
});

test("diagnostic appends do not repeatedly announce an unchanged progress summary", () => {
  const { api, document, MutationObserver } = loadNotifications();
  const id = api.notify({ key: null, title: "Compilation", message: "Compiling", pending: true });
  const observer = new MutationObserver(() => {});
  const announcer = document.querySelector(".notification-announcer");
  observer.observe(announcer, { childList: true, characterData: true, subtree: true });
  api.append(id, "First compiler diagnostic");
  api.append(id, "Second compiler diagnostic");
  assert.equal(observer.takeRecords().length, 0);
  assert.equal(announcer.textContent, "Compilation. Compiling");
  observer.disconnect();
});

test("large diagnostic streams retain their newest lines within the details limit", () => {
  const { api } = loadNotifications();
  const id = api.notify({ title: "Flash MCU", message: "Programming", details: "A".repeat(48000), pending: true });
  api.append(id, "Final verified page");
  const record = api.getAll()[0];
  assert.ok(record.details.length <= 48000);
  assert.match(record.details, /^\[Earlier details omitted\]/);
  assert.match(record.details, /Final verified page$/);
  assert.equal(record.pending, true);
});

test("notification text is never interpreted as HTML in toast or detail views", () => {
  const { api, document } = loadNotifications();
  const title = '<img src="x" onerror="alert(1)">';
  const details = '</pre><script>window.injected=true</script><b>Compiler output</b>';
  const id = api.notify({ title, message: details, details, tone: "error" });
  api.open(id);
  assert.equal(document.querySelector(".notification-toast-open strong").textContent, title);
  assert.equal(document.querySelector(".notification-detail-output").textContent, details);
  assert.equal(document.querySelectorAll(".notification-toasts img,.notification-toasts script,.notification-detail img,.notification-detail script,.notification-detail b").length, 0);
});

test("session reload preserves read history and marks interrupted operations without replaying toasts", () => {
  const first = loadNotifications();
  const done = first.api.notify({ title: "Compilation", message: "Build completed", tone: "success" });
  first.api.open(done);
  first.api.notify({ title: "Flash MCU", message: "Programming flash", details: "Page 1 verified", pending: true });
  first.advance(250);
  assert.ok(first.saved.has(storageKey));
  const second = loadNotifications({ saved: first.saved });
  assert.equal(second.api.getAll().length, 2);
  const completed = second.api.getAll().find(record => record.id === done);
  const interrupted = second.api.getAll().find(record => record.id !== done);
  assert.equal(completed.read, true);
  assert.equal(completed.tone, "success");
  assert.equal(interrupted.pending, false);
  assert.equal(interrupted.tone, "warning");
  assert.equal(interrupted.message, "Operation interrupted by page reload.");
  assert.match(interrupted.details, /Page 1 verified/);
  assert.equal(second.document.querySelectorAll(".notification-toast").length, 0);
});

test("notification storage failure degrades to in-memory history without recursive errors", () => {
  const { api, advance } = loadNotifications({ storageThrows: true });
  api.notify({ title: "Local operation", message: "Still visible" });
  assert.doesNotThrow(() => advance(300));
  assert.equal(api.getAll().length, 1);
});

test("dismissing a toast keeps its noninteractive exit until completion and retains history", () => {
  const { api, document, advance } = loadNotifications({ motion: true });
  const id = api.notify({ title: "Compilation", message: "Build completed" });
  api.dismiss(id);
  const outgoing = document.querySelector(".notification-toast.is-leaving");
  assert.ok(outgoing);
  assert.equal(outgoing.inert, true);
  assert.equal(outgoing.getAttribute("aria-hidden"), "true");
  advance(100);
  assert.equal(document.querySelectorAll(".notification-toast").length, 1);
  advance(1000);
  assert.equal(document.querySelectorAll(".notification-toast").length, 0);
  assert.equal(api.getAll().length, 1);
});

test("a final result replaces a dismissed pending toast without stale exit removing it", () => {
  const { api, document, advance } = loadNotifications({ motion: true });
  const id = api.notify({ title: "Flash MCU", message: "Writing", pending: true });
  api.dismiss(id);
  api.append(id, "Page verified", { message: "Still writing" });
  assert.equal(document.querySelectorAll(".notification-toast:not(.is-leaving)").length, 0);
  api.notify({ id, message: "Verified", tone: "success", pending: false });
  assert.equal(document.querySelectorAll(".notification-toast").length, 1);
  advance(1000);
  assert.equal(document.querySelectorAll(".notification-toast:not(.is-leaving)").length, 1);
  assert.equal(document.querySelector(".notification-toast-open > span").textContent, "Verified");
});

test("overflow bounds outgoing toasts and reduced motion dismisses without a delayed exit", () => {
  const active = loadNotifications({ motion: true });
  for (let index = 0; index < 105; index += 1) active.api.notify({ key: null, title: `Notice ${index}` });
  assert.equal(active.document.querySelectorAll(".notification-toast:not(.is-leaving)").length, 3);
  assert.equal(active.document.querySelectorAll(".notification-toast.is-leaving").length, 1);
  active.advance(1000);
  assert.equal(active.document.querySelectorAll(".notification-toast").length, 3);
  assert.equal(active.api.getAll().length, 100);
  const reduced = loadNotifications({ motion: true, reducedMotion: true });
  const id = reduced.api.notify({ title: "No motion" });
  reduced.api.dismiss(id);
  assert.equal(reduced.document.querySelectorAll(".notification-toast").length, 0);
});

test("technical logs go to the console while ordinary compiler output remains visible", () => {
  const { api, document, diagnostics, advance, saved } = loadNotifications();
  const id = api.notify({ title: "Chip detection", message: "Could not communicate with the chip.",
    details: "Check the adapter and chip power.", diagnostics: "Reading signature...", tone: "error" });
  api.open(id);
  assert.equal(document.querySelector(".notification-diagnostics"), null);
  assert.equal(document.querySelector(".notification-detail-output").textContent, "Check the adapter and chip power.");
  assert.match(diagnostics.join("\n"), /Reading signature/);
  assert.equal(Object.hasOwn(api.getAll()[0], "diagnostics"), false);
  api.notify({ id, details: "D".repeat(48000), diagnostics: "T".repeat(48000) });
  const record = api.getAll()[0];
  assert.ok(record.details.length <= 48000);
  advance(250);
  assert.doesNotMatch(saved.get(storageKey), /"diagnostics"/);
  const compiler = api.notify({ title: "Compilation", message: "Build failed", details: "main.c:7:3: error: missing semicolon" });
  api.open(compiler);
  assert.equal(document.querySelector(".notification-detail-output").hidden, false);
  assert.match(document.querySelector(".notification-detail-output").textContent, /missing semicolon/);
});

test("legacy stack traces leave the UI and session history without erasing useful details", () => {
  const saved = new Map([[storageKey, JSON.stringify({ schemaVersion: 1, records: [{ id: "old-error", createdAt: 1,
    title: "Chip detection", message: "Chip detection failed", details: "[20:53:08] Reading signature...\nError: Timed out\n    at waitForBuffer (http://localhost/updi-test.js:1101:15)\nPort closed.", tone: "error" }] })]]);
  const { api, document, diagnostics, advance } = loadNotifications({ saved });
  api.open("old-error");
  const record = api.getAll()[0];
  assert.equal(record.details, "[20:53:08] Reading signature...\nError: Timed out\nPort closed.");
  assert.match(diagnostics.join("\n"), /waitForBuffer/);
  assert.match(diagnostics.join("\n"), /Port closed/);
  assert.equal(Object.hasOwn(record, "diagnostics"), false);
  assert.equal(document.querySelector(".notification-detail-output").hidden, false);
  assert.equal(document.querySelector(".notification-detail-output").textContent, record.details);
  advance(250);
  assert.doesNotMatch(saved.get(storageKey), /waitForBuffer/);
  const id = api.notify({ title: "Compiler", message: "Compilation failed", details: "file.c:8:4: error: expected expression" });
  api.open(id);
  assert.equal(document.querySelector(".notification-detail-output").hidden, false);
});

test("mixed legacy logs retain their chronology, error reason and compiler lines while frames and source paths go only to the console", () => {
  const { api, document, diagnostics, advance, saved } = loadNotifications();
  const initial = "[20:53:08] Requesting serial port...\n[20:53:08] Opening port with 115200 / 8E2...";
  const id = api.notify({ key: null, title: "Chip detection", message: "Reading signature...", details: initial, pending: true });
  const mixed = [
    "[20:53:09] Error: Timed out in http://localhost/updi-test.js:1101:15",
    "[20:53:09]     at waitForBuffer (http://localhost/updi-test.js:1101:15)",
    "    at Array.map (<anonymous>)",
    "    at nativeCall (native)",
    "    at reader (C:\\Users\\david\\websites\\uartdebug\\public\\updi-test.js:1101:15)",
    "[20:53:09] Last caller: /var/www/uartdebug/public/updi-test.js:1101:15",
    "firmware.c:7:3: error: expected expression",
    "Payload: 64 byte(s), address 0x8040",
    "See https://example.com/adapter-help for connection guidance.",
    "[20:53:10] Port closed.",
  ].join("\n");
  api.append(id, mixed, { message: "Chip detection failed.", tone: "error", pending: false });
  const record = api.getAll()[0];
  assert.equal(api.getAll().length, 1);
  assert.ok(record.details.startsWith(initial));
  assert.match(record.details, /\[20:53:09\] Error: Timed out in \[source location\]/);
  assert.match(record.details, /Last caller: \[source location\]/);
  assert.match(record.details, /firmware\.c:7:3: error: expected expression/);
  assert.match(record.details, /Payload: 64 byte\(s\), address 0x8040/);
  assert.match(record.details, /https:\/\/example\.com\/adapter-help/);
  assert.match(record.details, /\[20:53:10\] Port closed\.$/);
  assert.doesNotMatch(record.details, /waitForBuffer|updi-test\.js|C:\\Users|\/var\/www|Array\.map|nativeCall/);
  assert.equal(diagnostics.length, 1);
  assert.match(diagnostics[0], /waitForBuffer/);
  const logged = diagnostics.length;
  api.open(id);
  api.open(id);
  assert.equal(diagnostics.length, logged, "opening or rendering sanitized records must not replay raw diagnostics");
  assert.equal(document.querySelector(".notification-detail-output").textContent, record.details);
  advance(250);
  assert.doesNotMatch(saved.get(storageKey), /waitForBuffer|updi-test\.js|C:\\\\Users|\/var\/www/);
});

test("a stack used as both message and details keeps its reason, receives a clean key and is logged once", () => {
  const { api, diagnostics, advance, saved } = loadNotifications();
  const raw = "Error: Adapter disconnected in http://localhost/uart.js:100:2\n    at readLoop (http://localhost/uart.js:100:2)\n    at Array.map (<anonymous>)";
  const id = api.notify({ title: "Serial connection", message: raw, tone: "error" });
  let record = api.getAll()[0];
  assert.equal(record.message, "The operation could not be completed.");
  assert.equal(record.details, "Error: Adapter disconnected in [source location]");
  assert.equal(record.key, "Serial connection\nError: Adapter disconnected in [source location]");
  assert.equal(diagnostics.length, 1);
  api.notify({ id, read: true });
  assert.equal(diagnostics.length, 1);
  record = api.getAll()[0];
  assert.equal(record.details, "Error: Adapter disconnected in [source location]");
  const second = api.notify({ title: "Serial connection", message: raw.replace("disconnected", "unavailable"), tone: "error" });
  assert.notEqual(second, id, "different error reasons must not collapse into the generic toast message's key");
  assert.equal(api.notify({ title: "Serial connection", message: raw, tone: "error" }), id, "the same cleaned reason retains normal deduplication");
  advance(250);
  assert.doesNotMatch(saved.get(storageKey), /readLoop|uart\.js|localhost|<anonymous>|"diagnostics"/);
});

test("restoring mixed legacy records immediately replaces raw stack keys and never logs them again on a subsequent reload", () => {
  const raw = "[20:53:08] Reading signature...\nError: Timed out in /var/www/uartdebug/updi-test.js:1101:15\n    at waitForBuffer (/var/www/uartdebug/updi-test.js:1101:15)\n[20:53:09] Port closed.";
  const saved = new Map([[storageKey, JSON.stringify({ schemaVersion: 1, records: [{ id: "old-mixed", createdAt: 1,
    key: `Chip detection\n${raw}`, title: "Chip detection", message: "Chip detection failed.", details: raw, tone: "error" }] })]]);
  const first = loadNotifications({ saved });
  assert.equal(first.diagnostics.length, 1);
  assert.match(first.api.getAll()[0].details, /Reading signature[\s\S]*Error: Timed out[\s\S]*Port closed/);
  assert.doesNotMatch(saved.get(storageKey), /waitForBuffer|updi-test\.js|\/var\/www/);
  const second = loadNotifications({ saved });
  assert.equal(second.diagnostics.length, 0);
  assert.equal(second.api.getAll()[0].details, first.api.getAll()[0].details);
  assert.equal(second.document.querySelectorAll(".notification-toast").length, 0);
});

test("mixed-stack source redaction consumes long dotted, URL-prefix and punctuation tokens without repeated scans", () => {
  const { performance } = require("node:perf_hooks");
  const { api } = loadNotifications();
  const frame = "\n    at reader (http://localhost/uart.js:100:2)";
  const values = ["a.".repeat(24000), "http://".repeat(6800), ")".repeat(47999) + "a"];
  const started = performance.now();
  for (const value of values) {
    const id = api.notify({ key: null, title: "Long recovered log", message: "Operation failed.", details: value + frame, tone: "error" });
    assert.equal(api.getAll().find(record => record.id === id).details, value);
  }
  assert.ok(performance.now() - started < 500, "bounded legacy records must not block the page on repetitive tokens");
});

test("source locations in a mixed error's summary and key are removed without changing ordinary explicit keys", () => {
  const { api, saved, advance } = loadNotifications();
  const rawMessage = "Read failed in (http://localhost/uart.js?v=build:100:2).";
  const id = api.notify({ title: "Serial connection", message: rawMessage, tone: "error",
    details: `${rawMessage}\n    at reader (http://localhost/uart.js?v=build:100:2)\nPort closed.` });
  const record = api.getAll()[0];
  assert.equal(record.id, id);
  assert.equal(record.message, "Read failed in [source location]");
  assert.equal(record.key, "Serial connection\nRead failed in [source location]");
  assert.equal(record.details, "Read failed in [source location]\nPort closed.");
  api.notify({ key: "ordinary-explicit-key", title: "Compilation", message: "Build failed", details: "main.c:1:2: error: expected expression" });
  assert.equal(api.getAll()[1].key, "ordinary-explicit-key");
  advance(250);
  assert.doesNotMatch(saved.get(storageKey), /localhost|uart\.js|at reader/);
});

test("an explicit legacy stack key uses the same cleaned value for lookup and storage", () => {
  const { api, saved, advance } = loadNotifications();
  const key = "Serial connection\nError: Disconnected in http://localhost/uart.js:100:2\n    at reader (http://localhost/uart.js:100:2)";
  const id = api.notify({ key, title: "Serial connection", message: "Connecting...", pending: true });
  assert.equal(api.notify({ key, title: "Serial connection", message: "Disconnected", pending: false, tone: "error" }), id);
  assert.equal(api.getAll().length, 1);
  assert.equal(api.getAll()[0].key, "Serial connection\nError: Disconnected in [source location]");
  advance(250);
  assert.doesNotMatch(saved.get(storageKey), /localhost|uart\.js|at reader/);
});
