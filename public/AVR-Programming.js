// AVR programming canvas with local files, CodeMirror, UART, and XC8 compilation.
(function () {
  const STORAGE_KEY = "ud_avr_programming_files_v1";
  const STORAGE_STATE = "ud_avr_programming_state_v2";
  const STORAGE_CURRENT = "ud_avr_programming_current_v1";
  const STORAGE_GROUPS = "ud_avr_programming_file_groups_v1";
  const STORAGE_MINI_PROJECTS = "ud_avr_programming_mini_projects_v1";
  const STORAGE_OUTLINER_WIDTH = "ud_avr_programming_outliner_width_v1";
  const STORAGE_DOCUMENTATION_WIDTH =
    "ud_avr_programming_documentation_width_v1";
  const STORAGE_PROJECT_INSTRUCTION =
    "ud_avr_ai_project_instruction_v2";
  const STORAGE_PROJECT_INSTRUCTION_LEGACY =
    "ud_avr_ai_project_instruction_v1";
  const STORAGE_PROJECT_AI_CHAT_WIDTH =
    "ud_avr_ai_chat_width_v1";
  const STORAGE_PROJECT_AI_SKILLS_WIDTH =
    "ud_avr_ai_skills_width_v1";
  const STORAGE_PROJECT_AI_CHATS = "ud_avr_ai_chats_v1";
  const STORAGE_PROJECT_AI_CHATS_RECOVERY =
    "ud_avr_ai_chats_recovery_v1";
  const STORAGE_PROJECT_AI_ACCOUNT_SYNC = "ud_avr_ai_account_sync_v1";
  const STORAGE_PROJECT_AI_LOCAL_DIRTY =
    "ud_avr_ai_local_dirty_v1";
  const STORAGE_PROJECT_AI_FILES_RECOVERY =
    "ud_avr_ai_files_recovery_v1";
  const STORAGE_PROJECT_AI_INSTRUCTION_RECOVERY =
    "ud_avr_ai_instruction_recovery_v1";
  const STORAGE_DEVICE_PANEL_STATE =
    "ud_avr_programming_device_panel_state_v2";
  const AI_SKILL_DRAG_MIME = "application/x-uartdebug-ai-skill+json";
  const PROJECT_AI_SKILLS_URL = "/api/avr/ai/skills";
  const PROJECT_AI_AUTH_SESSION_URL = "/api/avr/ai/auth/session";
  const PROJECT_AI_GOOGLE_START_URL = "/api/avr/ai/auth/google/start";
  const PROJECT_AI_LOGOUT_URL = "/api/avr/ai/auth/logout";
  const PROJECT_AI_ACCOUNT_WORKSPACE_URL =
    "/api/avr/ai/account/workspace";
  const PROJECT_AI_REQUEST_TARGET_BYTES = 768 * 1024;
  const PROJECT_AI_MAX_CHATS = 100;
  const PROJECT_AI_CHAT_TITLE_LENGTH = 52;
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
  const OUTLINER_COMPACT_WIDTH = 62;
  const OUTLINER_COMPACT_THRESHOLD = 112;
  const OUTLINER_MIN_EXPANDED_WIDTH = 180;
  const OUTLINER_EDITOR_MIN_WIDTH = 500;
  const DOCUMENTATION_DEFAULT_WIDTH = 360;
  const DOCUMENTATION_MIN_WIDTH = 240;
  const SPLIT_RESIZER_TOTAL_WIDTH = 28;
  const PROJECT_AI_CHAT_DEFAULT_WIDTH = 320;
  const PROJECT_AI_CHAT_MIN_WIDTH = 270;
  const PROJECT_AI_SKILLS_DEFAULT_WIDTH = 280;
  const PROJECT_AI_SKILLS_MIN_WIDTH = 240;
  const PROJECT_AI_INSTRUCTION_MIN_WIDTH = 350;
  const PROJECT_AI_RESIZER_TOTAL_WIDTH = 28;
  const PROJECT_WORKSPACE_TOGGLE_EXIT_MS = 180;
  const PROJECT_WORKSPACE_SWITCH_MS = 1000;
  const PROJECT_WORKSPACE_TOGGLE_ENTER_MS = 200;
  const DEVICE_PANEL_EXPANDED_HEIGHT = 112;
  const DEVICE_PANEL_COMPACT_HEIGHT = 54;
  const DEVICE_PANEL_COLLAPSED_HEIGHT = 0;
  const DEVICE_PANEL_DRAG_THRESHOLD = 48;
  const MINI_PROJECT_IMPORT_EVENT = "ud-avr-mini-project";
  const MINI_PROJECT_INSTALLED_EVENT = "ud-avr-mini-project-installed";
  const MINI_PROJECT_READY_EVENT = "ud-avr-mini-projects-ready";
  const DEFAULT_PROJECT_INSTRUCTION = "";
  const LEGACY_DEFAULT_PROJECT_INSTRUCTION = [
    "# Инициализация",
    "",
    "# Процессы",
    "",
    "## Фоновый процесс",
    "",
    "Цикл while(1).",
    "",
    "## Дискретизация по времени 1 сек.",
    "",
    "## Реакция на кнопку",
    "",
    "## Выдача по UART",
    "",
  ].join("\n");
  const LEGACY_BUILTIN_MINI_PROJECT_IDS = new Set([
    "minimum",
    "cpu-clock",
    "delay-blink",
    "timer-interrupt",
    "uart-tx",
    "uart-rx",
    "printf-usart0",
    "printf-usart1",
  ]);
  const MINI_PROJECT_ARCHIVE_WORKSPACE_LIMITS = Object.freeze({
    maxArchiveBytes: 4 * 1024 * 1024,
    maxEntryUncompressedBytes: 2 * 1024 * 1024,
    maxTotalUncompressedBytes: 2 * 1024 * 1024,
    maxTextBytes: 256 * 1024,
    maxImageBytes: 1024 * 1024,
  });

  const $ = (id) => document.getElementById(id);
  const miniProjectCore = window.UartDebugAvrMiniProjectCore;
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
  let contextMenuGroup = null;
  let inlineFileEdit = null;
  let outlinerWidth = OUTLINER_DEFAULT_WIDTH;
  let outlinerPreferredWidth = OUTLINER_DEFAULT_WIDTH;
  let outlinerResizeState = null;
  let documentationWidth = DOCUMENTATION_DEFAULT_WIDTH;
  let documentationPreferredWidth = DOCUMENTATION_DEFAULT_WIDTH;
  let documentationResizeState = null;
  let documentationHeadingIndex = new Map();
  let documentationMarkerHandles = [];
  let documentationMarkerFrame = null;
  let documentationRenderTimer = null;
  let documentationTargetTimer = null;
  let documentationEditor = null;
  let documentationEditorSyncing = false;
  let documentationEditSaveTimer = null;
  let projectWorkspaceMode = "avr";
  let projectWorkspaceTransitionTimer = null;
  let projectWorkspaceToggleExitTimer = null;
  let projectWorkspaceToggleEnterTimer = null;
  let projectAiChatWidth = PROJECT_AI_CHAT_DEFAULT_WIDTH;
  let projectAiChatPreferredWidth = PROJECT_AI_CHAT_DEFAULT_WIDTH;
  let projectAiChatResizeState = null;
  let projectAiSkillsWidth = PROJECT_AI_SKILLS_DEFAULT_WIDTH;
  let projectAiSkillsPreferredWidth = PROJECT_AI_SKILLS_DEFAULT_WIDTH;
  let projectAiSkillsResizeState = null;
  let projectInstructionDocument = {
    schemaVersion: 1,
    revision: 0,
    markdown: DEFAULT_PROJECT_INSTRUCTION,
    skillRefs: [],
    authorship: {
      schemaVersion: MARKDOWN_AUTHORSHIP_SCHEMA_VERSION,
      lines: ["original"],
      updatedAt: 1,
    },
  };
  let projectInstructionSaveTimer = null;
  let projectInstructionSaveAttempts = 0;
  let projectInstructionStorageReadFailed = false;
  let projectInstructionRenderFrame = null;
  let projectInstructionEditor = null;
  let projectInstructionEditorSyncing = false;
  let projectInstructionCompositionActive = false;
  const markdownLiveEditors = new Map();
  let projectAiSelectionQuote = null;
  const projectAiSkills = new Map();
  let projectAiSkillsLoaded = false;
  let devicePanelState = "expanded";
  let devicePanelHeight = DEVICE_PANEL_EXPANDED_HEIGHT;
  let devicePanelResizeState = null;
  let devicePanelTransitionTimer = null;
  let projectAiChats = {
    schemaVersion: 1,
    activeChatId: "",
    chats: [],
  };
  let projectAiConversation = [];
  let projectAiChatRenameId = "";
  let projectAiPendingChatPointerAction = null;
  let projectAiChatRenameRenderPending = false;
  let projectAiChatsSaveTimer = null;
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
    revisions: { chats: 0, files: 0, instruction: 0 },
    dirty: { chats: false, files: false, instruction: false },
    saving: { chats: false, files: false, instruction: false },
    conflicts: { chats: false, files: false, instruction: false },
    mutations: { chats: 0, files: 0, instruction: 0 },
    retries: { chats: 0, files: 0, instruction: 0 },
  };
  let projectAiLocalDirty = {
    chats: false,
    files: false,
    instruction: false,
  };
  let projectAiRequestInFlight = false;
  let projectAiRestorePromptFocus = false;
  let projectAiAuthSession = null;
  let projectAiAuthSessionPromise = null;
  let projectAiAuthRequestEpoch = 0;
  let projectAiQuotaUpdateSequence = 0;
  let projectAiLatestQuota = null;
  let workspaceResizeFrame = null;
  let workspaceResizeObserver = null;
  let watermarkFitFrame = null;
  let watermarkResizeObserver = null;
  let siteDialogResolve = null;
  const EDITOR_FILE_EXTENSIONS = new Set([
    "c",
    "h",
    "cpp",
    "cc",
    "hpp",
    "ino",
    "s",
    "asm",
    "txt",
    "md",
    "hex",
    "ihex",
  ]);
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
    watermark.textContent = fileName || "";
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

    const el = $("probeLog");
    if (el) el.textContent = "";
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

  function resolveSiteDialog(value) {
    const modal = $("siteDialog");
    if (modal) modal.hidden = true;

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

    modal.hidden = false;

    requestAnimationFrame(() => {
      (cancelText ? cancelBtn : confirmBtn).focus();
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

  function setMoreOptionsExpanded(expanded) {
    const modal = $("canvasUpdiSection");
    const btn = $("moreOptionsBtn");
    if (!modal || !btn) return;

    const isExpanded = !!expanded;
    const optionsLabel = "More options";
    modal.hidden = !isExpanded;
    btn.setAttribute("aria-expanded", String(isExpanded));
    btn.setAttribute("aria-label", optionsLabel);
    btn.textContent = "More";
    btn.title = isExpanded
      ? "Advanced UPDI tools are open"
      : "Show advanced UPDI tools";

    if (isExpanded) {
      requestAnimationFrame(() => {
        const card = document.querySelector(".updi-options-card");
        if (card) card.focus();
      });
    }
  }

  function toggleMoreOptions() {
    const modal = $("canvasUpdiSection");
    if (!modal) return;
    setMoreOptionsExpanded(modal.hidden);
  }

  function closeMoreOptions() {
    setMoreOptionsExpanded(false);
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
    const buttonLabel = "Compile";

    if (btn) {
      btn.textContent = buttonLabel;
      btn.title = buttonLabel;
      btn.disabled = !canCompile;
    }

    if (!resetLog) return;
    setCompileLogText("");
  }

  // Built-in mini-projects are loaded from the versioned catalog below.

  const BUILTIN_MINI_PROJECT_CATALOG_URL = "/avr-mini-projects/catalog.json";
  let builtInMiniProjectCatalogPromise = null;
  let builtInMiniProjectCardsPromise = null;
  let builtInMiniProjectCardsReady = false;

  async function loadBuiltInMiniProjectCatalog() {
    if (builtInMiniProjectCatalogPromise) {
      return builtInMiniProjectCatalogPromise;
    }

    builtInMiniProjectCatalogPromise = fetch(BUILTIN_MINI_PROJECT_CATALOG_URL, {
      cache: "no-cache",
      credentials: "same-origin",
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(
            `Mini-project catalog could not be loaded (${response.status}).`
          );
        }
        const catalog = await response.json();
        if (
          !catalog ||
          Number(catalog.schemaVersion) !== 1 ||
          !Array.isArray(catalog.projects)
        ) {
          throw new Error("Mini-project catalog has an unsupported format.");
        }

        const projects = new Map();
        for (const descriptor of catalog.projects) {
          const id = String(descriptor?.id || "").trim();
          if (!id || projects.has(id)) {
            throw new Error("Mini-project catalog contains an invalid id.");
          }
          projects.set(id, descriptor);
        }
        return projects;
      })
      .catch((error) => {
        builtInMiniProjectCatalogPromise = null;
        throw error;
      });

    return builtInMiniProjectCatalogPromise;
  }

  async function fetchBuiltInMiniProjectText(rawUrl, label) {
    const url = new URL(String(rawUrl || ""), window.location.href);
    if (url.origin !== window.location.origin) {
      throw new Error(`${label} must be served from this site.`);
    }
    const response = await fetch(url.href, {
      cache: "no-cache",
      credentials: "same-origin",
    });
    if (!response.ok) {
      throw new Error(`${label} could not be loaded (${response.status}).`);
    }
    return response.text();
  }

  function normalizeBuiltInMiniProjectLocale(value) {
    return String(value || "").trim().replace(/_/g, "-").toLowerCase();
  }

  function getBuiltInMiniProjectDefaultGuide(descriptor) {
    const guides = Array.isArray(descriptor?.guides)
      ? descriptor.guides.filter(
          (guide) => guide && typeof guide === "object" && guide.url
        )
      : [];
    if (!guides.length) return null;

    const defaultLocale = normalizeBuiltInMiniProjectLocale(
      descriptor?.defaultLocale
    );
    if (!defaultLocale) return guides[0];

    return (
      guides.find(
        (guide) =>
          normalizeBuiltInMiniProjectLocale(guide.locale) === defaultLocale
      ) || guides[0]
    );
  }

  function createBuiltInMiniProjectCard(descriptor) {
    const card = document.createElement("button");
    card.className = "file-add-card file-template-card";
    card.type = "button";
    card.dataset.templateId = descriptor.id;
    card.disabled = true;

    const title = document.createElement("span");
    title.className = "file-add-card-title";
    title.textContent = String(descriptor.displayName || descriptor.id);
    card.appendChild(title);

    const copy = document.createElement("span");
    copy.className = "file-add-card-copy";
    copy.hidden = true;
    card.appendChild(copy);

    return { card, copy };
  }

  async function renderBuiltInMiniProjectCards() {
    if (builtInMiniProjectCardsReady) return;
    if (builtInMiniProjectCardsPromise) {
      return builtInMiniProjectCardsPromise;
    }

    const grid = $("fileTemplateGrid");
    if (!grid) return;

    builtInMiniProjectCardsPromise = (async () => {
      grid.setAttribute("aria-busy", "true");
      const loading = document.createElement("span");
      loading.textContent = "Loading mini-projects...";
      grid.replaceChildren(loading);

      try {
        const catalog = await loadBuiltInMiniProjectCatalog();
        const records = Array.from(catalog.values()).map((descriptor) => ({
          descriptor,
          ...createBuiltInMiniProjectCard(descriptor),
        }));

        if (!records.length) {
          const empty = document.createElement("span");
          empty.textContent = "No mini-projects are available.";
          grid.replaceChildren(empty);
          builtInMiniProjectCardsReady = true;
          return;
        }

        grid.replaceChildren(...records.map((record) => record.card));
        let descriptionsReady = true;

        await Promise.all(
          records.map(async ({ descriptor, card, copy }) => {
            try {
              const guide = getBuiltInMiniProjectDefaultGuide(descriptor);
              if (!guide) {
                throw new Error("The default guide is missing.");
              }
              const markdown = await fetchBuiltInMiniProjectText(
                guide.url,
                "Guide file"
              );
              const description =
                miniProjectCore.extractShortProjectDescription(markdown);
              if (!description) {
                throw new Error(
                  'The default guide has no "Short Project Description" section.'
                );
              }
              copy.textContent = description;
              copy.hidden = false;
            } catch (error) {
              descriptionsReady = false;
              console.warn(
                `Mini-project description could not be loaded for ${descriptor.id}:`,
                error
              );
            } finally {
              card.disabled = false;
            }
          })
        );

        builtInMiniProjectCardsReady = descriptionsReady;
      } catch (error) {
        const failure = document.createElement("span");
        failure.textContent = "Mini-projects could not be loaded.";
        grid.replaceChildren(failure);
        console.warn("Mini-project catalog could not be rendered:", error);
      } finally {
        grid.removeAttribute("aria-busy");
        builtInMiniProjectCardsPromise = null;
      }
    })();

    return builtInMiniProjectCardsPromise;
  }

  async function loadBuiltInMiniProjectDefinition(templateId) {
    const catalog = await loadBuiltInMiniProjectCatalog();
    const descriptor = catalog.get(String(templateId || ""));
    if (!descriptor) return null;

    const sourceDescriptor = descriptor.source;
    if (!sourceDescriptor?.name || !sourceDescriptor?.url) {
      throw new Error("Mini-project catalog entry is missing its source file.");
    }

    const guideDescriptors = Array.isArray(descriptor.guides)
      ? descriptor.guides
      : [];
    const [sourceContent, ...guideContents] = await Promise.all([
      fetchBuiltInMiniProjectText(sourceDescriptor.url, "Source file"),
      ...guideDescriptors.map((guide) =>
        fetchBuiltInMiniProjectText(guide?.url, "Guide file")
      ),
    ]);
    const defaultGuide = getBuiltInMiniProjectDefaultGuide(descriptor);
    const defaultGuideIndex = defaultGuide
      ? guideDescriptors.indexOf(defaultGuide)
      : -1;
    const summary =
      defaultGuideIndex >= 0
        ? miniProjectCore.extractShortProjectDescription(
            guideContents[defaultGuideIndex]
          )
        : "";

    return {
      schemaVersion: 1,
      id: descriptor.id,
      displayName: descriptor.displayName || descriptor.title || descriptor.id,
      title: descriptor.title || descriptor.displayName || descriptor.id,
      summary,
      version: descriptor.version ?? 1,
      defaultLocale: descriptor.defaultLocale || "",
      files: [
        {
          role: "source",
          name: sourceDescriptor.name,
          content: sourceContent,
          mediaType: sourceDescriptor.mediaType || "text/x-c",
        },
        ...guideDescriptors.map((guide, index) => ({
          role: "guide",
          name: guide.name,
          content: guideContents[index],
          mediaType: guide.mediaType || "text/markdown",
          locale: guide.locale,
          label: guide.label,
          default:
            !!descriptor.defaultLocale &&
            descriptor.defaultLocale.toLowerCase() ===
              String(guide.locale || "").toLowerCase(),
          assetBaseUrl: guide.assetBaseUrl,
        })),
      ],
      ...(descriptor.aiSpecRef &&
        typeof descriptor.aiSpecRef === "object" &&
        !Array.isArray(descriptor.aiSpecRef)
        ? { aiSpecRef: descriptor.aiSpecRef }
        : {}),
    };
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
      if (
        origin === "builtin" &&
        LEGACY_BUILTIN_MINI_PROJECT_IDS.has(definitionId)
      ) {
        continue;
      }

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
        if (!/^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$/i.test(locale)) {
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

  function uniqueImportedName(base) {
    if (!base || !hasFile(base)) return base;

    const lastDot = base.lastIndexOf(".");
    const hasExtension = lastDot > 0;
    const stem = hasExtension ? base.slice(0, lastDot) : base;
    const ext = hasExtension ? base.slice(lastDot) : "";
    let index = 2;
    let candidate = `${stem}_${index}${ext}`;

    while (hasFile(candidate)) {
      index += 1;
      candidate = `${stem}_${index}${ext}`;
    }

    return candidate;
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

  function uniqueGroupName(base = "New group") {
    if (!hasGroup(base) && !hasFile(base)) return base;

    let index = 2;
    let candidate = `${base} ${index}`;
    while (hasGroup(candidate) || hasFile(candidate)) {
      index += 1;
      candidate = `${base} ${index}`;
    }
    return candidate;
  }

  function getGroupChildGroups(groupName) {
    const group = fileGroups[groupName];
    return (group?.groups || []).filter((name) => hasGroup(name));
  }

  function getRootGroupNames() {
    const nested = new Set();

    for (const group of Object.values(fileGroups)) {
      for (const groupName of group.groups || []) {
        if (hasGroup(groupName)) nested.add(groupName);
      }
    }

    return Object.keys(fileGroups).filter((name) => !nested.has(name));
  }

  function getGroupParent(groupName) {
    for (const [parentName, group] of Object.entries(fileGroups)) {
      if ((group.groups || []).includes(groupName)) return parentName;
    }
    return "";
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

  function getGroupedFileSet() {
    const grouped = new Set();
    for (const group of Object.values(fileGroups)) {
      for (const fileName of group.files || []) {
        if (hasFile(fileName)) grouped.add(fileName);
      }
    }
    return grouped;
  }

  function getGroupFileCount(groupName) {
    const visitedGroups = new Set();
    const visibleFiles = new Set();

    const collectVisibleFiles = (name) => {
      if (!hasGroup(name) || visitedGroups.has(name)) return;
      visitedGroups.add(name);

      const group = fileGroups[name];
      for (const fileName of group.files || []) {
        if (hasFile(fileName) && !isHiddenMiniProjectFile(fileName)) {
          visibleFiles.add(fileName);
        }
      }

      for (const childGroupName of group.groups || []) {
        collectVisibleFiles(childGroupName);
      }
    };

    collectVisibleFiles(groupName);
    return visibleFiles.size;
  }

  function getFileGroup(fileName) {
    for (const [groupName, group] of Object.entries(fileGroups)) {
      if ((group.files || []).includes(fileName)) return groupName;
    }
    return "";
  }

  function insertName(names, name, targetName = "", placement = "after") {
    const next = names.filter((itemName) => itemName !== name);
    const targetIndex = targetName ? next.indexOf(targetName) : -1;

    if (targetIndex === -1) {
      next.push(name);
      return next;
    }

    next.splice(placement === "before" ? targetIndex : targetIndex + 1, 0, name);
    return next;
  }

  function insertFileName(names, fileName, targetName = "", placement = "after") {
    return insertName(names, fileName, targetName, placement);
  }

  function setFilesInOrder(names) {
    const nextFiles = Object.create(null);
    const seen = new Set();

    for (const name of names) {
      if (!hasFile(name) || seen.has(name)) continue;
      nextFiles[name] = files[name];
      seen.add(name);
    }

    for (const name of Object.keys(files)) {
      if (seen.has(name)) continue;
      nextFiles[name] = files[name];
    }

    files = nextFiles;
  }

  function setGroupsInOrder(names) {
    const nextGroups = Object.create(null);
    const seen = new Set();

    for (const name of names) {
      if (!hasGroup(name) || seen.has(name)) continue;
      nextGroups[name] = fileGroups[name];
      seen.add(name);
    }

    for (const name of Object.keys(fileGroups)) {
      if (seen.has(name)) continue;
      nextGroups[name] = fileGroups[name];
    }

    fileGroups = nextGroups;
  }

  function renameFileKey(oldName, newName) {
    const nextFiles = Object.create(null);
    const nextAuthorship = Object.create(null);

    for (const name of Object.keys(files)) {
      nextFiles[name === oldName ? newName : name] = files[name];
    }

    for (const name of Object.keys(fileAuthorship)) {
      nextAuthorship[name === oldName ? newName : name] = fileAuthorship[name];
    }

    files = nextFiles;
    fileAuthorship = nextAuthorship;
  }

  function renameGroupKey(oldName, newName) {
    const nextGroups = Object.create(null);

    for (const name of Object.keys(fileGroups)) {
      nextGroups[name === oldName ? newName : name] = fileGroups[name];
    }

    fileGroups = nextGroups;

    for (const group of Object.values(fileGroups)) {
      group.groups = (group.groups || []).map((groupName) =>
        groupName === oldName ? newName : groupName
      );
    }
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

  function getNewFileContent(fileName) {
    return "";
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
    if (!ext || EDITOR_FILE_EXTENSIONS.has(ext)) return "editor";
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
    modal.hidden = false;
    void renderBuiltInMiniProjectCards();

    requestAnimationFrame(() => {
      const primaryAction = $("uploadExistingFileCard");
      primaryAction && primaryAction.focus();
    });
  }

  function closeAddFileModal() {
    const modal = $("fileAddModal");
    if (!modal) return;
    modal.hidden = true;
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

  function importEditorFile(fileName, content) {
    const requestedName = String(fileName || "").trim();
    const safeRequestedName = isReservedStorageName(requestedName)
      ? `_${requestedName}`
      : requestedName;
    const normalizedName =
      uniqueImportedName(safeRequestedName) || uniqueName("main.c");

    files[normalizedName] = String(content || "").replace(/\r\n/g, "\n");
    fileAuthorship[normalizedName] = createMarkdownAuthorship(
      files[normalizedName],
      "human"
    );
    selectFile(normalizedName);
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

  function getSafeMiniProjectGroupBase(title, definitionId) {
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
    };
    const projectFiles = ["source", "aiSpec"].flatMap((role) => {
      const name = project.files?.[role];
      if (!name || !hasFile(name)) return [];
      return [
        {
          role,
          name,
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
          name,
          content: getLiveFileContent(name),
          mediaType: guide.mediaType || defaultMediaTypes.guide,
          locale: guide.locale || "",
          label: guide.label || guide.locale || "",
        },
      ];
    });

    return {
      schemaVersion: 1,
      instanceId,
      id: project.definitionId,
      title: project.title,
      displayName: project.displayName || project.title,
      summary: project.summary || "",
      version: project.version,
      origin: project.origin,
      defaultLocale: project.defaultLocale || "",
      selectedLocale: project.selectedLocale || project.defaultLocale || "",
      files: [...projectFiles, ...guideFiles],
      assets: normalizeProjectAssets(project.assets),
      aiSpecRef: cloneJsonMetadata(project.aiSpecRef, null),
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
            projectFile.locale || definition.defaultLocale || `guide-${Object.keys(guides).length + 1}`;
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
        definitionId: definition.id,
        title: definition.title,
        displayName: String(
          rawDefinition.displayName || definition.title || definition.id
        ).trim(),
        summary: definition.summary,
        version: definition.version ?? 1,
        origin: String(origin || "local"),
        files: roleFiles,
        mediaTypes,
        guides,
        defaultLocale,
        selectedLocale: defaultLocale,
        assets: normalizeProjectAssets(definition.assets),
        aiSpecRef: cloneJsonMetadata(definition.aiSpecRef, null),
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

  function updateMiniProjectInstance(
    instanceId,
    rawDefinition,
    { origin = "ai" } = {}
  ) {
    const normalizedInstanceId = String(instanceId || "").trim();
    const existingProject = miniProjects[normalizedInstanceId];
    if (!existingProject) throw new Error("Mini-project was not found.");

    const definition = miniProjectCore.normalizeDefinition(rawDefinition);
    const sourceName = existingProject.files?.source;
    if (!sourceName || !hasFile(sourceName)) {
      throw new Error("The current mini-project source file was not found.");
    }

    const selectedLocale =
      existingProject.selectedLocale || existingProject.defaultLocale || "";
    const generatedGuide =
      definition.guides.find((guide) => guide.locale === selectedLocale) ||
      definition.guides.find(
        (guide) => guide.locale === definition.defaultLocale
      ) ||
      definition.files.guide ||
      definition.guides[0] ||
      null;
    const existingGuide =
      existingProject.guides?.[generatedGuide?.locale] ||
      existingProject.guides?.[selectedLocale] ||
      existingProject.guides?.[existingProject.defaultLocale] ||
      getMiniProjectGuideEntries(existingProject)[0] ||
      null;

    if (
      !generatedGuide ||
      !existingGuide?.fileName ||
      !hasFile(existingGuide.fileName)
    ) {
      throw new Error("The current mini-project guide file was not found.");
    }

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
    fileAuthorship = createDictionary(cloneJsonMetadata(fileAuthorship, {}));
    fileGroups = createDictionary(cloneJsonMetadata(fileGroups, {}));
    miniProjects = createDictionary(cloneJsonMetadata(miniProjects, {}));

    try {
      const project = miniProjects[normalizedInstanceId];
      const guide =
        project.guides?.[generatedGuide.locale] ||
        project.guides?.[selectedLocale] ||
        project.guides?.[project.defaultLocale] ||
        Object.values(project.guides || {}).find(
          (entry) => entry?.fileName === existingGuide.fileName
        );
      if (!guide?.fileName || !hasFile(guide.fileName)) {
        throw new Error("The current mini-project guide file was not found.");
      }

      const previousSource = files[sourceName];
      const previousGuide = files[guide.fileName];
      files[sourceName] = String(definition.files.source.content || "").replace(
        /\r\n?/g,
        "\n"
      );
      files[guide.fileName] = String(generatedGuide.content || "").replace(
        /\r\n?/g,
        "\n"
      );
      const replacementAuthor = String(origin || "ai") === "ai" ? "ai" : "original";
      fileAuthorship[sourceName] = mergeMarkdownAuthorshipForReplacement(
        previousSource,
        files[sourceName],
        fileAuthorship[sourceName],
        replacementAuthor
      );
      fileAuthorship[guide.fileName] = mergeMarkdownAuthorshipForReplacement(
        previousGuide,
        files[guide.fileName],
        fileAuthorship[guide.fileName],
        replacementAuthor
      );

      project.title = definition.title || project.title;
      project.summary = definition.summary;
      project.version = definition.version ?? project.version;
      project.origin = project.origin || String(origin || "ai");
      project.mediaTypes = project.mediaTypes || {};
      project.mediaTypes.source =
        definition.files.source.mediaType ||
        project.mediaTypes.source ||
        "text/x-c";
      guide.label = guide.label || generatedGuide.label || guide.locale || "";
      guide.mediaType =
        generatedGuide.mediaType || guide.mediaType || "text/markdown";
      if (generatedGuide.assetBaseUrl) {
        guide.assetBaseUrl = generatedGuide.assetBaseUrl;
      }
      const generatedAssets = normalizeProjectAssets(generatedGuide.assets);
      if (generatedAssets.length) guide.assets = generatedAssets;
      project.aiSpecRef = cloneJsonMetadata(
        definition.aiSpecRef,
        cloneJsonMetadata(project.aiSpecRef, null)
      );

      selectionStarted = true;
      selectFile(sourceName);
      persistState({ throwOnError: true });
      return getPublicMiniProjectInstance(normalizedInstanceId);
    } catch (error) {
      files = previousFiles;
      fileAuthorship = previousAuthorship;
      fileGroups = previousGroups;
      miniProjects = previousProjects;
      current = previousCurrent;

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
      return;
    }

    if (fileKind === "editor") {
      const text = await readLocalFileText(file);
      importEditorFile(file.name, text);
      return;
    }

    const message =
      'Unsupported file type. Upload a source, guide, firmware file, or a mini-project archive (.zip).';
    await showSiteAlert(message, "Unsupported file");
    console.warn(`Import rejected: "${file.name}" has an unsupported extension.`);
  }

  function ensureAtLeastOneFile() {
    if (Object.keys(files).length === 0) {
      const name = "main.c";
      files[name] = "";
      fileAuthorship[name] = createMarkdownAuthorship("", "human");
      current = name;
      persistState();
    }
  }

  function isReservedStorageName(name) {
    return ["__proto__", "prototype", "constructor"].includes(
      String(name || "").trim().toLowerCase()
    );
  }

  function validateInlineFileName(fileName, originalName = "") {
    const name = String(fileName || "").trim();

    if (!name) return "Enter a file name.";
    if (name === "." || name === "..") return "Use a regular file name.";
    if (isReservedStorageName(name)) return "Use a different file name.";
    if (/[\\/:*?"<>|\x00-\x1f]/.test(name)) {
      return 'Do not use path separators or these characters: \\ / : * ? " < > |';
    }
    if (name.length > 96) return "Keep the file name under 96 characters.";
    if (name !== originalName && (hasFile(name) || hasGroup(name))) {
      return "A file or group with this name already exists.";
    }

    return "";
  }

  function validateInlineGroupName(groupName, originalName = "") {
    const name = String(groupName || "").trim();

    if (!name) return "Enter a group name.";
    if (isReservedStorageName(name)) return "Use a different group name.";
    if (name.length > 64) return "Keep the group name under 64 characters.";
    if (/[\\/:*?"<>|\x00-\x1f]/.test(name)) {
      return 'Do not use path separators or these characters: \\ / : * ? " < > |';
    }
    if (name !== originalName && (hasGroup(name) || hasFile(name))) {
      return "A file or group with this name already exists.";
    }

    return "";
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

  function normalizeInlineFileName(fileName) {
    const name = String(fileName || "").trim();
    if (!name || name === "." || name === "..") return name;

    const withoutTrailingDots = name.replace(/\.+$/g, "");
    if (!withoutTrailingDots) return name;

    const lastDot = withoutTrailingDots.lastIndexOf(".");
    return lastDot > 0 ? withoutTrailingDots : `${withoutTrailingDots}.txt`;
  }

  function isInlineGroupEdit(edit = inlineFileEdit) {
    return edit?.mode === "create-group" || edit?.mode === "rename-group";
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
      if (isInlineGroupEdit() || inlineFileEdit?.mode === "rename-project") {
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
    input.setAttribute(
      "aria-label",
      edit.mode === "rename-group"
        ? "Rename group"
        : edit.mode === "create-group"
          ? "New group name"
          : edit.mode === "rename-project"
            ? "Rename mini-project"
          : edit.mode === "rename"
            ? "Rename file"
            : "New file name"
    );

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

  function isStackedCanvasLayout() {
    return window.matchMedia?.("(max-width: 1040px)")?.matches || false;
  }

  function getOutlinerMaxWidth() {
    const container = getCanvasSplitContainer();
    if (!container) return Math.max(OUTLINER_MIN_EXPANDED_WIDTH, outlinerWidth);
    if (isStackedCanvasLayout()) {
      return Math.max(
        OUTLINER_MIN_EXPANDED_WIDTH,
        Math.round(container.getBoundingClientRect().width)
      );
    }

    const rect = container.getBoundingClientRect();
    const available =
      rect.width -
      OUTLINER_EDITOR_MIN_WIDTH -
      documentationWidth -
      SPLIT_RESIZER_TOTAL_WIDTH;
    return Math.max(
      OUTLINER_MIN_EXPANDED_WIDTH,
      available
    );
  }

  function normalizeOutlinerWidth(width) {
    const numeric = Number(width);
    if (!Number.isFinite(numeric)) return OUTLINER_DEFAULT_WIDTH;
    if (numeric <= OUTLINER_COMPACT_THRESHOLD) return OUTLINER_COMPACT_WIDTH;
    return Math.max(
      OUTLINER_MIN_EXPANDED_WIDTH,
      Math.min(getOutlinerMaxWidth(), numeric)
    );
  }

  function persistOutlinerWidth(width) {
    try {
      localStorage.setItem(STORAGE_OUTLINER_WIDTH, String(width));
    } catch (error) {
      console.warn("Failed to persist file list width:", error);
    }
  }

  function refreshEditorAfterOutlinerResize() {
    window.requestAnimationFrame(() => {
      editor?.refresh();
      fitEditorFileWatermark();
    });
  }

  function applyOutlinerWidth(
    width,
    { persist = true, remember = true } = {}
  ) {
    const container = getCanvasSplitContainer();
    if (remember) outlinerPreferredWidth = normalizeOutlinerPreference(width);
    const normalized = normalizeOutlinerWidth(width);
    outlinerWidth = normalized;

    if (container) {
      const isCompact = normalized <= OUTLINER_COMPACT_THRESHOLD;
      container.style.setProperty("--outliner-width", `${normalized}px`);
      container.classList.toggle("is-outliner-compact", isCompact);
    }

    if (
      container &&
      !isStackedCanvasLayout() &&
      documentationWidth > getDocumentationMaxWidth()
    ) {
      applyDocumentationWidth(documentationPreferredWidth, {
        persist: false,
        remember: false,
      });
    }
    syncSplitResizerAria();
    if (persist) persistOutlinerWidth(outlinerPreferredWidth);
    refreshEditorAfterOutlinerResize();
  }

  function restoreOutlinerWidth() {
    let stored = OUTLINER_DEFAULT_WIDTH;
    try {
      const raw = localStorage.getItem(STORAGE_OUTLINER_WIDTH);
      stored = raw === null ? OUTLINER_DEFAULT_WIDTH : Number(raw);
    } catch (error) {
      console.warn("Failed to restore file list width:", error);
    }
    applyOutlinerWidth(Number.isFinite(stored) ? stored : OUTLINER_DEFAULT_WIDTH, {
      persist: false,
    });
  }

  function expandOutlinerForEditing() {
    if (outlinerWidth <= OUTLINER_COMPACT_THRESHOLD) {
      applyOutlinerWidth(OUTLINER_DEFAULT_WIDTH);
    }
  }

  function bindFileListResizer() {
    const resizer = $("fileListResizer");
    const container = getCanvasSplitContainer();
    if (!resizer || !container) return;

    const finishResize = (event) => {
      if (!outlinerResizeState) return;
      resizer.releasePointerCapture?.(outlinerResizeState.pointerId);
      outlinerResizeState = null;
      container.classList.remove("is-outliner-resizing");
      document.body.classList.remove("is-outliner-resizing");
      applyOutlinerWidth(outlinerPreferredWidth, {
        persist: true,
        remember: false,
      });
      event?.preventDefault?.();
    };

    resizer.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      outlinerResizeState = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startWidth: outlinerWidth,
      };
      resizer.setPointerCapture?.(event.pointerId);
      container.classList.add("is-outliner-resizing");
      document.body.classList.add("is-outliner-resizing");
    });

    resizer.addEventListener("pointermove", (event) => {
      if (!outlinerResizeState) return;
      event.preventDefault();
      const nextWidth =
        outlinerResizeState.startWidth + event.clientX - outlinerResizeState.startX;
      applyOutlinerWidth(nextWidth, { persist: false });
    });

    resizer.addEventListener("pointerup", finishResize);
    resizer.addEventListener("pointercancel", finishResize);

    resizer.addEventListener("keydown", (event) => {
      const step = event.shiftKey ? 48 : 24;
      let nextWidth = outlinerWidth;

      if (event.key === "ArrowLeft") {
        nextWidth -= step;
      } else if (event.key === "ArrowRight") {
        nextWidth =
          outlinerWidth <= OUTLINER_COMPACT_THRESHOLD
            ? OUTLINER_MIN_EXPANDED_WIDTH
            : outlinerWidth + step;
      } else if (event.key === "Home") {
        nextWidth = OUTLINER_COMPACT_WIDTH;
      } else if (event.key === "End") {
        nextWidth = OUTLINER_DEFAULT_WIDTH;
      } else {
        return;
      }

      event.preventDefault();
      applyOutlinerWidth(nextWidth);
    });

    applyOutlinerWidth(outlinerPreferredWidth, {
      persist: false,
      remember: false,
    });
  }

  function getDocumentationMinWidth() {
    const strip = document.querySelector(".documentation-action-strip");
    if (!strip) return DOCUMENTATION_MIN_WIDTH;
    const style = window.getComputedStyle?.(strip);
    const controls = [...strip.children].filter((element) => {
      const controlStyle = window.getComputedStyle?.(element);
      return !element.hidden && controlStyle?.display !== "none";
    });
    const gap = Number.parseFloat(style?.columnGap || style?.gap || "0") || 0;
    const horizontalPadding =
      (Number.parseFloat(style?.paddingLeft || "0") || 0) +
      (Number.parseFloat(style?.paddingRight || "0") || 0);
    const controlsWidth = controls.reduce(
      (total, element) => total + element.getBoundingClientRect().width,
      0
    );
    return Math.max(
      DOCUMENTATION_MIN_WIDTH,
      Math.ceil(
        horizontalPadding +
          controlsWidth +
          Math.max(0, controls.length - 1) * gap +
          2
      )
    );
  }

  function getDocumentationMaxWidth() {
    const minimum = getDocumentationMinWidth();
    const container = getCanvasSplitContainer();
    if (!container) {
      return Math.max(minimum, documentationWidth);
    }
    if (isStackedCanvasLayout()) {
      return Math.max(
        minimum,
        Math.round(container.getBoundingClientRect().width)
      );
    }

    const rect = container.getBoundingClientRect();
    const availableDocumentationWidth =
      rect.width -
      outlinerWidth -
      OUTLINER_EDITOR_MIN_WIDTH -
      SPLIT_RESIZER_TOTAL_WIDTH;
    return Math.max(
      minimum,
      availableDocumentationWidth
    );
  }

  function normalizeOutlinerPreference(width) {
    const numeric = Number(width);
    if (!Number.isFinite(numeric)) return OUTLINER_DEFAULT_WIDTH;
    if (numeric <= OUTLINER_COMPACT_THRESHOLD) return OUTLINER_COMPACT_WIDTH;
    return Math.max(OUTLINER_MIN_EXPANDED_WIDTH, numeric);
  }

  function normalizeDocumentationWidth(width) {
    const numeric = Number(width);
    if (!Number.isFinite(numeric)) return DOCUMENTATION_DEFAULT_WIDTH;
    const minimum = getDocumentationMinWidth();
    return Math.max(
      minimum,
      Math.min(getDocumentationMaxWidth(), numeric)
    );
  }

  function normalizeDocumentationPreference(width) {
    const numeric = Number(width);
    if (!Number.isFinite(numeric)) return DOCUMENTATION_DEFAULT_WIDTH;
    return Math.max(getDocumentationMinWidth(), numeric);
  }

  function syncSplitResizerAria() {
    const outlinerResizer = $("fileListResizer");
    if (outlinerResizer) {
      outlinerResizer.setAttribute(
        "aria-valuemin",
        String(OUTLINER_COMPACT_WIDTH)
      );
      outlinerResizer.setAttribute("aria-valuemax", String(getOutlinerMaxWidth()));
      outlinerResizer.setAttribute("aria-valuenow", String(outlinerWidth));
    }

    const documentationResizer = $("documentationResizer");
    if (documentationResizer) {
      documentationResizer.setAttribute(
        "aria-valuemin",
        String(getDocumentationMinWidth())
      );
      documentationResizer.setAttribute(
        "aria-valuemax",
        String(getDocumentationMaxWidth())
      );
      documentationResizer.setAttribute(
        "aria-valuenow",
        String(documentationWidth)
      );
    }
  }

  function persistDocumentationWidth(width) {
    try {
      localStorage.setItem(STORAGE_DOCUMENTATION_WIDTH, String(width));
    } catch (error) {
      console.warn("Failed to persist project guide width:", error);
    }
  }

  function applyDocumentationWidth(
    width,
    { persist = true, remember = true } = {}
  ) {
    const container = getCanvasSplitContainer();
    if (remember) {
      documentationPreferredWidth = normalizeDocumentationPreference(width);
    }
    const normalized = normalizeDocumentationWidth(width);
    documentationWidth = normalized;

    if (container) {
      container.style.setProperty("--documentation-width", `${normalized}px`);
    }

    syncSplitResizerAria();
    if (persist) persistDocumentationWidth(documentationPreferredWidth);
    refreshEditorAfterOutlinerResize();
  }

  function restoreDocumentationWidth() {
    let stored = DOCUMENTATION_DEFAULT_WIDTH;
    try {
      const raw = localStorage.getItem(STORAGE_DOCUMENTATION_WIDTH);
      stored = raw === null ? DOCUMENTATION_DEFAULT_WIDTH : Number(raw);
    } catch (error) {
      console.warn("Failed to restore project guide width:", error);
    }

    applyDocumentationWidth(
      Number.isFinite(stored) ? stored : DOCUMENTATION_DEFAULT_WIDTH,
      { persist: false }
    );
  }

  function bindDocumentationResizer() {
    const resizer = $("documentationResizer");
    const container = getCanvasSplitContainer();
    if (!resizer || !container) return;

    const finishResize = (event) => {
      if (!documentationResizeState) return;
      resizer.releasePointerCapture?.(documentationResizeState.pointerId);
      documentationResizeState = null;
      container.classList.remove("is-documentation-resizing");
      document.body.classList.remove("is-documentation-resizing");
      applyDocumentationWidth(documentationPreferredWidth, {
        persist: true,
        remember: false,
      });
      event?.preventDefault?.();
    };

    resizer.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      documentationResizeState = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startWidth: documentationWidth,
      };
      resizer.setPointerCapture?.(event.pointerId);
      container.classList.add("is-documentation-resizing");
      document.body.classList.add("is-documentation-resizing");
    });

    resizer.addEventListener("pointermove", (event) => {
      if (!documentationResizeState) return;
      event.preventDefault();
      const nextWidth =
        documentationResizeState.startWidth -
        (event.clientX - documentationResizeState.startX);
      applyDocumentationWidth(nextWidth, { persist: false });
    });

    resizer.addEventListener("pointerup", finishResize);
    resizer.addEventListener("pointercancel", finishResize);

    resizer.addEventListener("keydown", (event) => {
      const step = event.shiftKey ? 48 : 24;
      let nextWidth = documentationWidth;

      if (event.key === "ArrowLeft") {
        nextWidth += step;
      } else if (event.key === "ArrowRight") {
        nextWidth -= step;
      } else if (event.key === "Home") {
        nextWidth = getDocumentationMinWidth();
      } else if (event.key === "End") {
        nextWidth = getDocumentationMaxWidth();
      } else {
        return;
      }

      event.preventDefault();
      applyDocumentationWidth(nextWidth);
    });

    applyDocumentationWidth(documentationPreferredWidth, {
      persist: false,
      remember: false,
    });
  }

  function getProjectAiLayout() {
    return document.querySelector(".project-ai-layout");
  }

  function normalizeProjectAiChatPreference(width) {
    const numeric = Number(width);
    if (!Number.isFinite(numeric)) return PROJECT_AI_CHAT_DEFAULT_WIDTH;
    return Math.max(PROJECT_AI_CHAT_MIN_WIDTH, numeric);
  }

  function normalizeProjectAiSkillsPreference(width) {
    const numeric = Number(width);
    if (!Number.isFinite(numeric)) return PROJECT_AI_SKILLS_DEFAULT_WIDTH;
    return Math.max(PROJECT_AI_SKILLS_MIN_WIDTH, numeric);
  }

  function getProjectAiSideBudget() {
    const layout = getProjectAiLayout();
    if (!layout) {
      return PROJECT_AI_CHAT_DEFAULT_WIDTH + PROJECT_AI_SKILLS_DEFAULT_WIDTH;
    }
    if (isStackedCanvasLayout()) {
      return Math.max(
        PROJECT_AI_CHAT_MIN_WIDTH + PROJECT_AI_SKILLS_MIN_WIDTH,
        Math.round(layout.getBoundingClientRect().width)
      );
    }
    return Math.max(
      PROJECT_AI_CHAT_MIN_WIDTH + PROJECT_AI_SKILLS_MIN_WIDTH,
      layout.getBoundingClientRect().width -
        PROJECT_AI_INSTRUCTION_MIN_WIDTH -
        PROJECT_AI_RESIZER_TOTAL_WIDTH
    );
  }

  function resolveProjectAiWidths(chatWidth, skillsWidth, priority = "balanced") {
    let chat = normalizeProjectAiChatPreference(chatWidth);
    let skills = normalizeProjectAiSkillsPreference(skillsWidth);
    const budget = getProjectAiSideBudget();
    if (chat + skills <= budget) return { chat, skills };

    if (priority === "chat") {
      chat = Math.min(chat, budget - PROJECT_AI_SKILLS_MIN_WIDTH);
      skills = Math.min(skills, budget - chat);
    } else if (priority === "skills") {
      skills = Math.min(skills, budget - PROJECT_AI_CHAT_MIN_WIDTH);
      chat = Math.min(chat, budget - skills);
    } else {
      const reducibleChat = chat - PROJECT_AI_CHAT_MIN_WIDTH;
      const reducibleSkills = skills - PROJECT_AI_SKILLS_MIN_WIDTH;
      const overflow = chat + skills - budget;
      const reducibleTotal = reducibleChat + reducibleSkills;
      if (reducibleTotal > 0) {
        chat -= overflow * (reducibleChat / reducibleTotal);
        skills = budget - chat;
      }
    }

    return {
      chat: Math.max(PROJECT_AI_CHAT_MIN_WIDTH, Math.round(chat)),
      skills: Math.max(PROJECT_AI_SKILLS_MIN_WIDTH, Math.round(skills)),
    };
  }

  function getProjectAiChatMaxWidth() {
    return Math.max(
      PROJECT_AI_CHAT_MIN_WIDTH,
      getProjectAiSideBudget() - projectAiSkillsWidth
    );
  }

  function getProjectAiSkillsMaxWidth() {
    return Math.max(
      PROJECT_AI_SKILLS_MIN_WIDTH,
      getProjectAiSideBudget() - projectAiChatWidth
    );
  }

  function syncProjectAiResizerAria() {
    const chatResizer = $("projectAiChatResizer");
    if (chatResizer) {
      chatResizer.setAttribute("aria-valuemin", String(PROJECT_AI_CHAT_MIN_WIDTH));
      chatResizer.setAttribute("aria-valuemax", String(getProjectAiChatMaxWidth()));
      chatResizer.setAttribute("aria-valuenow", String(projectAiChatWidth));
    }

    const skillsResizer = $("projectAiSkillsResizer");
    if (skillsResizer) {
      skillsResizer.setAttribute(
        "aria-valuemin",
        String(PROJECT_AI_SKILLS_MIN_WIDTH)
      );
      skillsResizer.setAttribute(
        "aria-valuemax",
        String(getProjectAiSkillsMaxWidth())
      );
      skillsResizer.setAttribute("aria-valuenow", String(projectAiSkillsWidth));
    }
  }

  function persistProjectAiWidths() {
    try {
      localStorage.setItem(
        STORAGE_PROJECT_AI_CHAT_WIDTH,
        String(projectAiChatPreferredWidth)
      );
      localStorage.setItem(
        STORAGE_PROJECT_AI_SKILLS_WIDTH,
        String(projectAiSkillsPreferredWidth)
      );
    } catch (error) {
      console.warn("Failed to persist AI workspace widths:", error);
    }
  }

  function applyProjectAiWidths(
    chatWidth,
    skillsWidth,
    { persist = true, remember = true, priority = "balanced" } = {}
  ) {
    const resolved = resolveProjectAiWidths(chatWidth, skillsWidth, priority);
    projectAiChatWidth = resolved.chat;
    projectAiSkillsWidth = resolved.skills;
    if (remember) {
      projectAiChatPreferredWidth = resolved.chat;
      projectAiSkillsPreferredWidth = resolved.skills;
    }

    const layout = getProjectAiLayout();
    if (layout && !isStackedCanvasLayout()) {
      layout.style.setProperty("--project-ai-chat-width", `${resolved.chat}px`);
      layout.style.setProperty(
        "--project-ai-skills-width",
        `${resolved.skills}px`
      );
    } else if (layout) {
      layout.style.removeProperty("--project-ai-chat-width");
      layout.style.removeProperty("--project-ai-skills-width");
    }
    syncProjectAiResizerAria();
    if (persist) persistProjectAiWidths();
    window.requestAnimationFrame(() => projectInstructionEditor?.refresh());
  }

  function restoreProjectAiWidths() {
    let chat = PROJECT_AI_CHAT_DEFAULT_WIDTH;
    let skills = PROJECT_AI_SKILLS_DEFAULT_WIDTH;
    try {
      const storedChat = localStorage.getItem(STORAGE_PROJECT_AI_CHAT_WIDTH);
      const storedSkills = localStorage.getItem(STORAGE_PROJECT_AI_SKILLS_WIDTH);
      if (storedChat !== null) chat = Number(storedChat);
      if (storedSkills !== null) skills = Number(storedSkills);
    } catch (error) {
      console.warn("Failed to restore AI workspace widths:", error);
    }
    applyProjectAiWidths(chat, skills, { persist: false });
  }

  function bindProjectAiResizers() {
    const layout = getProjectAiLayout();
    const chatResizer = $("projectAiChatResizer");
    const skillsResizer = $("projectAiSkillsResizer");
    if (!layout || !chatResizer || !skillsResizer) return;

    const finishChatResize = (event) => {
      if (!projectAiChatResizeState) return;
      chatResizer.releasePointerCapture?.(projectAiChatResizeState.pointerId);
      projectAiChatResizeState = null;
      layout.classList.remove("is-chat-resizing");
      document.body.classList.remove("is-project-ai-resizing");
      applyProjectAiWidths(
        projectAiChatPreferredWidth,
        projectAiSkillsPreferredWidth,
        { persist: true, remember: false, priority: "chat" }
      );
      event?.preventDefault?.();
    };

    chatResizer.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || isStackedCanvasLayout()) return;
      event.preventDefault();
      projectAiChatResizeState = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startWidth: projectAiChatWidth,
      };
      chatResizer.setPointerCapture?.(event.pointerId);
      layout.classList.add("is-chat-resizing");
      document.body.classList.add("is-project-ai-resizing");
    });
    chatResizer.addEventListener("pointermove", (event) => {
      if (!projectAiChatResizeState) return;
      event.preventDefault();
      applyProjectAiWidths(
        projectAiChatResizeState.startWidth +
          event.clientX -
          projectAiChatResizeState.startX,
        projectAiSkillsPreferredWidth,
        { persist: false, priority: "chat" }
      );
    });
    chatResizer.addEventListener("pointerup", finishChatResize);
    chatResizer.addEventListener("pointercancel", finishChatResize);
    chatResizer.addEventListener("keydown", (event) => {
      const step = event.shiftKey ? 48 : 24;
      let nextWidth = projectAiChatWidth;
      if (event.key === "ArrowLeft") nextWidth -= step;
      else if (event.key === "ArrowRight") nextWidth += step;
      else if (event.key === "Home") nextWidth = PROJECT_AI_CHAT_MIN_WIDTH;
      else if (event.key === "End") nextWidth = getProjectAiChatMaxWidth();
      else return;
      event.preventDefault();
      applyProjectAiWidths(nextWidth, projectAiSkillsPreferredWidth, {
        priority: "chat",
      });
    });

    const finishSkillsResize = (event) => {
      if (!projectAiSkillsResizeState) return;
      skillsResizer.releasePointerCapture?.(projectAiSkillsResizeState.pointerId);
      projectAiSkillsResizeState = null;
      layout.classList.remove("is-skills-resizing");
      document.body.classList.remove("is-project-ai-resizing");
      applyProjectAiWidths(
        projectAiChatPreferredWidth,
        projectAiSkillsPreferredWidth,
        { persist: true, remember: false, priority: "skills" }
      );
      event?.preventDefault?.();
    };

    skillsResizer.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || isStackedCanvasLayout()) return;
      event.preventDefault();
      projectAiSkillsResizeState = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startWidth: projectAiSkillsWidth,
      };
      skillsResizer.setPointerCapture?.(event.pointerId);
      layout.classList.add("is-skills-resizing");
      document.body.classList.add("is-project-ai-resizing");
    });
    skillsResizer.addEventListener("pointermove", (event) => {
      if (!projectAiSkillsResizeState) return;
      event.preventDefault();
      applyProjectAiWidths(
        projectAiChatPreferredWidth,
        projectAiSkillsResizeState.startWidth -
          (event.clientX - projectAiSkillsResizeState.startX),
        { persist: false, priority: "skills" }
      );
    });
    skillsResizer.addEventListener("pointerup", finishSkillsResize);
    skillsResizer.addEventListener("pointercancel", finishSkillsResize);
    skillsResizer.addEventListener("keydown", (event) => {
      const step = event.shiftKey ? 48 : 24;
      let nextWidth = projectAiSkillsWidth;
      if (event.key === "ArrowLeft") nextWidth += step;
      else if (event.key === "ArrowRight") nextWidth -= step;
      else if (event.key === "Home") nextWidth = PROJECT_AI_SKILLS_MIN_WIDTH;
      else if (event.key === "End") nextWidth = getProjectAiSkillsMaxWidth();
      else return;
      event.preventDefault();
      applyProjectAiWidths(projectAiChatPreferredWidth, nextWidth, {
        priority: "skills",
      });
    });

    applyProjectAiWidths(
      projectAiChatPreferredWidth,
      projectAiSkillsPreferredWidth,
      { persist: false, remember: false }
    );
  }

  function bindWorkspaceResizeObserver() {
    const container = getCanvasSplitContainer();
    if (!container) return;

    const scheduleResize = () => {
      if (
        $("avrDeviceSection")?.classList.contains(
          "is-device-panel-transitioning"
        )
      ) {
        return;
      }
      if (workspaceResizeFrame !== null) return;
      workspaceResizeFrame = window.requestAnimationFrame(() => {
        workspaceResizeFrame = null;
        applyDocumentationWidth(documentationPreferredWidth, {
          persist: false,
          remember: false,
        });
        applyOutlinerWidth(outlinerPreferredWidth, {
          persist: false,
          remember: false,
        });
        applyDocumentationWidth(documentationPreferredWidth, {
          persist: false,
          remember: false,
        });
        applyProjectAiWidths(
          projectAiChatPreferredWidth,
          projectAiSkillsPreferredWidth,
          { persist: false, remember: false }
        );
        syncSplitResizerAria();
        fitEditorFileWatermark();
      });
    };

    if (typeof ResizeObserver === "function") {
      workspaceResizeObserver = new ResizeObserver(scheduleResize);
      workspaceResizeObserver.observe(container);
      const projectAiLayout = getProjectAiLayout();
      if (projectAiLayout) workspaceResizeObserver.observe(projectAiLayout);
      const editorContainer = document.querySelector(".editor-container");
      if (editorContainer) {
        watermarkResizeObserver = new ResizeObserver(
          scheduleEditorFileWatermarkFit
        );
        watermarkResizeObserver.observe(editorContainer);
      }
    } else {
      window.addEventListener("resize", scheduleResize);
    }

    document.fonts?.ready.then(refreshFontDependentMeasurements);
    document.fonts?.addEventListener?.(
      "loadingdone",
      refreshFontDependentMeasurements
    );
  }

  function getOutlinerFileKind(fileName) {
    const ext = String(fileName || "").split(".").pop().toLowerCase();
    if (["c", "cpp", "cc", "ino"].includes(ext)) return "c";
    if (["h", "hpp"].includes(ext)) return "h";
    if (["s", "asm"].includes(ext)) return "asm";
    if (["hex", "ihex"].includes(ext)) return "hex";
    if (ext === "txt") return "txt";
    if (ext === "md") return "md";
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
    return "F";
  }

  function startInlineCreate() {
    closeFileContextMenu();
    closeAddFileModal();
    expandOutlinerForEditing();
    inlineFileEdit = {
      mode: "create",
      value: uniqueName("main.c"),
      error: "",
    };
    renderOutliner();
    focusInlineFileInput();
  }

  function startInlineCreateGroup() {
    closeFileContextMenu();
    closeAddFileModal();
    expandOutlinerForEditing();
    inlineFileEdit = {
      mode: "create-group",
      value: uniqueGroupName("New group"),
      error: "",
    };
    renderOutliner();
    focusInlineFileInput();
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

  function startInlineRenameGroup(groupName) {
    if (!hasGroup(groupName)) return;
    closeFileContextMenu();
    closeAddFileModal();
    expandOutlinerForEditing();
    inlineFileEdit = {
      mode: "rename-group",
      originalName: groupName,
      value: groupName,
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
    const isGroupEdit =
      inlineFileEdit.mode === "create-group" ||
      inlineFileEdit.mode === "rename-group";
    const isProjectEdit = inlineFileEdit.mode === "rename-project";
    const nextName =
      isGroupEdit || isProjectEdit
        ? rawName
        : normalizeInlineFileName(rawName);
    const error = isProjectEdit
      ? validateMiniProjectDisplayName(nextName, inlineFileEdit.instanceId)
      : isGroupEdit
        ? validateInlineGroupName(nextName, originalName)
        : validateInlineFileName(nextName, originalName);

    if (error) {
      inlineFileEdit.value = nextName;
      inlineFileEdit.error = error;
      renderOutliner();
      focusInlineFileInput();
      return false;
    }

    if (inlineFileEdit.mode === "create") {
      files[nextName] = getNewFileContent(nextName);
      fileAuthorship[nextName] = createMarkdownAuthorship(
        files[nextName],
        "human"
      );
      inlineFileEdit = null;
      selectFile(nextName);
      return true;
    }

    if (inlineFileEdit.mode === "create-group") {
      fileGroups[nextName] = {
        files: [],
        groups: [],
        expanded: false,
      };
      inlineFileEdit = null;
      persistState();
      renderOutliner();
      return true;
    }

    if (inlineFileEdit.mode === "rename") {
      inlineFileEdit = null;
      applyFileRename(originalName, nextName);
      return true;
    }

    if (inlineFileEdit.mode === "rename-group") {
      inlineFileEdit = null;
      applyGroupRename(originalName, nextName);
      return true;
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

  function removeGroupFromParents(groupName) {
    for (const group of Object.values(fileGroups)) {
      group.groups = (group.groups || []).filter((name) => name !== groupName);
    }
  }

  function moveFileToRoot(fileName, targetName = "", placement = "after") {
    if (!hasFile(fileName)) return false;

    removeFileFromGroups(fileName);
    setFilesInOrder(
      insertFileName(Object.keys(files), fileName, targetName, placement)
    );
    persistState();
    renderOutliner();
    refreshDocumentationPane({ preserveScroll: true });
    return true;
  }

  function moveFileToGroup(fileName, groupName, targetName = "", placement = "after") {
    if (!hasFile(fileName) || !hasGroup(groupName)) return;

    removeFileFromGroups(fileName);
    const group = fileGroups[groupName];
    const groupFiles = (group.files || []).filter((name) => hasFile(name));
    group.files = insertFileName(groupFiles, fileName, targetName, placement);
    group.expanded = true;
    persistState();
    renderOutliner();
    refreshDocumentationPane({ preserveScroll: true });
    return true;
  }

  function moveGroupToRoot(groupName, targetName = "", placement = "after") {
    if (!hasGroup(groupName)) return false;

    removeGroupFromParents(groupName);
    setGroupsInOrder(
      insertName(Object.keys(fileGroups), groupName, targetName, placement)
    );
    persistState();
    renderOutliner();
    refreshDocumentationPane({ preserveScroll: true });
    return true;
  }

  function moveGroupToGroup(groupName, parentGroupName, targetName = "", placement = "after") {
    if (
      !hasGroup(groupName) ||
      !hasGroup(parentGroupName) ||
      groupName === parentGroupName ||
      isGroupDescendant(groupName, parentGroupName)
    ) {
      return false;
    }

    removeGroupFromParents(groupName);
    const parentGroup = fileGroups[parentGroupName];
    const groupNames = (parentGroup.groups || []).filter((name) => hasGroup(name));
    parentGroup.groups = insertName(groupNames, groupName, targetName, placement);
    parentGroup.expanded = true;
    persistState();
    renderOutliner();
    return true;
  }

  function assignFileToGroup(fileName, groupName) {
    moveFileToGroup(fileName, groupName);
  }

  function createGroupFromFiles(sourceFileName, targetFileName) {
    if (
      !hasFile(sourceFileName) ||
      !hasFile(targetFileName) ||
      sourceFileName === targetFileName
    ) {
      return false;
    }

    const parentGroupName = getFileGroup(targetFileName);
    const groupName = uniqueGroupName("New group");
    fileGroups[groupName] = {
      files: [],
      groups: [],
      expanded: true,
    };

    removeFileFromGroups(sourceFileName);
    removeFileFromGroups(targetFileName);
    fileGroups[groupName].files = [targetFileName, sourceFileName];

    if (parentGroupName && hasGroup(parentGroupName)) {
      const parentGroup = fileGroups[parentGroupName];
      parentGroup.groups = insertName(parentGroup.groups || [], groupName);
      parentGroup.expanded = true;
    }

    persistState();
    renderOutliner();
    refreshDocumentationPane({ preserveScroll: true });
    return true;
  }

  function eventHasDraggedEntry(event) {
    const types = Array.from(event.dataTransfer?.types || []);
    return (
      types.includes("text/x-ud-file") ||
      types.includes("text/x-ud-group") ||
      types.includes("text/plain")
    );
  }

  function getDraggedEntry(event) {
    const type = event.dataTransfer?.getData("text/x-ud-drag-type") || "";
    const groupName = event.dataTransfer?.getData("text/x-ud-group") || "";
    const fileName = event.dataTransfer?.getData("text/x-ud-file") || "";

    if (type === "group" && groupName) {
      return {
        type: "group",
        name: groupName,
      };
    }

    if (type === "file" && fileName) {
      return {
        type: "file",
        name: fileName,
      };
    }

    if (groupName) {
      return {
        type: "group",
        name: groupName,
      };
    }

    return {
      type: "file",
      name: fileName || event.dataTransfer?.getData("text/plain") || "",
    };
  }

  function getDropPlacement(event, row) {
    const rect = row.getBoundingClientRect();
    const y = event.clientY - rect.top;
    if (y > rect.height * 0.28 && y < rect.height * 0.72) return "inside";
    return y < rect.height / 2 ? "before" : "after";
  }

  function clearOutlinerDropMarkers() {
    document
      .querySelectorAll(".file-item.drop-before, .file-item.drop-after, .file-item.drop-target, .file-group-block.drop-target")
      .forEach((row) => {
        row.classList.remove("drop-before", "drop-after", "drop-target");
      });
    $("fileList")?.classList.remove("root-drop-target");
  }

  function markRowDrop(row, placement) {
    clearOutlinerDropMarkers();
    if (placement === "inside") {
      row.classList.add("drop-target");
      return;
    }

    row.classList.add(placement === "before" ? "drop-before" : "drop-after");
  }

  function bindOutlinerDropZone() {
    const list = $("fileList");
    if (!list) return;

    list.addEventListener("dragover", (event) => {
      if (!eventHasDraggedEntry(event)) return;
      const handledTarget = event.target.closest(
        ".file-item[data-file], .file-item.file-group, .file-group-block"
      );
      if (handledTarget) return;

      event.preventDefault();
      clearOutlinerDropMarkers();
      list.classList.add("root-drop-target");
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    });

    list.addEventListener("dragleave", (event) => {
      if (list.contains(event.relatedTarget)) return;
      list.classList.remove("root-drop-target");
    });

    list.addEventListener("drop", (event) => {
      if (!eventHasDraggedEntry(event)) return;
      const handledTarget = event.target.closest(
        ".file-item[data-file], .file-item.file-group, .file-group-block"
      );
      if (handledTarget) return;

      event.preventDefault();
      clearOutlinerDropMarkers();
      const dragged = getDraggedEntry(event);
      if (dragged.type === "group") {
        moveGroupToRoot(dragged.name);
      } else {
        moveFileToRoot(dragged.name);
      }
    });
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
    row.draggable = true;
    row.title = isMiniProjectSource ? `${displayName} (${name})` : name;
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
    menuBtn.title = "File actions";
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

    row.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      openFileContextMenu(name, e.clientX, e.clientY);
    });

    row.addEventListener("dragstart", (e) => {
      row.classList.add("dragging");
      e.dataTransfer?.setData("text/x-ud-drag-type", "file");
      e.dataTransfer?.setData("text/x-ud-file", name);
      e.dataTransfer?.setData("text/x-ud-source-group", groupName || "");
      e.dataTransfer?.setData("text/plain", name);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
    });

    row.addEventListener("dragend", () => {
      row.classList.remove("dragging");
      clearOutlinerDropMarkers();
    });

    row.addEventListener("dragover", (e) => {
      if (!eventHasDraggedEntry(e)) return;

      const dragged = getDraggedEntry(e);
      if (dragged.type === "file" && dragged.name === name) return;

      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      const placement = getDropPlacement(e, row);
      markRowDrop(row, dragged.type === "file" ? placement : placement === "inside" ? "after" : placement);
    });

    row.addEventListener("dragleave", (e) => {
      if (row.contains(e.relatedTarget)) return;
      row.classList.remove("drop-before", "drop-after", "drop-target");
    });

    row.addEventListener("drop", (e) => {
      if (!eventHasDraggedEntry(e)) return;

      e.preventDefault();
      e.stopPropagation();
      clearOutlinerDropMarkers();

      const dragged = getDraggedEntry(e);
      if (!dragged.name || dragged.name === name) return;
      const placement = getDropPlacement(e, row);

      if (dragged.type === "group") {
        if (groupName) {
          moveGroupToGroup(dragged.name, groupName);
        } else {
          moveGroupToRoot(dragged.name);
        }
        return;
      }

      if (placement === "inside") {
        createGroupFromFiles(dragged.name, name);
        return;
      }

      if (groupName) {
        moveFileToGroup(dragged.name, groupName, name, placement);
      } else {
        moveFileToRoot(dragged.name, name, placement);
      }
    });

    list.appendChild(row);
  }

  function renderGroupRow(list, groupName, depth = 0) {
    const groupFileCount = getGroupFileCount(groupName);
    const row = document.createElement("div");
    row.className = "file-item file-group";
    row.dataset.group = groupName;
    row.dataset.outlinerIcon = "";
    row.dataset.groupCount = String(groupFileCount);
    row.draggable = true;
    row.title = groupName;
    row.style.setProperty("--outliner-depth", String(depth));

    const group = fileGroups[groupName];
    if (group?.expanded) row.classList.add("expanded");

    const editingThisGroup =
      inlineFileEdit &&
      inlineFileEdit.mode === "rename-group" &&
      inlineFileEdit.originalName === groupName;

    if (editingThisGroup) {
      row.classList.add("editing");
      renderInlineFileInput(row, inlineFileEdit);
      list.appendChild(row);
      return;
    }

    const label = document.createElement("div");
    label.className = "file-name";
    label.textContent = groupName;
    row.appendChild(label);

    const count = document.createElement("span");
    count.className = "file-group-count";
    count.textContent = `+${groupFileCount}`;
    count.title = "Files in group";
    row.appendChild(count);

    const acts = document.createElement("div");
    acts.className = "file-actions";

    const menuBtn = document.createElement("button");
    menuBtn.className = "file-menu-btn";
    menuBtn.title = "Group actions";
    menuBtn.textContent = "\u22ef";

    menuBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const rect = menuBtn.getBoundingClientRect();
      openGroupContextMenu(groupName, rect.left + rect.width / 2, rect.bottom + 4);
    });

    acts.appendChild(menuBtn);
    row.appendChild(acts);

    row.addEventListener("click", () => {
      if (inlineFileEdit && !commitInlineFileEdit()) return;
      fileGroups[groupName].expanded = !fileGroups[groupName].expanded;
      persistState();
      renderOutliner();
    });

    row.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      openGroupContextMenu(groupName, e.clientX, e.clientY);
    });

    row.addEventListener("dragstart", (e) => {
      row.classList.add("dragging");
      e.dataTransfer?.setData("text/x-ud-drag-type", "group");
      e.dataTransfer?.setData("text/x-ud-group", groupName);
      e.dataTransfer?.setData("text/plain", groupName);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
    });

    row.addEventListener("dragend", () => {
      row.classList.remove("dragging");
      clearOutlinerDropMarkers();
    });

    row.addEventListener("dragover", (e) => {
      if (!eventHasDraggedEntry(e)) return;
      const dragged = getDraggedEntry(e);
      if (
        dragged.type === "group" &&
        (dragged.name === groupName || isGroupDescendant(dragged.name, groupName))
      ) {
        return;
      }

      e.preventDefault();
      e.stopPropagation();
      const placement = getDropPlacement(e, row);
      markRowDrop(row, placement);
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    });

    row.addEventListener("dragleave", (e) => {
      if (row.contains(e.relatedTarget)) return;
      row.classList.remove("drop-before", "drop-after", "drop-target");
    });

    row.addEventListener("drop", (e) => {
      if (!eventHasDraggedEntry(e)) return;
      e.preventDefault();
      e.stopPropagation();
      clearOutlinerDropMarkers();

      const dragged = getDraggedEntry(e);
      if (!dragged.name) return;
      const placement = getDropPlacement(e, row);

      if (dragged.type === "group") {
        if (
          dragged.name === groupName ||
          isGroupDescendant(dragged.name, groupName)
        ) {
          return;
        }

        if (placement === "inside") {
          moveGroupToGroup(dragged.name, groupName);
          return;
        }

        const parentGroupName = getGroupParent(groupName);
        if (parentGroupName) {
          moveGroupToGroup(dragged.name, parentGroupName, groupName, placement);
        } else {
          moveGroupToRoot(dragged.name, groupName, placement);
        }
        return;
      }

      if (placement === "inside") {
        assignFileToGroup(dragged.name, groupName);
        return;
      }

      const parentGroupName = getGroupParent(groupName);
      if (parentGroupName) {
        moveFileToGroup(dragged.name, parentGroupName);
      } else {
        moveFileToRoot(dragged.name);
      }
    });

    list.appendChild(row);
  }

  function renderOutlinerLegacy() {
    const list = $("fileList");
    list.innerHTML = "";

    const newRow = document.createElement("div");
    newRow.className = "file-item new-item";
    newRow.dataset.outlinerIcon = "+";
    newRow.title = "Add file";

    if (inlineFileEdit && inlineFileEdit.mode === "create") {
      newRow.classList.add("active", "editing");
      renderInlineFileInput(newRow, inlineFileEdit);
    } else {
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

    const names = Object.keys(files);

    for (const name of names) {
      const row = document.createElement("div");
      row.className = "file-item";
      row.dataset.file = name;
      if (isCFileName(name)) row.classList.add("file-c");

      if (name === current) {
        row.classList.add("active");
      }

      const editingThisFile =
        inlineFileEdit &&
        inlineFileEdit.mode === "rename" &&
        inlineFileEdit.originalName === name;

      if (editingThisFile) {
        row.classList.add("editing");
        renderInlineFileInput(row, inlineFileEdit);
        list.appendChild(row);
        continue;
      }

      const label = document.createElement("div");
      label.className = "file-name";
      label.textContent = name;
      row.appendChild(label);

      const acts = document.createElement("div");
      acts.className = "file-actions";

      const menuBtn = document.createElement("button");
      menuBtn.className = "file-menu-btn";
      menuBtn.title = "File actions";
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

      row.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        openFileContextMenu(name, e.clientX, e.clientY);
      });

      list.appendChild(row);
    }

    updateToolbarState();
    updateCompilePanelState(false);
  }

  function renderGroupEntry(list, groupName, depth = 0) {
    const group = fileGroups[groupName];
    if (!group) return;

    if (!group.expanded) {
      renderGroupRow(list, groupName, depth);
      return;
    }

    const groupBlock = document.createElement("div");
    groupBlock.className = "file-group-block";
    groupBlock.dataset.groupFiles = groupName;
    groupBlock.style.setProperty("--outliner-depth", String(depth));

    groupBlock.addEventListener("dragover", (event) => {
      if (!eventHasDraggedEntry(event)) return;
      const handledTarget = event.target.closest(
        ".file-item[data-file], .file-item.file-group"
      );
      if (handledTarget) return;

      const dragged = getDraggedEntry(event);
      if (
        dragged.type === "group" &&
        (dragged.name === groupName || isGroupDescendant(dragged.name, groupName))
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      clearOutlinerDropMarkers();
      groupBlock.classList.add("drop-target");
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    });

    groupBlock.addEventListener("dragleave", (event) => {
      if (groupBlock.contains(event.relatedTarget)) return;
      groupBlock.classList.remove("drop-target");
    });

    groupBlock.addEventListener("drop", (event) => {
      if (!eventHasDraggedEntry(event)) return;
      const handledTarget = event.target.closest(
        ".file-item[data-file], .file-item.file-group"
      );
      if (handledTarget) return;

      event.preventDefault();
      event.stopPropagation();
      clearOutlinerDropMarkers();

      const dragged = getDraggedEntry(event);
      if (dragged.type === "group") {
        moveGroupToGroup(dragged.name, groupName);
      } else {
        moveFileToGroup(dragged.name, groupName);
      }
    });

    renderGroupRow(groupBlock, groupName, depth);

    for (const childGroupName of getGroupChildGroups(groupName)) {
      renderGroupEntry(groupBlock, childGroupName, depth + 1);
    }

    for (const fileName of (group.files || []).filter(
      (name) => hasFile(name) && !isHiddenMiniProjectFile(name)
    )) {
      renderFileRow(groupBlock, fileName, groupName, depth + 1);
    }

    list.appendChild(groupBlock);
  }

  function renderOutliner() {
    const list = $("fileList");
    list.innerHTML = "";

    const newRow = document.createElement("div");
    newRow.className = "file-item new-item";
    newRow.dataset.outlinerIcon = "+";
    newRow.title = "Add file";

    if (inlineFileEdit && inlineFileEdit.mode === "create") {
      newRow.classList.add("active", "editing");
      renderInlineFileInput(newRow, inlineFileEdit);
    } else {
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

    if (inlineFileEdit && inlineFileEdit.mode === "create-group") {
      const groupRow = document.createElement("div");
      groupRow.className = "file-item file-group editing";
      groupRow.dataset.outlinerIcon = "";
      renderInlineFileInput(groupRow, inlineFileEdit);
      list.appendChild(groupRow);
    }

    const groupedFiles = getGroupedFileSet();
    const entries = [
      ...getRootGroupNames().map((name) => ({
        type: "group",
        name,
      })),
      ...Object.keys(files)
        .filter(
          (name) => !groupedFiles.has(name) && !isHiddenMiniProjectFile(name)
        )
        .map((name) => ({
          type: "file",
          name,
        })),
    ];

    for (const entry of entries) {
      if (entry.type === "group") {
        renderGroupEntry(list, entry.name, 0);
      } else {
        renderFileRow(list, entry.name, "", 0);
      }
    }

    updateToolbarState();
    updateCompilePanelState(false);
  }

  function openFileContextMenu(fileName, clientX, clientY) {
    const menu = $("fileContextMenu");
    if (!menu) return;

    contextMenuFile = fileName;
    contextMenuGroup = null;

    const renameBtn = menu.querySelector('button[data-action="rename"]');
    const deleteBtn = menu.querySelector('button[data-action="delete"]');
    const leaveGroupBtn = menu.querySelector('button[data-action="leave-group"]');
    const downloadBtn = menu.querySelector('button[data-action="download"]');
    const groupName = getFileGroup(fileName);
    const linkedProject = getMiniProjectForFile(fileName);
    const isMiniProjectSource =
      linkedProject?.role === miniProjectCore.ROLES.SOURCE;

    if (renameBtn) {
      renameBtn.hidden = false;
      renameBtn.textContent = isMiniProjectSource
        ? "Rename mini-project"
        : "Rename";
    }
    if (deleteBtn) {
      deleteBtn.hidden = false;
      deleteBtn.textContent = isMiniProjectSource
        ? "Delete mini-project"
        : "Delete";
    }
    if (leaveGroupBtn) leaveGroupBtn.hidden = !groupName;
    if (downloadBtn) downloadBtn.hidden = false;

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

  function openGroupContextMenu(groupName, clientX, clientY) {
    const menu = $("fileContextMenu");
    if (!menu) return;

    contextMenuFile = null;
    contextMenuGroup = groupName;

    const renameBtn = menu.querySelector('button[data-action="rename"]');
    const deleteBtn = menu.querySelector('button[data-action="delete"]');
    const leaveGroupBtn = menu.querySelector('button[data-action="leave-group"]');
    const downloadBtn = menu.querySelector('button[data-action="download"]');
    const downloadHexBtn = menu.querySelector(
      'button[data-action="download-hex"]'
    );

    if (renameBtn) {
      renameBtn.hidden = false;
      renameBtn.textContent = "Rename group";
    }
    if (deleteBtn) {
      deleteBtn.hidden = false;
      deleteBtn.textContent = "Delete group";
    }
    if (leaveGroupBtn) leaveGroupBtn.hidden = true;
    if (downloadBtn) downloadBtn.hidden = true;
    if (downloadHexBtn) downloadHexBtn.hidden = true;

    menu.style.display = "block";

    const menuRect = menu.getBoundingClientRect();
    const margin = 4;
    let x = clientX;
    let y = clientY;

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
    contextMenuGroup = null;
  }

  async function handleFileContextAction(action) {
    if (contextMenuGroup && hasGroup(contextMenuGroup)) {
      const targetGroup = contextMenuGroup;
      closeFileContextMenu();

      switch (action) {
        case "rename":
          startInlineRenameGroup(targetGroup);
          break;
        case "delete":
          await deleteGroup(targetGroup);
          break;
        default:
          break;
      }
      return;
    }

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
      case "leave-group":
        moveFileToRoot(targetName);
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
    return !!(
      linkedProject && linkedProject.role !== miniProjectCore.ROLES.SOURCE
    );
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

  function renameMiniProjectFile(oldName, newName) {
    for (const project of Object.values(miniProjects)) {
      for (const role of Object.keys(project.files || {})) {
        if (project.files[role] === oldName) project.files[role] = newName;
      }
      for (const guide of Object.values(project.guides || {})) {
        if (guide?.fileName === oldName) guide.fileName = newName;
      }
    }
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
      if (indexDocumentationHeadings) documentationHeadingIndex = new Map();
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
          if (headingKey && !documentationHeadingIndex.has(indexKey)) {
            documentationHeadingIndex.set(indexKey, element);
          }
        },
      });
      return;
    }

    content.replaceChildren();
    if (indexDocumentationHeadings) documentationHeadingIndex = new Map();

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
        if (headingKey && !documentationHeadingIndex.has(indexKey)) {
          documentationHeadingIndex.set(indexKey, heading);
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

  function normalizeInstructionSkillRefs(value) {
    if (!Array.isArray(value)) return [];
    const seen = new Set();
    const refs = [];
    for (const rawRef of value) {
      const id = String(rawRef?.id || "").trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      refs.push({
        id,
        version: String(rawRef?.version || "").trim(),
      });
    }
    return refs;
  }

  function normalizeProjectInstructionDocument(value) {
    const source = value && typeof value === "object" ? value : {};
    const revision = Number(source.revision);
    return {
      schemaVersion: 1,
      revision:
        Number.isSafeInteger(revision) && revision >= 0 ? revision : 0,
      markdown:
        typeof source.markdown === "string"
          ? source.markdown
          : DEFAULT_PROJECT_INSTRUCTION,
      skillRefs: normalizeInstructionSkillRefs(source.skillRefs),
      authorship: normalizeMarkdownAuthorship(
        source.authorship,
        typeof source.markdown === "string"
          ? source.markdown
          : DEFAULT_PROJECT_INSTRUCTION
      ),
    };
  }

  function parseStoredProjectInstruction(rawValue) {
    const parsed = JSON.parse(rawValue);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      parsed.schemaVersion !== 1 ||
      !Number.isSafeInteger(parsed.revision) ||
      parsed.revision < 0 ||
      typeof parsed.markdown !== "string"
    ) {
      throw new TypeError("Invalid stored project instruction.");
    }
    return normalizeProjectInstructionDocument(parsed);
  }

  function getProjectInstructionSnapshot({ forRequest = false } = {}) {
    const skillRefs = getCompatibleInstructionSkillRefs(
      projectInstructionDocument.markdown,
      projectInstructionDocument.skillRefs,
      { requireCatalog: forRequest }
    );
    return {
      schemaVersion: 1,
      revision: projectInstructionDocument.revision,
      markdown: projectInstructionDocument.markdown,
      skillRefs: skillRefs.map((skillRef) => ({
        ...skillRef,
      })),
      authorship: normalizeMarkdownAuthorship(
        projectInstructionDocument.authorship,
        projectInstructionDocument.markdown
      ),
    };
  }

  function setProjectInstructionSaveState(message = "", { error = false } = {}) {
    const saveState = $("projectInstructionSaveState");
    if (!saveState) return;
    const visibleMessage = String(message || "").trim();
    saveState.textContent = visibleMessage;
    saveState.hidden = !visibleMessage;
    saveState.classList.toggle("is-error", error && !!visibleMessage);
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
          projectInstructionDocument =
            legacyDocument.markdown === LEGACY_DEFAULT_PROJECT_INSTRUCTION
              ? {
                  ...legacyDocument,
                  markdown: DEFAULT_PROJECT_INSTRUCTION,
                  skillRefs: [],
                  authorship: normalizeMarkdownAuthorship(
                    null,
                    DEFAULT_PROJECT_INSTRUCTION
                  ),
                }
              : legacyDocument;
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
  }

  function persistProjectInstruction(
    { immediate = false, recover = false } = {}
  ) {
    if (projectInstructionStorageReadFailed && !recover) {
      setProjectInstructionSaveState("Stored instruction is unreadable", {
        error: true,
      });
      return;
    }
    if (recover) {
      projectInstructionStorageReadFailed = false;
      setProjectInstructionSaveState();
    }
    if (projectInstructionSaveTimer) {
      window.clearTimeout(projectInstructionSaveTimer);
      projectInstructionSaveTimer = null;
    }
    projectInstructionSaveAttempts = 0;
    if (projectAiBootComplete && !projectAiAccountWorkspaceApplying) {
      markProjectAiAccountDocumentDirty("instruction");
    }

    const save = () => {
      projectInstructionSaveTimer = null;
      try {
        window.localStorage.setItem(
          STORAGE_PROJECT_INSTRUCTION,
          JSON.stringify(getProjectInstructionSnapshot())
        );
      } catch {
        projectInstructionSaveAttempts += 1;
        const retrying = projectInstructionSaveAttempts < 3;
        setProjectInstructionSaveState(
          retrying ? "Save failed — retrying" : "Save failed",
          { error: true }
        );
        console.warn("The project instruction could not be saved locally.");
        if (retrying) {
          projectInstructionSaveTimer = window.setTimeout(
            save,
            600 * projectInstructionSaveAttempts
          );
        }
        return;
      }
      projectInstructionSaveAttempts = 0;
      setProjectInstructionSaveState();
    };

    if (immediate) save();
    else projectInstructionSaveTimer = window.setTimeout(save, 240);
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
    try {
      state.editor.clearGutter("markdown-authorship-gutter");
    } catch {}
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

  function addMarkdownAuthorshipGutter(state, markdown) {
    const authorship = normalizeMarkdownAuthorship(
      state.getAuthorship?.(),
      markdown
    );
    for (let line = 0; line < authorship.lines.length; line += 1) {
      const author = authorship.lines[line];
      if (author === "original") continue;
      const marker = document.createElement("span");
      marker.className = `markdown-authorship-marker is-${author}`;
      marker.textContent = author === "ai" ? "AI" : "H";
      marker.title =
        author === "ai"
          ? "This line was generated or changed by AI"
          : "This line was written or changed by a person";
      marker.setAttribute("aria-label", marker.title);
      state.editor.setGutterMarker(line, "markdown-authorship-gutter", marker);
    }
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
        addMarkdownAuthorshipGutter(state, markdown);
      });
      state.onHeadings?.(new Map());
      return;
    }
    if (!markdownRuntime?.analyze || !markdownRuntime?.renderInto) {
      state.renderCache = null;
      state.editor.operation(() => {
        clearMarkdownLiveDecorations(state);
        addMarkdownAuthorshipGutter(state, markdown);
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
        addMarkdownAuthorshipGutter(state, markdown);
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
      addMarkdownAuthorshipGutter(state, markdown);
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
    { skillRefs, expectedRevision = null, focus = false } = {}
  ) {
    if (typeof markdown !== "string") {
      throw new TypeError("The project instruction must be Markdown text.");
    }
    if (
      expectedRevision !== null &&
      projectInstructionDocument.revision !== expectedRevision
    ) {
      throw new Error(
        "The instruction changed while the AI was responding. Your newer edits were preserved."
      );
    }

    const previousMarkdown = projectInstructionDocument.markdown;
    projectInstructionDocument = {
      schemaVersion: 1,
      revision: projectInstructionDocument.revision + 1,
      markdown,
      skillRefs:
        skillRefs === undefined
          ? projectInstructionDocument.skillRefs
          : normalizeInstructionSkillRefs(skillRefs),
      authorship: mergeMarkdownAuthorshipForReplacement(
        previousMarkdown,
        markdown,
        projectInstructionDocument.authorship,
        "ai"
      ),
    };
    setProjectInstructionEditorValue(projectInstructionDocument.markdown);
    scheduleProjectInstructionPreview();
    persistProjectInstruction({ recover: true });
    if (focus) {
      projectInstructionEditor?.focus();
      if (!projectInstructionEditor) {
        $("projectInstructionEditor")?.focus({ preventScroll: true });
      }
    }
  }

  function normalizeProjectAiSkill(rawSkill) {
    const id = String(rawSkill?.id || "").trim();
    const markdown = String(rawSkill?.markdown || "").trim();
    if (!id || !/^[a-z0-9][a-z0-9._-]{0,95}$/i.test(id) || !markdown) {
      return null;
    }
    return {
      id,
      version: String(rawSkill?.version || "1").trim(),
      title: String(rawSkill?.title || id).trim(),
      summary: String(rawSkill?.summary || "").trim(),
      category: String(rawSkill?.category || "").trim(),
      markdown,
    };
  }

  function getCompatibleInstructionSkillRefs(
    markdown,
    refs = projectInstructionDocument.skillRefs,
    { requireCatalog = false } = {}
  ) {
    const normalizedRefs = normalizeInstructionSkillRefs(refs);
    if (!projectAiSkillsLoaded) {
      return requireCatalog ? [] : normalizedRefs;
    }
    const source = String(markdown || "");
    return normalizeInstructionSkillRefs(
      normalizedRefs.flatMap((skillRef) => {
        const skill = projectAiSkills.get(skillRef.id);
        if (!skill || !source.includes(skill.markdown)) return [];
        return [{ id: skill.id, version: skill.version }];
      })
    );
  }

  function reconcileProjectInstructionSkillRefs() {
    const nextRefs = getCompatibleInstructionSkillRefs(
      projectInstructionDocument.markdown
    );
    if (
      JSON.stringify(nextRefs) ===
      JSON.stringify(projectInstructionDocument.skillRefs)
    ) {
      return;
    }
    projectInstructionDocument = {
      ...projectInstructionDocument,
      revision: projectInstructionDocument.revision + 1,
      skillRefs: nextRefs,
    };
    persistProjectInstruction();
  }

  function setProjectAiSkills(rawSkills, { catalogLoaded = true } = {}) {
    projectAiSkills.clear();
    for (const rawSkill of Array.isArray(rawSkills) ? rawSkills : []) {
      const skill = normalizeProjectAiSkill(rawSkill);
      if (skill) projectAiSkills.set(skill.id, skill);
    }
    projectAiSkillsLoaded = catalogLoaded;
    if (catalogLoaded) reconcileProjectInstructionSkillRefs();
    renderProjectAiSkills();
  }

  function renderProjectAiSkills(message = "") {
    const list = $("projectSkillsList");
    if (!list) return;
    list.replaceChildren();

    if (!projectAiSkills.size) {
      const empty = document.createElement("p");
      empty.className = "project-skills-empty";
      empty.textContent =
        message ||
        "No instruction blocks are published yet. You can write the Markdown instruction manually.";
      list.appendChild(empty);
      return;
    }

    for (const skill of projectAiSkills.values()) {
      const card = document.createElement("article");
      card.className = "project-skill-card";
      card.dataset.skillId = skill.id;
      card.draggable = true;
      card.setAttribute("role", "listitem");

      const copy = document.createElement("div");
      copy.className = "project-skill-card-copy";
      const title = document.createElement("strong");
      title.className = "project-skill-card-title";
      title.textContent = skill.title;
      const summary = document.createElement("span");
      summary.className = "project-skill-card-summary";
      summary.textContent = skill.summary || "Reusable instruction block";
      copy.append(title, summary);

      const insert = document.createElement("button");
      insert.className = "project-skill-insert";
      insert.type = "button";
      insert.dataset.insertSkillId = skill.id;
      insert.textContent = "Insert";
      insert.setAttribute("aria-label", `Insert ${skill.title}`);
      card.append(copy, insert);
      list.appendChild(card);
    }
  }

  function insertProjectAiSkill(
    skillId,
    { focus = true, append = false } = {}
  ) {
    const skill = projectAiSkills.get(String(skillId || ""));
    if (!skill || !projectInstructionEditor) return false;

    const source = projectInstructionEditor.getValue();
    const start = append
      ? source.length
      : projectInstructionEditor.indexFromPos(
          projectInstructionEditor.getCursor("from")
        );
    const end = append
      ? start
      : projectInstructionEditor.indexFromPos(
          projectInstructionEditor.getCursor("to")
        );
    const before = source.slice(0, start);
    const after = source.slice(end);
    const prefix = before
      ? before.endsWith("\n\n")
        ? ""
        : before.endsWith("\n")
          ? "\n"
          : "\n\n"
      : "";
    const suffix = after
      ? after.startsWith("\n\n")
        ? ""
        : after.startsWith("\n")
          ? "\n"
          : "\n\n"
      : "\n";
    const insertion = `${prefix}${skill.markdown}${suffix}`;
    projectInstructionDocument.skillRefs = normalizeInstructionSkillRefs([
      ...projectInstructionDocument.skillRefs,
      { id: skill.id, version: skill.version },
    ]);
    projectInstructionEditor.replaceRange(
      insertion,
      projectInstructionEditor.posFromIndex(start),
      projectInstructionEditor.posFromIndex(end),
      "+insertSkill"
    );
    projectInstructionEditor.setCursor(
      projectInstructionEditor.posFromIndex(start + insertion.length)
    );
    if (focus) projectInstructionEditor.focus();
    return true;
  }

  async function fetchProjectAiSkills() {
    renderProjectAiSkills("Loading instruction blocks...");
    try {
      const response = await fetch(PROJECT_AI_SKILLS_URL, {
        method: "GET",
        headers: { Accept: "application/json" },
        credentials: "same-origin",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.ok !== true || !Array.isArray(data.skills)) {
        throw new Error("Instruction blocks are not available yet.");
      }
      setProjectAiSkills(data.skills, { catalogLoaded: true });
    } catch (error) {
      setProjectAiSkills([], { catalogLoaded: false });
      renderProjectAiSkills(
        error?.message ||
          "Instruction blocks are not available yet. Write the Markdown manually."
      );
    }
  }

  function bindProjectInstructionWorkspace() {
    const editorElement = $("projectInstructionEditor");
    const dropZone = $("projectInstructionDropZone");
    const list = $("projectSkillsList");
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
        gutters: ["markdown-authorship-gutter"],
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
      bindCodeMirrorQuoteSurface(
        projectInstructionEditor,
        "Project instruction"
      );

      const inputField = projectInstructionEditor.getInputField();
      inputField.setAttribute("aria-label", "Project instruction Markdown");
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
        projectInstructionDocument = {
          ...projectInstructionDocument,
          revision: projectInstructionDocument.revision + 1,
          markdown,
          authorship: updateMarkdownAuthorshipForChange(
            projectInstructionDocument.authorship,
            previousMarkdown,
            change,
            "human"
          ),
          skillRefs: getCompatibleInstructionSkillRefs(
            markdown,
            projectInstructionDocument.skillRefs
          ),
        };
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
        projectInstructionDocument = {
          ...projectInstructionDocument,
          revision: projectInstructionDocument.revision + 1,
          markdown: editorElement.value,
          authorship: createMarkdownAuthorship(
            editorElement.value,
            previousMarkdown === editorElement.value ? "original" : "human"
          ),
          skillRefs: getCompatibleInstructionSkillRefs(
            editorElement.value,
            projectInstructionDocument.skillRefs
          ),
        };
        persistProjectInstruction({ recover: true });
      });
    }

    list?.addEventListener("click", (event) => {
      const insert = event.target.closest("[data-insert-skill-id]");
      if (insert) insertProjectAiSkill(insert.dataset.insertSkillId || "");
    });
    list?.addEventListener("dragstart", (event) => {
      const card = event.target.closest("[data-skill-id]");
      const skill = projectAiSkills.get(card?.dataset.skillId || "");
      if (!card || !skill || !event.dataTransfer) return;
      card.classList.add("is-dragging");
      event.dataTransfer.effectAllowed = "copy";
      event.dataTransfer.setData(
        AI_SKILL_DRAG_MIME,
        JSON.stringify({ id: skill.id })
      );
      event.dataTransfer.setData("text/plain", skill.id);
    });
    list?.addEventListener("dragend", (event) => {
      event.target.closest("[data-skill-id]")?.classList.remove("is-dragging");
      dropZone?.classList.remove("is-drag-over");
    });

    dropZone?.addEventListener("dragover", (event) => {
      const types = Array.from(event.dataTransfer?.types || []);
      if (!types.includes(AI_SKILL_DRAG_MIME)) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "copy";
      dropZone.classList.add("is-drag-over");
    }, true);
    dropZone?.addEventListener("dragleave", (event) => {
      if (!dropZone.contains(event.relatedTarget)) {
        dropZone.classList.remove("is-drag-over");
      }
    });
    dropZone?.addEventListener("drop", (event) => {
      const types = Array.from(event.dataTransfer?.types || []);
      if (!types.includes(AI_SKILL_DRAG_MIME)) return;
      event.preventDefault();
      event.stopPropagation();
      dropZone.classList.remove("is-drag-over");
      let skillId = "";
      try {
        const payload = JSON.parse(
          event.dataTransfer?.getData(AI_SKILL_DRAG_MIME) || "{}"
        );
        skillId = String(payload.id || "");
      } catch {}
      if (!skillId) {
        const plainSkillId = String(
          event.dataTransfer?.getData("text/plain") || ""
        ).trim();
        if (projectAiSkills.has(plainSkillId)) skillId = plainSkillId;
      }
      if (skillId) {
        insertProjectAiSkill(skillId, { append: true });
      }
    }, true);

    renderProjectInstructionPreview();
    renderProjectAiSkills();
    window.UartDebugAvrAiWorkspace = Object.freeze({
      getInstruction: getProjectInstructionSnapshot,
      setInstruction(markdown, options = {}) {
        applyProjectInstructionMarkdown(markdown, options);
        return getProjectInstructionSnapshot();
      },
      setSkills(skills) {
        setProjectAiSkills(skills, { catalogLoaded: true });
        return projectAiSkills.size;
      },
    });
  }

  function createProjectAiRecordId(prefix) {
    const normalizedPrefix = String(prefix || "item").replace(/[^a-z0-9-]/gi, "");
    const randomId = window.crypto?.randomUUID?.() ||
      `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    return `${normalizedPrefix}-${randomId}`;
  }

  function createEmptyProjectAiChat() {
    const now = Date.now();
    return {
      id: createProjectAiRecordId("chat"),
      title: "New chat",
      titleSource: "auto",
      titleLocked: false,
      createdAt: now,
      updatedAt: now,
      messages: [],
    };
  }

  function normalizeProjectAiMessage(rawMessage) {
    const role = String(rawMessage?.role || "");
    const content = String(rawMessage?.content || "").trim();
    if (!content || !["user", "assistant"].includes(role)) return null;
    const createdAt = Number(rawMessage?.createdAt);
    const editedAt = Number(rawMessage?.editedAt);
    return {
      id:
        String(rawMessage?.id || "").trim() ||
        createProjectAiRecordId("message"),
      role,
      content,
      title: String(rawMessage?.title || "").trim().slice(0, 120),
      createdAt:
        Number.isSafeInteger(createdAt) && createdAt > 0
          ? createdAt
          : Date.now(),
      ...(Number.isSafeInteger(editedAt) && editedAt >= createdAt
        ? { editedAt }
        : {}),
    };
  }

  function normalizeProjectAiChat(rawChat) {
    if (!rawChat || typeof rawChat !== "object" || Array.isArray(rawChat)) {
      return null;
    }
    const createdAt = Number(rawChat.createdAt);
    const updatedAt = Number(rawChat.updatedAt);
    const messages = [];
    for (const rawMessage of Array.isArray(rawChat.messages)
      ? rawChat.messages
      : []) {
      const message = normalizeProjectAiMessage(rawMessage);
      if (message) messages.push(message);
    }
    const title = String(rawChat.title || "").trim();
    return {
      id:
        String(rawChat.id || "").trim() || createProjectAiRecordId("chat"),
      title: (title || "New chat").slice(0, PROJECT_AI_CHAT_TITLE_LENGTH),
      titleSource:
        rawChat.titleSource === "manual" ? "manual" : "auto",
      titleLocked:
        rawChat.titleLocked === true || rawChat.titleSource === "manual",
      createdAt:
        Number.isSafeInteger(createdAt) && createdAt > 0
          ? createdAt
          : Date.now(),
      updatedAt:
        Number.isSafeInteger(updatedAt) && updatedAt > 0
          ? updatedAt
          : Date.now(),
      messages,
    };
  }

  function normalizeProjectAiChats(rawValue) {
    const source =
      rawValue && typeof rawValue === "object" && !Array.isArray(rawValue)
        ? rawValue
        : {};
    const chats = [];
    const seen = new Set();
    for (const rawChat of Array.isArray(source.chats) ? source.chats : []) {
      const chat = normalizeProjectAiChat(rawChat);
      if (!chat || seen.has(chat.id)) continue;
      seen.add(chat.id);
      chats.push(chat);
      if (chats.length >= PROJECT_AI_MAX_CHATS) break;
    }
    if (!chats.length) chats.push(createEmptyProjectAiChat());
    const requestedActiveId = String(source.activeChatId || "");
    return {
      schemaVersion: 1,
      activeChatId: chats.some((chat) => chat.id === requestedActiveId)
        ? requestedActiveId
        : chats[0].id,
      chats,
    };
  }

  function getActiveProjectAiChat() {
    let active = projectAiChats.chats.find(
      (chat) => chat.id === projectAiChats.activeChatId
    );
    if (!active) {
      active = projectAiChats.chats[0] || createEmptyProjectAiChat();
      if (!projectAiChats.chats.length) projectAiChats.chats.push(active);
      projectAiChats.activeChatId = active.id;
    }
    projectAiConversation = active.messages;
    return active;
  }

  function getProjectAiChatsSnapshot() {
    return normalizeProjectAiChats(projectAiChats);
  }

  function restoreProjectAiChats() {
    try {
      const raw = window.localStorage.getItem(STORAGE_PROJECT_AI_CHATS);
      projectAiChats = normalizeProjectAiChats(raw ? JSON.parse(raw) : null);
    } catch {
      projectAiChats = normalizeProjectAiChats(null);
      console.warn("The stored AI chats could not be read.");
    }
    getActiveProjectAiChat();
  }

  function persistProjectAiChats(
    { syncAccount = true, renderList = true } = {}
  ) {
    try {
      window.localStorage.setItem(
        STORAGE_PROJECT_AI_CHATS,
        JSON.stringify(getProjectAiChatsSnapshot())
      );
    } catch (error) {
      console.warn("The AI chats could not be saved locally:", error);
    }
    if (renderList) renderProjectAiChatList();
    if (
      syncAccount &&
      projectAiBootComplete &&
      !projectAiAccountWorkspaceApplying
    ) {
      markProjectAiAccountDocumentDirty("chats");
    }
  }

  function deriveProjectAiChatTitle(message) {
    const singleLine = String(message || "")
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/[#>*_`~\[\]()]/g, " ")
      .replace(/\s+/g, " ")
      .replace(/^(?:please|could you|can you|нужно|пожалуйста)\s+/i, "")
      .trim();
    if (!singleLine) return "New chat";
    const shortTitle = singleLine.split(" ").slice(0, 7).join(" ");
    if (shortTitle.length <= PROJECT_AI_CHAT_TITLE_LENGTH) return shortTitle;
    return `${shortTitle.slice(0, PROJECT_AI_CHAT_TITLE_LENGTH - 1).trim()}…`;
  }

  function recordProjectAiMessage(kind, message, title = "") {
    if (!["user", "assistant"].includes(kind)) return null;
    const chat = getActiveProjectAiChat();
    const normalized = normalizeProjectAiMessage({
      id: createProjectAiRecordId("message"),
      role: kind,
      content: message,
      title,
      createdAt: Date.now(),
    });
    if (!normalized) return null;
    chat.messages.push(normalized);
    if (kind === "user" && chat.title === "New chat") {
      chat.title = deriveProjectAiChatTitle(normalized.content);
      chat.titleSource = "auto";
      chat.titleLocked = false;
    }
    chat.updatedAt = Date.now();
    projectAiConversation = chat.messages;
    persistProjectAiChats();
    return normalized;
  }

  function renderProjectAiMessageElement(
    kind,
    message,
    title = "",
    record = null
  ) {
    const history = $("projectAiHistory");
    if (!history) return null;

    const article = document.createElement("article");
    article.className = `project-ai-message is-${kind}`;
    if (record?.id) article.dataset.messageId = record.id;
    else article.dataset.aiTransient = "true";

    const speaker = document.createElement("span");
    speaker.className = "sr-only";
    speaker.textContent =
      kind === "user"
        ? "You"
        : kind === "assistant"
          ? "AI assistant"
          : "System";
    article.appendChild(speaker);

    if (title) {
      const heading = document.createElement("strong");
      heading.textContent = title;
      article.appendChild(heading);
    }

    if (kind === "assistant") {
      const markdown = document.createElement("div");
      markdown.className =
        "project-ai-message-markdown project-documentation-content";
      renderMarkdownInto(markdown, message, null, { allowImages: false });
      article.appendChild(markdown);
    } else {
      const paragraph = document.createElement("p");
      paragraph.textContent = String(message || "");
      article.appendChild(paragraph);
    }
    if (record?.editedAt) {
      const edited = document.createElement("span");
      edited.className = "project-ai-message-edited";
      edited.textContent = "Edited";
      article.appendChild(edited);
    }
    if (record?.id && ["user", "assistant"].includes(kind)) {
      const actions = document.createElement("div");
      actions.className = "project-ai-message-actions";
      if (kind === "user") {
        const edit = document.createElement("button");
        edit.type = "button";
        edit.className = "project-ai-message-action";
        edit.dataset.editMessageId = record.id;
        edit.textContent = "Edit";
        edit.setAttribute("aria-label", "Edit message");
        actions.appendChild(edit);
      }
      const copy = document.createElement("button");
      copy.type = "button";
      copy.className = "project-ai-message-action";
      copy.dataset.copyMessageId = record.id;
      copy.textContent = "Copy";
      copy.setAttribute("aria-label", "Copy message");
      actions.appendChild(copy);
      article.appendChild(actions);
    }
    history.appendChild(article);
    history.scrollTop = history.scrollHeight;
    return article;
  }

  function appendProjectAiMessage(kind, message, title = "") {
    const record = recordProjectAiMessage(kind, message, title);
    const article = renderProjectAiMessageElement(
      kind,
      message,
      title,
      record
    );
    return article;
  }

  function renderProjectAiHistory() {
    const history = $("projectAiHistory");
    if (!history) return;
    history.replaceChildren();
    const chat = getActiveProjectAiChat();
    if (!chat.messages.length) {
      renderProjectAiMessageElement(
        "assistant",
        "Ask an AVR question, refine the instruction, or explicitly request a new or updated mini-project."
      );
      return;
    }
    for (const message of chat.messages) {
      renderProjectAiMessageElement(
        message.role,
        message.content,
        message.title,
        message
      );
    }
  }

  function findProjectAiMessage(messageId) {
    const chat = getActiveProjectAiChat();
    const index = chat.messages.findIndex(
      (message) => message.id === String(messageId || "")
    );
    return index >= 0 ? { chat, message: chat.messages[index], index } : null;
  }

  async function copyTextToClipboard(text) {
    const value = String(text || "");
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return;
    }
    const fallback = document.createElement("textarea");
    fallback.value = value;
    fallback.setAttribute("readonly", "");
    fallback.style.position = "fixed";
    fallback.style.opacity = "0";
    document.body.appendChild(fallback);
    fallback.select();
    const copied = document.execCommand?.("copy");
    fallback.remove();
    if (!copied) throw new Error("Clipboard access is unavailable.");
  }

  async function copyProjectAiMessage(messageId, button = null) {
    const found = findProjectAiMessage(messageId);
    if (!found) return;
    try {
      await copyTextToClipboard(found.message.content);
      if (button) {
        const previous = button.textContent;
        button.textContent = "Copied";
        window.setTimeout(() => {
          if (button.isConnected) button.textContent = previous;
        }, 1200);
      }
    } catch (error) {
      appendProjectAiMessage(
        "system",
        error?.message || "The message could not be copied."
      );
    }
  }

  function truncateProjectAiMessageBranchForEdit(found, content, editedAt) {
    if (
      !found?.chat ||
      !Array.isArray(found.chat.messages) ||
      found.message?.role !== "user" ||
      !Number.isSafeInteger(found.index) ||
      found.index < 0 ||
      found.chat.messages[found.index] !== found.message
    ) {
      return null;
    }
    const timestamp =
      Number.isSafeInteger(editedAt) && editedAt > 0 ? editedAt : Date.now();
    const editedMessage = {
      ...found.message,
      content: String(content || "").trim(),
      editedAt: timestamp,
    };
    found.chat.messages.splice(found.index);
    found.chat.updatedAt = timestamp;
    projectAiConversation = found.chat.messages;
    return editedMessage;
  }

  function beginProjectAiMessageEdit(messageId) {
    if (projectAiRequestInFlight) return;
    const found = findProjectAiMessage(messageId);
    if (!found || found.message.role !== "user") return;
    const article = document.querySelector(
      `.project-ai-message[data-message-id="${CSS.escape(found.message.id)}"]`
    );
    if (!article || article.classList.contains("is-editing")) return;
    article.classList.add("is-editing");
    const paragraph = article.querySelector("p");
    const actions = article.querySelector(".project-ai-message-actions");
    if (!paragraph) return;
    paragraph.hidden = true;
    if (actions) actions.hidden = true;
    const form = document.createElement("form");
    form.className = "project-ai-message-edit-form";
    const textarea = document.createElement("textarea");
    textarea.value = found.message.content;
    textarea.rows = Math.min(12, Math.max(3, textarea.value.split("\n").length));
    textarea.setAttribute("aria-label", "Edit message");
    const controls = document.createElement("div");
    controls.className = "project-ai-message-edit-controls";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "connect-btn secondary-btn";
    cancel.textContent = "Cancel";
    const save = document.createElement("button");
    save.type = "submit";
    save.className = "connect-btn";
    save.textContent = "Save";
    controls.append(cancel, save);
    form.append(textarea, controls);
    article.appendChild(form);

    const close = () => {
      form.remove();
      paragraph.hidden = false;
      if (actions) actions.hidden = false;
      article.classList.remove("is-editing");
    };
    cancel.addEventListener("click", close);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const content = textarea.value.trim();
      if (!content) {
        textarea.focus();
        return;
      }
      const editedAt = Date.now();
      if (
        found.index === 0 &&
        !found.chat.titleLocked &&
        found.chat.titleSource !== "manual"
      ) {
        found.chat.title = deriveProjectAiChatTitle(content);
        found.chat.titleSource = "auto";
      }
      const editedMessage = truncateProjectAiMessageBranchForEdit(
        found,
        content,
        editedAt
      );
      if (!editedMessage) return;
      void submitProjectAiRequest(content, {
        existingUserMessage: editedMessage,
        clearPromptOnSuccess: false,
      });
    });
    textarea.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    });
    textarea.focus({ preventScroll: true });
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }

  function applyProjectAiChatTitle(rawTitle) {
    const title = String(rawTitle || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, PROJECT_AI_CHAT_TITLE_LENGTH);
    if (!title) return false;
    const chat = getActiveProjectAiChat();
    if (chat.titleLocked || chat.titleSource === "manual") return false;
    chat.title = title;
    chat.titleSource = "auto";
    chat.updatedAt = Date.now();
    persistProjectAiChats();
    return true;
  }

  function getProjectAiSelectionQuoteButton() {
    let button = $("projectAiSelectionQuoteBtn");
    if (button) return button;
    button = document.createElement("button");
    button.id = "projectAiSelectionQuoteBtn";
    button.className = "project-ai-selection-quote";
    button.type = "button";
    button.textContent = "Quote in AI";
    button.hidden = true;
    button.setAttribute("aria-label", "Quote selected text in AI chat");
    button.addEventListener("pointerdown", (event) => event.preventDefault());
    button.addEventListener("click", insertProjectAiSelectionQuote);
    document.body.appendChild(button);
    return button;
  }

  function hideProjectAiSelectionQuote() {
    const button = $("projectAiSelectionQuoteBtn");
    if (button) button.hidden = true;
    projectAiSelectionQuote = null;
  }

  function showProjectAiSelectionQuote(selection, rect) {
    const text = String(selection?.text || "").trim();
    if (!text || text.length > 16 * 1024 || !rect) {
      hideProjectAiSelectionQuote();
      return;
    }
    projectAiSelectionQuote = { ...selection, text };
    const button = getProjectAiSelectionQuoteButton();
    button.hidden = false;
    const left = Math.min(
      window.innerWidth - button.offsetWidth - 10,
      Math.max(10, rect.left + Math.min(rect.width || 0, 32))
    );
    const top = Math.min(
      window.innerHeight - button.offsetHeight - 10,
      Math.max(10, rect.bottom + 8)
    );
    button.style.left = `${Math.round(left)}px`;
    button.style.top = `${Math.round(top)}px`;
  }

  function insertProjectAiSelectionQuote() {
    const selection = projectAiSelectionQuote;
    const prompt = $("projectAiPrompt");
    if (!selection || !prompt) return;
    const source = String(selection.label || "Selected text").trim();
    const body = selection.text
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");
    const quote = `> **${source.replace(/[\r\n]+/g, " ")}**\n${body}`;
    const existing = prompt.value.trimEnd();
    prompt.value = existing ? `${existing}\n\n${quote}\n\n` : `${quote}\n\n`;
    hideProjectAiSelectionQuote();
    if (projectWorkspaceMode !== "ai") {
      setProjectWorkspaceMode("ai", { focusPrompt: true });
    }
    window.setTimeout(() => {
      prompt.focus({ preventScroll: true });
      prompt.setSelectionRange(prompt.value.length, prompt.value.length);
    }, projectWorkspaceMode === "ai" ? 0 : PROJECT_WORKSPACE_SWITCH_MS);
  }

  function showCodeMirrorSelectionQuote(codeMirror, label) {
    const text = codeMirror?.getSelection?.() || "";
    if (!text.trim()) {
      hideProjectAiSelectionQuote();
      return;
    }
    const from = codeMirror.getCursor("from");
    const to = codeMirror.getCursor("to");
    const coords = codeMirror.cursorCoords(to, "window");
    showProjectAiSelectionQuote(
      {
        text,
        label: typeof label === "function" ? label() : label,
        from: codeMirror.indexFromPos(from),
        to: codeMirror.indexFromPos(to),
      },
      {
        left: coords.left,
        bottom: coords.bottom,
        width: Math.max(0, coords.right - coords.left),
      }
    );
  }

  function bindCodeMirrorQuoteSurface(codeMirror, label) {
    const wrapper = codeMirror?.getWrapperElement?.();
    if (!wrapper || wrapper.dataset.aiQuoteBound === "true") return;
    wrapper.dataset.aiQuoteBound = "true";
    const show = () =>
      window.setTimeout(() => showCodeMirrorSelectionQuote(codeMirror, label), 0);
    const showFocusedSelection = () => {
      if (
        typeof codeMirror.hasFocus !== "function" ||
        codeMirror.hasFocus()
      ) {
        show();
      }
    };
    wrapper.addEventListener("mouseup", show);
    codeMirror.on?.("cursorActivity", showFocusedSelection);
    wrapper.addEventListener("keyup", (event) => {
      if (
        event.shiftKey ||
        ((event.ctrlKey || event.metaKey) &&
          String(event.key || "").toLowerCase() === "a") ||
        ["Shift", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
          event.key
        )
      ) {
        showFocusedSelection();
      }
    });
  }

  function showDomSelectionQuote(container, label) {
    const selection = window.getSelection?.();
    if (!selection || selection.isCollapsed || !selection.rangeCount) {
      hideProjectAiSelectionQuote();
      return;
    }
    const range = selection.getRangeAt(0);
    if (!container.contains(range.commonAncestorContainer)) return;
    const commonElement =
      range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
        ? range.commonAncestorContainer
        : range.commonAncestorContainer.parentElement;
    const article = commonElement?.closest?.(".project-ai-message") || null;
    const sourceLabel =
      typeof label === "function" ? label(article) : String(label || "");
    showProjectAiSelectionQuote(
      { text: selection.toString(), label: sourceLabel },
      range.getBoundingClientRect()
    );
  }

  function showProjectAiHistorySelectionQuote(history) {
    if (!history) return;
    showDomSelectionQuote(history, (article) => {
      const found = findProjectAiMessage(article?.dataset.messageId || "");
      return found?.message.role === "user"
        ? "Chat — your message"
        : "Chat — AI response";
    });
  }

  function closeProjectAiChatsMenu({ restoreFocus = false } = {}) {
    const menu = $("projectAiChatsMenu");
    const trigger = $("projectAiChatsBtn");
    if (!menu || !trigger) return;
    menu.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    if (restoreFocus) trigger.focus({ preventScroll: true });
  }

  function openProjectAiChatsMenu() {
    const menu = $("projectAiChatsMenu");
    const trigger = $("projectAiChatsBtn");
    if (!menu || !trigger || projectAiRequestInFlight) return;
    renderProjectAiChatList();
    menu.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    requestAnimationFrame(() => {
      menu
        .querySelector('[role="menuitem"][aria-current="true"]')
        ?.focus({ preventScroll: true });
    });
  }

  function toggleProjectAiChatsMenu() {
    const menu = $("projectAiChatsMenu");
    if (!menu) return;
    if (menu.hidden) openProjectAiChatsMenu();
    else closeProjectAiChatsMenu();
  }

  function getProjectAiChatAction(target) {
    const rename = target?.closest?.("[data-rename-chat-id]");
    if (rename) {
      return { type: "rename", chatId: rename.dataset.renameChatId || "" };
    }
    const select = target?.closest?.("[data-chat-id]");
    if (select) {
      return { type: "select", chatId: select.dataset.chatId || "" };
    }
    const remove = target?.closest?.("[data-delete-chat-id]");
    if (remove) {
      return { type: "delete", chatId: remove.dataset.deleteChatId || "" };
    }
    return null;
  }

  function runProjectAiChatAction(action) {
    if (!action?.chatId) return;
    if (action.type === "rename") {
      beginProjectAiChatRename(action.chatId);
    } else if (action.type === "select") {
      selectProjectAiChat(action.chatId);
    } else if (action.type === "delete") {
      void deleteProjectAiChat(action.chatId);
    }
  }

  function flushProjectAiChatRenameRender() {
    if (
      !projectAiChatRenameRenderPending ||
      projectAiPendingChatPointerAction
    ) {
      return;
    }
    projectAiChatRenameRenderPending = false;
    if (!projectAiChatRenameId) renderProjectAiChatList();
  }

  function renderProjectAiChatList() {
    const list = $("projectAiChatList");
    if (!list) return;
    list.replaceChildren();
    const sortedChats = [...projectAiChats.chats].sort(
      (left, right) => right.updatedAt - left.updatedAt
    );
    for (const chat of sortedChats) {
      const row = document.createElement("div");
      row.className = "project-ai-chat-list-item";
      row.classList.toggle("is-active", chat.id === projectAiChats.activeChatId);

      const select = document.createElement("button");
      select.type = "button";
      select.className = "project-ai-chat-select";
      select.dataset.chatId = chat.id;
      select.setAttribute("role", "menuitem");
      select.setAttribute(
        "aria-current",
        String(chat.id === projectAiChats.activeChatId)
      );
      select.textContent = chat.title || "New chat";
      select.title = select.textContent;

      const rename = document.createElement("button");
      rename.type = "button";
      rename.className = "project-ai-chat-rename";
      rename.dataset.renameChatId = chat.id;
      rename.setAttribute("role", "menuitem");
      rename.setAttribute("aria-label", `Rename chat ${select.textContent}`);
      rename.textContent = "Rename";

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "project-ai-chat-delete";
      remove.dataset.deleteChatId = chat.id;
      remove.setAttribute("role", "menuitem");
      remove.setAttribute("aria-label", `Delete chat ${select.textContent}`);
      remove.textContent = "×";

      if (projectAiChatRenameId === chat.id) {
        const input = document.createElement("input");
        input.className = "project-ai-chat-rename-input";
        input.value = chat.title || "New chat";
        input.maxLength = PROJECT_AI_CHAT_TITLE_LENGTH;
        input.setAttribute("aria-label", "Chat name");
        let renameCommitted = false;
        const saveRename = ({ deferRender = false } = {}) => {
          if (renameCommitted) return;
          const title = input.value.replace(/\s+/g, " ").trim();
          if (!title) {
            input.focus();
            return;
          }
          renameCommitted = true;
          chat.title = title.slice(0, PROJECT_AI_CHAT_TITLE_LENGTH);
          chat.titleSource = "manual";
          chat.titleLocked = true;
          chat.updatedAt = Date.now();
          projectAiChatRenameId = "";
          persistProjectAiChats({ renderList: !deferRender });
          if (deferRender) {
            projectAiChatRenameRenderPending = true;
            flushProjectAiChatRenameRender();
          }
        };
        input.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            saveRename();
          } else if (event.key === "Escape") {
            event.preventDefault();
            projectAiChatRenameId = "";
            renderProjectAiChatList();
          }
        });
        input.addEventListener("blur", () => saveRename({ deferRender: true }));
        row.append(input, rename, remove);
        window.requestAnimationFrame(() => {
          input.focus({ preventScroll: true });
          input.select();
        });
      } else {
        row.append(select, rename, remove);
      }
      list.appendChild(row);
    }
  }

  function beginProjectAiChatRename(chatId) {
    if (projectAiRequestInFlight) return;
    const chat = projectAiChats.chats.find(
      (candidate) => candidate.id === String(chatId || "")
    );
    if (!chat) return;
    projectAiChatRenameId = chat.id;
    renderProjectAiChatList();
  }

  function selectProjectAiChat(chatId) {
    if (projectAiRequestInFlight) return;
    const chat = projectAiChats.chats.find((candidate) => candidate.id === chatId);
    if (!chat) return;
    projectAiChatRenameId = "";
    projectAiChats.activeChatId = chat.id;
    projectAiConversation = chat.messages;
    persistProjectAiChats();
    renderProjectAiHistory();
    closeProjectAiChatsMenu();
    $("projectAiPrompt")?.focus({ preventScroll: true });
  }

  function createProjectAiChat() {
    if (projectAiRequestInFlight) return;
    if (projectAiChats.chats.length >= PROJECT_AI_MAX_CHATS) {
      closeProjectAiChatsMenu();
      appendProjectAiMessage(
        "system",
        `The chat limit of ${PROJECT_AI_MAX_CHATS} has been reached. Delete an older chat first.`
      );
      return;
    }
    const chat = createEmptyProjectAiChat();
    projectAiChatRenameId = "";
    projectAiChats.chats.push(chat);
    projectAiChats.activeChatId = chat.id;
    projectAiConversation = chat.messages;
    persistProjectAiChats();
    renderProjectAiHistory();
    closeProjectAiChatsMenu();
    $("projectAiPrompt")?.focus({ preventScroll: true });
  }

  async function deleteProjectAiChat(chatId) {
    if (projectAiRequestInFlight) return;
    const chat = projectAiChats.chats.find((candidate) => candidate.id === chatId);
    if (!chat) return;
    closeProjectAiChatsMenu();
    const confirmed = await showSiteConfirm({
      title: "Delete chat",
      message: `Delete “${chat.title || "New chat"}”? This removes its saved account copy too.`,
      confirmText: "Delete chat",
      cancelText: "Cancel",
      danger: true,
    });
    if (!confirmed) return;
    projectAiChats.chats = projectAiChats.chats.filter(
      (candidate) => candidate.id !== chatId
    );
    if (!projectAiChats.chats.length) {
      projectAiChats.chats.push(createEmptyProjectAiChat());
    }
    if (!projectAiChats.chats.some((candidate) => candidate.id === projectAiChats.activeChatId)) {
      projectAiChats.activeChatId = projectAiChats.chats[0].id;
    }
    projectAiConversation = getActiveProjectAiChat().messages;
    persistProjectAiChats();
    renderProjectAiHistory();
  }

  function readStoredProjectAiAccountSync() {
    try {
      const parsed = JSON.parse(
        window.localStorage.getItem(STORAGE_PROJECT_AI_ACCOUNT_SYNC) || "null"
      );
      if (!parsed || parsed.schemaVersion !== 1 || !parsed.accountKey) {
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
      for (const kind of ["chats", "files", "instruction"]) {
        projectAiLocalDirty[kind] = stored?.dirty?.[kind] === true;
      }
    } catch {
      projectAiLocalDirty = {
        chats: true,
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
    if (!["chats", "files", "instruction"].includes(kind)) return;
    projectAiLocalDirty[kind] = dirty === true;
    persistProjectAiLocalDirtyState();
  }

  function restoreProjectAiAccountSyncState() {
    const stored = readStoredProjectAiAccountSync();
    if (!stored) return;
    projectAiAccountSync.accountKey = String(stored.accountKey || "");
    for (const kind of ["chats", "files", "instruction"]) {
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
    if (kind === "chats") return getProjectAiChatsSnapshot();
    if (kind === "files") return getProjectAiAccountFilesSnapshot();
    if (kind === "instruction") return getProjectInstructionSnapshot();
    throw new TypeError(`Unsupported account document: ${kind}`);
  }

  function projectAiAccountDocumentsMatch(kind, remoteData) {
    try {
      const localData = getProjectAiAccountDocumentSnapshot(kind);
      const normalizedRemote =
        kind === "chats"
          ? normalizeProjectAiChats(remoteData)
          : kind === "instruction"
            ? normalizeProjectInstructionDocument(remoteData)
            : normalizeProjectAiAccountFilesSnapshot(remoteData);
      return JSON.stringify(localData) === JSON.stringify(normalizedRemote);
    } catch {
      return false;
    }
  }

  function getEmptyProjectAiAccountDocument(kind) {
    if (kind === "chats") return normalizeProjectAiChats(null);
    if (kind === "files") {
      return {
        schemaVersion: 2,
        files: { "main.c": "" },
        authorship: {
          "main.c": createMarkdownAuthorship("", "human"),
        },
        fileGroups: {},
        miniProjects: {},
        current: "main.c",
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
    const storageKeyBase =
      kind === "files"
        ? STORAGE_PROJECT_AI_FILES_RECOVERY
        : kind === "instruction"
          ? STORAGE_PROJECT_AI_INSTRUCTION_RECOVERY
          : STORAGE_PROJECT_AI_CHATS_RECOVERY;
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
    ensureAtLeastOneFile();
    if (!current) current = Object.keys(files)[0] || null;
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
    renderOutliner();
    if (editor) {
      editor.setOption("readOnly", !current ? "nocursor" : false);
      editor.setOption("mode", getEditorModeForFile(current));
      editor.setValue(current ? files[current] || "" : "");
      editor.refresh();
      scheduleMarkdownLivePreview("editor");
    }
    updateEditorFileWatermark(current || "");
    refreshDocumentationPane();
    scheduleDocumentationMarkerRefresh();
    resetHexArtifact();
    updateCompilePanelState(true);
    return true;
  }

  function applyProjectAiAccountDocument(kind, data) {
    projectAiAccountWorkspaceApplying = true;
    try {
      if (kind === "chats") {
        const nextChats = normalizeProjectAiChats(data);
        try {
          window.localStorage.setItem(
            STORAGE_PROJECT_AI_CHATS,
            JSON.stringify(nextChats)
          );
        } catch (error) {
          console.warn("The cloud AI chats could not be saved locally:", error);
          return false;
        }
        projectAiChats = nextChats;
        projectAiConversation = getActiveProjectAiChat().messages;
        renderProjectAiChatList();
        renderProjectAiHistory();
      } else if (kind === "files") {
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
        if (projectInstructionSaveTimer) {
          window.clearTimeout(projectInstructionSaveTimer);
          projectInstructionSaveTimer = null;
        }
        projectInstructionStorageReadFailed = false;
        projectInstructionDocument = nextInstruction;
        setProjectInstructionEditorValue(projectInstructionDocument.markdown);
        scheduleProjectInstructionPreview();
        setProjectInstructionSaveState();
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
    if (!projectAiAccountSync.ready || projectAiAccountSync.conflicts[kind]) {
      return;
    }
    const timerName =
      kind === "chats"
        ? "projectAiChatsSaveTimer"
        : kind === "files"
          ? "projectAiAccountFilesSaveTimer"
          : "projectAiAccountInstructionSaveTimer";
    const currentTimer =
      kind === "chats"
        ? projectAiChatsSaveTimer
        : kind === "files"
          ? projectAiAccountFilesSaveTimer
          : projectAiAccountInstructionSaveTimer;
    if (currentTimer) window.clearTimeout(currentTimer);
    const timer = window.setTimeout(() => {
      if (kind === "chats") projectAiChatsSaveTimer = null;
      else if (kind === "files") projectAiAccountFilesSaveTimer = null;
      else projectAiAccountInstructionSaveTimer = null;
      void saveProjectAiAccountDocument(kind);
    }, delay);
    if (timerName === "projectAiChatsSaveTimer") projectAiChatsSaveTimer = timer;
    else if (timerName === "projectAiAccountFilesSaveTimer") {
      projectAiAccountFilesSaveTimer = timer;
    } else {
      projectAiAccountInstructionSaveTimer = timer;
    }
  }

  function markProjectAiAccountDocumentDirty(kind) {
    if (!["chats", "files", "instruction"].includes(kind)) return;
    projectAiAccountSync.dirty[kind] = true;
    projectAiAccountSync.mutations[kind] += 1;
    setProjectAiLocalDirty(kind, true);
    persistProjectAiAccountSyncState();
    scheduleProjectAiAccountDocumentSave(kind);
  }

  function getProjectAiAccountConflictMessage(kind) {
    if (kind === "chats") {
      return "Chats changed in another tab or device. The local copy was kept and cloud saving was paused to avoid overwriting it.";
    }
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
        appendProjectAiMessage(
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
        appendProjectAiMessage(
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
        appendProjectAiMessage(
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
      projectAiChatsSaveTimer,
      projectAiAccountFilesSaveTimer,
      projectAiAccountInstructionSaveTimer,
    ]) {
      if (timer) window.clearTimeout(timer);
    }
    projectAiChatsSaveTimer = null;
    projectAiAccountFilesSaveTimer = null;
    projectAiAccountInstructionSaveTimer = null;
    for (const kind of ["chats", "files", "instruction"]) {
      projectAiAccountSync.saving[kind] = false;
      projectAiAccountSync.retries[kind] = 0;
    }
  }

  function hasMeaningfulProjectAiLocalDocument(kind) {
    if (kind === "chats") {
      return getProjectAiChatsSnapshot().chats.some(
        (chat) => Array.isArray(chat.messages) && chat.messages.length > 0
      );
    }
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
      const snapshot = getProjectInstructionSnapshot();
      return (
        String(snapshot.markdown || "").trim().length > 0 ||
        (Array.isArray(snapshot.skillRefs) && snapshot.skillRefs.length > 0)
      );
    }
    return false;
  }

  function getProjectAiAccountDocumentLabel(kind) {
    if (kind === "chats") return "AI chats";
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
    appendProjectAiMessage("system", message);
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
    appendProjectAiMessage(
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
        for (const kind of ["chats", "files", "instruction"]) {
          projectAiAccountSync.revisions[kind] = 0;
          projectAiAccountSync.dirty[kind] = false;
          projectAiAccountSync.conflicts[kind] = true;
          projectAiAccountSync.retries[kind] = 0;
        }
        if (!persistProjectAiAccountSyncState()) {
          projectAiAccountSync.accountKey = String(stored?.accountKey || "");
          const message =
            "The Google account workspace was not opened because the browser could not safely record the account transition. Local data was not changed. Free some browser storage and reload.";
          appendProjectAiMessage("system", message);
          setProjectAiAccountStatus(message, "error");
          return null;
        }
      }

      const remoteDocuments = Object.fromEntries(
        ["chats", "files", "instruction"].map((kind) => [
          kind,
          normalizeProjectAiRemoteDocument(documents[kind]),
        ])
      );
      const missingImportCandidates = differentKnownAccount
        ? ["chats", "files", "instruction"].filter(
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

      for (const kind of ["chats", "files", "instruction"]) {
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
          appendProjectAiMessage(
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
      const pausedKinds = ["chats", "files", "instruction"].filter(
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
      for (const kind of ["chats", "files", "instruction"]) {
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
    const history = $("projectAiHistory");
    if (!history) return null;

    const article = document.createElement("article");
    article.className = "project-ai-message is-assistant is-thinking";
    article.dataset.aiTransient = "true";
    article.setAttribute("role", "status");

    const label = document.createElement("span");
    label.className = "project-ai-thinking-stage";
    label.textContent = "Analyzing the request";

    const dots = document.createElement("span");
    dots.className = "project-ai-thinking-dots";
    dots.setAttribute("aria-hidden", "true");
    dots.append(
      document.createElement("span"),
      document.createElement("span"),
      document.createElement("span")
    );

    const phases = [
      "Preparing the relevant project context",
      "Waiting for the model response",
    ];
    let phaseIndex = 0;
    article._phaseTimer = window.setInterval(() => {
      if (!article.isConnected || phaseIndex >= phases.length) {
        window.clearInterval(article._phaseTimer);
        article._phaseTimer = null;
        return;
      }
      label.textContent = phases[phaseIndex];
      phaseIndex += 1;
    }, 2400);

    article.append(label, dots);
    history.appendChild(article);
    history.scrollTop = history.scrollHeight;
    return article;
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
    const history = $("projectAiHistory");
    if (history) history.scrollTop = history.scrollHeight;
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

  function openProjectAiAccountModal() {
    const modal = $("projectAiAccountModal");
    const trigger = $("projectAiAccountBtn");
    const card = $("projectAiAccountCard");
    if (!modal || !trigger || !card) return;

    modal.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    requestAnimationFrame(() => {
      const signIn = $("projectAiSignInBtn");
      const focusTarget = signIn && !signIn.hidden ? signIn : card;
      focusTarget.focus({ preventScroll: true });
    });
  }

  function closeProjectAiAccountModal({ restoreFocus = true } = {}) {
    const modal = $("projectAiAccountModal");
    const trigger = $("projectAiAccountBtn");
    if (!modal || !trigger || modal.hidden) return;

    modal.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    if (restoreFocus) {
      requestAnimationFrame(() => {
        trigger.focus({ preventScroll: true });
      });
    }
  }

  function setProjectAiAccountStatus(message = "", tone = "info") {
    const status = $("projectAiAccountStatus");
    if (!status) return;
    const normalizedMessage = String(message || "").trim();
    status.textContent = normalizedMessage;
    status.dataset.tone = tone;
    status.hidden = !normalizedMessage;
  }

  function trapProjectAiAccountFocus(event) {
    const modal = $("projectAiAccountModal");
    const card = $("projectAiAccountCard");
    if (!modal || !card || modal.hidden || event.key !== "Tab") return false;

    const focusable = Array.from(
      modal.querySelectorAll(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    ).filter(
      (element) =>
        !element.closest("[hidden]") && element.getClientRects().length > 0
    );

    if (focusable.length === 0) {
      event.preventDefault();
      card.focus({ preventScroll: true });
      return true;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const activeElement = document.activeElement;
    if (
      event.shiftKey &&
      (activeElement === first || !focusable.includes(activeElement))
    ) {
      event.preventDefault();
      last.focus({ preventScroll: true });
      return true;
    }
    if (
      !event.shiftKey &&
      (activeElement === last || !focusable.includes(activeElement))
    ) {
      event.preventDefault();
      first.focus({ preventScroll: true });
      return true;
    }
    return false;
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

    auth.hidden = true;
    accountButton.classList.remove(
      "is-sign-in-required",
      "is-authenticated",
      "is-unavailable"
    );
    accountButton.setAttribute("aria-label", "Open AI account");
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
      if (unavailable) unavailable.hidden = false;
      return;
    }

    if (session.authenticated !== true) {
      accountButton.classList.add("is-sign-in-required");
      accountButton.setAttribute(
        "aria-label",
        "Open AI account: Google sign-in required"
      );
      signIn.hidden = false;
      return;
    }

    account.textContent =
      String(session.user?.emailMasked || "").trim() || "Google account";
    account.title = account.textContent;
    accountButton.classList.add("is-authenticated");
    accountButton.setAttribute(
      "aria-label",
      `Open AI account: ${account.textContent}`
    );
    const remaining = Number(session.quota?.remaining);
    renderProjectAiQuota(session.quota);
    if (Number.isFinite(remaining)) {
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
    if (accountBody) {
      accountBody.setAttribute("aria-busy", String(!!pending));
    }
    if (signIn) signIn.disabled = !!pending;
    if (signOut) signOut.disabled = !!pending;
  }

  async function fetchProjectAiAuthSession() {
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
          appendProjectAiMessage(
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
          appendProjectAiMessage("system", message);
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
    appendProjectAiMessage("system", message);
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
        appendProjectAiMessage("system", message);
        setProjectAiAccountStatus(message, "error");
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
      appendProjectAiMessage("system", message);
      setProjectAiAccountStatus(message, "error");
    } finally {
      setProjectAiAuthPending(false);
    }
  }

  async function handleProjectAiSignOut() {
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
        appendProjectAiMessage("system", message);
        setProjectAiAccountStatus(message, "error");
      }
    } catch (error) {
      const message = error?.message || "Could not sign out. Try again.";
      appendProjectAiMessage("system", message);
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
    const form = $("projectAiForm");
    const chatsButton = $("projectAiChatsBtn");
    if (chatsButton) chatsButton.disabled = !!busy;
    if (busy) closeProjectAiChatsMenu();
    if (!form) return;
    const prompt = $("projectAiPrompt");
    if (busy) {
      projectAiRestorePromptFocus = form.contains(document.activeElement);
    }
    for (const control of form.elements) {
      if (control === prompt) {
        control.readOnly = !!busy;
        control.setAttribute("aria-readonly", String(!!busy));
      } else {
        control.disabled = !!busy;
      }
    }
    form.setAttribute("aria-busy", String(!!busy));
    if (!busy) {
      const activeElement = document.activeElement;
      const shouldRestoreFocus =
        projectAiRestorePromptFocus &&
        (!activeElement ||
          activeElement === document.body ||
          form.contains(activeElement));
      projectAiRestorePromptFocus = false;
      if (shouldRestoreFocus) prompt?.focus({ preventScroll: true });
    }
  }

  function getProjectAiJsonByteLength(value) {
    try {
      return new TextEncoder().encode(JSON.stringify(value)).byteLength;
    } catch {
      return Number.POSITIVE_INFINITY;
    }
  }

  function selectProjectAiConversation(payload) {
    const selected = [];
    payload.conversation = selected;
    let end = projectAiConversation.length;

    while (end > 0) {
      let start = end - 1;
      if (
        projectAiConversation[start]?.role === "assistant" &&
        start > 0 &&
        projectAiConversation[start - 1]?.role === "user"
      ) {
        start -= 1;
      }
      const added = [];
      for (let index = start; index < end; index += 1) {
        const message = projectAiConversation[index];
        added.push({
          role: message.role,
          content: message.content,
        });
      }
      selected.unshift(...added);
      if (
        getProjectAiJsonByteLength(payload) >
        PROJECT_AI_REQUEST_TARGET_BYTES
      ) {
        selected.splice(0, added.length);
        break;
      }
      end = start;
    }

    return selected;
  }

  function getProjectAiRequestPayload(prompt) {
    const mcuSelect = $("mcuSelect");
    const localeSelect = $("documentationLocaleSelect");
    const linkedProject = getMiniProjectForFile(current);
    const publicProject = linkedProject
      ? getPublicMiniProjectInstance(linkedProject.instanceId)
      : null;
    const documentation = getDocumentationContext(current);
    const sourceEntry = publicProject?.files?.find(
      (file) => file.role === miniProjectCore.ROLES.SOURCE
    );
    const guideEntry = publicProject?.files?.find(
      (file) =>
        file.role === miniProjectCore.ROLES.GUIDE &&
        file.name === documentation.guideFile
    );
    const currentProject = publicProject
      ? {
          instanceId: String(publicProject.instanceId || ""),
          id: String(publicProject.id || ""),
          title: String(publicProject.title || ""),
          displayName: String(
            publicProject.displayName || publicProject.title || ""
          ),
          sourceName: String(sourceEntry?.name || ""),
          guideName: String(guideEntry?.name || documentation.guideFile || ""),
          guideLocale: String(
            guideEntry?.locale || publicProject.selectedLocale || ""
          ),
          source: sourceEntry?.name
            ? getLiveFileContent(sourceEntry.name)
            : "",
          sourceAuthorship: sourceEntry?.name
            ? getFileAuthorship(sourceEntry.name)
            : null,
          guide:
            documentation.guideFile && hasFile(documentation.guideFile)
              ? getLiveFileContent(documentation.guideFile)
              : "",
          guideAuthorship:
            documentation.guideFile && hasFile(documentation.guideFile)
              ? getFileAuthorship(documentation.guideFile)
              : null,
          aiSpecRef:
            typeof publicProject.aiSpecRef?.id === "string" &&
            publicProject.aiSpecRef.id.trim()
              ? { id: publicProject.aiSpecRef.id.trim() }
              : null,
        }
      : null;
    const selectedMcu = String(mcuSelect?.value || "auto");
    const updiBridge =
      window[AVR_UPDI_BRIDGE_KEY] || window[LEGACY_UPDI_BRIDGE_KEY] || null;
    const detectedMcu =
      selectedMcu === "auto" &&
      typeof updiBridge?.getDetectedTargetKey === "function"
        ? String(updiBridge.getDetectedTargetKey() || "").trim()
        : "";
    const payload = {
      prompt: String(prompt || "").trim(),
      mcu: selectedMcu,
      ...(detectedMcu ? { detectedMcu } : {}),
      locale: String(
        localeSelect?.value ||
          publicProject?.selectedLocale ||
          document.documentElement.lang ||
          navigator.language ||
          "en"
      ),
      conversation: [],
      instructionDocument: getProjectInstructionSnapshot({ forRequest: true }),
    };
    if (currentProject?.instanceId) {
      payload.currentProject = currentProject;
    }
    selectProjectAiConversation(payload);
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
    const unchanged =
      snapshot &&
      linkedProject?.instanceId === snapshot.instanceId &&
      liveProject?.selectedLocale === snapshot.guideLocale &&
      liveSource?.name === snapshot.sourceName &&
      liveGuide?.name === snapshot.guideName &&
      getLiveFileContent(snapshot.sourceName) === snapshot.source &&
      getLiveFileContent(snapshot.guideName) === snapshot.guide;
    if (unchanged) return;

    throw new Error(
      /[\u0400-\u04ff]/u.test(String(requestPayload?.prompt || ""))
        ? "Текущий мини-проект изменился, пока ИИ готовил ответ. Новые локальные правки не были перезаписаны. Отправьте запрос ещё раз."
        : "The current mini-project changed while the AI was responding. Newer local edits were not overwritten. Submit the request again."
    );
  }

  function assertProjectAiInstructionIsFresh(requestPayload) {
    const expectedRevision = Number(
      requestPayload?.instructionDocument?.revision
    );
    if (
      Number.isSafeInteger(expectedRevision) &&
      expectedRevision === projectInstructionDocument.revision
    ) {
      return expectedRevision;
    }
    throw new Error(
      /[\u0400-\u04ff]/u.test(String(requestPayload?.prompt || ""))
        ? "Инструкция изменилась, пока ИИ готовил ответ. Ваши более новые правки сохранены. Отправьте запрос ещё раз."
        : "The instruction changed while the AI was responding. Your newer edits were preserved. Submit the request again."
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
          }
          return file;
        })
      : [];
    const displayName = String(
      project.displayName || project.name || project.id || "AI mini-project"
    ).trim();

    const definition = {
      schemaVersion: Number(project.schemaVersion) || 1,
      id: String(project.id || project.name || "ai-mini-project").trim(),
      title: displayName,
      displayName,
      summary: String(project.summary || ""),
      version: project.version ?? 1,
      files,
      defaultLocale:
        files.find((file) => file.role === miniProjectCore.ROLES.GUIDE)
          ?.locale || "en",
    };
    if (
      project.aiSpecRef &&
      typeof project.aiSpecRef === "object" &&
      !Array.isArray(project.aiSpecRef)
    ) {
      definition.aiSpecRef = cloneJsonMetadata(project.aiSpecRef, null);
    }
    return definition;
  }

  function appendExistingProjectAiUserMessage(rawMessage) {
    const message = normalizeProjectAiMessage(rawMessage);
    if (!message || message.role !== "user") {
      throw new TypeError("The edited user message is invalid.");
    }
    const chat = getActiveProjectAiChat();
    chat.messages.push(message);
    chat.updatedAt = Math.max(Date.now(), message.editedAt || message.createdAt);
    projectAiConversation = chat.messages;
    persistProjectAiChats();
    renderProjectAiHistory();
    return message;
  }

  async function submitProjectAiRequest(
    rawRequest,
    { existingUserMessage = null, clearPromptOnSuccess = true } = {}
  ) {
    if (projectAiRequestInFlight) return false;
    const prompt = $("projectAiPrompt");
    const request = String(rawRequest || "").trim();
    if (!request) {
      prompt?.focus({ preventScroll: true });
      return false;
    }

    const requestPayload = getProjectAiRequestPayload(request);
    if (existingUserMessage) {
      appendExistingProjectAiUserMessage(existingUserMessage);
    } else {
      appendProjectAiMessage("user", request);
    }
    let thinkingIndicator = appendProjectAiThinking();
    let quotaUpdatedFromResponse = false;
    setProjectAiFormBusy(true);

    try {
      const response = await fetch("/api/avr/ai/respond", {
        method: "POST",
        headers: {
          Accept: "application/x-ndjson, application/json",
          "Content-Type": "application/json",
        },
        credentials: "same-origin",
        body: JSON.stringify(requestPayload),
      });
      const apiResponse = await readProjectAiApiResponse(response, (progress) =>
        renderProjectAiThinkingProgress(thinkingIndicator, progress)
      );
      const data = apiResponse.data;
      const responseStatus = apiResponse.status;
      if (data?.quota) {
        updateProjectAiQuota(data.quota);
        quotaUpdatedFromResponse = true;
      }
      if (data?.progress) {
        renderProjectAiThinkingProgress(
          thinkingIndicator,
          data.progress,
          data.verification
        );
        if (!apiResponse.streamed) {
          await new Promise((resolve) => window.setTimeout(resolve, 700));
        }
      }
      removeProjectAiThinking(thinkingIndicator);
      thinkingIndicator = null;

      if (responseStatus < 200 || responseStatus >= 300 || data?.ok !== true) {
        const errorCode = String(data?.code || data?.error?.code || "");
        const apiKeyMissing =
          errorCode === "api_key_not_configured" ||
          (responseStatus === 503 &&
            /api key is not configured/i.test(String(data?.message || "")));
        if (
          errorCode === "free_quota_exhausted" &&
          responseStatus === 429 &&
          projectAiAuthSession?.quota
        ) {
          updateProjectAiQuota({
            ...projectAiAuthSession.quota,
            remaining: 0,
          });
          quotaUpdatedFromResponse = true;
        }
        const message =
          errorCode === "google_sign_in_required" && responseStatus === 401
            ? "Sign in with Google to use Uart Debug AI."
            : errorCode === "free_quota_exhausted" && responseStatus === 429
              ? "The free AI Credits for this browser installation are exhausted. More access is not available yet."
              : apiKeyMissing
                ? "API key is not configured"
                : String(
                    data?.error?.message ||
                      data?.error ||
                      data?.message ||
                      `AI request failed (${responseStatus}).`
                  );
        appendProjectAiMessage("system", message);
        return;
      }

      applyProjectAiChatTitle(data.chatTitle);

      if (data.kind === "answer") {
        const answer = String(data.message || "").trim();
        if (!answer) {
          throw new Error("The AI response did not include an answer.");
        }
        appendProjectAiMessage("assistant", answer);
        if (clearPromptOnSuccess && prompt) prompt.value = "";
        return;
      }

      if (data.kind === "instruction") {
        const expectedRevision = assertProjectAiInstructionIsFresh(
          requestPayload
        );
        const responseInstruction =
          data.instructionDocument &&
          typeof data.instructionDocument === "object"
            ? data.instructionDocument
            : {};
        const baseRevision =
          data.baseRevision ?? responseInstruction.baseRevision;
        const schemaVersion = responseInstruction.schemaVersion;
        const responseRevision = responseInstruction.revision;
        if (
          !Number.isSafeInteger(baseRevision) ||
          baseRevision !== expectedRevision ||
          schemaVersion !== 1 ||
          !Number.isSafeInteger(responseRevision) ||
          responseRevision !== baseRevision + 1
        ) {
          throw new Error(
            "The AI returned an incompatible instruction revision. Nothing was overwritten."
          );
        }
        const revisedMarkdown =
          responseInstruction.markdown ?? data.instructionMarkdown;
        if (typeof revisedMarkdown !== "string") {
          throw new Error(
            "The AI response did not include a Markdown instruction."
          );
        }
        if (!revisedMarkdown.trim()) {
          throw new Error(
            "The AI response did not include the revised instruction."
          );
        }
        applyProjectInstructionMarkdown(revisedMarkdown, {
          skillRefs: projectAiSkillsLoaded
            ? responseInstruction.skillRefs
            : undefined,
          expectedRevision,
        });
        const instructionMessage =
          String(data.message || "").trim() ||
          "I revised the Markdown instruction. Review it before asking me to create or update the project.";
        appendProjectAiMessage("assistant", instructionMessage);
        if (clearPromptOnSuccess && prompt) prompt.value = "";
        return;
      }

      if (data.kind !== "project" && !data.project) {
        throw new Error(
          "The AI response did not include an answer, instruction, or project."
        );
      }
      assertProjectAiInstructionIsFresh(requestPayload);
      const definition = normalizeGeneratedAiProject(data.project);
      const operation = String(data.operation || "");
      let savedProject = null;
      if (operation === "update") {
        const expectedTarget = String(
          requestPayload.currentProject?.instanceId || ""
        );
        const responseTarget = String(data.targetInstanceId || "");
        if (!expectedTarget || responseTarget !== expectedTarget) {
          throw new Error(
            "The AI response did not match the current mini-project. Nothing was changed."
          );
        }
        assertProjectAiUpdateIsFresh(requestPayload);
        savedProject = await window.UartDebugAvrMiniProjects.updateInstance(
          expectedTarget,
          definition,
          { origin: "ai" }
        );
      } else if (operation === "create") {
        savedProject = await window.UartDebugAvrMiniProjects.install(
          definition,
          {
            origin: "ai",
          }
        );
      } else {
        throw new Error("The AI response did not specify a project action.");
      }
      const projectMessage =
        String(data.message || "").trim() ||
        (operation === "update"
          ? "The current source and guide were updated in their local editable copies."
          : "The generated source and guide were installed as local editable copies.");
      appendProjectAiMessage(
        "assistant",
        projectMessage,
        savedProject?.displayName || definition.displayName
      );
      if (clearPromptOnSuccess && prompt) prompt.value = "";
    } catch (error) {
      removeProjectAiThinking(thinkingIndicator);
      thinkingIndicator = null;
      const message = error?.message || "The AI request could not be completed.";
      appendProjectAiMessage("system", message);
    } finally {
      removeProjectAiThinking(thinkingIndicator);
      setProjectAiFormBusy(false);
      if (
        projectAiAuthSession?.mode === "google" &&
        !quotaUpdatedFromResponse
      ) {
        void fetchProjectAiAuthSession().catch(() => {});
      }
    }
  }

  function handleProjectAiSubmit(event) {
    event.preventDefault();
    const prompt = $("projectAiPrompt");
    void submitProjectAiRequest(prompt?.value || "");
  }

  function renderProjectWorkspaceToggleLabel(label, words) {
    if (!label) return;
    const fragment = document.createDocumentFragment();
    for (const word of words) {
      const wordElement = document.createElement("span");
      wordElement.className = "project-ai-toggle-label-word";
      for (const character of word) {
        const characterElement = document.createElement("span");
        characterElement.textContent = character;
        wordElement.appendChild(characterElement);
      }
      fragment.appendChild(wordElement);
    }
    label.replaceChildren(fragment);
  }

  function setProjectWorkspaceMode(mode, { focusPrompt = false } = {}) {
    const aiMode = mode === "ai";
    const nextMode = aiMode ? "ai" : "avr";
    if (!aiMode) {
      closeProjectAiAccountModal({ restoreFocus: false });
    }
    const stage = $("projectWorkspaceStage");
    const avrScene = $("avrWorkspaceScene");
    const aiScene = $("projectAiScene");
    const toggle = $("projectAiToggle");
    const toggleLabel = toggle?.querySelector(".project-ai-toggle-label");
    if (!stage || !avrScene || !aiScene || !toggle) return;
    if (
      stage.classList.contains("is-switching") ||
      stage.classList.contains("is-toggle-departing") ||
      stage.classList.contains("is-toggle-hidden")
    ) {
      return;
    }

    const shouldAnimate = projectWorkspaceMode !== nextMode;
    const reducedMotion = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)"
    )?.matches;
    const compactWorkspace = window.matchMedia?.("(max-width: 1040px)")
      ?.matches;
    const animateTransition =
      shouldAnimate && !reducedMotion && !compactWorkspace;

    const outgoingScene = aiMode ? avrScene : aiScene;
    if (outgoingScene.contains(document.activeElement)) {
      toggle.focus({ preventScroll: true });
    }

    const applyMode = () => {
      projectWorkspaceMode = nextMode;
      stage.dataset.mode = nextMode;
      avrScene.setAttribute("aria-hidden", String(aiMode));
      aiScene.setAttribute("aria-hidden", String(!aiMode));
      if (aiMode) {
        avrScene.setAttribute("inert", "");
        aiScene.removeAttribute("inert");
      } else {
        aiScene.setAttribute("inert", "");
        avrScene.removeAttribute("inert");
      }
      toggle.setAttribute("aria-pressed", String(aiMode));
      toggle.setAttribute(
        "aria-label",
        aiMode ? "Return to AVR workspace" : "Open AI assistant workspace"
      );
      renderProjectWorkspaceToggleLabel(
        toggleLabel,
        aiMode ? ["AVR", "WORKSPACE"] : ["AI", "ASSISTANT"]
      );
    };

    const finishTransition = () => {
      toggle.disabled = false;
      editor?.refresh();
      projectInstructionEditor?.refresh();
      scheduleProjectInstructionPreview();
      fitEditorFileWatermark();
      if (aiMode && focusPrompt) {
        $("projectAiPrompt")?.focus({ preventScroll: true });
      }
    };

    if (animateTransition) {
      toggle.disabled = true;
      stage.classList.add("is-toggle-departing");
      void stage.offsetWidth;
      projectWorkspaceToggleExitTimer = window.setTimeout(() => {
        projectWorkspaceToggleExitTimer = null;
        stage.classList.add("is-toggle-hidden");
        stage.classList.remove("is-toggle-departing");
        applyMode();
        stage.classList.add("is-switching");
        void stage.offsetWidth;

        projectWorkspaceTransitionTimer = window.setTimeout(() => {
          projectWorkspaceTransitionTimer = null;
          stage.classList.remove("is-switching");
          void stage.offsetWidth;
          stage.classList.remove("is-toggle-hidden");
          projectWorkspaceToggleEnterTimer = window.setTimeout(() => {
            projectWorkspaceToggleEnterTimer = null;
            finishTransition();
          }, PROJECT_WORKSPACE_TOGGLE_ENTER_MS);
        }, PROJECT_WORKSPACE_SWITCH_MS);
      }, PROJECT_WORKSPACE_TOGGLE_EXIT_MS);
    } else {
      applyMode();
      window.setTimeout(finishTransition, 0);
    }

    if (aiMode) {
      void fetchProjectAiAuthSession().catch(() => {
        projectAiAuthSession = null;
        renderProjectAiAuthSession(null);
      });
    }
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
    applyOutlinerWidth(outlinerPreferredWidth, {
      persist: false,
      remember: false,
    });
    applyDocumentationWidth(documentationPreferredWidth, {
      persist: false,
      remember: false,
    });
    applyProjectAiWidths(
      projectAiChatPreferredWidth,
      projectAiSkillsPreferredWidth,
      { persist: false, remember: false }
    );
    syncSplitResizerAria();
    editor?.refresh();
    projectInstructionEditor?.refresh();
    fitEditorFileWatermark();
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
    viewport.setAttribute("aria-hidden", String(collapsed));
    if (collapsed) viewport.setAttribute("inert", "");
    else viewport.removeAttribute("inert");
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
    const section = $("avrDeviceSection");
    const handle = $("devicePanelToggle");
    if (!section || !handle) return;

    const finishResize = (event) => {
      if (!devicePanelResizeState) return;
      const resizeState = devicePanelResizeState;
      devicePanelResizeState = null;
      try {
        if (handle.hasPointerCapture?.(resizeState.pointerId)) {
          handle.releasePointerCapture(resizeState.pointerId);
        }
      } catch {}
      section.classList.remove("is-device-panel-resizing");
      document.body.classList.remove("is-device-panel-resizing");
      setDevicePanelState(devicePanelState, {
        persist: true,
        animate: false,
      });
      refreshWorkspaceAfterDevicePanelResize();
      event?.preventDefault?.();
    };

    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      devicePanelResizeState = {
        pointerId: event.pointerId,
        anchorY: event.clientY,
      };
      handle.setPointerCapture?.(event.pointerId);
      section.classList.add("is-device-panel-resizing");
      document.body.classList.add("is-device-panel-resizing");
    });

    handle.addEventListener("pointermove", (event) => {
      if (
        !devicePanelResizeState ||
        devicePanelResizeState.pointerId !== event.pointerId
      ) {
        return;
      }
      event.preventDefault();
      const delta = event.clientY - devicePanelResizeState.anchorY;
      const requestedSteps = Math.floor(
        Math.abs(delta) / DEVICE_PANEL_DRAG_THRESHOLD
      );
      if (requestedSteps < 1) return;

      const direction = delta < 0 ? -1 : 1;
      let nextState = devicePanelState;
      let appliedSteps = 0;
      while (appliedSteps < requestedSteps) {
        const adjacentState = getAdjacentDevicePanelState(
          nextState,
          direction
        );
        if (adjacentState === nextState) break;
        nextState = adjacentState;
        appliedSteps += 1;
      }

      if (appliedSteps === 0) {
        devicePanelResizeState.anchorY = event.clientY;
        return;
      }

      if (appliedSteps < requestedSteps) {
        devicePanelResizeState.anchorY = event.clientY;
      } else {
        devicePanelResizeState.anchorY +=
          direction * DEVICE_PANEL_DRAG_THRESHOLD * appliedSteps;
      }
      setDevicePanelState(nextState, { persist: false, animate: false });
      refreshWorkspaceAfterDevicePanelResize();
    });

    handle.addEventListener("pointerup", finishResize);
    handle.addEventListener("pointercancel", finishResize);
    handle.addEventListener("lostpointercapture", (event) => {
      if (devicePanelResizeState?.pointerId === event.pointerId) {
        finishResize(event);
      }
    });
    handle.addEventListener("keydown", (event) => {
      const states = ["collapsed", "compact", "expanded"];
      let index = states.indexOf(devicePanelState);
      if (event.key === "ArrowUp") index = Math.max(0, index - 1);
      else if (event.key === "ArrowDown") {
        index = Math.min(states.length - 1, index + 1);
      } else if (event.key === "Home") index = 0;
      else if (event.key === "End") index = states.length - 1;
      else return;
      event.preventDefault();
      setDevicePanelState(states[index]);
    });
  }

  function showDocumentationEmpty(title, message) {
    const content = $("projectDocumentationContent");
    if (!content) return;
    documentationHeadingIndex = new Map();
    content.replaceChildren();

    const empty = document.createElement("div");
    empty.className = "project-documentation-empty";
    const strong = document.createElement("strong");
    strong.textContent = title;
    const copy = document.createElement("p");
    copy.textContent = message;
    empty.append(strong, copy);
    content.appendChild(empty);
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

    window.requestAnimationFrame(() => {
      applyDocumentationWidth(documentationPreferredWidth, {
        persist: false,
        remember: false,
      });
    });
  }

  function saveDocumentationEditorValue({ persistNow = false } = {}) {
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
      gutters: ["markdown-authorship-gutter"],
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
    input.setAttribute("aria-label", "Project guide Markdown");
    input.setAttribute("aria-multiline", "true");
    input.setAttribute("data-tooltip-disabled", "");
    input.setAttribute("role", "textbox");
    input.setAttribute("spellcheck", "true");
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
    bindCodeMirrorQuoteSurface(documentationEditor, () => {
      const guideFile = editorElement.dataset.guideFile || "Project guide";
      return `Project guide — ${guideFile}`;
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
    const previousScrollTop = documentationEditor?.getScrollInfo?.().top || 0;
    const guideFile = context.guideFile;

    if (previousGuide && previousGuide !== guideFile) {
      saveDocumentationEditorValue({ persistNow: true });
    }
    pane.dataset.guideFile = guideFile;
    markdownEditor.dataset.guideFile = guideFile;
    setDocumentationNotice();
    refreshDocumentationControls(context);

    if (!guideFile || !hasFile(guideFile)) {
      content.hidden = false;
      documentationEditor?.getWrapperElement?.().setAttribute("hidden", "");
      markdownEditor.hidden = true;
      showDocumentationEmpty(
        "Guide file is not connected yet",
        "When a mini-project includes a human-readable .md file, it will appear here automatically."
      );
      scroll.scrollTop = 0;
      return;
    }

    const markdown = getLiveFileContent(guideFile);
    indexDocumentationMarkdownHeadings(markdown);
    content.hidden = true;
    markdownEditor.hidden = false;
    const wrapper = documentationEditor?.getWrapperElement?.();
    wrapper?.removeAttribute("hidden");
    setDocumentationEditorValue(markdown);
    documentationEditor?.setOption("readOnly", false);
    documentationEditor?.refresh();
    scheduleMarkdownLivePreview("documentation");
    documentationEditor?.scrollTo(
      null,
      preserveScroll && previousGuide === guideFile ? previousScrollTop : 0
    );
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
    if (projectWorkspaceMode === "ai") {
      setProjectWorkspaceMode("avr");
    }
    const context = getDocumentationContext(current);
    if (!context.guideFile || !hasFile(context.guideFile)) {
      setDocumentationNotice("This source file has no linked guide yet.");
      return false;
    }

    const pane = $("projectDocumentationPane");
    if (pane?.dataset.guideFile !== context.guideFile) refreshDocumentationPane();

    const headingKey = miniProjectCore.normalizeHeadingKey(marker.title);
    let target = documentationHeadingIndex.get(`${marker.level}:${headingKey}`);
    if (!target) {
      indexDocumentationMarkdownHeadings(
        getLiveFileContent(context.guideFile)
      );
      target = documentationHeadingIndex.get(`${marker.level}:${headingKey}`);
    }
    if (!target) {
      setDocumentationNotice(`Section not found: ${marker.title}`);
      return false;
    }

    setDocumentationNotice();
    if (!documentationEditor) return false;
    const targetPosition = CodeMirror.Pos(target.line, target.ch || 0);
    documentationEditor.scrollIntoView(
      { from: targetPosition, to: targetPosition },
      48
    );
    documentationEditor.setCursor(targetPosition);
    documentationEditor.focus();
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
    if (!hasFile(name)) return;
    if (editor && current && current !== name && hasFile(current)) {
      files[current] = editor.getValue();
    }

    current = name;
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

  function newCanvas() {
    startInlineCreate();
  }

  function renameFile(oldName) {
    startInlineRename(oldName);
  }

  function applyFileRename(oldName, newName) {
    if (!hasFile(oldName)) return;
    if (oldName === newName) {
      renderOutliner();
      return;
    }

    renameFileKey(oldName, newName);
    renameMiniProjectFile(oldName, newName);
    if (hexArtifactsBySource.has(oldName)) {
      hexArtifactsBySource.set(newName, hexArtifactsBySource.get(oldName));
      hexArtifactsBySource.delete(oldName);
    }
    for (const group of Object.values(fileGroups)) {
      group.files = (group.files || []).map((fileName) =>
        fileName === oldName ? newName : fileName
      );
    }
    const renamedCurrent = current === oldName;
    if (renamedCurrent) current = newName;
    persistState();
    renderOutliner();
    refreshDocumentationPane({ preserveScroll: true });
    scheduleDocumentationMarkerRefresh();
    if (renamedCurrent) {
      if (editor) {
        editor.setOption("mode", getEditorModeForFile(newName));
      }
      updateEditorFileWatermark(newName);
      resetHexArtifact();
      updateCompilePanelState(true);
    }
  }

  function applyGroupRename(oldName, newName) {
    if (!hasGroup(oldName)) return;
    if (oldName === newName) {
      renderOutliner();
      return;
    }

    renameGroupKey(oldName, newName);
    persistState();
    renderOutliner();
  }

  async function deleteGroup(groupName) {
    if (!hasGroup(groupName)) return;

    const childGroups = getGroupChildGroups(groupName);
    const parentGroupName = getGroupParent(groupName);
    const confirmed = await showSiteConfirm({
      title: "Delete group",
      message: `Delete group "${groupName}"? Files inside it will stay in Files.`,
      confirmText: "Delete group",
      cancelText: "Cancel",
      danger: true,
    });
    if (!confirmed) return;

    removeGroupFromParents(groupName);
    if (parentGroupName && hasGroup(parentGroupName)) {
      const parentGroup = fileGroups[parentGroupName];
      parentGroup.groups = [
        ...(parentGroup.groups || []).filter((name) => name !== groupName),
        ...childGroups.filter((name) => name !== parentGroupName),
      ];
      parentGroup.expanded = true;
    }

    delete fileGroups[groupName];
    persistState();
    renderOutliner();
    refreshDocumentationPane({ preserveScroll: true });
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
      title: deleteWholeProject ? "Delete mini-project" : "Delete file",
      message: deleteWholeProject
        ? `Delete mini-project "${displayName}" and its local source and guide copies? This cannot be undone.`
        : `Delete "${name}"? This cannot be undone.`,
      confirmText: deleteWholeProject ? "Delete mini-project" : "Delete",
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
    const blob = new Blob([files[name]], { type: "text/x-c" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  }

  function downloadCurrent() {
    if (!current || !hasFile(current)) return;
    const blob = new Blob([files[current]], { type: "text/x-c" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = current;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
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
      gutters: ["CodeMirror-linenumbers", "markdown-authorship-gutter"],
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
    bindCodeMirrorQuoteSurface(editor, () => `Editor — ${current || "file"}`);
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

  function getSelectDisplayText(select) {
    if (!select) return "";
    const selected = select.selectedOptions && select.selectedOptions[0];
    return selected ? selected.textContent.trim() : "";
  }

  function updateCustomSelectIntrinsicWidth(custom) {
    const label = custom?.querySelector(".custom-select-value");
    if (!custom || !label) return;
    custom.style.removeProperty("--custom-select-width");
    const textWidth = Math.ceil(label.scrollWidth);
    custom.style.setProperty(
      "--custom-select-width",
      `${Math.max(72, textWidth + 58)}px`
    );
  }

  function renderCustomSelectOptions(select, custom) {
    const list = custom.querySelector(".custom-select-list");
    const label = custom.querySelector(".custom-select-value");
    if (!list || !label) return;

    list.innerHTML = "";
    label.textContent = getSelectDisplayText(select) || "Select MCU";
    updateCustomSelectIntrinsicWidth(custom);

    const addOption = (option) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "custom-select-option";
      item.dataset.value = option.value;
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", String(option.value === select.value));
      item.textContent = option.textContent.trim();

      item.addEventListener("click", (event) => {
        event.stopPropagation();
        if (select.value !== option.value) {
          select.value = option.value;
          select.dispatchEvent(new Event("change", { bubbles: true }));
        } else {
          updateCustomSelect(select, custom);
        }
        closeCustomSelect(custom);
      });

      list.appendChild(item);
    };

    for (const child of Array.from(select.children)) {
      if (child.tagName === "OPTGROUP") {
        const group = document.createElement("div");
        group.className = "custom-select-group";

        const groupLabel = document.createElement("div");
        groupLabel.className = "custom-select-group-label";
        groupLabel.textContent = child.label || "";
        group.appendChild(groupLabel);
        list.appendChild(group);

        for (const option of Array.from(child.children)) {
          addOption(option);
        }
      } else if (child.tagName === "OPTION") {
        addOption(child);
      }
    }
  }

  function updateCustomSelect(select, custom) {
    if (!select || !custom) return;
    const trigger = custom.querySelector(".custom-select-trigger");
    if (trigger) trigger.disabled = !!select.disabled;
    custom.classList.toggle("is-disabled", !!select.disabled);
    custom.setAttribute("aria-disabled", String(!!select.disabled));
    renderCustomSelectOptions(select, custom);
    if (select.disabled) closeCustomSelect(custom);
  }

  function closeCustomSelect(custom) {
    if (!custom) return;
    custom.classList.remove("is-open");
    const trigger = custom.querySelector(".custom-select-trigger");
    if (trigger) trigger.setAttribute("aria-expanded", "false");
  }

  function openCustomSelect(select, custom) {
    if (!select || !custom || select.disabled) return;
    updateCustomSelect(select, custom);
    custom.classList.add("is-open");
    const trigger = custom.querySelector(".custom-select-trigger");
    if (trigger) trigger.setAttribute("aria-expanded", "true");

    requestAnimationFrame(() => {
      const active = custom.querySelector('.custom-select-option[aria-selected="true"]');
      active && active.scrollIntoView({ block: "nearest" });
    });
  }

  function initCustomSelect(select) {
    if (!select || select.dataset.customized === "true") return;

    select.dataset.customized = "true";
    select.classList.add("native-select-hidden");
    select.tabIndex = -1;
    select.setAttribute("aria-hidden", "true");

    const custom = document.createElement("div");
    custom.className = "custom-select";
    custom.setAttribute("aria-hidden", "false");

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "custom-select-trigger";
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", "false");
    const accessibleLabel =
      select.getAttribute("aria-label") ||
      select.labels?.[0]?.textContent?.trim() ||
      "Select option";
    trigger.setAttribute("aria-label", accessibleLabel);

    const value = document.createElement("span");
    value.className = "custom-select-value";
    trigger.appendChild(value);

    const menu = document.createElement("div");
    menu.className = "custom-select-menu";

    const list = document.createElement("div");
    list.className = "custom-select-list";
    list.setAttribute("role", "listbox");
    if (select.id) {
      list.id = `${select.id}CustomListbox`;
      trigger.setAttribute("aria-controls", list.id);
    }
    menu.appendChild(list);

    custom.appendChild(trigger);
    custom.appendChild(menu);
    select.insertAdjacentElement("afterend", custom);

    trigger.addEventListener("click", (event) => {
      event.stopPropagation();
      if (custom.classList.contains("is-open")) {
        closeCustomSelect(custom);
      } else {
        openCustomSelect(select, custom);
      }
    });

    trigger.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openCustomSelect(select, custom);
      }
    });

    custom.addEventListener("click", (event) => event.stopPropagation());
    select.addEventListener("change", () => updateCustomSelect(select, custom));

    const observer = new MutationObserver(() => updateCustomSelect(select, custom));
    observer.observe(select, {
      attributes: true,
      childList: true,
      subtree: true,
      attributeFilter: ["disabled", "label", "selected", "value"],
    });

    document.addEventListener("click", () => closeCustomSelect(custom));
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeCustomSelect(custom);
    });

    updateCustomSelect(select, custom);
  }

  function bindUI() {
      const newBtn = $("newBtn");
      const renameBtn = $("renameBtn");
      const deleteBtn = $("deleteBtn");
      const downloadBtn = $("downloadBtn");
      const compileBtn = $("compileBtn");
      const programHexBtn = $("programHexBtn");
      const moreOptionsBtn = $("moreOptionsBtn");
      const detectChipBtn = $("detectChipBtn");
      const fileContextMenu = $("fileContextMenu");
      const fileUploadInput = $("fileUploadInput");
      const fileAddModal = $("fileAddModal");
      const fileAddCloseBtn = $("fileAddCloseBtn");
      const uploadExistingFileCard = $("uploadExistingFileCard");
      const createNewGroupCard = $("createNewGroupCard");
      const fileTemplateGrid = $("fileTemplateGrid");
      const siteDialog = $("siteDialog");
      const siteDialogCloseBtn = $("siteDialogCloseBtn");
      const siteDialogCancelBtn = $("siteDialogCancelBtn");
      const siteDialogConfirmBtn = $("siteDialogConfirmBtn");
      const updiOptionsModal = $("canvasUpdiSection");
      const updiOptionsCloseBtn = $("updiOptionsCloseBtn");
      const mcuSelect = $("mcuSelect");
      const documentationLocaleSelect = $("documentationLocaleSelect");
      const projectAiToggle = $("projectAiToggle");
      const projectAiForm = $("projectAiForm");
      const projectAiPrompt = $("projectAiPrompt");
      const projectAiHistory = $("projectAiHistory");
      const projectAiChatsBtn = $("projectAiChatsBtn");
      const projectAiChatsMenu = $("projectAiChatsMenu");
      const projectAiNewChatBtn = $("projectAiNewChatBtn");
      const projectAiChatList = $("projectAiChatList");
      const projectAiAccountBtn = $("projectAiAccountBtn");
      const projectAiAccountModal = $("projectAiAccountModal");
      const projectAiAccountCloseBtn = $("projectAiAccountCloseBtn");
      const projectAiSignInBtn = $("projectAiSignInBtn");
      const projectAiSignOutBtn = $("projectAiSignOutBtn");

    initCustomSelect(mcuSelect);
    initCustomSelect(documentationLocaleSelect);
    bindOutlinerDropZone();
    bindFileListResizer();
    bindDocumentationResizer();
    bindProjectAiResizers();
    bindDevicePanelResizer();
    bindProjectInstructionWorkspace();
    bindDocumentationWorkspace();
    bindWorkspaceResizeObserver();
    newBtn && newBtn.addEventListener("click", startInlineCreate);
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
      moreOptionsBtn && moreOptionsBtn.addEventListener("click", toggleMoreOptions);
    updiOptionsCloseBtn &&
      updiOptionsCloseBtn.addEventListener("click", closeMoreOptions);
    updiOptionsModal &&
      updiOptionsModal.addEventListener("click", (event) => {
        if (event.target === updiOptionsModal) {
          closeMoreOptions();
        }
      });
    fileAddCloseBtn && fileAddCloseBtn.addEventListener("click", closeAddFileModal);
    createNewGroupCard &&
      createNewGroupCard.addEventListener("click", () => {
        closeAddFileModal();
        startInlineCreateGroup();
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

        saveDocumentationEditorValue({ persistNow: true });
        project.selectedLocale = locale;
        project.files.guide = guide.fileName;
        project.mediaTypes.guide = guide.mediaType || "text/markdown";
        persistState();
        refreshDocumentationPane();
      });
    projectAiToggle &&
      projectAiToggle.addEventListener("click", () => {
        setProjectWorkspaceMode(
          projectWorkspaceMode === "ai" ? "avr" : "ai",
          { focusPrompt: projectWorkspaceMode !== "ai" }
        );
      });
    projectAiForm &&
      projectAiForm.addEventListener("submit", handleProjectAiSubmit);
    projectAiChatsBtn &&
      projectAiChatsBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        toggleProjectAiChatsMenu();
      });
    projectAiChatsMenu &&
      projectAiChatsMenu.addEventListener("click", (event) => {
        event.stopPropagation();
      });
    projectAiNewChatBtn &&
      projectAiNewChatBtn.addEventListener("click", createProjectAiChat);
    projectAiChatList &&
      projectAiChatList.addEventListener("pointerdown", (event) => {
        projectAiPendingChatPointerAction = getProjectAiChatAction(event.target);
      });
    projectAiChatList &&
      projectAiChatList.addEventListener("pointercancel", () => {
        projectAiPendingChatPointerAction = null;
        flushProjectAiChatRenameRender();
      });
    projectAiChatList &&
      projectAiChatList.addEventListener("click", (event) => {
        const action =
          projectAiPendingChatPointerAction ||
          getProjectAiChatAction(event.target);
        projectAiPendingChatPointerAction = null;
        runProjectAiChatAction(action);
        flushProjectAiChatRenameRender();
      });
    projectAiHistory &&
      projectAiHistory.addEventListener("click", (event) => {
        const copy = event.target.closest("[data-copy-message-id]");
        if (copy) {
          void copyProjectAiMessage(copy.dataset.copyMessageId || "", copy);
          return;
        }
        const edit = event.target.closest("[data-edit-message-id]");
        if (edit) beginProjectAiMessageEdit(edit.dataset.editMessageId || "");
      });
    projectAiHistory &&
      projectAiHistory.addEventListener("mouseup", () =>
        window.setTimeout(
          () => showProjectAiHistorySelectionQuote(projectAiHistory),
          0
        )
      );
    projectAiHistory &&
      document.addEventListener("selectionchange", () => {
        const selection = window.getSelection?.();
        const anchorNode = selection?.anchorNode || null;
        const focusNode = selection?.focusNode || null;
        if (
          (anchorNode && projectAiHistory.contains(anchorNode)) ||
          (focusNode && projectAiHistory.contains(focusNode))
        ) {
          window.setTimeout(
            () => showProjectAiHistorySelectionQuote(projectAiHistory),
            0
          );
        }
      });
    projectAiAccountBtn &&
      projectAiAccountBtn.addEventListener("click", openProjectAiAccountModal);
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
    projectAiPrompt &&
      projectAiPrompt.addEventListener("keydown", (event) => {
        if (
          event.key !== "Enter" ||
          event.shiftKey ||
          event.isComposing ||
          projectAiRequestInFlight
        ) {
          return;
        }
        event.preventDefault();
        projectAiForm?.requestSubmit();
      });
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
      if (!e.target.closest?.(".project-ai-chats")) {
        closeProjectAiChatsMenu();
      }
      const menu = $("fileContextMenu");
      if (!menu || menu.style.display !== "block") return;
      if (menu.contains(e.target) || e.target.closest(".file-menu-btn")) {
        return;
      }
      closeFileContextMenu();
    });
    document.addEventListener("pointerdown", (event) => {
      if (event.target.closest?.("#projectAiSelectionQuoteBtn")) return;
      if (!event.target.closest?.(".CodeMirror, #projectAiHistory")) {
        hideProjectAiSelectionQuote();
      }
    });
    document.addEventListener("pointerup", () => {
      window.setTimeout(() => {
        projectAiPendingChatPointerAction = null;
        flushProjectAiChatRenameRender();
      }, 0);
    });

    // Close context menu on Escape
    document.addEventListener("keydown", (e) => {
      if (trapProjectAiAccountFocus(e)) return;
      if (e.key === "Escape") {
        if (projectAiChatsMenu && !projectAiChatsMenu.hidden) {
          closeProjectAiChatsMenu({ restoreFocus: true });
          return;
        }
        if (projectAiAccountModal && !projectAiAccountModal.hidden) {
          closeProjectAiAccountModal();
          return;
        }
        if (siteDialog && !siteDialog.hidden) {
          resolveSiteDialog(false);
          return;
        }
        if (updiOptionsModal && !updiOptionsModal.hidden) {
          closeMoreOptions();
          return;
        }
        if (inlineFileEdit) {
          cancelInlineFileEdit();
          return;
        }
        closeFileContextMenu();
        closeAddFileModal();
      }
    });

    window.addEventListener("beforeunload", () => {
      persistProjectInstruction({ immediate: true });
      saveDocumentationEditorValue({ persistNow: true });
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
    restoreProjectAiChats();
    restoreProjectAiLocalDirtyState();
    restoreProjectAiAccountSyncState();
    restoreProjectInstruction();
    const projectAiAuthReturn = consumeProjectAiAuthReturn();
    ensureAtLeastOneFile();
    restoreDocumentationWidth();
    restoreOutlinerWidth();
    restoreProjectAiWidths();
    applyOutlinerWidth(outlinerPreferredWidth, {
      persist: false,
      remember: false,
    });
    applyDocumentationWidth(documentationPreferredWidth, {
      persist: false,
      remember: false,
    });
    renderOutliner();
    if (!current) current = Object.keys(files)[0];
    initUpdiBridge();

    setMoreOptionsExpanded(false);
    restoreDevicePanelState();
    bindUI();
    renderProjectAiHistory();
    renderProjectAiChatList();
    void renderBuiltInMiniProjectCards();
    void fetchProjectAiSkills();
    setProjectWorkspaceMode(projectAiAuthReturn ? "ai" : "avr", {
      focusPrompt: !!projectAiAuthReturn,
    });
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
    void fetchProjectAiAuthSession().catch(() => {});
  }

  initMiniProjectBridge();
  document.addEventListener("DOMContentLoaded", boot);
})();
