// c-canvas.js — simple C editor 'canvas' with file outliner (localStorage-backed)
// Uses CodeMirror 5 to avoid ESM issues and to keep 1:1 styling with uart.html.

(function () {
  const STORAGE_KEY = "ud_c_canvas_files_v1";
  const STORAGE_CURRENT = "ud_c_canvas_current_v1";

  const $ = (id) => document.getElementById(id);

  /** @type {CodeMirror.Editor} */
  let editor = null;
  let files = {};
  let current = null;
  let saveTimer = null;

  // --- Helpers ---
  function defaultTemplate(name = "main.c") {
    return `// ${name}
// UartDebug C code canvas
// Tip: your files are kept in your browser's LocalStorage

#include <stdint.h>

// Blink example (pseudo):
// Adjust pins/headers for your MCU/toolchain
int main(void) {
    // init();
    for (;;) {
        // toggle_led();
        // delay_ms(500);
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
    else try { localStorage.removeItem(STORAGE_CURRENT); } catch (e) {}
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

    // "+" pseudo file to create new files
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

      const renameBtn = document.createElement("button");
      renameBtn.textContent = "Rename";
      renameBtn.title = "Rename file";
      renameBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        renameFile(name);
      });
      acts.appendChild(renameBtn);

      const delBtn = document.createElement("button");
      delBtn.textContent = "Delete";
      delBtn.title = "Delete file";
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

    // Persist state; clear current pointer if needed
    persistState();

    if (!current) {
      try { localStorage.removeItem(STORAGE_CURRENT); } catch (e) {}
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
    // Create a CodeMirror instance inside #editorHost
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
    if (!current) {
      editor.setOption("readOnly", "nocursor");
    }
    // Autosave with debounce
    editor.on("change", () => {
      if (!current) return;
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        files[current] = editor.getValue();
        persistState();
      }, 250);
    });

    // Ctrl/Cmd + S => download current file
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

    newBtn && newBtn.addEventListener("click", newCanvas);
    renameBtn &&
      renameBtn.addEventListener("click", () => current && renameFile(current));
    deleteBtn &&
      deleteBtn.addEventListener("click", () => current && deleteFile(current));
    downloadBtn && downloadBtn.addEventListener("click", downloadCurrent);

    window.addEventListener("beforeunload", () => {
      if (editor && current) {
        files[current] = editor.getValue();
        persistState();
      }
    });
  }

  // --- Boot ---
  function boot() {
    loadState();
    ensureAtLeastOneFile();
    renderOutliner();
    if (!current) current = Object.keys(files)[0];
    bindUI();
    initEditor();
    selectFile(current);
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
