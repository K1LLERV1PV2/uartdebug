// compile-server.js
// Receives C code and returns an AVR HEX file built with Microchip XC8.

const express = require("express");
const { mkdtemp, writeFile, readFile, rm } = require("fs/promises");
const fs = require("fs");
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

// Keep the legacy port so existing nginx configuration keeps working.
const PORT = process.env.PORT || 8082;
const HOST = process.env.HOST || process.env.BIND_HOST || "127.0.0.1";
const ALLOWED_ORIGINS = new Set(
  String(process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
);
const COMPILE_SERVER_VERSION = "20260617-security-hardening-v1";
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
const SUPPORTED_MCUS = new Set([
  "attiny402",
  "attiny404",
  "attiny406",
  "attiny412",
  "attiny414",
  "attiny416",
  "attiny417",
  "attiny424",
  "attiny426",
  "attiny427",
  "attiny804",
  "attiny806",
  "attiny807",
  "attiny814",
  "attiny816",
  "attiny817",
  "attiny824",
  "attiny826",
  "attiny827",
  "attiny1604",
  "attiny1606",
  "attiny1607",
  "attiny1614",
  "attiny1616",
  "attiny1617",
  "attiny1624",
  "attiny1626",
  "attiny1627",
  "attiny3216",
  "attiny3217",
  "attiny3224",
  "attiny3226",
  "attiny3227",
]);

// Tool paths can be overridden through environment variables.
const XC8_CC = resolveTool("XC8_CC", "xc8-cc");
const AVR_OBJCOPY = resolveTool("AVR_OBJCOPY", "avr-objcopy");
// Default ATtiny DFP path.
const DFP_PATH = process.env.XC8_DFP || "/opt/microchip/dfp/attiny/xc8";

function isExecutable(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function getPathTool(toolName) {
  const pathDirs = String(process.env.PATH || "")
    .split(path.delimiter)
    .filter(Boolean);

  for (const dir of pathDirs) {
    const candidate = path.join(dir, toolName);
    if (isExecutable(candidate)) return candidate;
  }

  return "";
}

function getXc8InstallCandidates(toolName) {
  const candidates = [];
  const roots = ["/opt/microchip/xc8", "/Applications/microchip/xc8"];

  for (const root of roots) {
    try {
      for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const versionDir = path.join(root, entry.name);
        candidates.push(path.join(versionDir, "bin", toolName));
        candidates.push(path.join(versionDir, "avr", "bin", toolName));
      }
    } catch {}
  }

  candidates.push(path.join("/opt/microchip/xc8", "bin", toolName));
  candidates.push(path.join("/usr/local/bin", toolName));
  candidates.push(path.join("/usr/bin", toolName));
  return candidates;
}

function resolveTool(envName, toolName) {
  const configured = String(process.env[envName] || "").trim();
  if (configured) return configured;

  const fromPath = getPathTool(toolName);
  if (fromPath) return fromPath;

  return getXc8InstallCandidates(toolName).find(isExecutable) || toolName;
}

app.disable("x-powered-by");

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
  );
  next();
});

app.use(express.json({ limit: "1mb" }));

app.use((err, req, res, next) => {
  if (err && err.type === "entity.too.large") {
    return res.status(413).json({
      ok: false,
      compile_server_version: COMPILE_SERVER_VERSION,
      stage: "request",
      stderr: "Request body is too large.",
    });
  }

  if (
    err instanceof SyntaxError &&
    Object.prototype.hasOwnProperty.call(err, "body")
  ) {
    return res.status(400).json({
      ok: false,
      compile_server_version: COMPILE_SERVER_VERSION,
      stage: "request",
      stderr: "Invalid JSON request body.",
    });
  }

  return next(err);
});

function rejectCrossSiteApiRequests(req, res, next) {
  const fetchSite = String(req.get("sec-fetch-site") || "").toLowerCase();
  if (fetchSite === "cross-site") {
    return res.status(403).json({
      ok: false,
      compile_server_version: COMPILE_SERVER_VERSION,
      stage: "request",
      stderr: "Cross-site API requests are not allowed.",
    });
  }

  const origin = String(req.get("origin") || "").trim();
  if (!origin || isAllowedOrigin(origin, req)) {
    return next();
  }

  return res.status(403).json({
    ok: false,
    compile_server_version: COMPILE_SERVER_VERSION,
    stage: "request",
    stderr: "Origin is not allowed.",
  });
}

function isAllowedOrigin(origin, req) {
  if (ALLOWED_ORIGINS.has(origin)) return true;

  try {
    const originUrl = new URL(origin);
    const forwardedHost = String(req.get("x-forwarded-host") || "").trim();
    const host = forwardedHost || String(req.get("host") || "").trim();
    return !!host && originUrl.host === host;
  } catch {
    return false;
  }
}

