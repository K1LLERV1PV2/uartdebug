"use strict";

const { test, expect } = require("playwright/test");

test("projects and creation are available together on first open", async ({ page }) => {
  await page.goto("/avr", { waitUntil: "load" });
  await page.waitForFunction(() => window.UartDebugAvrMiniProjects);
  await expect(page.locator("#fileContextMenu")).toBeHidden();
  await expect(page.locator("#projectChatMenu")).toBeHidden();
  await page.locator("#filesOpenBtn").click();
  await expect(page.getByRole("dialog", { name: "Projects", exact: true })).toHaveCount(1);
  await expect(page.locator('.ui-modal:not([hidden])')).toHaveCount(1);
  await expect(page.locator("#fileList")).toBeVisible();
  await expect(page.locator("#createEmptyProjectCard")).toBeVisible();
  await expect(page.locator("#uploadExistingFileCard")).toBeVisible();
  await expect(page.locator("#fileTemplateGrid .file-template-card").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Back to projects", exact: true })).toHaveCount(0);
  await expect(page.locator("#fileList .new-item")).toHaveCount(0);
  await page.locator("#createEmptyProjectCard").focus();
  await page.keyboard.press("Tab");
  await expect(page.locator("#uploadExistingFileCard")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator("#filesModal")).toBeHidden();
  await expect(page.locator("#filesOpenBtn")).toBeFocused();
  await page.locator("#filesOpenBtn").click();
  await page.locator("#createEmptyProjectCard").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#filesModal")).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.UartDebugAvrMiniProjects.getInstances().length)).toBe(1);
  await page.locator("#filesOpenBtn").click();
  await expect(page.locator("#fileList .mini-project-item")).toHaveCount(1);
  await expect(page.locator("#createEmptyProjectCard")).toBeVisible();
  await page.locator("#fileTemplateGrid .file-template-card").first().click();
  await expect(page.locator("#filesModal")).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.UartDebugAvrMiniProjects.getInstances().length)).toBe(2);
});

test("long project names and mini-project descriptions fit independently scrolling columns at 900px", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 900, height: 700 });
  await page.route("**/api/avr/ai/projects", route => route.fulfill({ json: {
    ok: true,
    projects: Array.from({ length: 10 }, (_, index) => ({
      id: `long-example-${index}`,
      title: `Example ${index + 1} with a deliberately detailed peripheral configuration title`,
      summary: "Configure the microcontroller clock and UART peripherals, prepare the transmit pin, and send an observable counter while preserving the interrupt buffer lifetime. Check the selected chip and package before reusing this educational example.",
      kind: "example",
    })),
  } }));
  await page.goto("/avr", { waitUntil: "load" });
  await page.waitForFunction(() => window.UartDebugAvrMiniProjects);
  await page.evaluate(async () => {
    const { project } = await (await fetch("/api/avr/ai/projects/motion-example")).json();
    for (let index = 0; index < 16; index++) {
      const copy = structuredClone(project);
      const name = index === 7 ? "A project with a long descriptive name for UART peripherals" : `Project ${index + 1}`;
      copy.id = `geometry-${index}`;
      copy.title = copy.displayName = name;
      copy.files.forEach(file => { file.name = file.name.replace("Motion example", name); });
      await window.UartDebugAvrMiniProjects.install(copy);
    }
  });
  await page.locator("#filesOpenBtn").click();
  await expect(page.locator("#fileList .mini-project-item")).toHaveCount(16);
  await expect(page.locator("#fileTemplateGrid .file-template-card")).toHaveCount(10);
  await expect(page.locator("#createEmptyProjectCard")).toBeVisible();
  await expect(page.locator("#uploadExistingFileCard")).toBeVisible();
  const geometry = await page.evaluate(() => {
    const rect = element => {
      const { top, right, bottom, left, height } = element.getBoundingClientRect();
      return { top, right, bottom, left, height };
    };
    return {
      rows: [...document.querySelectorAll("#fileList .mini-project-item")].map(row => ({
        row: rect(row), name: rect(row.querySelector(".file-name")),
      })),
      cards: [...document.querySelectorAll("#fileTemplateGrid .file-template-card")].map(card => ({
        card: rect(card), title: rect(card.querySelector(".file-add-card-title")),
        copy: rect(card.querySelector(".file-add-card-copy")),
      })),
      scroll: ["fileList", "fileTemplateGrid"].map(id => {
        const element = document.getElementById(id);
        return { id, clientHeight: element.clientHeight, scrollHeight: element.scrollHeight,
          horizontalOverflow: element.scrollWidth > element.clientWidth };
      }),
    };
  });
  const expectInside = (content, parent) => {
    expect(content.top).toBeGreaterThanOrEqual(parent.top - 0.5);
    expect(content.bottom).toBeLessThanOrEqual(parent.bottom + 0.5);
    expect(content.left).toBeGreaterThanOrEqual(parent.left - 0.5);
    expect(content.right).toBeLessThanOrEqual(parent.right + 0.5);
  };
  for (const { row, name } of geometry.rows) expectInside(name, row);
  expect(geometry.rows[7].name.height, "the long project name must exercise wrapping").toBeGreaterThan(30);
  for (const { card, title, copy } of geometry.cards) {
    expectInside(title, card);
    expectInside(copy, card);
    expect(copy.top, "the title must not overlap its description").toBeGreaterThanOrEqual(title.bottom + 3);
    expect(card.height, "catalog cards must retain space for their wrapped content").toBeGreaterThanOrEqual(title.height + copy.height + 24);
  }
  for (const region of geometry.scroll) {
    expect(region.scrollHeight, `${region.id} needs its own scrollable content`).toBeGreaterThan(region.clientHeight);
    expect(region.horizontalOverflow, `${region.id} must not scroll horizontally`).toBe(false);
  }
  const list = page.locator("#fileList"), catalog = page.locator("#fileTemplateGrid");
  await list.evaluate(element => { element.scrollTop = 0; });
  await catalog.evaluate(element => { element.scrollTop = 0; });
  await page.screenshot({ path: testInfo.outputPath("project-columns-long-content-900.png") });
  await list.hover();
  await page.mouse.wheel(0, 500);
  await expect.poll(() => list.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  expect(await catalog.evaluate(element => element.scrollTop)).toBe(0);
  const listScroll = await list.evaluate(element => element.scrollTop);
  await catalog.hover();
  await page.mouse.wheel(0, 500);
  await expect.poll(() => catalog.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  expect(await list.evaluate(element => element.scrollTop)).toBe(listScroll);
  await expect(page.locator("#createEmptyProjectCard")).toBeInViewport();
  await expect(page.locator("#uploadExistingFileCard")).toBeInViewport();
});

