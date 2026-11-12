"use strict";

const { test, expect } = require("playwright/test");

// Exercise the production UPDI protocol and target controls. The mock replaces
// only the adapter; application state is changed through its normal UI.
async function installSerialAdapter(page) {
  await page.addInitScript(() => {
    const serial = new EventTarget();
    const mock = { opened: 0, closed: 0, deviceId: 0x1e942a };
    let pointer = 0;
    let repeat = 1;
    let queue = [];
    let pendingRead = null;
    const push = (bytes) => {
      const result = { done: false, value: Uint8Array.from(bytes) };
      if (pendingRead) {
        const resolve = pendingRead;
        pendingRead = null;
        resolve(result);
      } else queue.push(result);
    };
    const memoryByte = (address) => address >= 0x1100 && address <= 0x1102
      ? (mock.deviceId >> ((0x1102 - address) * 8)) & 0xff
      : address === 0x0f01 ? 0x10 : 0;
    const port = {
      // An unlisted product keeps the complete adapter ID in the readout.
      getInfo: () => ({ usbVendorId: 0x0403, usbProductId: 0x6015 }),
      open: async () => { mock.opened += 1; queue = []; repeat = 1; },
      close: async () => { mock.closed += 1; },
      readable: { getReader: () => ({
        read: () => queue.length ? Promise.resolve(queue.shift()) : new Promise(resolve => { pendingRead = resolve; }),
        cancel: async () => { if (pendingRead) { pendingRead({ done: true }); pendingRead = null; } },
        releaseLock() {},
      }) },
      writable: { getWriter: () => ({
        async write(bytes) {
          const payload = [...bytes];
          const response = [];
          const command = payload[0] === 0x55 ? payload[1] : null;
          if (command === 0x69) {
            pointer = payload[2] | (payload[3] << 8);
            response.push(0x40);
          } else if (command === 0xa0) {
            repeat = payload[2] + 1;
          } else if (command === 0x24) {
            for (let index = 0; index < repeat; index += 1) response.push(memoryByte(pointer++));
            repeat = 1;
          } else if (command === 0xe6) {
            response.push(...new TextEncoder().encode("tinyAVR N:0O:0 32MHz"));
          } else if (command !== null && (command & 0xf0) === 0x80) {
            response.push((command & 0x0f) === 0x0b ? 0x08 : 0x10);
          } else if (command === 0x64 || command === 0x65) {
            throw new Error("A detection test must never write target memory");
          }
          push([...payload, ...response]);
        },
        releaseLock() {},
      }) },
    };
    serial.requestPort = async () => port;
    serial.getPorts = async () => [port];
    mock.disconnect = () => {
      const event = new Event("disconnect");
      Object.defineProperty(event, "port", { value: port });
      serial.dispatchEvent(event);
    };
    Object.defineProperty(navigator, "serial", { configurable: true, value: serial });
    window.__targetSerialAdapter = mock;
  });
}

test.beforeEach(async ({ page }) => {
  page.__targetErrors = [];
  page.on("pageerror", error => page.__targetErrors.push(error.message));
  page.on("console", message => { if (message.type() === "error") page.__targetErrors.push(message.text()); });
  await installSerialAdapter(page);
});

test.afterEach(async ({ page }) => { expect(page.__targetErrors).toEqual([]); });

async function open(page) {
  await page.goto("/avr", { waitUntil: "load" });
  await expect(page).toHaveTitle("AVR Programming - Uart Debug");
  await page.waitForFunction(() => window.__UARTDEBUG_AVR_PROGRAMMING_UPDI__
    && window.UartDebugAvrAiWorkspace && document.querySelectorAll("#mcuSelect option").length > 1);
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator("#mcuSelect")).toHaveValue("auto");
  await expect(page.locator('#mcuSelect option[value="auto"]')).toHaveText("Auto detect");
}

async function choose(page, id, value) {
  const custom = page.locator(`#${id} + .custom-select`);
  await custom.locator(".custom-select-trigger").click();
  await custom.locator(`.custom-select-option[data-value="${value}"]`).click();
  await expect(page.locator(`#${id}`)).toHaveValue(value);
}

async function detect(page, mcu = "attiny1624") {
  await page.locator("#detectChipBtn").click();
  await expect(page.locator("#avrDevicePanelViewport")).toHaveAttribute("data-state", "detected");
  await expect(page.locator("#mcuSelect")).toHaveValue(mcu);
  await expect(page.locator("#detectChipBtn")).toBeEnabled();
  await expect(page.locator("#detectChipBtn [data-detect-default]")).toHaveText("Connected");
  // Most detection cases inspect the ordinary readouts. Hover itself has
  // dedicated checks below, including keeping the wave active after success.
  await page.mouse.move(10, 870);
}

async function expectDetectedTarget(page, mcu = "attiny1624", label = "ATtiny1624") {
  await expect(page.locator("#mcuSelect")).toHaveValue(mcu);
  await expect(page.locator("#mcuSelect")).toHaveAttribute("data-connection-state", "ready");
  await expect(page.locator("#mcuSelect + .custom-select .custom-select-value")).toHaveText(label);
  const trigger = page.locator("#mcuSelect + .custom-select .custom-select-trigger");
  await expect(trigger).toHaveAccessibleName(`Target MCU: ${label}`);
  await expect(trigger).toHaveAttribute("data-tooltip", `Target MCU: ${label}`);
  await expect(trigger.locator(".custom-select-status")).toHaveText("");
  await expect(page.locator("#chipStatusText, .hardware-step-detail")).toHaveCount(0);
}

async function installPackageCatalog(page) {
  await page.route("**/api/avr/ai/status", route => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ ok: true, enabled: false, configured: false, ready: false,
      knowledge: { devices: [
        { mcu: "ATtiny1624", packages: ["SOIC-14", "TSSOP-14"] },
        { mcu: "ATtiny1614", packages: ["SOIC-14"] },
      ] } }),
  }));
}

test("Detect makes the real chip primary and preserves its package on recheck", async ({ page }, testInfo) => {
  await open(page);
  await expect(page.locator("#detectChipBtn [data-detect-default]")).toHaveText("Disconnected");
  await detect(page);
  await expectDetectedTarget(page);
  await expect(page.locator('#mcuSelect option[value="attiny1614"]')).toBeDisabled();
  await expect(page.locator('#mcuSelect option[value="attiny1624"]')).toBeEnabled();
  await expect(page.locator("#projectPackageSelect")).toBeEnabled();
  await choose(page, "projectPackageSelect", "SOIC-14");
  await detect(page);
  await expectDetectedTarget(page);
  await expect(page.locator("#projectPackageSelect")).toHaveValue("SOIC-14");
  expect(await page.evaluate(() => window.__targetSerialAdapter.opened)).toBe(2);
  expect(await page.evaluate(() => window.__targetSerialAdapter.closed)).toBe(2);
  await page.screenshot({ path: testInfo.outputPath("target-detected-primary.png") });
});

