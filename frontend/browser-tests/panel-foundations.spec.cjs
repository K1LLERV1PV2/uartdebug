"use strict";

const { test, expect } = require("playwright/test");

test.beforeEach(async ({ page }) => {
  page.__panelErrors = [];
  page.on("pageerror", error => page.__panelErrors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error") page.__panelErrors.push(message.text());
  });
});
test.afterEach(async ({ page }) => { expect(page.__panelErrors).toEqual([]); });

const pages = [
  { route: "/avr", title: "AVR Programming - Uart Debug", surfaces: [
    ".avr-device-panel", ".avr-action-card", ".avr-account-panel", ".project-chat-panel",
    ".project-instruction-panel", "#editorWorkspace", "#projectDocumentationPane",
    "#projectInstructionDropZone", ".editor-container", "#projectDocumentationScroll", "#projectChatForm",
    "#filesModal .ui-dialog-card", "#projectAiAccountCard",
    "#siteDialog .ui-dialog-card", "#notificationModal .ui-dialog-card",
    "#mcuSelect + .custom-select .custom-select-menu",
    "#fileContextMenu",
  ] },
  { route: "/uart.html", title: "UART Terminal - Uart Debug", surfaces: [
    ".terminal-device-panel", "#uartTxSession", "#uartRxSession", "#terminalSent", "#terminalReceived",
    "#txGeneratorPanel", "#oscilloscopeContainer", "#settingsModal .ui-dialog-card",
    "#notificationModal .ui-dialog-card", "#baudRate + .custom-select .custom-select-menu",
  ] },
  { route: "/", title: "Uart Debug", surfaces: [".avr-card", ".uart-card"] },
  { route: "/privacy.html", title: "Privacy Policy - Uart Debug", surfaces: [".legal-document"] },
  { route: "/terms.html", title: "Terms of Service - Uart Debug", surfaces: [".legal-document"] },
];

for (const { route, title, surfaces } of pages) {
  test(`${route} uses the shared frame contract without copied page borders`, async ({ page }, testInfo) => {
    await page.goto(route, { waitUntil: "load" });
    await expect(page).toHaveTitle(title);
    await expect(page.locator('link[rel="stylesheet"][href*="ui-controls.css"]')).toHaveCount(1);
    if (route === "/avr" || route === "/uart.html") {
      await page.waitForFunction(() => window.UartDebugNotifications && document.getElementById("notificationModal"));
    }
    // Probe the frame tokens at rest; motion has separate interaction tests.
    await page.addStyleTag({ content: "* { transition: none !important; animation: none !important; }" });
    await page.evaluate(() => document.activeElement?.blur());
    await page.waitForFunction(() => !document.querySelector(".CodeMirror-focused"));
    const contracts = await page.evaluate(selectors => selectors.map(selector => {
      const element = document.querySelector(selector);
      if (!element) return { selector, missing: true };
      const shared = element.matches(".ui-panel, .scroll-frame, .ui-dialog-card, .custom-select-menu");
      const previous = element.getAttribute("style");
      // Exercise the documented per-surface configuration. A page which still
      // draws its own border/background cannot consume these shared tokens.
      element.style.setProperty("--ui-panel-border", "rgb(111, 122, 133)");
      element.style.setProperty("--ui-panel-radius", "19px");
      element.style.setProperty("--ui-panel-bg", "rgb(22, 33, 44)");
      element.style.setProperty("--ui-panel-shadow", "rgb(9, 18, 27) 0px 0px 0px 1px");
      const style = getComputedStyle(element);
      const result = { selector, shared, border: style.borderTopColor, borderWidth: style.borderTopWidth,
        radius: style.borderTopLeftRadius, background: style.backgroundColor, shadow: style.boxShadow };
      if (previous === null) element.removeAttribute("style");
      else element.setAttribute("style", previous);
      return result;
    }), surfaces);
    for (const actual of contracts) {
      expect(actual, actual.selector).toEqual({ selector: actual.selector, shared: true,
        border: "rgb(111, 122, 133)", borderWidth: "1px", radius: "19px", background: "rgb(22, 33, 44)",
        shadow: "rgb(9, 18, 27) 0px 0px 0px 1px" });
    }
    // Static content gains the foundation, not artificial keyboard stops.
    if (route === "/") await expect(page.locator(".nav-card[tabindex]")).toHaveCount(0);
    if (route.includes("privacy") || route.includes("terms")) {
      await expect(page.locator(".legal-document[tabindex]")).toHaveCount(0);
    }
    await page.screenshot({ path: testInfo.outputPath(`shared-panels-${route.replace(/\W/g, "_") || "home"}.png`) });
  });
}

