// Desktop AVR projects with a specification, C program, code description and XC8 compilation.
(function () {
  const STORAGE_KEY = "ud_avr_programming_files_v1";
  const STORAGE_STATE = "ud_avr_programming_state_v2";
  const STORAGE_CURRENT = "ud_avr_programming_current_v1";
  const STORAGE_GROUPS = "ud_avr_programming_file_groups_v1";
  const STORAGE_MINI_PROJECTS = "ud_avr_programming_mini_projects_v1";
  const STORAGE_OUTLINER_WIDTH = "ud_avr_programming_outliner_width_v1";
  const STORAGE_EDITOR_COLLAPSED = "ud_avr_programming_editor_collapsed_v1";
  const STORAGE_DOCUMENTATION_WIDTH =
    "ud_avr_programming_documentation_width_v1";
  const STORAGE_PROJECT_INSTRUCTION =
    "ud_avr_ai_project_instruction_v2";
  const STORAGE_PROJECT_INSTRUCTION_LEGACY =
    "ud_avr_ai_project_instruction_v1";
  const STORAGE_PROJECT_AI_COLUMN_WIDTH =
    "ud_avr_ai_column_width_v1";
  const STORAGE_PROJECT_AI_ACCOUNT_SYNC = "ud_avr_ai_account_sync_v1";
  const STORAGE_PROJECT_AI_LOCAL_DIRTY =
    "ud_avr_ai_local_dirty_v1";
  const STORAGE_PROJECT_AI_FILES_RECOVERY =
    "ud_avr_ai_files_recovery_v1";
  const STORAGE_PROJECT_AI_INSTRUCTION_RECOVERY =
    "ud_avr_ai_instruction_recovery_v1";
  const STORAGE_DEVICE_PANEL_STATE =
    "ud_avr_programming_device_panel_state_v2";
  const PROJECT_AI_AUTH_SESSION_URL = "/api/avr/ai/auth/session";
  const PROJECT_AI_GOOGLE_START_URL = "/api/avr/ai/auth/google/start";
  const PROJECT_AI_LOGOUT_URL = "/api/avr/ai/auth/logout";
  const PROJECT_AI_ACCOUNT_PROFILE_URL = "/api/avr/ai/account/profile";
  const PROJECT_AI_ACCOUNT_WORKSPACE_URL =
    "/api/avr/ai/account/workspace";
  const MARKDOWN_AUTHORSHIP_SCHEMA_VERSION = 1;
  const MARKDOWN_AUTHORSHIP_VALUES = new Set(["original", "human", "ai"]);
  const LEGACY_STORAGE_KEY = "ud_c_canvas_files_v1";
  const LEGACY_STORAGE_CURRENT = "ud_c_canvas_current_v1";
  const AVR_UPDI_RUNTIME_KEY = "__UARTDEBUG_AVR_PROGRAMMING_UPDI__";
  const LEGACY_UPDI_RUNTIME_KEY = "__UARTDEBUG_CANVAS_UPDI__";
  const AVR_UPDI_BRIDGE_KEY = "__UARTDEBUG_AVR_PROGRAMMING_UPDI_BRIDGE__";
  const LEGACY_UPDI_BRIDGE_KEY = "__UARTDEBUG_CANVAS_UPDI_BRIDGE__";
  const AVR_SERIAL_STATE_EVENT = "ud-avr-programming-serial-state";
  const LEGACY_SERIAL_STATE_EVENT = "ud-canvas-serial-state";
  const OUTLINER_DEFAULT_WIDTH = 305;
  const WORKSPACE_PANEL_COMPACT_WIDTH = 62;
  const WORKSPACE_PANEL_COMPACT_THRESHOLD = 112;
  const WORKSPACE_PANEL_COLLAPSE_DISTANCE = 120;
  const WORKSPACE_PANEL_REOPEN_DISTANCE = 48;
  const OUTLINER_MIN_EXPANDED_WIDTH = 180;
  const OUTLINER_EDITOR_MIN_WIDTH = 500;
  const DOCUMENTATION_DEFAULT_WIDTH = 360;
  const DOCUMENTATION_MIN_WIDTH = 240;
  const WORKSPACE_RESIZER_TOTAL_WIDTH = 42;
  const PROJECT_AI_COLUMN_DEFAULT_WIDTH = 318;
  const PROJECT_AI_COLUMN_MIN_WIDTH = 238;
  const DEVICE_PANEL_EXPANDED_HEIGHT = 112;
  const DEVICE_PANEL_COMPACT_HEIGHT = 54;
  const DEVICE_PANEL_COLLAPSED_HEIGHT = 0;
  const DEVICE_PANEL_DRAG_THRESHOLD = 48;
  const MINI_PROJECT_IMPORT_EVENT = "ud-avr-mini-project";
  const MINI_PROJECT_INSTALLED_EVENT = "ud-avr-mini-project-installed";
  const MINI_PROJECT_READY_EVENT = "ud-avr-mini-projects-ready";
  const DEFAULT_PROJECT_INSTRUCTION = "";
  const MINI_PROJECT_ARCHIVE_WORKSPACE_LIMITS = Object.freeze({
    maxArchiveBytes: 4 * 1024 * 1024,
    maxEntryUncompressedBytes: 2 * 1024 * 1024,
    maxTotalUncompressedBytes: 2 * 1024 * 1024,
    maxTextBytes: 256 * 1024,
    maxImageBytes: 1024 * 1024,
  });

  const $ = (id) => document.getElementById(id);
  const miniProjectCore = window.UartDebugAvrMiniProjectCore;
  const projectFormat = window.UartDebugAvrProjectFormat;
  let resolveMiniProjectBridgeReady = null;
  const miniProjectBridgeReady = new Promise((resolve) => {
    resolveMiniProjectBridgeReady = resolve;
  });

  let editor = null;
  let files = Object.create(null);
  let fileAuthorship = Object.create(null);
  let fileGroups = Object.create(null);
  let miniProjects = Object.create(null);
  let current = null;
  let saveTimer = null;
  let compileErrorLineHandle = null;
  let contextMenuFile = null;
  let inlineFileEdit = null;
  let outlinerWidth = OUTLINER_DEFAULT_WIDTH;
  let outlinerPreferredWidth = OUTLINER_DEFAULT_WIDTH;
  let editorCollapsed = false;
  let activeSplitResize = null;
  let workspaceEditorRefreshFrame = null;
  let documentationWidth = DOCUMENTATION_DEFAULT_WIDTH;
  let documentationPreferredWidth = DOCUMENTATION_DEFAULT_WIDTH;
  const workspacePanelMinWidths = [OUTLINER_MIN_EXPANDED_WIDTH,
    PROJECT_AI_COLUMN_MIN_WIDTH, OUTLINER_EDITOR_MIN_WIDTH, DOCUMENTATION_MIN_WIDTH];
  let documentationHeadingIndex = new Map();
  let documentationRenderedHeadingIndex = new Map();
  let documentationMarkerHandles = [];
  let documentationMarkerFrame = null;
  let documentationRenderTimer = null;
  let documentationTargetTimer = null;
  let documentationEditMode = false;
  let documentationEditor = null;
  let documentationEditorSyncing = false;
  let documentationEditSaveTimer = null;
  let projectAiColumnWidth = PROJECT_AI_COLUMN_DEFAULT_WIDTH;
  let projectAiColumnPreferredWidth = PROJECT_AI_COLUMN_DEFAULT_WIDTH;
  let projectInstructionDocument = {
    schemaVersion: 2,
    revision: 0,
    markdown: DEFAULT_PROJECT_INSTRUCTION,
    locale: "",
    annotations: [],
    target: { mcu: "", packageName: "" },
    authorship: {
      schemaVersion: MARKDOWN_AUTHORSHIP_SCHEMA_VERSION,
      lines: ["original"],
      updatedAt: 1,
    },
  };
  const projectInstructionSaveJobs = new Map();
  // The unassigned specification is a draft before project creation. Project
  // specifications travel with their project in the workspace/account snapshot.
  let unassignedProjectInstructionDocument = null;
  let projectInstructionInstanceId = null;
  let projectInstructionScopeEpoch = 0;
  let projectInstructionStorageReadFailed = false;
  let projectInstructionRenderFrame = null;
  let projectInstructionEditor = null;
  let projectInstructionEditorSyncing = false;
  let projectInstructionCompositionActive = false;
  const markdownLiveEditors = new Map();
  let canvasSupportedDevices = [];
  let devicePanelState = "expanded";
  let devicePanelHeight = DEVICE_PANEL_EXPANDED_HEIGHT;
  let devicePanelTransitionTimer = null;
  let projectAiAccountFilesSaveTimer = null;
  let projectAiAccountInstructionSaveTimer = null;
  let projectAiAccountWorkspacePromise = null;
  let projectAiAccountWorkspaceRetryTimer = null;
  let projectAiAccountWorkspaceRetryCount = 0;
  let projectAiAccountWorkspaceEpoch = 0;
  let projectAiAccountWorkspaceApplying = false;
  let projectAiBootComplete = false;
  let projectAiAccountSync = {
    ready: false,
    accountKey: "",
    revisions: { files: 0, instruction: 0 },
    dirty: { files: false, instruction: false },
    saving: { files: false, instruction: false },
    conflicts: { files: false, instruction: false },
    mutations: { files: 0, instruction: 0 },
    retries: { files: 0, instruction: 0 },
  };
  let projectAiLocalDirty = {
    files: false,
    instruction: false,
  };
  let projectAiRequestInFlight = false;
  let projectAiAuthSession = null;
  let projectAiAuthSessionPromise = null;
  let projectAiAuthRequestEpoch = 0;
  let projectAiProfileSavePromise = null;
  let projectAiProfileNameDirty = false;
  let projectAiProfileAccountKey = "";
  let projectAiQuotaUpdateSequence = 0;
  let projectAiLatestQuota = null;
  let workspaceResizeFrame = null;
  let workspaceResizeObserver = null;
  let watermarkFitFrame = null;
  let watermarkResizeObserver = null;
  let siteDialogResolve = null;
  const HEX_FILE_EXTENSIONS = new Set(["hex", "ihex"]);
  const COMPILE_PROJECT_FILE_EXTENSIONS = new Set([
    "c",
    "h",
    "cpp",
    "cc",
    "hpp",
    "ino",
    "s",
    "asm",
    "txt",
  ]);
  const COMPILE_C_SOURCE_EXTENSIONS = new Set(["c"]);
  const COMPILE_HEADER_EXTENSIONS = new Set(["h", "hpp"]);

  function createDictionary(source) {
    const dictionary = Object.create(null);
    if (source && typeof source === "object" && !Array.isArray(source)) {
      Object.assign(dictionary, source);
    }
    return dictionary;
  }

  function cloneJsonMetadata(value, fallback) {
    if (value === undefined) return fallback;
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return fallback;
    }
  }

  function splitMarkdownAuthorshipLines(value) {
    return String(value ?? "").replace(/\r\n?/g, "\n").split("\n");
  }

  function normalizeMarkdownAuthorship(
    value,
    markdown,
    { fallbackAuthor = "original" } = {}
  ) {
    const source = value && typeof value === "object" ? value : {};
    const fallback = MARKDOWN_AUTHORSHIP_VALUES.has(fallbackAuthor)
      ? fallbackAuthor
      : "original";
    const lineCount = splitMarkdownAuthorshipLines(markdown).length;
    const lines = Array.isArray(source.lines)
      ? source.lines
          .slice(0, lineCount)
          .map((author) =>
            MARKDOWN_AUTHORSHIP_VALUES.has(String(author))
              ? String(author)
              : fallback
          )
      : [];
    while (lines.length < lineCount) lines.push(fallback);
    const updatedAt = Number(source.updatedAt);
    return {
      schemaVersion: MARKDOWN_AUTHORSHIP_SCHEMA_VERSION,
      lines,
      updatedAt:
        Number.isSafeInteger(updatedAt) && updatedAt > 0
          ? updatedAt
          : 1,
    };
  }

  function createMarkdownAuthorship(markdown, author = "original") {
    return {
      ...normalizeMarkdownAuthorship(null, markdown, {
        fallbackAuthor: author,
      }),
      updatedAt: Date.now(),
    };
  }

  function updateMarkdownAuthorshipForChange(
    authorship,
    previousMarkdown,
    change,
    author = "human"
  ) {
    const normalized = normalizeMarkdownAuthorship(
      authorship,
      previousMarkdown
    );
    if (!change?.from || !change?.to || !Array.isArray(change.text)) {
      return createMarkdownAuthorship(previousMarkdown, author);
    }
    const startLine = Math.max(0, Number(change.from.line) || 0);
    const removedLineCount =
      Math.max(startLine, Number(change.to.line) || startLine) - startLine + 1;
    const insertedLineCount = Math.max(1, change.text.length);
    normalized.lines.splice(
      startLine,
      removedLineCount,
      ...Array(insertedLineCount).fill(author)
    );
    normalized.updatedAt = Date.now();
    return normalized;
  }

  function mergeMarkdownAuthorshipForReplacement(
    previousMarkdown,
    nextMarkdown,
    previousAuthorship,
    author = "ai"
  ) {
    const previousLines = splitMarkdownAuthorshipLines(previousMarkdown);
    const nextLines = splitMarkdownAuthorshipLines(nextMarkdown);
    const previous = normalizeMarkdownAuthorship(
      previousAuthorship,
      previousMarkdown
    );
    let prefix = 0;
    while (
      prefix < previousLines.length &&
      prefix < nextLines.length &&
      previousLines[prefix] === nextLines[prefix]
    ) {
      prefix += 1;
    }
    let suffix = 0;
    while (
      suffix < previousLines.length - prefix &&
      suffix < nextLines.length - prefix &&
      previousLines[previousLines.length - 1 - suffix] ===
        nextLines[nextLines.length - 1 - suffix]
    ) {
      suffix += 1;
    }
    const nextAuthors = [
      ...previous.lines.slice(0, prefix),
      ...Array(Math.max(0, nextLines.length - prefix - suffix)).fill(author),
      ...(suffix
        ? previous.lines.slice(previous.lines.length - suffix)
        : []),
    ];
    return {
      schemaVersion: MARKDOWN_AUTHORSHIP_SCHEMA_VERSION,
      lines: nextAuthors,
      updatedAt: Date.now(),
    };
  }

  function getFileAuthorship(fileName) {
    const name = String(fileName || "");
    const content = hasFile(name) ? getLiveFileContent(name) : "";
    const normalized = normalizeMarkdownAuthorship(
      fileAuthorship[name],
      content
    );
    fileAuthorship[name] = normalized;
    return normalized;
  }

  function setFileAuthorship(fileName, authorship, markdown = null) {
    const name = String(fileName || "");
    if (!name) return;
    const source = markdown === null ? getLiveFileContent(name) : markdown;
    fileAuthorship[name] = normalizeMarkdownAuthorship(authorship, source);
  }

  function normalizeProjectAssets(value) {
    if (Array.isArray(value)) return cloneJsonMetadata(value, []);
    if (!value || typeof value !== "object") return [];

    return Object.entries(value).map(([path, rawAsset]) => {
      if (rawAsset && typeof rawAsset === "object") {
        return {
          ...cloneJsonMetadata(rawAsset, {}),
          path: String(rawAsset.path || rawAsset.name || path),
        };
      }
      return {
        path,
        dataUrl: typeof rawAsset === "string" ? rawAsset : "",
      };
    });
  }

  function setHexStatus(state, filename) {
    setHexStatus._state = state;

    const el = document.getElementById("hexStatus");
    if (!el) return;

    let label = el.querySelector(".label");
    if (!label) label = el;

    el.classList.remove("building", "ready", "error");

    switch (state) {
      case "building":
        el.classList.add("building");
        label.textContent = "HEX: building...";
        markHexDownloadReady(false);
        break;

      case "ready":
        el.classList.add("ready");
        label.textContent = filename ? `HEX: ${filename}` : "HEX: ready";
        markHexDownloadReady(true);
        break;

      case "error":
        el.classList.add("error");
        label.textContent = "HEX: failed";
        markHexDownloadReady(false);
        break;

      default:
        label.textContent = "HEX: idle";
        markHexDownloadReady(false);
        break;
    }
  }

  function markHexDownloadReady(ready) {
    const el = document.getElementById("hexStatus");
    if (!el) return;

    if (ready) {
      el.classList.add("download-ready");
      el.setAttribute("aria-disabled", "false");
      el.title = "Download .hex";
    } else {
      el.classList.remove("download-ready");
      el.setAttribute("aria-disabled", "true");
      el.title = "HEX not ready";
    }
  }

  function updateHexUI(hasHex) {
    markHexDownloadReady(!!hasHex);
  }

  function fitEditorFileWatermark() {
    const watermark = $("editorFileWatermark");
    const container = watermark?.closest(".editor-container");
    if (!watermark || !container) return;

    watermark.style.removeProperty("font-size");
    if (!watermark.textContent) return;

    const maximumWidth = container.clientWidth * 0.66;
    const preferredFontSize = Number.parseFloat(
      window.getComputedStyle(watermark).fontSize
    );
    const naturalWidth = watermark.scrollWidth;
    if (
      !Number.isFinite(preferredFontSize) ||
      preferredFontSize <= 0 ||
      maximumWidth <= 0 ||
      naturalWidth <= maximumWidth
    ) {
      return;
    }

    const safeMaximumWidth = Math.max(1, maximumWidth - 1);
    const fittedFontSize =
      preferredFontSize * (safeMaximumWidth / naturalWidth);
    watermark.style.fontSize = `${Math.max(1, fittedFontSize)}px`;

    const correctedWidth = watermark.scrollWidth;
    if (correctedWidth > maximumWidth) {
      const currentFontSize = Number.parseFloat(watermark.style.fontSize);
      watermark.style.fontSize = `${Math.max(
        1,
        currentFontSize * (safeMaximumWidth / correctedWidth)
      )}px`;
    }
  }

  function scheduleEditorFileWatermarkFit() {
    if (watermarkFitFrame !== null) return;
    watermarkFitFrame = window.requestAnimationFrame(() => {
      watermarkFitFrame = null;
      fitEditorFileWatermark();
    });
  }

  function refreshFontDependentMeasurements() {
    scheduleEditorFileWatermarkFit();
    document
      .querySelectorAll(".custom-select")
      .forEach(updateCustomSelectIntrinsicWidth);
  }

  function updateEditorFileWatermark(fileName) {
    const watermark = $("editorFileWatermark");
    if (!watermark) return;
    watermark.style.removeProperty("font-size");
    watermark.textContent = fileName ? getMiniProjectForFile(fileName)?.project.fileNames?.[fileName] || fileName : "";
    scheduleEditorFileWatermarkFit();
  }

  function setCompileLogText(text) {
    const el = $("compileLog");
    if (!el) return;
    el.textContent = String(text || "").replace(/\r\n/g, "\n");
    el.scrollTop = el.scrollHeight;
  }

  function appendCompileStatus(message) {
    const el = $("compileLog");
    if (!el) return;
    const text = String(message || "").replace(/\r\n/g, "\n").trim();
    if (!text) return;
    if (el.textContent && !el.textContent.endsWith("\n")) {
      el.textContent += "\n";
    }
    el.textContent += text;
    el.scrollTop = el.scrollHeight;
  }

  function setCompileLogLines(lines) {
    setCompileLogText(
      (Array.isArray(lines) ? lines : [lines]).filter(Boolean).join("\n")
    );
  }

  function clearUpdiLog() {
    const updi = getCanvasUpdiRuntime();
    if (updi && typeof updi.clearLog === "function") {
      updi.clearLog();
      return;
    }

    setCompileLogText("");
  }

  function sanitizeCompilerOutput(text) {
    return String(text || "")
      .replace(/\r\n/g, "\n")
      .split("\n")
      .filter(
        (line) =>
          !/^\s*sh:\s*0:\s*getcwd\(\)\s*failed:\s*No such file or directory\s*$/.test(
            line
          ) && !/^\s*Info:\s*Loading file:\s*.+$/i.test(line)
      )
      .join("\n")
      .trim();
  }

  function collectCompilerErrorText(data, rawText = "") {
    const parts = [];
    if (data && typeof data === "object") {
      parts.push(
        data.compile_stderr,
        data.stderr,
        data.error,
        data.compile_stdout,
        data.stdout
      );
    }
    parts.push(rawText);
    return sanitizeCompilerOutput(parts.filter(Boolean).join("\n"));
  }

  function getFirstCompilerIssue(data, rawText = "", fallbackFile = "") {
    const output = collectCompilerErrorText(data, rawText);
    const lines = output
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const locationLinePattern =
      /(?:^|\s)((?:[A-Za-z]:\/)?[^:\n]+?):(\d+)(?::(\d+))?:\s*(.+)$/i;
    const firstErrorLine =
      lines.find((line) => /(^|\s)(fatal\s+)?error\s*:/i.test(line)) ||
      lines.find((line) => locationLinePattern.test(line.replace(/\\/g, "/"))) ||
      lines[0] ||
      "";
    const failedFile =
      data && typeof data === "object" && data.failed_file
        ? getBaseFileName(data.failed_file)
        : "";

    if (!firstErrorLine) {
      return {
        fileName: failedFile || fallbackFile || "",
        lineNumber: 0,
        columnNumber: 0,
        message: "Compilation failed.",
      };
    }

    const normalized = firstErrorLine.replace(/\\/g, "/");
    const locationMatch = normalized.match(locationLinePattern);

    if (locationMatch) {
      return {
        fileName:
          getBaseFileName(locationMatch[1]) || failedFile || fallbackFile || "",
        lineNumber: Number(locationMatch[2]) || 0,
        columnNumber: Number(locationMatch[3]) || 0,
        message: cleanupCompilerMessage(locationMatch[4]),
      };
    }

    const genericMatch = firstErrorLine.match(
      /(?:(?:fatal\s+)?error|undefined reference)\s*:?\s*(.+)$/i
    );

    return {
      fileName: failedFile || fallbackFile || "",
      lineNumber: 0,
      columnNumber: 0,
      message: cleanupCompilerMessage(
        genericMatch ? genericMatch[1] : firstErrorLine
      ),
    };
  }

  function cleanupCompilerMessage(message) {
    return String(message || "")
      .replace(/^\s*(?:(?:fatal\s+)?error|undefined reference)\s*:?\s*/i, "")
      .replace(/\s*\[[^\]]+\]\s*$/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function formatCompilerIssue(issue) {
    const message =
      issue && issue.message ? issue.message : "Compilation failed.";
    const lineNumber = issue && issue.lineNumber ? issue.lineNumber : 0;
    const columnNumber = issue && issue.columnNumber ? issue.columnNumber : 0;
    const location = lineNumber
      ? ` ---- Line ${lineNumber}${columnNumber ? `, position ${columnNumber}` : ""}`
      : "";

    return `ERROR. ---- ${message}${location}`;
  }

  function clearCompileErrorHighlight() {
    if (!editor || !compileErrorLineHandle) {
      compileErrorLineHandle = null;
      return;
    }

    try {
      editor.removeLineClass(
        compileErrorLineHandle,
        "background",
        "compile-error-line"
      );
      editor.removeLineClass(
        compileErrorLineHandle,
        "wrap",
        "compile-error-wrap"
      );
    } catch {}

    compileErrorLineHandle = null;
  }

  function findProjectFileByBaseName(baseName) {
    const normalized = getBaseFileName(baseName);
    if (!normalized) return "";
    if (hasFile(normalized)) return normalized;
    return (
      Object.keys(files).find((name) => getBaseFileName(name) === normalized) ||
      ""
    );
  }

  function highlightCompilerIssue(issue) {
    clearCompileErrorHighlight();
    if (!issue || !issue.lineNumber || !editor) return;

    const targetFile =
      findProjectFileByBaseName(issue.fileName) ||
      (current && hasFile(current) ? current : "");
    if (targetFile && targetFile !== current && hasFile(targetFile)) {
      selectFile(targetFile);
    }
    if (!editor) return;

    const lineIndex = Math.max(0, Number(issue.lineNumber) - 1);
    const lineCount = editor.lineCount ? editor.lineCount() : 0;
    if (!lineCount || lineIndex >= lineCount) return;

    compileErrorLineHandle = editor.addLineClass(
      lineIndex,
      "background",
      "compile-error-line"
    );
    editor.addLineClass(lineIndex, "wrap", "compile-error-wrap");
    editor.setCursor({
      line: lineIndex,
      ch: Math.max(0, Number(issue.columnNumber || 1) - 1),
    });
    editor.scrollIntoView({ line: lineIndex, ch: 0 }, 80);
    setTimeout(() => editor && editor.refresh(), 0);
  }

  function showCompilerIssue(data, rawText = "", fallbackFile = "") {
    const issue = getFirstCompilerIssue(data, rawText, fallbackFile);
    highlightCompilerIssue(issue);
    setCompileLogText(formatCompilerIssue(issue));
    return issue;
  }

  const {
    openModal: openWorkspaceModal,
    closeModal: closeWorkspaceModal,
    trapModalFocus: trapWorkspaceModalFocus,
    dismissTopModal: dismissTopWorkspaceModal,
  } = window.UartDebugControls;

  function resolveSiteDialog(value) {
    closeWorkspaceModal($("siteDialog"));

    const resolve = siteDialogResolve;
    siteDialogResolve = null;
    if (resolve) resolve(value);
  }

  function showSiteDialog({
    title = "Notice",
    message = "",
    confirmText = "OK",
    cancelText = "",
    danger = false,
  } = {}) {
    const modal = $("siteDialog");
    const titleEl = $("siteDialogTitle");
    const messageEl = $("siteDialogMessage");
    const confirmBtn = $("siteDialogConfirmBtn");
    const cancelBtn = $("siteDialogCancelBtn");

    if (!modal || !titleEl || !messageEl || !confirmBtn || !cancelBtn) {
      return Promise.resolve(true);
    }

    if (siteDialogResolve) {
      resolveSiteDialog(false);
    }

    titleEl.textContent = title;
    messageEl.textContent = message;
    confirmBtn.textContent = confirmText;
    cancelBtn.textContent = cancelText || "Cancel";
    cancelBtn.hidden = !cancelText;
    confirmBtn.classList.toggle("warning-btn", !!danger);

    openWorkspaceModal(modal, {
      focusTarget: cancelText ? cancelBtn : confirmBtn,
      onClose: () => resolveSiteDialog(false),
    });

    return new Promise((resolve) => {
      siteDialogResolve = resolve;
    });
  }

  async function showSiteAlert(message, title = "Notice") {
    await showSiteDialog({
      title,
      message,
      confirmText: "OK",
    });
  }

  function showSiteConfirm({
    title = "Confirm",
    message = "",
    confirmText = "OK",
    cancelText = "Cancel",
    danger = false,
  } = {}) {
    return showSiteDialog({
      title,
      message,
      confirmText,
      cancelText,
      danger,
    });
  }

  function getCanvasUpdiRuntime() {
    if (typeof window === "undefined") return null;
    return (
      window[AVR_UPDI_RUNTIME_KEY] ||
      window[LEGACY_UPDI_RUNTIME_KEY] ||
      null
    );
  }

  async function ensureAutoDetectedTarget(options = {}) {
    const updi = getCanvasUpdiRuntime();
    if (!updi || typeof updi.ensureSignature !== "function") {
      throw new Error("UPDI auto detect is unavailable on this page.");
    }

    return await updi.ensureSignature({
      force: true,
      allowPrompt: true,
      useCached: !options.reselectPort,
      preferPrompt: true,
    });
  }

  function formatDeviceId(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return "";
    return `0x${numeric.toString(16).toUpperCase().padStart(6, "0")}`;
  }

  function describeSignatureInfo(signatureInfo) {
    if (!signatureInfo) return "";

    const signature = formatDeviceId(signatureInfo.deviceId);
    const targetLabel =
      signatureInfo && signatureInfo.matchedTargetLabel
        ? String(signatureInfo.matchedTargetLabel).trim()
        : "";

    if (targetLabel && signature) return `${targetLabel} (${signature})`;
    if (signature) return `unsupported signature ${signature}`;
    return "";
  }

  async function handleDetectChip() {
    try {
      const signatureInfo = await ensureAutoDetectedTarget({
        reselectPort: true,
      });
      const description = describeSignatureInfo(signatureInfo);

      if (description) {
        console.info(`Detected chip: ${description}.`);
      } else {
        console.warn(
          "Chip signature was not detected. Check the UPDI wiring and selected serial adapter."
        );
      }
    } catch (error) {
      console.warn(
        `Chip detection failed: ${error.message || String(error)}`
      );
    }
  }

  async function handleFlashCurrent() {
    const updi = getCanvasUpdiRuntime();
    if (!updi || typeof updi.programHex !== "function") {
      await showSiteAlert("Flash tools are not ready yet.", "Flash MCU");
      return;
    }

    if (isHexFileName(current)) {
      const hexText = syncCurrentFileFromEditor();

      try {
        loadHexIntoUpdiRuntime(updi, current, hexText, "editor");
      } catch (error) {
        await showSiteAlert(
          `HEX load failed.\n${error.message || String(error)}`,
          "Flash MCU"
        );
        return;
      }
    } else {
      let ready = false;
      try {
        ready = await ensureCurrentCompiledHexLoaded(updi);
      } catch (error) {
        await showSiteAlert(
          `HEX load failed.\n${error.message || String(error)}`,
          "Flash MCU"
        );
        return;
      }
      if (!ready) {
        return;
      }
    }

    if (typeof updi.preparePortPermission === "function") {
      try {
        await updi.preparePortPermission();
      } catch (error) {
        await showSiteAlert(
          `UPDI port access failed.\n${error.message || String(error)}`,
          "Flash MCU"
        );
        return;
      }
    }

    try {
      appendCompileStatus("Flashing ...");
      await updi.programHex();
      const compileLog = $("compileLog");
      const lines = String(compileLog?.textContent || "")
        .replace(/\r\n/g, "\n")
        .split("\n")
        .filter(Boolean);
      if (lines[lines.length - 1] === "Flashing ...") {
        lines[lines.length - 1] = "FLASH OK.";
      } else {
        lines.push("FLASH OK.");
      }
      setCompileLogLines(lines);
    } catch (error) {
      await showSiteAlert(
        `Flash failed.\n${error.message || String(error)}`,
        "Flash MCU"
      );
    }
  }

  function updateCompilePanelState(resetLog = false) {
    const btn = $("compileBtn");
    const hasCurrent = !!current;
    const canCompile = hasCurrent && /\.c$/i.test(current);
    const updiBusy = !!getCanvasUpdiRuntime()?.isBusy?.();
    const buttonLabel = "Compile";

    if (btn) {
      btn.textContent = buttonLabel;
      btn.title = buttonLabel;
      btn.disabled = !canCompile || updiBusy || setHexStatus._state === "building";
    }

    if (!resetLog || updiBusy) return;
    setCompileLogText("");
  }

  // Built-in mini-projects are loaded from the versioned catalog below.

  const BUILTIN_MINI_PROJECT_CATALOG_URL = "/api/avr/ai/projects";
  let builtInMiniProjectCatalogPromise = null;
  let builtInMiniProjectCardsPromise = null;
  let builtInMiniProjectCardsReady = false;

  async function loadBuiltInMiniProjectCatalog() {
    if (builtInMiniProjectCatalogPromise) return builtInMiniProjectCatalogPromise;
    builtInMiniProjectCatalogPromise = fetch(BUILTIN_MINI_PROJECT_CATALOG_URL, {
      cache: "no-cache", credentials: "same-origin", headers: { Accept: "application/json" },
    }).then(async response => {
      const catalog = await response.json();
      if (!response.ok || catalog.ok !== true || !Array.isArray(catalog.projects)) {
        throw new Error("Project catalog is unavailable.");
      }
      const projects = new Map();
      for (const descriptor of catalog.projects) {
        const id = String(descriptor?.id || "").trim();
        if (!id || projects.has(id)) throw new Error("Project catalog has an invalid ID.");
        projects.set(id, descriptor);
      }
      return projects;
    }).catch(error => { builtInMiniProjectCatalogPromise = null; throw error; });
    return builtInMiniProjectCatalogPromise;
  }

  async function renderBuiltInMiniProjectCards() {
    if (builtInMiniProjectCardsReady) return;
    if (builtInMiniProjectCardsPromise) return builtInMiniProjectCardsPromise;
    const grid = $("fileTemplateGrid");
    if (!grid) return;
    builtInMiniProjectCardsPromise = (async () => {
      grid.setAttribute("aria-busy", "true");
      try {
        const catalog = await loadBuiltInMiniProjectCatalog();
        const cards = [...catalog.values()].map(descriptor => {
          const card = document.createElement("button");
          card.type = "button";
          card.className = "file-add-card file-template-card";
          card.dataset.templateId = descriptor.id;
          const title = document.createElement("span");
          title.className = "file-add-card-title";
          title.textContent = String(descriptor.displayName || descriptor.title || descriptor.id);
          card.appendChild(title);
          if (descriptor.summary) {
            const copy = document.createElement("span");
            copy.className = "file-add-card-copy";
            copy.textContent = descriptor.summary;
            card.appendChild(copy);
          }
          return card;
        });
        grid.replaceChildren(...cards);
        builtInMiniProjectCardsReady = true;
      } catch (error) {
        const failure = document.createElement("span");
        failure.textContent = "Projects could not be loaded.";
        grid.replaceChildren(failure);
        console.warn("Project catalog could not be rendered:", error);
      } finally {
        grid.removeAttribute("aria-busy");
        builtInMiniProjectCardsPromise = null;
      }
    })();
    return builtInMiniProjectCardsPromise;
  }

  async function loadBuiltInMiniProjectDefinition(templateId) {
    const catalog = await loadBuiltInMiniProjectCatalog();
    if (!catalog.has(String(templateId || ""))) return null;
    const response = await fetch(BUILTIN_MINI_PROJECT_CATALOG_URL + "/" + encodeURIComponent(templateId), {
      cache: "no-cache", credentials: "same-origin", headers: { Accept: "application/json" },
    });
    const result = await response.json();
    if (!response.ok || result.ok !== true || !result.project) {
      throw new Error("Project could not be loaded.");
    }
    return result.project;
  }

  function loadState() {
    let loadedEnvelope = false;
    try {
      const rawState = localStorage.getItem(STORAGE_STATE);
      if (rawState) {
        const state = JSON.parse(rawState);
        if (
          state &&
          state.schemaVersion === 2 &&
          state.files &&
          typeof state.files === "object" &&
          !Array.isArray(state.files)
        ) {
          files = state.files;
          fileAuthorship =
            state.authorship && typeof state.authorship === "object"
              ? state.authorship
              : {};
          fileGroups =
            state.fileGroups && typeof state.fileGroups === "object"
              ? state.fileGroups
              : {};
          miniProjects =
            state.miniProjects && typeof state.miniProjects === "object"
              ? state.miniProjects
              : {};
          current = typeof state.current === "string" ? state.current : null;
          loadedEnvelope = true;
        }
      }
    } catch {
      loadedEnvelope = false;
    }

    if (!loadedEnvelope) {
      try {
        const storedFiles =
          localStorage.getItem(STORAGE_KEY) ??
          localStorage.getItem(LEGACY_STORAGE_KEY) ??
          "{}";
        files = JSON.parse(storedFiles || "{}");
        fileAuthorship = {};
        fileGroups = JSON.parse(localStorage.getItem(STORAGE_GROUPS) || "{}");
        current =
          localStorage.getItem(STORAGE_CURRENT) ??
          localStorage.getItem(LEGACY_STORAGE_CURRENT) ??
          null;
      } catch {
        files = Object.create(null);
        fileAuthorship = Object.create(null);
        fileGroups = Object.create(null);
        current = null;
      }

      try {
        miniProjects = JSON.parse(
          localStorage.getItem(STORAGE_MINI_PROJECTS) || "{}"
        );
      } catch {
        miniProjects = Object.create(null);
      }
    }

    files = createDictionary(files);
    fileAuthorship = createDictionary(fileAuthorship);
    for (const fileName of Object.keys(fileAuthorship)) {
      if (!Object.prototype.hasOwnProperty.call(files, fileName)) {
        delete fileAuthorship[fileName];
        continue;
      }
      setFileAuthorship(fileName, fileAuthorship[fileName], files[fileName]);
    }
    normalizeFileGroups();
    normalizeMiniProjectInstances();
    if (current && !hasFile(current)) current = null;
  }

  function persistState({ throwOnError = false } = {}) {
    const serializedFiles = JSON.stringify(files);
    let envelopeError = null;
    let legacyMirrorsUpdated = false;

    try {
      localStorage.setItem(
        STORAGE_STATE,
        JSON.stringify({
          schemaVersion: 2,
          files,
          authorship: fileAuthorship,
          fileGroups,
          miniProjects,
          current,
        })
      );
    } catch (error) {
      envelopeError = error;
      console.warn("Failed to persist AVR workspace state:", error);
    }

    try {
      localStorage.setItem(STORAGE_KEY, serializedFiles);
      localStorage.setItem(LEGACY_STORAGE_KEY, serializedFiles);
      localStorage.setItem(STORAGE_GROUPS, JSON.stringify(fileGroups));
      if (envelopeError) {
        localStorage.setItem(
          STORAGE_MINI_PROJECTS,
          JSON.stringify(miniProjects)
        );
      } else {
        localStorage.removeItem(STORAGE_MINI_PROJECTS);
      }
      if (current) {
        localStorage.setItem(STORAGE_CURRENT, current);
        localStorage.setItem(LEGACY_STORAGE_CURRENT, current);
      } else {
        localStorage.removeItem(STORAGE_CURRENT);
        localStorage.removeItem(LEGACY_STORAGE_CURRENT);
      }
      legacyMirrorsUpdated = true;
    } catch (error) {
      console.warn("Failed to update legacy AVR storage mirrors:", error);
    }

    if (envelopeError && legacyMirrorsUpdated) {
      try {
        localStorage.removeItem(STORAGE_STATE);
      } catch (error) {
        console.warn("Failed to discard stale AVR workspace state:", error);
      }
    }

    if (envelopeError && throwOnError) throw envelopeError;
    if (
      !envelopeError &&
      projectAiBootComplete &&
      !projectAiAccountWorkspaceApplying
    ) {
      markProjectAiAccountDocumentDirty("files");
    }
    return !envelopeError;
  }

  function normalizeMiniProjectInstances() {
    const normalized = Object.create(null);

    if (!miniProjects || typeof miniProjects !== "object") {
      miniProjects = Object.create(null);
      return;
    }

    for (const [rawInstanceId, rawProject] of Object.entries(miniProjects)) {
      if (!rawProject || typeof rawProject !== "object") continue;

      const instanceId = String(rawInstanceId || "").trim();
      if (!instanceId || normalized[instanceId]) continue;
      const definitionId = String(rawProject.definitionId || instanceId);
      const origin = String(rawProject.origin || "local");

      const roleFiles = {};
      const mediaTypes = {};
      const guides = {};
      const rawRoleFiles = rawProject.files;
      if (rawRoleFiles && typeof rawRoleFiles === "object") {
        for (const [rawRole, rawFileName] of Object.entries(rawRoleFiles)) {
          const role = miniProjectCore.normalizeRole(rawRole);
          const fileName = String(rawFileName || "").trim();
          if (!role || !fileName || !hasFile(fileName) || roleFiles[role]) {
            continue;
          }
          roleFiles[role] = fileName;
        }
      }

      const rawMediaTypes = rawProject.mediaTypes;
      if (rawMediaTypes && typeof rawMediaTypes === "object") {
        for (const [rawRole, rawMediaType] of Object.entries(rawMediaTypes)) {
          const role = miniProjectCore.normalizeRole(rawRole);
          const mediaType = String(rawMediaType || "").trim();
          if (role && roleFiles[role] && mediaType) mediaTypes[role] = mediaType;
        }
      }

      const addGuide = (rawLocale, rawGuide) => {
        const entry =
          typeof rawGuide === "string"
            ? { fileName: rawGuide }
            : rawGuide && typeof rawGuide === "object"
              ? rawGuide
              : null;
        if (!entry) return;

        const fileName = String(
          entry.fileName || entry.file || entry.name || ""
        ).trim();
        if (!fileName || !hasFile(fileName)) return;

        let locale = String(
          entry.locale || rawLocale || rawProject.defaultLocale || "und"
        )
          .trim()
          .replace(/_/g, "-");
        if (!projectFormat.isLocaleTag(locale)) {
          locale = "und";
        }
        const baseLocale = locale;
        let suffix = 2;
        while (guides[locale] && guides[locale].fileName !== fileName) {
          locale = `${baseLocale}-x-${suffix}`;
          suffix += 1;
        }

        guides[locale] = {
          locale,
          fileName,
          label: String(entry.label || locale),
          mediaType: String(entry.mediaType || "text/markdown"),
          assetBaseUrl: String(entry.assetBaseUrl || ""),
          assets: normalizeProjectAssets(entry.assets),
        };
      };

      if (rawProject.guides && typeof rawProject.guides === "object") {
        if (Array.isArray(rawProject.guides)) {
          for (const guide of rawProject.guides) {
            addGuide(guide?.locale, guide);
          }
        } else {
          for (const [locale, guide] of Object.entries(rawProject.guides)) {
            addGuide(locale, guide);
          }
        }
      }

      if (roleFiles.guide) {
        const alreadyLinked = Object.values(guides).some(
          (guide) => guide.fileName === roleFiles.guide
        );
        if (!alreadyLinked) {
          addGuide(rawProject.defaultLocale || "und", {
            fileName: roleFiles.guide,
            mediaType: mediaTypes.guide || "text/markdown",
          });
        }
      }

      if (!roleFiles.source) continue;

      const guideLocales = Object.keys(guides);
      let defaultLocale = String(rawProject.defaultLocale || "").trim();
      if (!guides[defaultLocale]) defaultLocale = guideLocales[0] || "";
      let selectedLocale = String(rawProject.selectedLocale || "").trim();
      if (!guides[selectedLocale]) selectedLocale = defaultLocale;
      if (selectedLocale && guides[selectedLocale]) {
        roleFiles.guide = guides[selectedLocale].fileName;
        mediaTypes.guide = guides[selectedLocale].mediaType;
      } else {
        delete roleFiles.guide;
        delete mediaTypes.guide;
      }

      normalized[instanceId] = {
        schemaVersion: 1,
        contract: "uartdebug-project/v2",
        definitionId,
        title: String(rawProject.title || rawProject.definitionId || instanceId),
        displayName: String(
          rawProject.displayName ||
            rawProject.title ||
            rawProject.definitionId ||
            instanceId
        ),
        summary: String(rawProject.summary || ""),
        version: rawProject.version ?? 1,
        origin,
        canvasName: String(rawProject.canvasName || getFileStem(roleFiles.source) + ".md"),
        projectPath: String(rawProject.projectPath || "Target_Projects/" + getSafeProjectFolderName(rawProject.title || definitionId, instanceId)),
        projectDocuments: projectFormat.normalizeProjectDocuments(rawProject.projectDocuments),
        fileNames: createDictionary(rawProject.fileNames),
        files: roleFiles,
        mediaTypes,
        guides,
        defaultLocale,
        selectedLocale,
        assets: normalizeProjectAssets(rawProject.assets),
        aiSpecRef:
          rawProject.aiSpecRef && typeof rawProject.aiSpecRef === "object"
            ? cloneJsonMetadata(rawProject.aiSpecRef, null)
            : null,
        ...(rawProject.canvas && typeof rawProject.canvas === "object"
          ? { canvas: normalizeProjectInstructionDocument(rawProject.canvas) }
          : {}),
      };
    }

    miniProjects = normalized;
    const activeLink = current ? getMiniProjectForFile(current) : null;
    if (
      activeLink &&
      activeLink.role !== miniProjectCore.ROLES.SOURCE &&
      hasFile(activeLink.project.files?.source)
    ) {
      current = activeLink.project.files.source;
    }
  }

  function normalizeFileGroups() {
    const normalized = Object.create(null);
    const assignedFiles = new Set();
    const assignedGroups = new Set();

    if (!fileGroups || typeof fileGroups !== "object") {
      fileGroups = Object.create(null);
      return;
    }

    for (const [rawName, rawGroup] of Object.entries(fileGroups)) {
      const name = String(rawName || "").trim();
      if (
        !name ||
        Object.prototype.hasOwnProperty.call(normalized, name)
      ) {
        continue;
      }

      normalized[name] = {
        files: [],
        groups: [],
        expanded: !!rawGroup?.expanded,
      };
    }

    for (const [rawName, rawGroup] of Object.entries(fileGroups)) {
      const name = String(rawName || "").trim();
      if (!normalized[name]) continue;

      const rawFiles = Array.isArray(rawGroup?.files)
        ? rawGroup.files
        : [];

      for (const fileName of rawFiles) {
        const normalizedFile = String(fileName || "").trim();
        if (
          !normalizedFile ||
          !hasFile(normalizedFile) ||
          assignedFiles.has(normalizedFile)
        ) {
          continue;
        }

        normalized[name].files.push(normalizedFile);
        assignedFiles.add(normalizedFile);
      }
    }

    for (const [rawName, rawGroup] of Object.entries(fileGroups)) {
      const name = String(rawName || "").trim();
      if (!normalized[name]) continue;

      const rawGroups = Array.isArray(rawGroup?.groups)
        ? rawGroup.groups
        : [];

      for (const groupName of rawGroups) {
        const childName = String(groupName || "").trim();
        if (
          !childName ||
          childName === name ||
          !normalized[childName] ||
          assignedGroups.has(childName)
        ) {
          continue;
        }

        normalized[name].groups.push(childName);
        assignedGroups.add(childName);
      }
    }

    fileGroups = normalized;
    pruneGroupCycles();
  }

  function uniqueName(base) {
    if (!hasFile(base)) return base;
    const m = base.match(/^(.*?)(\.(c|h))?$/i);
    const stem = (m && m[1]) || base;
    const ext = (m && m[2]) || ".c";
    let i = 2;
    while (hasFile(`${stem}_${i}${ext}`)) i++;
    return `${stem}_${i}${ext}`;
  }

  function getFileExtension(name) {
    const lastDot = typeof name === "string" ? name.lastIndexOf(".") : -1;
    return lastDot > -1 ? name.slice(lastDot + 1).toLowerCase() : "";
  }

  function hasFile(name) {
    return Object.prototype.hasOwnProperty.call(files, name);
  }

  function hasGroup(name) {
    return Object.prototype.hasOwnProperty.call(fileGroups, name);
  }

  function getGroupChildGroups(groupName) {
    const group = fileGroups[groupName];
    return (group?.groups || []).filter((name) => hasGroup(name));
  }

  function isGroupDescendant(groupName, possibleDescendant) {
    if (!hasGroup(groupName) || !possibleDescendant) return false;

    const stack = [...getGroupChildGroups(groupName)];
    const seen = new Set();

    while (stack.length) {
      const childName = stack.pop();
      if (!childName || seen.has(childName)) continue;
      if (childName === possibleDescendant) return true;
      seen.add(childName);
      stack.push(...getGroupChildGroups(childName));
    }

    return false;
  }

  function pruneGroupCycles() {
    for (const groupName of Object.keys(fileGroups)) {
      const group = fileGroups[groupName];
      group.groups = (group.groups || []).filter(
        (childName) =>
          childName !== groupName && !isGroupDescendant(childName, groupName)
      );
    }
  }

  function getFileGroup(fileName) {
    for (const [groupName, group] of Object.entries(fileGroups)) {
      if ((group.files || []).includes(fileName)) return groupName;
    }
    return "";
  }

  function isCFileName(fileName) {
    return /\.c$/i.test(fileName || "");
  }

  function getEditorModeForFile(fileName) {
    if (isCFileName(fileName)) return "text/x-csrc";
    if (/\.md$/i.test(fileName || "")) {
      return {
        name: "markdown",
        highlightFormatting: true,
        fencedCodeBlockHighlighting: false,
        strikethrough: true,
        taskLists: true,
        xml: false,
      };
    }
    return "text/plain";
  }

  function isHexFileName(fileName) {
    return HEX_FILE_EXTENSIONS.has(getFileExtension(fileName));
  }

  function isCompileProjectFileName(fileName) {
    return COMPILE_PROJECT_FILE_EXTENSIONS.has(getFileExtension(fileName));
  }

  function getFileStem(fileName) {
    const name = String(fileName || "");
    const lastDot = name.lastIndexOf(".");
    return lastDot > 0 ? name.slice(0, lastDot) : name;
  }

  function getBaseFileName(fileName) {
    return String(fileName || "")
      .replace(/\\/g, "/")
      .split("/")
      .filter(Boolean)
      .pop() || "";
  }

  function extractQuotedIncludes(sourceText) {
    const includes = [];
    const includePattern = /^\s*#\s*include\s*"([^"]+)"/gm;
    let match;

    while ((match = includePattern.exec(sourceText || ""))) {
      const includeName = String(match[1] || "").trim();
      if (includeName) includes.push(includeName);
    }

    return includes;
  }

  function resolveProjectIncludeName(includeName) {
    const rawName = String(includeName || "").trim();
    if (hasFile(rawName)) return rawName;

    const baseName = getBaseFileName(rawName);
    return baseName && hasFile(baseName) ? baseName : "";
  }

  function getHeaderCompanionSource(fileName) {
    if (!COMPILE_HEADER_EXTENSIONS.has(getFileExtension(fileName))) return "";

    const candidate = `${getFileStem(fileName)}.c`;
    return hasFile(candidate) ? candidate : "";
  }

  function getCompileProjectFileNames(entryName) {
    const visited = new Set();
    const requiredFiles = new Set();
    const textualSourceIncludes = new Set();

    const visit = (fileName, includedTextually = false) => {
      if (
        !fileName ||
        !hasFile(fileName) ||
        !isCompileProjectFileName(fileName)
      ) {
        return;
      }

      if (
        includedTextually &&
        COMPILE_C_SOURCE_EXTENSIONS.has(getFileExtension(fileName))
      ) {
        textualSourceIncludes.add(fileName);
      }

      if (visited.has(fileName)) return;
      visited.add(fileName);
      requiredFiles.add(fileName);

      for (const includeName of extractQuotedIncludes(files[fileName])) {
        const resolved = resolveProjectIncludeName(includeName);
        if (resolved) visit(resolved, true);
      }

      const companionSource = getHeaderCompanionSource(fileName);
      if (companionSource) visit(companionSource, false);
    };

    visit(entryName, false);

    const compileSourceNames = [entryName];
    for (const fileName of requiredFiles) {
      if (fileName === entryName) continue;
      if (!COMPILE_C_SOURCE_EXTENSIONS.has(getFileExtension(fileName))) continue;
      if (textualSourceIncludes.has(fileName)) continue;
      compileSourceNames.push(fileName);
    }

    return {
      requiredFiles: [...requiredFiles],
      compileSourceNames,
    };
  }

  function buildCompileProjectSnapshot(entryName) {
    if (editor && current) {
      syncCurrentFileFromEditor();
    }

    const plan = getCompileProjectFileNames(entryName);
    const projectFiles = plan.requiredFiles.map((name) => ({
      name,
      content: String(files[name] || ""),
    }));

    return {
      ...plan,
      projectFiles,
      sourceKey: JSON.stringify(projectFiles),
    };
  }

  function syncCurrentFileFromEditor() {
    if (!current) return "";

    if (editor) {
      files[current] = editor.getValue();
      persistState();
    }

    return files[current] || "";
  }

  function resolveUploadedFileKind(fileName) {
    const ext = getFileExtension(fileName);

    if (ext === "zip") return "mini-project-archive";
    return "unsupported";
  }

  async function readLocalFileText(file) {
    if (!file) return "";
    if (typeof file.text === "function") {
      return await file.text();
    }

    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () =>
        reject(reader.error || new Error("File read failed."));
      reader.readAsText(file);
    });
  }

  function openAddFileModal() {
    const modal = $("fileAddModal");
    if (!modal) return;

    closeFileContextMenu();
    void renderBuiltInMiniProjectCards();
    openWorkspaceModal(modal, {
      focusTarget: () => $("createEmptyProjectCard") || $("uploadExistingFileCard"),
      onClose: closeAddFileModal,
    });
  }

  function closeAddFileModal() {
    closeWorkspaceModal($("fileAddModal"));
  }

  function dispatchHexArtifact(detail) {
    if (typeof window === "undefined" || typeof CustomEvent !== "function") {
      return;
    }

    window.dispatchEvent(
      new CustomEvent("ud-updi-hex-artifact", {
        detail,
      })
    );
  }

  function uniqueMiniProjectInstanceId(baseId) {
    const safeBase =
      String(baseId || "mini-project")
        .trim()
        .replace(/[^a-z0-9_-]+/gi, "-")
        .replace(/^-+|-+$/g, "") || "mini-project";
    if (!Object.prototype.hasOwnProperty.call(miniProjects, safeBase)) {
      return safeBase;
    }

    let index = 2;
    let candidate = `${safeBase}-${index}`;
    while (Object.prototype.hasOwnProperty.call(miniProjects, candidate)) {
      index += 1;
      candidate = `${safeBase}-${index}`;
    }
    return candidate;
  }

  function getSafeProjectFolderName(title, definitionId) {
    const reservedNames = new Set(["__proto__", "prototype", "constructor"]);
    const cleanTitle = String(title || "")
      .replace(/[\\/:*?"<>|\x00-\x1f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 64);
    if (cleanTitle && !reservedNames.has(cleanTitle.toLowerCase())) {
      return cleanTitle;
    }

    const cleanId = String(definitionId || "project")
      .replace(/[^a-z0-9_-]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40);
    return `Mini project ${cleanId || "project"}`;
  }

  function uniqueReservedFileName(baseName, reservedNames) {
    const cleanName = String(baseName || "").trim();
    if (!cleanName) return "";
    if (!hasFile(cleanName) && !reservedNames.has(cleanName)) return cleanName;

    const lastDot = cleanName.lastIndexOf(".");
    const hasExtension = lastDot > 0;
    const stem = hasExtension ? cleanName.slice(0, lastDot) : cleanName;
    const extension = hasExtension ? cleanName.slice(lastDot) : "";
    let index = 2;
    let candidate = `${stem}_${index}${extension}`;

    while (hasFile(candidate) || reservedNames.has(candidate)) {
      index += 1;
      candidate = `${stem}_${index}${extension}`;
    }

    return candidate;
  }

  function getPublicMiniProjectInstance(instanceId) {
    const project = miniProjects[instanceId];
    if (!project || !project.files?.source || !hasFile(project.files.source)) {
      return null;
    }

    const defaultMediaTypes = {
      source: "text/x-c",
      guide: "text/markdown",
      aiSpec: "text/markdown",
      specification: "application/yaml",
    };
    const projectFiles = ["source", "specification", "aiSpec"].flatMap((role) => {
      const name = project.files?.[role];
      if (!name || !hasFile(name)) return [];
      return [
        {
          role,
          name: project.fileNames?.[name] || name,
          storageName: name,
          hidden: role !== "source",
          content: getLiveFileContent(name),
          mediaType: project.mediaTypes?.[role] || defaultMediaTypes[role],
        },
      ];
    });
    const guideFiles = Object.values(project.guides || {}).flatMap((guide) => {
      const name = guide?.fileName;
      if (!name || !hasFile(name)) return [];
      return [
        {
          role: miniProjectCore.ROLES.GUIDE,
          name: project.fileNames?.[name] || name,
          storageName: name,
          hidden: true,
          content: getLiveFileContent(name),
          mediaType: guide.mediaType || defaultMediaTypes.guide,
          locale: guide.locale || "",
          label: guide.label || guide.locale || "",
        },
      ];
    });

    return {
      schemaVersion: 1,
      contract: "uartdebug-project/v2",
      instanceId,
      id: project.definitionId,
      title: project.title,
      displayName: project.displayName || project.title,
      summary: project.summary || "",
      version: project.version,
      origin: project.origin,
      canvasName: project.canvasName,
      projectPath: project.projectPath,
      projectDocuments: projectFormat.normalizeProjectDocuments(project.projectDocuments),
      canvas: normalizeProjectInstructionDocument(project.canvas),
      defaultLocale: project.defaultLocale || "",
      selectedLocale: project.selectedLocale || project.defaultLocale || "",
      files: [...projectFiles, ...guideFiles],
      assets: normalizeProjectAssets(project.assets),
      ...(project.aiSpecRef ? { aiSpecRef: cloneJsonMetadata(project.aiSpecRef, null) } : {}),
    };
  }

  function renameMiniProjectInstance(instanceId, displayName) {
    const normalizedInstanceId = String(instanceId || "");
    const project = miniProjects[normalizedInstanceId];
    if (!project) throw new Error("Mini-project was not found.");

    const name = String(displayName || "").trim();
    const error = validateMiniProjectDisplayName(name, normalizedInstanceId);
    if (error) throw new Error(error);

    project.displayName = name;
    persistState();
    renderOutliner();
    refreshDocumentationPane({ preserveScroll: true });
    return getPublicMiniProjectInstance(normalizedInstanceId);
  }

  function installMiniProjectDefinition(rawDefinition, { origin = "local" } = {}) {
    const definition = miniProjectCore.normalizeDefinition(rawDefinition);
    const reservedNames = new Set();
    const definitionFiles = [
      definition.files.source,
      ...(definition.guides || []),
      definition.files.aiSpec,
      definition.files.specification,
    ].filter(Boolean);
    const seenDefinitionFiles = new Set();
    const pendingFiles = definitionFiles
      .filter((projectFile) => {
        const key = `${projectFile.role}:${projectFile.name.toLowerCase()}`;
        if (seenDefinitionFiles.has(key)) return false;
        seenDefinitionFiles.add(key);
        return true;
      })
      .map((projectFile) => {
      const name = uniqueReservedFileName(projectFile.name, reservedNames);
      if (!name) throw new TypeError("Mini-project file name is required.");
      reservedNames.add(name);
      return {
        role: projectFile.role,
        name,
        content: String(projectFile.content || "").replace(/\r\n?/g, "\n"),
        mediaType: projectFile.mediaType,
        locale: projectFile.locale || "",
        label: projectFile.label || projectFile.locale || "",
        assetBaseUrl: projectFile.assetBaseUrl || "",
        assets: normalizeProjectAssets(projectFile.assets),
      };
    });

    const instanceId = uniqueMiniProjectInstanceId(definition.id);
    const roleFiles = {};
    const mediaTypes = {};
    const guides = {};
    const previousFiles = files;
    const previousAuthorship = fileAuthorship;
    const previousGroups = fileGroups;
    const previousProjects = miniProjects;
    const previousCurrent = current;
    let selectionStarted = false;

    if (editor && previousCurrent && hasFile(previousCurrent)) {
      previousFiles[previousCurrent] = editor.getValue();
    }

    files = createDictionary(files);
    fileAuthorship = createDictionary(fileAuthorship);
    fileGroups = createDictionary(fileGroups);
    miniProjects = createDictionary(miniProjects);

    try {
      for (const projectFile of pendingFiles) {
        files[projectFile.name] = projectFile.content;
        fileAuthorship[projectFile.name] = createMarkdownAuthorship(
          projectFile.content,
          String(origin || "local") === "ai" ? "ai" : "original"
        );
        if (projectFile.role === miniProjectCore.ROLES.GUIDE) {
          let locale =
            projectFile.locale || definition.defaultLocale || "und";
          const baseLocale = locale;
          let suffix = 2;
          while (guides[locale]) {
            locale = `${baseLocale}-x-${suffix}`;
            suffix += 1;
          }
          guides[locale] = {
            locale,
            fileName: projectFile.name,
            label: projectFile.label || locale,
            mediaType: projectFile.mediaType || "text/markdown",
            assetBaseUrl: projectFile.assetBaseUrl || "",
            assets: projectFile.assets,
          };
        } else {
          roleFiles[projectFile.role] = projectFile.name;
          mediaTypes[projectFile.role] = projectFile.mediaType;
        }
      }

      const guideLocales = Object.keys(guides);
      const defaultLocale = guides[definition.defaultLocale]
        ? definition.defaultLocale
        : guideLocales[0] || "";
      if (defaultLocale) {
        roleFiles.guide = guides[defaultLocale].fileName;
        mediaTypes.guide = guides[defaultLocale].mediaType;
      }

      miniProjects[instanceId] = {
        schemaVersion: 1,
        contract: "uartdebug-project/v2",
        definitionId: definition.id,
        title: definition.title,
        displayName: String(
          rawDefinition.displayName || definition.title || definition.id
        ).trim(),
        summary: definition.summary,
        version: definition.version ?? 1,
        origin: String(origin || "local"),
        canvasName: definition.canvasName || getFileStem(definition.files.source.name) + ".md",
        projectPath: definition.projectPath || "Target_Projects/" + getSafeProjectFolderName(definition.title, definition.id),
        projectDocuments: definition.projectDocuments,
        fileNames: Object.fromEntries(pendingFiles.map((file, index) => [file.name, definitionFiles[index].name])),
        files: roleFiles,
        mediaTypes,
        guides,
        defaultLocale,
        selectedLocale: defaultLocale,
        assets: normalizeProjectAssets(definition.assets),
        aiSpecRef: cloneJsonMetadata(definition.aiSpecRef, null),
        canvas: definition.canvas ? normalizeProjectInstructionDocument({
          schemaVersion: 2, revision: 0, annotations: [], ...definition.canvas,
        }) : String(origin || "local") === "ai"
          ? getProjectInstructionSnapshot()
          : normalizeProjectInstructionDocument(null),
      };

      const sourceFile = roleFiles.source;
      selectionStarted = true;
      selectFile(sourceFile);
      persistState({ throwOnError: true });
      closeAddFileModal();
      return getPublicMiniProjectInstance(instanceId);
    } catch (error) {
      files = previousFiles;
      fileAuthorship = previousAuthorship;
      fileGroups = previousGroups;
      miniProjects = previousProjects;
      current = previousCurrent;

      if (selectionStarted) {
        activateCurrentProjectCanvas({ savePrevious: false, legacyFallback: true });
      }

      if (selectionStarted && editor) {
        editor.setOption("readOnly", previousCurrent ? false : "nocursor");
        editor.setOption("mode", getEditorModeForFile(previousCurrent));
        editor.setValue(
          previousCurrent && hasFile(previousCurrent)
            ? previousFiles[previousCurrent]
            : ""
        );
      }

      updateEditorFileWatermark(previousCurrent || "");
      renderOutliner();
      refreshDocumentationPane();
      scheduleDocumentationMarkerRefresh();
      try {
        persistState();
      } catch {}
      throw error;
    }
  }

  function updateMiniProjectInstance(instanceId, rawDefinition, { origin = "ai" } = {}) {
    const id = String(instanceId || "").trim();
    const existing = miniProjects[id];
    if (!existing) throw new Error("Project was not found.");
    const incoming = Array.isArray(rawDefinition?.files) ? rawDefinition.files : [];
    if (!incoming.length) throw new Error("The response has no project files.");
    const live = getPublicMiniProjectInstance(id);
    const incomingGuides = incoming.filter(file => file.role === "guide");
    const replacedGuides = live.files.filter(file => file.role === "guide" &&
      incomingGuides.some(guide =>
        guide.name.toLowerCase() === file.name.toLowerCase() && (!file.content.trim() || file.locale === "und") ||
        !file.content.trim() && incomingGuides.length === 1 && file.locale === existing.selectedLocale));
    const replacedGuideNames = new Set(replacedGuides.map(file => file.storageName));
    const incomingKeys = new Set(incoming.map(file => file.role === "guide"
      ? "guide:" + (file.locale || existing.selectedLocale || "en") : file.role));
    const merged = live.files.filter(file => !replacedGuideNames.has(file.storageName) && !incomingKeys.has(file.role === "guide"
      ? "guide:" + (file.locale || existing.selectedLocale || "en") : file.role));
    const defaultLocale = rawDefinition.defaultLocale || existing.defaultLocale || "en";
    const allGuides = [...merged, ...incomingGuides].filter(file => file.role === "guide");
    const definition = miniProjectCore.normalizeDefinition({
      ...live, ...rawDefinition, files: [...merged, ...incoming],
      defaultLocale: allGuides.some(file => file.locale === defaultLocale)
        ? defaultLocale : incomingGuides[0]?.locale || allGuides[0]?.locale || "en",
    });
    const previous = { files, fileAuthorship, fileGroups, miniProjects, current };
    if (editor && current && hasFile(current)) files[current] = editor.getValue();
    files = createDictionary(files);
    fileAuthorship = createDictionary(cloneJsonMetadata(fileAuthorship, {}));
    miniProjects = createDictionary(cloneJsonMetadata(miniProjects, {}));
    try {
      const project = miniProjects[id];
      const author = origin === "ai" ? "ai" : "original";
      const reserved = new Set();
      const reusableGuideNames = [...replacedGuideNames];
      for (const [locale, guide] of Object.entries(project.guides || {})) {
        if (replacedGuideNames.has(guide.fileName)) delete project.guides[locale];
      }
      for (const rawFile of incoming) {
        const role = miniProjectCore.normalizeRole(rawFile.role);
        const locale = rawFile.locale || project.selectedLocale || project.defaultLocale || "en";
        const file = role === "guide" ? definition.guides.find(item => item.locale === locale)
          : definition.files[role];
        if (!file) throw new Error("The response has an invalid project file.");
        let name = role === "guide" ? project.guides?.[locale]?.fileName : project.files[role];
        if (role === "guide" && !name) name = reusableGuideNames.shift();
        if (!name || !hasFile(name)) {
          name = uniqueReservedFileName(file.name, reserved);
          reserved.add(name);
        }
        const old = files[name] || "";
        files[name] = file.content;
        fileAuthorship[name] = mergeMarkdownAuthorshipForReplacement(old, file.content, fileAuthorship[name], author);
        project.fileNames = project.fileNames || {};
        project.fileNames[name] = file.name;
        if (role === "guide") {
          project.guides = project.guides || {};
          project.guides[locale] = {
            locale, fileName: name, label: file.label || locale,
            mediaType: "text/markdown", assets: normalizeProjectAssets(file.assets),
            assetBaseUrl: file.assetBaseUrl || "",
          };
          project.selectedLocale = project.defaultLocale = locale;
          project.files.guide = name;
        } else project.files[role] = name;
      }
      for (const name of reusableGuideNames) {
        delete files[name];
        delete fileAuthorship[name];
        delete project.fileNames[name];
      }
      project.title = definition.title;
      project.displayName = rawDefinition.displayName || definition.title;
      project.summary = definition.summary;
      project.version = definition.version;
      project.canvasName = definition.canvasName || project.canvasName;
      project.projectPath = definition.projectPath || project.projectPath;
      selectFile(project.files.source);
      persistState({ throwOnError: true });
      return getPublicMiniProjectInstance(id);
    } catch (error) {
      ({ files, fileAuthorship, fileGroups, miniProjects, current } = previous);
      activateCurrentProjectCanvas({ savePrevious: false });
      if (editor) editor.setValue(current ? files[current] || "" : "");
      renderOutliner();
      refreshDocumentationPane();
      throw error;
    }
  }

  function initMiniProjectBridge() {
    const bridge = Object.freeze({
      schemaVersion: miniProjectCore.SCHEMA_VERSION,
      importEvent: MINI_PROJECT_IMPORT_EVENT,
      installedEvent: MINI_PROJECT_INSTALLED_EVENT,
      readyEvent: MINI_PROJECT_READY_EVENT,
      ready: miniProjectBridgeReady,
      normalizeDefinition: miniProjectCore.normalizeDefinition,
      async install(definition, options = {}) {
        await miniProjectBridgeReady;
        try {
          const project = installMiniProjectDefinition(definition, {
            origin: options?.origin || "api",
          });
          window.dispatchEvent(
            new CustomEvent(MINI_PROJECT_INSTALLED_EVENT, {
              detail: { ok: true, project },
            })
          );
          return project;
        } catch (error) {
          window.dispatchEvent(
            new CustomEvent(MINI_PROJECT_INSTALLED_EVENT, {
              detail: {
                ok: false,
                error: error?.message || String(error),
              },
            })
          );
          throw error;
        }
      },
      async updateInstance(instanceId, definition, options = {}) {
        await miniProjectBridgeReady;
        try {
          const project = updateMiniProjectInstance(instanceId, definition, {
            origin: options?.origin || "api",
          });
          window.dispatchEvent(
            new CustomEvent(MINI_PROJECT_INSTALLED_EVENT, {
              detail: { ok: true, operation: "update", project },
            })
          );
          return project;
        } catch (error) {
          window.dispatchEvent(
            new CustomEvent(MINI_PROJECT_INSTALLED_EVENT, {
              detail: {
                ok: false,
                operation: "update",
                error: error?.message || String(error),
              },
            })
          );
          throw error;
        }
      },
      getInstances() {
        return Object.keys(miniProjects)
          .map(getPublicMiniProjectInstance)
          .filter(Boolean);
      },
      getInstance(instanceId) {
        return getPublicMiniProjectInstance(String(instanceId || ""));
      },
      renameInstance(instanceId, displayName) {
        return renameMiniProjectInstance(instanceId, displayName);
      },
    });

    window.UartDebugAvrMiniProjects = bridge;
    window.addEventListener(MINI_PROJECT_IMPORT_EVENT, (event) => {
      bridge
        .install(event.detail, {
          origin: "api-event",
        })
        .catch((error) => {
          console.error("Failed to install AVR mini-project:", error);
        });
    });
  }

  async function createFileFromTemplate(templateId) {
    const definition = await loadBuiltInMiniProjectDefinition(templateId);
    if (!definition) return false;

    installMiniProjectDefinition(definition, { origin: "builtin" });
    return true;
  }

  function createEmptyProject() {
    const names = new Set(Object.values(miniProjects).map((project) =>
      String(project.displayName || project.title || "").toLowerCase()));
    let title = "Untitled project";
    for (let suffix = 2; names.has(title.toLowerCase()); suffix += 1) {
      title = `Untitled project ${suffix}`;
    }
    return installMiniProjectDefinition({
      schemaVersion: 1,
      id: "empty-project",
      title,
      summary: "",
      version: "",
      defaultLocale: "en",
      files: [
        {
          role: "source",
          name: title + ".c",
          mediaType: "text/x-c",
          content: "",
        },
        {
          role: "guide",
          name: title + " (description).md",
          mediaType: "text/markdown",
          locale: "en",
          label: "English",
          content: "",
        },
      ],
      canvasName: title + ".md",
      projectPath: "Target_Projects/" + title,
    }, { origin: "local" });
  }

  function loadHexIntoUpdiRuntime(updi, fileName, hexText, source = "uploaded") {
    const normalizedHex = String(hexText || "").replace(/\r\n/g, "\n");

    if (!normalizedHex.trim()) {
      throw new Error("HEX file is empty.");
    }

    if (updi && typeof updi.loadHexFile === "function") {
      updi.loadHexFile(normalizedHex, fileName, source);
      return;
    }

    dispatchHexArtifact({
      hexText: normalizedHex,
      fileName,
      source,
    });
  }

  async function handleUploadedFile(file) {
    if (!file) return;

    const fileKind = resolveUploadedFileKind(file.name);
    if (fileKind === "mini-project-archive") {
      const archiveApi = window.UartDebugAvrMiniProjectArchive;
      if (!archiveApi?.parseMiniProjectArchive) {
        throw new Error("Mini-project archive support is not available.");
      }
      const definition = await archiveApi.parseMiniProjectArchive(file, {
        limits: MINI_PROJECT_ARCHIVE_WORKSPACE_LIMITS,
      });
      installMiniProjectDefinition(definition, { origin: "archive" });
      if (definition.importWarnings?.length) {
        reportProjectCanvasMessage("system", definition.importWarnings.join("\n"));
      }
      return;
    }



    const message =
      'Import a project archive (.zip).';
    await showSiteAlert(message, "Unsupported file");
    console.warn(`Import rejected: "${file.name}" has an unsupported extension.`);
  }

  function migrateLooseFilesToProjects() {
    const loose = Object.keys(files).filter(name => !getMiniProjectForFile(name));
    const legacyEmpty = loose.length === 1 && loose[0] === "main.c" && !files["main.c"];
    if (legacyEmpty) {
      delete files["main.c"];
      delete fileAuthorship["main.c"];
      if (current === "main.c") current = null;
    }
    for (const name of loose) {
      if (!hasFile(name) || !/\.c$/i.test(name)) continue;
      const title = getFileStem(name);
      const instanceId = uniqueMiniProjectInstanceId(title);
      const stem = getFileStem(name);
      const resource = loose.find(file => /\.ya?ml$/i.test(file) && getFileStem(file) === stem);
      const guide = loose.find(file => /\.md$/i.test(file) &&
        [stem, stem + ".guide", stem + "_help"].includes(getFileStem(file)) && !getMiniProjectForFile(file));
      const guideName = guide || uniqueName(stem + " (description).md");
      if (!guide) files[guideName] = "";
      miniProjects[instanceId] = {
        schemaVersion: 1, contract: "uartdebug-project/v2", definitionId: title,
        title, displayName: title, summary: "", version: "", origin: "migrated",
        canvasName: stem + ".md", projectPath: "Target_Projects/" + stem,
        files: { source: name, guide: guideName, ...(resource ? { specification: resource } : {}) },
        guides: { en: { locale: "en", fileName: guideName, label: "English", mediaType: "text/markdown" } },
        defaultLocale: "en", selectedLocale: "en", mediaTypes: {},
        fileNames: { [name]: name, [guideName]: guideName },
        canvas: current === name ? getUnassignedProjectInstructionSnapshot() : normalizeProjectInstructionDocument(null),
      };
    }
    // Keep unclaimed legacy files in storage/recovery; only projects are shown.
    if (current && isHiddenMiniProjectFile(current)) current = getVisibleWorkspaceFileNames()[0] || null;
  }

  function isReservedStorageName(name) {
    return ["__proto__", "prototype", "constructor"].includes(
      String(name || "").trim().toLowerCase()
    );
  }

  function validateMiniProjectDisplayName(displayName, instanceId = "") {
    const name = String(displayName || "").trim();

    if (!name) return "Enter a mini-project name.";
    if (isReservedStorageName(name)) {
      return "Use a different mini-project name.";
    }
    if (name.length > 64) {
      return "Keep the mini-project name under 64 characters.";
    }
    if (/[\\/:*?"<>|\x00-\x1f]/.test(name)) {
      return 'Do not use path separators or these characters: \\ / : * ? " < > |';
    }

    const normalizedName = name.toLocaleLowerCase();
    const duplicateProject = Object.entries(miniProjects).some(
      ([otherInstanceId, project]) =>
        otherInstanceId !== instanceId &&
        String(project?.displayName || project?.title || "")
          .trim()
          .toLocaleLowerCase() === normalizedName
    );
    if (duplicateProject || hasFile(name) || hasGroup(name)) {
      return "A file, group, or mini-project with this name already exists.";
    }

    return "";
  }

  function getFileNameSelectionEnd(fileName) {
    const name = String(fileName || "");
    const lastDot = name.lastIndexOf(".");
    return lastDot > 0 ? lastDot : name.length;
  }

  function focusInlineFileInput() {
    requestAnimationFrame(() => {
      const input = document.querySelector(".file-inline-input");
      if (!input) return;
      input.focus();
      if (inlineFileEdit?.mode === "rename-project") {
        input.select();
        return;
      }

      input.setSelectionRange(0, getFileNameSelectionEnd(input.value));
    });
  }

  function renderInlineFileInput(row, edit) {
    const editorWrap = document.createElement("div");
    editorWrap.className = "file-inline-editor";

    const input = document.createElement("input");
    input.className = "file-inline-input";
    input.type = "text";
    input.value = edit.value || "";
    input.spellcheck = false;
    input.setAttribute("aria-label", "Project display name");
    input.title = "Changes the project label only. The specification defines its name and file names.";

    const error = document.createElement("div");
    error.className = "file-inline-error";
    error.textContent = edit.error || "";

    input.addEventListener("click", (event) => event.stopPropagation());
    input.addEventListener("input", () => {
      if (!inlineFileEdit) return;
      inlineFileEdit.value = input.value;
      inlineFileEdit.error = "";
      error.textContent = "";
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        commitInlineFileEdit();
      } else if (event.key === "Escape") {
        event.preventDefault();
        cancelInlineFileEdit();
      }
    });
    input.addEventListener("blur", () => {
      window.setTimeout(() => {
        if (inlineFileEdit && document.querySelector(".file-inline-input") === input) {
          commitInlineFileEdit();
        }
      }, 0);
    });

    editorWrap.appendChild(input);
    editorWrap.appendChild(error);
    row.appendChild(editorWrap);
  }

  function getCanvasSplitContainer() {
    return document.querySelector(".canvas-split-container");
  }

  // Dividers resize adjacent panels; a closed neighbor passes spare width to an
  // expanded pane so compact panels can be reopened independently.
  function getWorkspacePanelSpecs() {
    return workspacePanelMinWidths.map((_, index) => ({
      min: getWorkspacePanelMinWidth(index), compact: WORKSPACE_PANEL_COMPACT_WIDTH,
    }));
  }

  function snapWorkspacePanelSize(value, spec) {
    return spec.compact && value <= WORKSPACE_PANEL_COMPACT_THRESHOLD
      ? spec.compact
      : Math.max(spec.min, value);
  }

  function workspacePanelFloor(value, spec) {
    return spec.compact && value === spec.compact ? spec.compact : spec.min;
  }

  function getWorkspaceContentWidth() {
    const container = getCanvasSplitContainer();
    return Math.max(
      getWorkspacePanelMinWidth(2) + 3 * WORKSPACE_PANEL_COMPACT_WIDTH,
      Math.round(container?.getBoundingClientRect().width || 0) -
        WORKSPACE_RESIZER_TOTAL_WIDTH
    );
  }

  function getWorkspaceWidths() {
    return [
      outlinerWidth,
      projectAiColumnWidth,
      getWorkspaceContentWidth() - outlinerWidth - projectAiColumnWidth - documentationWidth,
      documentationWidth,
    ];
  }

  function getWorkspaceNeighbor(index) {
    return index === 0 || index === 2 ? 1 : 2;
  }

  function getWorkspacePanelMaxWidth(index, widths = getWorkspaceWidths(), specs = getWorkspacePanelSpecs()) {
    const neighbor = getWorkspaceNeighbor(index);
    const otherSlack = widths[neighbor] === specs[neighbor].compact
      ? widths.reduce((sum, width, i) => sum + (i === index || i === neighbor ? 0 : width - workspacePanelFloor(width, specs[i])), 0)
      : 0;
    return widths[index] + widths[neighbor] - workspacePanelFloor(widths[neighbor], specs[neighbor]) + otherSlack;
  }

  function fitWorkspaceWidths(requested, available, specs) {
    const widths = requested.map((value, i) => snapWorkspacePanelSize(value, specs[i]));
    let excess = widths.reduce((sum, width) => sum + width, 0) - available;
    // A viewport change first consumes the flexible editor, then side-panel slack.
    for (const i of [2, 0, 3, 1]) {
      const take = Math.min(Math.max(0, excess), widths[i] - workspacePanelFloor(widths[i], specs[i]));
      widths[i] -= take;
      excess -= take;
    }
    for (const i of [0, 3, 1]) {
      if (excess <= 0) break;
      const released = widths[i] - specs[i].compact;
      widths[i] = specs[i].compact;
      excess -= released;
    }
    // Keep an explicitly collapsed editor compact; the canvas takes spare room.
    const flexibleIndex = widths[2] === specs[2].compact ? 1 : 2;
    widths[flexibleIndex] -= excess;
    return widths;
  }

  function resizeWorkspacePanels(start, specs, index, requested) {
    const widths = [...start];
    const neighbor = getWorkspaceNeighbor(index);
    const total = start[index] + start[neighbor];
    let target = Math.min(
      getWorkspacePanelMaxWidth(index, start, specs),
      snapWorkspacePanelSize(requested, specs[index])
    );
    if (target !== specs[index].compact && target < specs[index].min) return widths;
    let adjacent = total - target;
    if (start[neighbor] === specs[neighbor].compact) {
      // Keep the neighbor closed and exchange space with expanded panes,
      // preferring the editor or canvas.
      const recipients = [2, 1, 0, 3].filter(i => i !== index && i !== neighbor && widths[i] >= specs[i].min);
      if (!recipients.length) return widths;
      adjacent = specs[neighbor].compact;
      let transfer = total - target - adjacent;
      if (transfer >= 0) widths[recipients[0]] += transfer;
      else for (const recipient of recipients) {
        const borrowed = Math.min(-transfer, widths[recipient] - specs[recipient].min);
        widths[recipient] -= borrowed;
        transfer += borrowed;
      }
    } else if (adjacent !== specs[neighbor].compact && adjacent < specs[neighbor].min) {
      adjacent = snapWorkspacePanelSize(adjacent, specs[neighbor]);
      target = total - adjacent;
    }
    // A compact panel can reopen only when the available width meets its minimum.
    if (target !== specs[index].compact && target < specs[index].min) return widths;
    widths[index] = target;
    widths[neighbor] = adjacent;
    return widths;
  }

  function resizeWorkspaceBoundary(start, specs, boundary, delta) {
    if (!delta) return [...start];
    const growing = delta > 0 ? boundary : boundary + 1;
    const shrinking = delta > 0 ? boundary + 1 : boundary;
    const amount = Math.abs(delta);
    // A small motion on a closed rail must not immediately reopen it.
    if (start[growing] === specs[growing].compact &&
        amount < WORKSPACE_PANEL_REOPEN_DISTANCE) return [...start];
    const sizes = [...start];
    const requested = start[shrinking] - amount;
    sizes[shrinking] = start[shrinking] === specs[shrinking].compact ||
      requested <= specs[shrinking].min - WORKSPACE_PANEL_COLLAPSE_DISTANCE
      ? specs[shrinking].compact
      : Math.max(specs[shrinking].min, requested);
    const pairTotal = start[growing] + start[shrinking];
    sizes[growing] = Math.max(specs[growing].min, pairTotal - sizes[shrinking]);
    let missing = sizes[growing] + sizes[shrinking] - pairTotal;
    // A reopened pane first takes its minimum from its expanded neighbor.
    const adjacentSlack = sizes[shrinking] - workspacePanelFloor(sizes[shrinking], specs[shrinking]);
    const adjacentTransfer = Math.min(missing, adjacentSlack);
    sizes[shrinking] -= adjacentTransfer;
    missing -= adjacentTransfer;
    // Two closed neighbors may need space from a farther expanded pane. Never
    // close that pane implicitly or take more than its spare space.
    for (const index of [2, 1, 0, 3]) {
      if (index === growing || index === shrinking || missing <= 0) continue;
      const borrowed = Math.min(missing, sizes[index] - workspacePanelFloor(sizes[index], specs[index]));
      sizes[index] -= borrowed;
      missing -= borrowed;
    }
    return missing > 0 ? [...start] : sizes;
  }

  function getWorkspaceCollapsePreview(start, specs, boundary, delta) {
    if (!delta) return null;
    const index = delta < 0 ? boundary : boundary + 1;
    if (start[index] === specs[index].compact) return null;
    const overtravel = specs[index].min - (start[index] - Math.abs(delta));
    if (overtravel < 0 || overtravel >= WORKSPACE_PANEL_COLLAPSE_DISTANCE) return null;
    return { index, direction: delta < 0 ? -1 : 1 };
  }

  function getWorkspacePanelMinWidth(index) {
    const panel = getCanvasSplitContainer()?.querySelectorAll(
      ":scope > :is(.outliner, .project-ai-layout, .editor-workspace, .documentation-workspace)"
    )[index];
    const strip = panel?.querySelector(".ui-panel-header");
    if (!strip || !panel || !window.getComputedStyle) return workspacePanelMinWidths[index];
    const style = window.getComputedStyle?.(strip);
    if (style?.display === "none" || !strip.getClientRects().length) return workspacePanelMinWidths[index];
    const panelStyle = window.getComputedStyle(strip.closest(".avr-session-panel") || panel);
    const controls = [...strip.children].filter((element) => {
      const controlStyle = window.getComputedStyle?.(element);
      return !element.hidden && controlStyle?.display !== "none";
    });
    const gap = Number.parseFloat(style?.columnGap || style?.gap || "0") || 0;
    const horizontalPadding =
      (Number.parseFloat(style?.paddingLeft || "0") || 0) +
      (Number.parseFloat(style?.paddingRight || "0") || 0);
    const panelChrome =
      (Number.parseFloat(panelStyle?.paddingLeft || "0") || 0) +
      (Number.parseFloat(panelStyle?.paddingRight || "0") || 0) +
      (Number.parseFloat(panelStyle?.borderLeftWidth || "0") || 0) +
      (Number.parseFloat(panelStyle?.borderRightWidth || "0") || 0);
    const controlsWidth = controls.reduce(
      (total, element) => total + element.getBoundingClientRect().width,
      0
    );
    // Header children keep their intrinsic widths in one row. Do not measure
    // the constrained strip itself, which would lock its present pane width.
    workspacePanelMinWidths[index] = Math.max(WORKSPACE_PANEL_COMPACT_WIDTH + 1,
      Math.ceil(panelChrome + horizontalPadding + controlsWidth +
        Math.max(0, controls.length - 1) * gap + 2));
    return workspacePanelMinWidths[index];
  }

  function persistWorkspaceLayout() {
    outlinerPreferredWidth = outlinerWidth;
    projectAiColumnPreferredWidth = projectAiColumnWidth;
    documentationPreferredWidth = documentationWidth;
    try {
      localStorage.setItem(STORAGE_OUTLINER_WIDTH, String(outlinerPreferredWidth));
      localStorage.setItem(STORAGE_DOCUMENTATION_WIDTH, String(documentationPreferredWidth));
      localStorage.setItem(STORAGE_PROJECT_AI_COLUMN_WIDTH, String(projectAiColumnPreferredWidth));
      persistEditorCollapsed();
    } catch (error) {
      console.warn("Failed to persist workspace layout:", error);
    }
  }

  function persistEditorCollapsed() {
    try { localStorage.setItem(STORAGE_EDITOR_COLLAPSED, String(editorCollapsed)); } catch {}
  }

  function refreshWorkspaceEditors() {
    if (workspaceEditorRefreshFrame !== null) return;
    workspaceEditorRefreshFrame = window.requestAnimationFrame(() => {
      workspaceEditorRefreshFrame = null;
      editor?.refresh();
      documentationEditor?.refresh();
      projectInstructionEditor?.refresh();
      document.querySelectorAll(".canvas-split-container .custom-select").forEach(custom => {
        if (custom.getClientRects().length) updateCustomSelectIntrinsicWidth(custom);
      });
      fitEditorFileWatermark();
    });
  }

  function renderWorkspaceWidths(widths, { persist = false } = {}) {
    [outlinerWidth, projectAiColumnWidth, , documentationWidth] = widths;
    editorCollapsed = widths[2] <= WORKSPACE_PANEL_COMPACT_THRESHOLD;
    const container = getCanvasSplitContainer();
    if (container) {
      container.style.setProperty("--editor-workspace-min-width",
        `${editorCollapsed ? WORKSPACE_PANEL_COMPACT_WIDTH : getWorkspacePanelMinWidth(2)}px`);
      for (const [property, value] of [
        ["--outliner-width", outlinerWidth],
        ["--project-ai-width", projectAiColumnWidth],
        ["--documentation-width", documentationWidth],
      ]) container.style.setProperty(property, `${value}px`);
    }
    syncWorkspaceCompactState(widths);
    syncSplitResizerAria();
    if (persist) persistWorkspaceLayout();
    refreshWorkspaceEditors();
  }

  function fitWorkspaceToViewport() {
    renderWorkspaceWidths(fitWorkspaceWidths(
      [outlinerPreferredWidth, projectAiColumnPreferredWidth,
        editorCollapsed ? WORKSPACE_PANEL_COMPACT_WIDTH : OUTLINER_EDITOR_MIN_WIDTH,
        documentationPreferredWidth],
      getWorkspaceContentWidth(),
      getWorkspacePanelSpecs()
    ));

    refreshWorkspaceEditors();
  }

  function resizeWorkspacePanel(index, requested, { persist = true } = {}) {
    renderWorkspaceWidths(
      resizeWorkspacePanels(getWorkspaceWidths(), getWorkspacePanelSpecs(), index, requested),
      { persist }
    );
  }

  function syncEditorCollapseState() {
    const content = $("editorContent");
    $("editorWorkspace")?.classList.toggle("is-collapsed", editorCollapsed);
    if (content) content.hidden = editorCollapsed;
  }

  function syncWorkspaceCompactState(sizes) {
    const container = getCanvasSplitContainer();
    for (const [index, name] of ["outliner", "project-ai", "editor", "documentation"].entries()) {
      container?.classList.toggle(`is-${name}-compact`, sizes[index] <= WORKSPACE_PANEL_COMPACT_THRESHOLD);
    }
    syncEditorCollapseState();
  }

  function expandEditorForTargetValidation() {
    const sizes = getWorkspaceWidths();
    const specs = getWorkspacePanelSpecs();
    if (sizes[2] !== specs[2].compact) return;
    const restored = resizeWorkspacePanels(sizes, specs, 2, specs[2].min);
    if (restored[2] === specs[2].compact) {
      sizes[2] = specs[2].min;
      renderWorkspaceWidths(fitWorkspaceWidths(sizes, getWorkspaceContentWidth(), specs), { persist: true });
    } else renderWorkspaceWidths(restored, { persist: true });
  }

  function expandOutlinerForEditing() {
    if (getWorkspaceWidths()[0] <= WORKSPACE_PANEL_COMPACT_THRESHOLD) {
      resizeWorkspacePanel(0, OUTLINER_DEFAULT_WIDTH);
    }
  }

  function expandDocumentationForNavigation() {
    if (getWorkspaceWidths()[3] <= WORKSPACE_PANEL_COMPACT_THRESHOLD) {
      resizeWorkspacePanel(3, DOCUMENTATION_DEFAULT_WIDTH);
    }
  }

  function restoreWorkspaceLayout() {
    const read = (key, fallback) => {
      try {
        const stored = localStorage.getItem(key);
        const value = stored === null ? fallback : Number(stored);
        return Number.isFinite(value) && value >= 0 ? value : fallback;
      } catch { return fallback; }
    };
    const specs = getWorkspacePanelSpecs();
    outlinerPreferredWidth = snapWorkspacePanelSize(read(STORAGE_OUTLINER_WIDTH, OUTLINER_DEFAULT_WIDTH), specs[0]);
    projectAiColumnPreferredWidth = snapWorkspacePanelSize(read(STORAGE_PROJECT_AI_COLUMN_WIDTH, PROJECT_AI_COLUMN_DEFAULT_WIDTH), specs[1]);
    documentationPreferredWidth = snapWorkspacePanelSize(read(STORAGE_DOCUMENTATION_WIDTH, DOCUMENTATION_DEFAULT_WIDTH), specs[3]);
    try { editorCollapsed = localStorage.getItem(STORAGE_EDITOR_COLLAPSED) === "true"; } catch {}
    fitWorkspaceToViewport();
  }

  function syncSplitResizerAria() {
    const widths = getWorkspaceWidths();
    const specs = getWorkspacePanelSpecs();
    const names = ["Files", "Canvas", "Code", "Guide"];
    for (const [id, index] of [
      ["fileListResizer", 0], ["projectAiColumnResizer", 1], ["documentationResizer", 2],
    ]) {
      const handle = $(id);
      if (!handle) continue;
      const compact = widths[index] === specs[index].compact;
      const nextCompact = widths[index + 1] === specs[index + 1].compact;
      handle.setAttribute("aria-orientation", "vertical");
      handle.setAttribute("aria-valuemin", String(specs[index].compact));
      handle.setAttribute("aria-valuemax", String(Math.round(widths[index] + widths[index + 1] - specs[index + 1].compact)));
      handle.setAttribute("aria-valuenow", String(Math.round(widths[index])));
      const arrows = ["ArrowLeft", "ArrowRight"];
      const describe = (i, collapsed, arrow) => collapsed ? "collapsed"
        : widths[i] === specs[i].min ? `at minimum; ${arrow} to collapse`
          : `${Math.round(widths[i])} pixels`;
      handle.setAttribute("aria-valuetext", `${names[index]} ${describe(index, compact, arrows[0])}; ${names[index + 1]} ${describe(index + 1, nextCompact, arrows[1])}`);
    }
  }

  function clearSplitCollapsePreview() {
    document.querySelectorAll?.(".pane-collapse-cue").forEach(cue => cue.remove());
  }

  function showSplitCollapsePreview(panel, direction) {
    if (!panel) { clearSplitCollapsePreview(); return; }
    const name = direction < 0 ? "left" : "right";
    let cue = panel.querySelector(":scope > .pane-collapse-cue");
    if (!cue || cue.dataset.direction !== name) {
      clearSplitCollapsePreview();
      cue = document.createElement("div");
      cue.className = "pane-collapse-cue";
      cue.dataset.direction = name;
      cue.setAttribute("aria-hidden", "true");
      cue.setAttribute("inert", "");
      for (let index = 0; index < 3; index += 1) {
        const chevron = document.createElement("span");
        chevron.className = "pane-collapse-chevron";
        cue.appendChild(chevron);
      }
      panel.appendChild(cue);
    }
  }

  // Pointer capture, cancellation and feedback are shared by every separator.
  function bindSplitResizer(handle, { axis, enabled = () => true, start, move, finish, key }) {
    if (!handle) return;
    const coordinate = event => axis === "x" ? event.clientX : event.clientY;
    const end = event => {
      const session = activeSplitResize;
      if (!session || session.handle !== handle ||
          (event?.pointerId !== undefined && event.pointerId !== session.pointerId)) return;
      activeSplitResize = null;
      handle.classList.remove("is-resizing");
      clearSplitCollapsePreview();
      document.body.classList.remove(session.cursorClass);
      if (handle.hasPointerCapture?.(session.pointerId)) handle.releasePointerCapture(session.pointerId);
      finish?.(session.data);
      event?.preventDefault?.();
    };
    handle.addEventListener("pointerdown", event => {
      if (event.button !== 0 || event.isPrimary === false || activeSplitResize || !enabled()) return;
      event.preventDefault();
      handle.focus({ preventScroll: true });
      const cursorClass = axis === "x" ? "is-column-resizing" : "is-row-resizing";
      activeSplitResize = { handle, pointerId: event.pointerId,
        cursorClass, origin: coordinate(event), data: start(event) };
      handle.setPointerCapture?.(event.pointerId);
      handle.classList.add("is-resizing");
      document.body.classList.add(cursorClass);
    });
    handle.addEventListener("pointermove", event => {
      const session = activeSplitResize;
      if (!session || session.handle !== handle || session.pointerId !== event.pointerId) return;
      event.preventDefault();
      move(coordinate(event) - session.origin, session.data, event);
    });
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
      handle.addEventListener(type, end);
    }
    window.addEventListener("blur", () => end());
    window.addEventListener("resize", () => {
      end();
    });
    handle.addEventListener("keydown", event => {
      if (!activeSplitResize && enabled()) key?.(event);
    });
  }

  function bindWorkspaceColumnResizer(id, index) {
    bindSplitResizer($(id), {
      axis: "x",
      start: () => ({ available: getWorkspaceContentWidth(), widths: getWorkspaceWidths(), specs: getWorkspacePanelSpecs(), offset: 0 }),
      move: (delta, state) => {
        const movement = delta - state.offset;
        const sizes = resizeWorkspaceBoundary(state.widths, state.specs, index, movement);
        renderWorkspaceWidths(sizes);
        const preview = getWorkspaceCollapsePreview(state.widths, state.specs, index, movement);
        if (preview) {
          const panels = getCanvasSplitContainer()?.querySelectorAll(":scope > .outliner, :scope > .project-ai-layout, :scope > .editor-workspace, :scope > .documentation-workspace");
          showSplitCollapsePreview(panels?.[preview.index], preview.direction);
        } else clearSplitCollapsePreview();
        if (sizes.some((size, i) => (size === state.specs[i].compact) !== (state.widths[i] === state.specs[i].compact))) {
          state.widths = sizes;
          state.offset = delta;
        }
      },
      finish: state => {
        if (state.available !== getWorkspaceContentWidth()) fitWorkspaceToViewport();
        else persistWorkspaceLayout();
      },
      key: event => {
        const widths = getWorkspaceWidths(), specs = getWorkspacePanelSpecs();
        const arrows = ["ArrowLeft", "ArrowRight"];
        let delta;
        if (event.key === "Home") {
          if (widths[index] === specs[index].compact) return;
          delta = -(widths[index] - specs[index].min + WORKSPACE_PANEL_COLLAPSE_DISTANCE);
        } else if (event.key === "End") {
          if (widths[index + 1] === specs[index + 1].compact) return;
          delta = widths[index + 1] - specs[index + 1].min + WORKSPACE_PANEL_COLLAPSE_DISTANCE;
        } else if (arrows.includes(event.key)) {
          const direction = event.key === arrows[1] ? 1 : -1;
          const growing = direction > 0 ? index : index + 1;
          const shrinking = direction > 0 ? index + 1 : index;
          const step = widths[growing] === specs[growing].compact ? Math.max(WORKSPACE_PANEL_REOPEN_DISTANCE, specs[growing].min - specs[growing].compact)
            : widths[shrinking] <= specs[shrinking].min ? WORKSPACE_PANEL_COLLAPSE_DISTANCE
              : event.shiftKey ? 48 : 24;
          delta = direction * step;
        } else return;
        event.preventDefault();
        renderWorkspaceWidths(resizeWorkspaceBoundary(widths, specs, index, delta), { persist: true });
      },
    });
  }

  function bindFileListResizer() {
    bindWorkspaceColumnResizer("fileListResizer", 0);
  }

  function bindDocumentationResizer() {
    bindWorkspaceColumnResizer("documentationResizer", 2);
  }

  function getProjectAiLayout() {
    return document.querySelector(".project-ai-layout");
  }





  function bindProjectAiResizers() {
    bindWorkspaceColumnResizer("projectAiColumnResizer", 1);
  }

  function bindWorkspaceResizeObserver() {
    const container = getCanvasSplitContainer();
    if (!container) return;
    const busy = () => activeSplitResize ||
      $("avrDeviceSection")?.classList.contains("is-device-panel-transitioning");
    const scheduleResize = () => {
      if (busy() || workspaceResizeFrame !== null) return;
      workspaceResizeFrame = window.requestAnimationFrame(() => {
        workspaceResizeFrame = null;
        if (!busy()) fitWorkspaceToViewport();
      });
    };
    if (typeof ResizeObserver === "function") {
      workspaceResizeObserver = new ResizeObserver(scheduleResize);
      // Observe available space and intrinsic controls, never pane widths.
      workspaceResizeObserver.observe(container);
      container.querySelectorAll(".ui-panel-header > *").forEach(control => {
        workspaceResizeObserver.observe(control);
      });
      const editorContainer = document.querySelector(".editor-container");
      if (editorContainer) {
        watermarkResizeObserver = new ResizeObserver(scheduleEditorFileWatermarkFit);
        watermarkResizeObserver.observe(editorContainer);
      }
    } else window.addEventListener("resize", scheduleResize);
    document.fonts?.ready.then(() => {
      refreshFontDependentMeasurements();
      scheduleResize();
    });
    document.fonts?.addEventListener?.("loadingdone", () => {
      refreshFontDependentMeasurements();
      scheduleResize();
    });
  }

  function getOutlinerFileKind(fileName) {
    const ext = String(fileName || "").split(".").pop().toLowerCase();
    if (["c", "cpp", "cc", "ino"].includes(ext)) return "c";
    if (["h", "hpp"].includes(ext)) return "h";
    if (["s", "asm"].includes(ext)) return "asm";
    if (["hex", "ihex"].includes(ext)) return "hex";
    if (ext === "txt") return "txt";
    if (ext === "md") return "md";
    if (["yaml", "yml"].includes(ext)) return "yaml";
    return "file";
  }

  function getOutlinerFileIcon(fileName) {
    const kind = getOutlinerFileKind(fileName);
    if (kind === "c") return "C";
    if (kind === "h") return "H";
    if (kind === "asm") return "ASM";
    if (kind === "hex") return "HEX";
    if (kind === "txt") return "TXT";
    if (kind === "md") return "MD";
    if (kind === "yaml") return "YML";
    return "F";
  }

  function startInlineRename(fileName) {
    if (!hasFile(fileName)) return;
    closeFileContextMenu();
    closeAddFileModal();
    expandOutlinerForEditing();
    const linkedProject = getMiniProjectForFile(fileName);
    if (linkedProject?.role === miniProjectCore.ROLES.SOURCE) {
      inlineFileEdit = {
        mode: "rename-project",
        instanceId: linkedProject.instanceId,
        originalName: fileName,
        value:
          linkedProject.project.displayName ||
          linkedProject.project.title ||
          linkedProject.project.definitionId ||
          getFileStem(fileName),
        error: "",
      };
      renderOutliner();
      focusInlineFileInput();
      return;
    }
    inlineFileEdit = {
      mode: "rename",
      originalName: fileName,
      value: fileName,
      error: "",
    };
    renderOutliner();
    focusInlineFileInput();
  }

  function cancelInlineFileEdit() {
    inlineFileEdit = null;
    renderOutliner();
  }

  function commitInlineFileEdit() {
    if (!inlineFileEdit) return false;

    const input = document.querySelector(".file-inline-input");
    const rawName = String(
      input ? input.value : inlineFileEdit.value || ""
    ).trim();
    const originalName = inlineFileEdit.originalName || "";
    const nextName = rawName;
    const error = validateMiniProjectDisplayName(nextName, inlineFileEdit.instanceId);
    if (error) {
      inlineFileEdit.value = nextName;
      inlineFileEdit.error = error;
      renderOutliner();
      focusInlineFileInput();
      return false;
    }
    if (inlineFileEdit.mode === "rename-project") {
      const instanceId = inlineFileEdit.instanceId;
      inlineFileEdit = null;
      renameMiniProjectInstance(instanceId, nextName);
      return true;
    }

    inlineFileEdit = null;
    renderOutliner();
    return false;
  }

  function removeFileFromGroups(fileName) {
    for (const group of Object.values(fileGroups)) {
      group.files = (group.files || []).filter((name) => name !== fileName);
    }
  }

  function renderFileRow(list, name, groupName = "", depth = 0) {
    const linkedProject = getMiniProjectForFile(name);
    const isMiniProjectSource =
      linkedProject?.role === miniProjectCore.ROLES.SOURCE;
    const displayName = getOutlinerFileLabel(name);
    const row = document.createElement("div");
    row.className = "file-item";
    row.dataset.file = name;
    row.dataset.fileKind = isMiniProjectSource
      ? "mini-project"
      : getOutlinerFileKind(name);
    row.dataset.outlinerIcon = isMiniProjectSource
      ? "MP"
      : getOutlinerFileIcon(name);
    row.tabIndex = 0;
    row.setAttribute("role", "button");
    row.setAttribute("aria-label", displayName);
    row.title = isMiniProjectSource ? `${displayName} (${linkedProject.project.fileNames?.[name] || name})` : name;
    row.style.setProperty("--outliner-depth", String(depth));
    if (isMiniProjectSource) row.classList.add("mini-project-item");

    if (groupName) {
      row.dataset.groupMemberOf = groupName;
      row.classList.add("group-member");
    }
    if (isCFileName(name)) row.classList.add("file-c");

    if (name === current) {
      row.classList.add("active");
    }

    const editingThisFile =
      inlineFileEdit &&
      (inlineFileEdit.mode === "rename" ||
        inlineFileEdit.mode === "rename-project") &&
      inlineFileEdit.originalName === name;

    if (editingThisFile) {
      row.classList.add("editing");
      renderInlineFileInput(row, inlineFileEdit);
      list.appendChild(row);
      return;
    }

    const label = document.createElement("div");
    label.className = "file-name";
    label.textContent = displayName;
    row.appendChild(label);

    const acts = document.createElement("div");
    acts.className = "file-actions";

    const menuBtn = document.createElement("button");
    menuBtn.className = "file-menu-btn";
    menuBtn.title = "Project actions";
    menuBtn.textContent = "\u22ef";

    menuBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const rect = menuBtn.getBoundingClientRect();
      openFileContextMenu(name, rect.left + rect.width / 2, rect.bottom + 4);
    });

    acts.appendChild(menuBtn);
    row.appendChild(acts);

    row.addEventListener("click", () => {
      if (inlineFileEdit && !commitInlineFileEdit()) return;
      selectFile(name);
    });
    row.addEventListener("keydown", event => {
      if (event.target === row && ["Enter", " "].includes(event.key)) {
        event.preventDefault();
        row.click();
      }
    });

    row.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      openFileContextMenu(name, e.clientX, e.clientY);
    });

    list.appendChild(row);
  }

  function renderOutliner() {
    const list = $("fileList");
    list.innerHTML = "";

    const newRow = document.createElement("div");
    newRow.className = "file-item new-item";
    newRow.dataset.outlinerIcon = "+";
    newRow.title = "Add project";
    newRow.setAttribute("role", "button");
    newRow.setAttribute("aria-label", "Add project");
    newRow.tabIndex = 0;
    newRow.addEventListener("keydown", (event) => {
      if (event.target === newRow && ["Enter", " "].includes(event.key)) {
        event.preventDefault();
        newRow.click();
      }
    });

    {
      const plus = document.createElement("div");
      plus.className = "file-name";
      plus.textContent = "+";

      newRow.appendChild(plus);
      newRow.addEventListener("click", (e) => {
        e.stopPropagation();
        openAddFileModal();
      });
    }

    list.appendChild(newRow);

    for (const name of getVisibleWorkspaceFileNames()) {
      renderFileRow(list, name, "", 0);
    }

    updateToolbarState();
    updateCompilePanelState(false);
  }

  function openFileContextMenu(fileName, clientX, clientY) {
    const menu = $("fileContextMenu");
    if (!menu) return;

    contextMenuFile = fileName;

    const renameBtn = menu.querySelector('button[data-action="rename"]');
    const deleteBtn = menu.querySelector('button[data-action="delete"]');
    const downloadBtn = menu.querySelector('button[data-action="download"]');
    const linkedProject = getMiniProjectForFile(fileName);
    const isMiniProjectSource =
      linkedProject?.role === miniProjectCore.ROLES.SOURCE;

    if (renameBtn) {
      renameBtn.hidden = false;
      renameBtn.textContent = isMiniProjectSource
        ? "Change display name"
        : "Rename";
    }
    if (deleteBtn) {
      deleteBtn.hidden = false;
      deleteBtn.textContent = isMiniProjectSource
        ? "Delete project"
        : "Delete";
    }
    if (downloadBtn) {
      downloadBtn.hidden = false;
      downloadBtn.textContent = isMiniProjectSource ? "Download project ZIP" : "Download";
    }

    const downloadHexBtn = menu.querySelector(
      'button[data-action="download-hex"]'
    );
    if (downloadHexBtn) {
      downloadHexBtn.hidden = false;
      const canDownloadHex = /\.c$/i.test(fileName);
      downloadHexBtn.disabled = !canDownloadHex;
      downloadHexBtn.title = canDownloadHex
        ? "Compile and download HEX"
        : "HEX can only be built from .c files";
    }

    // First make it visible to measure size
    menu.style.display = "block";

    const menuRect = menu.getBoundingClientRect();
    const margin = 4;
    let x = clientX;
    let y = clientY;

    // Clamp to viewport
    if (x + menuRect.width + margin > window.innerWidth) {
      x = window.innerWidth - menuRect.width - margin;
    }
    if (y + menuRect.height + margin > window.innerHeight) {
      y = window.innerHeight - menuRect.height - margin;
    }
    if (x < margin) x = margin;
    if (y < margin) y = margin;

    menu.style.left = x + "px";
    menu.style.top = y + "px";
  }

  function closeFileContextMenu() {
    const menu = $("fileContextMenu");
    if (!menu) return;
    menu.style.display = "none";
    contextMenuFile = null;
  }

  async function handleFileContextAction(action) {
    if (!contextMenuFile || !hasFile(contextMenuFile)) {
      closeFileContextMenu();
      return;
    }

    const targetName = contextMenuFile;
    // Close menu immediately so it doesn't hang around over dialogs
    closeFileContextMenu();

    switch (action) {
      case "rename":
        renameFile(targetName);
        break;
      case "delete":
        await deleteFile(targetName);
        break;
      case "download":
        downloadFile(targetName);
        break;
      case "download-hex":
        await downloadHexForFile(targetName);
        break;
      default:
        break;
    }
  }

  function getMiniProjectGuideEntries(project) {
    return Object.values(project?.guides || {}).filter(
      (guide) => guide?.fileName && hasFile(guide.fileName)
    );
  }

  function getMiniProjectLocalFileNames(project) {
    const names = new Set();
    for (const name of Object.values(project?.files || {})) {
      if (typeof name === "string" && hasFile(name)) names.add(name);
    }
    for (const guide of getMiniProjectGuideEntries(project)) {
      names.add(guide.fileName);
    }
    return [...names];
  }

  function getMiniProjectForFile(fileName) {
    if (!fileName) return null;

    for (const [instanceId, project] of Object.entries(miniProjects)) {
      for (const [role, linkedFileName] of Object.entries(project.files || {})) {
        if (role === miniProjectCore.ROLES.GUIDE) continue;
        if (linkedFileName === fileName) {
          return { instanceId, project, role };
        }
      }
      for (const guide of getMiniProjectGuideEntries(project)) {
        if (guide.fileName === fileName) {
          return {
            instanceId,
            project,
            role: miniProjectCore.ROLES.GUIDE,
            locale: guide.locale || "",
            guide,
          };
        }
      }
    }

    return null;
  }

  function isHiddenMiniProjectFile(fileName) {
    const linkedProject = getMiniProjectForFile(fileName);
    return !linkedProject || linkedProject.role !== miniProjectCore.ROLES.SOURCE;
  }

  function getVisibleWorkspaceFileNames() {
    return Object.keys(files).filter((name) => !isHiddenMiniProjectFile(name));
  }

  function getOutlinerFileLabel(fileName) {
    const linkedProject = getMiniProjectForFile(fileName);
    if (linkedProject?.role === miniProjectCore.ROLES.SOURCE) {
      return (
        linkedProject.project.displayName ||
        linkedProject.project.title ||
        linkedProject.project.definitionId ||
        getFileStem(fileName)
      );
    }
    return fileName;
  }

  function removeMiniProjectFile(fileName) {
    for (const [instanceId, project] of Object.entries(miniProjects)) {
      for (const role of Object.keys(project.files || {})) {
        if (project.files[role] !== fileName) continue;
        delete project.files[role];
        if (project.mediaTypes) delete project.mediaTypes[role];
      }
      for (const [locale, guide] of Object.entries(project.guides || {})) {
        if (guide?.fileName === fileName) delete project.guides[locale];
      }
      if (!Object.keys(project.files || {}).length) delete miniProjects[instanceId];
    }
  }

  function isAiSpecMarkdownFile(fileName) {
    const linkedProject = getMiniProjectForFile(fileName);
    if (linkedProject) {
      return linkedProject.role === miniProjectCore.ROLES.AI_SPEC;
    }

    return (
      miniProjectCore.inferFileRole(String(fileName || "")) ===
      miniProjectCore.ROLES.AI_SPEC
    );
  }

  function findFileNameCaseInsensitive(candidate) {
    const wanted = String(candidate || "").toLowerCase();
    if (!wanted) return "";
    return Object.keys(files).find((name) => name.toLowerCase() === wanted) || "";
  }

  function resolveGuideFileName(fileName) {
    const linkedProject = getMiniProjectForFile(fileName);
    if (linkedProject) {
      const project = linkedProject.project;
      const selectedGuide =
        project.guides?.[project.selectedLocale] ||
        project.guides?.[project.defaultLocale] ||
        getMiniProjectGuideEntries(project)[0];
      const linkedGuide = selectedGuide?.fileName || project.files?.guide;
      if (linkedGuide && hasFile(linkedGuide)) return linkedGuide;
      if (linkedProject.role === miniProjectCore.ROLES.AI_SPEC) return "";
    }

    if (/\.md$/i.test(fileName || "") && !isAiSpecMarkdownFile(fileName)) {
      return fileName;
    }

    const stem = getFileStem(fileName);
    for (const candidate of [`${stem}.guide.md`, `${stem}.md`]) {
      const match = findFileNameCaseInsensitive(candidate);
      if (match && !isAiSpecMarkdownFile(match)) return match;
    }

    const groupName = getFileGroup(fileName);
    const groupFiles = groupName ? fileGroups[groupName]?.files || [] : [];
    return (
      groupFiles.find(
        (name) => /\.md$/i.test(name) && !isAiSpecMarkdownFile(name) && hasFile(name)
      ) || ""
    );
  }

  function getDocumentationContext(fileName = current) {
    const linkedProject = getMiniProjectForFile(fileName);
    const guideFile = resolveGuideFileName(fileName);
    const guide = linkedProject
      ? getMiniProjectGuideEntries(linkedProject.project).find(
          (entry) => entry.fileName === guideFile
        ) || null
      : null;
    return {
      guideFile,
      projectTitle:
        linkedProject?.project?.title ||
        (guideFile
          ? getFileStem(guideFile).replace(/\.guide$/i, "")
          : "Documentation"),
      linkedProject,
      guide,
    };
  }

  function getLiveFileContent(fileName) {
    if (editor && current === fileName) return editor.getValue();
    return String(fileName && hasFile(fileName) ? files[fileName] || "" : "");
  }

  function resolveSafeDocumentationLinkUrl(url) {
    const value = String(url || "").trim();
    if (!value) return "";
    try {
      const parsed = new URL(value, window.location.href);
      if (!["http:", "https:", "mailto:"].includes(parsed.protocol)) return "";
      return encodeURI(parsed.href);
    } catch {
      return "";
    }
  }

  function normalizeDocumentationAssetPath(value) {
    let path = String(value || "").trim().replace(/^<|>$/g, "");
    try {
      path = decodeURIComponent(path);
    } catch {}
    path = path.split(/[?#]/, 1)[0].replace(/\\/g, "/");
    while (path.startsWith("./")) path = path.slice(2);
    if (!path || path.startsWith("/") || /^[a-z][a-z\d+.-]*:/i.test(path)) {
      return "";
    }
    const segments = path.split("/").filter((segment) => segment && segment !== ".");
    if (segments.some((segment) => segment === "..")) return "";
    return segments.join("/");
  }

  function isSafeRasterDataUrl(value) {
    return /^data:image\/(?:png|jpe?g|gif|webp);base64,[a-z\d+/=\s]+$/i.test(
      String(value || "")
    );
  }

  function resolveDocumentationImageUrl(rawUrl, context) {
    const href = String(rawUrl || "").trim().replace(/^<|>$/g, "");
    if (!href) return "";

    const assetPath = normalizeDocumentationAssetPath(href);
    if (assetPath) {
      const registeredAssets = [
        ...(Array.isArray(context?.guide?.assets) ? context.guide.assets : []),
        ...(Array.isArray(context?.linkedProject?.project?.assets)
          ? context.linkedProject.project.assets
          : []),
      ];
      const matchedAsset = registeredAssets.find((asset) => {
        const candidate = normalizeDocumentationAssetPath(
          asset?.path || asset?.name || asset?.fileName
        );
        return candidate && candidate.toLowerCase() === assetPath.toLowerCase();
      });
      const embeddedUrl =
        matchedAsset?.dataUrl || matchedAsset?.url || matchedAsset?.content || "";
      if (isSafeRasterDataUrl(embeddedUrl)) return embeddedUrl;

      const assetBaseUrl = context?.guide?.assetBaseUrl || "";
      if (assetBaseUrl) {
        try {
          const base = new URL(assetBaseUrl, window.location.href);
          const target = new URL(assetPath, base);
          if (
            base.origin === window.location.origin &&
            target.origin === base.origin &&
            target.pathname.startsWith(base.pathname)
          ) {
            return target.href;
          }
        } catch {}
      }
    }

    try {
      const parsed = new URL(href, window.location.href);
      if (["http:", "https:"].includes(parsed.protocol)) return parsed.href;
    } catch {}
    return "";
  }

  function appendMarkdownInline(
    parent,
    rawText,
    context = null,
    { allowImages = true } = {}
  ) {
    const text = String(rawText || "");
    const tokenPattern =
      /(!\[([^\]\n]*)\]\(([^)\n]+)\)|`[^`\n]+`|\[([^\]\n]+)\]\(([^)\n]+)\)|\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|\*[^*\n]+\*|(?<![A-Za-z0-9])_(?=\S)(?:[^_\n]*?\S)?_(?![A-Za-z0-9]))/g;
    let cursor = 0;
    let match;

    while ((match = tokenPattern.exec(text))) {
      if (match.index > cursor) {
        parent.appendChild(document.createTextNode(text.slice(cursor, match.index)));
      }

      if (match[0].startsWith("![")) {
        const alt = match[2] || "";
        const src = allowImages
          ? resolveDocumentationImageUrl(match[3], context)
          : "";
        if (src) {
          const image = document.createElement("img");
          image.src = src;
          image.alt = alt;
          image.loading = "lazy";
          image.decoding = "async";
          parent.appendChild(image);
        } else if (alt) {
          parent.appendChild(document.createTextNode(alt));
        }
      } else if (match[0].startsWith("`")) {
        const code = document.createElement("code");
        code.textContent = match[0].slice(1, -1);
        parent.appendChild(code);
      } else if (
        match[0].startsWith("**") ||
        match[0].startsWith("__")
      ) {
        const strong = document.createElement("strong");
        appendMarkdownInline(
          strong,
          match[0].slice(2, -2),
          context,
          { allowImages }
        );
        parent.appendChild(strong);
      } else if (match[0].startsWith("~~")) {
        const deleted = document.createElement("del");
        appendMarkdownInline(
          deleted,
          match[0].slice(2, -2),
          context,
          { allowImages }
        );
        parent.appendChild(deleted);
      } else if (
        match[0].startsWith("*") ||
        match[0].startsWith("_")
      ) {
        const emphasis = document.createElement("em");
        appendMarkdownInline(
          emphasis,
          match[0].slice(1, -1),
          context,
          { allowImages }
        );
        parent.appendChild(emphasis);
      } else {
        const label = match[4];
        const href = resolveSafeDocumentationLinkUrl(
          String(match[5] || "").trim().replace(/^<|>$/g, "")
        );
        if (href) {
          const link = document.createElement("a");
          link.textContent = label;
          link.href = href;
          const destination = new URL(href, window.location.href);
          if (
            ["http:", "https:"].includes(destination.protocol) &&
            destination.origin !== window.location.origin
          ) {
            link.target = "_blank";
            link.rel = "noopener noreferrer";
          }
          parent.appendChild(link);
        } else {
          parent.appendChild(document.createTextNode(label));
        }
      }

      cursor = tokenPattern.lastIndex;
    }

    if (cursor < text.length) {
      parent.appendChild(document.createTextNode(text.slice(cursor)));
    }
  }

  function renderMarkdownInto(
    content,
    markdown,
    context = null,
    { indexDocumentationHeadings = false, allowImages = true } = {}
  ) {
    if (!content) return;

    const markdownRuntime = window.UartDebugMarkdown;
    if (markdownRuntime?.renderInto) {
      if (indexDocumentationHeadings) {
        documentationRenderedHeadingIndex = new Map();
      }
      markdownRuntime.renderInto(content, String(markdown || ""), {
        allowImages,
        resolveLinkUrl: (href) => resolveSafeDocumentationLinkUrl(href),
        resolveImageUrl: (href) =>
          allowImages ? resolveDocumentationImageUrl(href, context) : "",
        onHeading: ({ element, level, text, node }) => {
          if (!indexDocumentationHeadings || !element) return;
          const headingKey = miniProjectCore.normalizeHeadingKey(text);
          const indexKey = `${level}:${headingKey}`;
          element.dataset.documentationHeading = indexKey;
          if (Number.isSafeInteger(node?.position?.start?.offset)) {
            element.dataset.sourceStart = String(node.position.start.offset);
          }
          if (Number.isSafeInteger(node?.position?.end?.offset)) {
            element.dataset.sourceEnd = String(node.position.end.offset);
          }
          element.tabIndex = -1;
          if (
            headingKey &&
            !documentationRenderedHeadingIndex.has(indexKey)
          ) {
            documentationRenderedHeadingIndex.set(indexKey, element);
          }
        },
      });
      return;
    }

    content.replaceChildren();
    if (indexDocumentationHeadings) {
      documentationRenderedHeadingIndex = new Map();
    }

    const lines = String(markdown || "")
      .replace(/\r\n?/g, "\n")
      .split("\n");
    let paragraphLines = [];
    let activeList = null;
    let activeListType = "";
    let codeFence = null;
    let codeLines = [];

    const flushParagraph = () => {
      if (!paragraphLines.length) return;
      const paragraph = document.createElement("p");
      appendMarkdownInline(paragraph, paragraphLines.join(" ").trim(), context, {
        allowImages,
      });
      content.appendChild(paragraph);
      paragraphLines = [];
    };

    const flushList = () => {
      activeList = null;
      activeListType = "";
    };

    const flushCode = () => {
      const pre = document.createElement("pre");
      const code = document.createElement("code");
      code.textContent = codeLines.join("\n");
      if (codeFence?.language) code.dataset.language = codeFence.language;
      pre.appendChild(code);
      content.appendChild(pre);
      codeFence = null;
      codeLines = [];
    };

    const appendHeading = (level, rawHeadingText) => {
      const headingText = String(rawHeadingText || "")
        .replace(/[ \t]+#+[ \t]*$/, "")
        .trim();
      if (!headingText) return;

      const heading = document.createElement(`h${level}`);
      appendMarkdownInline(heading, headingText, context, { allowImages });
      if (indexDocumentationHeadings) {
        const headingKey = miniProjectCore.normalizeHeadingKey(headingText);
        const indexKey = `${level}:${headingKey}`;
        heading.dataset.documentationHeading = indexKey;
        heading.tabIndex = -1;
        if (
          headingKey &&
          !documentationRenderedHeadingIndex.has(indexKey)
        ) {
          documentationRenderedHeadingIndex.set(indexKey, heading);
        }
      }
      content.appendChild(heading);
    };

    for (const line of lines) {
      if (codeFence !== null) {
        const closingFence = line.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/);
        if (
          closingFence &&
          closingFence[1][0] === codeFence.character &&
          closingFence[1].length >= codeFence.length
        ) {
          flushCode();
          continue;
        }
        codeLines.push(line);
        continue;
      }

      const openingFence = line.match(/^ {0,3}(`{3,}|~{3,})\s*([^\s`~]*)?.*$/);
      if (openingFence) {
        flushParagraph();
        flushList();
        codeFence = {
          character: openingFence[1][0],
          length: openingFence[1].length,
          language: openingFence[2] || "plain",
        };
        codeLines = [];
        continue;
      }

      const headingMatch = line.match(/^ {0,3}(#{1,6})[ \t]+(.+?)\s*$/);
      if (headingMatch) {
        flushParagraph();
        flushList();
        appendHeading(headingMatch[1].length, headingMatch[2]);
        continue;
      }

      const setextMatch = line.match(/^ {0,3}(=+|-+)[ \t]*$/);
      if (setextMatch && paragraphLines.length) {
        const headingText = paragraphLines.join(" ").trim();
        paragraphLines = [];
        flushList();
        appendHeading(setextMatch[1][0] === "=" ? 1 : 2, headingText);
        continue;
      }

      if (/^\s*(?:---+|___+|\*\*\*+)\s*$/.test(line)) {
        flushParagraph();
        flushList();
        content.appendChild(document.createElement("hr"));
        continue;
      }

      const unorderedMatch = line.match(/^\s*[-*+]\s+(.+)$/);
      const orderedMatch = line.match(/^\s*\d+[.)]\s+(.+)$/);
      if (unorderedMatch || orderedMatch) {
        flushParagraph();
        const listType = orderedMatch ? "ol" : "ul";
        if (!activeList || activeListType !== listType) {
          flushList();
          activeList = document.createElement(listType);
          activeListType = listType;
          content.appendChild(activeList);
        }
        const item = document.createElement("li");
        appendMarkdownInline(item, (orderedMatch || unorderedMatch)[1], context, {
          allowImages,
        });
        activeList.appendChild(item);
        continue;
      }

      const quoteMatch = line.match(/^\s*>\s?(.*)$/);
      if (quoteMatch) {
        flushParagraph();
        flushList();
        const quote = document.createElement("blockquote");
        appendMarkdownInline(quote, quoteMatch[1], context, { allowImages });
        content.appendChild(quote);
        continue;
      }

      if (!line.trim()) {
        flushParagraph();
        flushList();
        continue;
      }

      flushList();
      paragraphLines.push(line.trim());
    }

    flushParagraph();
    flushList();
    if (codeFence !== null || codeLines.length) flushCode();
  }

  function renderMarkdownGuide(markdown, context = null) {
    renderMarkdownInto(
      $("projectDocumentationContent"),
      markdown,
      context,
      { indexDocumentationHeadings: true, allowImages: true }
    );
  }



  function normalizeCanvasAnnotations(value) {
    if (!Array.isArray(value)) return [];
    const ids = new Set();
    return value.slice(0, 100).flatMap((annotation) => {
      const id = String(annotation?.id || "");
      if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/.test(id) || ids.has(id)) return [];
      ids.add(id);
      const line = Number(annotation.anchor?.line);
      return [{
        id,
        kind: ["question", "information", "error"].includes(annotation.kind)
          ? annotation.kind : "question",
        anchor: {
          quote: String(annotation.anchor?.quote || ""),
          line: Number.isSafeInteger(line) && line >= 1 ? line : null,
        },
        message: String(annotation.message || ""),
        status: annotation.status === "resolved" ? "resolved" : "open",
        answer: String(annotation.answer || ""),
      }];
    });
  }

  function normalizeProjectInstructionDocument(value) {
    const source = value && typeof value === "object" ? value : {};
    const revision = Number(source.revision);
    const originalMarkdown = typeof source.markdown === "string"
      ? source.markdown : DEFAULT_PROJECT_INSTRUCTION;
    const legacyAnnotations = normalizeCanvasAnnotations(source.annotations);
    const locale = projectFormat.isLocaleTag(source.locale) && source.locale.toLowerCase() !== "und" ? source.locale : "";
    const markdown = migrateCanvasAnnotationsToMarkdown(originalMarkdown, legacyAnnotations, locale);
    return {
      schemaVersion: 2,
      revision: Number.isSafeInteger(revision) && revision >= 0 ? revision : 0,
      markdown,
      locale,
      annotations: [],
      ...(source.target && typeof source.target === "object" ? { target: {
        mcu: String(source.target.mcu || "").toLowerCase(),
        packageName: String(source.target.packageName || ""),
      } } : {}),
      authorship: legacyAnnotations.length
        ? mergeMarkdownAuthorshipForReplacement(originalMarkdown, markdown, source.authorship, "ai")
        : normalizeMarkdownAuthorship(source.authorship, markdown),
    };
  }

  function migrateCanvasAnnotationsToMarkdown(markdown, annotations, locale = "") {
    if (!annotations.length) return markdown;
    const labels = projectFormat.remarkLabels(locale || projectFormat.inferLocale(projectFormat.specificationText(markdown), "en"));
    let number = Math.max(0, ...Array.from(markdown.matchAll(/\[(?:AI|\u0418\u0418)\.(\d+)\]/g), match => Number(match[1])));
    const insertions = new Map();
    for (const annotation of annotations) {
      number += 1;
      const type = annotation.kind === "error" ? labels.error : annotation.kind === "information" ? labels.information : labels.question;
      const block = [`> ###### *[${labels.prefix}.${number}] ${type}.*`, ">",
        ...annotation.message.split("\n").map(line => "> " + line),
        ...(annotation.answer ? [">", "> > **" + labels.user + ":** " + annotation.answer.replace(/\n/g, "\n> > ")] : []),
        ...(annotation.status === "resolved" ? [">", "> " + labels.resolved] : []),
      ].join("\n");
      const line = resolveCanvasAnnotationLine(annotation, markdown);
      const lines = markdown.split("\n");
      let after = line === null ? lines.length - 1 : line;
      while (after + 1 < lines.length && lines[after + 1].trim()) after += 1;
      const entries = insertions.get(after) || [];
      entries.push(block);
      insertions.set(after, entries);
    }
    return markdown.split("\n").map((line, index) => line +
      (insertions.has(index) ? "\n\n" + insertions.get(index).join("\n\n") + "\n" : "")).join("\n");
  }

  function parseStoredProjectInstruction(rawValue) {
    const parsed = JSON.parse(rawValue);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      ![1, 2].includes(parsed.schemaVersion) ||
      !Number.isSafeInteger(parsed.revision) ||
      parsed.revision < 0 ||
      typeof parsed.markdown !== "string"
    ) {
      throw new TypeError("Invalid stored project instruction.");
    }
    return normalizeProjectInstructionDocument(parsed);
  }

  function getProjectInstructionSnapshot() {
    return normalizeProjectInstructionDocument(projectInstructionDocument);
  }

  function getUnassignedProjectInstructionSnapshot() {
    return normalizeProjectInstructionDocument(
      unassignedProjectInstructionDocument || projectInstructionDocument
    );
  }

  function activateCurrentProjectCanvas({ savePrevious = true, legacyFallback = false } = {}) {
    const linkedProject = getMiniProjectForFile(current);
    const nextInstanceId = linkedProject?.instanceId || null;
    if (savePrevious && nextInstanceId === projectInstructionInstanceId) return;
    if (savePrevious) persistProjectInstruction({ immediate: true });
    projectInstructionInstanceId = nextInstanceId;
    projectInstructionScopeEpoch += 1;
    projectInstructionDocument = normalizeProjectInstructionDocument(
      linkedProject
        ? linkedProject.project.canvas || (legacyFallback
          ? getUnassignedProjectInstructionSnapshot() : null)
        : getUnassignedProjectInstructionSnapshot()
    );
    setProjectInstructionEditorValue(projectInstructionDocument.markdown);
    projectInstructionEditor?.clearHistory?.();
    scheduleProjectInstructionPreview();
    syncCanvasTargetControls(true);
    reportProjectCanvasMessage("", "");
    refreshProjectInstructionSaveState();
  }

  function reportProjectCanvasMessage(kind, message) {
    const status = $("projectCanvasStatus");
    if (!status) return;
    status.textContent = String(message || "");
    status.hidden = !status.textContent;
    status.classList.toggle("is-error", kind === "system");
  }

  function getCanvasTarget() {
    const select = $("mcuSelect");
    let mcu = String(select?.value || projectInstructionDocument.target?.mcu || "");
    if (mcu === "auto") {
      const bridge = window[AVR_UPDI_BRIDGE_KEY] || window[LEGACY_UPDI_BRIDGE_KEY];
      mcu = String(bridge?.getDetectedTargetKey?.() || "");
    }
    return {
      mcu,
      packageName: String($("projectPackageSelect")?.value || ""),
    };
  }

  function syncCanvasTargetControls(restore = false) {
    const select = $("projectPackageSelect");
    if (!select) return;
    const mcuSelect = $("mcuSelect");
    const savedTarget = projectInstructionDocument.target;
    if (restore && mcuSelect) {
      const savedMcu = String(savedTarget?.mcu || "auto").toLowerCase();
      mcuSelect.value = [...mcuSelect.options].some((option) => option.value === savedMcu)
        ? savedMcu : "auto";
      const custom = mcuSelect.nextElementSibling;
      if (custom?.classList.contains("custom-select")) updateCustomSelect(mcuSelect, custom);
    }
    const target = getCanvasTarget();
    const device = canvasSupportedDevices.find((item) => item.mcu === target.mcu);
    const selectedPackage = restore
      ? (savedTarget?.mcu === target.mcu ? savedTarget.packageName : "") : select.value;
    const previousMcu = select.dataset.mcu;
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = !target.mcu
      ? "Choose package"
      : device
        ? "Choose package"
        : "Package unavailable";
    select.replaceChildren(placeholder);
    for (const packageName of device?.packages || []) {
      const option = document.createElement("option");
      option.value = packageName;
      option.textContent = packageName;
      select.appendChild(option);
    }
    if ((restore || !previousMcu || previousMcu === target.mcu) && device?.packages.includes(selectedPackage)) {
      select.value = selectedPackage;
    }
    select.dataset.mcu = target.mcu;
    select.disabled = !device;
  }

  function saveCanvasTarget() {
    const target = getCanvasTarget();
    const previous = projectInstructionDocument.target;
    if (previous?.mcu === target.mcu && previous?.packageName === target.packageName) return;
    projectInstructionDocument = { ...projectInstructionDocument, target,
      revision: projectInstructionDocument.revision + 1 };
    persistProjectInstruction({ recover: true });
  }

  function bindCanvasTargetControls() {
    setProjectAiFormBusy(false);
    $("mcuSelect")?.addEventListener("change", () => {
      syncCanvasTargetControls();
      saveCanvasTarget();
    });
    $("projectPackageSelect")?.addEventListener("change", saveCanvasTarget);
    // Knowledge availability is separate from account/credit availability.
    void fetch("/api/avr/ai/status", { headers: { Accept: "application/json" }, credentials: "same-origin" })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("Knowledge is unavailable")))
      .then((status) => {
        canvasSupportedDevices = (status.knowledge?.devices || []).filter((device) =>
          typeof device?.mcu === "string" && Array.isArray(device.packages))
          .map((device) => ({ ...device, mcu: device.mcu.toLowerCase() }));
        syncCanvasTargetControls(true);
        if (!canvasSupportedDevices.length) {
          reportProjectCanvasMessage("system", "The AVR knowledge pack is unavailable. Your canvas remains saved.");
        }
      })
      .catch(() => {
        syncCanvasTargetControls();
        reportProjectCanvasMessage("system", "AI is unavailable. You can keep editing the canvas.");
      });
    syncCanvasTargetControls();
  }

  function resolveCanvasAnnotationLine(annotation, markdown) {
    const quote = String(annotation.anchor?.quote || "");
    const preferred = Number(annotation.anchor?.line) - 1;
    const lines = markdown.split("\n");
    const preferredOffset = quote && preferred >= 0
      ? lines.slice(preferred).join("\n").indexOf(quote) : -1;
    if (preferredOffset >= 0 && preferredOffset < (lines[preferred]?.length || 0)) return preferred;
    const offset = quote ? markdown.indexOf(quote) : -1;
    return offset >= 0 ? markdown.slice(0, offset).split("\n").length - 1 : null;
  }

  function setProjectInstructionSaveState(message = "", { error = false } = {}) {
    const saveState = $("projectInstructionSaveState");
    if (!saveState) return;
    const visibleMessage = String(message || "").trim();
    saveState.textContent = visibleMessage;
    saveState.hidden = !visibleMessage;
    saveState.classList.toggle("is-error", error && !!visibleMessage);
  }

  function refreshProjectInstructionSaveState() {
    if (projectInstructionStorageReadFailed) {
      setProjectInstructionSaveState("Stored instruction is unreadable", { error: true });
      return;
    }
    const failures = [...projectInstructionSaveJobs.values()].filter((job) => job.attempts > 0);
    setProjectInstructionSaveState(failures.length
      ? failures.some((job) => job.timer) ? "Save failed — retrying" : "Save failed"
      : "", { error: failures.length > 0 });
  }

  function cancelProjectInstructionSave(scope) {
    const job = projectInstructionSaveJobs.get(scope);
    if (job?.timer) window.clearTimeout(job.timer);
    projectInstructionSaveJobs.delete(scope);
  }

  function restoreProjectInstruction() {
    try {
      const stored = window.localStorage.getItem(STORAGE_PROJECT_INSTRUCTION);
      if (stored !== null) {
        projectInstructionDocument = parseStoredProjectInstruction(stored);
      } else {
        const legacyStored = window.localStorage.getItem(
          STORAGE_PROJECT_INSTRUCTION_LEGACY
        );
        if (legacyStored !== null) {
          const legacyDocument = parseStoredProjectInstruction(legacyStored);
          projectInstructionDocument = legacyDocument;
          try {
            window.localStorage.setItem(
              STORAGE_PROJECT_INSTRUCTION,
              JSON.stringify(projectInstructionDocument)
            );
          } catch {
            console.warn(
              "The migrated project instruction could not be saved locally."
            );
          }
        }
      }
      projectInstructionStorageReadFailed = false;
    } catch {
      projectInstructionDocument = normalizeProjectInstructionDocument(null);
      projectInstructionStorageReadFailed = true;
      setProjectInstructionSaveState("Stored instruction is unreadable", {
        error: true,
      });
      console.warn("The stored project instruction could not be read.");
    }
    unassignedProjectInstructionDocument = getProjectInstructionSnapshot();
    // Only the formerly active project inherits the old shared canvas. New
    // projects always have an explicit, empty canvas of their own.
    const linkedProject = getMiniProjectForFile(current);
    if (linkedProject && !linkedProject.project.canvas && !projectInstructionStorageReadFailed) {
      linkedProject.project.canvas = getProjectInstructionSnapshot();
    }
    activateCurrentProjectCanvas({ savePrevious: false, legacyFallback: true });
  }

  function persistProjectInstruction(
    { immediate = false, recover = false } = {}
  ) {
    if (projectInstructionStorageReadFailed && !recover && !projectInstructionInstanceId) {
      setProjectInstructionSaveState("Stored instruction is unreadable", {
        error: true,
      });
      return;
    }
    if (recover && !projectInstructionInstanceId) {
      projectInstructionStorageReadFailed = false;
    }
    const scope = projectInstructionInstanceId;
    cancelProjectInstructionSave(scope);
    const job = { attempts: 0, timer: null };
    projectInstructionSaveJobs.set(scope, job);
    const project = projectInstructionInstanceId
      ? miniProjects[projectInstructionInstanceId] : null;
    if (project) project.canvas = getProjectInstructionSnapshot();
    else if (!projectInstructionInstanceId) {
      unassignedProjectInstructionDocument = getProjectInstructionSnapshot();
    }
    if (projectAiBootComplete && !projectAiAccountWorkspaceApplying) {
      markProjectAiAccountDocumentDirty(project ? "files" : "instruction");
    }

    const save = () => {
      job.timer = null;
      try {
        if (project) persistState({ throwOnError: true });
        else window.localStorage.setItem(
          STORAGE_PROJECT_INSTRUCTION,
          JSON.stringify(getUnassignedProjectInstructionSnapshot())
        );
      } catch {
        job.attempts += 1;
        const retrying = job.attempts < 3;
        console.warn("The project instruction could not be saved locally.");
        if (retrying) {
          job.timer = window.setTimeout(save, 600 * job.attempts);
        }
        refreshProjectInstructionSaveState();
        return;
      }
      projectInstructionSaveJobs.delete(scope);
      refreshProjectInstructionSaveState();
    };

    if (immediate) save();
    else job.timer = window.setTimeout(save, 240);
  }

  function walkMarkdownAst(node, visitor, parent = null) {
    if (!node || typeof node !== "object") return;
    if (visitor(node, parent) === false) return;
    for (const child of Array.isArray(node.children) ? node.children : []) {
      walkMarkdownAst(child, visitor, node);
    }
  }

  function getMarkdownAstText(node) {
    if (!node || typeof node !== "object") return "";
    if (["image", "imageReference"].includes(node.type)) {
      return String(node.alt || "");
    }
    if (Object.prototype.hasOwnProperty.call(node, "value")) {
      return String(node.value || "");
    }
    return (Array.isArray(node.children) ? node.children : [])
      .map(getMarkdownAstText)
      .join("");
  }

  function markdownPositionToCodeMirror(position, edge = "start") {
    const point = position?.[edge];
    if (!point) return null;
    return CodeMirror.Pos(
      Math.max(0, Number(point.line || 1) - 1),
      Math.max(0, Number(point.column || 1) - 1)
    );
  }

  function registerMarkdownLiveEditor(id, codeMirror, options = {}) {
    if (!id || !codeMirror) return null;
    const previous = markdownLiveEditors.get(id);
    if (previous?.frame != null) {
      window.cancelAnimationFrame(previous.frame);
    }
    if (previous) clearMarkdownLiveDecorations(previous);
    const state = {
      id,
      editor: codeMirror,
      frame: null,
      marks: [],
      widgets: [],
      lineClasses: [],
      compositionActive: false,
      renderCache: null,
      renderSequence: 0,
      getAuthorship:
        typeof options.getAuthorship === "function"
          ? options.getAuthorship
          : () => null,
      getContextKey:
        typeof options.getContextKey === "function"
          ? options.getContextKey
          : () => "",
      onHeadings:
        typeof options.onHeadings === "function" ? options.onHeadings : null,
      isMarkdown:
        typeof options.isMarkdown === "function"
          ? options.isMarkdown
          : () => true,
      resolveImageUrl:
        typeof options.resolveImageUrl === "function"
          ? options.resolveImageUrl
          : () => "",
      resolveLinkUrl:
        typeof options.resolveLinkUrl === "function"
          ? options.resolveLinkUrl
          : resolveSafeDocumentationLinkUrl,
    };
    markdownLiveEditors.set(id, state);
    codeMirror.on?.("focus", () => scheduleMarkdownLivePreview(id));
    codeMirror.on?.("blur", () =>
      window.setTimeout(() => scheduleMarkdownLivePreview(id), 0)
    );
    scheduleMarkdownLivePreview(id);
    return state;
  }

  function clearMarkdownLiveDecorations(state) {
    if (!state?.editor) return;
    for (const widget of state.widgets) {
      try {
        widget.clear();
      } catch {}
    }
    state.widgets = [];
    for (const marker of state.marks) {
      try {
        marker.clear();
      } catch {}
    }
    state.marks = [];
    for (const { line, where, className } of state.lineClasses) {
      try {
        state.editor.removeLineClass(line, where, className);
      } catch {}
    }
    state.lineClasses = [];
  }

  function addMarkdownLiveMark(state, from, to, options = {}) {
    if (!from || !to || (from.line === to.line && from.ch >= to.ch)) {
      return null;
    }
    const marker = state.editor.markText(from, to, {
      clearOnEnter: true,
      ...options,
    });
    state.marks.push(marker);
    return marker;
  }

  function addMarkdownLiveLineClass(state, line, where, className) {
    const lineHandle = state.editor.getLineHandle(line);
    if (!lineHandle) return;
    state.editor.addLineClass(lineHandle, where, className);
    state.lineClasses.push({ line: lineHandle, where, className });
  }

  function getMarkdownEditorActiveLines(codeMirror) {
    const activeLines = new Set();
    if (
      typeof codeMirror?.hasFocus === "function" &&
      !codeMirror.hasFocus()
    ) {
      return activeLines;
    }
    for (const selection of codeMirror.listSelections()) {
      const from = Math.min(selection.anchor.line, selection.head.line);
      const to = Math.max(selection.anchor.line, selection.head.line);
      for (let line = from; line <= to; line += 1) activeLines.add(line);
    }
    return activeLines;
  }

  function getMarkdownNodeOffsets(node) {
    const start = Number(node?.position?.start?.offset);
    const end = Number(node?.position?.end?.offset);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start) {
      return null;
    }
    return { start, end };
  }

  function captureMarkdownLiveScrollAnchor(codeMirror) {
    if (
      typeof codeMirror?.getScrollInfo !== "function" ||
      typeof codeMirror?.lineAtHeight !== "function" ||
      typeof codeMirror?.heightAtLine !== "function"
    ) {
      return null;
    }
    const scroll = codeMirror.getScrollInfo();
    const top = Math.max(0, Number(scroll?.top || 0));
    const line = Math.max(0, codeMirror.lineAtHeight(top, "local"));
    const lineTop = Number(codeMirror.heightAtLine(line, "local", true) || 0);
    return {
      line,
      offset: top - lineTop,
      left: Math.max(0, Number(scroll?.left || 0)),
    };
  }

  function restoreMarkdownLiveScrollAnchor(codeMirror, anchor) {
    if (!anchor || typeof codeMirror?.scrollTo !== "function") return;
    const line = Math.min(
      Math.max(0, Number(anchor.line || 0)),
      Math.max(0, codeMirror.lineCount() - 1)
    );
    const lineTop = Number(codeMirror.heightAtLine(line, "local", true) || 0);
    codeMirror.scrollTo(anchor.left, Math.max(0, lineTop + anchor.offset));
  }

  function markdownLiveRangeKey(start, end) {
    return `${Number(start)}:${Number(end)}`;
  }

  function createMarkdownLiveRenderIndex(container) {
    const elementsByRange = new Map();
    const targetOffsets = new Map();
    if (!container) return { elementsByRange, targetOffsets };

    for (const element of container.querySelectorAll(
      "[data-source-start][data-source-end]"
    )) {
      const start = Number(element.getAttribute("data-source-start"));
      const end = Number(element.getAttribute("data-source-end"));
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) continue;
      const key = markdownLiveRangeKey(start, end);
      const entries = elementsByRange.get(key) || [];
      entries.push(element);
      elementsByRange.set(key, entries);
    }

    for (const element of container.querySelectorAll("[id]")) {
      const owner = element.closest("[data-source-start]");
      const offset = Number(owner?.getAttribute("data-source-start"));
      if (element.id && Number.isSafeInteger(offset)) {
        targetOffsets.set(element.id, offset);
      }
    }
    return { elementsByRange, targetOffsets };
  }

  function getMarkdownLiveRenderCache(state, markdown, markdownRuntime) {
    const contextKey = String(state.getContextKey?.() || "");
    const key = `${contextKey}\u0000${markdown}`;
    if (state.renderCache?.key === key) return state.renderCache;

    const analysis = markdownRuntime.analyze(markdown);
    const rendered = document.createElement("div");
    rendered.className = "project-documentation-content";
    state.renderSequence += 1;
    markdownRuntime.renderInto(rendered, markdown, {
      allowImages: true,
      sourceId: `markdown-live-${state.id}-${state.renderSequence}`,
      resolveLinkUrl: (href, node, context) =>
        state.resolveLinkUrl(href, node, context),
      resolveImageUrl: (href, node, context) =>
        state.resolveImageUrl(href, node, context),
    });
    const index = createMarkdownLiveRenderIndex(rendered);
    state.renderCache = { key, analysis, rendered, ...index };
    return state.renderCache;
  }

  function getMarkdownLiveRenderedElement(cache, node, selector) {
    const offsets = getMarkdownNodeOffsets(node);
    if (!offsets) return null;
    const entries =
      cache?.elementsByRange?.get(
        markdownLiveRangeKey(offsets.start, offsets.end)
      ) || [];
    return entries.find((element) => element.matches(selector)) || null;
  }

  function getMarkdownLiveNavigationOffset(event, cache, fallbackOffset) {
    const target =
      event?.target && typeof event.target.closest === "function"
        ? event.target
        : null;
    const hashLink = target?.closest?.('a[href^="#"]');
    if (hashLink) {
      const targetId = String(hashLink.getAttribute("href") || "").slice(1);
      const linkedOffset = cache?.targetOffsets?.get(targetId);
      if (Number.isSafeInteger(linkedOffset)) return linkedOffset;
    }
    const sourceElement = target?.closest?.("[data-source-start]");
    const sourceOffset = Number(
      sourceElement?.getAttribute("data-source-start")
    );
    return Number.isSafeInteger(sourceOffset) ? sourceOffset : fallbackOffset;
  }

  function revealMarkdownLiveSource(state, offset) {
    if (!state?.editor || !Number.isSafeInteger(offset)) return;
    const position = state.editor.posFromIndex(offset);
    state.editor.operation(() => {
      clearMarkdownLiveDecorations(state);
      state.editor.setCursor(position);
    });
    state.editor.scrollIntoView({ from: position, to: position }, 48);
    state.editor.focus();
    scheduleMarkdownLivePreview(state.id);
  }

  function bindMarkdownLiveSourceReveal(
    state,
    element,
    fallbackOffset,
    cache
  ) {
    if (!element) return;
    const navigate = (event) => {
      event.preventDefault();
      event.stopPropagation();
      revealMarkdownLiveSource(
        state,
        getMarkdownLiveNavigationOffset(event, cache, fallbackOffset)
      );
    };
    element.addEventListener("pointerdown", navigate);
    element.addEventListener("click", (event) => {
      if (Number(event.detail) > 0) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      navigate(event);
    });
    if (!element.querySelector?.("a[href]")) {
      element.tabIndex = 0;
      element.setAttribute("aria-label", "Edit Markdown source");
      element.addEventListener("keydown", (event) => {
        if (!["Enter", " "].includes(event.key)) return;
        navigate(event);
      });
    }
  }

  function observeMarkdownLiveMediaSize(
    state,
    root,
    decoration,
    collectionName
  ) {
    if (!root || !decoration || typeof decoration.changed !== "function") return;
    const images = [
      ...(root.matches?.("img") ? [root] : []),
      ...(root.querySelectorAll?.("img") || []),
    ];
    const refreshSize = () => {
      if (!state[collectionName]?.includes(decoration)) return;
      const anchor = captureMarkdownLiveScrollAnchor(state.editor);
      decoration.changed();
      restoreMarkdownLiveScrollAnchor(state.editor, anchor);
    };
    for (const image of images) {
      image.addEventListener("load", refreshSize, { once: true });
      image.addEventListener("error", refreshSize, { once: true });
    }
  }

  function addMarkdownLiveBlockWidget(state, node, renderedElement, cache) {
    const offsets = getMarkdownNodeOffsets(node);
    const start = markdownPositionToCodeMirror(node.position, "start");
    const end = markdownPositionToCodeMirror(node.position, "end");
    if (!offsets || !start || !end || !renderedElement) return null;

    const marker = addMarkdownLiveMark(state, start, end, { collapsed: true });
    if (!marker) return null;
    const wrapper = document.createElement("div");
    wrapper.className =
      "markdown-live-block-widget project-documentation-content";
    wrapper.appendChild(renderedElement.cloneNode(true));
    bindMarkdownLiveSourceReveal(state, wrapper, offsets.start, cache);
    const widget = state.editor.addLineWidget(start.line, wrapper, {
      above: true,
      coverGutter: false,
      noHScroll: true,
      showIfHidden: true,
    });
    state.widgets.push(widget);
    observeMarkdownLiveMediaSize(state, wrapper, widget, "widgets");
    return widget;
  }

  function addMarkdownLiveInlineWidget(state, node, renderedElement, cache) {
    const offsets = getMarkdownNodeOffsets(node);
    const start = markdownPositionToCodeMirror(node.position, "start");
    const end = markdownPositionToCodeMirror(node.position, "end");
    if (!offsets || !start || !end || !renderedElement) return null;
    const replacement = renderedElement.cloneNode(true);
    bindMarkdownLiveSourceReveal(state, replacement, offsets.start, cache);
    const marker = addMarkdownLiveMark(state, start, end, {
      replacedWith: replacement,
    });
    observeMarkdownLiveMediaSize(state, replacement, marker, "marks");
    return marker;
  }

  function addMarkdownLiveFootnotesWidget(state, section, cache) {
    if (!section || !state?.editor) return null;
    const wrapper = document.createElement("div");
    wrapper.className =
      "markdown-live-block-widget markdown-live-footnotes-widget project-documentation-content";
    wrapper.appendChild(section.cloneNode(true));
    const firstDefinitionOffset = Number(
      section
        .querySelector('[role="doc-endnote"][data-source-start]')
        ?.getAttribute("data-source-start")
    );
    bindMarkdownLiveSourceReveal(
      state,
      wrapper,
      Number.isSafeInteger(firstDefinitionOffset) ? firstDefinitionOffset : 0,
      cache
    );
    const widget = state.editor.addLineWidget(state.editor.lastLine(), wrapper, {
      above: false,
      coverGutter: false,
      noHScroll: true,
      showIfHidden: true,
    });
    state.widgets.push(widget);
    observeMarkdownLiveMediaSize(state, wrapper, widget, "widgets");
    return widget;
  }

  function renderMarkdownLivePreviewState(state) {
    state.frame = null;
    if (!state.editor || state.compositionActive) return;
    const markdownRuntime = window.UartDebugMarkdown;
    const markdown = state.editor.getValue();
    if (!state.isMarkdown()) {
      state.renderCache = null;
      state.editor.operation(() => {
        clearMarkdownLiveDecorations(state);
      });
      state.onHeadings?.(new Map());
      return;
    }
    if (!markdownRuntime?.analyze || !markdownRuntime?.renderInto) {
      state.renderCache = null;
      state.editor.operation(() => {
        clearMarkdownLiveDecorations(state);
      });
      state.onHeadings?.(new Map());
      return;
    }
    let cache;
    try {
      cache = getMarkdownLiveRenderCache(state, markdown, markdownRuntime);
    } catch (error) {
      state.renderCache = null;
      state.editor.operation(() => {
        clearMarkdownLiveDecorations(state);
      });
      state.onHeadings?.(new Map());
      console.warn("Markdown preview could not be rendered:", error);
      return;
    }
    const tree = cache.analysis.tree;
    const activeLines = getMarkdownEditorActiveLines(state.editor);
    const viewport = state.editor.getViewport();
    const firstVisibleLine = Math.max(0, viewport.from - 40);
    const lastVisibleLine = Math.min(state.editor.lineCount(), viewport.to + 40);
    const headings = new Map();
    const renderedFootnotes = cache.rendered.querySelector(".footnotes");
    const footnoteDefinitionIsActive = (cache.analysis.blocks || []).some(
      (block) =>
        block.type === "footnoteDefinition" &&
        [...activeLines].some(
          (line) => line >= block.startLine - 1 && line <= block.endLine - 1
        )
    );
    const showFootnotes = !!renderedFootnotes && !footnoteDefinitionIsActive;
    const scrollAnchor = captureMarkdownLiveScrollAnchor(state.editor);

    state.editor.operation(() => {
      clearMarkdownLiveDecorations(state);
      for (const activeLine of activeLines) {
        if (activeLine < firstVisibleLine || activeLine >= lastVisibleLine) continue;
        addMarkdownLiveLineClass(
          state,
          activeLine,
          "background",
          "project-instruction-active-line"
        );
      }

      walkMarkdownAst(tree, (node, parent) => {
        const start = markdownPositionToCodeMirror(node.position, "start");
        const end = markdownPositionToCodeMirror(node.position, "end");
        const offsets = getMarkdownNodeOffsets(node);
        if (!start || !end || !offsets) return;
        const inViewport =
          end.line >= firstVisibleLine && start.line < lastVisibleLine;
        const active = [...activeLines].some(
          (line) => line >= start.line && line <= end.line
        );
        const raw = markdown.slice(offsets.start, offsets.end);

        if (
          node.type === "footnoteDefinition" &&
          !footnoteDefinitionIsActive &&
          !active
        ) {
          addMarkdownLiveMark(state, start, end, { collapsed: true });
          return false;
        }

        if (node.type === "definition" && !active) {
          addMarkdownLiveMark(state, start, end, { collapsed: true });
          return false;
        }

        if (node.type === "heading") {
          const headingText = getMarkdownAstText(node).trim();
          const key = miniProjectCore.normalizeHeadingKey(headingText);
          if (key && !headings.has(`${node.depth}:${key}`)) {
            headings.set(`${node.depth}:${key}`, {
              line: start.line,
              ch: start.ch,
              level: node.depth,
              title: headingText,
            });
          }
          if (!inViewport) return;
          addMarkdownLiveLineClass(
            state,
            start.line,
            "text",
            "project-instruction-line-heading"
          );
          addMarkdownLiveLineClass(
            state,
            start.line,
            "text",
            `project-instruction-line-heading-${node.depth}`
          );
          if (!active) {
            const firstChild = node.children?.[0];
            const childStart = markdownPositionToCodeMirror(
              firstChild?.position,
              "start"
            );
            if (childStart && childStart.line === start.line) {
              addMarkdownLiveMark(state, start, childStart, { collapsed: true });
            }
            const lastChild = node.children?.[node.children.length - 1];
            const childEnd = markdownPositionToCodeMirror(
              lastChild?.position,
              "end"
            );
            if (
              childEnd &&
              childEnd.line === end.line &&
              childEnd.ch < end.ch
            ) {
              addMarkdownLiveMark(state, childEnd, end, { collapsed: true });
            }
            if (end.line > start.line) {
              const underline = state.editor.getLine(end.line) || "";
              addMarkdownLiveMark(
                state,
                CodeMirror.Pos(end.line, 0),
                CodeMirror.Pos(end.line, underline.length),
                { collapsed: true }
              );
            }
          }
          return;
        }

        if (!inViewport) return;

        if (node.type === "table" && !active) {
          const table = getMarkdownLiveRenderedElement(cache, node, "table");
          if (table && addMarkdownLiveBlockWidget(state, node, table, cache)) {
            return false;
          }
        }

        if (node.type === "blockquote") {
          for (let line = start.line; line <= end.line; line += 1) {
            addMarkdownLiveLineClass(
              state,
              line,
              "text",
              "project-instruction-line-quote"
            );
            if (!active) {
              const text = state.editor.getLine(line) || "";
              const prefix = text.match(/^\s{0,3}(?:>[ \t]?)+/)?.[0] || "";
              if (prefix) {
                addMarkdownLiveMark(
                  state,
                  CodeMirror.Pos(line, 0),
                  CodeMirror.Pos(line, prefix.length),
                  { collapsed: true }
                );
              }
            }
          }
          return;
        }

        if (node.type === "code") {
          for (let line = start.line; line <= end.line; line += 1) {
            addMarkdownLiveLineClass(
              state,
              line,
              "text",
              "project-instruction-line-code"
            );
          }
          if (!active && /^\s{0,3}(`{3,}|~{3,})/.test(raw)) {
            const first = state.editor.getLine(start.line) || "";
            const last = state.editor.getLine(end.line) || "";
            addMarkdownLiveMark(
              state,
              CodeMirror.Pos(start.line, 0),
              CodeMirror.Pos(start.line, first.length),
              { collapsed: true }
            );
            if (end.line > start.line) {
              addMarkdownLiveMark(
                state,
                CodeMirror.Pos(end.line, 0),
                CodeMirror.Pos(end.line, last.length),
                { collapsed: true }
              );
            }
          }
          return;
        }

        if (node.type === "thematicBreak") {
          addMarkdownLiveLineClass(
            state,
            start.line,
            "text",
            "project-instruction-line-rule"
          );
          if (!active) addMarkdownLiveMark(state, start, end, { collapsed: true });
          return;
        }

        if (node.type === "tableRow") {
          addMarkdownLiveLineClass(
            state,
            start.line,
            "text",
            "markdown-live-table-row"
          );
        }

        if (node.type === "listItem" && !active) {
          const line = state.editor.getLine(start.line) || "";
          const task = line.match(/^(\s*)([-+*]|\d{1,9}[.)])\s+\[([ xX])\]\s+/);
          const marker = line.match(/^(\s*)([-+*]|\d{1,9}[.)])\s+/);
          if (task) {
            const checkboxStart = line.indexOf("[", task[1].length);
            const replacement = document.createElement("span");
            const checked = task[3].toLowerCase() === "x";
            replacement.className = `project-instruction-task-marker${
              checked ? " is-checked" : ""
            }`;
            replacement.textContent = checked ? "✓" : "";
            replacement.setAttribute("aria-hidden", "true");
            addMarkdownLiveMark(
              state,
              CodeMirror.Pos(start.line, checkboxStart),
              CodeMirror.Pos(start.line, checkboxStart + 3),
              { replacedWith: replacement }
            );
          } else if (marker && /^[-+*]$/.test(marker[2])) {
            const replacement = document.createElement("span");
            replacement.className = "project-instruction-list-marker";
            replacement.textContent = "•";
            addMarkdownLiveMark(
              state,
              CodeMirror.Pos(start.line, marker[1].length),
              CodeMirror.Pos(start.line, marker[0].length),
              { replacedWith: replacement }
            );
          } else if (marker) {
            addMarkdownLiveMark(
              state,
              CodeMirror.Pos(start.line, marker[1].length),
              CodeMirror.Pos(start.line, marker[1].length + marker[2].length),
              { className: "project-instruction-ordered-marker" }
            );
          }
          return;
        }

        if (["image", "imageReference"].includes(node.type) && !active) {
          const renderedImage = getMarkdownLiveRenderedElement(
            cache,
            node,
            "img, .ud-markdown-image-alt"
          );
          if (!renderedImage) return;
          const figure = document.createElement("span");
          figure.className = renderedImage.matches("img")
            ? "markdown-live-image"
            : "markdown-live-image-fallback";
          figure.appendChild(renderedImage.cloneNode(true));
          if (addMarkdownLiveInlineWidget(state, node, figure, cache)) {
            return false;
          }
          return;
        }

        if (node.type === "footnoteReference" && showFootnotes && !active) {
          const renderedReference = getMarkdownLiveRenderedElement(
            cache,
            node,
            "sup.footnote-ref"
          );
          if (
            renderedReference &&
            addMarkdownLiveInlineWidget(
              state,
              node,
              renderedReference,
              cache
            )
          ) {
            return false;
          }
          return;
        }

        const inlineClass = {
          strong: "project-instruction-live-strong",
          emphasis: "project-instruction-live-emphasis",
          delete: "project-instruction-live-deleted",
          inlineCode: "project-instruction-live-code",
          link: "project-instruction-live-link",
          linkReference: "project-instruction-live-link",
        }[node.type];
        if (!inlineClass || active) return;

        if (node.type === "inlineCode") {
          const delimiter = raw.match(/^`+/)?.[0]?.length || 0;
          if (delimiter && raw.length >= delimiter * 2) {
            const contentFrom = state.editor.posFromIndex(offsets.start + delimiter);
            const contentTo = state.editor.posFromIndex(offsets.end - delimiter);
            addMarkdownLiveMark(state, start, contentFrom, { collapsed: true });
            addMarkdownLiveMark(state, contentFrom, contentTo, {
              className: inlineClass,
            });
            addMarkdownLiveMark(state, contentTo, end, { collapsed: true });
          }
          return;
        }

        const firstChild = node.children?.[0];
        const lastChild = node.children?.[node.children.length - 1];
        const contentFrom = markdownPositionToCodeMirror(
          firstChild?.position,
          "start"
        );
        const contentTo = markdownPositionToCodeMirror(lastChild?.position, "end");
        if (!contentFrom || !contentTo) return;
        addMarkdownLiveMark(state, start, contentFrom, { collapsed: true });
        addMarkdownLiveMark(state, contentFrom, contentTo, {
          className: inlineClass,
        });
        addMarkdownLiveMark(state, contentTo, end, { collapsed: true });
      });

      if (showFootnotes) {
        addMarkdownLiveFootnotesWidget(state, renderedFootnotes, cache);
      }
    });
    restoreMarkdownLiveScrollAnchor(state.editor, scrollAnchor);
    state.onHeadings?.(headings);
  }

  function scheduleMarkdownLivePreview(id) {
    const state = markdownLiveEditors.get(id);
    if (!state || state.compositionActive || state.frame !== null) return;
    state.frame = window.requestAnimationFrame(() =>
      renderMarkdownLivePreviewState(state)
    );
  }

  function setMarkdownLiveComposition(id, active) {
    const state = markdownLiveEditors.get(id);
    if (!state) return;
    state.compositionActive = !!active;
    if (active) {
      if (state.frame !== null) window.cancelAnimationFrame(state.frame);
      state.frame = null;
      clearMarkdownLiveDecorations(state);
    } else {
      scheduleMarkdownLivePreview(id);
    }
  }

  function renderProjectInstructionPreview() {
    projectInstructionRenderFrame = null;
    const unifiedMarkdownState = markdownLiveEditors.get("instruction");
    if (unifiedMarkdownState) {
      renderMarkdownLivePreviewState(unifiedMarkdownState);
      return;
    }

    // Without the shared CommonMark/GFM runtime, keep the Markdown source
    // intact instead of presenting a second, incompatible interpretation.
  }

  function scheduleProjectInstructionPreview() {
    if (markdownLiveEditors.has("instruction")) {
      scheduleMarkdownLivePreview("instruction");
      return;
    }
    if (projectInstructionCompositionActive) return;
    if (projectInstructionRenderFrame !== null) return;
    projectInstructionRenderFrame = window.requestAnimationFrame(
      renderProjectInstructionPreview
    );
  }

  function setProjectInstructionEditorValue(markdown) {
    const nextMarkdown = String(markdown ?? "");
    const editorElement = $("projectInstructionEditor");
    if (!projectInstructionEditor) {
      if (editorElement && editorElement.value !== nextMarkdown) {
        editorElement.value = nextMarkdown;
      }
      return;
    }
    if (projectInstructionEditor.getValue() === nextMarkdown) return;

    projectInstructionEditorSyncing = true;
    try {
      const lastLine = projectInstructionEditor.lastLine();
      const lastCharacter = (projectInstructionEditor.getLine(lastLine) || "")
        .length;
      projectInstructionEditor.replaceRange(
        nextMarkdown,
        CodeMirror.Pos(0, 0),
        CodeMirror.Pos(lastLine, lastCharacter),
        "+setInstruction"
      );
      projectInstructionEditor.save();
    } finally {
      projectInstructionEditorSyncing = false;
    }
    scheduleProjectInstructionPreview();
  }

  function applyProjectInstructionMarkdown(
    markdown,
    { annotations, locale, target, expectedRevision = null, focus = false } = {}
  ) {
    if (typeof markdown !== "string") throw new TypeError("The canvas must be Markdown text.");
    if (expectedRevision !== null && projectInstructionDocument.revision !== expectedRevision) {
      throw new Error("The canvas changed while AI was working. Your newer edits were preserved.");
    }
    const previous = projectInstructionDocument;
    projectInstructionDocument = normalizeProjectInstructionDocument({
      ...previous,
      revision: previous.revision + 1,
      markdown,
      locale: locale === undefined ? previous.locale : locale,
      annotations: annotations === undefined ? previous.annotations : annotations,
      ...(target ? { target } : {}),
      authorship: mergeMarkdownAuthorshipForReplacement(
        previous.markdown, markdown, previous.authorship, "ai"
      ),
    });
    setProjectInstructionEditorValue(projectInstructionDocument.markdown);
    if (target) syncCanvasTargetControls(true);
    scheduleProjectInstructionPreview();
    persistProjectInstruction({ recover: true });
    if (focus) projectInstructionEditor?.focus();
  }

  function updateProjectInstructionFromUser(markdown, authorship) {
    projectInstructionDocument = {
      ...projectInstructionDocument,
      revision: projectInstructionDocument.revision + 1,
      markdown,
      // A manual edit may switch the requirements language. Infer it on the next run.
      locale: "",
      authorship,
    };
  }

  function bindProjectInstructionWorkspace() {
    const editorElement = $("projectInstructionEditor");
    if (
      editorElement &&
      typeof window.CodeMirror?.fromTextArea === "function"
    ) {
      editorElement.value = projectInstructionDocument.markdown;
      projectInstructionEditor = CodeMirror.fromTextArea(editorElement, {
        mode: {
          name: "markdown",
          highlightFormatting: true,
          fencedCodeBlockHighlighting: false,
          strikethrough: true,
          taskLists: true,
          xml: false,
        },
        theme: "material-darker",
        inputStyle: "contenteditable",
        lineNumbers: false,
        lineWrapping: true,
        indentUnit: 2,
        tabSize: 2,
        indentWithTabs: false,
        viewportMargin: 30,
        autofocus: false,
        extraKeys: {
          Tab(cm) {
            cm.replaceSelection("  ", "end", "+input");
          },
        },
      });
      projectInstructionEditor.setSize("100%", "100%");
      registerMarkdownLiveEditor("instruction", projectInstructionEditor, {
        getAuthorship: () => projectInstructionDocument.authorship,
        getContextKey: () => "project-instruction",
        resolveImageUrl: (href) => resolveDocumentationImageUrl(href, null),
      });

      const inputField = projectInstructionEditor.getInputField();
      inputField.setAttribute("aria-label", "Project specification Markdown");
      inputField.setAttribute("aria-multiline", "true");
      inputField.setAttribute("data-tooltip-disabled", "");
      inputField.setAttribute("role", "textbox");
      inputField.setAttribute("spellcheck", "true");
      inputField.addEventListener("compositionstart", () => {
        projectInstructionCompositionActive = true;
        setMarkdownLiveComposition("instruction", true);
        if (projectInstructionRenderFrame !== null) {
          window.cancelAnimationFrame(projectInstructionRenderFrame);
          projectInstructionRenderFrame = null;
        }
      });
      inputField.addEventListener("compositionend", () => {
        projectInstructionCompositionActive = false;
        setMarkdownLiveComposition("instruction", false);
        scheduleProjectInstructionPreview();
      });

      projectInstructionEditor.on("change", (cm, change) => {
        cm.save();
        if (projectInstructionEditorSyncing) return;
        const previousMarkdown = projectInstructionDocument.markdown;
        const markdown = cm.getValue();
        updateProjectInstructionFromUser(markdown,
          updateMarkdownAuthorshipForChange(
            projectInstructionDocument.authorship,
            previousMarkdown,
            change,
            "human"
          )
        );
        scheduleProjectInstructionPreview();
            persistProjectInstruction({ recover: true });
      });
      projectInstructionEditor.on(
        "cursorActivity",
        () => scheduleMarkdownLivePreview("instruction")
      );
      projectInstructionEditor.on(
        "viewportChange",
        () => scheduleMarkdownLivePreview("instruction")
      );
      window.setTimeout(() => {
        projectInstructionEditor?.refresh();
        scheduleProjectInstructionPreview();
      }, 0);
      window.addEventListener("resize", () => {
        projectInstructionEditor?.refresh();
      });
    } else if (editorElement) {
      editorElement.value = projectInstructionDocument.markdown;
      editorElement.addEventListener("input", () => {
        const previousMarkdown = projectInstructionDocument.markdown;
        updateProjectInstructionFromUser(editorElement.value,
          createMarkdownAuthorship(
            editorElement.value,
            previousMarkdown === editorElement.value ? "original" : "human"
          )
        );
            persistProjectInstruction({ recover: true });
      });
    }

    renderProjectInstructionPreview();
    window.UartDebugAvrAiWorkspace = Object.freeze({
      getInstruction: getProjectInstructionSnapshot,
      processCanvas: submitProjectCanvas,
      setInstruction(markdown, options = {}) {
        applyProjectInstructionMarkdown(markdown, options);
        return getProjectInstructionSnapshot();
      },
    });
  }

  function readStoredProjectAiAccountSync() {
    try {
      const parsed = JSON.parse(
        window.localStorage.getItem(STORAGE_PROJECT_AI_ACCOUNT_SYNC) || "null"
      );
      if (!parsed || ![1, 2].includes(parsed.schemaVersion) || !parsed.accountKey) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  function restoreProjectAiLocalDirtyState() {
    try {
      const stored = JSON.parse(
        window.localStorage.getItem(STORAGE_PROJECT_AI_LOCAL_DIRTY) || "null"
      );
      for (const kind of ["files", "instruction"]) {
        projectAiLocalDirty[kind] = stored?.dirty?.[kind] === true;
      }
    } catch {
      projectAiLocalDirty = {
        files: true,
        instruction: true,
      };
    }
  }

  function persistProjectAiLocalDirtyState() {
    try {
      window.localStorage.setItem(
        STORAGE_PROJECT_AI_LOCAL_DIRTY,
        JSON.stringify({
          schemaVersion: 1,
          dirty: projectAiLocalDirty,
          updatedAt: Date.now(),
        })
      );
    } catch (error) {
      console.warn("The local account-sync markers could not be saved:", error);
    }
  }

  function setProjectAiLocalDirty(kind, dirty) {
    if (!["files", "instruction"].includes(kind)) return;
    projectAiLocalDirty[kind] = dirty === true;
    persistProjectAiLocalDirtyState();
  }

  function restoreProjectAiAccountSyncState() {
    const stored = readStoredProjectAiAccountSync();
    if (!stored) return;
    projectAiAccountSync.accountKey = String(stored.accountKey || "");
    for (const kind of ["files", "instruction"]) {
      const revision = Number(stored.revisions?.[kind]);
      projectAiAccountSync.revisions[kind] =
        Number.isSafeInteger(revision) && revision >= 0 ? revision : 0;
      projectAiAccountSync.dirty[kind] = stored.dirty?.[kind] === true;
      projectAiAccountSync.conflicts[kind] =
        stored.conflicts?.[kind] === true;
    }
  }

  function persistProjectAiAccountSyncState() {
    if (!projectAiAccountSync.accountKey) return false;
    try {
      window.localStorage.setItem(
        STORAGE_PROJECT_AI_ACCOUNT_SYNC,
        JSON.stringify({
          schemaVersion: 1,
          accountKey: projectAiAccountSync.accountKey,
          revisions: projectAiAccountSync.revisions,
          dirty: projectAiAccountSync.dirty,
          conflicts: projectAiAccountSync.conflicts,
          updatedAt: Date.now(),
        })
      );
      return true;
    } catch (error) {
      console.warn("The account sync state could not be saved:", error);
      return false;
    }
  }

  function getProjectAiAccountFilesSnapshot() {
    if (editor && current && hasFile(current)) {
      files[current] = editor.getValue();
    }
    for (const fileName of Object.keys(files)) {
      setFileAuthorship(fileName, fileAuthorship[fileName], files[fileName]);
    }
    return {
      schemaVersion: 2,
      files: cloneJsonMetadata(files, {}),
      authorship: cloneJsonMetadata(fileAuthorship, {}),
      fileGroups: cloneJsonMetadata(fileGroups, {}),
      miniProjects: cloneJsonMetadata(miniProjects, {}),
      current: typeof current === "string" ? current : null,
    };
  }

  function normalizeProjectAiAccountFilesSnapshot(rawData) {
    const source = rawData && typeof rawData === "object" ? rawData : {};
    const normalizedFiles = createDictionary(cloneJsonMetadata(source.files, {}));
    const normalizedAuthorship = createDictionary(
      cloneJsonMetadata(source.authorship, {})
    );
    for (const [fileName, content] of Object.entries(normalizedFiles)) {
      normalizedAuthorship[fileName] = normalizeMarkdownAuthorship(
        normalizedAuthorship[fileName],
        content
      );
    }
    return {
      schemaVersion: 2,
      files: normalizedFiles,
      authorship: normalizedAuthorship,
      fileGroups: createDictionary(cloneJsonMetadata(source.fileGroups, {})),
      miniProjects: createDictionary(
        cloneJsonMetadata(source.miniProjects, {})
      ),
      current: typeof source.current === "string" ? source.current : null,
    };
  }

  function getProjectAiAccountDocumentSnapshot(kind) {
    if (kind === "files") return getProjectAiAccountFilesSnapshot();
    if (kind === "instruction") return getUnassignedProjectInstructionSnapshot();
    throw new TypeError(`Unsupported account document: ${kind}`);
  }

  function projectAiAccountDocumentsMatch(kind, remoteData) {
    try {
      const localData = getProjectAiAccountDocumentSnapshot(kind);
      const normalizedRemote =
        kind === "instruction"
            ? normalizeProjectInstructionDocument(remoteData)
            : normalizeProjectAiAccountFilesSnapshot(remoteData);
      return JSON.stringify(localData) === JSON.stringify(normalizedRemote);
    } catch {
      return false;
    }
  }

  function getEmptyProjectAiAccountDocument(kind) {
    if (kind === "files") {
      return {
        schemaVersion: 2,
        files: {},
        authorship: {},
        fileGroups: {},
        miniProjects: {},
        current: null,
      };
    }
    if (kind === "instruction") {
      return normalizeProjectInstructionDocument(null);
    }
    throw new TypeError(`Unsupported account document: ${kind}`);
  }

  function saveProjectAiRecoveryCopy(
    kind,
    data,
    sourceAccountKey = projectAiAccountSync.accountKey
  ) {
    if (kind !== "files" && kind !== "instruction") {
      throw new TypeError(`Unsupported account document: ${kind}`);
    }
    const storageKeyBase =
      kind === "files"
        ? STORAGE_PROJECT_AI_FILES_RECOVERY
        : STORAGE_PROJECT_AI_INSTRUCTION_RECOVERY;
    const recoveryScope =
      String(sourceAccountKey || "browser-local")
        .replace(/[^A-Za-z0-9_-]/g, "")
        .slice(0, 128) || "browser-local";
    const storageKey = `${storageKeyBase}:${recoveryScope}`;
    try {
      window.localStorage.setItem(
        storageKey,
        JSON.stringify({
          schemaVersion: 1,
          sourceAccountKey: recoveryScope,
          savedAt: Date.now(),
          data,
        })
      );
      const scopedCopies = [];
      for (let index = 0; index < window.localStorage.length; index += 1) {
        const candidateKey = window.localStorage.key(index);
        if (!candidateKey?.startsWith(`${storageKeyBase}:`)) continue;
        let savedAt = 0;
        try {
          savedAt = Number(
            JSON.parse(window.localStorage.getItem(candidateKey) || "null")
              ?.savedAt
          );
        } catch {}
        scopedCopies.push({
          key: candidateKey,
          savedAt: Number.isFinite(savedAt) ? savedAt : 0,
        });
      }
      scopedCopies
        .sort((left, right) => right.savedAt - left.savedAt)
        .slice(3)
        .forEach(({ key }) => window.localStorage.removeItem(key));
      return true;
    } catch (error) {
      console.warn(`The local ${kind} recovery copy could not be saved:`, error);
      return false;
    }
  }

  function applyProjectAiAccountFilesSnapshot(rawData) {
    if (
      !rawData ||
      rawData.schemaVersion !== 2 ||
      !rawData.files ||
      typeof rawData.files !== "object" ||
      Array.isArray(rawData.files)
    ) {
      throw new TypeError("The saved account file workspace is invalid.");
    }
    const previousWorkspace = {
      files,
      fileAuthorship,
      fileGroups,
      miniProjects,
      current,
    };
    files = createDictionary(cloneJsonMetadata(rawData.files, {}));
    fileAuthorship = createDictionary(
      cloneJsonMetadata(rawData.authorship, {})
    );
    for (const fileName of Object.keys(files)) {
      setFileAuthorship(fileName, fileAuthorship[fileName], files[fileName]);
    }
    fileGroups = createDictionary(cloneJsonMetadata(rawData.fileGroups, {}));
    miniProjects = createDictionary(cloneJsonMetadata(rawData.miniProjects, {}));
    current = typeof rawData.current === "string" ? rawData.current : null;
    normalizeFileGroups();
    normalizeMiniProjectInstances();
    if (current && !hasFile(current)) current = null;
    migrateLooseFilesToProjects();
    if (!current) current = getVisibleWorkspaceFileNames()[0] || null;
    try {
      persistState({ throwOnError: true });
    } catch (error) {
      ({ files, fileAuthorship, fileGroups, miniProjects, current } =
        previousWorkspace);
      console.warn("The cloud AVR workspace could not be saved locally:", error);
      return false;
    }
    if (saveTimer) {
      window.clearTimeout(saveTimer);
      saveTimer = null;
    }
    if (documentationEditSaveTimer) {
      window.clearTimeout(documentationEditSaveTimer);
      documentationEditSaveTimer = null;
    }
    for (const scope of projectInstructionSaveJobs.keys()) {
      if (scope !== null) cancelProjectInstructionSave(scope);
    }
    renderOutliner();
    if (editor) {
      editor.setOption("readOnly", !current ? "nocursor" : false);
      editor.setOption("mode", getEditorModeForFile(current));
      editor.setValue(current ? files[current] || "" : "");
      editor.refresh();
      scheduleMarkdownLivePreview("editor");
    }
    updateEditorFileWatermark(current || "");
    activateCurrentProjectCanvas({ savePrevious: false, legacyFallback: true });
    refreshDocumentationPane();
    scheduleDocumentationMarkerRefresh();
    resetHexArtifact();
    updateCompilePanelState(true);
    return true;
  }

  function applyProjectAiAccountDocument(kind, data) {
    projectAiAccountWorkspaceApplying = true;
    try {
      if (kind === "files") {
        if (!applyProjectAiAccountFilesSnapshot(data)) return false;
      } else if (kind === "instruction") {
        const nextInstruction = normalizeProjectInstructionDocument(data);
        try {
          window.localStorage.setItem(
            STORAGE_PROJECT_INSTRUCTION,
            JSON.stringify(nextInstruction)
          );
        } catch (error) {
          console.warn(
            "The cloud Project instruction could not be saved locally:",
            error
          );
          return false;
        }
        cancelProjectInstructionSave(null);
        projectInstructionStorageReadFailed = false;
        unassignedProjectInstructionDocument = nextInstruction;
        const linkedProject = getMiniProjectForFile(current);
        if (!linkedProject || !linkedProject.project.canvas) {
          activateCurrentProjectCanvas({ savePrevious: false, legacyFallback: true });
        }
      } else {
        return false;
      }
      return true;
    } finally {
      projectAiAccountWorkspaceApplying = false;
    }
  }

  function normalizeProjectAiRemoteDocument(rawDocument) {
    const revision = Number(rawDocument?.revision);
    const updatedAt = Number(rawDocument?.updatedAt);
    return {
      revision:
        Number.isSafeInteger(revision) && revision >= 0 ? revision : 0,
      updatedAt:
        Number.isSafeInteger(updatedAt) && updatedAt >= 0 ? updatedAt : 0,
      data:
        rawDocument && Object.prototype.hasOwnProperty.call(rawDocument, "data")
          ? rawDocument.data
          : null,
    };
  }

  function scheduleProjectAiAccountDocumentSave(kind, delay = 700) {
    if (!projectAiAccountSync.ready || projectAiAccountSync.conflicts[kind]) return;
    const currentTimer = kind === "files" ? projectAiAccountFilesSaveTimer : projectAiAccountInstructionSaveTimer;
    if (currentTimer) window.clearTimeout(currentTimer);
    const timer = window.setTimeout(() => {
      if (kind === "files") projectAiAccountFilesSaveTimer = null;
      else projectAiAccountInstructionSaveTimer = null;
      void saveProjectAiAccountDocument(kind);
    }, delay);
    if (kind === "files") projectAiAccountFilesSaveTimer = timer;
    else projectAiAccountInstructionSaveTimer = timer;
  }

  function markProjectAiAccountDocumentDirty(kind) {
    if (!["files", "instruction"].includes(kind)) return;
    projectAiAccountSync.dirty[kind] = true;
    projectAiAccountSync.mutations[kind] += 1;
    setProjectAiLocalDirty(kind, true);
    persistProjectAiAccountSyncState();
    scheduleProjectAiAccountDocumentSave(kind);
  }

  function getProjectAiAccountConflictMessage(kind) {
    if (kind === "instruction") {
      return "Project instruction changed in another tab or device. The local copy was kept and cloud saving was paused to avoid overwriting it.";
    }
    return "The AVR file workspace changed in another tab or device. The local copy was kept and cloud saving was paused to avoid overwriting it.";
  }

  function getProjectAiAccountSaveFailureMessage(kind, result, status) {
    const label = getProjectAiAccountDocumentLabel(kind);
    const detail = String(result?.message || "").trim();
    return `${label} remain saved locally, but cloud sync was paused${
      detail ? `: ${detail}` : ` after server error ${status}`
    }`;
  }

  async function saveProjectAiAccountDocument(kind) {
    if (
      !projectAiAccountSync.ready ||
      !projectAiAccountSync.dirty[kind] ||
      projectAiAccountSync.saving[kind] ||
      projectAiAccountSync.conflicts[kind]
    ) {
      return;
    }
    const mutation = projectAiAccountSync.mutations[kind];
    const baseRevision = projectAiAccountSync.revisions[kind];
    const data = getProjectAiAccountDocumentSnapshot(kind);
    const workspaceEpoch = projectAiAccountWorkspaceEpoch;
    const accountKey = projectAiAccountSync.accountKey;
    projectAiAccountSync.saving[kind] = true;
    let retryDelay = 0;
    try {
      const response = await fetch(`${PROJECT_AI_ACCOUNT_WORKSPACE_URL}/${kind}`, {
        method: "PUT",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        credentials: "same-origin",
        body: JSON.stringify({
          baseRevision,
          expectedAccountKey: accountKey,
          data,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (
        workspaceEpoch !== projectAiAccountWorkspaceEpoch ||
        accountKey !== projectAiAccountSync.accountKey
      ) {
        return;
      }
      if (
        response.status === 409 &&
        result?.code === "account_workspace_account_mismatch"
      ) {
        reportProjectCanvasMessage(
          "system",
          `The local ${getProjectAiAccountDocumentLabel(kind)} copy remains saved because the Google account changed in another tab. Cloud sync will reconnect to the current account before saving.`
        );
        resetProjectAiAccountWorkspaceRuntime();
        void fetchProjectAiAuthSession().catch((error) => {
          console.warn("Account workspace could not be reconnected:", error);
        });
        return;
      }
      if (response.status === 409) {
        projectAiAccountSync.conflicts[kind] = true;
        persistProjectAiAccountSyncState();
        reportProjectCanvasMessage(
          "system",
          `${getProjectAiAccountConflictMessage(kind)} Reload the page to choose which copy to use.`
        );
        return;
      }
      if (response.status === 401 || response.status === 403) {
        expireProjectAiWorkspaceSession(
          `The local ${getProjectAiAccountDocumentLabel(kind)} copy remains saved. The Google session expired; sign in again to resume cloud sync.`
        );
        return;
      }
      if ([400, 413, 415].includes(response.status)) {
        projectAiAccountSync.dirty[kind] = false;
        persistProjectAiAccountSyncState();
        reportProjectCanvasMessage(
          "system",
          getProjectAiAccountSaveFailureMessage(kind, result, response.status)
        );
        return;
      }
      if (!response.ok || result?.ok !== true) {
        if (response.status === 429) {
          const retryAfter = Number(response.headers.get("Retry-After"));
          if (Number.isFinite(retryAfter) && retryAfter > 0) {
            retryDelay = Math.min(120_000, retryAfter * 1000);
          }
        }
        throw new Error(
          String(result?.message || `Account ${kind} save failed (${response.status}).`)
        );
      }
      const savedDocument = result.document || result[kind] || result;
      const revision = Number(savedDocument?.revision);
      if (!Number.isSafeInteger(revision) || revision <= baseRevision) {
        throw new Error(`Account ${kind} save returned an invalid revision.`);
      }
      projectAiAccountSync.revisions[kind] = revision;
      projectAiAccountSync.dirty[kind] =
        projectAiAccountSync.mutations[kind] !== mutation;
      projectAiAccountSync.retries[kind] = 0;
      if (!projectAiAccountSync.dirty[kind]) {
        setProjectAiLocalDirty(kind, false);
      }
      persistProjectAiAccountSyncState();
    } catch (error) {
      if (
        workspaceEpoch !== projectAiAccountWorkspaceEpoch ||
        accountKey !== projectAiAccountSync.accountKey
      ) {
        return;
      }
      projectAiAccountSync.retries[kind] += 1;
      retryDelay =
        retryDelay ||
        Math.min(
          60_000,
          1800 * 2 ** Math.min(projectAiAccountSync.retries[kind] - 1, 5)
        );
      console.warn(`Account ${kind} sync failed:`, error);
    } finally {
      if (
        workspaceEpoch !== projectAiAccountWorkspaceEpoch ||
        accountKey !== projectAiAccountSync.accountKey
      ) {
        return;
      }
      projectAiAccountSync.saving[kind] = false;
      if (
        projectAiAccountSync.ready &&
        projectAiAccountSync.dirty[kind] &&
        !projectAiAccountSync.conflicts[kind]
      ) {
        scheduleProjectAiAccountDocumentSave(kind, retryDelay || 1800);
      }
    }
  }

  function resetProjectAiAccountWorkspaceRuntime() {
    projectAiAccountWorkspaceEpoch += 1;
    projectAiAccountWorkspacePromise = null;
    projectAiAccountSync.ready = false;
    if (projectAiAccountWorkspaceRetryTimer) {
      window.clearTimeout(projectAiAccountWorkspaceRetryTimer);
      projectAiAccountWorkspaceRetryTimer = null;
    }
    projectAiAccountWorkspaceRetryCount = 0;
    for (const timer of [
      projectAiAccountFilesSaveTimer,
      projectAiAccountInstructionSaveTimer,
    ]) {
      if (timer) window.clearTimeout(timer);
    }
    projectAiAccountFilesSaveTimer = null;
    projectAiAccountInstructionSaveTimer = null;
    for (const kind of ["files", "instruction"]) {
      projectAiAccountSync.saving[kind] = false;
      projectAiAccountSync.retries[kind] = 0;
    }
  }

  function hasMeaningfulProjectAiLocalDocument(kind) {
    if (kind === "files") {
      const snapshot = getProjectAiAccountFilesSnapshot();
      const fileEntries = Object.entries(snapshot.files || {});
      return (
        fileEntries.some(
          ([name, content]) => name !== "main.c" || String(content || "").length > 0
        ) ||
        Object.keys(snapshot.fileGroups || {}).length > 0 ||
        Object.keys(snapshot.miniProjects || {}).length > 0
      );
    }
    if (kind === "instruction") {
      const snapshot = getUnassignedProjectInstructionSnapshot();
      return (
        String(snapshot.markdown || "").trim().length > 0 ||
        (Array.isArray(snapshot.annotations) && snapshot.annotations.length > 0)
      );
    }
    return false;
  }

  function getProjectAiAccountDocumentLabel(kind) {
    if (kind === "instruction") return "Project instruction";
    return "AVR files";
  }

  function expireProjectAiWorkspaceSession(message) {
    projectAiAuthRequestEpoch += 1;
    projectAiAuthSessionPromise = null;
    projectAiLatestQuota = null;
    projectAiQuotaUpdateSequence += 1;
    projectAiAuthSession = {
      mode: "google",
      configured: true,
      authenticated: false,
      quota: null,
    };
    resetProjectAiAccountWorkspaceRuntime();
    renderProjectAiAuthSession(projectAiAuthSession);
    reportProjectCanvasMessage("system", message);
    setProjectAiAccountStatus(message, "error");
  }

  function scheduleProjectAiAccountWorkspaceRetry(error, workspaceEpoch) {
    if (
      workspaceEpoch !== projectAiAccountWorkspaceEpoch ||
      projectAiAuthSession?.authenticated !== true
    ) {
      return;
    }
    projectAiAccountWorkspaceRetryCount += 1;
    const retryAfter = Number(error?.retryAfterSeconds);
    const delay =
      Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(120_000, retryAfter * 1000)
        : Math.min(
            60_000,
            2000 * 2 ** Math.min(projectAiAccountWorkspaceRetryCount - 1, 5)
          );
    if (projectAiAccountWorkspaceRetryTimer) {
      window.clearTimeout(projectAiAccountWorkspaceRetryTimer);
    }
    setProjectAiAccountStatus(
      "Cloud workspace sync is temporarily unavailable. Your local changes are safe; retrying automatically.",
      "error"
    );
    projectAiAccountWorkspaceRetryTimer = window.setTimeout(() => {
      projectAiAccountWorkspaceRetryTimer = null;
      void initializeProjectAiAccountWorkspace().catch(() => {});
    }, delay);
  }

  function pauseProjectAiAccountDocumentForRecoveryFailure(kind) {
    projectAiAccountSync.dirty[kind] = false;
    projectAiAccountSync.conflicts[kind] = true;
    reportProjectCanvasMessage(
      "system",
      `The local ${getProjectAiAccountDocumentLabel(kind)} copy was not replaced because the browser could not safely persist both the local recovery and cloud copies. Free some browser storage and reload to choose again.`
    );
  }

  async function initializeProjectAiAccountWorkspace() {
    if (projectAiAccountSync.ready) return null;
    if (projectAiAccountWorkspacePromise) {
      return projectAiAccountWorkspacePromise;
    }
    const workspaceEpoch = ++projectAiAccountWorkspaceEpoch;
    const mutationsAtStart = { ...projectAiAccountSync.mutations };
    const promise = (async () => {
      const response = await fetch(PROJECT_AI_ACCOUNT_WORKSPACE_URL, {
        method: "GET",
        headers: { Accept: "application/json" },
        credentials: "same-origin",
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result?.ok !== true) {
        const loadError = new Error(
          String(result?.message || `Account workspace could not be loaded (${response.status}).`)
        );
        loadError.httpStatus = response.status;
        loadError.retryAfterSeconds = response.headers.get("Retry-After");
        throw loadError;
      }
      if (
        workspaceEpoch !== projectAiAccountWorkspaceEpoch ||
        projectAiAuthSession?.authenticated !== true
      ) {
        return null;
      }
      const accountKey = String(result.accountKey || "").trim();
      if (!accountKey) throw new Error("Account workspace identity is missing.");
      const stored = readStoredProjectAiAccountSync();
      const sameAccount = stored?.accountKey === accountKey;
      const differentKnownAccount =
        !!stored?.accountKey && stored.accountKey !== accountKey;
      const documents = result.documents || result.workspace || result;
      projectAiAccountSync.accountKey = accountKey;
      const localRecoveryAccountKey =
        String(stored?.accountKey || "").trim() || "browser-local";

      if (!sameAccount) {
        for (const kind of ["files", "instruction"]) {
          projectAiAccountSync.revisions[kind] = 0;
          projectAiAccountSync.dirty[kind] = false;
          projectAiAccountSync.conflicts[kind] = true;
          projectAiAccountSync.retries[kind] = 0;
        }
        if (!persistProjectAiAccountSyncState()) {
          projectAiAccountSync.accountKey = String(stored?.accountKey || "");
          const message =
            "The Google account workspace was not opened because the browser could not safely record the account transition. Local data was not changed. Free some browser storage and reload.";
          reportProjectCanvasMessage("system", message);
          setProjectAiAccountStatus(message, "error");
          return null;
        }
      }

      const remoteDocuments = Object.fromEntries(
        ["files", "instruction"].map((kind) => [
          kind,
          normalizeProjectAiRemoteDocument(documents[kind]),
        ])
      );
      const missingImportCandidates = differentKnownAccount
        ? ["files", "instruction"].filter(
            (kind) =>
              remoteDocuments[kind].revision === 0 &&
              remoteDocuments[kind].data === null &&
              hasMeaningfulProjectAiLocalDocument(kind)
          )
        : [];
      let importMissingFromPreviousAccount = false;
      if (missingImportCandidates.length) {
        importMissingFromPreviousAccount = await showSiteConfirm({
          title: "Different Google account",
          message:
            "This browser still contains local AVR data from another account. Import the local data into this Google account? Choose Start empty to keep it out of the new account; a recovery copy remains in this browser.",
          confirmText: "Import local data",
          cancelText: "Start empty",
        });
        if (workspaceEpoch !== projectAiAccountWorkspaceEpoch) return null;
      }

      const pendingConflicts = [];

      for (const kind of ["files", "instruction"]) {
        const remote = remoteDocuments[kind];
        const storedRevision = sameAccount ? Number(stored.revisions?.[kind]) : 0;
        const mutationChangedDuringRequest =
          projectAiAccountSync.mutations[kind] !== mutationsAtStart[kind];
        const localDirty =
          projectAiLocalDirty[kind] === true ||
          mutationChangedDuringRequest ||
          (sameAccount && stored.dirty?.[kind] === true) ||
          (!stored && hasMeaningfulProjectAiLocalDocument(kind));
        const rememberedConflict =
          sameAccount && stored.conflicts?.[kind] === true;
        projectAiAccountSync.revisions[kind] =
          sameAccount && Number.isSafeInteger(storedRevision)
            ? storedRevision
            : 0;
        projectAiAccountSync.dirty[kind] = false;
        projectAiAccountSync.conflicts[kind] = false;
        projectAiAccountSync.retries[kind] = 0;

        if (remote.revision === 0 || remote.data === null) {
          projectAiAccountSync.revisions[kind] = 0;
          if (rememberedConflict) {
            const label = getProjectAiAccountDocumentLabel(kind);
            const importLocal = await showSiteConfirm({
              title: `Empty cloud workspace: ${label}`,
              message: `The cloud has no ${label} copy, while this browser still has local data from an unresolved account transition. Import the local copy into this account? Choose Start empty to keep the local data out of the account; a recovery copy will be kept.`,
              confirmText: "Import local data",
              cancelText: "Start empty",
            });
            if (workspaceEpoch !== projectAiAccountWorkspaceEpoch) return null;
            if (!importLocal) {
              const recoverySaved = saveProjectAiRecoveryCopy(
                kind,
                getProjectAiAccountDocumentSnapshot(kind),
                localRecoveryAccountKey
              );
              if (!recoverySaved) {
                pauseProjectAiAccountDocumentForRecoveryFailure(kind);
                continue;
              }
              const emptyApplied = applyProjectAiAccountDocument(
                kind,
                getEmptyProjectAiAccountDocument(kind)
              );
              if (!emptyApplied) {
                pauseProjectAiAccountDocumentForRecoveryFailure(kind);
                continue;
              }
            }
            projectAiAccountSync.conflicts[kind] = false;
            projectAiAccountSync.dirty[kind] = true;
            setProjectAiLocalDirty(kind, true);
            continue;
          }
          if (differentKnownAccount && !importMissingFromPreviousAccount) {
            const recoverySaved = saveProjectAiRecoveryCopy(
              kind,
              getProjectAiAccountDocumentSnapshot(kind),
              localRecoveryAccountKey
            );
            if (!recoverySaved) {
              pauseProjectAiAccountDocumentForRecoveryFailure(kind);
              continue;
            }
            const emptyApplied = applyProjectAiAccountDocument(
              kind,
              getEmptyProjectAiAccountDocument(kind)
            );
            if (!emptyApplied) {
              pauseProjectAiAccountDocumentForRecoveryFailure(kind);
              continue;
            }
          }
          projectAiAccountSync.dirty[kind] = true;
          setProjectAiLocalDirty(kind, true);
          continue;
        }

        if (!sameAccount) {
          if (!differentKnownAccount && localDirty) {
            projectAiAccountSync.conflicts[kind] = true;
            pendingConflicts.push({ kind, remote });
            continue;
          }
          if (mutationChangedDuringRequest) {
            projectAiAccountSync.conflicts[kind] = true;
            pendingConflicts.push({ kind, remote });
            continue;
          }
          const recoverySaved = saveProjectAiRecoveryCopy(
            kind,
            getProjectAiAccountDocumentSnapshot(kind),
            localRecoveryAccountKey
          );
          if (!recoverySaved) {
            projectAiAccountSync.conflicts[kind] = true;
            pendingConflicts.push({ kind, remote });
            continue;
          }
          if (!applyProjectAiAccountDocument(kind, remote.data)) {
            pauseProjectAiAccountDocumentForRecoveryFailure(kind);
            continue;
          }
          projectAiAccountSync.revisions[kind] = remote.revision;
          setProjectAiLocalDirty(kind, false);
          continue;
        }

        if (rememberedConflict) {
          projectAiAccountSync.conflicts[kind] = true;
          pendingConflicts.push({ kind, remote });
          continue;
        }
        if (
          Number.isSafeInteger(storedRevision) &&
          storedRevision === remote.revision
        ) {
          if (projectAiAccountDocumentsMatch(kind, remote.data)) {
            projectAiAccountSync.dirty[kind] = false;
            setProjectAiLocalDirty(kind, false);
            continue;
          }
          if (localDirty) {
            projectAiAccountSync.dirty[kind] = true;
            projectAiAccountSync.conflicts[kind] = true;
            pendingConflicts.push({ kind, remote });
            continue;
          }
          const recoverySaved = saveProjectAiRecoveryCopy(
            kind,
            getProjectAiAccountDocumentSnapshot(kind),
            accountKey
          );
          if (!recoverySaved) {
            projectAiAccountSync.conflicts[kind] = true;
            pendingConflicts.push({ kind, remote });
            continue;
          }
          if (!applyProjectAiAccountDocument(kind, remote.data)) {
            pauseProjectAiAccountDocumentForRecoveryFailure(kind);
            continue;
          }
          projectAiAccountSync.dirty[kind] = false;
          setProjectAiLocalDirty(kind, false);
          continue;
        }
        if (localDirty) {
          projectAiAccountSync.dirty[kind] = true;
          projectAiAccountSync.conflicts[kind] = true;
          pendingConflicts.push({ kind, remote });
          continue;
        }

        const recoverySaved = saveProjectAiRecoveryCopy(
          kind,
          getProjectAiAccountDocumentSnapshot(kind),
          accountKey
        );
        if (!recoverySaved) {
          projectAiAccountSync.conflicts[kind] = true;
          pendingConflicts.push({ kind, remote });
          continue;
        }
        if (!applyProjectAiAccountDocument(kind, remote.data)) {
          pauseProjectAiAccountDocumentForRecoveryFailure(kind);
          continue;
        }
        projectAiAccountSync.revisions[kind] = remote.revision;
        setProjectAiLocalDirty(kind, false);
      }

      for (const { kind, remote } of pendingConflicts) {
        const label = getProjectAiAccountDocumentLabel(kind);
        const useCloud = await showSiteConfirm({
          title: `Cloud sync conflict: ${label}`,
          message: `A newer cloud copy exists for ${label}. Load that cloud copy on this device? A local recovery copy will be kept. Choose Pause sync to keep this local version without overwriting the cloud.`,
          confirmText: "Use cloud copy",
          cancelText: "Pause sync",
        });
        if (workspaceEpoch !== projectAiAccountWorkspaceEpoch) return null;
        if (!useCloud) {
          reportProjectCanvasMessage(
            "system",
            `Cloud sync is paused for ${label}. Nothing was overwritten. Reload the page when you are ready to choose again.`
          );
          continue;
        }
        const recoverySaved = saveProjectAiRecoveryCopy(
          kind,
          getProjectAiAccountDocumentSnapshot(kind),
          sameAccount ? accountKey : localRecoveryAccountKey
        );
        if (!recoverySaved) {
          pauseProjectAiAccountDocumentForRecoveryFailure(kind);
          continue;
        }
        if (!applyProjectAiAccountDocument(kind, remote.data)) {
          pauseProjectAiAccountDocumentForRecoveryFailure(kind);
          continue;
        }
        projectAiAccountSync.revisions[kind] = remote.revision;
        projectAiAccountSync.dirty[kind] = false;
        projectAiAccountSync.conflicts[kind] = false;
        setProjectAiLocalDirty(kind, false);
      }

      if (workspaceEpoch !== projectAiAccountWorkspaceEpoch) return null;
      projectAiAccountSync.ready = true;
      if (projectAiAccountWorkspaceRetryTimer) {
        window.clearTimeout(projectAiAccountWorkspaceRetryTimer);
        projectAiAccountWorkspaceRetryTimer = null;
      }
      projectAiAccountWorkspaceRetryCount = 0;
      const pausedKinds = ["files", "instruction"].filter(
        (kind) => projectAiAccountSync.conflicts[kind]
      );
      if (pausedKinds.length) {
        setProjectAiAccountStatus(
          `Cloud sync is paused for ${pausedKinds
            .map(getProjectAiAccountDocumentLabel)
            .join(", ")}. Local data was not overwritten.`,
          "error"
        );
      } else {
        setProjectAiAccountStatus("Account workspace synchronized.", "success");
      }
      persistProjectAiAccountSyncState();
      for (const kind of ["files", "instruction"]) {
        if (projectAiAccountSync.dirty[kind]) {
          scheduleProjectAiAccountDocumentSave(kind, 60);
        }
      }
      return result;
    })();
    projectAiAccountWorkspacePromise = promise;
    try {
      return await promise;
    } catch (error) {
      if (workspaceEpoch === projectAiAccountWorkspaceEpoch) {
        const status = Number(error?.httpStatus);
        if (status === 401 || status === 403) {
          expireProjectAiWorkspaceSession(
            "The Google session expired. Your local changes are safe; sign in again to resume cloud sync."
          );
        } else if (!status || status === 429 || status >= 500) {
          scheduleProjectAiAccountWorkspaceRetry(error, workspaceEpoch);
        } else {
          setProjectAiAccountStatus(
            "Cloud workspace sync is paused because the server rejected the load request. Your local changes are safe.",
            "error"
          );
        }
      }
      throw error;
    } finally {
      if (projectAiAccountWorkspacePromise === promise) {
        projectAiAccountWorkspacePromise = null;
      }
    }
  }

  function appendProjectAiThinking() {
    const status = $("projectCanvasStatus");
    if (!status) return null;
    status.hidden = false;
    status.classList.remove("is-error");
    status.replaceChildren();
    const indicator = document.createElement("div");
    const label = document.createElement("span");
    label.className = "project-ai-thinking-stage";
    label.textContent = "Analyzing the canvas…";
    indicator.appendChild(label);
    status.appendChild(indicator);
    return indicator;
  }

  function removeProjectAiThinking(indicator) {
    if (indicator?._phaseTimer) {
      window.clearInterval(indicator._phaseTimer);
      indicator._phaseTimer = null;
    }
    indicator?.remove();
  }

  function renderProjectAiThinkingProgress(indicator, progress, verification) {
    if (!indicator || !progress || !Array.isArray(progress.stages)) return;
    if (indicator._phaseTimer) {
      window.clearInterval(indicator._phaseTimer);
      indicator._phaseTimer = null;
    }
    if (!(indicator._progressStages instanceof Map)) {
      indicator._progressStages = new Map();
    }
    for (const stage of progress.stages) {
      const id = String(stage?.id || "step");
      const attempt = Number(stage?.attempt);
      const key = `${id}:${Number.isSafeInteger(attempt) ? attempt : 1}`;
      indicator._progressStages.set(key, { ...stage, id });
    }
    const labels = {
      generation: {
        in_progress: "Generating the response",
        completed: "Response generated",
        failed: "Response generation failed",
      },
      compilation: {
        in_progress: "Checking with the AVR compiler",
        completed: "Compiler check passed",
        failed: "Compiler check found a problem",
      },
      repair: {
        in_progress: "Repairing the compiler error",
        completed: "Compiler error repaired",
        failed: "Compiler repair failed",
      },
    };
    let list = indicator.querySelector(".project-ai-progress-stages");
    if (!list) {
      list = document.createElement("ol");
      list.className = "project-ai-progress-stages";
      indicator.appendChild(list);
    }
    list.replaceChildren();
    for (const stage of indicator._progressStages.values()) {
      const item = document.createElement("li");
      const status = String(stage?.status || "completed");
      item.className = `is-${status}`;
      const attempt = Number(stage?.attempt);
      const stageLabels = labels[stage?.id];
      item.textContent = `${
        stageLabels?.[status] || stageLabels?.completed || String(stage?.id || "Step")
      }${
        Number.isSafeInteger(attempt) && attempt > 1
          ? ` · attempt ${attempt}`
          : ""
      }`;
      list.appendChild(item);
    }
    const heading = indicator.querySelector(".project-ai-thinking-stage");
    if (heading) {
      heading.textContent =
        verification?.status === "passed"
          ? `Verified with ${verification.mcu || "the selected MCU"}`
          : progress.status === "failed"
            ? "Project verification failed"
            : progress.status === "completed"
              ? "Response ready"
              : "Working on the project";
    }
    indicator.querySelector(".project-ai-thinking-dots")?.remove();
  }

  async function readProjectAiApiResponse(response, onProgress) {
    const contentType = String(response.headers.get("content-type") || "")
      .split(";", 1)[0]
      .trim()
      .toLowerCase();
    if (contentType !== "application/x-ndjson") {
      return {
        status: response.status,
        data: await response.json().catch(() => ({})),
        streamed: false,
      };
    }
    if (!response.body?.getReader) {
      throw new Error("The streamed AI response is not supported by this browser.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const maximumBytes = 5 * 1024 * 1024;
    let receivedBytes = 0;
    let buffer = "";
    let finalEvent = null;

    const consumeLine = (rawLine) => {
      const line = String(rawLine || "").trim();
      if (!line) return;
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        throw new Error("The AI server returned an invalid progress stream.");
      }
      if (event?.type === "progress" && event.progress) {
        onProgress?.(event.progress);
        return;
      }
      if (event?.type === "result" || event?.type === "error") {
        finalEvent = event;
      }
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      receivedBytes += value?.byteLength || 0;
      if (receivedBytes > maximumBytes) {
        await reader.cancel().catch(() => {});
        throw new Error("The AI server response is too large.");
      }
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        consumeLine(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
      }
    }
    buffer += decoder.decode();
    consumeLine(buffer);
    if (!finalEvent || !finalEvent.data || typeof finalEvent.data !== "object") {
      throw new Error("The AI server closed the progress stream before the result.");
    }
    const streamedStatus = Number(finalEvent.status);
    return {
      status: Number.isSafeInteger(streamedStatus)
        ? streamedStatus
        : response.status,
      data: finalEvent.data,
      streamed: true,
    };
  }

  function renderProjectAiQuota(quota) {
    const budget = $("projectAiBudget");
    const value = $("projectAiBudgetValue");
    const fill = $("projectAiBudgetFill");
    if (!budget || !value || !fill) return;

    if (quota?.unlimited === true) {
      budget.hidden = false;
      budget.classList.remove("is-low", "is-empty");
      budget.setAttribute("role", "status");
      budget.setAttribute("aria-label", "Unlimited AI Credits");
      for (const attribute of ["aria-valuemin", "aria-valuemax", "aria-valuenow", "aria-valuetext"]) {
        budget.removeAttribute(attribute);
      }
      value.textContent = "Unlimited";
      fill.style.width = "100%";
      return;
    }

    budget.setAttribute("role", "progressbar");
    budget.setAttribute("aria-label", "AI Credits remaining");
    budget.setAttribute("aria-valuemin", "0");
    const granted = Number(quota?.granted);
    const remaining = Number(quota?.remaining);
    if (
      !Number.isFinite(granted) ||
      !Number.isFinite(remaining) ||
      granted <= 0
    ) {
      budget.hidden = true;
      budget.classList.remove("is-low", "is-empty");
      fill.style.width = "0%";
      return;
    }

    const safeRemaining = Math.max(0, Math.min(granted, remaining));
    const ratio = safeRemaining / granted;
    const format = new Intl.NumberFormat(undefined, {
      maximumFractionDigits: 2,
    });
    budget.hidden = false;
    budget.classList.toggle("is-low", ratio > 0 && ratio <= 0.2);
    budget.classList.toggle("is-empty", ratio <= 0);
    budget.setAttribute("aria-valuemax", String(granted));
    budget.setAttribute("aria-valuenow", String(safeRemaining));
    budget.setAttribute(
      "aria-valuetext",
      `${format.format(safeRemaining)} of ${format.format(granted)} AI Credits remaining`
    );
    value.textContent = `${format.format(safeRemaining)} / ${format.format(
      granted
    )}`;
    fill.style.width = `${Math.max(0, Math.min(100, ratio * 100))}%`;
  }

  function updateProjectAiQuota(quota) {
    if (!quota || typeof quota !== "object") return;
    projectAiQuotaUpdateSequence += 1;
    projectAiLatestQuota = {
      ...(projectAiLatestQuota || {}),
      ...quota,
      // Each server quota snapshot must explicitly grant unlimited access.
      unlimited: quota.unlimited === true,
    };
    quota = projectAiLatestQuota;
    if (projectAiAuthSession?.mode === "google") {
      projectAiAuthSession = {
        ...projectAiAuthSession,
        quota: {
          ...(projectAiAuthSession.quota || {}),
          ...quota,
        },
      };
      renderProjectAiAuthSession(projectAiAuthSession);
      return;
    }
    renderProjectAiQuota(quota);
  }

  function handleProjectAiAccountAction() {
    if (projectAiAuthSession?.mode === "google" &&
        projectAiAuthSession.configured === true &&
        projectAiAuthSession.authenticated !== true) {
      return handleProjectAiSignIn();
    }
    openProjectAiAccountModal();
  }

  function openProjectAiAccountModal() {
    const modal = $("projectAiAccountModal");
    const trigger = $("projectAiAccountBtn");
    const card = $("projectAiAccountCard");
    if (!modal || !trigger || !card) return;

    trigger.setAttribute("aria-expanded", "true");
    openWorkspaceModal(modal, {
      trigger,
      focusTarget: () => {
        const signIn = $("projectAiSignInBtn");
        return signIn && !signIn.hidden ? signIn : card;
      },
      onClose: closeProjectAiAccountModal,
    });
  }

  function closeProjectAiAccountModal({ restoreFocus = true } = {}) {
    const modal = $("projectAiAccountModal");
    const trigger = $("projectAiAccountBtn");
    if (!modal || !trigger || modal.hidden) return;

    trigger.setAttribute("aria-expanded", "false");
    closeWorkspaceModal(modal, { restoreFocus });
  }

  function setProjectAiAccountStatus(message = "", tone = "info") {
    const status = $("projectAiAccountStatus");
    if (!status) return;
    const normalizedMessage = String(message || "").trim();
    status.textContent = normalizedMessage;
    status.dataset.tone = tone;
    status.hidden = !normalizedMessage;
  }

  function renderProjectAiAuthSession(session) {
    const auth = $("projectAiAuth");
    const accountButton = $("projectAiAccountBtn");
    const signIn = $("projectAiSignInBtn");
    const signedInSession = $("projectAiAuthSession");
    const account = $("projectAiAccount");
    const credits = $("projectAiCredits");
    const unavailable = $("projectAiAuthUnavailable");
    const privacyNote = $("projectAiPrivacyNote");
    const accountLabel = auth?.querySelector(".project-ai-account-trigger-label");
    if (
      !auth ||
      !accountButton ||
      !signIn ||
      !signedInSession ||
      !account ||
      !credits
    ) {
      return;
    }

    const profileForm = $("projectAiProfileForm");
    const nameInput = $("projectAiDisplayName");
    const saveName = $("projectAiProfileSaveBtn");
    const signedIn = session?.mode === "google" && session.configured === true && session.authenticated === true;
    const accountKey = signedIn ? String(session.accountKey || "") : "";
    if (profileForm) profileForm.hidden = !signedIn;
    if (!signedIn || accountKey !== projectAiProfileAccountKey) {
      projectAiProfileNameDirty = false;
      nameInput?.removeAttribute("aria-invalid");
    }
    projectAiProfileAccountKey = accountKey;
    if (nameInput) {
      if (!projectAiProfileNameDirty) nameInput.value = signedIn ? String(session.user?.displayName || "") : "";
      nameInput.disabled = !signedIn || !accountKey || auth.getAttribute("aria-busy") === "true";
    }
    if (saveName) saveName.disabled = !signedIn || !accountKey || !projectAiProfileNameDirty || auth.getAttribute("aria-busy") === "true";

    auth.hidden = true;
    accountButton.classList.remove(
      "is-sign-in-required",
      "is-authenticated",
      "is-unavailable"
    );
    accountButton.setAttribute("aria-label", "Open AI account");
    accountButton.setAttribute("aria-haspopup", "dialog");
    accountButton.setAttribute("aria-controls", "projectAiAccountModal");
    accountButton.setAttribute("aria-expanded", String(!$("projectAiAccountModal")?.hidden));
    accountButton.disabled = auth.getAttribute("aria-busy") === "true";
    if (accountLabel) accountLabel.textContent = "Account";
    signIn.hidden = true;
    signedInSession.hidden = true;
    if (unavailable) unavailable.hidden = true;
    if (privacyNote) privacyNote.hidden = true;
    account.textContent = "";
    credits.textContent = "";
    credits.hidden = true;
    renderProjectAiQuota(null);

    if (session?.mode !== "google") {
      closeProjectAiAccountModal({ restoreFocus: false });
      return;
    }
    auth.hidden = false;
    if (privacyNote) privacyNote.hidden = false;

    if (session.configured !== true) {
      accountButton.classList.add("is-unavailable");
      accountButton.setAttribute("aria-label", "Open AI account: unavailable");
      if (accountLabel) accountLabel.textContent = "AI account unavailable";
      if (unavailable) unavailable.hidden = false;
      return;
    }

    if (session.authenticated !== true) {
      accountButton.classList.add("is-sign-in-required");
      accountButton.setAttribute(
        "aria-label",
        "Continue with Google"
      );
      accountButton.removeAttribute("aria-haspopup");
      accountButton.removeAttribute("aria-controls");
      accountButton.removeAttribute("aria-expanded");
      if (accountLabel) accountLabel.textContent = "Continue with Google";
      signIn.hidden = false;
      return;
    }

    const displayName = String(session.user?.displayName || "").trim() || "Google account";
    account.textContent = String(session.user?.emailMasked || "").trim() || "Google account";
    account.title = account.textContent;
    if (accountLabel) accountLabel.textContent = displayName;
    accountButton.classList.add("is-authenticated");
    accountButton.setAttribute(
      "aria-label",
      `Open AI account: ${displayName}`
    );
    const remaining = Number(session.quota?.remaining);
    renderProjectAiQuota(session.quota);
    if (session.quota?.unlimited === true) {
      credits.textContent = "Unlimited AI Credits";
      credits.title = credits.textContent;
      credits.hidden = false;
    } else if (Number.isFinite(remaining)) {
      const availableCredits = Math.max(0, remaining);
      const formattedCredits = new Intl.NumberFormat(undefined, {
        maximumFractionDigits: 2,
      }).format(availableCredits);
      credits.textContent = `${formattedCredits} AI Credit${
        availableCredits === 1 ? "" : "s"
      } remaining`;
      credits.title = credits.textContent;
      credits.hidden = false;
    }
    signedInSession.hidden = false;
  }

  function setProjectAiAuthPending(pending) {
    const auth = $("projectAiAuth");
    const accountBody = $("projectAiAccountBody");
    const signIn = $("projectAiSignInBtn");
    const signOut = $("projectAiSignOutBtn");
    if (auth) auth.setAttribute("aria-busy", String(!!pending));
    const accountButton = $("projectAiAccountBtn");
    if (accountButton) accountButton.disabled = !!pending;
    if (accountBody) {
      accountBody.setAttribute("aria-busy", String(!!pending));
    }
    if (signIn) signIn.disabled = !!pending;
    if (signOut) signOut.disabled = !!pending;
    const signedIn = projectAiAuthSession?.authenticated === true && !!projectAiProfileAccountKey;
    if ($("projectAiDisplayName")) $("projectAiDisplayName").disabled = !!pending || !signedIn;
    if ($("projectAiProfileSaveBtn")) $("projectAiProfileSaveBtn").disabled = !!pending || !signedIn || !projectAiProfileNameDirty;
  }

  function handleProjectAiProfileNameInput() {
    projectAiProfileNameDirty = true;
    $("projectAiDisplayName")?.removeAttribute("aria-invalid");
    setProjectAiAccountStatus();
    if ($("projectAiProfileSaveBtn")) $("projectAiProfileSaveBtn").disabled = !projectAiProfileAccountKey || $("projectAiAuth")?.getAttribute("aria-busy") === "true";
  }

  async function saveProjectAiProfile(event) {
    event?.preventDefault();
    if (projectAiProfileSavePromise) return projectAiProfileSavePromise;
    const input = $("projectAiDisplayName");
    const expectedAccountKey = projectAiProfileAccountKey;
    if (!input || !expectedAccountKey || projectAiAuthSession?.authenticated !== true ||
        $("projectAiAuth")?.getAttribute("aria-busy") === "true") return false;
    const displayName = input.value.trim().normalize("NFC");
    if (Array.from(displayName).length > 80 || /[\p{Cc}\p{Cs}\p{Zl}\p{Zp}\u061C\u200B\u200E\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/u.test(input.value)) {
      input.setAttribute("aria-invalid", "true");
      setProjectAiAccountStatus("Use a display name of up to 80 characters without control characters.", "error");
      input.focus({ preventScroll: true });
      return false;
    }
    const authEpoch = ++projectAiAuthRequestEpoch;
    let refreshAuth = false;
    projectAiAuthSessionPromise = null;
    setProjectAiAuthPending(true);
    setProjectAiAccountStatus();
    const savePromise = (async () => {
      try {
        const response = await fetch(PROJECT_AI_ACCOUNT_PROFILE_URL, {
          method: "PATCH",
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ displayName, expectedAccountKey }),
        });
        const data = await response.json().catch(() => ({}));
        if (authEpoch !== projectAiAuthRequestEpoch || projectAiAuthSession?.authenticated !== true) return false;
        refreshAuth = response.status === 401 || data?.code === "account_profile_account_mismatch";
        if (!response.ok || data?.ok !== true || data.accountKey !== expectedAccountKey || typeof data.user?.displayName !== "string") {
          throw new Error(String(data?.error?.message || data?.error || data?.message || `Display name could not be saved (${response.status}).`));
        }
        projectAiProfileNameDirty = false;
        input.removeAttribute("aria-invalid");
        projectAiAuthSession = { ...projectAiAuthSession, user: { ...projectAiAuthSession.user, ...data.user } };
        renderProjectAiAuthSession(projectAiAuthSession);
        setProjectAiAccountStatus(displayName ? "Display name saved." : "Google display name restored.", "success");
        return true;
      } catch (error) {
        if (authEpoch === projectAiAuthRequestEpoch) {
          setProjectAiAccountStatus(error?.message || "Display name could not be saved. Try again.", "error");
        }
        return false;
      }
    })();
    projectAiProfileSavePromise = savePromise;
    try { return await savePromise; }
    finally {
      if (projectAiProfileSavePromise === savePromise) {
        projectAiProfileSavePromise = null;
        setProjectAiAuthPending(false);
        if (refreshAuth) await fetchProjectAiAuthSession().catch(() => {});
      }
    }
  }

  async function fetchProjectAiAuthSession() {
    if (projectAiProfileSavePromise) await projectAiProfileSavePromise;
    if (projectAiAuthSessionPromise) return projectAiAuthSessionPromise;

    const quotaSequenceAtRequest = projectAiQuotaUpdateSequence;
    const authRequestEpoch = ++projectAiAuthRequestEpoch;
    const sessionPromise = (async () => {
      const response = await fetch(PROJECT_AI_AUTH_SESSION_URL, {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
        credentials: "same-origin",
      });
      let data = await response.json().catch(() => ({}));
      if (!response.ok || data?.ok !== true) {
        throw new Error(
          String(
            data?.error?.message ||
              data?.error ||
              data?.message ||
              `AI access check failed (${response.status}).`
          )
        );
      }

      if (authRequestEpoch !== projectAiAuthRequestEpoch) {
        return projectAiAuthSession;
      }

      if (
        quotaSequenceAtRequest !== projectAiQuotaUpdateSequence &&
        projectAiLatestQuota
      ) {
        data = { ...data, quota: projectAiLatestQuota };
      } else {
        projectAiLatestQuota =
          data.quota && typeof data.quota === "object" ? data.quota : null;
      }

      projectAiAuthSession = data;
      renderProjectAiAuthSession(data);
      if (data.mode === "google" && data.authenticated === true) {
        void initializeProjectAiAccountWorkspace().catch((error) => {
          console.warn("Account workspace could not be initialized:", error);
        });
      } else {
        resetProjectAiAccountWorkspaceRuntime();
      }
      return data;
    })();
    projectAiAuthSessionPromise = sessionPromise;

    try {
      return await sessionPromise;
    } finally {
      if (projectAiAuthSessionPromise === sessionPromise) {
        projectAiAuthSessionPromise = null;
      }
    }
  }

  function consumeProjectAiAuthReturn() {
    let url;
    try {
      url = new URL(window.location.href);
    } catch {
      return null;
    }
    const status = String(url.searchParams.get("ai_auth") || "");
    if (status !== "success" && status !== "error") return null;
    const code = String(url.searchParams.get("ai_auth_code") || "");
    url.searchParams.delete("ai_auth");
    url.searchParams.delete("ai_auth_code");
    try {
      window.history.replaceState(
        window.history.state,
        "",
        `${url.pathname}${url.search}${url.hash}`
      );
    } catch {}
    return { status, code };
  }

  function renderProjectAiAuthReturn(authReturn) {
    if (!authReturn) return;
    if (authReturn.status === "success") {
      void fetchProjectAiAuthSession()
        .then((session) => {
          const message =
            session?.authenticated === true
              ? "Signed in with Google."
              : "Google sign-in could not be restored. Please try again.";
          reportProjectCanvasMessage(
            "system",
            message
          );
          setProjectAiAccountStatus(
            message,
            session?.authenticated === true ? "success" : "error"
          );
        })
        .catch(() => {
          const message =
            "Google sign-in completed, but the session could not be checked. Please reload the page.";
          reportProjectCanvasMessage("system", message);
          setProjectAiAccountStatus(message, "error");
        });
      return;
    }

    const messages = {
      google_sign_in_denied: "Google sign-in was cancelled.",
      oauth_transaction_invalid:
        "The Google sign-in request expired or was already used. Please try again.",
      oauth_device_mismatch:
        "Google sign-in could not be matched to this browser. Please try again without clearing site data.",
      google_token_exchange_failed:
        "Google sign-in could not be verified. Please try again.",
      google_id_token_missing:
        "Google sign-in did not return the required identity information.",
      google_identity_invalid:
        "Google sign-in returned an invalid identity. Please try again.",
      google_email_unverified:
        "A verified Google email address is required.",
    };
    const message =
      messages[authReturn.code] ||
      "Google sign-in could not be completed. Please try again.";
    reportProjectCanvasMessage("system", message);
    setProjectAiAccountStatus(message, "error");
  }

  async function handleProjectAiSignIn() {
    setProjectAiAccountStatus();
    setProjectAiAuthPending(true);
    try {
      const session = await fetchProjectAiAuthSession();
      if (session.mode !== "google") return;
      if (session.configured !== true) {
        const message =
          "Google access for Uart Debug AI is not configured yet.";
        reportProjectCanvasMessage("system", message);
        setProjectAiAccountStatus(message, "error");
        openProjectAiAccountModal();
        return;
      }
      if (session.authenticated === true) return;
      const response = await fetch(PROJECT_AI_GOOGLE_START_URL, {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
        credentials: "same-origin",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.ok !== true || !data.redirectUrl) {
        throw new Error(
          String(
            data?.error?.message ||
              data?.error ||
              data?.message ||
              `Google sign-in could not start (${response.status}).`
          )
        );
      }
      const redirectUrl = new URL(
        String(data.redirectUrl),
        window.location.origin
      );
      if (
        redirectUrl.protocol !== "https:" ||
        redirectUrl.hostname !== "accounts.google.com"
      ) {
        throw new Error("Google sign-in returned an invalid redirect.");
      }
      window.location.assign(redirectUrl.toString());
    } catch (error) {
      const message =
        error?.message || "AI access could not be checked. Try again.";
      reportProjectCanvasMessage("system", message);
      setProjectAiAccountStatus(message, "error");
      openProjectAiAccountModal();
    } finally {
      setProjectAiAuthPending(false);
    }
  }

  async function handleProjectAiSignOut() {
    if (projectAiProfileSavePromise) await projectAiProfileSavePromise;
    let focusSignIn = false;
    setProjectAiAccountStatus();
    setProjectAiAuthPending(true);
    try {
      const response = await fetch(PROJECT_AI_LOGOUT_URL, {
        method: "POST",
        headers: {
          Accept: "application/json",
        },
        credentials: "same-origin",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.ok !== true) {
        throw new Error(
          String(
            data?.error?.message ||
              data?.error ||
              data?.message ||
              `Sign out failed (${response.status}).`
          )
        );
      }
      projectAiAuthRequestEpoch += 1;
      projectAiAuthSessionPromise = null;
      projectAiLatestQuota = null;
      projectAiQuotaUpdateSequence += 1;
      projectAiAuthSession = {
        mode: "google",
        configured: true,
        authenticated: false,
        quota: null,
      };
      resetProjectAiAccountWorkspaceRuntime();
      renderProjectAiAuthSession(projectAiAuthSession);
      focusSignIn = true;
      setProjectAiAccountStatus("Signed out.", "success");
      try {
        await fetchProjectAiAuthSession();
      } catch {
        const message =
          "Signed out, but the account status could not be refreshed. You can safely try again later.";
        reportProjectCanvasMessage("system", message);
        setProjectAiAccountStatus(message, "error");
      }
    } catch (error) {
      const message = error?.message || "Could not sign out. Try again.";
      reportProjectCanvasMessage("system", message);
      setProjectAiAccountStatus(message, "error");
    } finally {
      setProjectAiAuthPending(false);
      const modal = $("projectAiAccountModal");
      const signIn = $("projectAiSignInBtn");
      if (focusSignIn && modal && !modal.hidden && signIn && !signIn.hidden) {
        signIn.focus({ preventScroll: true });
      }
    }
  }

  function setProjectAiFormBusy(busy) {
    projectAiRequestInFlight = !!busy;
    const button = $("projectCanvasRunBtn");
    if (button) {
      button.disabled = !!busy;
      button.textContent = busy
        ? "Working…" : "Review specification";
    }
    for (const id of ["projectGenerateCodeBtn", "projectDescribeCodeBtn"]) {
      const control = $(id);
      if (control) control.disabled = !!busy;
    }
    $("projectCanvasForm")?.setAttribute("aria-busy", String(!!busy));
  }

  function getProjectAiJsonByteLength(value) {
    try {
      return new TextEncoder().encode(JSON.stringify(value)).byteLength;
    } catch {
      return Number.POSITIVE_INFINITY;
    }
  }



  function getProjectAiRequestPayload(operation = "analyze") {
    const linkedProject = getMiniProjectForFile(current);
    const project = linkedProject ? getPublicMiniProjectInstance(linkedProject.instanceId) : null;
    const source = project?.files.find((file) => file.role === "source");
    const guide = project?.files.find((file) => file.role === "guide" && file.locale === project.selectedLocale)
      || project?.files.find((file) => file.role === "guide");
    const specification = project?.files.find((file) => file.role === "specification");
    const target = getCanvasTarget();
    const payload = { operation, canvas: { ...getProjectInstructionSnapshot(), target }, ...target };
    if (project && source) {
      payload.currentProject = {
        instanceId: project.instanceId,
        id: project.id,
        title: project.title,
        displayName: project.displayName,
        sourceName: source.name,
        guideName: guide?.name || getFileStem(source.name) + " (description).md",
        guideLocale: guide?.locale || project.selectedLocale || "en",
        source: source.content,
        guide: guide?.content || "",
        version: project.version,
        canvasName: project.canvasName,
        projectPath: project.projectPath,
        projectDocuments: project.projectDocuments,
        sourceAuthorship: getFileAuthorship(source.storageName || source.name),
        ...(guide ? { guideAuthorship: getFileAuthorship(guide.storageName || guide.name) } : {}),
        ...(specification ? { specification: { name: specification.name, content: specification.content } } : {}),
      };
    }
    return payload;
  }

  function assertProjectAiUpdateIsFresh(requestPayload) {
    const snapshot = requestPayload?.currentProject;
    const linkedProject = getMiniProjectForFile(current);
    const liveProject = snapshot?.instanceId
      ? getPublicMiniProjectInstance(snapshot.instanceId)
      : null;
    const liveSource = liveProject?.files?.find(
      (file) => file.role === miniProjectCore.ROLES.SOURCE
    );
    const liveGuide = liveProject?.files?.find(
      (file) =>
        file.role === miniProjectCore.ROLES.GUIDE &&
        file.name === snapshot.guideName
    );
    const guideUnchanged = snapshot?.guideAuthorship
      ? liveProject?.selectedLocale === snapshot.guideLocale &&
        liveGuide?.name === snapshot.guideName && liveGuide.content === snapshot.guide
      : !liveProject?.files?.some(file => file.role === miniProjectCore.ROLES.GUIDE);
    const unchanged =
      snapshot &&
      linkedProject?.instanceId === snapshot.instanceId &&
      liveSource?.name === snapshot.sourceName &&
      liveSource.content === snapshot.source &&
      guideUnchanged &&
      (!snapshot.specification || liveProject.files.find(file => file.role === "specification")?.content === snapshot.specification.content);
    if (unchanged) return;

    throw new Error(
      "The current mini-project changed while the AI was responding. Newer local edits were not overwritten. Submit the request again."
    );
  }

  function assertProjectAiInstructionIsFresh(requestPayload, expectedScope = projectInstructionScopeEpoch) {
    if (expectedScope !== projectInstructionScopeEpoch) {
      throw new Error("The active project changed while AI was working. Run the canvas again.");
    }
    const expectedRevision = Number(
      requestPayload?.canvas?.revision
    );
    if (
      Number.isSafeInteger(expectedRevision) &&
      expectedRevision === projectInstructionDocument.revision
    ) {
      return expectedRevision;
    }
    throw new Error(
      "The instruction changed while the AI was responding. Your newer edits were preserved. Submit the request again."
    );
  }

  function normalizeGeneratedAiProject(project) {
    if (!project || typeof project !== "object" || Array.isArray(project)) {
      throw new Error("The AI response did not include a mini-project.");
    }

    const files = Array.isArray(project.files)
      ? project.files.map((rawFile) => {
          const role =
            rawFile?.role === "humanGuide"
              ? miniProjectCore.ROLES.GUIDE
              : rawFile?.role;
          const file = {
            role,
            name: String(rawFile?.name || ""),
            content: String(rawFile?.content || ""),
          };
          if (role === miniProjectCore.ROLES.GUIDE) {
            file.locale = String(rawFile?.locale || "en");
            file.mediaType = "text/markdown";
          } else if (role === miniProjectCore.ROLES.SOURCE) {
            file.mediaType = "text/x-c";
          } else if (role === miniProjectCore.ROLES.SPECIFICATION) {
            file.mediaType = "application/yaml";
          }
          return file;
        })
      : [];
    const displayName = String(
      project.displayName || project.title || project.name || project.id || "AI mini-project"
    ).trim();

    const definition = {
      schemaVersion: Number(project.schemaVersion) || 1,
      id: String(project.id || project.name || "ai-mini-project").trim(),
      title: displayName,
      displayName,
      summary: String(project.summary || ""),
      version: project.version ?? 1,
      ...(project.canvasName ? { canvasName: project.canvasName } : {}),
      ...(project.projectPath ? { projectPath: project.projectPath } : {}),
      files,
      defaultLocale:
        files.find((file) => file.role === miniProjectCore.ROLES.GUIDE)
          ?.locale || "en",
    };
    return definition;
  }



  async function submitProjectCanvas(operation = "analyze") {
    if (projectAiRequestInFlight) return;
    if (!["analyze", "generate", "describe"].includes(operation)) return;
    const request = getProjectAiRequestPayload(operation);
    if (operation === "describe" && !request.currentProject?.source.trim()) {
      reportProjectCanvasMessage("system", "Generate or write the project code before describing it.");
      return;
    }
    const accountEpoch = projectAiAccountWorkspaceEpoch;
    const accountKey = projectAiAuthSession?.accountKey || null;
    const canvasScopeEpoch = projectInstructionScopeEpoch;
    let quotaUpdated = false;
    let indicator = appendProjectAiThinking();
    setProjectAiFormBusy(true);
    try {
      const response = await fetch("/api/avr/ai/canvas", {
        method: "POST",
        headers: { Accept: "application/x-ndjson, application/json", "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(request),
      });
      const result = await readProjectAiApiResponse(response, (progress) => renderProjectAiThinkingProgress(indicator, progress));
      const data = result.data;
      if (accountEpoch !== projectAiAccountWorkspaceEpoch || accountKey !== (projectAiAuthSession?.accountKey || null)) {
        throw new Error("The account changed while AI was working. No changes were applied.");
      }
      if (data?.quota) { updateProjectAiQuota(data.quota); quotaUpdated = true; }
      if (result.status < 200 || result.status >= 300 || data?.ok !== true) {
        throw new Error(String(data?.message || data?.error?.message || `Canvas request failed (${result.status}).`));
      }
      const baseRevision = assertProjectAiInstructionIsFresh(request, canvasScopeEpoch);
      const target = getCanvasTarget();
      if (target.mcu !== request.mcu || target.packageName !== request.packageName) {
        throw new Error("The target changed while AI was working. Run the canvas again.");
      }
      if (!["canvas", "project"].includes(data.kind) || data.baseRevision !== baseRevision ||
          data.canvas?.schemaVersion !== 2 || data.canvas.revision !== baseRevision + 1 ||
          typeof data.canvas.markdown !== "string" || !Array.isArray(data.canvas.annotations)) {
        throw new Error("The server returned an incompatible canvas revision.");
      }
      if (data.stage && data.stage !== operation) throw new Error("The response belongs to a different project stage.");
      if (operation === "analyze" && data.kind === "project") throw new Error("Review cannot change project code or resources.");
      if (operation !== "analyze" && data.canvas.markdown !== request.canvas.markdown) {
        throw new Error("This stage cannot change the project specification.");
      }
      if (data.kind === "project") {
        const definition = normalizeGeneratedAiProject(data.project);
        const roles = definition.files.map(file => file.role).sort();
        const expectedRoles = operation === "generate" ? ["source", "specification"] : ["guide"];
        if (roles.join(",") !== expectedRoles.sort().join(",")) {
          throw new Error("The response does not match the requested project stage.");
        }
        if (data.operation === "update") {
          const instanceId = request.currentProject?.instanceId;
          if (!instanceId || (data.targetInstanceId && data.targetInstanceId !== instanceId)) {
            throw new Error("The response did not match the current mini-project.");
          }
          assertProjectAiUpdateIsFresh(request);
          await window.UartDebugAvrMiniProjects.updateInstance(instanceId, definition, { origin: "ai" });
        } else if (data.operation === "create") {
          if (operation !== "generate" || request.currentProject) throw new Error("The response cannot create a different project.");
          definition.files.push({ role: "guide", name: getFileStem(definition.files.find(file => file.role === "source").name) + " (description).md", content: "", mediaType: "text/markdown", locale: "en" });
          await window.UartDebugAvrMiniProjects.install(definition, { origin: "ai" });
        } else throw new Error("The response did not specify a project action.");
      }
      applyProjectInstructionMarkdown(data.canvas.markdown, {
        annotations: data.canvas.annotations,
        locale: data.canvas.locale,
        target: data.canvas.target,
        expectedRevision: baseRevision,
      });
      reportProjectCanvasMessage("assistant", data.message || (operation === "analyze" ? "Specification reviewed." : "Project updated."));
    } catch (error) {
      reportProjectCanvasMessage("system", error?.message || "The canvas request could not be completed.");
    } finally {
      removeProjectAiThinking(indicator);
      setProjectAiFormBusy(false);
      if (projectAiAuthSession?.mode === "google" && !quotaUpdated) {
        void fetchProjectAiAuthSession().catch(() => {});
      }
    }
  }

  function handleProjectCanvasSubmit(event) {
    event.preventDefault();
    void submitProjectCanvas();
  }

  function getDevicePanelHeightForState(state) {
    if (state === "collapsed") return DEVICE_PANEL_COLLAPSED_HEIGHT;
    if (state === "compact") return DEVICE_PANEL_COMPACT_HEIGHT;
    return DEVICE_PANEL_EXPANDED_HEIGHT;
  }

  function getAdjacentDevicePanelState(state, direction) {
    const states = ["collapsed", "compact", "expanded"];
    const index = Math.max(0, states.indexOf(state));
    const step = direction < 0 ? -1 : 1;
    return states[Math.max(0, Math.min(states.length - 1, index + step))];
  }

  function syncDevicePanelResizerAria() {
    const handle = $("devicePanelToggle");
    if (!handle) return;
    handle.setAttribute("aria-valuenow", String(Math.round(devicePanelHeight)));
    handle.setAttribute(
      "aria-valuetext",
      devicePanelState[0].toUpperCase() + devicePanelState.slice(1)
    );
  }

  function refreshWorkspaceAfterDevicePanelResize() {

    refreshWorkspaceEditors();
  }

  function applyDevicePanelState(
    state,
    { persist = false, animate = false } = {}
  ) {
    const section = $("avrDeviceSection");
    const viewport = $("avrDevicePanelViewport");
    const handle = $("devicePanelToggle");
    if (!section || !viewport || !handle) return;

    devicePanelState = ["expanded", "compact", "collapsed"].includes(state)
      ? state
      : "expanded";
    devicePanelHeight = getDevicePanelHeightForState(devicePanelState);
    section.style.setProperty("--device-panel-height", `${devicePanelHeight}px`);
    section.dataset.state = devicePanelState;
    const collapsed = devicePanelState === "collapsed" && devicePanelHeight === 0;
    for (const panel of [viewport, $("avrAccountPanelViewport")].filter(Boolean)) {
      panel.setAttribute("aria-hidden", String(collapsed));
      if (collapsed) panel.setAttribute("inert", "");
      else panel.removeAttribute("inert");
    }
    syncDevicePanelResizerAria();

    if (persist) {
      try {
        window.localStorage.setItem(STORAGE_DEVICE_PANEL_STATE, devicePanelState);
      } catch {}
    }

    if (devicePanelTransitionTimer) {
      window.clearTimeout(devicePanelTransitionTimer);
      devicePanelTransitionTimer = null;
    }
    section.classList.toggle("is-device-panel-transitioning", animate);
    if (animate) {
      devicePanelTransitionTimer = window.setTimeout(
        () => {
          devicePanelTransitionTimer = null;
          section.classList.remove("is-device-panel-transitioning");
          refreshWorkspaceAfterDevicePanelResize();
        },
        window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches
          ? 0
          : 270
      );
    }
  }

  function setDevicePanelState(
    state,
    { persist = true, animate = true } = {}
  ) {
    const normalized = ["expanded", "compact", "collapsed"].includes(state)
      ? state
      : "expanded";
    applyDevicePanelState(normalized, {
      persist,
      animate,
    });
  }

  function restoreDevicePanelState() {
    let storedState = "expanded";
    try {
      const raw = window.localStorage.getItem(STORAGE_DEVICE_PANEL_STATE);
      if (["expanded", "compact", "collapsed"].includes(raw)) {
        storedState = raw;
      }
    } catch {
      storedState = "expanded";
    }
    setDevicePanelState(storedState, { persist: false, animate: false });
  }

  function bindDevicePanelResizer() {
    bindSplitResizer($("devicePanelToggle"), {
      axis: "y",
      start: () => ({ anchor: 0 }),
      move: (position, drag) => {
        const delta = position - drag.anchor;
        const requestedSteps = Math.floor(Math.abs(delta) / DEVICE_PANEL_DRAG_THRESHOLD);
        if (requestedSteps < 1) return;
        const direction = delta < 0 ? -1 : 1;
        let nextState = devicePanelState;
        let appliedSteps = 0;
        while (appliedSteps < requestedSteps) {
          const adjacent = getAdjacentDevicePanelState(nextState, direction);
          if (adjacent === nextState) break;
          nextState = adjacent;
          appliedSteps += 1;
        }
        drag.anchor = appliedSteps < requestedSteps
          ? position
          : drag.anchor + direction * DEVICE_PANEL_DRAG_THRESHOLD * appliedSteps;
        if (nextState === devicePanelState) return;
        setDevicePanelState(nextState, { persist: false, animate: false });
        refreshWorkspaceAfterDevicePanelResize();
      },
      finish: () => {
        setDevicePanelState(devicePanelState, { persist: true, animate: false });
        refreshWorkspaceAfterDevicePanelResize();
      },
      key: event => {
        const states = ["collapsed", "compact", "expanded"];
        let index = states.indexOf(devicePanelState);
        if (event.key === "ArrowUp") index = Math.max(0, index - 1);
        else if (event.key === "ArrowDown") index = Math.min(states.length - 1, index + 1);
        else if (event.key === "Home") index = 0;
        else if (event.key === "End") index = states.length - 1;
        else return;
        event.preventDefault();
        setDevicePanelState(states[index]);
      },
    });
  }

  function setDocumentationNotice(message = "") {
    const notice = $("projectDocumentationNotice");
    if (!notice) return;
    notice.textContent = message;
    notice.hidden = !message;
  }

  function getDocumentationLocaleLabel(guide) {
    if (guide?.label) return guide.label;
    const locale = String(guide?.locale || "");
    if (!locale) return "Guide";
    try {
      const names = new Intl.DisplayNames([navigator.language || "en"], {
        type: "language",
      });
      return names.of(locale) || locale;
    } catch {
      return locale;
    }
  }

  function refreshDocumentationControls(context) {
    const localeSelect = $("documentationLocaleSelect");
    const editToggle = $("documentationEditToggle");
    const guideFile = context?.guideFile || "";
    const project = context?.linkedProject?.project || null;
    const guides = project ? getMiniProjectGuideEntries(project) : [];

    if (localeSelect) {
      localeSelect.replaceChildren();
      if (guides.length) {
        for (const guide of guides) {
          const option = document.createElement("option");
          option.value = guide.locale || "";
          option.textContent = getDocumentationLocaleLabel(guide);
          localeSelect.appendChild(option);
        }
        localeSelect.value =
          project.selectedLocale || project.defaultLocale || guides[0].locale || "";
        localeSelect.disabled = guides.length < 2;
      } else {
        const option = document.createElement("option");
        option.value = "";
        option.textContent = guideFile ? "Local guide" : "Localization";
        localeSelect.appendChild(option);
        localeSelect.disabled = true;
      }
    }

    if (editToggle) {
      const canEdit = !!guideFile && hasFile(guideFile);
      editToggle.disabled = !canEdit;
      editToggle.textContent = documentationEditMode ? "Preview" : "Edit";
      editToggle.setAttribute(
        "aria-pressed",
        String(documentationEditMode)
      );
    }

    window.requestAnimationFrame(() => {
      if (!activeSplitResize) fitWorkspaceToViewport();
    });
  }

  function saveDocumentationEditorValue({ persistNow = false } = {}) {
    if (!documentationEditMode) return;
    const markdownEditor = $("projectDocumentationEditor");
    const guideFile = markdownEditor?.dataset.guideFile || "";
    if (!markdownEditor || !guideFile || !hasFile(guideFile)) return;

    files[guideFile] = documentationEditor
      ? documentationEditor.getValue()
      : markdownEditor.value;
    if (projectAiBootComplete && !projectAiAccountWorkspaceApplying) {
      markProjectAiAccountDocumentDirty("files");
    }
    if (documentationEditSaveTimer) {
      window.clearTimeout(documentationEditSaveTimer);
      documentationEditSaveTimer = null;
    }
    if (persistNow) {
      persistState();
    } else {
      documentationEditSaveTimer = window.setTimeout(() => {
        documentationEditSaveTimer = null;
        persistState();
      }, 250);
    }
  }

  function setDocumentationEditorValue(markdown) {
    const value = String(markdown ?? "");
    const element = $("projectDocumentationEditor");
    if (!documentationEditor) {
      if (element && element.value !== value) element.value = value;
      return;
    }
    if (documentationEditor.getValue() === value) return;
    documentationEditorSyncing = true;
    try {
      documentationEditor.setValue(value);
      documentationEditor.save();
    } finally {
      documentationEditorSyncing = false;
    }
    scheduleMarkdownLivePreview("documentation");
  }

  function setDocumentationEditMode(editing) {
    const context = getDocumentationContext(current);
    const nextMode =
      !!editing && !!context.guideFile && hasFile(context.guideFile);
    if (documentationEditMode && !nextMode) {
      saveDocumentationEditorValue({ persistNow: true });
    }
    documentationEditMode = nextMode;
    if (nextMode) expandDocumentationForNavigation();
    refreshDocumentationPane({ preserveScroll: true });
    if (nextMode) {
      window.requestAnimationFrame(() => {
        documentationEditor?.focus({ preventScroll: true });
      });
    } else {
      documentationEditor?.getInputField?.().blur();
    }
  }

  function bindDocumentationWorkspace() {
    const editorElement = $("projectDocumentationEditor");
    if (
      !editorElement ||
      typeof window.CodeMirror?.fromTextArea !== "function"
    ) {
      editorElement?.addEventListener("input", () =>
        saveDocumentationEditorValue()
      );
      return;
    }

    documentationEditor = CodeMirror.fromTextArea(editorElement, {
      mode: {
        name: "markdown",
        highlightFormatting: true,
        fencedCodeBlockHighlighting: false,
        strikethrough: true,
        taskLists: true,
        xml: false,
      },
      theme: "material-darker",
      inputStyle: "contenteditable",
      lineNumbers: false,
      readOnly: true,
      lineWrapping: true,
      indentUnit: 2,
      tabSize: 2,
      indentWithTabs: false,
      viewportMargin: 30,
      autofocus: false,
      extraKeys: {
        Tab(cm) {
          cm.replaceSelection("  ", "end", "+input");
        },
      },
    });
    documentationEditor.setSize("100%", "100%");
    const input = documentationEditor.getInputField();
    input.setAttribute("aria-label", "Code description Markdown");
    input.setAttribute("aria-multiline", "true");
    input.setAttribute("data-tooltip-disabled", "");
    input.setAttribute("role", "textbox");
    input.setAttribute("spellcheck", "true");
    input.setAttribute("aria-readonly", "true");
    registerMarkdownLiveEditor("documentation", documentationEditor, {
      getContextKey: () =>
        `${editorElement.dataset.guideFile || ""}\u0000${current || ""}`,
      getAuthorship: () => {
        const guideFile = editorElement.dataset.guideFile || "";
        return guideFile ? getFileAuthorship(guideFile) : null;
      },
      onHeadings: (headings) => {
        documentationHeadingIndex = headings;
      },
      resolveImageUrl: (href) =>
        resolveDocumentationImageUrl(href, getDocumentationContext(current)),
    });
    input.addEventListener("compositionstart", () =>
      setMarkdownLiveComposition("documentation", true)
    );
    input.addEventListener("compositionend", () =>
      setMarkdownLiveComposition("documentation", false)
    );
    documentationEditor.on("change", (cm, change) => {
      cm.save();
      if (documentationEditorSyncing) return;
      const guideFile = editorElement.dataset.guideFile || "";
      if (!guideFile || !hasFile(guideFile)) return;
      const previousMarkdown = files[guideFile] || "";
      const markdown = cm.getValue();
      fileAuthorship[guideFile] = updateMarkdownAuthorshipForChange(
        fileAuthorship[guideFile],
        previousMarkdown,
        change,
        "human"
      );
      files[guideFile] = markdown;
      if (current === guideFile && editor && editor.getValue() !== markdown) {
        editor.setValue(markdown);
      }
      scheduleMarkdownLivePreview("documentation");
      scheduleMarkdownLivePreview("editor");
      saveDocumentationEditorValue();
    });
    documentationEditor.on("cursorActivity", () =>
      scheduleMarkdownLivePreview("documentation")
    );
    documentationEditor.on("viewportChange", () =>
      scheduleMarkdownLivePreview("documentation")
    );
    window.addEventListener("resize", () => documentationEditor?.refresh());
  }

  function indexDocumentationMarkdownHeadings(markdown) {
    const headings = new Map();
    try {
      const analysis = window.UartDebugMarkdown?.analyze?.(markdown);
      for (const heading of Array.isArray(analysis?.headings)
        ? analysis.headings
        : []) {
        const key = miniProjectCore.normalizeHeadingKey(heading.text);
        const indexKey = `${heading.level}:${key}`;
        if (!key || headings.has(indexKey)) continue;
        headings.set(indexKey, {
          line: Math.max(0, Number(heading.startLine || 1) - 1),
          ch: Math.max(0, Number(heading.startColumn || 1) - 1),
          level: heading.level,
          title: heading.text,
        });
      }
    } catch (error) {
      console.warn("Project guide headings could not be indexed:", error);
    }
    documentationHeadingIndex = headings;
  }

  function refreshDocumentationPane({ preserveScroll = false } = {}) {
    const pane = $("projectDocumentationPane");
    const scroll = $("projectDocumentationScroll");
    const content = $("projectDocumentationContent");
    const markdownEditor = $("projectDocumentationEditor");
    if (!pane || !scroll || !content || !markdownEditor) return;

    const context = getDocumentationContext(current);
    const previousGuide = pane.dataset.guideFile || "";
    const previousScrollTop = documentationEditMode
      ? documentationEditor?.getScrollInfo?.().top || 0
      : scroll.scrollTop;
    const guideFile = context.guideFile;

    if (previousGuide && previousGuide !== guideFile) {
      if (documentationEditMode) {
        saveDocumentationEditorValue({ persistNow: true });
      }
      documentationEditMode = false;
    }
    pane.dataset.guideFile = guideFile;
    markdownEditor.dataset.guideFile = guideFile;
    setDocumentationNotice();
    refreshDocumentationControls(context);

    if (!guideFile || !hasFile(guideFile)) {
      documentationEditMode = false;
      refreshDocumentationControls(context);
      scroll.classList.remove("is-documentation-edit");
      markdownEditor.readOnly = true;
      markdownEditor.setAttribute("aria-readonly", "true");
      documentationEditor?.setOption("readOnly", true);
      documentationEditor
        ?.getInputField?.()
        .setAttribute("aria-readonly", "true");
      content.hidden = false;
      documentationEditor?.getWrapperElement?.().setAttribute("hidden", "");
      markdownEditor.hidden = true;
      content.replaceChildren();
      scroll.scrollTop = 0;
      return;
    }

    const markdown = getLiveFileContent(guideFile);
    const wrapper = documentationEditor?.getWrapperElement?.();
    setDocumentationEditorValue(markdown);
    if (documentationEditMode) {
      scroll.classList.add("is-documentation-edit");
      content.hidden = true;
      markdownEditor.hidden = false;
      wrapper?.removeAttribute("hidden");
      markdownEditor.readOnly = false;
      markdownEditor.setAttribute("aria-readonly", "false");
      documentationEditor?.setOption("readOnly", false);
      documentationEditor
        ?.getInputField?.()
        .setAttribute("aria-readonly", "false");
      documentationEditor?.refresh();
      scheduleMarkdownLivePreview("documentation");
      documentationEditor?.scrollTo(
        null,
        preserveScroll && previousGuide === guideFile ? previousScrollTop : 0
      );
      return;
    }

    scroll.classList.remove("is-documentation-edit");
    markdownEditor.readOnly = true;
    markdownEditor.setAttribute("aria-readonly", "true");
    documentationEditor?.setOption("readOnly", true);
    documentationEditor
      ?.getInputField?.()
      .setAttribute("aria-readonly", "true");
    wrapper?.setAttribute("hidden", "");
    markdownEditor.hidden = true;
    content.hidden = false;
    renderMarkdownGuide(markdown, context);
    scroll.scrollTop =
      preserveScroll && previousGuide === guideFile ? previousScrollTop : 0;
  }

  function scheduleDocumentationPaneRefresh() {
    if (documentationRenderTimer) window.clearTimeout(documentationRenderTimer);
    documentationRenderTimer = window.setTimeout(() => {
      documentationRenderTimer = null;
      refreshDocumentationPane({ preserveScroll: true });
    }, 180);
  }

  function scrollDocumentationTargetIntoView(target, behavior = "auto") {
    const scroll = $("projectDocumentationScroll");
    if (!scroll || !target || !scroll.contains(target)) return false;

    const scrollRect = scroll.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const unclampedTop =
      scroll.scrollTop + targetRect.top - scrollRect.top - 20;
    const maximumTop = Math.max(0, scroll.scrollHeight - scroll.clientHeight);
    const top = Math.max(0, Math.min(maximumTop, unclampedTop));

    if (typeof scroll.scrollTo === "function") {
      scroll.scrollTo({ top, behavior });
    } else {
      scroll.scrollTop = top;
    }
    return true;
  }

  function navigateToDocumentationHeading(marker) {
    expandDocumentationForNavigation();
    const context = getDocumentationContext(current);
    if (!context.guideFile || !hasFile(context.guideFile)) {
      setDocumentationNotice("This source file has no linked guide yet.");
      return false;
    }

    if (documentationEditMode) {
      setDocumentationEditMode(false);
    }

    const pane = $("projectDocumentationPane");
    if (pane?.dataset.guideFile !== context.guideFile) refreshDocumentationPane();

    const headingKey = miniProjectCore.normalizeHeadingKey(marker.title);
    const targetKey = `${marker.level}:${headingKey}`;
    let target = documentationRenderedHeadingIndex.get(targetKey);
    if (!target) {
      renderMarkdownGuide(getLiveFileContent(context.guideFile), context);
      target = documentationRenderedHeadingIndex.get(targetKey);
    }
    if (!target) {
      setDocumentationNotice(`Section not found: ${marker.title}`);
      return false;
    }

    setDocumentationNotice();
    if (target instanceof Element) {
      scrollDocumentationTargetIntoView(target);
      target.classList.add("is-documentation-target");
      if (documentationTargetTimer) window.clearTimeout(documentationTargetTimer);
      documentationTargetTimer = window.setTimeout(() => {
        target.classList.remove("is-documentation-target");
        documentationTargetTimer = null;
      }, 1800);
      return true;
    }

    if (!documentationEditor) return false;
    const targetPosition = CodeMirror.Pos(target.line, target.ch || 0);
    documentationEditor.scrollIntoView(
      { from: targetPosition, to: targetPosition },
      48
    );
    const lineHandle = documentationEditor.getLineHandle(target.line);
    if (lineHandle) {
      documentationEditor.addLineClass(
        lineHandle,
        "background",
        "is-documentation-target"
      );
    }

    if (documentationTargetTimer) window.clearTimeout(documentationTargetTimer);
    documentationTargetTimer = window.setTimeout(() => {
      if (lineHandle) {
        documentationEditor?.removeLineClass(
          lineHandle,
          "background",
          "is-documentation-target"
        );
      }
      documentationTargetTimer = null;
    }, 1800);
    return true;
  }

  function clearDocumentationMarkers() {
    for (const marker of documentationMarkerHandles) marker.clear?.();
    documentationMarkerHandles = [];
  }

  function refreshDocumentationMarkers() {
    if (documentationMarkerFrame !== null) {
      window.cancelAnimationFrame(documentationMarkerFrame);
      documentationMarkerFrame = null;
    }

    clearDocumentationMarkers();
    if (!editor || !isCFileName(current)) return;

    const markerScanner = miniProjectCore.createDocumentationMarkerScanner();
    editor.operation(() => {
      for (let lineNumber = 0; lineNumber < editor.lineCount(); lineNumber += 1) {
        const line = editor.getLine(lineNumber);
        const marker = markerScanner.parseLine(line);
        if (!marker) continue;
        documentationMarkerHandles.push(
          editor.markText(
            CodeMirror.Pos(lineNumber, marker.start),
            CodeMirror.Pos(lineNumber, marker.end),
            {
              className: "cm-documentation-link",
              title: `Open guide section: ${marker.title}`,
            }
          )
        );
      }
    });
  }

  function scheduleDocumentationMarkerRefresh() {
    if (documentationMarkerFrame !== null) return;
    documentationMarkerFrame = window.requestAnimationFrame(() => {
      documentationMarkerFrame = null;
      refreshDocumentationMarkers();
    });
  }

  function openDocumentationMarkerAtLine(lineNumber) {
    if (!editor || !isCFileName(current)) return false;
    const markerScanner = miniProjectCore.createDocumentationMarkerScanner();
    let marker = null;
    for (let index = 0; index <= lineNumber; index += 1) {
      marker = markerScanner.parseLine(editor.getLine(index));
    }
    return marker ? navigateToDocumentationHeading(marker) : false;
  }

  function bindDocumentationMarkerNavigation() {
    if (!editor) return;
    const wrapper = editor.getWrapperElement();
    editor
      .getInputField()
      ?.setAttribute("aria-describedby", "editorDocumentationHint");
    wrapper.addEventListener("click", (event) => {
      if (!event.target.closest?.(".cm-documentation-link")) return;
      event.preventDefault();
      const position = editor.coordsChar(
        { left: event.clientX, top: event.clientY },
        "window"
      );
      openDocumentationMarkerAtLine(position.line);
    });
  }

  function selectFile(name) {
    if (!hasFile(name) || isHiddenMiniProjectFile(name)) return;
    if (editor && current && current !== name && hasFile(current)) {
      files[current] = editor.getValue();
    }

    current = name;
    activateCurrentProjectCanvas();
    if (editor) {
      editor.setOption("readOnly", false);
      editor.setOption("mode", getEditorModeForFile(name));
      editor.setValue(files[name]);
      editor.getWrapperElement()?.classList.toggle(
        "is-markdown-live",
        /\.md$/i.test(name)
      );
    }

    resetHexArtifact();
    updateCompilePanelState(true);

    updateEditorFileWatermark(name);
    refreshDocumentationPane();
    scheduleDocumentationMarkerRefresh();
    scheduleMarkdownLivePreview("editor");
    persistState();
    renderOutliner();
    if (editor) setTimeout(() => editor.refresh(), 0);
  }

  function renameFile(oldName) {
    startInlineRename(oldName);
  }

  async function deleteFile(name) {
    if (!hasFile(name)) return;
    const linkedProject = getMiniProjectForFile(name);
    const deleteWholeProject =
      linkedProject?.role === miniProjectCore.ROLES.SOURCE;
    const displayName = deleteWholeProject
      ? getOutlinerFileLabel(name)
      : name;
    const confirmed = await showSiteConfirm({
      title: deleteWholeProject ? "Delete project" : "Delete file",
      message: deleteWholeProject
        ? `Delete mini-project "${displayName}" and its local source and guide copies? This cannot be undone.`
        : `Delete "${name}"? This cannot be undone.`,
      confirmText: deleteWholeProject ? "Delete project" : "Delete",
      cancelText: "Cancel",
      danger: true,
    });
    if (!confirmed) return;

    const namesToDelete = deleteWholeProject
      ? getMiniProjectLocalFileNames(linkedProject.project)
      : [name];
    const deletedCurrent = namesToDelete.includes(current);
    for (const fileName of namesToDelete) {
      delete files[fileName];
      delete fileAuthorship[fileName];
      hexArtifactsBySource.delete(fileName);
      removeFileFromGroups(fileName);
    }
    if (deleteWholeProject) {
      delete miniProjects[linkedProject.instanceId];
    } else {
      removeMiniProjectFile(name);
    }
    if (deletedCurrent) {
      current = getVisibleWorkspaceFileNames()[0] || null;
      activateCurrentProjectCanvas({ savePrevious: false });
    }
    persistState();
    if (!current) {
      try {
        localStorage.removeItem(STORAGE_CURRENT);
        localStorage.removeItem(LEGACY_STORAGE_CURRENT);
      } catch {}
      if (Object.keys(files).length === 0 && editor) {
        editor.setValue("");
        editor.setOption("readOnly", "nocursor");
      }
      updateEditorFileWatermark("");
    } else {
      if (editor) {
        editor.setOption("readOnly", false);
        editor.setOption("mode", getEditorModeForFile(current));
        editor.setValue(files[current] || "");
      }
      updateEditorFileWatermark(current);
    }
    renderOutliner();
    refreshDocumentationPane();
    scheduleDocumentationMarkerRefresh();
    if (deletedCurrent) {
      resetHexArtifact();
      updateCompilePanelState(true);
    }
  }

  function downloadFile(name) {
    if (!name || !hasFile(name)) return;
    const linked = getMiniProjectForFile(name);
    const project = linked ? getPublicMiniProjectInstance(linked.instanceId) : null;
    const isProject = linked?.role === miniProjectCore.ROLES.SOURCE;
    const type = /\.ya?ml$/i.test(name) ? "application/yaml" : /\.md$/i.test(name) ? "text/markdown" : "text/plain";
    const content = isProject ? window.UartDebugAvrMiniProjectArchive.createProjectArchive({
      ...project,
      canvas: name === current ? getProjectInstructionSnapshot() : project.canvas,
    }) : getLiveFileContent(name);
    const blob = new Blob([content], { type: isProject ? "application/zip" : `${type};charset=utf-8` });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = isProject ? String(project.projectPath || project.title).split("/").pop() + ".zip"
      : linked?.project.fileNames?.[name] || name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  }

  function downloadCurrent() {
    downloadFile(current);
  }

  function updateToolbarState() {
    const has = !!current;
    const rb = $("renameBtn");
    const db = $("deleteBtn");
    const dl = $("downloadBtn");
    const cb = $("compileBtn");
    if (rb) rb.disabled = !has;
    if (db) db.disabled = !has;
    if (dl) dl.disabled = !has;
    if (cb) cb.disabled = !has || !/\.c$/i.test(current);
  }

  const C_HINT_WORDS = [
    // C keywords
    "auto",
    "break",
    "case",
    "char",
    "const",
    "continue",
    "default",
    "do",
    "double",
    "else",
    "enum",
    "extern",
    "float",
    "for",
    "goto",
    "if",
    "inline",
    "int",
    "long",
    "register",
    "restrict",
    "return",
    "short",
    "signed",
    "sizeof",
    "static",
    "struct",
    "switch",
    "typedef",
    "union",
    "unsigned",
    "void",
    "volatile",
    "while",
    // stdint types
    "int8_t",
    "int16_t",
    "int32_t",
    "uint8_t",
    "uint16_t",
    "uint32_t",
    // Common functions
    "printf",
    "puts",
    "putchar",
    "scanf",
    "strlen",
    "strcpy",
    "strncpy",
    "strcmp",
    "memcpy",
    "memset",
    "abs",
    "labs",
    "rand",
    "srand",
    // MCU and firmware helpers
    "F_CPU",
    "sei",
    "cli",
    "_delay_ms",
    "_delay_us",
  ];

  // Register a custom hint source from the dictionary and current file.
  CodeMirror.registerHelper("hint", "udc", function (cm) {
    const cur = cm.getCursor();
    const line = cm.getLine(cur.line);
    let start = cur.ch,
      end = cur.ch;

    // Expand the current word left and right.
    while (start && /[\w_]/.test(line.charAt(start - 1))) start--;
    while (end < line.length && /[\w_]/.test(line.charAt(end))) end++;

    const prefix = line.slice(start, cur.ch);
    const lcPref = prefix.toLowerCase();

    // Dictionary matches
    const dict = C_HINT_WORDS.filter((w) => w.toLowerCase().startsWith(lcPref));

    // Current buffer matches
    let any = [];
    try {
      any = (CodeMirror.hint.anyword(cm) || {}).list || [];
    } catch {}
    any = any.filter(
      (w) => w && typeof w === "string" && w.toLowerCase().startsWith(lcPref)
    );

    // Merge, deduplicate, and omit the exact typed prefix.
    const seen = new Set();
    const list = []
      .concat(dict, any)
      .filter((w) => w !== prefix)
      .filter((w) => (seen.has(w) ? false : (seen.add(w), true)))
      .slice(0, 200); // Keep the hint list bounded.

    return {
      list,
      from: CodeMirror.Pos(cur.line, start),
      to: CodeMirror.Pos(cur.line, end),
    };
  });

  function initEditor() {
    editor = CodeMirror($("editorHost"), {
      value: current && hasFile(current) ? files[current] : "",
      mode: getEditorModeForFile(current),
      theme: "material-darker",
      lineNumbers: true,
      gutters: ["CodeMirror-linenumbers"],
      indentUnit: 2,
      tabSize: 2,
      indentWithTabs: false,
      matchBrackets: true,
      autoCloseBrackets: true,
      autofocus: true,
      extraKeys: {
        "Ctrl-Space": "autocomplete",
        "Alt-Space": "autocomplete",
        "Alt-Enter": (cm) => openDocumentationMarkerAtLine(cm.getCursor().line),
      },
    });
    registerMarkdownLiveEditor("editor", editor, {
      getContextKey: () => current || "",
      getAuthorship: () => (current ? getFileAuthorship(current) : null),
      isMarkdown: () => /\.md$/i.test(current || ""),
      resolveImageUrl: (href) =>
        resolveDocumentationImageUrl(href, getDocumentationContext(current)),
    });
    bindDocumentationMarkerNavigation();
    editor.on("inputRead", function (cm, change) {
      if (!isCFileName(current)) return;
      if (!change || !change.text || !change.text.length) return;
      const ch = change.text.join("");
      const isPastedBlock =
        change.origin === "paste" ||
        change.text.length > 1 ||
        /\r|\n/.test(ch) ||
        /\n$/.test(ch);
      if (isPastedBlock) {
        if (cm.state?.completionActive && typeof cm.closeHint === "function") {
          cm.closeHint();
        }
        return;
      }
      if (/\w|_/.test(ch)) {
        cm.showHint({
          hint: CodeMirror.hint.udc,
          completeSingle: false,
          closeOnUnfocus: true,
        });
      }
    });
    if (editor && editor.setSize) {
      editor.setSize("100%", "100%");
      setTimeout(() => editor.refresh(), 0);
      window.addEventListener("resize", () => editor && editor.refresh());
    }
    if (!current) editor.setOption("readOnly", "nocursor");
    editor.on("change", (cm, change) => {
      clearCompileErrorHighlight();
      if (!current) return;
      const previousMarkdown = files[current] || "";
      const liveMarkdown = cm.getValue();
      if (change?.origin !== "setValue" && !projectAiAccountWorkspaceApplying) {
        fileAuthorship[current] = updateMarkdownAuthorshipForChange(
          fileAuthorship[current],
          previousMarkdown,
          change,
          "human"
        );
      }
      files[current] = liveMarkdown;
      scheduleMarkdownLivePreview("editor");
      if (projectAiAccountWorkspaceApplying) {
        scheduleDocumentationMarkerRefresh();
        if (resolveGuideFileName(current) === current) {
          scheduleDocumentationPaneRefresh();
        }
        return;
      }
      if (projectAiBootComplete && !projectAiAccountWorkspaceApplying) {
        markProjectAiAccountDocumentDirty("files");
      }
      scheduleDocumentationMarkerRefresh();
      if (resolveGuideFileName(current) === current) {
        scheduleDocumentationPaneRefresh();
      }
      if (saveTimer) clearTimeout(saveTimer);

      const codeSnapshot = liveMarkdown;
      const fileNameSnapshot = current;

      saveTimer = setTimeout(() => {
        if (fileNameSnapshot && hasFile(fileNameSnapshot)) {
          files[fileNameSnapshot] = codeSnapshot;
        }
        persistState();
      }, 250);
    });
    editor.on("cursorActivity", () => scheduleMarkdownLivePreview("editor"));
    editor.on("viewportChange", () => scheduleMarkdownLivePreview("editor"));
    scheduleDocumentationMarkerRefresh();
    editor.addKeyMap({
      "Ctrl-S": function () {
        downloadCurrent();
      },
      "Cmd-S": function () {
        downloadCurrent();
      },
    });
  }

  const {
    initSelect: initCustomSelect,
    updateSelect: updateCustomSelect,
    refreshSelectWidth: updateCustomSelectIntrinsicWidth,
  } = window.UartDebugControls;

  function bindUI() {
      const newBtn = $("newBtn");
      const renameBtn = $("renameBtn");
      const deleteBtn = $("deleteBtn");
      const downloadBtn = $("downloadBtn");
      const compileBtn = $("compileBtn");
      const programHexBtn = $("programHexBtn");
      const detectChipBtn = $("detectChipBtn");
      const fileContextMenu = $("fileContextMenu");
      const fileUploadInput = $("fileUploadInput");
      const fileAddModal = $("fileAddModal");
      const fileAddCloseBtn = $("fileAddCloseBtn");
      const uploadExistingFileCard = $("uploadExistingFileCard");
      const fileTemplateGrid = $("fileTemplateGrid");
      const siteDialog = $("siteDialog");
      const siteDialogCloseBtn = $("siteDialogCloseBtn");
      const siteDialogCancelBtn = $("siteDialogCancelBtn");
      const siteDialogConfirmBtn = $("siteDialogConfirmBtn");
      const mcuSelect = $("mcuSelect");
      const documentationLocaleSelect = $("documentationLocaleSelect");
      const documentationEditToggle = $("documentationEditToggle");
      const projectAiAccountBtn = $("projectAiAccountBtn");
      const projectAiAccountModal = $("projectAiAccountModal");
      const projectAiAccountCloseBtn = $("projectAiAccountCloseBtn");
      const projectAiSignInBtn = $("projectAiSignInBtn");
      const projectAiSignOutBtn = $("projectAiSignOutBtn");

    initCustomSelect(mcuSelect);
    initCustomSelect($("projectPackageSelect"));
    initCustomSelect(documentationLocaleSelect);
    bindFileListResizer();
    bindDocumentationResizer();
    bindProjectAiResizers();
    bindDevicePanelResizer();
    bindProjectInstructionWorkspace();
    bindDocumentationWorkspace();
    bindWorkspaceResizeObserver();
    newBtn && newBtn.addEventListener("click", openAddFileModal);
    renameBtn &&
      renameBtn.addEventListener("click", () => current && renameFile(current));
    deleteBtn &&
      deleteBtn.addEventListener("click", () => {
        if (!current) return;
        deleteFile(current).catch((error) => {
          showSiteAlert(
            `Delete failed.\n${error.message || String(error)}`,
            "Delete failed"
          );
        });
      });
      downloadBtn && downloadBtn.addEventListener("click", downloadCurrent);
      compileBtn && compileBtn.addEventListener("click", compileCurrentFile);
      detectChipBtn && detectChipBtn.addEventListener("click", handleDetectChip);
      programHexBtn && programHexBtn.addEventListener("click", handleFlashCurrent);
    fileAddCloseBtn && fileAddCloseBtn.addEventListener("click", closeAddFileModal);
    $("createEmptyProjectCard")?.addEventListener("click", () => {
      try {
        createEmptyProject();
      } catch (error) {
        void showSiteAlert(
          `Project could not be created.\n${error.message || String(error)}`,
          "New project"
        );
      }
    });
    fileTemplateGrid &&
      fileTemplateGrid.addEventListener("click", async (event) => {
        const card = event.target.closest("[data-template-id]");
        if (!card) return;
        card.disabled = true;
        try {
          await createFileFromTemplate(card.dataset.templateId || "");
        } catch (error) {
          await showSiteAlert(
            `Mini-project could not be created.\n${error.message || String(error)}`,
            "Mini-project"
          );
        } finally {
          card.disabled = false;
        }
      });
    uploadExistingFileCard &&
      uploadExistingFileCard.addEventListener("click", () => {
        closeAddFileModal();
        if (!fileUploadInput) return;
        fileUploadInput.value = "";
        fileUploadInput.click();
      });

    documentationLocaleSelect &&
      documentationLocaleSelect.addEventListener("change", () => {
        const context = getDocumentationContext(current);
        const project = context.linkedProject?.project;
        const locale = documentationLocaleSelect.value;
        const guide = project?.guides?.[locale];
        if (!project || !guide?.fileName || !hasFile(guide.fileName)) return;

        if (documentationEditMode) {
          saveDocumentationEditorValue({ persistNow: true });
          documentationEditMode = false;
        }
        project.selectedLocale = locale;
        project.files.guide = guide.fileName;
        project.mediaTypes.guide = guide.mediaType || "text/markdown";
        persistState();
        refreshDocumentationPane();
      });
    documentationEditToggle &&
      documentationEditToggle.addEventListener("click", () => {
        setDocumentationEditMode(!documentationEditMode);
      });
    $("projectCanvasForm")?.addEventListener("submit", handleProjectCanvasSubmit);
    $("projectGenerateCodeBtn")?.addEventListener("click", () => void submitProjectCanvas("generate"));
    $("projectDescribeCodeBtn")?.addEventListener("click", () => void submitProjectCanvas("describe"));
    bindCanvasTargetControls();
    projectAiAccountBtn &&
      projectAiAccountBtn.addEventListener("click", handleProjectAiAccountAction);
    projectAiAccountCloseBtn &&
      projectAiAccountCloseBtn.addEventListener(
        "click",
        closeProjectAiAccountModal
      );
    projectAiAccountModal &&
      projectAiAccountModal.addEventListener("click", (event) => {
        if (event.target === projectAiAccountModal) {
          closeProjectAiAccountModal();
        }
      });
    projectAiSignInBtn &&
      projectAiSignInBtn.addEventListener("click", handleProjectAiSignIn);
    projectAiSignOutBtn &&
      projectAiSignOutBtn.addEventListener("click", handleProjectAiSignOut);
    $("projectAiProfileForm")?.addEventListener("submit", saveProjectAiProfile);
    $("projectAiDisplayName")?.addEventListener("input", handleProjectAiProfileNameInput);
    fileAddModal &&
      fileAddModal.addEventListener("click", (event) => {
        const target = event.target;
        if (target === fileAddModal) {
          closeAddFileModal();
        }
      });
    fileUploadInput &&
      fileUploadInput.addEventListener("change", async (event) => {
        const input = event.target;
        const file =
          input instanceof HTMLInputElement && input.files
            ? input.files[0]
            : null;

        try {
          await handleUploadedFile(file);
        } catch (error) {
          const message = error && error.message ? error.message : String(error);
          await showSiteAlert(`Failed to import file.\n${message}`, "Import failed");
          console.warn(`Import failed: ${message}`);
        } finally {
          if (input instanceof HTMLInputElement) {
            input.value = "";
          }
        }
      });

    // Shared file context menu: click on items
    if (fileContextMenu) {
      fileContextMenu.addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-action]");
        if (!btn) return;
        const action = btn.dataset.action;
        if (!action) return;
        handleFileContextAction(action).catch((error) => {
          showSiteAlert(
            `File action failed.\n${error.message || String(error)}`,
            "File action failed"
          );
        });
      });
    }

    siteDialogConfirmBtn &&
      siteDialogConfirmBtn.addEventListener("click", () =>
        resolveSiteDialog(true)
      );
    siteDialogCancelBtn &&
      siteDialogCancelBtn.addEventListener("click", () =>
        resolveSiteDialog(false)
      );
    siteDialogCloseBtn &&
      siteDialogCloseBtn.addEventListener("click", () =>
        resolveSiteDialog(false)
      );
    siteDialog &&
      siteDialog.addEventListener("click", (event) => {
        if (event.target === siteDialog) {
          resolveSiteDialog(false);
        }
      });

    // Close context menu on click outside of it / trigger
    document.addEventListener("click", (e) => {
      const menu = $("fileContextMenu");
      if (!menu || menu.style.display !== "block") return;
      if (menu.contains(e.target) || e.target.closest(".file-menu-btn")) {
        return;
      }
      closeFileContextMenu();
    });
    // Dialogs share focus containment and dismiss only the topmost open surface.
    document.addEventListener("keydown", (e) => {
      if (e.defaultPrevented || trapWorkspaceModalFocus(e)) return;
      if (e.key === "Escape") {
        if (dismissTopWorkspaceModal()) {
          e.preventDefault();
          return;
        }
        if (inlineFileEdit) {
          cancelInlineFileEdit();
          return;
        }
        closeFileContextMenu();
      }
    });

    window.addEventListener("beforeunload", () => {
      persistProjectInstruction({ immediate: true });
      if (documentationEditMode) {
        saveDocumentationEditorValue({ persistNow: true });
      }
      if (editor && current) {
        files[current] = editor.getValue();
        persistState();
      }
    });
  }

  // --- HEX artifact state ---
  let lastHexContent = null;
  let lastHexName = null;
  const hexArtifactsBySource = new Map();
  let lastDetectedUpdiTargetKey = "";

  function getUpdiHexArtifact() {
    return {
      hexText: lastHexContent || "",
      fileName: lastHexName || "",
      source: "compiled",
    };
  }

  function dispatchUpdiHexArtifact() {
    dispatchHexArtifact(getUpdiHexArtifact());
  }

  function dispatchCanvasSerialState() {
    if (typeof window === "undefined" || typeof CustomEvent !== "function") {
      return;
    }

    const detail = {
      connected: false,
      label: "",
    };

    window.dispatchEvent(
      new CustomEvent(AVR_SERIAL_STATE_EVENT, {
        detail,
      })
    );
    window.dispatchEvent(
      new CustomEvent(LEGACY_SERIAL_STATE_EVENT, {
        detail,
      })
    );
  }

  function initUpdiBridge() {
    if (typeof window === "undefined") return;

    const bridge = {
      getHexArtifact: getUpdiHexArtifact,
      refreshCompileControls: () => updateCompilePanelState(false),
      isCanvasSerialConnected: () => false,
      getDetectedTargetKey: () => lastDetectedUpdiTargetKey || "",
      setDetectedTargetKey: (targetKey) => {
        lastDetectedUpdiTargetKey =
          typeof targetKey === "string" ? targetKey.trim() : "";
      },
    };

    window[AVR_UPDI_BRIDGE_KEY] = bridge;
    window[LEGACY_UPDI_BRIDGE_KEY] = bridge;
  }

  function resetHexArtifact() {
    lastHexContent = null;
    lastHexName = null;
    setHexStatus("idle");
    dispatchUpdiHexArtifact();
  }

  function getHexArtifactForFile(fileName) {
    return hexArtifactsBySource.get(fileName) || null;
  }

  function storeHexArtifact(fileName, hexText, hexName, sourceText, sourceKey) {
    if (!fileName || !hexText || !hexName) return;
    hexArtifactsBySource.set(fileName, {
      hexText,
      hexName,
      sourceText: String(sourceText || ""),
      sourceKey: String(sourceKey || sourceText || ""),
    });
  }

  function downloadHexArtifact(artifact) {
    if (!artifact || !artifact.hexText || !artifact.hexName) return false;
    const blob = new Blob([artifact.hexText], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = artifact.hexName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
    return true;
  }

  function downloadHex(fileName = current) {
    const artifact =
      getHexArtifactForFile(fileName) ||
      (fileName === current && lastHexContent && lastHexName
        ? { hexText: lastHexContent, hexName: lastHexName }
        : null);

    return downloadHexArtifact(artifact);
  }

  function syncFileFromEditor(fileName) {
    if (fileName && editor && current === fileName) {
      try {
        files[fileName] = editor.getValue();
        persistState();
      } catch {}
    }

    return String(fileName ? files[fileName] || "" : "");
  }

  function loadCompiledHexArtifact(updi, artifact) {
    if (!artifact || !artifact.hexText || !artifact.hexName) return false;

    lastHexContent = artifact.hexText;
    lastHexName = artifact.hexName;
    updateHexUI(true);
    setHexStatus("ready", lastHexName);
    loadHexIntoUpdiRuntime(updi, lastHexName, lastHexContent, "compiled");
    dispatchUpdiHexArtifact();
    return true;
  }

  async function ensureCurrentCompiledHexLoaded(updi) {
    const fileName = current;

    if (!fileName || !hasFile(fileName) || !isCFileName(fileName)) {
      return await compileCurrentFile();
    }

    syncFileFromEditor(fileName);
    const sourceKey = buildCompileProjectSnapshot(fileName).sourceKey;
    const cachedArtifact = getHexArtifactForFile(fileName);

    if (cachedArtifact && cachedArtifact.sourceKey === sourceKey) {
      return loadCompiledHexArtifact(updi, cachedArtifact);
    }

    const compiled = await compileCurrentFile();
    if (!compiled || current !== fileName) return false;

    return loadCompiledHexArtifact(updi, getHexArtifactForFile(fileName));
  }

  async function downloadHexForFile(fileName) {
    if (!fileName || !/\.c$/i.test(fileName)) return;

    syncFileFromEditor(fileName);
    const sourceKey = buildCompileProjectSnapshot(fileName).sourceKey;
    const artifact = getHexArtifactForFile(fileName);
    if (artifact && artifact.sourceKey === sourceKey) {
      downloadHexArtifact(artifact);
      return;
    }

    if (current !== fileName) {
      selectFile(fileName);
    }

    const compiled = await compileCurrentFile();
    if (compiled) {
      downloadHex(fileName);
    }
  }

  async function legacyCompileCurrentFile() {
    // Ensure we have a .c file open
    if (!current || !hasFile(current)) {
      await showSiteAlert("No open file.", "Compile");
      // Mark the HEX status as failed.
      try {
        if (typeof setHexStatus === "function") setHexStatus("error");
      } catch {}
      try {
        updateHexUI(false);
      } catch {}
      return;
    }
    if (!/\.c$/i.test(current)) {
      await showSiteAlert(
        "Only *.c files can be compiled. Select a .c file.",
        "Compile"
      );
      try {
        if (typeof setHexStatus === "function") setHexStatus("error");
      } catch {}
      try {
        updateHexUI(false);
      } catch {}
      return;
    }

    // Persist editor buffer just in case
    try {
      if (editor && current) files[current] = editor.getValue();
    } catch {}

    // Read compile options if present in UI, fallback to defaults
    const mcuEl = document.getElementById("mcuSelect");
    const optEl = document.getElementById("optimizeSelect");
    let selectedMcu = mcuEl && mcuEl.value ? mcuEl.value.trim() : "attiny1624";

    if (selectedMcu === "auto") {
      const bridge =
        typeof window !== "undefined"
          ? window[AVR_UPDI_BRIDGE_KEY] || window[LEGACY_UPDI_BRIDGE_KEY]
          : null;
      const detectedMcu =
        bridge && typeof bridge.getDetectedTargetKey === "function"
          ? String(bridge.getDetectedTargetKey() || "").trim()
          : "";

        if (!detectedMcu) {
          await showSiteAlert(
            "Auto detect could not resolve a supported chip. Check the UPDI connection or choose a concrete MCU before compiling.",
            "Auto detect failed"
          );
        try {
          if (typeof setHexStatus === "function") setHexStatus("error");
        } catch {}
        try {
          updateHexUI(false);
        } catch {}
        return;
      }

      selectedMcu = detectedMcu;
    }

    const compileSnapshot = buildCompileProjectSnapshot(current);
    const payload = {
      filename: current,
      code: files[current],
      project_files: compileSnapshot.projectFiles,
      mcu: selectedMcu,
      optimize: optEl && optEl.value ? optEl.value.trim() : "O1",
    };

    // UI: button state + HEX status: building
    const btn = document.getElementById("compileBtn");
    const prevLabel = btn ? btn.textContent : "";
    try {
      if (btn) {
        btn.disabled = true;
        btn.textContent = "Compiling…";
      }
    } catch {}
    try {
      if (typeof setHexStatus === "function") setHexStatus("building");
    } catch {}
    try {
      updateHexUI(false);
    } catch {}

    // Reset last HEX
    try {
      lastHexContent = null;
      lastHexName = null;
    } catch {}
    dispatchUpdiHexArtifact();

    // Request compile
    let resp;
    try {
      resp = await fetch("/api/avr/compile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      console.error("Network error:", e);
      await showSiteAlert(
        "Failed to send code for compilation (network error).",
        "Compile failed"
      );
      try {
        if (typeof setHexStatus === "function") setHexStatus("error");
      } catch {}
      try {
        updateHexUI(false);
      } catch {}
      if (btn) {
        btn.disabled = false;
        btn.textContent = prevLabel || "Compile";
      }
      return;
    }

    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      console.error("Server error:", resp.status, txt);
      await showSiteAlert(
        "Compile server error: " + resp.status + (txt ? "\n" + txt : ""),
        "Compile failed"
      );
      try {
        if (typeof setHexStatus === "function") setHexStatus("error");
      } catch {}
      try {
        updateHexUI(false);
      } catch {}
      if (btn) {
        btn.disabled = false;
        btn.textContent = prevLabel || "Compile";
      }
      return;
    }

    // Parse JSON
    let data;
    try {
      data = await resp.json();
    } catch (e) {
      console.error("Bad JSON:", e);
      await showSiteAlert("Invalid response from compile server.", "Compile failed");
      try {
        if (typeof setHexStatus === "function") setHexStatus("error");
      } catch {}
      try {
        updateHexUI(false);
      } catch {}
      if (btn) {
        btn.disabled = false;
        btn.textContent = prevLabel || "Compile";
      }
      return;
    }

    // Validate payload
    if (!data || data.ok !== true || !data.hex) {
      const stderr =
        data && data.stderr ? String(data.stderr) : "unknown error";
      console.error("Compile failed:", stderr, data);
      await showSiteAlert("Compilation failed.\n" + stderr, "Compile failed");
      try {
        if (typeof setHexStatus === "function") setHexStatus("error");
      } catch {}
      try {
        updateHexUI(false);
      } catch {}
      if (btn) {
        btn.disabled = false;
        btn.textContent = prevLabel || "Compile";
      }
      return;
    }

    // Success: store HEX, name, update UI
    try {
      lastHexContent = data.hex;
      const base = current.replace(/\.c$/i, "");
      lastHexName = (data.hex_name && data.hex_name.trim()) || base + ".hex";
    } catch (e) {
      console.warn("HEX handling warning:", e);
    }

    try {
      updateHexUI(true);
    } catch {}
    try {
      if (typeof setHexStatus === "function")
        setHexStatus("ready", lastHexName);
    } catch {}
    dispatchUpdiHexArtifact();

    // Show warnings if any
    if (data.stderr && String(data.stderr).trim()) {
      console.warn("avr-gcc warnings:", data.stderr);
    }

    // Restore button
    if (btn) {
      btn.disabled = false;
      btn.textContent = prevLabel || "Compile";
    }
  }

  async function compileCurrentFile() {
    if (getCanvasUpdiRuntime()?.isBusy?.()) return false;
    const compileFileName = current;
    const btn = $("compileBtn");
    const restoreButton = () => updateCompilePanelState(false);
    const markCompileFailed = () => {
      setHexStatus("error");
      updateHexUI(false);
      restoreButton();
      return false;
    };

    clearCompileErrorHighlight();

    try {
      if (compileFileName && editor && current === compileFileName) {
        files[compileFileName] = editor.getValue();
      }
    } catch {}

    const compileSource = compileFileName ? files[compileFileName] : "";

    if (!compileFileName || !compileSource) {
      setCompileLogText("No open file to compile.");
      return markCompileFailed();
    }

    if (!/\.c$/i.test(compileFileName)) {
      setCompileLogText(
        `"${compileFileName}" is not a C source file. Only *.c files can be compiled.`
      );
      return markCompileFailed();
    }

    clearUpdiLog();
    setCompileLogText("Compiling ...");

    const mcuEl = $("mcuSelect");
    const optEl = $("optimizeSelect");
    let selectedMcu = mcuEl && mcuEl.value ? mcuEl.value.trim() : "attiny1624";

    if (selectedMcu === "auto") {
      try {
        const signatureInfo = await ensureAutoDetectedTarget();
        const detectedMcu =
          signatureInfo && signatureInfo.matchedTargetKey
            ? String(signatureInfo.matchedTargetKey).trim()
            : "";
        if (!detectedMcu) {
          throw new Error(
            "Auto detect could not resolve a supported chip. Check the UPDI connection or choose a concrete MCU before compiling."
          );
        }

        selectedMcu = detectedMcu;
      } catch (error) {
        setCompileLogText(
          error.message ||
            "Auto detect could not resolve a supported chip. Check the UPDI connection or choose a concrete MCU before compiling."
        );
        return markCompileFailed();
      }
    }

    const compileSnapshot = buildCompileProjectSnapshot(compileFileName);
    const payload = {
      filename: compileFileName,
      code: files[compileFileName],
      project_files: compileSnapshot.projectFiles,
      mcu: selectedMcu,
      optimize: optEl && optEl.value ? optEl.value.trim() : "O1",
    };

    if (btn) {
      btn.disabled = true;
      btn.textContent = "Compiling ...";
      btn.title = btn.textContent;
    }

    setHexStatus("building");
    updateHexUI(false);

    lastHexContent = null;
    lastHexName = null;
    dispatchUpdiHexArtifact();

    let resp;
    try {
      resp = await fetch("/api/avr/compile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      console.error("Network error:", error);
      setCompileLogText(
        `Failed to reach the compile server: ${error.message || String(error)}`
      );
      return markCompileFailed();
    }

    if (!resp.ok) {
      const rawText = await resp.text().catch(() => "");
      let errorData = null;
      try {
        errorData = rawText ? JSON.parse(rawText) : null;
      } catch {}

      console.error("Compile server error:", resp.status, errorData || rawText);
      showCompilerIssue(errorData, rawText, compileFileName);
      return markCompileFailed();
    }

    let data;
    try {
      data = await resp.json();
    } catch (error) {
      console.error("Bad JSON:", error);
      setCompileLogText("Invalid JSON response from compile server.");
      return markCompileFailed();
    }

    if (!data || data.ok !== true || !data.hex) {
      console.error("Compilation failed:", data);
      showCompilerIssue(data, "", compileFileName);
      return markCompileFailed();
    }

    lastHexContent = data.hex;
    {
      const base = compileFileName.replace(/\.c$/i, "");
      lastHexName = (data.hex_name && data.hex_name.trim()) || base + ".hex";
    }
    storeHexArtifact(
      compileFileName,
      lastHexContent,
      lastHexName,
      files[compileFileName],
      compileSnapshot.sourceKey
    );

    updateHexUI(true);
    setHexStatus("ready", lastHexName);
    dispatchUpdiHexArtifact();

    setCompileLogText("BUILD OK. Hex file available.");

    restoreButton();
    return true;
  }

  function boot() {
    loadState();
    restoreProjectAiLocalDirtyState();
    restoreProjectAiAccountSyncState();
    restoreProjectInstruction();
    const projectAiAuthReturn = consumeProjectAiAuthReturn();
    migrateLooseFilesToProjects();
    restoreWorkspaceLayout();
    renderOutliner();
    if (!current) current = getVisibleWorkspaceFileNames()[0] || null;
    initUpdiBridge();

    restoreDevicePanelState();
    bindUI();
    void renderBuiltInMiniProjectCards();
    if (projectAiAuthReturn) {
      window.setTimeout(() => projectInstructionEditor?.focus(), 0);
    }
    initEditor();
    renderProjectAiAuthReturn(projectAiAuthReturn);

    updateHexUI(false);
    dispatchCanvasSerialState();
    dispatchUpdiHexArtifact();
    selectFile(current);

    const bridge = window.UartDebugAvrMiniProjects;
    resolveMiniProjectBridgeReady?.(bridge);
    resolveMiniProjectBridgeReady = null;
    window.dispatchEvent(
      new CustomEvent(MINI_PROJECT_READY_EVENT, {
        detail: { bridge },
      })
    );
    projectAiBootComplete = true;
    void fetchProjectAiAuthSession().catch(() => {
      renderProjectAiAuthSession({ mode: "google", configured: false, authenticated: false });
    });
  }

  initMiniProjectBridge();
  document.addEventListener("DOMContentLoaded", boot);
})();
