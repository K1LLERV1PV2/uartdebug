"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { parseHTML } = require("../frontend/markdown-runtime/node_modules/linkedom");

const core = require("../public/avr-mini-projects.js");
const {
  extractDocumentationMarkers,
  extractMarkdownHeadings,
} = require("../backend/avr-documentation-markers");

function loadAvrFrontendFunctionHooks(functionNames, overrides = {}) {
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
    ...(overrides.window || {}),
  };
  const fakeDocument =
    overrides.document ||
    {
      addEventListener(type, listener) {
        documentListeners.set(type, listener);
      },
    };
  const source = fs.readFileSync(
    path.join(__dirname, "../public/AVR-Programming.js"),
    "utf8"
  );
  const marker = "  initMiniProjectBridge();";
  assert.ok(source.includes(marker), "AVR frontend bootstrap marker is missing");
  const instrumented = source.replace(
    marker,
    `  window.__avrFrontendTestHooks = { ${functionNames.join(", ")} };\n${marker}`
  );

  vm.runInNewContext(instrumented, {
    window: fakeWindow,
    document: fakeDocument,
    CodeMirror: overrides.CodeMirror || { registerHelper() {} },
    console,
    Promise,
    Map,
    Set,
    TextDecoder,
    URL,
  });
  return fakeWindow.__avrFrontendTestHooks;
}

function loadVendoredMarkdownRuntime(document) {
  const runtimeSource = fs.readFileSync(
    path.join(__dirname, "../public/vendor/uartdebug-markdown.js"),
    "utf8"
  );
  const sandbox = { console, document };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.runInNewContext(runtimeSource, sandbox, {
    filename: "uartdebug-markdown.js",
  });
  return sandbox.UartDebugMarkdown;
}

function createMarkdownCodeMirrorStub(markdown, document) {
  let value = String(markdown);
  let focused = false;
  let selections = [{ anchor: { line: 0, ch: 0 }, head: { line: 0, ch: 0 } }];
  const listeners = new Map();
  const marks = [];
  const widgets = [];
  const scrollCalls = [];
  const editor = {
    marks,
    widgets,
    scrollCalls,
    operation(callback) {
      return callback();
    },
    on(type, listener) {
      const entries = listeners.get(type) || [];
      entries.push(listener);
      listeners.set(type, entries);
    },
    emit(type) {
      for (const listener of listeners.get(type) || []) listener(editor);
    },
    getValue: () => value,
    setValue(nextValue) {
      value = String(nextValue);
    },
    hasFocus: () => focused,
    setFocused(nextFocused) {
      focused = Boolean(nextFocused);
    },
    listSelections: () => selections,
    setSelections(nextSelections) {
      selections = nextSelections;
    },
    getViewport: () => ({ from: 0, to: editor.lineCount() }),
    lineCount: () => value.split("\n").length,
    lastLine: () => editor.lineCount() - 1,
    getLine(line) {
      return value.split("\n")[line] || "";
    },
    getLineHandle(line) {
      return line >= 0 && line < editor.lineCount() ? { line } : null;
    },
    addLineClass() {},
    removeLineClass() {},
    clearGutter() {},
    setGutterMarker() {},
    markText(from, to, options) {
      const mark = {
        from,
        to,
        options,
        cleared: false,
        changedCalls: 0,
        clear() {
          mark.cleared = true;
        },
        changed() {
          mark.changedCalls += 1;
        },
      };
      marks.push(mark);
      return mark;
    },
    addLineWidget(line, node, options) {
      assert.equal(node.ownerDocument, document);
      const widget = {
        line,
        node,
        options,
        cleared: false,
        changedCalls: 0,
        clear() {
          widget.cleared = true;
        },
        changed() {
          widget.changedCalls += 1;
        },
      };
      widgets.push(widget);
      return widget;
    },
    getScrollInfo: () => ({ top: 46, left: 7 }),
    lineAtHeight: () => 2,
    heightAtLine: (line) => line * 20,
    scrollTo(left, top) {
      scrollCalls.push({ kind: "scrollTo", left, top });
    },
    posFromIndex(offset) {
      const prefix = value.slice(0, Math.max(0, offset));
      const lines = prefix.split("\n");
      return { line: lines.length - 1, ch: lines.at(-1).length };
    },
    setCursor(position) {
      editor.cursor = position;
      selections = [{ anchor: position, head: position }];
    },
    scrollIntoView(range, margin) {
      scrollCalls.push({ kind: "scrollIntoView", range, margin });
    },
    focus() {
      focused = true;
    },
  };
  return editor;
}

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
  assert.equal(typeof bridge.updateInstance, "function");
  assert.equal(typeof bridge.renameInstance, "function");
  assert.equal(typeof bridge.ready?.then, "function");
  assert.equal(typeof windowListeners.get(bridge.importEvent), "function");
  assert.equal(typeof documentListeners.get("DOMContentLoaded"), "function");
});

test("migrates legacy instructions without losing text or authorship and removes skill refs", () => {
  const { normalizeProjectInstructionDocument, parseStoredProjectInstruction } =
    loadAvrFrontendFunctionHooks(["normalizeProjectInstructionDocument", "parseStoredProjectInstruction"]);
  const legacy = { schemaVersion: 1, revision: 7, markdown: "# Светодиод\nPB2",
    skillRefs: [{ id: "legacy", version: "1" }],
    authorship: { schemaVersion: 1, lines: ["human", "ai"], updatedAt: 123 } };
  const canvas = parseStoredProjectInstruction(JSON.stringify(legacy));
  assert.equal(canvas.schemaVersion, 2);
  assert.equal(canvas.markdown, legacy.markdown);
  assert.equal(canvas.revision, 7);
  assert.deepEqual(Array.from(canvas.authorship.lines), ["human", "ai"]);
  assert.equal("skillRefs" in canvas, false);
  assert.equal("target" in normalizeProjectInstructionDocument(null), false);
});

test("keeps annotation answers separate from Markdown and relocates quoted anchors", () => {
  const hooks = loadAvrFrontendFunctionHooks([
    "normalizeProjectInstructionDocument", "resolveCanvasAnnotationLine",
  ]);
  const markdown = "# Проект\n\nМигать светодиодом.";
  const canvas = hooks.normalizeProjectInstructionDocument({ schemaVersion: 2,
    revision: 1, markdown, locale: "ru", target: { mcu: "attiny1624", packageName: "SOIC-14" },
    annotations: [{ id: "q:frequency", kind: "question", anchor: { quote: "Мигать светодиодом.", line: 3 },
      message: "Какая частота?", status: "resolved", answer: "1 Гц" }] });
  assert.equal(canvas.markdown, markdown);
  assert.equal(canvas.annotations[0].answer, "1 Гц");
  assert.equal(canvas.annotations[0].id, "q:frequency");
  assert.equal(hooks.resolveCanvasAnnotationLine(canvas.annotations[0], "Новая строка\n" + markdown), 3);
  assert.equal(hooks.resolveCanvasAnnotationLine(canvas.annotations[0], "# Удалён текст"), null);
  assert.equal(canvas.target.packageName, "SOIC-14");
});

test("rejects a delayed canvas result after a user edit", () => {
  const hooks = loadAvrFrontendFunctionHooks([
    "assertProjectAiInstructionIsFresh",
    "setCanvas(value) { projectInstructionDocument = normalizeProjectInstructionDocument(value); }",
  ]);
  hooks.setCanvas({ schemaVersion: 2, revision: 5, markdown: "Newer edit" });
  assert.throws(() => hooks.assertProjectAiInstructionIsFresh({ canvas: { revision: 4 } }), /newer edits were preserved/i);
  assert.equal(hooks.assertProjectAiInstructionIsFresh({ canvas: { revision: 5 } }), 5);
});