test("the connected chip overrides manual choice and retains only packages available on its replacement", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1024, height: 884 });
  await installPackageCatalog(page);
  await open(page);
  await choose(page, "mcuSelect", "attiny1614");
  await choose(page, "projectPackageSelect", "SOIC-14");
  await expect(page.locator("#projectPackageSelect")).toBeEnabled();
  await detect(page);
  await expectDetectedTarget(page);
  await expect(page.locator("#projectPackageSelect")).toHaveValue("SOIC-14");
  await page.evaluate(() => {
    const select = document.getElementById("mcuSelect");
    select.value = "attiny1614";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await expectDetectedTarget(page);
  await expect(page.locator("#projectPackageSelect")).toHaveValue("SOIC-14");
  await choose(page, "projectPackageSelect", "TSSOP-14");
  await page.evaluate(() => { window.__targetSerialAdapter.deviceId = 0x1e9422; });
  await detect(page, "attiny1614");
  await expectDetectedTarget(page, "attiny1614", "ATtiny1614");
  await expect(page.locator("#projectPackageSelect")).toHaveValue("");
  await choose(page, "projectPackageSelect", "SOIC-14");
  await page.evaluate(() => { window.__targetSerialAdapter.deviceId = 0x1e942a; });
  await detect(page);
  await expect(page.locator("#projectPackageSelect")).toHaveValue("SOIC-14");
  await page.screenshot({ path: testInfo.outputPath("target-replacement-package.png") });
});

test("the Chip field shows waiting state inside while the port picker is pending", async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    const request = navigator.serial.requestPort;
    navigator.serial.requestPort = () => new Promise(resolve => {
      window.__resumeTargetProbe = () => resolve(request());
    });
  });
  await page.locator("#detectChipBtn").click();
  await expect(page.locator("#avrDevicePanelViewport")).toHaveAttribute("data-state", "detecting");
  await expect(page.locator("#mcuSelect")).toHaveAttribute("data-connection-state", "busy");
  await expect(page.locator("#mcuSelect + .custom-select .custom-select-status")).toContainText(/Working|Reading|Detect/i);
  await expect(page.locator("#detectChipBtn [data-detect-default]")).toHaveText(/Reading|Working|Select/i);
  await page.evaluate(() => window.__resumeTargetProbe());
  await expectDetectedTarget(page);
});

test("an adapter disconnect unlocks offline selection without erasing the project chip and package", async ({ page }) => {
  await open(page);
  await detect(page);
  await choose(page, "projectPackageSelect", "SOIC-14");
  await page.evaluate(() => window.__targetSerialAdapter.disconnect());
  await expect(page.locator("#mcuSelect")).toHaveValue("attiny1624");
  await expect(page.locator("#projectPackageSelect")).toHaveValue("SOIC-14");
  await expect(page.locator('#mcuSelect option[value="attiny1614"]')).toBeEnabled();
  expect(await page.evaluate(() => window.__UARTDEBUG_AVR_PROGRAMMING_UPDI_BRIDGE__.getDetectedTargetKey())).toBe("");
  await choose(page, "mcuSelect", "attiny1614");
  await expect(page.locator("#mcuSelect")).toHaveValue("attiny1614");
});

test("an unknown signature stays visible inside Chip and never becomes a mapped target", async ({ page }) => {
  await open(page);
  await page.evaluate(() => { window.__targetSerialAdapter.deviceId = 0x123456; });
  await page.locator("#detectChipBtn").click();
  await expect(page.locator("#avrDevicePanelViewport")).toHaveAttribute("data-state", "detected");
  await expect(page.locator("#mcuSelect")).toHaveAttribute("data-control-status", "Unknown chip");
  await expect(page.locator("#mcuSelect")).toHaveAttribute("data-connection-state", "warning");
  await expect(page.locator("#mcuSelect + .custom-select .custom-select-status")).toHaveText("Unknown chip");
  await expect(page.locator("#mcuSelect + .custom-select .custom-select-trigger")).toHaveAttribute("data-tooltip", /Unknown chip/);
  await expect(page.locator("#projectPackageSelect")).toBeDisabled();
  expect(await page.evaluate(() => window.__UARTDEBUG_AVR_PROGRAMMING_UPDI__.getSignatureInfo().deviceId)).toBe(0x123456);
  expect(await page.evaluate(() => window.__UARTDEBUG_AVR_PROGRAMMING_UPDI_BRIDGE__.getDetectedTargetKey())).toBe("");
});

async function readHardwareFlowGeometry(page) {
  await page.mouse.move(10, 870);
  await page.locator("#detectChipBtn").evaluate(async button => {
    const animations = button.getAnimations().filter(animation =>
      Number.isFinite(animation.effect?.getComputedTiming().endTime));
    await Promise.all(animations.map(animation => animation.finished.catch(() => {})));
  });
  return page.evaluate(() => {
    const rect = selector => {
      const element = document.querySelector(selector);
      const box = element.getBoundingClientRect();
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height };
    };
    return { row: rect(".avr-overview-row"), workspace: rect("#projectWorkspaceStage"),
      hardware: rect("#avrDevicePanelViewport"), panel: rect("#avrTargetPanelViewport"),
      actions: rect("#avrActionsPanelViewport"), actionGrid: rect("#avrActionsPanelViewport > .avr-action-panel"),
      account: rect("#avrAccountPanelViewport"),
      button: rect("#detectChipBtn"), port: rect(".hardware-step--port > .hardware-field"),
      mcu: rect("#mcuSelect + .custom-select .custom-select-trigger"), package: rect("#projectPackageSelect + .custom-select .custom-select-trigger"),
      projects: rect(".avr-action-card:has(#filesOpenBtn)"), notifications: rect(".avr-action-card:has(#notificationsBtn)"),
      overflow: document.documentElement.scrollWidth > innerWidth };
  });
}

