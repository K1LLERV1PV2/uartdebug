// ui.js
import { Graph } from "./graph.js";
import { Canvas } from "./canvas.js";
import { drawObject } from "./object.js";
import { Node } from "./node.js";

export class UI {
  // Получить все подграфы/формы из памяти
  _getAllSubgraphs() {
    return {
      graphs: this.projectData.graphs,
      shapes: this.projectData.shapes
    };
  }

  // Записать подграфы/формы в память
  _setAllSubgraphs({ graphs, shapes }) {
    this.projectData.graphs = graphs || {};
    this.projectData.shapes = shapes || {};
  }

  static _ensureMainExists(uiInstance) {
    const { graphs, shapes } = uiInstance._getAllSubgraphs();
    if (!graphs["main"]) {
      graphs["main"] = uiInstance.getCurrentState();
      uiInstance._setAllSubgraphs({ graphs, shapes });
    }
  }

  constructor(
    canvasElement,
    sidePanel,
    contextMenu,
    nodeList,
    nodeNameInput,
    saveBtn,
    loadBtn
  ) {
    this.canvasElement = canvasElement;
    this.contextMenu = contextMenu;
    this.nodeList = nodeList;
    this.nodeNameInput = nodeNameInput;
    this.saveBtn = saveBtn;
    this.loadBtn = loadBtn;

    this.baseSelect = document.getElementById("node-base-select");
    this.relSelect = document.getElementById("node-rel-select");

    this.baseSelect.addEventListener("change", (e) => {
      const [node] = this.graph.getSelectedNodes();
      if (!node) return;
      node.base = e.target.value;
      this.draw();
      this.pushUndo();
    });

    this.relSelect.addEventListener("change", (e) => {
      const [node] = this.graph.getSelectedNodes();
      if (!node) return;
      node.rel = e.target.value;
      this.draw();
      this.pushUndo();
    });

    // for group‐dragging
    this.groupDragging = false;
    this.groupDragStartPos = null;
    this.groupDragStartPositions = null;
    this.groupDragStartPositionsObjects = null;
    this.primaryDragNode = null;
    this.primaryDragObject = null;

    // Панель выбора цвета объектов
    this.colorPanelContainer = document.getElementById("color-panel-container");
    this.colorPanelToggle = document.getElementById("color-panel-toggle");
    this.objectColorPicker = document.getElementById("object-color-picker");

    // Инициализация кнопки-тогглера для панели цветов
    this.colorPanelToggle.textContent = ">";
    this.colorPanelToggle.addEventListener("click", () => {
      this.colorPanelContainer.classList.toggle("collapsed");
      this.colorPanelToggle.textContent =
        this.colorPanelContainer.classList.contains("collapsed") ? "<" : ">";
    });

    // При выборе цвета — меняем у всех выделенных объектов
    this.objectColorPicker.addEventListener("input", (e) => {
      const color = e.target.value;
      this.graph.getSelectedObjects().forEach((o) => (o.color = color));
      this.draw();
      this.pushUndo();
    });

    this.saveManagerModal = document.getElementById("save-manager-modal");
    this.saveListDiv = document.getElementById("save-list");
    this.saveNameInput = document.getElementById("save-name-input");
    this.saveActionBtn = document.getElementById("save-action-btn");

    this.saveMode = "save"; // или 'load'
    this.isLoadingProject = false;

    this.snapToGrid = false;
    this.gridStep = 20;

    this.sidePanel = sidePanel;
    // Форма для вновь создаваемых узлов ("solid" или "dashed")
    this.newNodeShapeType = "solid";
    // Тип для вновь создаваемых объектов ("circle"|"square"|"triangle")
    this.newObjectType = null;
    // Имя пользовательского узла для добавления
    this.newCustomNodeType = null;
    this.resizingObject = null;
    this.resizingHandle = null; // "nw","ne","se","sw"
    this.resizeStart = null; // { x, y, scaleX, scaleY }

    // Новые кнопки Undo/Redo (ищем их в документе)
    this.undoBtn = document.getElementById("undo-btn");
    this.redoBtn = document.getElementById("redo-btn");

    //this.operatorButtons = document.querySelectorAll(".operator-btn");
    //this.valueButtons = document.querySelectorAll(".value-btn");
    this.shapeButtons = document.querySelectorAll(".shape-btn");
    //this.runLogicBtn = document.getElementById("run-logic-btn");

    this.customNodeButtons = null;

    this.expandedNodes = {};

    this.graph = new Graph();
    this.newObjectType = null;
    this.canvas = new Canvas(canvasElement);
    this.ctx = this.canvas.getContext();

    this.svgOverlay = document.getElementById("svg-overlay");
    const svgNS = "http://www.w3.org/2000/svg";
    // группа, в которой будут все объекты
    this.svgGroup = document.createElementNS(svgNS, "g");
    this.svgOverlay.appendChild(this.svgGroup);

    // Переменные для масштабирования и панорамирования
    this.scale = 1;
    this.offset = { x: 0, y: 0 };

    // Переменные для перетаскивания узлов (групповое перемещение)
    this.draggingNode = null;
    this.dragOffsetX = 0;
    this.dragOffsetY = 0;
    this.groupDragging = false;
    this.groupDragStartPos = null;
    this.groupDragStartPositions = null;

    // Для перетаскивания узлов/объектов
    this.draggingNode = null;
    this.dragOffsetX = 0;
    this.dragOffsetY = 0;
    this.groupDragging = false;
    this.draggingObject = null;
    this.dragOffsetXObj = 0;
    this.dragOffsetYObj = 0;

    // Переменные для выделения области
    this.isSelectingArea = false;
    this.selectionStart = null;
    this.selectionRect = null;

    this.tempEdge = null;

    // Переменные для панорамирования (ПКМ в пустом месте)
    this.rightMouseDownInEmptyArea = false;
    this.isPanning = false;
    this.panStart = null;
    this.panOffsetStart = null;
    this.panThreshold = 5; // минимальное смещение для начала панорамирования

    // Стеки для Undo/Redo
    this.undoStack = [];
    this.redoStack = [];

    // хранилище всех подграфов и форм
    this.projectData = {
      graphs: {},    // { "main": { nodes:…, edges:…, objects:… }, … }
      shapes: {},    // { customNodeName: shapeType, … }
    };
    
    // начальный путь
    this.currentPath = ["main"];
    // создаём main в локалке, если его нет
    UI._ensureMainExists(this);
    // привязываем элемент хлебных крошек
    this.pathDisplay = document.getElementById("path-display");
    this.tabsContainer = document.getElementById("tabs-container");
    this.tabs = ["main"];
    this.updateBreadcrumb();
    this.updateTabs();

    // Блокируем до авторизации
    this.saveBtn.disabled = true;
    this.loadBtn.disabled = true;
    this.checkSession();

    // начальный “main” гарантируем после первой инициализации:
    this.projectData.graphs["main"] = this.getCurrentState();

    this.initEvents();
    this.draw();
  }

