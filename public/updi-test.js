(function () {
  const SERIAL_BAUD = 115200;
  const SERIAL_OPTIONS = {
    baudRate: SERIAL_BAUD,
    dataBits: 8,
    parity: "even",
    stopBits: 2,
    bufferSize: 4096,
  };

  const SERIAL_DOUBLE_BREAK_OPTIONS = {
    baudRate: 300,
    dataBits: 8,
    parity: "even",
    stopBits: 1,
    bufferSize: 4096,
  };

  const UPDI = {
    BREAK: 0x00,
    LDS: 0x00,
    STS: 0x40,
    LD: 0x20,
    ST: 0x60,
    LDCS: 0x80,
    STCS: 0xc0,
    REPEAT: 0xa0,
    KEY: 0xe0,
    PTR_INC: 0x04,
    PTR_ADDRESS: 0x08,
    ADDRESS_16: 0x04,
    DATA_8: 0x00,
    DATA_16: 0x01,
    KEY_SIB: 0x04,
    SIB_32BYTES: 0x02,
    REPEAT_BYTE: 0x00,
    PHY_SYNC: 0x55,
    PHY_ACK: 0x40,
    CS_STATUSA: 0x00,
    CS_CTRLA: 0x02,
    CS_CTRLB: 0x03,
    ASI_KEY_STATUS: 0x07,
    ASI_RESET_REQ: 0x08,
    ASI_SYS_STATUS: 0x0b,
    CTRLA_IBDLY_BIT: 7,
    CTRLA_RSD_BIT: 3,
    CTRLB_CCDETDIS_BIT: 3,
    CTRLB_UPDIDIS_BIT: 2,
    ASI_KEY_STATUS_NVMPROG: 4,
    ASI_SYS_STATUS_NVMPROG: 3,
    ASI_SYS_STATUS_LOCKSTATUS: 0,
    RESET_REQ_VALUE: 0x59,
    KEY_NVM: [0x4e, 0x56, 0x4d, 0x50, 0x72, 0x6f, 0x67, 0x20],
  };

  const NVM_P0 = {
    CTRLA: 0x00,
    STATUS: 0x02,
    CMD_WRITE_PAGE: 0x01,
    CMD_PAGE_BUFFER_CLEAR: 0x04,
    CMD_CHIP_ERASE: 0x05,
    STATUS_WRITE_ERROR_BIT: 2,
    STATUS_EEPROM_BUSY_BIT: 1,
    STATUS_FLASH_BUSY_BIT: 0,
  };

  const SUPPORTED_TARGETS = {
    attiny1624: {
      flashSize: 16 * 1024,
      flashStart: 0x8000,
      flashPageSize: 0x40,
      label: "ATtiny1624",
      nvmctrlBase: 0x1000,
      sigrowAddress: 0x1100,
      syscfgBase: 0x0f00,
      deviceId: 0x1e942a,
    },
  };

  const state = {
    fileName: "",
    hexText: "",
    image: null,
    busy: false,
    busyLabel: "",
    lastProbeOk: false,
    lastProbeError: "",
    sibText: "",
    signatureInfo: null,
    programInfo: null,
  };

  const els = {};

  function $(id) {
    return document.getElementById(id);
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function formatHex(value, width = 4) {
    return `0x${Number(value).toString(16).toUpperCase().padStart(width, "0")}`;
  }

  function bytesToHex(bytes, separator = "") {
    return Array.from(bytes || [])
      .map((value) => value.toString(16).toUpperCase().padStart(2, "0"))
      .join(separator);
  }

  function getTargetConfig() {
    return SUPPORTED_TARGETS[els.mcuSelect.value] || SUPPORTED_TARGETS.attiny1624;
  }

  function getCanvasUpdiBridge() {
    if (typeof window === "undefined") return null;
    return window.__UARTDEBUG_CANVAS_UPDI_BRIDGE__ || null;
  }

  function isCanvasSerialConnected() {
    const bridge = getCanvasUpdiBridge();
    if (!bridge || typeof bridge.isCanvasSerialConnected !== "function") {
      return false;
    }

    try {
      return !!bridge.isCanvasSerialConnected();
    } catch {
      return false;
    }
  }

  function setBusyLabel(label) {
    state.busyLabel = label || "";
    updateView();
  }

  function appendLog(message) {
    const timestamp = new Date().toLocaleTimeString("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    els.probeLog.textContent += `[${timestamp}] ${message}\n`;
    els.probeLog.scrollTop = els.probeLog.scrollHeight;
  }

  function clearLog() {
    els.probeLog.textContent = "";
  }

  function setStatus(kind, text) {
    els.probeStatus.classList.remove(
      "connected",
      "disconnected",
      "working",
      "error"
    );

    if (kind === "connected") {
      els.probeStatus.classList.add("connected");
    } else if (kind === "working") {
      els.probeStatus.classList.add("working");
    } else if (kind === "error") {
      els.probeStatus.classList.add("error");
    } else {
      els.probeStatus.classList.add("disconnected");
    }

    els.probeStatus.textContent = text;
  }

  function setSummaryNote(text, kind = "") {
    els.summaryNote.textContent = text;
    els.summaryNote.classList.remove("ok", "error");
    if (kind) els.summaryNote.classList.add(kind);
  }

  function resetSummary() {
    els.summarySource.textContent = "-";
    els.summaryBytes.textContent = "-";
    els.summarySegments.textContent = "-";
    els.summaryRange.textContent = "-";
    els.summaryRecords.textContent = "-";
    els.summaryTarget.textContent = getTargetConfig().label;
    els.summarySignature.textContent = "-";
    els.summaryRevision.textContent = "-";
    els.summarySerial.textContent = "-";
    els.summarySib.textContent = "SIB: -";
    setSummaryNote(
      "Load a valid Intel HEX image to inspect it. Probe and signature read are available anytime; Program HEX requires a loaded image."
    );
  }

  function updateButtons() {
    const canUseSerial = "serial" in navigator && !state.busy;
    const blockedByCanvasSerial = isCanvasSerialConnected();
    const disabledReason = blockedByCanvasSerial
      ? "Disconnect UART before using UPDI."
      : "";

    els.probeBtn.disabled = !canUseSerial || blockedByCanvasSerial;
    els.readSignatureBtn.disabled = !canUseSerial || blockedByCanvasSerial;
    els.programHexBtn.disabled =
      !canUseSerial || blockedByCanvasSerial || !state.image;

    if (els.probeBtn) els.probeBtn.title = disabledReason || "Probe UPDI";
    if (els.readSignatureBtn) {
      els.readSignatureBtn.title = disabledReason || "Read Signature";
    }
    if (els.programHexBtn) {
      els.programHexBtn.title = disabledReason || "Program HEX";
    }
  }

  function updateView() {
    const target = getTargetConfig();

    els.summaryTarget.textContent = target.label;
    els.summarySource.textContent = state.image ? state.fileName || "textarea" : "-";
    els.summaryBytes.textContent = state.image ? String(state.image.bytesTotal) : "-";
    els.summarySegments.textContent = state.image
      ? String(state.image.segments.length)
      : "-";
    els.summaryRange.textContent = state.image
      ? `${formatHex(state.image.minAddress)} - ${formatHex(
          state.image.maxAddressExclusive - 1
        )}`
      : "-";
    els.summaryRecords.textContent = state.image
      ? String(state.image.recordCount)
      : "-";

    els.summarySignature.textContent = state.signatureInfo
      ? formatHex(state.signatureInfo.deviceId, 6)
      : "-";
    els.summaryRevision.textContent = state.signatureInfo
      ? state.signatureInfo.revisionText
      : "-";
    els.summarySerial.textContent = state.signatureInfo
      ? state.signatureInfo.serialHex
      : "-";
    els.summarySib.textContent = `SIB: ${state.sibText || "-"}`;

    if (state.busy) {
      setStatus("working", state.busyLabel || "Working...");
    } else if (state.lastProbeError) {
      setStatus("error", state.lastProbeError);
    } else if (state.programInfo) {
      setStatus("connected", "Flash verified");
    } else if (state.signatureInfo) {
      setStatus("connected", "Signature ready");
    } else if (state.lastProbeOk) {
      setStatus("connected", "Probe OK");
    } else if ("serial" in navigator) {
      setStatus("disconnected", "Target ready");
    } else {
      setStatus("error", "Web Serial unavailable");
    }

    updateButtons();
  }

  function buildHexSegments(bytesByAddress) {
    const addresses = Array.from(bytesByAddress.keys()).sort((a, b) => a - b);
    if (!addresses.length) return [];

    const segments = [];
    let start = addresses[0];
    let prev = addresses[0];
    let chunk = [bytesByAddress.get(addresses[0])];

    for (let i = 1; i < addresses.length; i++) {
      const addr = addresses[i];
      if (addr === prev + 1) {
        chunk.push(bytesByAddress.get(addr));
      } else {
        segments.push({
          start,
          endExclusive: prev + 1,
          data: Uint8Array.from(chunk),
        });
        start = addr;
        chunk = [bytesByAddress.get(addr)];
      }
      prev = addr;
    }

    segments.push({
      start,
      endExclusive: prev + 1,
      data: Uint8Array.from(chunk),
    });

    return segments;
  }

  function parseIntelHex(hexText) {
    if (typeof hexText !== "string" || !hexText.trim()) {
      throw new Error("HEX image is empty.");
    }

    const lines = hexText
      .replace(/\r\n/g, "\n")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    if (!lines.length) {
      throw new Error("HEX image has no records.");
    }

    const bytesByAddress = new Map();
    let linearBase = 0;
    let segmentBase = 0;
    let eofSeen = false;

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex];

      if (eofSeen) {
        throw new Error(
          `HEX contains data after EOF record on line ${lineIndex + 1}.`
        );
      }

      if (!line.startsWith(":")) {
        throw new Error(`HEX line ${lineIndex + 1} does not start with ':'.`);
      }

      const payload = line.slice(1);
      if (!payload.length || payload.length % 2 !== 0) {
        throw new Error(`HEX line ${lineIndex + 1} has invalid length.`);
      }

      const bytes = [];
      for (let i = 0; i < payload.length; i += 2) {
        const value = Number.parseInt(payload.slice(i, i + 2), 16);
        if (!Number.isInteger(value)) {
          throw new Error(`HEX line ${lineIndex + 1} has non-hex data.`);
        }
        bytes.push(value);
      }

      if (bytes.length < 5) {
        throw new Error(`HEX line ${lineIndex + 1} is too short.`);
      }

      const count = bytes[0];
      const offset = (bytes[1] << 8) | bytes[2];
      const recordType = bytes[3];
      const data = bytes.slice(4, bytes.length - 1);
      const checksum = bytes[bytes.length - 1];

      if (data.length !== count) {
        throw new Error(
          `HEX line ${lineIndex + 1} has mismatched byte count.`
        );
      }

      if (payload.length !== (count + 5) * 2) {
        throw new Error(`HEX line ${lineIndex + 1} has unexpected size.`);
      }

      const sum = bytes
        .slice(0, bytes.length - 1)
        .reduce((acc, value) => acc + value, 0);
      const expectedChecksum = ((~sum + 1) & 0xff) >>> 0;
      if (expectedChecksum !== checksum) {
        throw new Error(`HEX line ${lineIndex + 1} has invalid checksum.`);
      }

      switch (recordType) {
        case 0x00: {
          const baseAddress = linearBase + segmentBase + offset;
          for (let i = 0; i < data.length; i++) {
            bytesByAddress.set(baseAddress + i, data[i]);
          }
          break;
        }

        case 0x01:
          eofSeen = true;
          break;

        case 0x02:
          if (data.length !== 2) {
            throw new Error(
              `HEX line ${lineIndex + 1} has invalid segment base record.`
            );
          }
          segmentBase = (((data[0] << 8) | data[1]) << 4) >>> 0;
          linearBase = 0;
          break;

        case 0x04:
          if (data.length !== 2) {
            throw new Error(
              `HEX line ${lineIndex + 1} has invalid linear base record.`
            );
          }
          linearBase = (((data[0] << 8) | data[1]) << 16) >>> 0;
          segmentBase = 0;
          break;

        case 0x03:
        case 0x05:
          break;

        default:
          throw new Error(
            `HEX line ${lineIndex + 1} uses unsupported record type ${formatHex(
              recordType,
              2
            )}.`
          );
      }
    }

    if (!eofSeen) {
      throw new Error("HEX image does not contain an EOF record.");
    }

    const segments = buildHexSegments(bytesByAddress);
    if (!segments.length) {
      throw new Error("HEX image does not contain any data bytes.");
    }

    return {
      segments,
      bytesTotal: bytesByAddress.size,
      minAddress: segments[0].start,
      maxAddressExclusive: segments[segments.length - 1].endExclusive,
      recordCount: lines.length,
    };
  }

  function validateImageForTarget(image) {
    const target = getTargetConfig();

    if (image.minAddress < 0) {
      throw new Error("HEX image contains a negative address.");
    }

    if (image.maxAddressExclusive > target.flashSize) {
      throw new Error(
        `HEX exceeds ${target.label} flash size (${target.flashSize} bytes).`
      );
    }

    return target;
  }

  function requireLoadedImage() {
    if (!state.image) {
      throw new Error("Load a valid Intel HEX image before programming.");
    }
    return state.image;
  }

  function buildFlashPages(image, target) {
    const pages = new Map();

    for (const segment of image.segments) {
      for (let index = 0; index < segment.data.length; index++) {
        const flashOffset = segment.start + index;
        const pageBase =
          Math.floor(flashOffset / target.flashPageSize) * target.flashPageSize;
        let page = pages.get(pageBase);

        if (!page) {
          page = new Uint8Array(target.flashPageSize);
          page.fill(0xff);
          pages.set(pageBase, page);
        }

        page[flashOffset - pageBase] = segment.data[index];
      }
    }

    return Array.from(pages.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([flashOffset, data]) => ({
        flashOffset,
        flashAddress: target.flashStart + flashOffset,
        data,
      }));
  }

  function findFirstMismatch(expected, actual) {
    const size = Math.min(expected.length, actual.length);
    for (let index = 0; index < size; index++) {
      if (expected[index] !== actual[index]) return index;
    }
    if (expected.length !== actual.length) return size;
    return -1;
  }

  function loadHexText(hexText, sourceName) {
    const image = parseIntelHex(hexText);
    const target = validateImageForTarget(image);

    state.hexText = hexText.replace(/\r\n/g, "\n");
    state.fileName = sourceName || "textarea";
    state.image = image;
    state.programInfo = null;
    state.lastProbeError = "";

    appendLog(
      `HEX loaded: ${state.fileName}, ${image.bytesTotal} B, ${image.segments.length} segment${
        image.segments.length === 1 ? "" : "s"
      }, target ${target.label}.`
    );

    setSummaryNote("HEX image parsed and validated.", "ok");
    updateView();
  }

  function clearHexState(logMessage = true) {
    state.fileName = "";
    state.hexText = "";
    state.image = null;
    state.programInfo = null;
    state.lastProbeError = "";
    els.hexTextarea.value = "";
    els.hexFileInput.value = "";
    updateView();
    setSummaryNote(
      "HEX input cleared. Probe and signature read are still available."
    );
    if (logMessage) appendLog("HEX state cleared.");
  }

  function applyExternalHexArtifact(detail) {
    const hexText =
      detail && typeof detail.hexText === "string" ? detail.hexText : "";
    const fileName =
      detail && typeof detail.fileName === "string" && detail.fileName.trim()
        ? detail.fileName.trim()
        : "compiled.hex";

    if (!hexText.trim()) {
      clearHexState(false);
      setSummaryNote(
        "Compile a file or load a HEX image to enable UPDI programming."
      );
      updateView();
      return;
    }

    try {
      els.hexTextarea.value = hexText;
      loadHexText(hexText, fileName);
      appendLog(`HEX synced from canvas: ${fileName}.`);
      setSummaryNote("Compiled HEX synced from the current canvas.", "ok");
    } catch (error) {
      state.image = null;
      state.programInfo = null;
      updateView();
      setSummaryNote(
        error.message || "Failed to sync compiled HEX from canvas.",
        "error"
      );
      appendLog(`Compiled HEX sync failed: ${error.message || error}`);
    }
  }

  async function readFileText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () =>
        reject(reader.error || new Error("File read failed."));
      reader.readAsText(file);
    });
  }

  function formatPortInfo(info) {
    if (!info) return "Unknown device";
    const vid = info.usbVendorId;
    const pid = info.usbProductId;

    if (vid != null && pid != null) {
      return `${formatHex(vid)}:${formatHex(pid)}`;
    }
    if (vid != null) return `${formatHex(vid)}`;
    return "Unknown device";
  }

  function concatBytes(a, b) {
    const merged = new Uint8Array(a.length + b.length);
    merged.set(a, 0);
    merged.set(b, a.length);
    return merged;
  }

  function startUpdiSessionIo(session) {
    session.reader = session.port.readable.getReader();
    session.writer = session.port.writable.getWriter();
    session.buffer = new Uint8Array(0);
    session.pumpDone = false;
    session.pumpError = null;
    session.closed = false;
    session.pumpPromise = (async () => {
      try {
        while (!session.closed) {
          const { value, done } = await session.reader.read();
          if (done) {
            session.pumpDone = true;
            break;
          }
          if (value && value.length) {
          session.buffer = concatBytes(session.buffer, value);
          }
        }
      } catch (error) {
        if (!session.closed) {
          session.pumpError = error;
        }
      }
    })();
  }

  async function stopUpdiSessionIo(session, closePort = false) {
    if (!session) return;

    session.closed = true;

    try {
      await session.reader.cancel();
    } catch {}

    try {
      await session.pumpPromise;
    } catch {}

    try {
      session.reader.releaseLock();
    } catch {}

    try {
      session.writer.releaseLock();
    } catch {}

    if (closePort) {
      try {
        await session.port.close();
      } catch {}
    }
  }

  async function openUpdiSession() {
    const port = await navigator.serial.requestPort();
    await port.open(SERIAL_OPTIONS);

    const session = {
      port,
      reader: null,
      writer: null,
      buffer: new Uint8Array(0),
      pumpDone: false,
      pumpError: null,
      closed: false,
      pumpPromise: null,
    };

    startUpdiSessionIo(session);
    return session;
  }

  async function closeUpdiSession(session) {
    await stopUpdiSessionIo(session, true);
  }

  async function reopenUpdiSession(session, options, settleMs = 20) {
    await stopUpdiSessionIo(session, true);
    await delay(settleMs);
    await session.port.open(options);
    startUpdiSessionIo(session);
  }

  async function waitForBuffer(session, count, timeoutMs, label = "") {
    const deadline = Date.now() + timeoutMs;

    while (session.buffer.length < count) {
      if (session.pumpError) {
        throw session.pumpError;
      }

      if (session.pumpDone) {
        throw new Error("Serial stream ended unexpectedly.");
      }

      if (Date.now() >= deadline) {
        throw new Error(
          label
            ? `Timed out waiting for ${label}.`
            : `Timed out waiting for ${count} byte(s).`
        );
      }

      await delay(5);
    }
  }

  function takeBytes(session, count) {
    const slice = session.buffer.slice(0, count);
    session.buffer = session.buffer.slice(count);
    return slice;
  }

  async function readExact(session, count, timeoutMs = 1000, label = "") {
    await waitForBuffer(session, count, timeoutMs, label);
    return takeBytes(session, count);
  }

  async function readUntilSilence(
    session,
    firstTimeoutMs = 1000,
    silenceMs = 60,
    maxBytes = 64
  ) {
    const startDeadline = Date.now() + firstTimeoutMs;
    while (!session.buffer.length) {
      if (session.pumpError) throw session.pumpError;
      if (session.pumpDone) throw new Error("Serial stream ended unexpectedly.");
      if (Date.now() >= startDeadline) {
        throw new Error("Timed out waiting for SIB bytes.");
      }
      await delay(5);
    }

    let lastLength = session.buffer.length;
    let stableSince = Date.now();

    while (Date.now() - stableSince < silenceMs && session.buffer.length < maxBytes) {
      if (session.pumpError) throw session.pumpError;
      if (session.buffer.length !== lastLength) {
        lastLength = session.buffer.length;
        stableSince = Date.now();
      }
      await delay(5);
    }

    return takeBytes(session, session.buffer.length);
  }

  async function writeAndConsumeEcho(session, bytes) {
    const payload = Uint8Array.from(bytes);
    await session.writer.write(payload);
    const echo = await readExact(
      session,
      payload.length,
      500,
      `echo of ${payload.length} byte(s)`
    );

    if (bytesToHex(echo) !== bytesToHex(payload)) {
      throw new Error(
        `Unexpected echo. Sent ${bytesToHex(payload, " ")}, got ${bytesToHex(
          echo,
          " "
        )}.`
      );
    }
  }

  async function performDoubleBreakRecovery(session) {
    appendLog("Reopening port for pyupdi-style double break (300 / 8E1)...");
    await reopenUpdiSession(session, SERIAL_DOUBLE_BREAK_OPTIONS, 40);

    await writeAndConsumeEcho(session, [UPDI.BREAK]);
    await delay(100);
    await writeAndConsumeEcho(session, [UPDI.BREAK]);

    appendLog("Returning port to 115200 / 8E2...");
    await reopenUpdiSession(session, SERIAL_OPTIONS, 40);
    await delay(20);
  }

  async function updiStcs(session, address, value) {
    await writeAndConsumeEcho(session, [
      UPDI.PHY_SYNC,
      UPDI.STCS | (address & 0x0f),
      value & 0xff,
    ]);
  }

  async function updiLdcs(session, address) {
    await writeAndConsumeEcho(session, [
      UPDI.PHY_SYNC,
      UPDI.LDCS | (address & 0x0f),
    ]);
    return (await readExact(session, 1, 1000, `LDCS ${formatHex(address, 2)} response`))[0];
  }

  async function updiReadSib(session) {
    await writeAndConsumeEcho(session, [
      UPDI.PHY_SYNC,
      UPDI.KEY | UPDI.KEY_SIB | UPDI.SIB_32BYTES,
    ]);
    return readUntilSilence(session, 1000, 80, 64);
  }

  async function updiWriteKey(session, keyBytes) {
    await writeAndConsumeEcho(session, [UPDI.PHY_SYNC, UPDI.KEY]);
    await writeAndConsumeEcho(session, [...keyBytes].reverse());
  }

  async function updiReset(session, applyReset) {
    await updiStcs(
      session,
      UPDI.ASI_RESET_REQ,
      applyReset ? UPDI.RESET_REQ_VALUE : 0x00
    );
  }

  async function updiStPtr16(session, address) {
    await writeAndConsumeEcho(session, [
      UPDI.PHY_SYNC,
      UPDI.ST | UPDI.PTR_ADDRESS | UPDI.DATA_16,
      address & 0xff,
      (address >> 8) & 0xff,
    ]);

    const ack = (await readExact(session, 1, 1000, "ST PTR ACK"))[0];
    if (ack !== UPDI.PHY_ACK) {
      throw new Error(`Expected ACK after ST PTR, got ${formatHex(ack, 2)}.`);
    }
  }

  async function updiRepeat(session, repeats) {
    await writeAndConsumeEcho(session, [
      UPDI.PHY_SYNC,
      UPDI.REPEAT | UPDI.REPEAT_BYTE,
      (repeats - 1) & 0xff,
    ]);
  }

  async function updiLdPtrInc(session, size) {
    await writeAndConsumeEcho(session, [
      UPDI.PHY_SYNC,
      UPDI.LD | UPDI.PTR_INC | UPDI.DATA_8,
    ]);
    return readExact(session, size, 1000, `LD PTR INC ${size} byte(s)`);
  }

  async function updiLdPtrInc16(session, words) {
    await writeAndConsumeEcho(session, [
      UPDI.PHY_SYNC,
      UPDI.LD | UPDI.PTR_INC | UPDI.DATA_16,
    ]);
    return readExact(session, words * 2, 1000, `LD PTR INC16 ${words * 2} byte(s)`);
  }

  async function updiSetAckEnabled(session, enabled) {
    await updiStcs(
      session,
      UPDI.CS_CTRLA,
      (1 << UPDI.CTRLA_IBDLY_BIT) |
        (enabled ? 0 : 1 << UPDI.CTRLA_RSD_BIT)
    );
  }

  async function updiStPtrInc8(session, value) {
    await writeAndConsumeEcho(session, [
      UPDI.PHY_SYNC,
      UPDI.ST | UPDI.PTR_INC | UPDI.DATA_8,
      value & 0xff,
    ]);

    const ack = (await readExact(session, 1, 1000, "ST PTR INC8 ACK"))[0];
    if (ack !== UPDI.PHY_ACK) {
      throw new Error(`Expected ACK after ST PTR INC8, got ${formatHex(ack, 2)}.`);
    }
  }

  async function updiStPtrInc16(session, data) {
    if (!data?.length) return;
    if (data.length % 2 !== 0) {
      throw new Error("Word write payload must contain an even number of bytes.");
    }

    if (data.length === 2) {
      await writeAndConsumeEcho(session, [
        UPDI.PHY_SYNC,
        UPDI.ST | UPDI.PTR_INC | UPDI.DATA_16,
        data[0],
        data[1],
      ]);

      const ack = (await readExact(session, 1, 1000, "ST PTR INC16 ACK"))[0];
      if (ack !== UPDI.PHY_ACK) {
        throw new Error(
          `Expected ACK after ST PTR INC16, got ${formatHex(ack, 2)}.`
        );
      }
      return;
    }

    await updiSetAckEnabled(session, false);
    try {
      await writeAndConsumeEcho(session, [
        UPDI.PHY_SYNC,
        UPDI.ST | UPDI.PTR_INC | UPDI.DATA_16,
      ]);
      await writeAndConsumeEcho(session, data);
    } finally {
      await updiSetAckEnabled(session, true);
    }
  }

  async function updiReadData16(session, address, size) {
    await updiStPtr16(session, address);
    if (size > 1) {
      await updiRepeat(session, size);
    }
    return updiLdPtrInc(session, size);
  }

  async function updiReadWords(session, address, words) {
    await updiStPtr16(session, address);
    if (words > 1) {
      await updiRepeat(session, words);
    }
    return updiLdPtrInc16(session, words);
  }

  async function updiWriteByte(session, address, value) {
    await updiStPtr16(session, address);
    await updiStPtrInc8(session, value);
  }

  async function updiWriteWords(session, address, data) {
    if (!data?.length) return;
    if (data.length % 2 !== 0) {
      throw new Error("Flash page data must contain an even number of bytes.");
    }

    await updiStPtr16(session, address);
    const words = data.length >> 1;
    if (words > 1) {
      await updiRepeat(session, words);
    }
    await updiStPtrInc16(session, data);
  }

  function decodeSib(bytes) {
    const raw = new TextDecoder("ascii")
      .decode(bytes)
      .replace(/\u0000+$/g, "");

    if (raw.length < 19) {
      throw new Error("SIB read returned incomplete data.");
    }

    const family = raw.slice(0, 7).trim();
    const nvmField = raw.slice(8, 11).trim();
    const ocdField = raw.slice(11, 14).trim();
    const osc = raw.slice(15, 19).trim();
    const extra = raw.slice(19).trim();

    return {
      raw,
      family,
      nvm: nvmField.includes(":") ? nvmField.split(":")[1] : nvmField,
      ocd: ocdField.includes(":") ? ocdField.split(":")[1] : ocdField,
      osc,
      extra,
    };
  }

  async function initDatalink(session) {
    await updiStcs(session, UPDI.CS_CTRLB, 1 << UPDI.CTRLB_CCDETDIS_BIT);
    await updiStcs(session, UPDI.CS_CTRLA, 1 << UPDI.CTRLA_IBDLY_BIT);
    const statusA = await updiLdcs(session, UPDI.CS_STATUSA);
    if (statusA === 0) {
      throw new Error("UPDI datalink check returned STATUSA=0x00.");
    }
    return statusA;
  }

  async function handshakeAndReadSib(session) {
    await writeAndConsumeEcho(session, [UPDI.BREAK]);

    try {
      await initDatalink(session);
    } catch (error) {
      appendLog(`Datalink init failed, trying BREAK recovery: ${error.message}`);
      await performDoubleBreakRecovery(session);
      await initDatalink(session);
    }

    const sib = decodeSib(await updiReadSib(session));
    state.sibText = sib.raw;
    appendLog(`SIB: ${sib.raw}`);

    if (sib.nvm !== "0") {
      throw new Error(`Unsupported NVM revision "${sib.nvm}" for this test page.`);
    }

    const statusA = await initDatalink(session);
    appendLog(`UPDI STATUSA = ${formatHex(statusA, 2)} (PDI rev ${statusA >> 4})`);

    return sib;
  }

  async function waitForUnlocked(session, timeoutMs) {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const status = await updiLdcs(session, UPDI.ASI_SYS_STATUS);
      if ((status & (1 << UPDI.ASI_SYS_STATUS_LOCKSTATUS)) === 0) {
        return status;
      }
      await delay(5);
    }

    throw new Error("Timed out waiting for LOCKSTATUS to clear.");
  }

  async function waitForProgMode(session, timeoutMs) {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const status = await updiLdcs(session, UPDI.ASI_SYS_STATUS);
      if (status & (1 << UPDI.ASI_SYS_STATUS_NVMPROG)) {
        return status;
      }
      await delay(5);
    }

    throw new Error("Timed out waiting for NVMPROG mode.");
  }

  async function enterNvmProgMode(session) {
    let status = await updiLdcs(session, UPDI.ASI_SYS_STATUS);
    if (status & (1 << UPDI.ASI_SYS_STATUS_NVMPROG)) {
      appendLog("Already in NVM programming mode.");
      return;
    }

    appendLog("Entering NVM programming mode...");
    await updiReset(session, true);
    await updiWriteKey(session, UPDI.KEY_NVM);

    const keyStatus = await updiLdcs(session, UPDI.ASI_KEY_STATUS);
    appendLog(`ASI_KEY_STATUS = ${formatHex(keyStatus, 2)}`);
    if ((keyStatus & (1 << UPDI.ASI_KEY_STATUS_NVMPROG)) === 0) {
      throw new Error("NVMProg key was not accepted.");
    }

    await updiReset(session, true);
    await updiReset(session, false);
    status = await waitForUnlocked(session, 300);
    appendLog(`Unlocked, SYS_STATUS = ${formatHex(status, 2)}`);

    status = await waitForProgMode(session, 300);
    appendLog(`NVMPROG active, SYS_STATUS = ${formatHex(status, 2)}`);
  }

  async function leaveNvmProgMode(session) {
    try {
      await updiReset(session, true);
      await updiReset(session, false);
      await updiStcs(
        session,
        UPDI.CS_CTRLB,
        (1 << UPDI.CTRLB_UPDIDIS_BIT) | (1 << UPDI.CTRLB_CCDETDIS_BIT)
      );
    } catch (error) {
      appendLog(`Leave progmode warning: ${error.message || error}`);
    }
  }

  function isTransientNvmPollError(error) {
    const message = String(error?.message || error || "");
    return (
      message.includes("Timed out waiting for ST PTR ACK") ||
      message.includes("Timed out waiting for LD PTR INC 1 byte(s)") ||
      message.includes("Timed out waiting for echo of 2 byte(s)") ||
      message.includes("Expected ACK after ST PTR")
    );
  }

  async function waitForNvmReady(session, target, timeoutMs = 500) {
    const deadline = Date.now() + timeoutMs;
    let transientCount = 0;

    while (Date.now() < deadline) {
      let status;
      try {
        status = (await updiReadData16(
          session,
          target.nvmctrlBase + NVM_P0.STATUS,
          1
        ))[0];
      } catch (error) {
        if (!isTransientNvmPollError(error)) {
          throw error;
        }

        transientCount += 1;
        if (transientCount <= 2) {
          appendLog(
            `NVM poll retry ${transientCount}: ${error.message || error}`
          );
        }
        await delay(8);
        continue;
      }

      if (status & (1 << NVM_P0.STATUS_WRITE_ERROR_BIT)) {
        throw new Error(`NVM controller error, STATUS=${formatHex(status, 2)}.`);
      }

      if (
        (status &
          ((1 << NVM_P0.STATUS_EEPROM_BUSY_BIT) |
            (1 << NVM_P0.STATUS_FLASH_BUSY_BIT))) ===
        0
      ) {
        return status;
      }

      await delay(4);
    }

    throw new Error("Timed out waiting for NVM controller ready state.");
  }

  async function executeNvmCommand(session, target, command) {
    await updiWriteByte(session, target.nvmctrlBase + NVM_P0.CTRLA, command);
  }

  async function chipErase(session, target) {
    appendLog("Issuing chip erase...");
    await waitForNvmReady(session, target, 500);
    await executeNvmCommand(session, target, NVM_P0.CMD_CHIP_ERASE);
    await delay(12);
    const status = await waitForNvmReady(session, target, 5000);
    appendLog(`Chip erase complete, NVM STATUS=${formatHex(status, 2)}.`);
  }

  async function writeFlashPage(session, target, page) {
    await waitForNvmReady(session, target, 500);
    appendLog(`Clearing page buffer at ${formatHex(page.flashAddress)}...`);
    await executeNvmCommand(session, target, NVM_P0.CMD_PAGE_BUFFER_CLEAR);
    await delay(4);
    await waitForNvmReady(session, target, 500);
    appendLog(`Loading page buffer at ${formatHex(page.flashAddress)}...`);
    await updiWriteWords(session, page.flashAddress, page.data);
    appendLog(`Committing page at ${formatHex(page.flashAddress)}...`);
    await executeNvmCommand(session, target, NVM_P0.CMD_WRITE_PAGE);
    await delay(8);
    await waitForNvmReady(session, target, 1000);
  }

  async function verifyFlashPage(session, page) {
    const actual = await updiReadWords(
      session,
      page.flashAddress,
      page.data.length >> 1
    );
    const mismatchIndex = findFirstMismatch(page.data, actual);

    if (mismatchIndex !== -1) {
      throw new Error(
        `Verify mismatch at ${formatHex(
          page.flashAddress + mismatchIndex
        )}: expected ${formatHex(page.data[mismatchIndex], 2)}, got ${formatHex(
          actual[mismatchIndex],
          2
        )}.`
      );
    }
  }

  async function readDeviceSignatureInfo(session, target) {
    const signatureBytes = await updiReadData16(session, target.sigrowAddress, 3);
    const deviceId =
      (signatureBytes[0] << 16) | (signatureBytes[1] << 8) | signatureBytes[2];

    const revisionByte = (await updiReadData16(session, target.syscfgBase + 1, 1))[0];
    const serialBytes = await updiReadData16(session, target.sigrowAddress + 3, 10);

    const info = {
      deviceId,
      revisionByte,
      revisionText: `${revisionByte >> 4}.${revisionByte & 0x0f}`,
      serialHex: bytesToHex(serialBytes),
    };

    state.signatureInfo = info;

    appendLog(`Signature: ${formatHex(deviceId, 6)}`);
    appendLog(`Revision byte: ${formatHex(revisionByte, 2)}`);
    appendLog(`Serial: ${info.serialHex}`);

    if (deviceId !== target.deviceId) {
      throw new Error(
        `Device ID mismatch: read ${formatHex(deviceId, 6)}, expected ${formatHex(
          target.deviceId,
          6
        )}.`
      );
    }

    return info;
  }

  async function runUpdiAction(actionName, handler) {
    if (state.busy) return;
    if (isCanvasSerialConnected()) {
      throw new Error("Disconnect UART before using UPDI programming tools.");
    }

    let session = null;
    state.busy = true;
    state.busyLabel = actionName;
    state.lastProbeError = "";
    updateView();

    try {
      appendLog("Requesting serial port...");
      session = await openUpdiSession();
      appendLog(`Opening port with ${SERIAL_BAUD} / 8E2...`);
      appendLog(`Port selected: ${formatPortInfo(session.port.getInfo?.())}`);

      const result = await handler(session);
      state.lastProbeOk = true;
      state.lastProbeError = "";
      return result;
    } catch (error) {
      state.lastProbeOk = false;
      state.lastProbeError = error.message || String(error);
      appendLog(`${actionName} failed: ${state.lastProbeError}`);
      throw error;
    } finally {
      if (session) {
        try {
          await closeUpdiSession(session);
          appendLog("Port closed.");
        } catch (closeError) {
          appendLog(
            `Port close warning: ${closeError.message || closeError}`
          );
        }
      }

      state.busy = false;
      state.busyLabel = "";
      updateView();
    }
  }

  async function probeUpdi() {
    try {
      await runUpdiAction("Probing UPDI...", async (session) => {
        const sib = await handshakeAndReadSib(session);
        appendLog(
          `Probe OK: family=${sib.family}, NVM=${sib.nvm}, OCD=${sib.ocd}, OSC=${sib.osc}`
        );
        setSummaryNote(
          "UPDI datalink and SIB read succeeded. No flash write was attempted.",
          "ok"
        );
      });
    } catch (error) {
      setSummaryNote(error.message || "UPDI probe failed.", "error");
    }
  }

  async function readSignature() {
    try {
      await runUpdiAction("Reading signature...", async (session) => {
        const target = getTargetConfig();
        let progModeEntered = false;

        await handshakeAndReadSib(session);
        try {
          await enterNvmProgMode(session);
          progModeEntered = true;
          const info = await readDeviceSignatureInfo(session, target);

          setSummaryNote(
            `Device signature matches ${target.label}: ${formatHex(
              info.deviceId,
              6
            )}.`,
            "ok"
          );
        } finally {
          if (progModeEntered) {
            await leaveNvmProgMode(session);
          }
        }
      });
    } catch (error) {
      setSummaryNote(error.message || "Signature read failed.", "error");
    }
  }

  async function programHex() {
    try {
      const image = requireLoadedImage();
      const target = validateImageForTarget(image);
      const pages = buildFlashPages(image, target);
      state.programInfo = null;

      if (!pages.length) {
        throw new Error("HEX image does not contain any flash pages to program.");
      }

      await runUpdiAction("Programming flash...", async (session) => {
        let progModeEntered = false;

        await handshakeAndReadSib(session);
        try {
          await enterNvmProgMode(session);
          progModeEntered = true;

          const info = await readDeviceSignatureInfo(session, target);
          appendLog(
            `Programming ${pages.length} page(s) to ${target.label} from ${state.fileName || "textarea"}.`
          );

          await chipErase(session, target);

          for (let index = 0; index < pages.length; index++) {
            const page = pages[index];
            const pageLabel = `page ${index + 1}/${pages.length}`;
            setBusyLabel(`Writing ${pageLabel}`);
            appendLog(`Writing ${pageLabel} at ${formatHex(page.flashAddress)}...`);
            await writeFlashPage(session, target, page);

            setBusyLabel(`Verifying ${pageLabel}`);
            appendLog(`Verifying ${pageLabel}...`);
            await verifyFlashPage(session, page);
          }

          state.programInfo = {
            fileName: state.fileName || "textarea",
            pagesWritten: pages.length,
            bytesProgrammed: image.bytesTotal,
            deviceId: info.deviceId,
          };

          appendLog(
            `Flash verified: ${pages.length} page(s), ${image.bytesTotal} byte(s) of payload.`
          );
          setSummaryNote(
            `Flash programmed and verified for ${target.label}: ${pages.length} page(s), ${image.bytesTotal} byte(s).`,
            "ok"
          );
        } finally {
          if (progModeEntered) {
            await leaveNvmProgMode(session);
          }
        }
      });
    } catch (error) {
      setSummaryNote(error.message || "Flash programming failed.", "error");
    }
  }

  async function handleFileLoad() {
    const file = els.hexFileInput.files && els.hexFileInput.files[0];
    if (!file) return;

    try {
      const text = await readFileText(file);
      els.hexTextarea.value = text;
      loadHexText(text, file.name);
    } catch (error) {
      state.image = null;
      state.programInfo = null;
      updateView();
      setSummaryNote(error.message || "Failed to load HEX file.", "error");
      setStatus("error", "HEX invalid");
      appendLog(`File load failed: ${error.message || error}`);
    }
  }

  function handleTextareaLoad() {
    try {
      loadHexText(els.hexTextarea.value, "textarea");
    } catch (error) {
      state.image = null;
      state.programInfo = null;
      updateView();
      setSummaryNote(error.message || "HEX parse failed.", "error");
      setStatus("error", "HEX invalid");
      appendLog(`HEX parse failed: ${error.message || error}`);
    }
  }

  function checkSupport() {
    if (!("serial" in navigator)) {
      if (els.apiWarning) els.apiWarning.classList.add("show");
      appendLog("Web Serial API is not available in this browser.");
      setSummaryNote(
        "Web Serial API is required for probe, signature read, and flash programming.",
        "error"
      );
    } else {
      appendLog("Web Serial API detected.");
    }
    updateButtons();
  }

  function bind() {
    els.hexFileInput.addEventListener("change", handleFileLoad);
    els.useTextareaBtn.addEventListener("click", handleTextareaLoad);
    els.clearHexBtn.addEventListener("click", () => clearHexState());
    els.clearLogBtn.addEventListener("click", clearLog);
    els.probeBtn.addEventListener("click", probeUpdi);
    els.readSignatureBtn.addEventListener("click", readSignature);
    els.programHexBtn.addEventListener("click", programHex);
    els.mcuSelect.addEventListener("change", () => {
      state.programInfo = null;
      if (state.hexText) {
        try {
          loadHexText(state.hexText, state.fileName || "textarea");
        } catch (error) {
          state.image = null;
          state.programInfo = null;
          updateView();
          setSummaryNote(error.message || "HEX parse failed.", "error");
          setStatus("error", "HEX invalid");
          appendLog(`Target validation failed: ${error.message || error}`);
        }
      } else {
        updateView();
      }
    });
  }

  function handleExternalHexArtifactEvent(event) {
    applyExternalHexArtifact(event?.detail || {});
  }

  function handleCanvasSerialStateEvent() {
    updateView();
  }

  function hasRequiredElements() {
    return !!(
      els.probeStatus &&
      els.mcuSelect &&
      els.probeBtn &&
      els.readSignatureBtn &&
      els.programHexBtn &&
      els.clearLogBtn &&
      els.hexFileInput &&
      els.hexTextarea &&
      els.useTextareaBtn &&
      els.clearHexBtn &&
      els.summarySource &&
      els.summaryBytes &&
      els.summarySegments &&
      els.summaryRange &&
      els.summaryRecords &&
      els.summaryTarget &&
      els.summarySignature &&
      els.summaryRevision &&
      els.summarySerial &&
      els.summarySib &&
      els.summaryNote &&
      els.probeLog
    );
  }

  function boot() {
    els.apiWarning = $("apiWarning");
    els.probeStatus = $("probeStatus");
    els.mcuSelect = $("mcuSelect");
    els.probeBtn = $("probeBtn");
    els.readSignatureBtn = $("readSignatureBtn");
    els.programHexBtn = $("programHexBtn");
    els.clearLogBtn = $("clearLogBtn");
    els.hexFileInput = $("hexFileInput");
    els.hexTextarea = $("hexTextarea");
    els.useTextareaBtn = $("useTextareaBtn");
    els.clearHexBtn = $("clearHexBtn");
    els.summarySource = $("summarySource");
    els.summaryBytes = $("summaryBytes");
    els.summarySegments = $("summarySegments");
    els.summaryRange = $("summaryRange");
    els.summaryRecords = $("summaryRecords");
    els.summaryTarget = $("summaryTarget");
    els.summarySignature = $("summarySignature");
    els.summaryRevision = $("summaryRevision");
    els.summarySerial = $("summarySerial");
    els.summarySib = $("summarySib");
    els.summaryNote = $("summaryNote");
    els.probeLog = $("probeLog");

    if (!hasRequiredElements()) {
      return;
    }

    bind();
    resetSummary();
    checkSupport();
    updateView();
    appendLog("UPDI test page is ready.");

    window.addEventListener("ud-updi-hex-artifact", handleExternalHexArtifactEvent);
    window.addEventListener(
      "ud-canvas-serial-state",
      handleCanvasSerialStateEvent
    );

    const bridge = getCanvasUpdiBridge();
    if (bridge && typeof bridge.getHexArtifact === "function") {
      try {
        const artifact = bridge.getHexArtifact();
        if (artifact && typeof artifact.hexText === "string" && artifact.hexText.trim()) {
          applyExternalHexArtifact(artifact);
        }
      } catch (error) {
        appendLog(`Bridge sync warning: ${error.message || error}`);
      }
    }
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
