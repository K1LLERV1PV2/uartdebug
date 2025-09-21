// backend/routes/flash.js
import express from "express";
import multer from "multer";
import os from "os";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { spawn } from "child_process";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
});
const router = express.Router();

// 2.1) Create a session first, so the browser can connect the WS bridge before Python starts
router.post("/flash/create-session", (req, res) => {
  const sessionId = crypto.randomUUID();
  res.json({ sessionId, wsPath: `/ws/flash/${sessionId}` });
});

// 2.2) Start flashing: upload HEX and spawn python tied to the existing sessionId
router.post("/flash/start", upload.single("file"), (req, res) => {
  try {
    const {
      sessionId,
      device = "attiny1624",
      baud = 230400,
      erase = "true",
      verify = "true",
    } = req.body;
    if (!sessionId)
      return res.status(400).json({ error: "sessionId required" });
    if (!req.file) return res.status(400).json({ error: "HEX file required" });

    const hexPath = path.join(
      os.tmpdir(),
      `flash-${Date.now()}-${crypto.randomUUID()}.hex`
    );
    fs.writeFileSync(hexPath, req.file.buffer);

    // Spawn python flasher, it connects to WS as role=python for this session
    const py = spawn(
      process.env.PYTHON_BIN || "python3",
      [
        path.resolve("python/flash_pymcuprog.py"),
        "--session",
        sessionId,
        "--device",
        device,
        "--hex",
        hexPath,
        "--baud",
        String(baud),
        ...(erase === "true" ? ["--erase"] : []),
        ...(verify === "true" ? ["--verify"] : []),
        // optional: "--ws", "ws://127.0.0.1:8080"  // if your HTTP server listens on a custom port
      ],
      { stdio: "inherit" }
    );

    py.on("exit", (code) => {
      fs.unlink(hexPath, () => {});
    });

    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
});

export default router;
