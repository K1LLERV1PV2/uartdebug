"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const http = require("node:http");
const os = require("node:os");
const { execFile, execFileSync } = require("node:child_process");
const { promisify } = require("node:util");

const repositoryRoot = path.join(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");

test("deployment guards database schema before rollback symlink changes", () => {
  const workflow = read(".github/workflows/deploy.yml");
  const guard = read("backend/deploy/guard-ai-access-schema-rollback.sh");
  const rollbackResolution = workflow.indexOf("rollback_target_output=");
  const bootstrapSymlink = workflow.indexOf(
    "ts_bootstrap=",
    rollbackResolution,
  );
  const rollbackSymlink = workflow.indexOf(
    "== Rollback mode ==",
    rollbackResolution,
  );

  assert.ok(rollbackResolution >= 0, "rollback guard invocation is missing");
  assert.ok(bootstrapSymlink > rollbackResolution);
  assert.ok(rollbackSymlink > bootstrapSymlink);
  assert.match(workflow, /Upload remote deploy helpers/);
  assert.match(
    workflow,
    /source: "backend\/deploy\/guard-ai-access-schema-rollback\.sh,backend\/deploy\/remote-deploy-helpers\.sh"/,
  );
  assert.match(workflow, /\. "\$\{deploy_helpers\}"/);
  assert.match(guard, /PRAGMA user_version;/);
  assert.match(guard, /target AI_ACCESS_SCHEMA_VERSION/);
  assert.match(guard, /restore the matching verified pre-migration/);
  assert.match(
    guard,
    /live_ai_access_schema_version.*-gt.*target_ai_access_schema_version/s,
  );
});

test("database backups are verified and conservatively retained", () => {
  const backup = read("backend/deploy/backup-ai-access-database.sh");
  const installer = read("backend/deploy/install-ai-service.sh");
  const workflow = read(".github/workflows/deploy.yml");

  assert.match(installer, /deploy\/backup-ai-access-database\.sh/);
  assert.doesNotMatch(
    installer,
    /\.backup '\$\{backup_root\}\/ai-access\.sqlite'/,
  );
  assert.match(backup, /retention_keep=10/);
  assert.match(
    backup,
    /\^\[0-9\]\{8\}T\[0-9\]\{6\}Z-pre-migration-\[0-9a-f\]\{7\}\$/,
  );
  assert.match(backup, /resolved_retention_root.*retention_root/s);
  assert.match(backup, /PRAGMA quick_check;/);
  assert.match(backup, /candidate_version.*metadata_version/s);
  assert.match(backup, /rm -rf -- "\$\{resolved_candidate\}"/);

  const backupCall = workflow.indexOf("access_db_backup=");
  const backendSymlink = workflow.indexOf('ln -sfn "$BE_NEW" "$BE_DIR"');
  const aiRestart = workflow.indexOf("systemctl restart uartdebug-ai.service");
  assert.ok(backupCall >= 0 && backupCall < backendSymlink);
  assert.ok(backupCall < aiRestart);
});

test("canvas installation includes its complete runtime and retains protected data paths", (t) => {
  const installer = read("backend/deploy/install-ai-service.sh");
  const unit = read("backend/deploy/uartdebug-ai.service");
  for (const filename of [
    "avr-ai-runtime.js",
    "avr-canvas-contract.js",
    "avr-documentation-lookup.js",
    "avr-knowledge.js",
    "avr-documentation-markers.js",
  ]) {
    assert.ok(
      installer.includes(filename),
      `The installer must copy ${filename}`,
    );
  }
  assert.match(installer, /loadKnowledge\(\)/);
  assert.match(installer, /ai\/canvas-rules\.md/);
  assert.match(installer, /cp -R "\$\{stage\}\/ai\/knowledge\/\."/);
  assert.match(
    installer,
    /install -d -o uartai -g uartai -m 0700 "\$\{documentation_root\}"/,
  );
  assert.match(
    unit,
    /AI_DOCUMENTATION_CACHE_DIR=\/var\/lib\/uartdebug-ai\/documentation/,
  );
  assert.match(
    unit,
    /ReadWritePaths=\/var\/lib\/uartdebug-ai\/documentation \/var\/lib\/uartdebug-ai\/data/,
  );
  assert.doesNotMatch(
    installer,
    /loadAiSkillCatalog|install-ai-rule-pack|ai\/skills/,
  );
  assert.doesNotMatch(unit, /AI_RULE_PACK_ROOT|AI_DRAFTS_DIR|AI_MAX_DRAFTS/);
  const bash =
    process.platform === "win32"
      ? "C:\\Program Files\\Git\\bin\\bash.exe"
      : "bash";
  if (process.platform === "win32" && !fs.existsSync(bash))
    return t.skip("Git Bash is not installed");
  for (const script of ["install-ai-service.sh", "smoke-ai-service.sh"]) {
    execFileSync(
      bash,
      ["-n", path.join(repositoryRoot, "backend/deploy", script)],
      { encoding: "utf8" },
    );
  }
});

test("canvas smoke check verifies retired routes and avoids paid generation", async (t) => {
  const bash =
    process.platform === "win32"
      ? "C:\\Program Files\\Git\\bin\\bash.exe"
      : "bash";
  if (process.platform === "win32" && !fs.existsSync(bash))
    return t.skip("Git Bash is not installed");
  const requests = [];
  let configured = true;
  const server = http.createServer((req, res) => {
    requests.push(`${req.method} ${req.url}`);
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/api/avr/ai/status")
      return res.end(
        JSON.stringify({
          ok: true,
          contract: "uartdebug-canvas/v1",
          accessRequired: false,
          configured,
          rules: { packageId: "canvas-v2" },
          knowledge: { devices: [{ mcu: "ATtiny1624" }] },
        }),
      );
    if (req.url === "/api/avr/ai/auth/session")
      return res.end(JSON.stringify({ ok: true, mode: "public" }));
    if (req.url === "/api/avr/ai/canvas") {
      res.statusCode = 503;
      return res.end(
        JSON.stringify({ ok: false, code: "api_key_not_configured" }),
      );
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ ok: false, code: "not_found" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const args = [
    path.join(repositoryRoot, "backend/deploy/smoke-ai-service.sh"),
    `http://127.0.0.1:${server.address().port}`,
  ];
  const run = () =>
    promisify(execFile)(bash, args, { encoding: "utf8", timeout: 20000 });
  const paid = await run();
  assert.match(paid.stdout, /canvas-without-key=skipped/);
  assert.equal(requests.includes("POST /api/avr/ai/canvas"), false);
  for (const route of [
    "POST /api/avr/ai/respond",
    "POST /api/avr/ai/generate",
    "GET /api/avr/ai/skills",
  ])
    assert.ok(requests.includes(route));
  configured = false;
  const withoutKey = await run();
  assert.match(withoutKey.stdout, /canvas-without-key=503/);
  assert.equal(
    requests.filter((value) => value === "POST /api/avr/ai/canvas").length,
    1,
  );
});

test("the rollback guard blocks a canvas database from a pre-canvas backend", (t) => {
  const bash =
    process.platform === "win32"
      ? "C:\\Program Files\\Git\\bin\\bash.exe"
      : "bash";
  if (process.platform === "win32" && !fs.existsSync(bash))
    return t.skip("Git Bash is not installed");
  const temporaryDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "uartdebug-rollback-"),
  );
  t.after(() =>
    fs.rmSync(temporaryDirectory, { recursive: true, force: true }),
  );
  const release = "20260924-120000-abcdef0";
  const roots = ["public", "backend", "python"].map((name) =>
    path.join(temporaryDirectory, name),
  );
  for (const root of roots)
    fs.mkdirSync(path.join(root, release), { recursive: true });
  const targetService = path.join(roots[1], release, "ai-access-service.js");
  fs.writeFileSync(targetService, "const SCHEMA_VERSION = 2;\n");
  const database = path.join(temporaryDirectory, "live.sqlite");
  fs.writeFileSync(
    database,
    "Test-only placeholder read through the controlled sqlite3 stub.\n",
  );
  const bin = path.join(temporaryDirectory, "bin");
  fs.mkdirSync(bin);
  fs.writeFileSync(
    path.join(bin, "sqlite3"),
    "#!/usr/bin/env bash\nprintf '3\\n'\n",
    { mode: 0o755 },
  );
  const posix = (value) =>
    process.platform === "win32"
      ? value
          .replace(/\\/g, "/")
          .replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`)
      : value;
  const script = path.join(
    repositoryRoot,
    "backend/deploy/guard-ai-access-schema-rollback.sh",
  );
  const args = [posix(script), ...roots.map(posix), release, posix(database)];
  const environment = { ...process.env };
  const pathKey =
    Object.keys(environment).find((key) => key.toUpperCase() === "PATH") ||
    "PATH";
  environment[pathKey] = bin + path.delimiter + (environment[pathKey] || "");
  const executionOptions = {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: environment,
  };
  assert.throws(
    () => execFileSync(bash, args, executionOptions),
    (error) => {
      assert.equal(error.status, 78);
      assert.match(
        error.stderr,
        /live AI database schema 3 is newer than target AI_ACCESS_SCHEMA_VERSION 2/,
      );
      assert.match(error.stderr, /restore the matching verified pre-migration/);
      assert.equal(error.stdout, "");
      return true;
    },
  );
  fs.writeFileSync(targetService, "const SCHEMA_VERSION = 3;\n");
  const output = execFileSync(bash, args, executionOptions);
  assert.equal(output.trim().split(/\r?\n/).length, 3);
  assert.match(output, /backend\/20260924-120000-abcdef0/);
});

test("release verification detects mismatched running knowledge or rules", async (t) => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "canvas-release-check-"),
  );
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, "status.json");
  const { createAvrAiService } = require("../backend/avr-ai-service");
  const status = await createAvrAiService({ environment: {} }).getStatus();
  const script = path.join(
    repositoryRoot,
    "backend/deploy/verify-ai-release.js",
  );
  fs.writeFileSync(file, JSON.stringify(status));
  execFileSync(process.execPath, [script, file]);
  for (const field of ["rules", "knowledge"]) {
    const mismatch = structuredClone(status);
    mismatch[field].digest = "0".repeat(64);
    fs.writeFileSync(file, JSON.stringify(mismatch));
    assert.throws(
      () => execFileSync(process.execPath, [script, file], { stdio: "pipe" }),
      (error) => error.status === 1,
    );
  }
});