test("infers language again after a manual canvas edit while preserving answers and target", () => {
  const hooks = loadAvrFrontendFunctionHooks([
    "getProjectInstructionSnapshot", "updateProjectInstructionFromUser",
    "setCanvas(value) { projectInstructionDocument = normalizeProjectInstructionDocument(value); }",
  ]);
  hooks.setCanvas({ schemaVersion: 2, revision: 6, markdown: "Мигать", locale: "ru",
    target: { mcu: "attiny1624", packageName: "SOIC-14" },
    annotations: [{ id: "q1", kind: "question", anchor: { quote: "Мигать", line: 1 },
      message: "Как часто?", status: "resolved", answer: "1 секунда" }] });
  hooks.updateProjectInstructionFromUser("Blink the LED", { schemaVersion: 1, lines: ["human"], updatedAt: 123 });
  const canvas = hooks.getProjectInstructionSnapshot();
  assert.equal(canvas.locale, "");
  assert.equal(canvas.revision, 7);
  assert.equal(canvas.target.packageName, "SOIC-14");
  assert.equal(canvas.annotations[0].answer, "1 секунда");
});

test("sends only the canvas and selected target without chat history or skill refs", () => {
  const { document } = parseHTML('<html><body><select id="mcuSelect"><option value="attiny1624" selected>ATtiny1624</option></select><select id="projectPackageSelect"><option value="SOIC-14" selected>SOIC-14</option></select></body></html>');
  const hooks = loadAvrFrontendFunctionHooks([
    "getProjectAiRequestPayload",
    "setCanvas(value) { projectInstructionDocument = normalizeProjectInstructionDocument(value); }",
  ], { document });
  hooks.setCanvas({ schemaVersion: 2, revision: 2, markdown: "Мигать PB2", locale: "ru" });
  const request = hooks.getProjectAiRequestPayload();
  assert.deepEqual(Object.keys(request).sort(), ["canvas", "mcu", "packageName"]);
  assert.equal(request.canvas.markdown, "Мигать PB2");
  assert.equal(request.mcu, "attiny1624");
  assert.equal(request.packageName, "SOIC-14");
  assert.equal("skillRefs" in request.canvas, false);
});

test("replaces chat controls with one canvas action while retaining account and neighboring resizers", () => {
  const html = fs.readFileSync(path.join(__dirname, "../public/avr.html"), "utf8");
  const source = fs.readFileSync(path.join(__dirname, "../public/AVR-Programming.js"), "utf8");
  const { document } = parseHTML(html);
  assert.ok(document.getElementById("projectInstructionEditor"));
  assert.equal(document.querySelectorAll("#projectCanvasForm button[type=submit]").length, 1);
  assert.ok(document.getElementById("projectPackageSelect"));
  for (const id of ["projectAiHistory", "projectAiPrompt", "projectAiChatsBtn", "projectAiChatResizer"]) {
    assert.equal(document.getElementById(id), null, id);
  }
  for (const id of ["fileListResizer", "projectAiColumnResizer", "documentationResizer", "projectAiAccountBtn", "projectAiBudget"]) {
    assert.ok(document.getElementById(id), id);
  }
  assert.ok(source.includes('fetch("/api/avr/ai/canvas"'));
  assert.equal(source.includes('fetch("/api/avr/ai/respond"'), false);
  assert.equal(source.includes("restoreProjectAiChats"), false);
  assert.equal(source.includes("skillRefs"), false);
  assert.ok(source.includes("sourceAuthorship"));
  assert.ok(source.includes("guideAuthorship"));
});

test("streams AI progress events before the final NDJSON result", async () => {
  const { readProjectAiApiResponse } = loadAvrFrontendFunctionHooks([
    "readProjectAiApiResponse",
  ]);
  const encoder = new TextEncoder();
  const chunks = [
    encoder.encode(
      '{"type":"progress","progress":{"schemaVersion":1,"status":"in_progress","stages":[{"id":"generation","status":"completed","attempt":1}]}}\n' +
        '{"type":"progress","progress":{"schemaVersion":1,"status":"in_progress","stages":[{"id":"compilation","status":"in_progress","attempt":1}]}}\n'
    ),
    encoder.encode(
      '{"type":"result","status":200,"data":{"ok":true,"kind":"answer","message":"Ready"}}\n'
    ),
  ];
  let index = 0;
  const response = {
    status: 200,
    headers: {
      get(name) {
        return String(name).toLowerCase() === "content-type"
          ? "application/x-ndjson; charset=utf-8"
          : null;
      },
    },
    body: {
      getReader() {
        return {
          async read() {
            return index < chunks.length
              ? { value: chunks[index++], done: false }
              : { value: undefined, done: true };
          },
          async cancel() {},
        };
      },
    },
  };
  const progressEvents = [];

  const result = await readProjectAiApiResponse(response, (progress) => {
    progressEvents.push(progress);
  });

  assert.equal(result.status, 200);
  assert.equal(result.streamed, true);
  assert.equal(result.data.message, "Ready");
  assert.deepEqual(
    progressEvents.map((progress) => progress.stages[0].id),
    ["generation", "compilation"]
  );
});

test("only exposes Markdown source markers for a focused live editor", () => {
  const { getMarkdownEditorActiveLines } = loadAvrFrontendFunctionHooks([
    "getMarkdownEditorActiveLines",
  ]);
  const unfocused = getMarkdownEditorActiveLines({
    hasFocus: () => false,
    listSelections() {
      throw new Error("unfocused selections must not be treated as active");
    },
  });
  const focused = getMarkdownEditorActiveLines({
    hasFocus: () => true,
    listSelections: () => [
      { anchor: { line: 4 }, head: { line: 2 } },
      { anchor: { line: 7 }, head: { line: 7 } },
    ],
  });

  assert.deepEqual(Array.from(unfocused), []);
  assert.deepEqual(Array.from(focused), [2, 3, 4, 7]);
});

