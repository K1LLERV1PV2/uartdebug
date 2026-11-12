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

test("editing a user message keeps its chat and makes the original version recoverable after reload", async ({ page }, testInfo) => {
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
  const save = await page.getByRole("button", { name: "Save and send", exact: true }).boundingBox();
  expect(cancel.y).toBe(save.y);
  await expect(user.locator(".project-chat-message-meta")).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath("chat-edit-message.png") });
  await page.getByRole("button", { name: "Save and send", exact: true }).click();
  await expect.poll(() => received.length).toBe(2);
  await expect(page.locator("#projectChatSendBtn")).toHaveAttribute("aria-label", "Send message");
  const updated = await chats(page);
  expect(updated.threads).toHaveLength(1);
  expect(updated.activeThreadId).toBe(first.id);
  const kept = updated.threads.find(item => item.id === first.id);
  expect(kept.messages.slice(0, 2)).toEqual(first.messages);
  expect(kept.messages).toHaveLength(4);
  expect(kept.draft).toBe("Keep this original draft.");
  expect(received[1].message).toBe("Explain the UART receiver instead.");
  expect(received[1].history).toEqual([]);
  expect(received[1].requestSource).toBe("message");
  const edited = page.locator('.project-chat-message[data-role="user"]').first();
  await expect(edited.locator(".project-chat-variant-count")).toHaveText("2/2");
  await edited.getByRole("button", { name: "Previous branch", exact: true }).click();
  await expect(page.locator('.project-chat-message[data-role="user"] .project-chat-message-content')).toHaveText("Explain the UART transmitter.");
  await page.reload({ waitUntil: "load" });
  await expect(page.locator('.project-chat-message[data-role="user"] .project-chat-message-content')).toHaveText("Explain the UART transmitter.");
  await expect(page.locator("#projectChatInput")).toHaveValue("Keep this original draft.");
  await page.locator('.project-chat-message[data-role="user"]').getByRole("button", { name: "Next branch", exact: true }).click();
  await expect(page.locator('.project-chat-message[data-role="user"] .project-chat-message-content')).toHaveText("Explain the UART receiver instead.");
  await page.screenshot({ path: testInfo.outputPath("chat-edit-branches.png") });
});

test("one Retry response control replaces a failure and preserves successful alternatives inside the chat", async ({ page }, testInfo) => {
  const received = [];
  await page.route("**/api/avr/ai/chat", async route => {
    const input = route.request().postDataJSON();
    received.push(input);
    if (received.length === 1) await route.fulfill({ status: 503, json: { ok: false, message: "Temporary test failure" } });
    else await route.fulfill({ json: { ok: true, kind: "chat", stage: "chat", baseRevision: input.canvas.revision,
      message: received.length === 2 ? "Recovered response." : "Alternative response." } });
  });
  await open(page);
  await send(page, "Explain interrupts.");
  await expect(page.locator('.project-chat-message[data-status="error"]')).toContainText("Temporary test failure");
  const before = await chats(page), originalThread = before.threads[0], originalUser = originalThread.messages[0];
  const failedId = originalThread.messages[1].id;
  const retry = page.getByRole("button", { name: "Retry response", exact: true });
  const failedIcon = await retry.locator("svg path").getAttribute("d");
  expect(failedIcon).toBe("M20 7v5h-5M20 12a8 8 0 1 0-2 6");
  await page.locator("#projectChatInput").fill("Keep this unrelated draft.");
  await retry.click();
  await expect(page.locator('.project-chat-message[data-role="assistant"]')).toContainText("Recovered response.");
  const conversation = await page.evaluate(() => window.UartDebugAvrAiWorkspace.getConversation());
  expect(conversation.messages).toHaveLength(2);
  expect(conversation.messages[0]).toEqual(originalUser);
  expect(conversation.messages[1].status).toBe("complete");
  expect(conversation.messages[1].id).toBe(failedId);
  expect((await chats(page)).activeThreadId).toBe(before.activeThreadId);
  await expect(page.locator("#projectChatInput")).toHaveValue("Keep this unrelated draft.");
  await expect(retry).toHaveAttribute("aria-label", "Retry response");
  await expect(retry).toHaveAttribute("data-ui-tooltip", "Retry response");
  expect(await retry.locator("svg path").getAttribute("d")).toBe(failedIcon);
  await expect(page.locator('[data-chat-action="regenerate"]')).toHaveCount(0);
  await retry.click();
  await expect(page.locator('.project-chat-message[data-role="assistant"] .project-chat-message-content')).toHaveText("Alternative response.");
  const repeated = await chats(page);
  expect(repeated.threads).toHaveLength(1);
  expect(repeated.activeThreadId).toBe(before.activeThreadId);
  expect(repeated.threads[0].messages).toHaveLength(3);
  expect(repeated.threads[0].messages.slice(0, 2)).toEqual(conversation.messages);
  expect(repeated.threads[0].title).toBe(originalThread.title);
  await expect(page.locator("#projectChatInput")).toHaveValue("Keep this unrelated draft.");
  await page.locator('.project-chat-message[data-role="assistant"]').getByRole("button", { name: "Previous branch", exact: true }).click();
  await expect(page.locator('.project-chat-message[data-role="assistant"] .project-chat-message-content')).toHaveText("Recovered response.");
  expect(received[1].message).toBe("Explain interrupts.");
  expect(received[1].history).toEqual([]);
  expect(received[2].message).toBe("Explain interrupts."); expect(received[2].history).toEqual([]);
  await page.locator(".project-chat-panel").screenshot({ path: testInfo.outputPath("chat-retry-single-arrow.png") });
});

