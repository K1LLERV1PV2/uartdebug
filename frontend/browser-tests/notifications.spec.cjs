"use strict";

const { test, expect } = require("playwright/test");

test.beforeEach(async ({ page }) => {
  page.__notificationErrors = [];
  page.__notificationConsoleErrors = [];
  page.__expectsCompileFailure = false;
  page.on("pageerror", error => page.__notificationErrors.push(error.message));
  page.on("console", message => {
    const expectedHttpError = page.__expectsCompileFailure &&
      message.text() === "Failed to load resource: the server responded with a status of 422 (Unprocessable Entity)";
    if (message.type() === "error" && !message.text().startsWith("Compile server error:") && !expectedHttpError) {
      page.__notificationConsoleErrors.push(message.text());
    }
  });
});

test.afterEach(async ({ page }) => {
  expect(page.__notificationErrors).toEqual([]);
  expect(page.__notificationConsoleErrors).toEqual([]);
});

async function openWorkspace(page, { project = false, route = "/avr" } = {}) {
  await page.goto(route, { waitUntil: "load" });
  await expect(page).toHaveTitle(route === "/avr" ? "AVR Programming - Uart Debug" : /Uart Debug/);
  await page.waitForFunction(() => window.UartDebugNotifications && document.getElementById("notificationModal"));
  if (project) {
    await page.waitForFunction(() => window.UartDebugAvrMiniProjects);
    await page.evaluate(async () => {
      const { project } = await (await fetch("/api/avr/ai/projects/motion-example")).json();
      await window.UartDebugAvrMiniProjects.install(project);
    });
    await page.selectOption("#mcuSelect", "attiny1624");
    await expect(page.locator("#compileBtn")).toBeEnabled();
  }
  await page.evaluate(() => {
    for (const record of window.UartDebugNotifications.getAll()) window.UartDebugNotifications.dismiss(record.id);
  });
}

test("Compile updates one operation toast and retains full diagnostics for later history", async ({ page }, testInfo) => {
  await openWorkspace(page, { project: true });
  page.__expectsCompileFailure = true;
  const requests = [];
  await page.route("**/api/avr/compile", async route => {
    await new Promise(resolve => {
      requests.push(async failed => {
        const filename = route.request().postDataJSON().filename;
        const stderr = `${filename}:7:3: error: Primary diagnostic\n${filename}:11:2: error: Secondary diagnostic must be retained`;
        await route.fulfill({ status: failed ? 422 : 200, contentType: "application/json", body: JSON.stringify(failed
          ? { ok: false, failed_file: filename, compile_stderr: stderr, compile_stdout: "Compiler command and context" }
          : { ok: true, hex: ":0100000000FF\n:00000001FF", hex_name: "motion.hex", compile_stdout: "Build completed with complete output" }) });
        resolve();
      });
    });
  });

  await page.locator("#compileBtn").click();
  await expect.poll(() => requests.length).toBe(1);
  await expect.poll(() => page.evaluate(() => window.UartDebugNotifications.getAll().filter(record => record.title === "Compilation").length)).toBe(1);
  expect(await page.evaluate(() => window.UartDebugNotifications.getAll().find(record => record.title === "Compilation").pending)).toBe(true);
  await expect(page.locator(".notification-toast-open").filter({ hasText: "Compilation" })).toHaveCount(1);
  await requests[0](false);
  await expect(page.locator("#compileBtn")).toBeEnabled();
  await expect.poll(() => page.evaluate(() => window.UartDebugNotifications.getAll().find(record => record.title === "Compilation").tone)).toBe("success");
  await expect.poll(() => page.evaluate(() => window.UartDebugNotifications.getAll().find(record => record.title === "Compilation").details)).toContain("HEX loaded: motion.hex");
  expect(await page.evaluate(() => window.UartDebugNotifications.getAll().filter(record => record.title === "HEX image").length)).toBe(0);
  await expect(page.locator("#compileLog,.compile-log-frame")).toHaveCount(0);

  await page.locator("#compileBtn").click();
  await expect.poll(() => requests.length).toBe(2);
  await expect.poll(() => page.evaluate(() => window.UartDebugNotifications.getAll().filter(record => record.title === "Compilation").length)).toBe(2);
  await requests[1](true);
  await expect(page.locator("#compileBtn")).toBeEnabled();
  const failedToast = page.locator('.notification-toast[data-tone="error"] .notification-toast-open').filter({ hasText: "Compilation" });
  await expect(failedToast).toContainText("Primary diagnostic");
  await failedToast.click();
  await expect(page.locator("#notificationModal")).toBeVisible();
  const details = page.locator(".notification-detail-output");
  await expect(details).toContainText("Secondary diagnostic must be retained");
  await expect(details).toContainText("Compiler command and context");
  await expect(page.locator("#editorHost .compile-error-line")).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath("compiler-notification-details.png") });
  await page.keyboard.press("Escape");
  await expect(page.locator("#notificationModal")).toBeHidden();
  await expect(failedToast).toBeFocused();
  await page.locator("#notificationsBtn").click();
  await expect(page.locator(".notification-history-item").filter({ hasText: "Compilation" })).toHaveCount(2);
  await expect(details).toContainText("Secondary diagnostic must be retained");
  await page.keyboard.press("Escape");
  await expect(page.locator("#notificationsBtn")).toBeFocused();
});

