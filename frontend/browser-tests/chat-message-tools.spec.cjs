"use strict";

const { test, expect } = require("playwright/test");

test.beforeEach(async ({ page }) => {
  page.__messageErrors = [];
  page.on("pageerror", error => page.__messageErrors.push(error.message));
});
test.afterEach(async ({ page }) => { expect(page.__messageErrors).toEqual([]); });

async function open(page) {
  await page.goto("/avr", { waitUntil: "load" });
  await expect(page).toHaveTitle("AVR Programming - Uart Debug");
  await page.waitForFunction(() => window.UartDebugChatMessageTools && window.UartDebugAvrAiWorkspace);
  await page.evaluate(async () => {
    const { project } = await (await fetch("/api/avr/ai/projects/motion-example")).json();
    await window.UartDebugAvrMiniProjects.install(project);
  });
}

async function replies(page, received, content) {
  await page.route("**/api/avr/ai/chat", async route => {
    const input = route.request().postDataJSON();
    received.push(input);
    await route.fulfill({ json: { ok: true, kind: "chat", stage: "chat", baseRevision: input.canvas.revision,
      message: typeof content === "function" ? content(received.length) : content } });
  });
}

async function send(page, text) {
  await page.locator("#projectChatInput").fill(text);
  await page.locator("#projectChatInput").press("Enter");
  await expect(page.locator("#projectChatSendBtn")).toHaveAttribute("aria-label", "Send message");
}
const chats = page => page.evaluate(() => window.UartDebugAvrAiWorkspace.getChats());

test("Copy code retains the exact code and its toolbar remains visible while code scrolls", async ({ page, context }, testInfo) => {
  const source = `USART1.CTRLB = USART_TXEN_bm;\n// ${"Long source line ".repeat(30)}\n`;
  await replies(page, [], `Configure the transmitter:\n\n\`\`\`c\n${source}\`\`\``);
  await open(page);
  await send(page, "Explain the transmitter.");
  const block = page.locator(".project-chat-code-block");
  await expect(block).toHaveCount(1);
  await expect(block.locator(".project-chat-code-header > span")).toHaveText("c");
  const header = await block.locator(".project-chat-code-header").boundingBox();
  const displayedCode = await block.locator("pre code").textContent();
  expect(displayedCode).toContain("USART1.CTRLB = USART_TXEN_bm;\n// Long source line ");
  await block.locator("pre").evaluate(element => { element.scrollLeft = element.scrollWidth; });
  expect(await block.locator(".project-chat-code-header").boundingBox()).toEqual(header);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const copyButton = block.getByRole("button", { name: "Copy code", exact: true });
  await copyButton.hover();
  await copyButton.evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished.catch(() => {}))));
  const copyBounds = await copyButton.boundingBox();
  await copyButton.click();
  expect((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n?/g, "\n")).toBe(displayedCode);
  await expect(block.getByRole("button", { name: "Code copied", exact: true })).toBeVisible();
  expect(await block.getByRole("button", { name: "Code copied", exact: true }).boundingBox()).toEqual(copyBounds);
  await page.screenshot({ path: testInfo.outputPath("chat-copy-code.png") });
});

test("editing a user message sends a new chat and preserves the original conversation and draft", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 900, height: 884 });
  const received = [];
  await replies(page, received, "Use the current project files.");
  await open(page);
  await send(page, "Explain the UART transmitter.");
  await page.locator("#projectChatInput").fill("Keep this original draft.");
  const original = await chats(page);
  const first = original.threads.find(item => item.id === original.activeThreadId);
  const user = page.locator('.project-chat-message[data-role="user"]').first();
  await user.locator('[data-chat-action="edit"]').click();
  await page.locator(".project-chat-edit textarea").fill("Explain the UART receiver instead.");
  const cancel = await page.getByRole("button", { name: "Cancel", exact: true }).boundingBox();
  const save = await page.getByRole("button", { name: "Send in new chat", exact: true }).boundingBox();
  expect(cancel.y).toBe(save.y);
  await expect(user.locator(".project-chat-message-meta")).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath("chat-edit-message.png") });
  await page.getByRole("button", { name: "Send in new chat", exact: true }).click();
  await expect.poll(() => received.length).toBe(2);
  await expect(page.locator("#projectChatSendBtn")).toHaveAttribute("aria-label", "Send message");
  const updated = await chats(page);
  expect(updated.threads).toHaveLength(2);
  expect(updated.activeThreadId).not.toBe(first.id);
  const kept = updated.threads.find(item => item.id === first.id);
  expect(kept.messages).toEqual(first.messages);
  expect(kept.draft).toBe("Keep this original draft.");
  expect(received[1].message).toBe("Explain the UART receiver instead.");
  expect(received[1].history).toEqual([]);
  expect(received[1].requestSource).toBe("message");
});

