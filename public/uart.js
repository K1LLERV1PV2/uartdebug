// Global variables
let port = null;
let reader = null;
let writer = null;
let currentView = "terminal";
let isReceiving = true;
let oscilloscopeData = [];
let oscilloscopeChart = null;
let zoomLevel = 1;
let panOffset = 0;
let loopInterval = null;
let loopIntervalInput = null;
let byteBuffer = [];
let txView = "text";
let chartZoom = { x: 1, y: 1 };
let chartPan = { x: 0, y: 0 };
let isPanningChart = false;
let isAxisDrag = false;
let axisHoverMode = null;
let axisDragMode = null;
let axisDragStart = { x: 0, y: 0 };
let axisDragScaleStart = { xMin: 0, xMax: 0, yMin: 0, yMax: 0 };
let panStartPos = { x: 0, y: 0 };
let panStartOffset = { x: 0, y: 0 };
let rxBuffer = new Uint8Array(0);
let rxFlushTimer = null;
let rxSilenceMs = 5;
let pendingReceiveStop = false;
let rxPausedByteParity = 0;
let rxResumeDiscardBytes = 0;
let oscilloscopeAutoAlignPending = false;
let oscilloscopeAutoAlignBuffer = [];
let generatorStream = null;
let oscilloscopeInfoTooltipEl = null;
const TX_GENERATOR_INTERVAL_MS = 10;
const TX_TEXT_INTERVAL_MS = 1000;
const TX_INTERVAL_MIN_MS = 10;
const TX_INTERVAL_MAX_MS = 10000;
const GEN_DEFAULT_AMPLITUDE_1BYTE = 100;
const GEN_DEFAULT_AMPLITUDE_2BYTE = 20000;
const GEN_DEFAULT_OFFSET_SIGNED = 0;
const GEN_DEFAULT_OFFSET_UNSIGNED_1BYTE = 128;
const GEN_DEFAULT_OFFSET_UNSIGNED_2BYTE = 32768;
const OSCILLOSCOPE_ALIGN_PROBE_BYTES = 16;
const OSCILLOSCOPE_THEME = {
  signal: "#46ff78",
  overflow: "#ff9c99",
  text: "#c8ffdd",
  muted: "#9fcbb0",
  grid: "rgba(129, 159, 141, 0.18)",
  axis: "rgba(200, 255, 221, 0.12)",
  axisHover: "rgba(200, 255, 221, 0.92)",
};
const TERMINAL_LAYOUT_STORAGE_KEY = "ud_uart_terminal_layout_v1";
const TERMINAL_LAYOUT_PANEL_IDS = ["tx", "rx"];
const TERMINAL_LAYOUT_MIN_PANEL_SIZE = 22;
const TERMINAL_LAYOUT_MAX_PANEL_SIZE = 78;

// DOM elements cache
let terminalSent = null;
let terminalReceived = null;
let txTerminalShell = null;
let rxTerminalShell = null;
let uartSessionsSplit = null;
let terminalLayoutResizer = null;
let terminalInput = null;
let terminalInputPanel = null;
let txGeneratorPanel = null;
let txLogControls = null;
let txModeControls = null;
let txGeneratorOptionsControls = null;
let connectBtn = null;
let sendBtn = null;
let receiveToggleBtn = null;
let statusIndicator = null;
let autoScrollCheckbox = null;
let timestampCheckbox = null;
let oscilloscopeCanvas = null;
let oscilloscopeContainer = null;
let cycleCheckbox = null;
let uartSessions = [];
let terminalLayoutState = {
  layout: "row",
  order: ["tx", "rx"],
  sizes: { tx: 50, rx: 50 },
};
let terminalLayoutDrag = null;
let terminalLayoutResize = null;
let terminalLayoutRefreshFrame = null;
let terminalStartOverlay = null;

// Initialize on page load
document.addEventListener("DOMContentLoaded", function () {
  initializeElements();
  initializeTerminalLayout();
  initializeEventListeners();
  initializeCustomSelects();
  updateTxInputPlaceholder();
  updateTxInputPanelVisibility();
  updateGeneratorUi();
  applyGeneratorOffsetDefaults();
  updateRunButtonState();
  updateReceiveButtonState();
  updateConnectionStatus(false);
  checkWebSerialSupport();
});

/**
 * Initialize DOM element references
 */
function initializeElements() {
  terminalSent = document.getElementById("terminalSent");
  terminalReceived = document.getElementById("terminalReceived");
  txTerminalShell = document.getElementById("txTerminalShell");
  rxTerminalShell = document.getElementById("rxTerminalShell");
  uartSessionsSplit = document.getElementById("uartSessionsSplit");
  terminalLayoutResizer = document.getElementById("terminalLayoutResizer");
  terminalInput = document.getElementById("terminalInput");
  terminalInputPanel = document.querySelector(
    "#uartTxSession .terminal-input-panel"
  );
  txGeneratorPanel = document.getElementById("txGeneratorPanel");
  txLogControls = document.getElementById("txLogControls");
  txModeControls = document.getElementById("txModeControls");
  txGeneratorOptionsControls = document.getElementById(
    "txGeneratorOptionsControls"
  );
  connectBtn = document.getElementById("connectBtn");
  sendBtn = document.getElementById("sendBtn");
  receiveToggleBtn = document.getElementById("receiveToggleBtn");
  loopIntervalInput = document.getElementById("loopIntervalInput");
  statusIndicator = document.getElementById("statusIndicator");
  autoScrollCheckbox = document.getElementById("autoScrollCheckbox");
  timestampCheckbox = document.getElementById("timestampCheckbox");
  oscilloscopeCanvas = document.getElementById("oscilloscopeCanvas");
  oscilloscopeContainer = document.getElementById("oscilloscopeContainer");
  cycleCheckbox = document.getElementById("cycleCheckbox");
  terminalStartOverlay = document.getElementById("terminalStartOverlay");
  uartSessions = Array.from(document.querySelectorAll(".uart-session"));
}

/**
 * Initialize all event listeners
 */
function initializeEventListeners() {
  // Connection button
  connectBtn.addEventListener("click", toggleConnection);
  terminalStartOverlay?.addEventListener("click", handleTerminalStart);

  // Run/Stop button and input
  sendBtn.addEventListener("click", handleRunAction);
  terminalInput.addEventListener("keypress", function (e) {
    if (e.key === "Enter") {
      handleRunAction();
    }
  });

  // Receive toggle
  receiveToggleBtn?.addEventListener("click", toggleReceiving);

  // Cycle checkbox
  cycleCheckbox?.addEventListener("change", handleCycleChange);

  // Loop interval input
  loopIntervalInput.addEventListener("change", function () {
    getNormalizedLoopIntervalMs(
      txView === "generator" ? TX_GENERATOR_INTERVAL_MS : TX_TEXT_INTERVAL_MS
    );
    // If loop is active, restart with new interval
    if (loopInterval) {
      stopLoopSend();
      startLoopSend();
    }
  });

  // Clear and save buttons
  document
    .getElementById("clearBtn")
    ?.addEventListener("click", clearTxTerminal);
  document
    .getElementById("clearBtnRx")
    ?.addEventListener("click", clearRxTerminal);
  document.getElementById("saveLogBtn")?.addEventListener("click", saveTxLog);
  document
    .getElementById("saveLogBtnRx")
    ?.addEventListener("click", saveRxLog);

  // Settings modal
  document
    .getElementById("settingsBtn")
    .addEventListener("click", openSettings);
  document
    .getElementById("modalCloseBtn")
    .addEventListener("click", closeSettings);

  // Close modal when clicking outside
  document
    .getElementById("settingsModal")
    .addEventListener("click", function (e) {
      if (e.target === this) {
        closeSettings();
      }
    });

  // Mode radio buttons
  document.querySelectorAll('input[name="txMode"]').forEach((radio) => {
    radio.addEventListener("change", handleTxModeChange);
  });
  document.querySelectorAll('input[name="rxMode"]').forEach((radio) => {
    radio.addEventListener("change", handleRxModeChange);
  });

  // View toggle radios
  document.querySelectorAll('input[name="rxView"]').forEach((radio) => {
    radio.addEventListener("change", handleViewChange);
  });

  // Tx view toggle radios
  document.querySelectorAll('input[name="txView"]').forEach((radio) => {
    radio.addEventListener("change", handleTxViewChange);
  });

  // Oscilloscope controls
  document
    .getElementById("oscilloResetBtn")
    .addEventListener("click", resetChartView);
  document
    .getElementById("oscilloClearBtn")
    .addEventListener("click", clearOscilloscope);
  document
    .getElementById("oscilloDownloadBtn")
    ?.addEventListener("click", downloadOscilloscopeImage);
  document
    .getElementById("oscilloFullscreenBtn")
    ?.addEventListener("click", toggleOscilloscopeFullscreen);

  document.querySelectorAll('input[name="signMode"]').forEach((radio) => {
    radio.addEventListener("change", updateOscilloscopeSettings);
  });

  document.querySelectorAll('input[name="byteSize"]').forEach((radio) => {
    radio.addEventListener("change", updateOscilloscopeSettings);
  });

  document.getElementById("genWaveform")?.addEventListener("change", () => {
    updateGeneratorUi();
  });
  document.querySelectorAll('input[name="genByteSize"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      applyGeneratorByteSizeDefaults();
      applyGeneratorOffsetDefaults();
    });
  });
  document.querySelectorAll('input[name="genSignMode"]').forEach((radio) => {
    radio.addEventListener("change", applyGeneratorOffsetDefaults);
  });

  document.addEventListener(
    "fullscreenchange",
    updateOscilloscopeFullscreenState
  );
}

function initializeTerminalLayout() {
  if (!uartSessionsSplit) return;

  terminalLayoutState = loadTerminalLayoutState();
  applyTerminalLayout();

  uartSessions.forEach((session) => {
    session
      .querySelector(".terminal-header")
      ?.addEventListener("pointerdown", handleTerminalDragPointerDown);
  });

  terminalLayoutResizer?.addEventListener(
    "pointerdown",
    handleTerminalResizePointerDown
  );
  terminalLayoutResizer?.addEventListener("keydown", handleTerminalResizeKey);
}

function loadTerminalLayoutState() {
  try {
    const raw = localStorage.getItem(TERMINAL_LAYOUT_STORAGE_KEY);
    return normalizeTerminalLayoutState(raw ? JSON.parse(raw) : null);
  } catch (error) {
    console.warn("Unable to load terminal layout:", error);
    return normalizeTerminalLayoutState(null);
  }
}

function saveTerminalLayoutState() {
  try {
    localStorage.setItem(
      TERMINAL_LAYOUT_STORAGE_KEY,
      JSON.stringify(terminalLayoutState)
    );
  } catch (error) {
    console.warn("Unable to save terminal layout:", error);
  }
}

