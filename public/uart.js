// Global variables
let port = null;
let reader = null;
let writer = null;
let currentView = "terminal";
let oscilloscopePaused = false;
let oscilloscopeData = [];
let oscilloscopeChart = null;
let zoomLevel = 1;
let panOffset = 0;
let loopInterval = null;
let loopIntervalInput = null;
let byteBuffer = [];
let chartZoom = { x: 1, y: 1 };
let chartPan = { x: 0, y: 0 };
let isPanningChart = false;
let panStartPos = { x: 0, y: 0 };
let panStartOffset = { x: 0, y: 0 };
let rxBuffer = new Uint8Array(0);
let rxFlushTimer = null;
let rxSilenceMs = 5;

// DOM elements cache
let terminalSent = null;
let terminalReceived = null;
let terminalInput = null;
let connectBtn = null;
let sendBtn = null;
let statusIndicator = null;
let autoScrollCheckbox = null;
let timestampCheckbox = null;
let oscilloscopeCanvas = null;
let oscilloscopeContainer = null;
let sendLoopBtn = null;

// Initialize on page load
document.addEventListener("DOMContentLoaded", function () {
  initializeElements();
  initializeEventListeners();
  checkWebSerialSupport();
});

/**
 * Initialize DOM element references
 */
function initializeElements() {
  terminalSent = document.getElementById("terminalSent");
  terminalReceived = document.getElementById("terminalReceived");
  terminalInput = document.getElementById("terminalInput");
  connectBtn = document.getElementById("connectBtn");
  sendBtn = document.getElementById("sendBtn");
  sendLoopBtn = document.getElementById("sendLoopBtn");
  loopIntervalInput = document.getElementById("loopIntervalInput");
  statusIndicator = document.getElementById("statusIndicator");
  autoScrollCheckbox = document.getElementById("autoScrollCheckbox");
  timestampCheckbox = document.getElementById("timestampCheckbox");
  oscilloscopeCanvas = document.getElementById("oscilloscopeCanvas");
  oscilloscopeContainer = document.getElementById("oscilloscopeContainer");
}

/**
 * Initialize all event listeners
 */
function initializeEventListeners() {
  // Connection button
  connectBtn.addEventListener("click", toggleConnection);

  // Send button and input
  sendBtn.addEventListener("click", sendData);
  terminalInput.addEventListener("keypress", function (e) {
    if (e.key === "Enter") {
      sendData();
    }
  });

  // Loop send button
  sendLoopBtn.addEventListener("click", toggleLoopSend);

  // Loop interval input
  loopIntervalInput.addEventListener("change", function () {
    const value = parseInt(this.value);
    if (value >= 100 && value <= 10000) {
      // If loop is active, restart with new interval
      if (loopInterval) {
        stopLoopSend();
        startLoopSend();
      }
    }
  });

  // Clear and save buttons
  document.getElementById("clearBtn").addEventListener("click", clearTerminals);
  document.getElementById("saveLogBtn").addEventListener("click", saveLog);

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

  // Input mode radio buttons
  document.querySelectorAll('input[name="inputMode"]').forEach((radio) => {
    radio.addEventListener("change", handleInputModeChange);
  });

  // View toggle buttons
  document.querySelectorAll(".view-btn").forEach((btn) => {
    btn.addEventListener("click", handleViewChange);
  });

  // Oscilloscope controls
  document
    .getElementById("oscilloResetBtn")
    .addEventListener("click", resetChartView);
  document
    .getElementById("oscilloClearBtn")
    .addEventListener("click", clearOscilloscope);
  document
    .getElementById("oscilloPauseBtn")
    .addEventListener("click", toggleOscilloscopePause);

  document.querySelectorAll('input[name="signMode"]').forEach((radio) => {
    radio.addEventListener("change", updateOscilloscopeSettings);
  });

  document.querySelectorAll('input[name="byteSize"]').forEach((radio) => {
    radio.addEventListener("change", updateOscilloscopeSettings);
  });

  const hexUploadBtn = document.getElementById("hexUploadBtn");
  const hexFileInput = document.getElementById("hexFileInput");
  hexUploadBtn?.addEventListener("click", () => hexFileInput?.click());
  hexFileInput?.addEventListener("change", handleHexFileSelected);
}

/**
 * Check if Web Serial API is supported
 */
