"use strict";

const { test, expect } = require("playwright/test");
const fs = require("node:fs");

const accountKey = "browser-sync-regression-account";
const workspaceKey = "ud_avr_programming_state_v3";
const syncKey = "ud_avr_ai_account_sync_v1";
const dirtyKey = "ud_avr_ai_local_dirty_v1";

test.beforeEach(async ({ page }) => {
  page.__syncErrors = [];
  page.on("pageerror", error => page.__syncErrors.push(error.message));
  page.on("console", message => { if (message.type() === "error") page.__syncErrors.push(message.text()); });
});
test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus && page.__syncCloud) {
    const local = await readWorkspace(page).catch(() => null);
    const evidence = testInfo.outputPath("sync-state.json");
    fs.writeFileSync(evidence, JSON.stringify({
      initial: page.__syncCloud.initial, cloud: page.__syncCloud.data, writes: page.__syncCloud.writes,
      local, sync: await readSync(page).catch(() => null),
    }, null, 2));
    await testInfo.attach("sync-state", { contentType: "application/json", path: evidence });
  }
  expect(page.__syncErrors).toEqual([]);
});

async function open(page) {
  await page.goto("/avr", { waitUntil: "load" });
  await expect(page).toHaveTitle("AVR Programming - Uart Debug");
  await page.waitForFunction(() => window.UartDebugAvrAiWorkspace && window.UartDebugAvrMiniProjects);
  await expect(page.locator("#projectChatInput")).toBeVisible();
}

async function readWorkspace(page) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)), workspaceKey);
}

async function readSync(page) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)), syncKey);
}

async function seedProject(page) {
  await open(page);
  await page.evaluate(async () => {
    const { project } = await (await fetch("/api/avr/ai/projects/motion-example")).json();
    await window.UartDebugAvrMiniProjects.install(project);
    window.UartDebugAvrAiWorkspace.setInstruction("# Saved project requirements\n\nKeep the output disabled at startup.");
  });
  await page.locator("#projectChatInput").fill("Keep the project planning draft.");
  await expect.poll(async () => {
    const state = await readWorkspace(page);
    return Object.values(state.miniProjects)[0]?.conversation?.threads[0]?.draft;
  }).toBe("Keep the project planning draft.");
  await page.waitForTimeout(300);
  return readWorkspace(page);
}

async function setSyncMarker(page, revision, { dirty = false, conflict = false } = {}) {
  await page.evaluate(({ syncKey, dirtyKey, accountKey, revision, dirty, conflict }) => {
    localStorage.setItem(syncKey, JSON.stringify({ schemaVersion: 4, accountKey, revision, dirty, conflict, legacyInstructionRevision: null }));
    localStorage.setItem(dirtyKey, JSON.stringify({ schemaVersion: 4, dirty }));
  }, { syncKey, dirtyKey, accountKey, revision, dirty, conflict });
}

async function mockCloud(page, data, revision = 5) {
  const cloud = { initial: structuredClone(data), data: structuredClone(data), revision, writes: [], reads: 0, readDelay: 0, readGate: null };
  page.__syncCloud = cloud;
  await page.route("**/api/avr/ai/auth/session", route => route.fulfill({ json: {
    ok: true, mode: "google", configured: true, authEnabled: true, authRequired: true,
    authenticated: true, accountKey, user: { displayName: "Sync regression", emailMasked: "s***@example.test" },
    quota: { unlimited: true },
  } }));
  await page.route("**/api/avr/ai/account/workspace**", async route => {
    const request = route.request();
    if (request.method() === "GET") {
      cloud.reads += 1;
      if (cloud.readGate) await cloud.readGate;
      if (cloud.readDelay) await new Promise(resolve => setTimeout(resolve, cloud.readDelay));
      return route.fulfill({ json: { ok: true, accountKey, documents: {
        files: { revision: cloud.revision, schemaVersion: 3, data: structuredClone(cloud.data) },
        instruction: { revision: 0, data: null },
      } } });
    }
    expect(request.method()).toBe("PUT");
    expect(new URL(request.url()).pathname).toBe("/api/avr/ai/account/workspace/files");
    const body = request.postDataJSON();
    cloud.writes.push(body);
    if (body.baseRevision !== cloud.revision || body.expectedAccountKey !== accountKey) {
      return route.fulfill({ status: 409, json: { ok: false, code: "account_data_revision_conflict", message: "The cloud revision changed." } });
    }
    cloud.data = structuredClone(body.data);
    cloud.revision += 1;
    return route.fulfill({ json: { ok: true, document: { revision: cloud.revision, schemaVersion: 3 } } });
  });
  return cloud;
}

