"use strict";

const assert = require("node:assert/strict");
const net = require("node:net");
const path = require("node:path");
const fs = require("node:fs");
const vm = require("node:vm");
const { spawn } = require("node:child_process");
const test = require("node:test");
const { createCompilerSandbox, canonicalizeProjectSource, usesAssemblerFileDirective, FILE_LIMIT, WORKSPACE_LIMIT } = require("../backend/compile-sandbox");

const config = { xc8Cc: "/opt/microchip/xc8/v3/bin/xc8-cc", avrObjcopy: "/usr/bin/avr-objcopy", dfpPath: "/opt/microchip/dfp/attiny/xc8" };
function harness({ probeStatus = 0, missing = "", oversized = false, symlink = false, platform = "linux" } = {}) {
  const probes = [], calls = [];
  const roots = new Set(["/usr", "/bin", "/lib", "/lib64", "/opt/microchip/xc8", "/opt/microchip/dfp", "/opt/microchip/xclm"]);
  const aliases = { "/bin": "/usr/bin", "/lib": "/usr/lib", "/lib64": "/usr/lib64" };
  const fileSystem = {
    constants: { X_OK: 1 },
    accessSync(value) { if (value === missing) throw new Error("Missing executable"); },
    existsSync: value => roots.has(value) && value !== missing,
    realpathSync: value => aliases[value] || value,
    statSync: value => ({ isFile: () => value !== config.dfpPath && !value.startsWith("/tmp"),
      isDirectory: () => value === config.dfpPath || value.startsWith("/tmp/xc8-") }),
    readdirSync: () => ["main.c", "main.o"],
    lstatSync: value => ({ isFile: () => true, isSymbolicLink: () => symlink,
      size: oversized && value.endsWith("main.o") ? WORKSPACE_LIMIT + 1 : 32 }),
  };
  const sandbox = createCompilerSandbox(config, { fileSystem, platform, tempRoot: "/tmp",
    spawnSync(command, args, options) { probes.push({ command, args, options }); return { status: probeStatus }; },
    execFile(command, args, options, callback) { calls.push({ command, args, options }); callback(null, "compiled", ""); },
  });
  return { sandbox, probes, calls };
}

test("compiler commands see one request workspace, public read-only tools, no host secrets and no shell", async () => {
  const { sandbox, probes, calls } = harness();
  assert.equal(sandbox.getStatus().ready, true);
  await sandbox.run(config.xc8Cc, ["-I/tmp/xc8-test", "/tmp/xc8-test/main.c", "-o", "/tmp/xc8-test/main.o"], {
    cwd: "/tmp/xc8-test", timeout: 20000, shell: true, env: { OPENAI_API_KEY: "never-pass-this", CUSTOM_SECRET: "also-private" },
  });
  assert.equal(probes.length, 1, "the usable namespace probe is cached");
  assert.deepEqual(probes[0].args.slice(-4), ["--chdir", "/work", "--", "/usr/bin/true"]);
  const call = calls[0];
  assert.equal(call.command, "/usr/bin/prlimit");
  assert.equal(call.options.shell, false);
  assert.equal(call.options.maxBuffer, 1024 * 1024);
  assert.equal(call.options.timeout, 20000);
  assert.deepEqual(call.args.slice(-4), ["-I/work", "/work/main.c", "-o", "/work/main.o"]);
  assert.ok(call.args.includes("--fsize=" + FILE_LIMIT));
  for (const flag of ["--unshare-user", "--unshare-pid", "--unshare-net", "--unshare-ipc", "--unshare-uts", "--die-with-parent", "--new-session"]) assert.ok(call.args.includes(flag));
  assert.equal(call.args[call.args.indexOf("--remount-ro") + 1], "/proc");
  assert.ok(call.args.includes("/usr"));
  assert.ok(!call.args.some(value => ["/etc", "/home", "/var", "/run", "/var/lib/uartdebug-ai", "/"].includes(value)));
  assert.deepEqual(Object.keys(call.options.env).sort(), ["HOME", "LANG", "LC_ALL", "PATH", "PWD", "TMPDIR"]);
  assert.equal(JSON.stringify(call).includes("never-pass-this"), false);
});

