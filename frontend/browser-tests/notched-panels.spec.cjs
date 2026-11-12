"use strict";

const { test, expect } = require("playwright/test");

for (const width of [1543, 1024]) {
  test(`smooth capsules stay clear and usable in expanded and compact panes at ${width}px`, async ({ page }, testInfo) => {
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await page.setViewportSize({ width, height: 884 });
    await page.goto("/avr", { waitUntil: "load" });
    await expect(page).toHaveTitle("AVR Programming - Uart Debug");
    await page.waitForFunction(() => window.UartDebugAvrAiWorkspace);
    await page.evaluate(async () => {
      const { project } = await (await fetch("/api/avr/ai/projects/motion-example")).json();
      await window.UartDebugAvrMiniProjects.install(project);
      await document.fonts.ready;
      for (const record of window.UartDebugNotifications.getAll()) window.UartDebugNotifications.dismiss(record.id);
    });
    await expect(page.locator("#fileList")).toContainText("Motion example");

    // Read the actual fractional pseudo-element boxes; the integer model.width
    // and computed-style estimates lose the half-pixel contour coordinates.
    const client = await page.context().newCDPSession(page);
    await client.send("DOM.enable");
    const { root } = await client.send("DOM.getDocument", { depth: -1, pierce: true });
    const captionIds = [];
    for (const selector of [".project-instruction-panel", "#editorWorkspace", "#projectDocumentationPane"]) {
      const { nodeId } = await client.send("DOM.querySelector", { nodeId: root.nodeId, selector });
      const { node } = await client.send("DOM.describeNode", { nodeId, depth: -1, pierce: true });
      captionIds.push(node.pseudoElements.find(pseudo => pseudo.pseudoType === "after").backendNodeId);
    }

    const readGeometry = async () => {
      const captions = [];
      for (const backendNodeId of captionIds) {
        const { model } = await client.send("DOM.getBoxModel", { backendNodeId });
        const xs = model.content.filter((_, index) => index % 2 === 0);
        const ys = model.content.filter((_, index) => index % 2 === 1);
        captions.push({ x: xs.reduce((sum, value) => sum + value, 0) / 4,
          y: ys.reduce((sum, value) => sum + value, 0) / 4,
          size: [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)] });
      }
      return page.evaluate(captions => {
      const panes = [...document.querySelectorAll(
        ".project-chat-panel, .project-instruction-panel, #editorWorkspace, #projectDocumentationPane")];
      const rect = element => element.getBoundingClientRect();
      const outline = pane => pane.querySelector(":scope > [data-panel-action-contour] .panel-action-outline");
      const fill = pane => pane.querySelector(":scope > [data-panel-action-contour] .panel-action-fill");
      const world = (pane, x, y) => new DOMPoint(x, y).matrixTransform(
        pane.querySelector(":scope > [data-panel-action-contour]").getScreenCTM());
      const frames = panes.map((pane, index) => pane.querySelector([
        ".project-chat-surface", ".project-instruction-live-editor", ".editor-container", "#projectDocumentationScroll",
      ][index]));
      const visibleFrame = pane => {
        const element = frames[panes.indexOf(pane)];
        return element.getClientRects().length ? rect(element) : null;
      };
      // Find the painted silhouette at the element's real Y coordinate rather
      // than duplicating the CSS rail/inset formula being tested.
      const boundary = (pane, insideX, outsideX, y) => {
        const matrix = pane.querySelector(":scope > [data-panel-action-contour]").getScreenCTM().inverse();
        const contains = x => fill(pane).isPointInFill(new DOMPoint(x, y).matrixTransform(matrix));
        if (!contains(insideX) || contains(outsideX)) return NaN;
        for (let step = 0; step < 24; step++) {
          const middle = (insideX + outsideX) / 2;
          if (contains(middle)) insideX = middle;
          else outsideX = middle;
        }
        return (insideX + outsideX) / 2;
      };
      const paintedWidth = (pane, y) => {
        const svg = pane.querySelector(":scope > [data-panel-action-contour]");
        const bounds = rect(svg), matrix = svg.getScreenCTM().inverse();
        // Locate an actual filled point at this height, including a narrow
        // upper rail whose rectangular pane midpoint can fall in its cutout.
        let inside = NaN;
        for (let x = bounds.left; x <= bounds.right; x += 1) {
          if (fill(pane).isPointInFill(new DOMPoint(x, y).matrixTransform(matrix))) {
            inside = x + 0.25;
            break;
          }
        }
        return boundary(pane, inside, bounds.right + 1, y) -
          boundary(pane, inside, bounds.left - 1, y);
      };
      const edge = (pane, side, top, bottom) => {
        const path = outline(pane), points = [];
        for (let length = 0, total = path.getTotalLength(); length <= total; length += 0.75) {
          const point = path.getPointAtLength(length);
          if (point.y < top || point.y > bottom) continue;
          if (side === "right" ? point.x < rect(pane).width - 1 : point.x > 35) continue;
          points.push(world(pane, point.x, point.y));
        }
        return points;
      };
      const joints = panes.slice(1).map((pane, index) => {
        const previous = panes[index];
        const previousRect = rect(previous), bounds = rect(pane);
        const actionsBottom = rect(previous.querySelector(":scope > .panel-action-lobe")).bottom - previousRect.top;
        const leftEdge = edge(previous, "right", actionsBottom - 10, actionsBottom + 100);
        const rightEdge = edge(pane, "left", actionsBottom - 10, actionsBottom + 100);
        let clearance = Infinity;
        for (const left of leftEdge) for (const right of rightEdge) {
          clearance = Math.min(clearance, Math.hypot(right.x - left.x, right.y - left.y));
        }
        const notchBottom = parseFloat(getComputedStyle(pane).getPropertyValue("--panel-left-notch-bottom"));
        return { clearance, boxGap: bounds.left - previousRect.right,
          topNotchEmpty: !fill(pane).isPointInFill(new DOMPoint(5, actionsBottom - 15)),
          lowerRailFilled: fill(pane).isPointInFill(new DOMPoint(5, notchBottom + 15)),
          caption: getComputedStyle(pane, "::after").content,
          writingMode: getComputedStyle(pane, "::after").writingMode };
      });
      const actionButtons = [...document.querySelectorAll(".panel-action-lobe button")].filter(button => button.getClientRects().length);
      const buttons = actionButtons.map(button => {
        const pane = button.closest(".panel-action-host");
        const bounds = rect(button), host = rect(pane);
        const matrix = pane.querySelector(":scope > [data-panel-action-contour]").getScreenCTM().inverse();
        const samples = [6, bounds.height / 2, bounds.height - 6].map(offset => {
          const point = new DOMPoint(bounds.x + bounds.width / 2, bounds.y + offset);
          const local = point.matrixTransform(matrix);
          const hit = document.elementFromPoint(point.x, point.y);
          return fill(pane).isPointInFill(local) && (hit === button || button.contains(hit));
        });
        return { id: button.id, width: bounds.width, height: bounds.height, right: host.right - bounds.right,
          top: bounds.y - host.y, font: getComputedStyle(button).fontSize,
          unblocked: samples.every(Boolean) };
      });
      const buttonBands = actionButtons.map(button => {
        const pane = button.closest(".panel-action-host"), bounds = rect(button), host = rect(pane);
        const centerX = bounds.x + bounds.width / 2, centerY = bounds.y + bounds.height / 2;
        const outer = boundary(pane, centerX,
          rect(pane.querySelector(":scope > [data-panel-action-contour]")).right + 1, centerY);
        const frame = visibleFrame(pane);
        return { id: button.id, centerInset: centerX - host.right,
          gapDifference: frame ? (bounds.left - frame.right) - (outer - bounds.right) : null };
      });
      const captionBands = panes.slice(1).map((pane, index) => {
        const bounds = rect(pane), caption = captions[index], frame = visibleFrame(pane);
        const outer = boundary(pane, bounds.x + bounds.width / 2,
          rect(pane.querySelector(":scope > [data-panel-action-contour]")).left - 1, caption.y);
        return { centerInset: caption.x - bounds.left, size: caption.size,
          centerError: frame ? caption.x - (outer + frame.left) / 2 : null };
      });
      return { joints, buttons, contours: panes.map(pane => pane.querySelectorAll(":scope > [data-panel-action-contour]").length),
        buttonBands, captionBands,
        bodyBands: [panes[1], panes[3]].map(pane => ({
          upper: paintedWidth(pane, rect(pane).top + 40),
          lower: paintedWidth(pane, rect(pane).bottom - 60),
        })),
        outlines: panes.map(pane => ({
          subpaths: (outline(pane).getAttribute("d").match(/M/g) || []).length,
          largestTurn: (() => {
            const path = outline(pane);
            let previous = path.getPointAtLength(0), angle = null, largest = 0;
            for (let length = 0.5, total = path.getTotalLength(); length <= total; length += 0.5) {
              const point = path.getPointAtLength(length);
              const nextAngle = Math.atan2(point.y - previous.y, point.x - previous.x);
              if (angle !== null) {
                const difference = nextAngle - angle;
                largest = Math.max(largest, Math.abs(Math.atan2(Math.sin(difference), Math.cos(difference))));
              }
              previous = point;
              angle = nextAngle;
            }
            return largest;
          })(),
        })),
        overflow: document.documentElement.scrollWidth > innerWidth };
      }, captions);
    };

    const reference = await readGeometry();
    const assertGeometry = geometry => {
      expect(geometry.contours).toEqual([1, 1, 1, 1]);
      expect(geometry.overflow).toBe(false);
      for (const path of geometry.outlines) {
        expect(path.subpaths, "a finished capsule must not contain wireframe construction dividers").toBe(1);
        expect(path.largestTurn, "the capsule and matching cutout must have a visible rounded bend").toBeLessThan(0.25);
      }
      for (const [index, joint] of geometry.joints.entries()) {
        expect(joint.boxGap).toBeCloseTo(14, 1);
        expect(joint.topNotchEmpty, "the next page must leave space around the preceding capsule").toBe(true);
        expect(joint.lowerRailFilled, "the left rail is part of the following page below its notch").toBe(true);
        expect(joint.caption).toBe(['"Specification"', '"Code"', '"Description"'][index]);
        expect(joint.writingMode).toBe("vertical-rl");
        expect(joint.clearance, "curves must not pinch the gap or touch their neighbor").toBeGreaterThanOrEqual(12);
        expect(joint.clearance).toBeLessThan(18);
      }
      expect(geometry.buttons).toHaveLength(reference.buttons.length);
      for (const [index, button] of geometry.buttons.entries()) {
        expect(button, "capsules must keep their actual button geometry after collapse").toEqual(reference.buttons[index]);
        expect(button.unblocked, "a transparent neighboring notch must not intercept capsule clicks").toBe(true);
      }
      for (const [index, band] of geometry.buttonBands.entries()) {
        if (band.gapDifference !== null) {
          expect(Math.abs(band.gapDifference), `${band.id} must have equal gaps to its inner frame and painted outer contour`).toBeLessThan(1);
        } else {
          expect(Math.abs(band.centerInset - reference.buttonBands[index].centerInset),
            `${band.id} must retain its validated position while its inner frame is hidden`).toBeLessThan(0.1);
        }
      }
      for (const [index, band] of geometry.captionBands.entries()) {
        if (band.centerError !== null) {
          expect(Math.abs(band.centerError), "the caption must be centered between its painted outer contour and inner frame").toBeLessThan(1);
        } else {
          expect(Math.abs(band.centerInset - reference.captionBands[index].centerInset),
            "a compact caption must retain its validated center without measuring a hidden frame").toBeLessThan(0.1);
        }
        expect(band.size, "compact captions must keep their actual fractional box size").toEqual(reference.captionBands[index].size);
      }
    };
    assertGeometry(reference);
    await page.locator("#fileListResizer").focus();
    await page.keyboard.press("End");
    await expect(page.locator(".canvas-split-container")).not.toHaveClass(/is-workspace-transitioning/);
    await expect(page.locator(".project-instruction-panel")).toHaveJSProperty("clientWidth", 60);
    assertGeometry(await readGeometry());
    await page.locator("#documentationResizer").focus();
    await page.keyboard.press("Home");
    await expect(page.locator(".canvas-split-container")).not.toHaveClass(/is-workspace-transitioning/);
    await expect(page.locator("#editorWorkspace")).toHaveJSProperty("clientWidth", 60);
    assertGeometry(await readGeometry());
    await page.screenshot({ path: testInfo.outputPath("compact-smooth-capsules.png") });
    await page.keyboard.press("End");
    await expect(page.locator(".canvas-split-container")).not.toHaveClass(/is-workspace-transitioning/);
    await expect(page.locator("#projectDocumentationPane")).toHaveJSProperty("clientWidth", 60);
    await expect(page.locator(".project-instruction-panel")).toHaveJSProperty("clientWidth", 60);
    const compactEnds = await readGeometry();
    assertGeometry(compactEnds);
    const [canvas, documentation] = compactEnds.bodyBands;
    expect(canvas.lower, "closed specification and description bodies must have equal painted widths")
      .toBeCloseTo(documentation.lower, 1);
    expect(canvas.upper, "the specification's incoming and outgoing rails must balance")
      .toBeCloseTo(canvas.lower, 1);
    await page.screenshot({ path: testInfo.outputPath("equal-compact-rails.png") });
    expect(errors).toEqual([]);
  });
}
