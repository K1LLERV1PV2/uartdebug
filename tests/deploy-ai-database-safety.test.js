"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const http = require("node:http");
const os = require("node:os");
const { execFile, execFileSync } = require("node:child_process");
const { promisify } = require("node:util");
const { createMaterialsFixture } = require("./helpers/avr-materials-fixture");

const repositoryRoot = path.join(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");

test("staged canonical materials are checked using the AI service identity before release activation", () => {
  const workflow = read(".github/workflows/deploy.yml");
  const helpers = read("backend/deploy/remote-deploy-helpers.sh");
  const boundary = workflow.indexOf('NOW="$(date +%Y%m%d-%H%M%S)');
  const preflight = workflow.slice(0, boundary);
  assert.ok(boundary > 0);
  assert.match(preflight, /verify_ai_release_knowledge "\$\{BE_SRC\}"/);
  assert.match(helpers, /run_sudo -u uartai \/usr\/bin\/node "\$\{materials_backend\}\/deploy\/verify-materials\.js"/);
  assert.match(helpers, /\/var\/lib\/uartdebug-ai\/materials\/current\/repository/);
});

test("deployment guards database schema before rollback symlink changes", () => {
  const workflow = read(".github/workflows/deploy.yml");
  const guard = read("backend/deploy/guard-ai-access-schema-rollback.sh");
  const rollbackResolution = workflow.indexOf("rollback_target_output=");
  const rollbackSymlink = workflow.indexOf(
    "== Rollback mode ==",
    rollbackResolution,
  );

  assert.ok(rollbackResolution >= 0, "rollback guard invocation is missing");
  assert.ok(rollbackSymlink > rollbackResolution);
  assert.ok(workflow.indexOf('ln -sfn', rollbackResolution) > rollbackSymlink,
    "the schema and materials preflight must finish before switching either release");
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

test("materials preflight refuses unsupported releases and stops after a failed catalog preparation", (t) => {
  const bash = process.platform === "win32" ? "C:\\Program Files\\Git\\bin\\bash.exe" : "bash";
  if (process.platform === "win32" && !fs.existsSync(bash)) return t.skip("Git Bash is not installed");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "uartdebug-preflight-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const posix = value => process.platform === "win32"
    ? value.replace(/\\/g, "/").replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`) : value;
  const helper = posix(path.join(repositoryRoot, "backend/deploy/remote-deploy-helpers.sh"));
  const run = () => {
    try {
      execFileSync(bash, ["-c", '. "$1"; run_sudo() { printf "%s\\n" "$*"; return 19; }; verify_ai_release_knowledge "$2"',
        "preflight-test", helper, posix(directory)], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      assert.fail("preflight unexpectedly accepted an invalid release");
    } catch (error) { return error; }
  };
  const unsupported = run();
  assert.equal(unsupported.status, 78);
  assert.match(unsupported.stderr, /Unsupported backend release/);
  assert.equal(unsupported.stdout, "", "no privileged command may run for an unsupported release");
  for (const file of ["ai-server.js", "compile-server.js", "compile-sandbox.js", "avr-ai-service.js", "avr-materials.js", "deploy/verify-materials.js", "deploy/uartdebug-ai.service", "deploy/uartdebug-backend.service"]) {
    const target = path.join(directory, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, "fixture");
  }
  const preparation = run();
  assert.equal(preparation.status, 19, "catalog preparation failure must reach the deployment caller");
  assert.match(preparation.stdout, /-u uartmaterials -g uartai .* --prepare-catalog/);
  assert.equal(preparation.stdout.trim().split(/\r?\n/).length, 1, "failed preparation must not proceed to activation/read checks");
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
  assert.match(installer, /avr-materials\.js/);
  assert.doesNotMatch(installer, /ai\/canvas-rules\.md|cp -R .*ai\/knowledge/);
  assert.match(unit, /AI_MATERIALS_ROOT=\/var\/lib\/uartdebug-ai\/materials\/current\/repository/);
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
  assert.match(unit, /Environment=AI_GOOGLE_AUTH_ENABLED=1/);
  assert.match(unit, /Environment=AI_GOOGLE_AUTH_REQUIRED=1/);
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

test("production smoke requires Google authentication and never starts paid generation", async (t) => {
  const bash =
    process.platform === "win32"
      ? "C:\\Program Files\\Git\\bin\\bash.exe"
      : "bash";
  if (process.platform === "win32" && !fs.existsSync(bash))
    return t.skip("Git Bash is not installed");
  const requests = [];
  let configured = true;
  let mode = "google";
  const server = http.createServer((req, res) => {
    requests.push(`${req.method} ${req.url}`);
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/api/avr/ai/status")
      return res.end(
        JSON.stringify({
          ok: true,
          contract: "uartdebug-project/v2",
          accessRequired: false,
          configured,
          rules: { packageId: "canvas-v2" },
          knowledge: { devices: [{ mcu: "ATtiny1624" }] },
        }),
      );
    if (req.url === "/api/avr/ai/auth/session")
      return res.end(JSON.stringify({ ok: true, mode, configured: true, authEnabled: mode === "google", authRequired: mode === "google", authenticated: false }));
    if (req.url === "/api/avr/ai/account/workspace") {
      res.statusCode = 401;
      return res.end(JSON.stringify({ ok: false, code: "authentication_required" }));
    }
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
  assert.match(paid.stdout, /anonymous-workspace=401/);
  assert.equal(requests.includes("POST /api/avr/ai/canvas"), false);
  for (const route of [
    "POST /api/avr/ai/respond",
    "POST /api/avr/ai/generate",
    "GET /api/avr/ai/skills",
  ])
    assert.ok(requests.includes(route));
  configured = false;
  const withoutKey = await run();
  assert.match(withoutKey.stdout, /anonymous-workspace=401/);
  assert.equal(
    requests.filter((value) => value === "POST /api/avr/ai/canvas").length,
    0,
  );
  mode = "public";
  await assert.rejects(run(), "a missing production auth configuration must fail release verification");
});

test("compiler isolation is required before activating a release", () => {
  const workflow = read(".github/workflows/deploy.yml");
  const preflight = workflow.indexOf('verify_compiler_release "${BE_SRC}"');
  const activation = workflow.indexOf('ln -sfn "$PUB_NEW"');
  assert.ok(preflight > 0 && preflight < activation);
  const unit = read("backend/deploy/uartdebug-backend.service");
  assert.match(unit, /User=uartcompile/);
  assert.match(unit, /RestrictNamespaces=user mnt pid net ipc uts/);
  assert.match(unit, /NoNewPrivileges=true/);
  assert.match(unit, /ProtectSystem=strict/);
  assert.match(unit, /PrivateTmp=true/);
  assert.match(unit, /ProcSubset=all/);
  assert.match(unit, /RestrictAddressFamilies=.*AF_NETLINK/);
  for (const flag of ["ProtectHostname", "ProtectKernelLogs", "ProtectKernelTunables"]) assert.match(unit, new RegExp(`${flag}=false`));
  const helpers = read("backend/deploy/remote-deploy-helpers.sh");
  assert.match(helpers, /\/usr\/bin\/bwrap/);
  assert.match(helpers, /\/usr\/bin\/prlimit/);
  assert.match(helpers, /compile-sandbox\.js/);
});

for (const [liveSchema, targetSchema] of [[3, 2], [6, 5]]) {
test(`the rollback guard blocks schema ${liveSchema} from a schema ${targetSchema} backend`, (t) => {
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
  const roots = ["public", "backend"].map((name) =>
    path.join(temporaryDirectory, name),
  );
  for (const root of roots)
    fs.mkdirSync(path.join(root, release), { recursive: true });
  const targetService = path.join(roots[1], release, "ai-access-service.js");
  fs.writeFileSync(targetService, `const SCHEMA_VERSION = ${targetSchema};\n`);
  const database = path.join(temporaryDirectory, "live.sqlite");
  fs.writeFileSync(
    database,
    "Test-only placeholder read through the controlled sqlite3 stub.\n",
  );
  const bin = path.join(temporaryDirectory, "bin");
  fs.mkdirSync(bin);
  fs.writeFileSync(
    path.join(bin, "sqlite3"),
    `#!/usr/bin/env bash\nprintf '${liveSchema}\\n'\n`,
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
        new RegExp(`live AI database schema ${liveSchema} is newer than target AI_ACCESS_SCHEMA_VERSION ${targetSchema}`),
      );
      assert.match(error.stderr, /restore the matching verified pre-migration/);
      assert.equal(error.stdout, "");
      return true;
    },
  );
  fs.writeFileSync(targetService, `const SCHEMA_VERSION = ${liveSchema};\n`);
  const output = execFileSync(bash, args, executionOptions);
  assert.equal(output.trim().split(/\r?\n/).length, 2);
  assert.match(output, /backend\/20260924-120000-abcdef0/);
});
}

