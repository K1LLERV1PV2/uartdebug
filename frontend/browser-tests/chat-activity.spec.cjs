"use strict";

const { test, expect } = require("playwright/test");

test.beforeEach(async ({ page }) => {
  page.__activityErrors = [];
  page.on("pageerror", error => page.__activityErrors.push(error.message));
  // Browser plugin not available. Exercise the real app's NDJSON reader and
  // controller in Edge/Chromium using a controllable, chunked browser stream.
  await page.addInitScript(() => {
    const original = window.fetch.bind(window);
    window.__chatStreams = [];
    window.fetch = (url, init = {}) => {
      if (!String(url).endsWith("/api/avr/ai/chat") || init.method !== "POST") return original(url, init);
      const request = JSON.parse(init.body);
      const encoder = new TextEncoder();
      const body = new ReadableStream({ start(controller) {
        const run = { request, write(event) {
          try { controller.enqueue(encoder.encode(JSON.stringify(event) + "\n")); if (event.type === "error") controller.close(); return true; } catch { return false; }
        }, finish(message) {
          this.write({ type: "result", status: 200, data: { ok: true, kind: "chat", stage: "chat", baseRevision: request.canvas.revision, message } });
          try { controller.close(); } catch {}
        } };
        window.__chatStreams.push(run);
        init.signal?.addEventListener("abort", () => { try { controller.error(new DOMException("Stopped", "AbortError")); } catch {} });
      } });
      return Promise.resolve(new Response(body, { headers: { "Content-Type": "application/x-ndjson" } }));
    };
  });
});
test.afterEach(async ({ page }) => expect(page.__activityErrors).toEqual([]));

async function open(page) {
  await page.goto("/avr", { waitUntil: "load" });
  await expect(page).toHaveTitle("AVR Programming - Uart Debug");
  await page.waitForFunction(() => window.UartDebugAvrAiWorkspace && window.UartDebugAvrMiniProjects);
  await page.evaluate(async () => {
    const { project } = await (await fetch("/api/avr/ai/projects/motion-example")).json();
    await window.UartDebugAvrMiniProjects.install(project);
  });
}

async function start(page, text = "Explain the LED output.") {
  const count = await page.evaluate(() => window.__chatStreams.length);
  await page.locator("#projectChatInput").fill(text);
  await page.locator("#projectChatSendBtn").click();
  await page.waitForFunction(expected => window.__chatStreams.length > expected, count);
}
const emit = (page, event) => page.evaluate(event => window.__chatStreams.at(-1).write(event), event);
const finish = (page, message) => page.evaluate(message => window.__chatStreams.at(-1).finish(message), message);
const assistant = page => page.locator('.project-chat-message[data-role="assistant"]').last();
const chat = page => page.evaluate(() => window.UartDebugAvrAiWorkspace.getConversation());

