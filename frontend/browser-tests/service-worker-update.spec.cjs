"use strict";

const { test, expect } = require("playwright/test");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

test.use({ serviceWorkers: "allow" });

const publicRoot = path.resolve(__dirname, "../../public");
const bootstrap = fs.readFileSync(path.join(publicRoot, "ui-service-worker.js"), "utf8");
const workerSource = fs.readFileSync(path.join(publicRoot, "sw.js"), "utf8");

async function cacheFixture() {
  const state = { revision: "old", legacyWorker: true, failInstall: false, offline: false, requests: [] };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    const request = { path: url.pathname, revision: state.revision, cacheControl: req.headers["cache-control"], ifNoneMatch: req.headers["if-none-match"] };
    state.requests.push(request);
    if (state.offline) return req.socket.destroy();
    const mime = url.pathname.endsWith(".js") ? "text/javascript" : url.pathname.endsWith(".css") ? "text/css" : "text/html";
    res.setHeader("Content-Type", mime);
    // Reproduce the production policy that allowed old unversioned resources to persist.
    res.setHeader("Cache-Control", url.pathname === "/sw.js" ? "no-cache" : "public, max-age=2592000, immutable");
    if (!["/sw.js", "/ui-service-worker.js"].includes(url.pathname)) {
      const etag = `"${url.pathname}-${state.revision}"`;
      res.setHeader("ETag", etag);
      if (req.headers["if-none-match"] === etag) {
        request.notModified = true;
        res.statusCode = 304;
        return res.end();
      }
    }
    if (url.pathname === "/sw.js") {
      const assets = ["/avr", "/index.html", "/app.js", "/app.css", "/ui-service-worker.js"];
      if (state.failInstall) assets.push("/missing.js");
      let source = workerSource
        .replace(/const CACHE_NAME = "[^"]+";/, `const CACHE_NAME = "uartdebug-shell-fixture-${state.revision}";`)
        .replace(/const APP_SHELL_ASSETS = \[[\s\S]*?\];/, `const APP_SHELL_ASSETS = ${JSON.stringify(assets)};`);
      if (state.revision === "old" && state.legacyWorker) {
        source = source.replace(/APP_SHELL_ASSETS\.map\(\(url\) => new Request\(url, \{ cache: "reload" \}\)\)/, "APP_SHELL_ASSETS")
          .replace(/fetch\(request, \{ cache: "no-cache" \}\)/g, "fetch(request)");
      }
      return res.end(source);
    }
    if (url.pathname === "/ui-service-worker.js") return res.end(bootstrap);
    if (url.pathname === "/app.js") return res.end(`document.querySelector('#revision').textContent = '${state.revision}';`);
    if (url.pathname === "/app.css") return res.end(`body{background:#202f39;color:#b2e7cf;font:16px Arial;padding:32px} main{border:1px solid #3a5058;border-radius:16px;padding:24px} body::after{content:'${state.revision} styles'}`);
    if (url.pathname === "/missing.js") { res.statusCode = 404; return res.end("Missing"); }
    if (["/avr", "/", "/index.html"].includes(url.pathname)) return res.end(`<!doctype html><title>UARTDebug cache fixture</title><link rel="stylesheet" href="/app.css"><main><h1>Project chat</h1><p id="revision">${state.revision}</p><textarea aria-label="Project draft">Unsaved project draft</textarea></main><script src="/app.js"></script>${state.revision === "old" ? "" : '<script defer src="/ui-service-worker.js"></script>'}`);
    res.statusCode = 404;
    res.end("Missing");
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return { state, origin: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => server.close(resolve)) };
}

async function installLegacyWorker(page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.register("/sw.js?v=legacy", { updateViaCache: "none" });
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true }));
  });
}