test("Retry replaces a failed assistant response without duplicating its user turn", async ({ page }) => {
  const received = [];
  await page.route("**/api/avr/ai/chat", async route => {
    const input = route.request().postDataJSON();
    received.push(input);
    if (received.length === 1) await route.fulfill({ status: 503, json: { ok: false, message: "Temporary test failure" } });
    else await route.fulfill({ json: { ok: true, kind: "chat", stage: "chat", baseRevision: input.canvas.revision, message: "Recovered response." } });
  });
  await open(page);
  await send(page, "Explain interrupts.");
  await expect(page.locator('.project-chat-message[data-status="error"]')).toContainText("Temporary test failure");
  const originalUser = (await page.evaluate(() => window.UartDebugAvrAiWorkspace.getConversation())).messages[0];
  await page.getByRole("button", { name: "Retry response", exact: true }).click();
  await expect(page.locator('.project-chat-message[data-role="assistant"]')).toContainText("Recovered response.");
  const conversation = await page.evaluate(() => window.UartDebugAvrAiWorkspace.getConversation());
  expect(conversation.messages).toHaveLength(2);
  expect(conversation.messages[0]).toEqual(originalUser);
  expect(conversation.messages[1].status).toBe("complete");
  expect(received[1].message).toBe("Explain interrupts.");
  expect(received[1].history).toEqual([]);
});

test("branching copies only the chosen prefix and continues against the current project files", async ({ page }) => {
  const received = [];
  await replies(page, received, count => `Response ${count}.`);
  await open(page);
  await send(page, "First question.");
  await send(page, "Second question.");
  const before = await chats(page);
  await page.locator("#editorWorkspace .CodeMirror").evaluate(element => {
    element.CodeMirror.setValue("#include <xc.h>\n// Current project edit\nint main(void) { while (1) {} }\n");
  });
  await page.locator('.project-chat-message[data-role="assistant"]').first().locator('[data-chat-action="branch"]').click();
  const branched = await chats(page);
  expect(branched.threads).toHaveLength(2);
  expect(branched.threads.find(item => item.id === before.activeThreadId).messages).toHaveLength(4);
  const active = branched.threads.find(item => item.id === branched.activeThreadId);
  expect(active.messages.map(item => item.content)).toEqual(["First question.", "Response 1."]);
  await send(page, "Continue the branch.");
  expect(received[2].history.map(item => item.content)).toEqual(["First question.", "Response 1."]);
  expect(received[2].currentProject.source).toContain("// Current project edit");
});

test("regenerating a specification review in a new chat retains the review action guard", async ({ page }) => {
  const received = [];
  await replies(page, received, "Please confirm the intended baud rate.");
  await open(page);
  const instruction = await page.evaluate(() => window.UartDebugAvrAiWorkspace.getInstruction());
  await page.locator("#projectCanvasRunBtn").click();
  await expect(page.locator('.project-chat-message[data-role="assistant"]')).toContainText("intended baud rate");
  const original = await chats(page);
  await page.getByRole("button", { name: "Regenerate in new chat", exact: true }).click();
  await expect.poll(() => received.length).toBe(2);
  await expect(page.locator("#projectChatSendBtn")).toHaveAttribute("aria-label", "Send message");
  expect(received.map(item => item.requestSource)).toEqual(["review", "review"]);
  const updated = await chats(page);
  expect(updated.threads).toHaveLength(2);
  expect(updated.threads.find(item => item.id === original.activeThreadId).messages).toEqual(original.threads[0].messages);
  expect(await page.evaluate(() => window.UartDebugAvrAiWorkspace.getInstruction())).toEqual(instruction);
});
