// compile-server.js
// Сервис, который принимает C-код и возвращает HEX,
// собирая всё через Microchip XC8 (xc8-cc) для AVR.

const express = require("express");
const { mkdtemp, writeFile, readFile, rm } = require("fs/promises");
const path = require("path");
const os = require("os");
const { execFile } = require("child_process");

const app = express();

// Порт как в старой версии, чтобы совпало с nginx-конфигом
const PORT = process.env.PORT || 8082;
const MAX_CODE_SIZE = 64 * 1024;

// Пути к тулзам — можно переопределить переменными окружения
const XC8_CC = process.env.XC8_CC || "xc8-cc";
const AVR_OBJCOPY = process.env.AVR_OBJCOPY || "avr-objcopy";
// Путь к DFP для ATtiny (мы распаковывали его сюда)
const DFP_PATH = process.env.XC8_DFP || "/opt/microchip/dfp/attiny/xc8";

app.use(express.json({ limit: "512kb" }));

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, opts, (err, stdout, stderr) => {
      if (err) {
        err.stdout = stdout;
        err.stderr = stderr;
        return reject(err);
      }
      resolve({ stdout, stderr });
    });
  });
}

// Маршрут — как в c-canvas.js
app.post("/api/avr", async (req, res) => {
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
      typeof mcu === "string" && mcu.trim().length > 0
        ? mcu.trim()
        : "attiny1624";

    const fCpuNum = Number(f_cpu);
    const F_CPU = Number.isFinite(fCpuNum) && fCpuNum > 0 ? fCpuNum : 20000000;

    const OPT = ["O0", "O1", "O2", "O3", "Os"].includes(optimize)
      ? optimize
      : "Os";

    const tmp = await mkdtemp(path.join(os.tmpdir(), "xc8-"));
    const srcPath = path.join(tmp, safeName);
    const elfPath = path.join(tmp, "main.elf");
    const hexPath = path.join(tmp, "main.hex");

    await writeFile(srcPath, code, "utf8");

    // --- Компиляция xc8-cc ---
    // По мануалу для AVR-версии XC8 нужно:
    //   xc8-cc -mcpu=<device> -mdfp=<путь-к-dfp> ... :contentReference[oaicite:0]{index=0}
    const compileArgs = [
      `-mcpu=${MCU}`,
      `-mdfp=${DFP_PATH}`,
      `-${OPT}`,
      "-Wall",
      "-Wextra",
      `-DF_CPU=${F_CPU}UL`,
      srcPath,
      "-o",
      elfPath,
    ];

    let compileResult;
    try {
      compileResult = await run(XC8_CC, compileArgs, {
        timeout: 20000,
      });
    } catch (err) {
      await rm(tmp, { recursive: true, force: true });
      return res.status(400).json({
        ok: false,
        stage: "compile",
        compiler: XC8_CC,
        cmd: `${XC8_CC} ${compileArgs.join(" ")}`,
        stdout: (err.stdout || "").toString(),
        stderr: (err.stderr || "").toString(),
      });
    }

    // --- ELF -> HEX ---
    const objcopyArgs = ["-O", "ihex", elfPath, hexPath];

    try {
      await run(AVR_OBJCOPY, objcopyArgs, { timeout: 10000 });
    } catch (err) {
      await rm(tmp, { recursive: true, force: true });
      return res.status(400).json({
        ok: false,
        stage: "objcopy",
        tool: AVR_OBJCOPY,
        cmd: `${AVR_OBJCOPY} ${objcopyArgs.join(" ")}`,
        stdout: (err.stdout || "").toString(),
        stderr: (err.stderr || "").toString(),
      });
    }

    const hex = await readFile(hexPath, "utf8");
    await rm(tmp, { recursive: true, force: true });

    res.json({
      ok: true,
      hex,
      hex_name: safeName.replace(/\.c$/i, "") + ".hex",
      compiler: XC8_CC,
      mcu: MCU,
      f_cpu: F_CPU,
      optimize: OPT,
      compile_stdout: compileResult.stdout.toString(),
      compile_stderr: compileResult.stderr.toString(),
    });
  } catch (e) {
    console.error(e);
    res.status(500).send("Internal error.");
  }
});

app.get("/health", (req, res) => res.send("ok"));

app.listen(PORT, () => {
  console.log(`[xc8-compile] listening on :${PORT}`);
});