async function seedUserData(page) {
  return page.evaluate(async () => {
    const values = {
      ud_avr_programming_state_v5: '{"projects":["kept current project"],"chats":["kept current chat"]}',
      ud_avr_programming_state_v4: '{"projects":["kept project"],"chats":["kept chat"]}',
      ud_avr_programming_state_v3: "previous workspace kept",
      ud_avr_programming_state_v2: "older workspace kept",
      uartdebug_draft: "unsaved user draft",
    };
    for (const [key, value] of Object.entries(values)) localStorage.setItem(key, value);
    await new Promise((resolve, reject) => {
      const request = indexedDB.open("uartdebug-cache-test-user-data", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("projects");
      request.onerror = reject;
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction("projects", "readwrite");
        transaction.objectStore("projects").put("kept indexed project", "project");
        transaction.oncomplete = () => { database.close(); resolve(); };
      };
    });
    await (await caches.open("unrelated-user-cache")).put("/user-snapshot", new Response("kept snapshot"));
    return values;
  });
}

test("ordinary reload updates a legacy worker and poisoned HTTP cache without clearing user data", async ({ page, context }, testInfo) => {
  const fixture = await cacheFixture();
  try {
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(fixture.origin + "/avr");
    await expect(page.locator("#revision")).toHaveText("old");
    // Before a worker controls the page, prove the HTTP cache alone serves stale JS.
    fixture.state.revision = "new";
    const requestsBefore = fixture.state.requests.filter(request => request.path === "/app.js").length;
    expect(await page.evaluate(() => fetch("/app.js").then(response => response.text()))).toContain("'old'");
    expect(fixture.state.requests.filter(request => request.path === "/app.js")).toHaveLength(requestsBefore);
    fixture.state.revision = "old";
    await installLegacyWorker(page);
    const saved = await seedUserData(page);
    fixture.state.revision = "new";
    let navigations = 0;
    page.on("framenavigated", frame => { if (frame === page.mainFrame()) navigations += 1; });
    await page.reload();
    await expect.poll(() => page.evaluate(() => caches.keys())).toContain("uartdebug-shell-fixture-new");
    await expect.poll(() => page.evaluate(() => caches.keys())).not.toContain("uartdebug-shell-fixture-old");
    // Activation must not silently navigate away from an active editor/request.
    expect(navigations).toBe(1);
    // A legacy cached document can remain open until this explicit normal reload.
    await page.reload();
    await expect(page.locator("#revision")).toHaveText("new");
    expect(await page.evaluate(() => getComputedStyle(document.body, "::after").content)).toContain("new styles");
    expect(await page.evaluate(async () => (await (await caches.open("uartdebug-shell-fixture-new")).match("/app.js")).text())).toContain("'new'");
    expect(fixture.state.requests.some(request => request.path === "/app.js" && request.notModified)).toBe(true);
    expect(await page.evaluate(keys => Object.fromEntries(keys.map(key => [key, localStorage.getItem(key)])), Object.keys(saved))).toEqual(saved);
    expect(await page.evaluate(async () => (await (await caches.open("unrelated-user-cache")).match("/user-snapshot")).text())).toBe("kept snapshot");
    expect(await page.evaluate(() => new Promise(resolve => {
      const request = indexedDB.open("uartdebug-cache-test-user-data", 1);
      request.onsuccess = () => {
        const database = request.result;
        const value = database.transaction("projects").objectStore("projects").get("project");
        value.onsuccess = () => { database.close(); resolve(value.result); };
      };
    }))).toBe("kept indexed project");
    await page.screenshot({ path: testInfo.outputPath("updated-shell.png") });
    fixture.state.offline = true;
    await context.setOffline(true);
    await page.reload();
    await expect(page.locator("#revision")).toHaveText("new");
    expect(errors).toEqual([]);
  } finally { await context.setOffline(false); await fixture.close(); }
});

