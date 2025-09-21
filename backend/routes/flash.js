// backend/routes/flash.js
import express from "express";
import multer from "multer";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";

const router = express.Router();

// ───────────────────────────────────────────────────────────────────────────────
// Upload config
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }, // 8 MB
});

// ───────────────────────────────────────────────────────────────────────────────
// 1) Создать сессию (браузер подключится к WS как role=browser)
router.post("/flash/create-session", (req, res) => {
  const sessionId = crypto.randomUUID();
  const wsBase =
    process.env.WS_BASE || `ws://127.0.0.1:${process.env.PORT || 8080}`;
  const wsPath = `/ws/flash/${sessionId}`;
  console.log(
    `[flash] create-session id=${sessionId} wsBase=${wsBase} wsPath=${wsPath}`
  );
  res.json({ sessionId, wsPath });
});

// ───────────────────────────────────────────────────────────────────────────────
// 2) Старт прошивки: принимаем HEX и запускаем Python (role=python)
router.post("/flash/start", upload.single("file"), (req, res) => {
  try {
    const {
      sessionId,
      device = "attiny1624",
      baud = 230400,
      erase = "true",
      verify = "true",
    } = req.body || {};

    if (!sessionId) {
      return res.status(400).json({ error: "sessionId required" });
    }
    if (!req.file) {
      return res
        .status(400)
        .json({ error: "HEX file required (multipart/form-data: file=...)" });
    }

    // Сохраняем временный HEX на диск, чтобы отдать его Python-скрипту
    const tmpHex = path.join(
      os.tmpdir(),
      `flash-${Date.now()}-${crypto.randomUUID()}.hex`
    );
    try {
      fs.writeFileSync(tmpHex, req.file.buffer);
    } catch (e) {
      console.error("[flash] write tmp hex error:", e);
      return res.status(500).json({ error: "Cannot write temp HEX file" });
    }

    // Параметры окружения/портов
    const wsBase =
      process.env.WS_BASE || `ws://127.0.0.1:${process.env.PORT || 8080}`;
    const pyBin = process.env.PYTHON_BIN || "python3";

    // Путь к Python-скрипту (относительно cwd процесса Node)
    const script = path.join(process.cwd(), "python", "flash_pymcuprog.py");

    // Сборка аргументов Python
    const args = [
      script,
      "--session",
      sessionId,
      "--device",
      device,
      "--hex",
      tmpHex,
      "--baud",
      String(baud),
      ...(String(erase) === "true" ? ["--erase"] : []),
      ...(String(verify) === "true" ? ["--verify"] : []),
      "--ws",
      wsBase,
    ];

    console.log("[flash] spawn:", pyBin, args.join(" "));
    const child = spawn(pyBin, args, {
      cwd: process.cwd(), // ожидаем /var/www/uartdebug (см. PM2 cwd)
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    child.stdout.on("data", (d) =>
      console.log("[py-out]", d.toString().trimEnd())
    );
    child.stderr.on("data", (d) =>
      console.error("[py-err]", d.toString().trimEnd())
    );
    child.on("error", (err) => console.error("[py-error]", err));
    child.on("exit", (code) => {
      // чистим временный HEX
      fs.unlink(tmpHex, () => {});
      console.log("[flash] python exit code:", code);
    });

    // Отвечаем сразу — диалог пойдет через WS и логи полетят в консоль и в RxD
    return res.json({ ok: true });
  } catch (e) {
    console.error("[flash] start error:", e);
    return res.status(500).json({ error: String(e?.message || e) });
  }
});

// ───────────────────────────────────────────────────────────────────────────────
// (Необязательно) Вспомогательный эндпоинт для быстрой проверки доступности сервера
router.get("/flash/health", (req, res) => {
  res.json({
    ok: true,
    port: Number(process.env.PORT) || 8080,
    wsBase: process.env.WS_BASE || `ws://127.0.0.1:${process.env.PORT || 8080}`,
  });
});

export default router;