function requireJsonRequest(req, res, next) {
  if (!req.is("application/json")) {
    return res.status(415).json({
      ok: false,
      compile_server_version: COMPILE_SERVER_VERSION,
      stage: "request",
      stderr: "Content-Type must be application/json.",
    });
  }

  return next();
}

app.use("/api/", rejectCrossSiteApiRequests);

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const childCwd = opts.cwd || process.cwd();
    const execOpts = {
      ...opts,
      env: buildChildEnv(childCwd, opts.env),
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

function buildChildEnv(childCwd, extraEnv = {}) {
  const env = {};

  for (const [name, value] of Object.entries(process.env)) {
    if (isSensitiveEnvName(name)) continue;
    env[name] = value;
  }

  return {
    ...env,
    ...extraEnv,
    PWD: childCwd,
    OLDPWD: childCwd,
  };
}

function isSensitiveEnvName(name) {
  return /(?:TOKEN|SECRET|PASSWORD|PASS|PRIVATE|CREDENTIAL|AUTH|API_?KEY|ACCESS_?KEY)/i.test(
    String(name || "")
  );
}

function getRunErrorDetails(err, toolName, tmpDir = "") {
  let error = err && err.message ? err.message : String(err || "");
  if (err && err.code === "ENOENT" && toolName) {
    const envName = toolName === AVR_OBJCOPY ? "AVR_OBJCOPY" : "XC8_CC";
    error = `${getToolLabel(toolName)} executable was not found. Install Microchip XC8 on the server or set the ${envName} environment variable.`;
  }

  return {
    stdout: sanitizeTextForResponse(err && err.stdout ? err.stdout : "", tmpDir),
    stderr: sanitizeTextForResponse(err && err.stderr ? err.stderr : "", tmpDir),
    error: sanitizeTextForResponse(error, tmpDir),
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

function getToolLabel(toolPath) {
  const label = path.basename(String(toolPath || ""));
  return label || String(toolPath || "");
}

function getDisplayPath(value, tmpDir = "") {
  const text = String(value);
  const normalizedTmp = tmpDir ? path.resolve(tmpDir) : "";

  if (normalizedTmp) {
    const normalizedArg = path.resolve(text);
    if (
      normalizedArg === normalizedTmp ||
      normalizedArg.startsWith(normalizedTmp + path.sep)
    ) {
      return path
        .join("<tmp>", path.relative(normalizedTmp, normalizedArg))
        .replace(/\\/g, "/");
    }
  }

  if (text === DFP_PATH) return "<xc8-dfp>";
  return text;
}

function getDisplayArg(arg, tmpDir = "") {
  const text = String(arg);

  if (text.startsWith("-I")) {
    const includePath = text.slice(2);
    return `-I${getDisplayPath(includePath, tmpDir)}`;
  }

  const displayPath = getDisplayPath(text, tmpDir);
  if (displayPath !== text) return displayPath;

  if (text === `-mdfp=${DFP_PATH}`) return "-mdfp=<xc8-dfp>";
  return text;
}

function getDisplayCommand(toolPath, args, tmpDir = "") {
  return [
    getToolLabel(toolPath),
    ...args.map((arg) => getDisplayArg(arg, tmpDir)),
  ]
    .map(shellQuote)
    .join(" ");
}

function sanitizeTextForResponse(value, tmpDir = "") {
  let text = String(value || "");
  const replacements = [
    [tmpDir ? path.resolve(tmpDir) : "", "<tmp>"],
    [DFP_PATH, "<xc8-dfp>"],
    [XC8_CC, getToolLabel(XC8_CC)],
    [AVR_OBJCOPY, getToolLabel(AVR_OBJCOPY)],
  ];

  for (const [needle, replacement] of replacements) {
    if (!needle) continue;
    text = text.split(needle).join(replacement);
  }

  return text;
}

function normalizeMcu(rawMcu) {
  const mcu =
    typeof rawMcu === "string" && rawMcu.trim().length > 0
      ? rawMcu.trim().toLowerCase()
      : "attiny1624";

  return SUPPORTED_MCUS.has(mcu) ? mcu : "";
}

function normalizeIncludePath(includePath) {
  return String(includePath || "").trim().replace(/\\/g, "/");
}

function isUnsafeIncludePath(includePath) {
  const normalized = normalizeIncludePath(includePath);
  if (!normalized) return true;
  if (normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized)) return true;
  return normalized.split("/").includes("..");
}

function findUnsafeInclude(sourceText) {
  const includeDirective = /^\s*#\s*(?:include|include_next|import)\s+(.+)$/gm;
  const asmIncludeDirective = /^\s*\.include\s+["']([^"']+)["']/gim;
  let match;

  while ((match = includeDirective.exec(sourceText || ""))) {
    const operand = String(match[1] || "").trim();
    const pathMatch = operand.match(/^([<"])([^>"]+)[>"]/);
    if (!pathMatch) {
      return operand || "<macro include>";
    }
    if (isUnsafeIncludePath(pathMatch[2])) return pathMatch[2];
  }

  while ((match = asmIncludeDirective.exec(sourceText || ""))) {
    if (isUnsafeIncludePath(match[1])) return match[1];
  }

  return "";
}

function assertSafeProjectSource(fileName, content) {
  const unsafeInclude = findUnsafeInclude(content);
  if (!unsafeInclude) return;

  throw new Error(
    `File "${fileName}" uses disallowed include path "${unsafeInclude}". Use project file names or compiler-provided headers only.`
  );
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
    assertSafeProjectSource(safeName, content);

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
  assertSafeProjectSource(entryName, normalizedEntryCode);
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

app.post("/api/avr/compile", requireJsonRequest, async (req, res) => {
  let tmp = "";

  try {
    const { filename, code, mcu, optimize, project_files } = req.body || {};

    if (typeof code !== "string" || !code.length) {
      return res.status(400).send('Missing "code".');
    }
    if (code.length > MAX_CODE_SIZE) {
      return res.status(413).send("Code too large.");
    }

    const safeName = normalizeProjectFileName(filename) || "main.c";

    const MCU = normalizeMcu(mcu);
    if (!MCU) {
      return res.status(400).json({
        ok: false,
        compile_server_version: COMPILE_SERVER_VERSION,
        stage: "request",
        stderr: "Unsupported MCU target.",
      });
    }

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

    // XC8 for AVR expects -mcpu=<device> and -mdfp=<dfp-path>.
    const commonCompileArgs = [
      `-mcpu=${MCU}`,
      `-mdfp=${DFP_PATH}`,
      `-${OPT}`,
      "-Wall",
      "-Wextra",
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
      const cmd = getDisplayCommand(XC8_CC, args, tmp);
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
          compiler: getToolLabel(XC8_CC),
          failed_file: file.sourceName,
          cmd,
          commands: compileCommands,
          compiled_files: compilePlan.compileSourceNames,
          project_files: compilePlan.requiredFiles,
          ...getRunErrorDetails(err, XC8_CC, tmp),
        });
      }
    }

    const linkArgs = [
      ...linkArgsBase,
      ...objectFiles.map((file) => file.objectPath),
      "-o",
      elfPath,
    ];
    const linkCommand = getDisplayCommand(XC8_CC, linkArgs, tmp);
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
        compiler: getToolLabel(XC8_CC),
        cmd: linkCommand,
        commands: compileCommands,
        compiled_files: compilePlan.compileSourceNames,
        project_files: compilePlan.requiredFiles,
        ...getRunErrorDetails(err, XC8_CC, tmp),
      });
    }

    const objcopyArgs = ["-O", "ihex", elfPath, hexPath];

    try {
      await run(AVR_OBJCOPY, objcopyArgs, { timeout: 10000, cwd: tmp });
    } catch (err) {
      await rm(tmp, { recursive: true, force: true });
      return res.status(400).json({
        ok: false,
        compile_server_version: COMPILE_SERVER_VERSION,
        stage: "objcopy",
        tool: getToolLabel(AVR_OBJCOPY),
        cmd: getDisplayCommand(AVR_OBJCOPY, objcopyArgs, tmp),
        compiled_files: compilePlan.compileSourceNames,
        project_files: compilePlan.requiredFiles,
        ...getRunErrorDetails(err, AVR_OBJCOPY, tmp),
      });
    }

    const hex = await readFile(hexPath, "utf8");
    await rm(tmp, { recursive: true, force: true });

    res.json({
      ok: true,
      compile_server_version: COMPILE_SERVER_VERSION,
      hex,
      hex_name: safeName.replace(/\.c$/i, "") + ".hex",
      compiler: getToolLabel(XC8_CC),
      mcu: MCU,
      optimize: OPT,
      compiled_files: compilePlan.compileSourceNames,
      project_files: compilePlan.requiredFiles,
      compile_stdout: sanitizeTextForResponse(compileStdout, tmp),
      compile_stderr: sanitizeTextForResponse(compileStderr, tmp),
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
  res.type("text/plain").send(`ok ${COMPILE_SERVER_VERSION}\n`)
);

app.listen(PORT, HOST, () => {
  console.log(
    `[xc8-compile] ${COMPILE_SERVER_VERSION} listening on ${HOST}:${PORT}`
  );
  console.log(`[xc8-compile] cwd=${process.cwd()} script=${__filename}`);
  console.log(`[xc8-compile] XC8_CC=${XC8_CC}`);
  console.log(`[xc8-compile] AVR_OBJCOPY=${AVR_OBJCOPY}`);
  console.log(`[xc8-compile] XC8_DFP=${DFP_PATH}`);
});