test("a failed new shell install retains the previous active worker and offline project shell", async ({ page, context }) => {
  const fixture = await cacheFixture();
  fixture.state.legacyWorker = false;
  try {
    await page.goto(fixture.origin + "/avr");
    await installLegacyWorker(page);
    fixture.state.revision = "broken";
    fixture.state.failInstall = true;
    const installState = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      const changed = new Promise(resolve => registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        worker.addEventListener("statechange", () => { if (worker.state === "redundant") resolve(worker.state); });
      }, { once: true }));
      await registration.update();
      return changed;
    });
    expect(installState).toBe("redundant");
    expect(await page.evaluate(() => navigator.serviceWorker.controller.scriptURL)).toContain("/sw.js?v=legacy");
    expect(await page.evaluate(() => caches.keys())).toContain("uartdebug-shell-fixture-old");
    fixture.state.offline = true;
    await context.setOffline(true);
    await page.reload();
    await expect(page.locator("#revision")).toHaveText("old");
  } finally { await context.setOffline(false); await fixture.close(); }
});

test("direct AVR entry installs the shared worker without first visiting the home page", async ({ page }, testInfo) => {
  const fixture = await cacheFixture();
  fixture.state.revision = "new";
  try {
    await page.goto(fixture.origin + "/avr");
    await page.evaluate(() => navigator.serviceWorker.ready);
    await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toBe(fixture.origin + "/sw.js");
    await page.screenshot({ path: testInfo.outputPath("direct-avr-shell.png") });
    expect(await page.evaluate(() => navigator.serviceWorker.getRegistrations().then(registrations => registrations.length))).toBe(1);
  } finally { await fixture.close(); }
});

test("the actual AVR app installs its complete shell and remains usable on an offline reload", async ({ page, context }, testInfo) => {
  let offline = false;
  const server = http.createServer((req, res) => {
    if (offline) return req.socket.destroy();
    const url = new URL(req.url, "http://localhost");
    const json = data => { res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(data)); };
    if (url.pathname === "/api/avr/ai/auth/session") return json({ ok: true, mode: "google", configured: false, authenticated: false });
    if (url.pathname === "/api/avr/ai/status") return json({ ok: true, enabled: false, configured: false, ready: false, knowledge: { devices: [{ mcu: "ATtiny1624", packages: ["SOIC-14"] }] } });
    if (url.pathname === "/api/avr/ai/projects") return json({ ok: true, projects: [] });
    if (url.pathname.startsWith("/api/")) { res.statusCode = 404; return res.end("Unknown API"); }
    try {
      let route = decodeURIComponent(url.pathname);
      if (route === "/") route = "/index.html";
      else if (!path.extname(route)) route += ".html";
      const file = path.resolve(publicRoot, "." + route);
      if (!file.startsWith(publicRoot + path.sep) || !fs.statSync(file).isFile()) throw new Error("Not found");
      const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };
      res.writeHead(200, { "Content-Type": mime[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-cache, max-age=0, must-revalidate" });
      res.end(fs.readFileSync(file));
    } catch { res.statusCode = 404; res.end("Missing"); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const origin = `http://127.0.0.1:${server.address().port}`;
    await page.goto(origin + "/avr");
    await expect(page.locator("#projectChatInput")).toBeVisible();
    await page.evaluate(() => navigator.serviceWorker.ready);
    await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toBe(origin + "/sw.js");
    await page.locator("#projectChatInput").fill("Keep my actual project planning draft.");
    await expect.poll(() => page.evaluate(() => localStorage.getItem("ud_avr_programming_state_v5"))).toContain("Keep my actual project planning draft.");
    const storedState = await page.evaluate(() => JSON.parse(localStorage.getItem("ud_avr_programming_state_v5")));
    await page.getByRole("button", { name: "Open projects", exact: true }).click();
    await expect(page.locator("#filesModal")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.screenshot({ path: testInfo.outputPath("actual-avr-installed.png") });
    offline = true;
    await context.setOffline(true);
    await page.reload();
    await expect(page.locator("#projectChatInput")).toBeVisible();
    await expect(page.locator("#projectChatInput")).toHaveValue("Keep my actual project planning draft.");
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("ud_avr_programming_state_v5")).draftConversation)).toEqual(storedState.draftConversation);
    await page.getByRole("button", { name: "Open projects", exact: true }).click();
    await expect(page.locator("#filesModal")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("actual-avr-offline-projects.png") });
    expect(errors).toEqual([]);
  } finally { await context.setOffline(false); await new Promise(resolve => server.close(resolve)); }
});
