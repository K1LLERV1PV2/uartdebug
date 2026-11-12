"use strict";

const { test, expect } = require("playwright/test");

async function readControlSurface(control) {
  return control.evaluate(async element => {
    await Promise.all(element.getAnimations()
      .filter(animation => Number.isFinite(animation.effect?.getComputedTiming().endTime))
      .map(animation => animation.finished.catch(() => {})));
    const style = getComputedStyle(element);
    return { radius: style.borderRadius, border: style.borderTopColor,
      background: style.backgroundColor, color: style.color, shadow: style.boxShadow };
  });
}

test("standalone inputs share appearance and mouse/keyboard focus across the workspaces", async ({ page }) => {
  await openControls(page, "/avr");
  await page.locator("#filesOpenBtn").click();
  await page.locator("#createEmptyProjectCard").click();
  await page.locator("#filesOpenBtn").click();
  await page.locator("#fileList .file-menu-btn").click();
  await page.locator('#fileContextMenu [data-action="rename"]').click();
  const rename = page.locator(".file-inline-input");
  await rename.click();
  await expect.poll(async () => (await readControlSurface(rename)).shadow).toContain("3px");
  const focused = await readControlSurface(rename);
  // Leaving the inline field commits it. Reopen Rename with the keyboard
  // rather than focusing its parent and expecting the old input to survive.
  await page.keyboard.press("Escape");
  await page.locator("#fileList .file-menu-btn").focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await expect(rename).toBeFocused();
  await expect.poll(() => readControlSurface(rename)).toEqual(focused);
  await rename.fill("invalid/name");
  await rename.press("Enter");
  await expect(rename).toHaveAttribute("aria-invalid", "true");
  await expect.poll(async () => (await readControlSurface(rename)).border).toBe("rgb(232, 95, 92)");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");

  await openConnectedUart(page);
  const input = page.locator("#terminalInput");
  await input.click();
  await expect.poll(() => readControlSurface(input)).toEqual(focused);
  await page.locator('label:has(#cycleCheckbox)').click();
  await page.locator("#cycleCheckbox").focus();
  await page.keyboard.press("Tab");
  const numeric = page.locator("#loopIntervalInput");
  await expect(numeric).toBeFocused();
  await expect.poll(() => readControlSurface(numeric)).toEqual(focused);
  await page.locator('label:has(#cycleCheckbox)').click();
  // UART locks the whole session separately. Probe the input component's
  // native disabled state without changing that session behavior.
  await numeric.evaluate(element => { element.disabled = true; });
  await expect(numeric).toBeDisabled();
  await expect(numeric).toHaveCSS("opacity", "0.64");
  expect(await page.evaluate(() => window.__controlUartWrites)).toEqual([]);
});

