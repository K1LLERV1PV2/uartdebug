"use strict";

const { test, expect } = require("playwright/test");

const panes = [".project-chat-panel", ".project-ai-layout", ".editor-workspace", ".documentation-workspace"];
const names = ["Chat", "Canvas", "Code", "Guide"];
const handles = ["#fileListResizer", "#projectAiColumnResizer", "#documentationResizer"];

async function open(page) {
  await page.goto("/avr", { waitUntil: "load" });
  await expect(page).toHaveTitle("AVR Programming - Uart Debug");
  await page.waitForFunction(() => window.UartDebugAvrAiWorkspace);
}

async function holdAtMinimum(page, boundary, side) {
  const handle = page.locator(handles[boundary]);
  const index = boundary + side;
  const direction = side ? 1 : -1;
  await handle.focus();
  for (let step = 0; step < 60; step++) {
    if ((await handle.getAttribute("aria-valuetext")).includes(`${names[index]} at minimum`)) break;
    await page.keyboard.press(direction < 0 ? "ArrowLeft" : "ArrowRight");
  }
  await expect(handle).toHaveAttribute("aria-valuetext", new RegExp(`${names[index]} at minimum`));
  const box = await handle.boundingBox();
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + direction * 16, point.y);
  return { index, direction, point, handle };
}

test("every boundary shows a directional wave only before collapsing an expanded pane", async ({ page }, testInfo) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem("ud_avr_programming_outliner_width_v1", "305");
    localStorage.setItem("ud_avr_ai_column_width_v1", "318");
    localStorage.setItem("ud_avr_programming_documentation_width_v1", "360");
    localStorage.setItem("ud_avr_programming_editor_collapsed_v1", "false");
  });
  for (const boundary of [0, 1, 2]) for (const side of [0, 1]) {
    await open(page);
    const { index, direction, handle } = await holdAtMinimum(page, boundary, side);
    const cue = page.locator(`${panes[index]} > .pane-collapse-cue`);
    await expect(cue).toHaveAttribute("data-direction", direction < 0 ? "left" : "right");
    await expect(page.locator(".pane-collapse-chevron")).toHaveCount(0);
    const wave = () => cue.evaluate(element => {
      const style = getComputedStyle(element, "::before");
      return { x: new DOMMatrixReadOnly(style.transform).m41, height: Number.parseFloat(style.height),
        clip: style.clipPath, moving: style.animationName !== "none", frame: element.getBoundingClientRect().height };
    });
    const initial = await wave();
    expect(initial.moving).toBe(true);
    expect(initial.clip).toBe("none");
    expect(initial.height).toBeCloseTo(initial.frame, 0);
    await expect.poll(async () => (await wave()).x * direction).toBeGreaterThan(initial.x * direction + 4);
    if (boundary === 0) await page.screenshot({ path: testInfo.outputPath(`collapse-wave-${side ? "right" : "left"}.png`) });
    await page.mouse.up();
    await expect(page.locator(".pane-collapse-cue")).toHaveCount(0);

    // Collapsing and reopening still use the shared separator, without an
    // animation or a replacement expand button in the narrow pane.
    await handle.focus();
    await page.keyboard.press(side ? "End" : "Home");
    await expect(page.locator(".canvas-split-container")).not.toHaveClass(/is-workspace-transitioning/);
    const box = await handle.boundingBox();
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(point.x - direction * 16, point.y);
    await expect(page.locator(".pane-collapse-cue")).toHaveCount(0);
    await page.mouse.up();
    if (index === 0) {
      await expect(page.locator("#projectChatCompactLabel")).toBeVisible();
      expect(await page.locator("#projectChatCompactLabel").evaluate(element => element.tabIndex)).toBe(-1);
      await expect(page.locator("#projectChatCompactLabel svg, #projectChatCompactBtn")).toHaveCount(0);
    }
    await handle.focus();
    await page.keyboard.press(direction < 0 ? "ArrowRight" : "ArrowLeft");
    await expect(page.locator(".canvas-split-container")).not.toHaveClass(/is-workspace-transitioning/);
    expect(await page.locator(panes[index]).evaluate(element => element.getBoundingClientRect().width)).toBeGreaterThan(112);
  }
  expect(errors).toEqual([]);
});

test("reduced motion keeps the minimum-size cue still in either direction", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const side of [0, 1]) {
    await open(page);
    await holdAtMinimum(page, 0, side);
    const cue = page.locator(".pane-collapse-cue");
    await expect(cue).toHaveCount(1);
    expect(await cue.evaluate(element => getComputedStyle(element, "::before").animationName)).toBe("none");
    await page.mouse.up();
  }
});