test("toast stack is bounded, keyed progress updates in place and untrusted output stays plain text", async ({ page }) => {
  await openWorkspace(page);
  const baseline = await page.evaluate(() => window.UartDebugNotifications.getAll().length);
  const id = await page.evaluate(() => {
    const api = window.UartDebugNotifications;
    for (let index = 0; index < 4; index += 1) api.notify({ key: `bounded-${index}`, title: `Notice ${index}`, message: `Message ${index}` });
    const id = api.notify({ key: "live-operation", title: "Live operation", message: "Starting", details: "First line", pending: true });
    for (let index = 0; index < 40; index += 1) api.append(id, `Diagnostic ${index}`, { message: `Page ${index}` });
    return id;
  });
  const operation = page.locator(".notification-toast-open").filter({ hasText: "Live operation" });
  await expect(operation).toHaveCount(1);
  await operation.locator("..").getByRole("button", { name: "Dismiss notification" }).click();
  await page.evaluate(id => {
    window.UartDebugNotifications.append(id, "Another diagnostic", { message: "Page 41" });
    window.UartDebugNotifications.notify({ id, message: "Page 42", pending: true });
  }, id);
  await expect(operation).toHaveCount(0);
  const repeatedId = await page.evaluate(id => {
    const api = window.UartDebugNotifications;
    api.notify({ id, message: '<img src="x" onerror="window.injected=true">', details: '</pre><script>window.injected=true</script>\nFinal output', tone: "success", pending: false });
    return api.notify({ id, message: '<img src="x" onerror="window.injected=true">' });
  }, id);
  expect(repeatedId).toBe(id);
  await expect(page.locator(".notification-toast")).toHaveCount(3);
  expect(await page.evaluate(() => window.UartDebugNotifications.getAll().length)).toBe(baseline + 5);
  await expect(operation).toHaveCount(1);
  await expect(operation).toContainText('<img src="x"');
  await operation.click();
  await expect(page.locator(".notification-detail-output")).toContainText("<script>window.injected=true</script>");
  await expect(page.locator(".notification-toast img,.notification-detail img,.notification-detail script")).toHaveCount(0);
  expect(await page.evaluate(() => window.injected)).toBeUndefined();
  await page.keyboard.press("Escape");
  await operation.locator("..").getByRole("button", { name: "Dismiss notification" }).click();
  await expect(page.locator(".notification-toast")).toHaveCount(2);
  expect(await page.evaluate(() => window.UartDebugNotifications.getAll().length)).toBe(baseline + 5);
});