test("retrying an older successful response excludes its old answer and later turns from request history", async ({ page }) => {
  const received = [];
  await replies(page, received, count => `Response ${count}.`);
  await open(page); await send(page, "First question."); await send(page, "Second question.");
  await page.locator("#projectChatInput").fill("Keep this draft.");
  const before = await chats(page), originalThread = before.threads[0];
  await page.locator('.project-chat-message[data-role="assistant"]').first().getByRole("button", { name: "Retry response", exact: true }).click();
  await expect.poll(() => received.length).toBe(3);
  await expect(page.locator("#projectChatSendBtn")).toHaveAttribute("aria-label", "Send message");
  expect(received[2].message).toBe("First question."); expect(received[2].history).toEqual([]);
  await expect(page.locator(".project-chat-message-content")).toHaveText(["First question.", "Response 3."]);
  const after = await chats(page);
  expect(after.threads).toHaveLength(1); expect(after.activeThreadId).toBe(before.activeThreadId);
  expect(after.threads[0].messages.slice(0, 4)).toEqual(originalThread.messages);
  expect(after.threads[0].messages).toHaveLength(5);
  await expect(page.locator("#projectChatInput")).toHaveValue("Keep this draft.");
  await page.locator('.project-chat-message[data-role="assistant"]').getByRole("button", { name: "Previous branch", exact: true }).click();
  await expect(page.locator(".project-chat-message-content")).toHaveText(["First question.", "Response 1.", "Second question.", "Response 2."]);
});

test("branching selects a prefix inside the same chat and can resume its saved continuation", async ({ page }) => {
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
  expect(branched.threads).toHaveLength(1);
  expect(branched.activeThreadId).toBe(before.activeThreadId);
  expect(branched.threads.find(item => item.id === before.activeThreadId).messages).toHaveLength(4);
  await expect(page.locator(".project-chat-message-content")).toHaveText(["First question.", "Response 1."]);
  await page.reload({ waitUntil: "load" });
  await expect(page.locator(".project-chat-message-content")).toHaveText(["First question.", "Response 1."]);
  await page.getByRole("button", { name: "Resume saved continuation", exact: true }).click();
  await expect(page.locator(".project-chat-message-content")).toHaveText(["First question.", "Response 1.", "Second question.", "Response 2."]);
  await page.locator('.project-chat-message[data-role="assistant"]').first().locator('[data-chat-action="branch"]').click();
  await send(page, "Continue the branch.");
  expect(received[2].history.map(item => item.content)).toEqual(["First question.", "Response 1."]);
  expect(received[2].currentProject.source).toContain("// Current project edit");
  const final = await chats(page);
  expect(final.activeThreadId).toBe(before.activeThreadId);
  expect(final.threads[0].messages).toHaveLength(6);
  await page.locator('.project-chat-message[data-role="user"]').last().getByRole("button", { name: "Previous branch", exact: true }).click();
  await expect(page.locator(".project-chat-message-content")).toHaveText(["First question.", "Response 1.", "Second question.", "Response 2."]);
});

