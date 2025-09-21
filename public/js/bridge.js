// public/js/bridge.js
(function () {
  const term = document.getElementById("terminalReceived");
  const fileInput = document.getElementById("flashHexFile");
  const flashBtn = document.getElementById("flashBtn");
  const mcuSelect = document.getElementById("mcuSelect");
  const baudSel = document.getElementById("baudRate");

  const log = (t, cls = "info") => {
    if (!term) return;
    const div = document.createElement("div");
    div.className = `terminal-line ${cls}`;
    div.textContent = t;
    term.appendChild(div);
    term.scrollTo(0, term.scrollHeight);
  };

  let ws = null,
    port = null,
    reader = null,
    writer = null;

  async function connectBridge(sessionId) {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(
      `${proto}://${location.host}/ws/flash/${sessionId}?role=browser`
    );
    ws.binaryType = "arraybuffer";

    ws.onopen = () => log(`WS bridge ready (session ${sessionId})`);

    ws.onmessage = async (ev) => {
      // JSON protocol: {id, cmd, args}
      let msg = null;
      try {
        msg = JSON.parse(
          typeof ev.data === "string"
            ? ev.data
            : new TextDecoder().decode(ev.data)
        );
      } catch {
        return;
      }
      const { id, cmd, args } = msg || {};

      const reply = (payload) => ws?.send(JSON.stringify({ id, ...payload }));

      try {
        if (cmd === "log") {
          log(String(args?.text || ""));
          return;
        }
        if (cmd === "open") {
          port = await navigator.serial.requestPort();
          await port.open({
            baudRate: args?.baud || 230400,
            dataBits: 8,
            stopBits: 1,
            parity: "none",
            bufferSize: 65536,
          });
          reader = port.readable.getReader();
          writer = port.writable.getWriter();
          return reply({ ok: true });
        }
        if (cmd === "setSignals") {
          if (!port) throw new Error("port not open");
          await port.setSignals(args || {}); // { dataTerminalReady?, requestToSend?, break? }
          return reply({ ok: true });
        }
        if (cmd === "write") {
          if (!writer) throw new Error("writer not ready");
          await writer.write(new Uint8Array(args?.bytes || []));
          return reply({ ok: true });
        }
        if (cmd === "read") {
          // Read up to args.n bytes or until timeout
          const need = Math.max(0, Number(args?.n || 0));
          const deadline =
            performance.now() + Math.max(0, Number(args?.timeout_ms || 1000));
          const out = [];
          while (out.length < need && performance.now() < deadline) {
            const { value, done } = await reader.read();
            if (done) break;
            if (value?.length) out.push(...value);
          }
          return reply({ ok: true, bytes: out });
        }
        if (cmd === "close") {
          try {
            reader?.releaseLock();
          } catch {}
          try {
            writer?.releaseLock();
          } catch {}
          try {
            await port?.close();
          } catch {}
          port = reader = writer = null;
          return reply({ ok: true });
        }
      } catch (e) {
        return reply({ ok: false, error: String(e?.message || e) });
      }
    };

    ws.onclose = () => log("WS bridge closed");
  }

  async function startFlashWithPy() {
    const file = fileInput.files?.[0];
    if (!file) return;

    // 1) Create session and connect WS first (to avoid race)
    const sRes = await fetch("/api/flash/create-session", { method: "POST" });
    const { sessionId } = await sRes.json();
    await connectBridge(sessionId);

    // 2) Start python on server with the uploaded HEX
    const fd = new FormData();
    fd.append("sessionId", sessionId);
    fd.append("device", mcuSelect?.value || "attiny1624");
    fd.append("baud", baudSel?.value || "230400");
    fd.append("erase", "true");
    fd.append("verify", "true");
    fd.append("file", file);
    const res = await fetch("/api/flash/start", { method: "POST", body: fd });
    if (!res.ok) log(`Start failed: ${await res.text()}`, "error");
  }

  // Hook your existing Flash MCU button
  if (flashBtn) {
    flashBtn.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => startFlashWithPy());
  }
})();
