"use strict";

// Run explicitly against the configured XC8 service, never during unit tests.
// node scripts/avr-knowledge/compile-fixtures.js [fixture-directory] [compile-url] [fixture-name]
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const directory = process.argv[2] || path.join(__dirname, "fixtures");
const url = process.argv[3] || "http://127.0.0.1:8082/api/avr/compile";
const filename = process.argv[4] || "composed-uart-timer.c";
if (!/^[a-z0-9-]+\.c$/.test(filename)) throw new Error("Invalid fixture name");
const code = fs.readFileSync(path.join(directory, filename), "utf8");
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");

(async () => {
  const runs = [];
  for (const mcu of ["attiny1624", "attiny1626", "attiny1627"]) {
    const response = await fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mcu, filename, code, project_files: [{ name: filename, content: code }] }),
      signal: AbortSignal.timeout(120000),
    });
    const result = await response.json();
    runs.push({ mcu, responseMcu: result.mcu, httpStatus: response.status, ok: result.ok === true && result.mcu === mcu,
      compileContract: result.compile_contract, compileServerVersion: result.compile_server_version,
      compiler: result.compiler || null, optimize: result.optimize || null,
      hexSha256: typeof result.hex === "string" ? hash(result.hex) : null,
      stdout: result.compile_stdout || result.stdout || "", stderr: result.compile_stderr || result.stderr || "", stage: result.stage || null });
  }
  console.log(JSON.stringify({ schemaVersion: 1, checkedAt: new Date().toISOString(),
    fixture: filename, sourceSha256: hash(code),
    scope: "These exact fixture bytes compiled on the recorded XC8 service for these targets. This is not hardware testing or proof that arbitrary compositions compile.", runs }, null, 2));
  if (runs.some((run) => !run.ok)) process.exitCode = 1;
})().catch((error) => { console.error(error); process.exitCode = 1; });
