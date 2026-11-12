"use strict";

const { test, expect } = require("playwright/test");

const panels = [".outliner", ".project-instruction-panel", "#editorWorkspace", "#projectDocumentationPane"];
const compactWidths = [62, 62, 62, 62];
const handles = ["fileListResizer", "projectAiColumnResizer", "documentationResizer"];
const directions = [
  { index: 0, boundary: 0, sign: 1 },
  { index: 1, boundary: 0, sign: -1 },
  { index: 1, boundary: 1, sign: 1 },
  { index: 2, boundary: 1, sign: -1 },
  { index: 2, boundary: 2, sign: 1 },
  { index: 3, boundary: 2, sign: -1 },
];

test.beforeEach(async ({ page }) => {
  page.__appErrors = [];
  page.on("pageerror", error => page.__appErrors.push(error.message));
  page.on("console", message => { if (message.type() === "error") page.__appErrors.push(message.text()); });
});

test.afterEach(async ({ page }) => {
  expect(page.__appErrors).toEqual([]);
});

async function filledWorkspace(page, index, width = 1543) {
  await page.setViewportSize({ width, height: 884 });
  await page.goto("/avr", { waitUntil: "load" });
  await expect(page).toHaveTitle("AVR Programming - Uart Debug");
  await page.waitForFunction(() => window.UartDebugAvrAiWorkspace && window.UartDebugAvrMiniProjects);
  await page.evaluate(index => {
    for (const [key, value] of [
      ["ud_avr_programming_outliner_width_v1", index === 0 ? "62" : "260"],
      ["ud_avr_ai_column_width_v1", index === 1 ? "62" : "372"],
      ["ud_avr_programming_documentation_width_v1", index === 3 ? "62" : "280"],
      ["ud_avr_programming_editor_collapsed_v1", index === 2 ? "true" : "false"],
    ]) localStorage.setItem(key, value);
  }, index);
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => window.UartDebugAvrAiWorkspace && window.UartDebugAvrMiniProjects);
  await page.evaluate(async () => {
    const { project } = await (await fetch("/api/avr/ai/projects/motion-example")).json();
    for (let index = 0; index < 8; index++) {
      const copy = structuredClone(project);
      const title = `Supporting project ${index} with a long file list label`;
      copy.id = `supporting-project-${index}`;
      copy.title = title;
      copy.canvasName = `${title}.md`;
      copy.projectPath = `Target_Projects/${title}`;
      copy.canvas.markdown = copy.canvas.markdown.replaceAll("Motion example", title);
      copy.files.forEach(file => { file.name = file.name.replace("Motion example", title); });
      await window.UartDebugAvrMiniProjects.install(copy);
    }
    await window.UartDebugAvrMiniProjects.install(project);
  });
  await expect(page.locator(".canvas-split-container")).toBeVisible();
  await expect(page.locator("#fileList")).toContainText("Motion example");
  await expect(page.locator(".CodeMirror")).toHaveCount(3);
  // Seed after beforeunload has saved the old controller's in-memory state.
  await page.addInitScript(() => {
    const state = JSON.parse(localStorage.getItem("ud_avr_programming_state_v7") || "null");
    if (!state) return;
    const currentProject = Object.values(state.miniProjects).find(project => project.files.source === state.current);
    if (!currentProject) return;
    currentProject.conversation = {
      schemaVersion: 1, draft: "Continue with the UART example.",
      messages: [
        { id: "motion-user", role: "user", content: "Explain UART initialization and interrupt behavior.", createdAt: 1, status: "complete" },
        { id: "motion-assistant", role: "assistant", content: "## UART initialization\n\n" +
          Array.from({ length: 8 }, () => "Keep the current text layout stable while its window opens or closes. Repeated words make changes in wrapping visible during the animation.").join("\n\n"),
          createdAt: 2, status: "complete" },
      ],
    };
    localStorage.setItem("ud_avr_programming_state_v7", JSON.stringify(state));
  });
  // Installation can focus an editor; restore the intended layout afterwards.
  await page.evaluate(index => {
    if (index === 0) localStorage.setItem("ud_avr_programming_outliner_width_v1", "62");
    if (index === 1) localStorage.setItem("ud_avr_ai_column_width_v1", "62");
    if (index === 2) localStorage.setItem("ud_avr_programming_editor_collapsed_v1", "true");
    if (index === 3) localStorage.setItem("ud_avr_programming_documentation_width_v1", "62");
  }, index);
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => window.UartDebugAvrAiWorkspace);
  await expect(page.locator("#projectChatThread .project-chat-message")).toHaveCount(2);
  await expect(page.locator("#projectChatInput")).toHaveValue("Continue with the UART example.");
  await page.evaluate(() => {
    for (const node of document.querySelectorAll(".CodeMirror")) node.CodeMirror.scrollTo(0, 100);
    for (const record of window.UartDebugNotifications?.getAll() || []) window.UartDebugNotifications.dismiss(record.id);
  });
  await expect(page.locator("#compileLog, .compile-log-frame, #projectCanvasStatus, #projectInstructionSaveState")).toHaveCount(0);
  await expect(page.locator(".canvas-split-container [data-panel-action-contour]")).toHaveCount(4);
  await expect.poll(() => page.locator(panels[index]).evaluate(node => node.getBoundingClientRect().width)).toBe(compactWidths[index]);
}

