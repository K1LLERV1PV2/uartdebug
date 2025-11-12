// c-canvas.js — code canvas with local files, CodeMirror editor, UART connect, and AVR compile->HEX
(function () {
  const STORAGE_KEY = "ud_c_canvas_files_v1";
  const STORAGE_CURRENT = "ud_c_canvas_current_v1";

  const $ = (id) => document.getElementById(id);

  let editor = null;
  let files = {};
  let current = null;
  let saveTimer = null;

  function defaultTemplate(name = "main.c") {
    return `// ${name}
// UartDebug C code canvas

#include <stdint.h>

int main(void) {
  // put your setup code here
  for (;;) {
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
      row.className = "file-item" + (name === current ? " active" : "");
      row.dataset.file = name;

      const label = document.createElement("div");
      label.className = "file-name";
      label.textContent = name;
      row.appendChild(label);

      const acts = document.createElement("div");
      acts.className = "file-actions";

      const delBtn = document.createElement("button");
      delBtn.className = "icon";
      delBtn.title = "Delete file";
      delBtn.innerHTML = `
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <path d="M10.6299 1.33496C12.0335 1.33496 13.2695 2.25996 13.666 3.60645L13.8809 4.33496H17L17.1338 4.34863C17.4369 4.41057 17.665 4.67858 17.665 5C17.665 5.32142 17.4369 5.58943 17.1338 5.65137L17 5.66504H16.6543L15.8574 14.9912C15.7177 16.629 14.3478 17.8877 12.7041 17.8877H7.2959C5.75502 17.8877 4.45439 16.7815 4.18262 15.2939L4.14258 14.9912L3.34668 5.66504H3C2.63273 5.66504 2.33496 5.36727 2.33496 5C2.33496 4.63273 2.63273 4.33496 3 4.33496H6.11914L6.33398 3.60645L6.41797 3.3584C6.88565 2.14747 8.05427 1.33496 9.37012 1.33496H10.6299ZM5.46777 14.8779L5.49121 15.0537C5.64881 15.9161 6.40256 16.5576 7.2959 16.5576H12.7041C13.6571 16.5576 14.4512 15.8275 14.5322 14.8779L15.3193 5.66504H4.68164L5.46777 14.8779ZM7.66797 12.8271V8.66016C7.66797 8.29299 7.96588 7.99528 8.33301 7.99512C8.70028 7.99512 8.99805 8.29289 8.99805 8.66016V12.8271C8.99779 13.1942 8.70012 13.4912 8.33301 13.4912C7.96604 13.491 7.66823 13.1941 7.66797 12.8271ZM11.002 12.8271V8.66016C11.002 8.29289 11.2997 7.99512 11.667 7.99512C12.0341 7.9953 12.332 8.293 12.332 8.66016V12.8271C12.3318 13.1941 12.0339 13.491 11.667 13.4912C11.2999 13.4912 11.0022 13.1942 11.002 12.8271ZM9.37012 2.66504C8.60726 2.66504 7.92938 3.13589 7.6582 3.83789L7.60938 3.98145L7.50586 4.33496H12.4941L12.3906 3.98145C12.1607 3.20084 11.4437 2.66504 10.6299 2.66504H9.37012Z"/>
      </svg>`;
      delBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        deleteFile(name);
      });
      acts.appendChild(delBtn);

      const dlBtn = document.createElement("button");
      dlBtn.textContent = "↓";
      dlBtn.className = "download";
      dlBtn.title = "Download file";
      dlBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        downloadFile(name);
      });
      acts.appendChild(dlBtn);

      row.appendChild(acts);
      row.addEventListener("click", () => selectFile(name));
      list.appendChild(row);
    }

    updateToolbarState();
  }

  function selectFile(name) {
    if (!files[name]) return;
    current = name;
    if (editor) {
      editor.setOption("readOnly", false);
      editor.setValue(files[name]);
    }
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
    if (current === oldName) current = newName;
    persistState();
    renderOutliner();
  }

  function deleteFile(name) {
    if (!files[name]) return;
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
    delete files[name];
    if (current === name) current = null;
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
    if (rb) rb.disabled = !has;
    if (db) db.disabled = !has;
    if (dl) dl.disabled = !has;
  }

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
      autofocus: true,
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
      saveTimer = setTimeout(() => {
        files[current] = editor.getValue();
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
    const hexDownloadBtn = $("hexDownloadBtn");

    newBtn && newBtn.addEventListener("click", newCanvas);
    renameBtn &&
      renameBtn.addEventListener("click", () => current && renameFile(current));
    deleteBtn &&
      deleteBtn.addEventListener("click", () => current && deleteFile(current));
    downloadBtn && downloadBtn.addEventListener("click", downloadCurrent);
    compileBtn && compileBtn.addEventListener("click", compileCurrentFile);
    hexDownloadBtn && hexDownloadBtn.addEventListener("click", downloadHex);

    window.addEventListener("beforeunload", async () => {
      if (editor && current) {
        files[current] = editor.getValue();
        persistState();
      }
      try {
        await disconnectSerialCanvas();
      } catch {}
    });
  }

  // --- HEX artifact state ---
  let lastHexContent = null;
  let lastHexName = null;

  function updateHexUI(hasHex) {
    const st = $("hexStatus");
    const dl = $("hexDownloadBtn");
    if (!st || !dl) return;
    if (hasHex) {
      st.textContent = "HEX: ready";
      dl.disabled = false;
    } else {
      st.textContent = "HEX: none";
      dl.disabled = true;
    }
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
    if (!current || !files[current]) {
      alert("Нет открытого файла.");
      return;
    }
    if (!/\.c$/i.test(current)) {
      alert("Скомпилировать можно только *.c файл. Vыберите .c.");
      return;
    }

    const payload = {
      filename: current,
      code: files[current],
      mcu: "attiny1624",
      f_cpu: 20000000,
      optimize: "Os",
    };

    const btn = $("compileBtn");
    const prevLabel = btn ? btn.textContent : "";
    try {
      if (btn) {
        btn.disabled = true;
        btn.textContent = "Compiling…";
      }
    } catch {}

    let resp;
    try {
      resp = await fetch("/api/avr/compile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      console.error("Network error:", e);
      alert("Не удалось отправить код на компиляцию (сеть).");
      if (btn) {
        btn.disabled = false;
        btn.textContent = prevLabel || "Compile";
      }
      return;
    }

    if (!resp.ok) {
      const txt = await resp.text();
      console.error("Server error:", txt);
      alert("Ошибка сервера компиляции: " + resp.status + "\\n" + txt);
      if (btn) {
        btn.disabled = false;
        btn.textContent = prevLabel || "Compile";
      }
      return;
    }

    let data;
    try {
      data = await resp.json();
    } catch (e) {
      console.error("Bad JSON:", e);
      alert("Некорректный ответ от сервера компиляции.");
      if (btn) {
        btn.disabled = false;
        btn.textContent = prevLabel || "Compile";
      }
      return;
    }

    if (!data || data.ok !== true || !data.hex) {
      const stderr = data && data.stderr ? data.stderr : "unknown error";
      alert("Компиляция не удалась.\\n" + stderr);
      lastHexContent = null;
      lastHexName = null;
      updateHexUI(false);
      if (btn) {
        btn.disabled = false;
        btn.textContent = prevLabel || "Compile";
      }
      return;
    }

    lastHexContent = data.hex;
    const base = current.replace(/\.c$/i, "");
    lastHexName = (data.hex_name && data.hex_name.trim()) || base + ".hex";
    updateHexUI(true);

    if (data.stderr && data.stderr.trim()) {
      console.warn("avr-gcc warnings:", data.stderr);
    }
    if (btn) {
      btn.disabled = false;
      btn.textContent = prevLabel || "Compile";
    }
  }

  // ------------- Minimal UART connect (Microchip defaults) -------------
  let canvasPort = null;
  let canvasReader = null;
  let canvasWriter = null;

  function getPortLabel(info) {
    if (!info) return "Unknown device";
    const hex = (n) => Number(n).toString(16).padStart(4, "0").toUpperCase();
    if (info.usbVendorId != null && info.usbProductId != null) {
      return `USB ${hex(info.usbVendorId)}:${hex(info.usbProductId)}`;
    }
    if (info.usbVendorId != null) return `USB ${hex(info.usbVendorId)}`;
    return "Unknown device";
  }

  async function connectSerialCanvas() {
    try {
      if (!("serial" in navigator)) {
        updateConnectionStatusCanvas(false);
        const btn = $("connectBtn");
        if (btn) btn.disabled = true;
        return;
      }

      canvasPort = await navigator.serial.requestPort();
      await canvasPort.open({
        baudRate: 230400,
        dataBits: 8,
        parity: "even",
        stopBits: 2,
        bufferSize: 4096,
      });

      canvasReader = canvasPort.readable.getReader();
      canvasWriter = canvasPort.writable.getWriter();

      const label = getPortLabel(canvasPort.getInfo?.());
      updateConnectionStatusCanvas(true, label || "");
    } catch (e) {
      console.error("[canvas] connect error:", e);
      updateConnectionStatusCanvas(false);
    }
  }

  async function disconnectSerialCanvas() {
    try {
      if (canvasReader) {
        try {
          await canvasReader.cancel();
        } catch {}
        try {
          canvasReader.releaseLock();
        } catch {}
      }
      if (canvasWriter) {
        try {
          canvasWriter.releaseLock();
        } catch {}
      }
      if (canvasPort) {
        try {
          await canvasPort.close();
        } catch {}
      }
    } finally {
      canvasReader = null;
      canvasWriter = null;
      canvasPort = null;
      updateConnectionStatusCanvas(false);
    }
  }

  function updateConnectionStatusCanvas(connected, label = "") {
    const status = $("statusIndicator");
    const btn = $("connectBtn");
    if (!status || !btn) return;

    if (connected) {
      status.textContent = label ? `Connected: ${label}` : "Connected";
      status.classList.remove("disconnected");
      status.classList.add("connected");
      btn.textContent = "Disconnect";
    } else {
      status.textContent = "Disconnected";
      status.classList.remove("connected");
      status.classList.add("disconnected");
      btn.textContent = "Connect";
    }
  }

  async function toggleConnectionCanvas() {
    if (canvasPort) await disconnectSerialCanvas();
    else await connectSerialCanvas();
  }

  function initSerialUI() {
    const btn = $("connectBtn");
    if (btn) btn.addEventListener("click", toggleConnectionCanvas);
    if (!("serial" in navigator)) {
      updateConnectionStatusCanvas(false);
      if (btn) btn.disabled = true;
    }
  }

  function boot() {
    loadState();
    ensureAtLeastOneFile();
    renderOutliner();
    if (!current) current = Object.keys(files)[0];
    bindUI();
    initEditor();
    initSerialUI();
    updateHexUI(false);
    selectFile(current);
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