async function waitForCleanSync(page, revision) {
  await expect.poll(async () => {
    const state = await readSync(page);
    return { revision: state?.revision, dirty: state?.dirty, conflict: state?.conflict };
  }).toEqual({ revision, dirty: false, conflict: false });
  await expect(page.locator("#siteDialog")).toBeHidden();
}

async function editLocalProject(page) {
  await page.locator("#editorHost .CodeMirror").evaluate(element => {
    const editor = element.CodeMirror;
    editor.replaceRange("// Local code edit survives reload\n", { line: 0, ch: 0 });
  });
  await page.evaluate(() => window.UartDebugAvrAiWorkspace.setInstruction("# Local requirements\n\nKeep this unsynchronized specification."));
  await page.locator("#projectChatInput").fill("Keep this unsynchronized chat draft.");
  await expect.poll(async () => {
    const state = await readWorkspace(page);
    return state.files[state.current]?.startsWith("// Local code edit survives reload");
  }).toBe(true);
  return readWorkspace(page);
}

test("a saved account project stays synchronized through repeated page reloads", async ({ page }, testInfo) => {
  const baseline = await seedProject(page);
  await setSyncMarker(page, 5);
  const cloud = await mockCloud(page, baseline);
  cloud.readDelay = 500;
  for (let reload = 0; reload < 3; reload++) {
    await page.reload({ waitUntil: "load" });
    await waitForCleanSync(page, 5);
    // Observe both the editor's deferred persistence and the sync debounce.
    await page.waitForTimeout(1200);
    await waitForCleanSync(page, 5);
    await expect(page.locator("#projectChatInput")).toHaveValue("Keep the project planning draft.");
  }
  expect(cloud.writes).toEqual([]);
  expect(cloud.data).toEqual(baseline);
  await page.screenshot({ path: testInfo.outputPath("synchronized-after-three-reloads.png") });
});

test("own unsynchronized project edits resume with the unchanged cloud base revision", async ({ page }, testInfo) => {
  const baseline = await seedProject(page);
  const local = await editLocalProject(page);
  await setSyncMarker(page, 5, { dirty: true });
  const cloud = await mockCloud(page, baseline);
  await page.reload({ waitUntil: "load" });
  await expect.poll(() => cloud.writes.length).toBe(1);
  expect(cloud.writes[0].baseRevision).toBe(5);
  expect(cloud.writes[0].expectedAccountKey).toBe(accountKey);
  expect(cloud.data.files[local.current]).toBe(local.files[local.current]);
  const project = Object.values(cloud.data.miniProjects)[0];
  expect(project.canvas.markdown).toContain("Keep this unsynchronized specification.");
  expect(project.conversation.threads[0].draft).toBe("Keep this unsynchronized chat draft.");
  await waitForCleanSync(page, 6);
  await page.reload({ waitUntil: "load" });
  await waitForCleanSync(page, 6);
  await page.waitForTimeout(1200);
  expect(cloud.writes).toHaveLength(1);
  await expect(page.locator("#projectChatInput")).toHaveValue("Keep this unsynchronized chat draft.");
  await page.screenshot({ path: testInfo.outputPath("resumed-local-edits-after-reload.png") });
});

test("identical cloud content acknowledges its newer revision and clears a remembered conflict", async ({ page }) => {
  const baseline = await seedProject(page);
  await setSyncMarker(page, 4, { dirty: true, conflict: true });
  const cloud = await mockCloud(page, baseline, 5);
  await page.reload({ waitUntil: "load" });
  await waitForCleanSync(page, 5);
  await page.waitForTimeout(1200);
  expect(cloud.writes).toEqual([]);
  await page.reload({ waitUntil: "load" });
  await waitForCleanSync(page, 5);
  expect(await readWorkspace(page)).toEqual(baseline);
});