async function separatorPoint(page, boundary) {
  const box = await page.locator("#" + handles[boundary]).boundingBox();
  return { x: box.x + box.width / 2, y: box.y + box.height * 0.82 };
}

async function heldGesture(page, direction, opening) {
  const { index, boundary, sign } = direction;
  const point = await separatorPoint(page, boundary);
  const logicalWidth = await page.locator(".canvas-split-container").evaluate((node, index) =>
    Number.parseFloat(getComputedStyle(node).gridTemplateColumns.split(" ")[index * 2]), index);
  const threshold = opening ? 48 : logicalWidth - 240 + 120;
  const movement = opening ? sign : -sign;
  await page.locator("#" + handles[boundary]).evaluate(node => {
    node.addEventListener("pointerdown", event => { window.__heldPointerId = event.pointerId; }, { once: true });
  });
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.evaluate(selector => {
    window.__motionFrames = [];
    window.__recordMotion = true;
    const compactClasses = ["is-outliner-compact", "is-project-ai-compact", "is-editor-compact", "is-documentation-compact"];
    const paneElements = [...document.querySelectorAll(
      ".canvas-split-container > :is(.outliner, .project-ai-layout, .editor-workspace, .documentation-workspace)")];
    const paneMotion = (styles = new Map()) => paneElements.map((pane, index) => {
      const toolbar = pane.querySelector(".panel-action-lobe");
      const chrome = pane.querySelector([
        ".project-chat-surface", ".project-instruction-live-editor", ".editor-container", "#projectDocumentationScroll",
      ][index]);
      const outer = pane.getBoundingClientRect();
      const inner = chrome.getBoundingClientRect();
      const cm = [...chrome.querySelectorAll(".CodeMirror")].find(element => element.getClientRects().length);
      const viewport = cm?.CodeMirror.getScrollerElement();
      const scroll = cm?.CodeMirror.getScrollInfo();
      const anchorLine = cm?.CodeMirror.lineAtHeight(scroll.top, "local");
      const anchor = cm ? { line: anchorLine,
        offset: scroll.top - cm.CodeMirror.heightAtLine(anchorLine, "local", true), left: scroll.left } : null;
      const referenceAnchor = window.__motionAnchorReferences?.[index];
      const text = cm?.querySelector(".CodeMirror-code");
      const content = text?.getBoundingClientRect();
      const lineGeometry = text ? [...text.querySelectorAll(".CodeMirror-line, .markdown-live-block-widget")]
        .slice(0, 6).map(line => {
          const bounds = line.getBoundingClientRect();
          return [bounds.x - content.x, bounds.y - content.y, bounds.width, bounds.height];
        }) : [];
      return { compact: document.querySelector(".canvas-split-container").classList.contains(compactClasses[index]),
        toolbarInset: toolbar ? outer.right - toolbar.getBoundingClientRect().right : null,
        compactContentsPainted: index === 0 ? painted(pane.querySelector("#projectChatCompactLabel"), styles) : null,
        outer: [outer.width, outer.height],
        chrome: { size: [inner.width, inner.height],
          insets: [inner.x - outer.x, outer.right - inner.right, inner.y - outer.y, outer.bottom - inner.bottom] },
        controls: [...pane.querySelectorAll(".panel-action-lobe button")].map(button => {
          const bounds = button.getBoundingClientRect();
          return { id: button.id, size: [bounds.width, bounds.height],
            insets: [outer.right - bounds.right, bounds.y - outer.y],
            font: getComputedStyle(button).fontSize, opacity: effectiveOpacity(button, styles) };
        }),
        editor: cm ? { viewport: [viewport.clientWidth, viewport.clientHeight],
          scroll: [scroll.left, scroll.top, scroll.width, scroll.height], lines: lineGeometry,
          anchor, expectedAnchorTop: referenceAnchor ? Math.min(Math.max(0,
            cm.CodeMirror.heightAtLine(referenceAnchor.line, "local", true) + referenceAnchor.offset),
            Math.max(0, scroll.height - scroll.clientHeight)) : null } : null };
    });
    const effectiveOpacity = (element, styles) => {
      let opacity = 1;
      for (let node = element; node; node = node.parentElement) {
        if (!styles.has(node)) styles.set(node, getComputedStyle(node));
        const style = styles.get(node);
        if (style.display === "none" || style.visibility !== "visible") return 0;
        opacity *= Number(style.opacity);
      }
      return opacity;
    };
    const painted = (element, styles) => effectiveOpacity(element, styles) > 0;
    const textMotion = (styles = new Map()) => paneElements.flatMap((pane, index) => {
      const outer = pane.getBoundingClientRect();
      const relative = bounds => [bounds.x - outer.x, bounds.y - outer.y, bounds.width, bounds.height];
      const glyphRects = element => {
        const rectangles = [];
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode()) && rectangles.length < 64) {
          const range = document.createRange();
          range.selectNodeContents(node);
          for (const bounds of range.getClientRects()) {
            if (bounds.width > 0.1 && bounds.height > 0.1) rectangles.push(relative(bounds));
          }
        }
        return rectangles;
      };
      const selectors = [".CodeMirror-code", ".CodeMirror-gutters", ".CodeMirror-cursors", "#editorFileWatermark",
        ".project-chat-message-content", "#projectChatInput"];
      return selectors.flatMap(selector => [...pane.querySelectorAll(selector)].map((element, ordinal) => {
        const layer = element;
        const bounds = layer.getBoundingClientRect();
        const lines = [...element.querySelectorAll(".CodeMirror-line, .markdown-live-block-widget, .CodeMirror-linenumber")].slice(0, 6);
        const rectangles = lines.length ? lines.flatMap(glyphRects) : glyphRects(layer);
        rectangles.push(...[...element.querySelectorAll(".CodeMirror-cursor")]
          .filter(cursor => cursor.getClientRects().length).map(cursor => relative(cursor.getBoundingClientRect())));
        const glyphs = [];
        for (const rectangle of rectangles.sort((a, b) => a[1] - b[1] || a[0] - b[0])) {
          const row = glyphs.find(row => Math.abs(row[1] - rectangle[1]) < 0.5 && Math.abs(row[3] - rectangle[3]) < 0.5 &&
            rectangle[0] <= row[0] + row[2] + 0.75 && rectangle[0] + rectangle[2] >= row[0] - 0.75);
          if (!row) glyphs.push([...rectangle]);
          else {
            const right = Math.max(row[0] + row[2], rectangle[0] + rectangle[2]);
            row[0] = Math.min(row[0], rectangle[0]);
            row[2] = right - row[0];
          }
        }
        return { key: `${index}:${selector}:${ordinal}`, pane: index,
          opacity: effectiveOpacity(layer, styles), font: getComputedStyle(layer).fontSize,
          box: relative(bounds), glyphs };
      }));
    });
    window.__motionAnchorReferences = null;
    window.__motionBefore = paneMotion();
    window.__motionAnchorReferences = window.__motionBefore.map(pane => pane.editor?.anchor || null);
    window.__motionBeforeText = textMotion();
    const started = performance.now();
    const sample = () => {
      const container = document.querySelector(".canvas-split-container");
      const styles = new Map();
      const frozen = [...container.querySelectorAll("[data-workspace-motion-content]")].map(element => {
        const bounds = element.getBoundingClientRect();
        return {
          key: `${paneElements.findIndex(pane => pane.contains(element))}:${element.id || element.className}`,
          pane: paneElements.findIndex(pane => pane.contains(element)),
          painted: painted(element, styles),
          opacity: effectiveOpacity(element, styles),
          size: [bounds.width, bounds.height],
          lines: [...element.querySelectorAll(".CodeMirror-line, .markdown-live-block-widget, h1, h2, h3, p, li, pre")].slice(0, 6).map(line => {
            const rect = line.getBoundingClientRect();
            return [rect.x - bounds.x, rect.y - bounds.y, rect.width, rect.height];
          }),
        };
      });
      window.__motionFrames.push({ t: performance.now() - started,
        width: document.querySelector(selector).getBoundingClientRect().width,
        active: container.classList.contains("is-workspace-transitioning"), frozen, panes: paneMotion(styles), text: textMotion(styles) });
      if (window.__recordMotion) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }, panels[index]);
  await page.mouse.move(point.x + movement * threshold, point.y);
  // Replay frequent samples inside the browser: per-command automation delays
  // previously hid the transition-restart bug seen with a held physical mouse.
  const { count: samples, lastX } = await page.evaluate(({ id, point, threshold, movement }) => new Promise(resolve => {
    const handle = document.getElementById(id), started = performance.now();
    let count = 0;
    let lastX = point.x + movement * threshold;
    const timer = setInterval(() => {
      const elapsed = performance.now() - started;
      if (elapsed >= 250) { clearInterval(timer); resolve({ count, lastX }); return; }
      lastX = point.x + movement * (threshold + elapsed * 0.3);
      handle.dispatchEvent(new PointerEvent("pointermove", { pointerId: window.__heldPointerId,
        clientX: lastX, clientY: point.y,
        buttons: 1, bubbles: true, cancelable: true }));
      count++;
    }, 1);
  }), { id: handles[boundary], point, threshold, movement });
  // Replay events do not move the browser's real pointer. Align it before the
  // stationary hold so pointerup reports this gesture's actual final position.
  await page.mouse.move(lastX, point.y);
  // Hold the pointer still through completion. Ordinary dragging after the snap
  // would legitimately change text layout and hide a second completion repaint.
  await page.waitForTimeout(450);
  await page.mouse.up();
  await page.evaluate(() => { window.__recordMotion = false; });
  const frames = await page.evaluate(() => window.__motionFrames);
  const before = await page.evaluate(() => window.__motionBefore);
  const beforeText = await page.evaluate(() => window.__motionBeforeText);
  const active = frames.filter(frame => frame.active);
  const lastActiveIndex = frames.findLastIndex(frame => frame.active);
  const settled = frames.slice(lastActiveIndex + 1);
  try {
    expect(samples).toBeGreaterThan(20);
    expect(active.length).toBeGreaterThanOrEqual(8);
    expect(new Set(active.map(frame => frame.width.toFixed(1))).size).toBeGreaterThanOrEqual(8);
    const range = Math.max(...frames.map(frame => frame.width)) - Math.min(...frames.map(frame => frame.width));
    // A long unsampled interval cannot distinguish a jump from normal animation.
    // Keep the width-jump check on adjacent, closely sampled frames; distinct
    // active widths above still reject a frozen transition with a final snap.
    const adjacent = frames.slice(1).map((frame, index) => ({ frame, previous: frames[index] }))
      .filter(({ frame, previous }) => frame.t - previous.t <= 40);
    expect(adjacent.length).toBeGreaterThanOrEqual(8);
    const maxJump = Math.max(...adjacent.map(({ frame, previous }) => Math.abs(frame.width - previous.width)));
    expect(maxJump, "a snap must move through intermediate widths instead of jumping at its deadline: " +
      JSON.stringify(frames.map(frame => [Math.round(frame.t), frame.width, frame.active])))
      .toBeLessThan(Math.max(24, range * 0.42));
    expect(active[0].frozen.length).toBeGreaterThan(0);
    const closingPanes = active[0].panes.map((pane, index) => !before[index].compact && pane.compact);
    if (!opening) expect(closingPanes[index], "the requested pane must enter its closing state").toBe(true);
    for (const frozen of active[0].frozen) {
      expect(frozen.painted, `${frozen.key} must have its final paint visibility before the first animation frame`)
        .toBe(!closingPanes[frozen.pane]);
    }
    for (const frame of active) for (const [index, frozen] of frame.frozen.entries()) {
      if (closingPanes[frozen.pane]) expect(frozen.painted,
        `${frozen.key} must stay hidden while its closing buttons move`).toBe(false);
      const geometry = ({ painted, opacity, ...layout }) => layout;
      expect(geometry(frozen), `text layer ${frozen.key} changed at ${Math.round(frame.t)}ms during ${opening ? "opening" : "closing"}`)
        .toEqual(geometry(active[0].frozen[index]));
    }
    expect(settled.length, "record the first frames after the animation, not only its active period").toBeGreaterThanOrEqual(6);
    expect(settled.at(-1).t - settled[0].t).toBeGreaterThanOrEqual(100);
    const changedGeometry = (left, right, tolerance = 1.5) => {
      if (left.length !== right.length) return true;
      return left.some((row, index) => row.length !== right[index].length ||
        row.some((value, column) => Math.abs(value - right[index][column]) > tolerance));
    };
    const textBoundary = (from, to, label) => {
      for (const next of to) {
        const previous = from.find(item => item.key === next.key);
        if (!previous || previous.opacity < 0.01 || !previous.glyphs.length || !next.glyphs.length) continue;
        const layoutChanged = Math.abs(parseFloat(previous.font) - parseFloat(next.font)) > 0.1 ||
          changedGeometry(previous.glyphs, next.glyphs);
        if (!layoutChanged) continue;
        // A layout change is concealed when either adjacent paint is already
        // transparent; the revealed glyphs must never visibly teleport.
        expect(Math.min(previous.opacity, next.opacity),
          `${next.key} must have a transparent boundary when its glyphs reflow or change font at ${label}: ` +
          JSON.stringify({ previous, next })).toBeLessThanOrEqual(0.12);
      }
    };
    // The former regression hid between these samples: active frames and final
    // frames were each stable, but visible text jumped as the width lock ended.
    textBoundary(beforeText, active[0].text, "the first moving frame");
    textBoundary(active.at(-1).text, settled[0].text, "the animation deadline");
    for (const [pane, geometry] of settled[0].panes.entries()) {
      const last = active.at(-1).panes[pane];
      if (geometry.compact || last.compact) continue;
      expect(changedGeometry([last.chrome.insets], [geometry.chrome.insets]),
        `pane ${pane} frame must not jump in either axis when text wrapping is reconciled`).toBe(false);
      for (const [index, button] of geometry.controls.entries()) {
        expect(changedGeometry([last.controls[index].size, last.controls[index].insets], [button.size, button.insets]),
          `${button.id} must not jump at the animation deadline`).toBe(false);
        expect(button.font).toBe(last.controls[index].font);
      }
      const previousEditor = before[pane].editor;
      if (!before[pane].compact && previousEditor && geometry.editor) {
        expect(Math.abs(geometry.editor.scroll[1] - geometry.editor.expectedAnchorTop),
          `pane ${pane} must preserve its previous source line and offset while wrapping changes, unless clamped at the document edge`)
          .toBeLessThan(1.5);
        expect(geometry.editor.scroll[0], `pane ${pane} must preserve horizontal reading position`).toBe(previousEditor.scroll[0]);
      }
    }
    for (const frame of active) for (const [pane, geometry] of frame.panes.entries()) {
      if (pane === 0 && before[pane].compact && geometry.compact) {
        expect(geometry.compactContentsPainted, "an already compact chat must keep its expansion control visible").toBe(true);
      }
      for (const [index, control] of geometry.controls.entries()) {
        const previous = before[pane].controls[index];
        expect(changedGeometry([control.size, control.insets], [previous.size, previous.insets], 0.1),
          `${control.id} must keep its capsule position and size in expanded, moving and compact states`).toBe(false);
        expect(control.font).toBe(previous.font);
      }
      if (geometry.compact) continue;
      const reference = before[pane].compact ? settled[0].panes[pane] : before[pane];
      for (const edge of [0, 1]) {
        expect(Math.abs(geometry.chrome.insets[edge] - reference.chrome.insets[edge]),
          `pane ${pane} inner frame must follow its outer ${edge ? "right" : "left"} edge throughout the transition`)
          .toBeLessThan(1);
      }
      if (geometry.editor) {
        expect(geometry.editor.scroll.slice(0, 2), `pane ${pane} scroll position must stay fixed while its viewport resizes`)
          .toEqual(active[0].panes[pane].editor.scroll.slice(0, 2));
        const viewportInset = geometry.chrome.size[0] - geometry.editor.viewport[0];
        const referenceInset = reference.chrome.size[0] - reference.editor.viewport[0];
        expect(Math.abs(viewportInset - referenceInset), `pane ${pane} CodeMirror viewport must follow the moving frame`)
          .toBeLessThan(1);
      }
    }
    for (const [pane, geometry] of settled[0].panes.entries()) {
      if (geometry.compact) continue;
      for (const frame of settled) {
        expect(frame.panes[pane].chrome, `pane ${pane} frame must already be settled in the first final frame`)
          .toEqual(geometry.chrome);
        expect(frame.panes[pane].editor, `pane ${pane} text and scrollbars must not redraw again after the first final frame`)
          .toEqual(geometry.editor);
        const controls = frame.panes[pane].controls;
        expect(controls.map(({ id, font, opacity }) => ({ id, font, opacity })),
          `pane ${pane} controls must retain their identity and appearance`).toEqual(
          geometry.controls.map(({ id, font, opacity }) => ({ id, font, opacity })));
        for (const [index, control] of controls.entries()) {
          const reference = geometry.controls[index];
          const maximumDrift = Math.max(...[...control.size, ...control.insets].map((value, coordinate) =>
            Math.abs(value - [...reference.size, ...reference.insets][coordinate])));
          expect(maximumDrift,
            `${control.id} must stop with its window, allowing only subpixel raster rounding`).toBeLessThan(0.1);
        }
      }
    }
    for (const [pane, closing] of closingPanes.entries()) {
      if (!closing || before[pane].toolbarInset === null) continue;
      for (const frame of active) {
        expect(Math.abs(frame.panes[pane].toolbarInset - before[pane].toolbarInset),
          "the capsule must keep its position relative to its page while closing").toBeLessThan(0.1);
        const content = frame.frozen.filter(body => body.pane === pane);
        expect(content.length).toBeGreaterThan(0);
        expect(content.every(body => !body.painted), "a closing page must clear its text before reaching the compact rail").toBe(true);
      }
    }
    await expect(page.locator("[data-workspace-motion-content]")).toHaveCount(0);
    await expect(page.locator("[data-workspace-motion-clip]")).toHaveCount(0);
    await expect(page.locator("[data-workspace-motion-height], [data-workspace-text-motion]")).toHaveCount(0);
    await expect(page.locator(".canvas-split-container")).not.toHaveClass(/is-workspace-transitioning/);
    const width = await page.locator(panels[index]).evaluate(node => node.getBoundingClientRect().width);
    if (opening) {
      expect(width).toBeGreaterThanOrEqual(239);
      const content = page.locator(panels[index]).locator([
        ".project-chat-surface", ".project-instruction-live-editor", ".editor-container", "#projectDocumentationScroll",
      ][index]);
      await expect(content).toBeVisible();
      expect(await content.evaluate(element => {
        for (let node = element; node; node = node.parentElement) {
          const style = getComputedStyle(node);
          if (style.display === "none" || style.visibility !== "visible" || Number(style.opacity) === 0) return false;
        }
        return true;
      }), "opening must restore painted content").toBe(true);
    }
    else expect(width).toBe(compactWidths[index]);
    const blockedActions = await page.locator(".panel-action-lobe button").evaluateAll(buttons => buttons.filter(button => {
      const bounds = button.getBoundingClientRect();
      if (button.disabled || !bounds.width || !bounds.height) return false;
      const hit = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      return hit !== button && !button.contains(hit);
    }).map(button => button.id));
    expect(blockedActions, "window clipping must not cover protruding action buttons").toEqual([]);
  } catch (error) {
    await test.info().attach("motion-frame-metrics", {
      body: JSON.stringify({ direction, opening, before, beforeText, frames }), contentType: "application/json",
    });
    throw error;
  }
}