test("release readiness passes the private status file through stdin before switching identity", () => {
  const workflow = read(".github/workflows/deploy.yml");
  assert.match(workflow, /run_sudo -u uartai \/usr\/bin\/node "\$\{BE_DIR\}\/deploy\/verify-ai-release\.js" - < "\$\{ai_status_body\}"/);
});

test("release verification accepts file paths and stdin while rejecting mismatched status", async (t) => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "canvas-release-check-"),
  );
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, "status.json");
  const { createAvrAiService } = require("../backend/avr-ai-service");
  const fixture = createMaterialsFixture(t);
  const environment = { AI_MATERIALS_ROOT: fixture.root };
  const status = await createAvrAiService({ environment }).getStatus();
  const executionOptions = { env: { ...process.env, ...environment }, stdio: "pipe" };
  const script = path.join(
    repositoryRoot,
    "backend/deploy/verify-ai-release.js",
  );
  fs.writeFileSync(file, JSON.stringify(status), { mode: 0o600 });
  for (const source of ["file", "stdin"]) {
    const run = (body) => {
      if (source === "file") {
        fs.writeFileSync(file, body);
        return execFileSync(process.execPath, [script, file], executionOptions);
      }
      return execFileSync(process.execPath, [script, "-"], { ...executionOptions, input: body });
    };
    run(JSON.stringify(status));
    for (const field of ["contract", "rules.digest", "knowledge.digest", "knowledge.version", "model"]) {
      const mismatch = structuredClone(status);
      const keys = field.split(".");
      const owner = keys.length === 1 ? mismatch : mismatch[keys[0]];
      owner[keys.at(-1)] = "mismatched-release";
      assert.throws(
        () => run(JSON.stringify(mismatch)),
        (error) => error.status === 1,
        `${source} must reject mismatched ${field}`,
      );
    }
    assert.throws(() => run("{invalid JSON"), (error) => error.status === 1);
  }
  if (process.platform !== "win32") {
    assert.equal(fs.statSync(file).mode & 0o777, 0o600, "verification must not broaden status file access");
  }
});
