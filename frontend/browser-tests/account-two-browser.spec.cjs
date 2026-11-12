"use strict";

const { test, expect } = require("playwright/test");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const workspaceKey = "ud_avr_programming_state_v6";
const syncKey = "ud_avr_ai_account_sync_v1";
const dirtyKey = "ud_avr_ai_local_dirty_v1";
const accountKey = "shared-two-browser-account";
const publicRoot = path.resolve(__dirname, "../../public");

async function startApp() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    const json = data => { res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(data)); };
    if (url.pathname === "/api/avr/ai/status") return json({ ok: true, enabled: true, configured: true, ready: true,
      knowledge: { devices: [{ mcu: "ATtiny1624", packages: ["SOIC-14", "TSSOP-14"] }] } });
    if (url.pathname === "/api/avr/ai/projects") return json({ ok: true, projects: [] });
    if (url.pathname.startsWith("/api/")) { res.statusCode = 404; return res.end("Unknown fixture API"); }
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
  return { origin: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => server.close(resolve)) };
}

async function connectCloud(context, cloud, browserName) {
  await context.route("**/api/avr/ai/auth/session", route => route.fulfill({ json: cloud.authenticated ? {
    ok: true, mode: "google", configured: true, authEnabled: true, authRequired: true, authenticated: true,
    accountKey, user: { displayName: "Shared browser regression", emailMasked: "t***@example.test" }, quota: { unlimited: true },
  } : { ok: true, mode: "google", configured: false, authenticated: false } }));
  await context.route("**/api/avr/ai/account/workspace**", async route => {
    const request = route.request();
    if (request.method() === "GET") {
      cloud.reads.push({ browser: browserName, revision: cloud.revision });
      return route.fulfill({ json: { ok: true, accountKey, documents: {
        files: { revision: cloud.revision, schemaVersion: 3, data: structuredClone(cloud.data) }, instruction: { revision: 0, data: null },
      } } });
    }
    const body = request.postDataJSON();
    cloud.writes.push({ browser: browserName, ...structuredClone(body) });
    if (request.method() !== "PUT" || body.expectedAccountKey !== accountKey || body.baseRevision !== cloud.revision) {
      return route.fulfill({ status: 409, json: { ok: false, code: "account_data_revision_conflict" } });
    }
    cloud.data = structuredClone(body.data);
    cloud.revision += 1;
    return route.fulfill({ json: { ok: true, document: { revision: cloud.revision, schemaVersion: 3 } } });
  });
  await context.route("**/api/avr/ai/chat", route => {
    const request = route.request().postDataJSON();
    return route.fulfill({ json: { ok: true, kind: "chat", stage: "chat", baseRevision: request.canvas.revision,
      message: request.message.includes("original") ? "Original saved response." : "New completed response from browser A." } });
  });
}

const workspace = page => page.evaluate(key => {
  const { localCheckpoint: _checkpoint, ...business } = JSON.parse(localStorage.getItem(key));
  return business;
}, workspaceKey);
const syncState = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), syncKey);
const chats = (state, selectedProject) => selectedProject ? Object.values(state.miniProjects)[0].conversation : state.draftConversation;

async function open(page, origin) {
  await page.goto(origin + "/avr");
  await expect(page).toHaveTitle("AVR Programming - Uart Debug");
  await expect(page.locator("#projectChatInput")).toBeVisible();
}

async function cleanAt(page, revision) {
  await expect.poll(async () => {
    const marker = await syncState(page);
    const checkpoint = await page.evaluate(key => JSON.parse(localStorage.getItem(key)).localCheckpoint, workspaceKey);
    return { accountKey: marker?.accountKey, revision: marker?.revision, dirty: marker?.dirty, conflict: marker?.conflict,
      bound: marker?.schemaVersion === 5 && !!checkpoint && marker.localCheckpoint === checkpoint };
  }).toEqual({ accountKey, revision, dirty: false, conflict: false, bound: true });
  await expect(page.locator("#siteDialog")).toBeHidden();
}

async function send(page, text, answer) {
  await page.locator("#projectChatInput").fill(text);
  await page.locator("#projectChatSendBtn").click();
  await expect(page.locator('.project-chat-message[data-role="assistant"]').last()).toContainText(answer);
  await expect(page.locator("#projectChatSendBtn")).toHaveAttribute("aria-label", "Send message");
}

