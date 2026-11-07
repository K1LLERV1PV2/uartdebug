"use strict";
const { test, expect } = require("playwright/test");

test.beforeEach(async ({ page }) => {
  page.__chatErrors = [];
  page.on("pageerror", error => page.__chatErrors.push(error.message));
  page.on("console", message => { if (message.type() === "error") page.__chatErrors.push(message.text()); });
});
test.afterEach(async ({ page }) => { expect(page.__chatErrors).toEqual([]); });

async function open(page, project = true) {
  await page.goto("/avr", { waitUntil: "load" });
  await expect(page).toHaveTitle("AVR Programming - Uart Debug");
  await page.waitForFunction(() => window.UartDebugAvrAiWorkspace && window.UartDebugProjectChat);
  if (project) await page.evaluate(async () => {
    const { project } = await (await fetch("/api/avr/ai/projects/motion-example")).json();
    await window.UartDebugAvrMiniProjects.install(project);
  });
  await expect(page.locator("#projectChatInput")).toBeVisible();
}
function reply(request, message) {
  return { ok: true, kind: "chat", stage: "chat", baseRevision: request.canvas.revision, message };
}
async function mockReplies(page, received, message = "Use **USART1**.\n\n```c\nUSART1.CTRLB = USART_TXEN_bm;\n```") {
  await page.route("**/api/avr/ai/chat", async route => {
    const request = route.request().postDataJSON(); received.push(request);
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(reply(request, message)) });
  });
}

async function activeChatId(page) {
  return page.evaluate(() => window.UartDebugAvrAiWorkspace.getChats().activeThreadId);
}
async function chatState(page) { return page.evaluate(() => window.UartDebugAvrAiWorkspace.getChats()); }
async function openHistory(page) {
  if (!await page.locator("#projectChatHistory").isVisible()) await page.locator("#projectChatHistoryBtn").click();
}
async function selectChat(page, id) {
  await openHistory(page);
  await page.locator(`[data-chat-open="${id}"]`).click();
}

test("chat sends context and history, renders Markdown, and restores its draft per project", async ({ page }, testInfo) => {
  const received = [];
  await mockReplies(page, received);
  await open(page);
  const instruction = await page.evaluate(() => window.UartDebugAvrAiWorkspace.getInstruction());
  await page.locator("#projectChatInput").fill("Explain the transmitter initialization.");
  await page.locator("#projectChatInput").press("Enter");
  await expect(page.locator('.project-chat-message[data-role="assistant"] code')).toContainText("USART_TXEN_bm");
  expect(received[0].message).toBe("Explain the transmitter initialization.");
  expect(received[0].currentProject.source).toContain("#include <xc.h>");
  expect(received[0].history).toEqual([]);
  expect(await page.evaluate(() => window.UartDebugAvrAiWorkspace.getInstruction())).toEqual(instruction);
  await page.locator("#projectChatInput").fill("Keep this unsent draft.");
  await page.reload({ waitUntil: "load" });
  await expect(page.locator("#projectChatInput")).toHaveValue("Keep this unsent draft.");
  await expect(page.locator("#projectChatThread .project-chat-message")).toHaveCount(2);
  await page.evaluate(async () => {
    const { project } = await (await fetch("/api/avr/ai/projects/motion-example")).json();
    project.id = "second-project"; project.title = "Second project"; project.displayName = "Second project";
    project.files.forEach(file => { file.name = file.name.replace("Motion example", "Second project"); });
    await window.UartDebugAvrMiniProjects.install(project);
  });
  await expect(page.locator("#projectChatThread .project-chat-message")).toHaveCount(0);
  await page.locator("#filesOpenBtn").click();
  await expect(page.locator("#filesModal")).toBeVisible();
  await page.locator('#fileList .file-item[data-file]').filter({ hasText: "Motion example" }).click();
  await expect(page.locator("#filesModal")).toBeHidden();
  await expect(page.locator("#projectChatInput")).toHaveValue("Keep this unsent draft.");
  await page.locator("#projectChatInput").fill("And explain interrupts.");
  await page.locator("#projectChatSendBtn").click();
  await expect(page.locator("#projectChatThread .project-chat-message")).toHaveCount(4);
  expect(received[1].history.map(message => message.role)).toEqual(["user", "assistant"]);
  await page.screenshot({ path: testInfo.outputPath("project-chat.png") });
});

test("review replies in chat and preserves an unrelated composer draft", async ({ page }) => {
  const received = [];
  await mockReplies(page, received, "Уточните назначение кнопки.");
  await open(page);
  await page.evaluate(() => window.UartDebugAvrAiWorkspace.setInstruction("# Проект\n\nТребования к кнопке.", { locale: "ru" }));
  await page.locator("#projectChatInput").fill("My unsent note");
  await page.locator("#projectCanvasRunBtn").click();
  await expect(page.locator('.project-chat-message[data-role="assistant"]')).toContainText("Уточните назначение кнопки.");
  expect(received[0].requestSource).toBe("review");
  expect(received[0].canvas.locale).toBe("ru");
  await expect(page.locator("#projectChatInput")).toHaveValue("My unsent note");
  expect((await page.evaluate(() => window.UartDebugAvrAiWorkspace.getInstruction())).markdown).not.toContain("Уточните");
  await page.unroute("**/api/avr/ai/chat");
  await page.route("**/api/avr/ai/chat", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({
    ok: true, kind: "project", stage: "generate", message: "Unauthorized stage",
  }) }));
  await page.locator("#projectCanvasRunBtn").click();
  await expect(page.locator('.project-chat-message[data-status="error"]')).toContainText("Review cannot change project code");
  expect((await page.evaluate(() => window.UartDebugAvrAiWorkspace.getInstruction())).markdown).not.toContain("Уточните");
});

test("stopping a response rejects a late result and leaves the next turn usable", async ({ page }) => {
  let release;
  await page.route("**/api/avr/ai/chat", async route => {
    const request = route.request().postDataJSON();
    await new Promise(resolve => { release = resolve; });
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(reply(request, "Late response must not appear")) }).catch(() => {});
  });
  await open(page);
  await page.locator("#projectChatInput").fill("Explain this project.");
  await page.locator("#projectChatSendBtn").click();
  await expect(page.locator("#projectChatSendBtn")).toHaveAttribute("aria-label", "Stop response");
  await expect(page.locator(".project-chat-progress:not([hidden])")).toBeVisible();
  await page.locator("#projectChatSendBtn").click();
  release();
  await expect(page.locator('.project-chat-message[data-status="error"]')).toContainText("stopped");
  await page.waitForTimeout(100);
  await expect(page.locator("#projectChatThread")).not.toContainText("Late response");
  await page.locator("#projectChatInput").fill("A new request");
  await expect(page.locator("#projectChatSendBtn")).toBeEnabled();
  await page.reload({ waitUntil: "load" });
  await expect(page.locator("#projectChatThread")).toContainText("Response stopped");
});