test("renders semantic Markdown widgets without changing CM5 source or page scroll", () => {
  const { document } = parseHTML("<html><body></body></html>");
  const baseRuntime = loadVendoredMarkdownRuntime(document);
  const runtimeCalls = { analyze: 0, renderInto: 0 };
  const runtime = {
    ...baseRuntime,
    analyze(markdown) {
      runtimeCalls.analyze += 1;
      return baseRuntime.analyze(markdown);
    },
    renderInto(target, markdown, options) {
      runtimeCalls.renderInto += 1;
      return baseRuntime.renderInto(target, markdown, options);
    },
  };
  const scheduledFrames = [];
  const fakeWindow = {
    UartDebugMarkdown: runtime,
    requestAnimationFrame(callback) {
      scheduledFrames.push(callback);
      return scheduledFrames.length;
    },
    cancelAnimationFrame() {},
    setTimeout(callback) {
      callback();
      return 1;
    },
  };
  const CodeMirror = {
    registerHelper() {},
    Pos(line, ch) {
      return { line, ch };
    },
  };
  const hooks = loadAvrFrontendFunctionHooks(
    [
      "registerMarkdownLiveEditor",
      "renderMarkdownLivePreviewState",
      "setMarkdownLiveComposition",
    ],
    { document, window: fakeWindow, CodeMirror }
  );
  const markdown = [
    "Before[^note] and again[^note].",
    "",
    "| Pin | Mode |",
    "| --- | --- |",
    "| `PA\\|1` | output \\| safe |",
    "",
    "![Inline](inline.png)",
    "![Reference][HeRo   Image]",
    "![Blocked](blocked.svg)",
    "",
    "[hero image]: reference.png \"Reference title\"",
    "",
    "[^unused]: This unreferenced definition stays in the source.",
    "[^note]: **Rendered** note.",
  ].join("\n");
  const editor = createMarkdownCodeMirrorStub(markdown, document);
  const dataImage = "data:image/png;base64,iVBORw0KGgo=";
  let contextKey = "project-a";
  const state = hooks.registerMarkdownLiveEditor("widget-test", editor, {
    getContextKey: () => contextKey,
    resolveImageUrl: (href) =>
      ["inline.png", "reference.png"].includes(href) ? dataImage : "",
  });

  hooks.renderMarkdownLivePreviewState(state);
  assert.equal(editor.getValue(), markdown);
  assert.deepEqual(runtimeCalls, { analyze: 1, renderInto: 1 });
  assert.equal(state.widgets.filter((widget) => !widget.cleared).length, 2);
  assert.equal(
    state.widgets.filter((widget) => widget.node.querySelector("table")).length,
    1
  );
  assert.equal(
    state.widgets.filter((widget) => widget.node.querySelector(".footnotes"))
      .length,
    1
  );
  const tableCells = state.widgets
    .find((widget) => widget.node.querySelector("table"))
    .node.querySelectorAll("td");
  assert.deepEqual(
    [...tableCells].map((cell) => cell.textContent),
    ["PA|1", "output | safe"]
  );
  const footnoteWidget = state.widgets.find((widget) =>
    widget.node.querySelector(".footnotes")
  );
  assert.equal(footnoteWidget.node.querySelectorAll('[role="doc-endnote"]').length, 1);
  assert.equal(footnoteWidget.node.querySelectorAll('[role="doc-backlink"]').length, 2);
  assert.match(footnoteWidget.node.textContent, /Rendered note/);
  assert.deepEqual(
    Array.from(state.marks, (mark) =>
        mark.options.replacedWith?.querySelector?.('[role="doc-noteref"]')
          ?.textContent
      ).filter(Boolean),
    ["1", "1"]
  );
  const renderedImages = state.marks
    .map((mark) => mark.options.replacedWith?.querySelector?.("img"))
    .filter(Boolean);
  assert.equal(renderedImages.length, 2);
  assert.ok(renderedImages.every((image) => image.getAttribute("src") === dataImage));
  assert.equal(renderedImages[1].getAttribute("title"), "Reference title");
  const imageMark = state.marks.find(
    (mark) => mark.options.replacedWith?.querySelector?.("img") === renderedImages[0]
  );
  renderedImages[0].dispatchEvent(new document.defaultView.Event("load"));
  assert.equal(imageMark.changedCalls, 1);
  assert.deepEqual(editor.scrollCalls.at(-1), {
    kind: "scrollTo",
    left: 7,
    top: 46,
  });
  assert.ok(
    state.marks.some(
      (mark) =>
        mark.options.replacedWith?.classList?.contains(
          "markdown-live-image-fallback"
        ) && mark.options.replacedWith.textContent === "Blocked"
    )
  );

  const analysis = baseRuntime.analyze(markdown);
  const usedDefinition = analysis.blocks.find(
    (block) =>
      block.type === "footnoteDefinition" &&
      markdown.slice(block.start, block.end).startsWith("[^note]")
  );
  const unusedDefinition = analysis.blocks.find(
    (block) =>
      block.type === "footnoteDefinition" &&
      markdown.slice(block.start, block.end).startsWith("[^unused]")
  );
  const collapsedOffsets = state.marks
    .filter((mark) => mark.options.collapsed)
    .map((mark) => [
      markdown.split("\n").slice(0, mark.from.line).join("\n").length +
        (mark.from.line ? 1 : 0) +
        mark.from.ch,
      markdown.split("\n").slice(0, mark.to.line).join("\n").length +
        (mark.to.line ? 1 : 0) +
        mark.to.ch,
    ]);
  assert.ok(
    collapsedOffsets.some(
      ([start, end]) => start === usedDefinition.start && end === usedDefinition.end
    )
  );
  assert.equal(
    collapsedOffsets.some(
      ([start, end]) => start === unusedDefinition.start && end === unusedDefinition.end
    ),
    true
  );

  const firstWidgets = [...state.widgets];
  const staleImageMark = state.marks.find(
    (mark) => mark.options.replacedWith?.querySelector?.("img") === renderedImages[1]
  );
  hooks.renderMarkdownLivePreviewState(state);
  assert.deepEqual(runtimeCalls, { analyze: 1, renderInto: 1 });
  assert.ok(firstWidgets.every((widget) => widget.cleared));
  renderedImages[1].dispatchEvent(new document.defaultView.Event("load"));
  assert.equal(staleImageMark.changedCalls, 0);
  assert.deepEqual(editor.scrollCalls.at(-1), {
    kind: "scrollTo",
    left: 7,
    top: 46,
  });

  contextKey = "project-b";
  hooks.renderMarkdownLivePreviewState(state);
  assert.deepEqual(runtimeCalls, { analyze: 2, renderInto: 2 });

  const footnoteReferences = analysis.inline.filter(
    (entry) => entry.type === "footnoteReference"
  );
  const secondBacklink = state.widgets
    .find((widget) => widget.node.querySelector(".footnotes"))
    .node.querySelectorAll('[role="doc-backlink"]')[1];
  secondBacklink.dispatchEvent(
    new document.defaultView.Event("pointerdown", {
      bubbles: true,
      cancelable: true,
    })
  );
  assert.deepEqual(editor.cursor, editor.posFromIndex(footnoteReferences[1].start));
  editor.setFocused(false);
  editor.setSelections([
    { anchor: { line: 0, ch: 0 }, head: { line: 0, ch: 0 } },
  ]);
  hooks.renderMarkdownLivePreviewState(state);

  const referenceMark = state.marks.find((mark) =>
    mark.options.replacedWith?.querySelector?.('[role="doc-noteref"]')
  );
  const referenceLink = referenceMark.options.replacedWith.querySelector(
    '[role="doc-noteref"]'
  );
  const navigationCountBefore = editor.scrollCalls.filter(
    (entry) => entry.kind === "scrollIntoView"
  ).length;
  referenceLink.dispatchEvent(
    new document.defaultView.Event("pointerdown", {
      bubbles: true,
      cancelable: true,
    })
  );
  assert.deepEqual(editor.cursor, editor.posFromIndex(usedDefinition.start));
  assert.equal(editor.scrollCalls.at(-1).kind, "scrollIntoView");
  const pointerClick = new document.defaultView.Event("click", {
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(pointerClick, "detail", { value: 1 });
  referenceLink.dispatchEvent(pointerClick);
  assert.equal(
    editor.scrollCalls.filter((entry) => entry.kind === "scrollIntoView").length,
    navigationCountBefore + 1
  );

  editor.setFocused(false);
  editor.setSelections([
    { anchor: { line: 0, ch: 0 }, head: { line: 0, ch: 0 } },
  ]);
  hooks.renderMarkdownLivePreviewState(state);
  const tableWidget = state.widgets.find((widget) =>
    widget.node.querySelector("table")
  );
  const tableCell = tableWidget.node.querySelector("td");
  const tableCellOffset = Number(tableCell.getAttribute("data-source-start"));
  tableCell.dispatchEvent(
    new document.defaultView.Event("pointerdown", {
      bubbles: true,
      cancelable: true,
    })
  );
  assert.deepEqual(editor.cursor, editor.posFromIndex(tableCellOffset));

  hooks.renderMarkdownLivePreviewState(state);
  assert.equal(
    state.widgets.some((widget) => widget.node.querySelector("table")),
    false,
    "an active table remains editable Markdown source"
  );
  hooks.setMarkdownLiveComposition("widget-test", true);
  assert.equal(state.widgets.length, 0);
  assert.equal(state.marks.length, 0);
  assert.equal(editor.getValue(), markdown);
});

test("vendored Markdown mode uses a non-ambiguous HTML tag lookahead", () => {
  const markdownMode = fs.readFileSync(
    path.join(
      __dirname,
      "../public/vendor/codemirror/5.65.16/mode/markdown/markdown.js"
    ),
    "utf8"
  );

  assert.match(
    markdownMode,
    /\[a-z\]\[a-z0-9-\]\*\(\?=\[\\s\/>\]\|\$\)/
  );
  assert.doesNotMatch(
    markdownMode,
    /\(\?:\\s\+\[a-z_:\.\\-\]\+\(\?:\\s\*\=\\s\*\[\^>\]\+\)\?\)\*/
  );
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

test("keeps Google AI account controls in an accessible account modal", () => {
  const html = fs.readFileSync(
    path.join(__dirname, "../public/avr.html"),
    "utf8"
  );
  const source = fs.readFileSync(
    path.join(__dirname, "../public/AVR-Programming.js"),
    "utf8"
  );
  const css = fs.readFileSync(
    path.join(__dirname, "../public/AVR-Programming.css"),
    "utf8"
  );

  const headerStart = html.indexOf('id="projectAiHeader"');
  const headerEnd = html.indexOf('id="projectCanvasForm"', headerStart);
  const accountModalStart = html.indexOf('id="projectAiAccountModal"');
  const accountModalEnd = html.indexOf('id="siteDialog"', accountModalStart);
  assert.ok(headerStart >= 0 && headerEnd > headerStart);
  assert.ok(accountModalStart >= 0 && accountModalEnd > accountModalStart);

  const header = html.slice(headerStart, headerEnd);
  const modal = html.slice(accountModalStart, accountModalEnd);
  assert.match(
    header,
    /id="projectAiAccountBtn"[\s\S]*?aria-haspopup="dialog"[\s\S]*?aria-controls="projectAiAccountModal"[\s\S]*?aria-expanded="false"/
  );
  assert.doesNotMatch(header, /id="projectAiChatsBtn"/);
  assert.match(header, /id="projectAiBudget"/);
  assert.doesNotMatch(
    header,
    /project-ai-google-sign-in-asset|id="projectAiPrivacyNote"|id="projectAiAccount"|id="projectAiCredits"|id="projectAiSignOutBtn"/
  );
  assert.match(
    modal,
    /role="dialog"[\s\S]*?aria-modal="true"[\s\S]*?aria-labelledby="projectAiAccountModalTitle"[\s\S]*?hidden/
  );
  assert.match(modal, /id="projectAiAccountCard"[\s\S]*?tabindex="-1"/);
  assert.match(modal, /id="projectAiAccountCloseBtn"/);
  assert.match(modal, /id="projectAiAccountStatus"[\s\S]*?role="status"/);
  for (const requiredControl of [
    "project-ai-google-sign-in-asset",
    'id="projectAiPrivacyNote"',
    'id="projectAiAccount"',
    'id="projectAiCredits"',
    'id="projectAiSignOutBtn"',
  ]) {
    assert.ok(
      modal.includes(requiredControl),
      `account modal is missing ${requiredControl}`
    );
  }

  const openStart = source.indexOf("function openProjectAiAccountModal()");
  const closeStart = source.indexOf(
    "function closeProjectAiAccountModal",
    openStart
  );
  const renderStart = source.indexOf(
    "function renderProjectAiAuthSession",
    closeStart
  );
  assert.ok(openStart >= 0 && closeStart > openStart && renderStart > closeStart);
  const openSource = source.slice(openStart, closeStart);
  const closeSource = source.slice(closeStart, renderStart);
  assert.match(openSource, /modal\.hidden = false/);
  assert.match(openSource, /trigger\.setAttribute\("aria-expanded", "true"\)/);
  assert.match(
    openSource,
    /const focusTarget = signIn && !signIn\.hidden \? signIn : card/
  );
  assert.match(openSource, /focusTarget\.focus\(\{ preventScroll: true \}\)/);
  assert.match(closeSource, /modal\.hidden = true/);
  assert.match(closeSource, /trigger\.setAttribute\("aria-expanded", "false"\)/);
  assert.match(closeSource, /trigger\.focus\(\{ preventScroll: true \}\)/);
  assert.match(
    source,
    /projectAiAccountBtn &&[\s\S]*?projectAiAccountBtn\.addEventListener\("click", openProjectAiAccountModal\)/
  );
  assert.match(
    source,
    /projectAiAccountCloseBtn &&[\s\S]*?projectAiAccountCloseBtn\.addEventListener\([\s\S]*?"click",[\s\S]*?closeProjectAiAccountModal/
  );
  assert.match(
    source,
    /if \(event\.target === projectAiAccountModal\) \{\s*closeProjectAiAccountModal\(\);\s*\}/
  );
  assert.match(
    source,
    /if \(e\.key === "Escape"\) \{[\s\S]*?if \(projectAiAccountModal && !projectAiAccountModal\.hidden\) \{\s*closeProjectAiAccountModal\(\);\s*return;/
  );
  assert.match(source, /function trapProjectAiAccountFocus\(event\)/);
  assert.match(
    source,
    /document\.addEventListener\("keydown", \(e\) => \{\s*if \(trapProjectAiAccountFocus\(e\)\) return;/
  );
  assert.match(
    source,
    /projectAiAuthSession = \{\s*mode: "google",\s*configured: true,\s*authenticated: false,\s*quota: null,\s*\};\s*resetProjectAiAccountWorkspaceRuntime\(\);\s*renderProjectAiAuthSession\(projectAiAuthSession\);/
  );
  assert.match(source, /setProjectAiAccountStatus\(message, "error"\)/);
  assert.match(
    css,
    /\.project-ai-account-modal\s*\{[\s\S]*?backdrop-filter:\s*blur\(8px\);/
  );
  assert.match(
    css,
    /\.project-ai-account-card\s*\{[\s\S]*?width:\s*min\(100%, 520px\);[\s\S]*?background:\s*var\(--avr-window-bg\);/
  );
  assert.match(
    css,
    /\.project-ai-google-sign-in\s*\{[\s\S]*?width:\s*100%;[\s\S]*?background:\s*rgba\(39, 174, 96, 0\.1\);/
  );
  assert.match(
    css,
    /\.project-ai-account-status\[data-tone="error"\]\s*\{[\s\S]*?color:\s*#ffe0aa;/
  );
});

test("keeps only technical AI concurrency safeguards", () => {
  const serverSource = fs.readFileSync(
    path.join(__dirname, "../backend/ai-server.js"),
    "utf8"
  );
  const serviceUnit = fs.readFileSync(
    path.join(__dirname, "../backend/deploy/uartdebug-ai.service"),
    "utf8"
  );
  const nginxLocation = fs.readFileSync(
    path.join(__dirname, "../backend/deploy/nginx-avr-ai-location.conf"),
    "utf8"
  );
  const oauthCallbackLocation = fs.readFileSync(
    path.join(
      __dirname,
      "../backend/deploy/nginx-avr-ai-oauth-callback-location.conf"
    ),
    "utf8"
  );
  const oauthLogRedaction = fs.readFileSync(
    path.join(
      __dirname,
      "../backend/deploy/redact-oauth-callback-logging.sh"
    ),
    "utf8"
  );
  const nginxCleanup = fs.readFileSync(
    path.join(__dirname, "../backend/deploy/remove-ai-request-limits.sh"),
    "utf8"
  );
  const deployWorkflow = fs.readFileSync(
    path.join(__dirname, "../.github/workflows/deploy.yml"),
    "utf8"
  );

  assert.doesNotMatch(serverSource, /AI_(?:RATE|DAILY)_/);
  assert.doesNotMatch(serviceUnit, /AI_(?:RATE|DAILY)_/);
  assert.doesNotMatch(nginxLocation, /^\s*limit_req\s/m);
  assert.match(nginxLocation, /^\s*limit_conn\s+uartdebug_conn_per_ip\s+2;/m);
  assert.match(
    oauthCallbackLocation,
    /location = \/api\/avr\/ai\/auth\/google\/callback\s*\{[\s\S]*?access_log off;/
  );
  assert.match(oauthLogRedaction, /BEGIN uartdebug-ai-oauth-callback/);
  assert.match(oauthLogRedaction, /unmanaged exact OAuth callback location/);
  assert.match(serverSource, /AI_MAX_CONCURRENT/);
  assert.match(nginxCleanup, /zone=uartdebug_ai_per_ip/);
  assert.match(
    deployWorkflow,
    /run_sudo \/bin\/bash[\s\\\n]+"\$\{BE_SRC\}\/deploy\/remove-ai-request-limits\.sh"/
  );
  assert.match(
    deployWorkflow,
    /run_sudo \/bin\/bash[\s\\\n]+"\$\{BE_SRC\}\/deploy\/redact-oauth-callback-logging\.sh"/
  );
  assert.match(deployWorkflow, /run_sudo nginx -t/);
});

test("installs the release AI unit before restarting the service", () => {
  const deployWorkflow = fs.readFileSync(
    path.join(__dirname, "../.github/workflows/deploy.yml"),
    "utf8"
  );
  const verifyUnit = deployWorkflow.indexOf(
    'run_sudo systemd-analyze verify "${ai_unit_template}"'
  );
  const installUnit = deployWorkflow.indexOf(
    "run_sudo install -o root -g root -m 0644",
    verifyUnit
  );
  const unitTarget = deployWorkflow.indexOf(
    "/etc/systemd/system/uartdebug-ai.service",
    installUnit
  );
  const daemonReload = deployWorkflow.indexOf(
    "run_sudo systemctl daemon-reload",
    unitTarget
  );
  const restart = deployWorkflow.indexOf(
    "run_sudo systemctl restart uartdebug-ai.service",
    daemonReload
  );

  assert.ok(verifyUnit >= 0, "the release unit must be verified before install");
  assert.ok(installUnit > verifyUnit, "the deployed release must install its AI unit");
  assert.ok(unitTarget > installUnit);
  assert.ok(daemonReload > unitTarget);
  assert.ok(restart > daemonReload);
  assert.match(
    deployWorkflow,
    /elif \[ -z "\$\{ROLLBACK\}" \]; then\s+echo "Missing AI service unit in \$\{BE_DIR\}"\s+exit 1/
  );
});

test("scopes the AI credential umask to secret generation", () => {
  const installer = fs.readFileSync(
    path.join(__dirname, "../backend/deploy/install-ai-service.sh"),
    "utf8"
  );

  assert.match(
    installer,
    /\(\s*umask 0077\s*openssl rand -hex 32 > "\$\{credential_path\}"\s*\)/
  );
});

test("installs OAuth callback log redaction idempotently", (t) => {
  const bash =
    process.platform === "win32"
      ? "C:\\Program Files\\Git\\bin\\bash.exe"
      : "bash";
  if (process.platform === "win32" && !fs.existsSync(bash)) {
    t.skip("Git Bash is not installed");
    return;
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "uartdebug-nginx-"));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const siteFile = path.join(tempRoot, "uartdebug.com");
  const scriptFile = path.join(
    __dirname,
    "../backend/deploy/redact-oauth-callback-logging.sh"
  );
  const snippetFile = path.join(
    __dirname,
    "../backend/deploy/nginx-avr-ai-oauth-callback-location.conf"
  );
  fs.writeFileSync(
    siteFile,
    [
      "server {",
      "    location ^~ /api/avr/ai/ {",
      "        proxy_pass http://127.0.0.1:8083;",
      "    }",
      "}",
      "",
    ].join("\n")
  );

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = childProcess.spawnSync(
      bash,
      [scriptFile, siteFile, snippetFile],
      { encoding: "utf8" }
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
  }

  const migrated = fs.readFileSync(siteFile, "utf8");
  assert.equal(
    (migrated.match(/location = \/api\/avr\/ai\/auth\/google\/callback/g) || [])
      .length,
    1
  );
  assert.match(migrated, /access_log off;/);
  assert.match(migrated, /location \^~ \/api\/avr\/ai\//);
});

test("deploys the local AVR knowledge package instead of the old skill catalog", () => {
  const installer = fs.readFileSync(
    path.join(__dirname, "../backend/deploy/install-ai-service.sh"),
    "utf8"
  );

  assert.match(installer, /loadKnowledge/);
  assert.match(installer, /ai\/knowledge/);
  assert.doesNotMatch(installer, /loadAiSkillCatalog/);
});

test("gives Add file enough width and lets catalog text wrap", () => {
  const css = fs.readFileSync(
    path.join(__dirname, "../public/AVR-Programming.css"),
    "utf8"
  );

  assert.match(
    css,
    /\.file-add-dialog\s*\{[\s\S]*?width:\s*min\(96vw,\s*1100px\);/
  );
  assert.match(
    css,
    /\.file-template-card\s*\{[\s\S]*?grid-template-columns:\s*minmax\(250px,\s*0\.42fr\)\s*minmax\(0,\s*1fr\);/
  );
  assert.match(
    css,
    /\.file-template-card \.file-add-card-title,[\s\S]*?\.file-template-card \.file-add-card-copy\s*\{[\s\S]*?overflow-wrap:\s*anywhere;[\s\S]*?white-space:\s*normal;/
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
  assert.match(source, /function getCanvasTarget/);
  assert.match(source, /getDetectedTargetKey/);
});

test("snaps the guide pane and resolves one shared AVR side-panel budget", () => {
  const css = fs.readFileSync(
    path.join(__dirname, "../public/AVR-Programming.css"),
    "utf8"
  );
  const source = fs.readFileSync(
    path.join(__dirname, "../public/AVR-Programming.js"),
    "utf8"
  );

  assert.match(
    source,
    /const WORKSPACE_PANEL_COMPACT_WIDTH\s*=\s*62;/
  );
  assert.match(
    source,
    /const WORKSPACE_PANEL_COMPACT_THRESHOLD\s*=\s*112;/
  );
  assert.match(
    source,
    /documentationExpandedMinWidth\s*=\s*Math\.max\([\s\S]*?panelChrome\s*\+[\s\S]*?controlsWidth/
  );
  assert.doesNotMatch(source, /halfSplitWidth/);
  assert.doesNotMatch(source, /availableDocumentationWidth\s*\/\s*2/);
  assert.match(source, /OUTLINER_EDITOR_MIN_WIDTH\s*=\s*500/);
  assert.match(
    css,
    /--editor-workspace-min-width:\s*500px;[\s\S]*?minmax\(var\(--editor-workspace-min-width\), 1fr\)/
  );
  assert.match(css, /--documentation-compact-width:\s*62px;/);
  assert.match(
    css,
    /minmax\(var\(--documentation-compact-width\), var\(--documentation-width\)\)/
  );
  assert.match(
    css,
    /\.canvas-split-container\.is-documentation-compact\s*\{[\s\S]*?--documentation-width:\s*var\(--documentation-compact-width\);/
  );
  assert.match(
    css,
    /\.canvas-split-container\.is-documentation-compact[\s\S]*?\.project-documentation-panel\s*> \*\s*\{[\s\S]*?display:\s*none !important;/
  );
  assert.match(
    css,
    /\.canvas-split-container\.is-documentation-compact[\s\S]*?\.project-documentation-panel::before\s*\{[\s\S]*?content:\s*"D\\A O\\A C\\A U\\A M\\A E\\A N\\A T\\A A\\A T\\A I\\A O\\A N";/
  );
  assert.match(
    css,
    /\.editor-workspace > \.avr-action-strip\s*\{[\s\S]*?flex-wrap:\s*nowrap;[\s\S]*?gap:\s*8px;/
  );
  assert.doesNotMatch(source, /OUTLINER_MAX_WIDTH|DOCUMENTATION_MAX_WIDTH/);
  assert.doesNotMatch(
    source,
    /PROJECT_AI_CHAT_MAX_WIDTH|PROJECT_AI_SKILLS_MAX_WIDTH/
  );
  assert.match(
    source,
    /function getDocumentationMinWidth\(\)[\s\S]*?strip\.children[\s\S]*?controlsWidth[\s\S]*?horizontalPadding/
  );
  assert.doesNotMatch(
    source,
    /function getDocumentationMinWidth\(\)[\s\S]{0,900}?strip\.scrollWidth/
  );
});

const workspacePanelSpecs = [
  { min: 180, compact: 62 },
  { min: 238, compact: 62 },
  { min: 500 },
  { min: 267, compact: 62 },
];

test("resizes only the adjacent pair and stops at its minimum widths", () => {
  const { resizeWorkspacePanels } = loadAvrFrontendFunctionHooks(["resizeWorkspacePanels"]);
  const start = [305, 318, 539, 360];
  const resize = (index, width) => Array.from(resizeWorkspacePanels(start, workspacePanelSpecs, index, width));
  assert.deepEqual(resize(0, 285), [285, 338, 539, 360]);
  assert.deepEqual(resize(0, 405), [385, 238, 539, 360]);
  assert.deepEqual(resize(0, 455), [385, 238, 539, 360]);
  assert.deepEqual(resize(1, 418), [305, 357, 500, 360]);
  assert.deepEqual(resize(3, 460), [305, 318, 500, 399]);
  assert.deepEqual(start, [305, 318, 539, 360], "drag snapshots must remain immutable");
});

test("all side columns snap without intermediate invalid widths and reopen", () => {
  const { resizeWorkspacePanels } = loadAvrFrontendFunctionHooks(["resizeWorkspacePanels"]);
  const start = [305, 318, 539, 360];
  for (const index of [0, 1, 3]) {
    assert.equal(resizeWorkspacePanels(start, workspacePanelSpecs, index, 113)[index], workspacePanelSpecs[index].min);
    const collapsed = resizeWorkspacePanels(start, workspacePanelSpecs, index, 112);
    assert.equal(collapsed[index], 62);
    const restored = resizeWorkspacePanels(collapsed, workspacePanelSpecs, index, workspacePanelSpecs[index].min);
    assert.equal(restored[index], workspacePanelSpecs[index].min);
  }
});

test("workspace resizing conserves space and minima across viewport and drag extremes", () => {
  const { resizeWorkspacePanels, fitWorkspaceWidths } = loadAvrFrontendFunctionHooks([
    "resizeWorkspacePanels", "fitWorkspaceWidths",
  ]);
  const valid = (widths, budget) => {
    assert.equal(widths.reduce((sum, width) => sum + width, 0), budget);
    widths.forEach((width, i) => assert.ok(
      Number.isFinite(width) && (width === workspacePanelSpecs[i].compact || width >= workspacePanelSpecs[i].min),
      `panel ${i}: invalid ${width} in ${widths}`
    ));
  };
  for (const budget of [686, 964, 1000, 1202, 1522, 2200]) {
    for (const preferred of [[305, 318, 500, 360], [62, 62, 500, 62], [1600, 900, 500, 1500]]) {
      const start = fitWorkspaceWidths(preferred, budget, workspacePanelSpecs);
      valid(start, budget);
      for (const index of [0, 1, 3]) {
        let previous = 0;
        for (let requested = -100; requested <= budget + 400; requested += 7) {
          const widths = resizeWorkspacePanels(start, workspacePanelSpecs, index, requested);
          valid(widths, budget);
          for (let i = 0; i < widths.length; i++) {
            if (i !== index && i !== (index === 0 ? 1 : 2)) {
              assert.equal(widths[i], start[i], "a divider must not resize unrelated panels");
            }
          }
          assert.ok(widths[index] >= previous, "one-way dragging must never reverse the resized panel");
          previous = widths[index];
        }
      }
    }
  }
});

test("shared pointer handling ignores other pointers and completes once on capture loss", () => {
  const listeners = new Map(), classes = new Set(), bodyClasses = new Set(), moves = [];
  const classList = set => ({ add: value => set.add(value), remove: value => set.delete(value) });
  let captured = null, finishes = 0;
  const handle = {
    classList: classList(classes),
    addEventListener: (name, callback) => listeners.set(name, callback),
    focus() {},
    setPointerCapture: id => { captured = id; },
    hasPointerCapture: id => captured === id,
    releasePointerCapture: () => { captured = null; },
  };
  const document = { addEventListener() {}, body: { classList: classList(bodyClasses) } };
  const { bindSplitResizer } = loadAvrFrontendFunctionHooks(["bindSplitResizer"], { document });
  bindSplitResizer(handle, {
    axis: "x", start: () => 300, move: (delta, width) => moves.push(width + delta),
    finish: () => finishes++,
  });
  const event = (pointerId, clientX) => ({ pointerId, clientX, button: 0, preventDefault() {} });
  listeners.get("pointerdown")(event(1, 100));
  listeners.get("pointermove")(event(2, 150));
  listeners.get("pointerup")(event(2, 150));
  assert.equal(finishes, 0);
  listeners.get("pointermove")(event(1, 140));
  assert.deepEqual(moves, [340]);
  assert.ok(bodyClasses.has("is-column-resizing"));
  listeners.get("lostpointercapture")(event(1, 140));
  listeners.get("pointerup")(event(1, 140));
  assert.equal(finishes, 1);
  assert.equal(classes.size, 0);
  assert.equal(bodyClasses.size, 0);
});

test("uses one CommonMark GFM runtime across every Markdown surface", () => {
  const html = fs.readFileSync(
    path.join(__dirname, "../public/avr.html"),
    "utf8"
  );
  const source = fs.readFileSync(
    path.join(__dirname, "../public/AVR-Programming.js"),
    "utf8"
  );
  const css = fs.readFileSync(
    path.join(__dirname, "../public/AVR-Programming.css"),
    "utf8"
  );
  const sw = fs.readFileSync(path.join(__dirname, "../public/sw.js"), "utf8");
  const runtimeIndex = html.indexOf("vendor/uartdebug-markdown.js");
  const avrIndex = html.indexOf("AVR-Programming.js");

  assert.ok(runtimeIndex >= 0 && runtimeIndex < avrIndex);
  assert.match(sw, /\/vendor\/uartdebug-markdown\.js/);
  assert.match(
    html,
    /id="documentationEditToggle"[\s\S]*?aria-pressed="false"[\s\S]*?>\s*Edit\s*<\/button>/
  );
  assert.match(
    html,
    /id="projectDocumentationEditor"[\s\S]*?aria-readonly="true"[\s\S]*?readonly/
  );
  assert.match(
    html,
    /project-documentation-scroll project-documentation-live-editor markdown-live-editor[\s\S]*?id="projectDocumentationScroll"[\s\S]*?id="projectDocumentationEditor"/
  );
  assert.match(html, /editor-surface markdown-live-editor/);
  assert.match(source, /window\.UartDebugMarkdown\?\.analyze/);
  assert.match(source, /markdownRuntime\?\.renderInto/);
  assert.match(source, /markdownRuntime\?\.analyze/);
  assert.match(source, /registerMarkdownLiveEditor\("instruction"/);
  assert.match(source, /registerMarkdownLiveEditor\("documentation"/);
  assert.match(source, /registerMarkdownLiveEditor\("editor"/);
  assert.match(
    source,
    /function bindDocumentationWorkspace\(\)[\s\S]*?CodeMirror\.fromTextArea\(editorElement,[\s\S]*?readOnly:\s*true,/
  );
  assert.match(
    source,
    /function setDocumentationEditMode\(editing\)[\s\S]*?documentationEditMode\s*=\s*nextMode;[\s\S]*?refreshDocumentationPane\(\{ preserveScroll: true \}\)/
  );
  assert.match(
    source,
    /if \(documentationEditMode\) \{[\s\S]*?content\.hidden = true;[\s\S]*?wrapper\?\.removeAttribute\("hidden"\);[\s\S]*?setOption\("readOnly", false\)[\s\S]*?renderMarkdownGuide\(markdown, context\)/
  );
  assert.match(
    source,
    /markdownEditor\.readOnly = true;[\s\S]*?setOption\("readOnly", true\)[\s\S]*?wrapper\?\.setAttribute\("hidden", ""\);[\s\S]*?content\.hidden = false;[\s\S]*?renderMarkdownGuide\(markdown, context\)/
  );
  assert.match(
    source,
    /function navigateToDocumentationHeading\(marker\)[\s\S]*?setDocumentationEditMode\(false\)[\s\S]*?documentationRenderedHeadingIndex\.get\(targetKey\)[\s\S]*?target instanceof Element[\s\S]*?scrollDocumentationTargetIntoView\(target\)/
  );
  assert.match(
    source,
    /renderMarkdownInto\([\s\S]*?documentationRenderedHeadingIndex = new Map\(\)[\s\S]*?documentationRenderedHeadingIndex\.set\(indexKey, element\)/
  );
  assert.match(
    source,
    /scroll\.classList\.add\("is-documentation-edit"\)[\s\S]*?scroll\.classList\.remove\("is-documentation-edit"\)/
  );
  assert.match(
    css,
    /\.project-documentation-scroll\.is-documentation-edit\s*\{[\s\S]*?overflow:\s*hidden;/
  );
  assert.match(
    css,
    /\.project-documentation-live-editor\.is-documentation-edit\s*\{[\s\S]*?overflow:\s*hidden;/
  );
  assert.doesNotMatch(
    css,
    /\.project-documentation-live-editor\s*\{[\s\S]*?overflow:\s*hidden;/
  );
  assert.match(
    source,
    /documentationEditToggle\.addEventListener\("click", \(\) => \{[\s\S]*?setDocumentationEditMode\(!documentationEditMode\)/
  );
  assert.match(source, /getMarkdownLiveRenderedElement\(cache, node, "table"\)/);
  assert.match(source, /\["image", "imageReference"\]\.includes\(node\.type\)/);
  assert.match(source, /node\.type === "footnoteReference"/);
  assert.match(source, /addMarkdownLiveFootnotesWidget/);
  assert.match(source, /instead of presenting a second, incompatible interpretation/);
  assert.match(source, /childEnd\.ch < end\.ch/);
});

test("uses a full-width three-stage draggable device-panel separator", () => {
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
  const viewportStart = html.indexOf('id="avrDevicePanelViewport"');
  const persistentToggle = html.indexOf('id="devicePanelToggle"');

  assert.ok(viewportStart >= 0);
  assert.ok(persistentToggle > viewportStart);
  assert.match(html, /id="avrDeviceSection"[\s\S]*data-state="expanded"/);
  assert.match(
    html,
    /class="split-resizer device-panel-resizer"[\s\S]*?id="devicePanelToggle"[\s\S]*?role="separator"[\s\S]*?aria-orientation="horizontal"/
  );
  assert.doesNotMatch(html, /devicePanelHoverToggle|device-panel-toggle-arrow/);
  assert.match(
    css,
    /\.avr-device-panel-viewport\s*\{[\s\S]*?height:\s*var\(--device-panel-height\);/
  );
  assert.match(css, /--device-panel-height:\s*112px;/);
  assert.match(
    html,
    /id="devicePanelToggle"[\s\S]*?aria-valuemax="112"[\s\S]*?aria-valuenow="112"/
  );
  assert.match(
    css,
    /\.split-resizer\.device-panel-resizer\s*\{[\s\S]*?width:\s*100%;[\s\S]*?cursor:\s*row-resize;/
  );
  assert.match(
    css,
    /\.split-resizer\[aria-orientation="horizontal"\]::before\s*\{[\s\S]*?width:\s*58px;[\s\S]*?height:\s*2px;/
  );
  assert.doesNotMatch(css, /device-panel-toggle-arrow::after/);
  assert.match(
    css,
    /data-state="compact"[\s\S]*?\.detect-chip-btn\s*\{[\s\S]*?height:\s*36px;[\s\S]*?padding:\s*0;/
  );
  assert.match(
    css,
    /data-state="compact"[\s\S]*?\.detect-chip-label\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?inset:\s*0;[\s\S]*?display:\s*flex;[\s\S]*?align-items:\s*center;[\s\S]*?justify-content:\s*center;/
  );
  assert.match(
    css,
    /data-state="compact"[\s\S]*?\.avr-status-value\s*\{[\s\S]*?height:\s*36px;[\s\S]*?min-height:\s*36px;/
  );
  assert.match(
    css,
    /\.feature-panel:has\(\s*> \.canvas-section > \.avr-device-section\[data-state="collapsed"\]\s*\)\s*\{\s*padding-top:\s*0;/
  );
  assert.match(
    source,
    /STORAGE_DEVICE_PANEL_STATE\s*=\s*\n\s*"ud_avr_programming_device_panel_state_v2"/
  );
  assert.match(source, /const states = \["collapsed", "compact", "expanded"\]/);
  assert.match(source, /DEVICE_PANEL_EXPANDED_HEIGHT\s*=\s*112/);
  assert.match(source, /DEVICE_PANEL_COMPACT_HEIGHT\s*=\s*54/);
  assert.match(source, /DEVICE_PANEL_COLLAPSED_HEIGHT\s*=\s*0/);
  assert.match(source, /DEVICE_PANEL_DRAG_THRESHOLD\s*=\s*48/);
  assert.match(source, /function getAdjacentDevicePanelState\(state, direction\)/);
  assert.match(source, /lostpointercapture/);
  assert.match(source, /if \(collapsed\) viewport\.setAttribute\("inert", ""\)/);
  assert.match(source, /restoreDevicePanelState\(\)/);
});

test("publishes legal pages and links them to Google sign-in", () => {
  const index = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
  const avr = fs.readFileSync(path.join(__dirname, "../public/avr.html"), "utf8");
  const privacy = fs.readFileSync(
    path.join(__dirname, "../public/privacy.html"),
    "utf8"
  );
  const terms = fs.readFileSync(
    path.join(__dirname, "../public/terms.html"),
    "utf8"
  );
  const sw = fs.readFileSync(path.join(__dirname, "../public/sw.js"), "utf8");

  assert.match(index, /href="\/privacy"/);
  assert.match(index, /href="\/terms"/);
  assert.match(avr, /id="projectAiPrivacyNote"[\s\S]*?href="\/privacy"/);
  assert.match(
    avr,
    /id="projectAiSignInBtn"[\s\S]*?icons\/sign-in-with-google-light\.svg/
  );
  assert.match(avr, /shared free AI-credit[\s\S]*?Google identity data is not sent/);
  assert.match(privacy, /Privacy Policy[\s\S]*?Google sign-in[\s\S]*?OpenAI/);
  assert.match(privacy, /stable pseudonymous browser safety identifier/);
  assert.match(privacy, /uartdebug@gmail\.com/);
  assert.match(terms, /Terms of Service[\s\S]*?AI Credits[\s\S]*?hardware/);
  for (const route of ["/privacy", "/privacy.html", "/terms", "/terms.html"]) {
    assert.ok(sw.includes(`"${route}"`), `service worker is missing ${route}`);
  }
  assert.match(sw, /icons\/sign-in-with-google-light\.svg/);
  assert.match(index, /optional AI assistant[\s\S]*?Google sign-in is required only/);
  assert.match(
    index,
    /<\/main>[\s\S]*?<footer class="home-footer">[\s\S]*?<p class="service-note">/
  );
  assert.match(
    index,
    /aria-label="Contacts"[\s\S]*?href="mailto:uartdebug@gmail\.com"[\s\S]*?href="https:\/\/github\.com\/K1LLERV1PV2\/uartdebug\/issues"/
  );
  assert.match(
    index,
    /body\s*\{[\s\S]*?display:\s*flex;[\s\S]*?min-height:\s*100vh;[\s\S]*?flex-direction:\s*column;/
  );
  assert.match(
    index,
    /\.home-footer\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) auto;/
  );
});

test("deploy verifies legal page content rather than accepting an SPA fallback", () => {
  const workflow = fs.readFileSync(
    path.join(__dirname, "../.github/workflows/deploy.yml"),
    "utf8"
  );
  const legalCheck = fs.readFileSync(
    path.join(__dirname, "../backend/deploy/check-legal-pages.sh"),
    "utf8"
  );

  assert.match(workflow, /check-legal-pages\.sh/);
  assert.match(legalCheck, /for legal_route in privacy terms/);
  assert.match(
    legalCheck,
    /rel=\\"canonical\\" href=\\"https:\/\/uartdebug\.com\/\$\{legal_route\}\\"/
  );
  assert.match(legalCheck, /<title>\$\{expected_title\}/);
  assert.match(workflow, /smoke-ai-service\.sh/);

  const remoteScript = workflow.match(
    /          script: \|\r?\n([\s\S]*?)\r?\n      - name: Cleanup temp on server/
  );
  assert.ok(remoteScript, "remote deploy script block is missing");
  const evaluatedInput = remoteScript[1]
    .split(/\r?\n/)
    .map((line) => line.replace(/^ {12}/, ""))
    .join("\n");
  assert.ok(
    evaluatedInput.length < 18000,
    `remote deploy action input is too close to GitHub's 21000-character expression limit: ${evaluatedInput.length}`
  );
  assert.match(workflow, /Upload remote deploy helpers/);
  assert.match(workflow, /remote-deploy-helpers\.sh/);
  assert.match(workflow, /\. "\$\{deploy_helpers\}"/);
});

test("deploy revisions AVR script and stylesheet URLs for returning browsers", () => {
  const stampScript = fs.readFileSync(
    path.join(__dirname, "../.github/scripts/stamp_frontend_build.py"),
    "utf8"
  );

  assert.match(
    stampScript,
    /revisioned_page_assets\s*=\s*\[[\s\S]*?"AVR-Programming\.css"[\s\S]*?"AVR-Programming\.js"[\s\S]*?"vendor\/uartdebug-markdown\.js"/
  );
  assert.match(
    stampScript,
    /\(\?P<prefix>\\b\(\?:href\|src\)/
  );
  assert.match(
    stampScript,
    /for asset_url, pattern, replacement in revisioned_page_asset_patterns:[\s\S]*?pattern\.subn\(replacement, html_text\)/
  );
  assert.match(
    stampScript,
    /if count != 1[\s\S]*?Expected exactly one HTML reference for each revisioned page asset/
  );
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

test("renders every built-in card from its catalog and default guide", () => {
  const html = fs.readFileSync(
    path.join(__dirname, "../public/avr.html"),
    "utf8"
  );
  const source = fs.readFileSync(
    path.join(__dirname, "../public/AVR-Programming.js"),
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
  const templateGridStart = html.indexOf('id="fileTemplateGrid"');
  const templateGridEnd = html.indexOf("</div>", templateGridStart);
  const templateGridMarkup = html.slice(templateGridStart, templateGridEnd);

  assert.ok(templateGridStart >= 0);
  assert.doesNotMatch(templateGridMarkup, /data-template-id|file-add-card-copy/);
  assert.match(source, /function renderBuiltInMiniProjectCards\(\)/);
  assert.match(
    source,
    /title\.textContent\s*=\s*String\(descriptor\.displayName\s*\|\|\s*descriptor\.id\)/
  );
  assert.match(
    source,
    /copy\.textContent\s*=\s*description/
  );
  assert.doesNotMatch(source, /copy\.innerHTML/);
  assert.doesNotMatch(source, /summary:\s*descriptor\.summary/);
  assert.deepEqual(
    publicCatalog.projects.map((entry) => entry.id),
    [
      "01_Minimum",
      "02_CPU_Clock",
      "03_Delay-Based_Blink",
      "04_Timer_Interrupt_Blink",
      "05_UART_Basic_Transmission",
      "06_UART_Basic_Receive",
      "07_Printf_Redirect_USART0",
      "08_Printf_Redirect_USART1",
      "09_UART0_Interrupt_Transmission",
      "10_UART1_Interrupt_Transmission",
    ]
  );

  for (const project of publicCatalog.projects) {
    const privateReference = privateCatalog.projects.find(
      (entry) => entry.id === project.id
    );
    assert.equal(project.aiSpecRef, undefined);
    assert.ok(privateReference, `missing private AI reference for ${project.id}`);

    const sourcePath = path.join(
      __dirname,
      "../public",
      project.source.url.replace(/^\/+/, "")
    );
    const aiPath = path.join(
      __dirname,
      "../backend/ai/mini-projects",
      privateReference.file
    );
    assert.ok(fs.existsSync(sourcePath), sourcePath);
    assert.ok(fs.existsSync(aiPath), aiPath);
    const defaultGuide =
      project.guides.find(
        (guide) =>
          String(guide.locale || "").toLowerCase() ===
          String(project.defaultLocale || "").toLowerCase()
      ) || project.guides[0];
    const defaultGuidePath = path.join(
      __dirname,
      "../public",
      defaultGuide.url.replace(/^\/+/, "")
    );
    const extractedDescription = core.extractShortProjectDescription(
      fs.readFileSync(defaultGuidePath, "utf8")
    );
    assert.ok(
      extractedDescription,
      `${project.id}: missing Short Project Description in the default guide`
    );
    if (Object.hasOwn(project, "summary")) {
      assert.equal(project.summary, extractedDescription);
    }
    assert.equal(
      crypto.createHash("sha256").update(fs.readFileSync(aiPath)).digest("hex"),
      privateReference.sha256
    );
    assert.ok(sw.includes(project.source.url));

    const markers = extractDocumentationMarkers(
      fs.readFileSync(sourcePath, "utf8")
    );
    for (const guide of project.guides) {
      const guidePath = path.join(
        __dirname,
        "../public",
        guide.url.replace(/^\/+/, "")
      );
      assert.ok(fs.existsSync(guidePath), guidePath);
      assert.ok(sw.includes(guide.url), `${guide.url}: missing from service worker`);

      const guideMarkdown = fs.readFileSync(guidePath, "utf8");
      const headings = new Set(
        extractMarkdownHeadings(guideMarkdown).map((heading) => heading.key)
      );
      for (const marker of markers) {
        assert.ok(
          headings.has(marker.key),
          `${project.id}/${guide.locale}: ${marker.key}`
        );
      }

      for (const image of guideMarkdown.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)) {
        const assetUrl = new URL(
          image[1],
          new URL(guide.assetBaseUrl || guide.url, "https://uartdebug.test")
        ).pathname;
        const assetPath = path.join(
          __dirname,
          "../public",
          decodeURIComponent(assetUrl).replace(/^\/+/, "")
        );
        assert.ok(fs.existsSync(assetPath), assetPath);
        assert.ok(sw.includes(assetUrl), `${assetUrl}: missing from service worker`);
      }
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