for (const selectedProject of [true, false]) {
  test(`a second browser adopts deleted/new chats after reload in ${selectedProject ? "the selected project" : "the unassigned draft"}`, async ({ browser }, testInfo) => {
    const app = await startApp();
    const contexts = await Promise.all([browser.newContext({ serviceWorkers: "block" }), browser.newContext({ serviceWorkers: "block" })]);
    const cloud = { authenticated: false, data: null, revision: 5, reads: [], writes: [] };
    const evidence = { scope: selectedProject ? "project" : "draft" };
    try {
      await Promise.all(contexts.map((context, index) => connectCloud(context, cloud, index === 0 ? "A" : "B")));
      const [a, b] = await Promise.all(contexts.map(context => context.newPage()));
      const pageErrors = [];
      for (const page of [a, b]) page.on("pageerror", error => pageErrors.push(error.message));
      await open(a, app.origin);
      if (selectedProject) {
        await a.locator("#filesOpenBtn").click();
        await a.locator("#createEmptyProjectCard").click();
        await expect(a.locator("#filesModal")).toBeHidden();
      }
      await send(a, "Explain the original chat.", "Original saved response.");
      const baseline = await workspace(a);
      const deletedId = chats(baseline, selectedProject).activeThreadId;
      cloud.data = structuredClone(baseline);
      cloud.authenticated = true;
      const marker = { schemaVersion: 5, accountKey, revision: 5, dirty: false, conflict: false, legacyInstructionRevision: null };
      await a.evaluate(({ workspaceKey, syncKey, dirtyKey, marker }) => {
        const localCheckpoint = JSON.parse(localStorage.getItem(workspaceKey)).localCheckpoint;
        localStorage.setItem(syncKey, JSON.stringify({ ...marker, localCheckpoint }));
        localStorage.setItem(dirtyKey, JSON.stringify({ schemaVersion: 5, localCheckpoint, dirty: false }));
      }, { workspaceKey, syncKey, dirtyKey, marker });
      await b.addInitScript(({ workspaceKey, syncKey, dirtyKey, baseline, marker }) => {
        if (localStorage.getItem(workspaceKey) !== null) return;
        const localCheckpoint = crypto.randomUUID();
        localStorage.setItem(workspaceKey, JSON.stringify({ ...baseline, localCheckpoint }));
        localStorage.setItem(syncKey, JSON.stringify({ ...marker, localCheckpoint }));
        localStorage.setItem(dirtyKey, JSON.stringify({ schemaVersion: 5, localCheckpoint, dirty: false }));
      }, { workspaceKey, syncKey, dirtyKey, baseline, marker });
      await a.reload();
      await open(b, app.origin);
      await Promise.all([cleanAt(a, 5), cleanAt(b, 5)]);
      expect(cloud.writes).toEqual([]);
      evidence.before = { a: await workspace(a), b: await workspace(b), cloud: structuredClone(cloud.data) };

      await a.locator("#projectChatActionsBtn").click();
      await a.locator('#projectChatMenu [data-chat-action="delete"]').click();
      await expect(a.locator("#siteDialogTitle")).toHaveText("Delete chat");
      await a.locator("#siteDialogConfirmBtn").click();
      await a.locator("#projectChatNewBtn").click();
      await send(a, "Explain the new request.", "New completed response from browser A.");
      await expect.poll(() => JSON.stringify(cloud.data)).toContain("New completed response from browser A.");
      await cleanAt(a, cloud.revision);
      const remoteChats = structuredClone(chats(cloud.data, selectedProject));
      expect(remoteChats.threads.some(thread => thread.id === deletedId)).toBe(false);
      evidence.afterA = { a: await workspace(a), b: await workspace(b), cloud: structuredClone(cloud.data), revision: cloud.revision };

      await b.reload();
      await cleanAt(b, cloud.revision);
      evidence.afterB = { b: await workspace(b), sync: await syncState(b), cloud: structuredClone(cloud.data),
        renderedText: await b.locator("#projectChatThread").innerText(),
        controller: await b.evaluate(() => window.UartDebugAvrAiWorkspace.getConversation()),
        workspaceChats: await b.evaluate(() => window.UartDebugAvrAiWorkspace.getChats()),
        reads: structuredClone(cloud.reads), writes: structuredClone(cloud.writes) };
      await b.screenshot({ path: testInfo.outputPath("browser-b-after-cloud-reload.png") });
      fs.writeFileSync(testInfo.outputPath("two-browser-state.json"), JSON.stringify(evidence, null, 2));
      await expect(b.locator("#projectChatThread")).toContainText("New completed response from browser A.");
      await expect(b.locator("#projectChatThread")).not.toContainText("Original saved response.");
      expect(chats(await workspace(b), selectedProject)).toEqual(remoteChats);
      expect(cloud.writes.filter(write => write.browser === "B")).toEqual([]);

      await b.locator("#projectChatInput").fill("Browser B draft belongs to the new conversation.");
      await expect.poll(() => {
        const conversation = chats(cloud.data, selectedProject);
        return conversation.threads.find(thread => thread.id === conversation.activeThreadId)?.draft;
      }).toBe("Browser B draft belongs to the new conversation.");
      await cleanAt(b, cloud.revision);
      const afterEdit = structuredClone(chats(cloud.data, selectedProject));
      expect(afterEdit.threads.some(thread => thread.id === deletedId)).toBe(false);
      expect(JSON.stringify(afterEdit)).toContain("New completed response from browser A.");
      expect(JSON.stringify(afterEdit)).not.toContain("Original saved response.");
      await a.reload();
      await cleanAt(a, cloud.revision);
      await expect(a.locator("#projectChatInput")).toHaveValue("Browser B draft belongs to the new conversation.");
      await expect(a.locator("#projectChatThread")).toContainText("New completed response from browser A.");
      expect(chats(await workspace(a), selectedProject)).toEqual(afterEdit);
      evidence.afterBEditAndAReload = { a: await workspace(a), b: await workspace(b), cloud: structuredClone(cloud.data), revision: cloud.revision };
      fs.writeFileSync(testInfo.outputPath("two-browser-state.json"), JSON.stringify(evidence, null, 2));
      expect(pageErrors).toEqual([]);
    } finally {
      if (!evidence.afterB) fs.writeFileSync(testInfo.outputPath("two-browser-state.json"), JSON.stringify({ ...evidence, cloud }, null, 2));
      await Promise.all(contexts.map(context => context.close()));
      await app.close();
    }
  });
}