test("notification modal uses the shared dialog stack and returns to the underlying modal", async ({ page }) => {
  await openWorkspace(page);
  await page.locator("#filesOpenBtn").click();
  await expect(page.locator("#filesModal")).toBeVisible();
  await expect(page.locator("#createEmptyProjectCard")).toBeVisible();
  await page.evaluate(() => window.UartDebugNotifications.notify({ key: "nested", title: "Nested notice", message: "Open the details while Projects remains open." }));
  await page.locator(".notification-toast-open").filter({ hasText: "Nested notice" }).click();
  await expect(page.locator("#notificationModal")).toBeVisible();
  await expect(page.getByRole("button", { name: "Close notifications", exact: true })).toBeFocused();
  const appearance = await page.evaluate(() => [
    document.querySelector("#filesModal .ui-dialog-card"), document.querySelector("#notificationModal .ui-dialog-card"),
  ].map(card => {
    const style = getComputedStyle(card);
    return [style.backgroundColor, style.borderTopColor, style.borderTopWidth, style.borderRadius];
  }));
  expect(appearance[0]).toEqual(appearance[1]);
  const columns = await page.evaluate(() => [
    document.querySelector("#filesModal .ui-dialog-card"), document.querySelector("#notificationModal .ui-dialog-card"),
  ].map(card => {
    const bounds = card.getBoundingClientRect(), header = card.querySelector(".ui-dialog-header").getBoundingClientRect();
    const body = card.querySelector(".ui-dialog-columns"), sidebar = body.querySelector(".ui-dialog-sidebar");
    const divider = sidebar.getBoundingClientRect(), bodyStyle = getComputedStyle(body);
    return { headerGap: divider.top - header.bottom, bottomGap: bounds.bottom - 1 - divider.bottom,
      border: getComputedStyle(sidebar).borderRightWidth, bodyPadding: bodyStyle.padding, gap: bodyStyle.columnGap,
      columnPadding: [...body.children].map(column => getComputedStyle(column).padding) };
  }));
  for (const column of columns) {
    expect(column.headerGap).toBeCloseTo(0, 1);
    expect(column.bottomGap).toBeCloseTo(0, 1);
    expect(column.border).toBe("1px");
    expect(column.bodyPadding).toBe("0px");
    expect(column.gap).toBe("0px");
    expect(column.columnPadding).toEqual(["18px", "18px"]);
  }
  await page.keyboard.press("Shift+Tab");
  expect(await page.evaluate(() => document.getElementById("notificationModal").contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => document.getElementById("notificationModal").contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.locator("#notificationModal")).toBeHidden();
  await expect(page.locator("#filesModal")).toBeVisible();
  await expect(page.locator("#createEmptyProjectCard")).toBeVisible();
  expect(await page.evaluate(() => document.getElementById("filesModal").contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.locator("#filesModal")).toBeHidden();
  await expect(page.locator("#filesOpenBtn")).toBeFocused();
});

test("session reload preserves read state and labels interrupted progress without toast replay", async ({ page }) => {
  await openWorkspace(page);
  const ids = await page.evaluate(() => {
    const api = window.UartDebugNotifications;
    const done = api.notify({ key: "session-done", title: "Session result", message: "Finished", tone: "success" });
    const pending = api.notify({ key: "session-pending", title: "Interrupted operation", message: "Page 1", details: "First page verified", pending: true });
    return { done, pending };
  });
  await page.locator(".notification-toast-open").filter({ hasText: "Session result" }).click();
  await expect.poll(() => page.evaluate(id => JSON.parse(sessionStorage.getItem("ud_notifications_session_v1") || "{}").records?.find(record => record.id === id)?.read, ids.done)).toBe(true);
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => window.UartDebugNotifications);
  const restored = await page.evaluate(ids => {
    const records = window.UartDebugNotifications.getAll();
    return { done: records.find(record => record.id === ids.done), pending: records.find(record => record.id === ids.pending) };
  }, ids);
  expect(restored.done.read).toBe(true);
  expect(restored.pending.pending).toBe(false);
  expect(restored.pending.tone).toBe("warning");
  expect(restored.pending.message).toBe("Operation interrupted by page reload.");
  await expect(page.locator(".notification-toast-open").filter({ hasText: /Session result|Interrupted operation/ })).toHaveCount(0);
  await page.locator("#notificationsBtn").click();
  await page.locator(".notification-history-item").filter({ hasText: "Interrupted operation" }).click();
  await expect(page.locator(".notification-detail-output")).toContainText("First page verified");
  expect(await page.evaluate(id => window.UartDebugNotifications.getAll().find(record => record.id === id).read, ids.pending)).toBe(true);
});

test("UART errors use the same toast details without contaminating serial data", async ({ page }) => {
  // The static fixture serves the same UART entry document directly.
  await openWorkspace(page, { route: "/uart.html" });
  await page.evaluate(() => addToTerminal("error", "UART read failed: adapter disconnected", document.getElementById("terminalReceived")));
  await expect(page.locator("#terminalReceived .terminal-line.error")).toHaveCount(0);
  await page.locator(".notification-toast-open").filter({ hasText: "UART read failed" }).click();
  await expect(page.locator("#notificationModal")).toBeVisible();
  await expect(page.locator(".notification-detail-summary")).toHaveText("UART read failed: adapter disconnected");
  await expect(page.locator(".notification-detail-output")).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(page.locator("#notificationModal")).toBeHidden();
});

test("a real signature echo timeout keeps technical logs in the console and shows actionable guidance", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 900, height: 700 });
  const consoleLog = [];
  page.on("console", message => { if (message.type() === "info") consoleLog.push(message.text()); });
  await page.addInitScript(() => {
    let resolveRead;
    window.__echoTimeoutPortClosed = 0;
    const serial = new EventTarget();
    const port = {
      open: async () => {}, close: async () => { window.__echoTimeoutPortClosed++; }, getInfo: () => ({}),
      readable: { getReader: () => ({
        read: () => new Promise(resolve => { resolveRead = resolve; }),
        cancel: async () => { resolveRead?.({ done: true }); }, releaseLock() {},
      }) },
      writable: { getWriter: () => ({ write: async () => {}, releaseLock() {} }) },
    };
    serial.requestPort = async () => port; serial.getPorts = async () => [port];
    Object.defineProperty(navigator, "serial", { configurable: true, value: serial });
  });
  await openWorkspace(page);
  await page.locator("#detectChipBtn").click();
  const toast = page.locator('.notification-toast[data-tone="error"] .notification-toast-open').filter({ hasText: "Chip detection" });
  await expect(toast).toContainText("Could not establish communication with the chip");
  await expect(toast).not.toContainText(/Timed out|waitForBuffer|updi-test\.js/);
  expect(await page.evaluate(() => window.__echoTimeoutPortClosed)).toBe(1);
  await toast.click();
  await expect(page.locator(".notification-detail-output")).toContainText("Stage: communicating over UPDI");
  await expect(page.locator(".notification-detail-output")).toContainText("chip power");
  await expect(page.locator(".notification-detail")).not.toContainText(/waitForBuffer|updi-test\.js|Port closed/);
  await expect(page.locator(".notification-diagnostics, .notification-diagnostics-copy, .ui-disclosure")).toHaveCount(0);
  expect(consoleLog.join("\n")).toContain("waitForBuffer");
  expect(consoleLog.join("\n")).toContain("Port closed.");
  expect(await page.evaluate(() => JSON.stringify(window.UartDebugNotifications.getAll()))).not.toMatch(/waitForBuffer|updi-test\.js/);
  await page.mouse.move(0, 0);
  await page.screenshot({ path: testInfo.outputPath("signature-error-guidance-900.png") });
});