test("retrying a completed specification review retains its chat and the review action guard", async ({ page }) => {
  const received = [];
  await replies(page, received, "Please confirm the intended baud rate.");
  await open(page);
  const instruction = await page.evaluate(() => window.UartDebugAvrAiWorkspace.getInstruction());
  await page.locator("#projectCanvasRunBtn").click();
  await expect(page.locator('.project-chat-message[data-role="assistant"]')).toContainText("intended baud rate");
  const original = await chats(page);
  await page.getByRole("button", { name: "Retry response", exact: true }).click();
  await expect.poll(() => received.length).toBe(2);
  await expect(page.locator("#projectChatSendBtn")).toHaveAttribute("aria-label", "Send message");
  expect(received.map(item => item.requestSource)).toEqual(["review", "review"]);
  const updated = await chats(page);
  expect(updated.threads).toHaveLength(1);
  expect(updated.activeThreadId).toBe(original.activeThreadId);
  expect(updated.threads[0].messages.slice(0, 2)).toEqual(original.threads[0].messages);
  expect(updated.threads[0].messages).toHaveLength(3);
  await expect(page.locator('.project-chat-message[data-role="assistant"] .project-chat-variant-count')).toHaveText("2/2");
  await page.locator('.project-chat-message[data-role="assistant"]').getByRole("button", { name: "Previous branch", exact: true }).click();
  await expect(page.locator('.project-chat-message[data-role="assistant"]')).toHaveAttribute("data-message-id", original.threads[0].messages[1].id);
  expect(await page.evaluate(() => window.UartDebugAvrAiWorkspace.getInstruction())).toEqual(instruction);
});