test("a single chat request creates a project and moves the draft conversation into it", async ({ page }) => {
  await page.route("**/api/avr/ai/chat", async route => {
    const input = route.request().postDataJSON();
    const markdown = "# Project Blink\n\nProject version - Ver.1.0\n\n## Hardware requirements\n\nATtiny1624 SOIC-14, PB1 LED.\n\n## Software requirements\n\nBlink every second.";
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({
      ok: true, kind: "project", stage: "generate", operation: "create", baseRevision: input.canvas.revision,
      canvas: { ...input.canvas, revision: input.canvas.revision + 1, markdown, locale: "en", annotations: [], target: { mcu: "attiny1624", packageName: "SOIC-14" } },
      project: { schemaVersion: 1, id: "blink", title: "Blink", version: "Ver.1.0", files: [
        { role: "source", name: "Blink.c", content: "#include <xc.h>\nint main(void) { while (1) {} }\n" },
        { role: "specification", name: "Blink.yaml", content: "microcontroller:\n  model: ATtiny1624\n  package: SOIC-14\nhardware_resources: {}\nsoftware_dependencies: {}\n" },
      ] }, message: "Created the Blink project.",
    }) });
  });
  await open(page, false);
  await page.locator("#projectChatInput").fill("Keep my separate planning draft");
  await page.locator("#projectChatNewBtn").click();
  const secondChat = await activeChatId(page);
  await page.locator("#projectChatInput").fill("Create Blink Ver.1.0 for ATtiny1624 SOIC-14. Blink PB1 every second.");
  await page.locator("#projectChatSendBtn").click();
  await expect(page.locator("#projectChatProjectName")).toHaveText("Blink");
  await expect(page.locator("#mcuSelect")).toHaveValue("attiny1624");
  await expect(page.locator("#projectPackageSelect")).toHaveValue("SOIC-14");
  await expect(page.locator("#projectChatThread")).toContainText("Created the Blink project.");
  expect((await page.evaluate(() => window.UartDebugAvrAiWorkspace.getInstruction())).markdown).toContain("# Project Blink");
  await page.locator("#filesOpenBtn").click();
  await expect(page.locator('#fileList .file-item[data-file]')).toHaveCount(1);
  await expect(page.locator("#fileList")).not.toContainText(".yaml");
  await page.keyboard.press("Escape");
  await page.reload({ waitUntil: "load" });
  await expect(page.locator("#projectChatThread .project-chat-message")).toHaveCount(2);
  const state = await page.evaluate(() => JSON.parse(localStorage.getItem("ud_avr_programming_state_v5")));
  expect(state.draftConversation?.threads.flatMap(item => item.messages) || []).toHaveLength(0);
  const chats = Object.values(state.miniProjects)[0].conversation;
  expect(chats.threads).toHaveLength(2);
  expect(chats.threads[0].draft).toBe("Keep my separate planning draft");
  expect(chats.activeThreadId).toBe(secondChat);
  expect(chats.threads[1].messages).toHaveLength(2);
});

test("project list scrolls alongside creation and supports renaming without resizing chat", async ({ page }, testInfo) => {
  await open(page);
  await page.evaluate(async () => {
    const { project } = await (await fetch("/api/avr/ai/projects/motion-example")).json();
    for (let i = 1; i <= 16; i++) {
      const copy = structuredClone(project); copy.id = `test-${i}`; copy.title = `Project ${i}`; copy.displayName = copy.title;
      copy.files.forEach(file => { file.name = file.name.replace("Motion example", copy.title); });
      await window.UartDebugAvrMiniProjects.install(copy);
    }
  });
  const width = await page.locator(".project-chat-panel").evaluate(e => e.getBoundingClientRect().width);
  await page.locator("#filesOpenBtn").click();
  await expect(page.locator("#filesModal")).toBeVisible();
  await expect(page.locator("#createEmptyProjectCard")).toBeVisible();
  await expect(page.locator("#uploadExistingFileCard")).toBeVisible();
  await page.locator('#fileList .file-item[data-file]').last().scrollIntoViewIfNeeded();
  await expect(page.locator('#fileList .file-item[data-file]').last()).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath("projects-modal.png") });
  await page.locator("#fileList .file-menu-btn").last().click();
  await page.locator('#fileContextMenu [data-action="rename"]').click();
  const rename = page.locator(".file-inline-input");
  await rename.fill("Renamed project"); await rename.press("Enter");
  await expect(page.locator("#fileList")).toContainText("Renamed project");
  expect(await page.locator(".project-chat-panel").evaluate(e => e.getBoundingClientRect().width)).toBe(width);
  await expect(page.locator("#createEmptyProjectCard")).toBeVisible();
  await page.keyboard.press("Escape"); await expect(page.locator("#filesModal")).toBeHidden();
  await expect(page.locator("#filesOpenBtn")).toBeFocused();
});

test("composer supports multiline and IME input, copying and creating another chat", async ({ page, context }) => {
  const received = [];
  await mockReplies(page, received, "The UART uses **8N1**.");
  await open(page);
  const specification = await page.evaluate(() => window.UartDebugAvrAiWorkspace.getInstruction());
  await expect(page.locator("#projectChatResetBtn")).toHaveCount(0);
  const firstChat = await activeChatId(page);
  const input = page.locator("#projectChatInput");
  await input.fill("First line"); await input.press("Shift+Enter"); await input.pressSequentially("Second line");
  await input.dispatchEvent("compositionstart");
  await input.dispatchEvent("keydown", { key: "Enter", isComposing: true });
  expect(received).toHaveLength(0);
  await input.dispatchEvent("compositionend");
  await input.press("Enter");
  await expect(page.locator('.project-chat-message[data-role="assistant"]')).toContainText("8N1");
  expect(received[0].message).toBe("First line\nSecond line");
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.locator('.project-chat-message[data-role="assistant"] .project-chat-copy').click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("The UART uses **8N1**.");
  await page.locator("#projectChatNewBtn").click();
  await expect(page.locator("#projectChatThread .project-chat-message")).toHaveCount(0);
  await expect(page.locator("#siteDialog")).toBeHidden();
  await selectChat(page, firstChat);
  await expect(page.locator("#projectChatThread .project-chat-message")).toHaveCount(2);
  expect(await page.evaluate(() => window.UartDebugAvrAiWorkspace.getInstruction())).toEqual(specification);
});

test("expanded chat shows its conversation name without a redundant Chat label or viewport tooltip", async ({ page }) => {
  await mockReplies(page, [], "A short response.");
  await open(page);
  await expect(page.locator("#projectChatTitle")).toHaveText("New chat");
  await expect(page.locator(".project-chat-header").getByRole("heading", { name: "Chat", exact: true })).toHaveCount(0);
  await expect(page.locator("#projectChatThread")).toHaveAttribute("aria-label", "Conversation");
  await page.locator("#projectChatThread").hover();
  await page.waitForTimeout(650);
  await expect(page.locator(".ui-tooltip.is-visible")).toHaveCount(0);
  await page.locator("#projectChatInput").fill("Explain this project.");
  await page.locator("#projectChatInput").press("Enter");
  await expect(page.locator('.project-chat-message[data-role="assistant"]')).toContainText("A short response.");
  await page.locator('.project-chat-message[data-role="assistant"] .project-chat-copy').hover();
  await expect(page.locator(".ui-tooltip.is-visible")).toHaveText("Copy message");
  await page.locator("#projectChatThread").hover({ position: { x: 40, y: 220 } });
  await page.waitForTimeout(650);
  await expect(page.locator(".ui-tooltip.is-visible")).toHaveCount(0);
});