function checkWebSerialSupport() {
  if (!("serial" in navigator)) {
    document.getElementById("apiWarning").classList.add("show");
    connectBtn.disabled = true;
    sendBtn.disabled = true;
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
function updateConnectionStatus(connected, deviceLabel = "") {
  if (connected) {
    statusIndicator.textContent = deviceLabel
      ? `Connected: ${deviceLabel}`
      : "Connected";
    statusIndicator.classList.remove("disconnected");
    statusIndicator.classList.add("connected");
    connectBtn.textContent = "Disconnect";
    sendBtn.disabled = false;
    sendLoopBtn.disabled = false;
    loopIntervalInput.disabled = false;
    terminalInput.disabled = false;
  } else {
    statusIndicator.textContent = "Disconnected";
    statusIndicator.classList.remove("connected");
    statusIndicator.classList.add("disconnected");
    connectBtn.textContent = "Connect";
    sendBtn.disabled = true;
    sendLoopBtn.disabled = true;
    loopIntervalInput.disabled = true;
    terminalInput.disabled = true;
  }

  setConnectionSelectsDisabled(connected);
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
  if (currentView === "oscilloscope" && !oscilloscopePaused) {
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
  const inputModeElement = document.querySelector(
    'input[name="inputMode"]:checked'
  );
  const inputMode = inputModeElement ? inputModeElement.value : "ascii";

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

  const inputModeElement = document.querySelector(
    'input[name="inputMode"]:checked'
  );
  const inputMode = inputModeElement ? inputModeElement.value : "ascii";
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
 * Intel HEX upload support
 */
async function handleHexFileSelected(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;

  try {
    const text = await file.text();
    const { bytes, records } = parseIntelHex(text);

    if (!writer) {
      addToTerminal("error", "Not connected", terminalSent);
      return;
    }

    addToTerminal(
      "info",
      `HEX: parsed ${bytes.length} bytes from ${records} records. Sending...`,
      terminalSent
    );

    await sendHexBytes(bytes);

    addToTerminal("info", `HEX: done (${bytes.length} bytes).`, terminalSent);
  } catch (err) {
    console.error(err);
    addToTerminal("error", `HEX error: ${err.message}`, terminalSent);
  } finally {
    e.target.value = "";
  }
}

async function sendHexBytes(uint8) {
  if (!writer) {
    addToTerminal("error", "Not connected", terminalSent);
    return;
  }
  const CHUNK = 512;
  for (let i = 0; i < uint8.length; i += CHUNK) {
    const chunk = uint8.subarray(i, Math.min(i + CHUNK, uint8.length));
    await writer.write(chunk);
  }
  const previewLen = Math.min(64, uint8.length);
  if (previewLen) {
    addToTerminal(
      "sent",
      formatHexData(uint8.subarray(0, previewLen)) +
        (uint8.length > previewLen ? " ..." : ""),
      terminalSent
    );
  }
}

async function onFlashClick() {
  try {
    if (!port) {
      addToTerminal(
        "error",
        "Not connected. Click Connect first.",
        terminalSent
      );
      return;
    }

    const fileInput = document.getElementById("hexFileInput");
    const fileFromLoad = fileInput?.files?.[0];

    if (fileFromLoad) {
      const hexText = await fileFromLoad.text();
      try {
        await flashHexTextWithAvrdude(hexText, __mcuTarget);
      } catch (e) {
        addToTerminal(
          "warn",
          "avrdude-wasm недоступен → переключаюсь на JS-UPDI: " +
            (e?.message || e),
          terminalSent
        );
        await flashHexTextWithUpdiJS(hexText, __mcuTarget);
      }
      return;
    }

    const flashHexInput = document.getElementById("flashHexInput");
    if (flashHexInput) {
      flashHexInput.value = "";
      flashHexInput.click();
      return;
    }

    addToTerminal(
      "warn",
      "No HEX file. Use Load HEX or choose a file for flashing.",
      terminalSent
    );
  } catch (e) {
    addToTerminal("error", "Flash failed: " + (e?.message || e), terminalSent);
    console.error(e);
  }
}

/**
 * Intel HEX (IHEX) parser.
 * Supports record types: 00 (data), 01 (EOF), 02 (Ext. Segment), 04 (Ext. Linear).
 * Addresses are used only for correct parsing; we send the data in the file order.
 */
function parseIntelHex(text) {
  let extSegBase = 0;
  let extLinBase = 0;
  let totalRecords = 0;
  const out = [];

  const lines = text.split(/\r?\n/);
  lines.forEach((raw, idx) => {
    const line = raw.trim();
    if (!line) return;
    if (line[0] !== ":") throw new Error(`Line ${idx + 1}: missing ':'`);

    const hex = line.slice(1);
    if (hex.length < 10) throw new Error(`Line ${idx + 1}: too short`);

    const byteCount = parseInt(hex.slice(0, 2), 16);
    const addr = parseInt(hex.slice(2, 6), 16);
    const type = parseInt(hex.slice(6, 8), 16);

    const dataStr = hex.slice(8, 8 + byteCount * 2);
    const checksumStr = hex.slice(8 + byteCount * 2, 8 + byteCount * 2 + 2);

    if (dataStr.length !== byteCount * 2) {
      throw new Error(`Line ${idx + 1}: byte count mismatch`);
    }
    const checksum = parseInt(checksumStr, 16);

    let sum = (byteCount + ((addr >> 8) & 0xff) + (addr & 0xff) + type) & 0xff;
    const data = [];
    for (let i = 0; i < dataStr.length; i += 2) {
      const b = parseInt(dataStr.slice(i, i + 2), 16);
      if (Number.isNaN(b)) throw new Error(`Line ${idx + 1}: invalid hex`);
      data.push(b);
      sum = (sum + b) & 0xff;
    }
    const calcCks = ((~sum + 1) & 0xff) >>> 0;
    if (calcCks !== checksum) {
      const got = checksum.toString(16).toUpperCase().padStart(2, "0");
      const exp = calcCks.toString(16).toUpperCase().padStart(2, "0");
      throw new Error(
        `Line ${idx + 1}: bad checksum (got 0x${got}, expected 0x${exp})`
      );
    }

    totalRecords++;

    switch (type) {
      case 0x00: {
        // data record
        out.push(...data);
        break;
      }
      case 0x01:
        // EOF
        break;
      case 0x02: {
        // Extended Segment Address: (value << 4)
        if (data.length !== 2)
          throw new Error(`Line ${idx + 1}: ESA length != 2`);
        extSegBase = ((data[0] << 8) | data[1]) << 4;
        extLinBase = 0;
        break;
      }
      case 0x04: {
        // Extended Linear Address: (value << 16)
        if (data.length !== 2)
          throw new Error(`Line ${idx + 1}: ELA length != 2`);
        extLinBase = ((data[0] << 8) | data[1]) << 16;
        extSegBase = 0;
        break;
      }
      default:
        break;
    }
  });

  return { bytes: new Uint8Array(out), records: totalRecords };
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
  const inputModeElement = document.querySelector(
    'input[name="inputMode"]:checked'
  );
  const inputMode = inputModeElement ? inputModeElement.value : "ascii";

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

/**
 * Handle input mode change
 */
function handleInputModeChange(event) {
  const inputMode = event.target.value;

  if (inputMode === "hex") {
    terminalInput.placeholder = "String of Hex Digits like 37 AB 02 fD 7c";
    terminalInput.classList.add("hex-mode");
  } else {
    terminalInput.placeholder = "Text string";
    terminalInput.classList.remove("hex-mode");
  }
}

/**
 * Handle view change (Terminal/Oscilloscope)
 */
function handleViewChange(event) {
  const button = event.currentTarget;
  const view = button.dataset.view;
  const oscilloscopeControls = document.getElementById("oscilloscopeControls");
  const dataModeControls = document.getElementById("dataModeControls");

  // Update active button
  document.querySelectorAll(".view-btn").forEach((btn) => {
    btn.classList.remove("active");
  });
  button.classList.add("active");

  if (view === "oscilloscope") {
    // Show oscilloscope
    terminalReceived.style.display = "none";
    oscilloscopeContainer.style.display = "block";
    oscilloscopeControls.style.display = "flex";
    dataModeControls.style.display = "flex"; // Show new data mode controls
    currentView = "oscilloscope";

    // Initialize oscilloscope if needed
    if (!oscilloscopeChart) {
      initOscilloscope();
    }
  } else {
    // Show terminal
    terminalReceived.style.display = "block";
    oscilloscopeContainer.style.display = "none";
    oscilloscopeControls.style.display = "none";
    dataModeControls.style.display = "none"; // Hide data mode controls
    currentView = "terminal";
  }
}

/**
 * Clear both terminals
 */
function clearTerminals() {
  terminalSent.innerHTML = "";
  terminalReceived.innerHTML = "";
}

/**
 * Save terminal log to file
 */
function saveLog() {
  const sentLines = Array.from(
    terminalSent.querySelectorAll(".terminal-line")
  ).map((line) => "TX: " + line.textContent);
  const receivedLines = Array.from(
    terminalReceived.querySelectorAll(".terminal-line")
  ).map((line) => "RX: " + line.textContent);

  const allLines = [];
  allLines.push("=== UART Terminal Log ===");
  allLines.push(`Date: ${new Date().toLocaleString()}`);
  allLines.push(`Baud Rate: ${document.getElementById("baudRate").value}`);
  allLines.push("");
  allLines.push("=== TxD ===");
  allLines.push(...sentLines);
  allLines.push("");
  allLines.push("=== RxD ===");
  allLines.push(...receivedLines);

  const logContent = allLines.join("\n");

  // Create download
  const blob = new Blob([logContent], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `uart_log_${Date.now()}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
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
          data: oscilloscopeData,
          borderColor: "#2ecc71",
          backgroundColor: "rgba(46, 204, 113, 0.1)",
          borderWidth: 2,
          tension: 0.1,
          pointRadius: 0,
          pointHoverRadius: 3,
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
              const value = context.parsed.y;
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
          grid: { color: "rgba(127, 140, 141, 0.2)" },
        },
        y: {
          display: true,
          title: {
            display: true,
            text: yTitle,
            color: "#ecf0f1",
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
          grid: { color: "rgba(127, 140, 141, 0.2)" },
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

/**
 * Update oscilloscope with new data
 */
function updateOscilloscopeData(uint8Array) {
  if (!oscilloscopeChart || oscilloscopePaused) {
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

  // Update chart
  oscilloscopeChart.data.datasets[0].data = [...oscilloscopeData];
  oscilloscopeChart.update("none");
}

/**
 * Clear oscilloscope data
 */
function clearOscilloscope() {
  if (oscilloscopeChart) {
    const points = 500;
    oscilloscopeData = new Array(points).fill(0);
    byteBuffer = []; // Clear byte buffer
    oscilloscopeChart.data.datasets[0].data = [...oscilloscopeData];
    oscilloscopeChart.update("none");
  }
}

/**
 * Toggle oscilloscope pause/play
 */
function toggleOscilloscopePause() {
  oscilloscopePaused = !oscilloscopePaused;

  const btn = document.getElementById("oscilloPauseBtn");
  const pauseIcon = btn.querySelector(".pause-icon");
  const playIcon = btn.querySelector(".play-icon");

  if (oscilloscopePaused) {
    btn.classList.remove("playing");
    pauseIcon.style.display = "none";
    playIcon.style.display = "block";
    btn.title = "Play";
  } else {
    btn.classList.add("playing");
    pauseIcon.style.display = "block";
    playIcon.style.display = "none";
    btn.title = "Pause";
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
    sendData();
  }

  // Ctrl+L to clear
  if (e.ctrlKey && e.key === "l") {
    e.preventDefault();
    clearTerminals();
  }

  // Ctrl+S to save log
  if (e.ctrlKey && e.key === "s") {
    e.preventDefault();
    saveLog();
  }

  // Space to pause/play oscilloscope when in graphic mode
  if (
    e.key === " " &&
    currentView === "oscilloscope" &&
    document.activeElement !== terminalInput
  ) {
    e.preventDefault();
    toggleOscilloscopePause();
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
 * Toggle loop sending
 */
function toggleLoopSend() {
  if (loopInterval) {
    stopLoopSend();
  } else {
    startLoopSend();
  }
}

/**
 * Start loop sending
 */
function startLoopSend() {
  // Проверяем, что есть что отправлять
  const inputMode = document.querySelector(
    'input[name="inputMode"]:checked'
  ).value;
  const inputValue = terminalInput.value.trim();

  if (!inputValue) {
    addToTerminal("error", "Nothing to send", terminalSent);
    return;
  }

  // Получаем интервал из поля ввода
  const intervalMs = parseInt(loopIntervalInput.value) || 1000;

  // Меняем иконку на стоп
  const loopIcon = sendLoopBtn.querySelector(".loop-icon");
  const stopIcon = sendLoopBtn.querySelector(".stop-icon");
  loopIcon.style.display = "none";
  stopIcon.style.display = "block";
  sendLoopBtn.classList.add("active");
  sendLoopBtn.title = "Stop loop";

  // Отправляем первый раз сразу
  sendDataLoop();

  // Запускаем интервал
  loopInterval = setInterval(() => {
    sendDataLoop();
  }, intervalMs);
}

/**
 * Stop loop sending
 */
function stopLoopSend() {
  if (loopInterval) {
    clearInterval(loopInterval);
    loopInterval = null;
  }

  // Возвращаем иконку цикла
  const loopIcon = sendLoopBtn.querySelector(".loop-icon");
  const stopIcon = sendLoopBtn.querySelector(".stop-icon");
  loopIcon.style.display = "block";
  stopIcon.style.display = "none";
  sendLoopBtn.classList.remove("active");
  sendLoopBtn.title = "Send in loop";
}

/**
 * Send data in loop (without clearing input)
 */
async function sendDataLoop() {
  if (!writer) return;

  const inputMode = document.querySelector(
    'input[name="inputMode"]:checked'
  ).value;
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

      oscilloscopeChart.update("none");
    }
  }
}

/**
 * Handle mouse down for panning
 */
function handleChartMouseDown(e) {
  // Check for middle mouse button (button === 1)
  if (e.button === 1) {
    e.preventDefault();
    isPanningChart = true;

    panStartPos = {
      x: e.clientX,
      y: e.clientY,
    };

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
  if (!isPanningChart || !oscilloscopeChart) return;

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
    const yDataDelta = (deltaY / chartArea.height) * yRange;

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

    // Update scales
    xScale.options.min = newXMin;
    xScale.options.max = newXMax;
    yScale.options.min = panStartOffset.yMin + yDataDelta;
    yScale.options.max = panStartOffset.yMax + yDataDelta;

    oscilloscopeChart.update("none");
  }
}

/**
 * Handle mouse up to stop panning
 */
function handleChartMouseUp(e) {
  if (e.button === 1 || isPanningChart) {
    isPanningChart = false;
    oscilloscopeCanvas.style.cursor = "default";
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
    // Get the current data range
    const byteSize = document.querySelector(
      'input[name="byteSize"]:checked'
    ).value;
    const signMode = document.querySelector(
      'input[name="signMode"]:checked'
    ).value;

    // Determine Y axis range based on mode
    let yMin, yMax;
    if (byteSize === "1") {
      if (signMode === "unsigned") {
        yMin = 0;
        yMax = 255;
      } else {
        yMin = -128;
        yMax = 127;
      }
    } else {
      if (signMode === "unsigned") {
        yMin = 0;
        yMax = 65535;
      } else {
        yMin = -32768;
        yMax = 32767;
      }
    }

    // Reset to original ranges
    delete xScale.options.min;
    delete xScale.options.max;
    yScale.options.min = yMin;
    yScale.options.max = yMax;

    oscilloscopeChart.update();
  }
}

// --- Web Serial: выбор порта и открытие в режиме UPDI 8E2 ---
let updiPort, updiWriter, updiReader;

async function openUpdiPort(baud = 230400) {
  // 1) Запросить порт
  const port = await navigator.serial.requestPort();
  // 2) Открыть на 8E2 (важно!)
  await port.open({
    baudRate: baud,
    dataBits: 8,
    parity: "even",
    stopBits: 2,
    bufferSize: 4096,
    flowControl: "none",
  });

  const textEncoder = new TextEncoder(); // будем писать бинарные Uint8Array, можно без этого
  const writer = port.writable.getWriter();
  const reader = port.readable.getReader();

  updiPort = port;
  updiWriter = writer;
  updiReader = reader;
}

async function closeUpdiPort() {
  try {
    await updiReader?.cancel();
  } catch {}
  try {
    updiReader?.releaseLock();
  } catch {}
  try {
    updiWriter?.releaseLock();
  } catch {}
  try {
    await updiPort?.close();
  } catch {}
  updiPort = updiWriter = updiReader = null;
}

// --- Низкоуровневые I/O ---
async function updiWrite(bytes) {
  if (!updiWriter) throw new Error("Port not open");
  await updiWriter.write(
    bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  );
}

// Чтение ровно N байтов с таймаутом
async function updiReadExact(n, timeoutMs = 500) {
  if (!updiReader) throw new Error("Port not open");
  const out = new Uint8Array(n);
  let got = 0;
  const deadline = performance.now() + timeoutMs;
  while (got < n) {
    const left = deadline - performance.now();
    if (left <= 0) throw new Error("UPDI read timeout");
    const { value, done } = await Promise.race([
      updiReader.read(),
      new Promise((r) =>
        setTimeout(() => r({ value: null, done: false }), Math.min(50, left))
      ),
    ]);
    if (done) throw new Error("Port closed");
    if (value && value.length) {
      const take = Math.min(value.length, n - got);
      out.set(value.subarray(0, take), got);
      got += take;
    }
  }
  return out;
}

// --- Константы/утилиты UPDI ---
const SYNCH = 0x55;
// Здесь дальше: коды инструкций, регистры CS, ключи NVM, и т.п.
// См. описание UPDI UART и последовательности SYNCH. :contentReference[oaicite:9]{index=9}

// Пример "ping": отправить SYNCH и прочитать первый ответ,
// в реальной реализации тут читают ID/REV через UPDI-команды
async function updiPing() {
  await updiWrite(new Uint8Array([SYNCH]));
  // Конкретный ожидаемый ответ зависит от следующей посланной команды;
  // здесь это просто smoke-test чтения
  const echo = await updiReadExact(1, 200);
  return echo[0];
}

// --- Заготовка прошивки ---
async function flashHexViaUpdi(
  intelHexText,
  { baud = 230400, pageSize = 128 } = {}
) {
  await openUpdiPort(baud);

  try {
    // 1) Разобрать HEX -> {ranges}
    const image = parseIntelHex(intelHexText); // реализуй ниже

    // 2) Установить линк (Enable/Break/SYNCH), прочитать ID, войти в режим NVM
    await updiEnableLink(); // TODO: реализовать
    await updiEnterNvm(); // TODO: реализовать (ключ, статусы)

    // 3) Chip Erase (если нужно)
    await updiChipErase(); // TODO

    // 4) Пакетная запись по страницам
    for (const { addr, data } of image.pages(pageSize)) {
      await updiWritePage(addr, data); // TODO
      // Тут же можно показывать прогресс
    }

    // 5) Верификация (опционально)
    // for each page: read back and compare

    // 6) Завершение / reset
    await updiLeaveNvm(); // TODO

    return true;
  } finally {
    await closeUpdiPort();
  }
}

// Мини-парсер Intel HEX (упрощённый, без экстремальных случаев)
function parseIntelHex(text) {
  const ranges = [];
  let upper = 0;
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (!line || line[0] !== ":") continue;
    const b = hexToBytes(line.slice(1));
    const len = b[0],
      addr = (b[1] << 8) | b[2],
      type = b[3];
    const data = b.slice(4, 4 + len);
    // checksum можно проверить при желании
    if (type === 0x04) {
      // Extended Linear Address
      upper = ((data[0] << 8) | data[1]) << 16;
    } else if (type === 0x00) {
      const abs = upper + addr;
      ranges.push({ addr: abs, data });
    } else if (type === 0x01) {
      break; // EOF
    }
  }
  // Сгруппировать в страницы/непрерывные блоки
  return {
    ranges,
    *pages(pageSize) {
      // Простейшая упаковка в страницы
      let buf = null,
        base = 0,
        off = 0;
      const flush = function* () {
        if (buf) yield { addr: base, data: buf };
        buf = null;
        base = 0;
        off = 0;
      };
      for (const r of ranges.sort((a, b) => a.addr - b.addr)) {
        let p = 0;
        while (p < r.data.length) {
          if (!buf) {
            base = r.addr + p;
            buf = new Uint8Array(pageSize);
            off = 0;
          }
          const room = pageSize - off;
          const take = Math.min(room, r.data.length - p);
          buf.set(r.data.subarray(p, p + take), off);
          off += take;
          p += take;
          if (off === pageSize) yield* flush();
        }
      }
      if (off) yield { addr: base, data: buf.subarray(0, off) };
    },
  };
}
function hexToBytes(h) {
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++)
    out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
}

// ======== UPDI link (browser Web Serial, 8E2 уже открыт выше) ========
const UPDI = (() => {
  // --- UPDI CS addresses (control/status space) ---
  // Источник адресов: Microchip UPDI docs (LDCS/STCS адресуют именно эти индексы)
  const CS = {
    STATUS: 0x00, // UPDI.STATUS
    CTRLB: 0x02, // UPDI.CTRLB
    CTRLA: 0x03, // UPDI.CTRLA (guard time и пр.)
    ASI_KEY_STATUS: 0x07, // ключевой статус (NVMPROG/CHIPERASE и т.п.)
    ASI_RESET_REQ: 0x08, // запрос reset (0x59 -> assert, 0x00 -> release)
  };

  // --- NVMCTRL (ATtiny1624 tinyAVR-2) memory-mapped registers ---
  // База и оффсеты подтверждены по даташиту; страница Flash = 64B
  const NVM = {
    BASE: 0x1000, // NVMCTRL base
    CTRLA: 0x1000, // +0x00
    CTRLB: 0x1001, // +0x01
    STATUS: 0x1002, // +0x02 (FBUSY/EEBUSY/WRERROR)
    INTCTRL: 0x1003, // +0x03
    INTFLAGS: 0x1004, // +0x04
    DATA: 0x1006, // +0x06 (для fuse-операций)
    ADDR: 0x1008, // +0x08 (16-битный адрес)
    PAGE_SIZE: 64,
  };

  // --- NVM CTRL.A commands (CMD[2:0]) —
  // Чип-erase и fuse write актуальны; WP выполняет запись буфера страницы во Flash
  const NVMCMD = {
    NOCMD: 0x0,
    WP: 0x1, // Write Page
    ER_PAGE: 0x4, // (если надо отдельно стирать страницу)
    CHER: 0x5, // Chip Erase
    EE_ERASE: 0x6,
    WFU: 0x7, // Write Fuse (через UPDI)
  };

  // --- UPDI KEY signatures (64-bit, little endian on wire as bytes sequence) ---
  // NVMPROG: "NVMProg " ; CHIPERASE: "NVMErase"
  // Подтверждено у Microchip: Enabling of Key Protected Interfaces / Key Signatures
  const KEY = {
    NVMPROG: new Uint8Array([0x4e, 0x56, 0x4d, 0x50, 0x72, 0x6f, 0x67, 0x20]), // "NVMProg "
    NVMERASE: new Uint8Array([0x4e, 0x56, 0x4d, 0x45, 0x72, 0x61, 0x73, 0x65]), // "NVMErase"
  };

  // --- Вспомогательные: порт, writer/reader, таймауты ---
  let port, writer, reader;

  function setPort(p) {
    port = p;
  }

  async function getWriter() {
    if (!writer) writer = port.writable.getWriter();
    return writer;
  }
  async function getReader() {
    if (!reader) reader = port.readable.getReader();
    return reader;
  }

  // Отправка массива байтов (без межбайтовых пауз, как рекомендует pymcuprog)
  async function send(bytes) {
    const w = await getWriter();
    await w.write(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  }

  // Получение N байтов (UPDI обычно эхоит отправленное, но мы читаем явные ответы)
  async function recv(count, timeoutMs = 50) {
    const r = await getReader();
    const deadline = performance.now() + timeoutMs;
    const out = new Uint8Array(count);
    let got = 0;
    while (got < count) {
      const { value, done } = await Promise.race([
        r.read(),
        new Promise((res) =>
          setTimeout(
            () => res({ value: null, done: true }),
            Math.max(1, timeoutMs / 4)
          )
        ),
      ]);
      if (done || value === null) {
        if (performance.now() > deadline)
          throw new Error(`UPDI timeout waiting ${count} bytes (got ${got})`);
        continue;
      }
      out.set(value.slice(0, Math.min(value.length, count - got)), got);
      got += Math.min(value.length, count - got);
    }
    return out;
  }

  // === НИЗКИЙ УРОВЕНЬ UPDI КАДРОВ ===
  // Все инструкции начинаются с SYNC (0x55)
  async function ldcs(addr /*0..15*/) {
    // LDCS — 1 байт ответа
    await send([0x55, 0x80 | (addr & 0x0f)]);
    const data = await recv(1);
    return data[0];
  }

  async function stcs(addr /*0..15*/, val) {
    // STCS — запись 1 байта
    await send([0x55, 0xc0 | (addr & 0x0f), val & 0xff]);
  }

  // KEY — ключи 64-бит. Формат: 0x55, 0xE0 | sizeC, затем 8 байт ключа.
  // Для ключа достаточно sizeC=0 (в спецификации KEY поддерживает 64b)
  async function key64(keyBytes /*Uint8Array length 8*/) {
    if (!(keyBytes instanceof Uint8Array) || keyBytes.length !== 8) {
      throw new Error("UPDI KEY expects Uint8Array(8)");
    }
    await send([0x55, 0xe0]); // KEY sizeC=0 (64-bit)
    await send(keyBytes);
    // Ответа не ожидается (KEY — fire-and-forget)
  }

  // Двойной BREAK — надёжно возвращает в известное состояние
  async function doubleBreak() {
    // 1) «линией BREAK» через setSignals (если поддерживается)
    try {
      await port.setSignals({ break: true });
      await new Promise((r) => setTimeout(r, 12)); // ~мс, хватит для >24 бит-таймов
      await port.setSignals({ break: false });
      await new Promise((r) => setTimeout(r, 3));
      await port.setSignals({ break: true });
      await new Promise((r) => setTimeout(r, 12));
      await port.setSignals({ break: false });
    } catch {
      // 2) Фолбэк: послать «медленные нули» — потребует переоткрытия на 300 бод (пропускаем в браузере)
    }
    // Сразу вслед — SYNC для «подтяжки такта по 0x55» (guard time учтём ниже)
    await send([0x55]);
  }

  // === ПУБЛИЧНЫЕ ШАГИ ===

  // 1) enable(): сброс, базовая конфигурация линка, проверка статуса
  async function enable() {
    if (!port) throw new Error("UPDI: serial port is not set");
    await doubleBreak();

    // Настроим Guard Time и CTRLB (паттерн из pymcuprog)
    // CTRLA (CS 0x03): GTVAL ≈ 8 (0x08) — щадящий GT для стабильности на USB-UART
    await stcs(CS.CTRLA, 0x08);
    // CTRLB (CS 0x02): 0x80 — включить подтверждения/тайминги по умолчанию
    await stcs(CS.CTRLB, 0x80);

    // Прочтём STATUS — типичное значение 0x30 (IDLE + something), но главное — чтоб читалось
    const status = await ldcs(CS.STATUS);
    if ((status & 0x10) === 0 && (status & 0x20) === 0) {
      // жёстко — но лучше сразу проявиться, чем зависнуть молча
      // (в boottime часть чипов отвечает с 0x00 — гоняем ещё раз)
      await doubleBreak();
    }
    return { status };
  }

  // 2) enterNvm(): подать NVMPROG ключ и убедиться, что режим открывается
  async function enterNvm() {
    await key64(KEY.NVMPROG); // 64-bit NVMPROG
    // Подождём, пока UPDI отметит ключ в ASI_KEY_STATUS (битовая карта зависит от семейства)
    // Практически: ждём ненулевое значение/конкретное значение >0
    const deadline = performance.now() + 150;
    let ks = 0;
    do {
      ks = await ldcs(CS.ASI_KEY_STATUS);
      if (ks) break;
      await new Promise((r) => setTimeout(r, 2));
    } while (performance.now() < deadline);
    if (!ks)
      throw new Error("UPDI: NVMPROG key did not latch (ASI_KEY_STATUS=0)");
    return { keyStatus: ks };
  }

  // 3) chipErase(): ключ NVMErase + короткий reset
  async function chipErase() {
    await key64(KEY.NVMERASE); // Массовое стирание — ключом
    // Короткий reset по ASI_RESET_REQ: 0x59 => assert, затем 0x00 => release.
    await stcs(CS.ASI_RESET_REQ, 0x59);
    await new Promise((r) => setTimeout(r, 2));
    await stcs(CS.ASI_RESET_REQ, 0x00);

    // Немного подождём готовности (через STATUS UPDI и/или NVMCTRL.STATUS позже при доступе к памяти)
    await new Promise((r) => setTimeout(r, 10));
  }

  // === Запись и верификация Flash (каркас) ===
  // ВНИМАНИЕ: ниже два TODO, куда надо вставить реальные кадры UPDI для
  //  - записи по адресам данных (0x8000..), «page buffer load»
  //  - чтения по адресам данных (для verify)
  // Это либо LDS/STS (прямая адресация), либо LD/ST с указателем (ptr_inc).
  // Точки вставки помечены // TODO(OPCODE) — после того как добавим, write/verify начнут работать.

  // вспомогательное: разложить hex-текст в Uint8Array (Intel HEX преобразуешь выше — сюда уже бинарь)
  function toUint8(data) {
    return data instanceof Uint8Array ? data : new Uint8Array(data);
  }

  // Установить 16-битный адрес (если используем ptr-вариант) — заготовка
  async function _setAddressPtr16(addr) {
    // TODO(OPCODE): кадр st_ptr16 / st_ptr (записать 16-бит адрес в указатель UPDI)
    // await send([0x55, <opcode>, addr & 0xFF, (addr>>8)&0xFF]);
    throw new Error("TODO: implement UPDI ST pointer (16-bit)");
  }

  // Прямая запись одного байта в data space по адресу (LDS/STS direct) — заготовка
  async function _stsByte(addr, val) {
    // TODO(OPCODE): STS (direct) формат: 0x55, <opcode_STS>, addr_lo, addr_hi, data
    // await send([0x55, STS_OPCODE, addr & 0xFF, (addr>>8)&0xFF, val & 0xFF]);
    throw new Error("TODO: implement UPDI STS (direct)");
  }

  // Прямое чтение одного байта из data space — заготовка
  async function _ldsByte(addr) {
    // TODO(OPCODE): LDS (direct) формат: 0x55, <opcode_LDS>, addr_lo, addr_hi ; затем читаем 1 байт
    // await send([0x55, LDS_OPCODE, addr & 0xFF, (addr>>8)&0xFF]);
    // const b = await recv(1);
    // return b[0];
    throw new Error("TODO: implement UPDI LDS (direct)");
  }

  // Ожидать, пока NVMCTRL освободится (по флагам busy)
  async function _waitNvmReady(timeoutMs = 150) {
    const deadline = performance.now() + timeoutMs;
    do {
      // читаем NVMCTRL.STATUS по data-адресу
      // const st = await _ldsByte(NVM.STATUS);
      // if ((st & 0x03) === 0) return true; // FBUSY|EEBUSY == 0
      await new Promise((r) => setTimeout(r, 2));
    } while (performance.now() < deadline);
    throw new Error("NVM busy timeout");
  }

  // Команда в NVMCTRL.CTRLA: требуется CCP-разблокировка CPU.CCP перед записью
  async function _nvmCommand(cmd /*NVMCMD*/) {
    // 1) CPU.CCP <- IOREG signature; 2) NVMCTRL.CTRLA <- cmd
    // Для tinyAVR 0/1/2 обычно CPU.CCP IOREG signature = 0x9D (окно на 4 команды).
    // Адрес CPU.CCP: CPU base 0x0030, offset CCP = 0x04 (для этих семейств).
    const CPU_CCP_ADDR = 0x0034; // 0x0030 + 0x04
    const CCP_IOREG = 0x9d;
    await _stsByte(CPU_CCP_ADDR, CCP_IOREG);
    await _stsByte(NVM.CTRLA, cmd & 0xff);
  }

  // Запись страницы Flash из буфера bytes в адресе 'addr' (должен быть кратен 64)
  async function writeFlash(addr, bytes /*Uint8Array or Array<number>*/) {
    const data = toUint8(bytes);
    if (addr % NVM.PAGE_SIZE !== 0)
      throw new Error("Flash write: address must be page-aligned (64B)");
    if (data.length % NVM.PAGE_SIZE !== 0)
      throw new Error("Flash write: whole pages only");

    // Для каждой страницы:
    for (let off = 0; off < data.length; off += NVM.PAGE_SIZE) {
      const pageAddr = addr + off;

      // 1) Подготовка буфера страницы: посылаем 64 байта по адресам 0x8000+...
      //    (на tinyAVR запись в область Flash с активным NVMPROG кладёт данные в page buffer)
      for (let i = 0; i < NVM.PAGE_SIZE; i++) {
        // Прямая адресация (STS direct): пишем байт в (pageAddr + i)
        await _stsByte(0x8000 + pageAddr + i, data[off + i]);
      }

      // 2) Коммит страницы: NVMCTRL.CTRLA = WP (через CCP окно)
      await _nvmCommand(NVMCMD.WP);

      // 3) Дождаться готовности:
      await _waitNvmReady(200);
    }
  }

  // Верификация: читаем назад и сравниваем
  async function verifyFlash(addr, bytes) {
    const data = toUint8(bytes);
    for (let i = 0; i < data.length; i++) {
      const b = await _ldsByte(0x8000 + addr + i);
      if (b !== data[i]) {
        return { ok: false, at: addr + i, expected: data[i], got: b };
      }
    }
    return { ok: true };
  }

  return {
    setPort,
    enable,
    enterNvm,
    chipErase,
    writeFlash, // TODO(OPCODE) внутри
    verifyFlash, // TODO(OPCODE) внутри
  };
})();

// ===== Пример «склейки» с уже открытым портом и кнопкой "Flash MCU" =====
async function flashMCU_fromBrowser(
  binaryBytes /*Uint8Array*/,
  baseAddr = 0x0000
) {
  // предполагаем, что serialPort уже открыт в 8E2 выше
  UPDI.setPort(serialPort);
  await UPDI.enable();
  await UPDI.enterNvm();
  await UPDI.chipErase();
  await UPDI.writeFlash(baseAddr, binaryBytes); // <== ВНУТРИ есть TODO(OPCODE)
  const vr = await UPDI.verifyFlash(baseAddr, binaryBytes); // <== ВНУТРИ есть TODO(OPCODE)
  if (!vr.ok)
    throw new Error(
      `Verify failed at 0x${vr.at.toString(16)} (got ${vr.got}, expected ${
        vr.expected
      })`
    );
}

// ===== Device-specific constants (tiny/mega 0/1/2 series) =====
const FLASH_START = 0x8000; // дата: Flash виден для LD/ST с 0x8000
const NVM_BASE = 0x1000; // база NVMCTRL
const NVM_CTRLA = NVM_BASE + 0x00;
const NVM_STATUS = NVM_BASE + 0x02; // bit0=FBUSY, bit1=EEBUSY
const NVM_DATA = NVM_BASE + 0x06; // 16-bit рег (для fuse через UPDI)
const NVM_ADDR = NVM_BASE + 0x08; // 16-bit адрес страницы
const CPU_BASE = 0x0030;
const CPU_CCP = CPU_BASE + 0x04;

// Команды NVMCTRL.CTRLA (датащит)
const NVM_CMD = {
  WP: 0x1, // write page buffer -> memory
  ER: 0x2, // erase page
  ERWP: 0x3, // erase+write page
  PBC: 0x4, // page buffer clear
};

// Ключ для CPU.CCP чтобы разрешить запись CTRLA (SPM key)
const CCP_SPM = 0x9d; // для AVR 0/1/2 серий

// ===== Общие утилиты NVM =====

async function nvmWaitIdle() {
  // Ждём окончания любых NVM-операций (FBUSY/EEBUSY=0)
  for (;;) {
    const s = await updiLDS8(NVM_STATUS);
    if ((s & 0x03) === 0) break;
  }
}

async function nvmExec(cmd) {
  // Разрешаем самопрограммирование и записываем команду в CTRLA
  await updiSTS8(CPU_CCP, CCP_SPM);
  await updiSTS8(NVM_CTRLA, cmd);
  await nvmWaitIdle();
}

// ====== WRITE ======
// Запись произвольного буфера в Flash c автоматическим разбиением на страницы.
// startAddr — адрес в Flash в БАЙТАХ (обычно 0), dataU8 — Uint8Array с данными.
// pageSizeBytes — размер страницы Flash (байт), напр. 64 для ATtiny1616.
async function updiWriteFlash(startAddr, dataU8, pageSizeBytes = 64) {
  // Flash пишется 16-битными словами — довыровняем хвост до 0xFF.
  let bytes = dataU8;
  if (bytes.length & 1) {
    const t = new Uint8Array(bytes.length + 1);
    t.set(bytes);
    t[t.length - 1] = 0xff;
    bytes = t;
  }

  // Идём по страницам
  let cur = startAddr >>> 0;
  for (let off = 0; off < bytes.length; off += pageSizeBytes) {
    const page = bytes.subarray(
      off,
      Math.min(off + pageSizeBytes, bytes.length)
    );

    // 1) Загрузка страничного буфера: пишем СРАЗУ в карту памяти Flash.
    //    Адресация — прямая (LD/ST). UPDI pointer + post-inc 16-bit.
    await nvmWaitIdle();

    // Установим UPDI pointer на начало этой страницы (в data space, от 0x8000)
    const pageDataAddr = (FLASH_START + cur) & 0xffff;
    await updiSTptr(pageDataAddr);

    // Записываем словами (16-bit). Для больших страниц — кусками <= 64 слов.
    const words = page.length >>> 1;
    let i = 0;
    while (i < words) {
      const chunkWords = Math.min(64, words - i); // безопасный размер блока
      if (chunkWords > 1) await updiREPEAT(chunkWords - 1);
      // Сформируем поток 2*chunkWords байт (LE: LSB, MSB)
      const tx = new Uint8Array(chunkWords * 2);
      for (let j = 0; j < chunkWords; j++) {
        tx[2 * j + 0] = page[2 * (i + j) + 0];
        tx[2 * j + 1] = page[2 * (i + j) + 1];
      }
      await updiSTptrInc16(tx);
      i += chunkWords;
    }

    // 2) Сообщим NVM адресу страницы (на всякий случай) и запустим Erase+Write
    await updiSTS16(NVM_ADDR, pageDataAddr);
    await nvmExec(NVM_CMD.ERWP); // страница стирается и пишется

    cur += pageSizeBytes;
  }
}

// ====== VERIFY ======
// Читаем обратно и сравниваем. Бросаем исключение при первом несовпадении.
async function updiVerifyFlash(startAddr, dataU8) {
  // Выравниваем как при записи
  let bytes = dataU8;
  if (bytes.length & 1) {
    const t = new Uint8Array(bytes.length + 1);
    t.set(bytes);
    t[t.length - 1] = 0xff;
    bytes = t;
  }

  let addr = (FLASH_START + startAddr) & 0xffff;
  await updiSTptr(addr);

  const totalWords = bytes.length >>> 1;
  let done = 0;

  while (done < totalWords) {
    const chunkWords = Math.min(64, totalWords - done);
    if (chunkWords > 1) await updiREPEAT(chunkWords - 1);

    const rx = await updiLDptrInc16(chunkWords); // Uint8Array длиной 2*chunkWords

    // Сравниваем побайтно
    for (let i = 0; i < rx.length; i++) {
      const exp = bytes[2 * done + i];
      if (rx[i] !== exp) {
        const abs = startAddr + 2 * done + i;
        throw new Error(
          `VERIFY FAIL @ 0x${abs.toString(16).padStart(4, "0")}: ` +
            `exp=0x${exp.toString(16).padStart(2, "0")} got=0x${rx[i]
              .toString(16)
              .padStart(2, "0")}`
        );
      }
    }
    done += chunkWords;
  }
}