test("public progress messages stay separate from the answer and redundant tool rows are summarized", async ({ page }, testInfo) => {
  await open(page); await start(page);
  const response = assistant(page), toggle = response.locator(".project-chat-work-toggle");
  await emit(page, { type: "progress", progress: { id: "generation", attempt: 1, status: "in_progress", label: "Analyzing the request" } });
  await emit(page, { type: "commentary", id: "call-1-message-1", text: "Проверю подключение светодиода" });
  await emit(page, { type: "commentary", id: "call-1-message-1", text: "Проверю подключение светодиода и настройки тактовой частоты." });
  const comments = response.locator('[data-kind="commentary"]');
  await expect(comments).toHaveCount(1);
  await expect(comments).toHaveText("Проверю подключение светодиода и настройки тактовой частоты.");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(toggle).toContainText("Analyzing the request");
  expect((await chat(page)).messages[1].content).toBe("");
  for (const attempt of [1, 2]) {
    await emit(page, { type: "progress", progress: { id: "generation", attempt, status: "completed", label: "Prepared a tool request" } });
    await emit(page, { type: "progress", progress: { id: "documentation", attempt, status: "completed", label: "Local documentation read" } });
  }
  await emit(page, { type: "progress", progress: { id: "documentation", attempt: 3, status: "failed", label: "Documentation lookup did not complete" } });
  await expect(response.locator(".project-chat-work-events")).not.toContainText("Prepared a tool request");
  await expect(response.locator(".project-chat-work-events")).toContainText("Local documentation read (2 steps)");
  await expect(response.locator('[data-status="error"]')).toHaveText("Documentation lookup did not complete");
  const appearance = await toggle.evaluate(element => {
    const style = getComputedStyle(element);
    return { top: style.borderTopWidth, left: style.borderLeftWidth, right: style.borderRightWidth, bottom: style.borderBottomWidth, background: style.backgroundColor };
  });
  expect(appearance).toEqual({ top: "0px", left: "0px", right: "0px", bottom: "1px", background: "rgba(0, 0, 0, 0)" });
  await toggle.hover();
  await expect(toggle).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await page.mouse.move(0, 0);
  await page.locator(".project-chat-panel").screenshot({ path: testInfo.outputPath("public-commentary-working.png") });
  await emit(page, { type: "message_delta", delta: "Готовый ответ." });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await finish(page, "Готовый ответ.");
  await page.reload();
  const restored = assistant(page);
  await restored.locator(".project-chat-work-toggle").click();
  await expect(restored.locator('[data-kind="commentary"]')).toHaveText("Проверю подключение светодиода и настройки тактовой частоты.");
  await expect(restored.locator(".project-chat-message-content")).toHaveText("Готовый ответ.");
  // Presentation grouping keeps the original saved operations intact.
  expect((await chat(page)).messages[1].work.events.filter(event => event.text === "Local documentation read")).toHaveLength(2);
  await page.locator(".project-chat-panel").screenshot({ path: testInfo.outputPath("public-commentary-complete.png") });
});

test("real activity and response fragments arrive before completion, with a live timer and a user-controlled history", async ({ page }, testInfo) => {
  await open(page); await start(page);
  const response = assistant(page), toggle = response.locator(".project-chat-work-toggle");
  await expect(response.locator(".project-chat-progress")).toHaveAttribute("aria-live", "off");
  await expect(response.getByRole("status")).toHaveAttribute("aria-live", "polite");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await emit(page, { type: "progress", progress: { id: "generation", attempt: 1, status: "in_progress", label: "Preparing the response" } });
  await expect(toggle).toContainText("Preparing the response");
  await expect.poll(() => toggle.textContent()).toMatch(/[1-9]\ds|[1-9]s/);
  await expect(response.locator(".project-chat-message-meta")).toBeHidden();
  await page.locator(".project-chat-panel").screenshot({ path: testInfo.outputPath("activity-working-expanded.png") });
  await emit(page, { type: "message_delta", delta: "The LED uses PB1.\n\n```c\nPORTB.OUTSET" });
  await expect(response.locator(".project-chat-message-content")).toContainText("The LED uses PB1.");
  await expect(response.locator("pre code")).toContainText("PORTB.OUTSET");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(page.locator("#projectChatJumpBtn")).toBeHidden();
  await emit(page, { type: "message_delta", delta: " = PIN1_bm;\n```\n\n[unsafe](javascript:alert(1))" });
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(response.locator('a[href^="javascript:"]')).toHaveCount(0);
  await emit(page, { type: "progress", progress: { id: "generation", attempt: 1, status: "completed" } });
  await emit(page, { type: "progress", progress: { id: "compilation", attempt: 1, status: "in_progress", label: "Compiling ATtiny1624" } });
  await expect(toggle).toContainText("Compiling ATtiny1624");
  await expect(response.locator(".project-chat-work-events li")).toHaveText(["Sending request", "Preparing the response", "Compiling ATtiny1624"]);
  await page.locator(".project-chat-panel").screenshot({ path: testInfo.outputPath("activity-streaming-expanded.png") });
  await emit(page, { type: "progress", progress: { id: "compilation", attempt: 1, status: "completed", label: "Compiling ATtiny1624" } });
  await finish(page, "The LED uses PB1.\n\n```c\nPORTB.OUTSET = PIN1_bm;\n```");
  await expect(toggle).toContainText("Worked for");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  const duration = await toggle.textContent();
  await page.waitForTimeout(1100);
  expect(await toggle.textContent()).toBe(duration);
  await expect(response.locator(".project-chat-message-meta")).toBeVisible();
  const saved = await chat(page);
  expect(saved.messages[1].work.finishedAt).toBeGreaterThan(saved.messages[1].work.startedAt);
  expect(saved.messages[1].work.events.find(event => event.id === "generation:1").status).toBe("complete");
  await page.reload({ waitUntil: "load" });
  await expect(assistant(page).locator(".project-chat-work-toggle")).toHaveText(duration);
  await expect(assistant(page).locator(".project-chat-work-toggle")).toHaveAttribute("aria-expanded", "false");
  await assistant(page).locator(".project-chat-work-toggle").focus();
  await page.keyboard.press("Enter");
  await expect(assistant(page).locator(".project-chat-work-events")).toBeVisible();
  await expect(assistant(page).locator(".project-chat-work-events")).toContainText("Compiling ATtiny1624");
  await page.locator(".project-chat-panel").screenshot({ path: testInfo.outputPath("activity-complete-reopened.png") });
});

