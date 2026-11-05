"use strict";

const { test, expect } = require("playwright/test");

test("page curves retain their geometry throughout header height changes", async ({ page }) => {
  await page.goto("/avr", { waitUntil: "load" });
  await page.waitForFunction(() => document.querySelectorAll(".panel-action-contour").length === 3);
  const transitions = await page.evaluate(async () => {
    const section = document.getElementById("avrDeviceSection");
    const handle = document.getElementById("devicePanelToggle");
    const result = [];
    for (const key of ["ArrowUp", "Home", "End", "ArrowUp", "End"]) {
      handle.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
      const frames = [];
      await new Promise(resolve => {
        let settled = 0;
        const sample = () => {
          const active = section.classList.contains("is-device-panel-transitioning");
          frames.push({ active, contours: [...document.querySelectorAll(".panel-action-contour")].map(svg => {
            const transform = svg.getScreenCTM();
            const path = svg.querySelector(".panel-action-outline").getAttribute("d");
            const curveTop = path.match(/V([-\d.]+) C/)?.[1];
            return { scaleY: transform.d, curveTop: curveTop ? Number(curveTop) : null,
              height: svg.getBoundingClientRect().height };
          }) });
          settled = active ? 0 : settled + 1;
          if (settled === 3) resolve();
          else requestAnimationFrame(sample);
        };
        // The contour updater is already queued by the state change. Sample
        // after it, so these rectangles describe the frame that will paint.
        requestAnimationFrame(sample);
      });
      result.push(frames);
    }
    return result;
  });
  for (const frames of transitions) {
    expect(frames.filter(frame => frame.active).length).toBeGreaterThanOrEqual(8);
    expect(new Set(frames.map(frame => frame.contours[0].height.toFixed(2))).size).toBeGreaterThan(8);
    const reference = frames.at(-1).contours;
    for (const frame of frames) for (const [index, contour] of frame.contours.entries()) {
      expect(contour.scaleY, "the SVG must not stretch an old viewBox during the transition").toBeCloseTo(1, 3);
      if (contour.curveTop !== null) {
        expect(contour.curveTop, "the bend must retain its position relative to the controls").toBeCloseTo(reference[index].curveTop, 2);
      }
    }
  }
});

test("reduced motion changes the device panel without leftover control animations", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/avr", { waitUntil: "load" });
  await page.waitForFunction(() => window.UartDebugAvrAiWorkspace);
  await page.locator("#devicePanelToggle").focus();
  for (const [key, state, height] of [["ArrowUp", "compact", 54], ["Home", "collapsed", 0], ["End", "expanded", 112]]) {
    await page.keyboard.press(key);
    await expect(page.locator("#avrDeviceSection")).toHaveAttribute("data-state", state);
    await expect(page.locator("#avrDevicePanelViewport")).toHaveJSProperty("clientHeight", height);
    await expect(page.locator("#avrDeviceSection")).not.toHaveClass(/is-device-panel-transitioning/);
    expect(await page.evaluate(() => document.getElementById("avrDeviceSection").getAnimations({ subtree: true })
      .filter(animation => animation.effect?.getKeyframes().some(frame => frame.transform || frame.width || frame.height)).length))
      .toBe(0);
  }
});