function expectHardwareFlowGeometry(boxes) {
  expect(boxes.row.left).toBeCloseTo(boxes.workspace.left, 1);
  expect(boxes.row.right).toBeCloseTo(boxes.workspace.right, 1);
  expect(boxes.hardware.left).toBeCloseTo(boxes.row.left, 1);
  expect(boxes.account.right).toBeCloseTo(boxes.workspace.right, 1);
  expect(boxes.panel.left).toBeCloseTo(boxes.hardware.left, 1);
  expect(boxes.panel.right).toBeCloseTo(boxes.hardware.right, 1);
  expect(boxes.actions.left - boxes.hardware.right).toBeCloseTo(8, 1);
  expect(boxes.account.left - boxes.actions.right).toBeCloseTo(8, 1);
  expect(boxes.overflow, "hardware state changes must not introduce page overflow").toBe(false);
  const fields = [boxes.button, boxes.port, boxes.mcu, boxes.package];
  for (const [index, field] of fields.entries()) {
    expect(field.width, "all four elements match the original button width").toBeCloseTo(boxes.button.width, 1);
    expect(field.height, "all four elements match the original button height").toBeCloseTo(boxes.button.height, 1);
    expect(field.left).toBeGreaterThanOrEqual(boxes.hardware.left);
    expect(field.right).toBeLessThanOrEqual(boxes.hardware.right);
    expect(field.top).toBeGreaterThanOrEqual(boxes.hardware.top);
    expect(field.bottom).toBeLessThanOrEqual(boxes.hardware.bottom);
    expect(field.top).toBeCloseTo(boxes.button.top, 1);
    if (index) expect(field.left - fields[index - 1].right).toBeGreaterThanOrEqual(8);
  }
  for (const action of [boxes.projects, boxes.notifications]) {
    expect(action.width).toBeCloseTo(boxes.account.width, 1);
    expect(action.height).toBeCloseTo(boxes.actions.height, 1);
    expect(action.left).toBeGreaterThan(boxes.package.right);
    expect(action.left).toBeGreaterThanOrEqual(boxes.actionGrid.left);
    expect(action.right).toBeLessThanOrEqual(boxes.actionGrid.right);
    expect(action.top).toBeCloseTo(boxes.actions.top, 1);
  }
  expect(boxes.notifications.left - boxes.projects.right).toBeCloseTo(8, 1);
}

async function expectNoHeaderTooltip(page, control) {
  await control.hover();
  await expect(control).not.toHaveAttribute("title", /.+/);
  // A scheduled tooltip becomes active before its delayed visible class is applied.
  await expect(page.locator('.ui-tooltip[aria-hidden="false"]')).toHaveCount(0);
}

test("multiline values fit equal compact hardware fields without header tooltips at 1024px", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1024, height: 884 });
  await open(page);
  await expect(page.locator(".avr-overview-row[data-tooltip-disabled]")).toHaveCount(1);
  await detect(page);
  await choose(page, "projectPackageSelect", "TSSOP-14");
  for (const [mode, key] of [["expanded", "End"], ["compact", "ArrowUp"], ["expanded", "End"]]) {
    await page.locator("#devicePanelToggle").focus();
    await page.keyboard.press(key);
    await expect(page.locator("#avrDeviceSection")).toHaveAttribute("data-state", mode);
    await expect(page.locator("#avrDeviceSection")).not.toHaveClass(/is-device-panel-transitioning/);
    await expectDetectedTarget(page);
    expectHardwareFlowGeometry(await readHardwareFlowGeometry(page));
    for (const id of ["mcuSelect", "projectPackageSelect"]) {
      const label = page.locator(`#${id} + .custom-select .custom-select-value`);
      expect(await label.evaluate(element => {
        const range = document.createRange();
        range.selectNodeContents(element);
        const box = element.getBoundingClientRect();
        return { fits: [...range.getClientRects()].every(rect => rect.left >= box.left - 1 && rect.right <= box.right + 1
          && rect.top >= box.top - 1 && rect.bottom <= box.bottom + 1), overflow: getComputedStyle(element).textOverflow };
      })).toEqual({ fits: true, overflow: "clip" });
    }
    await expectNoHeaderTooltip(page, page.locator("#adapterStatusText"));
    await expectNoHeaderTooltip(page, page.locator("#mcuSelect + .custom-select .custom-select-trigger"));
    await expectNoHeaderTooltip(page, page.locator("#projectPackageSelect + .custom-select .custom-select-trigger"));
    const packageTrigger = page.locator("#projectPackageSelect + .custom-select .custom-select-trigger");
    await packageTrigger.click();
    await expect(packageTrigger).toHaveAttribute("aria-expanded", "true");
    await expect.poll(async () => {
      const field = (await readConnectionTextGeometry(page))[2];
      return Math.abs(field.caret.center - field.frame[3] / 2);
    }, { message: "the open package caret stays centered with the selected label" }).toBeLessThan(1);
    await page.keyboard.press("Escape");
    await page.mouse.move(10, 870);
    await page.screenshot({ path: testInfo.outputPath(`compact-target-${mode}-1024.png`) });
  }
});

test("hardware errors keep controls aligned and retain useful stage logs without call stacks", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 900, height: 884 });
  await open(page);
  const diagnostics = [];
  page.on("console", message => { if (message.type() === "info") diagnostics.push(message.text()); });
  const adapterDiagnostic = "The selected USB adapter could not be opened because another application owns the serial port.";
  const chipDiagnostic = "The adapter opened, but the connected chip did not answer the UPDI SIB request; check target power and wiring.";
  await page.evaluate(({ adapterDiagnostic, chipDiagnostic }) => {
    const requestPort = navigator.serial.requestPort.bind(navigator.serial);
    let wrapped = false;
    let failOpen = true;
    navigator.serial.requestPort = async (...options) => {
      const port = await requestPort(...options);
      if (!wrapped) {
        wrapped = true;
        const open = port.open.bind(port);
        port.open = async (...options) => {
          if (failOpen) { failOpen = false; throw new Error(adapterDiagnostic); }
          return open(...options);
        };
        const getWriter = port.writable.getWriter.bind(port.writable);
        port.writable.getWriter = () => {
          const writer = getWriter();
          const write = writer.write.bind(writer);
          writer.write = async bytes => {
            if (bytes[0] === 0x55 && bytes[1] === 0xe6) throw new Error(chipDiagnostic);
            return write(bytes);
          };
          return writer;
        };
      }
      return port;
    };
  }, { adapterDiagnostic, chipDiagnostic });
  const setMode = async (mode, key) => {
    await page.locator("#devicePanelToggle").focus();
    await page.keyboard.press(key);
    await expect(page.locator("#avrDeviceSection")).toHaveAttribute("data-state", mode);
    await expect(page.locator("#avrDeviceSection")).not.toHaveClass(/is-device-panel-transitioning/);
  };
  const expectDiagnostic = async (message, guidance, diagnostic) => {
    const toast = page.locator('.notification-toast[data-tone="error"] .notification-toast-open').filter({ hasText: message });
    await expect(toast).toContainText(message);
    await expect(toast).not.toContainText(diagnostic);
    await toast.click();
    await expect(page.locator("#notificationModal")).toBeVisible();
    await expect(page.locator(".notification-detail-output")).toContainText(guidance);
    await expect(page.locator(".notification-detail-output")).toContainText(diagnostic);
    await expect(page.locator(".notification-detail")).not.toContainText(/https?:\/\/|updi-test\.js|\n\s*at (?:async )?/);
    expect(diagnostics.join("\n")).toContain(diagnostic);
    await page.keyboard.press("Escape");
  };
  await page.locator("#detectChipBtn").click();
  await expect(page.locator("#adapterStatusText")).toHaveText("Adapter error");
  await expectDiagnostic("The serial adapter is unavailable", "Select the correct port", adapterDiagnostic);
  for (const [mode, key] of [["expanded", "End"], ["compact", "ArrowUp"], ["expanded", "End"]]) {
    await setMode(mode, key);
    expectHardwareFlowGeometry(await readHardwareFlowGeometry(page));
    await expectNoHeaderTooltip(page, page.locator("#adapterStatusText"));
    await page.mouse.move(10, 870);
    await page.screenshot({ path: testInfo.outputPath(`compact-adapter-error-${mode}.png`) });
  }
  await page.locator("#detectChipBtn").click();
  await expect(page.locator("#mcuSelect")).toHaveAttribute("data-control-status", "Chip error");
  await expectDiagnostic("The device operation could not be completed", "Check the UPDI wiring", chipDiagnostic);
  for (const [mode, key] of [["compact", "ArrowUp"], ["expanded", "End"]]) {
    await setMode(mode, key);
    expectHardwareFlowGeometry(await readHardwareFlowGeometry(page));
    const trigger = page.locator("#mcuSelect + .custom-select .custom-select-trigger");
    await expect(trigger.locator(".custom-select-status")).toHaveText("Chip error");
    await expect(trigger.locator(".custom-select-status")).toHaveCSS("opacity", "1");
    await expectNoHeaderTooltip(page, trigger);
    await page.mouse.move(10, 870);
    await page.screenshot({ path: testInfo.outputPath(`compact-chip-error-${mode}.png`) });
  }
});

