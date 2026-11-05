"use strict";

const { test, expect } = require("playwright/test");

const surfaces = [
  { name: "specification", frame: "#projectInstructionDropZone", keyboardEntry: "#fileListResizer" },
  { name: "code", frame: ".editor-container", keyboardEntry: "#projectAiColumnResizer" },
  { name: "guide", frame: "#projectDocumentationScroll", keyboardEntry: "#documentationResizer" },
];
const markdown = [
  "# Shared editing surface", "", "A paragraph with **strong**, *emphasis*, `code` and a [link](https://example.com).", "",
  "## Second heading", "", "### Third heading", "", "#### Fourth heading", "", "##### Fifth heading", "", "###### Sixth heading", "",
  "- A list item", "- [x] A completed item", "", "> A quotation.", "",
  ...Array.from({ length: 110 }, (_, index) => `Paragraph ${index}: shared editor content keeps keyboard scrolling observable.\n`),
].join("\n");

test.beforeEach(async ({ page }) => {
  page.__surfaceErrors = [];
  page.on("pageerror", error => page.__surfaceErrors.push(error.message));
  page.on("console", message => { if (message.type() === "error") page.__surfaceErrors.push(message.text()); });
  await page.setViewportSize({ width: 1800, height: 1000 });
});

test.afterEach(async ({ page }) => { expect(page.__surfaceErrors).toEqual([]); });

async function open(page, { project = true } = {}) {
  await page.goto("/avr", { waitUntil: "load" });
  await expect(page).toHaveTitle("AVR Programming - Uart Debug");
  await page.waitForFunction(() => window.UartDebugAvrAiWorkspace && window.UartDebugAvrMiniProjects);
  if (project) await installProject(page);
  await page.evaluate(() => document.fonts.ready);
}

async function installProject(page) {
  await page.evaluate(async (text) => {
    const { project } = await (await fetch("/api/avr/ai/projects/motion-example")).json();
    project.canvas.markdown = text;
    project.files.find(file => file.role === "guide").content = text;
    project.files.find(file => file.role === "source").content = "#include <xc.h>\n"
      + Array.from({ length: 160 }, (_, index) => `// Code row ${index}`).join("\n")
      + "\nint main(void) { while (1) {} }\n";
    await window.UartDebugAvrMiniProjects.install(project);
  }, markdown);
  await expect(page.locator("#projectChatProjectName")).toHaveText("Motion example");
}

async function frameStyle(page, surface) {
  return page.locator(surface.frame).evaluate(element => {
    const style = getComputedStyle(element);
    return Object.fromEntries(["borderTopColor", "borderTopWidth", "borderTopStyle", "borderRadius", "backgroundColor", "boxShadow"]
      .map(property => [property, style[property]]));
  });
}

async function value(page, surface) {
  return page.locator(`${surface.frame} .CodeMirror`).evaluate(element => element.CodeMirror.getValue());
}

async function selectionStyle(cm) {
  return cm.evaluate(element => {
    const editor = element.CodeMirror;
    return editor.getOption("inputStyle") === "contenteditable"
      ? getComputedStyle(editor.getInputField(), "::selection").backgroundColor
      : getComputedStyle(element.querySelector(".CodeMirror-selected")).backgroundColor;
  });
}

async function blurEditors(page) {
  await page.locator("#devicePanelToggle").focus();
  await expect(page.locator(".CodeMirror-focused")).toHaveCount(0);
}

async function keyboardFocusEditor(page, surface) {
  await page.locator(surface.keyboardEntry).focus();
  for (let count = 0; count < 8; count += 1) {
    await page.keyboard.press("Tab");
    if (await page.locator(`${surface.frame} .CodeMirror`).evaluate(element => element.classList.contains("CodeMirror-focused"))) return;
  }
  throw new Error(`Keyboard traversal did not enter the ${surface.name} editor`);
}

