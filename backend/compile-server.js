// compile-server.js
// Сервис, который принимает C-код и возвращает HEX,
// собирая всё через Microchip XC8 (xc8-cc) для AVR.

const express = require("express");
const { mkdtemp, writeFile, readFile, rm } = require("fs/promises");
const path = require("path");
const os = require("os");
const { execFile } = require("child_process");

const app = express();
const SERVER_CWD = __dirname;

try {
  process.chdir(SERVER_CWD);
} catch (error) {
  console.warn(
    `[xc8-compile] failed to switch cwd to ${SERVER_CWD}: ${error.message}`
  );
}

// Порт как в старой версии, чтобы совпало с nginx-конфигом
const PORT = process.env.PORT || 8082;
const HOST = process.env.HOST || process.env.BIND_HOST || "127.0.0.1";
const COMPILE_SERVER_VERSION = "20260514-multifile-v2";
const MAX_CODE_SIZE = 64 * 1024;
const MAX_PROJECT_SIZE = 512 * 1024;
const MAX_PROJECT_FILES = 64;
const PROJECT_FILE_EXTENSIONS = new Set([
  "c",
  "h",
  "cpp",
  "cc",
  "hpp",
  "ino",
  "s",
  "asm",
  "txt",
]);
const C_SOURCE_EXTENSIONS = new Set(["c"]);
const HEADER_EXTENSIONS = new Set(["h", "hpp"]);

// Пути к тулзам — можно переопределить переменными окружения
const XC8_CC = process.env.XC8_CC || "xc8-cc";
const AVR_OBJCOPY = process.env.AVR_OBJCOPY || "avr-objcopy";
// Путь к DFP для ATtiny (мы распаковывали его сюда)
const DFP_PATH = process.env.XC8_DFP || "/opt/microchip/dfp/attiny/xc8";

app.use(express.json({ limit: "1mb" }));

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const childCwd = opts.cwd || process.cwd();
    const execOpts = {
      ...opts,
      env: {
        ...process.env,
        ...opts.env,
        PWD: childCwd,
        OLDPWD: childCwd,
      },
    };

    execFile(cmd, args, execOpts, (err, stdout, stderr) => {
      if (err) {
        err.stdout = stdout;
        err.stderr = stderr;
        return reject(err);
      }
      resolve({ stdout, stderr });
    });
  });
}

function getRunErrorDetails(err) {
  return {
    stdout: (err && err.stdout ? err.stdout : "").toString(),
    stderr: (err && err.stderr ? err.stderr : "").toString(),
    error: err && err.message ? err.message : String(err || ""),
    exit_code: err && Object.prototype.hasOwnProperty.call(err, "code")
      ? err.code
      : null,
    signal: err && err.signal ? err.signal : null,
    killed: !!(err && err.killed),
  };
}

function getFileExtension(fileName) {
  const lastDot = typeof fileName === "string" ? fileName.lastIndexOf(".") : -1;
  return lastDot > -1 ? fileName.slice(lastDot + 1).toLowerCase() : "";
}

function getFileStem(fileName) {
  const lastDot = typeof fileName === "string" ? fileName.lastIndexOf(".") : -1;
  return lastDot > 0 ? fileName.slice(0, lastDot) : fileName;
}

function normalizeProjectFileName(fileName) {
  const name = String(fileName || "").trim();
  if (!name || name === "." || name === "..") return "";
  if (name.length > 96) return "";
  if (/[\\/:*?"<>|\x00-\x1f]/.test(name)) return "";
  if (!PROJECT_FILE_EXTENSIONS.has(getFileExtension(name))) return "";
  return name;
}

function shellQuote(value) {
  const text = String(value);
  return /^[A-Za-z0-9_./:=+-]+$/.test(text)
    ? text
    : `"${text.replace(/(["\\$`])/g, "\\$1")}"`;
}

function normalizeProjectFiles(rawFiles, entryName, entryCode) {
  const projectFiles = new Map();
  let totalSize = 0;

  const addFile = (rawName, rawContent) => {
    const safeName = normalizeProjectFileName(rawName);
    if (!safeName || projectFiles.has(safeName)) return;

    const content = String(rawContent || "").replace(/\r\n/g, "\n");
    if (content.length > MAX_CODE_SIZE) {
      throw new Error(`File "${safeName}" is too large.`);
    }

    totalSize += content.length;
    if (totalSize > MAX_PROJECT_SIZE) {
      throw new Error("Project is too large.");
    }
    if (projectFiles.size >= MAX_PROJECT_FILES) {
      throw new Error("Project has too many files.");
    }

    projectFiles.set(safeName, content);
  };

  if (rawFiles && typeof rawFiles === "object") {
    if (Array.isArray(rawFiles)) {
      for (const item of rawFiles) {
        if (!item || typeof item !== "object") continue;
        addFile(item.name, item.content);
      }
    } else {
      for (const [name, content] of Object.entries(rawFiles)) {
        addFile(name, content);
      }
    }
  }

  const normalizedEntryCode = String(entryCode || "").replace(/\r\n/g, "\n");
  const previousEntryCode = projectFiles.get(entryName);
  if (previousEntryCode == null) {
    totalSize += normalizedEntryCode.length;
    if (totalSize > MAX_PROJECT_SIZE) {
      throw new Error("Project is too large.");
    }
    if (projectFiles.size >= MAX_PROJECT_FILES) {
      throw new Error("Project has too many files.");
    }
  } else {
    totalSize += normalizedEntryCode.length - previousEntryCode.length;
    if (totalSize > MAX_PROJECT_SIZE) {
      throw new Error("Project is too large.");
    }
  }

  projectFiles.set(entryName, normalizedEntryCode);
  return projectFiles;
}