test("icon actions share normal, hover and keyboard focus frames across their contexts", async ({ page }) => {
  await openControls(page, "/avr");
  await page.locator("#filesOpenBtn").click();
  await page.locator("#createEmptyProjectCard").click();
  await page.locator("#filesOpenBtn").click();
  const menu = page.locator("#fileList .file-menu-btn");
  await page.mouse.move(0, 0);
  await menu.evaluate(element => element.blur());
  const quiet = await readControlSurface(menu);
  expect(quiet).toMatchObject({ radius: "8px", border: "rgba(0, 0, 0, 0)", background: "rgba(0, 0, 0, 0)" });
  await menu.hover();
  await expect.poll(async () => (await readControlSurface(menu)).border).toBe("rgba(129, 159, 141, 0.22)");
  await expect.poll(async () => (await readControlSurface(menu)).background).toBe("rgba(129, 159, 141, 0.08)");
  await page.mouse.move(0, 0);
  await page.locator("#fileList .file-item").focus();
  await page.keyboard.press("Tab");
  await expect(menu).toBeFocused();
  await expect(menu).toHaveCSS("outline-style", "solid");
  await expect(menu).toHaveCSS("outline-width", "2px");
  const closeProjects = page.locator("#filesCloseBtn");
  await page.mouse.move(0, 0);
  await closeProjects.evaluate(element => element.blur());
  const normal = await readControlSurface(closeProjects);
  await closeProjects.hover();
  await expect.poll(async () => (await readControlSurface(closeProjects)).border).toBe("rgb(55, 195, 93)");
  const hovered = await readControlSurface(closeProjects);
  await page.keyboard.press("Escape");

  await page.evaluate(() => window.UartDebugNotifications.notify({
    title: "Control verification", message: "Shared icon frame", key: "icon-frame",
  }));
  const closeToast = page.locator(".notification-toast-close");
  await expect.poll(() => readControlSurface(closeToast)).toEqual(normal);
  await closeToast.hover();
  await expect.poll(() => readControlSurface(closeToast)).toEqual(hovered);
  await closeToast.click();

  await page.locator("#projectAiAccountBtn").click();
  const closeDialog = page.locator("#projectAiAccountCloseBtn");
  await page.mouse.move(0, 0);
  await closeDialog.evaluate(element => element.blur());
  await expect.poll(() => readControlSurface(closeDialog)).toEqual(normal);
  await closeDialog.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(closeDialog).toBeFocused();
  await expect(closeDialog).toHaveCSS("outline-width", "2px");
  await page.keyboard.press("Escape");

  await openConnectedUart(page);
  const clear = page.locator("#clearBtn");
  await page.mouse.move(0, 0);
  await expect.poll(() => readControlSurface(clear)).toEqual(normal);
  await clear.hover();
  await expect.poll(() => readControlSurface(clear)).toEqual(hovered);
  await page.mouse.move(0, 0);
  await clear.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(clear).toBeFocused();
  await expect(clear).toHaveCSS("outline-width", "2px");
  expect(await page.evaluate(() => window.__controlUartWrites)).toEqual([]);
});

test("project and notification records retain the project appearance and selected hover", async ({ page }) => {
  await openControls(page, "/avr");
  for (let index = 0; index < 2; index++) {
    await page.locator("#filesOpenBtn").click();
    await page.locator("#createEmptyProjectCard").click();
  }
  await page.locator("#filesOpenBtn").click();
  const selected = page.locator("#fileList .file-item.active");
  const unselected = page.locator("#fileList .file-item:not(.active)");
  const recordTypography = element => {
    const style = getComputedStyle(element);
    return { radius: style.borderRadius, padding: style.padding, fontSize: style.fontSize,
      fontWeight: style.fontWeight, lineHeight: style.lineHeight, minHeight: style.minHeight };
  };
  const typography = await selected.evaluate(recordTypography);
  expect(typography).toEqual({ radius: "10px", padding: "7px", fontSize: "13px",
    fontWeight: "400", lineHeight: "19.5px", minHeight: "44px" });
  await expect(selected.locator(".file-name")).toHaveCSS("font-weight", "400");
  await page.mouse.move(0, 0);
  const selectedSurface = await readControlSurface(selected);
  expect(selectedSurface).toMatchObject({ border: "rgba(70, 255, 120, 0.34)", background: "rgba(39, 174, 96, 0.18)" });
  await selected.hover();
  await expect.poll(() => readControlSurface(selected)).toEqual(selectedSurface);
  await unselected.hover();
  await expect.poll(async () => (await readControlSurface(unselected)).background).toBe("rgba(39, 174, 96, 0.11)");
  const hoveredSurface = await readControlSurface(unselected);
  await selected.locator(".file-menu-btn").click();
  const action = page.locator('#fileContextMenu [data-action="rename"]');
  await expect(action).toHaveCSS("padding", "8px 10px");
  await expect(action).toHaveCSS("font-weight", "600");
  await expect(action).toHaveCSS("border-radius", "8px");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");

  await page.evaluate(() => {
    for (let index = 0; index < 2; index++) window.UartDebugNotifications.notify({
      key: `record-${index}`, title: `Record ${index}`, message: `Record summary ${index}`,
    });
  });
  await page.locator("#notificationsBtn").click();
  const selectedNotice = page.locator('.notification-history-item[aria-pressed="true"]');
  const unselectedNotice = page.locator('.notification-history-item[aria-pressed="false"]').first();
  expect(await selectedNotice.evaluate(recordTypography)).toEqual(typography);
  await expect(selectedNotice.locator("strong")).toHaveCSS("font-weight", "400");
  await expect(selectedNotice.locator("strong")).toHaveCSS("line-height", "19.5px");
  await selectedNotice.hover();
  await expect.poll(() => readControlSurface(selectedNotice)).toEqual(selectedSurface);
  await unselectedNotice.hover();
  await expect.poll(() => readControlSurface(unselectedNotice)).toEqual(hoveredSurface);
  await unselectedNotice.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(unselectedNotice).toBeFocused();
  await expect(unselectedNotice).toHaveCSS("outline-width", "2px");
  await expect(unselectedNotice).toHaveCSS("outline-offset", "-2px");
});