test("nested window variants inherit theme values without inheriting a parent's frame configuration", async ({ page }) => {
  await page.goto("/uart.html", { waitUntil: "load" });
  const nested = await page.evaluate(() => {
    const parent = document.createElement("section");
    parent.className = "ui-dialog-card";
    parent.hidden = true;
    // Theme values deliberately flow into every descendant component; this
    // individual dialog's frame variant must stop at the component boundary.
    for (const [key, value] of Object.entries({
      "--ui-border": "rgb(111, 122, 133)", "--ui-radius": "17px", "--ui-window-bg": "rgb(22, 33, 44)",
      "--ui-panel-border": "rgb(1, 2, 3)", "--ui-panel-radius": "31px", "--ui-panel-bg": "rgb(4, 5, 6)",
      "--ui-panel-shadow": "rgb(7, 8, 9) 0px 0px 0px 3px",
    })) parent.style.setProperty(key, value);
    const panel = document.createElement("section"); panel.className = "ui-panel";
    const frame = document.createElement("div"); frame.className = "scroll-frame";
    panel.append(frame); parent.append(panel); document.body.append(parent);
    const read = element => {
      const style = getComputedStyle(element);
      return { border: style.borderTopColor, radius: style.borderTopLeftRadius,
        background: style.backgroundColor, shadow: style.boxShadow };
    };
    const result = { parent: read(parent), panel: read(panel), frame: read(frame) };
    parent.remove();
    return result;
  });
  expect(nested.parent).toEqual({ border: "rgb(1, 2, 3)", radius: "31px", background: "rgb(4, 5, 6)",
    shadow: "rgb(7, 8, 9) 0px 0px 0px 3px" });
  const themedDefault = { border: "rgb(111, 122, 133)", radius: "17px", background: "rgb(22, 33, 44)", shadow: "none" };
  expect(nested.panel).toEqual(themedDefault);
  expect(nested.frame).toEqual(themedDefault);
});

test("chat has one readonly scroll focus indicator and native PageDown scrolling", async ({ page }) => {
  await page.route("**/api/avr/ai/chat", async route => {
    const request = route.request().postDataJSON();
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({
      ok: true, kind: "chat", stage: "chat", baseRevision: request.canvas.revision,
      message: Array.from({ length: 90 }, (_, index) => `Paragraph ${index}: Review the project requirements before generating firmware.`).join("\n\n"),
    }) });
  });
  await page.goto("/avr", { waitUntil: "load" });
  await expect(page.locator("#projectChatInput")).toBeVisible();
  await page.locator("#projectChatInput").fill("Explain the firmware requirements in detail.");
  await page.locator("#projectChatInput").press("Enter");
  await expect(page.locator('.project-chat-message[data-role="assistant"]')).toContainText("Paragraph 89");
  const thread = page.locator("#projectChatThread");
  await expect(thread).toHaveClass(/ui-scroll-region/);
  await thread.focus();
  await page.keyboard.press("Home");
  await expect.poll(() => thread.evaluate(element => element.scrollTop)).toBe(0);
  await expect(thread).toBeFocused();
  expect(await thread.evaluate(element => getComputedStyle(element).boxShadow)).toContain("inset");
  expect(await page.locator(".project-chat-panel").evaluate(element => getComputedStyle(element).boxShadow)).toBe("none");
  await page.keyboard.press("PageDown");
  await expect.poll(() => thread.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
});

