"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const core = require("../public/avr-mini-projects.js");
const {
  extractDocumentationMarkers,
  extractMarkdownHeadings,
} = require("../backend/avr-documentation-markers");

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
  assert.equal(typeof bridge.renameInstance, "function");
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
  assert.match(source, /typeof publicProject\?\.aiSpecRef\?\.id === "string"/);
  assert.doesNotMatch(
    source,
    /cloneJsonMetadata\(publicProject\.aiSpecRef/
  );
  assert.doesNotMatch(
    source,
    /^\s*aiSpecRef:\s*descriptor\.aiSpecRef,\s*$/m
  );
  assert.match(
    source,
    /\.\.\.\(descriptor\.aiSpecRef[\s\S]*?\{\s*aiSpecRef:\s*descriptor\.aiSpecRef\s*\}/
  );
  assert.match(
    source,
    /window\.UartDebugAvrMiniProjects\.install\(definition/
  );
  assert.match(
    source,
    /rawFile\?\.role === "humanGuide"[\s\S]*miniProjectCore\.ROLES\.GUIDE/
  );
});

test("does not render the obsolete AI context row", () => {
  const html = fs.readFileSync(
    path.join(__dirname, "../public/avr.html"),
    "utf8"
  );
  const css = fs.readFileSync(
    path.join(__dirname, "../public/AVR-Programming.css"),
    "utf8"
  );
  const source = fs.readFileSync(
    path.join(__dirname, "../public/AVR-Programming.js"),
    "utf8"
  );

  assert.doesNotMatch(html, /class="project-ai-context"/);
  assert.doesNotMatch(html, /id="projectAiContextFile"/);
  assert.doesNotMatch(html, /id="projectAiContextMcu"/);
  assert.doesNotMatch(css, /\.project-ai-context/);
  assert.doesNotMatch(source, /refreshProjectAiContext/);
  assert.match(source, /mcu:\s*String\(mcuSelect\?\.value/);
});

test("lets the guide pane grow until the editor reaches its minimum width", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../public/AVR-Programming.js"),
    "utf8"
  );

  assert.match(
    source,
    /rect\.width\s*-\s*outlinerWidth\s*-\s*OUTLINER_EDITOR_MIN_WIDTH\s*-\s*SPLIT_RESIZER_TOTAL_WIDTH/
  );
  assert.doesNotMatch(source, /halfSplitWidth/);
  assert.doesNotMatch(source, /availableDocumentationWidth\s*\/\s*2/);
});

test("uses one framed AI request composer", () => {
  const html = fs.readFileSync(
    path.join(__dirname, "../public/avr.html"),
    "utf8"
  );
  const css = fs.readFileSync(
    path.join(__dirname, "../public/AVR-Programming.css"),
    "utf8"
  );
  const formStart = html.indexOf('id="projectAiForm"');
  const formEnd = html.indexOf("</form>", formStart);
  const form = html.slice(formStart, formEnd);
  const access = form.indexOf('id="projectAiAccessToken"');
  const composer = form.indexOf("project-ai-composer");
  const prompt = form.indexOf('id="projectAiPrompt"');
  const clear = form.indexOf('id="projectAiClearBtn"');
  const submit = form.indexOf('id="projectAiSubmitBtn"');

  assert.ok(access >= 0 && access < composer);
  assert.ok(composer < prompt);
  assert.ok(prompt < clear);
  assert.ok(clear < submit);
  assert.match(
    form,
    /project-ai-composer[^"]*scroll-frame|scroll-frame[^"]*project-ai-composer/
  );
  assert.match(css, /\.project-ai-composer:focus-within\s*\{/);
  assert.match(css, /#projectAiPrompt\s*\{[\s\S]*?border:\s*0;/);
  assert.match(css, /#projectAiPrompt\s*\{[\s\S]*?background:\s*transparent;/);
});

test("renames a mini-project display name without renaming its linked files", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../public/AVR-Programming.js"),
    "utf8"
  );

  assert.match(source, /mode:\s*"rename-project"/);
  assert.match(
    source,
    /function renameMiniProjectInstance[\s\S]*?project\.displayName = name;/
  );
  assert.match(
    source,
    /renameInstance\(instanceId, displayName\)[\s\S]*?renameMiniProjectInstance/
  );
  assert.doesNotMatch(
    source,
    /renameBtn\.hidden\s*=\s*!!isMiniProjectSource/
  );
});

test("wires the 02 CPU Clock card to its public files and private AI reference", () => {
  const html = fs.readFileSync(
    path.join(__dirname, "../public/avr.html"),
    "utf8"
  );
  const sw = fs.readFileSync(
    path.join(__dirname, "../public/sw.js"),
    "utf8"
  );
  const publicCatalog = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "../public/avr-mini-projects/catalog.json"),
      "utf8"
    )
  );
  const privateCatalog = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "../backend/ai/mini-projects/catalog.json"),
      "utf8"
    )
  );
  const project = publicCatalog.projects.find(
    (entry) => entry.id === "02_CPU_Clock"
  );
  const privateReference = privateCatalog.projects.find(
    (entry) => entry.id === "02_CPU_Clock"
  );

  assert.equal(
    (html.match(/data-template-id="02_CPU_Clock"/g) || []).length,
    1
  );
  assert.ok(project);
  assert.equal(project.displayName, "02_CPU_Clock");
  assert.equal(project.version, "1.2.3-b");
  assert.equal(project.source.name, "02_CPU_Clock_1.2.3-b.c");
  assert.equal(project.guides[0].name, "02_CPU_Clock_help_1.2.3-b.md");
  assert.equal(project.aiSpecRef, undefined);
  assert.ok(privateReference);
  assert.equal(privateReference.version, "1.2.3-a");
  assert.equal(
    privateReference.file,
    "02_CPU_Clock/02_CPU_Clock_AI_1.2.3-a.md"
  );

  const sourcePath = path.join(
    __dirname,
    "../public",
    project.source.url.replace(/^\/+/, "")
  );
  const guidePath = path.join(
    __dirname,
    "../public",
    project.guides[0].url.replace(/^\/+/, "")
  );
  const aiPath = path.join(
    __dirname,
    "../backend/ai/mini-projects",
    privateReference.file
  );
  assert.ok(fs.existsSync(sourcePath));
  assert.ok(fs.existsSync(guidePath));
  assert.ok(fs.existsSync(aiPath));
  assert.equal(
    crypto.createHash("sha256").update(fs.readFileSync(aiPath)).digest("hex"),
    privateReference.sha256
  );
  assert.match(sw, /02_CPU_Clock_1\.2\.3-b\.c/);
  assert.match(sw, /02_CPU_Clock_help_1\.2\.3-b\.md/);

  const markers = extractDocumentationMarkers(fs.readFileSync(sourcePath, "utf8"));
  const headings = new Set(
    extractMarkdownHeadings(fs.readFileSync(guidePath, "utf8")).map(
      (heading) => heading.key
    )
  );
  assert.equal(markers.length, 15);
  for (const marker of markers) assert.ok(headings.has(marker.key));
});
