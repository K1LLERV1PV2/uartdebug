"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

test("a disabled tooltip ancestor suppresses tooltips for its controls", () => {
  const documentListeners = new Map();
  let disabledAncestorLookups = 0;

  const fakeDocument = {
    readyState: "loading",
    body: {},
    addEventListener(type, listener) {
      documentListeners.set(type, listener);
    },
    querySelectorAll() {
      return [];
    },
    createElement() {
      throw new Error("A suppressed tooltip must not create its visual element.");
    },
  };

  class FakeMutationObserver {
    observe() {}
  }

  const source = fs.readFileSync(
    path.join(__dirname, "../public/ui-tooltips.js"),
    "utf8"
  );

  vm.runInNewContext(source, {
    document: fakeDocument,
    window: {
      addEventListener() {},
    },
    MutationObserver: FakeMutationObserver,
    Node: { ELEMENT_NODE: 1 },
    HTMLElement: class {},
    clearTimeout() {},
  });

  documentListeners.get("DOMContentLoaded")();

  const attributes = new Map([["aria-label", "Guide language"]]);
  const control = {
    matches() {
      return true;
    },
    closest(selector) {
      if (selector === "[data-tooltip-disabled]") {
        disabledAncestorLookups += 1;
        return { id: "projectDocumentationPane" };
      }
      return this;
    },
    getAttribute(name) {
      return attributes.get(name) || null;
    },
    setAttribute(name, value) {
      attributes.set(name, value);
    },
    removeAttribute(name) {
      attributes.delete(name);
    },
  };

  documentListeners.get("pointerover")({ target: control });

  assert.equal(disabledAncestorLookups, 1);
  assert.equal(attributes.has("data-ui-tooltip"), false);
  assert.equal(attributes.has("data-ui-tooltip-source"), false);
});