function normalizeTerminalLayoutState(input) {
  const layout = input?.layout === "column" ? "column" : "row";
  const order = Array.isArray(input?.order)
    ? input.order.filter((id) => TERMINAL_LAYOUT_PANEL_IDS.includes(id))
    : [];
  TERMINAL_LAYOUT_PANEL_IDS.forEach((id) => {
    if (!order.includes(id)) order.push(id);
  });

  let txSize = Number(input?.sizes?.tx);
  let rxSize = Number(input?.sizes?.rx);

  if (!Number.isFinite(txSize) || !Number.isFinite(rxSize)) {
    txSize = 50;
    rxSize = 50;
  } else {
    const total = txSize + rxSize;
    if (total > 0) {
      txSize = (txSize / total) * 100;
      rxSize = 100 - txSize;
    }
  }

  txSize = clampToRange(
    txSize,
    TERMINAL_LAYOUT_MIN_PANEL_SIZE,
    TERMINAL_LAYOUT_MAX_PANEL_SIZE
  );
  rxSize = 100 - txSize;

  return {
    layout,
    order: order.slice(0, 2),
    sizes: {
      tx: txSize,
      rx: rxSize,
    },
  };
}

function applyTerminalLayout() {
  if (!uartSessionsSplit) return;

  terminalLayoutState = normalizeTerminalLayoutState(terminalLayoutState);
  const [firstId, secondId] = terminalLayoutState.order;
  const firstPanel = getTerminalLayoutPanel(firstId);
  const secondPanel = getTerminalLayoutPanel(secondId);

  if (!firstPanel || !secondPanel) return;

  uartSessionsSplit.dataset.terminalLayout = terminalLayoutState.layout;
  uartSessionsSplit.style.setProperty(
    "--terminal-layout-first-grow",
    terminalLayoutState.sizes[firstId].toFixed(3)
  );
  uartSessionsSplit.style.setProperty(
    "--terminal-layout-second-grow",
    terminalLayoutState.sizes[secondId].toFixed(3)
  );

  uartSessions.forEach((session) => {
    session.classList.remove("is-layout-first", "is-layout-second");
  });
  firstPanel.classList.add("is-layout-first");
  secondPanel.classList.add("is-layout-second");

  if (terminalLayoutResizer) {
    const isRow = terminalLayoutState.layout === "row";
    terminalLayoutResizer.setAttribute(
      "aria-orientation",
      isRow ? "vertical" : "horizontal"
    );
  }

  scheduleTerminalLayoutRefresh();
}

function getTerminalLayoutPanel(id) {
  return document.querySelector(`[data-terminal-session="${id}"]`);
}

function getOtherTerminalPanelId(id) {
  return TERMINAL_LAYOUT_PANEL_IDS.find((panelId) => panelId !== id);
}

function handleTerminalDragPointerDown(event) {
  if (event.button !== 0 || !uartSessionsSplit) return;
  if (isTerminalHeaderInteractiveTarget(event.target)) return;

  const panelId =
    event.currentTarget.closest(".uart-session")?.dataset.terminalSession;
  const panel = getTerminalLayoutPanel(panelId);
  if (!panel) return;

  event.preventDefault();
  terminalLayoutDrag = {
    panelId,
    placement: null,
  };

  panel.classList.add("is-terminal-drag-source");
  document.body.classList.add("is-terminal-layout-active");
  uartSessionsSplit.classList.add("is-terminal-dragging");
  updateTerminalDropPlacement(event.clientX, event.clientY);

  document.addEventListener("pointermove", handleTerminalDragPointerMove);
  document.addEventListener("pointerup", handleTerminalDragPointerUp);
  document.addEventListener("pointercancel", cancelTerminalDrag);
}

function isTerminalHeaderInteractiveTarget(target) {
  return !!target.closest(
    "button, input, select, textarea, label, a, .custom-select, .checkbox-label, .radio-group, .view-toggle, .mode-controls, .data-mode-controls"
  );
}

function handleTerminalDragPointerMove(event) {
  if (!terminalLayoutDrag) return;
  event.preventDefault();
  updateTerminalDropPlacement(event.clientX, event.clientY);
}

function handleTerminalDragPointerUp(event) {
  if (!terminalLayoutDrag) return;
  event.preventDefault();

  const { panelId, placement } = terminalLayoutDrag;
  if (placement) {
    const otherPanelId = getOtherTerminalPanelId(panelId);
    terminalLayoutState.layout = placement.layout;
    terminalLayoutState.order =
      placement.position === "start"
        ? [panelId, otherPanelId]
        : [otherPanelId, panelId];
    applyTerminalLayout();
    saveTerminalLayoutState();
  }

  cancelTerminalDrag();
}

function cancelTerminalDrag() {
  if (!terminalLayoutDrag) return;

  getTerminalLayoutPanel(terminalLayoutDrag.panelId)?.classList.remove(
    "is-terminal-drag-source"
  );
  terminalLayoutDrag = null;
  clearTerminalDropClasses();
  uartSessionsSplit?.classList.remove("is-terminal-dragging");
  document.body.classList.remove("is-terminal-layout-active");
  document.removeEventListener("pointermove", handleTerminalDragPointerMove);
  document.removeEventListener("pointerup", handleTerminalDragPointerUp);
  document.removeEventListener("pointercancel", cancelTerminalDrag);
}

function updateTerminalDropPlacement(clientX, clientY) {
  if (!terminalLayoutDrag || !uartSessionsSplit) return;

  const rect = uartSessionsSplit.getBoundingClientRect();
  const xRatio = clampToRange((clientX - rect.left) / rect.width, 0, 1);
  const yRatio = clampToRange((clientY - rect.top) / rect.height, 0, 1);
  const horizontalBias = Math.abs(xRatio - 0.5);
  const verticalBias = Math.abs(yRatio - 0.5);

  const useHorizontal = horizontalBias >= verticalBias;
  const layout = useHorizontal ? "row" : "column";
  const position = useHorizontal
    ? xRatio < 0.5
      ? "start"
      : "end"
    : yRatio < 0.5
      ? "start"
      : "end";

  terminalLayoutDrag.placement = { layout, position };
  setTerminalDropClass(layout, position);
}

function setTerminalDropClass(layout, position) {
  if (!uartSessionsSplit) return;
  clearTerminalDropClasses();

  const className =
    layout === "row"
      ? position === "start"
        ? "terminal-drop-left"
        : "terminal-drop-right"
      : position === "start"
        ? "terminal-drop-top"
        : "terminal-drop-bottom";

  uartSessionsSplit.classList.add(className);
}

function clearTerminalDropClasses() {
  uartSessionsSplit?.classList.remove(
    "terminal-drop-left",
    "terminal-drop-right",
    "terminal-drop-top",
    "terminal-drop-bottom"
  );
}

function handleTerminalResizePointerDown(event) {
  if (event.button !== 0 || !uartSessionsSplit) return;

  event.preventDefault();
  terminalLayoutResize = true;
  document.body.classList.add("is-terminal-layout-active");
  uartSessionsSplit.classList.add("is-terminal-resizing");
  terminalLayoutResizer?.setPointerCapture?.(event.pointerId);
  updateTerminalLayoutSize(event.clientX, event.clientY);

  document.addEventListener("pointermove", handleTerminalResizePointerMove);
  document.addEventListener("pointerup", handleTerminalResizePointerUp);
  document.addEventListener("pointercancel", cancelTerminalResize);
}

function handleTerminalResizePointerMove(event) {
  if (!terminalLayoutResize) return;
  event.preventDefault();
  updateTerminalLayoutSize(event.clientX, event.clientY);
}

function handleTerminalResizePointerUp(event) {
  if (!terminalLayoutResize) return;
  event.preventDefault();
  cancelTerminalResize();
  saveTerminalLayoutState();
}

function cancelTerminalResize() {
  terminalLayoutResize = null;
  uartSessionsSplit?.classList.remove("is-terminal-resizing");
  document.body.classList.remove("is-terminal-layout-active");
  document.removeEventListener("pointermove", handleTerminalResizePointerMove);
  document.removeEventListener("pointerup", handleTerminalResizePointerUp);
  document.removeEventListener("pointercancel", cancelTerminalResize);
}

function updateTerminalLayoutSize(clientX, clientY) {
  if (!uartSessionsSplit) return;

  const rect = uartSessionsSplit.getBoundingClientRect();
  const [firstId, secondId] = terminalLayoutState.order;
  const isRow = terminalLayoutState.layout === "row";
  const axisSize = isRow ? rect.width : rect.height;
  const axisPosition = isRow ? clientX - rect.left : clientY - rect.top;
  const firstSize = clampToRange(
    (axisPosition / axisSize) * 100,
    TERMINAL_LAYOUT_MIN_PANEL_SIZE,
    TERMINAL_LAYOUT_MAX_PANEL_SIZE
  );

  terminalLayoutState.sizes[firstId] = firstSize;
  terminalLayoutState.sizes[secondId] = 100 - firstSize;
  applyTerminalLayout();
}

function handleTerminalResizeKey(event) {
  const isRow = terminalLayoutState.layout === "row";
  const increaseKeys = isRow ? ["ArrowRight"] : ["ArrowDown"];
  const decreaseKeys = isRow ? ["ArrowLeft"] : ["ArrowUp"];

  if (increaseKeys.includes(event.key)) {
    adjustTerminalLayoutSize(4);
  } else if (decreaseKeys.includes(event.key)) {
    adjustTerminalLayoutSize(-4);
  } else if (event.key === "Home" || event.key === "End") {
    resetTerminalLayoutSize();
  } else {
    return;
  }

  event.preventDefault();
  saveTerminalLayoutState();
}

function adjustTerminalLayoutSize(delta) {
  const [firstId, secondId] = terminalLayoutState.order;
  const firstSize = clampToRange(
    terminalLayoutState.sizes[firstId] + delta,
    TERMINAL_LAYOUT_MIN_PANEL_SIZE,
    TERMINAL_LAYOUT_MAX_PANEL_SIZE
  );

  terminalLayoutState.sizes[firstId] = firstSize;
  terminalLayoutState.sizes[secondId] = 100 - firstSize;
  applyTerminalLayout();
}

function resetTerminalLayoutSize() {
  terminalLayoutState.sizes.tx = 50;
  terminalLayoutState.sizes.rx = 50;
  applyTerminalLayout();
}

function scheduleTerminalLayoutRefresh() {
  if (terminalLayoutRefreshFrame) {
    cancelAnimationFrame(terminalLayoutRefreshFrame);
  }

  terminalLayoutRefreshFrame = requestAnimationFrame(() => {
    terminalLayoutRefreshFrame = null;
    if (oscilloscopeChart) {
      oscilloscopeChart.resize();
    }
  });
}

/**
 * Check if Web Serial API is supported
 */
