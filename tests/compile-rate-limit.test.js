"use strict";

const assert = require("node:assert/strict");
const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");
const test = require("node:test");
const {
  AVR_COMPILE_SERVER_VERSION,
} = require("../backend/avr-compiler-contract");

const REPOSITORY_ROOT = path.resolve(__dirname, "..");

test("compiler limits expensive starts per client and globally", async (t) => {
  const port = await reservePort();
  const child = spawn(process.execPath, ["backend/compile-server.js"], {
    cwd: REPOSITORY_ROOT,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      COMPILE_RATE_LIMIT_WINDOW_MS: "60000",
      COMPILE_RATE_LIMIT_MAX_PER_CLIENT: "2",
      COMPILE_RATE_LIMIT_MAX_GLOBAL: "3",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  t.after(() => {
    if (!child.killed) child.kill();
  });
  await waitForCompilerServer(child);

  const baseUrl = `http://127.0.0.1:${port}/api/avr/compile`;
  const first = await postWithoutJson(baseUrl, "198.51.100.10");
  const second = await postWithoutJson(baseUrl, "198.51.100.10");
  const clientLimited = await postWithoutJson(baseUrl, "198.51.100.10");
  const separateClient = await postWithoutJson(baseUrl, "198.51.100.11");
  const globalLimited = await postWithoutJson(baseUrl, "198.51.100.12");
  const health = await fetch(`http://127.0.0.1:${port}/health`);

  assert.equal(first.status, 415);
  assert.equal(second.status, 415);
  assert.equal(clientLimited.status, 429);
  assert.equal(clientLimited.headers.get("retry-after"), "60");
  assert.deepEqual(await clientLimited.json(), {
    compile_contract: "uartdebug-avr-compile/v1",
    compile_server_version: AVR_COMPILE_SERVER_VERSION,
    ok: false,
    stage: "server",
    code: "compile_rate_limited",
    scope: "client",
    stderr: "Too many compile requests. Try again shortly.",
  });

  assert.equal(separateClient.status, 415);
  assert.equal(globalLimited.status, 429);
  assert.equal((await globalLimited.json()).scope, "global");
  assert.notEqual(health.status, 429);
  assert.equal((await health.json()).service, "uartdebug-avr-compiler");
});

async function postWithoutJson(url, forwardedFor) {
  return await fetch(url, {
    method: "POST",
    headers: { "X-Forwarded-For": forwardedFor },
  });
}

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
  if (!port) throw new Error("Could not reserve a compiler test port.");
  return port;
}

async function waitForCompilerServer(child) {
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(
        new Error(
          `Compiler test server did not start. stdout=${stdout} stderr=${stderr}`
        )
      );
    }, 10_000);
    const poll = setInterval(() => {
      if (!stdout.includes("listening on 127.0.0.1:")) return;
      clearTimeout(timeout);
      clearInterval(poll);
      resolve();
    }, 10);
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      clearInterval(poll);
      reject(
        new Error(
          `Compiler test server exited early (${code ?? signal}). stderr=${stderr}`
        )
      );
    });
  });
}
