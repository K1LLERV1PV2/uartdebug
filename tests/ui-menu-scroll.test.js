"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

test("menu scroll dismissal ignores completed opening scrolls but detects later movement", () => {
  const scrolling = { scrollLeft: 0, scrollTop: 15 };
  const document = { scrollingElement: scrolling }, window = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../public/ui-controls.js"), "utf8"), { document, window });
  const { captureMenuScroll, hasMenuScrollChanged } = window.UartDebugControls;
  const ancestor = { scrollLeft: 5, scrollTop: 300, parentElement: null };
  const trigger = { scrollLeft: 0, scrollTop: 0, parentElement: ancestor };
  const snapshot = captureMenuScroll(trigger);
  assert.equal(hasMenuScrollChanged(snapshot, { target: ancestor }), false, "an opening scroll event can arrive after its offset was captured");
  assert.equal(hasMenuScrollChanged(snapshot, { target: document }), false);
  ancestor.scrollTop += 1;
  assert.equal(hasMenuScrollChanged(snapshot, { target: ancestor }), true);
  ancestor.scrollTop -= 1;
  ancestor.scrollLeft += 1;
  assert.equal(hasMenuScrollChanged(snapshot, { target: ancestor }), true);
  scrolling.scrollTop += 1;
  assert.equal(hasMenuScrollChanged(snapshot, { target: document }), true);
  assert.equal(hasMenuScrollChanged(snapshot, { target: {} }), true, "unknown outside scrolls retain normal dismissal");
  assert.equal(hasMenuScrollChanged(null, { target: ancestor }), true);
});