async function finishFiniteHardwareWave(page) {
  await page.locator("#hardwareFlowLight .hardware-flow-beam").evaluate(beam => {
    for (const animation of beam.getAnimations()) {
      if (["running", "paused"].includes(animation.playState)
        && Number.isFinite(animation.effect?.getComputedTiming().endTime)) animation.finish();
    }
  });
  // Finishing an animation dispatches its completion after the current frame.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function expectHardwareWaveIdle(page) {
  await expect(page.locator("#hardwareFlowLight")).toHaveAttribute("data-phase", "idle", { timeout: 7000 });
  expect(await page.locator("#hardwareFlowLight .hardware-flow-beam").evaluate(beam =>
    beam.getAnimations().filter(animation => animation.playState === "running").length)).toBe(0);
}

async function advanceHardwareWaveToReflection(page) {
  await expect(page.locator("#hardwareFlowLight")).toHaveAttribute("data-phase", "approach");
  // A packet already past the fault leaves normally before the next bounded pass.
  for (let step = 0; step < 3; step += 1) {
    await finishFiniteHardwareWave(page);
    if (await page.locator("#hardwareFlowLight").getAttribute("data-phase") === "reflect") return;
  }
  await expect(page.locator("#hardwareFlowLight")).toHaveAttribute("data-phase", "reflect");
}

async function expectChipStatusCentered(page, text) {
  // Inspect the actual status rather than the intentional connection hint.
  await page.mouse.move(10, 870);
  const trigger = page.locator("#mcuSelect + .custom-select .custom-select-trigger");
  await expect(trigger.locator(".custom-select-status")).toHaveText(text);
  for (const [state, key] of [["expanded", "End"], ["compact", "ArrowUp"]]) {
    await page.locator("#devicePanelToggle").focus();
    await page.keyboard.press(key);
    await expect(page.locator("#avrDeviceSection")).toHaveAttribute("data-state", state);
    await expect(page.locator("#avrDeviceSection")).not.toHaveClass(/is-device-panel-transitioning/);
    await expect(trigger.locator(".custom-select-status")).toHaveCSS("opacity", "1");
    const geometry = await trigger.evaluate(element => {
      const frame = element.getBoundingClientRect();
      const status = element.querySelector(".custom-select-status");
      const range = document.createRange();
      range.selectNodeContents(status);
      const text = range.getBoundingClientRect();
      const captionRange = document.createRange();
      captionRange.selectNodeContents(element.querySelector(".custom-select-caption"));
      const caption = captionRange.getBoundingClientRect();
      return {
        captionDx: caption.x + caption.width / 2 - frame.x - frame.width / 2,
        dx: text.x + text.width / 2 - frame.x - frame.width / 2,
        dy: text.y + text.height / 2 - frame.y - frame.height / 2,
        fits: text.left >= frame.left && text.right <= frame.right
          && text.top >= frame.top && text.bottom <= frame.bottom,
      };
    });
    expect(geometry.fits, `${text} must fit the actual ${state} Chip frame`).toBe(true);
    expect(Math.abs(geometry.dx), `${text} must use the whole field, without an implicit second grid column`).toBeLessThan(1);
    expect(Math.abs(geometry.captionDx), `the Chip heading must stay centered above ${text}`).toBeLessThan(1);
    const expectedOffset = state === "expanded" ? 7.5 : 0;
    expect(Math.abs(geometry.dy - expectedOffset), `${text} must share the ${state} value region with the connection hint`).toBeLessThan(1.5);
  }
}