test.beforeEach(async ({ page }) => {
  page.__controlErrors = [];
  page.on("pageerror", error => page.__controlErrors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error") page.__controlErrors.push(message.text());
  });
});
test.afterEach(async ({ page }) => { expect(page.__controlErrors).toEqual([]); });

async function openControls(page, route) {
  await page.goto(route, { waitUntil: "load" });
  await expect(page).toHaveTitle(route === "/avr" ? "AVR Programming - Uart Debug" : "UART Terminal - Uart Debug");
  await page.waitForFunction(() => window.UartDebugControls);
}

for (const [route, id] of [["/avr", "mcuSelect"], ["/uart.html", "baudRate"]]) {
  test(`${id} retains keyboard focus and navigation when its open options update`, async ({ page }, testInfo) => {
    await openControls(page, route);
    const select = page.locator(`#${id}`);
    const custom = page.locator(`#${id} + .custom-select`);
    const trigger = custom.locator(".custom-select-trigger");
    await expect(trigger).toBeEnabled();
    const values = await select.evaluate(element => [...element.options]
      .filter(option => !option.disabled && !option.parentElement.disabled).map(option => option.value));
    expect(values.length).toBeGreaterThanOrEqual(3);

    await trigger.focus();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowDown");
    const focused = custom.locator(`.custom-select-option[data-value="${values[1]}"]`);
    await expect(focused).toBeFocused();
    const selectedValue = await select.inputValue();

    // Simulate an asynchronous catalog refresh through the native select,
    // keeping the real shared MutationObserver and keyboard handlers active.
    await select.evaluate((element, value) => {
      [...element.options].find(option => option.value === value).textContent = "Updated option label";
      element.append(new Option("Unavailable option", "unavailable-option"));
      element.lastElementChild.disabled = true;
    }, values[1]);
    await expect(custom.locator('.custom-select-option[data-value="unavailable-option"]')).toBeDisabled();
    await expect(focused).toHaveText("Updated option label");
    await expect(focused).toBeFocused();
    await expect(custom).toHaveClass(/is-open/);
    await expect(select).toHaveValue(selectedValue);

    await page.keyboard.press("ArrowDown");
    await expect(custom.locator(`.custom-select-option[data-value="${values[2]}"]`)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(focused).toBeFocused();

    // Removing the focused option must leave focus in the same open control.
    await select.evaluate((element, value) => {
      [...element.options].find(option => option.value === value).remove();
    }, values[1]);
    await expect(custom.locator(`.custom-select-option[data-value="${selectedValue}"]`)).toBeFocused();
    await page.keyboard.press("End");
    await expect(custom.locator('.custom-select-option:not(:disabled)').last()).toBeFocused();
    await page.screenshot({ path: testInfo.outputPath(`${id}-updated-options.png`) });
    await page.keyboard.press("Escape");
    await expect(custom).not.toHaveClass(/is-open/);
    await expect(trigger).toBeFocused();
  });
}

test("disabled select options keep their inactive appearance under the pointer", async ({ page }) => {
  await openControls(page, "/uart.html");
  const select = page.locator("#baudRate");
  const custom = page.locator("#baudRate + .custom-select");
  await select.evaluate(element => {
    const option = new Option("Unavailable baud rate", "unavailable-rate");
    option.disabled = true;
    element.prepend(option);
  });
  await custom.locator(".custom-select-trigger").click();
  const unavailable = custom.locator('.custom-select-option[data-value="unavailable-rate"]');
  await expect(unavailable).toBeDisabled();
  const appearance = locator => locator.evaluate(element => {
    const style = getComputedStyle(element);
    return { border: style.borderTopColor, background: style.backgroundColor };
  });
  const idle = await appearance(unavailable);
  await unavailable.hover();
  expect(await appearance(unavailable)).toEqual(idle);
  await page.mouse.click(...await unavailable.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return [bounds.x + bounds.width / 2, bounds.y + bounds.height / 2];
  }));
  await expect(select).toHaveValue("115200");
  await expect(custom).toHaveClass(/is-open/);

  const available = custom.locator('.custom-select-option[data-value="9600"]');
  await available.hover();
  await expect.poll(() => appearance(available)).not.toEqual(idle);
  await page.keyboard.press("Escape");
});