test("nested edited branches retain both old tails without adding chat records", async ({ page }) => {
  const received = [];
  await replies(page, received, count => `Response ${count}.`);
  await open(page);
  await send(page, "First question."); await send(page, "Second question.");
  const original = await chats(page);
  await page.locator('.project-chat-message[data-role="user"]').last().locator('[data-chat-action="edit"]').click();
  await page.locator(".project-chat-edit textarea").fill("Edited second question.");
  await page.getByRole("button", { name: "Save and send", exact: true }).click();
  await expect.poll(() => received.length).toBe(3);
  await expect(page.locator("#projectChatSendBtn")).toHaveAttribute("aria-label", "Send message");
  await page.locator('.project-chat-message[data-role="user"]').first().locator('[data-chat-action="edit"]').click();
  await page.locator(".project-chat-edit textarea").fill("Edited first question.");
  await page.getByRole("button", { name: "Save and send", exact: true }).click();
  await expect.poll(() => received.length).toBe(4);
  await expect(page.locator("#projectChatSendBtn")).toHaveAttribute("aria-label", "Send message");
  expect(received[2].history.map(item => item.content)).toEqual(["First question.", "Response 1."]);
  expect(received[3].history).toEqual([]);
  await page.locator('.project-chat-message[data-role="user"]').first().getByRole("button", { name: "Previous branch", exact: true }).click();
  await expect(page.locator(".project-chat-message-content")).toHaveText(["First question.", "Response 1.", "Edited second question.", "Response 3."]);
  await page.locator('.project-chat-message[data-role="user"]').last().getByRole("button", { name: "Previous branch", exact: true }).click();
  await expect(page.locator(".project-chat-message-content")).toHaveText(["First question.", "Response 1.", "Second question.", "Response 2."]);
  await page.reload({ waitUntil: "load" });
  await expect(page.locator(".project-chat-message-content")).toHaveText(["First question.", "Response 1.", "Second question.", "Response 2."]);
  const firstQuestion = page.locator('.project-chat-message[data-role="user"]').first();
  const next = firstQuestion.getByRole("button", { name: "Next branch", exact: true });
  await next.focus(); await page.keyboard.press("Enter");
  await expect(page.locator(".project-chat-message-content")).toHaveText(["Edited first question.", "Response 4."]);
  await expect(page.locator('.project-chat-message[data-role="user"]').getByRole("button", { name: "Previous branch", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator(".project-chat-message-content")).toHaveText(["First question.", "Response 1.", "Second question.", "Response 2."]);
  await expect(page.locator('.project-chat-message[data-role="user"]').first().getByRole("button", { name: "Next branch", exact: true })).toBeFocused();
  await page.reload({ waitUntil: "load" });
  await expect(page.locator(".project-chat-message-content")).toHaveText(["First question.", "Response 1.", "Second question.", "Response 2."]);
  const final = await chats(page);
  expect(final.threads).toHaveLength(1); expect(final.activeThreadId).toBe(original.activeThreadId);
  expect(final.threads[0].messages).toHaveLength(8);
});

test("a branch from a user message can return to the earlier assistant continuation", async ({ page }) => {
  const received = [];
  await replies(page, received, count => `Response ${count}.`);
  await open(page); await send(page, "Original question.");
  await page.locator('.project-chat-message[data-role="user"]').locator('[data-chat-action="branch"]').click();
  await expect(page.getByRole("button", { name: "Resume saved continuation", exact: true })).toBeVisible();
  await send(page, "Additional requirement.");
  expect(received[1].history.map(item => item.content)).toEqual(["Original question."]);
  await page.locator('.project-chat-message[data-role="user"]').last().getByRole("button", { name: "Previous branch", exact: true }).click();
  await expect(page.locator(".project-chat-message-content")).toHaveText(["Original question.", "Response 1."]);
  await page.locator('.project-chat-message[data-role="assistant"]').getByRole("button", { name: "Next branch", exact: true }).click();
  await expect(page.locator(".project-chat-message-content")).toHaveText(["Original question.", "Additional requirement.", "Response 2."]);
  expect((await chats(page)).threads).toHaveLength(1);
});

test("editing at the total message limit keeps every saved branch and the edit draft", async ({ page }) => {
  const received = [];
  await replies(page, received, "This request must never run.");
  await open(page);
  await page.addInitScript(() => {
    if (sessionStorage.getItem("chat-tree-limit-seeded")) return;
    sessionStorage.setItem("chat-tree-limit-seeded", "true");
    const key = "ud_avr_programming_state_v6", state = JSON.parse(localStorage.getItem(key));
    const project = Object.values(state.miniProjects)[0];
    const chat = project.conversation ||= { schemaVersion: 5, activeThreadId: "limit-chat", threads: [{
      id: "limit-chat", title: "Saved chat", titleMode: "manual", draft: "", messages: [], activeLeafId: null, selectedChildIds: [],
    }] };
    const thread = chat.threads[0];
    thread.messages = Array.from({ length: 100 }, (_, index) => ({ id: `saved-${index}`, parentId: index ? `saved-${index - 1}` : null,
      role: "user", content: `Saved message ${index}`, status: "complete", createdAt: index, requestSource: "message" }));
    thread.activeLeafId = "saved-99";
    localStorage.setItem(key, JSON.stringify(state));
  });
  await page.reload({ waitUntil: "load" });
  const before = await chats(page);
  await page.locator('.project-chat-message[data-role="user"]').last().locator('[data-chat-action="edit"]').click();
  await page.locator(".project-chat-edit textarea").fill("Keep this unsent edit.");
  await page.getByRole("button", { name: "Save and send", exact: true }).click();
  await expect(page.locator(".notification-toast-open")).toContainText("100 messages across all branches");
  await expect(page.locator(".project-chat-edit textarea")).toHaveValue("Keep this unsent edit.");
  expect(received).toHaveLength(0);
  expect(await chats(page)).toEqual(before);
});

test("keyboard branch navigation keeps its direction through three response alternatives", async ({ page }) => {
  await replies(page, [], count => `Response ${count}.`);
  await open(page); await send(page, "Explain the UART.");
  for (let index = 0; index < 2; index++) {
    await page.getByRole("button", { name: "Retry response", exact: true }).click();
    await expect(page.locator("#projectChatSendBtn")).toHaveAttribute("aria-label", "Send message");
  }
  let assistant = page.locator('.project-chat-message[data-role="assistant"]');
  await expect(assistant.locator(".project-chat-variant-count")).toHaveText("3/3");
  await assistant.getByRole("button", { name: "Previous branch", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(assistant.locator(".project-chat-message-content")).toHaveText("Response 2.");
  await expect(assistant.getByRole("button", { name: "Previous branch", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(assistant.locator(".project-chat-message-content")).toHaveText("Response 1.");
  await expect(assistant.getByRole("button", { name: "Next branch", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(assistant.locator(".project-chat-message-content")).toHaveText("Response 2.");
  await expect(assistant.getByRole("button", { name: "Next branch", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(assistant.locator(".project-chat-message-content")).toHaveText("Response 3.");
});

test("long nested branches keep the chosen pager in view instead of jumping to the tail", async ({ page }, testInfo) => {
  const received = [], rootQuestion = "Original root question with detailed constraints for the project clock, pins, timing and serial output.";
  const answer = number => Array.from({ length: 16 }, (_, index) => `Response ${number}, paragraph ${index}. ` +
    "Preserve the project target and compare the alternatives carefully. ".repeat(2)).join("\n\n");
  await replies(page, received, answer);
  await open(page); await send(page, rootQuestion); await send(page, "Original continuation.");
  await page.locator('.project-chat-message[data-role="user"]').last().locator('[data-chat-action="edit"]').click();
  await page.locator(".project-chat-edit textarea").fill("Edited continuation.");
  await page.getByRole("button", { name: "Save and send", exact: true }).click();
  await expect(page.locator("#projectChatSendBtn")).toHaveAttribute("aria-label", "Send message");
  await page.locator('.project-chat-message[data-role="user"]').first().locator('[data-chat-action="edit"]').click();
  await page.locator(".project-chat-edit textarea").fill("Edited root.");
  await page.getByRole("button", { name: "Save and send", exact: true }).click();
  await expect(page.locator("#projectChatSendBtn")).toHaveAttribute("aria-label", "Send message");
  const thread = page.locator("#projectChatThread");
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const position = row => row.locator(".project-chat-message-variants").evaluate(group => {
    const frame = group.closest("#projectChatThread").getBoundingClientRect(), bounds = group.getBoundingClientRect();
    return { offset: bounds.top - frame.top, visible: bounds.top >= frame.top && bounds.bottom <= frame.bottom };
  });
  await settle(); await thread.evaluate(element => { element.scrollTop = 0; }); await settle();
  let root = page.locator('.project-chat-message[data-role="user"]').first();
  const beforeRoot = await position(root);
  await root.getByRole("button", { name: "Previous branch", exact: true }).click();
  await settle();
  root = page.locator('.project-chat-message[data-role="user"]').first();
  const afterRoot = await position(root);
  expect(afterRoot.visible).toBe(true); expect(Math.abs(afterRoot.offset - beforeRoot.offset)).toBeLessThan(2);
  await expect(root.getByRole("button", { name: "Next branch", exact: true })).toBeFocused();
  await expect(page.locator("#projectChatJumpBtn")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("chat-long-branch-anchor.png") });
  await page.locator(".project-chat-panel").screenshot({ path: testInfo.outputPath("chat-long-branch-anchor-chat.png") });
  let nested = page.locator('.project-chat-message[data-role="user"]').last();
  await nested.getByRole("button", { name: "Previous branch", exact: true }).scrollIntoViewIfNeeded(); await settle();
  const beforeNested = await position(nested);
  await nested.getByRole("button", { name: "Previous branch", exact: true }).click(); await settle();
  nested = page.locator('.project-chat-message[data-role="user"]').last();
  const afterNested = await position(nested);
  expect(afterNested.visible).toBe(true); expect(Math.abs(afterNested.offset - beforeNested.offset)).toBeLessThan(2);
  await expect(nested.getByRole("button", { name: "Next branch", exact: true })).toBeFocused();
  await send(page, "Continue the selected original branch.");
  expect(received[4].history.map(message => message.content)).toEqual([rootQuestion, answer(1), "Original continuation.", answer(2)]);
  expect((await chats(page)).threads).toHaveLength(1);
});
