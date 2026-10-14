"use strict";

const http = require("node:http");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { Transform } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { createMaterialsIdentityVerifier } = require("./materials-sync-auth");

const execute = promisify(execFile);
const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;
const VERSION = "uartdebug-materials-sync/1";

function send(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff", "Connection": "close",
  });
  res.end(JSON.stringify(data));
}

function createMaterialsSyncServer(options = {}) {
  const root = options.root || "/var/lib/uartdebug-ai/materials";
  const verify = options.verify || createMaterialsIdentityVerifier();
  const validator = options.validator || path.join(__dirname, "deploy", "verify-materials.js");
  const install = options.install || (async (archive, identity) => {
    const { stdout } = await execute("python3", [
      path.join(__dirname, "deploy", "install-materials.py"),
      "--archive", archive, "--root", root, "--commit", identity.commit,
      "--run-id", identity.runId, "--run-attempt", identity.runAttempt,
      "--validator", validator,
    ], { timeout: 120000, maxBuffer: 16 * 1024 });
    return JSON.parse(stdout);
  });
  let busy = false;
  const attemptsByAddress = new Map();
  const acceptedTokens = new Map();
  const server = http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/health") return send(res, 200, { ok: true, service: VERSION });
    if (req.method !== "POST" || req.url !== "/api/internal/materials/sync")
      return send(res, 404, { ok: false, code: "not_found" });
    const currentMinute = Math.floor(Date.now() / 60000);
    for (const [address, record] of attemptsByAddress) {
      if (record.minute !== currentMinute) attemptsByAddress.delete(address);
    }
    // The receiver binds to loopback; nginx overwrites this header with the
    // actual client address. Anonymous traffic must not consume another IP's allowance.
    const address = String(req.headers["x-real-ip"] || req.socket.remoteAddress || "unknown");
    const allowance = attemptsByAddress.get(address) || { minute: currentMinute, count: 0 };
    if (!attemptsByAddress.has(address) && attemptsByAddress.size >= 1000)
      return send(res, 429, { ok: false, code: "materials_sync_busy" });
    attemptsByAddress.set(address, allowance);
    if (++allowance.count > 30 || busy) return send(res, 429, { ok: false, code: "materials_sync_busy" });
    let archive;
    let ownsLock = false;
    async function cleanup() {
      if (archive) {
        await fsp.rm(archive, { force: true }).catch(() => {});
        archive = null;
      }
      if (ownsLock) { busy = false; ownsLock = false; }
    }
    async function complete(status, body) {
      await cleanup();
      send(res, status, body);
    }
    try {
      const bearer = /^Bearer ([A-Za-z0-9_.-]+)$/.exec(String(req.headers.authorization || ""));
      const identity = await verify(bearer?.[1] || "");
      for (const [token, expiry] of acceptedTokens) {
        if (expiry < Date.now()) acceptedTokens.delete(token);
      }
      if (acceptedTokens.has(identity.jti))
        return send(res, 409, { ok: false, code: "materials_identity_replayed" });
      if (busy) return send(res, 429, { ok: false, code: "materials_sync_busy" });
      const length = Number(req.headers["content-length"]);
      const digest = String(req.headers["x-uartdebug-archive-sha256"] || "");
      if (req.headers["content-type"] !== "application/gzip" ||
          !Number.isSafeInteger(length) || length <= 0 || length > MAX_ARCHIVE_BYTES ||
          !/^[a-f0-9]{64}$/.test(digest) ||
          req.headers["x-uartdebug-materials-commit"] !== identity.commit) {
        return send(res, 400, { ok: false, code: "invalid_materials_archive" });
      }
      busy = true;
      ownsLock = true;
      const uploads = path.join(root, "uploads");
      await fsp.mkdir(uploads, { recursive: true, mode: 0o750 });
      archive = path.join(uploads, `${crypto.randomUUID()}.tar.gz`);
      const hash = crypto.createHash("sha256");
      let received = 0;
      const meter = new Transform({ transform(chunk, encoding, next) {
        received += chunk.length;
        if (received > length) return next(new Error("Archive size exceeded"));
        hash.update(chunk);
        next(null, chunk);
      } });
      await pipeline(req, meter, fs.createWriteStream(archive, { flags: "wx", mode: 0o600 }));
      if (received !== length || hash.digest("hex") !== digest) {
        return await complete(400, { ok: false, code: "materials_archive_digest_mismatch" });
      }
      const result = await install(archive, identity);
      acceptedTokens.set(identity.jti, Date.now() + 600000);
      return await complete(200, result);
    } catch (error) {
      if (res.destroyed || res.writableEnded) return;
      return await complete(error?.status === 401 ? 401 : 422, {
        ok: false, code: error?.status === 401 ? "materials_identity_required" : "materials_install_failed",
      });
    } finally {
      await cleanup();
    }
  });
  server.headersTimeout = 15000;
  server.requestTimeout = 300000;
  server.timeout = 300000;
  return server;
}

if (require.main === module) {
  createMaterialsSyncServer().listen(8084, "127.0.0.1", () => {
    console.log(`${VERSION} listening on 127.0.0.1:8084`);
  });
}

module.exports = { createMaterialsSyncServer, MAX_ARCHIVE_BYTES };