test("switching projects interrupts the old conversation without leaking its response", async ({ page }) => {
  let release;
  await page.route("**/api/avr/ai/chat", async route => {
    const input = route.request().postDataJSON();
    await new Promise(resolve => { release = resolve; });
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(reply(input, "Wrong project response")) }).catch(() => {});
  });
  await open(page);
  await page.locator("#projectChatInput").fill("Explain the first project.");
  await page.locator("#projectChatSendBtn").click();
  await expect.poll(() => typeof release).toBe("function");
  await page.evaluate(async () => {
    const { project } = await (await fetch("/api/avr/ai/projects/motion-example")).json();
    project.id = "new-context"; project.title = "New context"; project.displayName = "New context";
    project.files.forEach(file => { file.name = file.name.replace("Motion example", "New context"); });
    await window.UartDebugAvrMiniProjects.install(project);
  });
  release();
  await expect(page.locator("#projectChatThread .project-chat-message")).toHaveCount(0);
  await page.locator("#filesOpenBtn").click();
  await page.locator('#fileList .file-item[data-file]').filter({ hasText: "Motion example" }).click();
  await expect(page.locator("#projectChatThread")).toContainText("interrupted after changing projects");
  await expect(page.locator("#projectChatThread")).not.toContainText("Wrong project response");
});

test("a delayed artifact response cannot overwrite a newer specification", async ({ page }) => {
  let finish;
  await page.route("**/api/avr/ai/chat", async route => {
    const input = route.request().postDataJSON();
    await new Promise(resolve => { finish = async () => {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({
        ok: true, kind: "canvas", stage: "analyze", message: "Old result", baseRevision: input.canvas.revision,
        canvas: { ...input.canvas, revision: input.canvas.revision + 1, markdown: "Old AI text", annotations: [] },
      }) }); resolve();
    }; });
  });
  await open(page);
  await page.locator("#projectChatInput").fill("Update the specification");
  await page.locator("#projectChatSendBtn").click();
  await expect.poll(() => typeof finish).toBe("function");
  await page.evaluate(() => window.UartDebugAvrAiWorkspace.setInstruction("Newer manual specification"));
  await finish();
  await expect(page.locator('.project-chat-message[data-status="error"]')).toContainText("newer edits were preserved");
  expect((await page.evaluate(() => window.UartDebugAvrAiWorkspace.getInstruction())).markdown).toBe("Newer manual specification");
});

test("reading older messages is not interrupted by a new answer and Jump returns to the latest", async ({ page }) => {
  let complete, count = 0;
  await page.route("**/api/avr/ai/chat", async route => {
    const input = route.request().postDataJSON();
    const answer = "A detailed project explanation.\n\n".repeat(35);
    if (count++ === 1) await new Promise(resolve => { complete = resolve; });
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(reply(input, answer)) });
  });
  await open(page);
  await page.locator("#projectChatInput").fill("Explain this project.");
  await page.locator("#projectChatSendBtn").click();
  await expect(page.locator('.project-chat-message[data-role="assistant"][data-status="complete"]')).toHaveCount(1);
  await page.locator("#projectChatInput").fill("Explain the next part.");
  await page.locator("#projectChatSendBtn").click();
  await expect.poll(() => typeof complete).toBe("function");
  const thread = page.locator("#projectChatThread");
  await thread.evaluate(element => { element.scrollTop = 0; element.dispatchEvent(new Event("scroll")); });
  await expect(page.locator("#projectChatJumpBtn")).toBeVisible();
  complete();
  await expect(page.locator('.project-chat-message[data-role="assistant"][data-status="complete"]')).toHaveCount(2);
  expect(await thread.evaluate(element => element.scrollTop)).toBeLessThan(1);
  await page.locator("#projectChatJumpBtn").click();
  await expect.poll(() => thread.evaluate(element => element.scrollHeight - element.scrollTop - element.clientHeight)).toBeLessThan(2);
  await expect(page.locator("#projectChatJumpBtn")).toBeHidden();
});

test("compact target controls keep Projects and Notifications usable with a longer package name", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await open(page, false);
  await page.selectOption("#mcuSelect", "attiny1624");
  await page.selectOption("#projectPackageSelect", "TSSOP-14");
  await page.locator("#devicePanelToggle").focus(); await page.keyboard.press("ArrowUp");
  await expect(page.locator("#avrDeviceSection")).not.toHaveClass(/is-device-panel-transitioning/);
  const controls = await page.locator(".avr-overview-row").evaluate(panel => {
    return [...panel.querySelectorAll(".custom-select-trigger, #filesOpenBtn, #notificationsBtn")].map(element => {
      const bounds = element.closest(".avr-overview-viewport").getBoundingClientRect();
      const box = element.getBoundingClientRect();
      return { left: box.left - bounds.left, right: bounds.right - box.right };
    });
  });
  expect(controls).toHaveLength(4);
  for (const control of controls) { expect(control.left).toBeGreaterThanOrEqual(0); expect(control.right).toBeGreaterThanOrEqual(0); }
  await page.locator("#filesOpenBtn").click();
  await expect(page.locator("#filesModal")).toBeVisible();
});


test("chats retain separate drafts and histories across reloads inside one project", async ({ page }, testInfo) => {
  const received = [];
  await mockReplies(page, received, "A response in this chat.");
  await open(page);
  const first = await activeChatId(page);
  await page.locator("#projectChatInput").fill("Explain clock initialization and the exact oscillator configuration for this project.");
  await page.locator("#projectChatSendBtn").click();
  await expect(page.locator('.project-chat-message[data-role="assistant"]')).toHaveCount(1);
  await page.locator("#projectChatInput").fill("Clock draft");
  await page.locator("#projectChatNewBtn").click();
  const second = await activeChatId(page);
  expect(second).not.toBe(first);
  await expect(page.locator("#projectChatInput")).toHaveValue("");
  await expect(page.locator("#projectChatThread .project-chat-message")).toHaveCount(0);
  await page.locator("#projectChatInput").fill("Interrupt draft");
  await page.reload({ waitUntil: "load" });
  expect(await activeChatId(page)).toBe(second);
  await expect(page.locator("#projectChatInput")).toHaveValue("Interrupt draft");
  await selectChat(page, first);
  await expect(page.locator("#projectChatInput")).toHaveValue("Clock draft");
  await expect(page.locator("#projectChatThread .project-chat-message")).toHaveCount(2);
  await selectChat(page, second);
  await page.locator("#projectChatInput").fill("Explain interrupts.");
  await page.locator("#projectChatSendBtn").click();
  await expect(page.locator('.project-chat-message[data-role="assistant"]')).toHaveCount(1);
  expect(received[1].history).toEqual([]);
  await selectChat(page, first);
  await page.locator("#projectChatInput").fill("What about prescaling?");
  await page.locator("#projectChatSendBtn").click();
  await expect(page.locator('.project-chat-message[data-role="assistant"]')).toHaveCount(2);
  expect(received[2].history.map(item => item.content)).toEqual([
    received[0].message, "A response in this chat.",
  ]);
  await page.setViewportSize({ width: 900, height: 768 });
  const geometry = await page.locator(".project-chat-header").evaluate(header => {
    const frame = header.getBoundingClientRect();
    const button = header.querySelector("#projectChatNewBtn").getBoundingClientRect();
    const history = header.querySelector("#projectChatHistoryBtn").getBoundingClientRect();
    return { plusFits: button.right <= frame.right + 1, gap: button.left - history.right,
      width: history.width, headerWidth: frame.width, heights: [button.height, history.height] };
  });
  expect(geometry.plusFits).toBe(true);
  expect(geometry.gap).toBeGreaterThanOrEqual(7);
  expect(geometry.width).toBeLessThan(geometry.headerWidth);
  expect(geometry.heights[0]).toBe(geometry.heights[1]);
  await page.screenshot({ path: testInfo.outputPath("multiple-project-chats.png") });
});