test("all editor surfaces inherit the same frame and focus contract for mouse and keyboard editing", async ({ page }, testInfo) => {
  await open(page);
  await blurEditors(page);
  const base = await frameStyle(page, surfaces[0]);
  for (const surface of surfaces) {
    await expect(page.locator(surface.frame)).toHaveClass(/\bscroll-frame\b/);
    expect(await frameStyle(page, surface), `${surface.name}: base frame`).toEqual(base);
  }
  let focused;
  let caretColor;
  let selectionColor;
  let blurredSelectionColor;
  for (const surface of surfaces) {
    const cm = page.locator(`${surface.frame} .CodeMirror`);
    await cm.locator(".CodeMirror-lines").click({ position: { x: 40, y: 40 } });
    await expect(cm).toHaveClass(/CodeMirror-focused/);
    expect(await cm.evaluate(element => getComputedStyle(element.CodeMirror.getInputField()).outlineStyle),
      `${surface.name}: focus belongs to its frame, with no extra outline over the text`).toBe("none");
    const mouseFocus = await frameStyle(page, surface);
    expect(mouseFocus.borderTopColor).not.toBe(base.borderTopColor);
    expect(mouseFocus.boxShadow).not.toBe(base.boxShadow);
    if (!focused) focused = mouseFocus;
    else expect(mouseFocus, `${surface.name}: mouse focus frame`).toEqual(focused);
    await page.keyboard.press("Control+End");
    await page.keyboard.insertText(`\nEdited ${surface.name}`);
    await expect.poll(() => value(page, surface)).toContain(`Edited ${surface.name}`);
    await expect.poll(() => cm.evaluate(element => element.CodeMirror.getScrollInfo().top)).toBeGreaterThan(100);
    const caret = await cm.evaluate(element => {
      const editor = element.CodeMirror;
      return editor.getOption("inputStyle") === "contenteditable"
        ? getComputedStyle(editor.getInputField()).caretColor
        : getComputedStyle(element.querySelector(".CodeMirror-cursor")).borderLeftColor;
    });
    await page.keyboard.press("Shift+Home");
    await expect.poll(() => cm.evaluate(element => element.CodeMirror.getSelection())).not.toBe("");
    if (await cm.evaluate(element => element.CodeMirror.getOption("inputStyle") === "contenteditable")) {
      await expect.poll(() => page.evaluate(() => window.getSelection()?.toString() || "")).not.toBe("");
    }
    const selection = await selectionStyle(cm);
    if (!caretColor) { caretColor = caret; selectionColor = selection; }
    else {
      expect(caret, `${surface.name}: caret`).toBe(caretColor);
      expect(selection, `${surface.name}: focused selection`).toBe(selectionColor);
    }
    await blurEditors(page);
    expect(await frameStyle(page, surface), `${surface.name}: blur restores base frame`).toEqual(base);
    const blurredSelection = await selectionStyle(cm);
    if (!blurredSelectionColor) blurredSelectionColor = blurredSelection;
    else expect(blurredSelection, `${surface.name}: unfocused selection`).toBe(blurredSelectionColor);
    await keyboardFocusEditor(page, surface);
    expect(await frameStyle(page, surface), `${surface.name}: keyboard focus matches mouse focus`).toEqual(focused);
    await page.keyboard.press("Control+Home");
    await expect.poll(() => cm.evaluate(element => element.CodeMirror.getScrollInfo().top)).toBeLessThan(5);
    await blurEditors(page);
  }
  await page.screenshot({ path: testInfo.outputPath("shared-editor-surfaces.png") });
});