function checkWebSerialSupport() {
  if (!("serial" in navigator)) {
    document.getElementById("apiWarning").classList.add("show");
    hideTerminalStartOverlay();
    connectBtn.disabled = true;
    updateConnectButtonLabels("Unavailable", "Web Serial unavailable");
    sendBtn.disabled = true;
    if (receiveToggleBtn) receiveToggleBtn.disabled = true;
    terminalInput.disabled = true;
  }
}

function hideTerminalStartOverlay() {
  if (!terminalStartOverlay) return;
  terminalStartOverlay.hidden = true;
}

function handleTerminalStart(event) {
  event.preventDefault();
  hideTerminalStartOverlay();

  if (!("serial" in navigator) || port || !connectBtn || connectBtn.disabled) {
    return;
  }

  connectSerial({ quietPortSelectionErrors: true });
}

/**
 * Toggle connection to serial port
 */
async function toggleConnection() {
  if (!port) {
    await connectSerial();
  } else {
    await disconnectSerial();
  }
}

function isSerialPortSelectionDismissed(error) {
  const name = error?.name || "";
  const message = String(error?.message || error || "");
  return (
    name === "NotFoundError" ||
    name === "NotAllowedError" ||
    name === "SecurityError" ||
    /user activation|user gesture|permission request|cancel/i.test(message)
  );
}

/**
 * Connect to serial port
 */
async function connectSerial({ quietPortSelectionErrors = false } = {}) {
  let selectedPort = null;

  try {
    selectedPort = await navigator.serial.requestPort();
  } catch (error) {
    if (!quietPortSelectionErrors || !isSerialPortSelectionDismissed(error)) {
      console.error("Connection error:", error);
    }
    return false;
  }

  try {
    port = selectedPort;

    // Get connection parameters with safe defaults
    const baudRate = parseInt(
      document.getElementById("baudRate")?.value || 115200
    );
    const dataBitsElement = document.getElementById("dataBits");
    const stopBitsElement = document.getElementById("stopBits");
    const parityElement = document.getElementById("parity");

    const dataBits = dataBitsElement ? parseInt(dataBitsElement.value) : 8;
    const stopBits = stopBitsElement ? parseInt(stopBitsElement.value) : 1;
    const parity = parityElement ? parityElement.value : "none";

    // Open port with parameters
    await port.open({
      baudRate,
      dataBits,
      stopBits,
      parity,
      bufferSize: 4096,
    });

    // Setup reader and writer directly
    reader = port.readable.getReader();
    writer = port.writable.getWriter();

    // Update UI
    updateConnectionStatus(true, getPortLabel(port));
    clearTerminals();
    addToTerminal("info", `Connected at ${baudRate} baud`, terminalSent);

    // Start reading
    readLoop();
    return true;
  } catch (error) {
    port = null;
    console.error("Connection error:", error);
    // addToTerminal('error', `Connection failed: ${error.message}`, terminalSent);
    return false;
  }
}

/**
 * Disconnect from serial port
 */
async function disconnectSerial() {
  try {
    // Stop reading
    if (reader) {
      try {
        await reader.cancel();
        reader.releaseLock();
      } catch (e) {
        console.log("Reader release:", e);
      }
      reader = null;
    }

    // Stop writing
    if (writer) {
      try {
        writer.releaseLock();
      } catch (e) {
        console.log("Writer release:", e);
      }
      writer = null;
    }

    stopLoopSend();

    // Reset RX coalescing buffer/timer
    pendingReceiveStop = false;
    rxPausedByteParity = 0;
    rxResumeDiscardBytes = 0;
    resetOscilloscopeAutoAlignState();
    rxBuffer = new Uint8Array(0);
    if (rxFlushTimer) {
      clearTimeout(rxFlushTimer);
      rxFlushTimer = null;
    }

    // Close port
    if (port) {
      await port.close();
      port = null;
    }

    // Update UI
    updateConnectionStatus(false);
    addToTerminal("info", "Disconnected", terminalSent);
  } catch (error) {
    console.error("Disconnection error:", error);
    addToTerminal(
      "error",
      `Disconnection error: ${error.message}`,
      terminalSent
    );
  }
}

/**
 * Update connection status in UI
 */
function setUartSessionLocked(locked) {
  if (!uartSessions || uartSessions.length === 0) return;
  uartSessions.forEach((session) => {
    session.classList.toggle("is-locked", !!locked);
    session.setAttribute("aria-disabled", locked ? "true" : "false");
  });
}

function getTxMode() {
  const inputModeElement = document.querySelector(
    'input[name="txMode"]:checked'
  );
  return inputModeElement ? inputModeElement.value : "ascii";
}

function getRxMode() {
  const inputModeElement = document.querySelector(
    'input[name="rxMode"]:checked'
  );
  return inputModeElement ? inputModeElement.value : "ascii";
}

function getModeForTarget(targetTerminal) {
  return targetTerminal === terminalReceived ? getRxMode() : getTxMode();
}

function updateConnectionStatus(connected, deviceLabel = "") {
  if (connected) {
    statusIndicator.textContent = deviceLabel || "Connected";
    statusIndicator.classList.remove("disconnected");
    statusIndicator.classList.add("connected");
    updateConnectButtonLabels("Connected", "Click to disconnect");
    connectBtn.classList.add("connected");
    sendBtn.disabled = false;
    if (receiveToggleBtn) receiveToggleBtn.disabled = false;
    if (cycleCheckbox) cycleCheckbox.disabled = false;
    loopIntervalInput.disabled = false;
    updateTxInputAvailability();
  } else {
    statusIndicator.textContent = "No port selection";
    statusIndicator.classList.remove("connected");
    statusIndicator.classList.add("disconnected");
    updateConnectButtonLabels("Disconnected", "Click to connect");
    connectBtn.classList.remove("connected");
    sendBtn.disabled = true;
    if (receiveToggleBtn) receiveToggleBtn.disabled = true;
    if (cycleCheckbox) cycleCheckbox.disabled = true;
    loopIntervalInput.disabled = true;
    updateTxInputAvailability();
  }

  setUartSessionLocked(!connected);
  setConnectionSelectsDisabled(connected);
}

function updateConnectButtonLabels(defaultText, hoverText) {
  if (!connectBtn) return;
  const defaultLabel = connectBtn.querySelector("[data-connect-default]");
  const hoverLabel = connectBtn.querySelector("[data-connect-hover]");

  if (defaultLabel && hoverLabel) {
    defaultLabel.textContent = defaultText;
    hoverLabel.textContent = hoverText;
    connectBtn.title = hoverText;
    connectBtn.setAttribute("aria-label", hoverText);
    return;
  }

  connectBtn.textContent = defaultText;
}

function updateTxInputAvailability() {
  if (!terminalInput) return;
  const enabled = !!port && txView === "text";
  terminalInput.disabled = !enabled;
}

function updateTxInputPanelVisibility() {
  if (!terminalInputPanel) return;
  terminalInputPanel.style.display = txView === "generator" ? "none" : "flex";
}