function extractQuotedIncludes(sourceText) {
  const includes = [];
  const includePattern = /^\s*#\s*include\s*"([^"]+)"/gm;
  let match;

  while ((match = includePattern.exec(sourceText || ""))) {
    const includeName = String(match[1] || "").trim();
    if (includeName) includes.push(includeName);
  }

  return includes;
}

function resolveProjectIncludeName(includeName, projectFiles) {
  const normalized = normalizeProjectFileName(includeName);
  if (normalized && projectFiles.has(normalized)) return normalized;

  const baseName = path.basename(String(includeName || "").replace(/\\/g, "/"));
  const normalizedBase = normalizeProjectFileName(baseName);
  return normalizedBase && projectFiles.has(normalizedBase)
    ? normalizedBase
    : "";
}

function getHeaderCompanionSource(fileName, projectFiles) {
  if (!HEADER_EXTENSIONS.has(getFileExtension(fileName))) return "";

  const candidate = `${getFileStem(fileName)}.c`;
  return projectFiles.has(candidate) ? candidate : "";
}

function buildCompilePlan(entryName, projectFiles) {
  const visited = new Set();
  const requiredFiles = new Set();
  const textualSourceIncludes = new Set();

  const visit = (fileName, includedTextually = false) => {
    if (!fileName || !projectFiles.has(fileName)) return;

    if (
      includedTextually &&
      C_SOURCE_EXTENSIONS.has(getFileExtension(fileName))
    ) {
      textualSourceIncludes.add(fileName);
    }

    if (visited.has(fileName)) return;
    visited.add(fileName);
    requiredFiles.add(fileName);

    const sourceText = projectFiles.get(fileName) || "";
    for (const includeName of extractQuotedIncludes(sourceText)) {
      const resolved = resolveProjectIncludeName(includeName, projectFiles);
      if (resolved) visit(resolved, true);
    }

    const companionSource = getHeaderCompanionSource(fileName, projectFiles);
    if (companionSource) visit(companionSource, false);
  };

  visit(entryName, false);

  const compileSourceNames = [entryName];
  for (const fileName of requiredFiles) {
    if (fileName === entryName) continue;
    if (!C_SOURCE_EXTENSIONS.has(getFileExtension(fileName))) continue;
    if (textualSourceIncludes.has(fileName)) continue;
    compileSourceNames.push(fileName);
  }

  return {
    requiredFiles: [...requiredFiles],
    compileSourceNames,
  };
}