test("UART also omits old call stacks from notifications and saved history while retaining them in DevTools", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 700 });
  await openWorkspace(page, { route: "/uart.html" });
  const logs = [];
  page.on("console", message => { if (message.type() === "info") logs.push(message.text()); });
  const id = await page.evaluate(() => window.UartDebugNotifications.notify({ key: null, title: "Serial connection", message: "The adapter disconnected.",
    details: "Error: Disconnected\n    at legacyReader (http://localhost/uart.js:100:2)",
    diagnostics: "Raw serial debugging context", tone: "error" }));
  await page.evaluate(id => window.UartDebugNotifications.open(id), id);
  await expect(page.locator(".notification-detail-summary")).toHaveText("The adapter disconnected.");
  await expect(page.locator(".notification-detail-output")).toBeHidden();
  await expect(page.locator(".notification-detail")).not.toContainText("legacyReader");
  await expect(page.getByText("Technical diagnostics", { exact: true })).toHaveCount(0);
  expect(logs.join("\n")).toContain("legacyReader");
  expect(logs.join("\n")).toContain("Raw serial debugging context");
  const logCount = logs.length;
  await page.evaluate(id => window.UartDebugNotifications.open(id), id);
  expect(logs.length).toBe(logCount);
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("ud_notifications_session_v1"))).not.toBeNull();
  expect(await page.evaluate(() => sessionStorage.getItem("ud_notifications_session_v1"))).not.toMatch(/legacyReader|Raw serial|"diagnostics"/);
});