function setConnectionSelectsDisabled(disabled) {
  document.querySelectorAll(".connection-control select").forEach((el) => {
    el.disabled = !!disabled;
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
  label.textContent = getSelectDisplayText(select) || "Select";

  for (const option of Array.from(select.options)) {
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
    const active = custom.querySelector(
      '.custom-select-option[aria-selected="true"]'
    );
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
    if (
      event.key === "ArrowDown" ||
      event.key === "Enter" ||
      event.key === " "
    ) {
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

function initializeCustomSelects() {
  [
    "baudRate",
    "genWaveform",
    "modalBaudRate",
    "dataBits",
    "stopBits",
    "parity",
  ].forEach((id) => initCustomSelect(document.getElementById(id)));
}

// ---------- Friendly USB names ----------
const USB_FRIENDLY_NAMES = {
  "1A86:55D3": "WCH CH343 USB-Serial",
  "1A86:7523": "WCH CH340/CH341 USB-Serial",
  "10C4:EA60": "Silicon Labs CP210x USB-Serial",
  "0403:6001": "FTDI FT232R USB-Serial",
  "067B:2303": "Prolific PL2303 USB-Serial",
  "303A:1001": "Espressif USB JTAG/Serial",
};

const USB_VENDOR_NAMES = {
  0x1a86: "WCH (QinHeng)",
  0x10c4: "Silicon Labs",
  0x0403: "FTDI",
  0x067b: "Prolific",
  0x303a: "Espressif",
  0x2341: "Arduino",
};

function hex4(n) {
  return Number(n).toString(16).padStart(4, "0").toUpperCase();
}
function vidpidKey(vid, pid) {
  return `${hex4(vid)}:${hex4(pid)}`;
}

function getPortLabel(port) {
  const info = port.getInfo ? port.getInfo() : {};
  const vid = info.usbVendorId;
  const pid = info.usbProductId;

  if (vid != null && pid != null) {
    const key = vidpidKey(vid, pid);
    if (USB_FRIENDLY_NAMES[key]) return USB_FRIENDLY_NAMES[key];
    const vendor = USB_VENDOR_NAMES[vid] || `USB ${hex4(vid)}`;
    return `${vendor} (${hex4(vid)}:${hex4(pid)})`;
  }
  if (vid != null) {
    const vendor = USB_VENDOR_NAMES[vid] || `USB ${hex4(vid)}`;
    return vendor;
  }
  return "Unknown device";
}

/**
 * Read data from serial port
 */
async function readLoop() {
  try {
    while (port && reader) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }

      handleReceivedData(value);
    }
  } catch (error) {
    console.error("Read error:", error);
    addToTerminal("error", `Read error: ${error.message}`, terminalReceived);
  }
}

/**
 * Handle received data from serial port
 */
function handleReceivedData(data) {
  if (!isReceiving) {
    if (isOscilloscopeTwoByteMode()) {
      rxPausedByteParity = (rxPausedByteParity + (data.length % 2)) % 2;
    }
    return;
  }

  if (currentView === "oscilloscope") {
    const oscilloscopeDataChunk = getOscilloscopeChunkForUpdate(data);
    if (oscilloscopeDataChunk && oscilloscopeDataChunk.length > 0) {
      updateOscilloscopeData(oscilloscopeDataChunk);
    }
  }

  rxAppend(data);

  if (rxFlushTimer) clearTimeout(rxFlushTimer);
  rxFlushTimer = setTimeout(flushRxBufferToTerminal, rxSilenceMs);

  if (pendingReceiveStop && shouldFinalizePendingReceiveStop()) {
    stopReceivingImmediately(false);
  }
}

function rxAppend(chunk) {
  // Merge Uint8Array chunks without mutating the original buffers.
  const merged = new Uint8Array(rxBuffer.length + chunk.length);
  merged.set(rxBuffer, 0);
  merged.set(chunk, rxBuffer.length);
  rxBuffer = merged;
}

function flushRxBufferToTerminal() {
  if (!rxBuffer || rxBuffer.length === 0) return;

  // Resolve the current RxD display mode.
  const inputMode = getRxMode();

  if (inputMode === "hex") {
    // HEX: render the whole buffer as one line.
    const hexString = formatHexData(rxBuffer);
    addToTerminal("received", hexString, terminalReceived);
  } else {
    // ASCII: decode the full buffer; addToTerminal renders CR/LF visibly.
    const decoder = new TextDecoder();
    const text = decoder.decode(rxBuffer);
    addToTerminal("received", text, terminalReceived);
  }

  // Clear the receive buffer.
  rxBuffer = new Uint8Array(0);
  rxFlushTimer = null;
}

/**
 * Send data to serial port
 */
async function sendData() {
  if (!port || !writer || !terminalInput.value.trim()) {
    return;
  }

  const inputMode = getTxMode();
  const inputValue = terminalInput.value;

  try {
    let dataToSend;
    let displayText;

    if (inputMode === "ascii") {
      // ASCII mode: always append \r\n
      const textWithLineEnding = inputValue + "\r\n";
      const encoder = new TextEncoder();
      dataToSend = encoder.encode(textWithLineEnding);
      displayText = textWithLineEnding;
    } else {
      // HEX mode: never append \r\n
      // Strict validation: only accept format "XX XX XX" where X is hex digit (0-F)
      const trimmedInput = inputValue.trim();

      // Check if empty
      if (!trimmedInput) {
        throw new Error("HEX string is empty");
      }

      // Valid pattern: hex bytes (2 chars) separated by single spaces
      // Examples: "AB", "AB CD", "AB CD EF"
      const hexPattern = /^[0-9A-Fa-f]{2}(\s[0-9A-Fa-f]{2})*$/;

      if (!hexPattern.test(trimmedInput)) {
        throw new Error("Example: 37 AB 02 fD 7c");
      }

      // Parse hex bytes
      const hexBytes = trimmedInput.split(" ");
      const bytes = [];

      for (const hexByte of hexBytes) {
        const byteValue = parseInt(hexByte, 16);
        bytes.push(byteValue);
      }

      dataToSend = new Uint8Array(bytes);
      displayText = formatHexData(dataToSend);
    }

    // Send data
    await writer.write(dataToSend);

    // Display in terminal
    addToTerminal("sent", displayText, terminalSent);
  } catch (error) {
    console.error("Data format error:", error);
    addToTerminal("error", `Data format error: ${error.message}`, terminalSent);
  }
}


/**
 * Add line to terminal
 */
function formatTimeWithMs(date = new Date()) {
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  const ms = String(date.getMilliseconds()).padStart(3, "0");
  return `${hh}:${mm}:${ss}.${ms}`;
}

function visualizeCRLFWithBreaks(str) {
  return str
    .replace(/\r/g, "\\r\r") // Visible "\r" plus the original carriage return.
    .replace(/\n/g, "\\n\n"); // Visible "\n" plus the original line break.
}

function addToTerminal(type, data, targetTerminal) {
  const line = document.createElement("div");
  line.className = `terminal-line ${type}`;

  // Add timestamp if enabled
  const timestamp = timestampCheckbox?.checked
    ? `[${formatTimeWithMs()}] `
    : "";

  // Check if we're in hex mode
  const inputMode = getModeForTarget(targetTerminal);

  if (inputMode === "hex" && (type === "sent" || type === "received")) {
    line.classList.add("hex-mode");
  }

  let display = data;
  if (inputMode === "ascii" && (type === "sent" || type === "received")) {
    display = visualizeCRLFWithBreaks(display);
  }

  // Set line content (no arrows, show all characters)
  line.textContent = timestamp + display;

  // Add to terminal
  targetTerminal.appendChild(line);

  // Auto-scroll if enabled
  if (autoScrollCheckbox?.checked) {
    targetTerminal.scrollTop = targetTerminal.scrollHeight;
  }
}

/**
 * Format data as hex string
 */
function formatHexData(uint8Array) {
  return Array.from(uint8Array)
    .map((byte) => byte.toString(16).padStart(2, "0").toUpperCase())
    .join(" ");
}

function updateTxInputPlaceholder() {
  if (!terminalInput) return;
  const inputMode = getTxMode();

  if (inputMode === "hex") {
    terminalInput.placeholder = "String of Hex Digits like 37 AB 02 fD 7c";
    terminalInput.classList.add("hex-mode");
  } else {
    terminalInput.placeholder = "Text string";
    terminalInput.classList.remove("hex-mode");
  }
}

function updateGeneratorUi() {
  const dutyField = document.getElementById("genDutyField");
  const paramsPanel = document.getElementById("generatorDependentParams");
  const waveform = document.getElementById("genWaveform")?.value || "sine";
  if (paramsPanel) {
    paramsPanel.dataset.waveform = waveform;
  }
  if (dutyField) {
    dutyField.style.display = waveform === "square" ? "flex" : "none";
  }
}

function getGeneratorSelectedByteSize() {
  return document.querySelector('input[name="genByteSize"]:checked')?.value || "1";
}

function getGeneratorSelectedSignMode() {
  return (
    document.querySelector('input[name="genSignMode"]:checked')?.value ||
    "unsigned"
  );
}

function getGeneratorDefaultAmplitudeByByteSize(byteSize) {
  return byteSize === "1"
    ? GEN_DEFAULT_AMPLITUDE_1BYTE
    : GEN_DEFAULT_AMPLITUDE_2BYTE;
}

function applyGeneratorByteSizeDefaults() {
  const amplitudeInput = document.getElementById("genAmplitude");
  if (!amplitudeInput) return;

  const byteSize = getGeneratorSelectedByteSize();
  amplitudeInput.value = String(getGeneratorDefaultAmplitudeByByteSize(byteSize));
}

function getGeneratorDefaultOffset(signMode, byteSize) {
  if (signMode !== "unsigned") {
    return GEN_DEFAULT_OFFSET_SIGNED;
  }

  return byteSize === "1"
    ? GEN_DEFAULT_OFFSET_UNSIGNED_1BYTE
    : GEN_DEFAULT_OFFSET_UNSIGNED_2BYTE;
}

function applyGeneratorOffsetDefaults() {
  const offsetInput = document.getElementById("genOffset");
  if (!offsetInput) return;

  const signMode = getGeneratorSelectedSignMode();
  const byteSize = getGeneratorSelectedByteSize();
  offsetInput.value = String(getGeneratorDefaultOffset(signMode, byteSize));
}

function getNormalizedLoopIntervalMs(defaultValue = TX_TEXT_INTERVAL_MS) {
  const parsed = parseInt(loopIntervalInput?.value, 10);
  const fallback = Number.isFinite(defaultValue)
    ? defaultValue
    : TX_TEXT_INTERVAL_MS;
  const normalized = Number.isFinite(parsed)
    ? Math.min(TX_INTERVAL_MAX_MS, Math.max(TX_INTERVAL_MIN_MS, parsed))
    : fallback;
  if (loopIntervalInput) {
    loopIntervalInput.value = String(normalized);
  }
  return normalized;
}

function applyTxViewDefaults() {
  if (txView === "generator") {
    if (cycleCheckbox) cycleCheckbox.checked = true;
    if (loopIntervalInput) {
      loopIntervalInput.value = String(TX_GENERATOR_INTERVAL_MS);
    }
    getNormalizedLoopIntervalMs(TX_GENERATOR_INTERVAL_MS);
    return;
  }

  if (cycleCheckbox) cycleCheckbox.checked = false;
  if (loopIntervalInput) {
    loopIntervalInput.value = String(TX_TEXT_INTERVAL_MS);
  }
  getNormalizedLoopIntervalMs(TX_TEXT_INTERVAL_MS);
}

function handleTxViewChange(event) {
  const view = event.target.value;
  if (!view || !event.target.checked) return;

  txView = view;
  if (txView === "generator") {
    if (txTerminalShell) txTerminalShell.style.display = "none";
    if (txGeneratorPanel) txGeneratorPanel.style.display = "flex";
    if (txLogControls) txLogControls.style.display = "none";
    if (txModeControls) txModeControls.style.display = "none";
    if (txGeneratorOptionsControls)
      txGeneratorOptionsControls.style.display = "flex";
  } else {
    if (txTerminalShell) txTerminalShell.style.display = "flex";
    if (txGeneratorPanel) txGeneratorPanel.style.display = "none";
    if (txLogControls) txLogControls.style.display = "flex";
    if (txModeControls) txModeControls.style.display = "flex";
    if (txGeneratorOptionsControls)
      txGeneratorOptionsControls.style.display = "none";
  }

  if (loopInterval) {
    stopLoopSend();
  }
  applyTxViewDefaults();
  updateTxInputPanelVisibility();
  updateTxInputAvailability();
}

function updateRunButtonState() {
  if (!sendBtn) return;
  const running = !!loopInterval;
  sendBtn.textContent = running ? "Stop" : "Run";
  sendBtn.classList.toggle("running", running);
  sendBtn.title = running ? "Stop cycle" : "Run";
}

function getOscilloscopeByteSizeMode() {
  return document.querySelector('input[name="byteSize"]:checked')?.value || "1";
}

function isOscilloscopeTwoByteMode() {
  const byteSizeMode = getOscilloscopeByteSizeMode();
  return byteSizeMode === "2BE" || byteSizeMode === "2LE";
}

function resetOscilloscopeAutoAlignState() {
  oscilloscopeAutoAlignPending = false;
  oscilloscopeAutoAlignBuffer = [];
}

function requestOscilloscopeAutoAlign() {
  if (!isOscilloscopeTwoByteMode()) {
    resetOscilloscopeAutoAlignState();
    return;
  }

  oscilloscopeAutoAlignPending = true;
  oscilloscopeAutoAlignBuffer = [];
  byteBuffer = [];
}

function decodeOscilloscopePairValue(bytes, index, byteSizeMode) {
  if (byteSizeMode === "2LE") {
    const low = bytes[index];
    const high = bytes[index + 1];
    return ((high << 8) | low) & 0xffff;
  }

  const high = bytes[index];
  const low = bytes[index + 1];
  return ((high << 8) | low) & 0xffff;
}

function calculateOscilloscopeAlignmentScore(bytes, startIndex, byteSizeMode) {
  let prev = null;
  let steps = 0;
  let totalDelta = 0;

  for (let i = startIndex; i + 1 < bytes.length; i += 2) {
    const value = decodeOscilloscopePairValue(bytes, i, byteSizeMode);
    if (prev !== null) {
      totalDelta += Math.abs(value - prev);
      steps += 1;
    }
    prev = value;
  }

  return steps > 0 ? totalDelta / steps : Number.POSITIVE_INFINITY;
}

function resolveOscilloscopeAutoAlignment(data) {
  if (!oscilloscopeAutoAlignPending) {
    return data;
  }

  oscilloscopeAutoAlignBuffer.push(...data);
  if (oscilloscopeAutoAlignBuffer.length < 8) {
    return null;
  }

  const byteSizeMode = getOscilloscopeByteSizeMode();
  const probe = oscilloscopeAutoAlignBuffer.slice(
    0,
    Math.min(oscilloscopeAutoAlignBuffer.length, OSCILLOSCOPE_ALIGN_PROBE_BYTES)
  );

  const scoreAligned = calculateOscilloscopeAlignmentScore(
    probe,
    0,
    byteSizeMode
  );
  const scoreShifted = calculateOscilloscopeAlignmentScore(
    probe,
    1,
    byteSizeMode
  );
  const useShifted = scoreShifted < scoreAligned;

  const out = new Uint8Array(oscilloscopeAutoAlignBuffer.slice(useShifted ? 1 : 0));
  resetOscilloscopeAutoAlignState();
  return out;
}

function getOscilloscopeChunkForUpdate(data) {
  let chunk = data;

  if (rxResumeDiscardBytes > 0) {
    const discardCount = Math.min(rxResumeDiscardBytes, chunk.length);
    rxResumeDiscardBytes -= discardCount;
    if (discardCount >= chunk.length) {
      return null;
    }
    chunk = chunk.slice(discardCount);
  }

  if (!isOscilloscopeTwoByteMode()) {
    resetOscilloscopeAutoAlignState();
    return chunk;
  }

  return resolveOscilloscopeAutoAlignment(chunk);
}

function dropDanglingOscilloscopePairByte() {
  if (!isOscilloscopeTwoByteMode()) return;

  // If processing was stopped in the middle of a 2-byte sample, discard
  // the tail byte to prevent permanent pair shift after restart.
  resetOscilloscopeAutoAlignState();
  if (byteBuffer.length % 2 !== 0) {
    byteBuffer = [];
  }
}

function updateReceiveButtonState() {
  if (!receiveToggleBtn) return;
  if (pendingReceiveStop) {
    receiveToggleBtn.textContent = "Stopping...";
    receiveToggleBtn.classList.add("receiving");
    receiveToggleBtn.title =
      "Waiting for full 2-byte sample (click again to force stop)";
    return;
  }

  const receiving = !!isReceiving;
  receiveToggleBtn.textContent = receiving ? "Stop" : "Get";
  receiveToggleBtn.classList.toggle("receiving", receiving);
  receiveToggleBtn.title = receiving ? "Stop receiving" : "Get data";
}

function stopReceivingImmediately(forcePairRealignment = false) {
  if (forcePairRealignment) {
    dropDanglingOscilloscopePairByte();
  }

  isReceiving = false;
  pendingReceiveStop = false;
  rxPausedByteParity = 0;
  rxResumeDiscardBytes = 0;
  resetOscilloscopeAutoAlignState();
  rxBuffer = new Uint8Array(0);
  if (rxFlushTimer) {
    clearTimeout(rxFlushTimer);
    rxFlushTimer = null;
  }
  updateReceiveButtonState();
}

function shouldDeferReceivingStop() {
  if (currentView !== "oscilloscope") return false;
  if (!isOscilloscopeTwoByteMode()) return false;

  const pendingBytes = byteBuffer.length + oscilloscopeAutoAlignBuffer.length;
  return pendingBytes % 2 !== 0;
}

function shouldFinalizePendingReceiveStop() {
  return !shouldDeferReceivingStop();
}

function toggleReceiving() {
  if (!isReceiving) {
    pendingReceiveStop = false;
    if (isOscilloscopeTwoByteMode()) {
      // Start from a clean local state and re-align with ongoing stream phase.
      byteBuffer = [];
      rxResumeDiscardBytes = rxPausedByteParity;
    } else {
      rxPausedByteParity = 0;
      rxResumeDiscardBytes = 0;
      resetOscilloscopeAutoAlignState();
    }
    isReceiving = true;
    updateReceiveButtonState();
    return;
  }

  if (pendingReceiveStop) {
    stopReceivingImmediately(true);
    return;
  }

  if (shouldDeferReceivingStop()) {
    pendingReceiveStop = true;
    updateReceiveButtonState();
    return;
  }

  stopReceivingImmediately(false);
}

function handleRunAction() {
  if (loopInterval) {
    stopLoopSend();
    return;
  }

  if (cycleCheckbox?.checked) {
    startLoopSend();
    return;
  }

  if (txView === "generator") {
    startGeneratorStream(false);
    return;
  } else {
    sendData();
  }
  updateRunButtonState();
}

function handleCycleChange() {
  if (!cycleCheckbox?.checked && loopInterval) {
    stopLoopSend();
  }
}

/**
 * Handle Tx/Rx mode change
 */
function handleTxModeChange() {
  updateTxInputPlaceholder();
}

function handleRxModeChange() {}

/**
 * Handle view change (Terminal/Oscilloscope)
 */
function handleViewChange(event) {
  const view = event.target.value;
  if (!event.target.checked) return;
  const oscilloscopeControls = document.getElementById("oscilloscopeControls");
  const dataModeControls = document.getElementById("dataModeControls");
  const rxModeControls = document.querySelectorAll(
    "#uartRxSession .mode-controls"
  );

  if (pendingReceiveStop && view !== "oscilloscope") {
    stopReceivingImmediately(true);
  }

  if (view === "oscilloscope") {
    // Show oscilloscope
    if (rxTerminalShell) rxTerminalShell.style.display = "none";
    oscilloscopeContainer.style.display = "flex";
    oscilloscopeControls.style.display = "flex";
    dataModeControls.style.display = "flex"; // Show new data mode controls
    rxModeControls.forEach((el) => (el.style.display = "none"));
    currentView = "oscilloscope";

    // Initialize oscilloscope if needed
    if (!oscilloscopeChart) {
      initOscilloscope();
    }
  } else {
    // Show terminal
    if (rxTerminalShell) rxTerminalShell.style.display = "flex";
    oscilloscopeContainer.style.display = "none";
    oscilloscopeControls.style.display = "none";
    dataModeControls.style.display = "none"; // Hide data mode controls
    rxModeControls.forEach((el) => (el.style.display = "flex"));
    currentView = "terminal";
  }
}

/**
 * Clear both terminals
 */
function clearTerminals() {
  clearTxTerminal();
  clearRxTerminal();
}

function clearTxTerminal() {
  if (terminalSent) {
    terminalSent.innerHTML = "";
  }
}

function clearRxTerminal() {
  if (terminalReceived) {
    terminalReceived.innerHTML = "";
  }
}

/**
 * Save terminal log to file
 */
function getBaudRateValue() {
  const baudRate = document.getElementById("baudRate");
  return baudRate ? baudRate.value : "";
}

function buildLogContent(label, terminal) {
  const lines = Array.from(terminal.querySelectorAll(".terminal-line")).map(
    (line) => line.textContent
  );

  const allLines = [];
  allLines.push(`=== UART ${label} Log ===`);
  allLines.push(`Date: ${new Date().toLocaleString()}`);
  const baudRate = getBaudRateValue();
  if (baudRate) {
    allLines.push(`Baud Rate: ${baudRate}`);
  }
  allLines.push("");
  allLines.push(...lines);

  return allLines.join("\n");
}

function saveTerminalLog(label, terminal, filePrefix) {
  if (!terminal) return;

  const logContent = buildLogContent(label, terminal);
  const blob = new Blob([logContent], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `uart_${filePrefix}_log_${Date.now()}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function saveTxLog() {
  saveTerminalLog("TxD", terminalSent, "tx");
}

function saveRxLog() {
  saveTerminalLog("RxD", terminalReceived, "rx");
}

function downloadOscilloscopeImage() {
  if (!oscilloscopeCanvas) return;
  const imageUrl = oscilloscopeCanvas.toDataURL("image/png");
  const a = document.createElement("a");
  a.href = imageUrl;
  a.download = `uart_oscilloscope_${Date.now()}.png`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/**
 * Open settings modal
 */
function openSettings() {
  const modal = document.getElementById("settingsModal");

  // Sync settings with main controls
  const modalBaudRate = document.getElementById("modalBaudRate");
  const mainBaudRate = document.getElementById("baudRate");

  if (modalBaudRate && mainBaudRate) {
    modalBaudRate.value = mainBaudRate.value;
    modalBaudRate.dispatchEvent(new Event("change", { bubbles: true }));
  }

  modal.classList.add("show");
}

/**
 * Close settings modal
 */
function closeSettings() {
  const modal = document.getElementById("settingsModal");

  // Sync settings back to main controls
  const modalBaudRate = document.getElementById("modalBaudRate");
  const mainBaudRate = document.getElementById("baudRate");

  if (modalBaudRate && mainBaudRate) {
    mainBaudRate.value = modalBaudRate.value;
    mainBaudRate.dispatchEvent(new Event("change", { bubbles: true }));
  }

  modal.classList.remove("show");
}

/**
 * Initialize oscilloscope
 */
function initOscilloscope() {
  // Check if Chart.js is loaded
  if (typeof Chart === "undefined") {
    console.error("Chart.js is not loaded");
    return;
  }
  ensureOscilloscopeInfoTooltipElement();

  const ctx = oscilloscopeCanvas.getContext("2d");

  // Clear previous chart if exists
  if (oscilloscopeChart) {
    oscilloscopeChart.destroy();
  }

  // Get settings
  const points = 500;
  const byteSize = document.querySelector(
    'input[name="byteSize"]:checked'
  ).value;
  const signMode = document.querySelector(
    'input[name="signMode"]:checked'
  ).value;

  // Initialize data array
  oscilloscopeData = new Array(points).fill(0);
  byteBuffer = []; // Clear byte buffer
  rxPausedByteParity = 0;
  rxResumeDiscardBytes = 0;
  resetOscilloscopeAutoAlignState();
  if (byteSize !== "1") {
    requestOscilloscopeAutoAlign();
  }
  axisHoverMode = null;

  // Determine Y axis range based on mode
  let yMin, yMax, yTitle;
  if (byteSize === "1") {
    if (signMode === "unsigned") {
      yMin = 0;
      yMax = 255;
      yTitle = "Value (0-255)";
    } else {
      yMin = -128;
      yMax = 127;
      yTitle = "Value (-128 to 127)";
    }
  } else {
    // 2 byte modes
    if (signMode === "unsigned") {
      yMin = 0;
      yMax = 65535;
      yTitle = "Value (0-65535)";
    } else {
      yMin = -32768;
      yMax = 32767;
      yTitle = "Value (-32768 to 32767)";
    }
  }

  // Create chart
  oscilloscopeChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: Array.from({ length: points }, (_, i) => i),
      datasets: [
        {
          label: "RxD Signal",
          data: buildOscilloscopeViewportData(yMin, yMax),
          borderColor: "rgba(0, 0, 0, 0)",
          backgroundColor: "rgba(0, 0, 0, 0)",
          borderWidth: 2,
          tension: 0,
          pointRadius: function (context) {
            return context.raw?.overflow ? 1.8 : 0;
          },
          pointHoverRadius: 4,
          pointBackgroundColor: function (context) {
            return context.raw?.overflow
              ? OSCILLOSCOPE_THEME.overflow
              : OSCILLOSCOPE_THEME.signal;
          },
          segment: {
            borderColor: function (context) {
              return context.p0.raw?.overflow || context.p1.raw?.overflow
                ? OSCILLOSCOPE_THEME.overflow
                : OSCILLOSCOPE_THEME.signal;
            },
          },
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: {
        duration: 0,
      },
      interaction: {
        intersect: false,
        mode: "nearest",
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: false,
          external: renderOscilloscopeInfoTooltip,
        },
      },
      scales: {
        x: {
          display: true,
          title: {
            display: true,
            text: "Sample",
            color: OSCILLOSCOPE_THEME.text,
          },
          ticks: { color: OSCILLOSCOPE_THEME.muted },
          border: {
            display: true,
            color: function () {
              return axisHoverMode === "x"
                ? OSCILLOSCOPE_THEME.axisHover
                : OSCILLOSCOPE_THEME.axis;
            },
            width: function () {
              return axisHoverMode === "x" ? 1.6 : 1;
            },
          },
          grid: {
            color: OSCILLOSCOPE_THEME.grid,
          },
        },
        y: {
          display: true,
          title: {
            display: true,
            text: yTitle,
            color: OSCILLOSCOPE_THEME.text,
          },
          border: {
            display: true,
            color: function () {
              return axisHoverMode === "y"
                ? OSCILLOSCOPE_THEME.axisHover
                : OSCILLOSCOPE_THEME.axis;
            },
            width: function () {
              return axisHoverMode === "y" ? 1.6 : 1;
            },
          },
          min: yMin,
          max: yMax,
          ticks: {
            color: OSCILLOSCOPE_THEME.muted,
            callback: function (value) {
              // Round value to integer for Y axis labels
              const roundedValue = Math.round(value);
              if (Math.abs(roundedValue) < 1000) {
                return roundedValue.toString();
              } else {
                // For large values, use k notation
                return (roundedValue / 1000).toFixed(0) + "k";
              }
            },
          },
          grid: {
            color: OSCILLOSCOPE_THEME.grid,
          },
        },
      },
    },
  });

  // Initialize zoom and pan controls
  initChartControls();

  // Reset zoom and pan when reinitializing
  chartZoom = { x: 1, y: 1 };
  chartPan = { x: 0, y: 0 };
}

function byteToHex(v) {
  const n = Math.max(0, Math.min(255, Math.round(v)));
  return n.toString(16).padStart(2, "0").toUpperCase();
}

function ensureOscilloscopeInfoTooltipElement() {
  if (oscilloscopeInfoTooltipEl && oscilloscopeInfoTooltipEl.isConnected) {
    return oscilloscopeInfoTooltipEl;
  }
  if (!oscilloscopeContainer) {
    return null;
  }

  const el = document.createElement("div");
  el.className = "oscilloscope-info-tooltip";
  el.style.opacity = "0";
  oscilloscopeContainer.appendChild(el);
  oscilloscopeInfoTooltipEl = el;
  return el;
}

function formatOscilloscopeValueLabel(value, byteSize, signMode) {
  const numeric = Number(value) || 0;
  if (byteSize === "1") {
    if (signMode === "unsigned") {
      return `Value: ${numeric} (0x${numeric
        .toString(16)
        .toUpperCase()
        .padStart(2, "0")})`;
    }
    const hexValue = numeric < 0 ? (256 + numeric).toString(16) : numeric.toString(16);
    return `Value: ${numeric} (0x${hexValue.toUpperCase().padStart(2, "0")})`;
  }

  if (signMode === "unsigned") {
    return `Value: ${numeric} (0x${numeric
      .toString(16)
      .toUpperCase()
      .padStart(4, "0")})`;
  }
  const hexValue = numeric < 0 ? (65536 + numeric).toString(16) : numeric.toString(16);
  return `Value: ${numeric} (0x${hexValue.toUpperCase().padStart(4, "0")})`;
}

function renderOscilloscopeInfoTooltip(context) {
  const el = ensureOscilloscopeInfoTooltipElement();
  if (!el) return;

  const tooltip = context?.tooltip;
  const chart = context?.chart;
  const point = tooltip?.dataPoints?.[0];
  const xScale = chart?.scales?.x;
  const chartArea = chart?.chartArea;

  if (!tooltip || tooltip.opacity === 0 || !point || !xScale || !chartArea) {
    el.style.opacity = "0";
    return;
  }

  const rawValue = Number.isFinite(point.raw?.rawY)
    ? point.raw.rawY
    : point.parsed?.y;
  const byteSize =
    document.querySelector('input[name="byteSize"]:checked')?.value || "1";
  const signMode =
    document.querySelector('input[name="signMode"]:checked')?.value ||
    "unsigned";
  el.textContent = formatOscilloscopeValueLabel(rawValue, byteSize, signMode);

  const x = chartArea.left + 10;

  const axisBandTop = xScale.top;
  const axisBandBottom = xScale.bottom;
  const axisBandHeight = Math.max(0, axisBandBottom - axisBandTop);
  const y = axisBandTop + axisBandHeight * 0.78;

  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.style.opacity = "1";
}

function clampToRange(value, minValue, maxValue) {
  return Math.min(maxValue, Math.max(minValue, value));
}

function getCurrentOscilloscopeYBounds() {
  const modeRange = getOscilloscopeModeRange();
  const fallbackMin = modeRange.yMin;
  const fallbackMax = modeRange.yMax;

  if (!oscilloscopeChart?.scales?.y) {
    return { yMin: fallbackMin, yMax: fallbackMax };
  }

  const yScale = oscilloscopeChart.scales.y;
  let yMin = Number.isFinite(yScale.options?.min)
    ? Number(yScale.options.min)
    : Number(yScale.min);
  let yMax = Number.isFinite(yScale.options?.max)
    ? Number(yScale.options.max)
    : Number(yScale.max);

  if (!Number.isFinite(yMin)) yMin = fallbackMin;
  if (!Number.isFinite(yMax)) yMax = fallbackMax;
  if (yMin > yMax) {
    const tmp = yMin;
    yMin = yMax;
    yMax = tmp;
  }

  return { yMin, yMax };
}

function buildOscilloscopeViewportData(yMin, yMax) {
  return oscilloscopeData.map((rawY, index) => {
    const overflow = rawY < yMin || rawY > yMax;
    return {
      x: index,
      y: clampToRange(rawY, yMin, yMax),
      rawY,
      overflow,
    };
  });
}

function syncOscilloscopeViewportData(updateMode = "none") {
  if (!oscilloscopeChart) return;
  const { yMin, yMax } = getCurrentOscilloscopeYBounds();
  oscilloscopeChart.data.datasets[0].data = buildOscilloscopeViewportData(
    yMin,
    yMax
  );
  oscilloscopeChart.update(updateMode);
}

/**
 * Update oscilloscope with new data
 */
function updateOscilloscopeData(uint8Array) {
  if (!oscilloscopeChart) {
    return;
  }

  const points = 500;
  const byteSize = document.querySelector(
    'input[name="byteSize"]:checked'
  ).value;
  const signMode = document.querySelector(
    'input[name="signMode"]:checked'
  ).value;

  // Process bytes according to selected mode
  for (let byte of uint8Array) {
    byteBuffer.push(byte);

    // Check if we have enough bytes for the selected mode
    if (
      byteSize === "1" ||
      (byteSize === "2BE" && byteBuffer.length >= 2) ||
      (byteSize === "2LE" && byteBuffer.length >= 2)
    ) {
      let value;

      if (byteSize === "1") {
        // 1 byte mode
        value = byteBuffer.shift();
        if (signMode === "signed") {
          // Convert to signed byte (-128 to 127)
          value = value > 127 ? value - 256 : value;
        }
      } else if (byteSize === "2BE") {
        // 2 byte Big Endian
        const high = byteBuffer.shift();
        const low = byteBuffer.shift();
        value = (high << 8) | low;
        if (signMode === "signed") {
          // Convert to signed 16-bit (-32768 to 32767)
          value = value > 32767 ? value - 65536 : value;
        }
      } else if (byteSize === "2LE") {
        // 2 byte Little Endian
        const low = byteBuffer.shift();
        const high = byteBuffer.shift();
        value = (high << 8) | low;
        if (signMode === "signed") {
          // Convert to signed 16-bit (-32768 to 32767)
          value = value > 32767 ? value - 65536 : value;
        }
      }

      // Add value to oscilloscope data
      oscilloscopeData.push(value);
      if (oscilloscopeData.length > points) {
        oscilloscopeData.shift();
      }
    }
  }

  // Update chart with clamped-to-viewport values
  syncOscilloscopeViewportData("none");
}

/**
 * Clear oscilloscope data
 */
function clearOscilloscope() {
  if (oscilloscopeChart) {
    const points = 500;
    oscilloscopeData = new Array(points).fill(0);
    byteBuffer = []; // Clear byte buffer
    rxPausedByteParity = 0;
    rxResumeDiscardBytes = 0;
    resetOscilloscopeAutoAlignState();
    if (isOscilloscopeTwoByteMode()) {
      requestOscilloscopeAutoAlign();
    }
    syncOscilloscopeViewportData("none");
  }
}

/**
 * Update oscilloscope settings
 */
function updateOscilloscopeSettings() {
  if (oscilloscopeChart) {
    initOscilloscope();
  }

  if (pendingReceiveStop && shouldFinalizePendingReceiveStop()) {
    stopReceivingImmediately(false);
  }
}

/**
 * Handle keyboard shortcuts
 */
document.addEventListener("keydown", function (e) {
  // Ctrl+Enter to send
  if (e.ctrlKey && e.key === "Enter" && !sendBtn.disabled) {
    handleRunAction();
  }

  // Ctrl+L to clear
  if (e.ctrlKey && e.key === "l") {
    e.preventDefault();
    clearTerminals();
  }

  // Ctrl+S to save TxD log
  if (e.ctrlKey && e.key === "s") {
    e.preventDefault();
    saveTxLog();
  }

  // R key to reset zoom/pan when oscilloscope is visible
  if (
    e.key === "r" &&
    currentView === "oscilloscope" &&
    document.activeElement !== terminalInput &&
    !e.ctrlKey &&
    !e.altKey &&
    !e.shiftKey
  ) {
    e.preventDefault();
    resetChartView();
  }
});

/**
 * Handle window resize for oscilloscope
 */
window.addEventListener("resize", function () {
  if (oscilloscopeChart) {
    oscilloscopeChart.resize();
  }
});

/**
 * Cleanup on page unload
 */
window.addEventListener("beforeunload", async function (e) {
  if (port) {
    await disconnectSerial();
  }
});

/**
 * Start loop sending
 */
function startLoopSend() {
  // Make sure there is data to send.
  const inputValue = terminalInput.value.trim();

  if (txView === "generator") {
    startGeneratorStream(true);
    return;
  }

  if (!inputValue) {
    addToTerminal("error", "Nothing to send", terminalSent);
    return;
  }

  // Read the interval from the input.
  const intervalMs = getNormalizedLoopIntervalMs(TX_TEXT_INTERVAL_MS);

  // Send once immediately.
  sendDataLoop();

  // Start the repeating send timer.
  loopInterval = setInterval(() => {
    sendDataLoop();
  }, intervalMs);

  updateRunButtonState();
}
/**
 * Stop loop sending
 */
function stopLoopSend() {
  if (generatorStream) {
    dropDanglingOscilloscopePairByte();
  }

  if (loopInterval) {
    clearInterval(loopInterval);
    loopInterval = null;
  }
  generatorStream = null;

  updateRunButtonState();
}

function getGeneratorConfig() {
  const waveform = document.getElementById("genWaveform")?.value || "sine";
  const samples = parseInt(document.getElementById("genSamples")?.value) || 64;
  const amplitude =
    parseFloat(document.getElementById("genAmplitude")?.value) || 0;
  const offset = parseFloat(document.getElementById("genOffset")?.value) || 0;
  const duty = parseFloat(document.getElementById("genDuty")?.value) || 50;
  const signMode =
    document.querySelector('input[name="genSignMode"]:checked')?.value ||
    "unsigned";
  const byteSize =
    document.querySelector('input[name="genByteSize"]:checked')?.value || "1";

  return {
    waveform,
    samples: Math.max(4, Math.min(4096, samples)),
    amplitude,
    offset,
    duty: Math.max(1, Math.min(99, duty)),
    signMode,
    byteSize,
  };
}

function generateWaveSamples(config) {
  const { waveform, samples, amplitude, offset, duty } = config;
  const out = new Array(samples);

  for (let i = 0; i < samples; i++) {
    const t = i / samples;
    let base = 0;

    if (waveform === "triangle") {
      base = 2 * Math.abs(2 * (t - Math.floor(t + 0.5))) - 1;
    } else if (waveform === "square") {
      base = t < duty / 100 ? 1 : -1;
    } else {
      base = Math.sin(2 * Math.PI * t);
    }

    out[i] = offset + amplitude * base;
  }

  return out;
}

function encodeGeneratorSamples(values, signMode, byteSize) {
  const bytes = [];
  const signed = signMode === "signed";

  for (const raw of values) {
    let v = Math.round(raw);

    if (byteSize === "1") {
      if (signed) {
        v = Math.max(-128, Math.min(127, v));
        if (v < 0) v += 256;
      } else {
        v = Math.max(0, Math.min(255, v));
      }
      bytes.push(v & 0xff);
    } else {
      if (signed) {
        v = Math.max(-32768, Math.min(32767, v));
        if (v < 0) v += 65536;
      } else {
        v = Math.max(0, Math.min(65535, v));
      }
      const high = (v >> 8) & 0xff;
      const low = v & 0xff;
      if (byteSize === "2LE") {
        bytes.push(low, high);
      } else {
        bytes.push(high, low);
      }
    }
  }

  return new Uint8Array(bytes);
}

function buildGeneratorStream(looping) {
  const config = getGeneratorConfig();
  const values = generateWaveSamples(config);
  const payload = encodeGeneratorSamples(
    values,
    config.signMode,
    config.byteSize
  );

  return {
    payload,
    index: 0,
    loop: looping,
    logged: false,
    sending: false,
    label: `GEN ${config.waveform}: ${values.length} samples`,
  };
}

function startGeneratorStream(looping) {
  if (!writer) return;

  dropDanglingOscilloscopePairByte();
  generatorStream = buildGeneratorStream(looping);
  if (!generatorStream.payload || generatorStream.payload.length === 0) {
    generatorStream = null;
    return;
  }

  const intervalMs = getNormalizedLoopIntervalMs(TX_GENERATOR_INTERVAL_MS);
  sendGeneratorByte();
  loopInterval = setInterval(() => {
    sendGeneratorByte();
  }, intervalMs);

  updateRunButtonState();
}

async function sendGeneratorByte() {
  if (!writer || !generatorStream || generatorStream.sending) return;

  const payload = generatorStream.payload;
  if (!payload || payload.length === 0) return;

  generatorStream.sending = true;
  try {
    const byte = payload[generatorStream.index];
    await writer.write(new Uint8Array([byte]));

    if (!generatorStream.logged) {
      addToTerminal("sent", generatorStream.label, terminalSent);
      generatorStream.logged = true;
    }

    generatorStream.index += 1;

    if (generatorStream.index >= payload.length) {
      if (generatorStream.loop) {
        generatorStream.index = 0;
      } else {
        stopLoopSend();
      }
    }
  } catch (error) {
    console.error("Generator send error:", error);
    addToTerminal(
      "error",
      `Generator send failed: ${error.message}`,
      terminalSent
    );
    stopLoopSend();
  } finally {
    if (generatorStream) {
      generatorStream.sending = false;
    }
  }
}
/**
 * Send data in loop (without clearing input)
 */
async function sendDataLoop() {
  if (!writer) return;

  const inputMode = getTxMode();
  const inputValue = terminalInput.value.trim();

  if (!inputValue) return;

  try {
    let dataToSend;
    let displayText;

    if (inputMode === "hex") {
      // HEX mode
      const hexValues = inputValue.match(/[0-9A-Fa-f]{1,2}/g);
      if (!hexValues) {
        addToTerminal("error", "Invalid HEX format", terminalSent);
        return;
      }

      dataToSend = new Uint8Array(hexValues.map((hex) => parseInt(hex, 16)));
      displayText = hexValues
        .map((hex) => hex.toUpperCase().padStart(2, "0"))
        .join(" ");
    } else {
      // ASCII mode
      const encoder = new TextEncoder();
      const textWithLineEnding = inputValue + "\r\n";
      dataToSend = encoder.encode(textWithLineEnding);
      // addToTerminal applies visualizeCRLFWithBreaks.
      displayText = textWithLineEnding;
    }

    // Send data
    await writer.write(dataToSend);

    // Display in terminal
    if (inputMode === "hex") {
      addToTerminal("sent hex-mode", displayText, terminalSent);
    } else {
      addToTerminal("sent", displayText, terminalSent);
    }

    // Keep the input intact during loop sending.
  } catch (error) {
    console.error("Send error:", error);
    addToTerminal("error", `Send failed: ${error.message}`, terminalSent);
    stopLoopSend(); // Stop the loop on send errors.
  }
}

/**
 * Initialize chart zoom and pan controls
 */
function initChartControls() {
  if (!oscilloscopeCanvas) return;

  // Remove existing listeners to prevent duplicates
  oscilloscopeCanvas.removeEventListener("wheel", handleChartZoom);
  oscilloscopeCanvas.removeEventListener("contextmenu", handleChartContextMenu);
  oscilloscopeCanvas.removeEventListener("mousedown", handleChartMouseDown);
  oscilloscopeCanvas.removeEventListener("mousemove", handleChartMouseMove);
  oscilloscopeCanvas.removeEventListener("mouseup", handleChartMouseUp);
  oscilloscopeCanvas.removeEventListener("mouseleave", handleChartMouseUp);

  // Add new listeners
  oscilloscopeCanvas.addEventListener("wheel", handleChartZoom, {
    passive: false,
  });
  oscilloscopeCanvas.addEventListener("contextmenu", handleChartContextMenu);
  oscilloscopeCanvas.addEventListener("mousedown", handleChartMouseDown);
  oscilloscopeCanvas.addEventListener("mousemove", handleChartMouseMove);
  oscilloscopeCanvas.addEventListener("mouseup", handleChartMouseUp);
  oscilloscopeCanvas.addEventListener("mouseleave", handleChartMouseUp);
}

function handleChartContextMenu(e) {
  e.preventDefault();
}

function getMousePos(e) {
  const rect = oscilloscopeCanvas.getBoundingClientRect();
  return {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top,
  };
}

function getAxisHoverMode(chart, x, y) {
  if (!chart) return null;
  const chartArea = chart.chartArea;
  if (!chartArea) return null;
  const xScale = chart.scales?.x;
  const yScale = chart.scales?.y;
  if (!xScale || !yScale) return null;

  const padding = 8;

  const inXBand =
    x >= chartArea.left - padding &&
    x <= chartArea.right + padding &&
    y >= chartArea.bottom &&
    y <= xScale.bottom + padding;

  if (inXBand) return "x";

  const leftAxisBand =
    x >= yScale.left - padding &&
    x <= chartArea.left &&
    y >= chartArea.top - padding &&
    y <= chartArea.bottom + padding;

  const rightAxisBand =
    x >= chartArea.right &&
    x <= yScale.right + padding &&
    y >= chartArea.top - padding &&
    y <= chartArea.bottom + padding;

  if (leftAxisBand || rightAxisBand) return "y";

  return null;
}

function setAxisHoverMode(mode) {
  const normalized = mode === "x" || mode === "y" ? mode : null;
  if (axisHoverMode === normalized) return;
  axisHoverMode = normalized;
  if (oscilloscopeChart) {
    oscilloscopeChart.update("none");
  }
}

/**
 * Handle chart zoom with mouse wheel
 */
function handleChartZoom(e) {
  e.preventDefault();

  if (!oscilloscopeChart) return;

  const chartArea = oscilloscopeChart.chartArea;
  if (!chartArea) return;

  const rect = oscilloscopeCanvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;
  const insidePlotArea =
    mouseX >= chartArea.left &&
    mouseX <= chartArea.right &&
    mouseY >= chartArea.top &&
    mouseY <= chartArea.bottom;

  if (!insidePlotArea) return;

  // Zoom factor
  const zoomIntensity = 0.1;
  const wheel = e.deltaY < 0 ? 1 : -1;
  const zoomFactor = Math.exp(wheel * zoomIntensity);

  // Update zoom level
  const newZoomX = chartZoom.x * zoomFactor;
  const newZoomY = chartZoom.y * zoomFactor;

  // Limit zoom range
  const minZoom = 0.5;
  const maxZoom = 10;

  if (newZoomX >= minZoom && newZoomX <= maxZoom) {
    // Update zoom
    chartZoom.x = newZoomX;
    chartZoom.y = newZoomY;

    // Keep cursor position anchored during zoom
    const xScale = oscilloscopeChart.scales.x;
    const yScale = oscilloscopeChart.scales.y;

    if (xScale && yScale) {
      const xCurrentMin = Number.isFinite(xScale.options.min)
        ? Number(xScale.options.min)
        : Number(xScale.min);
      const xCurrentMax = Number.isFinite(xScale.options.max)
        ? Number(xScale.options.max)
        : Number(xScale.max);
      const yCurrentMin = Number.isFinite(yScale.options.min)
        ? Number(yScale.options.min)
        : Number(yScale.min);
      const yCurrentMax = Number.isFinite(yScale.options.max)
        ? Number(yScale.options.max)
        : Number(yScale.max);

      const xAnchor = Number(xScale.getValueForPixel(mouseX));
      const yAnchor = Number(yScale.getValueForPixel(mouseY));
      if (!Number.isFinite(xAnchor) || !Number.isFinite(yAnchor)) return;

      let newXMin = xAnchor - (xAnchor - xCurrentMin) / zoomFactor;
      let newXMax = xAnchor + (xCurrentMax - xAnchor) / zoomFactor;
      const newYMin = yAnchor - (yAnchor - yCurrentMin) / zoomFactor;
      const newYMax = yAnchor + (yCurrentMax - yAnchor) / zoomFactor;

      // Keep X range within available samples
      const xDataMin = 0;
      const xDataMax =
        oscilloscopeData.length > 0 ? oscilloscopeData.length - 1 : 0;
      const xRange = newXMax - newXMin;
      const xFullRange = xDataMax - xDataMin;

      if (xFullRange <= 0 || xRange >= xFullRange) {
        newXMin = xDataMin;
        newXMax = xDataMax;
      } else {
        if (newXMin < xDataMin) {
          newXMax += xDataMin - newXMin;
          newXMin = xDataMin;
        }
        if (newXMax > xDataMax) {
          newXMin -= newXMax - xDataMax;
          newXMax = xDataMax;
        }
      }

      // Update chart scales
      xScale.options.min = newXMin;
      xScale.options.max = newXMax;
      yScale.options.min = newYMin;
      yScale.options.max = newYMax;

      syncOscilloscopeViewportData("none");
    }
  }
}

/**
 * Handle mouse down for panning
 */
function handleChartMouseDown(e) {
  if (!oscilloscopeChart) return;

  const mouse = getMousePos(e);
  if (e.button === 0) {
    const axisMode = getAxisHoverMode(oscilloscopeChart, mouse.x, mouse.y);
    if (axisMode) {
      e.preventDefault();
      isAxisDrag = true;
      axisDragMode = axisMode;
      setAxisHoverMode(axisMode);
      axisDragStart = { ...mouse };

      const xScale = oscilloscopeChart.scales.x;
      const yScale = oscilloscopeChart.scales.y;
      axisDragScaleStart = {
        xMin: xScale.options.min ?? xScale.min,
        xMax: xScale.options.max ?? xScale.max,
        yMin: yScale.options.min ?? yScale.min,
        yMax: yScale.options.max ?? yScale.max,
      };

      oscilloscopeCanvas.style.cursor =
        axisMode === "y" ? "ns-resize" : "ew-resize";
      return;
    }
  }

  // Pan with left or right mouse button
  if (e.button === 0 || e.button === 2) {
    e.preventDefault();
    isPanningChart = true;
    setAxisHoverMode(null);

    panStartPos = { x: e.clientX, y: e.clientY };

    if (oscilloscopeChart) {
      const xScale = oscilloscopeChart.scales.x;
      const yScale = oscilloscopeChart.scales.y;

      if (xScale && yScale) {
        panStartOffset = {
          xMin: xScale.options.min || xScale.min,
          xMax: xScale.options.max || xScale.max,
          yMin: yScale.options.min || yScale.min,
          yMax: yScale.options.max || yScale.max,
        };
      }
    }

    // Change cursor
    oscilloscopeCanvas.style.cursor = "grabbing";
  }
}

/**
 * Handle mouse move for panning
 */
function handleChartMouseMove(e) {
  if (!oscilloscopeChart) return;

  if (isAxisDrag) {
    const mouse = getMousePos(e);
    const chartArea = oscilloscopeChart.chartArea;
    if (!chartArea) return;

    if (axisDragMode === "x") {
      const deltaX = mouse.x - axisDragStart.x;
      const xScale = oscilloscopeChart.scales.x;
      const startMin = axisDragScaleStart.xMin;
      const startMax = axisDragScaleStart.xMax;
      const startRange = startMax - startMin;
      const factor = Math.exp(-deltaX * 0.005);
      let newRange = Math.max(startRange * factor, 1e-6);
      const mid = (startMin + startMax) / 2;

      const xDataMax =
        oscilloscopeData.length > 0 ? oscilloscopeData.length - 1 : 499;
      const minLimit = 0;
      const maxLimit = xDataMax;
      const maxRange = maxLimit - minLimit;

      if (newRange > maxRange) newRange = maxRange;

      let newMin = mid - newRange / 2;
      let newMax = mid + newRange / 2;

      if (newMin < minLimit) {
        newMin = minLimit;
        newMax = minLimit + newRange;
      }
      if (newMax > maxLimit) {
        newMax = maxLimit;
        newMin = maxLimit - newRange;
      }

      xScale.options.min = newMin;
      xScale.options.max = newMax;
    } else if (axisDragMode === "y") {
      const deltaY = mouse.y - axisDragStart.y;
      const yScale = oscilloscopeChart.scales.y;
      const startMin = axisDragScaleStart.yMin;
      const startMax = axisDragScaleStart.yMax;
      const startRange = startMax - startMin;
      const factor = Math.exp(deltaY * 0.005);
      const newRange = Math.max(startRange * factor, 1e-6);
      const mid = (startMin + startMax) / 2;
      yScale.options.min = mid - newRange / 2;
      yScale.options.max = mid + newRange / 2;
    }

    syncOscilloscopeViewportData("none");
    return;
  }

  if (!isPanningChart) {
    const mouse = getMousePos(e);
    const hoverMode = getAxisHoverMode(oscilloscopeChart, mouse.x, mouse.y);
    setAxisHoverMode(hoverMode);
    if (hoverMode === "y") {
      oscilloscopeCanvas.style.cursor = "ns-resize";
    } else if (hoverMode === "x") {
      oscilloscopeCanvas.style.cursor = "ew-resize";
    } else {
      oscilloscopeCanvas.style.cursor = "default";
    }
    return;
  }

  const chartArea = oscilloscopeChart.chartArea;
  if (!chartArea) return;

  // Calculate movement delta
  const deltaX = e.clientX - panStartPos.x;
  const deltaY = e.clientY - panStartPos.y;

  // Convert pixel delta to data delta
  const xScale = oscilloscopeChart.scales.x;
  const yScale = oscilloscopeChart.scales.y;

  if (xScale && yScale) {
    const xRange = panStartOffset.xMax - panStartOffset.xMin;
    const yRange = panStartOffset.yMax - panStartOffset.yMin;

    const xDataDelta = -(deltaX / chartArea.width) * xRange;
    let yDataDelta = (deltaY / chartArea.height) * yRange;

    // Calculate new X boundaries
    let newXMin = panStartOffset.xMin + xDataDelta;
    let newXMax = panStartOffset.xMax + xDataDelta;

    // Get the original data range
    const originalXMin = 0;
    const originalXMax = 499;

    // Constrain X axis panning to not go beyond data boundaries
    if (newXMin < originalXMin) {
      newXMin = originalXMin;
      newXMax = originalXMin + xRange;
    }
    if (newXMax > originalXMax) {
      newXMax = originalXMax;
      newXMin = originalXMax - xRange;
    }

    // Clamp vertical pan to +/-40% of the max amplitude for the current mode
    const { yMin, yMax, maxAmplitude } = getOscilloscopeModeRange();
    const limitShift = maxAmplitude * 0.4;
    const minDelta = yMin - limitShift - panStartOffset.yMin;
    const maxDelta = yMax + limitShift - panStartOffset.yMax;
    yDataDelta = Math.min(Math.max(yDataDelta, minDelta), maxDelta);

    // Update scales
    xScale.options.min = newXMin;
    xScale.options.max = newXMax;
    yScale.options.min = panStartOffset.yMin + yDataDelta;
    yScale.options.max = panStartOffset.yMax + yDataDelta;

    syncOscilloscopeViewportData("none");
  }
}

/**
 * Handle mouse up to stop panning
 */
function handleChartMouseUp(e) {
  if (e.button === 0 || e.button === 2 || isPanningChart) {
    isPanningChart = false;
  }

  if (e.button === 0 || isAxisDrag) {
    isAxisDrag = false;
    axisDragMode = null;
  }

  if (!isPanningChart && !isAxisDrag) {
    oscilloscopeCanvas.style.cursor = "default";
    if (e.type === "mouseleave") {
      setAxisHoverMode(null);
    }
  }
}

/**
 * Reset chart zoom and pan
 */
function resetChartView() {
  if (!oscilloscopeChart) return;

  chartZoom = { x: 1, y: 1 };
  chartPan = { x: 0, y: 0 };

  const xScale = oscilloscopeChart.scales.x;
  const yScale = oscilloscopeChart.scales.y;

  if (xScale && yScale) {
    const { yMin, yMax } = getOscilloscopeModeRange();

    // Reset to original ranges
    delete xScale.options.min;
    delete xScale.options.max;
    yScale.options.min = yMin;
    yScale.options.max = yMax;

    syncOscilloscopeViewportData();
  }
}

function getOscilloscopeModeRange() {
  const byteSize =
    document.querySelector('input[name="byteSize"]:checked')?.value || "1";
  const signMode =
    document.querySelector('input[name="signMode"]:checked')?.value ||
    "unsigned";

  let yMin;
  let yMax;
  let maxAmplitude;

  if (byteSize === "1") {
    if (signMode === "unsigned") {
      yMin = 0;
      yMax = 255;
      maxAmplitude = 255;
    } else {
      yMin = -128;
      yMax = 127;
      maxAmplitude = 128;
    }
  } else {
    if (signMode === "unsigned") {
      yMin = 0;
      yMax = 65535;
      maxAmplitude = 65535;
    } else {
      yMin = -32768;
      yMax = 32767;
      maxAmplitude = 32768;
    }
  }

  return { yMin, yMax, maxAmplitude };
}

function updateOscilloscopeFullscreenState() {
  const btn = document.getElementById("oscilloFullscreenBtn");
  const rxSession = document.getElementById("uartRxSession");
  if (!btn || !rxSession) return;
  const isFull = document.fullscreenElement === rxSession;
  btn.classList.toggle("active", isFull);
  btn.title = isFull ? "Exit fullscreen" : "Fullscreen";
  btn.setAttribute("aria-label", btn.title);
  if (oscilloscopeChart) {
    oscilloscopeChart.resize();
  }
}

function toggleOscilloscopeFullscreen() {
  const rxSession = document.getElementById("uartRxSession");
  if (!rxSession) return;

  if (document.fullscreenElement) {
    document.exitFullscreen?.();
    return;
  }

  if (rxSession.requestFullscreen) {
    rxSession.requestFullscreen();
  }
}

