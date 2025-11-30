// compile-server.js
const express = require("express");
const { mkdtemp, writeFile, readFile, rm } = require("fs/promises");
const path = require("path");
const os = require("os");
const { execFile } = require("child_process");

const app = express();
const PORT = process.env.PORT || 8082;

const XC8_CC = process.env.XC8_CC || "xc8-cc";
const AVR_OBJCOPY = process.env.AVR_OBJCOPY || "avr-objcopy";
const DFP_PATH = process.env.XC8_DFP || "/opt/microchip/dfp/attiny/xc8";

// Allow CORS from your site if backend runs on a different origin
if (process.env.CORS_ORIGIN) {
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", process.env.CORS_ORIGIN);
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });
}

app.use(express.json({ limit: "512kb" }));

const MAX_CODE_SIZE = 256 * 1024;

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const child = execFile(cmd, args, { ...opts }, (error, stdout, stderr) => {
      resolve({
        error,
        stdout: stdout?.toString?.() || "",
        stderr: stderr?.toString?.() || "",
      });
    });

    if (opts.input) {
      child.stdin.write(opts.input);
      child.stdin.end();
    }
  });
}

app.post("/api/avr/compile", async (req, res) => {
  try {
    const { filename, code, mcu, f_cpu, optimize } = req.body || {};

    if (typeof code !== "string" || !code.length) {
      return res.status(400).send('Missing "code".');
    }
    if (code.length > MAX_CODE_SIZE) {
      return res.status(413).send("Code too large.");
    }

    const safeName =
      typeof filename === "string" && filename.match(/^[\w.\-]{1,64}$/)
        ? filename
        : "main.c";

    const MCU =
      typeof mcu === "string" && mcu.trim() ? mcu.trim() : "attiny1624";
    const F_CPU = Number.isFinite(Number(f_cpu)) ? Number(f_cpu) : 20000000;
    const OPT = ["O0", "O1", "O2", "O3", "Os"].includes(optimize)
      ? optimize
      : "Os";

    const tmp = await mkdtemp(path.join(os.tmpdir(), "avr-"));
    const srcPath = path.join(tmp, safeName);
    const elfPath = path.join(tmp, "main.elf");
    const hexPath = path.join(tmp, "main.hex");

    await writeFile(srcPath, code, "utf8");

    // --- XC8 (xc8-cc) ---
    const compileArgs = [
      // для XC8 AVR правильнее использовать -mcpu
      `-mcpu=${MCU}`, // например, "attiny1624"
      `-mdfp=${DFP_PATH}`, // путь к DFP: /opt/microchip/dfp/attiny/xc8
      `-${OPT}`, // O0/O1/O2/O3/Os
      "-Wall",
      "-Wextra",
      `-DF_CPU=${F_CPU}UL`,
      srcPath,
      "-o",
      elfPath,
    ];

    const cc = await run(XC8_CC, compileArgs, { timeout: 20000 });

    if (cc.error) {
      await rm(tmp, { recursive: true, force: true });
      return res.json({
        ok: false,
        stdout: cc.stdout,
        stderr: cc.stderr || String(cc.error),
      });
    }

    // --- ELF -> HEX ---
    const ocArgs = ["-O", "ihex", "-R", ".eeprom", elfPath, hexPath];

    const oc = await run(AVR_OBJCOPY, ocArgs, { timeout: 10000 });

    if (oc.error) {
      await rm(tmp, { recursive: true, force: true });
      return res.json({
        ok: false,
        stdout: oc.stdout,
        stderr: oc.stderr || String(oc.error),
      });
    }

    const hex = await readFile(hexPath, "utf8");
    await rm(tmp, { recursive: true, force: true });

    res.json({
      ok: true,
      hex,
      hex_name: safeName.replace(/\.c$/i, "") + ".hex",
    });
  } catch (e) {
    console.error(e);
    res.status(500).send("Internal error.");
  }
});

app.get("/health", (req, res) => res.send("ok"));

app.listen(PORT, () => {
  console.log(`[avr-compile] listening on :${PORT}`);
});