for (const width of [1543, 1024]) for (const direction of directions) {
  test(`pane ${direction.index} from boundary ${direction.boundary}: stable held opening and closing at ${width}px`, async ({ page }, testInfo) => {
    await filledWorkspace(page, direction.index, width);
    await heldGesture(page, direction, true);
    if (width === 1543 && direction.index === 3) await page.screenshot({ path: testInfo.outputPath("filled-workspace.png") });
    await heldGesture(page, direction, false);
  });
}

test("reduced motion opens immediately without leaving frozen content", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await filledWorkspace(page, 2);
  await page.locator("#projectAiColumnResizer").focus();
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator("#editorWorkspace")).toHaveJSProperty("clientWidth", 238);
  await expect(page.locator(".canvas-split-container")).not.toHaveClass(/is-workspace-transitioning/);
  await expect(page.locator("[data-workspace-motion-content]")).toHaveCount(0);
});

test("keyboard resizing uses the same transition and releases its frozen content", async ({ page }) => {
  await filledWorkspace(page, 2);
  await page.locator("#projectAiColumnResizer").focus();
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator(".canvas-split-container")).toHaveClass(/is-workspace-transitioning/);
  await expect(page.locator("[data-workspace-motion-content]")).not.toHaveCount(0);
  await expect(page.locator(".canvas-split-container")).not.toHaveClass(/is-workspace-transitioning/);
  await page.keyboard.press("End");
  await expect(page.locator(".canvas-split-container")).toHaveClass(/is-workspace-transitioning/);
  await expect(page.locator(".canvas-split-container")).not.toHaveClass(/is-workspace-transitioning/);
  await expect(page.locator("#editorWorkspace")).toHaveJSProperty("clientWidth", 60);
  await expect(page.locator("[data-workspace-motion-content]")).toHaveCount(0);
});

