// c-canvas.js — code canvas with local files, CodeMirror editor, UART connect, and AVR compile->HEX
(function () {
  const STORAGE_KEY = "ud_c_canvas_files_v1";
  const STORAGE_CURRENT = "ud_c_canvas_current_v1";

  const $ = (id) => document.getElementById(id);

  let editor = null;
  let files = {};
  let current = null;
  let saveTimer = null;
  let contextMenuFile = null;

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
    const normalized = String(text || "").replace(/\r\n/g, "\n").trim();
    if (!normalized) return;
    appendCompileLog(title);
    el.textContent += `${normalized}\n`;
    el.scrollTop = el.scrollHeight;
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
// UartDebug C code canvas

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
      files = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      current = localStorage.getItem(STORAGE_CURRENT) || null;
    } catch {
      files = {};
      current = null;
    }
  }

  function persistState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(files));
    if (current) localStorage.setItem(STORAGE_CURRENT, current);
    else {
      try {
        localStorage.removeItem(STORAGE_CURRENT);
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
      newCanvas();
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

    const state = setHexStatus._state || "idle";
    setHexStatus(state, state === "ready" ? lastHexName : undefined);

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

  function handleFileContextAction(action) {
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
        compileCurrentFile();
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

    $("editorTitle").textContent = `Editor — ${name}`;
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
    if (deletedCurrent) current = null;
    persistState();
    if (!current) {
      try {
        localStorage.removeItem(STORAGE_CURRENT);
      } catch {}
      if (Object.keys(files).length === 0 && editor) {
        editor.setValue("");
        editor.setOption("readOnly", "nocursor");
      }
      $("editorTitle").textContent = "Editor";
    } else {
      if (editor) {
        editor.setOption("readOnly", false);
        editor.setValue(files[current] || "");
      }
      $("editorTitle").textContent = `Editor — ${current}`;
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
    const hexStatus = $("hexStatus");
    const fileContextMenu = $("fileContextMenu");

    newBtn && newBtn.addEventListener("click", newCanvas);
    renameBtn &&
      renameBtn.addEventListener("click", () => current && renameFile(current));
    deleteBtn &&
      deleteBtn.addEventListener("click", () => current && deleteFile(current));
    downloadBtn && downloadBtn.addEventListener("click", downloadCurrent);
    compileBtn && compileBtn.addEventListener("click", compileCurrentFile);
    hexStatus &&
      hexStatus.addEventListener("click", (event) => {
        event.stopPropagation();
        downloadHex();
      });

    // Shared file context menu: click on items
    if (fileContextMenu) {
      fileContextMenu.addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-action]");
        if (!btn) return;
        const action = btn.dataset.action;
        if (!action) return;
        handleFileContextAction(action);
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
  let lastDetectedUpdiTargetKey = "";

  function getUpdiHexArtifact() {
    return {
      hexText: lastHexContent || "",
      fileName: lastHexName || "",
      source: "compiled",
    };
  }

  function dispatchUpdiHexArtifact() {
    if (typeof window === "undefined" || typeof CustomEvent !== "function") {
      return;
    }

    window.dispatchEvent(
      new CustomEvent("ud-updi-hex-artifact", {
        detail: getUpdiHexArtifact(),
      })
    );
  }

  function dispatchCanvasSerialState() {
    if (typeof window === "undefined" || typeof CustomEvent !== "function") {
      return;
    }

    window.dispatchEvent(
      new CustomEvent("ud-canvas-serial-state", {
        detail: {
          connected: false,
          label: "",
        },
      })
    );
  }

  function initUpdiBridge() {
    if (typeof window === "undefined") return;

    window.__UARTDEBUG_CANVAS_UPDI_BRIDGE__ = {
      getHexArtifact: getUpdiHexArtifact,
      isCanvasSerialConnected: () => false,
      getDetectedTargetKey: () => lastDetectedUpdiTargetKey || "",
      setDetectedTargetKey: (targetKey) => {
        lastDetectedUpdiTargetKey =
          typeof targetKey === "string" ? targetKey.trim() : "";
      },
    };
  }

  function resetHexArtifact() {
    lastHexContent = null;
    lastHexName = null;
    setHexStatus("idle");
    dispatchUpdiHexArtifact();
  }

  function downloadHex() {
    if (!lastHexContent || !lastHexName) return;
    const blob = new Blob([lastHexContent], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = lastHexName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  }

  async function compileCurrentFile() {
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
          ? window.__UARTDEBUG_CANVAS_UPDI_BRIDGE__
          : null;
      const detectedMcu =
        bridge && typeof bridge.getDetectedTargetKey === "function"
          ? String(bridge.getDetectedTargetKey() || "").trim()
          : "";

      if (!detectedMcu) {
        alert(
          "Auto detect mode needs a known chip signature. Read Signature first or choose a concrete MCU before compiling."
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
    const compileSource = compileFileName ? files[compileFileName] : "";
    const btn = $("compileBtn");
    const restoreButton = () => updateCompilePanelState(false);

    if (!compileFileName || !compileSource) {
      setCompileLogText("");
      appendCompileLog("No open file to compile.");
      setHexStatus("error");
      updateHexUI(false);
      restoreButton();
      return;
    }

    if (!/\.c$/i.test(compileFileName)) {
      setCompileLogText("");
      appendCompileLog(
        `"${compileFileName}" is not a C source file. Only *.c files can be compiled.`
      );
      setHexStatus("error");
      updateHexUI(false);
      restoreButton();
      return;
    }

    try {
      if (editor && current === compileFileName) {
        files[compileFileName] = editor.getValue();
      }
    } catch {}

    const mcuEl = $("mcuSelect");
    const fcpuEl = $("fCpuInput");
    const optEl = $("optimizeSelect");
    let selectedMcu = mcuEl && mcuEl.value ? mcuEl.value.trim() : "attiny1624";

    if (selectedMcu === "auto") {
      const bridge =
        typeof window !== "undefined"
          ? window.__UARTDEBUG_CANVAS_UPDI_BRIDGE__
          : null;
      const detectedMcu =
        bridge && typeof bridge.getDetectedTargetKey === "function"
          ? String(bridge.getDetectedTargetKey() || "").trim()
          : "";

      if (!detectedMcu) {
        setCompileLogText("");
        appendCompileLog(
          "Auto detect mode needs a known chip signature. Read Signature first or choose a concrete MCU before compiling."
        );
        setHexStatus("error");
        updateHexUI(false);
        restoreButton();
        return;
      }

      selectedMcu = detectedMcu;
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

    setCompileLogText("");
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
      return;
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
      return;
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
      return;
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
      return;
    }

    lastHexContent = data.hex;
    {
      const base = compileFileName.replace(/\.c$/i, "");
      lastHexName = (data.hex_name && data.hex_name.trim()) || base + ".hex";
    }

    updateHexUI(true);
    setHexStatus("ready", lastHexName);
    dispatchUpdiHexArtifact();

    appendCompileLog(`Compilation succeeded for "${compileFileName}".`);
    appendCompileLog(
      `HEX ready: ${lastHexName} (${selectedMcu}, F_CPU=${payload.f_cpu}, ${payload.optimize}).`
    );

    const hasCompilerOutput =
      (data.compile_stdout && String(data.compile_stdout).trim()) ||
      (data.compile_stderr && String(data.compile_stderr).trim());

    if (!hasCompilerOutput) {
      appendCompileLog("Compiler returned no additional messages.");
    }

    appendCompileBlock("Compiler stdout", data.compile_stdout);
    appendCompileBlock("Compiler stderr", data.compile_stderr);

    restoreButton();
  }

  function boot() {
    loadState();
    ensureAtLeastOneFile();
    renderOutliner();
    if (!current) current = Object.keys(files)[0];
    initUpdiBridge();

    bindUI();
    initEditor();

    updateHexUI(false);
    dispatchCanvasSerialState();
    dispatchUpdiHexArtifact();
    selectFile(current);
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
