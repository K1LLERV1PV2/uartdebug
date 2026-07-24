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
  const OUTLINER_MAX_WIDTH = 460;
  const OUTLINER_EDITOR_MIN_WIDTH = 440;
  const DOCUMENTATION_DEFAULT_WIDTH = 360;
  const DOCUMENTATION_MIN_WIDTH = 240;
  const DOCUMENTATION_MAX_WIDTH = 1600;
  const SPLIT_RESIZER_TOTAL_WIDTH = 28;
  const MINI_PROJECT_IMPORT_EVENT = "ud-avr-mini-project";
  const MINI_PROJECT_INSTALLED_EVENT = "ud-avr-mini-project-installed";
  const MINI_PROJECT_READY_EVENT = "ud-avr-mini-projects-ready";
  const PROJECT_AI_ACCESS_STORAGE_KEY = "ud.avr.ai.ownerAccess";
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
  let documentationEditMode = false;
  let documentationEditSaveTimer = null;
  let projectPaneMode = "documentation";
  let projectAiGenerationInFlight = false;
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

    return {
      schemaVersion: 1,
      id: descriptor.id,
      displayName: descriptor.displayName || descriptor.title || descriptor.id,
      title: descriptor.title || descriptor.displayName || descriptor.id,
      summary: descriptor.summary || "",
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
        fileGroups = JSON.parse(localStorage.getItem(STORAGE_GROUPS) || "{}");
        current =
          localStorage.getItem(STORAGE_CURRENT) ??
          localStorage.getItem(LEGACY_STORAGE_CURRENT) ??
          null;
      } catch {
        files = Object.create(null);
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

    for (const name of Object.keys(files)) {
      nextFiles[name === oldName ? newName : name] = files[name];
    }

    files = nextFiles;
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
    return isCFileName(fileName) ? "text/x-csrc" : "text/plain";
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
    const previousGroups = fileGroups;
    const previousProjects = miniProjects;
    const previousCurrent = current;
    let selectionStarted = false;

    if (editor && previousCurrent && hasFile(previousCurrent)) {
      previousFiles[previousCurrent] = editor.getValue();
    }

    files = createDictionary(files);
    fileGroups = createDictionary(fileGroups);
    miniProjects = createDictionary(miniProjects);

    try {
      for (const projectFile of pendingFiles) {
        files[projectFile.name] = projectFile.content;
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
    return window.matchMedia?.("(max-width: 940px)")?.matches || false;
  }

  function getOutlinerMaxWidth() {
    const container = getCanvasSplitContainer();
    if (!container) return OUTLINER_MAX_WIDTH;
    if (isStackedCanvasLayout()) return OUTLINER_MAX_WIDTH;

    const rect = container.getBoundingClientRect();
    const available =
      rect.width -
      OUTLINER_EDITOR_MIN_WIDTH -
      documentationWidth -
      SPLIT_RESIZER_TOTAL_WIDTH;
    return Math.max(
      OUTLINER_MIN_EXPANDED_WIDTH,
      Math.min(OUTLINER_MAX_WIDTH, available)
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

  function getDocumentationMaxWidth() {
    const container = getCanvasSplitContainer();
    if (!container || isStackedCanvasLayout()) return DOCUMENTATION_MAX_WIDTH;

    const rect = container.getBoundingClientRect();
    const availableDocumentationWidth =
      rect.width -
      outlinerWidth -
      OUTLINER_EDITOR_MIN_WIDTH -
      SPLIT_RESIZER_TOTAL_WIDTH;
    return Math.max(
      DOCUMENTATION_MIN_WIDTH,
      Math.min(DOCUMENTATION_MAX_WIDTH, availableDocumentationWidth)
    );
  }

  function normalizeOutlinerPreference(width) {
    const numeric = Number(width);
    if (!Number.isFinite(numeric)) return OUTLINER_DEFAULT_WIDTH;
    if (numeric <= OUTLINER_COMPACT_THRESHOLD) return OUTLINER_COMPACT_WIDTH;
    return Math.max(
      OUTLINER_MIN_EXPANDED_WIDTH,
      Math.min(OUTLINER_MAX_WIDTH, numeric)
    );
  }

  function normalizeDocumentationWidth(width) {
    const numeric = Number(width);
    if (!Number.isFinite(numeric)) return DOCUMENTATION_DEFAULT_WIDTH;
    return Math.max(
      DOCUMENTATION_MIN_WIDTH,
      Math.min(getDocumentationMaxWidth(), numeric)
    );
  }

  function normalizeDocumentationPreference(width) {
    const numeric = Number(width);
    if (!Number.isFinite(numeric)) return DOCUMENTATION_DEFAULT_WIDTH;
    return Math.max(
      DOCUMENTATION_MIN_WIDTH,
      Math.min(DOCUMENTATION_MAX_WIDTH, numeric)
    );
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
        String(DOCUMENTATION_MIN_WIDTH)
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
        nextWidth = DOCUMENTATION_MIN_WIDTH;
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

  function bindWorkspaceResizeObserver() {
    const container = getCanvasSplitContainer();
    if (!container) return;

    const scheduleResize = () => {
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
        syncSplitResizerAria();
        fitEditorFileWatermark();
      });
    };

    if (typeof ResizeObserver === "function") {
      workspaceResizeObserver = new ResizeObserver(scheduleResize);
      workspaceResizeObserver.observe(container);
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

  function isSafeDocumentationUrl(url) {
    const value = String(url || "").trim();
    if (!value) return false;
    if (value.startsWith("#") || value.startsWith("/") || value.startsWith("./")) {
      return true;
    }
    try {
      const parsed = new URL(value, window.location.href);
      return ["http:", "https:", "mailto:"].includes(parsed.protocol);
    } catch {
      return false;
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

  function appendMarkdownInline(parent, rawText, context = null) {
    const text = String(rawText || "");
    const tokenPattern =
      /(!\[([^\]\n]*)\]\(([^)\n]+)\)|`[^`\n]+`|\[([^\]\n]+)\]\(([^)\n]+)\))/g;
    let cursor = 0;
    let match;

    while ((match = tokenPattern.exec(text))) {
      if (match.index > cursor) {
        parent.appendChild(document.createTextNode(text.slice(cursor, match.index)));
      }

      if (match[0].startsWith("![")) {
        const alt = match[2] || "";
        const src = resolveDocumentationImageUrl(match[3], context);
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
      } else {
        const label = match[4];
        const href = String(match[5] || "").trim().replace(/^<|>$/g, "");
        if (isSafeDocumentationUrl(href)) {
          const link = document.createElement("a");
          link.textContent = label;
          link.href = href;
          if (/^https?:/i.test(href)) {
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

  function renderMarkdownGuide(markdown, context = null) {
    const content = $("projectDocumentationContent");
    if (!content) return;

    content.replaceChildren();
    documentationHeadingIndex = new Map();

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
      appendMarkdownInline(paragraph, paragraphLines.join(" ").trim(), context);
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
      appendMarkdownInline(heading, headingText, context);
      const headingKey = miniProjectCore.normalizeHeadingKey(headingText);
      const indexKey = `${level}:${headingKey}`;
      heading.dataset.documentationHeading = indexKey;
      heading.tabIndex = -1;
      if (headingKey && !documentationHeadingIndex.has(indexKey)) {
        documentationHeadingIndex.set(indexKey, heading);
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
        appendMarkdownInline(item, (orderedMatch || unorderedMatch)[1], context);
        activeList.appendChild(item);
        continue;
      }

      const quoteMatch = line.match(/^\s*>\s?(.*)$/);
      if (quoteMatch) {
        flushParagraph();
        flushList();
        const quote = document.createElement("blockquote");
        appendMarkdownInline(quote, quoteMatch[1], context);
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

  function setProjectAiStatus(message, state = "offline") {
    const status = $("projectAiStatus");
    if (!status) return;
    status.dataset.state = state;
    const label = status.querySelector(".project-ai-status-label");
    if (label) label.textContent = String(message || "");
  }

  function readProjectAiAccessToken() {
    const input = $("projectAiAccessToken");
    const entered = input?.value?.trim() || "";
    if (entered) {
      try {
        window.sessionStorage.setItem(PROJECT_AI_ACCESS_STORAGE_KEY, entered);
      } catch {}
      return entered;
    }
    try {
      const stored =
        window.sessionStorage.getItem(PROJECT_AI_ACCESS_STORAGE_KEY)?.trim() ||
        "";
      if (input && stored) input.value = stored;
      return stored;
    } catch {
      return "";
    }
  }

  function appendProjectAiMessage(kind, message, title = "") {
    const history = $("projectAiHistory");
    if (!history) return null;

    const article = document.createElement("article");
    article.className = `project-ai-message is-${kind}`;
    article.dataset.aiTransient = "true";

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

    const paragraph = document.createElement("p");
    paragraph.textContent = String(message || "");
    article.appendChild(paragraph);
    history.appendChild(article);
    history.scrollTop = history.scrollHeight;
    return article;
  }

  function clearProjectAiHistory() {
    $("projectAiHistory")
      ?.querySelectorAll("[data-ai-transient]")
      .forEach((message) => message.remove());
    setProjectAiStatus("Checking API", "busy");
    refreshProjectAiApiStatus();
    $("projectAiPrompt")?.focus({ preventScroll: true });
  }

  function setProjectAiFormBusy(busy) {
    projectAiGenerationInFlight = !!busy;
    const form = $("projectAiForm");
    if (!form) return;
    for (const control of form.elements) {
      control.disabled = !!busy;
    }
    const clearButton = $("projectAiClearBtn");
    if (clearButton) clearButton.disabled = !!busy;
    form.setAttribute("aria-busy", String(!!busy));
  }

  function getProjectAiRequestPayload(prompt) {
    const mcuSelect = $("mcuSelect");
    const localeSelect = $("documentationLocaleSelect");
    const linkedProject = getMiniProjectForFile(current);
    const publicProject = linkedProject
      ? getPublicMiniProjectInstance(linkedProject.instanceId)
      : null;
    const documentation = getDocumentationContext(current);
    const currentProject = {
      id: String(publicProject?.id || ""),
      title: String(
        publicProject?.displayName ||
          publicProject?.title ||
          (current ? getOutlinerFileLabel(current) : "")
      ),
      source:
        current && isCFileName(current) ? getLiveFileContent(current) : "",
      guide:
        documentation.guideFile && hasFile(documentation.guideFile)
          ? getLiveFileContent(documentation.guideFile)
          : "",
      aiSpecRef:
        typeof publicProject?.aiSpecRef?.id === "string" &&
        publicProject.aiSpecRef.id.trim()
          ? { id: publicProject.aiSpecRef.id.trim() }
          : null,
    };
    const payload = {
      prompt: String(prompt || "").trim(),
      mcu: String(mcuSelect?.value || "auto"),
      locale: String(
        localeSelect?.value ||
          publicProject?.selectedLocale ||
          document.documentElement.lang ||
          navigator.language ||
          "en"
      ),
    };
    if (
      currentProject.id ||
      currentProject.title ||
      currentProject.source ||
      currentProject.guide
    ) {
      payload.currentProject = currentProject;
    }
    return payload;
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

  async function refreshProjectAiApiStatus() {
    if (projectAiGenerationInFlight) return;
    setProjectAiStatus("Checking API", "busy");

    try {
      const response = await fetch("/api/avr/ai/status", {
        method: "GET",
        headers: { Accept: "application/json" },
        credentials: "same-origin",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.ok !== true) {
        setProjectAiStatus(
          response.status === 503
            ? "API key is not configured"
            : "AI server unavailable",
          response.status === 503 ? "offline" : "error"
        );
        return;
      }
      if (!data.configured) {
        setProjectAiStatus("API key is not configured", "offline");
        return;
      }
      if (!data.accessConfigured) {
        setProjectAiStatus("Owner access is not configured", "error");
        return;
      }
      if (!data.enabled) {
        setProjectAiStatus("AI API is disabled", "offline");
        return;
      }
      if (data.ready === false) {
        setProjectAiStatus("AI rules are unavailable", "error");
        return;
      }

      const rulesLabel =
        data.rules?.packageId || data.rules?.projectVersion || "";
      if (!readProjectAiAccessToken()) {
        setProjectAiStatus("Owner access code required", "offline");
      } else {
        setProjectAiStatus(
          rulesLabel ? `AI ready · rules ${rulesLabel}` : "AI ready",
          "ready"
        );
      }
    } catch {
      setProjectAiStatus("AI server unavailable", "error");
    }
  }

  async function handleProjectAiSubmit(event) {
    event.preventDefault();
    if (projectAiGenerationInFlight) return;

    const prompt = $("projectAiPrompt");
    const request = prompt?.value?.trim() || "";
    if (!request) {
      prompt?.focus({ preventScroll: true });
      return;
    }

    appendProjectAiMessage("user", request);
    setProjectAiFormBusy(true);
    setProjectAiStatus("Generating project", "busy");

    try {
      const accessToken = readProjectAiAccessToken();
      const response = await fetch("/api/avr/ai/generate", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...(accessToken
            ? { "X-UartDebug-AI-Token": accessToken }
            : {}),
        },
        credentials: "same-origin",
        body: JSON.stringify(getProjectAiRequestPayload(request)),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok || data?.ok !== true) {
        const apiKeyMissing =
          data?.code === "api_key_not_configured" ||
          (response.status === 503 &&
            /api key is not configured/i.test(String(data?.message || "")));
        const message =
          response.status === 401
            ? "Owner access code is required or incorrect"
            : apiKeyMissing
            ? "API key is not configured"
            : String(
                data?.error?.message ||
                  data?.error ||
                  data?.message ||
                  `AI request failed (${response.status}).`
              );
        appendProjectAiMessage("system", message);
        setProjectAiStatus(
          message,
          response.status === 401 || response.status === 503
            ? "offline"
            : "error"
        );
        if (response.status === 401) {
          $("projectAiAccessToken")?.focus({ preventScroll: true });
        }
        return;
      }

      const definition = normalizeGeneratedAiProject(data.project);
      const installed = await window.UartDebugAvrMiniProjects.install(definition, {
        origin: "ai",
      });
      appendProjectAiMessage(
        "assistant",
        "The generated source and human guide were installed as local editable copies. Compile and review the draft before flashing it. Use the logo button to return to the guide.",
        installed?.displayName || definition.displayName
      );
      setProjectAiStatus("Draft installed", "ready");
      if (prompt) prompt.value = "";
    } catch (error) {
      const message = error?.message || "The AI request could not be completed.";
      appendProjectAiMessage("system", message);
      setProjectAiStatus("Generation failed", "error");
    } finally {
      setProjectAiFormBusy(false);
    }
  }

  function setProjectPaneMode(mode, { focusPrompt = false } = {}) {
    const aiMode = mode === "ai";
    const pane = $("projectDocumentationPane");
    const documentationView = $("projectDocumentationView");
    const aiWorkspace = $("projectAiWorkspace");
    const toggle = $("projectAiToggle");
    const localeControl = pane?.querySelector(".documentation-locale-control");
    const editToggle = $("documentationEditToggle");
    if (!documentationView || !aiWorkspace || !toggle) return;

    projectPaneMode = aiMode ? "ai" : "documentation";
    documentationView.hidden = aiMode;
    aiWorkspace.hidden = !aiMode;
    if (localeControl) localeControl.hidden = aiMode;
    if (editToggle) editToggle.hidden = aiMode;
    pane.dataset.view = projectPaneMode;
    toggle.setAttribute("aria-pressed", String(aiMode));
    toggle.setAttribute(
      "aria-label",
      aiMode ? "Return to project guide" : "Open AI project assistant"
    );

    if (aiMode) {
      refreshProjectAiApiStatus();
      if (focusPrompt) {
        window.requestAnimationFrame(() => {
          const accessToken = readProjectAiAccessToken();
          (accessToken
            ? $("projectAiPrompt")
            : $("projectAiAccessToken")
          )?.focus({ preventScroll: true });
        });
      }
    }
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
      const canEdit = !!project && !!guideFile && guideFile !== current;
      editToggle.disabled = !canEdit;
      editToggle.textContent = documentationEditMode ? "Preview" : "Edit";
      editToggle.setAttribute("aria-pressed", String(documentationEditMode));
    }
  }

  function saveDocumentationEditorValue({ persistNow = false } = {}) {
    const markdownEditor = $("projectDocumentationEditor");
    const guideFile = markdownEditor?.dataset.guideFile || "";
    if (!markdownEditor || !guideFile || !hasFile(guideFile)) return;

    files[guideFile] = markdownEditor.value;
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

  function setDocumentationEditMode(editing) {
    const context = getDocumentationContext(current);
    const nextMode =
      !!editing &&
      !!context.linkedProject?.project &&
      !!context.guideFile &&
      context.guideFile !== current;
    if (documentationEditMode && !nextMode) {
      saveDocumentationEditorValue({ persistNow: true });
    }
    documentationEditMode = nextMode;
    refreshDocumentationPane({ preserveScroll: !nextMode });
    if (nextMode) {
      window.requestAnimationFrame(() => $("projectDocumentationEditor")?.focus());
    }
  }

  function refreshDocumentationPane({ preserveScroll = false } = {}) {
    const pane = $("projectDocumentationPane");
    const scroll = $("projectDocumentationScroll");
    const content = $("projectDocumentationContent");
    const markdownEditor = $("projectDocumentationEditor");
    if (!pane || !scroll || !content || !markdownEditor) return;

    const context = getDocumentationContext(current);
    const previousGuide = pane.dataset.guideFile || "";
    const previousScrollTop = scroll.scrollTop;
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
      content.hidden = false;
      markdownEditor.hidden = true;
      scroll.classList.remove("is-editing");
      showDocumentationEmpty(
        "Guide file is not connected yet",
        "When a mini-project includes a human-readable .md file, it will appear here automatically."
      );
      scroll.scrollTop = 0;
      return;
    }

    const markdown = getLiveFileContent(guideFile);
    if (documentationEditMode) {
      content.hidden = true;
      markdownEditor.hidden = false;
      scroll.classList.add("is-editing");
      if (markdownEditor.value !== markdown) markdownEditor.value = markdown;
      scroll.scrollTop = 0;
      return;
    }

    content.hidden = false;
    markdownEditor.hidden = true;
    scroll.classList.remove("is-editing");
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
    if (projectPaneMode === "ai") {
      setProjectPaneMode("documentation");
    }
    const context = getDocumentationContext(current);
    if (!context.guideFile || !hasFile(context.guideFile)) {
      setDocumentationNotice("This source file has no linked guide yet.");
      return false;
    }

    if (documentationEditMode) {
      saveDocumentationEditorValue({ persistNow: true });
      documentationEditMode = false;
      refreshDocumentationPane();
    }

    const pane = $("projectDocumentationPane");
    if (pane?.dataset.guideFile !== context.guideFile) refreshDocumentationPane();

    const headingKey = miniProjectCore.normalizeHeadingKey(marker.title);
    const target = documentationHeadingIndex.get(`${marker.level}:${headingKey}`);
    if (!target) {
      setDocumentationNotice(`Section not found: ${marker.title}`);
      return false;
    }

    setDocumentationNotice();
    document
      .querySelectorAll(".is-documentation-target")
      .forEach((element) => element.classList.remove("is-documentation-target"));
    target.classList.add("is-documentation-target");
    scrollDocumentationTargetIntoView(
      target,
      window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches
        ? "auto"
        : "smooth"
    );
    target.focus({ preventScroll: true });

    if (documentationTargetTimer) window.clearTimeout(documentationTargetTimer);
    documentationTargetTimer = window.setTimeout(() => {
      target.classList.remove("is-documentation-target");
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
    }

    resetHexArtifact();
    updateCompilePanelState(true);

    updateEditorFileWatermark(name);
    refreshDocumentationPane();
    scheduleDocumentationMarkerRefresh();
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
    editor.on("change", () => {
      clearCompileErrorHighlight();
      if (!current) return;
      scheduleDocumentationMarkerRefresh();
      if (resolveGuideFileName(current) === current) {
        scheduleDocumentationPaneRefresh();
      }
      if (saveTimer) clearTimeout(saveTimer);

      const codeSnapshot = editor.getValue();
      const fileNameSnapshot = current;

      saveTimer = setTimeout(() => {
        if (fileNameSnapshot && hasFile(fileNameSnapshot)) {
          files[fileNameSnapshot] = codeSnapshot;
        }
        persistState();
      }, 250);
    });
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
      const documentationEditToggle = $("documentationEditToggle");
      const documentationEditor = $("projectDocumentationEditor");
      const projectAiToggle = $("projectAiToggle");
      const projectAiForm = $("projectAiForm");
      const projectAiClearBtn = $("projectAiClearBtn");

    initCustomSelect(mcuSelect);
    initCustomSelect(documentationLocaleSelect);
    bindOutlinerDropZone();
    bindFileListResizer();
    bindDocumentationResizer();
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
    projectAiToggle &&
      projectAiToggle.addEventListener("click", () => {
        setProjectPaneMode(
          projectPaneMode === "ai" ? "documentation" : "ai",
          { focusPrompt: projectPaneMode !== "ai" }
        );
      });
    projectAiForm &&
      projectAiForm.addEventListener("submit", handleProjectAiSubmit);
    projectAiClearBtn &&
      projectAiClearBtn.addEventListener("click", clearProjectAiHistory);
    documentationEditor &&
      documentationEditor.addEventListener("input", () => {
        saveDocumentationEditorValue();
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
      const menu = $("fileContextMenu");
      if (!menu || menu.style.display !== "block") return;
      if (menu.contains(e.target) || e.target.closest(".file-menu-btn")) {
        return;
      }
      closeFileContextMenu();
    });

    // Close context menu on Escape
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
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
    ensureAtLeastOneFile();
    restoreDocumentationWidth();
    restoreOutlinerWidth();
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
    bindUI();
    setProjectPaneMode("documentation");
    initEditor();

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
  }

  initMiniProjectBridge();
  document.addEventListener("DOMContentLoaded", boot);
})();
