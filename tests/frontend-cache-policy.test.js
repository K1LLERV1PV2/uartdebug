"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const repositoryRoot = path.resolve(__dirname, "..");
const bootstrap = fs.readFileSync(path.join(repositoryRoot, "public/ui-service-worker.js"), "utf8");

test("every actual entry page uses the same stable worker bootstrap", () => {
  for (const name of ["index", "avr", "uart", "privacy", "terms"]) {
    const html = fs.readFileSync(path.join(repositoryRoot, "public", name + ".html"), "utf8");
    assert.equal((html.match(/src="ui-service-worker\.js(?:\?[^\"]*)?"/g) || []).length, 1, name);
    assert.doesNotMatch(html, /navigator\.serviceWorker\.register/);
  }
});

test("worker updates on direct entry and returning to a page without navigating or touching storage", async () => {
  const events = new Map();
  const calls = [];
  const registration = { update: async () => calls.push("update") };
  const document = { readyState: "loading", visibilityState: "hidden", addEventListener: (type, listener) => events.set(type, listener) };
  vm.runInNewContext(bootstrap, {
    document,
    navigator: { serviceWorker: { register: async (url, options) => { calls.push([url, options.updateViaCache]); return registration; } } },
    window: { addEventListener: (type, listener) => events.set(type, listener) },
  });
  await events.get("load")();
  assert.deepEqual(calls, [["/sw.js", "none"], "update"]);
  events.get("visibilitychange")();
  assert.equal(calls.length, 2);
  document.visibilityState = "visible";
  events.get("visibilitychange")();
  await Promise.resolve();
  assert.deepEqual(calls, [["/sw.js", "none"], "update", "update"]);
  registration.update = async () => { throw new Error("offline"); };
  await events.get("load")();
});

test("nginx frontend cache migration is idempotent and refuses unsafe layouts or failed validation", t => {
  const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash";
  if (process.platform === "win32" && !fs.existsSync(bash)) return t.skip("Git Bash is not installed");
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "uartdebug-cache-policy-"));
  t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
  const bin = path.join(temporaryRoot, "bin");
  fs.mkdirSync(bin);
  const site = path.join(temporaryRoot, "uartdebug.com");
  const api = "    location ^~ /api/avr/ai/ {\n        proxy_buffering off;\n        proxy_pass http://127.0.0.1:8083;\n    }\n";
  const security = "        include /etc/nginx/snippets/uartdebug-security-headers.conf;\n";
  const fixture = "server {\n" + api + ["location = /avr", "location = /uart", "location /", "location ~* \\.(css|js|png|svg)$", "location ~* \\.(html)$"]
    .map(location => `    ${location} {\n${security}        expires 30d;\n        add_header Cache-Control "public, max-age=2592000, immutable" always;\n        try_files $uri =404;\n    }\n`).join("") + "}\n";
  const toPosix = value => value.replaceAll("\\", "/").replace(/^([A-Za-z]):/, (_, drive) => "/" + drive.toLowerCase());
  // Do not depend on an nginx installation or root ownership in a unit fixture.
  const nginx = path.join(bin, "nginx");
  fs.writeFileSync(nginx, '#!/bin/bash\nif [ -f "$FAIL_MARKER" ]; then rm "$FAIL_MARKER"; exit 1; fi\nexit 0\n', { mode: 0o755 });
  fs.writeFileSync(path.join(bin, "install"), '#!/bin/bash\nargs=(); directory=0\nwhile [ "$#" -gt 0 ]; do\n case "$1" in -o|-g|-m) shift 2 ;; -d) directory=1; shift ;; *) args+=("$1"); shift ;; esac\ndone\nif [ "$directory" = 1 ]; then mkdir -p "${args[@]}"; else cp "${args[@]}"; fi\n', { mode: 0o755 });
  const failMarker = path.join(temporaryRoot, "reject-once");
  const runner = path.join(temporaryRoot, "run-fixture.sh");
  // Git Bash prepends its system tools at startup. Put mocks first afterwards;
  // paths remain separate arguments and never become shell command source.
  fs.writeFileSync(runner, '#!/bin/bash\nexport PATH="$1:$PATH"\nshift\nexec bash "$@"\n');
  const run = backupName => spawnSync(bash, [toPosix(runner), toPosix(bin),
    toPosix(path.join(repositoryRoot, "backend/deploy/set-frontend-cache-policy.sh")), toPosix(site), toPosix(path.join(temporaryRoot, backupName))], {
    encoding: "utf8", env: { ...process.env, FAIL_MARKER: toPosix(failMarker) },
  });
  fs.writeFileSync(site, fixture);
  let result = run("first-backup");
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const configured = fs.readFileSync(site, "utf8");
  assert.equal((configured.match(/no-cache, max-age=0, must-revalidate/g) || []).length, 5);
  assert.equal((configured.match(/expires off;/g) || []).length, 5);
  assert.equal((configured.match(/uartdebug-security-headers\.conf/g) || []).length, 5);
  assert.ok(configured.includes(api));
  assert.doesNotMatch(configured, /immutable|expires 30d/);
  assert.equal(fs.readFileSync(path.join(temporaryRoot, "first-backup/uartdebug.com"), "utf8"), fixture);
  result = run("first-backup");
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(fs.readFileSync(site, "utf8"), configured);
  fs.writeFileSync(site, fixture);
  fs.writeFileSync(failMarker, "reject");
  result = run("rejected-backup");
  assert.equal(result.status, 78, result.stdout + result.stderr);
  assert.equal(fs.readFileSync(site, "utf8"), fixture);
  for (const unsafe of [fixture.replace("location = /avr", "location = /unexpected"), fixture.replace(security, "")]) {
    fs.writeFileSync(site, unsafe);
    result = run("unsafe-backup");
    assert.equal(result.status, 65, result.stdout + result.stderr);
    assert.equal(fs.readFileSync(site, "utf8"), unsafe);
  }
});