test("missing isolation or denied namespaces never execute a compiler", async () => {
  for (const options of [{ probeStatus: 1 }, { missing: "/usr/bin/bwrap" }, { missing: "/usr/bin/prlimit" }, { platform: "win32" }]) {
    const { sandbox, calls } = harness(options);
    assert.equal(sandbox.getStatus().ready, false);
    await assert.rejects(sandbox.run(config.xc8Cc, [], { cwd: "/tmp/xc8-test" }), error => error.code === "compiler_isolation_unavailable");
    assert.equal(calls.length, 0);
  }
});

test("isolation cannot be repurposed to launch arbitrary programs or bind host directories", async () => {
  const { sandbox, calls } = harness();
  await assert.rejects(sandbox.run("/bin/sh", ["-c", "anything"], { cwd: "/tmp/xc8-test" }), /isolation is unavailable/);
  await assert.rejects(sandbox.run(config.xc8Cc, [], { cwd: "/var/lib/uartdebug-ai" }), /isolation is unavailable/);
  assert.equal(calls.length, 0);
});

test("unexpected output files and aggregate oversized output fail the compiler operation", async () => {
  for (const options of [{ oversized: true }, { symlink: true }]) {
    const { sandbox } = harness(options);
    await assert.rejects(sandbox.run(config.xc8Cc, [], { cwd: "/tmp/xc8-test" }), /Compiler output/);
  }
});

test("source canonicalization follows line splicing and comments while preserving quoted comment characters", () => {
  assert.equal(canonicalizeProjectSource('#inc\\\nlude/**/"/private"'), '#include "/private"');
  assert.equal(canonicalizeProjectSource('%:/**/include "/private"'), '# include "/private"');
  assert.equal(canonicalizeProjectSource('char *url="https://example.test/*literal*/"; // end\n'), 'char *url="https://example.test/*literal*/"; \n');
});

test("assembler file directives are distinguished from harmless C strings", () => {
  assert.equal(usesAssemblerFileDirective("main.c", 'printf("The .include directive is unavailable.");'), false);
  assert.equal(usesAssemblerFileDirective("main.c", '__asm__(".in" "cbin \\\"private\\\"");'), true);
  assert.equal(usesAssemblerFileDirective("main.c", '__asm__ __volatile__ (".include \\\"private\\\"");'), true);
  assert.equal(usesAssemblerFileDirective("file.S", '.incbin "private"'), true);
  assert.equal(usesAssemblerFileDirective("main.c", '__asm__("nop");'), false);
  assert.equal(usesAssemblerFileDirective("main.c", 'printf("asm(.include file)");'), false);
  assert.equal(usesAssemblerFileDirective("main.c", 'const char *text = "__asm__(.incbin file)";'), false);
  assert.equal(usesAssemblerFileDirective("main.c", 'asm volatile("nop)" : : "r"(function_call(1))); printf(".include");'), false);
  assert.equal(usesAssemblerFileDirective("main.c", 'asm("nop)\\\" .include file");'), true);
  assert.equal(usesAssemblerFileDirective("main.c", 'asm volatile("nop" : : "r"(function_call(".incbin file")));'), true);
});

test("unterminated assembly contexts are consumed once without repeated suffix scans", () => {
  const source = "asm(".repeat(131072);
  const started = performance.now();
  assert.equal(usesAssemblerFileDirective("main.c", source), false);
  assert.equal(usesAssemblerFileDirective("main.c", source + '".incbin file"'), true);
  assert.ok(performance.now() - started < 1500, "half-megabyte malformed contexts must remain bounded");
});