app.post("/api/avr/compile", async (req, res) => {
  let tmp = "";

  try {
    const { filename, code, mcu, f_cpu, optimize, project_files } =
      req.body || {};

    if (typeof code !== "string" || !code.length) {
      return res.status(400).send('Missing "code".');
    }
    if (code.length > MAX_CODE_SIZE) {
      return res.status(413).send("Code too large.");
    }

    const safeName = normalizeProjectFileName(filename) || "main.c";

    const MCU =
      typeof mcu === "string" && mcu.trim().length > 0
        ? mcu.trim()
        : "attiny1624";

    const fCpuNum = Number(f_cpu);
    const F_CPU = Number.isFinite(fCpuNum) && fCpuNum > 0 ? fCpuNum : 20000000;

    const requestedOptimize =
      typeof optimize === "string" ? optimize.trim() : "";
    const OPT = ["O0", "O1", "O2", "O3"].includes(requestedOptimize)
      ? requestedOptimize
      : "O1";

    let projectFiles;
    try {
      projectFiles = normalizeProjectFiles(project_files, safeName, code);
    } catch (error) {
      return res.status(400).json({
        ok: false,
        compile_server_version: COMPILE_SERVER_VERSION,
        stage: "project",
        stderr: error.message || String(error),
      });
    }

    const compilePlan = buildCompilePlan(safeName, projectFiles);
    tmp = await mkdtemp(path.join(os.tmpdir(), "xc8-"));
    const elfPath = path.join(tmp, "main.elf");
    const hexPath = path.join(tmp, "main.hex");

    for (const [fileName, content] of projectFiles) {
      await writeFile(path.join(tmp, fileName), content, "utf8");
    }

    // --- Компиляция xc8-cc ---
    // По мануалу для AVR-версии XC8 нужно:
    //   xc8-cc -mcpu=<device> -mdfp=<путь-к-dfp> ... :contentReference[oaicite:0]{index=0}
    const commonCompileArgs = [
      `-mcpu=${MCU}`,
      `-mdfp=${DFP_PATH}`,
      `-${OPT}`,
      "-Wall",
      "-Wextra",
      `-DF_CPU=${F_CPU}UL`,
      `-I${tmp}`,
    ];

    const linkArgsBase = [`-mcpu=${MCU}`, `-mdfp=${DFP_PATH}`, `-${OPT}`];
    const objectFiles = compilePlan.compileSourceNames.map((name, index) => {
      const stem = getFileStem(name).replace(/[^A-Za-z0-9_.-]/g, "_");
      return {
        sourceName: name,
        sourcePath: path.join(tmp, name),
        objectPath: path.join(tmp, `${index + 1}-${stem}.o`),
      };
    });

    const compileCommands = [];
    let compileStdout = "";
    let compileStderr = "";

    for (const file of objectFiles) {
      const args = [
        ...commonCompileArgs,
        "-c",
        file.sourcePath,
        "-o",
        file.objectPath,
      ];
      const cmd = [XC8_CC, ...args].map(shellQuote).join(" ");
      compileCommands.push(cmd);

      try {
        const result = await run(XC8_CC, args, {
          timeout: 20000,
          cwd: tmp,
        });
        compileStdout += result.stdout.toString();
        compileStderr += result.stderr.toString();
      } catch (err) {
        await rm(tmp, { recursive: true, force: true });
        return res.status(400).json({
          ok: false,
          compile_server_version: COMPILE_SERVER_VERSION,
          stage: "compile",
          compiler: XC8_CC,
          failed_file: file.sourceName,
          cmd,
          commands: compileCommands,
          compiled_files: compilePlan.compileSourceNames,
          project_files: compilePlan.requiredFiles,
          ...getRunErrorDetails(err),
        });
      }
    }

    const linkArgs = [
      ...linkArgsBase,
      ...objectFiles.map((file) => file.objectPath),
      "-o",
      elfPath,
    ];
    const linkCommand = [XC8_CC, ...linkArgs].map(shellQuote).join(" ");
    compileCommands.push(linkCommand);

    try {
      const result = await run(XC8_CC, linkArgs, {
        timeout: 20000,
        cwd: tmp,
      });
      compileStdout += result.stdout.toString();
      compileStderr += result.stderr.toString();
    } catch (err) {
      await rm(tmp, { recursive: true, force: true });
      return res.status(400).json({
        ok: false,
        compile_server_version: COMPILE_SERVER_VERSION,
        stage: "link",
        compiler: XC8_CC,
        cmd: linkCommand,
        commands: compileCommands,
        compiled_files: compilePlan.compileSourceNames,
        project_files: compilePlan.requiredFiles,
        ...getRunErrorDetails(err),
      });
    }

    // --- ELF -> HEX ---
    const objcopyArgs = ["-O", "ihex", elfPath, hexPath];

    try {
      await run(AVR_OBJCOPY, objcopyArgs, { timeout: 10000, cwd: tmp });
    } catch (err) {
      await rm(tmp, { recursive: true, force: true });
      return res.status(400).json({
        ok: false,
        compile_server_version: COMPILE_SERVER_VERSION,
        stage: "objcopy",
        tool: AVR_OBJCOPY,
        cmd: [AVR_OBJCOPY, ...objcopyArgs].map(shellQuote).join(" "),
        compiled_files: compilePlan.compileSourceNames,
        project_files: compilePlan.requiredFiles,
        ...getRunErrorDetails(err),
      });
    }

    const hex = await readFile(hexPath, "utf8");
    await rm(tmp, { recursive: true, force: true });

    res.json({
      ok: true,
      compile_server_version: COMPILE_SERVER_VERSION,
      hex,
      hex_name: safeName.replace(/\.c$/i, "") + ".hex",
      compiler: XC8_CC,
      mcu: MCU,
      f_cpu: F_CPU,
      optimize: OPT,
      compiled_files: compilePlan.compileSourceNames,
      project_files: compilePlan.requiredFiles,
      compile_stdout: compileStdout,
      compile_stderr: compileStderr,
    });
  } catch (e) {
    if (tmp) {
      try {
        await rm(tmp, { recursive: true, force: true });
      } catch {}
    }

    console.error(e);
    res.status(500).send("Internal error.");
  }
});

app.get("/health", (req, res) =>
  res.type("text/plain").send(`ok ${COMPILE_SERVER_VERSION}`)
);

app.listen(PORT, HOST, () => {
  console.log(
    `[xc8-compile] ${COMPILE_SERVER_VERSION} listening on ${HOST}:${PORT}`
  );
  console.log(`[xc8-compile] cwd=${process.cwd()} script=${__filename}`);
});
