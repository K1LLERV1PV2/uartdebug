// Desktop AVR projects with a specification, C program, code description and XC8 compilation.
(function () {
  const STORAGE_KEY = "ud_avr_programming_files_v1";
  const STORAGE_STATE = window.UartDebugWorkspacePersistence.KEY;
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
  const AVR_UPDI_BRIDGE_KEY = "__UARTDEBUG_AVR_PROGRAMMING_UPDI_BRIDGE__";
  const OUTLINER_DEFAULT_WIDTH = 305;
  const WORKSPACE_PANEL_COMPACT_WIDTH = 62;
  const WORKSPACE_PANEL_TRANSITION_MS = 320;
  const WORKSPACE_PANEL_MIN_WIDTH = 240;
  const DOCUMENTATION_DEFAULT_WIDTH = 360;
  const WORKSPACE_RESIZER_TOTAL_WIDTH = 42;
  const PROJECT_AI_COLUMN_DEFAULT_WIDTH = 318;
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
  const {
    WORKSPACE_PANEL_COMPACT_THRESHOLD,
    WORKSPACE_PANEL_COLLAPSE_DISTANCE,
    WORKSPACE_PANEL_REOPEN_DISTANCE,
    getCapsuleNotchPoints,
    snapWorkspacePanelSize,
    fitWorkspaceWidths,
    resizeWorkspacePanels,
    resizeWorkspaceBoundary,
    getWorkspaceResizePreview,
    balanceWorkspaceSpacing
  } = window.UartDebugAvrWorkspaceLayout;
  let resolveMiniProjectBridgeReady = null;
  const miniProjectBridgeReady = new Promise((resolve) => {
    resolveMiniProjectBridgeReady = resolve;
  });

  let editor = null;
  let files = Object.create(null);
  let fileAuthorship = Object.create(null);
  let miniProjects = Object.create(null);
  let current = null;
  let draftProjectConversation = null;
  let projectChatController = null;
  let hardwareFlow = null;
  let projectChatApplyingResponse = false;
  let saveTimer = null;
  let compileErrorLineHandle = null;
  let compileNotificationId = null;
  let compileTask = null;
  let unreadableWorkspaceRaw = null;
  let workspacePersistence = null;
  let workspaceGeneration = 0;
  let workspaceOwnershipLost = false;
  let workspaceLocalPending = false;
  const workspaceRecoveryLineage = window.UartDebugWorkspacePersistence.createId();
  let legacySyncMarkerRaw = null;
  let legacyDirtyMarkerRaw = null;
  let legacyCheckpoint = null;
  let projectAiNotificationId = null;
  let contextMenuFile = null;
  let contextMenuTrigger = null;
  let contextMenuScroll = null;
  let inlineFileEdit = null;
  let outlinerWidth = OUTLINER_DEFAULT_WIDTH;
  let outlinerPreferredWidth = OUTLINER_DEFAULT_WIDTH;
  let editorCollapsed = false;
  let workspaceEditorRefreshFrame = null;
  let documentationWidth = DOCUMENTATION_DEFAULT_WIDTH;
  let documentationPreferredWidth = DOCUMENTATION_DEFAULT_WIDTH;
  const workspacePanelMinWidths = Array(4).fill(WORKSPACE_PANEL_MIN_WIDTH);
  let documentationMarkerHandles = [];
  let documentationMarkerFrame = null;
  let documentationRenderTimer = null;
  let documentationTargetTimer = null;
  let documentationEditor = null;
  let documentationEditorSyncing = false;
  let documentationSaveTimer = null;
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
  let workspaceDraftCanvasRestored = false;
  let projectInstructionInstanceId = null;
  let projectInstructionScopeEpoch = 0;
  let projectInstructionStorageReadFailed = false;
  let projectInstructionRenderFrame = null;
  let projectInstructionEditor = null;
  let projectInstructionEditorSyncing = false;
  let projectInstructionCompositionActive = false;
  const markdownLiveEditors = new Map();
  let canvasSupportedDevices = null;
  let devicePanelState = "expanded";
  let devicePanelHeight = DEVICE_PANEL_EXPANDED_HEIGHT;
  let devicePanelTransitionTimer = null;
  let devicePanelControlAnimations = [];
  let projectAiAccountSaveTimer = null;
  let projectAiAccountWorkspacePromise = null;
  let projectAiAccountWorkspaceRetryTimer = null;
  let projectAiAccountWorkspaceRetryCount = 0;
  let projectAiAccountWorkspaceEpoch = 0;
  let projectAiAccountWorkspaceApplying = false;
  let projectAiBootComplete = false;
  let projectAiAccountSync = {
    ready: false,
    accountKey: "",
    revision: 0,
    dirty: false,
    saving: false,
    conflict: false,
    mutation: 0,
    retryCount: 0,
    localDirty: false,
    legacyInstructionRevision: null,
    rejectedMutation: null,
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
  let workspaceTransitionTimer = null;
  let pendingSpecificationReveal = null;
  let pendingTaskDialogueReveal = null;
  let workspaceTransitionFrame = null;
  const workspaceTextAnimations = new Map();
  const workspaceMotionScrollAnchors = new Map();
  let workspaceLayoutSettling = false;
  let panelActionContourFrame = null;
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
    if (workspaceTransitionTimer !== null) return;
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

  function reportCompilerStatus(message, { tone = "error", details = message, diagnostics = "", pending = false } = {}) {
    if (compileNotificationId) {
      window.UartDebugNotifications?.append(compileNotificationId, details, { message, tone, pending, ...(diagnostics ? { diagnostics } : {}) });
      return;
    }
    compileNotificationId = window.UartDebugNotifications?.notify({
      id: compileNotificationId || undefined, key: compileNotificationId ? undefined : null, title: "Compilation", message, details,
      source: compileNotificationId ? undefined : current || "AVR compiler", tone, pending, diagnostics,
    }) || compileNotificationId;
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
        typeof data.error === "string" ? data.error : data.error?.message,
        data.compile_stdout,
        data.stdout,
        data.message,
      );
    }
    const output = parts.filter(part => typeof part === "string" && part.trim());
    return sanitizeCompilerOutput(output.length ? output.join("\n") : rawText);
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
    const summary = `${issue.message}${issue.lineNumber ? ` (line ${issue.lineNumber}${issue.columnNumber ? `, column ${issue.columnNumber}` : ""})` : ""}`;
    reportCompilerStatus(summary, {
      details: [formatCompilerIssue(issue), collectCompilerErrorText(data, rawText)].filter(Boolean).join("\n\n"),
    });
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
    window.UartDebugNotifications?.notify({ title, message: String(message).split("\n")[0], details: message, tone: "error" });
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
    return window[AVR_UPDI_RUNTIME_KEY] || null;
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
      notificationId: options.notificationId,
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
      if (!error?.uartDebugNotificationId) window.UartDebugNotifications?.notify({
        title: "Chip detection", message: error.message || String(error), tone: "error",
      });
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
        if (!error?.uartDebugNotificationId) await showSiteAlert(
          `HEX load failed.\n${error.message || String(error)}`,
          "Flash MCU"
        );
        return;
      }
    } else {
      let ready = false;
      try {
        // Resolve the connected chip before choosing or compiling firmware.
        // The programmer checks the signature again immediately before erase.
        const info = await ensureAutoDetectedTarget();
        if (!info?.matchedTargetKey) {
          throw new Error(`The connected chip is not supported (${formatDeviceId(info?.deviceId) || "unknown signature"}). No firmware was prepared for flashing.`);
        }
        ready = await ensureCurrentCompiledHexLoaded(updi);
      } catch (error) {
        if (!error?.uartDebugNotificationId) await showSiteAlert(
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
        if (!error?.uartDebugNotificationId) await showSiteAlert(
          `UPDI port access failed.\n${error.message || String(error)}`,
          "Flash MCU"
        );
        return;
      }
    }

    try {
      await updi.programHex();
    } catch (error) {
      if (!error?.uartDebugNotificationId) await showSiteAlert(
        `Flash failed.\n${error.message || String(error)}`,
        "Flash MCU"
      );
    }
  }

  function updateCompilePanelState() {
    const btn = $("compileBtn");
    const hasCurrent = !!current;
    const canCompile = hasCurrent && /\.c$/i.test(current);
    const updiBusy = !!getCanvasUpdiRuntime()?.isBusy?.();
    const buttonLabel = "Compile";

    if (btn) {
      btn.textContent = buttonLabel;
      btn.title = buttonLabel;
      btn.disabled = !canCompile || updiBusy || !!compileTask || setHexStatus._state === "building";
    }

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
    const heading = $("fileTemplatesTitle");
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
            copy.dataset.tooltip = descriptor.summary;
            card.appendChild(copy);
          }
          return card;
        });
        const restoreFocus = !!document.activeElement && grid.contains(document.activeElement);
        grid.replaceChildren(...cards);
        if (heading) heading.hidden = cards.length === 0;
        grid.hidden = cards.length === 0;
        if (restoreFocus) cards[0]?.focus({ preventScroll: true });
        builtInMiniProjectCardsReady = true;
      } catch (error) {
        const noticeId = window.UartDebugNotifications?.notify({ key: "project-catalog", title: "Mini-projects", tone: "error",
          message: "Projects could not be loaded.", details: error.message || String(error) });
        const message = document.createElement("p");
        message.className = "ui-empty-state";
        message.textContent = "Mini projects are unavailable.";
        const retry = document.createElement("button");
        retry.type = "button";
        retry.className = "ui-action project-catalog-retry";
        retry.textContent = "Retry";
        retry.addEventListener("click", () => {
          if (noticeId) window.UartDebugNotifications?.dismiss(noticeId);
          retry.textContent = "Loading…";
          void renderBuiltInMiniProjectCards();
        });
        const restoreFocus = !!document.activeElement && grid.contains(document.activeElement);
        grid.replaceChildren(message, retry);
        if (heading) heading.hidden = false;
        grid.hidden = false;
        if (restoreFocus) retry.focus({ preventScroll: true });
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

  function getWorkspacePersistence() {
    return workspacePersistence ||= window.UartDebugWorkspacePersistence.create({ storage: localStorage });
  }

  function requireWorkspaceOwnership() {
    if (!workspaceOwnershipLost && getWorkspacePersistence().owns()) return true;
    workspaceOwnershipLost = true;
    projectAiAccountSync.dirty = true;
    projectAiAccountSync.localDirty = true;
    projectAiAccountSync.conflict = true;
    // Never replace a neighbouring tab's envelope or its sync markers. Keep
    // this tab's distinct unsent candidate outside routine backup pruning.
    const candidate = getProjectAiAccountFilesSnapshot({ captureLive: false });
    const chat = projectChatController?.getScopedSnapshot?.();
    if (chat?.scope.accountEpoch === projectAiAccountWorkspaceEpoch) {
      if (chat.scope.instanceId && miniProjects[chat.scope.instanceId]) {
        candidate.miniProjects[chat.scope.instanceId].conversation = chat.conversation;
      } else if (!chat.scope.instanceId) candidate.draftConversation = chat.conversation;
    }
    const preserved = saveProjectAiWorkspaceRecovery(candidate,
      projectAiAccountSync.accountKey, { protectedCopy: true, lineage: workspaceRecoveryLineage });
    window.UartDebugNotifications?.notify({ key: "workspace-ownership", title: "Project storage", tone: "warning",
      message: preserved
        ? "Another tab changed the saved projects. This copy is preserved in browser recovery. Keep this tab open to copy any needed unsaved text before reloading."
        : "Another tab changed the saved projects. Browser recovery could not be saved. Keep this tab open to copy your unsaved text." });
    return false;
  }

  function captureWorkspaceOperation(project = null) {
    return { generation: workspaceGeneration, project };
  }

  function assertWorkspaceOperation(operation, instanceId = null) {
    if (operation.generation !== workspaceGeneration ||
        (instanceId && miniProjects[instanceId] !== operation.project)) {
      throw new Error("The workspace changed before this action completed. No changes were applied.");
    }
    if (!requireWorkspaceOwnership()) throw new window.UartDebugWorkspacePersistence.OwnershipError();
  }

  function invalidateWorkspaceWriters() {
    workspaceGeneration += 1;
    if (saveTimer) window.clearTimeout(saveTimer);
    saveTimer = null;
    if (documentationSaveTimer) window.clearTimeout(documentationSaveTimer);
    documentationSaveTimer = null;
    for (const scope of projectInstructionSaveJobs.keys()) cancelProjectInstructionSave(scope);
    inlineFileEdit = null;
    closeFileContextMenu();
  }

  function loadState() {
    let loadedEnvelope = false;
    let legacyGroups = {};
    let rawState = null;
    workspaceDraftCanvasRestored = false;
    draftProjectConversation = null;
    try {
      const syncMarkerBeforeLoad = localStorage.getItem(STORAGE_PROJECT_AI_ACCOUNT_SYNC);
      const dirtyMarkerBeforeLoad = localStorage.getItem(STORAGE_PROJECT_AI_LOCAL_DIRTY);
      const saved = getWorkspacePersistence().load();
      // Trust unbound migration markers only for the source actually loaded:
      // a legacy envelope, or the older split-key/empty workspace fallback.
      if (saved.migratedFrom || saved.raw === null) {
        legacySyncMarkerRaw = syncMarkerBeforeLoad;
        legacyDirtyMarkerRaw = dirtyMarkerBeforeLoad;
        legacyCheckpoint = saved.sourceCheckpoint;
      }
      rawState = saved.raw;
      if (rawState) {
        const state = saved.data;
        if (
          state &&
          [2, 3].includes(state.schemaVersion) &&
          state.files &&
          typeof state.files === "object" &&
          !Array.isArray(state.files)
        ) {
          files = state.files;
          fileAuthorship =
            state.authorship && typeof state.authorship === "object"
              ? state.authorship
              : {};
          legacyGroups = state.fileGroups || {};
          miniProjects =
            state.miniProjects && typeof state.miniProjects === "object"
              ? state.miniProjects
              : {};
          current = typeof state.current === "string" ? state.current : null;
          if (state.draftConversation) draftProjectConversation = normalizeProjectConversation(state.draftConversation, { recoverPending: true });
          for (const project of Object.values(miniProjects)) {
            if (project?.conversation) normalizeProjectConversation(project.conversation, { recoverPending: true });
          }
          if (state.schemaVersion === 3 && state.draftCanvas && typeof state.draftCanvas === "object") {
            unassignedProjectInstructionDocument = normalizeProjectInstructionDocument(state.draftCanvas);
            workspaceDraftCanvasRestored = true;
          }
          loadedEnvelope = true;
        } else {
          throw new Error("The saved workspace has an unsupported format.");
        }
      }
    } catch (error) {
      loadedEnvelope = false;
      rawState = workspacePersistence?.sourceRaw ?? rawState;
      if (rawState) {
        unreadableWorkspaceRaw = rawState;
        preserveUnreadableWorkspace(error);
      } else {
        window.UartDebugNotifications?.notify({ key: "workspace-read", title: "Project storage", tone: "error",
          message: "The saved projects could not be read.",
          details: "Check browser storage access and reload before editing your projects.", diagnostics: error?.stack || String(error) });
      }
    }

    if (!loadedEnvelope) {
      try {
        const storedFiles =
          localStorage.getItem(STORAGE_KEY) ??
          localStorage.getItem(LEGACY_STORAGE_KEY) ??
          "{}";
        files = JSON.parse(storedFiles || "{}");
        fileAuthorship = {};
        legacyGroups = JSON.parse(localStorage.getItem(STORAGE_GROUPS) || "{}");
        current =
          localStorage.getItem(STORAGE_CURRENT) ??
          localStorage.getItem(LEGACY_STORAGE_CURRENT) ??
          null;
      } catch {
        files = Object.create(null);
        fileAuthorship = Object.create(null);
        legacyGroups = {};
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
    normalizeMiniProjectInstances();
    if (current && !hasFile(current)) current = null;
    return legacyGroups;
  }

  function preserveUnreadableWorkspace(error = null) {
    if (unreadableWorkspaceRaw === null) return true;
    try {
      const base = `${STORAGE_PROJECT_AI_FILES_RECOVERY}:unreadable-workspace`;
      let recoveryKey = base;
      const previous = localStorage.getItem(recoveryKey);
      let previousRaw = null;
      try { previousRaw = previous && JSON.parse(previous).rawWorkspace; } catch {}
      if (previous && previousRaw !== unreadableWorkspaceRaw) {
        const suffix = Date.now();
        let index = 0;
        do { recoveryKey = `${base}:${suffix}-${index++}`; } while (localStorage.getItem(recoveryKey) !== null);
      }
      localStorage.setItem(recoveryKey, JSON.stringify({ schemaVersion: 1, savedAt: Date.now(),
        sourceAccountKey: "browser-local", rawWorkspace: unreadableWorkspaceRaw }));
      unreadableWorkspaceRaw = null;
      window.UartDebugNotifications?.notify({ key: "workspace-read", title: "Project storage", tone: "warning",
        message: "The saved projects could not be loaded.",
        details: "The original saved data has been preserved in this browser as a recovery copy.",
        diagnostics: [`Recovery storage key: ${recoveryKey}`, error?.stack || ""].filter(Boolean).join("\n\n") });
      return true;
    } catch (recoveryError) {
      window.UartDebugNotifications?.notify({ key: "workspace-read", title: "Project storage", tone: "error",
        message: "The saved projects could not be loaded safely.",
        details: "The original saved data was kept unchanged. Saving and account synchronization are paused. Free browser storage and reload before editing.",
        diagnostics: recoveryError?.stack || String(recoveryError) });
      return false;
    }
  }

  function persistState({ throwOnError = false } = {}) {
    if (!preserveUnreadableWorkspace()) {
      if (throwOnError) throw new Error("The original workspace could not be preserved for recovery.");
      return false;
    }
    let changed = false;
    let emptyBaseline = false;
    try {
      if (!requireWorkspaceOwnership()) throw new window.UartDebugWorkspacePersistence.OwnershipError();
      adoptConfirmedWorkspaceRevision();
      const snapshot = getProjectAiAccountFilesSnapshot({ captureLive: false });
      emptyBaseline = !getWorkspacePersistence().checkpoint && !hasMeaningfulProjectAiLocalWorkspace(snapshot);
      changed = getWorkspacePersistence().write(snapshot).changed;
      workspaceLocalPending = false;
    } catch (error) {
      console.warn("Failed to persist AVR workspace state:", error);
      window.UartDebugNotifications?.notify({ key: "workspace-save", title: "Project storage", tone: "error",
        message: "Projects could not be saved in this browser.", details: error.message || String(error) });
      if (throwOnError) throw error;
      return false;
    }
    // The envelope is the only live workspace store. Old split keys are read
    // solely for migration and are discarded only after the atomic write.
    try {
      for (const key of [STORAGE_KEY, LEGACY_STORAGE_KEY, STORAGE_GROUPS,
        STORAGE_MINI_PROJECTS, STORAGE_CURRENT, LEGACY_STORAGE_CURRENT,
        STORAGE_PROJECT_INSTRUCTION, STORAGE_PROJECT_INSTRUCTION_LEGACY]) {
        if (projectInstructionStorageReadFailed && [STORAGE_PROJECT_INSTRUCTION, STORAGE_PROJECT_INSTRUCTION_LEGACY].includes(key)) continue;
        localStorage.removeItem(key);
      }
    } catch (error) {
      console.warn("Failed to remove migrated AVR storage keys:", error);
    }
    workspaceDraftCanvasRestored = true;
    if (
      changed && !emptyBaseline && projectAiBootComplete &&
      !projectAiAccountWorkspaceApplying
    ) {
      markProjectAiAccountWorkspaceDirty({ pending: false });
    }
    // A changed checkpoint must carry its own markers, including when an
    // editor already marked the previous checkpoint dirty before debouncing.
    persistProjectAiLocalDirtyState();
    persistProjectAiAccountSyncState();
    return true;
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
      if (origin === "builtin" && guides.en) {
        defaultLocale = "en";
        selectedLocale = "en";
      }
      if (selectedLocale && guides[selectedLocale]) {
        roleFiles.guide = guides[selectedLocale].fileName;
        mediaTypes.guide = guides[selectedLocale].mediaType;
      } else {
        delete roleFiles.guide;
        delete mediaTypes.guide;
      }

      const contract = rawProject.contract === projectFormat.V3_CONTRACT ? projectFormat.V3_CONTRACT : projectFormat.V2_CONTRACT;
      const title = String(rawProject.title || rawProject.definitionId || instanceId);
      normalized[instanceId] = {
        schemaVersion: 1,
        contract,
        definitionId,
        title,
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
        ...(contract === projectFormat.V3_CONTRACT ? {
          referenceFiles: projectFormat.normalizeReferenceFiles(rawProject.referenceFiles, title),
        } : {}),
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
        ...(rawProject.conversation ? { conversation: normalizeProjectConversation(rawProject.conversation, { recoverPending: true }) } : {}),
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

  function isCFileName(fileName) {
    return /\.c$/i.test(fileName || "");
  }

  function getMarkdownEditorMode() {
    return {
      name: "markdown",
      highlightFormatting: true,
      fencedCodeBlockHighlighting: false,
      strikethrough: true,
      taskLists: true,
      xml: false,
    };
  }

  function getEditorModeForFile(fileName) {
    if (isCFileName(fileName)) return "text/x-csrc";
    if (/\.md$/i.test(fileName || "")) return getMarkdownEditorMode();
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
    const includePattern = /^[ \t\v\f\r]*#[ \t\v\f\r]*include[ \t\v\f\r]*"([^"\r\n]+)"/gm;
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

  function buildCompileProjectSnapshot(entryName, targetMcu = getCanvasTarget().mcu) {
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
      sourceKey: JSON.stringify({ mcu: targetMcu, projectFiles }),
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

  function openFilesModal() {
    const modal = $("filesModal");
    if (!modal || !modal.hidden) return;
    closeFileContextMenu();
    void renderBuiltInMiniProjectCards();
    $("filesOpenBtn")?.setAttribute("aria-expanded", "true");
    openWorkspaceModal(modal, {
      trigger: $("filesOpenBtn"),
      focusTarget: () => {
        const list = $("fileList");
        const row = list?.querySelector(".file-item.active") || list?.querySelector(".file-item");
        row?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
        return row || $("createEmptyProjectCard");
      },
      onClose: () => {
        const menu = $("fileContextMenu");
        if (menu?.style.display === "block") closeFileContextMenu({ restoreFocus: true });
        else closeFilesModal();
      },
    });
  }

  function closeFilesModal() {
    if (inlineFileEdit) cancelInlineFileEdit();
    closeFileContextMenu();
    closeWorkspaceModal($("filesModal"));
    $("filesOpenBtn")?.setAttribute("aria-expanded", "false");
  }

  function bindFilesModal() {
    $("filesOpenBtn")?.addEventListener("click", openFilesModal);
    $("filesCloseBtn")?.addEventListener("click", closeFilesModal);
    $("filesModal")?.addEventListener("click", event => {
      if (event.target === $("filesModal")) closeFilesModal();
    });
    document.addEventListener("scroll", event => {
      const menu = $("fileContextMenu");
      if (menu?.style.display !== "block" || menu.contains(event.target)) return;
      if (window.UartDebugControls.hasMenuScrollChanged(contextMenuScroll, event)) closeFileContextMenu();
    }, true);
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
    const lastDot = cleanName.lastIndexOf(".");
    const hasExtension = lastDot > 0;
    const stem = hasExtension ? cleanName.slice(0, lastDot) : cleanName;
    const extension = hasExtension ? cleanName.slice(lastDot) : "";
    const withSuffix = (suffix) => {
      const available = 96 - extension.length - suffix.length;
      if (available < 1) throw new Error("The file extension is too long to allocate a unique name.");
      return stem.slice(0, available) + suffix + extension;
    };
    const initial = withSuffix("");
    if (!hasFile(initial) && !reservedNames.has(initial)) return initial;
    let index = 2;
    let candidate = withSuffix(`_${index}`);

    while (hasFile(candidate) || reservedNames.has(candidate)) {
      index += 1;
      candidate = withSuffix(`_${index}`);
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
      contract: project.contract || projectFormat.V2_CONTRACT,
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
      ...(project.contract === projectFormat.V3_CONTRACT ? {
        referenceFiles: projectFormat.normalizeReferenceFiles(project.referenceFiles, project.title),
      } : {}),
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

    const previousName = project.displayName;
    project.displayName = name;
    try {
      persistState({ throwOnError: true });
    } catch (error) {
      project.displayName = previousName;
      throw error;
    }
    renderOutliner();
    refreshDocumentationPane({ preserveScroll: true });
    projectChatController?.refresh();
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
    const previousProjects = miniProjects;
    const previousCurrent = current;
    let selectionStarted = false;

    if (editor && previousCurrent && hasFile(previousCurrent)) {
      previousFiles[previousCurrent] = editor.getValue();
    }

    files = createDictionary(files);
    fileAuthorship = createDictionary(fileAuthorship);
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
        contract: definition.contract,
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
        ...(definition.contract === projectFormat.V3_CONTRACT ? { referenceFiles: definition.referenceFiles } : {}),
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
      closeFilesModal();
      return getPublicMiniProjectInstance(instanceId);
    } catch (error) {
      files = previousFiles;
      fileAuthorship = previousAuthorship;
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
      contract: live.contract === projectFormat.V3_CONTRACT ? live.contract : rawDefinition.contract || live.contract,
      referenceFiles: live.referenceFiles,
      defaultLocale: allGuides.some(file => file.locale === defaultLocale)
        ? defaultLocale : incomingGuides[0]?.locale || allGuides[0]?.locale || "en",
    });
    const previous = { files, fileAuthorship, miniProjects, current };
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
      project.contract = definition.contract;
      if (definition.contract === projectFormat.V3_CONTRACT) {
        project.referenceFiles = definition.referenceFiles;
        if (existing.contract !== projectFormat.V3_CONTRACT) {
          const placeholder = project.files.guide;
          if (placeholder && !files[placeholder].trim()) {
            project.fileNames[placeholder] = definition.title + ".Description.md";
          }
        }
      }
      project.displayName = existing.displayName && existing.displayName !== existing.title
        ? existing.displayName : rawDefinition.displayName || definition.title;
      project.summary = definition.summary;
      project.version = definition.version;
      project.canvasName = definition.canvasName || project.canvasName;
      project.projectPath = definition.projectPath || project.projectPath;
      selectFile(project.files.source);
      persistState({ throwOnError: true });
      return getPublicMiniProjectInstance(id);
    } catch (error) {
      ({ files, fileAuthorship, miniProjects, current } = previous);
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
        const operation = captureWorkspaceOperation();
        await miniProjectBridgeReady;
        try {
          assertWorkspaceOperation(operation);
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
        const operation = captureWorkspaceOperation(miniProjects[instanceId]);
        await miniProjectBridgeReady;
        try {
          assertWorkspaceOperation(operation, instanceId);
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
    const operation = captureWorkspaceOperation();
    const definition = await loadBuiltInMiniProjectDefinition(templateId);
    if (!definition) return false;
    assertWorkspaceOperation(operation);
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

  function loadHexIntoUpdiRuntime(updi, fileName, hexText, source = "uploaded", targetMcu = "") {
    const normalizedHex = String(hexText || "").replace(/\r\n/g, "\n");

    if (!normalizedHex.trim()) {
      throw new Error("HEX file is empty.");
    }

    if (updi && typeof updi.loadHexFile === "function") {
      updi.loadHexFile(normalizedHex, fileName, source, targetMcu);
      return;
    }

    dispatchHexArtifact({
      hexText: normalizedHex,
      fileName,
      source,
      targetMcu,
    });
  }

  async function handleUploadedFile(file) {
    if (!file) return;
    const operation = captureWorkspaceOperation();
    const fileKind = resolveUploadedFileKind(file.name);
    if (fileKind === "mini-project-archive") {
      const archiveApi = window.UartDebugAvrMiniProjectArchive;
      if (!archiveApi?.parseMiniProjectArchive) {
        throw new Error("Mini-project archive support is not available.");
      }
      const definition = await archiveApi.parseMiniProjectArchive(file, {
        limits: MINI_PROJECT_ARCHIVE_WORKSPACE_LIMITS,
      });
      assertWorkspaceOperation(operation);
      installMiniProjectDefinition(definition, { origin: "archive" });
      if (definition.importWarnings?.length) {
        reportProjectCanvasMessage("warning", definition.importWarnings.join("\n"));
      }
      return;
    }



    const message =
      'Import a project archive (.zip).';
    await showSiteAlert(message, "Unsupported file");
    console.warn(`Import rejected: "${file.name}" has an unsupported extension.`);
  }


  function migrateLooseFilesToProjects(legacyGroups = {}) {
    // Groups are read only during migration. Preserve their direct guide links
    // in projects, then discard the old presentation tree and expansion state.
    const groupedGuides = new Map();
    const assigned = new Set();
    for (const group of Object.values(legacyGroups || {})) {
      const members = (Array.isArray(group?.files) ? group.files : []).map(name => String(name || "").trim())
        .filter(name => {
          if (!name || !hasFile(name) || assigned.has(name)) return false;
          assigned.add(name);
          return true;
        });
      const guide = members.find(name => /\.md$/i.test(name) && !isAiSpecMarkdownFile(name));
      if (guide) for (const source of members.filter(name => /\.c$/i.test(name))) groupedGuides.set(source, guide);
    }
    const loose = Object.keys(files).filter(name => !getMiniProjectForFile(name));
    if (loose.length === 1 && loose[0] === "main.c" && !files["main.c"]) {
      delete files["main.c"];
      delete fileAuthorship["main.c"];
      if (current === "main.c") current = null;
    }
    for (const name of Object.keys(files).filter(name => /\.c$/i.test(name))) {
      const linked = getMiniProjectForFile(name);
      const existing = linked?.role === miniProjectCore.ROLES.SOURCE ? linked.project : null;
      if (linked && !existing) continue;
      if (existing && (getMiniProjectGuideEntries(existing).length || !groupedGuides.has(name))) continue;
      const stem = getFileStem(name);
      const guide = [`${stem}.guide.md`, `${stem}.md`, `${stem}_help.md`]
        .map(findFileNameCaseInsensitive).find(file => file && !isAiSpecMarkdownFile(file)) || groupedGuides.get(name);
      let guideName = guide;
      if (!guide || getMiniProjectForFile(guide)) {
        guideName = uniqueReservedFileName(guide || stem + " (description).md", new Set());
        files[guideName] = guide ? files[guide] : "";
        if (guide && fileAuthorship[guide]) fileAuthorship[guideName] = cloneJsonMetadata(fileAuthorship[guide], null);
      }
      const locale = projectFormat.inferLocale(files[guideName], "und");
      const guides = { [locale]: { locale, fileName: guideName, label: locale, mediaType: "text/markdown" } };
      if (existing) {
        existing.files.guide = guideName;
        existing.guides = guides;
        existing.defaultLocale = existing.selectedLocale = locale;
        existing.fileNames[guideName] = guideName;
        continue;
      }
      const instanceId = uniqueMiniProjectInstanceId(stem);
      const resource = loose.find(file => /\.ya?ml$/i.test(file) && getFileStem(file) === stem && !getMiniProjectForFile(file));
      miniProjects[instanceId] = {
        schemaVersion: 1, contract: "uartdebug-project/v2", definitionId: stem,
        title: stem, displayName: stem, summary: "", version: "", origin: "migrated",
        canvasName: stem + ".md", projectPath: "Target_Projects/" + stem,
        files: { source: name, guide: guideName, ...(resource ? { specification: resource } : {}) },
        guides, defaultLocale: locale, selectedLocale: locale, mediaTypes: {},
        fileNames: { [name]: name, [guideName]: guideName },
        canvas: [name, guide, resource].includes(current)
          ? getUnassignedProjectInstructionSnapshot() : normalizeProjectInstructionDocument(null),
      };
    }
    // Keep all unclaimed legacy files in storage/recovery; show only projects.
    if (current && isHiddenMiniProjectFile(current)) current = getMiniProjectForFile(current)?.project.files.source || getVisibleWorkspaceFileNames()[0] || null;
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
    if (duplicateProject || hasFile(name)) {
      return "A file or mini-project with this name already exists.";
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
    input.className = "file-inline-input ui-text-input";
    input.type = "text";
    input.value = edit.value || "";
    input.spellcheck = false;
    input.setAttribute("aria-label", "Project display name");
    input.setAttribute("aria-invalid", String(!!edit.error));
    input.title = "Changes the project label only. The specification defines its name and file names.";

    input.addEventListener("click", (event) => event.stopPropagation());
    input.addEventListener("input", () => {
      if (!inlineFileEdit) return;
      inlineFileEdit.value = input.value;
      inlineFileEdit.error = "";
      input.setAttribute("aria-invalid", "false");
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
    row.appendChild(editorWrap);
  }

  function getCanvasSplitContainer() {
    return document.querySelector(".canvas-split-container");
  }

  // Dividers resize adjacent panels; a closed neighbor passes spare width to an
  // expanded pane so compact panels can be reopened independently.
  function getWorkspacePanelSpecs() {
    return workspacePanelMinWidths.map((_, index) => ({
      min: getWorkspacePanelMinWidth(index),
      compact: WORKSPACE_PANEL_COMPACT_WIDTH,
    }));
  }

  function getWorkspaceContentWidth() {
    const container = getCanvasSplitContainer();
    const specs = getWorkspacePanelSpecs();
    const style = container && window.getComputedStyle?.(container);
    const gaps = ["--outliner-resizer-width", "--project-ai-resizer-width", "--documentation-resizer-width"]
      .map(property => Number.parseFloat(style?.getPropertyValue?.(property)));
    const dividerWidth = gaps.every(Number.isFinite)
      ? gaps.reduce((sum, width) => sum + width, 0) : WORKSPACE_RESIZER_TOTAL_WIDTH;
    return Math.max(
      specs.reduce((total, spec) => total + spec.compact, 0) +
        Math.max(...specs.map(spec => spec.min - spec.compact)),
      Math.round(container?.getBoundingClientRect().width || 0) -
        dividerWidth
    );
  }

  function getWorkspaceWidths() {
    return [
      outlinerWidth,
      projectAiColumnWidth,
      editorCollapsed ? WORKSPACE_PANEL_COMPACT_WIDTH :
        getWorkspaceContentWidth() - outlinerWidth - projectAiColumnWidth - documentationWidth,
      documentationWidth,
    ];
  }

  function renderWorkspaceBoundary(start, specs, boundary, delta, options) {
    const sizes = resizeWorkspaceBoundary(start, specs, boundary, delta);
    const applied = renderWorkspaceWidths(sizes, options);
    const growing = delta > 0 ? boundary : boundary + 1;
    const shrinking = delta > 0 ? boundary + 1 : boundary;
    const reopening = delta && Math.abs(delta) >= WORKSPACE_PANEL_REOPEN_DISTANCE &&
      start[growing] === specs[growing].compact;
    if (applied && (!reopening || sizes[growing] !== specs[growing].compact)) return true;
    if (!reopening || start[shrinking] === specs[shrinking].compact) return applied;
    // The pane body can fit while its newly opened divider still needs space.
    const adjacentClosed = resizeWorkspaceBoundary(start, specs, boundary, delta, true);
    if (adjacentClosed[growing] === specs[growing].compact) return applied;
    return renderWorkspaceWidths(adjacentClosed, options);
  }


  function getWorkspacePanelMinWidth(index) {
    const panel = getCanvasSplitContainer()?.querySelectorAll(
      ":scope > :is(.outliner, .project-ai-layout, .editor-workspace, .documentation-workspace)"
    )[index];
    const strip = panel?.querySelector(".ui-panel-header");
    if (!strip || !panel || !window.getComputedStyle) return workspacePanelMinWidths[index];
    if (strip.dataset.toolbarLayout === "vertical") {
      const host = strip.closest(".panel-action-host") || panel;
      const hostStyle = window.getComputedStyle(host);
      const configured = Number.parseFloat(hostStyle?.getPropertyValue?.("--panel-action-min-width"));
      const trailingSpace = Number.parseFloat(hostStyle?.getPropertyValue?.("--panel-action-trailing-space")) || 0;
      if (Number.isFinite(configured)) {
        workspacePanelMinWidths[index] = Math.max(WORKSPACE_PANEL_COMPACT_WIDTH + 1, Math.ceil(configured + trailingSpace));
      }
      return workspacePanelMinWidths[index];
    }
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
      window.UartDebugNotifications?.notify({ key: "layout-save", title: "Workspace", tone: "warning",
        message: "Window sizes could not be saved.", details: error.message || String(error) });
    }
  }

  function persistEditorCollapsed() {
    try { localStorage.setItem(STORAGE_EDITOR_COLLAPSED, String(editorCollapsed)); } catch {}
  }

  function refreshWorkspaceEditor(codeMirror) {
    if (!codeMirror) return;
    const wrapper = codeMirror.getWrapperElement?.();
    if (wrapper?.getClientRects && !wrapper.getClientRects().length) return;
    codeMirror.refresh();
    // A reopened CM5 viewport can retain its scroll offset while its native
    // scrollbar is still at zero. Synchronize them before queued scroll events.
    const scroller = codeMirror.getScrollerElement?.();
    if (!scroller) return;
    const vertical = wrapper?.querySelector(".CodeMirror-vscrollbar");
    const horizontal = wrapper?.querySelector(".CodeMirror-hscrollbar");
    if (vertical) vertical.scrollTop = scroller.scrollTop;
    if (horizontal) horizontal.scrollLeft = scroller.scrollLeft;
  }

  function settleWorkspaceEditors(anchors = new Map(), editors = [editor, documentationEditor, projectInstructionEditor]) {
    if (workspaceLayoutSettling) return;
    workspaceLayoutSettling = true;
    try {
      for (const codeMirror of editors) {
        if (!codeMirror) continue;
        const wrapper = codeMirror.getWrapperElement?.();
        if (wrapper?.getClientRects && !wrapper.getClientRects().length) continue;
        const state = [...markdownLiveEditors.values()].find(item => item.editor === codeMirror);
        const anchor = anchors.get(codeMirror) || captureMarkdownLiveScrollAnchor(codeMirror);
        if (state?.frame != null) window.cancelAnimationFrame?.(state.frame);
        if (state) state.frame = null;
        refreshWorkspaceEditor(codeMirror);
        if (state && !state.compositionActive) {
          // Refresh can change the visible source range after Markdown wraps.
          // Complete that range before this task yields to the next paint.
          for (let pass = 0; pass < 2; pass += 1) {
            const before = codeMirror.getViewport();
            renderMarkdownLivePreviewState(state);
            refreshWorkspaceEditor(codeMirror);
            const after = codeMirror.getViewport();
            if (before.from === after.from && before.to === after.to) break;
          }
        }
        restoreMarkdownLiveScrollAnchor(codeMirror, anchor);
        refreshWorkspaceEditor(codeMirror);
      }
    } finally {
      workspaceLayoutSettling = false;
    }
  }

  function refreshWorkspaceEditors() {
    if (workspaceEditorRefreshFrame !== null) return;
    workspaceEditorRefreshFrame = window.requestAnimationFrame(() => {
      workspaceEditorRefreshFrame = null;
      if (workspaceTransitionTimer !== null) {
        updatePanelActionContours();
        return;
      }
      settleWorkspaceEditors();
      document.querySelectorAll(".canvas-split-container .custom-select").forEach(custom => {
        if (custom.getClientRects().length) updateCustomSelectIntrinsicWidth(custom);
      });
      fitEditorFileWatermark();
      updatePanelActionContours();
    });
  }

  function finishWorkspaceTransition() {
    const completing = workspaceTransitionTimer !== null;
    const anchors = new Map(workspaceMotionScrollAnchors);
    workspaceMotionScrollAnchors.clear();
    if (workspaceTransitionFrame !== null) {
      window.cancelAnimationFrame?.(workspaceTransitionFrame);
      workspaceTransitionFrame = null;
    }
    if (workspaceTransitionTimer !== null) {
      window.clearTimeout?.(workspaceTransitionTimer);
      workspaceTransitionTimer = null;
    }
    const container = getCanvasSplitContainer();
    container?.classList.remove("is-workspace-transitioning");
    container?.style.removeProperty("grid-template-columns");
    for (const element of container?.querySelectorAll("[data-workspace-motion-content]") || []) {
      element.removeAttribute("data-workspace-motion-content");
      element.style.removeProperty("--workspace-content-width");
    }
    for (const element of container?.querySelectorAll("[data-workspace-motion-clip]") || []) {
      element.removeAttribute("data-workspace-motion-clip");
      element.style.removeProperty("--workspace-content-overflow-x");
    }
    syncWorkspaceCompactState(getWorkspaceWidths());
    for (const cue of container?.querySelectorAll(".pane-collapse-cue") || []) {
      if (cue.parentElement?.getBoundingClientRect().width <= WORKSPACE_PANEL_COMPACT_THRESHOLD) cue.remove();
    }
    if (completing) {
      settleWorkspaceEditors(anchors);
      fitEditorFileWatermark();
      updatePanelActionContours();
    }
    for (const [element, animation] of workspaceTextAnimations) {
      if (!completing) {
        animation.cancel();
        element.removeAttribute("data-workspace-text-motion");
        continue;
      }
      // The old wrapping is fully transparent before the layout lock is
      // released. Reveal the reconciled text without exposing that change.
      const reveal = element.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: 110, easing: "ease-out",
      });
      animation.cancel();
      element.dataset.workspaceTextMotion = "revealing";
      workspaceTextAnimations.set(element, reveal);
      reveal.finished.then(() => {
        if (workspaceTextAnimations.get(element) !== reveal) return;
        workspaceTextAnimations.delete(element);
        element.removeAttribute("data-workspace-text-motion");
      }).catch(() => {});
    }
    if (!completing) workspaceTextAnimations.clear();
    if (completing && pendingSpecificationReveal) {
      const instruction = pendingSpecificationReveal;
      pendingSpecificationReveal = null;
      window.requestAnimationFrame(() => revealSpecificationQuestions(instruction));
    }
  }

  function measureWorkspaceContent() {
    const measurements = new Map();
    const container = getCanvasSplitContainer();
    // Text retains its layout while the surrounding frames resize.
    const selectors = ["#projectChatTitle, .project-chat-message-content, #projectChatInput, .project-chat-edit textarea, .project-chat-edit-note, .project-chat-history-title, .project-chat-history-preview, .project-chat-history-date",
      ".CodeMirror-code, #projectInstructionEditor",
      ".CodeMirror-code, #editorFileWatermark",
      ".CodeMirror-code, #projectDocumentationEditor"];
    const panels = container?.querySelectorAll(
      ":scope > :is(.outliner, .project-ai-layout, .editor-workspace, .documentation-workspace)");
    panels?.forEach((panel, index) => {
      for (const element of panel.querySelectorAll(selectors[index])) {
        const bounds = element.getBoundingClientRect?.();
        if (!bounds?.width || !bounds.height) continue;
        const viewport = element.closest(".CodeMirror, .project-chat-title-content, .project-chat-thread, .project-chat-history-list, .project-documentation-scroll");
        const scrollers = viewport ? [viewport, ...viewport.querySelectorAll(
          ".CodeMirror-scroll, .CodeMirror-vscrollbar, .CodeMirror-hscrollbar"),
          ...(element.matches("textarea") ? [element] : [])] : [element];
        measurements.set(element, { index, width: bounds.width, viewport,
          overflowX: viewport && viewport.scrollWidth > viewport.clientWidth + 1 &&
            window.getComputedStyle(viewport).overflowX !== "hidden" ? "scroll" : "hidden",
          scroll: scrollers.map(node => [node, node.scrollLeft, node.scrollTop]) });
      }
    });
    return measurements;
  }

  function freezeWorkspaceContent(before, previousCompact) {
    // A narrow closing target can leave no measurable text width. Retain its
    // previous layers too, so they keep their layout until the frame closes.
    const measurements = new Map([...before, ...measureWorkspaceContent()]);
    for (const [element, after] of measurements) {
      const bounds = previousCompact[after.index] ? after : before.get(element) || after;
      element.style.setProperty("--workspace-content-width", `${bounds.width}px`);
      element.setAttribute("data-workspace-motion-content", "");
      if (after.viewport) {
        after.viewport.style.setProperty("--workspace-content-overflow-x", bounds.overflowX);
        after.viewport.setAttribute("data-workspace-motion-clip", "");
      }
      for (const [node, left, top] of bounds.scroll) {
        node.scrollLeft = left;
        node.scrollTop = top;
      }
    }
  }

  function prepareWorkspaceTextReflow(previousWidths, widths) {
    const panels = getCanvasSplitContainer()?.querySelectorAll(
      ":scope > :is(.outliner, .project-ai-layout, .editor-workspace, .documentation-workspace)");
    panels?.forEach((panel, index) => {
      if (previousWidths[index] <= WORKSPACE_PANEL_COMPACT_THRESHOLD ||
          widths[index] <= WORKSPACE_PANEL_COMPACT_THRESHOLD ||
          Math.abs(previousWidths[index] - widths[index]) < 1) return;
      for (const element of panel.querySelectorAll(
        "[data-workspace-motion-content], .CodeMirror-gutters, .CodeMirror-cursors, .CodeMirror-selected")) {
        if (typeof element.animate !== "function") continue;
        const cm = element.closest(".CodeMirror")?.CodeMirror;
        if (cm && !cm.getOption("lineWrapping")) continue;
        if (!cm && !(element.value || element.textContent)) continue;
        const animation = element.animate([
          { opacity: 1, offset: 0 }, { opacity: 1, offset: 0.65 }, { opacity: 0, offset: 1 },
        ], { duration: WORKSPACE_PANEL_TRANSITION_MS - 24, fill: "forwards" });
        element.dataset.workspaceTextMotion = "hiding";
        workspaceTextAnimations.set(element, animation);
      }
    });
  }

  function renderWorkspaceWidths(widths, { persist = false, animate = true, fit = false } = {}) {
    const previousWidths = getWorkspaceWidths();
    const specs = getWorkspacePanelSpecs();
    const previousCompact = [outlinerWidth <= WORKSPACE_PANEL_COMPACT_THRESHOLD,
      projectAiColumnWidth <= WORKSPACE_PANEL_COMPACT_THRESHOLD,
      editorCollapsed, documentationWidth <= WORKSPACE_PANEL_COMPACT_THRESHOLD];
    const compactChanged = widths.some((value, index) =>
      (value <= WORKSPACE_PANEL_COMPACT_THRESHOLD) !== previousCompact[index]);
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    if (animate && !reducedMotion && workspaceTransitionTimer !== null) return false;
    const motion = animate && !reducedMotion && compactChanged && typeof window.setTimeout === "function";
    if (motion || !animate || reducedMotion) finishWorkspaceTransition();
    const container = getCanvasSplitContainer();
    const startGrid = motion && container && window.getComputedStyle?.(container).gridTemplateColumns;
    const before = motion ? measureWorkspaceContent() : null;
    if (motion) {
      for (const codeMirror of [editor, documentationEditor, projectInstructionEditor]) {
        if (!codeMirror) continue;
        workspaceMotionScrollAnchors.set(codeMirror, captureMarkdownLiveScrollAnchor(codeMirror));
      }
    }
    // Commit the target pane state while keeping already closed rails fixed.
    syncWorkspaceCompactClasses(widths);
    let adjusted = balanceWorkspaceSpacing(widths, getWorkspaceContentWidth(), previousWidths, specs);
    if (!adjusted && fit) {
      const retained = widths.map((width, index) => previousWidths[index] === specs[index].compact
        ? specs[index].compact : width);
      syncWorkspaceCompactClasses(retained);
      adjusted = balanceWorkspaceSpacing(retained, getWorkspaceContentWidth(), previousWidths, specs);
    }
    if (!adjusted) {
      syncWorkspaceCompactClasses(previousWidths);
      finishWorkspaceTransition();
      return false;
    }
    widths = adjusted;
    [outlinerWidth, projectAiColumnWidth, , documentationWidth] = widths;
    editorCollapsed = widths[2] <= WORKSPACE_PANEL_COMPACT_THRESHOLD;
    if (container) {
      container.style.setProperty("--editor-workspace-min-width",
        `${editorCollapsed ? WORKSPACE_PANEL_COMPACT_WIDTH : getWorkspacePanelMinWidth(2)}px`);
      for (const [property, value] of [
        ["--outliner-width", outlinerWidth],
        ["--project-ai-width", projectAiColumnWidth],
        ["--documentation-width", documentationWidth],
      ]) container.style.setProperty(property, `${value}px`);
    }
    // Keep closing content at its expanded size while the frame moves. Opening
    // content is measured once at its final width before the first visible frame.
    syncWorkspaceCompactState(widths, motion ? widths.map((size, index) =>
      previousCompact[index] ? size : Math.max(size, specs[index].min)) : widths);
    if (motion) {
      if (previousCompact[2] && widths[2] > WORKSPACE_PANEL_COMPACT_THRESHOLD) fitEditorFileWatermark();
      const openingEditors = [null, projectInstructionEditor, editor, documentationEditor]
        .filter((codeMirror, index) => codeMirror && previousCompact[index] && widths[index] > WORKSPACE_PANEL_COMPACT_THRESHOLD);
      if (openingEditors.length) settleWorkspaceEditors(workspaceMotionScrollAnchors, openingEditors);
      const endGrid = container && window.getComputedStyle?.(container).gridTemplateColumns;
      if (startGrid && endGrid && startGrid !== "none" && endGrid !== "none") {
        freezeWorkspaceContent(before, previousCompact);
        prepareWorkspaceTextReflow(previousWidths, widths);
        container.style.setProperty("grid-template-columns", startGrid);
        syncWorkspaceCompactClasses(previousWidths);
        container.getBoundingClientRect();
        container.classList.add("is-workspace-transitioning");
        syncWorkspaceCompactClasses(widths);
        // Finish editor measurement before starting the movement clock. Without
        // a painted starting frame, synchronous layout can consume the opening
        // part of the transition and make the first visible frame jump ahead.
        workspaceTransitionFrame = window.requestAnimationFrame(() => {
          workspaceTransitionFrame = window.requestAnimationFrame(() => {
            workspaceTransitionFrame = null;
            container.style.setProperty("grid-template-columns", endGrid);
            window.clearTimeout(workspaceTransitionTimer);
            workspaceTransitionTimer = window.setTimeout(finishWorkspaceTransition, WORKSPACE_PANEL_TRANSITION_MS);
          });
        });
      } else container?.classList.add("is-workspace-transitioning");
      workspaceTransitionTimer = window.setTimeout(() => {
        finishWorkspaceTransition();
      }, WORKSPACE_PANEL_TRANSITION_MS);
    }
    syncSplitResizerAria();
    if (compactChanged) clearSplitCollapsePreview();
    if (persist) persistWorkspaceLayout();
    refreshWorkspaceEditors();
    return true;
  }

  function fitWorkspaceToViewport() {
    renderWorkspaceWidths(fitWorkspaceWidths(
      [outlinerPreferredWidth, projectAiColumnPreferredWidth,
        editorCollapsed ? WORKSPACE_PANEL_COMPACT_WIDTH : WORKSPACE_PANEL_MIN_WIDTH,
        documentationPreferredWidth],
      getWorkspaceContentWidth(),
      getWorkspacePanelSpecs()
    ), { animate: false, fit: true });

    refreshWorkspaceEditors();
  }

  function resizeWorkspacePanel(index, requested, { persist = true } = {}) {
    renderWorkspaceWidths(
      resizeWorkspacePanels(getWorkspaceWidths(), getWorkspacePanelSpecs(), index, requested),
      { persist }
    );
  }

  function revealSpecificationQuestions(instruction) {
    if (projectInstructionDocument !== instruction ||
        projectAiColumnWidth > WORKSPACE_PANEL_COMPACT_THRESHOLD) return;
    if (workspaceTransitionTimer !== null) {
      pendingSpecificationReveal = instruction;
      return;
    }
    resizeWorkspacePanel(1, PROJECT_AI_COLUMN_DEFAULT_WIDTH, { persist: false });
  }

  function syncEditorCollapseState(collapsed = editorCollapsed) {
    const content = $("editorContent");
    $("editorWorkspace")?.classList.toggle("is-collapsed", collapsed);
    if (content) content.hidden = collapsed;
  }

  function syncWorkspaceCompactClasses(sizes) {
    const container = getCanvasSplitContainer();
    for (const [index, name] of ["outliner", "project-ai", "editor", "documentation"].entries()) {
      container?.classList.toggle(`is-${name}-compact`, sizes[index] <= WORKSPACE_PANEL_COMPACT_THRESHOLD);
    }
  }

  function syncWorkspaceCompactState(sizes, contentSizes = sizes) {
    syncWorkspaceCompactClasses(sizes);
    const container = getCanvasSplitContainer();
    for (const [index, name] of ["outliner", "project-ai", "editor", "documentation"].entries()) {
      container?.classList.toggle(`is-${name}-content-compact`, contentSizes[index] <= WORKSPACE_PANEL_COMPACT_THRESHOLD);
    }
    syncEditorCollapseState(contentSizes[2] <= WORKSPACE_PANEL_COMPACT_THRESHOLD);
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
    const names = ["Chat", "Canvas", "Code", "Guide"];
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

  function clearSplitCollapsePreview({ immediate = false } = {}) {
    const compactPanels = [
      [".outliner", "is-outliner-compact"], [".project-ai-layout", "is-project-ai-compact"],
      [".editor-workspace", "is-editor-compact"], [".documentation-workspace", "is-documentation-compact"],
    ];
    document.querySelectorAll?.(".pane-collapse-cue").forEach(cue => {
      const container = cue.closest?.(".canvas-split-container");
      const compact = compactPanels.some(([selector, state]) =>
        cue.parentElement?.matches(selector) && container?.classList.contains(state));
      const animation = cue.getAnimations?.({ subtree: true })[0];
      if (immediate || !animation || animation.playState === "finished" ||
          (compact && !container?.classList.contains("is-workspace-transitioning"))) {
        cue.remove();
        return;
      }
      if (compact) {
        const duration = Number(animation.effect.getTiming().duration);
        const remaining = Math.max(0, duration - (Number(animation.currentTime) || 0));
        // Finish the existing pass inside the window's 320ms transition.
        // Repeated pointer samples must never slow it down or restart it.
        animation.updatePlaybackRate(Math.max(animation.playbackRate, remaining / 180));
      }
      cue.dataset.finishing = "true";
    });
  }

  function showSplitCollapsePreview(panel, direction) {
    if (!panel || panel.getBoundingClientRect().width <= WORKSPACE_PANEL_COMPACT_THRESHOLD) {
      clearSplitCollapsePreview({ immediate: true });
      return;
    }
    const name = direction < 0 ? "left" : "right";
    let cue = panel.querySelector(":scope > .pane-collapse-cue");
    if (!cue || cue.dataset.direction !== name) {
      clearSplitCollapsePreview({ immediate: true });
      cue = document.createElement("div");
      cue.className = "pane-collapse-cue";
      cue.dataset.direction = name;
      cue.setAttribute("aria-hidden", "true");
      cue.setAttribute("inert", "");
      cue.addEventListener("animationend", () => {
        if (cue.dataset.finishing === "true") cue.remove();
      });
      panel.appendChild(cue);
    }
    delete cue.dataset.finishing;
  }

  function bindSplitResizer(handle, options) {
    window.UartDebugControls.bindPanelResizer(handle, {
      ...options,
      finish: (state, event) => {
        clearSplitCollapsePreview();
        options.finish?.(state, event);
      },
    });
  }

  function bindWorkspaceColumnResizer(id, index) {
    bindSplitResizer($(id), {
      axis: "x",
      start: () => ({ viewportWidth: getCanvasSplitContainer()?.getBoundingClientRect().width,
        widths: getWorkspaceWidths(), specs: getWorkspacePanelSpecs(), offset: 0 }),
      move: (delta, state) => {
        if (workspaceTransitionTimer !== null) {
          // Complete one snap in either direction. Rebase the held gesture so
          // pointer samples cannot restart the transition or accumulate a jump.
          state.widths = getWorkspaceWidths();
          state.offset = delta;
          return;
        }
        const movement = delta - state.offset;
        renderWorkspaceBoundary(state.widths, state.specs, index, movement);
        const rendered = getWorkspaceWidths();
        const preview = getWorkspaceResizePreview(state.widths, state.specs, index, movement);
        if (preview) {
          const panels = getCanvasSplitContainer()?.querySelectorAll(":scope > .outliner, :scope > .project-ai-layout, :scope > .editor-workspace, :scope > .documentation-workspace");
          showSplitCollapsePreview(panels?.[preview.index], preview.direction);
        } else clearSplitCollapsePreview();
        if (rendered.some((size, i) => (size === state.specs[i].compact) !== (state.widths[i] === state.specs[i].compact))) {
          state.widths = rendered;
          state.offset = delta;
        }
      },
      finish: state => {
        if (state.viewportWidth !== getCanvasSplitContainer()?.getBoundingClientRect().width) fitWorkspaceToViewport();
        else persistWorkspaceLayout();
      },
      key: command => {
        const widths = getWorkspaceWidths(), specs = getWorkspacePanelSpecs();
        let delta;
        if (command.endpoint === "start") {
          if (widths[index] === specs[index].compact) return;
          delta = -(widths[index] - specs[index].min + WORKSPACE_PANEL_COLLAPSE_DISTANCE);
        } else if (command.endpoint === "end") {
          if (widths[index + 1] === specs[index + 1].compact) return;
          delta = widths[index + 1] - specs[index + 1].min + WORKSPACE_PANEL_COLLAPSE_DISTANCE;
        } else {
          const direction = command.direction;
          const growing = direction > 0 ? index : index + 1;
          const shrinking = direction > 0 ? index + 1 : index;
          const step = widths[growing] === specs[growing].compact ? Math.max(WORKSPACE_PANEL_REOPEN_DISTANCE, specs[growing].min - specs[growing].compact)
            : widths[shrinking] <= specs[shrinking].min ? WORKSPACE_PANEL_COLLAPSE_DISTANCE
              : command.accelerated ? 48 : 24;
          delta = direction * step;
        }
        renderWorkspaceBoundary(widths, specs, index, delta, { persist: true });
      },
    });
  }

  function bindFileListResizer() {
    bindWorkspaceColumnResizer("fileListResizer", 0);
  }

  function bindDocumentationResizer() {
    bindWorkspaceColumnResizer("documentationResizer", 2);
  }

  function bindProjectAiResizers() {
    bindWorkspaceColumnResizer("projectAiColumnResizer", 1);
  }

  function updatePanelActionContours() {
    const container = getCanvasSplitContainer();
    if (!container) return;
    const panes = [...container.querySelectorAll(".panel-action-host, .panel-action-notched")];
    // The matching inward offset also needs a visible radius at the bend.
    // A shallower curve pinches that radius down to about two pixels.
    const curveDepth = 52;
    let previousCapsuleCurveTop = 0;
    let previousPaneRight = 0;
    for (const [index, pane] of panes.entries()) {
      const contour = pane.querySelector(":scope > [data-panel-action-contour]");
      const bounds = pane.getBoundingClientRect?.();
      if (!contour || !bounds?.width || !bounds.height) continue;
      const style = window.getComputedStyle(pane);
      const rail = Number.parseFloat(style.getPropertyValue("--panel-action-width")) || 34;
      const bodyRight = bounds.width - 0.5;
      const bottom = bounds.height - 0.5;
      const actions = pane.querySelector(":scope > .panel-action-lobe");
      const capsuleCurveTop = actions ? actions.getBoundingClientRect().bottom - bounds.top + 12 : 0;
      const overhang = actions ? rail : 0;
      const right = bodyRight + overhang;
      const notch = pane.classList.contains("panel-action-notched") ? rail : 0;
      // Keep both top corners inside the narrowest compact panel's contour.
      const radius = Math.min(15, Math.max(0, (right - notch - 0.5) / 2));
      const bottomRadius = Math.min(15, Math.max(0, (bodyRight - 0.5) / 2));
      const clearance = index ? Math.max(0, bounds.left - previousPaneRight) : 0;
      const notchTop = notch ? Math.min(previousCapsuleCurveTop - bounds.top,
        Math.max(0, bottom - curveDepth - bottomRadius)) : 0;
      const notchBottom = notchTop + curveDepth;
      // Keep the capsule's established curve. Its neighbor follows a parallel
      // offset, including the one pixel between the two stroke center lines.
      let outline = `M${notch + radius} 0.5 H${right - radius} Q${right} 0.5 ${right} ${radius}`;
      if (actions) outline += ` V${capsuleCurveTop} C${right} ${capsuleCurveTop + curveDepth / 2} ${bodyRight} ${capsuleCurveTop + curveDepth / 2} ${bodyRight} ${capsuleCurveTop + curveDepth}`;
      outline += ` V${bottom - bottomRadius} Q${bodyRight} ${bottom} ${bodyRight - bottomRadius} ${bottom}`;
      outline += ` H${bottomRadius} Q0.5 ${bottom} 0.5 ${bottom - bottomRadius}`;
      if (notch) {
        const points = getCapsuleNotchPoints(notch, curveDepth, clearance + 1).reverse();
        outline += ` V${notchBottom}`;
        for (const point of points.slice(1)) {
          outline += ` L${(point.x + 0.5).toFixed(3)} ${(notchTop + point.y).toFixed(3)}`;
        }
        outline += ` V${radius}`;
      }
      else outline += ` V${radius}`;
      outline += ` Q${notch + 0.5} 0.5 ${notch + radius} 0.5 Z`;
      const viewBox = `0 0 ${bounds.width + overhang} ${bounds.height}`;
      if (contour.getAttribute("viewBox") !== viewBox) contour.setAttribute("viewBox", viewBox);
      pane.style.setProperty("--panel-left-notch-bottom", `${notchBottom}px`);
      for (const [selector, path] of [[".panel-action-outline", outline],
        [".panel-action-fill", outline]]) {
        const element = contour.querySelector(selector);
        if (element?.getAttribute("d") !== path) element?.setAttribute("d", path);
      }
      previousCapsuleCurveTop = bounds.top + capsuleCurveTop;
      previousPaneRight = bounds.right;
    }
    const moving = container.classList.contains("is-workspace-transitioning") ||
      $("avrDeviceSection")?.classList.contains("is-device-panel-transitioning");
    if (moving && panelActionContourFrame === null) {
      panelActionContourFrame = window.requestAnimationFrame(() => {
        panelActionContourFrame = null;
        updatePanelActionContours();
      });
    }
  }

  function bindPanelActionExpansion() {
    const container = getCanvasSplitContainer();
    if (!container) return;
    const contourTemplate = $("panelActionContour")?.content?.firstElementChild;
    if (contourTemplate) {
      for (const pane of container.querySelectorAll(".panel-action-host, .panel-action-notched")) {
        if (pane.querySelector(":scope > [data-panel-action-contour]")) continue;
        const contour = contourTemplate.cloneNode(true);
        contour.setAttribute("data-panel-action-contour", "");
        contour.setAttribute("aria-hidden", "true");
        contour.setAttribute("focusable", "false");
        pane.prepend(contour);
      }
    }
    updatePanelActionContours();
    if (container.dataset.panelActionsBound === "true") return;
    container.dataset.panelActionsBound = "true";
    const expandActionPanel = (event) => {
      if (event.type === "focusin" && !event.target?.matches?.(":focus-visible")) return;
      const actions = event.target?.closest?.(".panel-action-lobe");
      if (!actions || !container.contains(actions)) return;
      const panels = [...container.querySelectorAll(
        ":scope > :is(.outliner, .project-ai-layout, .editor-workspace, .documentation-workspace)"
      )];
      const index = panels.findIndex(panel => panel.contains(actions));
      if (index < 0) return;
      const widths = getWorkspaceWidths(), specs = getWorkspacePanelSpecs();
      if (widths[index] === specs[index].compact) resizeWorkspacePanel(index, specs[index].min);
    };
    // Capture click after pointer release, before the existing action handler.
    // Moving a tab during pointerdown/focus would cancel its pending click.
    container.addEventListener("click", expandActionPanel, true);
    container.addEventListener("focusin", expandActionPanel);
  }

  function bindWorkspaceResizeObserver() {
    const container = getCanvasSplitContainer();
    if (!container) return;
    const busy = () => window.UartDebugControls.isPanelResizing() ||
      container.classList.contains("is-workspace-transitioning") ||
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
    openFilesModal();
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
      window.UartDebugNotifications?.notify({ key: "project-name-validation", title: "Project display name", message: error, tone: "warning" });
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

  function renderFileRow(list, name) {
    const linkedProject = getMiniProjectForFile(name);
    const isMiniProjectSource =
      linkedProject?.role === miniProjectCore.ROLES.SOURCE;
    const displayName = getOutlinerFileLabel(name);
    const row = document.createElement("div");
    row.className = "file-item ui-list-item ui-list-item--record";
    row.dataset.file = name;
    row.dataset.fileKind = isMiniProjectSource
      ? "mini-project"
      : getOutlinerFileKind(name);
    if (!isMiniProjectSource) row.dataset.outlinerIcon = getOutlinerFileIcon(name);
    row.tabIndex = 0;
    row.setAttribute("role", "button");
    row.setAttribute("aria-label", displayName);
    if (isMiniProjectSource) {
      row.classList.add("mini-project-item");
      row.dataset.tooltipDisabled = "";
    } else row.title = name;

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
    label.className = "file-name ui-list-item-title";
    label.textContent = displayName;
    row.appendChild(label);

    const acts = document.createElement("div");
    acts.className = "file-actions";

    const menuBtn = document.createElement("button");
    menuBtn.className = "file-menu-btn ui-icon-button ui-icon-button--quiet ui-menu-trigger";
    menuBtn.title = "Project actions";
    menuBtn.setAttribute("aria-label", `Actions for ${displayName}`);
    menuBtn.setAttribute("aria-haspopup", "menu");
    menuBtn.setAttribute("aria-controls", "fileContextMenu");
    menuBtn.setAttribute("aria-expanded", "false");
    menuBtn.textContent = "\u22ef";

    menuBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const rect = menuBtn.getBoundingClientRect();
      openFileContextMenu(name, rect.left + rect.width / 2, rect.bottom + 4, menuBtn);
    });

    acts.appendChild(menuBtn);
    row.appendChild(acts);

    row.addEventListener("click", () => {
      if (inlineFileEdit && !commitInlineFileEdit()) return;
      selectFile(name);
      closeFilesModal();
    });
    row.addEventListener("keydown", event => {
      if (event.target === row && (event.key === "ContextMenu" || event.key === "F10" && event.shiftKey)) {
        event.preventDefault();
        const bounds = row.getBoundingClientRect();
        openFileContextMenu(name, bounds.left, bounds.bottom + 4, row);
        return;
      }
      if (event.target === row && ["Enter", " "].includes(event.key)) {
        event.preventDefault();
        row.click();
      }
    });

    row.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      openFileContextMenu(name, e.clientX, e.clientY, row);
    });

    list.appendChild(row);
  }

  function renderOutliner() {
    const list = $("fileList");
    list.innerHTML = "";

    const currentProject = $("currentProjectCardDetail");
    const selectedProject = getMiniProjectForFile(current)?.project;
    if (currentProject) currentProject.textContent = selectedProject ? getOutlinerFileLabel(selectedProject.files.source) : "";

    const names = getVisibleWorkspaceFileNames();
    if (!names.length) {
      const empty = document.createElement("p");
      empty.className = "ui-empty-state";
      empty.textContent = "No projects yet";
      list.appendChild(empty);
    }
    for (const name of names) {
      renderFileRow(list, name);
    }

    updateCompilePanelState();
  }

  function openFileContextMenu(fileName, clientX, clientY, trigger) {
    const menu = $("fileContextMenu");
    if (!menu) return;

    if (menu.style.display === "block" && contextMenuFile === fileName && contextMenuTrigger === trigger) {
      closeFileContextMenu({ restoreFocus: true });
      return;
    }
    closeFileContextMenu();

    contextMenuFile = fileName;
    contextMenuTrigger = trigger || document.activeElement;
    contextMenuTrigger?.setAttribute("aria-expanded", "true");
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", "Project actions");
    for (const button of menu.querySelectorAll("button")) {
      button.setAttribute("role", "menuitem");
      button.tabIndex = -1;
    }

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
    menu.querySelector("button:not([hidden]):not(:disabled)")?.focus({ preventScroll: true });
    contextMenuScroll = window.UartDebugControls.captureMenuScroll(contextMenuTrigger);
  }

  function closeFileContextMenu({ restoreFocus = false } = {}) {
    const menu = $("fileContextMenu");
    if (!menu) return;
    menu.style.display = "none";
    contextMenuFile = null;
    const trigger = contextMenuTrigger;
    contextMenuTrigger = null;
    contextMenuScroll = null;
    trigger?.setAttribute("aria-expanded", "false");
    if (restoreFocus && trigger?.isConnected) trigger.focus({ preventScroll: true });
  }

  function handleFileMenuKeydown(event) {
    const menu = $("fileContextMenu");
    if (menu?.style.display !== "block") return false;
    if (event.key === "Escape") {
      closeFileContextMenu({ restoreFocus: true });
      event.preventDefault();
      return true;
    }
    if (event.key === "Tab") {
      closeFileContextMenu({ restoreFocus: true });
      return false;
    }
    if (!menu.contains(document.activeElement) || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return false;
    const buttons = [...menu.querySelectorAll("button:not([hidden]):not(:disabled)")];
    const index = buttons.indexOf(document.activeElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
      : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
    event.preventDefault();
    return true;
  }

  async function handleFileContextAction(action) {
    if (!contextMenuFile || !hasFile(contextMenuFile)) {
      closeFileContextMenu();
      return;
    }

    const targetName = contextMenuFile;
    // Close menu immediately so it doesn't hang around over dialogs
    closeFileContextMenu({ restoreFocus: true });

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

    return "";
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
    const { markdown, dialogue } = projectFormat.migrateV3TaskDialogue(
      migrateCanvasAnnotationsToMarkdown(originalMarkdown, legacyAnnotations, locale), source.dialogue,
    );
    return {
      schemaVersion: 2,
      revision: Number.isSafeInteger(revision) && revision >= 0 ? revision : 0,
      markdown,
      locale,
      annotations: [],
      dialogue,
      ...(source.target && typeof source.target === "object" ? { target: {
        mcu: String(source.target.mcu || "").toLowerCase(),
        packageName: String(source.target.packageName || ""),
      } } : {}),
      authorship: markdown !== originalMarkdown
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
      unassignedProjectInstructionDocument || (projectInstructionInstanceId ? null : projectInstructionDocument)
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
    if (!projectChatApplyingResponse && !projectAiAccountWorkspaceApplying) projectChatController?.refresh();
  }

  function normalizeProjectConversation(value, options = {}) {
    return window.UartDebugProjectChat?.normalize(value, options)
      || { schemaVersion: 6, activeThreadId: "chat-1", threads: [{ id: "chat-1", title: "New chat", messages: [], activeLeafId: null, draft: "", titleMode: "auto" }] };
  }

  function getProjectChatContext() {
    const linked = getMiniProjectForFile(current);
    const instanceId = linked?.instanceId || null;
    const conversation = normalizeProjectConversation(linked ? linked.project.conversation : draftProjectConversation);
    return {
      key: `${projectAiAccountWorkspaceEpoch}:${instanceId || "draft"}`,
      instanceId,
      accountEpoch: projectAiAccountWorkspaceEpoch,
      threadId: conversation.activeThreadId,
      title: linked?.project.displayName || linked?.project.title || "New project",
      conversation,
    };
  }

  function saveProjectConversation(scope, conversation, fromScope = null) {
    if (scope.accountEpoch !== projectAiAccountWorkspaceEpoch ||
        scope.key !== `${scope.accountEpoch}:${scope.instanceId || "draft"}` ||
        (fromScope && (fromScope.accountEpoch !== scope.accountEpoch || fromScope.instanceId ||
          fromScope.key !== `${scope.accountEpoch}:draft`))) return false;
    const project = scope.instanceId ? miniProjects[scope.instanceId] : null;
    if (scope.instanceId && !project) return false;
    const value = normalizeProjectConversation(conversation);
    const previousDraft = draftProjectConversation, previous = project?.conversation;
    // Reading/flushing an unused chat must not materialize a new empty chat or
    // turn account hydration into an edit. Still persist other pending changes.
    if (!fromScope && JSON.stringify(normalizeProjectConversation(project ? previous : previousDraft)) === JSON.stringify(value)) {
      return persistState();
    }
    if (project) project.conversation = value;
    else draftProjectConversation = value;
    if (project && fromScope) draftProjectConversation = normalizeProjectConversation(null);
    if (persistState()) return true;
    draftProjectConversation = previousDraft;
    if (project) {
      if (previous === undefined) delete project.conversation;
      else project.conversation = previous;
    }
    return false;
  }

  function initProjectChat() {
    if (!window.UartDebugProjectChat?.create || !$("projectChatForm")) return;
    projectChatController = window.UartDebugProjectChat.create({
      root: document.querySelector(".project-chat-panel"),
      getContext: getProjectChatContext,
      save: saveProjectConversation,
      request: requestProjectChat,
      onBusy: setProjectAiFormBusy,
      openFiles: openFilesModal,
      confirm: showSiteConfirm,
      notify: options => window.UartDebugNotifications?.notify(options),
    });
  }

  function reportProjectCanvasMessage(kind, message, notificationId = null) {
    const content = String(message || "").trim();
    if (!content) return;
    if (notificationId) {
      window.UartDebugNotifications?.append(notificationId, content, {
        message: content.split("\n")[0], tone: kind === "system" ? "error" : "success", pending: false,
      });
      return;
    }
    window.UartDebugNotifications?.notify({
      key: `message:${content}`, title: "Workspace",
      message: content.split("\n")[0], details: content,
      tone: kind === "system" ? "error" : kind === "warning" ? "warning" : "success", pending: false,
    });
  }

  function getCanvasTarget() {
    const select = $("mcuSelect");
    const detected = String(window[AVR_UPDI_BRIDGE_KEY]?.getDetectedTargetKey?.() || "");
    const selected = String(select?.value || projectInstructionDocument.target?.mcu || "");
    const packageSelect = $("projectPackageSelect");
    return {
      mcu: detected || (selected === "auto" ? "" : selected),
      packageName: String(packageSelect?.value || packageSelect?.dataset.pendingPackage || ""),
    };
  }

  function refreshTargetPresentation() {
    const select = $("mcuSelect");
    if (!select) return;
    const runtime = getCanvasUpdiRuntime();
    const info = runtime?.getSignatureInfo?.();
    const detected = String(window[AVR_UPDI_BRIDGE_KEY]?.getDetectedTargetKey?.() || "");
    if (detected && [...select.options].some(option => option.value === detected)) select.value = detected;
    let optionsChanged = false;
    for (const option of select.options) {
      const disabled = !!detected && option.value !== detected;
      if (option.disabled !== disabled) { option.disabled = disabled; optionsChanged = true; }
    }
    const busy = runtime?.isBusy?.() === true;
    const automatic = select.value === "auto";
    const autoOption = [...select.options].find(option => option.value === "auto");
    const autoLabel = automatic && info && !detected ? "Unknown chip" : busy && automatic ? "Working…" : "Auto detect";
    const status = select.dataset.controlStatus || "";
    const presentationChanged = optionsChanged || autoOption?.dataset.displayLabel !== autoLabel;
    if (autoOption) autoOption.dataset.displayLabel = autoLabel;
    const targetLabel = select.selectedOptions[0]?.textContent || select.value;
    select.dataset.tooltip = status ? `Target MCU: ${targetLabel}. ${status}.` : `Target MCU: ${targetLabel}`;
    const custom = select.nextElementSibling;
    if (presentationChanged && custom?.classList.contains("custom-select")) updateCustomSelect(select, custom);
    custom?.querySelector(".custom-select-trigger")?.setAttribute("data-tooltip", select.dataset.tooltip);
  }

  function syncCanvasTargetControls(restore = false) {
    const select = $("projectPackageSelect");
    if (!select) return;
    const mcuSelect = $("mcuSelect");
    const savedTarget = projectInstructionDocument.target;
    const detected = String(window[AVR_UPDI_BRIDGE_KEY]?.getDetectedTargetKey?.() || "");
    if (restore && mcuSelect && !detected) {
      const savedMcu = String(savedTarget?.mcu || "auto").toLowerCase();
      mcuSelect.value = [...mcuSelect.options].some(option => option.value === savedMcu) ? savedMcu : "auto";
    }
    if (detected && mcuSelect) mcuSelect.value = detected;
    const target = getCanvasTarget();
    const selectedPackage = restore ? String(savedTarget?.packageName || "")
      : String(select.value || select.dataset.pendingPackage || "");
    // A not-yet-loaded catalog cannot establish that a saved package is invalid.
    if (!canvasSupportedDevices) {
      if (selectedPackage) select.dataset.pendingPackage = selectedPackage;
      else delete select.dataset.pendingPackage;
      select.disabled = true;
      refreshTargetPresentation();
      return;
    }
    const device = canvasSupportedDevices.find(item => item.mcu === target.mcu);
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = target.mcu && !device ? "Package unavailable" : "Choose package";
    placeholder.dataset.displayLabel = target.mcu && !device ? "Unavailable" : "Package";
    select.replaceChildren(placeholder);
    for (const packageName of device?.packages || []) {
      const option = document.createElement("option");
      option.value = packageName;
      option.textContent = packageName;
      select.appendChild(option);
    }
    if (device?.packages.includes(selectedPackage)) select.value = selectedPackage;
    delete select.dataset.pendingPackage;
    select.dataset.mcu = target.mcu;
    select.disabled = !device;
    const custom = mcuSelect?.nextElementSibling;
    if (custom?.classList.contains("custom-select")) updateCustomSelect(mcuSelect, custom);
    refreshTargetPresentation();
  }

  function saveCanvasTarget() {
    const target = getCanvasTarget();
    const previous = projectInstructionDocument.target;
    if ((previous?.mcu || "") === target.mcu && (previous?.packageName || "") === target.packageName) return;
    projectInstructionDocument = { ...projectInstructionDocument, target,
      revision: projectInstructionDocument.revision + 1 };
    persistProjectInstruction({ recover: true });
  }

  function bindCanvasTargetControls() {
    setProjectAiFormBusy(false);
    $("mcuSelect")?.addEventListener("change", () => {
      syncCanvasTargetControls();
      saveCanvasTarget();
      pulseHardwareFlow();
    });
    $("projectPackageSelect")?.addEventListener("change", () => {
      saveCanvasTarget();
      pulseHardwareFlow();
    });
    // Knowledge availability is separate from account/credit availability.
    void fetch("/api/avr/ai/status", { headers: { Accept: "application/json" }, credentials: "same-origin" })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("Knowledge is unavailable")))
      .then((status) => {
        canvasSupportedDevices = (status.knowledge?.devices || []).filter((device) =>
          typeof device?.mcu === "string" && Array.isArray(device.packages))
          .map((device) => ({ ...device, mcu: device.mcu.toLowerCase() }));
        syncCanvasTargetControls(true);
        saveCanvasTarget();
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

  function hardwareStageElement(stage) {
    if (stage === "adapter") return $("adapterStatusText")?.closest(".hardware-port");
    const select = $(stage === "package" ? "projectPackageSelect" : "mcuSelect");
    return select?.nextElementSibling?.querySelector(".custom-select-trigger");
  }

  function currentHardwareFailure() {
    if ($("adapterStatusText")?.classList.contains("is-error")) return "adapter";
    if ($("mcuSelect")?.dataset.connectionState === "error") return "chip";
    if ($("projectPackageSelect")?.dataset.connectionState === "error") return "package";
    return "";
  }

  function pulseHardwareFlow() {
    const fault = currentHardwareFailure();
    if (fault) hardwareFlow?.fail(hardwareStageElement(fault));
    else hardwareFlow?.pulse();
  }

  function bindHardwareFlow() {
    hardwareFlow = window.UartDebugHardwareFlow?.create($("hardwareFlowLight"));
    const button = $("detectChipBtn");
    const hoverArea = button?.closest(".hardware-step--detect");
    hoverArea?.addEventListener("pointerenter", () => {
      if (button.disabled && !button.classList.contains("is-working")) return;
      const fault = currentHardwareFailure();
      hardwareFlow?.setActive("connection-hover", true, fault ? hardwareStageElement(fault) : null);
    });
    hoverArea?.addEventListener("pointerleave", () => hardwareFlow?.setActive("connection-hover", false));
    $("avrTargetPanelViewport")?.addEventListener("ud-select-toggle", (event) => {
      const owner = event.target.id === "mcuSelect" ? "chip-menu"
        : event.target.id === "projectPackageSelect" ? "package-menu" : "";
      if (!owner) return;
      const fault = event.detail.open && currentHardwareFailure();
      hardwareFlow?.setActive(owner, event.detail.open, fault ? hardwareStageElement(fault) : null);
    });
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
    const visibleMessage = String(message || "").trim();
    if (visibleMessage) window.UartDebugNotifications?.notify({ key: "instruction-save", title: "Project storage",
      message: visibleMessage, tone: error ? "error" : "info" });
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
      const stored = workspaceDraftCanvasRestored ? null
        : window.localStorage.getItem(STORAGE_PROJECT_INSTRUCTION);
      if (workspaceDraftCanvasRestored) {
        projectInstructionDocument = getUnassignedProjectInstructionSnapshot();
        // A failed legacy import remains recoverable after unrelated project
        // edits have saved the canonical envelope. Never use it as a fallback.
        const unreadableLegacy = window.localStorage.getItem(STORAGE_PROJECT_INSTRUCTION)
          ?? window.localStorage.getItem(STORAGE_PROJECT_INSTRUCTION_LEGACY);
        if (unreadableLegacy !== null) parseStoredProjectInstruction(unreadableLegacy);
      }
      if (stored !== null) {
        projectInstructionDocument = parseStoredProjectInstruction(stored);
      } else if (!workspaceDraftCanvasRestored) {
        const legacyStored = window.localStorage.getItem(
          STORAGE_PROJECT_INSTRUCTION_LEGACY
        );
        if (legacyStored !== null) {
          const legacyDocument = parseStoredProjectInstruction(legacyStored);
          projectInstructionDocument = legacyDocument;
        }
      }
      projectInstructionStorageReadFailed = false;
    } catch {
      projectInstructionDocument = workspaceDraftCanvasRestored
        ? getUnassignedProjectInstructionSnapshot() : normalizeProjectInstructionDocument(null);
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
    for (const project of Object.values(miniProjects)) {
      if (!project.canvas) project.canvas = normalizeProjectInstructionDocument(null);
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
    const canvas = getProjectInstructionSnapshot();
    const previousCanvas = project ? project.canvas : unassignedProjectInstructionDocument;
    const changed = JSON.stringify(previousCanvas) !== JSON.stringify(canvas);
    if (project) project.canvas = canvas;
    else if (!projectInstructionInstanceId) {
      unassignedProjectInstructionDocument = canvas;
    }
    if (changed && projectAiBootComplete && !projectAiAccountWorkspaceApplying) {
      markProjectAiAccountWorkspaceDirty();
    }

    const save = () => {
      job.timer = null;
      try {
        persistState({ throwOnError: true });
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
    codeMirror.getScrollerElement?.()?.classList.add("ui-scroll-region");
    const previous = markdownLiveEditors.get(id);
    if (previous?.frame != null) {
      window.cancelAnimationFrame(previous.frame);
    }
    if (previous) {
      clearMarkdownLiveDecorations(previous);
      for (const { widget } of previous.taskDialogue?.widgets.values() || []) widget.clear();
    }
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

  function createTaskDialogueCard(record, updateAnswer) {
    const card = document.createElement("section");
    card.className = "project-task-dialogue";
    card.dataset.taskDialogueId = record.id;
    card.contentEditable = "false";
    const title = document.createElement("strong");
    title.textContent = ({
      question: "Clarifying question", requirement: "Agreed requirement",
      decision: "Technical decision", note: "Note", next: "Next step",
    })[record.kind] + " · " + record.id;
    const message = document.createElement("p");
    message.textContent = record.message;
    card.append(title, message);
    if (!["question", "next"].includes(record.kind)) return card;
    if (record.submitted) {
      const answer = document.createElement("p");
      answer.className = "project-task-dialogue-answer";
      answer.textContent = record.answer ? "Answer: " + record.answer : "Addressed in the task";
      card.append(answer);
      return card;
    }
    const choices = document.createElement("div");
    choices.className = "project-task-dialogue-choices";
    choices.setAttribute("role", "group");
    choices.setAttribute("aria-label", "Choices for " + record.id);
    const custom = document.createElement("label");
    custom.className = "project-task-dialogue-custom";
    custom.textContent = "Your answer";
    const field = document.createElement("textarea");
    field.className = "ui-text-input ui-scroll-region";
    field.setAttribute("aria-label", "Your answer to " + record.id);
    field.placeholder = "Write your own answer";
    field.rows = 2;
    field.maxLength = 2048;
    field.value = record.choice == null ? record.answer : "";
    const markChoice = (button, selected) => {
      button.setAttribute("aria-pressed", String(selected));
      button.classList.toggle("secondary-btn", !selected);
    };
    const buttons = record.options.map((option, index) => {
      const button = document.createElement("button");
      button.className = "ui-action ui-action--compact";
      button.type = "button";
      markChoice(button, record.choice === index);
      button.textContent = (index + 1) + ". " + option;
      button.addEventListener("click", () => {
        if (!updateAnswer(option, index)) return;
        field.value = "";
        buttons.forEach((item, i) => markChoice(item, index === i));
      });
      choices.append(button);
      return button;
    });
    field.addEventListener("input", () => {
      if (updateAnswer(field.value, null)) buttons.forEach(button => markChoice(button, false));
    });
    custom.append(field);
    if (buttons.length) card.append(choices);
    card.append(custom);
    return card;
  }

  function renderTaskDialogueWidgets(state, markdown) {
    const records = projectInstructionDocument.dialogue;
    const scope = projectInstructionScopeEpoch;
    if (state.taskDialogue?.records === records && state.taskDialogue?.markdown === markdown &&
        state.taskDialogue?.scope === scope) return;
    const scroll = captureMarkdownLiveScrollAnchor(state.editor);
    const widgets = new Map();
    state.editor.operation(() => {
      for (const { widget } of state.taskDialogue?.widgets.values() || []) widget.clear();
      state.taskDialogue = { records, markdown, scope, widgets };
      const headings = records?.length ? projectFormat.v3TaskHeadings(markdown) : [];
      for (const record of records || []) {
        const anchor = record.anchor.level ? projectFormat.findV3TaskHeading(headings, record.anchor) : null;
        const boundary = anchor && headings.find(heading => heading.line > anchor.line && heading.level <= anchor.level);
        const line = boundary ? boundary.line - 1 : state.editor.lastLine();
        const card = createTaskDialogueCard(record, (answer, choice) => {
          if (scope !== projectInstructionScopeEpoch) return false;
          const current = projectInstructionDocument.dialogue;
          const original = current?.find(item => item.id === record.id);
          if (!original || original.submitted) return false;
          if (original.answer === answer && original.choice === choice) return true;
          const dialogue = current.map(item => item === original ? { ...item, answer, choice } : item);
          projectInstructionDocument = { ...projectInstructionDocument, revision: projectInstructionDocument.revision + 1, dialogue };
          state.taskDialogue.records = dialogue;
          persistProjectInstruction({ recover: true });
          return true;
        });
        const widget = state.editor.addLineWidget(line, card, { noHScroll: true, handleMouseEvents: false, showIfHidden: true });
        widgets.set(record.id, { widget, card, line });
      }
    });
    restoreMarkdownLiveScrollAnchor(state.editor, scroll);
  }

  function revealPendingTaskDialogue(state) {
    if (state.id !== "instruction" || !pendingTaskDialogueReveal) return;
    const { id, scope } = pendingTaskDialogueReveal;
    if (scope !== projectInstructionScopeEpoch) {
      pendingTaskDialogueReveal = null;
      return;
    }
    if (projectAiColumnWidth <= WORKSPACE_PANEL_COMPACT_THRESHOLD) return;
    const entry = state.taskDialogue?.widgets.get(id);
    if (!entry) return;
    if (!entry.card.isConnected) state.editor.scrollIntoView(CodeMirror.Pos(entry.line, 0), 24);
    if (!entry.card.isConnected) return;
    const bounds = entry.card.getBoundingClientRect();
    const viewport = state.editor.getScrollerElement().getBoundingClientRect();
    pendingTaskDialogueReveal = null;
    if (bounds.top < viewport.top || bounds.bottom > viewport.bottom) {
      state.editor.scrollTo(null, state.editor.getScrollInfo().top + bounds.top - viewport.top - 8);
    }
  }

  function renderMarkdownLivePreviewState(state) {
    if (state.frame != null) window.cancelAnimationFrame?.(state.frame);
    state.frame = null;
    if (!state.editor || state.compositionActive) return;
    if (workspaceTransitionTimer !== null) return;
    const markdownRuntime = window.UartDebugMarkdown;
    const markdown = state.editor.getValue();
    if (state.id === "instruction") renderTaskDialogueWidgets(state, markdown);
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
      window.UartDebugNotifications?.notify({ key: "markdown-render", title: "Markdown", tone: "warning",
        message: "Preview could not be rendered. The original text is still available.", details: error.message || String(error) });
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
    revealPendingTaskDialogue(state);
    state.onHeadings?.(headings);
  }

  function scheduleMarkdownLivePreview(id) {
    const state = markdownLiveEditors.get(id);
    if (!state || state.compositionActive || workspaceLayoutSettling ||
        workspaceTransitionTimer !== null || state.frame !== null) return;
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
    { annotations, dialogue, locale, target, expectedRevision = null, focus = false } = {}
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
      ...(dialogue !== undefined ? { dialogue } : {}),
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
      projectInstructionEditor = createMarkdownDocumentEditor(editorElement, { label: "Project specification Markdown" });
      registerMarkdownLiveEditor("instruction", projectInstructionEditor, {
        getAuthorship: () => projectInstructionDocument.authorship,
        getContextKey: () => "project-instruction",
        resolveImageUrl: (href) => resolveDocumentationImageUrl(href, null),
      });

      const inputField = projectInstructionEditor.getInputField();
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
      getConversation: () => projectChatController?.getConversation(),
      getChats: () => normalizeProjectConversation(getProjectChatContext().conversation),
      sendMessage: message => projectChatController?.submit(message),
      stopResponse: () => projectChatController?.cancel(),
      setInstruction(markdown, options = {}) {
        applyProjectInstructionMarkdown(markdown, options);
        return getProjectInstructionSnapshot();
      },
    });
  }


  function readStoredProjectAiAccountSync() {
    try {
      const raw = window.localStorage.getItem(STORAGE_PROJECT_AI_ACCOUNT_SYNC);
      const parsed = JSON.parse(raw || "null");
      if (!parsed || ![1, 2, 3, 4, 5].includes(parsed.schemaVersion) || !parsed.accountKey) return null;
      const current = parsed.schemaVersion >= 4;
      const bound = parsed.schemaVersion === 5
        ? !!parsed.localCheckpoint && (parsed.localCheckpoint === getWorkspacePersistence().checkpoint ||
          raw === legacySyncMarkerRaw && parsed.localCheckpoint === legacyCheckpoint)
        : raw === legacySyncMarkerRaw;
      return {
        accountKey: String(parsed.accountKey),
        localCheckpoint: parsed.localCheckpoint,
        writerId: parsed.writerId,
        bound,
        revision: current ? parsed.revision : parsed.revisions?.files,
        dirty: !bound || (current ? parsed.dirty === true : parsed.dirty?.files === true || parsed.dirty?.instruction === true),
        conflict: current ? parsed.conflict === true : parsed.conflicts?.files === true || parsed.conflicts?.instruction === true,
        legacyInstructionRevision: parsed.legacyInstructionRevision,
      };
    } catch { return null; }
  }

  function getForeignPendingWorkspaceMarker() {
    try {
      const marker = JSON.parse(localStorage.getItem(STORAGE_PROJECT_AI_LOCAL_DIRTY) || "null");
      return marker?.schemaVersion === 5 && marker.pending === true && marker.dirty === true && marker.writerId &&
        marker.writerId !== workspaceRecoveryLineage && marker.localCheckpoint === getWorkspacePersistence().checkpoint
        ? marker : null;
    } catch { return null; }
  }

  function adoptConfirmedWorkspaceRevision() {
    if (projectAiAccountSync.conflict) return;
    const marker = readStoredProjectAiAccountSync();
    if (marker?.bound && marker.accountKey === projectAiAccountSync.accountKey && !marker.conflict &&
        (!marker.dirty || marker.writerId === workspaceRecoveryLineage) &&
        Number.isSafeInteger(marker.revision) && marker.revision > projectAiAccountSync.revision) {
      projectAiAccountSync.revision = marker.revision;
    }
  }


  function restoreProjectAiLocalDirtyState() {
    try {
      const raw = window.localStorage.getItem(STORAGE_PROJECT_AI_LOCAL_DIRTY);
      const stored = JSON.parse(raw || "null");
      const bound = stored?.schemaVersion === 5
        ? !!stored.localCheckpoint && (stored.localCheckpoint === getWorkspacePersistence().checkpoint ||
          raw === legacyDirtyMarkerRaw && stored.localCheckpoint === legacyCheckpoint)
        : raw === legacyDirtyMarkerRaw;
      projectAiAccountSync.localDirty = !bound || (stored?.schemaVersion >= 4
        ? stored.dirty === true : stored?.dirty?.files === true || stored?.dirty?.instruction === true);
    } catch { projectAiAccountSync.localDirty = true; }
  }


  function persistProjectAiLocalDirtyState() {
    try {
      if (!requireWorkspaceOwnership()) return false;
      // A pending editor mutation can precede its debounced envelope write.
      // A different tab's ACK/no-op must not mark that mutation saved.
      if (getForeignPendingWorkspaceMarker()) return false;
      window.localStorage.setItem(STORAGE_PROJECT_AI_LOCAL_DIRTY, JSON.stringify({
        schemaVersion: 5, localCheckpoint: getWorkspacePersistence().checkpoint,
        writerId: workspaceRecoveryLineage,
        pending: workspaceLocalPending,
        dirty: projectAiAccountSync.localDirty, updatedAt: Date.now(),
      }));
    } catch (error) {
      console.warn("The local account-sync markers could not be saved:", error);
      window.UartDebugNotifications?.notify({ key: "account-sync-storage", title: "Account synchronization", tone: "warning",
        message: "Synchronization state could not be saved in this browser.", details: error.message || String(error) });
    }
  }


  function setProjectAiLocalDirty(dirty) {
    projectAiAccountSync.localDirty = dirty === true;
    persistProjectAiLocalDirtyState();
  }


  function restoreProjectAiAccountSyncState() {
    const stored = readStoredProjectAiAccountSync();
    if (!stored) return;
    projectAiAccountSync.accountKey = stored.accountKey;
    projectAiAccountSync.legacyInstructionRevision = Number.isSafeInteger(stored.legacyInstructionRevision)
      ? stored.legacyInstructionRevision : null;
    const revision = Number(stored.revision);
    projectAiAccountSync.revision = Number.isSafeInteger(revision) && revision >= 0 ? revision : 0;
    projectAiAccountSync.dirty = stored.dirty;
    projectAiAccountSync.conflict = stored.conflict;
  }


  function persistProjectAiAccountSyncState() {
    if (!projectAiAccountSync.accountKey) return false;
    try {
      if (!requireWorkspaceOwnership()) return false;
      adoptConfirmedWorkspaceRevision();
      const pending = getForeignPendingWorkspaceMarker();
      if (pending) {
        const previous = readStoredProjectAiAccountSync();
        if (previous?.bound && previous.accountKey === projectAiAccountSync.accountKey) {
          // The ACK confirms this durable checkpoint's base revision, while
          // preserving the other writer's still-pending mutation and identity.
          const raw = JSON.parse(localStorage.getItem(STORAGE_PROJECT_AI_ACCOUNT_SYNC));
          localStorage.setItem(STORAGE_PROJECT_AI_ACCOUNT_SYNC, JSON.stringify({ ...raw,
            revision: Math.max(Number(previous.revision) || 0, projectAiAccountSync.revision),
            dirty: true, writerId: pending.writerId, updatedAt: Date.now() }));
        }
        return false;
      }
      window.localStorage.setItem(STORAGE_PROJECT_AI_ACCOUNT_SYNC, JSON.stringify({
        schemaVersion: 5,
        localCheckpoint: getWorkspacePersistence().checkpoint,
        writerId: workspaceRecoveryLineage,
        pending: workspaceLocalPending,
        accountKey: projectAiAccountSync.accountKey,
        revision: projectAiAccountSync.revision,
        dirty: projectAiAccountSync.dirty,
        conflict: projectAiAccountSync.conflict,
        legacyInstructionRevision: projectAiAccountSync.legacyInstructionRevision,
        updatedAt: Date.now(),
      }));
      return true;
    } catch (error) {
      console.warn("The account sync state could not be saved:", error);
      window.UartDebugNotifications?.notify({ key: "account-sync-storage", title: "Account synchronization", tone: "warning",
        message: "Synchronization state could not be saved in this browser.", details: error.message || String(error) });
      return false;
    }
  }

  function getProjectAiAccountFilesSnapshot({ captureLive = true } = {}) {
    if (captureLive && editor && current && hasFile(current)) {
      files[current] = editor.getValue();
    }
    for (const fileName of Object.keys(files)) {
      setFileAuthorship(fileName, fileAuthorship[fileName], files[fileName]);
    }
    if (captureLive && projectInstructionInstanceId && miniProjects[projectInstructionInstanceId]) {
      miniProjects[projectInstructionInstanceId].canvas = getProjectInstructionSnapshot();
    } else if (captureLive && !projectInstructionInstanceId) {
      unassignedProjectInstructionDocument = getProjectInstructionSnapshot();
    }
    return {
      schemaVersion: 3,
      files: cloneJsonMetadata(files, {}),
      authorship: cloneJsonMetadata(fileAuthorship, {}),
      miniProjects: cloneJsonMetadata(miniProjects, {}),
      current: typeof current === "string" ? current : null,
      draftCanvas: getUnassignedProjectInstructionSnapshot(),
      ...(draftProjectConversation ? { draftConversation: normalizeProjectConversation(draftProjectConversation) } : {}),
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
    const normalizedProjects = createDictionary(cloneJsonMetadata(source.miniProjects, {}));
    for (const project of Object.values(normalizedProjects)) {
      if (project?.canvas && typeof project.canvas === "object") {
        project.canvas = normalizeProjectInstructionDocument(project.canvas);
      }
    }
    return {
      schemaVersion: 3,
      files: normalizedFiles,
      authorship: normalizedAuthorship,
      ...(Object.hasOwn(source, "fileGroups")
        ? { fileGroups: createDictionary(cloneJsonMetadata(source.fileGroups, {})) } : {}),
      miniProjects: normalizedProjects,
      current: typeof source.current === "string" ? source.current : null,
      draftCanvas: normalizeProjectInstructionDocument(source.draftCanvas),
      ...(source.draftConversation ? { draftConversation: normalizeProjectConversation(source.draftConversation) } : {}),
    };
  }

  function migrateLegacyProjectAiAccountSnapshot(rawData, legacyInstruction) {
    const source = rawData && typeof rawData === "object" ? rawData : {};
    const snapshot = normalizeProjectAiAccountFilesSnapshot(source);
    if (source.schemaVersion !== 3) {
      snapshot.draftCanvas = normalizeProjectInstructionDocument(legacyInstruction);
    }
    for (const project of Object.values(snapshot.miniProjects)) {
      if (!project || typeof project !== "object") continue;
      const active = Object.values(project.files || {}).includes(snapshot.current)
        || Object.values(project.guides || {}).some(guide => guide?.fileName === snapshot.current);
      project.canvas = normalizeProjectInstructionDocument(project.canvas
        || (source.schemaVersion !== 3 && active ? snapshot.draftCanvas : null));
    }
    return snapshot;
  }

  function projectAiWorkspaceValuesEqual(left, right) {
    // Object insertion order is not a change; arrays and every stored value are.
    if (left === right) return true;
    if (!left || !right || typeof left !== "object" || typeof right !== "object" ||
        Array.isArray(left) !== Array.isArray(right)) return false;
    const keys = Object.keys(left);
    return keys.length === Object.keys(right).length && keys.every(key =>
      Object.hasOwn(right, key) && projectAiWorkspaceValuesEqual(left[key], right[key]));
  }

  function projectAiAccountWorkspaceMatches(remoteData) {
    try {
      return projectAiWorkspaceValuesEqual(getProjectAiAccountFilesSnapshot(), normalizeProjectAiAccountFilesSnapshot(remoteData));
    } catch { return false; }
  }


  function getEmptyProjectAiAccountWorkspace() {
    return {
      schemaVersion: 3, files: {}, authorship: {}, miniProjects: {}, current: null,
      draftCanvas: normalizeProjectInstructionDocument(null),
    };
  }

  function saveProjectAiWorkspaceRecovery(
    data,
    sourceAccountKey = projectAiAccountSync.accountKey,
    { protectedCopy = false, lineage = null } = {}
  ) {
    const storageKeyBase = STORAGE_PROJECT_AI_FILES_RECOVERY;
    const recoveryScope =
      String(sourceAccountKey || "browser-local")
        .replace(/[^A-Za-z0-9_-]/g, "")
        .slice(0, 128) || "browser-local";
    const scopePrefix = `${storageKeyBase}:${recoveryScope}`;
    try {
      const serializedData = JSON.stringify(data);
      for (let index = 0; index < window.localStorage.length; index += 1) {
        const key = window.localStorage.key(index);
        if (key !== scopePrefix && !key?.startsWith(`${scopePrefix}:`)) continue;
        let previous;
        try { previous = JSON.parse(window.localStorage.getItem(key)); }
        catch { continue; } // Unreadable evidence is neither replaced nor pruned.
        if (previous?.schemaVersion !== 1) continue;
        if (lineage && previous.protectedLineage === lineage) {
          if (JSON.stringify(previous.data) !== serializedData) window.localStorage.setItem(key,
            JSON.stringify({ ...previous, data, savedAt: Date.now() }));
          return true;
        }
        if (JSON.stringify(previous.data) !== serializedData ||
            (lineage && previous.protectedLineage && previous.protectedLineage !== lineage)) continue;
        if (protectedCopy && (!previous.protectedCopy || lineage && !previous.protectedLineage)) window.localStorage.setItem(key,
          JSON.stringify({ ...previous, protectedCopy: true, ...(lineage ? { protectedLineage: lineage } : {}) }));
        return true;
      }
      let storageKey = scopePrefix;
      let suffix = 0;
      while (window.localStorage.getItem(storageKey) !== null) {
        storageKey = `${scopePrefix}:${Date.now()}-${suffix++}`;
      }
      window.localStorage.setItem(
        storageKey,
        JSON.stringify({
          schemaVersion: 1,
          sourceAccountKey: recoveryScope,
          savedAt: Date.now(),
          ...(protectedCopy ? { protectedCopy: true } : {}),
          ...(lineage ? { protectedLineage: lineage } : {}),
          data,
          ...(projectInstructionStorageReadFailed ? { unreadableDraft:
            window.localStorage.getItem(STORAGE_PROJECT_INSTRUCTION)
              ?? window.localStorage.getItem(STORAGE_PROJECT_INSTRUCTION_LEGACY) } : {}),
        })
      );
      const scopedCopies = [];
      for (let index = 0; index < window.localStorage.length; index += 1) {
        const candidateKey = window.localStorage.key(index);
        if (!candidateKey?.startsWith(`${storageKeyBase}:`)) continue;
        let savedAt = 0;
        try {
          const candidate = JSON.parse(window.localStorage.getItem(candidateKey) || "null");
          // Unreadable/future workspace envelopes must remain exact recovery
          // evidence, rather than being pruned with normal account snapshots.
          if (candidate?.schemaVersion !== 1 || !candidate.data || candidate.protectedCopy || typeof candidate.rawWorkspace === "string") continue;
          savedAt = Number(candidate?.savedAt);
        } catch { continue; }
        scopedCopies.push({
          key: candidateKey,
          savedAt: Number.isFinite(savedAt) ? savedAt : 0,
          order: index,
        });
      }
      scopedCopies
        .sort((left, right) => right.savedAt - left.savedAt || right.order - left.order)
        .slice(3)
        .forEach(({ key }) => window.localStorage.removeItem(key));
      return true;
    } catch (error) {
      console.warn("The local workspace recovery copy could not be saved:", error);
      window.UartDebugNotifications?.notify({ key: "workspace-recovery", title: "Project storage", tone: "error",
        message: "The workspace recovery copy could not be saved.", details: error.message || String(error) });
      return false;
    }
  }

  function applyProjectAiAccountFilesSnapshot(rawData) {
    if (
      !rawData ||
      rawData.schemaVersion !== 3 ||
      !rawData.draftCanvas ||
      !rawData.files ||
      typeof rawData.files !== "object" ||
      Array.isArray(rawData.files)
    ) {
      throw new TypeError("The saved account file workspace is invalid.");
    }
    if (!captureAndPersistWorkspace()) return false;
    projectChatController?.cancel("The account workspace changed. No response changes were applied.", { save: false });
    invalidateWorkspaceWriters();
    const previousWorkspace = {
      files,
      fileAuthorship,
      miniProjects,
      current,
      unassignedProjectInstructionDocument,
      projectInstructionDocument,
      projectInstructionInstanceId,
      workspaceDraftCanvasRestored,
      projectInstructionStorageReadFailed,
      draftProjectConversation,
    };
    files = createDictionary(cloneJsonMetadata(rawData.files, {}));
    fileAuthorship = createDictionary(
      cloneJsonMetadata(rawData.authorship, {})
    );
    for (const fileName of Object.keys(files)) {
      setFileAuthorship(fileName, fileAuthorship[fileName], files[fileName]);
    }
    miniProjects = createDictionary(cloneJsonMetadata(rawData.miniProjects, {}));
    current = typeof rawData.current === "string" ? rawData.current : null;
    unassignedProjectInstructionDocument = normalizeProjectInstructionDocument(rawData.draftCanvas);
    draftProjectConversation = rawData.draftConversation ? normalizeProjectConversation(rawData.draftConversation, { recoverPending: true }) : null;
    workspaceDraftCanvasRestored = true;
    projectInstructionStorageReadFailed = false;
    normalizeMiniProjectInstances();
    if (current && !hasFile(current)) current = null;
    migrateLooseFilesToProjects(rawData.fileGroups);
    if (!current) current = getVisibleWorkspaceFileNames()[0] || null;
    const activeProject = getMiniProjectForFile(current);
    projectInstructionInstanceId = activeProject?.instanceId || null;
    projectInstructionDocument = normalizeProjectInstructionDocument(activeProject
      ? activeProject.project.canvas : unassignedProjectInstructionDocument);
    try {
      persistState({ throwOnError: true });
    } catch (error) {
      ({ files, fileAuthorship, miniProjects, current,
        unassignedProjectInstructionDocument, projectInstructionDocument,
        projectInstructionInstanceId, workspaceDraftCanvasRestored, projectInstructionStorageReadFailed, draftProjectConversation } =
        previousWorkspace);
      console.warn("The cloud AVR workspace could not be saved locally:", error);
      return false;
    }
    if (saveTimer) {
      window.clearTimeout(saveTimer);
      saveTimer = null;
    }
    if (documentationSaveTimer) {
      window.clearTimeout(documentationSaveTimer);
      documentationSaveTimer = null;
    }
    for (const scope of projectInstructionSaveJobs.keys()) {
      cancelProjectInstructionSave(scope);
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
    activateCurrentProjectCanvas({ savePrevious: false });
    projectChatController?.refresh({ force: true });
    refreshDocumentationPane();
    scheduleDocumentationMarkerRefresh();
    resetHexArtifact();
    updateCompilePanelState();
    return true;
  }


  function applyProjectAiAccountWorkspace(data) {
    projectAiAccountWorkspaceApplying = true;
    try { return applyProjectAiAccountFilesSnapshot(data); }
    finally { projectAiAccountWorkspaceApplying = false; }
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


  function scheduleProjectAiAccountWorkspaceSave(delay = 700) {
    if (!projectAiAccountSync.ready || projectAiAccountSync.conflict ||
        projectAiAccountSync.rejectedMutation === projectAiAccountSync.mutation) return;
    if (projectAiAccountSaveTimer) window.clearTimeout(projectAiAccountSaveTimer);
    projectAiAccountSaveTimer = window.setTimeout(() => {
      projectAiAccountSaveTimer = null;
      void saveProjectAiAccountWorkspace();
    }, delay);
  }


  function markProjectAiAccountWorkspaceDirty({ pending = true } = {}) {
    adoptConfirmedWorkspaceRevision();
    workspaceLocalPending = pending;
    projectAiAccountSync.dirty = true;
    projectAiAccountSync.mutation += 1;
    projectAiAccountSync.rejectedMutation = null;
    setProjectAiLocalDirty(true);
    persistProjectAiAccountSyncState();
    scheduleProjectAiAccountWorkspaceSave();
  }

  function getProjectAiAccountSaveFailureMessage(result, status) {
    const detail = String(result?.message || "").trim();
    return `Projects remain saved locally, but cloud sync was paused${
      detail ? `: ${detail}` : ` after server error ${status}`
    }`;
  }

  async function saveProjectAiAccountWorkspace() {
    if (!preserveUnreadableWorkspace()) return;
    if (
      !projectAiAccountSync.ready ||
      !projectAiAccountSync.dirty ||
      projectAiAccountSync.saving ||
      projectAiAccountSync.conflict ||
      projectAiAccountSync.rejectedMutation === projectAiAccountSync.mutation
    ) {
      return;
    }
    if (!captureAndPersistWorkspace()) return;
    if (projectAiAccountSync.conflict || !requireWorkspaceOwnership()) return;
    const mutation = projectAiAccountSync.mutation;
    const baseRevision = projectAiAccountSync.revision;
    const data = getProjectAiAccountFilesSnapshot({ captureLive: false });
    const checkpoint = getWorkspacePersistence().checkpoint;
    const workspaceEpoch = projectAiAccountWorkspaceEpoch;
    const accountKey = projectAiAccountSync.accountKey;
    projectAiAccountSync.saving = true;
    let retryDelay = 0;
    try {
      const response = await fetch(`${PROJECT_AI_ACCOUNT_WORKSPACE_URL}/files`, {
        method: "PUT",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        credentials: "same-origin",
        body: JSON.stringify({
          baseRevision,
          expectedAccountKey: accountKey,
          ...(Number.isSafeInteger(projectAiAccountSync.legacyInstructionRevision)
            ? { expectedLegacyInstructionRevision: projectAiAccountSync.legacyInstructionRevision } : {}),
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
      if (!requireWorkspaceOwnership()) return;
      if (
        response.status === 409 &&
        result?.code === "account_workspace_account_mismatch"
      ) {
        reportProjectCanvasMessage(
          "system",
          `The local Projects copy remains saved because the Google account changed in another tab. Cloud sync will reconnect to the current account before saving.`
        );
        reconnectProjectAiAccountIdentity();
        return;
      }
      let verifiedAcknowledgement = null;
      if (response.status === 409 && result?.code === "account_data_revision_conflict") {
        // A successful PUT can lose its ACK. Only exact equality with the
        // immutable sent snapshot can acknowledge it; never merge newer edits.
        const check = await fetch(PROJECT_AI_ACCOUNT_WORKSPACE_URL, {
          method: "GET", headers: { Accept: "application/json" }, credentials: "same-origin",
        });
        const latest = await check.json().catch(() => ({}));
        if (workspaceEpoch !== projectAiAccountWorkspaceEpoch || accountKey !== projectAiAccountSync.accountKey ||
            !requireWorkspaceOwnership()) return;
        if (check.status === 401 || check.status === 403) {
          expireProjectAiWorkspaceSession("The Google session expired. Your local changes are safe; sign in again to resume cloud sync.");
          return;
        }
        if (!check.ok || latest.ok !== true || !latest.accountKey) {
          throw new Error(`The saved workspace could not be verified (${check.status}).`);
        }
        if (latest.accountKey !== accountKey || projectAiAuthSession?.accountKey !== accountKey) {
          reconnectProjectAiAccountIdentity();
          return;
        }
        const remote = normalizeProjectAiRemoteDocument((latest.documents || latest.workspace || latest).files);
        if (remote.revision > baseRevision &&
            projectAiWorkspaceValuesEqual(remote.data, data)) verifiedAcknowledgement = remote;
      }
      if (response.status === 409 && !verifiedAcknowledgement) {
        projectAiAccountSync.conflict = true;
        persistProjectAiAccountSyncState();
        reportProjectCanvasMessage(
          "system",
          `Projects changed in another tab or browser. The local copy was kept and cloud saving was paused to avoid overwriting it. Reload the page to choose which copy to use.`
        );
        return;
      }
      if (response.status === 401 || response.status === 403) {
        expireProjectAiWorkspaceSession(
          `The local Projects copy remains saved. The Google session expired; sign in again to resume cloud sync.`
        );
        return;
      }
      if ([400, 413, 415].includes(response.status)) {
        // A rejection acknowledges no data. Block only this unchanged
        // candidate; a real edit is eligible for a fresh attempt.
        if (projectAiAccountSync.mutation === mutation && getWorkspacePersistence().checkpoint === checkpoint) {
          projectAiAccountSync.rejectedMutation = mutation;
        }
        projectAiAccountSync.dirty = true;
        setProjectAiLocalDirty(true);
        persistProjectAiAccountSyncState();
        reportProjectCanvasMessage(
          "system",
          getProjectAiAccountSaveFailureMessage(result, response.status)
        );
        return;
      }
      if (!verifiedAcknowledgement && (!response.ok || result?.ok !== true)) {
        if (response.status === 429) {
          const retryAfter = Number(response.headers.get("Retry-After"));
          if (Number.isFinite(retryAfter) && retryAfter > 0) {
            retryDelay = Math.min(120_000, retryAfter * 1000);
          }
        }
        throw new Error(
          String(result?.message || `Account workspace save failed (${response.status}).`)
        );
      }
      const savedDocument = verifiedAcknowledgement || result.document || result.files || result;
      const revision = Number(savedDocument?.revision);
      if (!Number.isSafeInteger(revision) || revision <= baseRevision) {
        throw new Error(`Account workspace save returned an invalid revision.`);
      }
      projectAiAccountSync.revision = revision;
      projectAiAccountSync.legacyInstructionRevision = null;
      projectAiAccountSync.dirty =
        projectAiAccountSync.mutation !== mutation || getWorkspacePersistence().checkpoint !== checkpoint;
      projectAiAccountSync.retryCount = 0;
      if (!projectAiAccountSync.dirty) {
        setProjectAiLocalDirty(false);
        setProjectAiAccountStatus("Projects synchronized with your account.", "success");
      }
      persistProjectAiAccountSyncState();
    } catch (error) {
      if (
        workspaceEpoch !== projectAiAccountWorkspaceEpoch ||
        accountKey !== projectAiAccountSync.accountKey
      ) {
        return;
      }
      projectAiAccountSync.retryCount += 1;
      retryDelay =
        retryDelay ||
        Math.min(
          60_000,
          1800 * 2 ** Math.min(projectAiAccountSync.retryCount - 1, 5)
        );
      console.warn(`Account workspace sync failed:`, error);
      window.UartDebugNotifications?.notify({ key: "account-sync", title: "Account synchronization", tone: "warning",
        message: "Projects could not be synchronized. Retrying automatically.", details: error.message || String(error) });
    } finally {
      if (
        workspaceEpoch !== projectAiAccountWorkspaceEpoch ||
        accountKey !== projectAiAccountSync.accountKey
      ) {
        return;
      }
      projectAiAccountSync.saving = false;
      if (
        projectAiAccountSync.ready &&
        projectAiAccountSync.dirty &&
        !projectAiAccountSync.conflict
      ) {
        scheduleProjectAiAccountWorkspaceSave(retryDelay || 1800);
      }
    }
  }


  function reconnectProjectAiAccountIdentity() {
    resetProjectAiAccountWorkspaceRuntime();
    projectAiAuthRequestEpoch += 1;
    projectAiAuthSessionPromise = null;
    void fetchProjectAiAuthSession().catch(error => console.warn("Account identity could not be refreshed:", error));
  }

  function resetProjectAiAccountWorkspaceRuntime() {
    const saved = captureAndPersistWorkspace();
    projectChatController?.cancel("Account access changed. No response changes were applied.", { save: false });
    // Failed persistence must not discard an input still owned by the chat
    // controller when its account epoch is invalidated for security.
    const chat = projectChatController?.getScopedSnapshot?.();
    if (chat?.scope.accountEpoch === projectAiAccountWorkspaceEpoch) {
      const project = chat.scope.instanceId ? miniProjects[chat.scope.instanceId] : null;
      if (project) project.conversation = chat.conversation;
      else if (!chat.scope.instanceId) draftProjectConversation = chat.conversation;
    }
    if (!saved) saveProjectAiWorkspaceRecovery(getProjectAiAccountFilesSnapshot({ captureLive: false }),
      projectAiAccountSync.accountKey, { protectedCopy: true, lineage: workspaceRecoveryLineage });
    invalidateWorkspaceWriters();
    projectAiAccountWorkspaceEpoch += 1;
    projectChatController?.refresh({ force: true });
    projectAiAccountWorkspacePromise = null;
    projectAiAccountSync.ready = false;
    if (projectAiAccountWorkspaceRetryTimer) window.clearTimeout(projectAiAccountWorkspaceRetryTimer);
    projectAiAccountWorkspaceRetryTimer = null;
    projectAiAccountWorkspaceRetryCount = 0;
    if (projectAiAccountSaveTimer) window.clearTimeout(projectAiAccountSaveTimer);
    projectAiAccountSaveTimer = null;
    projectAiAccountSync.saving = false;
    projectAiAccountSync.retryCount = 0;
    projectAiAccountSync.rejectedMutation = null;
  }


  function hasMeaningfulProjectAiLocalWorkspace(snapshot = getProjectAiAccountFilesSnapshot()) {
    const draftChats = snapshot.draftConversation ? normalizeProjectConversation(snapshot.draftConversation).threads : [];
    return Object.entries(snapshot.files || {}).some(
      ([name, content]) => name !== "main.c" || String(content || "").length > 0
    ) ||
      Object.keys(snapshot.miniProjects || {}).length > 0 ||
      String(snapshot.draftCanvas.markdown || "").trim().length > 0 ||
      (snapshot.draftCanvas.dialogue?.length || 0) > 0 ||
      draftChats.length > 1 || draftChats.some(
        chat => chat.messages.length > 0 || chat.draft.trim().length > 0 || chat.titleMode === "manual"
      );
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


  function pauseProjectAiAccountWorkspaceForRecoveryFailure() {
    projectAiAccountSync.dirty = false;
    projectAiAccountSync.conflict = true;
    reportProjectCanvasMessage("system",
      "The local Projects copy was not replaced because the browser could not safely persist both the local recovery and cloud copies. Free some browser storage and reload to choose again.");
  }

  function captureAndPersistWorkspace() {
    // Explicit transition barrier: persistence itself must never capture a
    // stale view while selection/import is staging a new owner model.
    if (!requireWorkspaceOwnership()) return false;
    getProjectAiAccountFilesSnapshot();
    saveDocumentationEditorValue();
    if (projectChatController?.flush() !== false && persistState()) return true;
    setProjectAiAccountStatus(
      "Cloud sync is paused because the current workspace could not be saved in this browser. Your drafts remain open; free browser storage and reload.",
      "error"
    );
    return false;
  }

  async function initializeProjectAiAccountWorkspace() {
    if (!preserveUnreadableWorkspace()) return null;
    if (projectAiAccountSync.ready) return null;
    if (projectAiAccountWorkspacePromise) return projectAiAccountWorkspacePromise;
    projectChatController?.cancel("Account workspace is being synchronized. No response changes were applied.");
    if (!captureAndPersistWorkspace()) return null;
    const workspaceEpoch = ++projectAiAccountWorkspaceEpoch;
    projectChatController?.refresh({ force: true });
    const mutationAtStart = projectAiAccountSync.mutation;
    // Another tab can update the shared sync marker while this tab still has
    // its older copy in memory. Only this copy's known base can authorize a PUT.
    const baseAccountKey = projectAiAccountSync.accountKey;
    const baseRevision = projectAiAccountSync.revision;
    const promise = (async () => {
      const response = await fetch(PROJECT_AI_ACCOUNT_WORKSPACE_URL, {
        method: "GET", headers: { Accept: "application/json" }, credentials: "same-origin",
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result?.ok !== true) {
        const error = new Error(String(result?.message || `Account workspace could not be loaded (${response.status}).`));
        error.httpStatus = response.status;
        error.retryAfterSeconds = response.headers.get("Retry-After");
        throw error;
      }
      if (workspaceEpoch !== projectAiAccountWorkspaceEpoch || projectAiAuthSession?.authenticated !== true) return null;
      // Include input still waiting for the chat debounce in reconciliation and
      // any recovery copy before an authoritative cloud snapshot is adopted.
      if (!captureAndPersistWorkspace()) return null;
      const accountKey = String(result.accountKey || "").trim();
      if (!accountKey) throw new Error("Account workspace identity is missing.");
      const verifiedAccountKey = String(projectAiAuthSession?.accountKey || "");
      if (!verifiedAccountKey || verifiedAccountKey !== accountKey) {
        reconnectProjectAiAccountIdentity();
        return null;
      }
      const stored = readStoredProjectAiAccountSync();
      const sameAccount = stored?.accountKey === accountKey;
      const differentKnownAccount = !!stored?.accountKey && !sameAccount;
      const documents = result.documents || result.workspace || result;
      const remote = normalizeProjectAiRemoteDocument(documents.files);
      const legacyInstruction = normalizeProjectAiRemoteDocument(documents.instruction);
      const instructionMigrationRequired = remote.data?.schemaVersion !== 3;
      const migrationRequired = instructionMigrationRequired || Object.hasOwn(remote.data || {}, "fileGroups");
      projectAiAccountSync.legacyInstructionRevision = instructionMigrationRequired ? legacyInstruction.revision : null;
      if (instructionMigrationRequired && (remote.data !== null || legacyInstruction.data !== null)) {
        remote.data = migrateLegacyProjectAiAccountSnapshot(remote.data, legacyInstruction.data);
      }
      projectAiAccountSync.accountKey = accountKey;
      const localRecoveryAccountKey = String(stored?.accountKey || "").trim() || "browser-local";

      if (!sameAccount) {
        Object.assign(projectAiAccountSync, { revision: 0, dirty: false, conflict: true, retryCount: 0 });
        if (!persistProjectAiAccountSyncState()) {
          projectAiAccountSync.accountKey = String(stored?.accountKey || "");
          const message = "The Google account workspace was not opened because the browser could not safely record the account transition. Local data was not changed. Free some browser storage and reload.";
          reportProjectCanvasMessage("system", message);
          setProjectAiAccountStatus(message, "error");
          return null;
        }
      }

      let importMissingFromPreviousAccount = false;
      if (differentKnownAccount && remote.revision === 0 && remote.data === null && hasMeaningfulProjectAiLocalWorkspace()) {
        importMissingFromPreviousAccount = await showSiteConfirm({
          title: "Different Google account",
          message: "This browser still contains local AVR data from another account. Import the local data into this Google account? Choose Start empty to keep it out of the new account; a recovery copy remains in this browser.",
          confirmText: "Import local data", cancelText: "Start empty",
        });
        if (workspaceEpoch !== projectAiAccountWorkspaceEpoch) return null;
      }

      const hasLocalBase = sameAccount && baseAccountKey === accountKey &&
        Number.isSafeInteger(baseRevision) && baseRevision >= 0;
      const sameRevision = hasLocalBase && baseRevision === remote.revision;
      const mutationChangedDuringRequest = projectAiAccountSync.mutation !== mutationAtStart;
      const localDirty = projectAiAccountSync.localDirty || mutationChangedDuringRequest ||
        (sameAccount && stored.dirty) || (!stored && hasMeaningfulProjectAiLocalWorkspace());
      const rememberedConflict = sameAccount && stored.conflict;
      projectAiAccountSync.revision = hasLocalBase ? baseRevision : 0;
      Object.assign(projectAiAccountSync, { dirty: false, conflict: false, retryCount: 0 });
      let pendingConflict = false;
      const preserveLocalCopy = sourceAccountKey => saveProjectAiWorkspaceRecovery(
        getProjectAiAccountFilesSnapshot(), sourceAccountKey
      );
      const applyCloudCopy = sourceAccountKey => {
        if (!preserveLocalCopy(sourceAccountKey)) {
          projectAiAccountSync.conflict = true;
          pendingConflict = true;
          return false;
        }
        if (!applyProjectAiAccountWorkspace(remote.data)) {
          pauseProjectAiAccountWorkspaceForRecoveryFailure();
          return false;
        }
        projectAiAccountSync.revision = remote.revision;
        setProjectAiLocalDirty(false);
        return true;
      };

      const reconcileWorkspace = async () => {
        if (remote.data === null) {
          projectAiAccountSync.revision = 0;
          let importLocal = true;
          if (rememberedConflict) {
            importLocal = await showSiteConfirm({
              title: "Empty cloud workspace: Projects",
              message: "The cloud has no Projects copy, while this browser still has local data from an unresolved account transition. Import the local copy into this account? Choose Start empty to keep the local data out of the account; a recovery copy will be kept.",
              confirmText: "Import local data", cancelText: "Start empty",
            });
            if (workspaceEpoch !== projectAiAccountWorkspaceEpoch) return;
          } else if (differentKnownAccount) importLocal = importMissingFromPreviousAccount;
          if (!importLocal && (!preserveLocalCopy(localRecoveryAccountKey) ||
              !applyProjectAiAccountWorkspace(getEmptyProjectAiAccountWorkspace()))) {
            pauseProjectAiAccountWorkspaceForRecoveryFailure();
            return;
          }
          projectAiAccountSync.dirty = true;
          setProjectAiLocalDirty(true);
          return;
        }
        if (!sameAccount) {
          if ((!differentKnownAccount && localDirty) || mutationChangedDuringRequest) {
            projectAiAccountSync.conflict = true;
            pendingConflict = true;
          } else applyCloudCopy(localRecoveryAccountKey);
          return;
        }
        const matchesCloud = projectAiAccountWorkspaceMatches(remote.data);
        if (matchesCloud && (!instructionMigrationRequired || sameRevision && !rememberedConflict)) {
          projectAiAccountSync.revision = remote.revision;
          setProjectAiLocalDirty(false);
          return;
        }
        // Own unsaved edits are not a conflict when
        // the unified cloud document has not advanced. The PUT still uses CAS.
        // Legacy split instruction documents need their separate reconciliation.
        if (!instructionMigrationRequired && sameRevision && localDirty) {
          projectAiAccountSync.dirty = true;
          setProjectAiLocalDirty(true);
          return;
        }
        if (rememberedConflict || localDirty) {
          projectAiAccountSync.dirty = localDirty;
          projectAiAccountSync.conflict = true;
          pendingConflict = true;
          return;
        }
        applyCloudCopy(accountKey);
      };
      await reconcileWorkspace();
      if (workspaceEpoch !== projectAiAccountWorkspaceEpoch) return null;

      if (pendingConflict) {
        const useCloud = await showSiteConfirm({
          title: "Cloud sync conflict: Projects",
          message: "A newer cloud copy exists for Projects. Load that cloud copy on this device? A local recovery copy will be kept. Choose Pause sync to keep this local version without overwriting the cloud.",
          confirmText: "Use cloud copy", cancelText: "Pause sync",
        });
        if (workspaceEpoch !== projectAiAccountWorkspaceEpoch) return null;
        if (!useCloud) reportProjectCanvasMessage("system",
          "Cloud sync is paused for Projects. Nothing was overwritten. Reload the page when you are ready to choose again.");
        else if (!preserveLocalCopy(sameAccount ? accountKey : localRecoveryAccountKey) ||
            !applyProjectAiAccountWorkspace(remote.data)) pauseProjectAiAccountWorkspaceForRecoveryFailure();
        else {
          projectAiAccountSync.revision = remote.revision;
          projectAiAccountSync.dirty = false;
          projectAiAccountSync.conflict = false;
          setProjectAiLocalDirty(false);
        }
      }

      if (workspaceEpoch !== projectAiAccountWorkspaceEpoch) return null;
      // The first unified save checks both revisions captured by this GET.
      if (migrationRequired && !projectAiAccountSync.conflict) {
        projectAiAccountSync.dirty = true;
        setProjectAiLocalDirty(true);
      }
      projectAiAccountSync.ready = true;
      if (projectAiAccountWorkspaceRetryTimer) window.clearTimeout(projectAiAccountWorkspaceRetryTimer);
      projectAiAccountWorkspaceRetryTimer = null;
      projectAiAccountWorkspaceRetryCount = 0;
      if (projectAiAccountSync.conflict) setProjectAiAccountStatus(
        "Cloud sync is paused for Projects. Local data was not overwritten.", "error");
      else if (projectAiAccountSync.dirty) setProjectAiAccountStatus(
        "Projects are saved locally; synchronizing your account…", "");
      else setProjectAiAccountStatus("Projects synchronized with your account.", "success");
      persistProjectAiAccountSyncState();
      if (projectAiAccountSync.dirty) scheduleProjectAiAccountWorkspaceSave(60);
      return result;
    })();
    projectAiAccountWorkspacePromise = promise;
    try { return await promise; }
    catch (error) {
      if (workspaceEpoch === projectAiAccountWorkspaceEpoch) {
        const status = Number(error?.httpStatus);
        if (status === 401 || status === 403) expireProjectAiWorkspaceSession(
          "The Google session expired. Your local changes are safe; sign in again to resume cloud sync.");
        else if (!status || status === 429 || status >= 500) scheduleProjectAiAccountWorkspaceRetry(error, workspaceEpoch);
        else setProjectAiAccountStatus(
          "Cloud workspace sync is paused because the server rejected the load request. Your local changes are safe.", "error");
      }
      throw error;
    } finally {
      if (projectAiAccountWorkspacePromise === promise) projectAiAccountWorkspacePromise = null;
    }
  }

  function appendProjectAiThinking() {
    projectAiNotificationId = window.UartDebugNotifications?.notify({ key: null, title: "Project review",
      message: "Analyzing the canvas…", pending: true, tone: "info" });
    return { id: projectAiNotificationId, _progressStages: new Map() };
  }

  function removeProjectAiThinking(indicator) {
    if (indicator?.id === projectAiNotificationId) projectAiNotificationId = null;
  }

  function renderProjectAiThinkingProgress(indicator, progress, verification) {
    if (!indicator || !progress || !Array.isArray(progress.stages)) return;
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
    const stages = [];
    for (const stage of indicator._progressStages.values()) {
      const status = String(stage?.status || "completed");
      const attempt = Number(stage?.attempt);
      const stageLabels = labels[stage?.id];
      stages.push(`${
        stageLabels?.[status] || stageLabels?.completed || String(stage?.id || "Step")
      }${
        Number.isSafeInteger(attempt) && attempt > 1
          ? ` · attempt ${attempt}`
          : ""
      }`);
    }
    const heading =
        verification?.status === "passed"
          ? `Verified with ${verification.mcu || "the selected MCU"}`
          : progress.status === "failed"
            ? "Project verification failed"
            : progress.status === "completed"
              ? "Response ready"
              : "Working on the project";
    if (indicator.id) window.UartDebugNotifications?.notify({ id: indicator.id, title: "Project review",
      message: heading, details: stages.join("\n"), pending: true,
      tone: progress.status === "failed" ? "warning" : "info" });
  }

  async function readProjectAiApiResponse(response, onProgress, { onCommentary, onMessageDelta, onMessageReset } = {}) {
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
      if (event?.type === "commentary") {
        if (typeof event.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(event.id) ||
            typeof event.text !== "string" || event.text.includes("\0") || new TextEncoder().encode(event.text).length > 1024) {
          throw new Error("The AI server returned an invalid progress message.");
        }
        if (!finalEvent) onCommentary?.({ id: event.id, text: event.text });
        return;
      }
      if (event?.type === "message_delta") {
        if (typeof event.delta !== "string" || event.delta.includes("\0") || event.delta.length > 32768) {
          throw new Error("The AI server returned an invalid response fragment.");
        }
        if (!finalEvent) onMessageDelta?.(event.delta);
        return;
      }
      if (event?.type === "message_reset") {
        if (!finalEvent) onMessageReset?.();
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
    const normalizedMessage = String(message || "").trim();
    if (normalizedMessage) window.UartDebugNotifications?.notify({ key: `message:${normalizedMessage}`, title: "Account",
      message: normalizedMessage.split("\n")[0], details: normalizedMessage, tone });
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

      const wasAuthenticated = projectAiAuthSession?.authenticated === true;
      const previousAccountKey = String(projectAiAuthSession?.accountKey || "");
      if (wasAuthenticated && previousAccountKey !== String(data.accountKey || "")) {
        resetProjectAiAccountWorkspaceRuntime();
      }
      projectAiAuthSession = data;
      renderProjectAiAuthSession(data);
      if (data.mode === "google" && data.authenticated === true) {
        void initializeProjectAiAccountWorkspace().catch((error) => {
          console.warn("Account workspace could not be initialized:", error);
          window.UartDebugNotifications?.notify({ key: "account-workspace-init", title: "Account synchronization", tone: "error",
            message: "Account projects could not be loaded.", details: error.message || String(error) });
        });
      } else if (wasAuthenticated || projectAiAccountSync.ready || projectAiAccountSync.saving || projectAiAccountWorkspacePromise) {
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
    projectChatController?.setExternalBusy?.(!!busy);
    const button = $("projectCanvasRunBtn");
    if (button) {
      button.disabled = !!busy;
      button.textContent = "Your turn";
    }
    $("projectCanvasForm")?.setAttribute("aria-busy", String(!!busy));
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
        contract: project.contract,
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
      contract: project.contract === projectFormat.V3_CONTRACT ? projectFormat.V3_CONTRACT : undefined,
      id: String(project.id || project.name || "ai-mini-project").trim(),
      title: String(project.title || project.name || displayName).trim(),
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

  async function applyProjectAiResponse(data, request, operation, scopeEpoch, { allowChat = false } = {}) {
    const baseRevision = assertProjectAiInstructionIsFresh(request, scopeEpoch);
    const target = getCanvasTarget();
    if (target.mcu !== request.mcu || target.packageName !== request.packageName) {
      throw new Error("The project target changed while AI was working. No changes were applied.");
    }
    if (allowChat && data.kind === "chat") {
      if (data.stage !== "chat" || data.baseRevision !== baseRevision || data.canvas || data.project) {
        throw new Error("The server returned an incompatible chat response.");
      }
      return;
    }
    if (!["analyze", "generate", "describe"].includes(operation) ||
        !["canvas", "project"].includes(data.kind) || data.baseRevision !== baseRevision ||
        data.canvas?.schemaVersion !== 2 || data.canvas.revision !== baseRevision + 1 ||
        typeof data.canvas.markdown !== "string" || !Array.isArray(data.canvas.annotations)) {
      throw new Error("The server returned an incompatible canvas revision.");
    }
    if (data.stage && data.stage !== operation) throw new Error("The response belongs to a different project stage.");
    if (operation === "analyze" && data.kind === "project") throw new Error("Review cannot change project code or resources.");
    if (operation !== "analyze" && !(allowChat && operation === "generate") && data.canvas.markdown !== request.canvas.markdown) {
      throw new Error("This stage cannot change the project specification.");
    }
    if (data.kind === "project") {
      const definition = normalizeGeneratedAiProject(data.project);
      const roles = definition.files.map(file => file.role).sort();
      const expectedRoles = operation === "generate" ? ["source", "specification"] : ["guide"];
      if (roles.join(",") !== expectedRoles.sort().join(",")) throw new Error("The response does not match the requested project stage.");
      if (data.operation === "update") {
        const instanceId = request.currentProject?.instanceId;
        if (!instanceId || (data.targetInstanceId && data.targetInstanceId !== instanceId)) throw new Error("The response did not match the current project.");
        assertProjectAiUpdateIsFresh(request);
        await window.UartDebugAvrMiniProjects.updateInstance(instanceId, definition, { origin: "ai" });
      } else if (data.operation === "create") {
        if (operation !== "generate" || request.currentProject) throw new Error("The response cannot create a different project.");
        const guideSuffix = definition.contract === projectFormat.V3_CONTRACT ? ".Description.md" : " (description).md";
        definition.files.push({ role: "guide", name: getFileStem(definition.files.find(file => file.role === "source").name) + guideSuffix, content: "", mediaType: "text/markdown", locale: "en" });
        await window.UartDebugAvrMiniProjects.install(definition, { origin: "ai" });
      } else throw new Error("The response did not specify a project action.");
    }
    applyProjectInstructionMarkdown(data.canvas.markdown, {
      annotations: data.canvas.annotations, dialogue: data.canvas.dialogue, locale: data.canvas.locale,
      target: data.canvas.target, expectedRevision: baseRevision,
    });
    const previousQuestions = new Map((request.canvas.dialogue || []).map(record => [record.id, record]));
    const newQuestion = operation === "analyze" && projectInstructionDocument.dialogue?.find(record =>
      ["question", "next"].includes(record.kind) && !record.submitted &&
      (!previousQuestions.has(record.id) || record.options.length > (previousQuestions.get(record.id)?.options.length || 0)));
    if (newQuestion) {
      pendingTaskDialogueReveal = { id: newQuestion.id, scope: projectInstructionScopeEpoch };
      revealSpecificationQuestions(projectInstructionDocument);
    }
  }

  async function requestProjectChat({ message, history, signal, onProgress, onCommentary, onMessageDelta, onMessageReset, scope, requestSource = "message" }) {
    const request = { ...getProjectAiRequestPayload(), message, history, requestSource, dialogueVersion: 1 };
    delete request.operation;
    const accountEpoch = projectAiAccountWorkspaceEpoch;
    const accountKey = projectAiAuthSession?.accountKey || null;
    const scopeEpoch = projectInstructionScopeEpoch;
    let quotaUpdated = false;
    try {
      const response = await fetch("/api/avr/ai/chat", {
        method: "POST", credentials: "same-origin", signal,
        headers: { Accept: "application/x-ndjson, application/json", "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      const result = await readProjectAiApiResponse(response, progress => onProgress?.(progress), { onCommentary, onMessageDelta, onMessageReset });
      if (signal.aborted) throw new DOMException("Response stopped.", "AbortError");
      if (accountEpoch !== projectAiAccountWorkspaceEpoch || accountKey !== (projectAiAuthSession?.accountKey || null) ||
          scope.key !== getProjectChatContext().key || scope.threadId !== getProjectChatContext().threadId) {
        throw new Error("The active project, chat or account changed. No changes were applied.");
      }
      const data = result.data;
      if (data?.quota) { updateProjectAiQuota(data.quota); quotaUpdated = true; }
      if (result.status < 200 || result.status >= 300 || data?.ok !== true) {
        throw new Error(String(data?.message || data?.error?.message || `Chat request failed (${result.status}).`));
      }
      if (requestSource === "review" && !["chat", "analyze"].includes(data.stage)) {
        throw new Error("Review cannot change project code or documentation.");
      }
      if (typeof data.message !== "string" || !data.message.trim()) throw new Error("The assistant returned an empty response.");
      projectChatApplyingResponse = true;
      try { await applyProjectAiResponse(data, request, data.stage, scopeEpoch, { allowChat: true }); }
      finally { projectChatApplyingResponse = false; }
      return { message: data.message, scope: getProjectChatContext() };
    } finally {
      if (projectAiAuthSession?.mode === "google" && !quotaUpdated && !signal.aborted) {
        void fetchProjectAiAuthSession().catch(() => {});
      }
    }
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
      await applyProjectAiResponse(data, request, operation, canvasScopeEpoch);
      reportProjectCanvasMessage("assistant", data.message || (operation === "analyze" ? "Specification reviewed." : "Project updated."), indicator?.id);
    } catch (error) {
      reportProjectCanvasMessage("system", error?.message || "The canvas request could not be completed.", indicator?.id);
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
    if (projectChatController) void projectChatController.submit("Your turn.");
    else void submitProjectCanvas();
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

  function measureDevicePanelControls(section) {
    const controls = new Map();
    for (const element of section.querySelectorAll(
      ".detect-chip-btn, .hardware-port, .hardware-flow .custom-select, .hardware-flow-light, " +
      ".avr-action-title > :not(button), .avr-card-detail, .project-ai-budget > *"
    )) {
      const bounds = element.getBoundingClientRect();
      if (bounds.width && bounds.height) {
        const style = window.getComputedStyle(element);
        controls.set(element, {
          x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height,
          paddingLeft: style.paddingLeft, paddingRight: style.paddingRight,
          gap: style.gap, opacity: style.opacity,
          targetOpacity: style.getPropertyValue?.("--device-control-opacity")?.trim() || style.opacity,
        });
      }
    }
    return controls;
  }

  function finishDevicePanelControlAnimations() {
    for (const animation of devicePanelControlAnimations) animation.cancel();
    devicePanelControlAnimations = [];
  }

  function animateDevicePanelControls(before, section, fromHeight, toHeight) {
    const duration = WORKSPACE_PANEL_TRANSITION_MS;
    const options = { duration, easing: "cubic-bezier(0.22, 0.8, 0.22, 1)", fill: "both" };
    for (const [element, bounds] of measureDevicePanelControls(section)) {
      const previous = before?.get(element);
      if (!previous || typeof element.animate !== "function") continue;
      const from = {}, to = {};
      for (const property of ["width", "height"]) {
        if (Math.abs(previous[property] - bounds[property]) < 0.5) continue;
        from[property] = `${previous[property]}px`;
        to[property] = `${bounds[property]}px`;
        if (property === "width") {
          from.minWidth = from.width;
          to.minWidth = to.width;
        }
      }
      for (const property of ["paddingLeft", "paddingRight", "gap"]) {
        if (previous[property] === bounds[property]) continue;
        if (!Number.isFinite(Number.parseFloat(previous[property])) || !Number.isFinite(Number.parseFloat(bounds[property]))) continue;
        from[property] = previous[property];
        to[property] = bounds[property];
      }
      if (Object.keys(from).length) devicePanelControlAnimations.push(element.animate([from, to], options));
      if (previous.opacity !== bounds.targetOpacity) {
        const reveal = Number(bounds.targetOpacity) > Number(previous.opacity);
        devicePanelControlAnimations.push(element.animate([
          { opacity: previous.opacity, offset: 0 },
          { opacity: reveal ? previous.opacity : bounds.targetOpacity, offset: reveal ? 0.9 : 0.1 },
          { opacity: bounds.targetOpacity, offset: 1 },
        ], { duration, fill: "both" }));
      }
    }
    // Both modes retain the same four columns. Frame height is the only
    // hardware layout change; account elements still share the FLIP pass.
    for (const viewport of section.querySelectorAll(".avr-overview-viewport")) {
      if (typeof viewport.animate !== "function") continue;
      devicePanelControlAnimations.push(viewport.animate([
        { height: `${fromHeight}px` }, { height: `${toHeight}px` },
      ], options));
    }
    for (const [element, bounds] of measureDevicePanelControls(section)) {
      const previous = before?.get(element);
      if (!previous || typeof element.animate !== "function") continue;
      const x = previous.x - bounds.x, y = previous.y - bounds.y;
      if (Math.abs(x) < 0.5 && Math.abs(y) < 0.5) continue;
      const transform = window.getComputedStyle(element).transform;
      const base = transform === "none" ? "" : ` ${transform}`;
      devicePanelControlAnimations.push(element.animate([
        { transform: `translate(${x}px, ${y}px)${base}` }, { transform },
      ], options));
    }
  }

  function applyDevicePanelState(
    state,
    { persist = false, animate = false } = {}
  ) {
    const section = $("avrDeviceSection");
    const viewport = $("avrDevicePanelViewport");
    const handle = $("devicePanelToggle");
    if (!section || !viewport || !handle) return;

    const previousState = devicePanelState;
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    const nextState = ["expanded", "compact", "collapsed"].includes(state)
      ? state
      : "expanded";
    if (previousState === nextState && devicePanelTransitionTimer && !reducedMotion) {
      if (persist) {
        try { window.localStorage.setItem(STORAGE_DEVICE_PANEL_STATE, nextState); } catch {}
      }
      return;
    }
    const transitioning = animate && !reducedMotion && previousState !== nextState;
    const fromHeight = viewport.getBoundingClientRect().height;
    const before = transitioning && fromHeight > 0.5
      ? measureDevicePanelControls(section) : null;
    finishDevicePanelControlAnimations();
    if (devicePanelTransitionTimer) {
      window.clearTimeout(devicePanelTransitionTimer);
      devicePanelTransitionTimer = null;
    }
    section.classList.toggle("is-device-panel-transitioning", transitioning);
    devicePanelState = nextState;
    devicePanelHeight = getDevicePanelHeightForState(devicePanelState);
    section.style.setProperty("--device-panel-height", `${devicePanelHeight}px`);
    section.dataset.state = devicePanelState;
    section.querySelectorAll(".avr-target-controls .custom-select").forEach(updateCustomSelectIntrinsicWidth);
    const collapsed = devicePanelState === "collapsed" && devicePanelHeight === 0;
    for (const panel of section.querySelectorAll(".avr-overview-viewport")) {
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

    if (transitioning) animateDevicePanelControls(before, section, fromHeight, devicePanelHeight);
    updatePanelActionContours();
    if (transitioning) {
      const finishTransition = () => {
        // WAAPI can start on the next rendering frame. Do not cancel its last
        // few pixels merely because a wall-clock timer reached the duration.
        if (devicePanelControlAnimations.some(animation => animation.pending || animation.playState === "running")) {
          devicePanelTransitionTimer = window.setTimeout(finishTransition, 16);
          return;
        }
        devicePanelTransitionTimer = null;
        finishDevicePanelControlAnimations();
        updatePanelActionContours();
        section.classList.remove("is-device-panel-transitioning");
        refreshWorkspaceAfterDevicePanelResize();
      };
      devicePanelTransitionTimer = window.setTimeout(finishTransition, WORKSPACE_PANEL_TRANSITION_MS);
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
        if (devicePanelTransitionTimer !== null) {
          drag.anchor = position;
          return;
        }
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
        setDevicePanelState(nextState, { persist: false, animate: true });
        refreshWorkspaceAfterDevicePanelResize();
      },
      finish: () => {
        setDevicePanelState(devicePanelState, { persist: true, animate: false });
        refreshWorkspaceAfterDevicePanelResize();
      },
      key: command => {
        const states = ["collapsed", "compact", "expanded"];
        let index = states.indexOf(devicePanelState);
        if (command.endpoint === "start") index = 0;
        else if (command.endpoint === "end") index = states.length - 1;
        else index = Math.max(0, Math.min(states.length - 1, index + command.direction));
        setDevicePanelState(states[index]);
      },
    });
  }

  function setDocumentationNotice(message = "") {
    if (message) window.UartDebugNotifications?.notify({ title: "Code description", message, tone: "warning" });
  }

  function saveDocumentationEditorValue({ persistNow = false, change = null } = {}) {
    const markdownEditor = $("projectDocumentationEditor");
    const guideFile = markdownEditor?.dataset.guideFile || "";
    if (!markdownEditor || !guideFile || !hasFile(guideFile)) return;

    const previousMarkdown = files[guideFile] || "";
    const markdown = documentationEditor
      ? documentationEditor.getValue()
      : markdownEditor.value;
    if (previousMarkdown !== markdown) {
      fileAuthorship[guideFile] = change
        ? updateMarkdownAuthorshipForChange(getFileAuthorship(guideFile), previousMarkdown, change, "human")
        : mergeMarkdownAuthorshipForReplacement(previousMarkdown, markdown, getFileAuthorship(guideFile), "human");
      files[guideFile] = markdown;
    }
    if (current === guideFile && editor && editor.getValue() !== markdown) {
      editor.setValue(markdown);
    }
    if (previousMarkdown !== markdown && projectAiBootComplete && !projectAiAccountWorkspaceApplying) {
      markProjectAiAccountWorkspaceDirty();
    }
    if (documentationSaveTimer) {
      window.clearTimeout(documentationSaveTimer);
      documentationSaveTimer = null;
    }
    if (persistNow) {
      persistState();
    } else {
      documentationSaveTimer = window.setTimeout(() => {
        documentationSaveTimer = null;
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

  function createMarkdownDocumentEditor(element, { label, readOnly = false }) {
    const cm = CodeMirror.fromTextArea(element, {
      mode: getMarkdownEditorMode(),
      theme: "material-darker",
      inputStyle: "contenteditable",
      lineNumbers: false,
      readOnly,
      lineWrapping: true,
      indentUnit: 2,
      tabSize: 2,
      indentWithTabs: false,
      viewportMargin: 30,
      autofocus: false,
      extraKeys: {
        Tab(editor) { editor.replaceSelection("  ", "end", "+input"); },
      },
    });
    cm.setSize("100%", "100%");
    cm.getWrapperElement().classList.add("is-markdown-live");
    const input = cm.getInputField();
    input.setAttribute("aria-label", label);
    input.setAttribute("aria-multiline", "true");
    input.setAttribute("data-tooltip-disabled", "");
    input.setAttribute("role", "textbox");
    input.setAttribute("spellcheck", "true");
    input.setAttribute("aria-readonly", String(!!readOnly));
    return cm;
  }

  function bindDocumentationWorkspace() {
    const editorElement = $("projectDocumentationEditor");
    if (editorElement) {
      editorElement.readOnly = true;
      editorElement.setAttribute("aria-readonly", "true");
    }
    if (
      !editorElement ||
      typeof window.CodeMirror?.fromTextArea !== "function"
    ) {
      editorElement?.addEventListener("input", () =>
        saveDocumentationEditorValue()
      );
      return;
    }

    documentationEditor = createMarkdownDocumentEditor(editorElement, {
      label: "Code description Markdown",
      readOnly: "nocursor",
    });
    const input = documentationEditor.getInputField();
    registerMarkdownLiveEditor("documentation", documentationEditor, {
      getContextKey: () =>
        `${editorElement.dataset.guideFile || ""}\u0000${current || ""}`,
      getAuthorship: () => {
        const guideFile = editorElement.dataset.guideFile || "";
        return guideFile ? getFileAuthorship(guideFile) : null;
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
      scheduleMarkdownLivePreview("documentation");
      scheduleMarkdownLivePreview("editor");
      saveDocumentationEditorValue({ change });
    });
    documentationEditor.on("cursorActivity", () =>
      scheduleMarkdownLivePreview("documentation")
    );
    documentationEditor.on("viewportChange", () =>
      scheduleMarkdownLivePreview("documentation")
    );
    window.addEventListener("resize", () => documentationEditor?.refresh());
  }

  function refreshDocumentationPane({ preserveScroll = false } = {}) {
    const pane = $("projectDocumentationPane");
    const scroll = $("projectDocumentationScroll");
    const markdownEditor = $("projectDocumentationEditor");
    if (!pane || !scroll || !markdownEditor) return;

    const context = getDocumentationContext(current);
    const previousGuide = pane.dataset.guideFile || "";
    const previousScrollTop = documentationEditor?.getScrollInfo?.().top ?? markdownEditor.scrollTop ?? 0;
    const guideFile = context.guideFile;

    pane.dataset.guideFile = guideFile;
    markdownEditor.dataset.guideFile = guideFile;
    setDocumentationNotice();
    const canEdit = !!guideFile && hasFile(guideFile);
    const markdown = canEdit ? getLiveFileContent(guideFile) : "";
    const wrapper = documentationEditor?.getWrapperElement?.();
    setDocumentationEditorValue(markdown);
    markdownEditor.hidden = false;
    markdownEditor.readOnly = !canEdit;
    markdownEditor.setAttribute("aria-readonly", String(!canEdit));
    wrapper?.removeAttribute("hidden");
    documentationEditor?.setOption("readOnly", canEdit ? false : "nocursor");
    documentationEditor
      ?.getInputField?.()
      .setAttribute("aria-readonly", String(!canEdit));
    const top = preserveScroll && previousGuide === guideFile ? previousScrollTop : 0;
    if (documentationEditor) documentationEditor.scrollTo(null, top);
    else markdownEditor.scrollTop = top;
    scheduleMarkdownLivePreview("documentation");
    refreshWorkspaceEditors();
  }

  function scheduleDocumentationPaneRefresh() {
    if (documentationRenderTimer) window.clearTimeout(documentationRenderTimer);
    documentationRenderTimer = window.setTimeout(() => {
      documentationRenderTimer = null;
      refreshDocumentationPane({ preserveScroll: true });
    }, 180);
  }

  function navigateToDocumentationHeading(marker) {
    expandDocumentationForNavigation();
    const context = getDocumentationContext(current);
    if (!context.guideFile || !hasFile(context.guideFile)) {
      setDocumentationNotice("This source file has no linked guide yet.");
      return false;
    }

    const pane = $("projectDocumentationPane");
    if (pane?.dataset.guideFile !== context.guideFile) refreshDocumentationPane();

    const headingKey = miniProjectCore.normalizeHeadingKey(marker.title);
    let target = null;
    try {
      const tree = window.UartDebugMarkdown?.analyze(getLiveFileContent(context.guideFile)).tree;
      if (tree) walkMarkdownAst(tree, node => {
        if (target || node.type !== "heading" || node.depth !== marker.level ||
            miniProjectCore.normalizeHeadingKey(getMarkdownAstText(node)) !== headingKey) return;
        const point = node.position?.start;
        if (point) target = {
          line: Math.max(0, Number(point.line || 1) - 1),
          ch: Math.max(0, Number(point.column || 1) - 1),
          offset: Math.max(0, Number(point.offset) || 0),
        };
      });
    } catch (error) {
      console.warn("Documentation headings could not be read:", error);
    }
    if (!target) {
      setDocumentationNotice(`Section not found: ${marker.title}`);
      return false;
    }

    setDocumentationNotice();
    if (!documentationEditor) {
      const textarea = $("projectDocumentationEditor");
      if (!textarea) return false;
      textarea.focus({ preventScroll: true });
      textarea.setSelectionRange(target.offset, target.offset);
      textarea.scrollTop = Math.max(0, target.line * (Number.parseFloat(window.getComputedStyle(textarea).lineHeight) || 20) - 48);
      return true;
    }
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
    updateCompilePanelState();

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
    const operation = captureWorkspaceOperation(linkedProject?.project || null);
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

    assertWorkspaceOperation(operation, linkedProject?.instanceId || null);
    if (!hasFile(name) || (linkedProject && miniProjects[linkedProject.instanceId] !== linkedProject.project)) return;
    if (projectChatController?.flush() === false) {
      throw new Error("The current chat could not be saved. The project was not deleted.");
    }
    // Retain live edits in the owner model before staging a discrete deletion.
    getProjectAiAccountFilesSnapshot();

    const namesToDelete = deleteWholeProject
      ? getMiniProjectLocalFileNames(linkedProject.project)
      : [name];
    const deletedCurrent = namesToDelete.includes(current);
    const previous = { files, fileAuthorship, miniProjects, current,
      unassignedProjectInstructionDocument, projectInstructionStorageReadFailed };
    files = createDictionary(files);
    fileAuthorship = createDictionary(fileAuthorship);
    miniProjects = createDictionary(miniProjects);
    if (!deleteWholeProject) {
      for (const [instanceId, project] of Object.entries(miniProjects)) {
        if (!getMiniProjectLocalFileNames(project).includes(name)) continue;
        miniProjects[instanceId] = { ...project, files: { ...project.files },
          mediaTypes: { ...project.mediaTypes }, guides: { ...project.guides } };
      }
    }
    try {
      for (const fileName of namesToDelete) {
        delete files[fileName];
        delete fileAuthorship[fileName];
      }
      if (deleteWholeProject) delete miniProjects[linkedProject.instanceId];
      else removeMiniProjectFile(name);
      if (!getVisibleWorkspaceFileNames().length) {
        unassignedProjectInstructionDocument = normalizeProjectInstructionDocument(null);
        projectInstructionStorageReadFailed = false;
      }
      if (deletedCurrent) current = getVisibleWorkspaceFileNames()[0] || null;
      persistState({ throwOnError: true });
    } catch (error) {
      ({ files, fileAuthorship, miniProjects, current,
        unassignedProjectInstructionDocument, projectInstructionStorageReadFailed } = previous);
      throw error;
    }

    // Only a committed deletion can invalidate queued saves and view state.
    if (deleteWholeProject) cancelProjectInstructionSave(linkedProject.instanceId);
    if (deletedCurrent && saveTimer) {
      window.clearTimeout(saveTimer);
      saveTimer = null;
    }
    if (documentationSaveTimer) {
      window.clearTimeout(documentationSaveTimer);
      documentationSaveTimer = null;
    }
    for (const fileName of namesToDelete) {
      hexArtifactsBySource.delete(fileName);
    }
    if (!getVisibleWorkspaceFileNames().length) {
      cancelProjectInstructionSave(null);
    }
    if (deletedCurrent) {
      activateCurrentProjectCanvas({ savePrevious: false });
    }
    if (!current) {
      try {
        localStorage.removeItem(STORAGE_CURRENT);
        localStorage.removeItem(LEGACY_STORAGE_CURRENT);
      } catch {}
      if (editor) {
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
      updateCompilePanelState();
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

  function showEditorCompletions(cm) {
    if (!isCFileName(current)) return CodeMirror.commands.autocomplete(cm);
    cm.showHint({ hint: CodeMirror.hint.udc, completeSingle: false, closeOnUnfocus: true });
  }

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
        "Ctrl-Space": showEditorCompletions,
        "Alt-Space": showEditorCompletions,
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
        showEditorCompletions(cm);
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
      scheduleDocumentationMarkerRefresh();
      if (resolveGuideFileName(current) === current) {
        scheduleDocumentationPaneRefresh();
      }
      // setValue restores an already-owned model value. A delayed save here
      // would run after boot and turn a page reload into a user modification.
      if (projectAiAccountWorkspaceApplying || change?.origin === "setValue") {
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = null;
        return;
      }
      if (projectAiBootComplete) markProjectAiAccountWorkspaceDirty();
      if (saveTimer) clearTimeout(saveTimer);

      saveTimer = setTimeout(() => {
        saveTimer = null;
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
      const compileBtn = $("compileBtn");
      const programHexBtn = $("programHexBtn");
      const detectChipBtn = $("detectChipBtn");
      const fileContextMenu = $("fileContextMenu");
      const fileUploadInput = $("fileUploadInput");
      const uploadExistingFileCard = $("uploadExistingFileCard");
      const fileTemplateGrid = $("fileTemplateGrid");
      const siteDialog = $("siteDialog");
      const siteDialogCloseBtn = $("siteDialogCloseBtn");
      const siteDialogCancelBtn = $("siteDialogCancelBtn");
      const siteDialogConfirmBtn = $("siteDialogConfirmBtn");
      const mcuSelect = $("mcuSelect");
      const projectAiAccountBtn = $("projectAiAccountBtn");
      const projectAiAccountModal = $("projectAiAccountModal");
      const projectAiAccountCloseBtn = $("projectAiAccountCloseBtn");
      const projectAiSignInBtn = $("projectAiSignInBtn");
      const projectAiSignOutBtn = $("projectAiSignOutBtn");

    initCustomSelect(mcuSelect);
    initCustomSelect($("projectPackageSelect"));
    bindHardwareFlow();
    bindFileListResizer();
    bindFilesModal();
    bindDocumentationResizer();
    bindProjectAiResizers();
    bindDevicePanelResizer();
    bindProjectInstructionWorkspace();
    bindDocumentationWorkspace();
    bindPanelActionExpansion();
    bindWorkspaceResizeObserver();
      compileBtn && compileBtn.addEventListener("click", compileCurrentFile);
      detectChipBtn && detectChipBtn.addEventListener("click", handleDetectChip);
      programHexBtn && programHexBtn.addEventListener("click", handleFlashCurrent);
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
        closeFilesModal();
        if (!fileUploadInput) return;
        fileUploadInput.value = "";
        fileUploadInput.click();
      });

    $("projectCanvasForm")?.addEventListener("submit", handleProjectCanvasSubmit);
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
      if (e.defaultPrevented || handleFileMenuKeydown(e) || trapWorkspaceModalFocus(e)) return;
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
      // Navigation ends this browser's run. Keep the duration observed here;
      // crash recovery falls back to the last recorded activity instead.
      projectChatController?.cancel("Response interrupted after leaving the page.");
      projectChatController?.flush();
      persistProjectInstruction({ immediate: true });
      if (documentationSaveTimer) {
        window.clearTimeout(documentationSaveTimer);
        documentationSaveTimer = null;
      }
      if (editor && current) {
        files[current] = editor.getValue();
      }
      persistState();
    });
  }

  // --- HEX artifact state ---
  let lastHexContent = null;
  let lastHexName = null;
  let lastHexTargetMcu = "";
  const hexArtifactsBySource = new Map();
  let lastDetectedUpdiTargetKey = "";

  function getUpdiHexArtifact() {
    return {
      hexText: lastHexContent || "",
      fileName: lastHexName || "",
      source: "compiled",
      targetMcu: lastHexTargetMcu,
    };
  }

  function dispatchUpdiHexArtifact(notificationId = null) {
    dispatchHexArtifact({ ...getUpdiHexArtifact(), ...(notificationId ? { notificationId } : {}) });
  }

  function initUpdiBridge() {
    if (typeof window === "undefined") return;

    const bridge = {
      setHardwareActivity: (owner, active) => hardwareFlow?.setActive(owner, active),
      reportHardwareFailure: (stage) => hardwareFlow?.fail(hardwareStageElement(stage)),
      getHexArtifact: getUpdiHexArtifact,
      refreshCompileControls: () => {
        updateCompilePanelState();
        if (!getCanvasUpdiRuntime()?.isBusy?.()
          && $("projectPackageSelect")?.dataset.mcu !== getCanvasTarget().mcu) {
          syncCanvasTargetControls();
          saveCanvasTarget();
        }
        refreshTargetPresentation();
      },
      getDetectedTargetKey: () => lastDetectedUpdiTargetKey || "",
      setDetectedTargetKey: (targetKey) => {
        lastDetectedUpdiTargetKey =
          typeof targetKey === "string" ? targetKey.trim() : "";
        if (lastDetectedUpdiTargetKey) {
          const select = $("mcuSelect");
          if (select) select.value = lastDetectedUpdiTargetKey;
          syncCanvasTargetControls();
          saveCanvasTarget();
        }
        refreshTargetPresentation();
      },
    };

    window[AVR_UPDI_BRIDGE_KEY] = bridge;
  }

  function resetHexArtifact() {
    lastHexContent = null;
    lastHexName = null;
    lastHexTargetMcu = "";
    setHexStatus("idle");
    dispatchUpdiHexArtifact();
  }

  function getHexArtifactForFile(fileName) {
    return hexArtifactsBySource.get(fileName) || null;
  }

  function storeHexArtifact(fileName, hexText, hexName, sourceText, sourceKey, targetMcu) {
    if (!fileName || !hexText || !hexName) return;
    hexArtifactsBySource.set(fileName, {
      hexText,
      hexName,
      sourceText: String(sourceText || ""),
      sourceKey: String(sourceKey || sourceText || ""),
      targetMcu: String(targetMcu || "").toLowerCase(),
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
    if (!artifact || !artifact.hexText || !artifact.hexName
      || !artifact.targetMcu || artifact.targetMcu !== getCanvasTarget().mcu) return false;

    lastHexContent = artifact.hexText;
    lastHexName = artifact.hexName;
    lastHexTargetMcu = artifact.targetMcu;
    updateHexUI(true);
    setHexStatus("ready", lastHexName);
    loadHexIntoUpdiRuntime(updi, lastHexName, lastHexContent, "compiled", lastHexTargetMcu);
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
    const artifact = getHexArtifactForFile(fileName);
    if (!artifact || artifact.sourceKey !== buildCompileProjectSnapshot(fileName).sourceKey) return false;
    return loadCompiledHexArtifact(updi, artifact);
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
    if (compiled && current === fileName) {
      const artifact = getHexArtifactForFile(fileName);
      if (artifact?.sourceKey === buildCompileProjectSnapshot(fileName).sourceKey) downloadHexArtifact(artifact);
    }
  }

  async function compileCurrentFile() {
    if (compileTask || getCanvasUpdiRuntime()?.isBusy?.()) return false;
    const task = compileCurrentFileSnapshot();
    compileTask = task;
    updateCompilePanelState();
    try { return await task; }
    finally {
      if (compileTask === task) compileTask = null;
      updateCompilePanelState();
    }
  }

  async function requestCompileResult(payload, timeoutMs) {
    const controller = new AbortController();
    let timer, timedOut = false;
    const timeoutError = new Error("The compile request exceeded its complete-response deadline.");
    timeoutError.name = "TimeoutError";
    const deadline = new Promise((resolve, reject) => {
      timer = setTimeout(() => { timedOut = true; controller.abort(); reject(timeoutError); }, timeoutMs);
    });
    const request = (async () => {
      const response = await fetch("/api/avr/compile", {
        method: "POST", signal: controller.signal,
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      if (!response.ok) return { response, rawText: await response.text() };
      try { return { response, data: await response.json() }; }
      catch (error) { error.compileResponseInvalid = true; throw error; }
    })();
    try { return await Promise.race([request, deadline]); }
    catch (error) { throw timedOut ? timeoutError : error; }
    finally { clearTimeout(timer); }
  }

  async function compileCurrentFileSnapshot() {
    compileNotificationId = null;
    const compileFileName = current;
    const compileInstanceId = getMiniProjectForFile(compileFileName)?.instanceId || null;
    const compileAccountEpoch = projectAiAccountWorkspaceEpoch;
    const btn = $("compileBtn");
    const restoreButton = () => updateCompilePanelState();
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
      reportCompilerStatus("No open file to compile.");
      return markCompileFailed();
    }

    if (!/\.c$/i.test(compileFileName)) {
      reportCompilerStatus(
        `"${compileFileName}" is not a C source file. Only *.c files can be compiled.`
      );
      return markCompileFailed();
    }

    reportCompilerStatus("Compiling…", { tone: "info", pending: true });

    const mcuEl = $("mcuSelect");
    const optEl = $("optimizeSelect");
    let selectedMcu = getCanvasTarget().mcu || (mcuEl && mcuEl.value ? mcuEl.value.trim() : "auto");

    if (selectedMcu === "auto") {
      try {
        const signatureInfo = await ensureAutoDetectedTarget({ notificationId: compileNotificationId });
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
        if (error?.uartDebugNotificationId !== compileNotificationId || !error?.uartDebugNotificationId) {
          reportCompilerStatus("A supported chip could not be selected for compilation.", {
            details: "Check the UPDI connection or choose a supported chip before compiling.", diagnostics: error?.stack || String(error) });
        }
        return markCompileFailed();
      }
    }

    // Auto-detection can await user interaction. The requested project must
    // still be selected before its immutable compiler input is captured.
    if (current !== compileFileName || compileInstanceId !== (getMiniProjectForFile(compileFileName)?.instanceId || null)
      || compileAccountEpoch !== projectAiAccountWorkspaceEpoch) {
      reportCompilerStatus("The project changed. Compile the selected project again.", { tone: "warning" });
      return false;
    }
    const compileSnapshot = buildCompileProjectSnapshot(compileFileName, selectedMcu);
    const sourceText = compileSnapshot.projectFiles.find(file => file.name === compileFileName)?.content || "";
    const discardChangedBuild = () => {
      const fresh = current === compileFileName && compileAccountEpoch === projectAiAccountWorkspaceEpoch
        && compileInstanceId === (getMiniProjectForFile(compileFileName)?.instanceId || null)
        && compileSnapshot.sourceKey === buildCompileProjectSnapshot(compileFileName).sourceKey;
      if (fresh) return false;
      reportCompilerStatus("The project changed during compilation. Compile it again.", { tone: "warning",
        details: "The previous build was discarded because its project, source files or target changed. No firmware from that build was loaded." });
      if (current === compileFileName && setHexStatus._state === "building") {
        setHexStatus("idle"); updateHexUI(false);
      }
      return true;
    };
    const payload = {
      filename: compileFileName,
      code: sourceText,
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
    lastHexTargetMcu = "";
    dispatchUpdiHexArtifact();

    let result;
    // The server allows 20 s per C unit, 20 s for linking and 10 s for HEX.
    // Include transport/queue headroom and bound receiving the body as well.
    const timeoutMs = 60000 + 20000 * Math.max(1, compileSnapshot.compileSourceNames.length);
    try {
      result = await requestCompileResult(payload, timeoutMs);
    } catch (error) {
      if (discardChangedBuild()) return false;
      const timeout = error?.name === "TimeoutError";
      reportCompilerStatus(timeout ? "The compile server did not respond in time."
        : error?.compileResponseInvalid ? "The compile server returned an unreadable response."
          : "The compile server could not be reached.", {
        details: timeout ? "The request was stopped. Try compiling again."
          : "Check your connection and try compiling again.", diagnostics: error?.stack || String(error) });
      return markCompileFailed();
    }
    if (discardChangedBuild()) return false;
    const resp = result.response;
    if (!resp.ok) {
      const rawText = result.rawText;
      let errorData = null;
      try {
        errorData = rawText ? JSON.parse(rawText) : null;
      } catch {}
      console.error("Compile server error:", resp.status, errorData || rawText);
      if (!errorData && /(?:^\s*(?:<!doctype|<html)\b|(?:^|\n)\s*at\s+.+:\d+:\d+\)?\s*(?:\n|$))/i.test(rawText)) {
        reportCompilerStatus("The compile server could not complete the request.", {
          details: "Try compiling again in a moment.", diagnostics: `HTTP ${resp.status}\n${rawText}` });
        return markCompileFailed();
      }
      showCompilerIssue(errorData, rawText, compileFileName);
      return markCompileFailed();
    }

    const data = result.data;
    if (!data || data.ok !== true || !data.hex) {
      console.error("Compilation failed:", data);
      showCompilerIssue(data, "", compileFileName);
      return markCompileFailed();
    }

    lastHexContent = data.hex;
    lastHexTargetMcu = selectedMcu;
    {
      const base = compileFileName.replace(/\.c$/i, "");
      lastHexName = (data.hex_name && data.hex_name.trim()) || base + ".hex";
    }
    storeHexArtifact(
      compileFileName,
      lastHexContent,
      lastHexName,
      sourceText,
      compileSnapshot.sourceKey,
      selectedMcu
    );

    updateHexUI(true);
    setHexStatus("ready", lastHexName);
    reportCompilerStatus("Build completed. HEX file is ready.", { tone: "success",
      details: [compileFileName, `Target: ${selectedMcu}`, `HEX: ${lastHexName}`,
        collectCompilerErrorText(data)].filter(Boolean).join("\n\n") });
    dispatchUpdiHexArtifact(compileNotificationId);

    restoreButton();
    return true;
  }

  function boot() {
    const legacyGroups = loadState();
    restoreProjectAiLocalDirtyState();
    restoreProjectAiAccountSyncState();
    restoreProjectInstruction();
    const projectAiAuthReturn = consumeProjectAiAuthReturn();
    migrateLooseFilesToProjects(legacyGroups);
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
    initProjectChat();
    renderProjectAiAuthReturn(projectAiAuthReturn);

    updateHexUI(false);
    dispatchUpdiHexArtifact();
    selectFile(current);
    if (workspacePersistence?.migratedFrom && !workspacePersistence.checkpoint) persistState();

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
