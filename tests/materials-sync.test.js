"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { createMaterialsIdentityVerifier, AUDIENCE } = require("../backend/materials-sync-auth");
const { createMaterialsSyncServer } = require("../backend/materials-sync-server");

const COMMIT = "a".repeat(40);
const seconds = 1_800_000_000;
const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "test-key", use: "sig", alg: "RS256" };
function claims(changes = {}) {
  return {
    iss: "https://token.actions.githubusercontent.com", aud: AUDIENCE,
    sub: "repo:Sergey-Bulanov@11813891/UartDebug2@1408960831:ref:refs/heads/main",
    repository: "Sergey-Bulanov/UartDebug2", repository_id: "1408960831",
    repository_owner_id: "11813891", repository_visibility: "private",
    ref: "refs/heads/main", ref_type: "branch", sha: COMMIT,
    workflow_ref: "Sergey-Bulanov/UartDebug2/.github/workflows/sync-ai-materials.yml@refs/heads/main",
    workflow_sha: COMMIT, event_name: "push", runner_environment: "github-hosted",
    run_id: "10", run_attempt: "1", jti: "test-token", iat: seconds, nbf: seconds, exp: seconds + 300,
    ...changes,
  };
}
function token(payload, headerChanges = {}) {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "test-key", ...headerChanges })).toString("base64url");
  const content = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.sign("RSA-SHA256", Buffer.from(`${header}.${content}`), privateKey).toString("base64url");
  return `${header}.${content}.${signature}`;
}
function verifier() {
  return createMaterialsIdentityVerifier({ now: () => seconds * 1000,
    fetch: async (url, options) => {
      assert.equal(url, "https://token.actions.githubusercontent.com/.well-known/jwks");
      assert.equal(options.redirect, "error");
      return { ok: true, text: async () => JSON.stringify({ keys: [jwk] }) };
    } });
}

test("materials identity verifies the signed main workflow and immutable repository identity", async () => {
  const verify = verifier();
  assert.deepEqual(await verify(token(claims())), { commit: COMMIT, runId: "10", runAttempt: "1", jti: "test-token" });
  await verify(token(claims({ event_name: "workflow_dispatch" })));
  await verify(token(claims({ sub: "repo:Sergey-Bulanov/UartDebug2:ref:refs/heads/main" })));
});

test("materials identity rejects wrong audience, repository, branch, workflow, events and expiry", async () => {
  for (const change of [
    { aud: "another-server" }, { repository_id: "1" }, { repository_owner_id: "1" },
    { repository: "attacker/UartDebug2" }, { sub: "repo:attacker/UartDebug2:ref:refs/heads/main" },
    { ref: "refs/heads/test" }, { ref_type: "tag" }, { repository_visibility: "public" },
    { workflow_ref: "another-workflow" }, { workflow_sha: "b".repeat(40) },
    { event_name: "pull_request" }, { event_name: "dynamic" }, { runner_environment: "self-hosted" },
    { exp: seconds }, { exp: seconds + 1000 }, { nbf: seconds + 31 }, { iat: seconds + 31 },
    { run_id: "../10" }, { sha: "../main" }, { jti: "" },
  ]) await assert.rejects(verifier()(token(claims(change))), { code: "materials_identity_required" });
});

test("materials identity rejects tampered signatures and algorithm/key substitutions", async () => {
  const signed = token(claims());
  const parts = signed.split(".");
  parts[1] = Buffer.from(JSON.stringify(claims({ run_id: "11" }))).toString("base64url");
  await assert.rejects(verifier()(parts.join(".")), { code: "materials_identity_required" });
  for (const changes of [{ alg: "none" }, { alg: "HS256" }, { jku: "https://attacker.test" }, { jwk }, { crit: ["custom"] }])
    await assert.rejects(verifier()(token(claims(), changes)), { code: "materials_identity_required" });
});

