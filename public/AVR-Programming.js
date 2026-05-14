// c-canvas.js — code canvas with local files, CodeMirror editor, UART connect, and AVR compile->HEX
(function () {
  const STORAGE_KEY = "ud_avr_programming_files_v1";
  const STORAGE_CURRENT = "ud_avr_programming_current_v1";
  const STORAGE_GROUPS = "ud_avr_programming_file_groups_v1";
  const LEGACY_STORAGE_KEY = "ud_c_canvas_files_v1";
  const LEGACY_STORAGE_CURRENT = "ud_c_canvas_current_v1";
  const AVR_UPDI_RUNTIME_KEY = "__UARTDEBUG_AVR_PROGRAMMING_UPDI__";
  const LEGACY_UPDI_RUNTIME_KEY = "__UARTDEBUG_CANVAS_UPDI__";
  const AVR_UPDI_BRIDGE_KEY = "__UARTDEBUG_AVR_PROGRAMMING_UPDI_BRIDGE__";
  const LEGACY_UPDI_BRIDGE_KEY = "__UARTDEBUG_CANVAS_UPDI_BRIDGE__";
  const AVR_SERIAL_STATE_EVENT = "ud-avr-programming-serial-state";
  const LEGACY_SERIAL_STATE_EVENT = "ud-canvas-serial-state";

  const $ = (id) => document.getElementById(id);

  let editor = null;
  let files = {};
  let fileGroups = {};
  let current = null;
  let saveTimer = null;
  let contextMenuFile = null;
  let contextMenuGroup = null;
  let inlineFileEdit = null;
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

  function updateEditorFileWatermark(fileName) {
    const el = $("editorFileWatermark");
    if (!el) return;
    el.textContent = fileName || "";
  }

  function formatCompileLogTime() {
    return new Date().toLocaleTimeString("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  function setCompileLogText(text) {
    const el = $("compileLog");
    if (!el) return;
    el.textContent = String(text || "").replace(/\r\n/g, "\n");
    el.scrollTop = el.scrollHeight;
  }

  function appendCompileLog(message) {
    const el = $("compileLog");
    if (!el) return;
    const text = String(message || "").replace(/\r\n/g, "\n");
    if (el.textContent && !el.textContent.endsWith("\n")) {
      el.textContent += "\n";
    }
    el.textContent += `[${formatCompileLogTime()}] ${text}\n`;
    el.scrollTop = el.scrollHeight;
  }

  function appendCompileBlock(title, text) {
    const el = $("compileLog");
    if (!el) return;
    const normalized = sanitizeCompilerOutput(text);
    if (!normalized) return;
    appendCompileLog(title);
    el.textContent += `${normalized}\n`;
    el.scrollTop = el.scrollHeight;
  }

  function formatCompileErrorDetails(data) {
    if (!data || typeof data !== "object") return "";
    const lines = [];
    if (data.failed_file) lines.push(`file: ${data.failed_file}`);
    if (data.error) lines.push(String(data.error));
    if (data.exit_code !== undefined && data.exit_code !== null) {
      lines.push(`exit code: ${data.exit_code}`);
    }
    if (data.signal) lines.push(`signal: ${data.signal}`);
    if (data.killed) lines.push("process was killed");
    return lines.join("\n");
  }

  function formatCompileFileList(names) {
    return Array.isArray(names)
      ? names.filter(Boolean).map(String).join(", ")
      : "";
  }

  function isLegacyCompileServerResponse(data, compileSnapshot) {
    if (!compileSnapshot || compileSnapshot.projectFiles.length <= 1) {
      return false;
    }

    if (!data || typeof data !== "object") return false;
    if (Array.isArray(data.compiled_files)) return false;

    const command = String(data.cmd || "");
    return !command || !/\s-I/.test(command);
  }

  function appendLegacyCompileServerWarning() {
    appendCompileLog(
      "Compile server is still running an older backend. Redeploy/restart backend so it accepts project_files and compiles linked project sources."
    );
  }

  function sanitizeCompilerOutput(text) {
    return String(text || "")
      .replace(/\r\n/g, "\n")
      .split("\n")
      .filter(
        (line) =>
          !/^\s*sh:\s*0:\s*getcwd\(\)\s*failed:\s*No such file or directory\s*$/.test(
            line
          )
      )
      .join("\n")
      .trim();
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
    const section = $("canvasUpdiSection");
    const btn = $("moreOptionsBtn");
    if (!section || !btn) return;

    const isExpanded = !!expanded;
    section.hidden = !isExpanded;
    btn.setAttribute("aria-expanded", String(isExpanded));
    btn.textContent = isExpanded ? "Hide options" : "More options";
    btn.title = isExpanded
      ? "Hide advanced UPDI tools"
      : "Show advanced UPDI tools";

    if (isExpanded) {
      requestAnimationFrame(() => {
        section.scrollIntoView({ block: "nearest", behavior: "smooth" });
      });
    }
  }

  function toggleMoreOptions() {
    const section = $("canvasUpdiSection");
    if (!section) return;
    setMoreOptionsExpanded(section.hidden);
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
      await updi.programHex();
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
    const buttonLabel = hasCurrent
      ? `Compile "${current}"`
      : "Compile current file";

    if (btn) {
      btn.textContent = buttonLabel;
      btn.title = buttonLabel;
      btn.disabled = !canCompile;
    }

    if (!resetLog) return;

    if (!hasCurrent) {
      setCompileLogText("Create or select a C source file to compile.");
      return;
    }

    if (isHexFileName(current)) {
      setCompileLogText(
        `"${current}" is a HEX firmware file.\nSelect a *.c file to compile.`
      );
      return;
    }

    if (!canCompile) {
      setCompileLogText(
        `"${current}" is not a C source file.\nSelect a *.c file to compile.`
      );
      return;
    }

    setCompileLogText(
      `Ready to compile "${current}".\nCompiler messages and HEX status will appear here.`
    );
  }

  function defaultTemplate(name = "main.c") {
    return `// ${name}
// UartDebug AVR Programming workspace

#include <stdint.h>
#include <avr/interrupt.h>

int main(void) {
  sei();
  // put your setup code here
  
  while (1) {
    // loop
  }
  
  return 0;
}
`;
  }

  function loadState() {
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
      files = {};
      fileGroups = {};
      current = null;
    }

    normalizeFileGroups();
  }

  function persistState() {
    const serializedFiles = JSON.stringify(files);
    localStorage.setItem(STORAGE_KEY, serializedFiles);
    localStorage.setItem(LEGACY_STORAGE_KEY, serializedFiles);
    localStorage.setItem(STORAGE_GROUPS, JSON.stringify(fileGroups));
    if (current) {
      localStorage.setItem(STORAGE_CURRENT, current);
      localStorage.setItem(LEGACY_STORAGE_CURRENT, current);
    } else {
      try {
        localStorage.removeItem(STORAGE_CURRENT);
        localStorage.removeItem(LEGACY_STORAGE_CURRENT);
      } catch {}
    }
  }

  function normalizeFileGroups() {
    const normalized = {};
    const assignedFiles = new Set();

    if (!fileGroups || typeof fileGroups !== "object") {
      fileGroups = {};
      return;
    }

    for (const [rawName, rawGroup] of Object.entries(fileGroups)) {
      const name = String(rawName || "").trim();
      if (!name || normalized[name]) continue;

      const rawFiles = Array.isArray(rawGroup?.files)
        ? rawGroup.files
        : [];
      const groupFiles = [];

      for (const fileName of rawFiles) {
        const normalizedFile = String(fileName || "").trim();
        if (
          !normalizedFile ||
          !hasFile(normalizedFile) ||
          assignedFiles.has(normalizedFile)
        ) {
          continue;
        }

        groupFiles.push(normalizedFile);
        assignedFiles.add(normalizedFile);
      }

      normalized[name] = {
        files: groupFiles,
        expanded: !!rawGroup?.expanded,
      };
    }

    fileGroups = normalized;
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
    const group = fileGroups[groupName];
    return (group?.files || []).filter((name) => hasFile(name)).length;
  }

  function getFileGroup(fileName) {
    for (const [groupName, group] of Object.entries(fileGroups)) {
      if ((group.files || []).includes(fileName)) return groupName;
    }
    return "";
  }

  function insertFileName(names, fileName, targetName = "", placement = "after") {
    const next = names.filter((name) => name !== fileName);
    const targetIndex = targetName ? next.indexOf(targetName) : -1;

    if (targetIndex === -1) {
      next.push(fileName);
      return next;
    }

    next.splice(placement === "before" ? targetIndex : targetIndex + 1, 0, fileName);
    return next;
  }

  function setFilesInOrder(names) {
    const nextFiles = {};
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

  function renameFileKey(oldName, newName) {
    const nextFiles = {};

    for (const name of Object.keys(files)) {
      nextFiles[name === oldName ? newName : name] = files[name];
    }

    files = nextFiles;
  }

  function renameGroupKey(oldName, newName) {
    const nextGroups = {};

    for (const name of Object.keys(fileGroups)) {
      nextGroups[name === oldName ? newName : name] = fileGroups[name];
    }

    fileGroups = nextGroups;
  }

  function isCFileName(fileName) {
    return /\.c$/i.test(fileName || "");
  }

  function getEditorModeForFile(fileName) {
    return isCFileName(fileName) ? "text/x-csrc" : "text/plain";
  }

  function getNewFileContent(fileName) {
    return isCFileName(fileName) ? defaultTemplate(fileName) : "";
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
      const primaryAction = $("createNewFileCard");
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
    const normalizedName =
      uniqueImportedName((fileName || "").trim()) || uniqueName("main.c");

    files[normalizedName] = String(content || "").replace(/\r\n/g, "\n");
    selectFile(normalizedName);
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

    const text = await readLocalFileText(file);
    const fileKind = resolveUploadedFileKind(file.name);

    if (fileKind === "editor") {
      importEditorFile(file.name, text);
      return;
    }

    const message =
      'Unsupported file type. Upload a source file (.c, .h, .cpp, .hpp, .ino, .s, .asm, .txt) or a firmware file (.hex).';
    await showSiteAlert(message, "Unsupported file");
    console.warn(`Import rejected: "${file.name}" has an unsupported extension.`);
  }

  function ensureAtLeastOneFile() {
    if (Object.keys(files).length === 0) {
      const name = "main.c";
      files[name] = defaultTemplate(name);
      current = name;
      persistState();
    }
  }

  function validateInlineFileName(fileName, originalName = "") {
    const name = String(fileName || "").trim();

    if (!name) return "Enter a file name.";
    if (name === "." || name === "..") return "Use a regular file name.";
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
    if (name.length > 64) return "Keep the group name under 64 characters.";
    if (/[\\/:*?"<>|\x00-\x1f]/.test(name)) {
      return 'Do not use path separators or these characters: \\ / : * ? " < > |';
    }
    if (name !== originalName && (hasGroup(name) || hasFile(name))) {
      return "A file or group with this name already exists.";
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
      if (isInlineGroupEdit()) {
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

  function startInlineCreate() {
    closeFileContextMenu();
    closeAddFileModal();
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
    const nextName = isGroupEdit ? rawName : normalizeInlineFileName(rawName);
    const error = isGroupEdit
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
      current = nextName;
      inlineFileEdit = null;
      persistState();
      renderOutliner();
      if (editor) {
        editor.setOption("readOnly", false);
        editor.setOption("mode", getEditorModeForFile(nextName));
        editor.setValue(files[nextName]);
      }
      updateEditorFileWatermark(nextName);
      resetHexArtifact();
      updateCompilePanelState(true);
      return true;
    }

    if (inlineFileEdit.mode === "create-group") {
      fileGroups[nextName] = {
        files: [],
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

    inlineFileEdit = null;
    renderOutliner();
    return false;
  }

  function removeFileFromGroups(fileName) {
    for (const group of Object.values(fileGroups)) {
      group.files = (group.files || []).filter((name) => name !== fileName);
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
    return true;
  }

  function assignFileToGroup(fileName, groupName) {
    moveFileToGroup(fileName, groupName);
  }

  function eventHasDraggedFile(event) {
    const types = Array.from(event.dataTransfer?.types || []);
    return types.includes("text/x-ud-file") || types.includes("text/plain");
  }

  function getDraggedFileName(event) {
    return (
      event.dataTransfer?.getData("text/x-ud-file") ||
      event.dataTransfer?.getData("text/plain") ||
      ""
    );
  }

  function getDropPlacement(event, row) {
    const rect = row.getBoundingClientRect();
    return event.clientY < rect.top + rect.height / 2 ? "before" : "after";
  }

  function clearOutlinerDropMarkers() {
    document
      .querySelectorAll(".file-item.drop-before, .file-item.drop-after, .file-item.drop-target")
      .forEach((row) => {
        row.classList.remove("drop-before", "drop-after", "drop-target");
      });
    $("fileList")?.classList.remove("root-drop-target");
  }

  function markRowDrop(row, placement) {
    clearOutlinerDropMarkers();
    row.classList.add(placement === "before" ? "drop-before" : "drop-after");
  }

  function bindOutlinerDropZone() {
    const list = $("fileList");
    if (!list) return;

    list.addEventListener("dragover", (event) => {
      if (!eventHasDraggedFile(event)) return;
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
      if (!eventHasDraggedFile(event)) return;
      const handledTarget = event.target.closest(
        ".file-item[data-file], .file-item.file-group, .file-group-block"
      );
      if (handledTarget) return;

      event.preventDefault();
      clearOutlinerDropMarkers();
      const fileName = getDraggedFileName(event);
      moveFileToRoot(fileName);
    });
  }

  function renderFileRow(list, name, groupName = "") {
    const row = document.createElement("div");
    row.className = "file-item";
    row.dataset.file = name;
    row.draggable = true;

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
      inlineFileEdit.mode === "rename" &&
      inlineFileEdit.originalName === name;

    if (editingThisFile) {
      row.classList.add("editing");
      renderInlineFileInput(row, inlineFileEdit);
      list.appendChild(row);
      return;
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

    row.addEventListener("dragstart", (e) => {
      row.classList.add("dragging");
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
      if (!eventHasDraggedFile(e)) return;

      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      markRowDrop(row, getDropPlacement(e, row));
    });

    row.addEventListener("dragleave", (e) => {
      if (row.contains(e.relatedTarget)) return;
      row.classList.remove("drop-before", "drop-after");
    });

    row.addEventListener("drop", (e) => {
      if (!eventHasDraggedFile(e)) return;

      e.preventDefault();
      e.stopPropagation();
      clearOutlinerDropMarkers();

      const fileName = getDraggedFileName(e);
      if (!fileName || fileName === name) return;

      const placement = getDropPlacement(e, row);
      if (groupName) {
        moveFileToGroup(fileName, groupName, name, placement);
      } else {
        moveFileToRoot(fileName, name, placement);
      }
    });

    list.appendChild(row);
  }

  function renderGroupRow(list, groupName) {
    const row = document.createElement("div");
    row.className = "file-item file-group";
    row.dataset.group = groupName;

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
    count.textContent = `+${getGroupFileCount(groupName)}`;
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

    row.addEventListener("dragover", (e) => {
      if (!eventHasDraggedFile(e)) return;
      e.preventDefault();
      e.stopPropagation();
      clearOutlinerDropMarkers();
      row.classList.add("drop-target");
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    });

    row.addEventListener("dragleave", (e) => {
      if (row.contains(e.relatedTarget)) return;
      row.classList.remove("drop-target");
    });

    row.addEventListener("drop", (e) => {
      if (!eventHasDraggedFile(e)) return;
      e.preventDefault();
      e.stopPropagation();
      clearOutlinerDropMarkers();
      const fileName = getDraggedFileName(e);
      assignFileToGroup(fileName, groupName);
    });

    list.appendChild(row);
  }

  function renderOutlinerLegacy() {
    const list = $("fileList");
    list.innerHTML = "";

    const newRow = document.createElement("div");
    newRow.className = "file-item new-item";
    newRow.title = "Create new file";

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

  function renderOutliner() {
    const list = $("fileList");
    list.innerHTML = "";

    const newRow = document.createElement("div");
    newRow.className = "file-item new-item";
    newRow.title = "Create new file";

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
      renderInlineFileInput(groupRow, inlineFileEdit);
      list.appendChild(groupRow);
    }

    const groupedFiles = getGroupedFileSet();
    const entries = [
      ...Object.keys(fileGroups).map((name) => ({
        type: "group",
        name,
      })),
      ...Object.keys(files)
        .filter((name) => !groupedFiles.has(name))
        .map((name) => ({
          type: "file",
          name,
        })),
    ];

    for (const entry of entries) {
      if (entry.type === "group") {
        const group = fileGroups[entry.name];
        if (group?.expanded) {
          const groupFiles = (group.files || []).filter((name) => hasFile(name));

          const groupBlock = document.createElement("div");
          groupBlock.className = "file-group-block";
          groupBlock.dataset.groupFiles = entry.name;

          renderGroupRow(groupBlock, entry.name);

          for (const fileName of groupFiles) {
            renderFileRow(groupBlock, fileName, entry.name);
          }

          list.appendChild(groupBlock);
        } else {
          renderGroupRow(list, entry.name);
        }
      } else {
        renderFileRow(list, entry.name);
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

    if (renameBtn) renameBtn.hidden = false;
    if (deleteBtn) {
      deleteBtn.hidden = false;
      deleteBtn.textContent = "Delete";
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

    if (renameBtn) renameBtn.hidden = false;
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

    const confirmed = await showSiteConfirm({
      title: "Delete group",
      message: `Delete group "${groupName}"? Files inside it will stay in Files.`,
      confirmText: "Delete group",
      cancelText: "Cancel",
      danger: true,
    });
    if (!confirmed) return;

    delete fileGroups[groupName];
    persistState();
    renderOutliner();
  }

  async function deleteFile(name) {
    if (!hasFile(name)) return;
    const confirmed = await showSiteConfirm({
      title: "Delete file",
      message: `Delete "${name}"? This cannot be undone.`,
      confirmText: "Delete",
      cancelText: "Cancel",
      danger: true,
    });
    if (!confirmed) return;

    const deletedCurrent = current === name;
    delete files[name];
    hexArtifactsBySource.delete(name);
    removeFileFromGroups(name);
    if (deletedCurrent) {
      current = Object.keys(files)[0] || null;
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
    // ключевые слова
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
    // типы stdint
    "int8_t",
    "int16_t",
    "int32_t",
    "uint8_t",
    "uint16_t",
    "uint32_t",
    // часто встречающиеся функции
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
    // твоё железо/прошивки (примерные хелперы)
    "F_CPU",
    "sei",
    "cli",
    "_delay_ms",
    "_delay_us",
  ];

  // Регистрируем собственный хинт: словарик + любые слова из файла
  CodeMirror.registerHelper("hint", "udc", function (cm) {
    const cur = cm.getCursor();
    const line = cm.getLine(cur.line);
    let start = cur.ch,
      end = cur.ch;

    // расширяем слово влево/вправо (латиница, цифры, подчёркивание)
    while (start && /[\w_]/.test(line.charAt(start - 1))) start--;
    while (end < line.length && /[\w_]/.test(line.charAt(end))) end++;

    const prefix = line.slice(start, cur.ch);
    const lcPref = prefix.toLowerCase();

    // 1) из словарика
    const dict = C_HINT_WORDS.filter((w) => w.toLowerCase().startsWith(lcPref));

    // 2) из текущего буфера (anyword)
    let any = [];
    try {
      any = (CodeMirror.hint.anyword(cm) || {}).list || [];
    } catch {}
    any = any.filter(
      (w) => w && typeof w === "string" && w.toLowerCase().startsWith(lcPref)
    );

    // склеим и удалим дубликаты, кроме точного совпадения с уже набранным префиксом
    const seen = new Set();
    const list = []
      .concat(dict, any)
      .filter((w) => w !== prefix)
      .filter((w) => (seen.has(w) ? false : (seen.add(w), true)))
      .slice(0, 200); // на всякий случай ограничим

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
      },
    });
    editor.on("inputRead", function (cm, change) {
      if (!isCFileName(current)) return;
      if (!change || !change.text || !change.text.length) return;
      const ch = change.text.join("");
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
      if (!current) return;
      if (saveTimer) clearTimeout(saveTimer);

      const codeSnapshot = editor.getValue();

      saveTimer = setTimeout(() => {
        files[current] = codeSnapshot;
        persistState();
      }, 250);
    });
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

  function renderCustomSelectOptions(select, custom) {
    const list = custom.querySelector(".custom-select-list");
    const label = custom.querySelector(".custom-select-value");
    if (!list || !label) return;

    list.innerHTML = "";
    label.textContent = getSelectDisplayText(select) || "Select MCU";

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
    custom.classList.toggle("is-disabled", !!select.disabled);
    custom.setAttribute("aria-disabled", String(!!select.disabled));
    renderCustomSelectOptions(select, custom);
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

    const custom = document.createElement("div");
    custom.className = "custom-select";
    custom.setAttribute("aria-hidden", "false");

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "custom-select-trigger";
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", "false");

    const value = document.createElement("span");
    value.className = "custom-select-value";
    trigger.appendChild(value);

    const menu = document.createElement("div");
    menu.className = "custom-select-menu";

    const list = document.createElement("div");
    list.className = "custom-select-list";
    list.setAttribute("role", "listbox");
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
      const createNewFileCard = $("createNewFileCard");
      const uploadExistingFileCard = $("uploadExistingFileCard");
      const createNewGroupCard = $("createNewGroupCard");
      const siteDialog = $("siteDialog");
      const siteDialogCloseBtn = $("siteDialogCloseBtn");
      const siteDialogCancelBtn = $("siteDialogCancelBtn");
      const siteDialogConfirmBtn = $("siteDialogConfirmBtn");
      const mcuSelect = $("mcuSelect");

    initCustomSelect(mcuSelect);
    bindOutlinerDropZone();
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
    fileAddCloseBtn && fileAddCloseBtn.addEventListener("click", closeAddFileModal);
    createNewFileCard &&
      createNewFileCard.addEventListener("click", () => {
        closeAddFileModal();
        newCanvas();
      });
    createNewGroupCard &&
      createNewGroupCard.addEventListener("click", () => {
        closeAddFileModal();
        startInlineCreateGroup();
      });
    uploadExistingFileCard &&
      uploadExistingFileCard.addEventListener("click", () => {
        closeAddFileModal();
        if (!fileUploadInput) return;
        fileUploadInput.value = "";
        fileUploadInput.click();
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
        if (inlineFileEdit) {
          cancelInlineFileEdit();
          return;
        }
        closeFileContextMenu();
        closeAddFileModal();
      }
    });

    window.addEventListener("beforeunload", () => {
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
      // индикатор ошибки
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
    const fcpuEl = document.getElementById("fCpuInput");
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
      f_cpu: fcpuEl && Number(fcpuEl.value) ? Number(fcpuEl.value) : 20000000,
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

    try {
      if (compileFileName && editor && current === compileFileName) {
        files[compileFileName] = editor.getValue();
      }
    } catch {}

    const compileSource = compileFileName ? files[compileFileName] : "";

    if (!compileFileName || !compileSource) {
      setCompileLogText("");
      appendCompileLog("No open file to compile.");
      setHexStatus("error");
      updateHexUI(false);
      restoreButton();
      return false;
    }

    if (!/\.c$/i.test(compileFileName)) {
      setCompileLogText("");
      appendCompileLog(
        `"${compileFileName}" is not a C source file. Only *.c files can be compiled.`
      );
      setHexStatus("error");
      updateHexUI(false);
      restoreButton();
      return false;
    }

    setCompileLogText("");

    const mcuEl = $("mcuSelect");
    const fcpuEl = $("fCpuInput");
    const optEl = $("optimizeSelect");
    let selectedMcu = mcuEl && mcuEl.value ? mcuEl.value.trim() : "attiny1624";

    if (selectedMcu === "auto") {
      appendCompileLog("Auto detect is enabled. Reading chip signature...");

      try {
        const signatureInfo = await ensureAutoDetectedTarget();
        const detectedMcu =
          signatureInfo && signatureInfo.matchedTargetKey
            ? String(signatureInfo.matchedTargetKey).trim()
            : "";
        const detectedLabel =
          signatureInfo && signatureInfo.matchedTargetLabel
            ? String(signatureInfo.matchedTargetLabel).trim()
            : detectedMcu;

        if (!detectedMcu) {
          throw new Error(
            "Auto detect could not resolve a supported chip. Check the UPDI connection or choose a concrete MCU before compiling."
          );
        }

        selectedMcu = detectedMcu;
        appendCompileLog(`Detected target: ${detectedLabel}.`);
      } catch (error) {
        appendCompileLog(
          error.message ||
            "Auto detect could not resolve a supported chip. Check the UPDI connection or choose a concrete MCU before compiling."
        );
        setHexStatus("error");
        updateHexUI(false);
        restoreButton();
        return false;
      }
    }

    const compileSnapshot = buildCompileProjectSnapshot(compileFileName);
    const payload = {
      filename: compileFileName,
      code: files[compileFileName],
      project_files: compileSnapshot.projectFiles,
      mcu: selectedMcu,
      f_cpu: fcpuEl && Number(fcpuEl.value) ? Number(fcpuEl.value) : 20000000,
      optimize: optEl && optEl.value ? optEl.value.trim() : "O1",
    };

    if (btn) {
      btn.disabled = true;
      btn.textContent = `Compiling "${compileFileName}"...`;
      btn.title = btn.textContent;
    }

    setHexStatus("building");
    updateHexUI(false);

    lastHexContent = null;
    lastHexName = null;
    dispatchUpdiHexArtifact();

    appendCompileLog(`Compiling "${compileFileName}" for ${selectedMcu}...`);
    appendCompileLog(
      `Options: F_CPU=${payload.f_cpu}, optimize=${payload.optimize}.`
    );
    if (compileSnapshot.projectFiles.length > 1) {
      appendCompileLog(
        `Project files: ${compileSnapshot.projectFiles
          .map((file) => file.name)
          .join(", ")}.`
      );
    }

    let resp;
    try {
      resp = await fetch("/api/avr/compile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      console.error("Network error:", error);
      appendCompileLog(
        `Failed to reach the compile server: ${error.message || String(error)}`
      );
      setHexStatus("error");
      updateHexUI(false);
      restoreButton();
      return false;
    }

    if (!resp.ok) {
      const rawText = await resp.text().catch(() => "");
      let errorData = null;
      try {
        errorData = rawText ? JSON.parse(rawText) : null;
      } catch {}

      console.error("Compile server error:", resp.status, errorData || rawText);
      appendCompileLog(
        errorData && errorData.stage
          ? `Compilation failed during ${errorData.stage}.`
          : `Compile server error ${resp.status}.`
      );
      if (errorData && errorData.cmd) {
        appendCompileBlock("Command", errorData.cmd);
      }
      if (isLegacyCompileServerResponse(errorData, compileSnapshot)) {
        appendLegacyCompileServerWarning();
      }
      const compiledFiles = formatCompileFileList(
        errorData && errorData.compiled_files
      );
      if (compiledFiles) {
        appendCompileLog(`Source units: ${compiledFiles}.`);
      }
      appendCompileBlock("Error", formatCompileErrorDetails(errorData));
      appendCompileBlock("Stdout", errorData && errorData.stdout);
      appendCompileBlock("Stderr", errorData && errorData.stderr);
      if (!errorData && rawText.trim()) {
        appendCompileBlock("Server response", rawText);
      }
      setHexStatus("error");
      updateHexUI(false);
      restoreButton();
      return false;
    }

    let data;
    try {
      data = await resp.json();
    } catch (error) {
      console.error("Bad JSON:", error);
      appendCompileLog("Invalid JSON response from compile server.");
      appendCompileBlock("Parse error", error.message || String(error));
      setHexStatus("error");
      updateHexUI(false);
      restoreButton();
      return false;
    }

    if (!data || data.ok !== true || !data.hex) {
      console.error("Compilation failed:", data);
      appendCompileLog("Compilation failed.");
      if (data && data.cmd) {
        appendCompileBlock("Command", data.cmd);
      }
      if (isLegacyCompileServerResponse(data, compileSnapshot)) {
        appendLegacyCompileServerWarning();
      }
      const compiledFiles = formatCompileFileList(data && data.compiled_files);
      if (compiledFiles) {
        appendCompileLog(`Source units: ${compiledFiles}.`);
      }
      appendCompileBlock("Error", formatCompileErrorDetails(data));
      appendCompileBlock("Stdout", data && data.stdout);
      appendCompileBlock("Stderr", data && data.stderr);
      appendCompileBlock("Compiler stdout", data && data.compile_stdout);
      appendCompileBlock("Compiler stderr", data && data.compile_stderr);
      setHexStatus("error");
      updateHexUI(false);
      restoreButton();
      return false;
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

    appendCompileLog(`Compilation succeeded for "${compileFileName}".`);
    appendCompileLog(
      `HEX ready: ${lastHexName} (${selectedMcu}, F_CPU=${payload.f_cpu}, ${payload.optimize}).`
    );
    if (isLegacyCompileServerResponse(data, compileSnapshot)) {
      appendLegacyCompileServerWarning();
    }
    {
      const compiledFiles = formatCompileFileList(data.compiled_files);
      if (compiledFiles && data.compiled_files.length > 1) {
        appendCompileLog(`Compiled units: ${compiledFiles}.`);
      }
    }

    const filteredCompileStdout = sanitizeCompilerOutput(data.compile_stdout);
    const filteredCompileStderr = sanitizeCompilerOutput(data.compile_stderr);
    const hasCompilerOutput =
      !!filteredCompileStdout || !!filteredCompileStderr;

    if (!hasCompilerOutput) {
      appendCompileLog("Compiler returned no additional messages.");
    }

    appendCompileBlock("Compiler stdout", filteredCompileStdout);
    appendCompileBlock("Compiler stderr", filteredCompileStderr);

    restoreButton();
    return true;
  }

  function boot() {
    loadState();
    ensureAtLeastOneFile();
    renderOutliner();
    if (!current) current = Object.keys(files)[0];
    initUpdiBridge();

    setMoreOptionsExpanded(false);
    bindUI();
    initEditor();

    updateHexUI(false);
    dispatchCanvasSerialState();
    dispatchUpdiHexArtifact();
    selectFile(current);
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