test("switching chats interrupts the old response before it can alter shared project artifacts", async ({ page }) => {
  let finish;
  await page.route("**/api/avr/ai/chat", async route => {
    const request = route.request().postDataJSON();
    await new Promise(resolve => { finish = async () => {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({
        ok: true, kind: "canvas", stage: "analyze", message: "Late chat result", baseRevision: request.canvas.revision,
        canvas: { ...request.canvas, revision: request.canvas.revision + 1, markdown: "Wrong chat specification", annotations: [] },
      }) }).catch(() => {});
      resolve();
    }; });
  });
  await open(page);
  const specification = await page.evaluate(() => window.UartDebugAvrAiWorkspace.getInstruction());
  const first = await activeChatId(page);
  await page.locator("#projectChatInput").fill("Review this specification.");
  await page.locator("#projectChatSendBtn").click();
  await expect.poll(() => typeof finish).toBe("function");
  await page.locator("#projectChatNewBtn").click();
  await finish();
  await expect(page.locator("#projectChatThread .project-chat-message")).toHaveCount(0);
  expect(await page.evaluate(() => window.UartDebugAvrAiWorkspace.getInstruction())).toEqual(specification);
  await selectChat(page, first);
  await expect(page.locator('.project-chat-message[data-status="error"]')).toContainText("interrupted after creating another chat");
  await expect(page.locator("#projectChatThread")).not.toContainText("Late chat result");
});

test("legacy project conversation migrates intact and blank chats have distinct names", async ({ page }) => {
  await open(page);
  await page.addInitScript(() => {
    const key = "ud_avr_programming_state_v5", state = JSON.parse(localStorage.getItem(key));
    Object.values(state.miniProjects)[0].conversation = { schemaVersion: 1, draft: "Legacy unsent draft", messages: [
      { id: "legacy-message", role: "user", content: "Legacy conversation", createdAt: 1, status: "complete" },
    ] };
    localStorage.setItem(key, JSON.stringify(state));
  });
  await page.reload({ waitUntil: "load" });
  await expect(page.locator("#projectChatThread")).toContainText("Legacy conversation");
  await expect(page.locator("#projectChatInput")).toHaveValue("Legacy unsent draft");
  const first = await activeChatId(page);
  await page.locator("#projectChatNewBtn").click();
  const empty = await activeChatId(page);
  await page.locator("#projectChatNewBtn").click();
  expect(await activeChatId(page), "a second New chat reuses the already empty conversation").toBe(empty);
  await page.locator("#projectChatInput").fill("Another unsent draft");
  await page.locator("#projectChatNewBtn").click();
  const labels = (await chatState(page)).threads.map(item => item.title);
  expect(labels).toHaveLength(3);
  expect(new Set(labels).size).toBe(3);
  await selectChat(page, first);
  await expect(page.locator("#projectChatInput")).toHaveValue("Legacy unsent draft");
  await expect(page.locator("#projectChatThread")).toContainText("Legacy conversation");
});


test("chat titles stay concise while restored long names remain accessible", async ({ page }, testInfo) => {
  await mockReplies(page, [], "A short reply.");
  await page.setViewportSize({ width: 900, height: 768 });
  await open(page);
  const first = await activeChatId(page);
  const prompt = "Create a non-blocking UART example for ATtiny1624 with a button interrupt, periodic LED status, debouncing, and printf output at 115200 baud without delay loops.";
  await page.locator("#projectChatInput").fill(prompt);
  await page.locator("#projectChatSendBtn").click();
  await expect(page.locator('.project-chat-message[data-role="assistant"]')).toHaveCount(1);
  const savedTitle = (await chatState(page)).threads[0].title;
  expect(Array.from(savedTitle).length).toBeLessThanOrEqual(72);
  expect(savedTitle).toMatch(/…$/);
  await expect(page.locator('.project-chat-message[data-role="user"] .project-chat-message-content')).toHaveText(prompt);
  await page.locator("#projectChatNewBtn").click();
  await openHistory(page);
  const label = page.locator(`[data-chat-open="${first}"] .project-chat-history-title`);
  const atMostTwoLines = locator => locator.evaluate(element => {
    const style = getComputedStyle(element), box = element.getBoundingClientRect();
    return box.height <= 2 * parseFloat(style.lineHeight) + 0.5;
  });
  expect(await atMostTwoLines(label)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("chat-history-natural-title.png") });
  await page.locator(`[data-chat-open="${first}"]`).focus();
  await page.keyboard.press("Enter");
  expect(await activeChatId(page)).toBe(first);
  await expect(page.locator("#projectChatThread")).toContainText("A short reply.");
  const restoredName = "界".repeat(85);
  await page.addInitScript(({ id, title }) => {
    const key = "ud_avr_programming_state_v5", state = JSON.parse(localStorage.getItem(key));
    Object.values(state.miniProjects)[0].conversation.threads.find(item => item.id === id).title = title;
    localStorage.setItem(key, JSON.stringify(state));
  }, { id: first, title: restoredName });
  await page.reload({ waitUntil: "load" });
  await openHistory(page);
  await expect(label).toHaveText(restoredName);
  expect(await atMostTwoLines(label)).toBe(true);
  expect((await chatState(page)).threads[0].title).toBe(restoredName);
  await page.screenshot({ path: testInfo.outputPath("chat-history-restored-title.png") });
});

test("the chat-count limit reports the problem without replacing existing chats", async ({ page }) => {
  await open(page);
  await page.addInitScript(() => {
    const key = "ud_avr_programming_state_v5", state = JSON.parse(localStorage.getItem(key));
    Object.values(state.miniProjects)[0].conversation = { schemaVersion: 2, activeThreadId: "limit-0",
      threads: Array.from({ length: 32 }, (_, index) => ({ id: `limit-${index}`, title: `Chat ${index + 1}`,
        draft: `Draft ${index + 1}`, messages: [] })) };
    localStorage.setItem(key, JSON.stringify(state));
  });
  await page.reload({ waitUntil: "load" });
  const before = await page.evaluate(() => window.UartDebugAvrAiWorkspace.getChats());
  await page.locator("#projectChatNewBtn").click();
  await expect(page.locator(".notification-toast-open")).toContainText("at most 32 chats");
  await expect(page.locator("#projectChatInput")).toHaveValue("Draft 1");
  expect(await page.evaluate(() => window.UartDebugAvrAiWorkspace.getChats())).toEqual(before);
});


