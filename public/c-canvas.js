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
    else
      try {
        localStorage.removeItem(STORAGE_CURRENT);
      } catch (e) {}
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

      // 🗑 Delete — иконкой
      const delBtn = document.createElement("button");
      delBtn.className = "icon";
      delBtn.title = "Delete file";
      delBtn.innerHTML = `
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <path d="M10.6299 1.33496C12.0335 1.33496 13.2695 2.25996 13.666 3.60645L13.8809 4.33496H17L17.1338 4.34863C17.4369 4.41057 17.665 4.67858 17.665 5C17.665 5.32142 17.4369 5.58943 17.1338 5.65137L17 5.66504H16.6543L15.8574 14.9912C15.7177 16.629 14.3478 17.8877 12.7041 17.8877H7.2959C5.75502 17.8877 4.45439 16.7815 4.18262 15.2939L4.14258 14.9912L3.34668 5.66504H3C2.63273 5.66504 2.33496 5.36727 2.33496 5C2.33496 4.63273 2.63273 4.33496 3 4.33496H6.11914L6.33398 3.60645L6.41797 3.3584C6.88565 2.14747 8.05427 1.33496 9.37012 1.33496H10.6299ZM5.46777 14.8779L5.49121 15.0537C5.64881 15.9161 6.40256 16.5576 7.2959 16.5576H12.7041C13.6571 16.5576 14.4512 15.8275 14.5322 14.8779L15.3193 5.66504H4.68164L5.46777 14.8779ZM7.66797 12.8271В8.66016C7.66797 8.29299 7.96588 7.99528 8.33301 7.99512C8.70028 7.99512 8.99805 8.29289 8.99805 8.66016В12.8271C8.99779 13.1942 8.70012 13.4912 8.33301 13.4912C7.96604 13.491 7.66823 13.1941 7.66797 12.8271ZM11.002 12.8271В8.66016C11.002 8.29289 11.2997 7.99512 11.667 7.99512C12.0341 7.9953 12.332 8.293 12.332 8.66016В12.8271C12.3318 13.1941 12.0339 13.491 11.667 13.4912C11.2999 13.4912 11.0022 13.1942 11.002 12.8271ZM9.37012 2.66504C8.60726 2.66504 7.92938 3.13589 7.6582 3.83789L7.60938 3.98145L7.50586 4.33496H12.4941L12.3906 3.98145C12.1607 3.20084 11.4437 2.66504 10.6299 2.66504H9.37012Z"/>
      </svg>`;
      delBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        deleteFile(name);
      });
      acts.appendChild(delBtn);

      // ⬇ Download — текстовая кнопка (как было)
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

    // Persist state; clear current pointer if needed
    persistState();

    if (!current) {
      try {
        localStorage.removeItem(STORAGE_CURRENT);
      } catch (e) {}
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
    // Force CodeMirror to fill container height and width
    if (editor && editor.setSize) {
      editor.setSize("100%", "100%");
      setTimeout(() => editor.refresh(), 0);
      window.addEventListener("resize", () => editor && editor.refresh());
    }

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
