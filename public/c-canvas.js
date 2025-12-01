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
  let compactInitEditor = null;
  let compactLoopEditor = null;
  let isUpdatingFromMainToCompact = false;
  let isUpdatingFromCompactToMain = false;
  let compactSyncTimer = null;

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

      if (name === current) {
        const hex = document.createElement("div");
        hex.id = "hexStatus";
        hex.className = "hex-status";
        hex.setAttribute("aria-live", "polite");
        hex.innerHTML =
          '<span class="dot" aria-hidden="true"></span>' +
          '<span class="label">HEX: idle</span>';

        hex.addEventListener("click", (e) => {
          e.stopPropagation();
          downloadHex();
        });

        acts.appendChild(hex);
      }

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

    $("editorTitle").textContent = `Editor — ${name}`;
    persistState();
    renderOutliner();
    if (editor) setTimeout(() => editor.refresh(), 0);

    if (compactInitEditor && compactLoopEditor) {
      updateCompactFromMain(files[name]);
    }
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

  function parseMainSections(source) {
    const mainRegex = /\bint\s+main\s*\([^)]*\)\s*{/m;
    const match = mainRegex.exec(source);
    if (!match) {
      throw new Error("main() not found");
    }

    // Открывающая { у main()
    const braceIndex = source.indexOf("{", match.index);
    if (braceIndex === -1) {
      throw new Error("main() opening brace not found");
    }

    // Находим соответствующую закрывающую } main()
    let depth = 0;
    let bodyEndBraceIndex = -1;
    for (let i = braceIndex; i < source.length; i++) {
      const ch = source[i];
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          bodyEndBraceIndex = i;
          break;
        }
      }
    }
    if (bodyEndBraceIndex === -1) {
      throw new Error("main() closing brace not found");
    }

    const bodyStartIndex = braceIndex + 1;
    const beforeMain = source.slice(0, bodyStartIndex);
    const body = source.slice(bodyStartIndex, bodyEndBraceIndex);
    const afterMain = source.slice(bodyEndBraceIndex);

    const loopRegex = /\bwhile\s*\([^)]*\)|\bfor\s*\([^)]*\)/g;
    const loopMatch = loopRegex.exec(body);

    // main() без цикла — всё это init-часть
    if (!loopMatch) {
      return {
        beforeMain,
        afterMain,
        body,
        initSection: body,
        loopSection: "",
        loopHeader: "",
        loopBody: "",
        tailSection: "",
      };
    }

    const loopKeywordIndex = loopMatch.index;

    // ВАЖНО: тащим отступ строки целиком, а не только слово while/for
    let loopHeaderStart = loopKeywordIndex;
    for (let i = loopKeywordIndex - 1; i >= 0; i--) {
      const ch = body[i];
      if (ch === "\n") {
        loopHeaderStart = i + 1;
        break;
      }
    }

    // Ищем { после while/for
    let blockStartIndex = -1;
    for (let j = loopKeywordIndex; j < body.length; j++) {
      const ch = body[j];
      if (ch === "{") {
        blockStartIndex = j;
        break;
      }
      if (ch === ";") {
        // цикл без { } — одна строка
        break;
      }
    }

    // Вариант без блока: while (...) stmt;
    if (blockStartIndex === -1) {
      const semiIndex = body.indexOf(";", loopKeywordIndex);
      if (semiIndex === -1) {
        throw new Error("Loop without ';'");
      }

      const initSection = body.slice(0, loopHeaderStart);
      const loopSection = body.slice(loopHeaderStart, semiIndex + 1);
      const tailSection = body.slice(semiIndex + 1);

      return {
        beforeMain,
        afterMain,
        body,
        initSection,
        loopSection,
        loopHeader: "",
        loopBody: "",
        tailSection,
      };
    }

    // Вариант с блоком: while (...) { ... }
    let depth2 = 0;
    let blockEndIndex = -1;
    for (let k = blockStartIndex; k < body.length; k++) {
      const ch = body[k];
      if (ch === "{") depth2++;
      else if (ch === "}") {
        depth2--;
        if (depth2 === 0) {
          blockEndIndex = k;
          break;
        }
      }
    }
    if (blockEndIndex === -1) {
      throw new Error("Cannot find end of main loop block");
    }

    const initSection = body.slice(0, loopHeaderStart);
    const loopSection = body.slice(loopHeaderStart, blockEndIndex + 1);
    const tailSection = body.slice(blockEndIndex + 1);

    const loopHeader = body.slice(loopHeaderStart, blockStartIndex + 1);
    const loopBody = body.slice(blockStartIndex + 1, blockEndIndex);

    return {
      beforeMain,
      afterMain,
      body,
      initSection,
      loopSection,
      loopHeader,
      loopBody,
      tailSection,
    };
  }

  function detectBodyIndent(body) {
    const lines = body.split(/\r?\n/);
    for (const line of lines) {
      const m = line.match(/^(\s+)\S/);
      if (m) return m[1];
    }
    return "  ";
  }

  function rebuildSourceFromCompact(source, newInit, newLoop) {
    const sections = parseMainSections(source);

    // Берём исходное тело main() целиком
    let body = sections.body;

    // --- 1. Подменяем init-часть (всё до первой строки цикла) ---
    const initText =
      typeof newInit === "string" ? newInit.replace(/\r\n/g, "\n") : "";
    const initEnd = sections.initSection.length;

    // Заменяем старый init-блок на то, что в compactInit
    body = initText + body.slice(initEnd);

    // --- 2. Подменяем тело цикла ---
    // Если удалось выделить чистое тело { ... } — меняем только его,
    // иначе (цикл без фигурных скобок) – весь loopSection.
    const loopSegment =
      sections.loopBody && sections.loopBody.length
        ? sections.loopBody
        : sections.loopSection;

    const loopText =
      typeof newLoop === "string" ? newLoop.replace(/\r\n/g, "\n") : "";

    if (loopSegment && loopSegment.length) {
      // Ищем только ПОСЛЕ init-блока, чтобы не попасть в совпадения в init
      const searchFrom = initText.length;
      const idx = body.indexOf(loopSegment, searchFrom);
      if (idx !== -1) {
        body =
          body.slice(0, idx) + loopText + body.slice(idx + loopSegment.length);
      }
    }

    // Небольшой safety: если тело не пустое и не заканчивается \n,
    // добавим перевод строки перед закрывающей скобкой main().
    if (body && !body.endsWith("\n")) {
      body += "\n";
    }

    return sections.beforeMain + body + sections.afterMain;
  }

  function updateCompactFromMain(source) {
    if (!compactInitEditor || !compactLoopEditor) return;

    let sections;
    try {
      sections = parseMainSections(source);
    } catch (e) {
      // Если main() не нашли — просто очищаем компакт-панель
      isUpdatingFromMainToCompact = true;
      try {
        compactInitEditor.setValue("");
        compactLoopEditor.setValue("");
      } finally {
        isUpdatingFromMainToCompact = false;
      }
      return;
    }

    // Берём кусок из основного редактора "как есть",
    // аккуратно убирая только пустые строки по краям,
    // но НЕ меняя отступы самих строк.
    const segmentToCompact = (segment) => {
      if (!segment) return "";
      let s = segment.replace(/\r\n/g, "\n");

      // 1) убираем только ОДНУ первую пустую строку после '{',
      //    но не лезем в пробелы перед кодом
      if (s.startsWith("\n")) {
        s = s.slice(1);
      }

      // 2) убираем полностью пустые строки в начале
      s = s.replace(/^(?:[ \t]*\n)+/, "");

      // 3) и в конце
      s = s.replace(/(?:\n[ \t]*)+$/, "");

      return s;
    };

    // Всё, что до первого цикла — в Init
    const initText = segmentToCompact(sections.initSection);

    // Тело цикла: либо чистое тело { ... }, либо весь loopSection, если тело отдельно не выделено
    const loopSource =
      (sections.loopBody && sections.loopBody.length
        ? sections.loopBody
        : sections.loopSection) || "";
    const loopText = segmentToCompact(loopSource);

    // Обновляем компакт-редакторы, помечая, что это "синхронизация слева направо"
    isUpdatingFromMainToCompact = true;
    try {
      compactInitEditor.setValue(initText);
      compactLoopEditor.setValue(loopText);
    } finally {
      isUpdatingFromMainToCompact = false;
    }
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
      const fromCompact = isUpdatingFromCompactToMain;

      saveTimer = setTimeout(() => {
        files[current] = codeSnapshot;
        persistState();

        if (!fromCompact) {
          updateCompactFromMain(codeSnapshot);
        }
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

  function initCompactEditors() {
    const initTextarea = document.getElementById("compactInit");
    const loopTextarea = document.getElementById("compactLoop");
    if (!initTextarea || !loopTextarea || !window.CodeMirror) return;

    compactInitEditor = CodeMirror.fromTextArea(initTextarea, {
      mode: "text/x-csrc",
      theme: "material-darker",
      lineNumbers: false,
      matchBrackets: false,
      autoCloseBrackets: false,
    });

    compactLoopEditor = CodeMirror.fromTextArea(loopTextarea, {
      mode: "text/x-csrc",
      theme: "material-darker",
      lineNumbers: false,
      matchBrackets: false,
      autoCloseBrackets: false,
    });

    compactInitEditor.setSize("100%", "100%");
    compactLoopEditor.setSize("100%", "100%");
    setTimeout(() => {
      compactInitEditor.refresh();
      compactLoopEditor.refresh();
    }, 0);

    const handleCompactChange = () => {
      if (!current) return;
      if (isUpdatingFromMainToCompact) return;

      if (compactSyncTimer) clearTimeout(compactSyncTimer);
      compactSyncTimer = setTimeout(() => {
        try {
          const newInit = compactInitEditor.getValue();
          const newLoop = compactLoopEditor.getValue();
          const origin = (editor && editor.getValue()) || files[current] || "";

          const rebuilt = rebuildSourceFromCompact(origin, newInit, newLoop);

          isUpdatingFromCompactToMain = true;
          try {
            if (editor) {
              const cursor = editor.getCursor();
              editor.setValue(rebuilt);
              editor.setCursor(cursor);
            }
            files[current] = rebuilt;
            persistState();
          } finally {
            isUpdatingFromCompactToMain = false;
          }
        } catch (e) {
          console.error("[compact] apply error:", e);
        }
      }, 250);
    };

    compactInitEditor.on("change", handleCompactChange);
    compactLoopEditor.on("change", handleCompactChange);
  }

  function bindUI() {
    const newBtn = $("newBtn");
    const renameBtn = $("renameBtn");
    const deleteBtn = $("deleteBtn");
    const downloadBtn = $("downloadBtn");
    const compileBtn = $("compileBtn");
    const fileContextMenu = $("fileContextMenu");

    newBtn && newBtn.addEventListener("click", newCanvas);
    renameBtn &&
      renameBtn.addEventListener("click", () => current && renameFile(current));
    deleteBtn &&
      deleteBtn.addEventListener("click", () => current && deleteFile(current));
    downloadBtn && downloadBtn.addEventListener("click", downloadCurrent);
    compileBtn && compileBtn.addEventListener("click", compileCurrentFile);

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

  function resetHexArtifact() {
    lastHexContent = null;
    lastHexName = null;
    setHexStatus("idle");
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

    const payload = {
      filename: current,
      code: files[current],
      mcu: mcuEl && mcuEl.value ? mcuEl.value.trim() : "attiny1624",
      f_cpu: fcpuEl && Number(fcpuEl.value) ? Number(fcpuEl.value) : 20000000,
      optimize: optEl && optEl.value ? optEl.value.trim() : "Os",
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
    initCompactEditors();
    initSerialUI();
    updateHexUI(false);
    selectFile(current);
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