test("a failed chat transfer keeps the received answer and every draft without clearing the source", async ({ page }) => {
  await page.route("**/api/avr/ai/chat", async route => {
    const input = route.request().postDataJSON();
    await page.evaluate(() => {
      const original = Storage.prototype.setItem;
      window.__restoreChatStorage = () => { Storage.prototype.setItem = original; };
      Storage.prototype.setItem = function (key, value) {
        if (key === "ud_avr_programming_state_v5") {
          const state = JSON.parse(value);
          if (Object.values(state.miniProjects).some(project => project.conversation?.threads.some(thread =>
            thread.messages.some(message => message.role === "assistant" && message.content === "Created the Blink project.")))) {
            throw new DOMException("Test storage limit reached", "QuotaExceededError");
          }
        }
        return original.call(this, key, value);
      };
    });
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({
      ok: true, kind: "project", stage: "generate", operation: "create", baseRevision: input.canvas.revision,
      canvas: { ...input.canvas, revision: input.canvas.revision + 1,
        markdown: "# Project Blink\n\nProject version - Ver.1.0", locale: "en", annotations: [], target: { mcu: "attiny1624", packageName: "SOIC-14" } },
      project: { schemaVersion: 1, id: "blink", title: "Blink", version: "Ver.1.0", files: [
        { role: "source", name: "Blink.c", content: "#include <xc.h>\nint main(void) { while (1) {} }\n" },
        { role: "specification", name: "Blink.yaml", content: "microcontroller:\n  model: ATtiny1624\n  package: SOIC-14\nhardware_resources: {}\nsoftware_dependencies: {}\n" },
      ] }, message: "Created the Blink project.",
    }) });
  });
  await open(page, false);
  await page.locator("#projectChatInput").fill("Keep this planning draft");
  await page.locator("#projectChatNewBtn").click();
  await page.locator("#projectChatInput").fill("Create Blink Ver.1.0 for ATtiny1624 SOIC-14.");
  await page.locator("#projectChatSendBtn").click();
  await expect(page.locator('.project-chat-message[data-role="assistant"][data-status="complete"] .project-chat-message-content')).toHaveText("Created the Blink project.");
  await expect(page.locator(".notification-toast-open")).toContainText(["Response received but could not be saved"]);
  await expect(page.locator('.project-chat-message[data-status="error"]')).toHaveCount(0);
  const state = await page.evaluate(() => JSON.parse(localStorage.getItem("ud_avr_programming_state_v5")));
  expect(state.draftConversation.threads).toHaveLength(2);
  expect(state.draftConversation.threads[0].draft).toBe("Keep this planning draft");
  expect(state.draftConversation.threads[1].messages[0].content).toContain("Create Blink");
  expect(Object.values(state.miniProjects)[0].conversation).toBeUndefined();
  await page.evaluate(() => window.__restoreChatStorage());
});


async function openChatActions(page, id = null) {
  if (id) {
    await openHistory(page);
    await page.locator(`[data-chat-menu="${id}"]`).click();
  } else await page.locator("#projectChatActionsBtn").click();
  await expect(page.locator("#projectChatMenu")).toBeVisible();
  await page.locator('#projectChatMenu [data-chat-action="delete"]').click();
  await expect(page.locator("#siteDialog")).toBeVisible();
}

test("chat deletion uses shared confirmation and replaces the last chat only after approval", async ({ page }) => {
  await open(page);
  const first = await activeChatId(page);
  await page.locator("#projectChatInput").fill("Preserve this draft until deletion is approved.");
  await openChatActions(page);
  await expect(page.locator("#siteDialog")).toContainText("Project files will be kept.");
  await page.locator("#siteDialogCancelBtn").click();
  await expect(page.locator("#projectChatActionsBtn")).toBeFocused();
  await expect(page.locator("#projectChatInput")).toHaveValue("Preserve this draft until deletion is approved.");
  expect(await activeChatId(page)).toBe(first);
  await openChatActions(page);
  await page.locator("#siteDialogConfirmBtn").click();
  await expect(page.locator("#projectChatInput")).toHaveValue("");
  expect((await chatState(page)).threads).toHaveLength(1);
  expect(await activeChatId(page)).not.toBe(first);
  expect((await chatState(page)).threads[0].title).toBe("New chat");
});

test("cancelling deletion keeps a response running and confirming deletion rejects its late artifact", async ({ page }) => {
  let finish;
  await page.route("**/api/avr/ai/chat", async route => {
    const request = route.request().postDataJSON();
    await new Promise(resolve => { finish = async () => {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({
        ok: true, kind: "canvas", stage: "analyze", message: "Deleted-chat response", baseRevision: request.canvas.revision,
        canvas: { ...request.canvas, revision: request.canvas.revision + 1, markdown: "Deleted-chat artifact", annotations: [] },
      }) }).catch(() => {});
      resolve();
    }; });
  });
  await open(page);
  const specification = await page.evaluate(() => window.UartDebugAvrAiWorkspace.getInstruction());
  await page.locator("#projectChatInput").fill("Review the current specification.");
  await page.locator("#projectChatSendBtn").click();
  await expect.poll(() => typeof finish).toBe("function");
  await openChatActions(page);
  await page.locator("#siteDialogCancelBtn").click();
  await expect(page.locator("#projectChatSendBtn")).toHaveAttribute("aria-label", "Stop response");
  await expect(page.locator('.project-chat-message[data-status="pending"]')).toHaveCount(1);
  await openChatActions(page);
  await page.locator("#siteDialogConfirmBtn").click();
  await finish();
  await expect(page.locator("#projectChatThread .project-chat-message")).toHaveCount(0);
  expect(await page.evaluate(() => window.UartDebugAvrAiWorkspace.getInstruction())).toEqual(specification);
});

test("deleting an inactive chat frees quota while retaining the current unsaved answer and draft", async ({ page }) => {
  const answer = "Received answer: " + "x".repeat(32768 - 17);
  await mockReplies(page, [], answer);
  await open(page);
  await page.addInitScript(() => {
    if (sessionStorage.getItem("chat-quota-seeded")) return;
    sessionStorage.setItem("chat-quota-seeded", "true");
    const key = "ud_avr_programming_state_v5", state = JSON.parse(localStorage.getItem(key));
    const chats = { schemaVersion: 2, activeThreadId: "large-0",
      threads: Array.from({ length: 9 }, (_, index) => ({ id: `large-${index}`, title: `Stored chat ${index + 1}`, draft: "",
        messages: Array.from({ length: index ? 8 : 2 }, (_, message) => ({ id: `message-${message}`, role: "assistant", status: "complete",
          createdAt: message + 1, content: message === 7 ? "q" : "z".repeat(32768) })) })) };
    let remaining = 2 * 1024 * 1024 - 16 * 1024 - new TextEncoder().encode(JSON.stringify(chats)).length;
    for (let index = 1; index < chats.threads.length; index++) {
      const extra = Math.floor(remaining / (chats.threads.length - index));
      chats.threads[index].messages[7].content += "q".repeat(extra);
      remaining -= extra;
    }
    Object.values(state.miniProjects)[0].conversation = chats;
    localStorage.setItem(key, JSON.stringify(state));
  });
  await page.reload({ waitUntil: "load" });
  await page.locator("#projectChatInput").fill("Explain the UART setup.");
  await page.locator("#projectChatSendBtn").click();
  await expect.poll(() => page.evaluate(() => window.UartDebugAvrAiWorkspace.getConversation().messages.at(-1).content)).toBe(answer);
  await expect(page.locator(".notification-toast-open")).toContainText(["Response received but could not be saved"]);
  await page.locator("#projectChatInput").fill("Keep this unsent follow-up.");
  await openChatActions(page, "large-1");
  await page.locator("#siteDialogConfirmBtn").click();
  await page.locator("#projectChatHistoryBtn").click();
  await expect(page.locator("#projectChatInput")).toHaveValue("Keep this unsent follow-up.");
  const saved = await page.evaluate(() => window.UartDebugAvrAiWorkspace.getChats());
  expect(saved.threads).toHaveLength(8);
  expect(saved.threads.some(item => item.id === "large-1")).toBe(false);
  expect(saved.activeThreadId).toBe("large-0");
  expect(saved.threads[0].messages.at(-1).content).toBe(answer);
  expect(saved.threads[0].draft).toBe("Keep this unsent follow-up.");
  await page.reload({ waitUntil: "load" });
  await expect(page.locator("#projectChatInput")).toHaveValue("Keep this unsent follow-up.");
  expect((await page.evaluate(() => window.UartDebugAvrAiWorkspace.getChats())).threads[0].messages.at(-1).content).toBe(answer);
});


