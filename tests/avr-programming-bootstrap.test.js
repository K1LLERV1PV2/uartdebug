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
  assert.match(
    css,
    /\.documentation-action-strip\s*>\s*\[hidden\]\s*\{[\s\S]*?display:\s*none !important;/
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

  assert.match(html, /id="projectAiHeader"[^>]*hidden/);
  assert.match(html, /id="projectAiTitle">Build with Uart Debug AI/);
  assert.match(html, /id="projectAiView"/);
  assert.match(html, /id="projectAiWorkspace"/);
  assert.match(html, /id="projectAiHistory"[\s\S]*role="log"/);
  assert.match(html, /id="projectAiForm"/);
  assert.doesNotMatch(html, /id="projectAiAccessToken"/);
  assert.doesNotMatch(html, /id="projectAiClearBtn"/);
  assert.doesNotMatch(html, /Describe the mini-project you need/);
  assert.match(source, /fetch\("\/api\/avr\/ai\/status"/);
  assert.match(source, /fetch\("\/api\/avr\/ai\/generate"/);
  assert.match(source, /"API key is not configured"/);
  assert.doesNotMatch(source, /"X-UartDebug-AI-Token"/);
  assert.doesNotMatch(source, /PROJECT_AI_ACCESS_STORAGE_KEY/);
  assert.doesNotMatch(source, /readProjectAiAccessToken/);
  assert.doesNotMatch(source, /clearProjectAiHistory/);
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

test("uses sibling framed AI workspace and request composer", () => {
  const html = fs.readFileSync(
    path.join(__dirname, "../public/avr.html"),
    "utf8"
  );
  const css = fs.readFileSync(
    path.join(__dirname, "../public/AVR-Programming.css"),
    "utf8"
  );
  const viewStart = html.indexOf('id="projectAiView"');
  const viewEnd = html.indexOf("</aside>", viewStart);
  const view = html.slice(viewStart, viewEnd);
  const workspace = view.indexOf('id="projectAiWorkspace"');
  const formStart = html.indexOf('id="projectAiForm"');
  const formEnd = html.indexOf("</form>", formStart);
  const form = html.slice(formStart, formEnd);
  const composer = form.indexOf("project-ai-composer");
  const prompt = form.indexOf('id="projectAiPrompt"');
  const submit = form.indexOf('id="projectAiSubmitBtn"');

  assert.ok(viewStart >= 0);
  assert.ok(workspace >= 0);
  assert.ok(view.indexOf('id="projectAiForm"') > workspace);
  assert.ok(composer < prompt);
  assert.ok(prompt < submit);
  assert.doesNotMatch(form, /projectAiAccessToken|projectAiClearBtn/);
  assert.match(
    view,
    /project-ai-workspace[^"]*scroll-frame|scroll-frame[^"]*project-ai-workspace/
  );
  assert.match(
    form,
    /project-ai-composer[^"]*scroll-frame|scroll-frame[^"]*project-ai-composer/
  );
  assert.match(css, /\.project-ai-view\s*\{[\s\S]*?flex-direction:\s*column;/);
  assert.match(
    css,
    /\.project-ai-form\s*\{[\s\S]*?margin-top:\s*12px;/
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

test("wires every built-in card to public files and a private AI reference", () => {
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
  assert.deepEqual(
    publicCatalog.projects.map((entry) => entry.id),
    ["01_Minimum", "02_CPU_Clock", "03_Delay-Based_Blink"]
  );

  for (const project of publicCatalog.projects) {
    const privateReference = privateCatalog.projects.find(
      (entry) => entry.id === project.id
    );
    assert.equal(
      (html.match(new RegExp(`data-template-id="${project.id}"`, "g")) || [])
        .length,
      1
    );
    assert.equal(project.aiSpecRef, undefined);
    assert.ok(privateReference, `missing private AI reference for ${project.id}`);

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
    assert.ok(fs.existsSync(sourcePath), sourcePath);
    assert.ok(fs.existsSync(guidePath), guidePath);
    assert.ok(fs.existsSync(aiPath), aiPath);
    assert.equal(
      crypto.createHash("sha256").update(fs.readFileSync(aiPath)).digest("hex"),
      privateReference.sha256
    );
    assert.ok(sw.includes(project.source.url));
    assert.ok(sw.includes(project.guides[0].url));

    const markers = extractDocumentationMarkers(
      fs.readFileSync(sourcePath, "utf8")
    );
    const headings = new Set(
      extractMarkdownHeadings(fs.readFileSync(guidePath, "utf8")).map(
        (heading) => heading.key
      )
    );
    for (const marker of markers) {
      assert.ok(headings.has(marker.key), `${project.id}: ${marker.key}`);
    }
  }

  const cpuClock = publicCatalog.projects.find(
    (entry) => entry.id === "02_CPU_Clock"
  );
  const delayBlink = publicCatalog.projects.find(
    (entry) => entry.id === "03_Delay-Based_Blink"
  );
  const cpuClockReference = privateCatalog.projects.find(
    (entry) => entry.id === "02_CPU_Clock"
  );
  const delayBlinkReference = privateCatalog.projects.find(
    (entry) => entry.id === "03_Delay-Based_Blink"
  );

  assert.equal(cpuClock.version, "1.2.3-b");
  assert.equal(cpuClockReference.version, "1.2.3-a");
  assert.equal(delayBlink.displayName, "03_Delay-Based_Blink");
  assert.equal(delayBlink.version, "1.2.3-b");
  assert.equal(
    delayBlink.source.name,
    "03_Delay-Based_Blink_1.2.3-b.c"
  );
  assert.equal(
    delayBlink.guides[0].name,
    "03_Delay-Based_Blink_help_1.2.3-b.md"
  );
  assert.equal(delayBlinkReference.version, "1.2.3-b");
  assert.equal(
    delayBlinkReference.file,
    "03_Delay-Based_Blink/03_Delay-Based_Blink_AI_1.2.3-b.md"
  );
  const delayBlinkSourcePath = path.join(
    __dirname,
    "../public",
    delayBlink.source.url.replace(/^\/+/, "")
  );
  assert.equal(
    extractDocumentationMarkers(
      fs.readFileSync(delayBlinkSourcePath, "utf8")
    ).length,
    14
  );
});