test("default history folds when the answer starts, repair resets only the unverified preview, and final duration persists", async ({ page }) => {
  await open(page); await start(page);
  await emit(page, { type: "progress", progress: { id: "generation", attempt: 1, status: "in_progress" } });
  await emit(page, { type: "message_delta", delta: "An unverified first draft." });
  await expect(assistant(page).locator(".project-chat-work-toggle")).toHaveAttribute("aria-expanded", "false");
  await emit(page, { type: "message_reset" });
  await emit(page, { type: "progress", progress: { id: "repair", attempt: 2, status: "in_progress" } });
  await expect(assistant(page).locator(".project-chat-message-content")).not.toContainText("unverified");
  await expect(assistant(page).locator(".project-chat-work-toggle")).toContainText("Fixing compiler errors");
  await emit(page, { type: "message_delta", delta: "The checked response." });
  await finish(page, "The checked response.");
  await expect(assistant(page).locator(".project-chat-work-toggle")).toHaveAttribute("aria-expanded", "false");
  const before = (await chat(page)).messages[1];
  expect(before.content).toBe("The checked response.");
  await page.reload({ waitUntil: "load" });
  expect((await chat(page)).messages[1]).toEqual(before);
});

test("stopping preserves the partial answer and activity, and retry starts a fresh attempt without a new chat", async ({ page }, testInfo) => {
  await open(page); await start(page);
  await emit(page, { type: "progress", progress: { id: "documentation", attempt: 1, status: "in_progress" } });
  await emit(page, { type: "message_delta", delta: "A useful partial explanation." });
  await expect(assistant(page).locator(".project-chat-message-content")).toHaveText("A useful partial explanation.");
  await page.locator("#projectChatSendBtn").click();
  await expect(assistant(page)).toHaveAttribute("data-status", "error");
  await expect(assistant(page).locator(".project-chat-message-content")).toHaveText("A useful partial explanation.");
  await expect(assistant(page).locator(".project-chat-work-error")).toContainText("Response stopped");
  const stopped = (await chat(page)).messages[1];
  await page.screenshot({ path: testInfo.outputPath("activity-stopped-partial.png") });
  await page.reload({ waitUntil: "load" });
  expect((await chat(page)).messages[1]).toEqual(stopped);
  await assistant(page).getByRole("button", { name: "Retry response", exact: true }).click();
  await page.waitForFunction(() => window.__chatStreams.length === 1);
  await expect(assistant(page).locator(".project-chat-message-content")).toBeHidden();
  await finish(page, "The retry completed.");
  await expect(assistant(page)).toHaveAttribute("data-status", "complete");
  const retried = await chat(page);
  expect(retried.messages).toHaveLength(2);
  expect(retried.messages[1].id).toBe(stopped.id);
  expect(retried.messages[1].work.startedAt).toBeGreaterThan(stopped.work.startedAt);
  expect(retried.messages[1].content).toBe("The retry completed.");
});