async function readHardwareWaveCrest(page) {
  return page.locator("#hardwareFlowLight .hardware-flow-beam").evaluate(beam => {
    const box = beam.getBoundingClientRect();
    const style = getComputedStyle(beam);
    const percentage = Number.parseFloat(style.backgroundPositionX.match(/(-?[\d.]+)%/)?.[1] || "0");
    const pixels = Number.parseFloat(style.backgroundPositionX.match(/(-?[\d.]+)px/)?.[1] || "0");
    const band = Number.parseFloat(style.backgroundSize) / 100;
    // Locate the visible peak of the rendered gradient, not a controller flag.
    const crest = box.left + box.width * ((1 - band) * percentage / 100 + band * 0.56) + pixels;
    const inset = style.clipPath.match(/^inset\(\S+\s+(-?[\d.]+)(%|px)/);
    const clippedRight = inset ? box.right - Number(inset[1]) * (inset[2] === "%" ? box.width / 100 : 1) : box.right;
    return { crest, clippedRight };
  });
}

async function holdHardwareWaveFailure(page) {
  await page.evaluate(() => {
    navigator.serial.requestPort = () => new Promise((resolve, reject) => {
      window.__rejectHardwareWavePicker = () => reject(new Error("requestPort: delayed adapter failure"));
    });
  });
  await page.locator("#detectChipBtn").click();
  await expect(page.locator("#hardwareFlowLight")).toHaveAttribute("data-phase", "forward");
}

async function rejectHardwareWaveAt(page, time) {
  return page.evaluate(async time => {
    const light = document.getElementById("hardwareFlowLight");
    const beam = light.querySelector(".hardware-flow-beam");
    const original = beam.getAnimations()[0];
    original.pause();
    original.currentTime = time;
    const read = () => {
      const style = getComputedStyle(beam);
      return { position: style.backgroundPositionX, opacity: Number(style.opacity), clip: style.clipPath };
    };
    const before = read();
    const keyframes = JSON.stringify(original.effect.getKeyframes());
    window.__rejectHardwareWavePicker();
    // The async UPDI rejection settles through microtasks. Keeping this task
    // paused lets us compare the exact event boundary without elapsed frames.
    for (let attempt = 0; attempt < 100 && light.dataset.phase !== "approach"; attempt += 1) {
      await Promise.resolve();
    }
    return {
      before, after: read(), phase: light.dataset.phase,
      sameAnimation: beam.getAnimations()[0] === original,
      sameKeyframes: JSON.stringify(original.effect.getKeyframes()) === keyframes,
      iterations: original.effect.getTiming().iterations,
    };
  }, time);
}

async function seekHardwareWave(page, time) {
  await page.locator("#hardwareFlowLight .hardware-flow-beam").evaluate((beam, time) => {
    for (const animation of beam.getAnimations()) {
      animation.pause();
      animation.currentTime = time;
    }
  }, time);
}

async function readConnectionValues(page) {
  return page.evaluate(() => {
    const chip = document.getElementById("mcuSelect");
    return { port: document.getElementById("adapterStatusText").textContent,
      chip: chip.value, status: chip.dataset.controlStatus, state: chip.dataset.connectionState,
      package: document.getElementById("projectPackageSelect").value };
  });
}

async function readConnectionTextGeometry(page) {
  return page.evaluate(() => [
    [".hardware-port", ".avr-status-value", ".hardware-field-caption"],
    ["#mcuSelect + .custom-select .custom-select-trigger", ".custom-select-value", ".custom-select-caption"],
    ["#projectPackageSelect + .custom-select .custom-select-trigger", ".custom-select-value", ".custom-select-caption"],
  ].map(([selector, valueSelector, captionSelector]) => {
    const field = document.querySelector(selector), bounds = field.getBoundingClientRect();
    const textBounds = element => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const rect = range.getBoundingClientRect();
      return { center: rect.y + rect.height / 2 - bounds.y, top: rect.top, bottom: rect.bottom,
        fits: [...range.getClientRects()].every(box => box.left >= bounds.left - 0.5 && box.right <= bounds.right + 0.5
          && box.top >= bounds.top - 0.5 && box.bottom <= bounds.bottom + 0.5) };
    };
    const value = textBounds(field.querySelector(valueSelector));
    const caption = field.querySelector(captionSelector);
    const status = field.querySelector(".custom-select-status");
    let caret = null;
    if (field.matches(".custom-select-trigger")) {
      // The caret is generated content; measure its rendered border triangle
      // with the same computed geometry, rather than asserting a CSS offset.
      const style = getComputedStyle(field, "::after");
      const probe = document.createElement("span");
      probe.setAttribute("aria-hidden", "true");
      for (const property of ["display", "position", "boxSizing", "width", "height", "left", "right", "top", "bottom",
        "margin", "padding", "border", "borderTop", "borderRight", "borderBottom", "borderLeft",
        "alignSelf", "justifySelf", "transform", "transformOrigin", "translate"]) probe.style[property] = style[property];
      probe.style.visibility = "hidden";
      field.appendChild(probe);
      const rect = probe.getBoundingClientRect();
      caret = { center: rect.y + rect.height / 2 - bounds.y,
        fits: rect.left >= bounds.left && rect.right <= bounds.right && rect.top >= bounds.top && rect.bottom <= bounds.bottom };
      probe.remove();
    }
    return { selector, value, frame: [bounds.x, bounds.y, bounds.width, bounds.height],
      caption: { text: caption.textContent, center: textBounds(caption).center,
        opacity: Number(getComputedStyle(caption).opacity), bottom: textBounds(caption).bottom },
      auxiliary: status?.textContent && Number(getComputedStyle(status).opacity) > 0.9
        ? textBounds(status) : null, caret };
  }));
}