test("specification and guide share Markdown typography, options, indentation and keyboard scrolling", async ({ page }) => {
  await open(page);
  await blurEditors(page);
  const markdownSurfaces = [surfaces[0], surfaces[2]];
  const options = [];
  const typography = [];
  for (const surface of markdownSurfaces) {
    await expect(page.locator(surface.frame)).toHaveClass(/\bmarkdown-live-editor\b/);
    const cm = page.locator(`${surface.frame} .CodeMirror`);
    await expect(cm).toHaveClass(/\bis-markdown-live\b/);
    options.push(await cm.evaluate(element => Object.fromEntries([
      "mode", "theme", "inputStyle", "lineNumbers", "lineWrapping", "indentUnit", "tabSize", "indentWithTabs", "viewportMargin", "autofocus",
    ].map(option => [option, element.CodeMirror.getOption(option)]))));
    typography.push(await cm.evaluate(element => {
      const properties = (node, names) => {
        const style = getComputedStyle(node);
        return Object.fromEntries(names.map(name => [name, style[name]]));
      };
      return {
        text: properties(element, ["fontFamily", "fontSize", "lineHeight", "tabSize", "caretColor"]),
        scroll: properties(element.querySelector(".CodeMirror-scroll"), ["overflowX", "overflowY", "overscrollBehavior", "scrollbarGutter"]),
        lines: properties(element.querySelector(".CodeMirror-lines"), ["paddingTop", "paddingBottom"]),
        line: properties(element.querySelector("pre.CodeMirror-line"), ["paddingLeft", "paddingRight"]),
        headings: [1, 2, 3, 4, 5, 6].map(level => properties(element.querySelector(`.project-instruction-line-heading-${level}`),
          ["fontFamily", "fontSize", "fontWeight", "lineHeight"])),
      };
    }));
    await keyboardFocusEditor(page, surface);
    await page.keyboard.press("Control+End");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Tab");
    await page.keyboard.insertText("indentation-marker");
    await expect.poll(() => value(page, surface)).toMatch(/\n {2}indentation-marker$/);
    await expect.poll(() => cm.evaluate(element => element.CodeMirror.getScrollInfo().top)).toBeGreaterThan(100);
    await blurEditors(page);
  }
  expect(options[1]).toEqual(options[0]);
  expect(typography[1]).toEqual(typography[0]);
  expect(typography[0].lines).toEqual({ paddingTop: "16px", paddingBottom: "16px" });
  expect(typography[0].line).toEqual({ paddingLeft: "16px", paddingRight: "16px" });
});

test("native Markdown fallbacks use the same frame, focus, text and scroll styling", async ({ page }) => {
  // Simulate unavailable document-editor enhancement while keeping the code
  // editor available, so the app follows its real textarea fallback branches.
  await page.addInitScript(() => {
    let constructor;
    Object.defineProperty(window, "CodeMirror", {
      configurable: true,
      get: () => constructor,
      set(value) { constructor = value; if (value) value.fromTextArea = undefined; },
    });
  });
  await open(page, { project: false });
  await expect(page.locator("#projectDocumentationEditor")).toHaveJSProperty("readOnly", true);
  await installProject(page);
  await blurEditors(page);
  const fallbackSurfaces = [
    { frame: "#projectInstructionDropZone", input: "#projectInstructionEditor" },
    { frame: "#projectDocumentationScroll", input: "#projectDocumentationEditor" },
  ];
  let base;
  let focused;
  let textStyle;
  for (const surface of fallbackSurfaces) {
    await expect(page.locator(`${surface.frame} .CodeMirror`)).toHaveCount(0);
    const input = page.locator(surface.input);
    await expect(input).toBeEditable();
    if (!base) base = await frameStyle(page, surface);
    else expect(await frameStyle(page, surface)).toEqual(base);
    await input.click();
    if (!focused) focused = await frameStyle(page, surface);
    else expect(await frameStyle(page, surface)).toEqual(focused);
    expect(focused.borderTopColor).not.toBe(base.borderTopColor);
    const computed = await input.evaluate(element => {
      const style = getComputedStyle(element);
      return Object.fromEntries(["fontFamily", "fontSize", "lineHeight", "padding", "caretColor", "tabSize", "overscrollBehavior", "scrollbarGutter"]
        .map(property => [property, style[property]]));
    });
    if (!textStyle) textStyle = computed;
    else expect(computed).toEqual(textStyle);
    await page.keyboard.press("Control+End");
    await page.keyboard.insertText("\nFallback edit");
    await expect(input).toHaveValue(/Fallback edit$/);
    await expect.poll(() => input.evaluate(element => element.scrollTop)).toBeGreaterThan(100);
    await blurEditors(page);
    expect(await frameStyle(page, surface)).toEqual(base);
  }
});
