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

test("truncates an edited AI-chat branch before resubmission", () => {
  const { truncateProjectAiMessageBranchForEdit } =
    loadAvrFrontendFunctionHooks(["truncateProjectAiMessageBranchForEdit"]);
  const userMessage = {
    id: "message-user",
    role: "user",
    content: "old request",
    createdAt: 100,
  };
  const chat = {
    id: "chat-one",
    updatedAt: 300,
    messages: [
      { id: "message-before", role: "assistant", content: "context" },
      userMessage,
      { id: "message-stale", role: "assistant", content: "stale answer" },
      { id: "message-after", role: "user", content: "stale follow-up" },
    ],
  };

  const edited = truncateProjectAiMessageBranchForEdit(
    { chat, message: userMessage, index: 1 },
    "new request",
    500
  );

  assert.equal(edited.id, userMessage.id);
  assert.equal(edited.content, "new request");
  assert.equal(edited.editedAt, 500);
  assert.equal(chat.updatedAt, 500);
  assert.deepEqual(
    chat.messages.map((message) => message.id),
    ["message-before"]
  );
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

test("defers rename rendering and listens for keyboard text selections", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../public/AVR-Programming.js"),
    "utf8"
  );

  assert.match(
    source,
    /input\.addEventListener\("blur", \(\) =>\s*saveRename\(\{ deferRender: true \}\)\s*\)/
  );
  assert.match(source, /persistProjectAiChats\(\{ renderList: !deferRender \}\)/);
  assert.match(
    source,
    /addEventListener\("pointerdown", \(event\) => \{\s*projectAiPendingChatPointerAction = getProjectAiChatAction\(event\.target\)/
  );
  assert.match(
    source,
    /const action =\s*projectAiPendingChatPointerAction \|\|\s*getProjectAiChatAction\(event\.target\)/
  );
  assert.match(
    source,
    /codeMirror\.on\?\.\("cursorActivity", showFocusedSelection\)/
  );
  assert.match(
    source,
    /\(event\.ctrlKey \|\| event\.metaKey\)[\s\S]*?\.toLowerCase\(\) === "a"/
  );
  assert.match(
    source,
    /document\.addEventListener\("selectionchange",[\s\S]*?showProjectAiHistorySelectionQuote/
  );
  assert.match(
    source,
    /submitProjectAiRequest\(content, \{[\s\S]*?existingUserMessage: editedMessage,[\s\S]*?clearPromptOnSuccess: false/
  );
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

test("keeps documentation separate and uses a full-height AI workspace rail", () => {
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
  const stageStart = html.indexOf('id="projectWorkspaceStage"');
  const documentationStart = html.indexOf('id="projectDocumentationPane"');
  const documentationEnd = html.indexOf("</aside>", documentationStart);
  const aiSceneStart = html.indexOf('id="projectAiScene"');
  const aiViewStart = html.indexOf('id="projectAiView"');
  const aiToggleIndex = html.indexOf('id="projectAiToggle"');

  assert.ok(stageStart >= 0);
  assert.ok(documentationStart > stageStart);
  assert.ok(documentationEnd > documentationStart);
  assert.ok(aiSceneStart > documentationEnd);
  assert.ok(aiViewStart > aiSceneStart);
  assert.ok(aiToggleIndex > aiViewStart);
  assert.doesNotMatch(
    html.slice(documentationStart, documentationEnd),
    /projectAiView|projectAiHeader|projectAiToggle/
  );
  assert.match(html.slice(aiToggleIndex), /icons\/logo-512\.png/);
  assert.match(
    css,
    /\.project-ai-toggle\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?top:\s*0;[\s\S]*?bottom:\s*0;[\s\S]*?left:\s*calc\(100% - var\(--project-workspace-rail-width\)\);/
  );
  assert.match(
    css,
    /\.project-workspace-stage\[data-mode="ai"\] \.project-ai-toggle\s*\{[\s\S]*?left:\s*0;/
  );
  assert.match(
    html.slice(aiToggleIndex),
    /project-ai-toggle-label-word[\s\S]*?<span>A<\/span><span>I<\/span>[\s\S]*?project-ai-toggle-label-word[\s\S]*?<span>A<\/span><span>S<\/span><span>S<\/span>/
  );
  assert.match(
    css,
    /\.project-ai-toggle\s*\{[\s\S]*?background:\s*var\(--avr-window-bg\);/
  );
  assert.match(
    css,
    /\.project-ai-toggle::before\s*\{[\s\S]*?linear-gradient\(90deg, transparent, var\(--avr-bg\)\)/
  );
  assert.match(
    css,
    /\.project-ai-toggle-arrow::before,[\s\S]*?\.project-ai-toggle-arrow::after\s*\{[\s\S]*?height:\s*50%;/
  );
  assert.doesNotMatch(css, /project-workspace-rail-breathe/);
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

  assert.match(html, /id="projectWorkspaceStage"[\s\S]*data-mode="avr"/);
  assert.match(html, /id="avrWorkspaceScene"/);
  assert.match(html, /id="projectAiScene"[\s\S]*aria-hidden="true"[\s\S]*inert/);
  assert.match(html, /id="projectAiHeader"/);
  assert.match(
    html,
    /class="sr-only" id="projectAiTitle">\s*Uart Debug AI conversation/
  );
  assert.doesNotMatch(html, /AVR project assistant/);
  assert.match(html, /id="projectAiView"/);
  assert.match(html, /id="projectAiWorkspace"/);
  assert.match(html, /id="projectAiHistory"[\s\S]*role="log"/);
  assert.match(html, /id="projectAiForm"/);
  assert.match(
    html,
    /id="projectAiAuth"[\s\S]*?aria-label="AI access"[\s\S]*?hidden[\s\S]*?id="projectAiAccountBtn"/
  );
  assert.match(
    html,
    /id="projectAiAccountStatus"[\s\S]*?role="status"[\s\S]*?aria-live="polite"/
  );
  assert.match(html, /id="projectAiAccountBtn"/);
  assert.match(html, /id="projectAiSignInBtn"[\s\S]*Continue with Google/);
  assert.match(html, /id="projectAiAccount"/);
  assert.match(html, /id="projectAiCredits"/);
  assert.match(html, /id="projectAiBudget"[\s\S]*role="progressbar"/);
  assert.match(html, /id="projectAiBudgetFill"/);
  assert.match(
    html,
    /id="projectAiChatsBtn"[\s\S]*?aria-haspopup="menu"[\s\S]*?aria-controls="projectAiChatsMenu"/
  );
  assert.match(html, /id="projectAiNewChatBtn"[\s\S]*?New chat/);
  assert.match(html, /id="projectAiChatList"/);
  assert.match(html, /id="projectAiSignOutBtn"[\s\S]*Sign out/);
  assert.match(html, /id="projectInstructionEditor"/);
  assert.doesNotMatch(html, /id="projectInstructionPreview"/);
  assert.match(
    html,
    /vendor\/codemirror\/5\.65\.16\/mode\/markdown\/markdown\.js/
  );
  assert.match(html, /id="projectSkillsList"[\s\S]*role="list"/);
  assert.doesNotMatch(html, /accounts\.google\.com\/gsi|gsi\/client/);
  assert.doesNotMatch(html, /id="projectAiAccessToken"/);
  assert.doesNotMatch(html, /id="projectAiClearBtn"/);
  assert.doesNotMatch(html, /project-ai-status-label/);
  assert.doesNotMatch(html, /id="projectAiStatus"/);
  assert.doesNotMatch(html, /Describe the mini-project you need/);
  assert.doesNotMatch(source, /fetch\("\/api\/avr\/ai\/status"/);
  assert.match(source, /fetch\("\/api\/avr\/ai\/respond"/);
  assert.match(source, /PROJECT_AI_SKILLS_URL\s*=\s*"\/api\/avr\/ai\/skills"/);
  assert.doesNotMatch(source, /AI_BROWSER_INSTALLATION_STORAGE_KEY/);
  assert.doesNotMatch(source, /X-UartDebug-Installation/);
  assert.doesNotMatch(source, /getAiBrowserInstallationHeader/);
  assert.match(
    source,
    /if \(session\?\.mode !== "google"\) \{[\s\S]*?closeProjectAiAccountModal\(\{ restoreFocus: false \}\);[\s\S]*?return;[\s\S]*?\}/
  );
  assert.match(source, /PROJECT_AI_AUTH_SESSION_URL[\s\S]*method: "GET"/);
  assert.match(source, /credentials: "same-origin"/);
  assert.match(
    source,
    /fetch\("\/api\/avr\/ai\/respond"[\s\S]*credentials: "same-origin"/
  );
  assert.match(
    source,
    /fetchProjectAiAuthSession\(\)[\s\S]*fetch\(PROJECT_AI_GOOGLE_START_URL[\s\S]*credentials: "same-origin"[\s\S]*redirectUrl\.hostname !== "accounts\.google\.com"[\s\S]*window\.location\.assign\(redirectUrl\.toString\(\)\)/
  );
  assert.match(source, /PROJECT_AI_LOGOUT_URL[\s\S]*method: "POST"/);
  assert.match(source, /google_sign_in_required/);
  assert.match(source, /free_quota_exhausted/);
  assert.match(source, /browser installation are exhausted/);
  assert.match(source, /data\.kind === "answer"/);
  assert.match(source, /data\.kind === "instruction"/);
  assert.match(
    source,
    /instructionDocument:\s*getProjectInstructionSnapshot\(\{ forRequest: true \}\)/
  );
  assert.match(source, /assertProjectAiInstructionIsFresh\(requestPayload\)/);
  assert.match(source, /updateProjectAiQuota\(data\.quota\)/);
  assert.match(source, /schemaVersion !== 1/);
  assert.match(source, /responseRevision !== baseRevision \+ 1/);
  assert.match(source, /typeof revisedMarkdown !== "string"/);
  assert.match(source, /projectAiQuotaUpdateSequence/);
  assert.match(source, /projectAiLatestQuota/);
  assert.match(source, /projectAiAuthRequestEpoch/);
  assert.match(source, /projectAiAuthSessionPromise === sessionPromise/);
  assert.match(source, /function recordProjectAiMessage\(kind, message, title/);
  assert.match(source, /STORAGE_PROJECT_AI_CHATS\s*=\s*"ud_avr_ai_chats_v1"/);
  assert.match(
    source,
    /PROJECT_AI_ACCOUNT_WORKSPACE_URL\s*=\s*\n\s*"\/api\/avr\/ai\/account\/workspace"/
  );
  assert.match(source, /markProjectAiAccountDocumentDirty\("instruction"\)/);
  assert.match(
    source,
    /for \(const kind of \["chats", "files", "instruction"\]\)/
  );
  assert.match(
    source,
    /STORAGE_PROJECT_AI_LOCAL_DIRTY\s*=\s*\n\s*"ud_avr_ai_local_dirty_v1"/
  );
  assert.match(source, /projectAiAccountWorkspaceEpoch/);
  assert.match(source, /conflicts: projectAiAccountSync\.conflicts/);
  assert.match(source, /title: "Different Google account"/);
  assert.match(source, /confirmText: "Import local data"/);
  assert.match(source, /title: `Cloud sync conflict: \$\{label\}`/);
  assert.match(source, /cancelText: "Pause sync"/);
  assert.match(source, /expectedAccountKey: accountKey/);
  assert.match(source, /account_workspace_account_mismatch/);
  assert.match(source, /sourceAccountKey: recoveryScope/);
  assert.match(source, /scopedCopies[\s\S]*?\.slice\(3\)/);
  assert.match(source, /projectAiAccountWorkspaceRetryTimer/);
  assert.match(source, /function projectAiAccountDocumentsMatch\(kind, remoteData\)/);
  assert.match(source, /if \(projectAiAccountDocumentsMatch\(kind, remote\.data\)\)/);
  assert.doesNotMatch(source, /PROJECT_AI_MAX_MESSAGES_PER_CHAT/);
  assert.match(source, /appendProjectAiThinking\(\)/);
  assert.match(source, /removeProjectAiThinking\(thinkingIndicator\)/);
  assert.match(source, /data\.kind !== "project" && !data\.project/);
  assert.match(source, /operation === "update"/);
  assert.match(source, /responseTarget !== expectedTarget/);
  assert.match(source, /assertProjectAiUpdateIsFresh\(requestPayload\)/);
  assert.match(source, /Newer local edits were not overwritten/);
  assert.match(
    source,
    /UartDebugAvrMiniProjects\.updateInstance\([\s\S]*?expectedTarget/
  );
  assert.match(source, /projectAiForm\?\.requestSubmit\(\)/);
  assert.match(source, /"API key is not configured"/);
  assert.doesNotMatch(source, /"X-UartDebug-AI-Token"/);
  assert.doesNotMatch(source, /PROJECT_AI_ACCESS_STORAGE_KEY/);
  assert.doesNotMatch(source, /readProjectAiAccessToken/);
  assert.doesNotMatch(source, /clearProjectAiHistory/);
  assert.match(source, /typeof publicProject\.aiSpecRef\?\.id === "string"/);
  assert.doesNotMatch(source, /PROJECT_AI_MAX_CONVERSATION_MESSAGES/);
  assert.doesNotMatch(source, /projectAiConversation\.slice\(/);
  assert.match(source, /PROJECT_AI_REQUEST_TARGET_BYTES\s*=\s*768 \* 1024/);
  assert.match(source, /selectProjectAiConversation\(payload\)/);
  assert.match(source, /selected\.unshift\(\.\.\.added\)/);
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
    /window\.UartDebugAvrMiniProjects\.install\(\s*definition/
  );
  assert.match(
    source,
    /rawFile\?\.role === "humanGuide"[\s\S]*miniProjectCore\.ROLES\.GUIDE/
  );
  assert.match(
    html,
    /placeholder="Ask, revise the instruction, or request a project"/
  );
  assert.match(html, />\s*Send\s*<\/button>/);
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
  const headerEnd = html.indexOf('id="projectAiView"', headerStart);
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
  assert.match(header, /id="projectAiChatsBtn"/);
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

test("treats the staged AI skills catalog as authoritative during deploy", () => {
  const installer = fs.readFileSync(
    path.join(__dirname, "../backend/deploy/install-ai-service.sh"),
    "utf8"
  );

  assert.match(installer, /shopt -s nullglob/);
  assert.match(
    installer,
    /rm -f -- "\$\{backend_dir\}\/ai\/skills\/"\*\.md/
  );
  assert.match(installer, /if \[ "\$\{#skill_markdown\[@\]\}" -gt 0 \]/);
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
  assert.match(source, /const selectedMcu = String\(mcuSelect\?\.value/);
  assert.match(source, /mcu:\s*selectedMcu/);
  assert.match(source, /detectedMcu/);
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
    /const DOCUMENTATION_COMPACT_WIDTH\s*=\s*62;/
  );
  assert.match(
    source,
    /const DOCUMENTATION_COMPACT_THRESHOLD\s*=\s*112;/
  );
  assert.match(
    source,
    /function getAvrSidePanelBudget\(\)[\s\S]*?OUTLINER_EDITOR_MIN_WIDTH\s*-\s*SPLIT_RESIZER_TOTAL_WIDTH/
  );
  assert.match(
    source,
    /function resolveAvrWorkspaceWidths\([\s\S]*?priority === "outliner"[\s\S]*?budget - outliner[\s\S]*?priority === "documentation"[\s\S]*?budget - documentation/
  );
  assert.match(
    source,
    /function applyOutlinerWidth\([\s\S]*?resolveAvrWorkspaceWidths\(\s*requested,\s*documentationPreferredWidth,\s*"outliner"\s*\)/
  );
  assert.match(
    source,
    /function applyDocumentationWidth\([\s\S]*?resolveAvrWorkspaceWidths\(\s*outlinerPreferredWidth,\s*requested,\s*"documentation"\s*\)/
  );
  assert.match(
    source,
    /outlinerPreferredWidth\s*=\s*resolved\.outliner;[\s\S]*?documentationPreferredWidth\s*=\s*resolved\.documentation;/
  );
  assert.match(
    source,
    /normalizeDocumentationPreference\(width\)[\s\S]*?numeric <= DOCUMENTATION_COMPACT_THRESHOLD[\s\S]*?return DOCUMENTATION_COMPACT_WIDTH;/
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

test("uses one CommonMark GFM runtime across every Markdown surface", () => {
  const html = fs.readFileSync(
    path.join(__dirname, "../public/avr.html"),
    "utf8"
  );
  const source = fs.readFileSync(
    path.join(__dirname, "../public/AVR-Programming.js"),
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
    /const readOnly\s*=\s*!documentationEditMode;[\s\S]*?documentationEditor\?\.setOption\("readOnly", readOnly\)[\s\S]*?aria-readonly/
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

test("wires safe prompt quotes, external chat actions, and hidden provenance", () => {
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
  const promptHighlightStart = source.indexOf(
    "function renderProjectAiPromptHighlight()"
  );
  const promptHighlightEnd = source.indexOf(
    "function setProjectAiPromptValue",
    promptHighlightStart
  );
  const promptHighlightSource = source.slice(
    promptHighlightStart,
    promptHighlightEnd
  );

  assert.match(source, /function bindCodeMirrorQuoteSurface/);
  assert.match(
    source,
    /showProjectAiHistorySelectionQuote\(projectAiHistory\)/
  );
  assert.match(source, /id = "projectAiSelectionQuoteBtn"/);
  assert.match(source, /dataset\.copyMessageId/);
  assert.match(source, /dataset\.editMessageId/);
  assert.match(source, /dataset\.renameChatId/);
  assert.match(source, /deriveProjectAiChatTitle/);
  assert.match(
    html,
    /class="project-ai-prompt-field"[\s\S]*?id="projectAiPromptHighlight"[\s\S]*?aria-hidden="true"[\s\S]*?id="projectAiPrompt"/
  );
  assert.ok(
    promptHighlightStart >= 0 && promptHighlightEnd > promptHighlightStart
  );
  assert.match(promptHighlightSource, /document\.createDocumentFragment\(\)/);
  assert.match(promptHighlightSource, /document\.createElement\("span"\)/);
  assert.match(promptHighlightSource, /line\.textContent\s*=\s*rawLine/);
  assert.match(promptHighlightSource, /highlight\.replaceChildren\(fragment\)/);
  assert.doesNotMatch(promptHighlightSource, /innerHTML/);
  assert.match(
    source,
    /projectAiPrompt\.addEventListener\("input", renderProjectAiPromptHighlight\)/
  );
  assert.match(
    source,
    /projectAiPrompt\.addEventListener\(\s*"scroll",\s*syncProjectAiPromptHighlightScroll/
  );
  assert.match(
    source,
    /prompt\.offsetWidth\s*-\s*prompt\.clientWidth[\s\S]*?highlight\.style\.right/
  );
  assert.match(
    css,
    /\.project-ai-prompt-highlight\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?color:\s*transparent;[\s\S]*?pointer-events:\s*none;/
  );
  assert.match(
    css,
    /\.project-ai-prompt-highlight-line\.is-quote\s*\{[\s\S]*?linear-gradient\([\s\S]*?rgba\(112, 205, 145, 0\.075\);/
  );
  assert.match(
    css,
    /#projectAiPrompt\s*\{[\s\S]*?scrollbar-gutter:\s*stable;/
  );
  assert.match(
    source,
    /article\.appendChild\(bubble\);[\s\S]*?actions\.className = "project-ai-message-actions";[\s\S]*?article\.appendChild\(actions\);/
  );
  assert.match(
    css,
    /\.project-ai-message-bubble\s*\{[\s\S]*?padding:\s*10px 11px;[\s\S]*?border-radius:/
  );
  assert.match(
    css,
    /\.project-ai-message-actions\s*\{[\s\S]*?margin-top:\s*3px;[\s\S]*?align-self:\s*flex-start;/
  );
  assert.match(
    source,
    /bubble\.hidden\s*=\s*true;[\s\S]*?actions\.hidden\s*=\s*true;[\s\S]*?form\.className\s*=\s*"project-ai-message-edit-form";/
  );
  assert.match(
    css,
    /\.project-ai-message-edit-form\s*\{[\s\S]*?padding:\s*12px;[\s\S]*?border:\s*1px solid[\s\S]*?border-radius:\s*14px;[\s\S]*?box-shadow:/
  );
  assert.match(
    css,
    /\.project-ai-message-edit-form textarea:focus\s*\{[\s\S]*?box-shadow:\s*0 0 0 3px/
  );
  assert.match(source, /MARKDOWN_AUTHORSHIP_VALUES/);
  assert.match(source, /sourceAuthorship/);
  assert.match(source, /guideAuthorship/);
  assert.doesNotMatch(source, /addMarkdownAuthorshipGutter/);
  assert.doesNotMatch(source, /setGutterMarker\(/);
  assert.doesNotMatch(source, /markdown-authorship-gutter/);
  assert.doesNotMatch(css, /markdown-authorship-gutter/);
  assert.doesNotMatch(css, /markdown-authorship-marker/);
  assert.match(source, /instructionDocument:[\s\S]*?getProjectInstructionSnapshot/);
  assert.match(source, /detectedMcu/);
  assert.match(source, /renderProjectAiThinkingProgress/);
});

test("uses three sibling AI panels with live Markdown and a framed composer", () => {
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
  const aiLayoutStart = html.indexOf("project-ai-layout");
  const chatPanel = html.indexOf("project-ai-chat-panel", aiLayoutStart);
  const instructionPanel = html.indexOf(
    "project-instruction-panel",
    aiLayoutStart
  );
  const skillsPanel = html.indexOf("project-skills-panel", aiLayoutStart);
  const chatResizer = html.indexOf('id="projectAiChatResizer"', aiLayoutStart);
  const skillsResizer = html.indexOf(
    'id="projectAiSkillsResizer"',
    aiLayoutStart
  );

  assert.ok(viewStart >= 0);
  assert.ok(aiLayoutStart >= 0);
  assert.ok(chatPanel > aiLayoutStart);
  assert.ok(chatResizer > chatPanel);
  assert.ok(instructionPanel > chatResizer);
  assert.ok(skillsResizer > instructionPanel);
  assert.ok(skillsPanel > skillsResizer);
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
  assert.match(
    css,
    /\.project-ai-layout\s*\{[\s\S]*?grid-template-columns:[\s\S]*?minmax\(270px,[\s\S]*?var\(--project-ai-resizer-width\)[\s\S]*?minmax\(350px,[\s\S]*?var\(--project-ai-resizer-width\)[\s\S]*?minmax\(240px,/
  );
  assert.match(css, /\.project-ai-layout\s*\{[\s\S]*?gap:\s*0;/);
  assert.match(
    html,
    /id="projectAiChatResizer"[\s\S]*?role="separator"[\s\S]*?aria-orientation="vertical"/
  );
  assert.match(
    html,
    /id="projectAiSkillsResizer"[\s\S]*?role="separator"[\s\S]*?aria-orientation="vertical"/
  );
  assert.match(
    source,
    /projectAiChatPreferredWidth\s*=\s*resolved\.chat;[\s\S]*?projectAiSkillsPreferredWidth\s*=\s*resolved\.skills;/
  );
  assert.match(
    css,
    /\.project-instruction-workspace\s*\{[\s\S]*?display:\s*flex;/
  );
  assert.match(source, /AI_SKILL_DRAG_MIME/);
  assert.match(source, /CodeMirror\.fromTextArea\(editorElement/);
  assert.match(source, /name:\s*"markdown"/);
  assert.match(source, /inputField\.setAttribute\("role", "textbox"\)/);
  assert.match(
    source,
    /inputField\.setAttribute\("data-tooltip-disabled", ""\)/
  );
  assert.match(
    source,
    /function addMarkdownLiveMark[\s\S]*?state\.editor\.markText\(/
  );
  assert.doesNotMatch(source, /projectInstructionEditor\.markText\(/);
  assert.match(source, /"cursorActivity"/);
  assert.match(source, /projectInstructionEditor\.replaceRange\(/);
  assert.doesNotMatch(source, /setRangeText\(/);
  assert.match(source, /insertProjectAiSkill\(skillId, \{ append: true \}\)/);
  assert.match(source, /function bindProjectAiResizers\(\)/);
  assert.match(source, /STORAGE_PROJECT_AI_CHAT_WIDTH/);
  assert.match(source, /STORAGE_PROJECT_AI_SKILLS_WIDTH/);
  assert.match(
    html,
    /project-instruction-live-editor scroll-frame[\s\S]*?id="projectInstructionDropZone"/
  );
  assert.doesNotMatch(html, /project-skills-help|Saved locally/);
  assert.doesNotMatch(source, /Saved locally/);
  assert.match(source, /getCompatibleInstructionSkillRefs/);
  assert.match(
    source,
    /skillRefs:\s*projectAiSkillsLoaded\s*\?\s*responseInstruction\.skillRefs\s*:\s*undefined/
  );
  assert.match(source, /projectInstructionStorageReadFailed && !recover/);
  assert.match(source, /Stored instruction is unreadable/);
  assert.match(source, /const DEFAULT_PROJECT_INSTRUCTION = "";/);
  assert.match(source, /ud_avr_ai_project_instruction_v2/);
  assert.match(source, /ud_avr_ai_project_instruction_v1/);
  assert.match(source, /const LEGACY_DEFAULT_PROJECT_INSTRUCTION = \[/);
  assert.match(
    source,
    /legacyDocument\.markdown === LEGACY_DEFAULT_PROJECT_INSTRUCTION[\s\S]*?markdown:\s*DEFAULT_PROJECT_INSTRUCTION[\s\S]*?skillRefs:\s*\[\]/
  );
  assert.match(
    source,
    /localStorage\.setItem\(\s*STORAGE_PROJECT_INSTRUCTION,[\s\S]*?JSON\.stringify\(projectInstructionDocument\)/
  );
  assert.doesNotMatch(
    html,
    /placeholder="# Initialization|Describe what the project should do/
  );
  for (const level of [1, 2, 3, 4, 5, 6]) {
    assert.match(
      css,
      new RegExp(
        `pre\\.CodeMirror-line\\.project-instruction-line-heading-${level}`
      )
    );
  }
  assert.doesNotMatch(source, /setextHeading|underscoreExpression/);
  assert.doesNotMatch(source, /function decorateProjectInstructionInline/);
  assert.match(source, /node\.type === "heading"/);
  assert.match(source, /node\.type === "inlineCode"/);
  assert.match(
    source,
    /strong:\s*"project-instruction-live-strong"[\s\S]*?emphasis:[\s\S]*?delete:/
  );
  assert.match(source, /project-instruction-task-marker/);
  assert.match(source, /node\.type === "listItem"/);
  assert.match(source, /renderMarkdownInto\(markdown, message, null, \{ allowImages: false \}\)/);
  assert.match(source, /match\[0\]\.startsWith\("\*\*"\)/);
  assert.match(source, /document\.createElement\("strong"\)/);
  assert.match(source, /document\.createElement\("em"\)/);
  assert.match(source, /document\.createElement\("del"\)/);
  assert.match(source, /\(\?<!\[A-Za-z0-9\]\)_/);
  const headingSixRule = css.match(
    /pre\.CodeMirror-line\.project-instruction-line-heading-6\s*\{[\s\S]*?\}/
  )?.[0];
  assert.ok(headingSixRule);
  assert.doesNotMatch(headingSixRule, /text-transform:\s*uppercase/);
  assert.match(source, /control\.readOnly = !!busy/);
  assert.match(source, /prompt\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(source, /function consumeProjectAiAuthReturn\(\)/);
  assert.match(source, /url\.searchParams\.delete\("ai_auth"\)/);
  assert.match(source, /window\.history\.replaceState\(/);
  assert.match(source, /google_sign_in_denied:\s*"Google sign-in was cancelled\."/);
  assert.match(
    source,
    /setProjectWorkspaceMode\(projectAiAuthReturn \? "ai" : "avr"/
  );
  assert.match(
    css,
    /animation:\s*project-workspace-card-switch 980ms/
  );
  assert.match(
    css,
    /\.project-workspace-stage\.is-switching \.project-workspace-track\s*\{[\s\S]*?transition-delay:\s*250ms;/
  );
  assert.match(css, /\.is-toggle-departing[\s\S]*?\.project-ai-toggle/);
  assert.match(css, /\.is-toggle-hidden[\s\S]*?\.project-ai-toggle/);
  assert.match(source, /PROJECT_WORKSPACE_TOGGLE_EXIT_MS\s*=\s*180/);
  assert.match(source, /PROJECT_WORKSPACE_SWITCH_MS\s*=\s*1000/);
  assert.match(source, /PROJECT_WORKSPACE_TOGGLE_ENTER_MS\s*=\s*200/);
  assert.match(
    css,
    /\.project-workspace-track\s*\{[\s\S]*?transition:\s*transform 440ms/
  );
  assert.match(css, /@media \(max-width: 1040px\)/);
  assert.match(css, /height:\s*clamp\(560px, 78vh, 700px\)/);
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
    /\.split-resizer\.device-panel-resizer::before\s*\{[\s\S]*?width:\s*58px;[\s\S]*?height:\s*2px;/
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
  assert.match(source, /anchorY:\s*event\.clientY/);
  assert.doesNotMatch(source, /getNearestDevicePanelState|getLiveDevicePanelState/);
  const pointerMoveStart = source.indexOf(
    'handle.addEventListener("pointermove"'
  );
  const pointerMoveEnd = source.indexOf(
    'handle.addEventListener("pointerup"',
    pointerMoveStart
  );
  assert.ok(pointerMoveStart >= 0 && pointerMoveEnd > pointerMoveStart);
  const pointerMoveSource = source.slice(pointerMoveStart, pointerMoveEnd);
  assert.match(
    pointerMoveSource,
    /const delta = event\.clientY - devicePanelResizeState\.anchorY/
  );
  assert.match(
    pointerMoveSource,
    /Math\.floor\(\s*Math\.abs\(delta\) \/ DEVICE_PANEL_DRAG_THRESHOLD\s*\)/
  );
  assert.match(pointerMoveSource, /const direction = delta < 0 \? -1 : 1/);
  assert.match(
    pointerMoveSource,
    /while \(appliedSteps < requestedSteps\)[\s\S]*?getAdjacentDevicePanelState\(\s*nextState,\s*direction\s*\)/
  );
  assert.match(
    pointerMoveSource,
    /devicePanelResizeState\.anchorY \+=[\s\S]*?DEVICE_PANEL_DRAG_THRESHOLD \* appliedSteps/
  );
  assert.match(
    pointerMoveSource,
    /setDevicePanelState\(nextState, \{ persist: false, animate: false \}\)/
  );
  assert.match(
    source,
    /event\.key === "ArrowUp"[\s\S]*?Math\.max\(0, index - 1\)[\s\S]*?event\.key === "ArrowDown"[\s\S]*?Math\.min\(states\.length - 1, index \+ 1\)/
  );
  assert.match(
    source,
    /handle\.addEventListener\("pointercancel", finishResize\)/
  );
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