async function installUartAdapter(page) {
  await page.addInitScript(() => {
    const writes = [];
    let pendingRead = null;
    const port = {
      getInfo: () => ({ usbVendorId: 0x0403, usbProductId: 0x6001 }),
      open: async () => {},
      close: async () => {},
      readable: { getReader: () => ({
        read: () => new Promise(resolve => { pendingRead = resolve; }),
        cancel: async () => { pendingRead?.({ done: true }); pendingRead = null; },
        releaseLock() {},
      }) },
      writable: { getWriter: () => ({
        write: async bytes => { writes.push([...bytes]); },
        releaseLock() {},
      }) },
    };
    Object.defineProperty(navigator, "serial", { configurable: true, value: {
      requestPort: async () => port,
      getPorts: async () => [port],
    } });
    window.__controlUartWrites = writes;
  });
}

async function openConnectedUart(page) {
  await installUartAdapter(page);
  await openControls(page, "/uart.html");
  await page.locator("#connectBtn").click();
  await expect(page.locator("#uartTxSession")).toHaveAttribute("aria-disabled", "false");
  await expect(page.locator("#terminalInput")).toBeEnabled();
}

async function expectProxyFocus(input) {
  await expect(input).toBeFocused();
  await expect.poll(() => input.evaluate(element => {
    const style = getComputedStyle(element.nextElementSibling);
    return [style.outlineStyle, style.outlineWidth];
  })).toEqual(["solid", "2px"]);
}

test("UART checkboxes and log scrolling use the keyboard while retaining ASCII sending", async ({ page }, testInfo) => {
  await openConnectedUart(page);
  await page.locator('input[name="txMode"][value="ascii"]').focus();
  await page.keyboard.press("Tab");
  const autoScroll = page.locator("#autoScrollCheckbox");
  await expectProxyFocus(autoScroll);
  await expect(autoScroll).toBeChecked();
  await page.keyboard.press("Space");
  await expect(autoScroll).not.toBeChecked();

  await page.keyboard.press("Tab");
  const showTime = page.locator("#timestampCheckbox");
  await expectProxyFocus(showTime);
  await page.keyboard.press("Space");
  await expect(showTime).toBeChecked();

  await page.keyboard.press("Tab");
  const cycle = page.locator("#cycleCheckbox");
  await expectProxyFocus(cycle);
  await page.keyboard.press("Space");
  await expect(cycle).toBeChecked();
  await page.screenshot({ path: testInfo.outputPath("uart-checkbox-keyboard-focus.png") });
  await page.keyboard.press("Space");
  await expect(cycle).not.toBeChecked();
  expect(await page.evaluate(() => window.__controlUartWrites)).toEqual([]);

  await page.locator("#terminalInput").fill("Hi");
  await page.locator("#sendBtn").click();
  await expect.poll(() => page.evaluate(() => window.__controlUartWrites)).toEqual([[72, 105, 13, 10]]);

  // Populate the real log renderer without producing additional serial writes.
  await page.evaluate(() => {
    const log = document.getElementById("terminalSent");
    for (let index = 0; index < 100; index++) addToTerminal("sent", `Keyboard log row ${index}`, log);
  });
  // From Run, the existing Clear and Save controls precede the log region.
  await page.keyboard.press("Tab");
  await expect(page.locator("#clearBtn")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.locator("#saveLogBtn")).toBeFocused();
  await page.keyboard.press("Tab");
  const log = page.locator("#terminalSent");
  await expect(log).toBeFocused();
  expect(await log.evaluate(element => getComputedStyle(element).boxShadow)).toContain("inset");
  await page.keyboard.press("PageDown");
  await expect.poll(() => log.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__controlUartWrites)).toEqual([[72, 105, 13, 10]]);
});

