"use strict";

const { test, expect } = require("playwright/test");
// Playwright already bundles this PNG reader; no extra browser dependency.
const { PNG } = require("playwright-core/lib/utilsBundle");

function sourcePixels(buffer) {
  const png = PNG.sync.read(buffer);
  let count = 0;
  for (let i = 0; i < png.data.length; i += 4) {
    const [r, g, b] = png.data.subarray(i, i + 3);
    if (r > 180 && g > 100 && b < 145 && r > g + 20) count++;
  }
  return count;
}

test("horizontal source scrolling never paints code over the fixed line numbers", async ({ page }, testInfo) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/avr", { waitUntil: "load" });
  await page.waitForFunction(() => window.UartDebugAvrMiniProjects);
  await page.evaluate(async () => {
    const { project } = await (await fetch("/api/avr/ai/projects/motion-example")).json();
    await window.UartDebugAvrMiniProjects.install(project);
    document.querySelector("#editorHost .CodeMirror").CodeMirror.setValue(
      Array.from({ length: 65 }, () => "#define LONG_SOURCE_SYMBOL 123456789 // Readable code must stay outside the fixed line-number column").join("\n"));
  });
  for (const width of [1543, 1024]) {
    await page.setViewportSize({ width, height: 884 });
    await page.evaluate(() => document.fonts.ready);
    for (const left of [0, 55, 120]) {
      await page.evaluate(left => document.querySelector("#editorHost .CodeMirror").CodeMirror.scrollTo(left, 35), left);
      await expect.poll(() => page.locator("#editorHost .CodeMirror").evaluate(node => node.CodeMirror.getScrollInfo().left)).toBe(left);
      const gutter = await page.locator("#editorHost .CodeMirror-gutters").boundingBox();
      const clip = { x: gutter.x, y: gutter.y + 10, width: gutter.width, height: 180 };
      expect(sourcePixels(await page.screenshot({ clip })), `source text bleeds into the gutter at ${width}px / scroll ${left}`).toBe(0);
      expect(sourcePixels(await page.screenshot({ clip: { ...clip, x: gutter.x + gutter.width + 2, width: 140 } })),
        "source must still be visible beside the gutter").toBeGreaterThan(15);
    }
  }
  await page.locator("#editorHost").screenshot({ path: testInfo.outputPath("source-scrolled.png") });
  expect(errors).toEqual([]);
});