test("notification details share readonly scrolling without activating the modal frame", async ({ page }, testInfo) => {
  await page.goto("/uart.html", { waitUntil: "load" });
  await page.waitForFunction(() => window.UartDebugNotifications);
  await page.evaluate(() => window.UartDebugNotifications.notify({ key: "shared-scroll-contract",
    title: "Long diagnostic", message: "Inspect the complete diagnostic output.",
    details: Array.from({ length: 100 }, (_, index) => `Diagnostic row ${index}`).join("\n"),
  }));
  await page.locator(".notification-toast-open").filter({ hasText: "Long diagnostic" }).click();
  expect(await page.locator(".notification-detail pre").evaluate(element => getComputedStyle(element).boxShadow)).toBe("none");
  const card = page.locator("#notificationModal .ui-dialog-card");
  const initial = await card.evaluate(element => {
    const style = getComputedStyle(element);
    return [style.borderTopColor, style.boxShadow];
  });
  await page.keyboard.press("Tab");
  await expect(page.locator(".notification-history-item").filter({ hasText: "Long diagnostic" })).toBeFocused();
  const details = page.locator(".notification-detail pre");
  const historyLength = await page.locator(".notification-history-item").count();
  for (let index = 0; index < historyLength && !await details.evaluate(element => element === document.activeElement); index++) {
    await page.keyboard.press("Tab");
  }
  await expect(details).toBeFocused();
  await expect(details).toHaveClass(/scroll-frame/);
  await expect(details).toHaveClass(/ui-scroll-region/);
  expect(await details.evaluate(element => getComputedStyle(element).boxShadow)).toContain("inset");
  expect(await card.evaluate(element => {
    const style = getComputedStyle(element);
    return [style.borderTopColor, style.boxShadow];
  })).toEqual(initial);
  await page.keyboard.press("PageDown");
  await expect.poll(() => details.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await page.screenshot({ path: testInfo.outputPath("shared-notification-scroll-focus.png") });
  await page.keyboard.press("Escape");
  await expect(page.locator("#notificationModal")).toBeHidden();
});

test("code completion uses the shared popup frame and retains its editor interaction", async ({ page }) => {
  await page.goto("/avr", { waitUntil: "load" });
  await page.waitForFunction(() => window.UartDebugAvrMiniProjects);
  await page.evaluate(async () => {
    const { project } = await (await fetch("/api/avr/ai/projects/motion-example")).json();
    await window.UartDebugAvrMiniProjects.install(project);
    const cm = document.querySelector("#editorHost .CodeMirror").CodeMirror;
    cm.setValue("int main(void) {\n  PO\n}\n// PORTA and PORTB are device ports");
    cm.setCursor({ line: 1, ch: 4 });
    cm.focus();
  });
  await page.keyboard.press("Control+Space");
  const popup = page.locator(".CodeMirror-hints");
  await expect(popup).toBeVisible();
  const actual = await popup.evaluate(element => {
    element.style.setProperty("--ui-panel-border", "rgb(111, 122, 133)");
    element.style.setProperty("--ui-panel-radius", "19px");
    element.style.setProperty("--ui-panel-bg", "rgb(22, 33, 44)");
    const style = getComputedStyle(element);
    return [style.borderTopColor, style.borderTopLeftRadius, style.backgroundColor];
  });
  expect(actual).toEqual(["rgb(111, 122, 133)", "19px", "rgb(22, 33, 44)"]);
  await popup.locator(".CodeMirror-hint").filter({ hasText: /^PORTB$/ }).click();
  await expect(popup).toBeHidden();
  await expect.poll(() => page.locator("#editorHost .CodeMirror").evaluate(element => element.CodeMirror.getLine(1))).toContain("PORTB");
  await expect(page.locator("#editorHost .CodeMirror")).toHaveClass(/CodeMirror-focused/);
});
