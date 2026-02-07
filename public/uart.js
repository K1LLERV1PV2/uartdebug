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
let generatorStream = null;
const TX_GENERATOR_INTERVAL_MS = 10;
const TX_TEXT_INTERVAL_MS = 1000;
const TX_INTERVAL_MIN_MS = 10;
const TX_INTERVAL_MAX_MS = 10000;

// DOM elements cache
let terminalSent = null;
let terminalReceived = null;
let txTerminalShell = null;
let rxTerminalShell = null;
let terminalInput = null;
let txGeneratorPanel = null;
let txLogControls = null;
let txModeControls = null;
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

// Initialize on page load
document.addEventListener("DOMContentLoaded", function () {
  initializeElements();
  initializeEventListeners();
  updateTxInputPlaceholder();
  updateGeneratorUi();
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
  terminalInput = document.getElementById("terminalInput");
  txGeneratorPanel = document.getElementById("txGeneratorPanel");
  txLogControls = document.getElementById("txLogControls");
  txModeControls = document.getElementById("txModeControls");
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
  uartSessions = Array.from(document.querySelectorAll(".uart-session"));
}

/**
 * Initialize all event listeners
 */
function initializeEventListeners() {
  // Connection button
  connectBtn.addEventListener("click", toggleConnection);

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

  document.addEventListener(
    "fullscreenchange",
    updateOscilloscopeFullscreenState
  );

}

/**
 * Check if Web Serial API is supported
 */
function checkWebSerialSupport() {
  if (!("serial" in navigator)) {
    document.getElementById("apiWarning").classList.add("show");
    connectBtn.disabled = true;
    sendBtn.disabled = true;
    if (receiveToggleBtn) receiveToggleBtn.disabled = true;
    terminalInput.disabled = true;
  }
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

/**
 * Connect to serial port
 */
async function connectSerial() {
  try {
    // Get port selection from user
    port = await navigator.serial.requestPort();

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
  } catch (error) {
    console.error("Connection error:", error);
    // addToTerminal('error', `Connection failed: ${error.message}`, terminalSent);
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
    session.inert = !!locked;
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
    statusIndicator.textContent = deviceLabel
      ? `Connected: ${deviceLabel}`
      : "Connected";
    statusIndicator.classList.remove("disconnected");
    statusIndicator.classList.add("connected");
    connectBtn.textContent = "Disconnect";
    connectBtn.classList.add("connected");
    sendBtn.disabled = false;
    if (receiveToggleBtn) receiveToggleBtn.disabled = false;
    if (cycleCheckbox) cycleCheckbox.disabled = false;
    loopIntervalInput.disabled = false;
    updateTxInputAvailability();
  } else {
    statusIndicator.textContent = "Disconnected";
    statusIndicator.classList.remove("connected");
    statusIndicator.classList.add("disconnected");
    connectBtn.textContent = "Connect";
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

function updateTxInputAvailability() {
  if (!terminalInput) return;
  const enabled = !!port && txView === "text";
  terminalInput.disabled = !enabled;
}

function setConnectionSelectsDisabled(disabled) {
  document.querySelectorAll(".connection-control select").forEach((el) => {
    el.disabled = !!disabled;
  });
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
    return;
  }

  if (currentView === "oscilloscope") {
    updateOscilloscopeData(data);
  }

  rxAppend(data);

  if (rxFlushTimer) clearTimeout(rxFlushTimer);
  rxFlushTimer = setTimeout(flushRxBufferToTerminal, rxSilenceMs);
}

function rxAppend(chunk) {
  // Склеиваем Uint8Array без мутаций исходников
  const merged = new Uint8Array(rxBuffer.length + chunk.length);
  merged.set(rxBuffer, 0);
  merged.set(chunk, rxBuffer.length);
  rxBuffer = merged;
}

function flushRxBufferToTerminal() {
  if (!rxBuffer || rxBuffer.length === 0) return;

  // Определяем текущий режим отображения RxD
  const inputMode = getRxMode();

  if (inputMode === "hex") {
    // HEX: весь буфер одной строкой
    const hexString = formatHexData(rxBuffer);
    addToTerminal("received", hexString, terminalReceived);
  } else {
    // ASCII: декодируем целиком, CR/LF будут отрисованы красиво внутри addToTerminal
    // (addToTerminal уже вызывает visualizeCRLFWithBreaks)
    const decoder = new TextDecoder();
    const text = decoder.decode(rxBuffer);
    addToTerminal("received", text, terminalReceived);
  }

  // Очистка
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

    // Clear input
    terminalInput.value = "";
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
    .replace(/\r/g, "\\r\r") // видимая "\r" + реальная \r (на экране эффекта не даст)
    .replace(/\n/g, "\\n\n"); // видимая "\n" + реальный перенос
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
  const waveform = document.getElementById("genWaveform")?.value || "sine";
  if (dutyField) {
    dutyField.style.display = waveform === "square" ? "flex" : "none";
  }
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
  } else {
    if (txTerminalShell) txTerminalShell.style.display = "flex";
    if (txGeneratorPanel) txGeneratorPanel.style.display = "none";
    if (txLogControls) txLogControls.style.display = "flex";
    if (txModeControls) txModeControls.style.display = "flex";
  }

  if (loopInterval) {
    stopLoopSend();
  }
  applyTxViewDefaults();
  updateTxInputAvailability();
}

function updateRunButtonState() {
  if (!sendBtn) return;
  const running = !!loopInterval;
  sendBtn.textContent = running ? "Stop" : "Run";
  sendBtn.classList.toggle("running", running);
  sendBtn.title = running ? "Stop cycle" : "Run";
}

function updateReceiveButtonState() {
  if (!receiveToggleBtn) return;
  const receiving = !!isReceiving;
  receiveToggleBtn.textContent = receiving ? "Stop" : "Get";
  receiveToggleBtn.classList.toggle("receiving", receiving);
  receiveToggleBtn.title = receiving ? "Stop receiving" : "Get data";
}

function toggleReceiving() {
  isReceiving = !isReceiving;
  if (!isReceiving) {
    rxBuffer = new Uint8Array(0);
    if (rxFlushTimer) {
      clearTimeout(rxFlushTimer);
      rxFlushTimer = null;
    }
  }
  updateReceiveButtonState();
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
          borderColor: "#2ecc71",
          backgroundColor: "rgba(46, 204, 113, 0.1)",
          borderWidth: 2,
          tension: 0,
          pointRadius: function (context) {
            return context.raw?.overflow ? 1.8 : 0;
          },
          pointHoverRadius: 4,
          pointBackgroundColor: function (context) {
            return context.raw?.overflow ? "#e74c3c" : "#2ecc71";
          },
          segment: {
            borderColor: function (context) {
              return context.p0.raw?.overflow || context.p1.raw?.overflow
                ? "#e74c3c"
                : "#2ecc71";
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
          enabled: true,
          callbacks: {
            label: function (context) {
              const value = Number.isFinite(context.raw?.rawY)
                ? context.raw.rawY
                : context.parsed.y;
              // Format tooltip based on current mode
              if (byteSize === "1") {
                if (signMode === "unsigned") {
                  return `Value: ${value} (0x${value
                    .toString(16)
                    .toUpperCase()
                    .padStart(2, "0")})`;
                } else {
                  const hexValue =
                    value < 0 ? (256 + value).toString(16) : value.toString(16);
                  return `Value: ${value} (0x${hexValue
                    .toUpperCase()
                    .padStart(2, "0")})`;
                }
              } else {
                if (signMode === "unsigned") {
                  return `Value: ${value} (0x${value
                    .toString(16)
                    .toUpperCase()
                    .padStart(4, "0")})`;
                } else {
                  const hexValue =
                    value < 0
                      ? (65536 + value).toString(16)
                      : value.toString(16);
                  return `Value: ${value} (0x${hexValue
                    .toUpperCase()
                    .padStart(4, "0")})`;
                }
              }
            },
          },
        },
      },
      scales: {
        x: {
          display: true,
          title: { display: true, text: "Sample", color: "#ecf0f1" },
          ticks: { color: "#bdc3c7" },
          border: {
            display: true,
            color: function () {
              return axisHoverMode === "x"
                ? "rgba(236, 240, 241, 0.9)"
                : "rgba(236, 240, 241, 0.08)";
            },
            width: function () {
              return axisHoverMode === "x" ? 1.6 : 1;
            },
          },
          grid: {
            color: "rgba(127, 140, 141, 0.2)",
          },
        },
        y: {
          display: true,
          title: {
            display: true,
            text: yTitle,
            color: "#ecf0f1",
          },
          border: {
            display: true,
            color: function () {
              return axisHoverMode === "y"
                ? "rgba(236, 240, 241, 0.9)"
                : "rgba(236, 240, 241, 0.08)";
            },
            width: function () {
              return axisHoverMode === "y" ? 1.6 : 1;
            },
          },
          min: yMin,
          max: yMax,
          ticks: {
            color: "#bdc3c7",
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
            color: "rgba(127, 140, 141, 0.2)",
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
  // Проверяем, что есть что отправлять
  const inputValue = terminalInput.value.trim();

  if (txView === "generator") {
    startGeneratorStream(true);
    return;
  }

  if (!inputValue) {
    addToTerminal("error", "Nothing to send", terminalSent);
    return;
  }

  // Получаем интервал из поля ввода
  const intervalMs = getNormalizedLoopIntervalMs(TX_TEXT_INTERVAL_MS);

  // Отправляем первый раз сразу
  sendDataLoop();

  // Запускаем интервал
  loopInterval = setInterval(() => {
    sendDataLoop();
  }, intervalMs);

  updateRunButtonState();
}
/**
 * Stop loop sending
 */
function stopLoopSend() {
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
      // Не применяем visualizeCRLFWithBreaks здесь - это делается в addToTerminal
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

    // НЕ очищаем поле ввода при циклической отправке
  } catch (error) {
    console.error("Send error:", error);
    addToTerminal("error", `Send failed: ${error.message}`, terminalSent);
    stopLoopSend(); // Останавливаем цикл при ошибке
  }
}

/**
 * Initialize chart zoom and pan controls
 */
function initChartControls() {
  if (!oscilloscopeCanvas) return;

  // Remove existing listeners to prevent duplicates
  oscilloscopeCanvas.removeEventListener("wheel", handleChartZoom);
  oscilloscopeCanvas.removeEventListener("mousedown", handleChartMouseDown);
  oscilloscopeCanvas.removeEventListener("mousemove", handleChartMouseMove);
  oscilloscopeCanvas.removeEventListener("mouseup", handleChartMouseUp);
  oscilloscopeCanvas.removeEventListener("mouseleave", handleChartMouseUp);

  // Add new listeners
  oscilloscopeCanvas.addEventListener("wheel", handleChartZoom, {
    passive: false,
  });
  oscilloscopeCanvas.addEventListener("mousedown", handleChartMouseDown);
  oscilloscopeCanvas.addEventListener("mousemove", handleChartMouseMove);
  oscilloscopeCanvas.addEventListener("mouseup", handleChartMouseUp);
  oscilloscopeCanvas.addEventListener("mouseleave", handleChartMouseUp);
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

  const rect = oscilloscopeCanvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;

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
    // Calculate zoom center point
    const chartArea = oscilloscopeChart.chartArea;
    if (!chartArea) return;

    const xRelative = (mouseX - chartArea.left) / chartArea.width;
    const yRelative = (mouseY - chartArea.top) / chartArea.height;

    // Update zoom
    chartZoom.x = newZoomX;
    chartZoom.y = newZoomY;

    // Adjust pan to keep mouse position stable
    const xScale = oscilloscopeChart.scales.x;
    const yScale = oscilloscopeChart.scales.y;

    if (xScale && yScale) {
      const xRange = xScale.max - xScale.min;
      const yRange = yScale.max - yScale.min;

      // Calculate new ranges
      const newXRange = xRange / zoomFactor;
      const newYRange = yRange / zoomFactor;

      // Calculate new min/max to keep mouse position stable
      const xValue = xScale.min + xRelative * xRange;
      const yValue = yScale.min + yRelative * yRange;

      const newXMin = xValue - xRelative * newXRange;
      const newXMax = newXMin + newXRange;
      const newYMin = yValue - yRelative * newYRange;
      const newYMax = newYMin + newYRange;

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

  // Pan with left mouse button when not dragging axes
  if (e.button === 0) {
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
  if (e.button === 0 || isPanningChart) {
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