test("an error keeps streamed text separate from its terminal explanation", async ({ page }) => {
  await open(page); await start(page);
  await emit(page, { type: "message_delta", delta: "Keep this partial answer." });
  await emit(page, { type: "error", status: 503, data: { ok: false, message: "The compiler is temporarily unavailable." } });
  await expect(assistant(page)).toHaveAttribute("data-status", "error");
  await expect(assistant(page).locator(".project-chat-message-content")).toHaveText("Keep this partial answer.");
  await expect(assistant(page).locator(".project-chat-work-error")).toContainText("compiler is temporarily unavailable");
  expect((await chat(page)).messages[1].work.finishedAt).not.toBeNull();
});

test("reopening an unfinished saved response preserves its partial text and never counts offline time as work", async ({ page }) => {
  await open(page); await start(page);
  await emit(page, { type: "progress", progress: { id: "generation", attempt: 1, status: "in_progress" } });
  await emit(page, { type: "message_delta", delta: "Keep this interrupted preview." });
  await expect.poll(async () => (await chat(page)).messages[1].content).toBe("Keep this interrupted preview.");
  await page.addInitScript(() => {
    if (sessionStorage.getItem("old-pending-activity")) return;
    sessionStorage.setItem("old-pending-activity", "true");
    const key = "ud_avr_programming_state_v4", state = JSON.parse(localStorage.getItem(key));
    const message = Object.values(state.miniProjects)[0].conversation.threads[0].messages[1];
    // This is a crash snapshot, independent of the ordinary beforeunload path.
    message.status = "pending";
    message.work = { startedAt: 100, finishedAt: null, events: [
      { id: "generation:1", text: "Preparing the response", at: 1100, status: "active" },
    ] };
    localStorage.setItem(key, JSON.stringify(state));
  });
  await page.reload({ waitUntil: "load" });
  await expect(assistant(page)).toHaveAttribute("data-status", "error");
  await expect(assistant(page).locator(".project-chat-message-content")).toHaveText("Keep this interrupted preview.");
  await expect(assistant(page).locator(".project-chat-work-toggle")).toHaveText("Interrupted after 1s");
  const saved = (await chat(page)).messages[1];
  expect(saved.work.finishedAt).toBe(1100);
  await page.waitForTimeout(1100);
  await expect(assistant(page).locator(".project-chat-work-toggle")).toHaveText("Interrupted after 1s");
});

test("ordinary reload freezes the actual elapsed time after a quiet period and retains the partial answer", async ({ page }) => {
  await open(page); await start(page);
  await emit(page, { type: "progress", progress: { id: "generation", attempt: 1, status: "in_progress" } });
  await emit(page, { type: "message_delta", delta: "Retain the quiet response preview." });
  await expect(assistant(page).locator(".project-chat-message-content")).toHaveText("Retain the quiet response preview.");
  await page.waitForTimeout(1250);
  const beforeReload = await page.evaluate(() => Date.now());
  await page.reload({ waitUntil: "load" });
  await expect(assistant(page)).toHaveAttribute("data-status", "error");
  await expect(assistant(page).locator(".project-chat-message-content")).toHaveText("Retain the quiet response preview.");
  const saved = (await chat(page)).messages[1];
  expect(saved.work.finishedAt).toBeGreaterThanOrEqual(beforeReload);
  expect(saved.work.finishedAt).toBeLessThanOrEqual(await page.evaluate(() => Date.now()));
  expect(saved.work.finishedAt - saved.work.startedAt).toBeGreaterThanOrEqual(1200);
  expect(saved.work.events.at(-1).text).toBe("Response interrupted after leaving the page.");
  const label = await assistant(page).locator(".project-chat-work-toggle").textContent();
  await page.waitForTimeout(1100);
  await expect(assistant(page).locator(".project-chat-work-toggle")).toHaveText(label);
  expect((await chat(page)).messages[1].work.finishedAt).toBe(saved.work.finishedAt);
});