test("UART radio arrows change native groups and retain Generator and RX synchronization", async ({ page }, testInfo) => {
  await openConnectedUart(page);
  const data = page.locator('input[name="txView"][value="text"]');
  const generator = page.locator('input[name="txView"][value="generator"]');
  await data.focus();
  await page.keyboard.press("ArrowRight");
  await expect(generator).toBeChecked();
  await expectProxyFocus(generator);
  await expect(page.locator("#txGeneratorPanel")).toBeVisible();
  await expect(page.locator('input[name="rxView"][value="oscilloscope"]')).toBeChecked();
  await expect(page.locator("#cycleCheckbox")).toBeChecked();
  await expect(page.locator("#loopIntervalInput")).toHaveValue("10");

  await page.keyboard.press("Tab");
  const unsigned = page.locator('input[name="genSignMode"][value="unsigned"]');
  const signed = page.locator('input[name="genSignMode"][value="signed"]');
  await expectProxyFocus(unsigned);
  await page.keyboard.press("ArrowRight");
  await expect(signed).toBeChecked();
  await expectProxyFocus(signed);
  await page.keyboard.press("Tab");
  const oneByte = page.locator('input[name="genByteSize"][value="1"]');
  const twoBytes = page.locator('input[name="genByteSize"][value="2BE"]');
  await expectProxyFocus(oneByte);
  await page.keyboard.press("ArrowRight");
  await expect(twoBytes).toBeChecked();
  await expectProxyFocus(twoBytes);
  await expect(page.locator('input[name="byteSize"][value="2BE"]')).toBeChecked();
  await page.screenshot({ path: testInfo.outputPath("uart-radio-keyboard-focus.png") });

  await generator.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(data).toBeChecked();
  await expect(page.locator("#txTerminalShell")).toBeVisible();
  await expect(page.locator("#txGeneratorPanel")).toBeHidden();
  await expect(page.locator("#cycleCheckbox")).not.toBeChecked();
  await expect(page.locator("#loopIntervalInput")).toHaveValue("1000");
  expect(await page.evaluate(() => window.__controlUartWrites)).toEqual([]);
});