async function expectConnectionHoverText(page, { port, chip, mode }) {
  const fields = [];
  for (const [selector, expected, captionSelector] of [
    [".hardware-port", port, ".hardware-field-caption"],
    ["#mcuSelect + .custom-select .custom-select-trigger", chip, ".custom-select-caption"],
  ]) {
    const field = page.locator(selector);
    await expect.poll(() => field.evaluate(element => getComputedStyle(element, "::before").opacity)).toBe("1");
    const geometry = await field.evaluate((element, captionSelector) => {
      const style = getComputedStyle(element, "::before");
      const content = style.content.replace(/^["']|["']$/g, "");
      // Measure the browser's wrapping for the generated copy with its exact
      // computed dimensions and font, inside the same containing block.
      const probe = document.createElement("span");
      probe.textContent = content;
      probe.setAttribute("aria-hidden", "true");
      for (const property of ["display", "position", "boxSizing", "width", "height", "left", "top",
        "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "alignItems", "justifyItems",
        "alignContent", "justifyContent", "font", "lineHeight", "whiteSpace", "wordBreak", "overflowWrap",
        "textAlign", "letterSpacing", "transform"]) probe.style[property] = style[property];
      probe.style.visibility = "hidden";
      element.appendChild(probe);
      const range = document.createRange();
      range.selectNodeContents(probe);
      const text = range.getBoundingClientRect();
      const bounds = element.getBoundingClientRect();
      const caption = element.querySelector(captionSelector);
      const captionRange = document.createRange();
      captionRange.selectNodeContents(caption);
      const captionBounds = captionRange.getBoundingClientRect();
      const result = { content,
        center: text.y + text.height / 2 - bounds.y,
        frame: [bounds.x, bounds.y, bounds.width, bounds.height],
        captionCenter: captionBounds.y + captionBounds.height / 2 - bounds.y,
        fits: [...range.getClientRects()].every(rect => rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1
          && rect.top >= bounds.top - 1 && rect.bottom <= bounds.bottom + 1),
        dx: text.x + text.width / 2 - bounds.x - bounds.width / 2,
        captionOpacity: Number(getComputedStyle(caption).opacity),
        captionOverlap: text.top < captionBounds.bottom && text.bottom > captionBounds.top };
      probe.remove();
      return result;
    }, captionSelector);
    expect(geometry.content).toBe(expected);
    expect(geometry.fits, `${expected} must fit inside its ${mode} field`).toBe(true);
    expect(Math.abs(geometry.dx), `${expected} must stay centered`).toBeLessThan(1);
    if (mode === "expanded") {
      expect(geometry.captionOpacity, "the field heading must remain visible above the hover copy").toBe(1);
      expect(geometry.captionOverlap, "hover copy must not cover its field heading").toBe(false);
    }
    fields.push(geometry);
  }
  return fields;
}

for (const width of [900, 1543]) {
  test(`connection hover previews both fields and runs one shared wave at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 884 });
    await open(page);
    for (const connected of [false, true]) {
      if (connected) {
        await detect(page);
        await choose(page, "projectPackageSelect", "SOIC-14");
      }
      for (const [mode, key] of [["expanded", "End"], ["compact", "ArrowUp"]]) {
        await page.locator("#devicePanelToggle").focus();
        await page.keyboard.press(key);
        await expect(page.locator("#avrDeviceSection")).toHaveAttribute("data-state", mode);
        await expect(page.locator("#avrDeviceSection")).not.toHaveClass(/is-device-panel-transitioning/);
        const before = await readConnectionValues(page);
        const normal = await readConnectionTextGeometry(page);
        for (const field of normal) {
          expect(field.value.fits, `${field.selector} must retain all normal value text inside the frame`).toBe(true);
          if (field.auxiliary) {
            expect(field.auxiliary.fits, "the visible connection status must remain inside its frame").toBe(true);
            expect(field.auxiliary.top, "the connection status must remain below the selected chip").toBeGreaterThanOrEqual(field.value.bottom);
          }
          if (field.caret) {
            expect(field.caret.fits, "the selector arrow must remain inside its frame").toBe(true);
            expect(Math.abs(field.caret.center - field.frame[3] / 2), "the selector arrow must stay at the trigger center").toBeLessThan(1);
          }
          if (mode === "expanded" && field.caption.text) {
            expect(field.value.top, "the normal value must not overlap its caption").toBeGreaterThanOrEqual(field.caption.bottom);
          }
        }
        const packageValue = normal[2];
        const packageOffset = packageValue.value.center - packageValue.frame[3] / 2;
        if (!connected) {
          expect(packageValue.caption.text).toBe("");
          expect(Math.abs(packageOffset), "an uncaptioned Package placeholder must remain centered in its field").toBeLessThan(1.5);
        } else {
          expect(packageValue.caption.text).toBe("Package");
          expect(Math.abs(packageValue.value.center - normal[1].value.center), "selected Package and Chip must share one value level").toBeLessThan(1.5);
        }
        await page.locator("#detectChipBtn").hover();
        await expect(page.locator("#hardwareFlowLight")).toHaveAttribute("data-phase", "forward");
        const start = await readHardwareWaveCrest(page);
        await expect.poll(async () => (await readHardwareWaveCrest(page)).crest).not.toBe(start.crest);
        const hovered = await expectConnectionHoverText(page, {
          port: connected ? "Click to reselect device" : "Click to select device",
          chip: connected ? "Click to redetect the chip" : "Click to detect the chip", mode,
        });
        for (const [index, field] of hovered.entries()) {
          expect(field.frame, "hover must not move or resize the field").toEqual(normal[index].frame);
          expect(Math.abs(field.captionCenter - normal[index].caption.center), "hover must not move the caption").toBeLessThan(0.5);
          expect(Math.abs(field.center - normal[index].value.center), "normal and hover text must use the same vertical level").toBeLessThan(1.5);
        }
        expect(await readConnectionValues(page), "hover is a presentation preview, not a target change").toEqual(before);
        await expect(page.locator("#adapterStatusText")).toHaveCSS("opacity", "0");
        await expect(page.locator("#mcuSelect + .custom-select .custom-select-value")).toHaveCSS("opacity", "0");
        await expect(page.locator('.ui-tooltip[aria-hidden="false"]')).toHaveCount(0);
        await page.screenshot({ path: testInfo.outputPath(`connection-hover-${connected ? "connected" : "disconnected"}-${mode}-${width}.png`) });
        await page.mouse.move(10, 870);
        await expect(page.locator("#adapterStatusText")).toHaveCSS("opacity", "1");
        await expect(page.locator("#mcuSelect + .custom-select .custom-select-value")).toHaveCSS("opacity", "1");
        expect(await readConnectionValues(page)).toEqual(before);
        await finishFiniteHardwareWave(page);
        await expectHardwareWaveIdle(page);
      }
    }
  });
}

test("connection hover and leave preserve pending work and the success under the cursor", async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    const request = navigator.serial.requestPort.bind(navigator.serial);
    navigator.serial.requestPort = () => new Promise(resolve => {
      window.__releaseHoverPicker = () => resolve(request());
    });
  });
  await page.locator("#detectChipBtn").click();
  await expect(page.locator("#detectChipBtn")).toBeDisabled();
  await page.mouse.move(10, 870);
  expect(await page.locator("#hardwareFlowLight .hardware-flow-beam").evaluate(beam =>
    beam.getAnimations()[0].effect.getComputedTiming().endTime)).toBe(Infinity);
  // Enter the disabled button while the real operation remains pending.
  const button = await page.locator("#detectChipBtn").boundingBox();
  await page.mouse.move(button.x + button.width / 2, button.y + button.height / 2);
  await expect(page.locator("#mcuSelect + .custom-select .custom-select-status")).toHaveText("Working");
  await expect(page.locator("#mcuSelect + .custom-select .custom-select-status")).toHaveCSS("opacity", "1");
  expect(await page.locator(".hardware-port").evaluate(element => getComputedStyle(element, "::before").opacity)).toBe("0");
  await page.evaluate(() => window.__releaseHoverPicker());
  await expect(page.locator("#detectChipBtn")).toBeEnabled();
  await expectDetectedTarget(page);
  await expectConnectionHoverText(page, { port: "Click to reselect device", chip: "Click to redetect the chip", mode: "expanded" });
  expect(await page.locator("#hardwareFlowLight .hardware-flow-beam").evaluate(beam =>
    beam.getAnimations()[0].effect.getComputedTiming().endTime)).toBe(Infinity);
  await page.mouse.move(10, 870);
  await finishFiniteHardwareWave(page);
  await expectHardwareWaveIdle(page);
});

test("selector hover keeps the hardware wave idle until menu or value activity", async ({ page }) => {
  await installPackageCatalog(page);
  await open(page);
  await expectHardwareWaveIdle(page);
  const trigger = page.locator("#mcuSelect + .custom-select .custom-select-trigger");
  await trigger.hover();
  await trigger.focus();
  await expectHardwareWaveIdle(page);

  await trigger.click();
  await expect(page.locator("#hardwareFlowLight")).toHaveAttribute("data-phase", "forward");
  await page.keyboard.press("Escape");
  await finishFiniteHardwareWave(page);
  await expectHardwareWaveIdle(page);

  for (const [id, value] of [["mcuSelect", "attiny1614"], ["projectPackageSelect", "SOIC-14"]]) {
    await choose(page, id, value);
    await expect(page.locator("#hardwareFlowLight")).toHaveAttribute("data-phase", "forward");
    await finishFiniteHardwareWave(page);
    await expectHardwareWaveIdle(page);
  }
});

test("closing a target menu does not stop the wave of a pending port picker", async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    const request = navigator.serial.requestPort.bind(navigator.serial);
    navigator.serial.requestPort = () => new Promise(resolve => {
      window.__releaseHardwareWavePicker = () => resolve(request());
    });
  });
  await page.locator("#detectChipBtn").click();
  await expect(page.locator("#hardwareFlowLight")).toHaveAttribute("data-phase", "forward");
  await expectChipStatusCentered(page, "Working");
  await page.locator("#mcuSelect + .custom-select .custom-select-trigger").click();
  await page.keyboard.press("Escape");
  // Cross an entire pass while the real async permission request is unresolved.
  await page.waitForTimeout(2600);
  await expect(page.locator("#avrDevicePanelViewport")).toHaveAttribute("data-state", "detecting");
  await expect(page.locator("#hardwareFlowLight")).toHaveAttribute("data-phase", "forward");
  await page.evaluate(() => window.__releaseHardwareWavePicker());
  await expect(page.locator("#detectChipBtn")).toBeEnabled();
  await expectDetectedTarget(page);
  await finishFiniteHardwareWave(page);
  await expectHardwareWaveIdle(page);
});

for (const stage of ["adapter", "chip"]) {
  test(`a ${stage} failure reflects the wave from that field and returns red to the left`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 900, height: 884 });
    await open(page);
    await page.evaluate(stage => {
      if (stage === "adapter") {
        navigator.serial.requestPort = async () => { throw new Error("requestPort: adapter unavailable"); };
      } else {
        const request = navigator.serial.requestPort.bind(navigator.serial);
        navigator.serial.requestPort = async () => {
          const port = await request();
          const getWriter = port.writable.getWriter.bind(port.writable);
          port.writable.getWriter = () => {
            const writer = getWriter();
            const write = writer.write.bind(writer);
            writer.write = async bytes => {
              if (bytes[0] === 0x55 && bytes[1] === 0xe6) throw new Error("Chip did not answer the SIB request");
              return write(bytes);
            };
            return writer;
          };
          return port;
        };
      }
    }, stage);
    await page.locator("#detectChipBtn").click();
    const fault = stage === "adapter" ? page.locator(".hardware-port")
      : page.locator("#mcuSelect + .custom-select .custom-select-trigger");
    if (stage === "adapter") await expect(page.locator("#adapterStatusText")).toHaveText("Adapter error");
    else await expect(page.locator("#mcuSelect")).toHaveAttribute("data-control-status", "Chip error");
    await advanceHardwareWaveToReflection(page);
    await page.locator("#hardwareFlowLight .hardware-flow-beam").evaluate(beam => {
      for (const animation of beam.getAnimations()) {
        animation.pause();
        animation.currentTime = 0;
      }
    });
    await expect(page.locator("#hardwareFlowLight")).toHaveAttribute("data-tone", "error");
    const field = await fault.boundingBox();
    const impact = await readHardwareWaveCrest(page);
    expect(Math.abs(impact.crest - field.x - field.width), "the reflection must begin at the failed field's right edge").toBeLessThan(2);
    expect(impact.clippedRight, "a failed stage must not light fields beyond it").toBeLessThanOrEqual(field.x + field.width + 1);
    if (stage === "chip") await expectChipStatusCentered(page, "Chip error");
    const start = await readHardwareWaveCrest(page);
    await page.locator("#hardwareFlowLight .hardware-flow-beam").evaluate(beam => {
      for (const animation of beam.getAnimations()) {
        const duration = Number(animation.effect.getTiming().duration);
        if (Number.isFinite(duration)) animation.currentTime = duration * 0.55;
      }
    });
    const returning = await readHardwareWaveCrest(page);
    expect(returning.crest, "the red wave must travel left from the impact").toBeLessThan(start.crest - 20);
    await page.mouse.move(10, 870);
    await page.screenshot({ path: testInfo.outputPath(`${stage}-wave-reflection.png`) });
    await finishFiniteHardwareWave(page);
    await expectHardwareWaveIdle(page);
  });
}

test("retrying during a red return leaves the new pending detection active", async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    const request = navigator.serial.requestPort.bind(navigator.serial);
    window.__hardwareWaveFailPort = true;
    navigator.serial.requestPort = () => {
      if (window.__hardwareWaveFailPort) return Promise.reject(new Error("requestPort: temporary adapter failure"));
      return new Promise(resolve => { window.__releaseHardwareWaveRetry = () => resolve(request()); });
    };
  });
  await page.locator("#detectChipBtn").click();
  await expect(page.locator("#adapterStatusText")).toHaveText("Adapter error");
  await advanceHardwareWaveToReflection(page);
  await expect(page.locator("#hardwareFlowLight")).toHaveAttribute("data-tone", "error");
  await page.evaluate(() => { window.__hardwareWaveFailPort = false; });
  await page.locator("#detectChipBtn").click();
  await expect(page.locator("#hardwareFlowLight")).toHaveAttribute("data-phase", "forward");
  await expect(page.locator("#hardwareFlowLight")).toHaveAttribute("data-tone", "green");
  // The obsolete red return would have completed during this newer request.
  await page.waitForTimeout(1300);
  await expect(page.locator("#avrDevicePanelViewport")).toHaveAttribute("data-state", "detecting");
  await expect(page.locator("#hardwareFlowLight")).toHaveAttribute("data-phase", "forward");
  await page.evaluate(() => window.__releaseHardwareWaveRetry());
  await expect(page.locator("#detectChipBtn")).toBeEnabled();
  await expectDetectedTarget(page);
  await page.mouse.move(10, 870);
  await finishFiniteHardwareWave(page);
  await expectHardwareWaveIdle(page);
});

test("reduced motion keeps hardware activity and warning text usable without a frozen wave", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page);
  await page.locator("#detectChipBtn").hover();
  await expectConnectionHoverText(page, { port: "Click to select device", chip: "Click to detect the chip", mode: "expanded" });
  await expectHardwareWaveIdle(page);
  await page.mouse.move(10, 870);
  await page.evaluate(() => {
    window.__targetSerialAdapter.deviceId = 0x123456;
    const request = navigator.serial.requestPort.bind(navigator.serial);
    navigator.serial.requestPort = () => new Promise(resolve => {
      window.__releaseReducedMotionPicker = () => resolve(request());
    });
  });
  await page.locator("#detectChipBtn").click();
  await expectChipStatusCentered(page, "Working");
  await expectHardwareWaveIdle(page);
  await expect(page.locator("#hardwareFlowLight .hardware-flow-beam")).toHaveCSS("opacity", "0");
  await page.evaluate(() => window.__releaseReducedMotionPicker());
  await expect(page.locator("#detectChipBtn")).toBeEnabled();
  await expectChipStatusCentered(page, "Unknown chip");
  await expectHardwareWaveIdle(page);
  await expect(page.locator("#hardwareFlowLight .hardware-flow-beam")).toHaveCSS("opacity", "0");
});

test("an early hardware failure preserves the ordinary wave at the event boundary", async ({ page }) => {
  await open(page);
  await holdHardwareWaveFailure(page);
  const boundary = await rejectHardwareWaveAt(page, 300);
  expect(boundary.phase).toBe("approach");
  expect(boundary.sameAnimation, "an error must not replace the current incoming wave").toBe(true);
  expect(boundary.sameKeyframes, "the ordinary incoming trajectory must stay intact").toBe(true);
  expect(boundary.after).toMatchObject({ position: boundary.before.position, opacity: boundary.before.opacity });
  expect(boundary.iterations, "the current pass should end at the contact point").toBeGreaterThan(0);
  expect(boundary.iterations).toBeLessThan(1);
  await advanceHardwareWaveToReflection(page);
  await finishFiniteHardwareWave(page);
  await expectHardwareWaveIdle(page);
});

test("a late hardware failure lets the existing packet leave before the next right-edge reflection", async ({ page }) => {
  await open(page);
  await holdHardwareWaveFailure(page);
  const boundary = await rejectHardwareWaveAt(page, 2000);
  expect(boundary.phase).toBe("approach");
  expect(boundary.sameAnimation, "an already-past wave must leave on its original animation").toBe(true);
  expect(boundary.sameKeyframes).toBe(true);
  expect(boundary.after, "a late error must not fade, clip or teleport the visible packet").toEqual(boundary.before);
  expect(boundary.iterations, "the current ordinary iteration must finish in full").toBe(1);

  await finishFiniteHardwareWave(page);
  await expect(page.locator("#hardwareFlowLight")).toHaveAttribute("data-phase", "approach");
  await seekHardwareWave(page, 0);
  const next = await readHardwareWaveCrest(page);
  const port = await page.locator(".hardware-port").boundingBox();
  expect(next.crest, "the next natural pass starts outside the left edge").toBeLessThan(port.x);
  expect(Math.abs(next.clippedRight - port.x - port.width), "only the bounded next pass is clipped at the fault").toBeLessThan(1);
  await advanceHardwareWaveToReflection(page);
  await seekHardwareWave(page, 0);
  const contact = await readHardwareWaveCrest(page);
  expect(Math.abs(contact.crest - port.x - port.width), "the next pass must reflect from Port's right edge").toBeLessThan(1);
  await finishFiniteHardwareWave(page);
  await expectHardwareWaveIdle(page);
});

test("ordinary and reflected hardware waves travel equal distances in equal time", async ({ page }) => {
  await open(page);
  await holdHardwareWaveFailure(page);
  await seekHardwareWave(page, 400);
  const greenStart = await readHardwareWaveCrest(page);
  await seekHardwareWave(page, 600);
  const greenEnd = await readHardwareWaveCrest(page);
  await rejectHardwareWaveAt(page, 600);
  await advanceHardwareWaveToReflection(page);
  await seekHardwareWave(page, 200);
  const redStart = await readHardwareWaveCrest(page);
  await seekHardwareWave(page, 400);
  const redEnd = await readHardwareWaveCrest(page);
  const forwardDistance = greenEnd.crest - greenStart.crest;
  const returnDistance = redStart.crest - redEnd.crest;
  expect(forwardDistance, "the ordinary packet must actually move over the sampled interval").toBeGreaterThan(20);
  expect(returnDistance, "the reflected packet must move back to the left").toBeGreaterThan(20);
  expect(Math.abs(returnDistance - forwardDistance), "the error return must keep the ordinary wave's pixel speed").toBeLessThan(0.5);
  await finishFiniteHardwareWave(page);
  await expectHardwareWaveIdle(page);
});

test("opening another hardware selector does not restart a return from the same visible fault", async ({ page }) => {
  await installPackageCatalog(page);
  await open(page);
  await choose(page, "mcuSelect", "attiny1614");
  await choose(page, "projectPackageSelect", "SOIC-14");
  await page.evaluate(() => {
    navigator.serial.requestPort = async () => { throw new Error("requestPort: adapter remains unavailable"); };
  });
  await page.locator("#detectChipBtn").click();
  await expect(page.locator("#adapterStatusText")).toHaveText("Adapter error");
  await advanceHardwareWaveToReflection(page);
  await page.locator("#hardwareFlowLight .hardware-flow-beam").evaluate(beam => {
    const animation = beam.getAnimations()[0];
    animation.pause();
    animation.currentTime = Number(animation.effect.getComputedTiming().endTime) * 0.35;
    window.__preservedHardwareReturn = animation;
    const style = getComputedStyle(beam);
    window.__preservedHardwareReturnPose = { position: style.backgroundPositionX, opacity: Number(style.opacity) };
  });
  await page.mouse.move(10, 870);
  await page.locator("#detectChipBtn").hover();
  const hovered = await page.locator("#hardwareFlowLight .hardware-flow-beam").evaluate(beam => {
    const style = getComputedStyle(beam);
    return { sameAnimation: beam.getAnimations()[0] === window.__preservedHardwareReturn,
      position: style.backgroundPositionX, opacity: Number(style.opacity), before: window.__preservedHardwareReturnPose };
  });
  expect(hovered.sameAnimation, "connection hover must not restart a return from the existing fault").toBe(true);
  expect({ position: hovered.position, opacity: hovered.opacity }).toEqual(hovered.before);
  for (const id of ["mcuSelect", "projectPackageSelect"]) {
    await page.locator(`#${id} + .custom-select .custom-select-trigger`).click();
    const current = await page.locator("#hardwareFlowLight .hardware-flow-beam").evaluate(beam => {
      const style = getComputedStyle(beam);
      return { sameAnimation: beam.getAnimations()[0] === window.__preservedHardwareReturn,
        position: style.backgroundPositionX, opacity: Number(style.opacity),
        before: window.__preservedHardwareReturnPose };
    });
    expect(current.sameAnimation, "opening a selector must not replace the existing red return").toBe(true);
    expect({ position: current.position, opacity: current.opacity }).toEqual(current.before);
    await expect(page.locator("#hardwareFlowLight")).toHaveAttribute("data-tone", "error");
    await expect(page.locator("#hardwareFlowLight")).toHaveAttribute("data-phase", "reflect");
  }
  await page.keyboard.press("Escape");
  await finishFiniteHardwareWave(page);
  await expectHardwareWaveIdle(page);
});
