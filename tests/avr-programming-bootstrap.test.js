"use strict";

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { parseHTML } = require("../frontend/markdown-runtime/node_modules/linkedom");
const { resizeEnvironment } = require("./helpers/panel-resizer-harness");

const core = require("../public/avr-mini-projects.js");
const projectFormat = require("../public/avr-project-format.js");

function loadAvrFrontendFunctionHooks(functionNames, overrides = {}) {
  const windowListeners = new Map();
  const documentListeners = new Map();
  const fakeWindow = {
    UartDebugAvrMiniProjectCore: core,
    UartDebugAvrProjectFormat: projectFormat,
    UartDebugAvrWorkspaceLayout: require("../public/avr-workspace-layout.js"),
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
    `  window.__avrFrontendTestHooks = { ${functionNames.join(", ")}, notifications: () => window.UartDebugNotifications.getAll() };\n${marker}`
  );

  const sandbox = {
    window: fakeWindow,
    document: fakeDocument,
    CodeMirror: overrides.CodeMirror || { registerHelper() {} },
    console,
    Promise,
    Map,
    Set,
    TextDecoder,
    TextEncoder,
    AbortController,
    DOMException,
    URL,
    localStorage: fakeWindow.localStorage,
    fetch: overrides.fetch,
    ResizeObserver: overrides.ResizeObserver,
    sessionStorage: { getItem: () => null, setItem() {} },
    setTimeout: overrides.setTimeout || (() => 1),
    clearTimeout: overrides.clearTimeout || (() => {}),
    requestAnimationFrame: () => 1,
  };
  // Exercise the real notification records without constructing the browser
  // surface; rendering, focus and toast interactions have browser coverage.
  fakeDocument.readyState = "loading";
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../public/ui-controls.js"), "utf8"), sandbox);
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../public/ui-notifications.js"), "utf8"), sandbox);
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../public/avr-project-chat.js"), "utf8"), sandbox);
  vm.runInNewContext(instrumented, sandbox);
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
    UartDebugAvrWorkspaceLayout: require("../public/avr-workspace-layout.js"),
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

  const sandbox = {
    window: fakeWindow,
    document: fakeDocument,
    CodeMirror: { registerHelper() {} },
    console,
    Promise,
    Map,
    Set,
    URL,
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../public/ui-controls.js"), "utf8"), sandbox);
  vm.runInNewContext(source, sandbox);

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

test("migrates legacy annotation questions and answers into Markdown exactly once", () => {
  const hooks = loadAvrFrontendFunctionHooks(["normalizeProjectInstructionDocument", "resolveCanvasAnnotationLine"]);
  const markdown = "# Project\n\nBlink the LED.";
  const annotation = { id: "q:frequency", kind: "question", anchor: { quote: "Blink the LED.", line: 3 }, message: "How often?", status: "resolved", answer: "1 Hz\nKeep the pin." };
  const canvas = hooks.normalizeProjectInstructionDocument({ schemaVersion:2,revision:1,markdown,locale:"en",annotations:[annotation],target:{mcu:"attiny1624",packageName:"SOIC-14"} });
  assert.match(canvas.markdown, /Blink the LED\.\n\n> ###### \*\[AI\.1\] Question\.\*/);
  assert.match(canvas.markdown, /> > \*\*User:\*\* 1 Hz\n> > Keep the pin\./);
  assert.match(canvas.markdown, /Resolved in the previous specification/);
  assert.equal(canvas.annotations.length,0);
  assert.equal(hooks.normalizeProjectInstructionDocument(canvas).markdown,canvas.markdown);
  assert.equal(hooks.resolveCanvasAnnotationLine(annotation,"New line\n"+markdown),3);
  assert.equal(canvas.target.packageName,"SOIC-14");
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

test("infers language again after a manual specification edit while preserving its target", () => {
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
  assert.equal(canvas.annotations.length, 0);
});

function loadCanvasLifecycleHooks(storage = new Map(), options = {}) {
  const { document } = parseHTML('<html><body></body></html>');
  const hooks = loadAvrFrontendFunctionHooks([
    "createEmptyProject", "installMiniProjectDefinition", "updateMiniProjectInstance",
    "selectFile", "getProjectInstructionSnapshot", "getProjectAiAccountFilesSnapshot",
    "applyProjectAiAccountWorkspace",
    "restoreProjectInstruction", "loadState", "persistState", "persistProjectInstruction", "deleteFile",
    "migrateLegacyProjectAiAccountSnapshot", "initializeProjectAiAccountWorkspace", "saveProjectAiAccountWorkspace",
    "resetProjectAiAccountWorkspaceRuntime", "restoreProjectAiLocalDirtyState", "restoreProjectAiAccountSyncState",
    "getPublicMiniProjectInstance", "getVisibleWorkspaceFileNames", "migrateLooseFilesToProjects", "getEmptyProjectAiAccountWorkspace", "isHiddenMiniProjectFile",
    "getProjectAiRequestPayload", "assertProjectAiUpdateIsFresh",
    "assertProjectAiInstructionIsFresh", "canvasScope() { return projectInstructionScopeEpoch; }",
    `prepare() {
      resetHexArtifact = updateCompilePanelState = renderOutliner =
        refreshDocumentationPane = scheduleDocumentationMarkerRefresh =
        scheduleMarkdownLivePreview = updateEditorFileWatermark = () => {};
    }`,
    `editCanvas(markdown) {
      updateProjectInstructionFromUser(markdown, createMarkdownAuthorship(markdown, "human"));
      persistProjectInstruction({ immediate: true, recover: true });
    }`,
    `queueCanvas(markdown) {
      updateProjectInstructionFromUser(markdown, createMarkdownAuthorship(markdown, "human"));
      persistProjectInstruction({ recover: true });
    }`,
    `confirm(value) { showSiteConfirm = async () => value; }`,
    `account(accountKey, ready = false) {
      projectAiBootComplete = true;
      projectAiAuthSession = { authenticated: true, accountKey };
      projectAiAccountSync.accountKey = accountKey;
      projectAiAccountSync.ready = ready;
    }`,
    `syncState() { return JSON.parse(JSON.stringify(projectAiAccountSync)); }`,
    `dirtyAccount() { projectAiAccountSync.dirty = true; }`,
    `setCanvasDocument(canvas) { projectInstructionDocument = normalizeProjectInstructionDocument(canvas); }`,
    `codeEditor(markdown) {
      let value = markdown;
      editor = { getValue: () => value, setValue(next) { value = next; }, setOption() {}, refresh() {} };
    }`,
    `codeValue() { return editor?.getValue(); }`,
    `pendingCanvasScopes() { return [...projectInstructionSaveJobs.keys()]; }`,
  ], {
    document,
    window: {
      localStorage: {
        getItem: (key) => storage.get(key) ?? null,
        setItem: options.setItem || ((key, value) => storage.set(key, String(value))),
        removeItem: (key) => storage.delete(key),
        get length() { return storage.size; },
        key: (index) => [...storage.keys()][index] ?? null,
      },
      requestAnimationFrame: () => 1,
      setTimeout: options.setTimeout || (() => 1),
      clearTimeout: options.clearTimeout || (() => {}),
    },
    fetch: options.fetch,
  });
  hooks.prepare();
  return { hooks, storage, document };
}

test("new projects have empty canvases and project switches restore each saved draft", () => {
  const { hooks, storage } = loadCanvasLifecycleHooks();
  hooks.editCanvas("Loose-file draft");
  const first = hooks.createEmptyProject();
  assert.equal(hooks.getProjectInstructionSnapshot().markdown, "");
  assert.equal(first.files.some((file) => file.role === "specification"), false);
  assert.equal(first.files.find((file) => file.role === "source").content, "");
  assert.equal(first.files.find((file) => file.role === "guide").content, "");
  hooks.editCanvas("First project's requirements");
  const second = hooks.createEmptyProject();
  assert.equal(hooks.getProjectInstructionSnapshot().markdown, "");
  hooks.editCanvas("Second project's requirements");
  hooks.selectFile(first.files.find((file) => file.role === "source").name);
  assert.equal(hooks.getProjectInstructionSnapshot().markdown, "First project's requirements");
  const snapshot = hooks.getProjectAiAccountFilesSnapshot();
  assert.equal(snapshot.miniProjects[second.instanceId].canvas.markdown, "Second project's requirements");
  assert.equal(snapshot.schemaVersion, 3);
  assert.equal(snapshot.draftCanvas.markdown, "Loose-file draft");

  const reloaded = loadCanvasLifecycleHooks(storage).hooks;
  reloaded.loadState();
  reloaded.restoreProjectInstruction();
  assert.equal(reloaded.getProjectInstructionSnapshot().markdown, "First project's requirements");
  reloaded.selectFile(second.files.find((file) => file.role === "source").name);
  assert.equal(reloaded.getProjectInstructionSnapshot().markdown, "Second project's requirements");
});

test("tutorial imports start blank while AI creation and updates retain their canvas", () => {
  const { hooks } = loadCanvasLifecycleHooks();
  const template = {
    schemaVersion: 1, id: "tutorial-fixture", title: "Tutorial fixture", defaultLocale: "en",
    files: [
      { role: "source", name: "fixture.c", content: "int main(void) { for (;;) {} }" },
      { role: "guide", name: "fixture.md", locale: "en", content: "# Tutorial" },
    ],
  };
  hooks.editCanvas("Existing draft");
  const tutorial = hooks.installMiniProjectDefinition(template, { origin: "builtin" });
  assert.equal(hooks.getProjectInstructionSnapshot().markdown, "");
  hooks.editCanvas("Add a timer");
  hooks.updateMiniProjectInstance(tutorial.instanceId, template, { origin: "ai" });
  assert.equal(hooks.getProjectInstructionSnapshot().markdown, "Add a timer");
  hooks.installMiniProjectDefinition(template, { origin: "ai" });
  assert.equal(hooks.getProjectInstructionSnapshot().markdown, "Add a timer");
});

test("account snapshots restore project canvases and the workspace draft atomically", () => {
  const { hooks } = loadCanvasLifecycleHooks();
  hooks.editCanvas("Cloud workspace draft");
  hooks.createEmptyProject();
  hooks.editCanvas("Project requirements");
  const accountFiles = hooks.getProjectAiAccountFilesSnapshot();
  hooks.createEmptyProject();
  hooks.editCanvas("Other requirements");
  assert.equal(hooks.applyProjectAiAccountWorkspace( accountFiles), true);
  assert.equal(hooks.getProjectInstructionSnapshot().markdown, "Project requirements");
  assert.equal(hooks.getProjectInstructionSnapshot().markdown, "Project requirements");
  assert.equal(hooks.getProjectAiAccountFilesSnapshot().draftCanvas.markdown, "Cloud workspace draft");
});

test("migrates the former shared canvas to the active legacy project without copying it to new projects", () => {
  const { hooks, storage } = loadCanvasLifecycleHooks();
  const legacy = hooks.createEmptyProject();
  const files = hooks.getProjectAiAccountFilesSnapshot();
  files.schemaVersion = 2;
  delete files.draftCanvas;
  delete files.miniProjects[legacy.instanceId].canvas;
  storage.set("ud_avr_programming_state_v2", JSON.stringify(files));
  storage.set("ud_avr_ai_project_instruction_v2", JSON.stringify({
    schemaVersion: 2, revision: 9, markdown: "Existing requirements", annotations: [],
  }));
  const migrated = loadCanvasLifecycleHooks(storage).hooks;
  migrated.loadState();
  migrated.restoreProjectInstruction();
  assert.equal(migrated.getProjectInstructionSnapshot().markdown, "Existing requirements");
  migrated.createEmptyProject();
  assert.equal(migrated.getProjectInstructionSnapshot().markdown, "");
  migrated.selectFile(legacy.files.find((file) => file.role === "source").name);
  assert.equal(migrated.getProjectInstructionSnapshot().markdown, "Existing requirements");
});

test("rejects delayed AI responses after switching away and back to an unchanged canvas", () => {
  const { hooks } = loadCanvasLifecycleHooks();
  const first = hooks.createEmptyProject();
  hooks.editCanvas("First draft");
  const request = { canvas: hooks.getProjectInstructionSnapshot() };
  const requestScope = hooks.canvasScope();
  hooks.createEmptyProject();
  hooks.selectFile(first.files.find((file) => file.role === "source").name);
  assert.equal(hooks.getProjectInstructionSnapshot().revision, request.canvas.revision);
  assert.throws(() => hooks.assertProjectAiInstructionIsFresh(request, requestScope), /active project changed/i);
  assert.equal(hooks.assertProjectAiInstructionIsFresh(request, hooks.canvasScope()), request.canvas.revision);
});

test("switching projects preserves failed-save warnings and retries the original project", () => {
  const storage = new Map();
  const timers = new Map();
  let timerId = 0;
  let failWrites = false;
  const { hooks } = loadCanvasLifecycleHooks(storage, {
    setItem(key, value) {
      if (failWrites && key === "ud_avr_programming_state_v2") throw new Error("Storage quota");
      storage.set(key, String(value));
    },
    setTimeout(callback) { timers.set(++timerId, callback); return timerId; },
    clearTimeout(id) { timers.delete(id); },
  });
  const first = hooks.createEmptyProject();
  const second = hooks.createEmptyProject();
  hooks.selectFile(first.files.find((file) => file.role === "source").name);
  failWrites = true;
  hooks.editCanvas("Unsaved first project draft");
  hooks.selectFile(second.files.find((file) => file.role === "source").name);
  const failedSave = hooks.notifications().find(record => /Save failed/.test(record.message));
  assert.ok(failedSave, "the failed save must remain available in notification history after switching projects");
  assert.equal(failedSave.tone, "error");
  assert.ok(timers.size > 0, "The previous project's retry must survive switching");
  failWrites = false;
  for (const [id, callback] of [...timers]) { timers.delete(id); callback(); }
  const saved = JSON.parse(storage.get("ud_avr_programming_state_v2"));
  assert.equal(saved.miniProjects[first.instanceId].canvas.markdown, "Unsaved first project draft");
  assert.equal(hooks.pendingCanvasScopes().length, 0);
  assert.ok(hooks.notifications().some(record => record.id === failedSave.id), "a recovered save must not erase its diagnostic history");
});

test("restoring a workspace reports an unreadable loose canvas without discarding its recovery source", () => {
  const { hooks, storage } = loadCanvasLifecycleHooks();
  hooks.createEmptyProject();
  const legacy = JSON.parse(storage.get("ud_avr_programming_state_v2"));
  legacy.schemaVersion = 2;
  delete legacy.draftCanvas;
  storage.set("ud_avr_programming_state_v2", JSON.stringify(legacy));
  storage.set("ud_avr_ai_project_instruction_v2", "unreadable");
  hooks.loadState();
  hooks.restoreProjectInstruction();
  assert.ok(hooks.notifications().some(record => /unreadable/.test(record.message) && record.tone === "error"));
  assert.equal(storage.get("ud_avr_ai_project_instruction_v2"), "unreadable");
  hooks.persistState();
  const reloaded = loadCanvasLifecycleHooks(storage);
  reloaded.hooks.loadState();
  reloaded.hooks.restoreProjectInstruction();
  assert.ok(reloaded.hooks.notifications().some(record => /unreadable/.test(record.message) && record.tone === "error"));
  assert.equal(storage.get("ud_avr_ai_project_instruction_v2"), "unreadable");
});

test("deleting the last project cancels its save and clears the hidden workspace draft durably", async () => {
  const timers = new Map();
  let nextTimer = 0;
  const { hooks, storage } = loadCanvasLifecycleHooks(new Map(), {
    setTimeout(callback) { timers.set(++nextTimer, callback); return nextTimer; },
    clearTimeout(id) { timers.delete(id); },
  });
  hooks.editCanvas("Old unassigned architecture");
  const project = hooks.createEmptyProject();
  hooks.queueCanvas("Pending project specification");
  assert.ok(hooks.pendingCanvasScopes().includes(project.instanceId));
  hooks.confirm(true);
  await hooks.deleteFile(project.files.find(file => file.role === "source").name);
  assert.equal(hooks.getProjectInstructionSnapshot().markdown, "");
  assert.equal(hooks.getProjectAiAccountFilesSnapshot().draftCanvas.markdown, "");
  assert.equal(hooks.pendingCanvasScopes().length, 0);
  for (const callback of timers.values()) callback();
  const saved = JSON.parse(storage.get("ud_avr_programming_state_v2"));
  assert.equal(saved.schemaVersion, 3);
  assert.equal(saved.draftCanvas.markdown, "");
  assert.equal(Object.keys(saved.miniProjects).length, 0);
  const reloaded = loadCanvasLifecycleHooks(storage).hooks;
  reloaded.loadState();
  reloaded.restoreProjectInstruction();
  assert.equal(reloaded.getProjectInstructionSnapshot().markdown, "");
  assert.equal(reloaded.getVisibleWorkspaceFileNames().length, 0);
});

test("deletion cancellation preserves all drafts and deleting one project keeps the surviving canvas", async () => {
  const { hooks } = loadCanvasLifecycleHooks();
  hooks.editCanvas("Workspace draft");
  const first = hooks.createEmptyProject();
  hooks.editCanvas("First project");
  const second = hooks.createEmptyProject();
  hooks.editCanvas("Second project");
  const firstSource = first.files.find(file => file.role === "source").name;
  const secondSource = second.files.find(file => file.role === "source").name;
  hooks.confirm(false);
  await hooks.deleteFile(secondSource);
  assert.equal(hooks.getProjectInstructionSnapshot().markdown, "Second project");
  assert.equal(hooks.getVisibleWorkspaceFileNames().length, 2);
  hooks.confirm(true);
  await hooks.deleteFile(secondSource);
  assert.equal(hooks.getProjectInstructionSnapshot().markdown, "First project");
  assert.equal(hooks.getProjectAiAccountFilesSnapshot().current, firstSource);
  assert.equal(hooks.getProjectAiAccountFilesSnapshot().draftCanvas.markdown, "Workspace draft");
});

test("deleting the last visible project clears the editor while retaining hidden legacy files", async () => {
  const { hooks } = loadCanvasLifecycleHooks();
  const project = hooks.createEmptyProject();
  const sourceName = project.files.find(file => file.role === "source").name;
  const snapshot = JSON.parse(JSON.stringify(hooks.getProjectAiAccountFilesSnapshot()));
  snapshot.files["legacy-note.txt"] = "Retained recovery content";
  assert.equal(hooks.applyProjectAiAccountWorkspace( snapshot), true);
  hooks.codeEditor("// Deleted project's code");
  hooks.confirm(true);
  await hooks.deleteFile(sourceName);
  assert.equal(hooks.getVisibleWorkspaceFileNames().length, 0);
  assert.equal(hooks.codeValue(), "");
  assert.equal(hooks.getProjectInstructionSnapshot().markdown, "");
  assert.equal(hooks.getProjectAiAccountFilesSnapshot().files["legacy-note.txt"], "Retained recovery content");
});

test("an empty workspace saves a new draft and empty submissions remain valid", () => {
  const { hooks, storage } = loadCanvasLifecycleHooks();
  hooks.editCanvas("New draft without a project");
  const reloaded = loadCanvasLifecycleHooks(storage).hooks;
  reloaded.loadState();
  reloaded.restoreProjectInstruction();
  assert.equal(reloaded.getProjectInstructionSnapshot().markdown, "New draft without a project");
  reloaded.editCanvas("");
  assert.equal(reloaded.getProjectAiRequestPayload().canvas.markdown, "");
  assert.equal(reloaded.getProjectAiRequestPayload().currentProject, undefined);
});

test("a canonical empty draft wins over a legacy standalone canvas before or after cloud restore", () => {
  for (const restoreBeforeCloud of [true, false]) {
    const { hooks, storage } = loadCanvasLifecycleHooks();
    storage.set("ud_avr_ai_project_instruction_v2", JSON.stringify({
      schemaVersion: 2, revision: 9, markdown: "Stale architecture", annotations: [],
    }));
    if (restoreBeforeCloud) hooks.restoreProjectInstruction();
    assert.equal(hooks.applyProjectAiAccountWorkspace( hooks.getEmptyProjectAiAccountWorkspace()), true);
    if (!restoreBeforeCloud) hooks.restoreProjectInstruction();
    assert.equal(hooks.getProjectInstructionSnapshot().markdown, "");
    assert.equal(hooks.getProjectAiAccountFilesSnapshot().draftCanvas.markdown, "");
    const reloaded = loadCanvasLifecycleHooks(storage).hooks;
    reloaded.loadState();
    reloaded.restoreProjectInstruction();
    assert.equal(reloaded.getProjectInstructionSnapshot().markdown, "");
  }
});

test("accepting a cloud snapshot cancels a queued unassigned draft save", () => {
  const timers = new Map();
  let nextTimer = 0;
  const { hooks } = loadCanvasLifecycleHooks(new Map(), {
    setTimeout(callback) { timers.set(++nextTimer, callback); return nextTimer; },
    clearTimeout(id) { timers.delete(id); },
  });
  hooks.queueCanvas("Queued local draft");
  assert.deepEqual(Array.from(hooks.pendingCanvasScopes()), [null]);
  assert.equal(hooks.applyProjectAiAccountWorkspace( hooks.getEmptyProjectAiAccountWorkspace()), true);
  assert.equal(hooks.pendingCanvasScopes().length, 0);
  assert.equal(timers.size, 0);
  assert.equal(hooks.getProjectInstructionSnapshot().markdown, "");
});

test("one account snapshot preserves code, YAML, descriptions, metadata, assets, and latest canvas", () => {
  const { hooks } = loadCanvasLifecycleHooks();
  hooks.editCanvas("Workspace draft");
  const project = hooks.installMiniProjectDefinition({
    schemaVersion: 1, id: "bundle", title: "Bundle", version: "Ver.2.0",
    canvasName: "Bundle.md", projectPath: "Target_Projects/Bundle Ver.2.0",
    projectDocuments: [{ name: "AGENTS.md", content: "Use a nonblocking loop." }],
    assets: [{ path: "Images/Board.svg", mediaType: "image/svg+xml", content: "<svg xmlns=\"http://www.w3.org/2000/svg\"/>" }],
    files: [
      { role: "source", name: "Bundle.c", content: "int main(void) { for (;;) {} }" },
      { role: "specification", name: "Bundle.yaml", content: "model: ATtiny1624", hidden: true },
      { role: "guide", name: "Bundle_description.md", locale: "en", content: "# Description" },
    ],
  });
  hooks.setCanvasDocument({ schemaVersion: 2, revision: 4, markdown: "Latest unsaved edit", locale: "en",
    target: { mcu: "attiny1624", packageName: "SOIC14" }, annotations: [], authorship: { lines: ["human"] } });
  const snapshot = JSON.parse(JSON.stringify(hooks.getProjectAiAccountFilesSnapshot()));
  assert.equal(snapshot.miniProjects[project.instanceId].canvas.markdown, "Latest unsaved edit");
  const target = loadCanvasLifecycleHooks().hooks;
  assert.equal(target.applyProjectAiAccountWorkspace( snapshot), true);
  assert.equal(JSON.stringify(target.getProjectAiAccountFilesSnapshot()), JSON.stringify(snapshot));
  assert.equal(target.getPublicMiniProjectInstance(project.instanceId).files.find(file => file.role === "specification").hidden, true);
});

test("cloud project restoration cannot copy the old editor into the restored source", () => {
  const remote = loadCanvasLifecycleHooks().hooks;
  const project = remote.installMiniProjectDefinition({ schemaVersion: 1, id: "cloud-project", title: "Cloud project",
    files: [{ role: "source", name: "Cloud.c", content: "// Cloud source" }] });
  remote.editCanvas("Cloud specification");
  const cloud = remote.getProjectAiAccountFilesSnapshot();
  const { hooks, storage } = loadCanvasLifecycleHooks();
  hooks.createEmptyProject();
  hooks.editCanvas("Local specification");
  hooks.codeEditor("// Unsynced old editor source");
  assert.equal(hooks.applyProjectAiAccountWorkspace( cloud), true);
  const source = project.files.find(file => file.role === "source").name;
  assert.equal(hooks.getProjectAiAccountFilesSnapshot().files[source], "// Cloud source");
  assert.equal(JSON.parse(storage.get("ud_avr_programming_state_v2")).files[source], "// Cloud source");
  assert.equal(hooks.getProjectInstructionSnapshot().markdown, "Cloud specification");
});

function accountSyncStorage(accountKey, revision, overrides = {}) {
  return new Map([["ud_avr_ai_account_sync_v1", JSON.stringify({ schemaVersion: 1, accountKey,
    revisions: { files: revision, instruction: 800 }, dirty: { files: false, instruction: false },
    conflicts: { files: false, instruction: false }, ...overrides })]]);
}

function jsonResponse(data, status = 200) {
  return { ok: status >= 200 && status < 300, status, headers: { get: () => null }, json: async () => data };
}

test("legacy account document order does not affect consolidation or the first atomic save", async () => {
  const fixture = loadCanvasLifecycleHooks().hooks;
  const active = fixture.createEmptyProject();
  const other = fixture.createEmptyProject();
  fixture.selectFile(active.files.find(file => file.role === "source").name);
  const oldFiles = JSON.parse(JSON.stringify(fixture.getProjectAiAccountFilesSnapshot()));
  oldFiles.schemaVersion = 2;
  delete oldFiles.draftCanvas;
  delete oldFiles.miniProjects[active.instanceId].canvas;
  oldFiles.miniProjects[other.instanceId].canvas.markdown = "";
  const oldInstruction = { schemaVersion: 2, revision: 4, markdown: "Legacy active specification", annotations: [] };
  for (const kinds of [["files", "instruction"], ["instruction", "files"]]) {
    const accountKey = "account-migration";
    const requests = [];
    const stored = accountSyncStorage(accountKey, 7);
    const { hooks, storage } = loadCanvasLifecycleHooks(stored, { fetch: async (url, init) => {
      requests.push({ url, ...init });
      if (init.method === "GET") return jsonResponse({ ok: true, accountKey, documents: Object.fromEntries(kinds.map(kind => [kind,
        { revision: kind === "files" ? 7 : 19, data: kind === "files" ? oldFiles : oldInstruction }])) });
      return jsonResponse({ ok: true, document: { revision: 8 } });
    } });
    hooks.restoreProjectAiAccountSyncState();
    hooks.account(accountKey);
    await hooks.initializeProjectAiAccountWorkspace();
    assert.equal(hooks.getProjectInstructionSnapshot().markdown, "Legacy active specification");
    assert.equal(hooks.getProjectAiAccountFilesSnapshot().miniProjects[other.instanceId].canvas.markdown, "");
    assert.equal(hooks.syncState().dirty, true, "Migration must be written even after adopting cloud data");
    await hooks.saveProjectAiAccountWorkspace();
    const writes = requests.filter(request => request.method === "PUT");
    assert.equal(writes.length, 1);
    assert.equal(writes[0].url, "/api/avr/ai/account/workspace/files");
    const body = JSON.parse(writes[0].body);
    assert.equal(body.baseRevision, 7, "Independent instruction revision must not replace the files revision");
    assert.equal(body.expectedLegacyInstructionRevision, 19);
    assert.equal(body.data.schemaVersion, 3);
    assert.equal(body.data.draftCanvas.markdown, "Legacy active specification");
    assert.equal(hooks.syncState().dirty, false);
    const sync = JSON.parse(storage.get("ud_avr_ai_account_sync_v1"));
    assert.equal(sync.schemaVersion, 4);
    assert.equal(sync.revision, 8);
  }
});

test("legacy dirty flags are combined without replacing the files revision", () => {
  const storage = accountSyncStorage("same-account", 3, {
    dirty: { files: false, instruction: true }, conflicts: { files: false, instruction: true },
  });
  storage.set("ud_avr_ai_local_dirty_v1", JSON.stringify({ dirty: { files: false, instruction: true } }));
  const { hooks } = loadCanvasLifecycleHooks(storage);
  hooks.restoreProjectAiAccountSyncState();
  hooks.restoreProjectAiLocalDirtyState();
  assert.equal(hooks.syncState().revision, 3);
  assert.equal(hooks.syncState().dirty, true);
  assert.equal(hooks.syncState().conflict, true);
  assert.equal("revisions" in hooks.syncState(), false);
  assert.equal("conflicts" in hooks.syncState(), false);
});

test("an unsaved legacy instruction marker pauses the entire project reconciliation", async () => {
  const accountKey = "dirty-legacy-account";
  const storage = accountSyncStorage(accountKey, 3, { dirty: { files: false, instruction: true } });
  const requests = [];
  const { hooks } = loadCanvasLifecycleHooks(storage, { fetch: async (url, init) => {
    requests.push({ url, ...init });
    return jsonResponse({ ok: true, accountKey, documents: {
      files: { revision: 3, data: { schemaVersion: 2, files: {}, authorship: {}, fileGroups: {}, miniProjects: {}, current: null } },
      instruction: { revision: 90, data: { schemaVersion: 2, revision: 9, markdown: "Older cloud draft" } },
    } });
  } });
  hooks.editCanvas("Newer local draft");
  hooks.restoreProjectAiAccountSyncState();
  hooks.account(accountKey);
  hooks.confirm(false);
  await hooks.initializeProjectAiAccountWorkspace();
  await hooks.saveProjectAiAccountWorkspace();
  assert.equal(hooks.getProjectInstructionSnapshot().markdown, "Newer local draft");
  assert.equal(hooks.syncState().conflict, true);
  assert.equal(hooks.syncState().revision, 3);
  assert.equal(requests.length, 1);
});

test("canonical account saves send draft and projects together and retain edits made during a save", async () => {
  let finishSave;
  const requests = [];
  const { hooks } = loadCanvasLifecycleHooks(new Map(), { fetch: (url, init) => {
    requests.push({ url, ...init });
    return new Promise(resolve => { finishSave = resolve; });
  } });
  hooks.account("same-account", true);
  hooks.createEmptyProject();
  hooks.editCanvas("Submitted draft");
  const pending = hooks.saveProjectAiAccountWorkspace();
  hooks.editCanvas("Newer draft");
  finishSave(jsonResponse({ ok: true, document: { revision: 1 } }));
  await pending;
  assert.equal(hooks.syncState().revision, 1);
  assert.equal(hooks.syncState().dirty, true);
  assert.equal(hooks.getProjectInstructionSnapshot().markdown, "Newer draft");
  assert.equal(requests.length, 1);
  const body = JSON.parse(requests[0].body);
  assert.equal(body.data.schemaVersion, 3);
  assert.equal(Object.values(body.data.miniProjects)[0].canvas.markdown, "Submitted draft");
  assert.equal(body.data.draftCanvas.markdown, "");
  assert.equal(body.expectedLegacyInstructionRevision, undefined);
});

test("stale account save responses cannot acknowledge another account's projects", async () => {
  let finishSave;
  const { hooks } = loadCanvasLifecycleHooks(new Map(), { fetch: () => new Promise(resolve => { finishSave = resolve; }) });
  hooks.account("first-account", true);
  hooks.editCanvas("First account draft");
  const pending = hooks.saveProjectAiAccountWorkspace();
  hooks.resetProjectAiAccountWorkspaceRuntime();
  hooks.account("second-account", true);
  hooks.editCanvas("Second account draft");
  finishSave(jsonResponse({ ok: true, document: { revision: 50 } }));
  await pending;
  assert.equal(hooks.syncState().revision, 0);
  assert.equal(hooks.syncState().dirty, true);
  assert.equal(hooks.getProjectInstructionSnapshot().markdown, "Second account draft");
});

test("deleting the final project saves an empty account envelope instead of skipping sync", async () => {
  const writes = [];
  const { hooks } = loadCanvasLifecycleHooks(new Map(), { fetch: async (url, init) => {
    writes.push({ url, ...init });
    return jsonResponse({ ok: true, document: { revision: writes.length } });
  } });
  hooks.account("same-account", true);
  hooks.editCanvas("Old standalone draft");
  const project = hooks.createEmptyProject();
  hooks.editCanvas("Project draft");
  await hooks.saveProjectAiAccountWorkspace();
  hooks.confirm(true);
  await hooks.deleteFile(project.files.find(file => file.role === "source").name);
  assert.equal(hooks.syncState().dirty, true);
  await hooks.saveProjectAiAccountWorkspace();
  assert.equal(writes.length, 2);
  const deleted = JSON.parse(writes[1].body);
  assert.equal(deleted.baseRevision, 1);
  assert.deepEqual(deleted.data.files, {});
  assert.deepEqual(deleted.data.miniProjects, {});
  assert.equal(deleted.data.draftCanvas.markdown, "");
  assert.equal(deleted.data.current, null);
  assert.equal(hooks.syncState().dirty, false);
});

test("legacy instruction-only accounts migrate with the files revision zero", async () => {
  const accountKey = "instruction-only";
  const requests = [];
  const { hooks } = loadCanvasLifecycleHooks(accountSyncStorage(accountKey, 0), { fetch: async (url, init) => {
    requests.push({ url, ...init });
    return init.method === "GET" ? jsonResponse({ ok: true, accountKey, documents: {
      files: { revision: 0, data: null },
      instruction: { revision: 31, data: { schemaVersion: 2, revision: 9, markdown: "Existing account draft" } },
    } }) : jsonResponse({ ok: true, document: { revision: 1 } });
  } });
  hooks.restoreProjectAiAccountSyncState();
  hooks.account(accountKey);
  await hooks.initializeProjectAiAccountWorkspace();
  assert.equal(hooks.getProjectInstructionSnapshot().markdown, "Existing account draft");
  await hooks.saveProjectAiAccountWorkspace();
  const body = JSON.parse(requests[1].body);
  assert.equal(body.baseRevision, 0);
  assert.equal(body.expectedLegacyInstructionRevision, 31);
  assert.equal(body.data.draftCanvas.markdown, "Existing account draft");
  assert.deepEqual(body.data.miniProjects, {});
});

test("canonical cloud data ignores stale instruction rows and never starts a second save", async () => {
  const accountKey = "canonical-account";
  const fixture = loadCanvasLifecycleHooks().hooks;
  const canonical = fixture.getEmptyProjectAiAccountWorkspace();
  const requests = [];
  const { hooks } = loadCanvasLifecycleHooks(accountSyncStorage(accountKey, 4), { fetch: async (url, init) => {
    requests.push({ url, ...init });
    return jsonResponse({ ok: true, accountKey, documents: {
      instruction: { revision: 99, data: { schemaVersion: 2, revision: 50, markdown: "Stale hidden architecture" } },
      files: { revision: 4, data: canonical },
    } });
  } });
  hooks.restoreProjectAiAccountSyncState();
  hooks.account(accountKey);
  await hooks.initializeProjectAiAccountWorkspace();
  await hooks.saveProjectAiAccountWorkspace();
  assert.equal(hooks.getProjectInstructionSnapshot().markdown, "");
  assert.equal(hooks.syncState().dirty, false);
  assert.equal(hooks.syncState().legacyInstructionRevision, null);
  assert.equal(requests.length, 1);
});

test("failed canonical local writes keep legacy migration sources and do not acknowledge sync", () => {
  const legacyInstruction = JSON.stringify({ schemaVersion: 2, revision: 7, markdown: "Recoverable legacy draft" });
  const storage = new Map([["ud_avr_ai_project_instruction_v2", legacyInstruction]]);
  const { hooks } = loadCanvasLifecycleHooks(storage, { setItem(key, value) {
    if (key === "ud_avr_programming_state_v2") throw new Error("Storage quota");
    storage.set(key, String(value));
  } });
  hooks.restoreProjectInstruction();
  assert.equal(hooks.persistState(), false);
  assert.equal(storage.get("ud_avr_ai_project_instruction_v2"), legacyInstruction);
  assert.equal(hooks.getProjectInstructionSnapshot().markdown, "Recoverable legacy draft");
});

test("keeps the explicit canvas-stage payload separate from conversational history and retired skill refs", () => {
  const { document } = parseHTML('<html><body><select id="mcuSelect"><option value="attiny1624" selected>ATtiny1624</option></select><select id="projectPackageSelect"><option value="SOIC-14" selected>SOIC-14</option></select></body></html>');
  const hooks = loadAvrFrontendFunctionHooks([
    "getProjectAiRequestPayload",
    "setCanvas(value) { projectInstructionDocument = normalizeProjectInstructionDocument(value); }",
  ], { document });
  hooks.setCanvas({ schemaVersion: 2, revision: 2, markdown: "Мигать PB2", locale: "ru" });
  const request = hooks.getProjectAiRequestPayload();
  assert.deepEqual(Object.keys(request).sort(), ["canvas", "mcu", "operation", "packageName"]);
  assert.equal(request.canvas.markdown, "Мигать PB2");
  assert.equal(request.mcu, "attiny1624");
  assert.equal(request.packageName, "SOIC-14");
  assert.equal("skillRefs" in request.canvas, false);
});

test("places project chat in the left pane and project browsing in a shared modal while retaining the editors", () => {
  const html = fs.readFileSync(path.join(__dirname, "../public/avr.html"), "utf8");
  const source = fs.readFileSync(path.join(__dirname, "../public/AVR-Programming.js"), "utf8");
  const { document } = parseHTML(html);
  assert.ok(document.getElementById("projectInstructionEditor"));
  assert.equal(document.querySelectorAll("#projectCanvasForm button[type=submit]").length, 1);
  assert.ok(document.getElementById("projectPackageSelect"));
  for (const id of ["projectChatThread", "projectChatInput", "projectChatSendBtn", "projectChatCompactLabel"]) {
    assert.ok(document.querySelector(`.outliner #${id}`), id);
  }
  const compactChatLabel = document.getElementById("projectChatCompactLabel");
  assert.equal(compactChatLabel.tagName, "DIV");
  assert.equal(compactChatLabel.textContent.trim(), "Chat");
  assert.equal(compactChatLabel.querySelector("svg, button"), null);
  assert.equal(document.getElementById("projectChatCompactBtn"), null);
  assert.ok(document.querySelector("#filesModal.ui-modal #fileList"));
  assert.equal(document.querySelector(".outliner #fileList"), null);
  assert.ok(document.querySelector("#avrActionsPanelViewport #filesOpenBtn"));
  assert.equal(document.getElementById("filesOpenBtn").getAttribute("aria-controls"), "filesModal");
  for (const id of ["projectAiHistory", "projectAiPrompt", "projectAiChatsBtn", "projectAiChatResizer"]) {
    assert.equal(document.getElementById(id), null, id);
  }
  for (const id of ["fileListResizer", "projectAiColumnResizer", "documentationResizer", "projectAiAccountBtn", "projectAiBudget"]) {
    assert.ok(document.getElementById(id), id);
  }
  assert.ok(source.includes('fetch("/api/avr/ai/canvas"'));
  assert.ok(source.includes('fetch("/api/avr/ai/chat"'));
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
  assert.doesNotMatch(modal, /id="projectAiAccountStatus"/);
  const { document } = parseHTML(html);
  assert.ok(document.getElementById("projectAiAccountModal").classList.contains("ui-modal"));
  assert.ok(document.getElementById("projectAiAccountCard").classList.contains("ui-dialog-card"));
  assert.ok(document.getElementById("projectAiAccountBody").classList.contains("ui-dialog-body"));
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
  assert.match(openSource, /openWorkspaceModal\(modal, \{/);
  assert.match(openSource, /trigger\.setAttribute\("aria-expanded", "true"\)/);
  assert.match(
    openSource,
    /return signIn && !signIn\.hidden \? signIn : card/
  );
  assert.match(closeSource, /closeWorkspaceModal\(modal, \{ restoreFocus \}\)/);
  assert.match(closeSource, /trigger\.setAttribute\("aria-expanded", "false"\)/);
  assert.match(
    source,
    /projectAiAccountBtn &&[\s\S]*?projectAiAccountBtn\.addEventListener\("click", handleProjectAiAccountAction\)/
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
    /if \(e\.key === "Escape"\) \{\s*if \(dismissTopWorkspaceModal\(\)\)/
  );
  assert.match(source, /trapModalFocus: trapWorkspaceModalFocus/);
  assert.match(
    source,
    /document\.addEventListener\("keydown", \(e\) => \{\s*if \(e\.defaultPrevented \|\| handleFileMenuKeydown\(e\) \|\| trapWorkspaceModalFocus\(e\)\) return;/
  );
  assert.match(
    source,
    /projectAiAuthSession = \{\s*mode: "google",\s*configured: true,\s*authenticated: false,\s*quota: null,\s*\};\s*resetProjectAiAccountWorkspaceRuntime\(\);\s*renderProjectAiAuthSession\(projectAiAuthSession\);/
  );
  assert.match(source, /setProjectAiAccountStatus\(message, "error"\)/);
  const controlsCss = fs.readFileSync(path.join(__dirname, "../public/ui-controls.css"), "utf8");
  assert.match(controlsCss, /\.ui-modal\s*\{[^}]*backdrop-filter:\s*var\(--ui-modal-backdrop,\s*blur\(8px\)\);/);
  const sharedFrame = controlsCss.match(/:where\(\.ui-panel,\s*\.scroll-frame,\s*\.ui-dialog-card,\s*\.custom-select-menu\)(?:,\s*\.CodeMirror-hints)?\s*\{([^}]*)\}/)?.[1];
  assert.ok(sharedFrame, "account cards must consume the shared window foundation");
  assert.match(sharedFrame, /border:\s*1px solid var\(--ui-panel-border, var\(--ui-border\)\);/);
  assert.match(sharedFrame, /border-radius:\s*var\(--ui-panel-radius, var\(--ui-radius\)\);/);
  assert.match(sharedFrame, /background:\s*var\(--ui-panel-bg, var\(--ui-window-bg\)\);/);
  assert.match(sharedFrame, /box-shadow:\s*var\(--ui-panel-shadow, none\);/);
  const dialogCard = controlsCss.match(/\.ui-dialog-card\s*\{([^}]*)\}/)?.[1];
  assert.ok(dialogCard, "the dialog variant must configure the common frame");
  assert.match(dialogCard, /--ui-panel-bg:\s*var\(--ui-dialog-bg, var\(--ui-window-bg\)\);/);
  assert.match(dialogCard, /--ui-panel-shadow:\s*var\(--ui-dialog-shadow,\s*0 20px 60px rgba\(7, 13, 20, 0\.32\)\);/);
  assert.doesNotMatch(dialogCard, /(?:^|\n)\s*(?:border|border-radius|background|box-shadow)\s*:/,
    "the account dialog must not duplicate the shared frame properties");
  assert.match(
    css,
    /\.project-ai-account-card\s*\{[^}]*width:\s*min\(100%, 520px\);/
  );
  assert.match(
    css,
    /\.project-ai-google-sign-in\s*\{[\s\S]*?width:\s*100%;[\s\S]*?background:\s*rgba\(39, 174, 96, 0\.1\);/
  );
  assert.doesNotMatch(css, /\.project-ai-account-status/);
});

test("unlimited AI quota replaces finite progress semantics and finite snapshots restore them", () => {
  const { document } = parseHTML(fs.readFileSync(path.join(__dirname, "../public/avr.html"), "utf8"));
  const hooks = loadAvrFrontendFunctionHooks(["updateProjectAiQuota", "renderProjectAiQuota"], { document });
  const budget = document.getElementById("projectAiBudget");
  const value = document.getElementById("projectAiBudgetValue");
  const fill = document.getElementById("projectAiBudgetFill");

  hooks.updateProjectAiQuota({ granted: 100, spent: 90, reserved: 0, remaining: 10 });
  assert.equal(budget.classList.contains("is-low"), true);
  assert.equal(value.textContent, "10 / 100");
  hooks.updateProjectAiQuota({ unlimited: true, granted: null, spent: null, reserved: null, remaining: null });
  assert.equal(budget.hidden, false);
  assert.equal(value.textContent, "Unlimited");
  assert.equal(fill.style.width, "100%");
  assert.equal(budget.getAttribute("role"), "status");
  assert.equal(budget.getAttribute("aria-label"), "Unlimited AI Credits");
  assert.equal(budget.classList.contains("is-low"), false);
  assert.equal(budget.classList.contains("is-empty"), false);
  for (const attribute of ["aria-valuemin", "aria-valuemax", "aria-valuenow", "aria-valuetext"]) {
    assert.equal(budget.hasAttribute(attribute), false, attribute);
  }

  // Normal snapshots keep the old API shape, with no unlimited flag.
  hooks.updateProjectAiQuota({ granted: 100, spent: 100, reserved: 0, remaining: 0 });
  assert.equal(value.textContent, "0 / 100");
  assert.equal(fill.style.width, "0%");
  assert.equal(budget.getAttribute("role"), "progressbar");
  assert.equal(budget.getAttribute("aria-label"), "AI Credits remaining");
  assert.equal(budget.getAttribute("aria-valuemin"), "0");
  assert.equal(budget.getAttribute("aria-valuemax"), "100");
  assert.equal(budget.getAttribute("aria-valuenow"), "0");
  assert.equal(budget.classList.contains("is-empty"), true);
  hooks.renderProjectAiQuota({ unlimited: "true", granted: null, remaining: null });
  assert.equal(budget.hidden, true, "Only an explicit boolean flag grants unlimited display");
});

test("unlimited Google account shows its entitlement without hiding or disabling canvas controls", () => {
  const { document } = parseHTML(fs.readFileSync(path.join(__dirname, "../public/avr.html"), "utf8"));
  const hooks = loadAvrFrontendFunctionHooks(["renderProjectAiAuthSession", "setProjectAiFormBusy"], { document });
  const session = { mode: "google", configured: true, authenticated: true,
    user: { displayName: "Test Account", emailMasked: "t***@example.com" },
    quota: { unlimited: true, granted: null, spent: null, reserved: null, remaining: null } };
  hooks.renderProjectAiAuthSession(session);
  const accountButton = document.getElementById("projectAiAccountBtn");
  const accountLabel = document.querySelector(".project-ai-account-trigger-label");
  assert.equal(accountLabel.textContent, "Test Account");
  assert.equal(accountButton.disabled, false);
  assert.equal(accountButton.getAttribute("aria-haspopup"), "dialog");
  const credits = document.getElementById("projectAiCredits");
  const button = document.getElementById("projectCanvasRunBtn");
  assert.equal(credits.textContent, "Unlimited AI Credits");
  assert.equal(credits.title, "Unlimited AI Credits");
  assert.equal(credits.hidden, false);
  assert.equal(document.getElementById("projectAiAuthSession").hidden, false);
  hooks.setProjectAiFormBusy(true);
  assert.equal(button.disabled, true, "Request concurrency protection remains");
  hooks.setProjectAiFormBusy(false);
  assert.equal(button.disabled, false);
  hooks.renderProjectAiAuthSession({ ...session, quota: { granted: 100, remaining: 1 } });
  assert.equal(credits.textContent, "1 AI Credit remaining");
  hooks.renderProjectAiAuthSession({ ...session, user: { emailMasked: "t***@example.com" } });
  assert.equal(accountLabel.textContent, "Google account");
  hooks.renderProjectAiAuthSession({ ...session, authenticated: false, quota: null });
  assert.equal(accountLabel.textContent, "Continue with Google");
  assert.equal(accountButton.getAttribute("aria-label"), "Continue with Google");
  assert.equal(accountButton.hasAttribute("aria-haspopup"), false);
  assert.equal(credits.hidden, true);
  assert.equal(document.getElementById("projectAiBudget").hidden, true);
});

test("account name saves once, preserves an edited draft during quota updates, and refreshes the visible name", async () => {
  const { document } = parseHTML(fs.readFileSync(path.join(__dirname, "../public/avr.html"), "utf8"));
  let finishSave;
  const calls = [];
  const hooks = loadAvrFrontendFunctionHooks([
    "saveProjectAiProfile", "handleProjectAiProfileNameInput", "updateProjectAiQuota",
    "session(value) { projectAiAuthSession = value; renderProjectAiAuthSession(value); }",
  ], { document, fetch: (url, options) => {
    calls.push({ url, options });
    return new Promise(resolve => { finishSave = resolve; });
  } });
  hooks.session({ mode: "google", configured: true, authenticated: true, accountKey: "profile_account_key_12345678901234567890",
    user: { displayName: "David", emailMasked: "d***@example.com" }, quota: { unlimited: true } });
  const input = document.getElementById("projectAiDisplayName");
  const button = document.getElementById("projectAiProfileSaveBtn");
  assert.equal(input.value, "David");
  assert.equal(button.disabled, true);
  input.value = "  Давид 👩‍💻  ";
  hooks.handleProjectAiProfileNameInput();
  hooks.updateProjectAiQuota({ unlimited: true });
  assert.equal(input.value, "  Давид 👩‍💻  ", "Credit refresh must preserve an unsaved name");
  const saved = hooks.saveProjectAiProfile();
  const duplicate = hooks.saveProjectAiProfile();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/avr/ai/account/profile");
  assert.equal(calls[0].options.method, "PATCH");
  assert.equal(calls[0].options.credentials, "same-origin");
  assert.deepEqual(JSON.parse(calls[0].options.body), { displayName: "Давид 👩‍💻", expectedAccountKey: "profile_account_key_12345678901234567890" });
  assert.equal(input.disabled, true);
  assert.equal(document.getElementById("projectAiSignOutBtn").disabled, true);
  finishSave({ ok: true, status: 200, json: async () => ({ ok: true, accountKey: "profile_account_key_12345678901234567890", user: { displayName: "Давид 👩‍💻", emailMasked: "d***@example.com" } }) });
  assert.deepEqual(await Promise.all([saved, duplicate]), [true, true]);
  assert.equal(input.value, "Давид 👩‍💻");
  assert.equal(input.disabled, false);
  assert.equal(button.disabled, true);
  assert.equal(document.querySelector(".project-ai-account-trigger-label").textContent, "Давид 👩‍💻");
  assert.equal(document.getElementById("projectAiAccount").textContent, "d***@example.com");
  assert.equal(document.getElementById("projectAiCredits").textContent, "Unlimited AI Credits");
});

test("failed name saves preserve the draft and can retry or reset to the Google name", async () => {
  const { document } = parseHTML(fs.readFileSync(path.join(__dirname, "../public/avr.html"), "utf8"));
  let fail = true;
  const hooks = loadAvrFrontendFunctionHooks([
    "saveProjectAiProfile", "handleProjectAiProfileNameInput",
    "prepare() { projectAiAuthSession = {mode:'google',configured:true,authenticated:true,accountKey:'profile_account_key_12345678901234567890',user:{displayName:'David'},quota:{unlimited:true}}; renderProjectAiAuthSession(projectAiAuthSession); }",
  ], { document, fetch: async () => fail
    ? { ok: false, status: 429, json: async () => ({ message: "Try again shortly." }) }
    : { ok: true, status: 200, json: async () => ({ ok: true, accountKey: "profile_account_key_12345678901234567890", user: { displayName: "David", emailMasked: "d***@example.com" } }) } });
  hooks.prepare();
  const input = document.getElementById("projectAiDisplayName");
  input.value = "New name";
  hooks.handleProjectAiProfileNameInput();
  assert.equal(await hooks.saveProjectAiProfile(), false);
  assert.equal(input.value, "New name");
  assert.equal(document.getElementById("projectAiProfileSaveBtn").disabled, false);
  assert.ok(hooks.notifications().some(record => record.message === "Try again shortly." && record.tone === "error"));
  fail = false;
  input.value = "";
  hooks.handleProjectAiProfileNameInput();
  assert.equal(await hooks.saveProjectAiProfile(), true);
  assert.equal(input.value, "David");
  assert.ok(hooks.notifications().some(record => record.message === "Google display name restored." && record.tone === "success"));
});

test("a delayed name-save response cannot repaint a signed-out account", async () => {
  const { document } = parseHTML(fs.readFileSync(path.join(__dirname, "../public/avr.html"), "utf8"));
  let finishSave;
  const hooks = loadAvrFrontendFunctionHooks([
    "saveProjectAiProfile", "handleProjectAiProfileNameInput",
    "prepare() { projectAiAuthSession = {mode:'google',configured:true,authenticated:true,accountKey:'profile_account_key_12345678901234567890',user:{displayName:'David'}}; renderProjectAiAuthSession(projectAiAuthSession); }",
    "expire() { projectAiAuthRequestEpoch++; projectAiAuthSession = {mode:'google',configured:true,authenticated:false}; renderProjectAiAuthSession(projectAiAuthSession); }",
  ], { document, fetch: () => new Promise(resolve => { finishSave = resolve; }) });
  hooks.prepare();
  document.getElementById("projectAiDisplayName").value = "Old response";
  hooks.handleProjectAiProfileNameInput();
  const saved = hooks.saveProjectAiProfile();
  hooks.expire();
  finishSave({ ok: true, status: 200, json: async () => ({ ok: true, accountKey: "profile_account_key_12345678901234567890", user: { displayName: "Old response" } }) });
  assert.equal(await saved, false);
  assert.equal(document.getElementById("projectAiProfileForm").hidden, true);
  assert.equal(document.getElementById("projectAiDisplayName").value, "");
  assert.equal(document.querySelector(".project-ai-account-trigger-label").textContent, "Continue with Google");
});

test("name validation accepts 80 Unicode points and rejects longer names and multiline/control text", async () => {
  const { document } = parseHTML(fs.readFileSync(path.join(__dirname, "../public/avr.html"), "utf8"));
  let calls = 0;
  const hooks = loadAvrFrontendFunctionHooks([
    "saveProjectAiProfile", "handleProjectAiProfileNameInput",
    "prepare() { projectAiAuthSession = {mode:'google',configured:true,authenticated:true,accountKey:'profile_account_key_12345678901234567890',user:{displayName:'David'}}; renderProjectAiAuthSession(projectAiAuthSession); }",
  ], { document, fetch: async (_, options) => {
    calls++;
    return { ok: true, status: 200, json: async () => ({ ok: true, accountKey: "profile_account_key_12345678901234567890", user: { displayName: JSON.parse(options.body).displayName } }) };
  } });
  hooks.prepare();
  const input = document.getElementById("projectAiDisplayName");
  for (const name of ["🙂".repeat(81), "David\nTest", "David\u2028Test", "David\u202eTest", "David\ud800Test"]) {
    input.value = name;
    hooks.handleProjectAiProfileNameInput();
    assert.equal(await hooks.saveProjectAiProfile(), false);
    assert.equal(input.getAttribute("aria-invalid"), "true");
  }
  assert.equal(calls, 0);
  input.value = "🙂".repeat(80);
  hooks.handleProjectAiProfileNameInput();
  assert.equal(await hooks.saveProjectAiProfile(), true);
  assert.equal(calls, 1);
});

test("an account switch clears the previous account's unsaved name even when masked emails match", () => {
  const { document } = parseHTML(fs.readFileSync(path.join(__dirname, "../public/avr.html"), "utf8"));
  const hooks = loadAvrFrontendFunctionHooks([
    "handleProjectAiProfileNameInput",
    "session(value) { projectAiAuthSession = value; renderProjectAiAuthSession(value); }",
  ], { document });
  const session = { mode: "google", configured: true, authenticated: true,
    accountKey: "account_a_123456789012345678901234567890", user: { displayName: "Account A", emailMasked: "d***@example.com" } };
  hooks.session(session);
  const input = document.getElementById("projectAiDisplayName");
  input.value = "A's unfinished name";
  hooks.handleProjectAiProfileNameInput();
  hooks.session({ ...session, accountKey: "account_b_123456789012345678901234567890", user: { ...session.user, displayName: "Account B" } });
  assert.equal(input.value, "Account B");
  assert.equal(document.getElementById("projectAiProfileSaveBtn").disabled, true);
});

test("a session read started before a name save cannot restore the former name", async () => {
  const { document } = parseHTML(fs.readFileSync(path.join(__dirname, "../public/avr.html"), "utf8"));
  const key = "profile_account_key_12345678901234567890";
  let finishRead;
  const hooks = loadAvrFrontendFunctionHooks([
    "fetchProjectAiAuthSession", "saveProjectAiProfile", "handleProjectAiProfileNameInput",
    "prepare() { projectAiAuthSession = {mode:'google',configured:true,authenticated:true,accountKey:'profile_account_key_12345678901234567890',user:{displayName:'David'}}; renderProjectAiAuthSession(projectAiAuthSession); }",
  ], { document, fetch: (url) => url.endsWith("/auth/session")
    ? new Promise(resolve => { finishRead = resolve; })
    : Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, accountKey: key, user: { displayName: "New name" } }) }) });
  hooks.prepare();
  const oldRead = hooks.fetchProjectAiAuthSession();
  document.getElementById("projectAiDisplayName").value = "New name";
  hooks.handleProjectAiProfileNameInput();
  assert.equal(await hooks.saveProjectAiProfile(), true);
  finishRead({ ok: true, status: 200, json: async () => ({ ok: true, mode: "google", configured: true, authenticated: true, accountKey: key, user: { displayName: "David" } }) });
  await oldRead;
  assert.equal(document.querySelector(".project-ai-account-trigger-label").textContent, "New name");
  assert.equal(document.getElementById("projectAiDisplayName").value, "New name");
});

test("a name save preserves an in-flight canvas result while a real account switch rejects it and its quota", async () => {
  for (const changeAccount of [false, true]) {
    const { document } = parseHTML(fs.readFileSync(path.join(__dirname, "../public/avr.html"), "utf8"));
    let finishCanvas;
    const hooks = loadAvrFrontendFunctionHooks([
      "submitProjectCanvas", "saveProjectAiProfile", "handleProjectAiProfileNameInput",
      `prepare() {
        projectInstructionDocument = normalizeProjectInstructionDocument({ schemaVersion:2, revision:3, markdown:'Blink LED', annotations:[] });
        projectAiAuthSession = {mode:'google',configured:true,authenticated:true,accountKey:'profile_account_key_12345678901234567890',user:{displayName:'David'},quota:{unlimited:true}};
        renderProjectAiAuthSession(projectAiAuthSession);
        getCanvasTarget = () => ({ mcu:'attiny1624', packageName:'SOIC-14' });
        appendProjectAiThinking = () => null;
        removeProjectAiThinking = () => {};
        applyProjectInstructionMarkdown = markdown => { window.appliedCanvas = markdown; };
        fetchProjectAiAuthSession = async () => projectAiAuthSession;
      }`,
      `changeAccount() {
        projectAiAuthSession = {...projectAiAuthSession,accountKey:'other_account_key_123456789012345678901',user:{displayName:'Other'},quota:{granted:100,remaining:80}};
        renderProjectAiAuthSession(projectAiAuthSession);
      }`,
      "applied() { return window.appliedCanvas; }",
    ], { document, fetch: (url) => url.endsWith("/canvas")
      ? new Promise(resolve => { finishCanvas = resolve; })
      : Promise.resolve({ ok:true, status:200, json:async()=>({ok:true,accountKey:"profile_account_key_12345678901234567890",user:{displayName:"New name"}}) }) });
    hooks.prepare();
    const canvasRequest = hooks.submitProjectCanvas();
    document.getElementById("projectAiDisplayName").value = "New name";
    hooks.handleProjectAiProfileNameInput();
    assert.equal(await hooks.saveProjectAiProfile(), true);
    if (changeAccount) hooks.changeAccount();
    finishCanvas({ ok:true, status:200, headers:{get:()=>"application/json"}, json:async()=>({ok:true,kind:"canvas",baseRevision:3,
      canvas:{schemaVersion:2,revision:4,markdown:"AI added details",annotations:[]},quota:{unlimited:true},message:"Canvas updated."}) });
    await canvasRequest;
    if (changeAccount) {
      assert.equal(hooks.applied(), undefined);
      assert.ok(hooks.notifications().some(record => /account changed/.test(record.message) && record.tone === "error"));
      assert.equal(document.getElementById("projectAiBudgetValue").textContent, "80 / 100");
    } else {
      assert.equal(hooks.applied(), "AI added details");
      assert.ok(hooks.notifications().some(record => record.message === "Canvas updated." && record.tone === "success"));
    }
  }
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
  assert.match(nginxLocation, /^\s*limit_conn\s+uartdebug_conn_per_ip\s+16;/m);
  assert.match(oauthCallbackLocation, /^\s*limit_conn\s+uartdebug_conn_per_ip\s+16;/m);
  assert.match(
    oauthCallbackLocation,
    /location = \/api\/avr\/ai\/auth\/google\/callback\s*\{[\s\S]*?access_log off;/
  );
  assert.match(oauthLogRedaction, /BEGIN uartdebug-ai-oauth-callback/);
  assert.match(oauthLogRedaction, /unmanaged exact OAuth callback location/);
  assert.match(serverSource, /AI_MAX_CONCURRENT/);
  assert.match(serverSource, /const DEFAULT_MAX_CONCURRENT\s*=\s*2;/);
  assert.match(serverSource, /if \(concurrentRequests >= maxConcurrent\)/);
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

test("migrates only the AI transport limit and remains idempotent without changing compiler or callback limits", (t) => {
  if (process.platform === "win32") {
    t.skip("The privileged nginx migration is executed with isolated filesystem tools on Linux");
    return;
  }
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "uartdebug-ai-transport-"));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const bin = path.join(tempRoot, "bin");
  fs.mkdirSync(bin);
  // CI can exercise the actual awk migration without changing file owners.
  fs.writeFileSync(path.join(bin, "install"), [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    'test "$#" -eq 8',
    'test "$1" = -o && test "$2" = root && test "$3" = -g && test "$4" = root',
    'test "$5" = -m',
    'mode="$6"',
    "shift 6",
    'cp -- "$1" "$2"',
    'chmod "$mode" "$2"',
    "",
  ].join("\n"), { mode: 0o755 });
  const limitsFile = path.join(tempRoot, "limits.conf");
  const siteFile = path.join(tempRoot, "site.conf");
  const compilerZone = "limit_req_zone $binary_remote_addr zone=uartdebug_compile_per_ip:10m rate=5r/m;";
  fs.writeFileSync(limitsFile, [
    "limit_conn_zone $binary_remote_addr zone=uartdebug_conn_per_ip:10m;",
    "limit_req_zone $binary_remote_addr zone=uartdebug_ai_per_ip:10m rate=5r/m;",
    compilerZone,
    "",
  ].join("\n"));
  const compilerBlock = [
    "    location ^~ /api/avr/ {",
    "        limit_req zone=uartdebug_compile_per_ip burst=5 nodelay;",
    "        limit_conn uartdebug_conn_per_ip 3;",
    "        proxy_pass http://127.0.0.1:8082;",
    "    }",
  ].join("\n");
  const callbackBlock = [
    "    location = /api/avr/ai/auth/google/callback {",
    "        access_log off;",
    "        limit_conn uartdebug_conn_per_ip 2;",
    "        proxy_pass http://127.0.0.1:8083;",
    "    }",
  ].join("\n");
  fs.writeFileSync(siteFile, [
    "server {",
    "    location ^~ /api/avr/ai/ {",
    "        # Preserve braces in comments: } {",
    "        limit_req zone=uartdebug_ai_per_ip burst=5 nodelay;",
    "        limit_conn uartdebug_conn_per_ip 2;",
    "        proxy_pass http://127.0.0.1:8083;",
    "    }",
    compilerBlock,
    callbackBlock,
    "}",
    "",
  ].join("\n"));
  const script = path.join(__dirname, "../backend/deploy/remove-ai-request-limits.sh");
  let firstSite;
  let firstLimits;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = childProcess.spawnSync("bash", [script, limitsFile, siteFile], {
      encoding: "utf8", env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH },
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const site = fs.readFileSync(siteFile, "utf8");
    const limits = fs.readFileSync(limitsFile, "utf8");
    assert.match(site, /location \^~ \/api\/avr\/ai\/ \{[\s\S]*?limit_conn uartdebug_conn_per_ip 16;/);
    assert.doesNotMatch(site, /limit_req zone=uartdebug_ai_per_ip/);
    assert.ok(site.includes(compilerBlock), "Compiler transport and rate limits must be preserved");
    assert.ok(site.includes(callbackBlock), "The callback is managed by its separate exact-route installer");
    assert.ok(limits.includes(compilerZone));
    assert.doesNotMatch(limits, /zone=uartdebug_ai_per_ip/);
    if (attempt === 0) { firstSite = site; firstLimits = limits; }
    else { assert.equal(site, firstSite); assert.equal(limits, firstLimits); }
  }
});

test("installs the release AI unit before restarting the service", () => {
  const deployWorkflow = fs.readFileSync(
    path.join(__dirname, "../.github/workflows/deploy.yml"),
    "utf8"
  );
  const verifyUnit = deployWorkflow.indexOf(
    'run_sudo systemd-analyze verify "${BE_SRC}/deploy/uartdebug-ai.service"'
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
  assert.ok(verifyUnit < deployWorkflow.indexOf('ln -sfn "$BE_NEW" "$BE_DIR"'),
    "the staged unit must be checked before release activation");
  assert.ok(deployWorkflow.indexOf('run_sudo systemd-analyze verify "${rollback_be_target}/deploy/uartdebug-ai.service"') <
    deployWorkflow.indexOf('ln -sfn "${rollback_be_target}" "${BE_DIR}"'),
    "rollback must also validate its target unit before release activation");
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

test("deploys the canonical materials loader instead of the old skill catalog", () => {
  const installer = fs.readFileSync(
    path.join(__dirname, "../backend/deploy/install-ai-service.sh"),
    "utf8"
  );

  assert.match(installer, /loadKnowledge/);
  assert.match(installer, /avr-materials\.js/);
  const unit = fs.readFileSync(path.join(__dirname, "../backend/deploy/uartdebug-ai.service"), "utf8");
  assert.match(unit, /AI_MATERIALS_ROOT=.*materials\/current\/repository/);
  assert.doesNotMatch(installer, /loadAiSkillCatalog/);
});

test("gives Add file enough width and lets catalog text wrap", () => {
  const css = fs.readFileSync(
    path.join(__dirname, "../public/AVR-Programming.css"),
    "utf8"
  );

  assert.match(
    css,
    /\.files-dialog\s*\{[\s\S]*?width:\s*min\(96vw,\s*1100px\);/
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

test("separates the ordered hardware controls from project and notification cards", () => {
  const html = fs.readFileSync(path.join(__dirname, "../public/avr.html"), "utf8");
  const { document } = parseHTML(html);
  const code = document.getElementById("editorWorkspace");
  const targets = document.getElementById("avrTargetPanelViewport");
  const hardware = document.getElementById("avrDevicePanelViewport");
  assert.ok(hardware.contains(targets), "the hardware frame owns the project target fields");
  assert.equal(targets.classList.contains("avr-target-panel-viewport"), false,
    "the target group must not create a nested viewport or second height animation");
  assert.deepEqual(Array.from(targets.querySelectorAll("select"), el => el.id), ["mcuSelect", "projectPackageSelect"]);
  const steps = Array.from(targets.querySelectorAll(".hardware-flow > .hardware-step"));
  assert.equal(steps.length, 4);
  for (const [index, id] of ["detectChipBtn", "adapterStatusText", "mcuSelect", "projectPackageSelect"].entries()) {
    assert.ok(steps[index].contains(document.getElementById(id)), `${id} belongs to its ordered hardware step`);
  }
  assert.equal(document.getElementById("chipStatusText"), null, "one primary chip field replaces the separate detected result");
  assert.equal(targets.querySelector(".hardware-step-caption, .hardware-step-detail"), null);
  assert.equal(document.getElementById("mcuSelect").getAttribute("data-control-caption"), "Chip");
  assert.equal(document.getElementById("projectPackageSelect").getAttribute("data-control-caption"), "Package");
  assert.equal(document.getElementById("mcuSelect").hasAttribute("data-placeholder-icon"), false);
  assert.equal(document.getElementById("projectPackageSelect").hasAttribute("data-placeholder-icon"), false);
  const originalButton = document.getElementById("detectChipBtn");
  assert.equal(originalButton.className, "detect-chip-btn");
  assert.equal(originalButton.querySelector("svg"), null);
  assert.equal(originalButton.querySelector("[data-detect-default]").textContent.trim(), "Disconnected");
  assert.equal(originalButton.querySelector("[data-detect-hover]").textContent.trim(), "Click to detect the chip");
  assert.equal(document.getElementById("adapterStatusText").querySelector("button, select"), null,
    "the port readout must not imply a separate picker");
  assert.equal(code.querySelector("select"), null);
  for (const id of ["projectAiBudget", "projectAiAuth"]) {
    assert.equal(document.querySelectorAll(`#${id}`).length, 1);
    assert.ok(document.getElementById("avrAccountPanelViewport").contains(document.getElementById(id)));
  }
  assert.deepEqual(Array.from(document.querySelector(".avr-overview-row").children, el => el.id),
    ["avrDevicePanelViewport", "avrActionsPanelViewport", "avrAccountPanelViewport"]);
  assert.equal(document.querySelectorAll(".avr-overview-row > .avr-overview-viewport").length, 3);
  assert.equal(document.querySelector("#projectCanvasForm select"), null);
  assert.equal(document.getElementById("moreOptionsBtn"), null);
  assert.equal(document.getElementById("canvasUpdiSection"), null);
  assert.equal(code.querySelector("#editorCollapseBtn"), null);
  const notifications = document.querySelector("[data-notifications-open]");
  assert.ok(notifications, "the notification history must have a reachable control");
  const actions = document.querySelector("#avrActionsPanelViewport > .avr-action-panel");
  assert.ok(actions);
  assert.equal(actions.classList.contains("ui-panel"), false, "the action grid has no shared frame");
  const projects = document.getElementById("filesOpenBtn");
  const cards = Array.from(actions.querySelectorAll(":scope > .avr-action-card.ui-panel"));
  assert.equal(cards.length, 2);
  assert.ok(cards[0].contains(projects), "projects have an independent card surface");
  assert.ok(cards[1].contains(notifications), "notifications have an independent card surface");
  for (const trigger of [projects, notifications, document.getElementById("projectAiAccountBtn")]) {
    assert.ok(trigger.classList.contains("avr-panel-trigger"));
  }
  assert.equal(hardware.contains(actions), false);
  assert.match(cards[0].textContent, /Projects/);
  assert.match(cards[1].textContent, /Notifications/);
  assert.equal(notifications.getAttribute("aria-controls"), "notificationModal");
  for (const id of ["compileLog", "projectCanvasStatus", "projectInstructionSaveState", "projectAiAccountStatus", "projectDocumentationNotice"]) {
    assert.equal(document.getElementById(id), null, `${id} must not duplicate notification history inside a workspace pane`);
  }
  const controlsIndex = html.indexOf('src="ui-controls.js');
  const notificationsIndex = html.indexOf('src="ui-notifications.js');
  const workspaceIndex = html.indexOf('src="AVR-Programming.js');
  assert.ok(controlsIndex >= 0 && notificationsIndex > controlsIndex && workspaceIndex > notificationsIndex,
    "shared controls and notifications must load before workspace producers");
});

function compactTargetFixture(catalog) {
  const { document } = parseHTML('<html><body><select id="mcuSelect"><option value="attiny1614">ATtiny1614</option><option value="attiny1624">ATtiny1624</option></select><select id="projectPackageSelect"><option value="SOIC-14" selected>SOIC-14</option></select></body></html>');
  for (const select of document.querySelectorAll("select")) {
    Object.defineProperty(select, "value", {
      configurable: true,
      get() { return this.querySelector("option[selected]")?.value || this.options[0]?.value || ""; },
      set(value) { for (const option of this.options) {
        if (option.value === String(value)) option.setAttribute("selected", "");
        else option.removeAttribute("selected");
      } },
    });
  }
  let detected = "";
  const hooks = loadAvrFrontendFunctionHooks([
    "syncCanvasTargetControls", "buildCompileProjectSnapshot", "getCanvasTarget", "loadCompiledHexArtifact", "getUpdiHexArtifact",
    `prepare(catalog) {
      canvasSupportedDevices = catalog;
      current = "main.c";
      files = { "main.c": "int main(void) { return 0; }" };
      editor = null;
      getCompileProjectFileNames = () => ({ requiredFiles: ["main.c"], compileSourceNames: ["main.c"] });
      refreshTargetPresentation = () => {};
      updateHexUI = () => {};
      setHexStatus = () => {};
      dispatchUpdiHexArtifact = () => {};
    }`,
    "setCatalog(catalog) { canvasSupportedDevices = catalog; }",
  ], { document, window: { __UARTDEBUG_AVR_PROGRAMMING_UPDI_BRIDGE__: { getDetectedTargetKey: () => detected } } });
  hooks.prepare(catalog);
  return { hooks, document, detect: value => { detected = value; } };
}

const compactTargetCatalog = [
  { mcu: "attiny1614", packages: ["SOIC-14"] },
  { mcu: "attiny1624", packages: ["SOIC-14", "TSSOP-14"] },
];

test("a detected replacement keeps a supported package across MCU changes and clears an unsupported one", () => {
  const { hooks, document, detect } = compactTargetFixture(compactTargetCatalog);
  const chip = document.getElementById("mcuSelect"), packageSelect = document.getElementById("projectPackageSelect");
  hooks.syncCanvasTargetControls();
  assert.equal(packageSelect.value, "SOIC-14");
  detect("attiny1624");
  hooks.syncCanvasTargetControls();
  assert.equal(chip.value, "attiny1624");
  assert.equal(packageSelect.value, "SOIC-14");
  packageSelect.value = "TSSOP-14";
  detect("attiny1614");
  hooks.syncCanvasTargetControls();
  assert.equal(chip.value, "attiny1614");
  assert.equal(packageSelect.value, "");
});

test("a delayed package catalog preserves its candidate until replacement support can be checked", () => {
  const { hooks, document, detect } = compactTargetFixture(null);
  const packageSelect = document.getElementById("projectPackageSelect");
  detect("attiny1624");
  hooks.syncCanvasTargetControls();
  assert.equal(packageSelect.dataset.pendingPackage, "SOIC-14");
  assert.equal(packageSelect.disabled, true);
  hooks.setCatalog(compactTargetCatalog);
  hooks.syncCanvasTargetControls();
  assert.equal(packageSelect.value, "SOIC-14");
  assert.equal(packageSelect.disabled, false);
  assert.equal(packageSelect.dataset.pendingPackage, undefined);
});

test("compile cache identity includes the effective MCU even when project sources do not change", () => {
  const { hooks, document, detect } = compactTargetFixture(compactTargetCatalog);
  const first = JSON.parse(hooks.buildCompileProjectSnapshot("main.c").sourceKey);
  document.getElementById("mcuSelect").value = "attiny1624";
  const second = JSON.parse(hooks.buildCompileProjectSnapshot("main.c").sourceKey);
  assert.equal(first.mcu, "attiny1614");
  assert.equal(second.mcu, "attiny1624");
  assert.deepEqual(first.projectFiles, second.projectFiles);
  detect("attiny1614");
  const connected = JSON.parse(hooks.buildCompileProjectSnapshot("main.c").sourceKey);
  assert.deepEqual(connected, first, "a known physical target also controls cache identity");
});

test("loading cached compiled HEX preserves its build MCU through the runtime and bridge", () => {
  const { hooks } = compactTargetFixture(compactTargetCatalog);
  const calls = [];
  assert.equal(hooks.loadCompiledHexArtifact({ loadHexFile: (...args) => calls.push(args) }, {
    hexText: ":0100000000FF\n:00000001FF", hexName: "main.hex", targetMcu: "attiny1614",
  }), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][2], "compiled");
  assert.equal(calls[0][3], "attiny1614");
  assert.equal(hooks.getUpdiHexArtifact().targetMcu, "attiny1614");
});

function pendingCompileFixture(fetch, timers = {}) {
  const { document } = parseHTML('<html><body><button id="compileBtn"></button></body></html>');
  const loaded = [];
  const hooks = loadAvrFrontendFunctionHooks([
    "compileCurrentFile", "ensureCurrentCompiledHexLoaded", "downloadHexForFile", "getHexArtifactForFile", "getUpdiHexArtifact",
    `prepare() {
      current = "main.c";
      files = { "main.c": '#include "board.h"\\nint main(void) { return VALUE; }', "board.h": "#define VALUE 0" };
      editor = null;
      getCanvasTarget = () => ({ mcu: window.__compileTarget });
      getMiniProjectForFile = name => files[name] === undefined ? null : ({ instanceId: window.__compileProject });
      dispatchUpdiHexArtifact = () => {};
      downloadHexArtifact = () => { window.__compileDownloads++; return true; };
    }`,
    `change(kind) {
      if (kind === "source") files["main.c"] += "\\n// New edit";
      if (kind === "header") files["board.h"] = "#define VALUE 1";
      if (kind === "mcu") window.__compileTarget = "attiny1624";
      if (kind === "project") window.__compileProject = "replacement-project";
      if (kind === "account") projectAiAccountWorkspaceEpoch++;
    }`,
    `lateEditCompiler() {
      compileCurrentFile = async () => {
        const snapshot = buildCompileProjectSnapshot(current);
        storeHexArtifact(current, "HEX", "main.hex", files[current], snapshot.sourceKey, window.__compileTarget);
        files[current] += "\\n// Edited after request";
        return true;
      };
    }`,
    `failAutoDetection() {
      getCanvasTarget = () => ({ mcu: "auto" });
      ensureAutoDetectedTarget = async ({ notificationId }) => {
        window.UartDebugNotifications.notify({ id: notificationId, title: "Compilation",
          message: "The chip could not be reached.", details: "Check the adapter and UPDI connection.", tone: "error", pending: false });
        const error = new Error("Timed out waiting for echo of 1 byte(s).");
        error.uartDebugNotificationId = notificationId;
        throw error;
      };
    }`,
    "downloads() { return window.__compileDownloads; }",
  ], { document, fetch, ...timers, window: { __compileTarget: "attiny1614", __compileProject: "project", __compileDownloads: 0,
    __UARTDEBUG_AVR_PROGRAMMING_UPDI__: { loadHexFile: (...args) => loaded.push(args) } } });
  hooks.prepare();
  return { hooks, loaded, document };
}

test("compiler results use the exact requested snapshot and reject source, header, target or project changes", async () => {
  for (const change of [null, "source", "header", "mcu", "project", "account"]) {
    let finish, payload, requests = 0;
    const { hooks } = pendingCompileFixture((url, init) => {
      requests++; payload = JSON.parse(init.body);
      return new Promise(resolve => { finish = resolve; });
    });
    const compiling = hooks.compileCurrentFile();
    assert.equal(await hooks.compileCurrentFile(), false, "a second caller must not begin another build");
    assert.equal(requests, 1);
    if (change) hooks.change(change);
    finish({ ok: true, async json() { return { ok: true, hex: "HEX", hex_name: "main.hex" }; } });
    assert.equal(await compiling, !change, change || "unchanged");
    const artifact = hooks.getHexArtifactForFile("main.c");
    if (change) {
      assert.equal(artifact, null, change);
      assert.equal(hooks.getUpdiHexArtifact().hexText, "");
      assert.match(hooks.notifications().at(-1).message, /project changed/i);
    } else {
      assert.equal(artifact.sourceText, payload.code);
      assert.deepEqual(JSON.parse(artifact.sourceKey), { mcu: payload.mcu, projectFiles: payload.project_files });
    }
  }
});

test("changes while the compiler response body is arriving cannot load or cache old firmware", async () => {
  let receiveBody;
  const { hooks, loaded } = pendingCompileFixture(async () => ({ ok: true,
    json: () => new Promise(resolve => { receiveBody = resolve; }),
  }));
  const flashing = hooks.ensureCurrentCompiledHexLoaded({ loadHexFile: (...args) => loaded.push(args) });
  while (!receiveBody) await Promise.resolve();
  hooks.change("source");
  receiveBody({ ok: true, hex: "OLD" });
  assert.equal(await flashing, false);
  assert.equal(hooks.getHexArtifactForFile("main.c"), null);
  assert.equal(loaded.length, 0);
});

test("flash and download recheck a compiled artifact after their awaited build returns", async () => {
  for (const action of ["flash", "download"]) {
    const { hooks, loaded } = pendingCompileFixture(async () => { throw new Error("Must use injected build"); });
    hooks.lateEditCompiler();
    if (action === "flash") assert.equal(await hooks.ensureCurrentCompiledHexLoaded({ loadHexFile: (...args) => loaded.push(args) }), false);
    else await hooks.downloadHexForFile("main.c");
    assert.equal(loaded.length, 0);
    assert.equal(hooks.downloads(), 0);
  }
});

test("the whole compiler response has a deadline, releases its guard and cannot publish a late body", async () => {
  let fireDeadline, completeBody, signal, cancelled = 0, budget, sequence = 0, requestTimer;
  const { hooks, document } = pendingCompileFixture(async (url, init) => {
    signal = init.signal;
    return { ok: true, json: () => new Promise(resolve => { completeBody = resolve; }) };
  }, { setTimeout(callback, milliseconds) {
    const timer = ++sequence;
    if (milliseconds >= 60000) { fireDeadline = callback; budget = milliseconds; requestTimer = timer; }
    return timer;
  }, clearTimeout(timer) { if (timer === requestTimer) cancelled++; } });
  const compiling = hooks.compileCurrentFile();
  while (!completeBody) await Promise.resolve();
  assert.equal(budget, 80000, "one C unit includes linker, HEX and transport headroom");
  fireDeadline();
  assert.equal(await compiling, false);
  assert.equal(signal.aborted, true);
  assert.equal(cancelled, 1);
  assert.equal(document.getElementById("compileBtn").disabled, false);
  assert.match(hooks.notifications().at(-1).message, /did not respond in time/);
  completeBody({ ok: true, hex: "LATE" });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(hooks.getHexArtifactForFile("main.c"), null);
});

test("compilation preserves an already published human-readable auto-detection failure", async () => {
  const { hooks } = pendingCompileFixture(async () => { throw new Error("Compiler must not run"); });
  hooks.failAutoDetection();
  assert.equal(await hooks.compileCurrentFile(), false);
  const notices = hooks.notifications();
  assert.equal(notices.length, 1);
  assert.equal(notices[0].message, "The chip could not be reached.");
  assert.equal(notices[0].pending, false);
  assert.doesNotMatch(notices[0].message, /echo|Timed out/);
});

test("proxy HTML and server stack responses are not presented as source-code compiler errors", async () => {
  for (const raw of ["<!DOCTYPE html><html><body>Bad Gateway</body></html>", "Error: Internal compiler wrapper error\n    at run (/server/compiler.js:15:3)"]) {
    const { hooks } = pendingCompileFixture(async () => ({ ok: false, status: 502, async text() { return raw; } }));
    assert.equal(await hooks.compileCurrentFile(), false);
    const notice = hooks.notifications().at(-1);
    assert.equal(notice.message, "The compile server could not complete the request.");
    assert.doesNotMatch(notice.details, /<html>|compiler\.js| at run/);
  }
});

test("existing desktop dialogs share one modal surface while retaining their dimensions", () => {
  const { document } = parseHTML(fs.readFileSync(path.join(__dirname, "../public/avr.html"), "utf8"));
  for (const id of ["filesModal", "projectAiAccountModal", "siteDialog"]) {
    const modal = document.getElementById(id);
    assert.ok(modal.classList.contains("ui-modal"), id);
    assert.ok(modal.querySelector(".ui-dialog-card"), id);
    assert.ok(modal.querySelector(".ui-dialog-header"), id);
    assert.ok(modal.querySelector(".ui-dialog-close"), id);
    assert.ok(modal.querySelector(".ui-dialog-body"), id);
  }
  assert.ok(document.querySelector("#siteDialog .ui-dialog-actions"));
  const { document: uartDocument } = parseHTML(fs.readFileSync(path.join(__dirname, "../public/uart.html"), "utf8"));
  const settings = uartDocument.getElementById("settingsModal");
  assert.ok(settings.classList.contains("ui-modal"));
  assert.ok(settings.querySelector(".ui-dialog-card"));
  assert.ok(settings.querySelector(".ui-dialog-body"));
});

test("compiler notifications retain full diagnostics while updating one operation record", () => {
  const hooks = loadAvrFrontendFunctionHooks(["reportCompilerStatus", "showCompilerIssue", "collectCompilerErrorText"]);
  hooks.reportCompilerStatus("Compiling ...", { tone: "info", pending: true });
  const started = hooks.notifications()[0];
  assert.equal(started.pending, true);
  const issue = hooks.showCompilerIssue({
    compile_stderr: "board.c:9:4: error: expected ';' before '<' token\nboard.c:12:2: error: unknown identifier PINx\n",
    compile_stdout: "Compiler target: ATtiny1624\nAdditional diagnostic context retained.",
  }, "HTTP diagnostic body", "main.c");
  assert.equal(issue.fileName, "board.c");
  assert.equal(issue.lineNumber, 9);
  assert.equal(issue.columnNumber, 4);
  const records = hooks.notifications();
  assert.equal(records.length, 1);
  assert.equal(records[0].id, started.id);
  assert.equal(records[0].tone, "error");
  assert.equal(records[0].pending, false);
  assert.equal(records[0].message, "expected ';' before '<' token (line 9, column 4)");
  assert.match(records[0].details, /ERROR\..*Line 9, position 4/);
  assert.match(records[0].details, /board\.c:12:2: error: unknown identifier PINx/);
  assert.match(records[0].details, /Additional diagnostic context retained/);
  assert.doesNotMatch(records[0].details, /HTTP diagnostic body/,
    "parsed diagnostics must not be duplicated by their raw HTTP body");
  assert.equal(hooks.collectCompilerErrorText({ error: { message: "Structured compiler error" } }, '{"error":{"message":"Structured compiler error"}}'),
    "Structured compiler error");
  assert.equal(hooks.collectCompilerErrorText(null, "Unstructured compiler response"), "Unstructured compiler response");
});

test("informational alert paths report details without opening a blocking confirmation", async () => {
  const hooks = loadAvrFrontendFunctionHooks(["showSiteAlert",
    "prepare() { showSiteDialog = () => { throw new Error('An informational alert must not block'); }; }"]);
  hooks.prepare();
  await hooks.showSiteAlert("Import failed.\nFull parser detail on the second line.", "Project import");
  const records = hooks.notifications();
  assert.equal(records.length, 1);
  assert.equal(records[0].title, "Project import");
  assert.equal(records[0].message, "Import failed.");
  assert.equal(records[0].details, "Import failed.\nFull parser detail on the second line.");
});

test("the same account and workspace failure has one notification with its complete details", () => {
  const hooks = loadAvrFrontendFunctionHooks(["reportProjectCanvasMessage", "setProjectAiAccountStatus"]);
  const message = "Cloud saving was paused.\nNewer local project data was retained.";
  hooks.reportProjectCanvasMessage("system", message);
  const id = hooks.notifications()[0].id;
  hooks.setProjectAiAccountStatus(message, "error");
  hooks.setProjectAiAccountStatus(message, "error");
  hooks.reportProjectCanvasMessage("", "");
  hooks.setProjectAiAccountStatus();
  const records = hooks.notifications();
  assert.equal(records.length, 1);
  assert.equal(records[0].id, id);
  assert.equal(records[0].message, "Cloud saving was paused.");
  assert.equal(records[0].details, message);
  assert.equal(records[0].tone, "error");
});

test("AI progress and completion keep stage attempts and the final result in one notification", () => {
  const hooks = loadAvrFrontendFunctionHooks(["appendProjectAiThinking", "renderProjectAiThinkingProgress", "reportProjectCanvasMessage", "removeProjectAiThinking",
    "start() { projectAiRequestInFlight = true; }"]);
  hooks.start();
  const operation = hooks.appendProjectAiThinking();
  assert.equal(hooks.notifications().length, 1);
  hooks.renderProjectAiThinkingProgress(operation, { status: "in_progress", stages: [
    { id: "generation", status: "completed", attempt: 1 },
    { id: "compilation", status: "failed", attempt: 1 },
  ] });
  hooks.renderProjectAiThinkingProgress(operation, { status: "completed", stages: [
    { id: "repair", status: "completed", attempt: 2 },
  ] }, { status: "passed", mcu: "ATtiny1624" });
  hooks.reportProjectCanvasMessage("assistant", "Specification reviewed.\nThe current canvas is saved.", operation.id);
  hooks.removeProjectAiThinking(operation);
  const records = hooks.notifications();
  assert.equal(records.length, 1);
  assert.equal(records[0].id, operation.id);
  assert.equal(records[0].message, "Specification reviewed.");
  assert.equal(records[0].tone, "success");
  assert.equal(records[0].pending, false);
  assert.match(records[0].details, /Response generated/);
  assert.match(records[0].details, /Compiler check found a problem/);
  assert.match(records[0].details, /Compiler error repaired · attempt 2/);
  assert.match(records[0].details, /The current canvas is saved/);
});

test("background account feedback cannot finish or overwrite an active AI notification", () => {
  const hooks = loadAvrFrontendFunctionHooks(["appendProjectAiThinking", "reportProjectCanvasMessage",
    "start() { projectAiRequestInFlight = true; }"]);
  hooks.start();
  const operation = hooks.appendProjectAiThinking();
  hooks.reportProjectCanvasMessage("system", "Cloud saving was paused.\nThe local project copy remains saved.");
  const records = hooks.notifications();
  assert.equal(records.length, 2);
  const progress = records.find(record => record.id === operation.id);
  assert.equal(progress.pending, true);
  assert.equal(progress.message, "Analyzing the canvas…");
  assert.equal(progress.tone, "info");
  const background = records.find(record => record.id !== operation.id);
  assert.equal(background.pending, false);
  assert.equal(background.tone, "error");
  assert.equal(background.message, "Cloud saving was paused.");
  assert.match(background.details, /The local project copy remains saved/);
  hooks.reportProjectCanvasMessage("assistant", "Specification reviewed.", operation.id);
  const completed = hooks.notifications();
  assert.equal(completed.length, 2);
  assert.equal(completed.find(record => record.id === operation.id).pending, false);
  assert.equal(completed.find(record => record.id !== operation.id).details, background.details);
});

test("saved built-in examples use English while preserving older description files", () => {
  const { hooks } = loadCanvasLifecycleHooks();
  const project = hooks.createEmptyProject();
  const snapshot = JSON.parse(JSON.stringify(hooks.getProjectAiAccountFilesSnapshot()));
  const saved = snapshot.miniProjects[project.instanceId];
  saved.origin = "builtin";
  saved.defaultLocale = saved.selectedLocale = "ru";
  snapshot.files["legacy.ru.md"] = "# Старое описание";
  saved.guides.ru = { fileName: "legacy.ru.md", locale: "ru", mediaType: "text/markdown" };
  assert.equal(hooks.applyProjectAiAccountWorkspace( snapshot), true);
  const restored = hooks.getPublicMiniProjectInstance(project.instanceId);
  assert.equal(restored.defaultLocale, "en");
  assert.equal(restored.selectedLocale, "en");
  assert.equal(hooks.getProjectAiAccountFilesSnapshot().files["legacy.ru.md"], "# Старое описание");
});

test("documentation uses one live Markdown surface without deferred actions or edit modes", () => {
  const html = fs.readFileSync(path.join(__dirname, "../public/avr.html"), "utf8");
  const source = fs.readFileSync(path.join(__dirname, "../public/AVR-Programming.js"), "utf8");
  const { document } = parseHTML(html);
  assert.equal(document.getElementById("documentationLocaleSelect"), null);
  assert.equal(document.querySelector(".documentation-locale-control"), null);
  assert.doesNotMatch(source, /documentationLocaleSelect|getDocumentationLocaleLabel/);
  for (const id of ["documentationEditToggle", "projectGenerateCodeBtn", "projectDescribeCodeBtn", "projectDocumentationContent"]) {
    assert.equal(document.getElementById(id), null, `${id} must not leave a second documentation mode or deferred action in the UI`);
  }
  const guide = document.getElementById("projectDocumentationPane");
  assert.ok(guide.querySelector("#projectDocumentationEditor"));
  assert.equal(guide.querySelector("button, .ui-panel-header, .panel-action-lobe"), null);
  assert.equal(guide.classList.contains("panel-action-host"), false);
  assert.equal(document.querySelectorAll(".panel-action-lobe").length, 2);
  assert.doesNotMatch(source, /documentationEditMode|setDocumentationEditMode|refreshDocumentationControls|documentationEditToggle/);
});

test("the native guide editor preserves authorship and saves directly without an edit toggle", () => {
  const { document } = parseHTML('<html><body><aside id="projectDocumentationPane"><div id="projectDocumentationScroll"><textarea id="projectDocumentationEditor"></textarea></div></aside></body></html>');
  const textarea = document.getElementById("projectDocumentationEditor");
  const hooks = loadAvrFrontendFunctionHooks([
    "bindDocumentationWorkspace", "refreshDocumentationPane", "saveDocumentationEditorValue",
    `prepare() {
      current = "main.c"; files["main.c"] = "// Unchanged code";
      files["guide.md"] = "# Title\\n\\nKept line\\n\\nOld line";
      fileAuthorship["guide.md"] = { schemaVersion: 1, lines: ["original", "original", "ai", "ai", "ai"] };
      getDocumentationContext = () => ({ guideFile: "guide.md" });
      refreshWorkspaceEditors = scheduleMarkdownLivePreview = persistState = () => {};
    }`,
    `readGuide() { return { markdown: files["guide.md"], authorship: getFileAuthorship("guide.md"), source: files["main.c"] }; }`,
    `replaceWorkspaceGuide() { files["guide.md"] = "# Cloud replacement"; files["other.md"] = "# Other guide"; getDocumentationContext = () => ({ guideFile: "other.md" }); }`,
    `removeGuide() { getDocumentationContext = () => ({ guideFile: "" }); }`,
  ], { document, window: { setTimeout: () => 1, clearTimeout() {} } });
  hooks.prepare();
  hooks.bindDocumentationWorkspace();
  hooks.refreshDocumentationPane();
  assert.equal(textarea.readOnly, false);
  assert.equal(textarea.getAttribute("aria-readonly"), "false");
  textarea.value = "# Title\n\nKept line\n\nEdited directly";
  textarea.dispatchEvent(new document.defaultView.Event("input"));
  const saved = hooks.readGuide();
  assert.equal(saved.markdown, textarea.value);
  assert.equal(saved.authorship.lines[0], "original");
  assert.equal(saved.authorship.lines[2], "ai");
  assert.equal(saved.authorship.lines[4], "human");
  assert.equal(saved.source, "// Unchanged code");
  hooks.replaceWorkspaceGuide();
  hooks.refreshDocumentationPane();
  assert.equal(textarea.value, "# Other guide");
  assert.equal(hooks.readGuide().markdown, "# Cloud replacement", "switching projects must not save an old buffer over a newer workspace snapshot");
  hooks.removeGuide();
  hooks.refreshDocumentationPane();
  assert.equal(textarea.value, "");
  assert.equal(textarea.readOnly, true);
  assert.equal(textarea.getAttribute("aria-readonly"), "true");
  assert.equal(hooks.readGuide().markdown, "# Cloud replacement");
});

test("code collapses from either boundary and retains desktop preferences as the PC window resizes", () => {
  const { document } = parseHTML(`<html><body><div class="canvas-split-container"><section id="editorWorkspace"><div id="editorContent"></div></section><div id="documentationResizer"></div></div></body></html>`);
  let width = 1564;
  const storage = new Map();
  document.querySelector(".canvas-split-container").getBoundingClientRect = () => ({ width });
  const hooks = loadAvrFrontendFunctionHooks([
    "restoreWorkspaceLayout", "resizeWorkspacePanel", "fitWorkspaceToViewport", "getWorkspaceWidths", "getWorkspacePanelSpecs", "resizeWorkspaceBoundary",
    "drag(boundary, delta) { renderWorkspaceWidths(resizeWorkspaceBoundary(getWorkspaceWidths(), getWorkspacePanelSpecs(), boundary, delta), { persist: true }); }",
  ], {
    document,
    window: {
      requestAnimationFrame: () => 1,
      localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    },
  });
  hooks.restoreWorkspaceLayout();
  hooks.drag(1, hooks.getWorkspaceWidths()[2] - 62);
  assert.equal(hooks.getWorkspaceWidths()[2], 62);
  assert.equal(document.getElementById("editorContent").hidden, true);
  hooks.drag(2, 500);
  assert.ok(hooks.getWorkspaceWidths()[2] >= hooks.getWorkspacePanelSpecs()[2].min);
  assert.equal(document.getElementById("editorContent").hidden, false);
  hooks.drag(2, 62 - hooks.getWorkspaceWidths()[2]);
  width = 1100;
  hooks.fitWorkspaceToViewport();
  assert.equal(hooks.getWorkspaceWidths()[2], 62);
  hooks.resizeWorkspacePanel(2, hooks.getWorkspacePanelSpecs()[2].min);
  assert.ok(hooks.getWorkspaceWidths()[2] >= hooks.getWorkspacePanelSpecs()[2].min);
  assert.equal(Array.from(hooks.getWorkspaceWidths()).reduce((a, b) => a + b), width - 42);
  hooks.drag(1, hooks.getWorkspaceWidths()[2] - hooks.getWorkspacePanelSpecs()[2].min + 120);
  assert.equal(storage.get("ud_avr_programming_editor_collapsed_v1"), "true");
  hooks.restoreWorkspaceLayout();
  assert.equal(document.getElementById("editorContent").hidden, true);
  width = 960;
  hooks.fitWorkspaceToViewport();
  assert.equal(document.getElementById("documentationResizer").getAttribute("aria-orientation"), "vertical");
  assert.equal(document.getElementById("editorContent").hidden, true);
  hooks.drag(2, 500);
  assert.equal(document.getElementById("editorContent").hidden, false);
  assert.equal(Array.from(hooks.getWorkspaceWidths()).reduce((a, b) => a + b), width - 42);
  assert.equal(storage.has("ud_avr_programming_row_sizes_v1"), false);
});

test("review sends an empty specification without requiring target selectors", async () => {
  const {document}=parseHTML('<html><body><button id="projectCanvasRunBtn"></button><form id="projectCanvasForm"></form></body></html>');
  let sent;
  const hooks=loadAvrFrontendFunctionHooks(["submitProjectCanvas","getProjectInstructionSnapshot",
    "prepare() { projectInstructionDocument = normalizeProjectInstructionDocument({markdown:'',revision:0}); appendProjectAiThinking=removeProjectAiThinking=()=>null; persistProjectInstruction=scheduleProjectInstructionPreview=()=>{}; }"],{
    document,fetch:async(url,options)=>{sent=JSON.parse(options.body);return {ok:true,status:200,headers:{get:()=>"application/json"},json:async()=>({ok:true,kind:"canvas",stage:"analyze",baseRevision:0,canvas:{schemaVersion:2,revision:1,markdown:"> ###### *[AI.1] Question.*\n>\n> What should the project do?",annotations:[]}})};},
    window:{requestAnimationFrame:()=>1,setTimeout:()=>1,clearTimeout(){},localStorage:{setItem(){}}}
  });
  hooks.prepare();
  await hooks.submitProjectCanvas();
  assert.equal(sent.operation,"analyze");
  assert.equal(sent.canvas.markdown,"");
  assert.equal(sent.mcu,"");
  assert.equal(sent.packageName,"");
  assert.match(hooks.getProjectInstructionSnapshot().markdown,/What should the project do/);
  assert.equal(document.getElementById("projectCanvasRunBtn").disabled,false);
  assert.equal(document.getElementById("projectGenerateCodeBtn"),null);
  assert.equal(document.getElementById("projectDescribeCodeBtn"),null);
});

test("compile shortcuts and file changes preserve an active UPDI notification and its details", async () => {
  const { document } = parseHTML('<html><body><button id="compileBtn"></button></body></html>');
  let busy = true;
  const runtime = { isBusy: () => busy };
  const hooks = loadAvrFrontendFunctionHooks([
    "updateCompilePanelState", "compileCurrentFile", "initUpdiBridge", "setHexStatus",
    "choose(name) { current = name; files[name] = '// Source'; }",
    "updiNotice() { return window.UartDebugNotifications.notify({title:'Flash MCU',message:'Writing page 1',details:'Writing page 1',pending:true,source:'UPDI'}); }",
  ], { document, window: { __UARTDEBUG_AVR_PROGRAMMING_UPDI__: runtime } });
  hooks.choose("main.c");
  const noticeId = hooks.updiNotice();
  hooks.updateCompilePanelState();
  assert.equal(document.getElementById("compileBtn").disabled, true);
  assert.equal(await hooks.compileCurrentFile(), false);
  assert.equal(hooks.notifications().length, 1);
  assert.equal(hooks.notifications()[0].id, noticeId);
  assert.equal(hooks.notifications()[0].details, "Writing page 1");
  assert.equal(hooks.notifications()[0].pending, true);
  busy = false;
  hooks.updateCompilePanelState();
  assert.equal(document.getElementById("compileBtn").disabled, false);
  hooks.setHexStatus("building");
  hooks.updateCompilePanelState();
  assert.equal(document.getElementById("compileBtn").disabled, true);
  hooks.setHexStatus("ready");
  hooks.updateCompilePanelState();
  assert.equal(document.getElementById("compileBtn").disabled, false);
  hooks.choose("guide.md");
  hooks.updateCompilePanelState();
  assert.equal(document.getElementById("compileBtn").disabled, true);
});

test("workspace panes share an expanded floor and retain intrinsic measurement for horizontal toolbars", () => {
  const css = fs.readFileSync(
    path.join(__dirname, "../public/AVR-Programming.css"),
    "utf8"
  );
  const source = fs.readFileSync(
    path.join(__dirname, "../public/AVR-Programming.js"),
    "utf8"
  );
  const layout = require("../public/avr-workspace-layout.js");

  assert.match(
    source,
    /const WORKSPACE_PANEL_COMPACT_WIDTH\s*=\s*62;/
  );
  assert.equal(layout.WORKSPACE_PANEL_COMPACT_THRESHOLD, 112);
  assert.match(
    source,
    /workspacePanelMinWidths\[index\]\s*=\s*Math\.max\([\s\S]*?panelChrome\s*\+[\s\S]*?controlsWidth/
  );
  assert.doesNotMatch(source, /halfSplitWidth/);
  assert.doesNotMatch(source, /availableDocumentationWidth\s*\/\s*2/);
  assert.match(source, /WORKSPACE_PANEL_MIN_WIDTH\s*=\s*240/);
  assert.match(
    css,
    /--editor-workspace-min-width:\s*240px;[\s\S]*?minmax\(var\(--editor-workspace-min-width\), 1fr\)/
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
    /\.canvas-split-container\.is-documentation-content-compact\s+\.project-documentation-panel\s*> :not\(\.pane-collapse-cue, \[data-panel-action-contour\]\)\s*\{[^}]*display:\s*none !important;/
  );
  assert.match(
    css,
    /\.documentation-workspace::before\s*\{[^}]*content:\s*"Description";/
  );
  assert.match(
    css,
    /\.canvas-split-container \.ui-panel-header\s*\{[\s\S]*?flex-wrap:\s*nowrap;[\s\S]*?gap:\s*var\(--avr-control-gap\);/
  );
  assert.doesNotMatch(source, /OUTLINER_MAX_WIDTH|DOCUMENTATION_MAX_WIDTH/);
  assert.doesNotMatch(
    source,
    /PROJECT_AI_CHAT_MAX_WIDTH|PROJECT_AI_SKILLS_MAX_WIDTH/
  );
  assert.match(
    source,
    /function getWorkspacePanelMinWidth\(index\)[\s\S]*?strip\.children[\s\S]*?controlsWidth[\s\S]*?horizontalPadding/
  );
  assert.doesNotMatch(
    source,
    /function getWorkspacePanelMinWidth\(index\)[\s\S]{0,900}?strip\.scrollWidth/
  );
  assert.doesNotMatch(source, /function getDocumentationMinWidth/);
  for (const name of ["outliner", "project-ai", "documentation"]) {
    assert.match(css, new RegExp(`--${name}-resizer-width:\\s*14px;`));
  }
  assert.equal(Array.from(css.matchAll(/--panel-action-right\s*:/g)).length, 1,
    "the capsule must keep one position rule in expanded and compact states");
  assert.match(css, /--panel-action-right:\s*calc\(-0\.5px - var\(--panel-action-width\)\);/);
});

test("workspace minima follow visible intrinsic controls and retain them while collapsed", () => {
  const { document } = parseHTML(`<html><body><div class="canvas-split-container">
    <aside class="outliner"></aside>
    <div class="project-ai-layout"><section class="avr-session-panel"><form class="ui-panel-header"><button id="canvasControl"></button></form></section></div>
    <section class="editor-workspace avr-session-panel"><div class="ui-panel-header"><div id="targetControls"></div><div id="buildControls"></div><button id="hiddenControl" hidden></button></div></section>
    <aside class="documentation-workspace avr-session-panel"></aside>
  </div></body></html>`);
  const widths = { canvasControl: 132, targetControls: 340, buildControls: 220, hiddenControl: 1000 };
  for (const [id] of Object.entries(widths)) {
    document.getElementById(id).getBoundingClientRect = () => ({ width: widths[id] });
  }
  for (const strip of document.querySelectorAll(".ui-panel-header")) {
    strip.getClientRects = () => strip.hidden ? [] : [{}];
  }
  const hooks = loadAvrFrontendFunctionHooks(["getWorkspacePanelSpecs"], {
    document,
    window: { getComputedStyle: el => el.classList.contains("avr-session-panel")
      ? { paddingLeft: "12px", paddingRight: "12px", borderLeftWidth: "1px", borderRightWidth: "1px" }
      : { display: el.hidden ? "none" : "flex", columnGap: "8px" } },
  });
  const minima = () => Array.from(hooks.getWorkspacePanelSpecs(), spec => spec.min);
  assert.deepEqual(minima(), [240, 160, 596, 240]);
  widths.buildControls = 300;
  assert.equal(minima()[2], 676);
  document.querySelector(".editor-workspace .ui-panel-header").hidden = true;
  widths.targetControls = 0;
  widths.buildControls = 0;
  assert.equal(minima()[2], 676, "a hidden toolbar must retain its last expanded width");
});

function panelMotionFixture(notchWidth = 34) {
  const { document } = parseHTML(`<html><body>
  <template id="panelActionContour"><svg class="panel-action-contour" aria-hidden="true"><path class="panel-action-fill"></path><path class="panel-action-outline"></path></svg></template>
  <div class="canvas-split-container">
    <aside id="filesPanel" class="outliner"><div id="fileList"></div></aside>
    <div class="project-ai-layout"><section id="specPanel" class="project-instruction-panel panel-action-host"><form class="panel-action-lobe ui-panel-header" data-toolbar-layout="vertical"><button id="reviewAction" type="button">Review specification</button></form></section></div>
    <section id="editorWorkspace" class="editor-workspace panel-action-host"><div class="panel-action-lobe ui-panel-header" data-toolbar-layout="vertical"><button>Compile</button><button>Flash MCU</button></div><div id="editorContent"></div></section>
    <aside id="guidePanel" class="documentation-workspace"></aside>
  </div></body></html>`);
  const container = document.querySelector(".canvas-split-container");
  container.getBoundingClientRect = () => ({ width: 1802 });
  const floors = { filesPanel: 240, specPanel: 240, editorWorkspace: 240, guidePanel: 240 };
  const trailingSpaces = { filesPanel: 0, specPanel: 0, editorWorkspace: 0, guidePanel: 0 };
  const dividerWidths = {
    "--outliner-resizer-width": "14px", "--project-ai-resizer-width": "28px",
    "--documentation-resizer-width": "28px",
  };
  const getComputedStyle = element => ({ getPropertyValue(property) {
    if (element === container) {
      if (property === "--panel-action-width") return `${notchWidth}px`;
      if (property === "--project-ai-resizer-width" && container.classList.contains("is-project-ai-compact")) return "14px";
      if (property === "--documentation-resizer-width" && container.classList.contains("is-editor-compact")) return "14px";
      return dividerWidths[property] || "";
    }
    if (property === "--panel-action-min-width") return `${floors[element.id]}px`;
    if (property === "--panel-action-trailing-space") return `${trailingSpaces[element.id]}px`;
    return "";
  } });
  return { document, container, getComputedStyle, trailingSpaces, dividerWidths };
}

test("each notebook page gets one shared contour without changing its action buttons", () => {
  const fixture = panelMotionFixture();
  const actions = [...fixture.container.querySelectorAll(".panel-action-lobe")];
  const labels = actions.map(group => group.textContent);
  const hooks = loadAvrFrontendFunctionHooks(["bindPanelActionExpansion"], { document: fixture.document });
  hooks.bindPanelActionExpansion();
  hooks.bindPanelActionExpansion();
  assert.equal(actions.length, 2);
  assert.equal(fixture.container.querySelectorAll("[data-panel-action-contour]").length, 3);
  for (const [index, group] of actions.entries()) {
    assert.equal(group.querySelector("[data-panel-action-contour]"), null, "the page owns its complete contour");
    const contour = group.parentElement.querySelector(":scope > [data-panel-action-contour]");
    assert.equal(contour.localName, "svg");
    assert.equal(contour.getAttribute("aria-hidden"), "true");
    assert.equal(contour.querySelectorAll("path").length, 2);
    assert.equal(group.textContent, labels[index]);
  }
  assert.ok(fixture.document.getElementById("guidePanel").querySelector(":scope > [data-panel-action-contour]"));
  assert.equal(fixture.document.getElementById("panelActionContour").content.firstElementChild.hasAttribute("data-panel-action-contour"), false);
});

test("all panes share the same body minimum independent of their page contours", () => {
  const fixture = panelMotionFixture();
  for (const button of fixture.document.querySelectorAll("button")) {
    button.getBoundingClientRect = () => ({ width: 1000, height: 44 });
  }
  const hooks = loadAvrFrontendFunctionHooks(["getWorkspacePanelSpecs"], {
    document: fixture.document, window: { getComputedStyle: fixture.getComputedStyle },
  });
  const minima = () => Array.from(hooks.getWorkspacePanelSpecs(), spec => spec.min);
  assert.deepEqual(minima(), [240, 240, 240, 240]);
  const hosts = ["filesPanel", "specPanel", "editorWorkspace", "guidePanel"];
  assert.deepEqual(minima().map((width, index) => width - fixture.trailingSpaces[hosts[index]]),
    [240, 240, 240, 240], "each body must reach the same collapse threshold");
  fixture.container.classList.add("is-editor-compact", "is-documentation-compact");
  assert.deepEqual(minima(), [240, 240, 240, 240], "collapsed actions must retain their expanded floors");
});

test("compact bodies account for the incoming notch without widening the canvas", () => {
  for (const [notch, expected] of [[34, [62, 28, 62, 62]], [38, [62, 24, 62, 62]]]) {
    const fixture = panelMotionFixture(notch);
    const hooks = loadAvrFrontendFunctionHooks(["getWorkspacePanelSpecs"], {
      document: fixture.document, window: { getComputedStyle: fixture.getComputedStyle },
    });
    assert.deepEqual(Array.from(hooks.getWorkspacePanelSpecs(), spec => spec.compact), expected);
  }
});

test("workspace width follows the configured dividers and preserves the minimum PC layout", () => {
  const fixture = panelMotionFixture();
  let width = 1200;
  fixture.container.getBoundingClientRect = () => ({ width });
  const hooks = loadAvrFrontendFunctionHooks(["getWorkspaceContentWidth"], {
    document: fixture.document, window: { getComputedStyle: fixture.getComputedStyle },
  });
  assert.equal(hooks.getWorkspaceContentWidth(), 1130);
  Object.assign(fixture.dividerWidths, {
    "--outliner-resizer-width": "22px", "--project-ai-resizer-width": "40px",
    "--documentation-resizer-width": "18px",
  });
  assert.equal(hooks.getWorkspaceContentWidth(), 1120,
    "changing shared divider widths must change the available pane budget");
  fixture.dividerWidths["--documentation-resizer-width"] = "";
  assert.equal(hooks.getWorkspaceContentWidth(), 1158, "unavailable CSS metrics use three shared 14px desktop dividers");
  width = 300;
  assert.equal(hooks.getWorkspaceContentWidth(), 426,
    "a very narrow PC window must retain one expanded body and three compact rails");
});

test("collapsing and reopening either action pane accounts for its divider on both boundaries", () => {
  const fixture = panelMotionFixture();
  const hooks = loadAvrFrontendFunctionHooks([
    "renderWorkspaceWidths", "getWorkspaceWidths", "getWorkspacePanelSpecs", "getWorkspaceContentWidth", "resizeWorkspaceBoundary",
    "prepare() { refreshWorkspaceEditors = () => {}; }",
  ], { document: fixture.document, window: { getComputedStyle: fixture.getComputedStyle } });
  hooks.prepare();
  const initial = [400, 400, 400, 532];
  for (const index of [1, 2]) {
    for (const boundary of [index - 1, index]) {
      assert.equal(hooks.renderWorkspaceWidths(initial, { animate: false }), true);
      const specs = hooks.getWorkspacePanelSpecs();
      const sign = index === boundary ? -1 : 1;
      const candidate = Array.from(hooks.resizeWorkspaceBoundary(initial, specs, boundary,
        sign * (initial[index] - specs[index].min + 120)));
      assert.equal(hooks.renderWorkspaceWidths(candidate, { animate: false }), true);
      const closed = Array.from(hooks.getWorkspaceWidths());
      assert.equal(closed[index], specs[index].compact);
      assert.equal(closed.reduce((sum, width) => sum + width, 0), 1746,
        "closing an action group releases its 14px divider reservation");
      assert.equal(closed.reduce((sum, width) => sum + width, 0), hooks.getWorkspaceContentWidth());
      const growing = index === boundary ? boundary + 1 : boundary;
      assert.equal(closed[growing], candidate[growing] + 14,
        "released divider space belongs to the pane already growing in the drag");
      const reopen = hooks.resizeWorkspaceBoundary(closed, specs, boundary, -sign * 48);
      assert.equal(hooks.renderWorkspaceWidths(reopen, { animate: false }), true);
      const opened = Array.from(hooks.getWorkspaceWidths());
      assert.ok(opened[index] >= specs[index].min);
      assert.equal(opened.reduce((sum, width) => sum + width, 0), 1732);
      assert.equal(opened.reduce((sum, width) => sum + width, 0), hooks.getWorkspaceContentWidth());
      opened.forEach((width, panel) => assert.ok(width >= specs[panel].min));
    }
  }
});

test("divider changes keep the code rail at 62px and persist a completed pointer collapse", () => {
  const fixture = panelMotionFixture(), storage = new Map();
  let callbacks;
  const hooks = loadAvrFrontendFunctionHooks([
    "renderWorkspaceWidths", "getWorkspaceWidths", "getWorkspaceContentWidth", "bindWorkspaceColumnResizer",
    "prepare(capture) { refreshWorkspaceEditors = () => {}; bindSplitResizer = (_handle, handlers) => capture(handlers); }",
  ], { document: fixture.document, window: {
    getComputedStyle: fixture.getComputedStyle,
    localStorage: { setItem: (key, value) => storage.set(key, value) },
  } });
  hooks.prepare(handlers => { callbacks = handlers; });
  assert.equal(hooks.renderWorkspaceWidths([400, 400, 62, 884], { animate: false }), true);
  hooks.bindWorkspaceColumnResizer("fileListResizer", 0);
  const session = callbacks.start();
  callbacks.move(280, session);
  assert.deepEqual(Array.from(hooks.getWorkspaceWidths()), [786, 28, 62, 884]);
  assert.equal(session.widths.reduce((sum, width) => sum + width, 0), hooks.getWorkspaceContentWidth(),
    "the next pointer sample must start from the reconciled budget");
  callbacks.finish(session);
  assert.equal(hooks.getWorkspaceWidths()[1], 28,
    "releasing a divider must persist the collapse rather than restore old preferences");
  assert.equal(hooks.getWorkspaceWidths()[2], 62);
  assert.equal(storage.get("ud_avr_ai_column_width_v1"), "28");
  assert.equal(storage.get("ud_avr_programming_editor_collapsed_v1"), "true");
});

test("a reopen that cannot also reserve its divider leaves every panel unchanged", () => {
  for (const index of [1, 2]) {
    const fixture = panelMotionFixture();
    fixture.container.getBoundingClientRect = () => ({ width: 1016 });
    const hooks = loadAvrFrontendFunctionHooks([
      "renderWorkspaceWidths", "getWorkspaceWidths", "getWorkspacePanelSpecs", "getWorkspaceContentWidth", "resizeWorkspaceBoundary",
      "prepare() { refreshWorkspaceEditors = () => {}; }",
    ], { document: fixture.document, window: { getComputedStyle: fixture.getComputedStyle } });
    hooks.prepare();
    const start = index === 1 ? [452, 28, 240, 240] : [418, 240, 62, 240];
    assert.equal(hooks.renderWorkspaceWidths(start, { animate: false }), true);
    const candidate = hooks.resizeWorkspaceBoundary(start, hooks.getWorkspacePanelSpecs(), 1, index === 1 ? 48 : -48);
    assert.equal(candidate[index], 240, "the body alone would fit before accounting for its protrusion");
    assert.equal(hooks.renderWorkspaceWidths(candidate, { animate: false }), false);
    assert.deepEqual(Array.from(hooks.getWorkspaceWidths()), start);
    assert.equal(fixture.container.classList.contains(index === 1 ? "is-project-ai-compact" : "is-editor-compact"), true);
    assert.equal(start.reduce((sum, width) => sum + width, 0), hooks.getWorkspaceContentWidth());
  }
});

test("boundary reopen reserves its divider by closing only its adjacent pane when necessary", () => {
  for (const index of [1, 2]) {
    const fixture = panelMotionFixture();
    fixture.container.getBoundingClientRect = () => ({ width: 1016 });
    const hooks = loadAvrFrontendFunctionHooks([
      "renderWorkspaceWidths", "renderWorkspaceBoundary", "getWorkspaceWidths", "getWorkspacePanelSpecs", "getWorkspaceContentWidth",
      "prepare() { refreshWorkspaceEditors = () => {}; }",
    ], { document: fixture.document, window: { getComputedStyle: fixture.getComputedStyle } });
    hooks.prepare();
    const start = index === 1 ? [452, 28, 240, 240] : [418, 240, 62, 240];
    assert.equal(hooks.renderWorkspaceWidths(start, { animate: false }), true);
    assert.equal(hooks.renderWorkspaceBoundary(start, hooks.getWorkspacePanelSpecs(), 1,
      index === 1 ? 48 : -48, { animate: false }), true);
    const sizes = Array.from(hooks.getWorkspaceWidths());
    assert.deepEqual(sizes, index === 1 ? [418, 240, 62, 240] : [418, 28, 274, 240]);
    assert.equal(sizes.reduce((sum, width) => sum + width, 0), hooks.getWorkspaceContentWidth());
  }
});

test("PC viewport fitting preserves an explicitly closed code rail across divider reservations", () => {
  const fixture = panelMotionFixture();
  let width = 1802;
  fixture.container.getBoundingClientRect = () => ({ width });
  const hooks = loadAvrFrontendFunctionHooks([
    "renderWorkspaceWidths", "fitWorkspaceToViewport", "getWorkspaceWidths", "getWorkspacePanelSpecs", "getWorkspaceContentWidth",
    "prepare() { refreshWorkspaceEditors = () => {}; }",
  ], { document: fixture.document, window: {
    getComputedStyle: fixture.getComputedStyle, localStorage: { setItem() {} },
  } });
  hooks.prepare();
  assert.equal(hooks.renderWorkspaceWidths([400, 400, 62, 884], { animate: false, persist: true }), true);
  for (width of [1100, 960, 1500, 520, 1800]) {
    hooks.fitWorkspaceToViewport();
    const sizes = Array.from(hooks.getWorkspaceWidths()), specs = hooks.getWorkspacePanelSpecs();
    assert.equal(sizes[2], 62);
    assert.equal(sizes.reduce((sum, size) => sum + size, 0), hooks.getWorkspaceContentWidth());
    sizes.forEach((size, index) => assert.ok(size === specs[index].compact || size >= specs[index].min));
  }
});

test("restoring saved rails keeps them closed while another pane can absorb spare width", () => {
  for (const saved of [
    // Legacy canvas rails saved as 62px must migrate to the current 28px body.
    [400, 62, true, 360], [62, 400, true, 62], [400, 62, true, 62],
    [62, 62, true, 360], [62, 62, false, 62],
    [400, 28, true, 360],
  ]) {
    const fixture = panelMotionFixture();
    const storage = new Map([
      ["ud_avr_programming_outliner_width_v1", String(saved[0])],
      ["ud_avr_ai_column_width_v1", String(saved[1])],
      ["ud_avr_programming_editor_collapsed_v1", String(saved[2])],
      ["ud_avr_programming_documentation_width_v1", String(saved[3])],
    ]);
    const hooks = loadAvrFrontendFunctionHooks([
      "restoreWorkspaceLayout", "getWorkspaceWidths", "getWorkspacePanelSpecs", "getWorkspaceContentWidth",
      "prepare() { refreshWorkspaceEditors = () => {}; }",
    ], { document: fixture.document, window: {
      getComputedStyle: fixture.getComputedStyle,
      localStorage: { getItem: key => storage.get(key) ?? null },
    } });
    hooks.prepare();
    hooks.restoreWorkspaceLayout();
    const sizes = Array.from(hooks.getWorkspaceWidths()), specs = hooks.getWorkspacePanelSpecs();
    for (const index of [0, 1, 2, 3]) {
      const closed = index === 2 ? saved[index] : saved[index] === 62 || index === 1 && saved[index] === 28;
      assert.equal(sizes[index] === specs[index].compact, closed, `saved rail ${index} changed state in ${saved}`);
      assert.ok(sizes[index] === specs[index].compact || sizes[index] >= specs[index].min);
    }
    assert.equal(sizes.reduce((sum, size) => sum + size, 0), hooks.getWorkspaceContentWidth());
  }
});

test("collapse and reopen animate their geometry once while reduced motion remains immediate", () => {
  const fixture = panelMotionFixture(), timers = new Map();
  let nextTimer = 0, reduced = false;
  const hooks = loadAvrFrontendFunctionHooks([
    "renderWorkspaceWidths", "getWorkspaceWidths",
    "prepare() { refreshWorkspaceEditors = () => {}; }",
  ], { document: fixture.document, window: {
    getComputedStyle: fixture.getComputedStyle, matchMedia: () => ({ matches: reduced }),
    setTimeout(callback, delay) { assert.equal(delay, 320); timers.set(++nextTimer, callback); return nextTimer; },
    clearTimeout(id) { timers.delete(id); },
  } });
  hooks.prepare();
  const start = Array.from(hooks.getWorkspaceWidths());
  const collapsed = [...start]; collapsed[1] += collapsed[0] - 62; collapsed[0] = 62;
  hooks.renderWorkspaceWidths(collapsed);
  assert.ok(fixture.container.classList.contains("is-workspace-transitioning"));
  assert.equal(timers.size, 1);
  hooks.renderWorkspaceWidths(collapsed);
  assert.equal(timers.size, 1, "an unchanged pointer sample must not restart its snap animation");
  assert.deepEqual(Array.from(hooks.getWorkspaceWidths()), collapsed);
  [...timers.values()][0]();
  assert.equal(fixture.container.classList.contains("is-workspace-transitioning"), false);
  hooks.renderWorkspaceWidths(start);
  assert.ok(fixture.container.classList.contains("is-workspace-transitioning"));
  reduced = true;
  hooks.renderWorkspaceWidths(collapsed);
  assert.equal(fixture.container.classList.contains("is-workspace-transitioning"), false);
  assert.equal(timers.size, 0);
  assert.deepEqual(Array.from(hooks.getWorkspaceWidths()), collapsed);
});

test("held pointer movement lets every pane finish one fixed snap in either direction", () => {
  for (const index of [0, 1, 2, 3]) {
    for (const opening of [false, true]) {
      const fixture = panelMotionFixture(), timers = new Map();
      let callbacks, nextTimer = 0;
      const hooks = loadAvrFrontendFunctionHooks([
        "renderWorkspaceWidths", "getWorkspaceWidths", "getWorkspacePanelSpecs", "bindWorkspaceColumnResizer",
        "prepare(capture) { refreshWorkspaceEditors = () => {}; bindSplitResizer = (_handle, handlers) => capture(handlers); }",
      ], { document: fixture.document, window: {
        getComputedStyle: fixture.getComputedStyle,
        setTimeout(callback, delay) {
          assert.equal(delay, 320);
          timers.set(++nextTimer, callback);
          return nextTimer;
        },
        clearTimeout(id) { timers.delete(id); },
      } });
      hooks.prepare(handlers => { callbacks = handlers; });
      hooks.renderWorkspaceWidths([400, 400, 400, 532], { animate: false });
      const boundary = index < 2 ? index : index - 1;
      const growDirection = index === boundary ? 1 : -1;
      if (opening) {
        const closed = Array.from(hooks.getWorkspaceWidths());
        const neighbor = index === boundary ? index + 1 : index - 1;
        const compact = hooks.getWorkspacePanelSpecs()[index].compact;
        closed[neighbor] += closed[index] - compact;
        closed[index] = compact;
        assert.equal(hooks.renderWorkspaceWidths(closed, { animate: false }), true);
      }
      hooks.bindWorkspaceColumnResizer("fileListResizer", boundary);
      const session = callbacks.start();
      const direction = opening ? growDirection : -growDirection;
      const snapDelta = direction * (opening ? 48 : session.widths[index] - session.specs[index].min + 120);
      callbacks.move(snapDelta, session);
      const target = Array.from(hooks.getWorkspaceWidths());
      assert.equal(target[index] === session.specs[index].compact, !opening, `pane ${index} did not start its ${opening ? "opening" : "closing"} snap`);
      assert.equal(timers.size, 1);
      const timerId = [...timers.keys()][0];
      assert.ok(fixture.container.classList.contains("is-workspace-transitioning"));

      let latestDelta = snapDelta;
      for (const distance of [0.25, 0.5, 2, 10, 80, 160, 200]) {
        latestDelta = snapDelta + direction * distance;
        callbacks.move(latestDelta, session);
        assert.ok(fixture.container.classList.contains("is-workspace-transitioning"),
          `continued dragging must not cancel pane ${index}'s snap`);
        assert.deepEqual([...timers.keys()], [timerId], "held samples must not restart the snap timer");
        assert.deepEqual(Array.from(hooks.getWorkspaceWidths()), target,
          "held samples must leave the animation's destination unchanged");
        assert.deepEqual(Array.from(session.widths), target);
        assert.equal(session.offset, latestDelta, "consume pointer travel during the snap instead of accumulating a catch-up jump");
      }

      timers.get(timerId)();
      assert.equal(fixture.container.classList.contains("is-workspace-transitioning"), false);
      assert.equal(timers.size, 0);
      assert.deepEqual(Array.from(hooks.getWorkspaceWidths()), target);
      if (opening) {
        callbacks.move(latestDelta + growDirection * 24, session);
        assert.equal(hooks.getWorkspaceWidths()[index], target[index] + 24,
          "resizing after a snap must use only the movement since the latest held sample");
        assert.equal(timers.size, 0, "ordinary resizing must not start another snap");
      } else {
        callbacks.move(latestDelta + growDirection * 47, session);
        assert.equal(hooks.getWorkspaceWidths()[index], session.specs[index].compact,
          "a held collapse must not accumulate travel toward a subsequent reopen");
        assert.equal(timers.size, 0);
        callbacks.move(latestDelta + growDirection * 48, session);
        assert.ok(hooks.getWorkspaceWidths()[index] >= session.specs[index].min);
        assert.equal(timers.size, 1, "reversing by the reopen threshold starts one new fixed snap");
        assert.equal(nextTimer, 2);
      }
    }
  }
});

test("workspace observers do not refit a panel midway through its collapse transition", () => {
  const fixture = panelMotionFixture(), timers = new Map(), frames = [];
  let observeResize, fits = 0;
  class Observer {
    constructor(callback) { observeResize = callback; }
    observe() {}
  }
  const hooks = loadAvrFrontendFunctionHooks([
    "bindWorkspaceResizeObserver", "renderWorkspaceWidths", "getWorkspaceWidths",
    "prepare(callback) { refreshWorkspaceEditors = () => {}; fitWorkspaceToViewport = callback; }",
  ], { document: fixture.document, ResizeObserver: Observer, window: {
    getComputedStyle: fixture.getComputedStyle,
    setTimeout(callback) { timers.set(1, callback); return 1; },
    clearTimeout(id) { timers.delete(id); },
    requestAnimationFrame(callback) { frames.push(callback); return frames.length; },
  } });
  hooks.prepare(() => fits++);
  hooks.bindWorkspaceResizeObserver();
  const widths = Array.from(hooks.getWorkspaceWidths());
  widths[1] += widths[0] - 62; widths[0] = 62;
  hooks.renderWorkspaceWidths(widths);
  observeResize();
  assert.equal(frames.length, 0);
  assert.equal(fits, 0);
  [...timers.values()][0]();
  observeResize();
  assert.equal(frames.length, 1);
  frames[0]();
  assert.equal(fits, 1);
});

test("an empty project list has one empty state and no extra creation step", () => {
  const fixture = panelMotionFixture();
  const hooks = loadAvrFrontendFunctionHooks([
    "renderOutliner", "prepare() { updateCompilePanelState = () => {}; }",
  ], { document: fixture.document });
  hooks.prepare();
  hooks.renderOutliner();
  hooks.renderOutliner();
  assert.equal(fixture.document.querySelectorAll(".new-item").length, 0);
  assert.equal(fixture.document.querySelectorAll("#fileList .ui-empty-state").length, 1);
  assert.equal(fixture.document.querySelector("#fileList .ui-empty-state").textContent, "No projects yet");
  assert.equal(fixture.document.querySelector("#projectListActions"), null);
});

test("clicking an action in a collapsed panel expands it and still invokes the existing action", () => {
  const fixture = panelMotionFixture();
  const hooks = loadAvrFrontendFunctionHooks([
    "bindPanelActionExpansion", "renderWorkspaceWidths", "getWorkspaceWidths",
    "prepare() { refreshWorkspaceEditors = () => {}; }",
  ], { document: fixture.document, window: {
    getComputedStyle: fixture.getComputedStyle,
    localStorage: { setItem() {} },
  } });
  hooks.prepare();
  const widths = Array.from(hooks.getWorkspaceWidths());
  widths[0] += widths[1] - 28; widths[1] = 28;
  hooks.renderWorkspaceWidths(widths);
  hooks.bindPanelActionExpansion();
  let actions = 0;
  fixture.document.getElementById("reviewAction").addEventListener("click", () => actions++);
  fixture.document.getElementById("reviewAction").click();
  assert.equal(actions, 1);
  assert.equal(hooks.getWorkspaceWidths()[1], 240);
});

test("device-panel snap animates its three viewports and inherits target visibility from the hardware frame", () => {
  const { document } = parseHTML(`<html><body><section id="avrDeviceSection">
    <div class="avr-overview-row">
      <div class="avr-overview-viewport avr-device-panel-viewport" id="avrDevicePanelViewport"><section id="avrTargetPanelViewport"></section></div>
      <div class="avr-overview-viewport" id="avrActionsPanelViewport"></div>
      <div class="avr-overview-viewport avr-account-panel-viewport" id="avrAccountPanelViewport"></div>
    </div>
    <div id="devicePanelToggle"></div>
  </section></body></html>`);
  const timers = new Map(), storage = new Map(), animations = [];
  let cancelledAnimations = 0;
  const panels = [...document.querySelectorAll(".avr-overview-viewport")];
  for (const panel of panels) panel.animate = (frames, options) => {
    animations.push({ id: panel.id, frames, options });
    return { pending: false, playState: "finished", cancel() { cancelledAnimations++; } };
  };
  let nextTimer = 0, reduced = false;
  const hooks = loadAvrFrontendFunctionHooks([
    "setDevicePanelState", "prepare() { refreshWorkspaceAfterDevicePanelResize = () => {}; }",
  ], { document, window: {
    matchMedia: () => ({ matches: reduced }),
    localStorage: { setItem: (key, value) => storage.set(key, value) },
    setTimeout(callback, delay) {
      assert.equal(delay, 320);
      const id = ++nextTimer;
      timers.set(id, () => { timers.delete(id); callback(); });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
  } });
  hooks.prepare();
  const section = document.getElementById("avrDeviceSection");
  hooks.setDevicePanelState("compact", { persist: false });
  assert.ok(section.classList.contains("is-device-panel-transitioning"));
  assert.deepEqual(animations.map(animation => animation.id), panels.map(panel => panel.id));
  assert.ok(animations.every(animation => animation.options.duration === 320 && animation.frames.at(-1).height === "54px"));
  hooks.setDevicePanelState("compact", { persist: true, animate: false });
  assert.ok(section.classList.contains("is-device-panel-transitioning"));
  assert.equal(timers.size, 1);
  assert.equal(storage.get("ud_avr_programming_device_panel_state_v2"), "compact");
  [...timers.values()][0]();
  assert.equal(section.classList.contains("is-device-panel-transitioning"), false);
  assert.equal(cancelledAnimations, panels.length);
  reduced = true;
  hooks.setDevicePanelState("expanded");
  assert.equal(section.classList.contains("is-device-panel-transitioning"), false);
  assert.equal(timers.size, 0);
  const targets = document.getElementById("avrTargetPanelViewport");
  hooks.setDevicePanelState("collapsed", { animate: false });
  assert.ok(panels.every(panel => panel.hasAttribute("inert") && panel.getAttribute("aria-hidden") === "true"));
  assert.equal(targets.closest("[inert]"), panels[0], "target controls inherit the hardware viewport's inert state");
  assert.equal(targets.hasAttribute("inert"), false, "the target group must not own a second visibility state");
  hooks.setDevicePanelState("expanded", { animate: false });
  assert.ok(panels.every(panel => !panel.hasAttribute("inert") && panel.getAttribute("aria-hidden") === "false"));
  assert.equal(targets.closest("[inert]"), null);
  assert.equal(animations.length, panels.length, "reduced motion and immediate visibility changes must not start more animations");
});


test("shared pointer handling ignores other pointers and completes once on capture loss", () => {
  const { document, window, handle, pointer } = resizeEnvironment();
  const moves = [];
  let finishes = 0;
  const { bindSplitResizer } = loadAvrFrontendFunctionHooks(["bindSplitResizer"], { document, window });
  bindSplitResizer(handle, {
    axis: "x", start: () => 300, move: (delta, width) => moves.push(width + delta),
    finish: () => finishes++,
  });
  handle.emit("pointerdown", pointer(1, 100));
  document.emit("pointermove", pointer(2, 150));
  document.emit("pointerup", pointer(2, 150));
  assert.equal(finishes, 0);
  document.emit("pointermove", pointer(1, 140));
  assert.deepEqual(moves, [340]);
  assert.ok(document.body.classes.has("is-column-resizing"));
  handle.emit("lostpointercapture", pointer(1, 140));
  document.emit("pointerup", pointer(1, 140));
  assert.equal(finishes, 1);
  assert.equal(handle.classes.size, 0);
  assert.equal(document.body.classes.size, 0);
});

test("chat boundary delegates mouse, keyboard and cancellation to the shared panel input", () => {
  const { document, window, handle, pointer } = resizeEnvironment();
  document.getElementById = id => id === "fileListResizer" ? handle : null;
  const changes = [], completions = [];
  const hooks = loadAvrFrontendFunctionHooks([
    "bindFileListResizer",
    `prepare(changed, completed) {
      getWorkspaceWidths = () => [400, 400, 400, 532];
      getWorkspacePanelSpecs = () => Array.from({ length: 4 }, () => ({ min: 240, compact: 62 }));
      getCanvasSplitContainer = () => ({ getBoundingClientRect: () => ({ width: 1802 }) });
      renderWorkspaceBoundary = (widths, specs, index, delta) => changed(index, delta);
      persistWorkspaceLayout = completed;
    }`,
  ], { document, window });
  hooks.prepare((index, delta) => changes.push([index, delta]), () => completions.push(true));
  hooks.bindFileListResizer();
  handle.setPointerCapture = () => { throw new Error("Capture unavailable"); };
  handle.emit("pointerdown", pointer(1, 405, { isPrimary: false }));
  assert.equal(handle.focusCount, 0);
  handle.emit("pointerdown", pointer(1, 405));
  assert.deepEqual(changes, []);
  assert.equal(handle.focusCount, 1);
  document.emit("pointermove", pointer(1, 435));
  window.emit("resize");
  document.emit("pointerup", pointer(1, 500));
  assert.deepEqual(changes, [[0, 30]]);
  assert.equal(completions.length, 1);
  assert.equal(document.body.classes.size, 0);
  assert.equal(handle.emit("keydown", { key: "Home" }).defaultPrevented, true);
  assert.equal(handle.emit("keydown", { key: "End" }).defaultPrevented, true);
  handle.emit("keydown", { key: "ArrowRight", shiftKey: true });
  assert.deepEqual(changes.slice(1), [[0, -280], [0, 280], [0, 48]]);
});

test("live Markdown preserves literal source and clears old decorations when its shared runtime is unavailable", () => {
  const { document } = parseHTML('<html><body></body></html>');
  const runtime = loadVendoredMarkdownRuntime(document);
  const hooks = loadAvrFrontendFunctionHooks([
    "registerMarkdownLiveEditor", "renderMarkdownLivePreviewState",
    "setRuntime(runtime) { window.UartDebugMarkdown = runtime; }",
  ], { document, window: { UartDebugMarkdown: runtime, requestAnimationFrame: () => 1 }, CodeMirror: { registerHelper() {}, Pos: (line, ch) => ({ line, ch }) } });
  const markdown = '## Clock\n\n<script>alert("unsafe")</script>\n\n**literal**';
  const editor = createMarkdownCodeMirrorStub(markdown, document);
  let headings;
  const state = hooks.registerMarkdownLiveEditor("fallback-test", editor, { onHeadings: value => { headings = value; } });
  hooks.renderMarkdownLivePreviewState(state);
  assert.ok(state.marks.length > 0);
  assert.equal(headings.size, 1);
  const previousMarks = [...state.marks];
  hooks.setRuntime(undefined);
  hooks.renderMarkdownLivePreviewState(state);
  assert.equal(editor.getValue(), markdown);
  assert.ok(previousMarks.every(mark => mark.cleared));
  assert.equal(state.marks.length, 0);
  assert.equal(state.widgets.length, 0);
  assert.equal(state.renderCache, null);
  assert.equal(headings.size, 0);
  assert.equal(document.querySelector("script"), null);
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
    /project-documentation-scroll project-documentation-live-editor markdown-live-editor[\s\S]*?id="projectDocumentationScroll"[\s\S]*?id="projectDocumentationEditor"/
  );
  assert.match(html, /editor-surface markdown-live-editor/);
  assert.match(source, /markdownRuntime\.renderInto/);
  assert.match(source, /markdownRuntime\?\.analyze/);
  assert.match(source, /registerMarkdownLiveEditor\("instruction"/);
  assert.match(source, /registerMarkdownLiveEditor\("documentation"/);
  assert.match(source, /registerMarkdownLiveEditor\("editor"/);
  assert.match(
    source,
    /function bindDocumentationWorkspace\(\)[\s\S]*?createMarkdownDocumentEditor\(editorElement,[\s\S]*?readOnly:\s*"nocursor",/
  );
  assert.doesNotMatch(source, /documentationEditMode|setDocumentationEditMode|documentationRenderedHeadingIndex|renderMarkdownGuide|renderMarkdownInto/);
  assert.doesNotMatch(css, /is-documentation-edit/);
  assert.match(css, /\.project-documentation-scroll\s*\{[\s\S]*?overflow:\s*hidden;/);
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
    /\.avr-overview-viewport\s*\{[\s\S]*?height:\s*var\(--device-panel-height\);/
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
  assert.match(html, /id="detectChipBtn"[\s\S]*?data-detect-default[\s\S]*?<\/button>[\s\S]*?id="adapterStatusText"/);
  assert.match(html, /data-detect-default[\s\S]*?data-detect-hover/);
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
  assert.match(source, /window\.UartDebugControls\.bindPanelResizer\(handle/);
  assert.match(html, /aria-controls="avrDevicePanelViewport avrActionsPanelViewport avrAccountPanelViewport"/);
  assert.doesNotMatch(css, /\.avr-target-panel-viewport/);
  assert.match(source, /if \(collapsed\) panel\.setAttribute\("inert", ""\)/);
  assert.match(source, /restoreDevicePanelState\(\)/);
});

test("publishes legal pages and links them to Google sign-in", () => {
  const index = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
  const homeCss = fs.readFileSync(path.join(__dirname, "../public/home.css"), "utf8");
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
  assert.doesNotMatch(index, /service-note/);
  assert.match(
    index,
    /<\/main>[\s\S]*?<footer class="home-footer">[\s\S]*?class="footer-link-groups"/
  );
  assert.match(
    index,
    /aria-label="Contacts"[\s\S]*?href="mailto:uartdebug@gmail\.com"[\s\S]*?href="https:\/\/github\.com\/K1LLERV1PV2\/uartdebug\/issues"/
  );
  assert.match(
    homeCss,
    /body\s*\{[\s\S]*?display:\s*flex;[\s\S]*?min-height:\s*100vh;[\s\S]*?flex-direction:\s*column;/
  );
  assert.match(
    homeCss,
    /\.home-footer\s*\{[\s\S]*?grid-template-columns:\s*1fr;/
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

test("deploy revisions shared and page assets together on every public route", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "uartdebug-build-stamp-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const publicRoot = path.join(root, "public");
  fs.mkdirSync(publicRoot);
  const actualPublic = path.join(__dirname, "../public");
  fs.cpSync(actualPublic, publicRoot, { recursive: true });
  const result = childProcess.spawnSync(process.platform === "win32" ? "python" : "python3", [
    path.join(__dirname, "../.github/scripts/stamp_frontend_build.py"),
  ], { cwd: root, env: { ...process.env, FRONTEND_BUILD_ID: "shared-ui-test" }, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  for (const page of ["index.html", "avr.html", "uart.html", "privacy.html", "terms.html"]) {
    const html = fs.readFileSync(path.join(publicRoot, page), "utf8");
    assert.match(html, /ui-theme\.css\?v=shared-ui-test/);
    for (const reference of html.matchAll(/(?:src|href)=["']([^"']+\.(?:js|css))(?:\?v=([^"']+))?["']/g)) {
      if (reference[1].includes("vendor/") && !reference[1].includes("uartdebug-markdown")) continue;
      assert.equal(reference[2], "shared-ui-test", `${page}: ${reference[1]}`);
    }
  }
  const worker = fs.readFileSync(path.join(publicRoot, "sw.js"), "utf8");
  assert.match(worker, /uartdebug-shell-shared-ui-test/);
  for (const asset of ["/home.css", "/ui-theme.css", "/ui-controls.css", "/ui-controls.js"]) {
    assert.ok(worker.includes(JSON.stringify(asset)), `${asset} missing from offline shell`);
  }
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

test("invalid project display names report a toast without changing project identity, and a valid correction commits", () => {
  const { document, window: domWindow } = parseHTML('<html><body><div id="fileList"></div></body></html>');
  const storage = new Map();
  const hooks = loadAvrFrontendFunctionHooks([
    "createEmptyProject", "startInlineRename", "commitInlineFileEdit", "getProjectAiAccountFilesSnapshot",
    "prepare() { selectFile = name => { current = name; }; closeFileContextMenu = openFilesModal = refreshDocumentationPane = () => {}; }",
  ], { document, window: { setTimeout: () => 1, localStorage: {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: key => storage.delete(key),
  } } });
  hooks.prepare();
  const project = hooks.createEmptyProject();
  const snapshot = () => JSON.parse(JSON.stringify(hooks.getProjectAiAccountFilesSnapshot()));
  const before = snapshot();
  const sourceName = before.miniProjects[project.instanceId].files.source;
  hooks.startInlineRename(sourceName);
  let input = document.querySelector(".file-inline-input");
  input.value = "Invalid/project";
  input.dispatchEvent(new domWindow.Event("input"));
  assert.equal(hooks.commitInlineFileEdit(), false);
  input = document.querySelector(".file-inline-input");
  assert.equal(input.getAttribute("aria-invalid"), "true");
  assert.equal(document.querySelector(".file-inline-error"), null);
  const record = hooks.notifications().find(notification => notification.key === "project-name-validation");
  assert.ok(record);
  assert.equal(record.tone, "warning");
  assert.match(record.message, /Do not use path separators/);
  assert.deepEqual(snapshot(), before, "invalid input must not change the label, canonical names, files or project identity");
  assert.equal(document.querySelector(".file-item[data-file]").getAttribute("aria-label"), project.displayName);

  input.value = "A useful display label";
  input.dispatchEvent(new domWindow.Event("input"));
  assert.equal(input.getAttribute("aria-invalid"), "false");
  assert.equal(hooks.commitInlineFileEdit(), true);
  assert.equal(document.querySelector(".file-inline-input"), null);
  assert.equal(document.querySelector(".file-inline-error"), null);
  assert.equal(document.querySelector(".file-item[data-file] .file-name").textContent, "A useful display label");
  const row = document.querySelector(".file-item[data-file]");
  assert.equal(row.hasAttribute("data-outliner-icon"), false, "a project label must not reserve space for the former MP badge");
  assert.equal(row.hasAttribute("title"), false, "the internal source name must not appear in a project tooltip");
  assert.equal(row.hasAttribute("data-tooltip-disabled"), true, "the accessible project name must not create a duplicate tooltip");
  const after = snapshot();
  assert.equal(after.miniProjects[project.instanceId].displayName, "A useful display label");
  after.miniProjects[project.instanceId].displayName = before.miniProjects[project.instanceId].displayName;
  assert.deepEqual(after, before, "a display-label edit must preserve the specification name, source/guide names, contents and canonical project identity");
});

test("loads project cards from the private-backed API and fetches only the selected project", async () => {
  const {document}=parseHTML('<html><body><div id="fileTemplateGrid"></div></body></html>');
  const calls=[];
  const project={schemaVersion:1,id:"fixture",title:"Fixture",version:"Ver.1.0",canvasName:"Fixture.md",projectPath:"Target_Projects/Fixture Ver.1.0",canvas:{markdown:"# Project Fixture",locale:"en"},files:[{role:"source",name:"Fixture.c",content:""}]};
  const hooks=loadAvrFrontendFunctionHooks(["renderBuiltInMiniProjectCards","loadBuiltInMiniProjectDefinition"],{document,fetch:async url=>{
    calls.push(url);
    return {ok:true,json:async()=>url.endsWith("/fixture")?{ok:true,project}:{ok:true,schemaVersion:2,projects:[{id:"fixture",title:"Fixture",summary:"A reviewed example."}]}};
  }});
  await hooks.renderBuiltInMiniProjectCards();
  assert.deepEqual(calls,["/api/avr/ai/projects"]);
  const card=document.querySelector('[data-template-id="fixture"]');
  assert.ok(card);
  assert.equal(card.textContent,"FixtureA reviewed example.");
  assert.equal(card.disabled,false);
  const definition=await hooks.loadBuiltInMiniProjectDefinition("fixture");
  assert.equal(definition.canvasName,"Fixture.md");
  assert.deepEqual(calls,["/api/avr/ai/projects","/api/avr/ai/projects/fixture"]);
  assert.equal(fs.existsSync(path.join(__dirname,"../public/avr-mini-projects/catalog.json")),false);
});



test("empty workspaces stay empty after local and cloud restoration", () => {
  const {hooks}=loadCanvasLifecycleHooks();
  hooks.loadState();
  hooks.migrateLooseFilesToProjects();
  const empty=hooks.getEmptyProjectAiAccountWorkspace();
  assert.equal(Object.keys(empty.files).length,0);
  assert.equal(empty.current,null);
  assert.equal(hooks.applyProjectAiAccountWorkspace(empty),true);
  const snapshot=hooks.getProjectAiAccountFilesSnapshot();
  assert.equal(Object.keys(snapshot.files).length,0);
  assert.equal(Object.keys(snapshot.miniProjects).length,0);
  assert.equal(snapshot.current,null);
});

test("partial generation and description updates preserve the other stage and hide all service files", () => {
  const {hooks}=loadCanvasLifecycleHooks();
  const project=hooks.createEmptyProject();
  hooks.editCanvas("User specification");
  hooks.updateMiniProjectInstance(project.instanceId,{schemaVersion:1,id:project.id,title:"Blink",version:"Ver.1.0",canvasName:"Blink.md",projectPath:"Target_Projects/Blink Ver.1.0",files:[
    {role:"source",name:"Blink.c",content:"int main(void) { while(1){} }"},
    {role:"specification",name:"Blink.yaml",content:"microcontroller:\n  model: ATtiny1624\n",hidden:true},
  ]});
  let updated=hooks.getPublicMiniProjectInstance(project.instanceId);
  assert.equal(updated.files.find(file=>file.role==="guide").content,"");
  assert.equal(updated.files.find(file=>file.role==="source").name,"Blink.c");
  assert.equal(updated.canvasName,"Blink.md");
  assert.equal(updated.projectPath,"Target_Projects/Blink Ver.1.0");
  assert.equal(hooks.getProjectInstructionSnapshot().markdown,"User specification");
  hooks.updateMiniProjectInstance(project.instanceId,{schemaVersion:1,id:project.id,title:"Blink",version:"Ver.1.0",files:[{role:"guide",name:"Blink_description.md",content:"# Code description",locale:"en"}]});
  updated=hooks.getPublicMiniProjectInstance(project.instanceId);
  assert.match(updated.files.find(file=>file.role==="source").content,/int main/);
  assert.equal(updated.files.find(file=>file.role==="guide").content,"# Code description");
  assert.equal(updated.files.find(file=>file.role==="specification").hidden,true);
  const snapshot=hooks.getProjectAiAccountFilesSnapshot();
  const resource=snapshot.miniProjects[project.instanceId].files.specification;
  assert.equal(hooks.isHiddenMiniProjectFile(resource),true);
  hooks.selectFile(resource);
  assert.equal(hooks.getProjectAiAccountFilesSnapshot().current,snapshot.current);
  assert.equal(hooks.getVisibleWorkspaceFileNames().length,1);
});

test("legacy loose projects migrate without losing code, guides, resources, or answers", () => {
  const storage=new Map([["ud_avr_programming_state_v2",JSON.stringify({schemaVersion:2,files:{"blink.c":"// user code","blink.md":"# User guide","blink.yaml":"resource: old","unused.txt":"keep"},current:"blink.c",miniProjects:{},fileGroups:{},authorship:{}})],
    ["ud_avr_ai_project_instruction_v2",JSON.stringify({schemaVersion:2,revision:0,markdown:"Requirements",annotations:[{id:"q1",message:"Clock?",kind:"question",anchor:{quote:"Requirements",line:1},answer:"20 MHz",status:"open"}]})]]);
  const {hooks}=loadCanvasLifecycleHooks(storage);
  hooks.loadState();hooks.restoreProjectInstruction();hooks.migrateLooseFilesToProjects();hooks.selectFile("blink.c");
  const snapshot=hooks.getProjectAiAccountFilesSnapshot();
  assert.equal(Object.keys(snapshot.miniProjects).length,1);
  assert.equal(snapshot.files["blink.c"],"// user code");
  assert.equal(snapshot.files["blink.md"],"# User guide");
  assert.equal(snapshot.files["blink.yaml"],"resource: old");
  assert.equal(snapshot.files["unused.txt"],"keep");
  assert.deepEqual(Array.from(hooks.getVisibleWorkspaceFileNames()),["blink.c"]);
  assert.match(hooks.getProjectInstructionSnapshot().markdown,/20 MHz/);
});

test("legacy nested groups migrate direct guide links without retaining folder state", () => {
  const originalFiles = {
    "alpha.c": "// Alpha source", "beta.c": "// Beta source",
    "shared.md": "# Alpha guide", "leaf.md": "# Beta guide",
    "notes.txt": "Unclaimed notes", "image.svg": "<svg></svg>",
  };
  const groupState = { Root: { files: ["alpha.c", "shared.md"], groups: ["Child"], expanded: true },
    Child: { files: ["beta.c", "leaf.md"], groups: ["Root"], expanded: false } };
  const storage = new Map([["ud_avr_programming_state_v2", JSON.stringify({
    schemaVersion: 2, files: originalFiles, authorship: {}, miniProjects: {}, fileGroups: groupState, current: "alpha.c",
  })]]);
  const { hooks } = loadCanvasLifecycleHooks(storage);
  const legacyGroups = hooks.loadState();
  hooks.restoreProjectInstruction();
  hooks.migrateLooseFilesToProjects(legacyGroups);
  hooks.selectFile("alpha.c");
  const snapshot = hooks.getProjectAiAccountFilesSnapshot();
  assert.equal("fileGroups" in snapshot, false);
  assert.equal(Object.keys(snapshot.miniProjects).length, 2);
  for (const [name, text] of Object.entries(originalFiles)) assert.equal(snapshot.files[name], text);
  const alpha = Object.values(snapshot.miniProjects).find(project => project.files.source === "alpha.c");
  const beta = Object.values(snapshot.miniProjects).find(project => project.files.source === "beta.c");
  assert.equal(alpha.files.guide, "shared.md");
  assert.equal(beta.files.guide, "leaf.md");
  assert.equal(hooks.persistState(), true);
  assert.equal("fileGroups" in JSON.parse(storage.get("ud_avr_programming_state_v2")), false);
});

test("a guide shared by old grouped sources migrates into independently owned project guides", () => {
  const guide = "# Shared guide\nThe program must keep user code.";
  const authorship = { schemaVersion: 1, lines: ["human", "original"], updatedAt: 7 };
  const storage = new Map([["ud_avr_programming_state_v2", JSON.stringify({
    schemaVersion: 2, files: { "first.c": "// First", "second.c": "// Second", "manual.md": guide },
    authorship: { "manual.md": authorship }, miniProjects: {}, current: "second.c",
    fileGroups: { Examples: { files: ["first.c", "second.c", "manual.md"] } },
  })]]);
  const { hooks } = loadCanvasLifecycleHooks(storage);
  const legacyGroups = hooks.loadState();
  hooks.restoreProjectInstruction();
  hooks.migrateLooseFilesToProjects(legacyGroups);
  const snapshot = hooks.getProjectAiAccountFilesSnapshot();
  const projects = Object.values(snapshot.miniProjects);
  assert.equal(projects.length, 2);
  const guideNames = projects.map(project => project.files.guide);
  assert.equal(new Set(guideNames).size, 2);
  for (const name of guideNames) {
    assert.match(name, /\.md$/);
    assert.equal(snapshot.files[name], guide);
    assert.equal(JSON.stringify(snapshot.authorship[name]), JSON.stringify(authorship));
  }
  assert.equal(snapshot.files["manual.md"], guide);
  assert.equal("fileGroups" in snapshot, false);
});

test("legacy guide migration keeps case-insensitive stem priority without inheriting parent folders", () => {
  const originalFiles = { "Blink.C": "// Program", "BLINK.guide.md": "# Preferred guide", "Blink.md": "# Other guide",
    "Child.c": "// Child program", "parent.md": "# Parent guide" };
  const storage = new Map([["ud_avr_programming_state_v2", JSON.stringify({ schemaVersion: 2,
    files: originalFiles, authorship: {}, miniProjects: {}, current: "Blink.C",
    fileGroups: { Parent: { files: ["parent.md"], groups: ["Child"] }, Child: { files: ["Child.c"] } },
  })]]);
  const { hooks } = loadCanvasLifecycleHooks(storage);
  const groups = hooks.loadState();
  hooks.restoreProjectInstruction();
  hooks.migrateLooseFilesToProjects(groups);
  const snapshot = hooks.getProjectAiAccountFilesSnapshot();
  const blink = Object.values(snapshot.miniProjects).find(project => project.files.source === "Blink.C");
  const child = Object.values(snapshot.miniProjects).find(project => project.files.source === "Child.c");
  assert.equal(blink.files.guide, "BLINK.guide.md");
  assert.notEqual(child.files.guide, "parent.md");
  assert.equal(snapshot.files[child.files.guide], "");
  for (const [name, text] of Object.entries(originalFiles)) assert.equal(snapshot.files[name], text);
});

test("cloud group migration writes one canonical snapshot without reopening the old instruction document", async () => {
  const fixture = loadCanvasLifecycleHooks().hooks;
  const project = fixture.createEmptyProject();
  const cloud = JSON.parse(JSON.stringify(fixture.getProjectAiAccountFilesSnapshot()));
  const cloudProject = cloud.miniProjects[project.instanceId];
  delete cloudProject.files.guide;
  cloudProject.guides = {};
  cloudProject.defaultLocale = cloudProject.selectedLocale = "";
  cloud.files["old-guide.md"] = "# Historical guide\nThe program uses a timer.";
  cloud.fileGroups = { Historical: { files: [cloudProject.files.source, "old-guide.md"] } };
  const accountKey = "group-migration-account", requests = [];
  const { hooks } = loadCanvasLifecycleHooks(accountSyncStorage(accountKey, 7), { fetch: async (url, init) => {
    requests.push({ url, ...init });
    return init.method === "GET" ? jsonResponse({ ok: true, accountKey, documents: {
      files: { revision: 7, data: cloud }, instruction: { revision: 99, data: { markdown: "Inactive draft" } },
    } }) : jsonResponse({ ok: true, document: { revision: 8 } });
  } });
  hooks.restoreProjectAiAccountSyncState();
  hooks.account(accountKey);
  await hooks.initializeProjectAiAccountWorkspace();
  assert.equal(hooks.syncState().dirty, true);
  assert.equal(hooks.syncState().legacyInstructionRevision, null);
  assert.equal(hooks.getProjectAiAccountFilesSnapshot().miniProjects[project.instanceId].files.guide, "old-guide.md");
  await hooks.saveProjectAiAccountWorkspace();
  const writes = requests.filter(request => request.method === "PUT");
  assert.equal(writes.length, 1);
  const saved = JSON.parse(writes[0].body);
  assert.equal(saved.baseRevision, 7);
  assert.equal(saved.expectedLegacyInstructionRevision, undefined);
  assert.equal("fileGroups" in saved.data, false);
  assert.equal(saved.data.files["old-guide.md"], cloud.files["old-guide.md"]);
  assert.equal(hooks.syncState().dirty, false);
});

test("failed local group migration leaves the old envelope and split keys available for recovery", () => {
  const legacy = JSON.stringify({ schemaVersion: 2, files: { "old.c": "// Original", "guide.md": "# Original guide" },
    fileGroups: { Old: { files: ["old.c", "guide.md"] } }, authorship: {}, miniProjects: {}, current: "old.c" });
  const oldGroupKey = "ud_avr_programming_file_groups_v1";
  const storage = new Map([["ud_avr_programming_state_v2", legacy], [oldGroupKey, "legacy backup"]]);
  const { hooks } = loadCanvasLifecycleHooks(storage, { setItem(key) {
    if (key === "ud_avr_programming_state_v2") throw new Error("Storage quota");
  } });
  const legacyGroups = hooks.loadState();
  hooks.restoreProjectInstruction();
  hooks.migrateLooseFilesToProjects(legacyGroups);
  assert.equal(hooks.persistState(), false);
  assert.equal(storage.get("ud_avr_programming_state_v2"), legacy);
  assert.equal(storage.get(oldGroupKey), "legacy backup");
});

test("unreadable and newer workspace envelopes are preserved exactly before any replacement write", () => {
  for (const raw of ["{ damaged workspace", JSON.stringify({ schemaVersion: 99, files: { "future.c": "Future source" }, opaque: [1, 2] })]) {
    const stateKey = "ud_avr_programming_state_v2";
    const storage = new Map([[stateKey, raw]]);
    const { hooks } = loadCanvasLifecycleHooks(storage);
    hooks.loadState();
    const recovery = [...storage.entries()].find(([key]) => key.startsWith("ud_avr_ai_files_recovery_v1:unreadable-workspace"));
    assert.ok(recovery);
    assert.equal(JSON.parse(recovery[1]).rawWorkspace, raw);
    assert.equal(storage.get(stateKey), raw, "reading alone cannot replace the original");
    assert.equal(hooks.persistState(), true);
    assert.equal(JSON.parse(storage.get(recovery[0])).rawWorkspace, raw);
    assert.match(hooks.notifications().find(item => item.key === "workspace-read").details, /recovery copy/);
  }
});

test("a failed raw workspace recovery copy blocks local overwrite and cloud initialization or save", async () => {
  const stateKey = "ud_avr_programming_state_v2", raw = "{ original unreadable projects";
  const storage = new Map([[stateKey, raw]]);
  let requests = 0;
  const { hooks } = loadCanvasLifecycleHooks(storage, { setItem(key, value) {
    if (key.startsWith("ud_avr_ai_files_recovery_v1:unreadable-workspace")) throw new Error("Quota exhausted");
    storage.set(key, String(value));
  }, fetch: async () => { requests++; throw new Error("Cloud must remain untouched"); } });
  hooks.loadState();
  assert.equal(hooks.persistState(), false);
  assert.throws(() => hooks.persistState({ throwOnError: true }), /preserved for recovery/);
  hooks.account("account");
  assert.equal(await hooks.initializeProjectAiAccountWorkspace(), null);
  hooks.account("account", true);
  hooks.dirtyAccount();
  await hooks.saveProjectAiAccountWorkspace();
  assert.equal(requests, 0);
  assert.equal(storage.get(stateKey), raw);
  assert.match(hooks.notifications().find(item => item.key === "workspace-read").details, /paused/);
});

test("canonical projects without a description remain fresh until their program changes", () => {
  const { hooks } = loadCanvasLifecycleHooks();
  const project = hooks.installMiniProjectDefinition({ schemaVersion: 1, contract: "uartdebug-project/v2", id: "target", title: "Target", version: "Ver.1.0",
    canvasName: "Target.md", projectPath: "Target_Projects/Target", canvas: { markdown: "# Project Target", locale: "ru" },
    files: [{ role: "source", name: "Target.c", content: "#include <xc.h>\nint main(void) {}" }],
  });
  const request = hooks.getProjectAiRequestPayload("generate");
  assert.equal(request.currentProject.guide, "");
  assert.equal(request.currentProject.guideAuthorship, undefined);
  assert.doesNotThrow(() => hooks.assertProjectAiUpdateIsFresh(request));
  hooks.updateMiniProjectInstance(project.instanceId, { id: "target", title: "Target", version: "Ver.1.0", files: [{ role: "source", name: "Target.c", content: "Changed program" }] });
  assert.throws(() => hooks.assertProjectAiUpdateIsFresh(request), /newer local edits/i);
});

test("project-local rules stay hidden, survive reload, and follow only the selected project", () => {
  const { hooks, storage } = loadCanvasLifecycleHooks();
  const documents = [{ name: "AGENTS.md", content: "! Keep the UART ISR short.\r\n" }, { name: "00_README.md", content: "# Устройство\r\nRead only this project.\r\n" }];
  const first = hooks.installMiniProjectDefinition({ id: "first", title: "First", version: "Ver.1.0", canvas: { markdown: "# Project First\n\nProject version - Ver.1.0\n", locale: "en" },
    projectDocuments: documents, files: [{ role: "source", name: "First.c", content: "int main(void) {}" }] });
  assert.equal(JSON.stringify(hooks.getProjectAiRequestPayload().currentProject.projectDocuments), JSON.stringify(documents));
  assert.equal(first.files.some(file => ["AGENTS.md", "00_README.md"].includes(file.name)), false);
  const second = hooks.createEmptyProject();
  assert.equal(hooks.getProjectAiRequestPayload().currentProject.projectDocuments.length, 0);
  hooks.selectFile(first.files.find(file => file.role === "source").storageName);
  hooks.updateMiniProjectInstance(first.instanceId, { id: "first", title: "First", files: [{ role: "source", name: "First.c", content: "int main(void) { return 0; }" }] });
  const reloaded = loadCanvasLifecycleHooks(storage).hooks;
  reloaded.loadState();
  reloaded.restoreProjectInstruction();
  assert.equal(JSON.stringify(reloaded.getProjectAiRequestPayload().currentProject.projectDocuments), JSON.stringify(documents));
  const snapshot = reloaded.getProjectAiAccountFilesSnapshot();
  assert.equal(Object.keys(snapshot.files).some(name => /(?:AGENTS|00_README)\.md$/.test(name)), false);
  reloaded.selectFile(second.files.find(file => file.role === "source").storageName);
  assert.equal(reloaded.getProjectAiRequestPayload().currentProject.projectDocuments.length, 0);
});

test("legacy Russian remarks migrate with localized headings and preserve answers exactly", () => {
  const hooks = loadAvrFrontendFunctionHooks(["normalizeProjectInstructionDocument"]);
  const markdown = "# Проект Светодиод\n\nНастроить светодиод.";
  const answer = "100 мс\nНе менять вывод.";
  const result = hooks.normalizeProjectInstructionDocument({ markdown, locale: "ru-RU", annotations: [{ id: "legacy", kind: "question", message: "Какой период?", answer, status: "resolved" }] });
  assert.match(result.markdown, /\[ИИ\.1\] Вопрос\./);
  assert.match(result.markdown, /> > \*\*Пользователь:\*\* 100 мс\n> > Не менять вывод\./);
  assert.match(result.markdown, /Решено в предыдущей версии спецификации\./);
  assert.doesNotMatch(result.markdown, /Question|User|Resolved/);
  assert.equal(hooks.normalizeProjectInstructionDocument(result).markdown, result.markdown);
});

test("preserved Russian remark identifiers do not choose the language of new English migrated remarks", () => {
  const hooks = loadAvrFrontendFunctionHooks(["normalizeProjectInstructionDocument"]);
  const markdown = "# Project Blink\n\nProject version - Ver.1.0\n\nUse the selected microcontroller.\n\n> ###### *[ИИ.7] Information.*\n>\n> Keep the legacy identifier.\n";
  const result = hooks.normalizeProjectInstructionDocument({ markdown, locale: "", annotations: [{ id: "legacy", kind: "question", message: "Which pin?", answer: "PA3", status: "open" }] });
  assert.match(result.markdown, /\[ИИ\.7\] Information\./);
  assert.match(result.markdown, /\[AI\.8\] Question\./);
  assert.match(result.markdown, /\*\*User:\*\* PA3/);
});

test("a first Russian description replaces the selected empty English placeholder atomically", () => {
  for (const placeholderName of ["Blink (description).md", "Untitled project (description).md"]) {
    const { hooks } = loadCanvasLifecycleHooks();
    const project = hooks.installMiniProjectDefinition({ id: "blink", title: "Blink", version: "Ver.1.0", defaultLocale: "en",
      canvas: { markdown: "# Project Blink\n\nProject version - Ver.1.0\n", locale: "ru" },
      files: [{ role: "source", name: "Blink.c", content: "int main(void) {}" },
        { role: "guide", name: placeholderName, content: "", locale: "en" },
        { role: "guide", name: "Blink (description) (fr).md", content: "Description française existante.", locale: "fr" }],
    });
    const oldPlaceholder = project.files.find(file => file.role === "guide" && file.locale === "en");
    hooks.updateMiniProjectInstance(project.instanceId, { id: "blink", title: "Blink", version: "Ver.1.0", files: [
      { role: "guide", name: "Blink (description).md", content: "# Описание\n\nТекущий код.\n", locale: "ru" },
    ] });
    const updated = hooks.getPublicMiniProjectInstance(project.instanceId);
    assert.equal(updated.files.find(file => file.role === "guide" && file.locale === "ru").storageName, oldPlaceholder.storageName);
    assert.equal(updated.files.find(file => file.role === "guide" && file.locale === "ru").name, "Blink (description).md");
    assert.equal(updated.files.find(file => file.role === "guide" && file.locale === "fr").content, "Description française existante.");
    assert.equal(updated.files.some(file => file.role === "guide" && file.locale === "en"), false);
    assert.equal(updated.selectedLocale, "ru");
    assert.equal(updated.files.find(file => file.role === "source").content, "int main(void) {}");
  }
});

test("a description with unknown language changes its locale without creating a second artifact", () => {
  const { hooks } = loadCanvasLifecycleHooks();
  const project = hooks.installMiniProjectDefinition({ id: "blink", title: "Blink", version: "Ver.1.0", defaultLocale: "und",
    files: [{ role: "source", name: "Blink.c", content: "int main(void) {}" },
      { role: "guide", name: "Blink (description).md", content: "# Descripción del código\n\nEl programa termina.\n", locale: "und" },
      { role: "guide", name: "Blink (description) (fr).md", content: "Description française existante.", locale: "fr" }],
  });
  const oldGuide = project.files.find(file => file.role === "guide" && file.locale === "und");
  hooks.updateMiniProjectInstance(project.instanceId, { id: "blink", title: "Blink", version: "Ver.1.0", files: [
    { role: "guide", name: "Blink (description).md", content: "# Descripción del código\n\nEl código actual termina.\n", locale: "es" },
  ] });
  const updated = hooks.getPublicMiniProjectInstance(project.instanceId);
  const guides = updated.files.filter(file => file.role === "guide");
  assert.equal(guides.length, 2);
  assert.equal(guides.find(file => file.locale === "es").storageName, oldGuide.storageName);
  assert.equal(guides.find(file => file.locale === "es").name, oldGuide.name);
  assert.equal(guides.find(file => file.locale === "fr").content, "Description française existante.");
  assert.equal(updated.selectedLocale, "es");
  assert.equal(updated.files.some(file => file.locale === "und"), false);
});

test("an imported guide without language metadata uses und instead of an invalid synthetic language", () => {
  const { hooks } = loadCanvasLifecycleHooks();
  const project = hooks.installMiniProjectDefinition({ id: "blink", title: "Blink", files: [
    { role: "source", name: "Blink.c", content: "int main(void) {}" },
    { role: "guide", name: "Blink (description).md", content: "Descripción del programa." },
  ] });
  assert.equal(project.files.find(file => file.role === "guide").locale, "und");
  assert.equal(hooks.getProjectAiRequestPayload("describe").currentProject.guideLocale, "und");
});

test("motion defers Markdown decoration and final layout completes without a later preview frame", () => {
  const { document } = parseHTML('<html><body></body></html>');
  const frames = new Map();
  let frameId = 0, refreshes = 0;
  const hooks = loadAvrFrontendFunctionHooks([
    "registerMarkdownLiveEditor", "renderMarkdownLivePreviewState", "scheduleMarkdownLivePreview", "settleWorkspaceEditors",
    "begin(cm) { projectInstructionEditor = cm; workspaceTransitionTimer = 17; }",
    "end() { workspaceTransitionTimer = null; settleWorkspaceEditors(); }",
  ], { document, window: {
    UartDebugMarkdown: loadVendoredMarkdownRuntime(document),
    requestAnimationFrame(callback) { frames.set(++frameId, callback); return frameId; },
    cancelAnimationFrame(id) { frames.delete(id); },
  }, CodeMirror: { registerHelper() {}, Pos: (line, ch) => ({ line, ch }) } });
  const cm = createMarkdownCodeMirrorStub("# Title\n\nA paragraph with **bold text**.", document);
  cm.refresh = () => { refreshes++; hooks.scheduleMarkdownLivePreview("instruction"); };
  hooks.begin(cm);
  const state = hooks.registerMarkdownLiveEditor("instruction", cm);
  hooks.renderMarkdownLivePreviewState(state);
  assert.equal(cm.marks.length, 0, "a moving text layer must not replace its decorations");
  assert.equal(frames.size, 0);
  hooks.end();
  assert.ok(refreshes > 0);
  assert.ok(cm.marks.some(mark => !mark.cleared), "Markdown must be decorated before layout completion returns");
  assert.equal(frames.size, 0, "refresh viewport events must not queue a second visible layout");
  assert.deepEqual(cm.scrollCalls.at(-1), { kind: "scrollTo", left: 7, top: 46 });
});

test("synchronous workspace layout consumes a previously queued Markdown preview", () => {
  const { document } = parseHTML('<html><body></body></html>');
  const frames = new Map();
  const hooks = loadAvrFrontendFunctionHooks([
    "registerMarkdownLiveEditor", "settleWorkspaceEditors",
    "prepare(cm) { projectInstructionEditor = cm; }",
  ], { document, window: {
    UartDebugMarkdown: loadVendoredMarkdownRuntime(document),
    requestAnimationFrame(callback) { frames.set(42, callback); return 42; },
    cancelAnimationFrame(id) { frames.delete(id); },
  }, CodeMirror: { registerHelper() {}, Pos: (line, ch) => ({ line, ch }) } });
  const cm = createMarkdownCodeMirrorStub("# Title\n\nExisting description.", document);
  cm.refresh = () => {};
  hooks.prepare(cm);
  hooks.registerMarkdownLiveEditor("instruction", cm);
  assert.equal(frames.size, 1);
  hooks.settleWorkspaceEditors();
  assert.equal(frames.size, 0);
  assert.ok(cm.marks.some(mark => !mark.cleared));
});