test("scrollbars stay transparent and arrowless across document, chat, editor, menu, dialog and UART scrolling", async ({ page }, testInfo) => {
  const transparent = "rgba(0, 0, 0, 0)";
  const check = async (region, { axis = "y", scroll = true, background = false } = {}) => {
    await expect(region).toBeVisible();
    if (scroll) await expect.poll(() => region.evaluate((element, axis) => axis === "x"
      ? element.scrollWidth - element.clientWidth : element.scrollHeight - element.clientHeight, axis)).toBeGreaterThan(0);
    const result = await region.evaluate((element, axis) => {
      const style = getComputedStyle(element);
      const scrollbar = getComputedStyle(element, "::-webkit-scrollbar");
      const track = getComputedStyle(element, "::-webkit-scrollbar-track");
      const corner = getComputedStyle(element, "::-webkit-scrollbar-corner");
      const thumb = getComputedStyle(element, "::-webkit-scrollbar-thumb");
      const button = getComputedStyle(element, "::-webkit-scrollbar-button");
      const overflow = axis === "x" ? element.scrollWidth - element.clientWidth : element.scrollHeight - element.clientHeight;
      if (axis === "x") element.scrollLeft = element.scrollWidth;
      else element.scrollTop = element.scrollHeight;
      return { track: track.backgroundColor, corner: corner.backgroundColor, thumb: thumb.backgroundColor,
        size: axis === "x" ? scrollbar.height : scrollbar.width,
        button: [button.display, button.width, button.height],
        colors: style.scrollbarColor, background: style.backgroundColor, width: style.scrollbarWidth,
        overflow, position: axis === "x" ? element.scrollLeft : element.scrollTop };
    }, axis);
    expect(result.track).toBe(transparent);
    expect(result.corner).toBe(transparent);
    expect(result.thumb).toBe("rgba(70, 255, 120, 0.55)");
    expect(parseFloat(result.size), "Chromium needs a styled base pseudo-element to paint a custom scrollbar").toBeGreaterThan(0);
    expect(result.button).toEqual(["none", "0px", "0px"]);
    expect(result.colors, "allow Chromium to draw the custom scrollbar").toBe("auto");
    expect(result.width, "allow Chromium to use the custom scrollbar dimensions").toBe("auto");
    if (background) expect(result.background).toBe(transparent);
    if (scroll) {
      expect(result.overflow, "exercise a real overflowing scroll region").toBeGreaterThan(0);
      expect(result.position, "the region remains scrollable").toBeGreaterThan(0);
    }
    return result;
  };

  await page.route("**/api/avr/ai/chat", async route => {
    const input = route.request().postDataJSON();
    const message = Array.from({ length: 80 }, (_, index) => `Paragraph ${index}: Keep the clock and UART configuration consistent.`).join("\n\n");
    await route.fulfill({ json: { ok: true, kind: "chat", stage: "chat", baseRevision: input.canvas.revision, message } });
  });
  await openControls(page, "/avr");
  await page.waitForFunction(() => window.UartDebugAvrMiniProjects);
  await page.evaluate(async () => {
    const { project } = await (await fetch("/api/avr/ai/projects/motion-example")).json();
    await window.UartDebugAvrMiniProjects.install(project);
  });
  await page.locator("#projectChatInput").fill("Explain the UART configuration.");
  await page.locator("#projectChatSendBtn").click();
  await expect(page.locator('#projectChatThread .project-chat-message[data-role="assistant"]')).toContainText("Paragraph 79");
  await check(page.locator("#projectChatThread"));
  await page.locator("#projectChatInput").fill(Array.from({ length: 40 }, (_, index) => `Unsent draft line ${index}`).join("\n"));
  await check(page.locator("#projectChatInput"));
  await check(page.locator("#editorHost .CodeMirror-vscrollbar"), { background: true });
  await check(page.locator("#editorHost .CodeMirror-hscrollbar"), { axis: "x", background: true });
  for (const filler of [".CodeMirror-scrollbar-filler", ".CodeMirror-gutter-filler"]) {
    await expect(page.locator(`#editorHost ${filler}`)).toHaveCSS("background-color", transparent);
  }
  await page.mouse.move(0, 0);
  await page.screenshot({ path: testInfo.outputPath("transparent-scrollbars-avr.png") });

  const custom = page.locator("#mcuSelect + .custom-select");
  await custom.locator(".custom-select-trigger").click();
  await check(custom.locator(".custom-select-list"));
  await page.mouse.move(0, 0);
  await page.screenshot({ path: testInfo.outputPath("transparent-scrollbars-menu.png") });
  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    const id = window.UartDebugNotifications.notify({ title: "Connection stages", message: "Operation completed.",
      details: Array.from({ length: 100 }, (_, index) => `[20:53:08] Verified page ${index + 1}/100`).join("\n"), tone: "success" });
    window.UartDebugNotifications.open(id);
  });
  await check(page.locator(".notification-detail-output"));
  await page.mouse.move(0, 0);
  await page.screenshot({ path: testInfo.outputPath("transparent-scrollbars-dialog.png") });
  await page.keyboard.press("Escape");

  await openConnectedUart(page);
  await page.evaluate(() => {
    const log = document.getElementById("terminalSent");
    for (let index = 0; index < 100; index++) addToTerminal("sent", `UART scrolling row ${index}`, log);
  });
  await check(page.locator("#terminalSent"));
  await page.mouse.move(0, 0);
  await page.screenshot({ path: testInfo.outputPath("transparent-scrollbars-uart.png") });

  await page.goto("/privacy.html", { waitUntil: "load" });
  await expect(page).toHaveTitle(/Privacy/);
  await check(page.locator("html"));
  await page.mouse.move(0, 0);
  await page.screenshot({ path: testInfo.outputPath("transparent-scrollbars-document.png") });
});
