"use strict";

const { test, expect } = require("playwright/test");

test("chat text, composer and controls retain their anchors across both transition boundaries", async ({ page }, testInfo) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto("/avr", { waitUntil: "load" });
  await expect(page).toHaveTitle("AVR Programming - Uart Debug");
  await page.waitForFunction(() => window.UartDebugAvrMiniProjects);
  await page.evaluate(async () => {
    const { project } = await (await fetch("/api/avr/ai/projects/motion-example")).json();
    await window.UartDebugAvrMiniProjects.install(project);
  });
  // Seed after the previous page's real beforeunload save, before app startup.
  await page.addInitScript(() => {
    const state = JSON.parse(localStorage.getItem("ud_avr_programming_state_v3") || "null");
    if (!state) return;
    const currentProject = Object.values(state.miniProjects).find(item => item.files.source === state.current);
    if (!currentProject) return;
    currentProject.conversation = {
      schemaVersion: 1, draft: "Continue with the UART example.",
      messages: [
        { id: "motion-user", role: "user", content: "Explain the UART initialization and interrupt behavior.", createdAt: 1, status: "complete" },
        { id: "motion-assistant", role: "assistant", content: "## UART initialization\n\n" +
          Array.from({ length: 8 }, () => "Keep the current text layout stable while its window opens or closes. Repeated words make changes in wrapping visible during the animation.").join("\n\n"),
          createdAt: 2, status: "complete" },
      ],
    };
    localStorage.setItem("ud_avr_programming_state_v3", JSON.stringify(state));
  });
  await page.reload({ waitUntil: "load" });
  await expect(page.locator("#projectChatThread .project-chat-message")).toHaveCount(2);
  await expect(page.locator("#projectChatInput")).toHaveValue("Continue with the UART example.");
  await page.evaluate(() => document.fonts.ready);

  await page.evaluate(() => {
    const pane = document.querySelector(".project-chat-panel");
    const effectiveOpacity = element => {
      let opacity = 1;
      for (let node = element; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.display === "none" || style.visibility !== "visible") return 0;
        opacity *= Number(style.opacity);
      }
      return opacity;
    };
    window.__chatModeFrames = [];
    window.__readChatFrame = () => {
      const outer = pane.getBoundingClientRect();
      const read = selector => {
        const element = pane.querySelector(selector), box = element.getBoundingClientRect();
        return { width: box.width, height: box.height, left: box.left - outer.left,
          right: outer.right - box.right, top: box.top - outer.top, bottom: outer.bottom - box.bottom,
          font: getComputedStyle(element).fontSize, opacity: effectiveOpacity(element),
          iconWidth: element.querySelector("svg")?.getBoundingClientRect().width ?? null };
      };
      return { phase: window.__chatFramePhase, active: document.querySelector(".canvas-split-container").classList.contains("is-workspace-transitioning"),
        compact: document.querySelector(".canvas-split-container").classList.contains("is-outliner-content-compact"),
        paneWidth: outer.width, composer: read("#projectChatForm"), input: read("#projectChatInput"),
        send: read("#projectChatSendBtn"), model: read(".project-chat-model"), context: read("#projectChatContextBtn"), newChat: read("#projectChatNewBtn"), history: read("#projectChatHistoryBtn"), compactControl: read("#projectChatCompactLabel") };
    };
  });
  const expandedReference = await page.evaluate(() => window.__readChatFrame());
  await page.locator("#fileListResizer").focus();
  for (const key of ["Home", "ArrowRight"]) {
    await page.evaluate(key => {
      window.__chatFramePhase = key;
      window.__captureChatFrames = true;
      const sample = () => {
        window.__chatModeFrames.push(window.__readChatFrame());
        if (window.__captureChatFrames) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    }, key);
    await page.keyboard.press(key);
    await expect(page.locator(".canvas-split-container")).not.toHaveClass(/is-workspace-transitioning/);
    await page.waitForTimeout(130);
    await page.evaluate(() => { window.__captureChatFrames = false; });
    const width = await page.locator(".project-chat-panel").evaluate(node => node.getBoundingClientRect().width);
    if (key === "Home") {
      expect(width).toBe(62);
      await expect(page.locator("#projectChatCompactLabel")).toBeVisible();
      await expect(page.locator("#projectChatForm")).toBeHidden();
    } else {
      expect(width).toBeGreaterThanOrEqual(240);
      await expect(page.locator("#projectChatCompactLabel")).toBeHidden();
      await expect(page.locator("#projectChatForm")).toBeVisible();
    }
  }
  const frames = await page.evaluate(() => window.__chatModeFrames);
  try {
    expect(frames.filter(frame => frame.active).length, "sample actual moving frames in both directions").toBeGreaterThan(8);
    const reopened = frames.find(frame => frame.phase === "ArrowRight" && !frame.active && !frame.compact && frame.paneWidth >= 240);
    expect(reopened, "record the first settled reopening frame").toBeTruthy();
    for (const frame of frames) {
      if (frame.compact) {
        expect(frame.compactControl.width).toBe(36);
        expect(frame.compactControl.opacity).toBe(1);
        continue;
      }
      expect(frame.input.font).toBe(expandedReference.input.font);
      expect(frame.input.height, "the draft input must not change height during horizontal pane movement").toBe(expandedReference.input.height);
      for (const control of ["send", "newChat"]) {
        expect(frame[control].height).toBe(expandedReference[control].height);
        expect(frame[control].font).toBe(expandedReference[control].font);
      }
      expect(frame.send.width).toBe(expandedReference.send.width);
      expect(frame.context.width, "the project context must reserve room for its nonshrinking icon").toBeGreaterThanOrEqual(19);
      expect(frame.context.iconWidth).toBe(expandedReference.context.iconWidth);
      expect(frame.model.left - frame.context.left, "the model must not overlap the project context while the pane reveals its content").toBeGreaterThanOrEqual(frame.context.width);
      expect(frame.send.left - frame.model.left - frame.model.width, "the model stays directly beside Send throughout the transition").toBeCloseTo(8, 1);
      expect(frame.model.top + frame.model.height / 2).toBeCloseTo(frame.send.top + frame.send.height / 2, 1);
      expect(frame.newChat.iconWidth, "header actions must retain their intrinsic contents even while the closed pane clips them").toBe(expandedReference.newChat.iconWidth);
      if (frame.paneWidth >= 240) {
        expect(frame.newChat.width, "the two header actions share the available row width").toBeCloseTo(frame.history.width, 1);
        expect(frame.newChat.right, "the fully revealed header retains its right pane inset").toBeCloseTo(expandedReference.newChat.right, 1);
      }
      expect(frame.composer.left, "composer border follows the left pane edge").toBeCloseTo(expandedReference.composer.left, 1);
      expect(frame.composer.right, "composer border follows the right pane edge").toBeCloseTo(expandedReference.composer.right, 1);
      expect(frame.composer.bottom, "composer remains anchored to the pane bottom").toBeCloseTo(expandedReference.composer.bottom, 1);
      if (!frame.active && frame.phase === "ArrowRight" && frame.paneWidth >= 240) {
        const layout = ({ opacity, ...geometry }) => geometry;
        for (const control of ["composer", "input", "send", "newChat"]) {
          expect(layout(frame[control]), `${control} geometry must already be stable after the pane stops`).toEqual(layout(reopened[control]));
        }
      }
    }
    await expect(page.locator("#projectChatInput")).toHaveValue("Continue with the UART example.");
    await expect(page.locator("#projectChatThread .project-chat-message")).toHaveCount(2);
    expect(errors).toEqual([]);
  } catch (error) {
    await testInfo.attach("chat-boundary-metrics", { body: JSON.stringify(frames), contentType: "application/json" });
    throw error;
  }
});