test("chat actions share keyboard dismissal, outside click, resize and scroll behavior", async ({ page }) => {
  await mockReplies(page, [], "A long answer to scroll.\n\n".repeat(70));
  await open(page);
  await page.locator("#projectChatInput").fill("Explain the project.");
  await page.locator("#projectChatSendBtn").click();
  await expect(page.locator('.project-chat-message[data-status="complete"][data-role="assistant"]')).toHaveCount(1);
  const trigger = page.locator("#projectChatActionsBtn");
  const menu = page.locator("#projectChatMenu");
  const show = async () => { await trigger.focus(); await page.keyboard.press("Shift+F10"); await expect(menu).toBeVisible(); };
  await show();
  for (const key of ["ArrowDown", "ArrowUp", "Home", "End"]) {
    await page.keyboard.press(key);
    expect(await menu.locator('[role="menuitem"]').evaluateAll(elements => elements.some(element => element === document.activeElement))).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden(); await expect(trigger).toBeFocused();
  await show(); await page.keyboard.press("Tab");
  await expect(menu).toBeHidden(); await expect(page.locator("#projectChatThread")).toBeFocused();
  await show(); await page.locator("#projectChatInput").click();
  await expect(menu).toBeHidden(); await expect(page.locator("#projectChatInput")).toBeFocused();
  await show(); await page.setViewportSize({ width: 1400, height: 820 }); await expect(menu).toBeHidden();
  await show();
  const thread = page.locator("#projectChatThread");
  const previous = await thread.evaluate(element => element.scrollTop);
  await thread.hover(); await page.mouse.wheel(0, -500);
  await expect.poll(() => thread.evaluate(element => element.scrollTop)).toBeLessThan(previous);
  await expect(menu).toBeHidden();
});

test("a context change closes chat actions and rejects a queued action from the old project", async ({ page }) => {
  await open(page);
  await page.locator("#projectChatActionsBtn").focus();
  await page.keyboard.press("Shift+F10");
  await expect(page.locator("#projectChatMenu")).toBeVisible();
  await page.evaluate(async () => {
    const { project } = await (await fetch("/api/avr/ai/projects/motion-example")).json();
    project.id = "context-switch"; project.title = "Different project"; project.displayName = project.title;
    project.files.forEach(file => { file.name = file.name.replace("Motion example", "Different project"); });
    await window.UartDebugAvrMiniProjects.install(project);
  });
  await expect(page.locator("#projectChatMenu")).toBeHidden();
  await page.locator('#projectChatMenu [data-chat-action="delete"]').dispatchEvent("click");
  await expect(page.locator("#siteDialog")).toBeHidden();
  expect((await chatState(page)).threads).toHaveLength(1);
  await expect(page.locator("#projectChatInput")).toHaveValue("");
});


test("history exposes rename and export without retired search or organization controls", async ({ page }) => {
  await mockReplies(page, [], "The timer controls the LED.");
  await open(page);
  const first = await activeChatId(page);
  const specification = await page.evaluate(() => window.UartDebugAvrAiWorkspace.getInstruction());
  await page.locator("#projectChatActionsBtn").click();
  await page.locator('#projectChatMenu [data-chat-action="rename"]').click();
  const rename = page.getByRole("textbox", { name: "Chat name", exact: true });
  await rename.fill("UART planning");
  await rename.press("Enter");
  await page.locator("#projectChatHistoryBtn").click();
  await page.locator("#projectChatInput").fill("Discuss the UART peripheral in this project.");
  await page.locator("#projectChatSendBtn").click();
  await expect(page.locator('.project-chat-message[data-role="assistant"]')).toContainText("timer");
  expect((await chatState(page)).threads[0]).toMatchObject({ title: "UART planning", titleMode: "manual" });
  await page.locator("#projectChatNewBtn").click();
  const second = await activeChatId(page);
  await page.locator("#projectChatInput").fill("Keep the second draft");
  await openHistory(page);
  await expect(page.locator("[data-chat-open]")).toHaveCount(2);
  await expect(page.locator("#projectChatSearch, #projectChatActiveFilter, #projectChatArchivedFilter, #projectChatArchiveNote, #projectChatRestoreBtn, .project-chat-history-group")).toHaveCount(0);
  await page.locator(`[data-chat-menu="${first}"]`).click();
  expect(await page.locator("#projectChatMenu [data-chat-action]").evaluateAll(items => items.map(item => item.dataset.chatAction))).toEqual(["rename", "export", "delete"]);
  const downloaded = page.waitForEvent("download");
  await page.locator('#projectChatMenu [data-chat-action="export"]').click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe("UART planning.md");
  const content = require("node:fs").readFileSync(await download.path(), "utf8");
  expect(content).toContain("# UART planning");
  expect(content).toContain("Discuss the UART peripheral");
  expect(content).toContain("The timer controls the LED.");
  expect(content).not.toContain("Keep the second draft");
  expect(await activeChatId(page)).toBe(second);
  expect(await page.evaluate(() => window.UartDebugAvrAiWorkspace.getInstruction())).toEqual(specification);
  await page.reload({ waitUntil: "load" });
  const state = await chatState(page);
  expect(state.schemaVersion).toBe(6);
  expect(state.threads[0]).toMatchObject({ title: "UART planning", titleMode: "manual" });
  expect(Object.hasOwn(state.threads[0], "pinned")).toBe(false);
  expect(Object.hasOwn(state.threads[0], "archived")).toBe(false);
  await expect(page.locator("#projectChatInput")).toHaveValue("Keep the second draft");
});

test("all legacy archived and pinned chats remain visible without retaining the removed flags", async ({ page }) => {
  await open(page);
  const legacy = { schemaVersion: 3, activeThreadId: "archived", threads: [
    { id: "pinned", title: "Older pinned chat", titleMode: "manual", pinned: true, archived: false, draft: "Pinned draft", messages: [
      { id: "pin-message", role: "user", content: "Keep the pinned conversation.", createdAt: 1, status: "complete" },
    ] },
    { id: "archived", title: "Archived review", titleMode: "manual", pinned: false, archived: true, draft: "Archived draft", messages: [
      { id: "archived-user", role: "user", content: "Review the specification.", createdAt: 2, status: "complete", requestSource: "review" },
      { id: "archived-answer", role: "assistant", content: "Keep the archived answer.", createdAt: 3, status: "complete" },
    ] },
    { id: "newer", title: "Newer conversation", titleMode: "manual", pinned: false, archived: false, draft: "Newer draft", messages: [
      { id: "recent-message", role: "user", content: "The newest conversation.", createdAt: 4, status: "complete" },
    ] },
  ] };
  await page.addInitScript(legacy => {
    if (sessionStorage.getItem("removed-chat-flags-migrated")) return;
    sessionStorage.setItem("removed-chat-flags-migrated", "true");
    const key = "ud_avr_programming_state_v5", state = JSON.parse(localStorage.getItem(key));
    Object.values(state.miniProjects)[0].conversation = legacy;
    localStorage.setItem(key, JSON.stringify(state));
  }, legacy);
  await page.reload({ waitUntil: "load" });
  await expect(page.locator("#projectChatThread")).toContainText("Keep the archived answer.");
  await expect(page.locator("#projectChatInput")).toHaveValue("Archived draft");
  await expect(page.locator("#projectChatInput")).toHaveAttribute("placeholder", "Ask about your project");
  await openHistory(page);
  expect(await page.locator("[data-chat-open]").evaluateAll(items => items.map(item => item.dataset.chatOpen))).toEqual(["newer", "archived", "pinned"]);
  await expect(page.locator("#projectChatSearch, #projectChatActiveFilter, #projectChatArchivedFilter, #projectChatArchiveNote, #projectChatRestoreBtn, .project-chat-history-group")).toHaveCount(0);
  const state = await chatState(page);
  expect(state.schemaVersion).toBe(6);
  expect(state.threads).toHaveLength(3);
  for (const original of legacy.threads) {
    const migrated = state.threads.find(item => item.id === original.id);
    expect(migrated.title).toBe(original.title);
    expect(migrated.draft).toBe(original.draft);
    expect(migrated.titleMode).toBe("manual");
    expect(migrated.messages.map(({ id, content, createdAt }) => ({ id, content, createdAt }))).toEqual(original.messages.map(({ id, content, createdAt }) => ({ id, content, createdAt })));
    expect(Object.hasOwn(migrated, "pinned")).toBe(false);
    expect(Object.hasOwn(migrated, "archived")).toBe(false);
  }
  expect(state.threads.find(item => item.id === "archived").messages[0].requestSource).toBe("review");
  await page.reload({ waitUntil: "load" });
  await openHistory(page);
  await expect(page.locator("[data-chat-open]")).toHaveCount(3);
});

test("opening history during a response keeps row focus and scroll position without stopping the response", async ({ page }) => {
  let finish;
  await page.route("**/api/avr/ai/chat", async route => {
    const request = route.request().postDataJSON();
    await new Promise(resolve => { finish = async () => {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(reply(request, "Finished while reading history.")) }); resolve();
    }; });
  });
  await open(page);
  await page.addInitScript(() => {
    if (sessionStorage.getItem("history-many")) return;
    sessionStorage.setItem("history-many", "true");
    const key = "ud_avr_programming_state_v5", state = JSON.parse(localStorage.getItem(key));
    Object.values(state.miniProjects)[0].conversation = { schemaVersion: 3, activeThreadId: "history-0", threads:
      Array.from({ length: 20 }, (_, index) => ({ id: `history-${index}`, title: `History example ${index}`,
        titleMode: "manual", pinned: false, archived: index % 2 === 1, draft: "", messages: [] })) };
    localStorage.setItem(key, JSON.stringify(state));
  });
  await page.reload({ waitUntil: "load" });
  await page.locator("#projectChatInput").fill("Explain this project.");
  await page.locator("#projectChatSendBtn").click();
  await expect.poll(() => typeof finish).toBe("function");
  await openHistory(page);
  await expect(page.locator("[data-chat-open]")).toHaveCount(20);
  const list = page.locator("#projectChatHistoryList");
  await list.hover(); await page.mouse.wheel(0, 300);
  await expect.poll(() => list.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  const focusChat = await list.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return [...element.querySelectorAll("[data-chat-menu]")].find(item => {
      const box = item.getBoundingClientRect();
      return box.top >= bounds.top + 4 && box.bottom <= bounds.bottom - 4;
    })?.dataset.chatMenu;
  });
  expect(focusChat).toBeTruthy();
  const focused = page.locator(`[data-chat-menu="${focusChat}"]`);
  await focused.focus();
  const before = await list.evaluate(element => element.scrollTop);
  await finish();
  await expect(page.locator("#projectChatSendBtn")).toHaveAttribute("aria-label", "Send message");
  await expect(focused).toBeFocused();
  expect(await list.evaluate(element => element.scrollTop)).toBeCloseTo(before, 0);
  await page.locator("#projectChatHistoryBtn").click();
  await expect(page.locator("#projectChatThread")).toContainText("Finished while reading history.");
});

