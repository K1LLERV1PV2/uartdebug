"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile, spawnSync } = require("node:child_process");

const FILE_LIMIT = 16 * 1024 * 1024;
const WORKSPACE_LIMIT = 64 * 1024 * 1024;
const BWRAP = "/usr/bin/bwrap";
const PRLIMIT = "/usr/bin/prlimit";
const PUBLIC_TOOL_ROOTS = ["/usr", "/opt/microchip/xc8", "/opt/microchip/dfp", "/opt/microchip/xclm"];

function unavailable() {
  const error = new Error("Compiler isolation is unavailable. Contact the site administrator.");
  error.code = "compiler_isolation_unavailable";
  return error;
}

function createCompilerSandbox({ xc8Cc, avrObjcopy, dfpPath }, dependencies = {}) {
  const fileSystem = dependencies.fileSystem || fs;
  const platform = dependencies.platform || process.platform;
  const paths = platform === "linux" ? path.posix : path;
  const tempRoot = dependencies.tempRoot || os.tmpdir();
  const execute = dependencies.execFile || execFile;
  const executeSync = dependencies.spawnSync || spawnSync;
  const now = dependencies.now || Date.now;
  const tools = new Set([xc8Cc, avrObjcopy]);
  let cachedStatus = null;
  let checkedAt = -Infinity;

  const isWithin = (candidate, root) => candidate === root || candidate.startsWith(root + "/");
  const environment = () => ({ PATH: "/usr/local/bin:/usr/bin:/bin", LANG: "C.UTF-8", LC_ALL: "C.UTF-8",
    HOME: "/tmp", TMPDIR: "/tmp", PWD: "/work" });
  const executable = value => {
    fileSystem.accessSync(value, fileSystem.constants.X_OK);
    if (!fileSystem.statSync(value).isFile()) throw unavailable();
  };

  function baseArguments() {
    if (platform !== "linux") throw unavailable();
    executable(BWRAP); executable(PRLIMIT);
    for (const tool of tools) {
      if (!paths.isAbsolute(tool || "")) throw unavailable();
      executable(tool);
      const resolved = fileSystem.realpathSync(tool);
      if (!PUBLIC_TOOL_ROOTS.some(root => fileSystem.existsSync(root) && isWithin(resolved, fileSystem.realpathSync(root)))) throw unavailable();
    }
    const resolvedDfp = fileSystem.realpathSync(dfpPath);
    if (!isWithin(resolvedDfp, fileSystem.realpathSync("/opt/microchip/dfp")) ||
      !fileSystem.statSync(dfpPath).isDirectory()) throw unavailable();
    const args = ["--fsize=" + FILE_LIMIT, "--", BWRAP,
      "--die-with-parent", "--new-session", "--unshare-user", "--unshare-ipc", "--unshare-pid", "--unshare-net", "--unshare-uts",
      "--cap-drop", "ALL", "--ro-bind", "/usr", "/usr"];
    for (const name of ["bin", "lib", "lib64"]) {
      const alias = "/" + name;
      if (!fileSystem.existsSync(alias)) continue;
      const resolved = fileSystem.realpathSync(alias);
      if (isWithin(resolved, "/usr")) args.push("--symlink", resolved.slice(1), alias);
      else args.push("--ro-bind", alias, alias);
    }
    for (const root of PUBLIC_TOOL_ROOTS.slice(1)) {
      if (fileSystem.existsSync(root)) args.push("--ro-bind", root, root);
    }
    args.push("--proc", "/proc", "--remount-ro", "/proc", "--dev", "/dev", "--tmpfs", "/tmp", "--dir", "/work");
    return args;
  }

  function getStatus() {
    if (cachedStatus && now() - checkedAt < 30000) return { ...cachedStatus };
    try {
      const args = baseArguments();
      const probe = executeSync(PRLIMIT, [...args, "--chdir", "/work", "--", "/usr/bin/true"], {
        timeout: 3000, maxBuffer: 4096, env: environment(), encoding: "utf8",
      });
      cachedStatus = { ready: !probe.error && probe.status === 0 };
    } catch { cachedStatus = { ready: false }; }
    checkedAt = now();
    return { ...cachedStatus };
  }

  function invocation(tool, args, options) {
    if (!getStatus().ready || !tools.has(tool)) throw unavailable();
    const cwd = fileSystem.realpathSync(options.cwd || "");
    if (paths.dirname(cwd) !== fileSystem.realpathSync(tempRoot) || !paths.basename(cwd).startsWith("xc8-") ||
      !fileSystem.statSync(cwd).isDirectory()) throw unavailable();
    const rewrite = value => {
      const arg = String(value);
      if (arg === cwd || arg.startsWith(cwd + "/")) return "/work" + arg.slice(cwd.length);
      if (arg === "-I" + cwd || arg.startsWith("-I" + cwd + "/")) return "-I/work" + arg.slice(cwd.length + 2);
      return arg;
    };
    return { command: PRLIMIT, args: [...baseArguments(), "--bind", cwd, "/work", "--chdir", "/work", "--", tool, ...args.map(rewrite)],
      options: { ...options, env: environment(), shell: false, maxBuffer: 1024 * 1024 }, cwd };
  }

  function checkWorkspace(cwd) {
    let total = 0;
    for (const name of fileSystem.readdirSync(cwd)) {
      const entry = fileSystem.lstatSync(paths.join(cwd, name));
      if (!entry.isFile() || entry.isSymbolicLink()) throw new Error("Compiler output contains an unsupported file.");
      total += entry.size;
      if (total > WORKSPACE_LIMIT) throw new Error("Compiler output exceeds the workspace size limit.");
    }
  }

  async function run(tool, args, options = {}) {
    const call = invocation(tool, args, options);
    const result = await new Promise((resolve, reject) => execute(call.command, call.args, call.options, (error, stdout, stderr) => {
      if (error) { error.stdout = stdout; error.stderr = stderr; reject(error); }
      else resolve({ stdout, stderr });
    }));
    checkWorkspace(call.cwd);
    return result;
  }

  return { run, getStatus };
}