test("a genuinely divergent newer cloud project requires a choice and preserves both copies", async ({ page }, testInfo) => {
  const baseline = await seedProject(page);
  const local = await editLocalProject(page);
  const remote = structuredClone(baseline);
  remote.files[remote.current] = "// Different cloud code\n" + remote.files[remote.current];
  await setSyncMarker(page, 5, { dirty: true });
  const cloud = await mockCloud(page, remote, 6);
  await page.reload({ waitUntil: "load" });
  await expect(page.locator("#siteDialogTitle")).toHaveText("Cloud sync conflict: Projects");
  await expect(page.locator("#siteDialog")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("genuine-cloud-conflict.png") });
  await page.locator("#siteDialogCancelBtn").click();
  await page.waitForTimeout(1200);
  expect(cloud.writes).toEqual([]);
  expect(cloud.data).toEqual(remote);
  expect((await readWorkspace(page)).files[local.current]).toBe(local.files[local.current]);
  await page.reload({ waitUntil: "load" });
  await expect(page.locator("#siteDialog")).toBeVisible();
  await page.locator("#siteDialogConfirmBtn").click();
  await waitForCleanSync(page, 6);
  expect((await readWorkspace(page)).files[remote.current]).toBe(remote.files[remote.current]);
  const recovery = await page.evaluate(account => JSON.parse(localStorage.getItem(`ud_avr_ai_files_recovery_v1:${account}`)), accountKey);
  expect(recovery.data.files[local.current]).toBe(local.files[local.current]);
  expect(Object.values(recovery.data.miniProjects)[0].conversation.threads[0].draft).toBe("Keep this unsynchronized chat draft.");
  await page.reload({ waitUntil: "load" });
  await waitForCleanSync(page, 6);
  await page.waitForTimeout(1200);
  await expect(page.locator("#siteDialog")).toBeHidden();
  expect(cloud.writes).toEqual([]);
});

test("different saved chat branches remain a conflict when project code and canvas match", async ({ page }) => {
  const local = await seedProject(page);
  const conversation = Object.values(local.miniProjects)[0].conversation;
  const thread = conversation.threads[0];
  thread.messages = [
    { id: "branch-question", parentId: null, role: "user", content: "Explain the UART.", createdAt: 1, status: "complete", requestSource: "message" },
    { id: "branch-first", parentId: "branch-question", role: "assistant", content: "First saved response.", createdAt: 2, status: "complete" },
    { id: "branch-second", parentId: "branch-question", role: "assistant", content: "Second saved response.", createdAt: 3, status: "complete" },
  ];
  thread.activeLeafId = "branch-first";
  thread.selectedChildIds = ["branch-question", "branch-first"];
  const remote = structuredClone(local);
  const remoteThread = Object.values(remote.miniProjects)[0].conversation.threads[0];
  remoteThread.activeLeafId = "branch-second";
  remoteThread.selectedChildIds = ["branch-question", "branch-second"];
  await page.addInitScript(({ key, data }) => localStorage.setItem(key, JSON.stringify(data)), { key: workspaceKey, data: local });
  await setSyncMarker(page, 5, { dirty: true });
  const cloud = await mockCloud(page, remote, 6);
  await page.reload({ waitUntil: "load" });
  await expect(page.locator("#siteDialogTitle")).toHaveText("Cloud sync conflict: Projects");
  await expect(page.locator("#siteDialog")).toBeVisible();
  await page.locator("#siteDialogCancelBtn").click();
  await expect(page.locator("#projectChatThread")).toContainText("First saved response.");
  await expect(page.locator("#projectChatThread")).not.toContainText("Second saved response.");
  const saved = await readWorkspace(page);
  expect(Object.values(saved.miniProjects)[0].conversation.threads[0].activeLeafId).toBe("branch-first");
  expect(Object.values(cloud.data.miniProjects)[0].conversation.threads[0].activeLeafId).toBe("branch-second");
  expect(cloud.writes).toEqual([]);
});

test("a queued editor save cannot replace a newer project update in local or cloud storage", async ({ page }) => {
  const baseline = await seedProject(page);
  await setSyncMarker(page, 5);
  const cloud = await mockCloud(page, baseline);
  await page.reload({ waitUntil: "load" });
  await waitForCleanSync(page, 5);
  const updatedSource = "#include <xc.h>\n// New project update must win\nint main(void) { while (1) {} }\n";
  await page.evaluate(async updatedSource => {
    const editor = document.querySelector("#editorHost .CodeMirror").CodeMirror;
    editor.replaceRange("// Superseded pending local edit\n", { line: 0, ch: 0 });
    const project = window.UartDebugAvrMiniProjects.getInstances()[0];
    const source = project.files.find(file => file.role === "source");
    await window.UartDebugAvrMiniProjects.updateInstance(project.instanceId, {
      schemaVersion: 1, id: project.id, title: project.title,
      files: [{ role: "source", name: source.name, content: updatedSource }],
    });
  }, updatedSource);
  await page.waitForTimeout(1200);
  expect(await page.locator("#editorHost .CodeMirror").evaluate(element => element.CodeMirror.getValue())).toBe(updatedSource);
  const local = await readWorkspace(page);
  expect(local.files[local.current]).toBe(updatedSource);
  await expect.poll(() => cloud.data.files[local.current]).toBe(updatedSource);
  expect(cloud.writes.length).toBeGreaterThan(0);
  expect(cloud.writes.every(write => write.data.files[local.current] === updatedSource)).toBe(true);
  await waitForCleanSync(page, cloud.revision);
});