for (const width of [1024, 1543]) {
  test(`device controls move without mode-switch jumps while held at ${width}px`, async ({ page }) => {
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await page.setViewportSize({ width, height: 884 });
    await page.goto("/avr", { waitUntil: "load" });
    await page.waitForFunction(() => window.UartDebugAvrAiWorkspace && document.querySelectorAll("#mcuSelect option").length > 1);
    await page.evaluate(() => document.fonts.ready);
    await page.selectOption("#mcuSelect", { label: "ATtiny1624" });
    await page.selectOption("#projectPackageSelect", { label: "SOIC-14" });
    // The budget has an additional row-to-column layout change after sign-in.
    // Use existing elements without an account or external service request.
    await page.evaluate(() => {
      document.getElementById("projectAiBudget").hidden = false;
      document.getElementById("projectAiBudgetValue").textContent = "Unlimited";
      document.querySelector(".project-ai-account-trigger-label").textContent = "Example account";
    });
    for (const [target, action] of [["compact", -1], ["expanded", 1], ["compact", -1], ["collapsed", -1], ["compact", 1],
      ["expanded", "End"], ["collapsed", "Home"], ["expanded", "End"]]) {
      await page.evaluate(() => {
        window.__deviceMotionFrames = [];
        window.__recordDeviceMotion = true;
        const started = performance.now();
        window.__deviceMotionObserver?.disconnect();
        const sample = (scheduleNext = true) => {
          const section = document.getElementById("avrDeviceSection");
          const viewport = document.getElementById("avrDevicePanelViewport");
          const controls = [...section.querySelectorAll(
            ".detect-chip-btn, .hardware-port, .hardware-flow .custom-select-trigger, .hardware-flow-light, #filesOpenBtn, #notificationsBtn, " +
            ".project-ai-auth > :not(button), .project-ai-budget > *"
          )];
          window.__deviceMotionFrames.push({
            time: performance.now() - started,
            state: section.dataset.state,
            active: section.classList.contains("is-device-panel-transitioning"),
            height: viewport.getBoundingClientRect().height,
            opacity: Number(getComputedStyle(viewport).opacity),
            controls: controls.map(element => {
              const bounds = element.getBoundingClientRect();
              const style = getComputedStyle(element);
              const key = element.classList.contains("custom-select-trigger") ? element.closest(".custom-select").previousElementSibling.id
                : element.classList.contains("hardware-port") ? "port-box" : element.id;
              return { key, rect: [bounds.x, bounds.y, bounds.width, bounds.height], opacity: Number(style.opacity), font: style.fontSize, transform: style.transform };
            }),
          });
          if (scheduleNext && window.__recordDeviceMotion) requestAnimationFrame(() => sample());
        };
        window.__deviceMotionObserver = new MutationObserver(() => sample(false));
        window.__deviceMotionObserver.observe(document.getElementById("avrDeviceSection"), { attributes: true, attributeFilter: ["class", "data-state"] });
        sample();
      });
      const handle = await page.locator("#devicePanelToggle").boundingBox();
      const x = handle.x + handle.width / 2, y = handle.y + handle.height / 2;
      if (typeof action === "number") {
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.move(x, y + action * 52, { steps: 8 });
      } else {
        await page.locator("#devicePanelToggle").focus();
        await page.keyboard.press(action);
      }
      await expect(page.locator("#avrDeviceSection")).toHaveAttribute("data-state", target);
      await expect(page.locator("#avrDeviceSection")).not.toHaveClass(/is-device-panel-transitioning/);
      // Keep holding after the snap so the first settled frames are recorded.
      await page.waitForTimeout(100);
      if (typeof action === "number") await page.mouse.up();
      const frames = await page.evaluate(() => {
        window.__recordDeviceMotion = false;
        window.__deviceMotionObserver.disconnect();
        return window.__deviceMotionFrames;
      });
      const first = frames.findIndex(frame => frame.active);
      const settledIndex = frames.findIndex((frame, index) => index > first && !frame.active);
      const active = frames.filter(frame => frame.active);
      expect(first).toBeGreaterThan(0);
      expect(active.length, "held dragging must keep the viewport animation active").toBeGreaterThanOrEqual(8);
      expect(new Set(active.map(frame => frame.height.toFixed(2))).size).toBeGreaterThanOrEqual(8);
      expect(settledIndex).toBeGreaterThan(first);
      for (const frame of active.filter(frame => frame.opacity > 0.1)) {
        const light = frame.controls.find(control => control.key === "hardwareFlowLight");
        const firstField = frame.controls.find(control => control.key === "detectChipBtn");
        const lastField = frame.controls.find(control => control.key === "projectPackageSelect");
        const port = frame.controls.find(control => control.key === "port-box");
        expect(Math.abs(light.rect[0] - firstField.rect[0]), `light left edge detached during ${target}`).toBeLessThan(1);
        expect(Math.abs(light.rect[0] + light.rect[2] - lastField.rect[0] - lastField.rect[2]),
          `light right edge detached during ${target}`).toBeLessThan(1);
        for (const coordinate of [1, 3]) {
          expect(Math.abs(light.rect[coordinate] - port.rect[coordinate]),
            `light height or position detached during ${target}`).toBeLessThan(1);
        }
        for (const pair of [["detectChipBtn", "port-box"], ["port-box", "mcuSelect"], ["mcuSelect", "projectPackageSelect"],
          ["projectPackageSelect", "filesOpenBtn"],
          ["filesOpenBtn", "notificationsBtn"]]) {
          const [a, b] = pair.map(key => frame.controls.find(control => control.key === key));
          if (!a || !b || a.opacity <= 0.05 || b.opacity <= 0.05) continue;
          const width = Math.min(a.rect[0] + a.rect[2], b.rect[0] + b.rect[2]) - Math.max(a.rect[0], b.rect[0]);
          const height = Math.min(a.rect[1] + a.rect[3], b.rect[1] + b.rect[3]) - Math.max(a.rect[1], b.rect[1]);
          expect(width > 1 && height > 1, `${pair.join(" / ")} overlap during ${target}`).toBe(false);
        }
      }
      const before = frames[first - 1], start = frames[first];
      const lastActive = frames[settledIndex - 1], settled = frames[settledIndex];
      for (const [index, control] of settled.controls.entries()) {
        if (!control.rect[2] || !control.rect[3]) continue;
        for (const [oldFrame, newFrame, boundary] of [[before, start, "start"], [lastActive, settled, "finish"]]) {
          if (boundary === "start" && before.height < 1 || boundary === "finish" && settled.height < 1) continue;
          // The first active frame precedes movement; the finish is already at
          // its final rectangle. Neither boundary may teleport a control.
          for (const coordinate of [0, 1, 2, 3]) {
            expect(Math.abs(newFrame.controls[index].rect[coordinate] - oldFrame.controls[index].rect[coordinate]),
              `control ${index} coordinate ${coordinate} jumped at ${boundary} of ${target}`)
              .toBeLessThan(2);
          }
        }
        for (const frame of active) {
          expect(frame.controls[index].font, "control glyphs must not be scaled to animate their boxes").toBe(control.font);
          const matrix = frame.controls[index].transform.match(/^matrix\(([^)]+)\)$/)?.[1].split(",").map(Number);
          if (matrix) {
            expect(matrix[0]).toBeCloseTo(1, 4);
            expect(matrix[3]).toBeCloseTo(1, 4);
          }
        }
      }
      expect(await page.evaluate(() => document.getElementById("avrDeviceSection").getAnimations({ subtree: true })
        .filter(animation => animation.effect?.getKeyframes().some(frame => frame.transform || frame.width || frame.height)).length))
        .toBe(0);
    }
    expect(errors).toEqual([]);
  });
}