test("manually opening a long activity history keeps its heading in view instead of following the bottom", async ({ page }, testInfo) => {
  await open(page); await start(page, "Hi");
  await page.evaluate(() => {
    const stream = window.__chatStreams.at(-1);
    for (let attempt = 1; attempt <= 40; attempt++) stream.write({ type: "progress", progress: {
      id: "documentation", attempt, status: "completed",
      label: `Read local documentation section ${attempt} and checked the available register information.`,
    } });
    stream.finish("A short final answer.");
  });
  const response = assistant(page), toggle = response.locator(".project-chat-work-toggle");
  await expect(response).toHaveAttribute("data-status", "complete");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  const geometry = () => toggle.evaluate(element => {
    const thread = element.closest(".project-chat-thread"), bounds = element.getBoundingClientRect(), viewport = thread.getBoundingClientRect();
    return { top: bounds.top, bottom: bounds.bottom, viewportTop: viewport.top, viewportBottom: viewport.bottom,
      scrollTop: thread.scrollTop, scrollHeight: thread.scrollHeight, clientHeight: thread.clientHeight };
  });
  await expect.poll(async () => { const value = await geometry(); return value.scrollHeight - value.clientHeight; }).toBeLessThanOrEqual(1);
  const before = await geometry();
  await page.locator(".project-chat-panel").screenshot({ path: testInfo.outputPath("long-activity-before-opening.png") });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const after = await geometry();
  expect(after.scrollHeight - after.clientHeight).toBeGreaterThan(500);
  expect(after.scrollTop).toBe(before.scrollTop);
  expect(Math.abs(after.top - before.top)).toBeLessThan(1);
  expect(after.top).toBeGreaterThanOrEqual(after.viewportTop);
  expect(after.bottom).toBeLessThanOrEqual(after.viewportBottom);
  await expect(page.locator("#projectChatJumpBtn")).toBeVisible();
  await page.locator(".project-chat-panel").screenshot({ path: testInfo.outputPath("long-activity-heading-kept-in-view.png") });
  await page.locator("#projectChatJumpBtn").click();
  await expect.poll(async () => (await geometry()).scrollTop).toBeGreaterThan(0);
  await expect(page.locator("#projectChatJumpBtn")).toBeHidden();
});

for (const width of [900, 1543]) test(`user bubbles fit short text and retain multiline, long-token and editing layouts at ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 884 });
  await open(page); await start(page, "Hi"); await finish(page, "A short answer.");
  const user = page.locator('.project-chat-message[data-role="user"]').first();
  const geometry = await user.evaluate(element => {
    const body = element.querySelector(".project-chat-message-content"), range = document.createRange();
    range.selectNodeContents(body);
    return { bubble: body.getBoundingClientRect().width, text: range.getBoundingClientRect().width, thread: element.parentElement.clientWidth };
  });
  expect(geometry.bubble - geometry.text).toBeLessThan(27);
  expect(geometry.bubble).toBeLessThan(geometry.thread * .8);
  await user.hover();
  await page.locator(".project-chat-panel").screenshot({ path: testInfo.outputPath(`bubble-and-branch-${width}.png`) });
  await start(page, "First line\nSecond line\n" + "longtoken".repeat(80)); await finish(page, "Multiline answer.");
  expect(await page.locator('.project-chat-message[data-role="user"]').last().evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await user.locator('[data-chat-action="edit"]').click();
  await expect(user.locator(".project-chat-edit textarea")).toBeVisible();
  expect((await user.boundingBox()).width).toBeGreaterThan((await page.locator("#projectChatThread").boundingBox()).width * .9);
  await page.locator(".project-chat-panel").screenshot({ path: testInfo.outputPath(`bubble-edit-${width}.png`) });
});