test("C include scanning stays line-local and fast across long newline-only prefixes", () => {
  const compiler = fs.readFileSync(path.join(__dirname, "../backend/compile-server.js"), "utf8");
  const frontend = fs.readFileSync(path.join(__dirname, "../public/AVR-Programming.js"), "utf8");
  const functionText = (text, name, nextName) => text.slice(text.indexOf(`function ${name}(`), text.indexOf(`function ${nextName}(`));
  const backendContext = vm.createContext({ canonicalizeProjectSource });
  vm.runInContext(functionText(compiler, "normalizeIncludePath", "assertSafeProjectSource") +
    functionText(compiler, "extractQuotedIncludes", "resolveProjectIncludeName"), backendContext);
  const frontendContext = vm.createContext({});
  vm.runInContext(functionText(frontend, "extractQuotedIncludes", "resolveProjectIncludeName"), frontendContext);
  const example = '\v\f \t# \tinclude \v"one.h"\r\n#\ninclude "not-a-directive.h"\n#include\n"also-not-a-directive.h"';
  assert.deepEqual(Array.from(backendContext.extractQuotedIncludes(example)), ["one.h"]);
  assert.deepEqual(Array.from(frontendContext.extractQuotedIncludes(example)), ["one.h"]);
  assert.equal(backendContext.findUnsafeInclude('\t# \vinclude "/audit-probe"'), "/audit-probe");
  const manyLines = "\n".repeat(512000) + "int value;";
  const started = performance.now();
  assert.equal(backendContext.findUnsafeInclude(manyLines), "");
  assert.equal(backendContext.extractQuotedIncludes(manyLines).length, 0);
  assert.equal(frontendContext.extractQuotedIncludes(manyLines).length, 0);
  assert.ok(performance.now() - started < 1500, "blank lines must not be reconsidered as directive whitespace");
});

test("generated C validation preserves leading blank lines without quadratic directive searches", () => {
  const { validateSource } = require("../backend/avr-canvas-contract");
  const source = "\n".repeat(60000) + '// Project name: blink\n// Project version: Ver.1.0\n#include <xc.h>\n//+ Begin AI includes\n//- End AI includes\n//+ Begin AI globals\n//- End AI globals\n//+ Begin user globals\n//- End user globals\nint main(void) {\n//+ Begin AI initialization\n//- End AI initialization\n//+ Begin user initialization\n//- End user initialization\nwhile (1) {\n//+ Begin AI cyclic\n//- End AI cyclic\n//+ Begin user cyclic\n//- End user cyclic\n}\nreturn 0;\n}\n';
  const started = performance.now();
  assert.doesNotThrow(() => validateSource(source, { software_dependencies: { includes: ["#include <xc.h>"] } }, "", { title: "blink", version: "Ver.1.0" }));
  assert.ok(performance.now() - started < 1500, "source identity and include searches must stay bounded");
});

test("the public compiler rejects obfuscated host includes before invoking any tool", async t => {
  const reserve = net.createServer();
  await new Promise(resolve => reserve.listen(0, "127.0.0.1", resolve));
  const port = reserve.address().port;
  await new Promise(resolve => reserve.close(resolve));
  const child = spawn(process.execPath, [path.join(__dirname, "../backend/compile-server.js")], {
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(port), COMPILE_RATE_LIMIT_MAX_PER_CLIENT: "100" }, stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => { if (!child.killed) child.kill(); });
  await new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error("Compiler test server failed to start")), 10000);
    child.stdout.on("data", chunk => { output += chunk; if (output.includes("listening on")) { clearTimeout(timer); resolve(); } });
    child.once("exit", () => { clearTimeout(timer); reject(new Error("Compiler test server exited")); });
  });
  for (const code of [
    '#include "/audit-probe"', '#/**/include "/audit-probe"', '#include/**/"/audit-probe"',
    '#inc\\\nlude "/audit-probe"', '%:include "/audit-probe"', '#define P "/audit-probe"\n#include P',
    '__asm__(".incbin \\\"/audit-probe\\\"");', '__asm__(".in" "cbin \\\"/audit-probe\\\"");',
  ]) {
    const response = await fetch(`http://127.0.0.1:${port}/api/avr/compile`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: "main.c", code: code + "\nint main(void){return 0;}", mcu: "attiny1624" }) });
    const body = await response.json();
    assert.equal(response.status, 400);
    assert.equal(body.stage, "project");
  }
});