test("cancelled and reversed held gestures leave usable, settled panels", async ({ page }) => {
  await filledWorkspace(page, 1);
  const handle = page.locator("#projectAiColumnResizer"), point = await separatorPoint(page, 1);
  await handle.evaluate(node => node.addEventListener("pointerdown", event => { window.__heldPointerId = event.pointerId; }));
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 20, point.y);
  await handle.evaluate(node => node.dispatchEvent(new PointerEvent("pointercancel", { pointerId: window.__heldPointerId, bubbles: true })));
  await page.mouse.up();
  await expect(handle).not.toHaveClass(/is-resizing/);
  await expect(page.locator("body")).not.toHaveClass(/is-column-resizing/);
  await expect(page.locator(panels[1])).toHaveJSProperty("clientWidth", 60);

  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 48, point.y);
  await page.mouse.move(point.x + 20, point.y);
  await expect(page.locator(".canvas-split-container")).not.toHaveClass(/is-workspace-transitioning/);
  await page.mouse.move(point.x - 100, point.y);
  await page.mouse.up();
  await expect(page.locator(".canvas-split-container")).not.toHaveClass(/is-workspace-transitioning/);
  await expect(page.locator(panels[1])).toHaveJSProperty("clientWidth", 60);
  await expect(page.locator("[data-workspace-motion-content]")).toHaveCount(0);
});