test("rapid device-panel reversals start from the current visible frame", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 884 });
  await page.goto("/avr", { waitUntil: "load" });
  await page.waitForFunction(() => window.UartDebugAvrAiWorkspace && document.querySelectorAll("#mcuSelect option").length > 1);
  await page.selectOption("#mcuSelect", "attiny1624");
  await page.selectOption("#projectPackageSelect", "TSSOP-14");
  await page.evaluate(() => {
    const section = document.getElementById("avrDeviceSection");
    const read = () => [...section.querySelectorAll("#detectChipBtn, .hardware-port, #mcuSelect + .custom-select, #projectPackageSelect + .custom-select, .hardware-flow-light")]
      .map(element => { const box = element.getBoundingClientRect(); return [box.x, box.y, box.width, box.height]; });
    window.__deviceReversalBoundaries = [];
    let pending = null;
    document.getElementById("devicePanelToggle").addEventListener("keydown", () => {
      pending = { before: read(), height: document.getElementById("avrDevicePanelViewport").getBoundingClientRect().height };
    }, { capture: true });
    new MutationObserver(records => {
      if (!pending || !records.some(record => record.attributeName === "data-state")) return;
      window.__deviceReversalBoundaries.push({ ...pending, after: read() });
      pending = null;
    }).observe(section, { attributes: true, attributeFilter: ["data-state"] });
  });
  await page.locator("#devicePanelToggle").focus();
  for (const [key, hold] of [["ArrowUp", 70], ["End", 220], ["ArrowUp", 70], ["End", 220], ["Home", 70], ["End", 0]]) {
    await page.keyboard.press(key);
    if (hold) await page.waitForTimeout(hold);
  }
  await expect(page.locator("#avrDeviceSection")).toHaveAttribute("data-state", "expanded");
  await expect(page.locator("#avrDeviceSection")).not.toHaveClass(/is-device-panel-transitioning/);
  const boundaries = await page.evaluate(() => window.__deviceReversalBoundaries);
  expect(boundaries).toHaveLength(6);
  for (const boundary of boundaries.filter(boundary => boundary.height > 1)) {
    for (const [index, before] of boundary.before.entries()) for (let coordinate = 0; coordinate < 4; coordinate += 1) {
      expect(Math.abs(before[coordinate] - boundary.after[index][coordinate]), `reversal moved control ${index} coordinate ${coordinate} before animation`)
        .toBeLessThan(2);
    }
  }
  await expect(page.locator("#mcuSelect + .custom-select .custom-select-value")).toHaveText("ATtiny1624");
  await expect(page.locator("#projectPackageSelect + .custom-select .custom-select-value")).toHaveText("TSSOP-14");
  expect(await page.evaluate(() => document.getElementById("avrDeviceSection").getAnimations({ subtree: true })
    .filter(animation => animation.effect?.getKeyframes().some(frame => frame.transform || frame.width || frame.height)).length)).toBe(0);
});