// Defence in depth only. The process filesystem boundary remains authoritative.
function canonicalizeProjectSource(value) {
  const source = String(value || "").replace(/\?\?=/g, "#").replace(/\?\?\//g, "\\")
    .replace(/\\[ \t\v\f]*\r?\n/g, "");
  let output = "", quote = "";
  for (let index = 0; index < source.length; index++) {
    const char = source[index], next = source[index + 1];
    if (quote) {
      output += char;
      if (char === "\\" && next) output += source[++index];
      else if (char === quote) quote = "";
    } else if (char === '"' || char === "'") { quote = char; output += char; }
    else if (char === "/" && next === "*") {
      output += " "; index += 2;
      while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) index++;
      index++;
    } else if (char === "/" && next === "/") {
      while (index < source.length && source[index] !== "\n") index++;
      output += "\n";
    } else output += char;
  }
  return output.replace(/%:/g, "#");
}

function usesAssemblerFileDirective(fileName, source) {
  const canonical = canonicalizeProjectSource(source).replace(/"\s*"/g, "");
  const fileDirective = /\.(?:incbin|include)\b/i;
  if (/\.(?:s|asm)$/i.test(fileName)) return fileDirective.test(canonical);
  const identifiers = new Set(["asm", "__asm", "__asm__"]);
  const qualifiers = new Set(["volatile", "__volatile__", "goto"]);
  const identifierEnd = start => {
    let end = start;
    while (end < canonical.length && /[A-Za-z0-9_]/.test(canonical[end])) end++;
    return end;
  };
  const quotedEnd = start => {
    const quote = canonical[start];
    let end = start + 1;
    while (end < canonical.length) {
      if (canonical[end] === "\\") end += 2;
      else if (canonical[end++] === quote) break;
    }
    return end;
  };
  // Each quoted literal or asm context is consumed once, including an
  // unterminated context. A regex search would retry its suffix for every asm.
  let index = 0;
  while (index < canonical.length) {
    const char = canonical[index];
    if (char === '"' || char === "'") { index = quotedEnd(index); continue; }
    if (!/[A-Za-z0-9_]/.test(char)) { index++; continue; }
    const end = identifierEnd(index);
    const identifier = canonical.slice(index, end);
    index = end;
    if (!identifiers.has(identifier)) continue;
    let cursor = end;
    while (cursor < canonical.length) {
      while (cursor < canonical.length && /\s/.test(canonical[cursor])) cursor++;
      if (canonical[cursor] === "(") break;
      const next = identifierEnd(cursor);
      if (next === cursor || !qualifiers.has(canonical.slice(cursor, next))) break;
      cursor = next;
    }
    index = cursor;
    if (canonical[cursor] !== "(") continue;
    const start = ++cursor;
    let depth = 1;
    while (cursor < canonical.length && depth > 0) {
      const token = canonical[cursor];
      if (token === '"' || token === "'") { cursor = quotedEnd(cursor); continue; }
      if (token === "(") depth++;
      else if (token === ")") depth--;
      cursor++;
    }
    if (fileDirective.test(canonical.slice(start, depth ? cursor : cursor - 1))) return true;
    index = cursor;
  }
  return false;
}

module.exports = { createCompilerSandbox, canonicalizeProjectSource, usesAssemblerFileDirective, FILE_LIMIT, WORKSPACE_LIMIT };