test("a new chat draft after clean account synchronization is saved locally and to the cloud", async ({ page }) => {
  const baseline = await seedProject(page);
  await setSyncMarker(page, 5);
  const cloud = await mockCloud(page, baseline);
  await page.reload({ waitUntil: "load" });
  await expect.poll(() => cloud.reads).toBe(1);
  await waitForCleanSync(page, 5);
  await page.waitForTimeout(1200);
  const nextDraft = "A new planning draft written after account synchronization.";
  await page.locator("#projectChatInput").fill(nextDraft);
  await expect.poll(async () => {
    const state = await readWorkspace(page);
    return Object.values(state.miniProjects)[0].conversation.threads[0].draft;
  }).toBe(nextDraft);
  await expect.poll(() => cloud.writes.length).toBe(1);
  expect(cloud.writes[0].baseRevision).toBe(5);
  expect(Object.values(cloud.data.miniProjects)[0].conversation.threads[0].draft).toBe(nextDraft);
  await waitForCleanSync(page, 6);
  await page.reload({ waitUntil: "load" });
  await waitForCleanSync(page, 6);
  await expect(page.locator("#projectChatInput")).toHaveValue(nextDraft);
  await page.waitForTimeout(1200);
  expect(cloud.writes).toHaveLength(1);
});

test("a chat draft typed while cloud loading is pending survives reconciliation and reload", async ({ page }, testInfo) => {
  const baseline = await seedProject(page);
  await setSyncMarker(page, 5);
  const cloud = await mockCloud(page, baseline);
  let releaseRead;
  cloud.readGate = new Promise(resolve => { releaseRead = resolve; });
  const nextDraft = "Keep the draft typed while the cloud request is pending.";
  try {
    await page.reload({ waitUntil: "load" });
    await expect.poll(() => cloud.reads).toBe(1);
    await page.locator("#projectChatInput").fill(nextDraft);
    await expect.poll(async () => {
      const state = await readWorkspace(page);
      return Object.values(state.miniProjects)[0].conversation.threads[0].draft;
    }).toBe(nextDraft);
  } finally {
    cloud.readGate = null;
    releaseRead();
  }
  await expect.poll(() => cloud.writes.length).toBe(1);
  expect(cloud.writes[0].baseRevision).toBe(5);
  expect(Object.values(cloud.data.miniProjects)[0].conversation.threads[0].draft).toBe(nextDraft);
  await waitForCleanSync(page, 6);
  await expect(page.locator("#projectChatInput")).toHaveValue(nextDraft);
  await page.reload({ waitUntil: "load" });
  await waitForCleanSync(page, 6);
  await expect(page.locator("#projectChatInput")).toHaveValue(nextDraft);
  await page.waitForTimeout(1200);
  expect(cloud.writes).toHaveLength(1);
  await page.screenshot({ path: testInfo.outputPath("chat-draft-retained-after-pending-cloud-load.png") });
});

test("an unused missing conversation does not turn clean cloud adoption into a conflict", async ({ page }) => {
  const local = await seedProject(page);
  delete Object.values(local.miniProjects)[0].conversation;
  delete local.draftConversation;
  const remote = structuredClone(local);
  remote.files[remote.current] = "// Newer cloud source with no local edits\n" + remote.files[remote.current];
  await page.addInitScript(({ workspaceKey, syncKey, dirtyKey, accountKey, data }) => {
    localStorage.setItem(workspaceKey, JSON.stringify(data));
    localStorage.setItem(syncKey, JSON.stringify({ schemaVersion: 4, accountKey, revision: 5, dirty: false, conflict: false, legacyInstructionRevision: null }));
    localStorage.setItem(dirtyKey, JSON.stringify({ schemaVersion: 4, dirty: false }));
  }, { workspaceKey, syncKey, dirtyKey, accountKey, data: local });
  const cloud = await mockCloud(page, remote, 6);
  await page.reload({ waitUntil: "load" });
  await expect.poll(() => cloud.reads).toBe(1);
  await waitForCleanSync(page, 6);
  await expect(page.locator("#projectChatInput")).toHaveValue("");
  await page.waitForTimeout(1200);
  expect((await readWorkspace(page)).files[remote.current]).toBe(remote.files[remote.current]);
  expect(cloud.writes).toEqual([]);
  expect(cloud.data).toEqual(remote);
});
