"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const core = require("../public/avr-mini-projects.js");

test("exposes the mini-project bridge before DOMContentLoaded", () => {
  const windowListeners = new Map();
  const documentListeners = new Map();
  const fakeWindow = {
    UartDebugAvrMiniProjectCore: core,
    addEventListener(type, listener) {
      windowListeners.set(type, listener);
    },
    dispatchEvent() {
      return true;
    },
  };
  const fakeDocument = {
    addEventListener(type, listener) {
      documentListeners.set(type, listener);
    },
  };
  const source = fs.readFileSync(
    path.join(__dirname, "../public/AVR-Programming.js"),
    "utf8"
  );

  vm.runInNewContext(source, {
    window: fakeWindow,
    document: fakeDocument,
    CodeMirror: { registerHelper() {} },
    console,
    Promise,
    Map,
    Set,
    URL,
  });

  const bridge = fakeWindow.UartDebugAvrMiniProjects;
  assert.ok(bridge);
  assert.equal(bridge.schemaVersion, core.SCHEMA_VERSION);
  assert.equal(typeof bridge.install, "function");
  assert.equal(typeof bridge.ready?.then, "function");
  assert.equal(typeof windowListeners.get(bridge.importEvent), "function");
  assert.equal(typeof documentListeners.get("DOMContentLoaded"), "function");
});

test("uses the MP badge for mini-projects in the AVR outliner", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../public/AVR-Programming.js"),
    "utf8"
  );

  assert.match(
    source,
    /row\.dataset\.outlinerIcon\s*=\s*isMiniProjectSource\s*\?\s*"MP"/
  );
});

test("keeps the AI toggle at the right edge of Project guide controls", () => {
  const html = fs.readFileSync(
    path.join(__dirname, "../public/avr.html"),
    "utf8"
  );
  const css = fs.readFileSync(
    path.join(__dirname, "../public/AVR-Programming.css"),
    "utf8"
  );
  const guideControlsStart = html.indexOf(
    'aria-label="Project guide controls"'
  );
  const localeIndex = html.indexOf(
    'id="documentationLocaleSelect"',
    guideControlsStart
  );
  const editIndex = html.indexOf(
    'id="documentationEditToggle"',
    guideControlsStart
  );
  const aiToggleIndex = html.indexOf('id="projectAiToggle"', guideControlsStart);
  const documentationViewIndex = html.indexOf(
    'id="projectDocumentationView"',
    guideControlsStart
  );

  assert.ok(guideControlsStart >= 0);
  assert.ok(localeIndex > guideControlsStart);
  assert.ok(editIndex > localeIndex);
  assert.ok(aiToggleIndex > editIndex);
  assert.ok(aiToggleIndex < documentationViewIndex);
  assert.match(
    html.slice(aiToggleIndex, documentationViewIndex),
    /icons\/logo-512\.png/
  );
  assert.match(
    css,
    /\.documentation-action-strip \.project-ai-toggle\s*\{[\s\S]*?width:\s*44px !important;[\s\S]*?min-width:\s*44px !important;[\s\S]*?margin-left:\s*auto !important;/
  );
});

test("wires the project AI pane to the AVR AI API contract", () => {
  const html = fs.readFileSync(
    path.join(__dirname, "../public/avr.html"),
    "utf8"
  );
  const source = fs.readFileSync(
    path.join(__dirname, "../public/AVR-Programming.js"),
    "utf8"
  );

  assert.match(html, /id="projectAiWorkspace"/);
  assert.match(html, /id="projectAiHistory"[\s\S]*role="log"/);
  assert.match(html, /id="projectAiForm"/);
  assert.match(html, /id="projectAiAccessToken"[\s\S]*type="password"/);
  assert.match(source, /fetch\("\/api\/avr\/ai\/status"/);
  assert.match(source, /fetch\("\/api\/avr\/ai\/generate"/);
  assert.match(source, /"API key is not configured"/);
  assert.match(source, /"X-UartDebug-AI-Token"/);
  assert.match(source, /sessionStorage/);
  assert.match(source, /aiSpecRef:\s*publicProject\?\.aiSpecRef/);
  assert.match(
    source,
    /window\.UartDebugAvrMiniProjects\.install\(definition/
  );
  assert.match(
    source,
    /rawFile\?\.role === "humanGuide"[\s\S]*miniProjectCore\.ROLES\.GUIDE/
  );
});