async function syncFixture(t, install) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "uartdebug-material-sync-"));
  const server = createMaterialsSyncServer({ root, verify: verifier(), install });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${server.address().port}/api/internal/materials/sync`;
  const body = Buffer.from("a repository archive");
  const headers = {
    Authorization: `Bearer ${token(claims())}`, "Content-Type": "application/gzip",
    "X-UartDebug-Materials-Commit": COMMIT,
    "X-UartDebug-Archive-Sha256": crypto.createHash("sha256").update(body).digest("hex"),
  };
  return { root, url, body, headers };
}

test("sync endpoint authenticates before uploading and rejects mismatched bytes and replay", async (t) => {
  let installs = 0;
  const f = await syncFixture(t, async (archive, identity) => {
    installs++;
    assert.equal(fs.readFileSync(archive, "utf8"), "a repository archive");
    assert.equal(identity.commit, COMMIT);
    return { ok: true, commit: COMMIT };
  });
  assert.equal((await fetch(f.url, { method: "POST", body: f.body, headers: { ...f.headers, Authorization: "Bearer forged" } })).status, 401);
  assert.equal((await fetch(f.url, { method: "POST", body: f.body, headers: { ...f.headers, "X-UartDebug-Materials-Commit": "b".repeat(40) } })).status, 400);
  assert.equal((await fetch(f.url, { method: "POST", body: f.body, headers: { ...f.headers, "X-UartDebug-Archive-Sha256": "b".repeat(64) } })).status, 400);
  const result = await fetch(f.url, { method: "POST", body: f.body, headers: f.headers });
  assert.equal(result.status, 200);
  assert.equal((await result.json()).commit, COMMIT);
  assert.equal((await fetch(f.url, { method: "POST", body: f.body, headers: f.headers })).status, 409);
  assert.equal(installs, 1);
  assert.deepEqual(fs.readdirSync(path.join(f.root, "uploads")), []);
});

test("failed installation leaves no upload and permits a corrected retry", async (t) => {
  let installs = 0;
  const f = await syncFixture(t, async () => {
    if (++installs === 1) throw Error("bad archive");
    return { ok: true };
  });
  assert.equal((await fetch(f.url, { method: "POST", body: f.body, headers: f.headers })).status, 422);
  assert.equal((await fetch(f.url, { method: "POST", body: f.body, headers: f.headers })).status, 200);
  assert.deepEqual(fs.readdirSync(path.join(f.root, "uploads")), []);
});

test("anonymous traffic from one address cannot exhaust another deployment address", async (t) => {
  const f = await syncFixture(t, async () => ({ ok: true }));
  for (let i = 0; i < 30; i++) {
    const response = await fetch(f.url, { method: "POST", body: f.body,
      headers: { ...f.headers, Authorization: "Bearer forged", "X-Real-IP": "192.0.2.1" } });
    assert.equal(response.status, 401);
  }
  assert.equal((await fetch(f.url, { method: "POST", body: f.body,
    headers: { ...f.headers, "X-Real-IP": "192.0.2.1" } })).status, 429);
  assert.equal((await fetch(f.url, { method: "POST", body: f.body,
    headers: { ...f.headers, "X-Real-IP": "192.0.2.2" } })).status, 200);
});

const REQUIRED = ["AGENTS.md", "Project_Rules/AGENTS_Add_On.md", "Project_Rules/Project_Description.md",
  "Project_Rules/Base_project_rules.md", "MCU_Knowledge_Base/00_README.md",
  "MCU_Knowledge_Base/AVR/00_README.md", "MCU_Knowledge_Base/AVR/AVR_Programming_General_Rules.md"];
function archive(root, commit, additions = [], omitted = []) {
  const filename = path.join(root, `${crypto.randomUUID()}.tar.gz`);
  const entries = REQUIRED.filter((name) => !omitted.includes(name)).map((name) => ({ name, content: "# Canonical rules\n" })).concat(additions);
  const config = path.join(root, `${crypto.randomUUID()}.json`);
  fs.writeFileSync(config, JSON.stringify({ entries, commit, filename }));
  execFileSync(process.platform === "win32" ? "python" : "python3", ["-c", [
    "import io,json,tarfile,sys",
    "c=json.load(open(sys.argv[1],encoding='utf-8'))",
    "with tarfile.open(c['filename'],'w:gz',pax_headers={'comment':c['commit']}) as t:",
    " for e in c['entries']:",
    "  p=tarfile.TarInfo(e['name']); b=e.get('content','').encode('utf-8'); p.size=len(b)",
    "  if e.get('symlink'): p.type=tarfile.SYMTYPE; p.linkname=e['symlink']; p.size=0",
    "  t.addfile(p,io.BytesIO(b))",
  ].join("\n"), config]);
  return filename;
}
function install(root, archiveFile, commit, extra = []) {
  return JSON.parse(execFileSync(process.platform === "win32" ? "python" : "python3", [
    path.join(__dirname, "../backend/deploy/install-materials.py"),
    "--archive", archiveFile, "--root", path.join(root, "materials"), "--commit", commit, ...extra,
  ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
}

test("archive installer preserves paths/content, hashes every file and atomically removes stale active files", (t) => {
  if (process.platform === "win32") return t.skip("Release symlinks are validated on the Linux deployment target");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "uartdebug-material-archive-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const content = "Русский текст\r\n#include <xc.h>\n";
  const first = archive(root, COMMIT, [{ name: "Target_Projects/Тест Ver.1.0/Тест.c", content }, { name: "Notes/old.md", content: "old" }]);
  const result = install(root, first, COMMIT, ["--run-id", "10"]);
  assert.equal(result.files, REQUIRED.length + 2);
  const current = path.join(root, "materials/current");
  assert.equal(fs.readFileSync(path.join(current, "repository/Target_Projects/Тест Ver.1.0/Тест.c"), "utf8"), content);
  const manifest = JSON.parse(fs.readFileSync(path.join(current, "manifest.json")));
  assert.equal(manifest.files["Target_Projects/Тест Ver.1.0/Тест.c"].sha256, crypto.createHash("sha256").update(content).digest("hex"));
  const next = "b".repeat(40);
  install(root, archive(root, next), next, ["--run-id", "11"]);
  assert.equal(fs.existsSync(path.join(current, "repository/Notes/old.md")), false);
  assert.equal(fs.existsSync(path.join(root, `materials/releases/${COMMIT}/repository/Notes/old.md`)), true);
  assert.throws(() => install(root, first, COMMIT, ["--run-id", "9"]));
  assert.equal(JSON.parse(fs.readFileSync(path.join(current, "manifest.json"))).commit, next);
});

test("archive installer rejects traversal, links, duplicates, incomplete rules and wrong commits", (t) => {
  if (process.platform === "win32") return t.skip("Archive installation is validated on Linux");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "uartdebug-material-invalid-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  install(root, archive(root, COMMIT), COMMIT);
  for (const additions of [
    [{ name: "../escaped.txt", content: "escape" }],
    [{ name: "/escaped.txt", content: "escape" }],
    [{ name: "MCU_Knowledge_Base/link", symlink: "../../escaped.txt" }],
    [{ name: "AGENTS.md", content: "duplicate" }],
  ]) assert.throws(() => install(root, archive(root, "b".repeat(40), additions), "b".repeat(40)));
  assert.throws(() => install(root, archive(root, "b".repeat(40), [], ["AGENTS.md"]), "b".repeat(40)));
  assert.throws(() => install(root, archive(root, "b".repeat(40)), "c".repeat(40)));
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, "materials/current/manifest.json"))).commit, COMMIT);
  assert.equal(fs.existsSync(path.join(root, "materials/escaped.txt")), false);
});

test("reactivating an existing immutable release retains the newest workflow watermark", (t) => {
  if (process.platform === "win32") return t.skip("Release activation is validated on Linux");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "uartdebug-material-reactivation-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const next = "b".repeat(40);
  const firstArchive = archive(root, COMMIT);
  const nextArchive = archive(root, next);
  install(root, firstArchive, COMMIT, ["--run-id", "10"]);
  const firstManifest = fs.readFileSync(path.join(root, `materials/releases/${COMMIT}/manifest.json`), "utf8");
  install(root, nextArchive, next, ["--run-id", "11"]);
  install(root, firstArchive, COMMIT, ["--run-id", "12"]);
  assert.equal(fs.readFileSync(path.join(root, `materials/releases/${COMMIT}/manifest.json`), "utf8"), firstManifest);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, "materials/activation.json"), "utf8")), {
    runId: "12", runAttempt: "1", commit: COMMIT,
  });
  assert.throws(() => install(root, nextArchive, next, ["--run-id", "11"]));
  assert.throws(() => install(root, nextArchive, next, ["--run-id", "12"]));
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, "materials/current/manifest.json"), "utf8")).commit, COMMIT);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, "materials/activation.json"), "utf8")).runId, "12");
});
