// public/js/bridge.js
(function () {
  const term = document.getElementById("terminalReceived");
  const flashBtn = document.getElementById("flashBtn");
  const mcuSelect = document.getElementById("mcuSelect");
  const baudSel = document.getElementById("baudRate");

  const fileInput =
    document.getElementById("flashHexFile") ||
    (() => {
      const i = document.createElement("input");
      i.type = "file";
      i.accept = ".hex,.ihx,.ihex";
      i.id = "flashHexFile";
      i.hidden = true;
      document.body.appendChild(i);
      return i;
    })();

  const log = (t, cls = "info") => {
    if (!term) {
      console.log(t);
      return;
    }
    const div = document.createElement("div");
    div.className = `terminal-line ${cls}`;
    div.textContent = t;
    term.appendChild(div);
    term.scrollTo(0, term.scrollHeight);
  };

  let ws = null;
  let flashPort = null; // наш порт для прошивки (после requestPort)
  let reader = null,
    writer = null;
  let weOpenedPort = false; // открывали ли мы порт (чтобы решать, закрывать ли его в конце)

  function connectBridge(sessionId) {
    return new Promise((resolve, reject) => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      ws = new WebSocket(
        `${proto}://${location.host}/ws/flash/${sessionId}?role=browser`
      );
      ws.binaryType = "arraybuffer";

      const openTimer = setTimeout(
        () => reject(new Error("WS open timeout")),
        8000
      );

      ws.onopen = () => {
        clearTimeout(openTimer);
        log(`WS bridge ready (session ${sessionId})`);
        resolve();
      };

      ws.onclose = () => log("WS bridge closed");
      ws.onerror = (e) => console.error("WS error:", e);

      ws.onmessage = async (ev) => {
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
            try {
              // 1) Если терминал держал порт — мы его уже закрыли в onHexChosen()
              // 2) Если порт уже открыт (редкий случай) — не пытаемся открыть заново
              if (flashPort && flashPort.readable) {
                reader = flashPort.readable.getReader();
                writer = flashPort.writable.getWriter();
                weOpenedPort = false; // открыт не нами
                return reply({ ok: true });
              }

              if (!flashPort) {
                // на всякий случай: если не задан, спросим у пользователя
                flashPort = await navigator.serial.requestPort();
              }

              await flashPort.open({
                baudRate: args?.baud || 230400,
                dataBits: 8,
                stopBits: 1,
                parity: "none",
                bufferSize: 65536,
              });
              reader = flashPort.readable.getReader();
              writer = flashPort.writable.getWriter();
              weOpenedPort = true;
              return reply({ ok: true });
            } catch (e) {
              // Если порт уже открыт кем-то — считаем это успехом и просто берём writer/reader
              const msg = String(e?.message || e);
              if (/already open/i.test(msg)) {
                try {
                  reader = flashPort.readable.getReader();
                  writer = flashPort.writable.getWriter();
                  weOpenedPort = false;
                  return reply({ ok: true });
                } catch (e2) {
                  return reply({ ok: false, error: String(e2?.message || e2) });
                }
              }
              return reply({ ok: false, error: msg });
            }
          }

          if (cmd === "setSignals") {
            if (!flashPort) throw new Error("port not open");
            await flashPort.setSignals(args || {}); // { dataTerminalReady?, requestToSend?, break? }
            return reply({ ok: true });
          }

          if (cmd === "write") {
            if (!writer) throw new Error("writer not ready");
            await writer.write(new Uint8Array(args?.bytes || []));
            return reply({ ok: true });
          }

          if (cmd === "read") {
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
            // Закрываем только если открывали мы
            try {
              reader?.releaseLock();
            } catch {}
            try {
              writer?.releaseLock();
            } catch {}
            if (weOpenedPort) {
              try {
                await flashPort?.close();
              } catch {}
            }
            reader = writer = null;
            return reply({ ok: true });
          }
        } catch (e) {
          return reply({ ok: false, error: String(e?.message || e) });
        }
      };
    });
  }

  async function onHexChosen() {
    const file = fileInput.files?.[0];
    if (!file) return;

    try {
      // 0) Если терминал уже подключён — аккуратно его разомкнём
      if (window.port) {
        try {
          if (typeof window.disconnectSerial === "function") {
            await window.disconnectSerial();
          } else {
            // жёсткая остановка, если нет экспортированной функции
            try {
              window.reader?.cancel();
              window.reader?.releaseLock();
            } catch {}
            try {
              window.writer?.releaseLock();
            } catch {}
            try {
              await window.port?.close();
            } catch {}
            window.port = null;
          }
          log("Terminal disconnected for flashing…");
        } catch (e) {
          log(`Failed to disconnect terminal: ${e?.message || e}`, "error");
        }
      }

      // 1) Захватываем порт в user-gesture
      flashPort = await navigator.serial.requestPort();

      // 2) Создаём сессию и ждём WS
      const sRes = await fetch("/api/flash/create-session", { method: "POST" });
      const { sessionId } = await sRes.json();
      await connectBridge(sessionId);

      // 3) Стартуем Python
      const fd = new FormData();
      fd.append("sessionId", sessionId);
      fd.append("device", mcuSelect?.value || "attiny1624");
      fd.append("baud", baudSel?.value || "230400");
      fd.append("erase", "true");
      fd.append("verify", "true");
      fd.append("file", file);

      const res = await fetch("/api/flash/start", { method: "POST", body: fd });
      if (!res.ok) log(`Start failed: ${await res.text()}`, "error");
    } catch (e) {
      log(`Start error: ${e?.message || e}`, "error");
    } finally {
      fileInput.value = "";
    }
  }

  if (flashBtn) {
    flashBtn.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", onHexChosen);
  }
})();