test("project actions keep keyboard focus and close before their parent dialog", async ({ page }) => {
  await page.goto("/avr", { waitUntil: "load" });
  await page.waitForFunction(() => window.UartDebugAvrMiniProjects);
  await page.evaluate(async () => {
    const { project } = await (await fetch("/api/avr/ai/projects/motion-example")).json();
    await window.UartDebugAvrMiniProjects.install(project);
  });
  await page.locator("#filesOpenBtn").click();
  const row = page.locator("#fileList .file-item.mini-project-item");
  const trigger = row.locator(".file-menu-btn");
  await row.hover();
  const presentation = await row.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    const name = element.querySelector(".file-name").getBoundingClientRect();
    const menu = element.querySelector(".file-menu-btn").getBoundingClientRect();
    return { badge: getComputedStyle(element, "::before").display,
      sourceTooltip: element.title, tooltipsDisabled: element.hasAttribute("data-tooltip-disabled"),
      centerDifference: name.y + name.height / 2 - menu.y - menu.height / 2,
      insetDifference: (name.left - bounds.left) - (bounds.right - menu.right) };
  });
  expect(presentation.badge).toBe("none");
  expect(presentation.sourceTooltip).toBe("");
  expect(presentation.tooltipsDisabled).toBe(true);
  expect(Math.abs(presentation.centerDifference)).toBeLessThan(0.5);
  expect(Math.abs(presentation.insetDifference), "removing MP must remove its reserved width too").toBeLessThan(0.5);
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  const menu = page.getByRole("menu", { name: "Project actions" });
  await expect(menu.getByRole("menuitem").first()).toBeFocused();
  const spacing = await menu.evaluate(element => {
    const buttons = [...element.querySelectorAll("button:not([hidden])")];
    const rects = buttons.map(button => button.getBoundingClientRect());
    const style = getComputedStyle(buttons[0]);
    return { gaps: rects.slice(1).map((rect, index) => rect.top - rects[index].bottom),
      required: parseFloat(getComputedStyle(element).getPropertyValue("--ui-control-gap")),
      focusReach: parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset) };
  });
  for (const gap of spacing.gaps) expect(gap).toBeCloseTo(spacing.required, 1);
  expect(spacing.gaps[0], "the focused action must not cover the neighboring action").toBeGreaterThan(spacing.focusReach);
  await page.keyboard.press("ArrowDown");
  await expect(menu.locator('[data-action="delete"]')).toBeFocused();
  await page.keyboard.press("End");
  await expect(menu.locator('[data-action="download-hex"]')).toBeFocused();
  await page.keyboard.press("Home");
  await expect(menu.locator('[data-action="rename"]')).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(page.locator("#filesModal")).toBeVisible();
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await row.focus();
  await page.keyboard.press("Shift+F10");
  await expect(menu.getByRole("menuitem").first()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(row).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator("#filesModal")).toBeHidden();
  await expect(page.locator("#filesOpenBtn")).toBeFocused();
});
