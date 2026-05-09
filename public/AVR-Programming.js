// c-canvas.js — code canvas with local files, CodeMirror editor, UART connect, and AVR compile->HEX
(function () {
  const STORAGE_KEY = "ud_avr_programming_files_v1";
  const STORAGE_CURRENT = "ud_avr_programming_current_v1";
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
  let current = null;
  let saveTimer = null;
  let contextMenuFile = null;
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
  ]);
  const HEX_FILE_EXTENSIONS = new Set(["hex", "ihex"]);

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

  async function ensureAutoDetectedTarget() {
    const updi = getCanvasUpdiRuntime();
    if (!updi || typeof updi.ensureSignature !== "function") {
      throw new Error("UPDI auto detect is unavailable on this page.");
    }

    return await updi.ensureSignature({ force: true });
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
    appendCompileLog("Reading chip signature...");

    try {
      const signatureInfo = await ensureAutoDetectedTarget();
      const description = describeSignatureInfo(signatureInfo);

      if (description) {
        appendCompileLog(`Detected chip: ${description}.`);
      } else {
        appendCompileLog(
          "Chip signature was not detected. Check the UPDI wiring and selected serial adapter."
        );
      }
    } catch (error) {
      appendCompileLog(
        `Chip detection failed: ${error.message || String(error)}`
      );
    }
  }

  async function handleFlashCurrent() {
    const updi = getCanvasUpdiRuntime();
    if (!updi || typeof updi.programHex !== "function") {
      appendCompileLog("Flash tools are not ready yet.");
      return;
    }

    if (typeof updi.preparePortPermission === "function") {
      try {
        appendCompileLog("Preparing UPDI port access...");
        await updi.preparePortPermission();
      } catch (error) {
        appendCompileLog(
          `UPDI port access failed: ${error.message || String(error)}`
        );
        return;
      }
    }

    if (!updi.hasLoadedImage || !updi.hasLoadedImage()) {
      await compileCurrentFile();
      if (!updi.hasLoadedImage || !updi.hasLoadedImage()) {
        return;
      }
    }

    try {
      await updi.programHex();
    } catch (error) {
      appendCompileLog(`Flash failed: ${error.message || String(error)}`);
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
      current =
        localStorage.getItem(STORAGE_CURRENT) ??
        localStorage.getItem(LEGACY_STORAGE_CURRENT) ??
        null;
    } catch {
      files = {};
      current = null;
    }
  }

  function persistState() {
    const serializedFiles = JSON.stringify(files);
    localStorage.setItem(STORAGE_KEY, serializedFiles);
    localStorage.setItem(LEGACY_STORAGE_KEY, serializedFiles);
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

  function uniqueName(base) {
    if (!files[base]) return base;
    const m = base.match(/^(.*?)(\.(c|h))?$/i);
    const stem = (m && m[1]) || base;
    const ext = (m && m[2]) || ".c";
    let i = 2;
    while (files[`${stem}_${i}${ext}`]) i++;
    return `${stem}_${i}${ext}`;
  }

  function uniqueImportedName(base) {
    if (!base || !files[base]) return base;

    const lastDot = base.lastIndexOf(".");
    const hasExtension = lastDot > 0;
    const stem = hasExtension ? base.slice(0, lastDot) : base;
    const ext = hasExtension ? base.slice(lastDot) : "";
    let index = 2;
    let candidate = `${stem}_${index}${ext}`;

    while (files[candidate]) {
      index += 1;
      candidate = `${stem}_${index}${ext}`;
    }

    return candidate;
  }

  function getFileExtension(name) {
    const lastDot = typeof name === "string" ? name.lastIndexOf(".") : -1;
    return lastDot > -1 ? name.slice(lastDot + 1).toLowerCase() : "";
  }

  function looksLikeIntelHex(text) {
    const firstContentLine = String(text || "")
      .replace(/\r\n/g, "\n")
      .split("\n")
      .map((line) => line.trim())
      .find(Boolean);

    return !!firstContentLine && firstContentLine.startsWith(":");
  }

  function resolveUploadedFileKind(fileName, text) {
    const ext = getFileExtension(fileName);

    if (HEX_FILE_EXTENSIONS.has(ext)) return "hex";
    if (ext === "txt" && looksLikeIntelHex(text)) return "hex";
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

    if (normalizedName !== fileName) {
      appendCompileLog(
        `Imported "${fileName}" as "${normalizedName}" because that name was already in use.`
      );
      return;
    }

    appendCompileLog(`Imported "${normalizedName}" into the editor.`);
  }

  function loadUploadedHexFile(fileName, hexText) {
    const updi = getCanvasUpdiRuntime();

    setMoreOptionsExpanded(true);

    if (updi && typeof updi.loadHexFile === "function") {
      updi.loadHexFile(hexText, fileName, "uploaded");
    } else {
      dispatchHexArtifact({
        hexText,
        fileName,
        source: "uploaded",
      });
    }

    appendCompileLog(`Loaded firmware image "${fileName}" for UPDI flashing.`);
  }

  async function handleUploadedFile(file) {
    if (!file) return;

    const text = await readLocalFileText(file);
    const fileKind = resolveUploadedFileKind(file.name, text);

    if (fileKind === "hex") {
      loadUploadedHexFile(file.name, text);
      return;
    }

    if (fileKind === "editor") {
      importEditorFile(file.name, text);
      return;
    }

    const message =
      'Unsupported file type. Upload a source file (.c, .h, .cpp, .hpp, .ino, .s, .asm, .txt) or a firmware file (.hex).';
    alert(message);
    appendCompileLog(`Import rejected: "${file.name}" has an unsupported extension.`);
  }

  function ensureAtLeastOneFile() {
    if (Object.keys(files).length === 0) {
      const name = "main.c";
      files[name] = defaultTemplate(name);
      current = name;
      persistState();
    }
  }

  function renderOutliner() {
    const list = $("fileList");
    list.innerHTML = "";

    const newRow = document.createElement("div");
    newRow.className = "file-item active new-item";
    newRow.title = "Create new file";

    const plus = document.createElement("div");
    plus.className = "file-name";
    plus.textContent = "+";

    newRow.appendChild(plus);
    newRow.addEventListener("click", (e) => {
      e.stopPropagation();
      openAddFileModal();
    });

    list.appendChild(newRow);

    const names = Object.keys(files).sort((a, b) => a.localeCompare(b));

    for (const name of names) {
      const row = document.createElement("div");
      row.className = "file-item";
      row.dataset.file = name;

      if (name === current) {
        row.classList.add("active");
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
      menuBtn.innerHTML = "⋯";

      menuBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const rect = menuBtn.getBoundingClientRect();
        openFileContextMenu(name, rect.left + rect.width / 2, rect.bottom + 4);
      });

      acts.appendChild(menuBtn);
      row.appendChild(acts);

      row.addEventListener("click", () => {
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

  function openFileContextMenu(fileName, clientX, clientY) {
    const menu = $("fileContextMenu");
    if (!menu) return;

    contextMenuFile = fileName;

    // Enable/disable actions based on file
    const compileBtn = menu.querySelector('button[data-action="compile"]');
    if (compileBtn) {
      compileBtn.disabled = !/\.c$/i.test(fileName);
    }

    const downloadHexBtn = menu.querySelector(
      'button[data-action="download-hex"]'
    );
    if (downloadHexBtn) {
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
    if (!contextMenuFile || !files[contextMenuFile]) {
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
        deleteFile(targetName);
        break;
      case "download":
        downloadFile(targetName);
        break;
      case "compile":
        if (current !== targetName) {
          selectFile(targetName);
        }
        await compileCurrentFile();
        break;
      case "download-hex":
        await downloadHexForFile(targetName);
        break;
      default:
        break;
    }
  }

  function selectFile(name) {
    if (!files[name]) return;
    current = name;
    if (editor) {
      editor.setOption("readOnly", false);
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
    let name = prompt("New canvas name:", uniqueName("main.c"));
    if (!name) return;
    name = name.trim();
    if (!name) return;
    if (files[name]) {
      alert("A file with this name already exists.");
      return;
    }
    files[name] = defaultTemplate(name);
    current = name;
    persistState();
    renderOutliner();
    if (editor) editor.setValue(files[name]);
    resetHexArtifact();
    updateCompilePanelState(true);
  }

  function renameFile(oldName) {
    if (!files[oldName]) return;
    const proposed = prompt("Rename to:", oldName);
    if (!proposed || proposed === oldName) return;
    const newName = proposed.trim();
    if (!newName) return;
    if (files[newName]) {
      alert("A file with this name already exists.");
      return;
    }
    files[newName] = files[oldName];
    delete files[oldName];
    if (hexArtifactsBySource.has(oldName)) {
      hexArtifactsBySource.set(newName, hexArtifactsBySource.get(oldName));
      hexArtifactsBySource.delete(oldName);
    }
    const renamedCurrent = current === oldName;
    if (renamedCurrent) current = newName;
    persistState();
    renderOutliner();
    if (renamedCurrent) {
      resetHexArtifact();
      updateCompilePanelState(true);
    }
  }

  function deleteFile(name) {
    if (!files[name]) return;
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
    const deletedCurrent = current === name;
    delete files[name];
    hexArtifactsBySource.delete(name);
    if (deletedCurrent) current = null;
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
    if (!name || !files[name]) return;
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
    if (!current || !files[current]) return;
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
      value: current && files[current] ? files[current] : "",
      mode: "text/x-csrc",
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

    newBtn && newBtn.addEventListener("click", openAddFileModal);
    renameBtn &&
      renameBtn.addEventListener("click", () => current && renameFile(current));
    deleteBtn &&
      deleteBtn.addEventListener("click", () => current && deleteFile(current));
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
          alert(`Failed to import file.\n${message}`);
          appendCompileLog(`Import failed: ${message}`);
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
          appendCompileLog(
            `File action failed: ${error.message || String(error)}`
          );
        });
      });
    }

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

  function storeHexArtifact(fileName, hexText, hexName, sourceText) {
    if (!fileName || !hexText || !hexName) return;
    hexArtifactsBySource.set(fileName, {
      hexText,
      hexName,
      sourceText: String(sourceText || ""),
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

  async function downloadHexForFile(fileName) {
    if (!fileName || !/\.c$/i.test(fileName)) return;

    if (current === fileName && editor) {
      try {
        files[fileName] = editor.getValue();
        persistState();
      } catch {}
    }

    const sourceText = String(files[fileName] || "");
    const artifact = getHexArtifactForFile(fileName);
    if (artifact && artifact.sourceText === sourceText) {
      downloadHexArtifact(artifact);
      appendCompileLog(`Downloaded cached HEX for "${fileName}".`);
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
    if (!current || !files[current]) {
      alert("No open file.");
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
      alert("Only *.c files can be compiled. Select a .c file.");
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
          alert(
            "Auto detect could not resolve a supported chip. Check the UPDI connection or choose a concrete MCU before compiling."
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

    const payload = {
      filename: current,
      code: files[current],
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
      alert("Failed to send code for compilation (network error).");
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
      alert("Compile server error: " + resp.status + (txt ? "\n" + txt : ""));
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
      alert("Invalid response from compile server.");
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
      alert("Compilation failed.\n" + stderr);
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

    const payload = {
      filename: compileFileName,
      code: files[compileFileName],
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
      files[compileFileName]
    );

    updateHexUI(true);
    setHexStatus("ready", lastHexName);
    dispatchUpdiHexArtifact();

    appendCompileLog(`Compilation succeeded for "${compileFileName}".`);
    appendCompileLog(
      `HEX ready: ${lastHexName} (${selectedMcu}, F_CPU=${payload.f_cpu}, ${payload.optimize}).`
    );

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