for (const view of ["edit", "history"]) {
  test(`${view} text retains its layout while the neighboring pane changes the chat width`, async ({ page }, testInfo) => {
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/api/avr/ai/chat", async route => {
      const input = route.request().postDataJSON();
      await route.fulfill({ json: { ok: true, kind: "chat", stage: "chat", baseRevision: input.canvas.revision, message: "Review the UART configuration." } });
    });
    await page.goto("/avr", { waitUntil: "load" });
    await page.waitForFunction(() => window.UartDebugAvrAiWorkspace);
    await page.locator("#projectChatInput").fill("Explain the UART interrupt configuration and how the receive buffer handles consecutive characters without losing the current project state. ".repeat(7));
    await page.locator("#projectChatInput").press("Enter");
    await expect(page.locator('.project-chat-message[data-role="assistant"]')).toContainText("UART configuration");
    if (view === "edit") await page.locator('[data-chat-action="edit"]').click();
    else await page.locator("#projectChatHistoryBtn").click();
    await page.evaluate(() => document.fonts.ready);

    await page.evaluate(view => {
      const pane = document.querySelector(".project-chat-panel");
      const text = pane.querySelector(view === "edit" ? ".project-chat-edit textarea" : ".project-chat-history-title");
      const frame = pane.querySelector(view === "edit" ? ".project-chat-edit-input" : ".project-chat-history-row");
      window.__readExtendedChatFrame = () => {
        const outer = pane.getBoundingClientRect(), box = text.getBoundingClientRect(), frameBox = frame.getBoundingClientRect();
        const range = document.createRange(); range.selectNodeContents(text);
        const lines = [...range.getClientRects()].map(rect => [rect.width, rect.y - box.y]);
        const note = pane.querySelector(".project-chat-edit-note");
        return { active: document.querySelector(".canvas-split-container").classList.contains("is-workspace-transitioning"),
          textWidth: box.width, frameWidth: frameBox.width,
          rightInset: outer.right - frameBox.right, textScrollHeight: view === "edit" ? text.scrollHeight : null,
          noteHeight: view === "edit" ? note.getBoundingClientRect().height : null,
          border: getComputedStyle(text).borderTopWidth, overflow: getComputedStyle(text).overflowY,
          lines, clip: view === "history" ? getComputedStyle(text.parentElement).overflowX : null };
      };
    }, view);
    const handle = page.locator("#fileListResizer");
    await handle.focus();
    for (const key of ["End", "ArrowLeft"]) {
      const before = await page.evaluate(() => window.__readExtendedChatFrame());
      await page.evaluate(() => {
        window.__extendedChatFrames = []; window.__sampleExtendedChat = true;
        const sample = () => {
          window.__extendedChatFrames.push(window.__readExtendedChatFrame());
          if (window.__sampleExtendedChat) requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      });
      await page.keyboard.press(key);
      await expect(page.locator(".canvas-split-container")).toHaveClass(/is-workspace-transitioning/);
      await expect(page.locator(".canvas-split-container")).not.toHaveClass(/is-workspace-transitioning/);
      await page.waitForTimeout(170);
      const frames = await page.evaluate(() => { window.__sampleExtendedChat = false; return window.__extendedChatFrames; });
      const moving = frames.filter(frame => frame.active);
      expect(moving.length).toBeGreaterThan(6);
      expect(new Set(moving.map(frame => Math.round(frame.frameWidth))).size, "the surrounding field or row frame must remain fluid").toBeGreaterThan(4);
      for (const frame of moving) {
        expect(frame.textWidth, "only the text width remains fixed").toBeCloseTo(before.textWidth, 1);
        expect(frame.rightInset).toBeCloseTo(before.rightInset, 1);
        if (view === "edit") {
          expect(frame.border, "the textarea must not freeze its own border inside the moving frame").toBe("0px");
          expect(frame.textScrollHeight).toBe(before.textScrollHeight);
          expect(frame.noteHeight).toBe(before.noteHeight);
          expect(frame.overflow, "the old textarea scrollbar must not remain in the middle of the growing frame").toBe("hidden");
        } else {
          expect(frame.lines).toEqual(before.lines);
          expect(frame.clip, "text must not cover its neighboring action menu").toBe("hidden");
        }
      }
      const settled = frames.filter(frame => !frame.active).slice(-3);
      expect(settled.length).toBe(3);
      expect(settled[1]).toEqual(settled[0]);
      expect(settled[2]).toEqual(settled[0]);
      await testInfo.attach(`${view}-${key}-frames`, { body: JSON.stringify(frames), contentType: "application/json" });
    }
    expect(errors).toEqual([]);
  });
}