  initEvents() {
    // Отключаем стандартное контекстное меню на канвасе
    this.canvasElement.addEventListener("contextmenu", (e) =>
      e.preventDefault()
    );

    // События мыши
    this.canvasElement.addEventListener("mousedown", (e) =>
      this.onMouseDown(e)
    );
    this.canvasElement.addEventListener("mouseup", (e) => this.onMouseUp(e));
    this.canvasElement.addEventListener("mousemove", (e) =>
      this.onMouseMove(e)
    );
    this.canvasElement.addEventListener("dblclick", (e) =>
      this.onDoubleClick(e)
    );

    const leftContainer = document.getElementById("side-panel-left-container");
    const leftToggle = document.getElementById("side-panel-left-toggle");
    const tabs = this.tabsContainer;
    leftToggle.textContent = "<"; // начальное состояние раскрыто
    leftToggle.addEventListener("click", () => {
      leftContainer.classList.toggle("collapsed");
      const collapsed = leftContainer.classList.contains("collapsed");
      leftToggle.textContent = collapsed ? ">" : "<";
      if (tabs) {
        tabs.style.left = collapsed ? "10px" : "280px";
      }
    });

    this.nodeNameInput.addEventListener("input", (e) => {
      if (this.isLoadingProject) return;
      this.onNodeNameChange(e);
      this.pushUndo();
    });

    // Обработчик для сворачивания/разворачивания правой панели
    const container = document.getElementById("side-panel-container");
    const sidePanelToggle = document.getElementById("side-panel-toggle");
    sidePanelToggle.textContent = ">"; // При открытой панели
    sidePanelToggle.addEventListener("click", function () {
      container.classList.toggle("collapsed");
      if (container.classList.contains("collapsed")) {
        sidePanelToggle.textContent = "<";
      } else {
        sidePanelToggle.textContent = ">";
      }
    });

    // Обработчики кнопок выбора оператора
    /*this.operatorButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const selectedNodes = this.graph.getSelectedNodes();
        if (selectedNodes.length === 1) {
          const node = selectedNodes[0];
          // Читаем оператор из data-op
          const op = btn.dataset.op; // "", "V", "&", "⊕"
          node.operator = op;
          this.draw();
          this.updateNodeList();
          this.pushUndo();
        }
      });
    });*/

    // Обработчики кнопок выбора значения
    /*this.valueButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const selectedNodes = this.graph.getSelectedNodes();
        if (selectedNodes.length === 1) {
          const node = selectedNodes[0];
          // Читаем значение из data-val
          const val = btn.dataset.val; // "", "1", "0"
          node.forcedValue = val === "" ? null : val;
          this.draw();
          this.updateNodeList();
          this.pushUndo();
        }
      });
    });*/

    // Кнопки выбора формы узла
    this.shapeButtons = document.querySelectorAll(".shape-btn");
    this.shapeButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        // сброс выбора объектов
        this.newObjectType = null;
        this.objectButtons.forEach((b) => b.classList.remove("active"));
        this.newCustomNodeType = null;
        this.highlightCustomNodeButton(null);

        // выбор формы для новых узлов
        this.newNodeShapeType = btn.dataset.shape;
        this.highlightShapeButton(this.newNodeShapeType);
      });
    });
    this.highlightShapeButton(this.newNodeShapeType);

    // Кнопки выбора объектов
    this.objectButtons = document.querySelectorAll(".object-btn");
    this.objectButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        // сброс формы узлов
        this.newNodeShapeType = null;
        this.highlightShapeButton(null);

        // выбор типа для новых объектов
        this.newObjectType = btn.dataset.obj;
        this.objectButtons.forEach((b) =>
          b.classList.toggle("active", b === btn)
        );
        // сброс пользовательского узла
        this.newCustomNodeType = null;
        this.highlightCustomNodeButton(null);
      });
    });

    // Кнопки пользовательских узлов
    this.updateCustomNodeButtons();

    // Кнопка «Запустить» для расчёта булевой логики
    /*this.runLogicBtn.addEventListener("click", () => {
      this.calcBooleanLogic();
      this.draw();
      this.pushUndo();
    });*/

    // Обработчик зума: колесико мыши
    this.canvasElement.addEventListener("wheel", (e) => {
      e.preventDefault();
      const zoomFactor = 1.1;

      // Определяем позицию мыши в пределах канваса
      const rect = this.canvasElement.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      // Переводим позицию мыши в мировые координаты
      const worldMouseX = (mouseX - this.offset.x) / this.scale;
      const worldMouseY = (mouseY - this.offset.y) / this.scale;

      // Вычисляем новый масштаб
      let newScale = this.scale;
      if (e.deltaY < 0) {
        newScale *= zoomFactor;
      } else {
        newScale /= zoomFactor;
      }

      // Обновляем смещение так, чтобы мировая точка, соответствующая позиции мыши, оставалась неизменной
      this.offset.x = mouseX - worldMouseX * newScale;
      this.offset.y = mouseY - worldMouseY * newScale;
      this.scale = newScale;

      this.draw();
    });

    // Горячие клавиши для Undo/Redo и ctrl+c, ctrl+v, ctrl+shift+g
    window.addEventListener("keydown", (e) => {
      // Переключение привязки к сетке: Ctrl+Shift+G
      if (e.ctrlKey && e.shiftKey && e.code === "KeyG") {
        e.preventDefault();
        this.snapToGrid = !this.snapToGrid;
        console.log("Snap to grid: " + this.snapToGrid);
        return;
      }

      // Обработка ctrl+c – копирование
      if ((e.ctrlKey || e.metaKey) && e.code === "KeyC") {
        e.preventDefault();
        this.copySelection();
        return;
      }
      // Обработка ctrl+v – вставка
      if ((e.ctrlKey || e.metaKey) && e.code === "KeyV") {
        e.preventDefault();
        this.pasteClipboard();
        return;
      }

      // Ctrl+Z
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.code === "KeyZ") {
        e.preventDefault();
        this.undo();
      }
      // Ctrl+Shift+Z
      else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === "KeyZ") {
        e.preventDefault();
        this.redo();
      }
      // Удаление (Delete)
      if (e.key === "Delete") {
        this.deleteSelected();
        this.pushUndo();
      }
    });

    // Кнопки Undo/Redo
    if (this.undoBtn) {
      this.undoBtn.addEventListener("click", () => this.undo());
    }
    if (this.redoBtn) {
      this.redoBtn.addEventListener("click", () => this.redo());
    }

    // Взаимодействие со списком узлов
    this.nodeList.addEventListener("click", (e) => this.onNodeListClick(e));

    // Сохранение/загрузка
    this.saveBtn.addEventListener("click", () => this.openSaveManager("save"));
    this.loadBtn.addEventListener("click", () => this.openSaveManager("load"));

    // Скрываем контекстное меню при клике вне его
    document.addEventListener("click", () => {
      this.contextMenu.style.display = "none";
    });

    // Обработчик для сворачивания/разворачивания секций боковой панели
    document.querySelectorAll(".collapsible-header").forEach((header) => {
      header.addEventListener("click", () => {
        header.classList.toggle("collapsed");
        const content = header.nextElementSibling;
        content.classList.toggle("collapsed");
      });
    });

    // Обработчики для модального окна:
    document
      .querySelector("#save-manager-modal .close-button")
      .addEventListener("click", () => {
        this.closeSaveManager();
      });

    // Обработчик для кнопки в модальном окне (в зависимости от режима)
    this.saveActionBtn.addEventListener("click", async () => {
      if (this.saveMode !== "save") return;
      const name = this.saveNameInput.value.trim();
      if (!name) {
        alert("Введите имя сохранения");
        return;
      }
      try {
        await this.saveProjectServer(name);
        this.closeSaveManager();
      } catch (err) {
        alert(err.message || "Не удалось сохранить проект");
      }
    });

    const infoButton = document.getElementById("info-button");
    const infoModal = document.getElementById("info-modal");
    const infoClose = infoModal.querySelector(".close-button");
    // Показать модал
    infoButton.addEventListener("click", (e) => {
      e.stopPropagation();
      infoModal.style.display = "flex";
    });

    // Скрыть при клике на крестик
    infoClose.addEventListener("click", (e) => {
      e.stopPropagation();
      infoModal.style.display = "none";
    });

    // Скрыть, если кликнули вне .modal-content
    infoModal.addEventListener("click", (e) => {
      if (e.target === infoModal) {
        infoModal.style.display = "none";
      }
    });

    // Чтобы контекстное меню не перекрыло справку
    document.addEventListener("click", () => {
      this.contextMenu.style.display = "none";
    });
  }

  highlightShapeButton(shape) {
    this.shapeButtons.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.shape === shape);
    });
  }

  highlightCustomNodeButton(name) {
    if (!this.customNodeButtons) return;
    this.customNodeButtons.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.custom === name);
    });
  }

  deleteCustomNode(name) {
    if (!confirm(`Удалить узел "${name}" вместе с содержимым?`)) return;
    const subs = this._getAllSubgraphs();
    const prefix = `main\\${name}`;
    Object.keys(subs.graphs).forEach((k) => {
      if (k === prefix || k.startsWith(prefix + "\\")) {
        delete subs.graphs[k];
      }
    });
    delete subs.shapes[name];
    this._setAllSubgraphs(subs);
    if (this.currentPath.join("\\").startsWith(prefix)) {
      this.currentPath = ["main"];
      this.setCurrentState(subs.graphs["main"]);
      this.updateBreadcrumb();
    }
    this.updateCustomNodeButtons();
    this.updateNodeList();
    this.draw();
  }

  updateCustomNodeButtons() {
    const container = document.getElementById("custom-node-controls");
    if (!container) return;
    container.innerHTML = "";
    const { graphs, shapes } = this._getAllSubgraphs();
    const names = Object.keys(graphs)
      .filter((k) => k.startsWith("main\\") && k.split("\\").length === 2)
      .map((k) => k.split("\\")[1])
      .filter((n) => {
        const g = graphs[`main\\${n}`];
        return g.nodes.length > 0 || g.edges.length > 0 || g.objects.length > 0;
      });
    const unique = [...new Set(names)];
    if (!unique.includes(this.newCustomNodeType)) {
      this.newCustomNodeType = null;
    }
    unique.forEach((name) => {
      const item = document.createElement("div");
      item.classList.add("custom-node-item");

      const btn = document.createElement("button");
      btn.classList.add("custom-node-btn");
      btn.dataset.custom = name;
      const shape = shapes[name];
      if (shape) btn.dataset.shape = shape;
      btn.textContent = name;
      btn.addEventListener("click", () => {
        this.objectButtons.forEach((b) => b.classList.remove("active"));
        this.newObjectType = null;
        this.newCustomNodeType = name;
        if (shape) {
          this.newNodeShapeType = shape;
          this.highlightShapeButton(this.newNodeShapeType);
        }
        this.highlightCustomNodeButton(name);
      });

      const del = document.createElement("button");
      del.classList.add("delete-custom-node-btn");
      del.textContent = "✕";
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        this.deleteCustomNode(name);
      });

      item.appendChild(btn);
      item.appendChild(del);
      container.appendChild(item);
    });
    this.customNodeButtons = container.querySelectorAll(".custom-node-btn");
    this.highlightCustomNodeButton(this.newCustomNodeType);
  }

  // метод обновления хлебных крошек
  updateBreadcrumb() {
    // используем backslash
    this.pathDisplay.textContent = "\\" + this.currentPath.join("\\");
    // кликабельные сегменты
    this.pathDisplay.innerHTML = this.currentPath
      .map((seg, i) => `<a href="#" data-idx="${i}">${seg}</a>`)
      .join("\\");
    this.pathDisplay
      .querySelectorAll("a")
      .forEach((a) =>
        a.addEventListener("click", (e) =>
          this.navigateTo(+e.target.dataset.idx)
        )
      );
  }

  updateTabs() {
    if (!this.tabsContainer) return;
    this.tabsContainer.innerHTML = "";
    const current = this.currentPath.join("\\");
    this.tabs.forEach((path) => {
      const tab = document.createElement("div");
      tab.classList.add("tab");
      if (path === current) tab.classList.add("active");
      const name = path.split("\\").pop();
      tab.textContent = name;
      if (path !== "main") {
        const close = document.createElement("span");
        close.classList.add("close-tab");
        close.textContent = "\u2715"; // крестик
        close.addEventListener("click", (e) => {
          e.stopPropagation();
          this.closeTab(path);
        });
        tab.appendChild(close);
      }
      tab.addEventListener("click", () => {
        this.openTab(path);
        this.navigateToPath(path);
      });
      this.tabsContainer.appendChild(tab);
    });
  }

  openTab(path) {
    if (!this.tabs.includes(path)) {
      this.tabs.push(path);
    }
    this.updateTabs();
  }

  closeTab(path) {
    const idx = this.tabs.indexOf(path);
    if (idx === -1) return;
    this.tabs.splice(idx, 1);
    if (path === this.currentPath.join("\\")) {
      const next =
        this.tabs[idx] || this.tabs[idx - 1] || this.tabs[0] || "main";
      this.navigateToPath(next);
    } else {
      this.updateTabs();
    }
  }

  navigateToPath(path) {
    const { graphs, shapes } = this._getAllSubgraphs();
    graphs[this.currentPath.join("\\")] = this.getCurrentState();
    this._setAllSubgraphs({ graphs, shapes });

    this.currentPath = path.split("\\");
    this.updateBreadcrumb();

    if (graphs[path]) {
      this.setCurrentState(graphs[path]);
    } else {
      this.graph = new Graph();
      this.canvas.clear();
      this.draw();
    }
    this.updateNodeList();
    this.updateCustomNodeButtons();
    this.updateTabs();
  }

  updateTabs() {
    if (!this.tabsContainer) return;
    this.tabsContainer.innerHTML = "";
    const current = this.currentPath.join("\\");
    this.tabs.forEach((path) => {
      const tab = document.createElement("div");
      tab.classList.add("tab");
      if (path === current) tab.classList.add("active");
      const name = path.split("\\").pop();
      tab.textContent = name;
      if (path !== "main") {
        const close = document.createElement("span");
        close.classList.add("close-tab");
        close.textContent = "\u2715"; // крестик
        close.addEventListener("click", (e) => {
          e.stopPropagation();
          this.closeTab(path);
        });
        tab.appendChild(close);
      }
      tab.addEventListener("click", () => {
        this.openTab(path);
        this.navigateToPath(path);
      });
      this.tabsContainer.appendChild(tab);
    });
  }

  openTab(path) {
    if (!this.tabs.includes(path)) {
      this.tabs.push(path);
    }
    this.updateTabs();
  }

  closeTab(path) {
    const idx = this.tabs.indexOf(path);
    if (idx === -1) return;
    this.tabs.splice(idx, 1);
    if (path === this.currentPath.join("\\")) {
      const next =
        this.tabs[idx] || this.tabs[idx - 1] || this.tabs[0] || "main";
      this.navigateToPath(next);
    } else {
      this.updateTabs();
    }
  }

  navigateToPath(path) {
    const { graphs, shapes } = this._getAllSubgraphs();
    graphs[this.currentPath.join("\\")] = this.getCurrentState();
    this._setAllSubgraphs({ graphs, shapes });

    this.currentPath = path.split("\\");
    this.updateBreadcrumb();

    if (graphs[path]) {
      this.setCurrentState(graphs[path]);
    } else {
      this.graph = new Graph();
      this.canvas.clear();
      this.draw();
    }
    this.updateNodeList();
    this.updateCustomNodeButtons();
    this.updateTabs();
  }

  // методы навигации
  navigateInto(node) {
    const nodeName = typeof node === "string" ? node : node.name;
    // 1) сохраняем текущий подграф и форму узла при необходимости
    const { graphs, shapes } = this._getAllSubgraphs();
    graphs[this.currentPath.join("\\")] = this.getCurrentState();
    if (typeof node !== "string" && this.currentPath.length === 1) {
      shapes[node.name] = node.shapeType;
    }
    this._setAllSubgraphs({ graphs, shapes });

    // 2) углубляемся
    this.currentPath.push(nodeName);
    this.updateBreadcrumb();
    this.openTab(this.currentPath.join("\\"));

    // 3) загружаем или создаём новый граф
    const key = this.currentPath.join("\\");
    if (graphs[key]) {
      this.setCurrentState(graphs[key]);
    } else {
      this.graph = new Graph();
      this.canvas.clear();
      this.draw();
    }
    this.updateNodeList();
    this.updateCustomNodeButtons();
  }

  navigateTo(idx) {
    // 1) сохраняем текущий подграф
    const { graphs, shapes } = this._getAllSubgraphs();
    graphs[this.currentPath.join("\\")] = this.getCurrentState();
    this._setAllSubgraphs({ graphs, shapes });

    // 2) обрезаем путь
    this.currentPath = this.currentPath.slice(0, idx + 1);
    this.updateBreadcrumb();
    this.openTab(this.currentPath.join("\\"));

    // 3) загружаем нужный
    const key = this.currentPath.join("\\");
    this.setCurrentState(graphs[key]);
    this.updateNodeList();
    this.updateCustomNodeButtons();
  }

  // При изменении оператора
  /*onNodeOperatorChange(e) {
    const selectedNodes = this.graph.getSelectedNodes();
    if (selectedNodes.length === 1) {
      const node = selectedNodes[0];
      node.operator = e.target.value; // "", "V", "&", "⊕"
      this.draw();
      this.updateNodeList();
      this.pushUndo();
    }
  }*/

  // При изменении значения
  /*onNodeValueChange(e) {
    const selectedNodes = this.graph.getSelectedNodes();
    if (selectedNodes.length === 1) {
      const node = selectedNodes[0];
      const val = e.target.value; // "", "1", "0"
      node.forcedValue = val === "" ? null : val;
      this.draw();
      this.updateNodeList();
      this.pushUndo();
    }
  }*/

  // Основной метод для вычисления булевой логики
  /*calcBooleanLogic() {
    // 1) Сначала сбрасываем computedValue в forcedValue (если есть)
    for (const node of this.graph.nodes) {
      if (node.forcedValue !== null) {
        node.computedValue = node.forcedValue; // "1" или "0"
      } else {
        node.computedValue = null;
      }
    }

    // 2) Выполняем итерации, пока есть изменения (или ограничимся ~10 итерациями)
    let changed = true;
    const maxIterations = 10;
    let iterationCount = 0;

    while (changed && iterationCount < maxIterations) {
      changed = false;
      iterationCount++;

      for (const node of this.graph.nodes) {
        // Если у узла есть forcedValue, то он не пересчитывается
        if (node.forcedValue !== null) {
          continue;
        }
        // Если оператор не задан, то computedValue = null (уже установлено)
        if (!node.operator) {
          continue;
        }

        // Сбор входных значений от всех узлов, ведущих к данному
        const incomingEdges = this.graph.edges.filter((e) => e.toNode === node);
        // Преобразуем входные значения в массив "0"/"1"/null
        const inputValues = incomingEdges.map((e) => e.fromNode.computedValue);

        // Для упрощения: null считаем как "0"
        const boolValues = inputValues.map((v) => (v === "1" ? 1 : 0));

        // Вычисляем новое значение на основе оператора
        let newValue = null; // "1" или "0"
        if (node.operator === "V") {
          // OR (логическое ИЛИ)
          const orResult = boolValues.reduce((acc, val) => acc || val, 0);
          newValue = orResult ? "1" : "0";
        } else if (node.operator === "&") {
          // AND (логическое И)
          // Если нет входных узлов, по желанию можно считать 0 или 1.
          // Предположим, если входов нет, то пусть будет 0
          const andResult = boolValues.reduce((acc, val) => acc && val, 1);
          newValue = andResult ? "1" : "0";
        } else if (node.operator === "⊕") {
          // XOR (исключающее ИЛИ)
          // Считаем XOR всех входных (null => 0)
          const xorResult = boolValues.reduce((acc, val) => acc ^ val, 0);
          newValue = xorResult ? "1" : "0";
        }

        // Сравниваем с текущим значением
        if (node.computedValue !== newValue) {
          node.computedValue = newValue;
          changed = true;
        }
      }
    }

    // После окончания итераций в node.computedValue хранятся итоговые значения
    // Отрисуем результат
    this.draw();
  }*/

  // Возвращает координаты с учётом масштаба и смещения
  getMousePos(e) {
    const rect = this.canvasElement.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left - this.offset.x) / this.scale,
      y: (e.clientY - rect.top - this.offset.y) / this.scale,
    };
  }

  // ----------------------------
  // Методы Undo/Redo
  // ----------------------------

  // Сохраняем текущее состояние в undoStack и очищаем redoStack
  pushUndo() {
    const current = JSON.stringify(this.getCurrentState());
    this.undoStack.push(current);
    this.redoStack = [];
  }

  // Получаем текущее состояние (граф, смещение, масштаб, объекты)
  getCurrentState() {
    return {
      scale: this.scale,
      offset: { x: this.offset.x, y: this.offset.y },
      nextNodeId: this.graph.nextNodeId,
      nextEdgeId: this.graph.nextEdgeId,
      nextObjectId: this.graph.nextObjectId,
      nodes: this.graph.nodes.map((n) => ({
        id: n.id,
        x: n.x,
        y: n.y,
        name: n.name,
        //operator: n.operator,
        //forcedValue: n.forcedValue,
        shapeType: n.shapeType,
        base: n.base,
        rel: n.rel,
      })),
      edges: this.graph.edges.map((e) => ({
        id: e.id,
        from: e.fromNode.id,
        to: e.toNode ? e.toNode.id : null,
      })),
      objects: this.graph.objects.map((o) => ({
        id: o.id,
        x: o.x,
        y: o.y,
        type: o.type,
        scaleX: o.scaleX, // теперь сохраняем оба масштаба
        scaleY: o.scaleY,
        color: o.color,
        selected: o.selected,
      })),
    };
  }

  // Восстанавливаем состояние из объекта
  setCurrentState(state) {
    this.scale = state.scale;
    this.offset = { x: state.offset.x, y: state.offset.y };

    // Пересоздаём граф
    this.graph = new Graph();

    // 1) Восстанавливаем узлы
    state.nodes.forEach((nData) => {
      const node = this.graph.addNode(nData.x, nData.y);
      if (node) {
        node.id = nData.id;
        node.name = nData.name;
        //node.operator = nData.operator;
        //node.forcedValue = nData.forcedValue;
        node.shapeType = nData.shapeType;
        node.base = nData.base;
        node.rel = nData.rel;
      }
    });
    this.graph.nextNodeId = state.nextNodeId;

    // 2) Восстанавливаем связи
    state.edges.forEach((eData) => {
      const fromNode = this.graph.nodes.find((n) => n.id === eData.from);
      if (fromNode) {
        if (eData.to !== null) {
          const toNode = this.graph.nodes.find((n) => n.id === eData.to);
          if (toNode) {
            const edge = this.graph.addEdge(fromNode, toNode);
            edge.id = eData.id;
          }
        } else {
          const temp = this.graph.addTempEdge(fromNode, 0, 0);
          temp.id = eData.id;
        }
      }
    });
    this.graph.nextEdgeId = state.nextEdgeId;

    // 3) Восстанавливаем объекты
    state.objects.forEach((oData) => {
      const o = this.graph.addObject(oData.x, oData.y, oData.type);
      o.id = oData.id;
      o.scaleX = oData.scaleX;
      o.scaleY = oData.scaleY;
      o.color = oData.color;
      o.selected = oData.selected;
    });
    this.graph.nextObjectId = state.nextObjectId;

    // Финальная отрисовка
    this.updateNodeList();
    this.draw();
  }

  undo() {
    if (this.undoStack.length > 0) {
      // Текущее состояние кладём в redoStack
      const current = JSON.stringify(this.getCurrentState());
      this.redoStack.push(current);

      // Берём последнее из undoStack и откатываемся
      const prev = JSON.parse(this.undoStack.pop());
      this.setCurrentState(prev);
    }
  }

  redo() {
    if (this.redoStack.length > 0) {
      // Текущее состояние кладём в undoStack
      const current = JSON.stringify(this.getCurrentState());
      this.undoStack.push(current);

      // Берём последнее из redoStack и восстанавливаем
      const next = JSON.parse(this.redoStack.pop());
      this.setCurrentState(next);
    }
  }

  // ----------------------------
  // События мыши
  // ----------------------------

  onMouseDown(e) {
    const pos = this.getMousePos(e);

    // 0) Обработка «ручек» для изменения размеров объектов
    for (let o of this.graph.getSelectedObjects()) {
      const w = 20 * o.scaleX;
      const h = 20 * o.scaleY;
      const hs = 6 / this.scale;
      const handles = {
        nw: { x: o.x - w, y: o.y - h },
        ne: { x: o.x + w, y: o.y - h },
        se: { x: o.x + w, y: o.y + h },
        sw: { x: o.x - w, y: o.y + h },
      };
      for (let [name, c] of Object.entries(handles)) {
        if (
          pos.x >= c.x - hs &&
          pos.x <= c.x + hs &&
          pos.y >= c.y - hs &&
          pos.y <= c.y + hs
        ) {
          this.resizingObject = o;
          this.resizingHandle = name;
          this.resizeStart = {
            x: pos.x,
            y: pos.y,
            scaleX: o.scaleX,
            scaleY: o.scaleY,
          };
          return;
        }
      }
    }

    // 1) Левая кнопка мыши
    if (e.button === 0) {
      // 1.1) Клик по узлу
      const node = this.graph.getNodeAt(pos.x, pos.y);
      if (node) {
        if (e.ctrlKey || e.metaKey) {
          node.selected = true;
        } else if (!node.selected) {
          this.graph.clearSelection();
          this.graph.clearObjectSelection();
          node.selected = true;
        }

        // Начинаем групповое перемещение
        this.groupDragging = true;
        this.groupDragStartPos = { x: pos.x, y: pos.y };

        // Запоминаем исходные позиции всех выделенных узлов и объектов
        this.groupDragStartPositions = {};
        this.graph.getSelectedNodes().forEach((n) => {
          this.groupDragStartPositions[n.id] = { x: n.x, y: n.y };
        });
        this.groupDragStartPositionsObjects = {};
        this.graph.getSelectedObjects().forEach((o2) => {
          this.groupDragStartPositionsObjects[o2.id] = { x: o2.x, y: o2.y };
        });

        // Запоминаем «главный» узел, за который тянем
        this.primaryDragNode = node;

        this.updateNodeList();
        this.draw();
        return;
      }

      // 1.2) Клик по объекту
      const obj = this.graph.getObjectAt(pos.x, pos.y);
      if (obj) {
        if (e.ctrlKey || e.metaKey) {
          obj.selected = true;
        } else if (!obj.selected) {
          this.graph.clearSelection();
          this.graph.clearObjectSelection();
          obj.selected = true;
        }

        this.groupDragging = true;
        this.groupDragStartPos = { x: pos.x, y: pos.y };

        this.groupDragStartPositions = {};
        this.graph.getSelectedNodes().forEach((n) => {
          this.groupDragStartPositions[n.id] = { x: n.x, y: n.y };
        });
        this.groupDragStartPositionsObjects = {};
        this.graph.getSelectedObjects().forEach((o2) => {
          this.groupDragStartPositionsObjects[o2.id] = { x: o2.x, y: o2.y };
        });

        // Запоминаем «главный» объект, за который тянем
        this.primaryDragObject = obj;

        this.updateNodeList();
        this.draw();
        return;
      }

      // 1.3) Клик по пустому месту — начинаем рамочную селекцию
      this.graph.clearSelection();
      this.graph.clearObjectSelection();
      this.updateNodeList();
      this.draw();

      this.isSelectingArea = true;
      this.selectionStart = pos;
      this.selectionRect = { x: pos.x, y: pos.y, width: 0, height: 0 };
    }

    // 2) Правая кнопка мыши — временная связь или панорамирование
    else if (e.button === 2) {
      const node = this.graph.getNodeAt(pos.x, pos.y);
      if (node) {
        this.tempEdge = this.graph.addTempEdge(node, pos.x, pos.y);
      } else {
        this.rightMouseDownInEmptyArea = true;
        this.panStart = { x: e.clientX, y: e.clientY };
        this.panOffsetStart = { x: this.offset.x, y: this.offset.y };
      }
    }
  }

  onMouseMove(e) {
    const pos = this.getMousePos(e);

    if (this.groupDragging && (!this.groupDragStartPos || !this.groupDragStartPositions)) {
      return;
    }

    // 0) Изменение размера выделенного объекта
    if (this.resizingObject) {
      const o = this.resizingObject;
      const offX = Math.abs(pos.x - o.x);
      const offY = Math.abs(pos.y - o.y);
      o.scaleX = Math.max(0.1, offX / 20);
      o.scaleY = Math.max(0.1, offY / 20);
      this.draw();
      return;
    }

    // 1) Групповое перетаскивание узлов и объектов
    if (this.groupDragging) {
      // если data для группового драга не инициализированы — выходим
      if (!this.groupDragStartPos
          || !this.groupDragStartPositions
          || !this.groupDragStartPositionsObjects) {
        return;
      }
      const dx = pos.x - this.groupDragStartPos.x;
      const dy = pos.y - this.groupDragStartPos.y;

      // — Перемещение узлов —
      if (this.snapToGrid && this.primaryDragNode) {
        // Сначала «привязываем» первичный узел
        const start0 = this.groupDragStartPositions[this.primaryDragNode.id];
        const rawX0 = start0.x + dx;
        const rawY0 = start0.y + dy;
        const snapX0 = Math.round(rawX0 / this.gridStep) * this.gridStep;
        const snapY0 = Math.round(rawY0 / this.gridStep) * this.gridStep;
        const dxEff = snapX0 - start0.x;
        const dyEff = snapY0 - start0.y;

        // Применяем тот же сдвиг ко всем выделенным узлам
        this.graph.getSelectedNodes().forEach((n) => {
          const start = this.groupDragStartPositions[n.id];
          if (n === this.primaryDragNode) {
            n.setPosition(snapX0, snapY0);
          } else {
            n.setPosition(start.x + dxEff, start.y + dyEff);
          }
        });
      } else {
        // Обычное групповое перемещение без привязки
        this.graph.getSelectedNodes().forEach((n) => {
          const start = this.groupDragStartPositions[n.id];
          n.setPosition(start.x + dx, start.y + dy);
        });
      }

      // — Перемещение объектов —
      if (this.snapToGrid && this.primaryDragObject) {
        const start0 =
          this.groupDragStartPositionsObjects[this.primaryDragObject.id];
        const rawX0 = start0.x + dx;
        const rawY0 = start0.y + dy;
        const snapX0 = Math.round(rawX0 / this.gridStep) * this.gridStep;
        const snapY0 = Math.round(rawY0 / this.gridStep) * this.gridStep;
        const dxEff = snapX0 - start0.x;
        const dyEff = snapY0 - start0.y;

        this.graph.getSelectedObjects().forEach((o) => {
          const start = this.groupDragStartPositionsObjects[o.id];
          if (o === this.primaryDragObject) {
            o.x = snapX0;
            o.y = snapY0;
          } else {
            o.x = start.x + dxEff;
            o.y = start.y + dyEff;
          }
        });
      } else {
        this.graph.getSelectedObjects().forEach((o) => {
          const start = this.groupDragStartPositionsObjects[o.id];
          o.x = start.x + dx;
          o.y = start.y + dy;
        });
      }

      this.draw();
      return;
    }

    // 2) Перетаскивание одиночного узла
    if (this.draggingNode && !this.isSelectingArea) {
      let x = pos.x - this.dragOffsetX;
      let y = pos.y - this.dragOffsetY;
      if (this.snapToGrid) {
        x = Math.round(x / this.gridStep) * this.gridStep;
        y = Math.round(y / this.gridStep) * this.gridStep;
      }
      this.draggingNode.setPosition(x, y);
      this.draw();
      return;
    }

    // 3) Обновление временной связи
    if (this.tempEdge) {
      this.tempEdge.setTempEnd(pos.x, pos.y);
      this.draw();
    }

    // 4) Рамочное выделение
    if (this.isSelectingArea) {
      // если selectionStart ещё не установлен — отменяем
      if (!this.selectionStart) {
        this.isSelectingArea = false;
        return;
      }
      const x = Math.min(this.selectionStart.x, pos.x);
      const y = Math.min(this.selectionStart.y, pos.y);
      const w = Math.abs(pos.x - this.selectionStart.x);
      const h = Math.abs(pos.y - this.selectionStart.y);
      this.selectionRect = { x, y, width: w, height: h };

      this.graph.clearSelection();
      this.graph.nodes.forEach((n) => {
        if (n.x >= x && n.x <= x + w && n.y >= y && n.y <= y + h) {
          n.selected = true;
        }
      });
      this.updateNodeList();
      this.draw();
    }

    // 5) Панорамирование (ПКМ + движение)
    if (this.rightMouseDownInEmptyArea) {
      const dxPan = e.clientX - this.panStart.x;
      const dyPan = e.clientY - this.panStart.y;
      if (
        !this.isPanning &&
        (Math.abs(dxPan) > this.panThreshold ||
          Math.abs(dyPan) > this.panThreshold)
      ) {
        this.isPanning = true;
      }
      if (this.isPanning) {
        this.offset.x = this.panOffsetStart.x + dxPan;
        this.offset.y = this.panOffsetStart.y + dyPan;
        this.draw();
      }
    }
  }

  onMouseUp(e) {
    const pos = this.getMousePos(e);

    // 0) Завершение режима изменения размеров
    if (this.resizingObject) {
      this.resizingObject = null;
      this.resizingHandle = null;
      this.resizeStart = null;
      this.pushUndo();
      return;
    }

    // 1) Завершение временной связи
    if (this.tempEdge) {
      const targetNode = this.graph.getNodeAt(pos.x, pos.y);
      if (targetNode && targetNode !== this.tempEdge.fromNode) {
        this.tempEdge.toNode = targetNode;
        this.pushUndo();
      } else {
        this.graph.removeEdge(this.tempEdge);
      }
      this.tempEdge = null;
      this.updateNodeList();
      this.draw();
      return;
    }

    // 2) Левая кнопка — финиш перетаскивания или рамочной селекции
    if (e.button === 0) {
      // Групповое перетаскивание
      if (this.groupDragging) {
        this.groupDragging = false;
        // Сброс вспомогательных полей для grid-снаппинга
        this.primaryDragNode = null;
        this.primaryDragObject = null;
        this.groupDragStartPositions = null;
        this.groupDragStartPositionsObjects = null;
        this.pushUndo();
        return;
      }
      // Рамочная селекция
      if (this.isSelectingArea) {
        this.isSelectingArea = false;
        setTimeout(() => {
          this.selectionRect = null;
          this.selectionStart = null;
          this.draw();
        }, 300);
        return;
      }
      return;
    }

    // 3) Правая кнопка — контекстное меню или панорамирование
    if (e.button === 2) {
      if (this.rightMouseDownInEmptyArea) {
        if (!this.isPanning) {
          this.contextMenu.style.left = e.pageX + "px";
          this.contextMenu.style.top = e.pageY + "px";
          this.contextMenu.style.display = "block";
        }
        this.rightMouseDownInEmptyArea = false;
        this.isPanning = false;
        this.panStart = null;
        this.panOffsetStart = null;
      }
    }
  }

  onDoubleClick(e) {
    const pos = this.getMousePos(e);
    if (e.button === 0) {
      const node = this.graph.getNodeAt(pos.x, pos.y);
      if (node && !this.newObjectType) {
        this.navigateInto(node);
        return;
      }
      // 2) Если выбран тип объекта — создаём объект
      if (this.newObjectType) {
        this.graph.clearSelection();
        this.graph.clearObjectSelection();
        const o = this.graph.addObject(pos.x, pos.y, this.newObjectType);
        o.selected = true;
        this.updateNodeList(); // пока в списке узлов объекты не отображаются
        this.draw();
        this.pushUndo();
        return;
      }
      // 2b) Если выбран пользовательский узел
      if (this.newCustomNodeType) {
        this.graph.clearSelection();
        const newNode = this.graph.addNode(pos.x, pos.y);
        if (newNode) {
          const { shapes } = this._getAllSubgraphs();
          const stored = shapes[this.newCustomNodeType];
          newNode.shapeType = stored || this.newNodeShapeType || "circle-solid";
          newNode.name = this.newCustomNodeType;
          newNode.selected = true;
        }
        this.updateNodeList();
        this.draw();
        this.pushUndo();
        return;
      }
      // 3) Иначе — обычное добавление узла
      const existingNode = this.graph.getNodeAt(pos.x, pos.y);
      if (!existingNode) {
        this.graph.clearSelection();
        const newNode = this.graph.addNode(pos.x, pos.y);
        if (newNode) {
          newNode.shapeType = this.newNodeShapeType;
          newNode.selected = true;
        }
        this.updateNodeList();
        this.draw();
        this.pushUndo();
      }
    }
  }

  onNodeListClick(e) {
    const li = e.target.closest("li");
    if (li) {
      const nodeId = parseInt(li.getAttribute("data-id"));
      // Если Ctrl не зажат, сбрасываем выделение
      if (!(e.ctrlKey || e.metaKey)) {
        this.expandedNodes = {};
        this.graph.clearSelection();
        this.graph.edges.forEach((ed) => (ed.selected = false));
      }
      const node = this.graph.nodes.find((n) => n.id === nodeId);
      if (node) {
        node.selected = true;
        this.nodeNameInput.value = node.name;
        //this.highlightOperatorButton(node.operator);
        //this.highlightValueButton(node.forcedValue || "");
        this.draw();
        this.updateNodeList();

        // Панорамирование к узлу, если он не виден полностью
        const nodeScreenX = node.x * this.scale + this.offset.x;
        const nodeScreenY = node.y * this.scale + this.offset.y;
        const canvasWidth = this.canvasElement.clientWidth;
        const canvasHeight = this.canvasElement.clientHeight;
        if (
          nodeScreenX < 0 ||
          nodeScreenX > canvasWidth ||
          nodeScreenY < 0 ||
          nodeScreenY > canvasHeight
        ) {
          this.panToNode(node);
        }
      }
    }
  }

  onNodeNameChange(e) {
    const selectedNodes = this.graph.getSelectedNodes();
    if (selectedNodes.length === 1) {
      selectedNodes[0].name = e.target.value;
      this.draw();
      this.updateNodeList();
    }
  }

  copySelection() {
    const sel = this.graph.getSelectedNodes();
    if (sel.length === 0) return;

    // Копируем в буфер все свойства узла
    this.clipboard = {
      nodes: sel.map((n) => ({
        id: n.id,
        x: n.x,
        y: n.y,
        name: n.name,
        shapeType: n.shapeType,
        base: n.base,
        rel: n.rel,
      })),
      edges: this.graph.edges
        .filter(
          (e) => e.toNode && sel.includes(e.fromNode) && sel.includes(e.toNode)
        )
        .map((e) => ({ from: e.fromNode.id, to: e.toNode.id })),
    };
  }

  async pasteClipboard() {
    if (!this.clipboard) return;
    const oldToNew = {};
    const offset = 80; // достаточно большой сдвиг, чтобы не пересекаться

    // 1) Воссоздаём узлы вручную
    this.graph.clearSelection();
    this.clipboard.nodes.forEach((data) => {
      // создаём новый id
      const newId = this.graph.nextNodeId++;
      // координаты со сдвигом
      const x = data.x + offset;
      const y = data.y + offset;
      // создаём экземпляр узла без проверки коллизий
      const n = new Node(newId, x, y);
      // восстанавливаем все поля
      n.name = data.name;
      n.shapeType = data.shapeType;
      n.base = data.base;
      n.rel = data.rel;
      n.selected = true;
      // добавляем прямо в массив
      this.graph.nodes.push(n);
      oldToNew[data.id] = n;
    });

    // 2) Воссоздаём связи между вставленными узлами
    this.clipboard.edges.forEach((e) => {
      const a = oldToNew[e.from],
        b = oldToNew[e.to];
      if (a && b) {
        this.graph.addEdge(a, b);
      }
    });

    // 3) Обновляем UI и стек undo/redo
    this.pushUndo();
    this.updateNodeList();
    this.draw();
  }

  deleteSelected() {
    // 1) Сначала удаляем выбранные объекты
    const selectedObjects = this.graph.getSelectedObjects();
    if (selectedObjects.length > 0) {
      selectedObjects.forEach((o) => this.graph.removeObject(o));

      // 2) Иначе – связи
    } else {
      const selectedEdges = this.graph.getSelectedEdges();
      if (selectedEdges.length > 0) {
        selectedEdges.forEach((edge) => this.graph.removeEdge(edge));

        // 3) Иначе – узлы
      } else {
        const selectedNodes = this.graph.getSelectedNodes();
        selectedNodes.forEach((node) => this.graph.removeNode(node));
      }
    }
    this.updateNodeList();
    this.draw();
  }

  updateNodeList() {
    // Очищаем список узлов в боковой панели
    this.nodeList.innerHTML = "";

    // Перебираем все узлы
    this.graph.nodes.forEach((node) => {
      // Создаём элемент списка для узла
      const li = document.createElement("li");
      li.setAttribute("data-id", node.id);

      // Заголовок узла (имя + стрелочка раскрытия)
      const headerDiv = document.createElement("div");
      headerDiv.classList.add("node-header");

      // Имя узла
      const nodeNameSpan = document.createElement("span");
      nodeNameSpan.classList.add("node-name");
      nodeNameSpan.textContent = node.name;
      headerDiv.appendChild(nodeNameSpan);

      // Если узел выбран — добавляем стрелочку для раскрытия списка связей
      if (node.selected) {
        const toggleArrow = document.createElement("span");
        toggleArrow.classList.add("toggle-edges");
        toggleArrow.textContent = this.expandedNodes[node.id] ? "▼" : "►";
        toggleArrow.addEventListener("click", (e) => {
          e.stopPropagation();
          this.expandedNodes[node.id] = !this.expandedNodes[node.id];
          this.updateNodeList();
        });
        headerDiv.appendChild(toggleArrow);
      }

      li.appendChild(headerDiv);

      // Подсветка выбранного узла
      if (node.selected) {
        li.classList.add("selected");
        // Синхронизируем поле «Имя» и кнопки оператора/значения
        this.nodeNameInput.value = node.name;
        //this.highlightOperatorButton(node.operator);
        //this.highlightValueButton(node.forcedValue || "");
      }

      // Если узел выбран и раскрыт — отображаем список входящих и исходящих связей
      if (
        node.selected &&
        (this.expandedNodes[node.id] ||
          this.graph.edges.some(
            (edge) =>
              (edge.fromNode === node || edge.toNode === node) && edge.selected
          ))
      ) {
        const edgeList = document.createElement("ul");
        edgeList.classList.add("edge-list");

        // Собираем все завершённые связи, где узел участвует как fromNode или toNode
        const relatedEdges = this.graph.edges.filter(
          (edge) =>
            (edge.fromNode === node || edge.toNode === node) && edge.toNode
        );

        relatedEdges.forEach((edge) => {
          const edgeLi = document.createElement("li");
          edgeLi.classList.add("edge-item");
          edgeLi.setAttribute("data-edge-id", edge.id);
          if (edge.selected) {
            edgeLi.classList.add("selected-edge");
          }

          const edgeVisual = document.createElement("div");
          edgeVisual.classList.add("edge-visual");

          // Зеленый кружок всегда представляет выбранный узел (выделенный)
          const greenCircle = document.createElement("span");
          greenCircle.classList.add("edge-circle", "from-circle");

          // Определяем, является ли связь исходящей (selected узел как fromNode)
          // или входящей (selected узел как toNode)
          const isOutgoing = edge.fromNode === node;
          const otherNode = isOutgoing ? edge.toNode : edge.fromNode;

          // Создаем стрелку в виде inline‑SVG
          const svgNS = "http://www.w3.org/2000/svg";
          const arrow = document.createElementNS(svgNS, "svg");
          arrow.classList.add("edge-arrow");
          arrow.setAttribute("width", "90");
          arrow.setAttribute("height", "20");

          // Создаем группу для отрисовки стрелки
          const g = document.createElementNS(svgNS, "g");
          // Если связь входящая, отражаем группу по горизонтали относительно правого края SVG
          if (!isOutgoing) {
            g.setAttribute("transform", "translate(90,0) scale(-1,1)");
          }

          // Линия стрелки
          const line = document.createElementNS(svgNS, "line");
          line.setAttribute("x1", "0");
          line.setAttribute("y1", "10");
          line.setAttribute("x2", "80");
          line.setAttribute("y2", "10");
          line.setAttribute("stroke", edge.selected ? "#16a085" : "#fff");
          line.setAttribute("stroke-width", "2");
          g.appendChild(line);

          // Стрелочная головка
          const arrowHead = document.createElementNS(svgNS, "polygon");
          arrowHead.setAttribute("points", "80,5 90,10 80,15");
          arrowHead.setAttribute("fill", edge.selected ? "#16a085" : "#fff");
          g.appendChild(arrowHead);

          // Добавляем группу в SVG
          arrow.appendChild(g);

          // Серый кружок для другого узла с его номером
          const grayCircle = document.createElement("span");
          grayCircle.classList.add("edge-circle", "to-circle");
          grayCircle.textContent = otherNode.name; // можно и id

          // Собираем визуальное представление: зеленый кружок, стрелка, серый кружок
          edgeVisual.appendChild(greenCircle);
          edgeVisual.appendChild(arrow);
          edgeVisual.appendChild(grayCircle);

          edgeLi.appendChild(edgeVisual);
          edgeList.appendChild(edgeLi);

          // Один клик по связи — выделяем её
          edgeLi.addEventListener("click", (e) => {
            e.stopPropagation();
            if (e.ctrlKey || e.metaKey) {
              edge.selected = true;
            } else {
              this.graph.edges.forEach((ed) => (ed.selected = false));
              // Если связь исходящая, выделяем узел-источник, иначе оставляем выделенным текущий узел
              if (isOutgoing) {
                edge.fromNode.selected = true;
              }
              edge.selected = true;
            }
            this.draw();
            this.updateNodeList();
          });

          // Двойной клик — панорамируем к другому узлу
          edgeLi.addEventListener("dblclick", (e) => {
            e.stopPropagation();
            this.panToNode(otherNode);
          });
        });

        li.appendChild(edgeList);
      }

      // Клик по li (кроме стрелочки) — выделяем узел
      li.addEventListener("click", (e) => {
        // Если клик произошёл внутри списка связей, не сбрасываем раскрытие узла
        if (e.target.closest(".edge-list")) return;

        if (e.ctrlKey || e.metaKey) {
          // При зажатом Ctrl добавляем узел в выделение (если он еще не выделен)
          node.selected = true;
        } else {
          // Сбрасываем раскрытие у всех узлов и снимаем выделение
          this.expandedNodes = {};
          this.graph.clearSelection();
          this.graph.edges.forEach((ed) => (ed.selected = false));
          node.selected = true;
        }

        // Синхронизируем поле «Имя» и кнопки оператора/значения
        this.nodeNameInput.value = node.name;
        //this.highlightOperatorButton(node.operator);
        //this.highlightValueButton(node.forcedValue || "");
        //this.highlightValueButton(node.forcedValue || "");
        // подсветить кнопку формы текущего выделенного узла
        const sel = this.graph.getSelectedNodes();

        this.draw();
        this.updateNodeList();

        // Панорамирование к узлу, если он не виден полностью
        const nodeScreenX = node.x * this.scale + this.offset.x;
        const nodeScreenY = node.y * this.scale + this.offset.y;
        const canvasWidth = this.canvasElement.clientWidth;
        const canvasHeight = this.canvasElement.clientHeight;
        if (
          nodeScreenX < 0 ||
          nodeScreenX > canvasWidth ||
          nodeScreenY < 0 ||
          nodeScreenY > canvasHeight
        ) {
          this.panToNode(node);
        }
      });

      // Добавляем элемент списка узлов
      this.nodeList.appendChild(li);
    });

    // Автоматическое открытие/закрытие секции свойств узла
    const selectedNodes = this.graph.getSelectedNodes();
    const propertiesContent = document.querySelector(
      "#node-properties-section .section-content"
    );
    if (selectedNodes.length === 1) {
      propertiesContent.classList.remove("collapsed");

      const node = selectedNodes[0];

      // Заполняем Base-select
      this.baseSelect.innerHTML = "";
      this.baseSelect.appendChild(new Option("", "")); // пустой
      this.graph.nodes.forEach((n) =>
        this.baseSelect.appendChild(new Option(n.name, n.name))
      );
      this.baseSelect.value = node.base;

      // Заполняем Rel-select
      this.relSelect.innerHTML = "";
      this.relSelect.appendChild(new Option("", ""));
      this.graph.nodes.forEach((n) =>
        this.relSelect.appendChild(new Option(n.name, n.name))
      );
      this.relSelect.value = node.rel;

      // Если выбран ровно один узел, синхронизируем поле имени и кнопки
      this.nodeNameInput.value = selectedNodes[0].name;
      //this.highlightOperatorButton(selectedNodes[0].operator);
      //this.highlightValueButton(selectedNodes[0].forcedValue || "");
    } else {
      propertiesContent.classList.add("collapsed");
    }

    const selObjs = this.graph.getSelectedObjects();
    if (selObjs.length > 0) {
      this.objectColorPicker.value = selObjs[0].color;
    }
  }

  /*highlightOperatorButton(op) {
    this.operatorButtons.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.op === op);
    });
  }

  highlightValueButton(val) {
    this.valueButtons.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.val === val);
    });
  }*/

  panToNode(node) {
    const canvasWidth = this.canvasElement.clientWidth;
    const canvasHeight = this.canvasElement.clientHeight;
    // Целевые смещения так, чтобы узел оказался в центре канваса
    const targetOffsetX = canvasWidth / 2 - node.x * this.scale;
    const targetOffsetY = canvasHeight / 2 - node.y * this.scale;

    const startOffsetX = this.offset.x;
    const startOffsetY = this.offset.y;
    const deltaX = targetOffsetX - startOffsetX;
    const deltaY = targetOffsetY - startOffsetY;
    const duration = 500; // длительность анимации в мс
    let startTime = null;

    const animate = (timestamp) => {
      if (!startTime) startTime = timestamp;
      const elapsed = timestamp - startTime;
      const t = Math.min(elapsed / duration, 1);
      // Используем easeInOutQuad для плавного перехода
      const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      this.offset.x = startOffsetX + deltaX * ease;
      this.offset.y = startOffsetY + deltaY * ease;
      this.draw();
      if (t < 1) {
        requestAnimationFrame(animate);
      }
    };
    requestAnimationFrame(animate);
  }

  // Открытие модального окна в заданном режиме ('save' или 'load')
  openSaveManager(mode) {
    this.saveMode = mode;
    document.getElementById("save-manager-title").textContent =
      mode === "save" ? "Сохранить проект" : "Загрузить проект";
    // Если в режиме загрузки прячем панель сохранения, иначе показываем
    document.getElementById("save-controls").style.display =
      mode === "save" ? "flex" : "none";
    this.populateSaveList();
    this.saveManagerModal.style.display = "flex";
  }

  // Закрытие модального окна
  closeSaveManager() {
    this.saveManagerModal.style.display = "none";
    this.saveNameInput.value = "";
  }

  // Заполнение списка сохранений
  async populateSaveList() {
    this.saveListDiv.innerHTML = "";
    let projects = [];
    try {
      projects = await this.fetchServerProjects();
    } catch (err) {
      alert(err.message);
      return;
    }
    for (const p of projects) {
      const { id, name } = p;
      const div = document.createElement("div");
      div.classList.add("save-item");

      const label = document.createElement("span");
      label.textContent = name;
      div.appendChild(label);

      div.addEventListener("click", () => {
        if (this.saveMode === "load") {
          this.loadProjectServer(id);
          this.closeSaveManager();
        } else {
          this.saveNameInput.value = name;
          this.currentProjectId = id;
        }
      });

      const delBtn = document.createElement("button");
      delBtn.textContent = "✕";
      delBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (confirm(`Удалить проект «${name}»?`)) {
          this.deleteProjectServer(id);
          this.populateSaveList();
        }
      });
      div.appendChild(delBtn);
      this.saveListDiv.appendChild(div);
    }
    if (this.saveMode === "save") {
      this.saveNameInput.value = "";
    }
  }

  async checkSession() {
    const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
    console.log('▶ checkSession start');
    const authButtons = document.querySelector('.auth-buttons');
    const accountBtn  = document.getElementById('account-btn');
    console.log('  before:', 
      '.auth-buttons exists?', !!authButtons, 
      'hidden?', authButtons?.hidden, 
      '#account-btn exists?', !!accountBtn, 
      'hidden?', accountBtn?.hidden
    );
    console.log('  /api/auth/me →', res.status);

    if (res.ok) {
      this.user = await res.json();
      this.saveBtn.disabled = false;
      this.loadBtn.disabled = false;

      // Скрываем Log In / Sign Up, показываем Аккаунт
      if (authButtons) authButtons.hidden = true;
      if (accountBtn)   accountBtn.hidden   = false;
    } else {
      this.user = null;
      this.saveBtn.disabled = true;
      this.loadBtn.disabled = true;

      // Показываем Log In / Sign Up, прячем Аккаунт
      if (authButtons) authButtons.hidden = false;
      if (accountBtn)  accountBtn.hidden   = true;
    }
    console.log('  after:', 
      '.auth-buttons hidden?', authButtons?.hidden, 
      '#account-btn hidden?', accountBtn?.hidden
    );
  }


  // ======= API для серверных проектов =======
  // 1) список всех проектов
  async fetchServerProjects() {
    const res = await fetch('/api/projects');
    if (!res.ok) throw new Error('Не удалось загрузить проекты');
    return await res.json(); // [{id, name, data}, …]
  }

  // 2) сохранить (создать/обновить)
  async saveProjectServer(name) {
    // 1) Захватываем текущее состояние canvas (nodes+edges и т.п.)
    const state = this.getCurrentState();
    // 2) Берём все подграфы/формы из памяти
    const { graphs, shapes } = this._getAllSubgraphs();
    // 3) Перезаписываем граф активного пути (main или subgraph) на свежий snapshot
    const pathKey = this.currentPath.join('\\');
    graphs[pathKey] = state;
    // Так же, если у вас есть отдельная структура shapes, обновите её из UI
    // shapes = this.canvasApp.getShapesState(); // пример, если нужно
    const project = { graphs, shapes, currentPath: this.currentPath };
    // базовый payload
    const payload = {
      name,
      data: JSON.stringify(project)
    };
    console.log('Saving project, currentProjectId =', this.currentProjectId);
    if (this.currentProjectId) {
      payload.id = this.currentProjectId;
    }
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      throw new Error('Ошибка сохранения');
    }
    const json = await res.json();
    // сохраняем id/имя для последующих «повторов»
    this.currentProjectId   = json.id;
    this.currentProjectName = json.name;
    // чтобы новый проект сразу появился в списке
    await this.populateSaveList();
    alert(`Проект «${json.name}» сохранён на сервере`);
  }

  // 3) загрузить
  async loadProjectServer(id) {
    const projects = await this.fetchServerProjects();
    const p = projects.find(pr => pr.id === id);
    if (!p) { alert('Проект не найден'); return; }
    const project = JSON.parse(p.data);
    this._setAllSubgraphs({ graphs: project.graphs, shapes: project.shapes });
    this.currentPath = project.currentPath || ['main'];
    const pathKey = this.currentPath.join('\\');
    const state =
      project.graphs[pathKey] ||
      project.graphs.main ||
      this.getCurrentState();
    this.setCurrentState(state);
    this.updateBreadcrumb();
    this.tabs = [pathKey];
    this.updateTabs();
    this.currentProjectId   = id;
    this.currentProjectName = p.name;
    alert(`Проект «${p.name}» загружен с сервера`);
    this.undoStack = [];
    this.redoStack = [];
    this.graph.clearSelection();
    this.nodeNameInput.value = '';
    this.updateNodeList();
    this.updateCustomNodeButtons();
    this.draw();
    this.pushUndo();
  }

  // 4) удалить
  async deleteProjectServer(id) {
    const res = await fetch(`/api/projects/${id}`, { method: 'DELETE' });
    if (!res.ok) { alert('Ошибка удаления'); return; }
    alert('Проект удалён с сервера');
  }
  // ======= конец API =======

  draw() {
    // 1) Очистка Canvas
    this.canvas.clear();

    // 2) Сохраняем контекст и применяем панорамирование + масштаб
    this.ctx.save();
    this.ctx.translate(this.offset.x, this.offset.y);
    this.ctx.scale(this.scale, this.scale);

    // 3) Рисуем сетку
    this.canvas.drawGrid(this.scale, this.offset);

    // NEW: precompute all node bounds BEFORE drawing edges
    for (let node of this.graph.nodes) {
      node.computeBounds(this.ctx);
    }

    // 4) Рисуем объекты на Canvas (под узлами и рёбрами)
    for (const o of this.graph.objects) {
      drawObject(this.ctx, o, this.scale);
    }

    // 5) Рисуем связи
    for (let edge of this.graph.edges) {
      edge.draw(this.ctx);
    }

    // 6) Рисуем узлы
    for (let node of this.graph.nodes) {
      node.draw(this.ctx);
    }

    // 7) Рисуем ручки масштабирования для выбранных объектов
    for (let o of this.graph.getSelectedObjects()) {
      this.drawObjectHandles(o);
    }

    // 8) Рисуем рамочную селекцию (если есть)
    if (this.isSelectingArea && this.selectionRect) {
      this.ctx.save();
      this.ctx.strokeStyle = "yellow";
      this.ctx.lineWidth = 1 / this.scale;
      this.ctx.setLineDash([5 / this.scale, 3 / this.scale]);
      const { x, y, width, height } = this.selectionRect;
      this.ctx.strokeRect(x, y, width, height);
      this.ctx.restore();
    }

    // 9) Восстанавливаем контекст
    this.ctx.restore();
  }

  drawObjectHandles(o) {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = "#fff";
    ctx.fillStyle = "#16a085";
    ctx.lineWidth = 1 / this.scale;
    const hs = 6 / this.scale; // половина размера ручки в мировых
    // координатах: 12px экранных
    const w = 20 * o.scaleX;
    const h = 20 * o.scaleY;
    const corners = [
      { x: o.x - w, y: o.y - h, name: "nw" },
      { x: o.x + w, y: o.y - h, name: "ne" },
      { x: o.x + w, y: o.y + h, name: "se" },
      { x: o.x - w, y: o.y + h, name: "sw" },
    ];
    for (let c of corners) {
      ctx.beginPath();
      ctx.rect(c.x - hs, c.y - hs, 2 * hs, 2 * hs);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const authButtons = document.querySelector('.auth-buttons');
  const accountBtn  = document.getElementById('account-btn');
  const accountMenu = document.getElementById('account-menu');
  const menuToggle  = document.querySelector('.menu-toggle');
  const siteMenu    = document.getElementById('site-menu');
  const overlay     = document.getElementById('overlay');
  const logoutBtn   = document.getElementById('logout-btn');

  try {
    const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
    if (res.ok) {
      authButtons.hidden = true;
      accountBtn.hidden  = false;
    } else {
      authButtons.hidden = false;
      accountBtn.hidden  = true;
    }
  } catch {
    authButtons.hidden = false;
    accountBtn.hidden  = true;
  }

  // Открыть/закрыть меню аккаунта
  if (accountBtn && accountMenu && overlay) {
    accountBtn.addEventListener('click', () => {
      // если открыто левое меню — закрываем его
      menuToggle.classList.remove('open');
      siteMenu.classList.remove('open');
      // переключаем правое меню
      accountMenu.classList.toggle('open');
      overlay.classList.toggle('open');
    });
    // Клик по оверлею закрывает всё
    overlay.addEventListener('click', () => {
      menuToggle.classList.remove('open');
      siteMenu.classList.remove('open');
      accountMenu.classList.remove('open');
      overlay.classList.remove('open');
    });
  }

  logoutBtn.addEventListener('click', async () => {
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'same-origin'
    });
    window.location.href = '/';
  });

  menuToggle.addEventListener('click', () => {
    menuToggle.classList.toggle('open');
    siteMenu.classList.toggle('open');
    overlay.classList.toggle('open');
  });
  overlay.addEventListener('click', () => {
    menuToggle.classList.remove('open');
    siteMenu.classList.remove('open');
    overlay.classList.remove('open');
  });
});