for (const width of [900, 1543]) {
  test(`the model stays directly beside Send with a long project name before and after reopening at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 884 });
    await open(page);
    const projectTitle = "A detailed UART project with a long descriptive name for the serial connection and interrupt example";
    await page.addInitScript(title => {
      const key = "ud_avr_programming_state_v5", state = JSON.parse(localStorage.getItem(key));
      Object.values(state.miniProjects)[0].displayName = title;
      localStorage.setItem(key, JSON.stringify(state));
    }, projectTitle);
    await page.reload({ waitUntil: "load" });
    await expect(page.locator("#projectChatProjectName")).toHaveText(projectTitle);
    const read = () => page.locator("#projectChatForm").evaluate(form => {
      const frame = form.getBoundingClientRect(), model = form.querySelector(".project-chat-model").getBoundingClientRect();
      const send = form.querySelector("#projectChatSendBtn").getBoundingClientRect();
      const context = form.querySelector("#projectChatContextBtn").getBoundingClientRect();
      const project = form.querySelector("#projectChatProjectName"), label = project.getBoundingClientRect();
      return { dy: model.y + model.height / 2 - send.y - send.height / 2, gap: send.left - model.right,
        modelFits: model.left >= frame.left && model.right <= frame.right && model.top >= frame.top && model.bottom <= frame.bottom,
        sendFits: send.left >= frame.left && send.right <= frame.right && send.top >= frame.top && send.bottom <= frame.bottom,
        contextOverlaps: context.right > model.left + 0.5 && context.top < model.bottom && context.bottom > model.top,
        labelFits: label.left >= frame.left && label.right <= frame.right,
        clipped: project.scrollWidth > project.clientWidth, ellipsis: getComputedStyle(project).textOverflow,
        overflow: form.scrollWidth > form.clientWidth + 1 };
    });
    const expectInlineModel = geometry => {
      expect(Math.abs(geometry.dy)).toBeLessThan(1);
      expect(geometry.gap).toBeGreaterThan(0);
      expect(geometry.gap).toBeLessThanOrEqual(12);
      expect(geometry.modelFits && geometry.sendFits && geometry.labelFits).toBe(true);
      expect(geometry.contextOverlaps || geometry.overflow).toBe(false);
      expect(geometry.clipped).toBe(true);
      expect(geometry.ellipsis).toBe("ellipsis");
    };
    const before = await read();
    expectInlineModel(before);
    await page.locator("#fileListResizer").focus();
    await page.keyboard.press("Home");
    await expect(page.locator(".canvas-split-container")).not.toHaveClass(/is-workspace-transitioning/);
    await expect(page.locator("#projectChatForm")).toBeHidden();
    await expect(page.locator("#projectChatCompactLabel")).toBeVisible();
    await page.keyboard.press("ArrowRight");
    await expect(page.locator(".canvas-split-container")).not.toHaveClass(/is-workspace-transitioning/);
    await expect(page.locator("#projectChatForm")).toBeVisible();
    const after = await read();
    expectInlineModel(after);
    expect(after.gap).toBeCloseTo(before.gap, 1);
    await page.screenshot({ path: testInfo.outputPath(`chat-model-send-${width}.png`) });
  });
}

test("all more-menu buttons share glyph geometry, visual states and keyboard dismissal", async ({ page }) => {
  await open(page);
  const samples = [];
  async function inspect(trigger, menu) {
    const read = () => trigger.evaluate(element => {
      const box = element.getBoundingClientRect(), style = getComputedStyle(element);
      const range = document.createRange(); range.selectNodeContents(element);
      const glyph = range.getBoundingClientRect();
      return {
        width: box.width, height: box.height,
        glyphX: glyph.x - box.x, glyphY: glyph.y - box.y,
        glyphWidth: glyph.width, glyphHeight: glyph.height,
        font: style.font, padding: style.padding, radius: style.borderRadius,
        color: style.color, background: style.backgroundColor, border: style.borderColor,
        outline: style.outline, outlineOffset: style.outlineOffset,
      };
    });
    const settle = () => trigger.evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished.catch(() => {}))));
    await page.mouse.move(0, 0);
    await trigger.evaluate(element => element.blur());
    await settle();
    const normal = await read();
    await trigger.hover(); await settle();
    const hover = await read();
    await page.mouse.move(0, 0);
    await trigger.focus();
    // Use keyboard navigation so :focus-visible is compared in the same input
    // modality, regardless of whether a preceding view opened by mouse.
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(trigger).toBeFocused();
    await settle();
    const focus = await read();
    await page.keyboard.press("Enter");
    await expect(menu).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
    samples.push({ normal, hover, focus });
  }
  await inspect(page.locator("#projectChatActionsBtn"), page.locator("#projectChatMenu"));
  await openHistory(page);
  await inspect(page.locator("[data-chat-menu]").first(), page.locator("#projectChatMenu"));
  await page.locator("#filesOpenBtn").click();
  await inspect(page.locator("#fileList .file-menu-btn").first(), page.locator("#fileContextMenu"));
  expect(samples[1], "history menu uses the current-chat menu's shared glyph and state rules").toEqual(samples[0]);
  expect(samples[2], "project menu retains the same standard control geometry and states").toEqual(samples[0]);
});

test("unexpected JavaScript chat failures stay in DevTools while application errors remain actionable", async ({ page }) => {
  const logs = [];
  page.on("console", message => { if (message.type() === "info") logs.push(message.text()); });
  await open(page);
  await page.evaluate(() => {
    const originalFetch = window.fetch;
    window.fetch = (url, options) => String(url).includes("/api/avr/ai/chat")
      ? Promise.reject(new TypeError("Cannot read properties of undefined (reading 'internalField')"))
      : originalFetch(url, options);
  });
  await page.locator("#projectChatInput").fill("Explain this project.");
  await page.locator("#projectChatSendBtn").click();
  const error = page.locator('.project-chat-message[data-status="error"]');
  await expect(error.locator(".project-chat-message-content")).toHaveText("The response could not be completed. Try again.");
  expect(logs.join("\n")).toContain("internalField");
  expect(JSON.stringify(await chatState(page))).not.toContain("internalField");
  await page.locator(".notification-toast-open").filter({ hasText: "The response could not be completed" }).click();
  await expect(page.locator(".notification-detail")).not.toContainText("internalField");
  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    const originalFetch = window.fetch;
    window.fetch = (url, options) => String(url).includes("/api/avr/ai/chat")
      ? Promise.resolve(new Response(JSON.stringify({ ok: false, message: "Select a project before continuing." }), { status: 409 }))
      : originalFetch(url, options);
  });
  await page.locator("#projectChatInput").fill("Try again.");
  await page.locator("#projectChatSendBtn").click();
  await expect(error.last()).toContainText("Select a project before continuing.");
});

for (const width of [900, 1543]) {
  test(`current chat heading stays distinct, bounded and stable through response states and reopening at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 884 });
    let release;
    await page.route("**/api/avr/ai/chat", async route => {
      const request = route.request().postDataJSON();
      await new Promise(resolve => { release = resolve; });
      await route.fulfill({ json: reply(request, "Late response") }).catch(() => {});
    });
    await open(page);
    const title = page.locator("#projectChatTitle");
    await expect(title).toHaveRole("heading");
    await expect(title).toHaveText("New chat");
    const measure = () => page.locator(".project-chat-header").evaluate(header => {
      const box = element => {
        const { top, right, bottom, left, width, height } = element.getBoundingClientRect();
        return { top, right, bottom, left, width, height };
      };
      const heading = header.querySelector("#projectChatTitle"), content = header.querySelector(".project-chat-title-content");
      return { header: box(header), title: box(heading), content: box(content),
        menu: box(header.querySelector("#projectChatActionsBtn")), navigation: box(header.querySelector(".project-chat-navigation")),
        lineHeight: Number.parseFloat(getComputedStyle(heading).lineHeight),
        overflow: header.scrollWidth > header.clientWidth + 1 };
    });
    const empty = await measure();
    expect(empty.navigation.bottom).toBeLessThanOrEqual(empty.title.top);
    for (const name of [
      "UART initialization, clock configuration and interrupt-driven serial transmission",
      "PeripheralConfigurationWithoutSpaces".repeat(5),
    ]) {
      await page.locator("#projectChatActionsBtn").click();
      await page.locator('#projectChatMenu [data-chat-action="rename"]').click();
      await page.getByRole("textbox", { name: "Chat name", exact: true }).fill(name);
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await page.locator("#projectChatHistoryBtn").click();
      await expect(title).toHaveText(name);
      const geometry = await measure();
      expect(geometry.title.height).toBe(geometry.lineHeight);
      expect(geometry.header.height).toBeLessThanOrEqual(80);
      await expect(title).toHaveCSS("white-space", "nowrap");
      await expect(title).toHaveCSS("text-overflow", "ellipsis");
      expect(geometry.content.right).toBeLessThanOrEqual(geometry.menu.left);
      expect(geometry.navigation.bottom).toBeLessThanOrEqual(geometry.title.top);
      expect(geometry.header.height, "short and truncated names retain one compact header footprint").toBe(empty.header.height);
      expect(geometry.overflow).toBe(false);
    }
    const name = await title.textContent(), before = await measure();
    await page.locator("#projectChatInput").fill("Explain this project.");
    await page.locator("#projectChatSendBtn").click();
    await expect.poll(() => typeof release).toBe("function");
    await expect(page.locator('.project-chat-message[data-status="pending"]')).toBeVisible();
    await expect(title).toHaveText(name);
    expect(await measure()).toEqual(before);
    await page.locator("#projectChatSendBtn").click();
    release();
    await expect(page.locator('.project-chat-message[data-status="error"]')).toContainText("stopped");
    await expect(title).toHaveText(name);
    expect(await measure()).toEqual(before);
    await page.locator("#projectChatInput").fill("Preserve this unsent draft.");
    await page.locator("#fileListResizer").focus();
    await page.keyboard.press("Home");
    await expect(page.locator(".canvas-split-container")).not.toHaveClass(/is-workspace-transitioning/);
    await expect(title).toBeHidden();
    await page.keyboard.press("ArrowRight");
    await expect(page.locator(".canvas-split-container")).not.toHaveClass(/is-workspace-transitioning/);
    await expect(title).toHaveText(name);
    await expect(title).toBeVisible();
    await expect(page.locator("#projectChatInput")).toHaveValue("Preserve this unsent draft.");
    await expect(page.locator('.project-chat-message[data-status="error"]')).toContainText("stopped");
    const reopened = await measure();
    expect(reopened.content.right).toBeLessThanOrEqual(reopened.menu.left);
    expect(reopened.navigation.bottom).toBeLessThanOrEqual(reopened.title.top);
    expect(reopened.header.height).toBe(before.header.height);
    expect(reopened.overflow).toBe(false);
    await page.mouse.move(0, 0);
    await expect(page.locator('.ui-tooltip[aria-hidden="false"]')).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath(`chat-heading-${width}.png`) });
    await openHistory(page);
    await expect(title).toHaveText("Project chats");
    await expect(page.locator("#projectChatActionsBtn")).toBeHidden();
  });
}
