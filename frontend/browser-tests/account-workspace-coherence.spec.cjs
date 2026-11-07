"use strict";

const { test, expect } = require("playwright/test");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const archive = require("../../public/avr-mini-project-archive.js");
const publicRoot = path.resolve(__dirname, "../../public");
const workspaceKey = "ud_avr_programming_state_v5", syncKey = "ud_avr_ai_account_sync_v1", dirtyKey = "ud_avr_ai_local_dirty_v1";
const accountKey = "workspace-coherence-account";

function definition(name) {
  return { schemaVersion: 1, contract: "uartdebug-project/v2", id: name.toLowerCase().replaceAll(" ", "-"), title: name, version: "Ver.1.0",
    defaultLocale: "en", canvasName: name + ".md", projectPath: "Target_Projects/" + name,
    projectDocuments: [{ name: "AGENTS.md", content: "# Local project rules\nPreserve " + name + " project ownership." }, { name: "00_README.md", content: "# " + name + " workspace notes" }],
    canvas: { locale: "en", markdown: "# " + name + "\n\nOriginal requirements." },
    files: [{ role: "source", name: name + ".c", content: "// Original source\nint main(void) { return 0; }\n" },
      { role: "guide", name: name + " (description).md", locale: "en", content: "# " + name + "\n\nOriginal description.\n" },
      { role: "specification", name: name + ".yaml", content: "microcontroller:\n  model: ATtiny1624\n  package: SOIC-14\nhardware_resources: {}\nsoftware_dependencies: {}\n" }] };
}

function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }

async function pair(browser) {
  const cloud = { authenticated: false, accountKey, data: null, revision: 5, reads: [], writes: [], authReads: [], holdRead: null, holdPut: null, holdAuth: null, templateGate: null, templateRequests: 0 };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const json = data => { res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(data)); };
    if (url.pathname === "/api/avr/ai/status") return json({ ok: true, enabled: false, configured: false, ready: false,
      knowledge: { devices: [{ mcu: "ATtiny1624", packages: ["SOIC-14", "TSSOP-14"] }] } });
    if (url.pathname === "/api/avr/ai/projects") return json({ ok: true, projects: [{ id: "held-template", title: "Held template", kind: "example" }] });
    if (url.pathname === "/api/avr/ai/projects/held-template") {
      cloud.templateRequests++;
      if (cloud.templateGate) await cloud.templateGate.promise;
      return json({ ok: true, project: definition("Held template") });
    }
    if (url.pathname.startsWith("/api/")) { res.statusCode = 404; return res.end("Unknown API"); }
    try {
      const route = url.pathname === "/avr" ? "/avr.html" : url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
      const file = path.resolve(publicRoot, "." + route);
      if (!file.startsWith(publicRoot + path.sep) || !fs.statSync(file).isFile()) throw new Error("Missing");
      const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" };
      res.writeHead(200, { "Content-Type": mime[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
      res.end(fs.readFileSync(file));
    } catch { res.statusCode = 404; res.end("Missing"); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const contexts = await Promise.all([browser.newContext({ serviceWorkers: "block", viewport: { width: 1543, height: 884 } }), browser.newContext({ serviceWorkers: "block", viewport: { width: 1543, height: 884 } })]);
  const errors = [];
  for (const [index, context] of contexts.entries()) {
    const who = index ? "B" : "A";
    await context.route("**/api/avr/ai/auth/session", async route => {
      const identity = cloud.accountKey;
      // Capture response identity when the request starts, including held responses.
      const session = cloud.authenticated ? {
        ok: true, mode: "google", configured: true, authEnabled: true, authRequired: true, authenticated: true, accountKey: identity,
        user: { displayName: identity === accountKey ? "Workspace regression" : "Incoming Account" }, quota: { unlimited: true },
      } : { ok: true, mode: "google", configured: false, authenticated: false };
      const record = { who, accountKey: identity, held: false }; cloud.authReads.push(record);
      if (cloud.holdAuth?.who === who && !cloud.holdAuth.consumed) {
        cloud.holdAuth.consumed = true; record.held = true; await cloud.holdAuth.promise;
      }
      return route.fulfill({ json: session });
    });
    await context.route("**/api/avr/ai/chat", route => route.fulfill({ status: 503, json: { ok: false, message: "Provider fixture is intentionally unavailable." } }));
    await context.route("**/api/avr/ai/account/workspace**", async route => {
      const request = route.request();
      if (request.method() === "GET") {
        cloud.reads.push({ who, revision: cloud.revision });
        if (cloud.holdRead?.who === who) await cloud.holdRead.promise;
        return route.fulfill({ json: { ok: true, accountKey: cloud.accountKey, documents: { files: { revision: cloud.revision, schemaVersion: 3, data: structuredClone(cloud.data) }, instruction: { revision: 0, data: null } } } });
      }
      const body = request.postDataJSON(), record = { who, body: structuredClone(body), accepted: false };
      cloud.writes.push(record);
      if (cloud.holdPut?.who === who) await cloud.holdPut.promise;
      if (request.method() !== "PUT" || body.expectedAccountKey !== cloud.accountKey || body.baseRevision !== cloud.revision) {
        return route.fulfill({ status: 409, json: { ok: false, code: body.expectedAccountKey !== cloud.accountKey ? "account_workspace_account_mismatch" : "account_data_revision_conflict" } });
      }
      cloud.data = structuredClone(body.data); cloud.revision++; record.accepted = true;
      return route.fulfill({ json: { ok: true, document: { revision: cloud.revision, schemaVersion: 3 } } });
    });
  }
  const [a, b] = await Promise.all(contexts.map(context => context.newPage()));
  for (const page of [a, b]) page.on("pageerror", error => errors.push(error.message));
  const open = async page => { await page.goto(origin + "/avr"); await expect(page.locator("#projectChatInput")).toBeVisible(); };
  await open(a);
  await a.evaluate(project => window.UartDebugAvrMiniProjects.install(project), definition("Primary"));
  await a.locator("#projectChatInput").fill("Original planning draft.");
  await expect.poll(() => state(a).then(value => JSON.stringify(value))).toContain("Original planning draft.");
  const baseline = await state(a);
  cloud.data = structuredClone(baseline); cloud.authenticated = true;
  const marker = { schemaVersion: 5, accountKey, revision: 5, dirty: false, conflict: false, legacyInstructionRevision: null };
  await a.evaluate(({ workspaceKey, syncKey, dirtyKey, marker }) => {
    const localCheckpoint = JSON.parse(localStorage.getItem(workspaceKey)).localCheckpoint;
    localStorage.setItem(syncKey, JSON.stringify({ ...marker, localCheckpoint }));
    localStorage.setItem(dirtyKey, JSON.stringify({ schemaVersion: 5, localCheckpoint, dirty: false }));
  }, { workspaceKey, syncKey, dirtyKey, marker });
  await b.addInitScript(({ workspaceKey, syncKey, dirtyKey, marker, baseline }) => {
    if (localStorage.getItem(workspaceKey) !== null) return;
    const localCheckpoint = crypto.randomUUID();
    localStorage.setItem(workspaceKey, JSON.stringify({ ...baseline, localCheckpoint }));
    localStorage.setItem(syncKey, JSON.stringify({ ...marker, localCheckpoint }));
    localStorage.setItem(dirtyKey, JSON.stringify({ schemaVersion: 5, localCheckpoint, dirty: false }));
  }, { workspaceKey, syncKey, dirtyKey, marker, baseline });
  await a.reload(); await open(b); await Promise.all([clean(a, 5), clean(b, 5)]);
  expect(cloud.writes).toEqual([]);
  return { a, b, cloud, errors, baseline, async close() {
    cloud.holdRead?.resolve(); cloud.holdPut?.resolve(); cloud.holdAuth?.resolve(); cloud.templateGate?.resolve();
    await Promise.all(contexts.map(context => context.close())); await new Promise(resolve => server.close(resolve));
  } };
}

const state = page => page.evaluate(key => {
  const envelope = JSON.parse(localStorage.getItem(key));
  if (!envelope) return null;
  // This checkpoint belongs to this browser only. Every business field remains compared.
  const { localCheckpoint: _checkpoint, ...business } = envelope;
  return business;
}, workspaceKey);
const marker = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), syncKey);
const project = value => Object.values(value.miniProjects)[0];
async function clean(page, revision, expectedAccount = accountKey) {
  await expect.poll(async () => {
    const value = await marker(page), checkpoint = await page.evaluate(key => JSON.parse(localStorage.getItem(key)).localCheckpoint, workspaceKey);
    return [value?.accountKey, value?.revision, value?.dirty, value?.conflict,
      value?.schemaVersion === 5 && !!checkpoint && value.localCheckpoint === checkpoint];
  }).toEqual([expectedAccount, revision, false, false, true]);
  await expect(page.locator("#siteDialog")).toBeHidden();
}
async function synced(page, cloud) {
  await expect.poll(async () => {
    const value = await state(page), saved = await marker(page);
    const active = Object.values(value.miniProjects).find(item => Object.values(item.files).includes(value.current));
    const collection = active?.conversation || value.draftConversation;
    const draft = collection?.threads.find(thread => thread.id === collection.activeThreadId)?.draft || "";
    const checkpoint = await page.evaluate(key => JSON.parse(localStorage.getItem(key)).localCheckpoint, workspaceKey);
    return saved?.accountKey === cloud.accountKey && saved?.revision === cloud.revision && !saved?.dirty && !saved?.conflict &&
      saved?.schemaVersion === 5 && !!checkpoint && saved.localCheckpoint === checkpoint &&
      JSON.stringify(value) === JSON.stringify(cloud.data) && draft === await page.locator("#projectChatInput").inputValue();
  }).toBe(true);
  await expect(page.locator("#siteDialog")).toBeHidden();
}
async function reloadInto(page, cloud) {
  const authoritative = structuredClone(cloud.data), revision = cloud.revision, writes = cloud.writes.length;
  await page.reload(); await clean(page, revision); await synced(page, cloud);
  expect(await state(page)).toEqual(authoritative);
  expect(cloud.data).toEqual(authoritative);
  expect(cloud.revision).toBe(revision);
  expect(cloud.writes).toHaveLength(writes);
}
async function mutateAll(page, label) {
  await page.evaluate(label => {
    const append = (selector, text) => { const cm = document.querySelector(selector).CodeMirror; cm.replaceRange(text, { line: cm.lastLine(), ch: cm.getLine(cm.lastLine()).length }, null, "+input"); };
    append("#editorHost .CodeMirror", "\n// " + label + " source");
    append("#projectDocumentationScroll .CodeMirror", "\n" + label + " description");
    append("#projectInstructionDropZone .CodeMirror", "\n" + label + " requirements");
    const input = document.querySelector("#projectChatInput"); input.value = label + " chat draft"; input.dispatchEvent(new Event("input", { bubbles: true }));
  }, label);
}
async function assertRendered(page, value) {
  const active = Object.values(value.miniProjects).find(item => Object.values(item.files).includes(value.current));
  expect(await page.locator("#editorHost .CodeMirror").evaluate(element => element.CodeMirror.getValue())).toBe(value.files[value.current] || "");
  expect(await page.locator("#projectInstructionDropZone .CodeMirror").evaluate(element => element.CodeMirror.getValue())).toBe(active?.canvas.markdown || value.draftCanvas.markdown);
  expect(await page.locator("#projectDocumentationScroll .CodeMirror").evaluate(element => element.CodeMirror.getValue())).toBe(active ? value.files[active.files.guide] : "");
  const conversation = active?.conversation || value.draftConversation;
  const draft = conversation?.threads.find(thread => thread.id === conversation.activeThreadId)?.draft || "";
  await expect(page.locator("#projectChatInput")).toHaveValue(draft);
  await expect(page.locator("#projectChatProjectName")).toHaveText(active?.displayName || active?.title || "New project");
}
async function chooseProject(page, source) {
  await page.locator("#filesOpenBtn").click();
  await page.locator(`#fileList [data-file="${source}"]`).click();
  await expect(page.locator("#filesModal")).toBeHidden();
}
async function projectAction(page, source, action) {
  await page.locator("#filesOpenBtn").click();
  await page.locator(`#fileList [data-file="${source}"] .file-menu-btn`).click();
  await page.locator(`#fileContextMenu [data-action="${action}"]`).click();
}
async function removeProject(page, source) {
  await projectAction(page, source, "delete"); await page.locator("#siteDialogConfirmBtn").click(); await page.keyboard.press("Escape");
}
async function snapshot(testInfo, name, pair) {
  const checkpoints = await Promise.all([pair.a, pair.b].map(page => page.evaluate(key => JSON.parse(localStorage.getItem(key))?.localCheckpoint, workspaceKey)));
  fs.writeFileSync(testInfo.outputPath(name + ".json"), JSON.stringify({ a: await state(pair.a), b: await state(pair.b), checkpoints, cloud: pair.cloud, errors: pair.errors }, null, 2));
  await pair.a.screenshot({ path: testInfo.outputPath(name + "-browser-a.png") });
  await pair.b.screenshot({ path: testInfo.outputPath(name + "-browser-b.png") });
}

test("aggregate project fields, inactive projects and synchronized selection round-trip through two browsers", async ({ browser }, testInfo) => {
  const p = await pair(browser);
  try {
    await p.a.evaluate(async () => {
      const item = window.UartDebugAvrMiniProjects.getInstances()[0];
      const yaml = item.files.find(file => file.role === "specification");
      await window.UartDebugAvrMiniProjects.updateInstance(item.instanceId, { files: [{ ...yaml, content: yaml.content + "# Updated internal YAML specification\n" }] });
    });
    await mutateAll(p.a, "Browser A"); await synced(p.a, p.cloud);
    await p.a.evaluate(project => window.UartDebugAvrMiniProjects.install(project), definition("Secondary"));
    await mutateAll(p.a, "Inactive source owner"); await synced(p.a, p.cloud);
    await chooseProject(p.a, "Primary.c"); await synced(p.a, p.cloud);
    await reloadInto(p.b, p.cloud); await assertRendered(p.b, p.cloud.data);
    expect(JSON.stringify(p.cloud.data)).toContain("Inactive source owner description");
    expect(JSON.stringify(p.cloud.data)).toContain("Browser A requirements");
    expect(JSON.stringify(p.cloud.data)).toContain("Updated internal YAML specification");
    expect(project(p.cloud.data).projectDocuments).toEqual(definition("Primary").projectDocuments);
    await projectAction(p.b, "Primary.c", "rename");
    await p.b.locator(".file-inline-input").fill("Renamed Primary"); await p.b.locator(".file-inline-input").press("Enter"); await p.b.keyboard.press("Escape");
    await snapshot(testInfo, "immediately-after-rename", p);
    await expect(p.b.locator("#projectChatProjectName")).toHaveText("Renamed Primary");
    await mutateAll(p.b, "Browser B"); await synced(p.b, p.cloud);
    await reloadInto(p.a, p.cloud); await assertRendered(p.a, p.cloud.data);
    await snapshot(testInfo, "aggregate-round-trip", p); expect(p.errors).toEqual([]);
  } finally { await p.close(); }
});

async function beginAccountReplacement(p, page) {
  const incoming = structuredClone(p.baseline);
  project(incoming).displayName = "Incoming Primary";
  incoming.files[incoming.current] = "// Authoritative incoming account source\n";
  incoming.authorship[incoming.current].lines = incoming.files[incoming.current].split("\n").map(() => "original");
  project(incoming).canvas.markdown = "# Incoming account requirements";
  project(incoming).canvas.authorship.lines = ["original"];
  p.cloud.accountKey = "different-incoming-account"; p.cloud.revision = 40; p.cloud.data = incoming;
  // An old browser's next legitimate save discovers that the server account changed.
  await page.locator("#editorHost .CodeMirror").evaluate(element => element.CodeMirror.replaceRange("// Outgoing change retained in recovery\n", { line: 0, ch: 0 }, null, "+input"));
  return incoming;
}
async function replaceAccount(p, page) {
  const incoming = await beginAccountReplacement(p, page);
  await expect.poll(() => marker(page).then(value => value?.accountKey)).toBe("different-incoming-account");
  await clean(page, 40, "different-incoming-account"); await assertRendered(page, incoming);
  return incoming;
}

for (const kind of ["template", "zip"]) {
  test(`a held ${kind} import from an outgoing account cannot install into its replacement`, async ({ browser }, testInfo) => {
    const p = await pair(browser);
    try {
      if (kind === "template") {
        p.cloud.templateGate = deferred();
        await p.a.locator("#filesOpenBtn").click();
        await p.a.locator('#fileTemplateGrid [data-template-id="held-template"]').click();
        await expect.poll(() => p.cloud.templateRequests).toBe(1);
      } else {
        await p.a.evaluate(() => {
          const read = File.prototype.arrayBuffer;
          const gate = new Promise(resolve => { window.__releaseZipRead = resolve; });
          File.prototype.arrayBuffer = async function () { if (this.name === "Held.zip") { window.__zipReadStarted = true; await gate; } return read.call(this); };
        });
        await p.a.locator("#fileUploadInput").setInputFiles({ name: "Held.zip", mimeType: "application/zip", buffer: Buffer.from(archive.createProjectArchive(definition("Held ZIP"))) });
        await p.a.waitForFunction(() => window.__zipReadStarted);
      }
      const incoming = await replaceAccount(p, p.a);
      if (kind === "template") { p.cloud.templateGate.resolve(); p.cloud.templateGate = null; await expect(p.a.locator('#fileTemplateGrid [data-template-id="held-template"]')).toBeEnabled(); }
      else { await p.a.evaluate(() => window.__releaseZipRead()); await expect(p.a.locator("#fileUploadInput")).toHaveValue(""); }
      await p.a.waitForTimeout(1000);
      await snapshot(testInfo, `held-${kind}-after-account-replacement`, p);
      expect(await state(p.a)).toEqual(incoming);
      expect(p.cloud.data).toEqual(incoming);
      expect(p.cloud.writes.filter(item => item.accepted && item.body.expectedAccountKey === "different-incoming-account")).toEqual([]);
      const recovery = await p.a.evaluate(account => JSON.parse(localStorage.getItem("ud_avr_ai_files_recovery_v1:" + account)), accountKey);
      expect(JSON.stringify(recovery.data)).toContain("Outgoing change retained in recovery");
      expect(p.errors).toEqual([]);
    } finally { await p.close(); }
  });
}

test("an uncommitted project rename cannot act on a replacement with the same instance id", async ({ browser }, testInfo) => {
  const p = await pair(browser);
  try {
    await projectAction(p.a, "Primary.c", "rename");
    const oldInput = await p.a.locator(".file-inline-input").elementHandle();
    await p.a.locator(".file-inline-input").fill("Stale outgoing rename");
    const incoming = await replaceAccount(p, p.a);
    await snapshot(testInfo, "stale-rename-after-replacement", p);
    await expect(p.a.locator(".file-inline-input")).toHaveCount(0);
    await oldInput.dispatchEvent("keydown", { key: "Enter", bubbles: true });
    await p.a.waitForTimeout(1000);
    expect(await state(p.a)).toEqual(incoming); expect(p.cloud.data).toEqual(incoming);
    expect(project(await state(p.a)).displayName).toBe("Incoming Primary");
    expect(p.errors).toEqual([]);
  } finally { await p.close(); }
});

test("a held old auth response cannot relabel or reconnect an incoming account after mismatch recovery", async ({ browser }, testInfo) => {
  const p = await pair(browser);
  try {
    p.cloud.holdAuth = { who: "A", ...deferred() };
    await p.a.locator("#projectChatInput").fill("Check the current session.");
    await p.a.locator("#projectChatSendBtn").click();
    await expect.poll(() => p.cloud.authReads.some(item => item.who === "A" && item.held && item.accountKey === accountKey)).toBe(true);
    const incoming = await beginAccountReplacement(p, p.a);
    await expect.poll(() => p.cloud.writes.some(item => item.who === "A" && item.body.expectedAccountKey === accountKey)).toBe(true);
    await expect(p.a.locator(".notification-toast").filter({ hasText: "Google account changed" })).toBeVisible();
    p.cloud.holdAuth.resolve(); p.cloud.holdAuth = null;
    await expect.poll(() => marker(p.a).then(value => value?.accountKey)).toBe("different-incoming-account");
    await clean(p.a, 40, "different-incoming-account");
    await expect(p.a.locator("#projectAiAccountBtn")).toHaveAttribute("aria-label", "Open AI account: Incoming Account");
    await expect(p.a.locator(".project-ai-account-trigger-label")).toHaveText("Incoming Account");
    await p.a.waitForTimeout(1000); await assertRendered(p.a, incoming);
    expect(await state(p.a)).toEqual(incoming); expect(p.cloud.data).toEqual(incoming);
    expect(p.cloud.writes.filter(item => item.accepted && item.body.expectedAccountKey === "different-incoming-account")).toEqual([]);
    const recovery = await p.a.evaluate(account => JSON.parse(localStorage.getItem("ud_avr_ai_files_recovery_v1:" + account)), accountKey);
    expect(JSON.stringify(recovery.data)).toContain("Outgoing change retained in recovery");
    expect(JSON.stringify(recovery.data)).toContain("Check the current session.");
    await snapshot(testInfo, "old-auth-response-ignored", p); expect(p.errors).toEqual([]);
  } finally { await p.close(); }
});

test("project ZIP/create/delete lifecycle reaches an empty workspace without reviving old files or drafts", async ({ browser }, testInfo) => {
  const p = await pair(browser);
  try {
    await p.a.locator("#filesOpenBtn").click(); await p.a.locator("#createEmptyProjectCard").click();
    await synced(p.a, p.cloud);
    await p.a.locator("#fileUploadInput").setInputFiles({ name: "Imported.zip", mimeType: "application/zip", buffer: Buffer.from(archive.createProjectArchive(definition("Imported"))) });
    await expect.poll(() => state(p.a).then(value => Object.values(value.miniProjects).some(item => item.title === "Imported"))).toBe(true);
    await synced(p.a, p.cloud); await reloadInto(p.b, p.cloud); await assertRendered(p.b, p.cloud.data);
    const sources = Object.values((await state(p.a)).miniProjects).map(item => item.files.source);
    for (const source of sources) await removeProject(p.a, source);
    await synced(p.a, p.cloud); expect(p.cloud.data.files).toEqual({}); expect(p.cloud.data.miniProjects).toEqual({});
    await reloadInto(p.b, p.cloud); await assertRendered(p.b, p.cloud.data);
    await p.b.evaluate(() => window.UartDebugAvrAiWorkspace.setInstruction("# Unassigned requirements retained"));
    await p.b.locator("#projectChatInput").fill("Unassigned draft retained"); await synced(p.b, p.cloud);
    await reloadInto(p.a, p.cloud); await assertRendered(p.a, p.cloud.data);
    await p.a.evaluate(() => window.UartDebugAvrAiWorkspace.setInstruction("")); await p.a.locator("#projectChatInput").fill(""); await synced(p.a, p.cloud);
    await reloadInto(p.b, p.cloud); await assertRendered(p.b, p.cloud.data);
    expect(p.cloud.data.draftCanvas.markdown).toBe(""); expect(p.cloud.data.files).toEqual({});
    await snapshot(testInfo, "empty-after-lifecycle", p); expect(p.errors).toEqual([]);
  } finally { await p.close(); }
});

test("all queued edit producers survive delayed hydration in recovery and cannot overwrite the chosen cloud copy", async ({ browser }, testInfo) => {
  const p = await pair(browser);
  try {
    await mutateAll(p.a, "New cloud"); await synced(p.a, p.cloud); const remote = structuredClone(p.cloud.data);
    p.cloud.holdRead = { who: "B", ...deferred() }; const oldReads = p.cloud.reads.length;
    await p.b.reload(); await expect.poll(() => p.cloud.reads.length).toBeGreaterThan(oldReads);
    await mutateAll(p.b, "Pending local"); p.cloud.holdRead.resolve(); p.cloud.holdRead = null;
    await expect(p.b.locator("#siteDialogTitle")).toHaveText("Cloud sync conflict: Projects");
    expect(p.cloud.data).toEqual(remote); expect(p.cloud.writes.filter(item => item.who === "B")).toEqual([]);
    await p.b.locator("#siteDialogConfirmBtn").click(); await clean(p.b, p.cloud.revision);
    const recovery = await p.b.evaluate(account => JSON.parse(localStorage.getItem("ud_avr_ai_files_recovery_v1:" + account)), accountKey);
    for (const field of ["source", "description", "requirements", "chat draft"]) expect(JSON.stringify(recovery.data)).toContain("Pending local " + field);
    await p.b.waitForTimeout(1000); await synced(p.b, p.cloud); await assertRendered(p.b, remote);
    expect(p.cloud.data).toEqual(remote);
    await mutateAll(p.b, "After adoption"); await synced(p.b, p.cloud); await reloadInto(p.a, p.cloud);
    expect(JSON.stringify(p.cloud.data)).not.toContain("Pending local");
    await snapshot(testInfo, "queued-edits-recovered", p); expect(p.errors).toEqual([]);
  } finally { await p.close(); }
});

test("a held stale save is rejected after another browser advances the shared cloud revision", async ({ browser }, testInfo) => {
  const p = await pair(browser);
  try {
    p.cloud.holdPut = { who: "A", ...deferred() }; await mutateAll(p.a, "Stale A");
    await expect.poll(() => p.cloud.writes.filter(item => item.who === "A").length).toBe(1);
    await mutateAll(p.b, "Winner B"); await synced(p.b, p.cloud); const remote = structuredClone(p.cloud.data);
    p.cloud.holdPut.resolve(); p.cloud.holdPut = null;
    await expect.poll(() => marker(p.a).then(value => value?.conflict)).toBe(true);
    expect(p.cloud.data).toEqual(remote); expect(p.cloud.writes.find(item => item.who === "A").accepted).toBe(false);
    expect(JSON.stringify(await state(p.a))).toContain("Stale A source");
    await p.a.reload(); await expect(p.a.locator("#siteDialogTitle")).toHaveText("Cloud sync conflict: Projects");
    await p.a.locator("#siteDialogConfirmBtn").click(); await clean(p.a, p.cloud.revision); await assertRendered(p.a, remote);
    const recovery = await p.a.evaluate(account => JSON.parse(localStorage.getItem("ud_avr_ai_files_recovery_v1:" + account)), accountKey);
    for (const field of ["source", "description", "requirements", "chat draft"]) expect(JSON.stringify(recovery.data)).toContain("Stale A " + field);
    await p.a.waitForTimeout(1000); await synced(p.a, p.cloud); expect(p.cloud.data).toEqual(remote);
    await snapshot(testInfo, "stale-save-rejected", p); expect(p.errors).toEqual([]);
  } finally { await p.close(); }
});