for (const width of [900, 1024, 1543, 1920]) {
  test(`the compact hardware flow keeps four equal controls beside the action cards and account at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 884 });
    await page.goto("/avr", { waitUntil: "load" });
    await page.waitForFunction(() => document.querySelectorAll("#mcuSelect option").length > 1);
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator(".avr-overview-row > .avr-overview-viewport")).toHaveCount(3);
    await expect(page.locator(".hardware-flow > .hardware-step")).toHaveCount(4);
    await expect(page.locator("#avrActionsPanelViewport .avr-action-card").filter({ has: page.locator("#filesOpenBtn") })).toContainText("Projects");
    await expect(page.locator("#avrActionsPanelViewport .avr-action-card").filter({ has: page.locator("#notificationsBtn") })).toContainText("Notifications");
    await expect(page.locator(".hardware-step-caption, .hardware-step-detail, #chipStatusText")).toHaveCount(0);
    await expect(page.locator("#detectChipBtn > svg")).toHaveCount(0);
    await expect(page.locator("#detectChipBtn [data-detect-hover]")).toHaveText("Click to detect the chip");
    await expect(page.locator("#mcuSelect")).toHaveAttribute("data-control-caption", "Chip");
    await expect(page.locator("#projectPackageSelect")).toHaveAttribute("data-control-caption", "Package");
    await expect(page.locator(".hardware-port .hardware-field-caption")).toHaveText("Port");
    for (const selected of [false, true]) {
      if (selected) {
        await page.selectOption("#mcuSelect", { label: "ATtiny1624" });
        await page.selectOption("#projectPackageSelect", { label: "TSSOP-14" });
      }
      for (const state of ["expanded", "compact"]) {
        await page.locator("#devicePanelToggle").focus();
        await page.keyboard.press("End");
        if (state === "compact") await page.keyboard.press("ArrowUp");
        await expect(page.locator("#avrDeviceSection")).toHaveAttribute("data-state", state);
        await expect(page.locator("#avrDeviceSection")).not.toHaveClass(/is-device-panel-transitioning/);
        const geometry = await page.evaluate(() => {
          const rect = element => {
            const { x, y, width, height } = element.getBoundingClientRect();
            return { x, y, width, height };
          };
          const field = selector => {
            const element = document.querySelector(selector);
            const label = element.querySelector(".custom-select-value");
            const range = document.createRange();
            if (label) range.selectNodeContents(label);
            return { ...rect(element), selector,
              labelFits: !label || range.getBoundingClientRect().width <= label.getBoundingClientRect().width + 1 };
          };
          const viewport = document.getElementById("avrDevicePanelViewport");
          const panel = document.getElementById("avrTargetPanelViewport");
          return {
            row: rect(document.querySelector(".avr-overview-row")),
            workspace: rect(document.getElementById("projectWorkspaceStage")),
            hardware: rect(viewport), panel: rect(panel),
            actionPanel: rect(document.getElementById("avrActionsPanelViewport")),
            actionGrid: rect(document.querySelector("#avrActionsPanelViewport > .avr-action-panel")),
            account: rect(document.getElementById("avrAccountPanelViewport")),
            controls: ["#detectChipBtn", ".hardware-step--port > .hardware-field", "#mcuSelect + .custom-select .custom-select-trigger",
              "#projectPackageSelect + .custom-select .custom-select-trigger"].map(field),
            actions: [...document.querySelectorAll("#avrActionsPanelViewport .avr-action-card")].map(card => ({
              ...rect(card),
              trigger: rect(card.querySelector(".avr-panel-trigger")),
            })),
            internalCaptions: [...document.querySelectorAll(".hardware-port .hardware-field-caption, .hardware-flow .custom-select-caption")]
              .map(element => element.closest(".hardware-field, .custom-select-trigger") !== null),
            connectionArrows: [...document.querySelectorAll(".hardware-step")].some(element => {
              const style = getComputedStyle(element, "::before");
              return style.content !== "none" && parseFloat(style.borderTopWidth) > 0 && parseFloat(style.borderRightWidth) > 0;
            }),
            singleOwner: viewport.contains(panel) && !panel.classList.contains("avr-target-panel-viewport"),
            overflow: document.documentElement.scrollWidth > innerWidth,
          };
        });
        const { hardware, panel, actionPanel, actionGrid, account } = geometry;
        expect(geometry.singleOwner, "the hardware frame must have one viewport owner, without nested viewport animations").toBe(true);
        expect(geometry.row.x, "the header must share the workspace's left edge").toBeCloseTo(geometry.workspace.x, 1);
        expect(geometry.row.x + geometry.row.width, "the header must share the workspace's right edge")
          .toBeCloseTo(geometry.workspace.x + geometry.workspace.width, 1);
        expect(hardware.x).toBeCloseTo(geometry.row.x, 1);
        expect(account.x + account.width).toBeCloseTo(geometry.workspace.x + geometry.workspace.width, 1);
        expect(panel.x).toBeCloseTo(hardware.x, 1);
        expect(panel.width).toBeCloseTo(hardware.width, 1);
        expect(actionPanel.x - hardware.x - hardware.width, "hardware and actions keep the shared panel gap").toBeCloseTo(8, 1);
        expect(account.x - actionPanel.x - actionPanel.width, "actions and account keep the shared panel gap").toBeCloseTo(8, 1);
        expect(hardware.width, "the hardware flow needs the main share of the header").toBeGreaterThan(account.width);
        expect(geometry.overflow, "desktop resizing must not introduce page overflow").toBe(false);
        expect(geometry.controls).toHaveLength(4);
        expect(geometry.actions).toHaveLength(2);
        const controls = [...geometry.controls, ...geometry.actions];
        for (const [frame, items] of [[hardware, geometry.controls], [actionGrid, geometry.actions]]) {
          for (const control of items) {
            expect(control.width, "each field and utility must keep a usable hit or readout area").toBeGreaterThanOrEqual(36);
            expect(control.x).toBeGreaterThanOrEqual(frame.x);
            expect(control.x + control.width).toBeLessThanOrEqual(frame.x + frame.width);
            expect(control.y).toBeGreaterThanOrEqual(frame.y);
            expect(control.y + control.height).toBeLessThanOrEqual(frame.y + frame.height);
          }
        }
        const originalButton = geometry.controls[0];
        for (const control of geometry.controls) {
          expect(control.width, "the four controls match the original first button width").toBeCloseTo(originalButton.width, 1);
          expect(control.height, "the four controls match the original first button height").toBeCloseTo(originalButton.height, 1);
          expect(control.y).toBeCloseTo(originalButton.y, 1);
        }
        expect(originalButton.width).toBeGreaterThanOrEqual(width <= 1400 ? 100 : 148);
        expect(originalButton.height).toBe(state === "expanded" ? 76 : 36);
        for (const action of geometry.actions) {
          expect(action.width, "each card matches the neighboring account panel").toBeCloseTo(account.width, 1);
          expect(action.height).toBeCloseTo(state === "expanded" ? 112 : 54, 1);
          expect(action.y).toBeCloseTo(actionPanel.y, 1);
          expect(action.trigger.x).toBeGreaterThanOrEqual(action.x);
          expect(action.trigger.y).toBeGreaterThanOrEqual(action.y);
          expect(action.trigger.x + action.trigger.width).toBeLessThanOrEqual(action.x + action.width);
          expect(action.trigger.y + action.trigger.height).toBeLessThanOrEqual(action.y + action.height);
          expect(action.trigger.width).toBeGreaterThanOrEqual(action.width - 2);
          expect(action.trigger.height).toBeGreaterThanOrEqual(action.height - 2);
        }
        expect(geometry.internalCaptions).toEqual([true, true, true]);
        expect(geometry.connectionArrows, "the visual connection must not add directional arrows").toBe(false);
        for (let index = 1; index < geometry.controls.length; index += 1) {
          const previous = geometry.controls[index - 1], current = geometry.controls[index];
          expect(current.x - previous.x - previous.width, "Detect, Port, Chip and Package retain their left-to-right order")
            .toBeGreaterThanOrEqual(8);
        }
        const [projects, notifications] = geometry.actions;
        const lastField = geometry.controls[3];
        expect(projects.x, "project actions remain outside the four-stage sequence").toBeGreaterThan(lastField.x + lastField.width);
        expect(notifications.x - projects.x - projects.width).toBeCloseTo(8, 1);
        for (const [index, left] of controls.entries()) for (const right of controls.slice(index + 1)) {
          const overlap = Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x) > 0.5 &&
            Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y) > 0.5;
          expect(overlap, "hardware controls and utilities must remain independently usable").toBe(false);
        }
        if (selected) {
          for (const control of geometry.controls.slice(2)) expect(control.labelFits, "selected MCU and package names stay readable").toBe(true);
          await expect(page.locator("#mcuSelect + .custom-select .custom-select-trigger")).toContainText("ATtiny1624");
          await expect(page.locator("#projectPackageSelect + .custom-select .custom-select-trigger")).toContainText("TSSOP-14");
        }
        if ((width === 1543 || width === 1024) && selected) await page.screenshot({ path: testInfo.outputPath(`overview-${state}.png`) });
      }
    }
    await page.locator("#filesOpenBtn").click();
    await expect(page.locator("#filesModal")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.locator("#notificationsBtn").click();
    await expect(page.locator("#notificationModal")).toBeVisible();
  });
}

test("the guide edits directly, persists after reload and accepts code heading navigation", async ({ page }, testInfo) => {
  await filledWorkspace(page, 0);
  for (const id of ["documentationEditToggle", "projectGenerateCodeBtn", "projectDescribeCodeBtn"]) {
    await expect(page.locator("#" + id)).toHaveCount(0);
  }
  await expect(page.locator(".panel-action-lobe")).toHaveCount(3);
  await expect(page.locator("#projectDocumentationPane button, #projectDocumentationPane .panel-action-lobe")).toHaveCount(0);
  const guide = page.locator("#projectDocumentationScroll .CodeMirror");
  await expect(guide).toBeVisible();
  expect(await guide.evaluate(node => node.CodeMirror.getOption("readOnly"))).toBe(false);
  await guide.evaluate(node => node.CodeMirror.focus());
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText("\n\n## Direct edit\n\nSaved directly in the guide.");
  await page.locator("#documentationResizer").focus();
  await expect.poll(() => guide.evaluate(node => node.CodeMirror.getValue())).toContain("Saved directly in the guide.");
  // Let the normal local-save debounce complete before testing a real reload.
  await page.waitForTimeout(400);
  await page.reload({ waitUntil: "load" });
  await expect.poll(() => guide.evaluate(node => node.CodeMirror.getValue())).toContain("Saved directly in the guide.");
  expect(await guide.evaluate(node => node.CodeMirror.getOption("readOnly"))).toBe(false);

  const code = page.locator("#editorContent .CodeMirror");
  await code.evaluate(node => node.CodeMirror.focus());
  await page.keyboard.press("Control+Home");
  await page.keyboard.insertText("//## Section 12\n");
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("Alt+Enter");
  await expect(guide.locator(".is-documentation-target")).toHaveCount(1);
  expect(await guide.evaluate(node => {
    const cm = node.CodeMirror;
    const line = cm.getValue().split("\n").indexOf("## Section 12");
    return cm.getLineHandle(line).bgClass;
  })).toContain("is-documentation-target");
  expect(await guide.evaluate(node => node.CodeMirror.getScrollInfo().top)).toBeGreaterThan(100);
  expect(await guide.evaluate(node => node.CodeMirror.getOption("readOnly"))).toBe(false);
  await expect.poll(() => guide.evaluate(node => node.CodeMirror.getValue())).toContain("Saved directly in the guide.");
  await page.screenshot({ path: testInfo.outputPath("direct-guide-edit.png") });
});
