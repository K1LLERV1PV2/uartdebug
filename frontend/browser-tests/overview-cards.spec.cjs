"use strict";

const { test, expect } = require("playwright/test");

test("overview cards show the active project and latest notification in their clickable detail rows", async ({ page }) => {
  await page.goto("/avr");
  await page.waitForFunction(() => window.UartDebugAvrMiniProjects && window.UartDebugNotifications);
  await expect(page.locator("#currentProjectCardDetail")).toHaveCSS("visibility", "hidden");
  await expect(page.locator("#latestNotificationCardDetail")).toHaveCSS("visibility", "hidden");
  await page.evaluate(async () => {
    const { project } = await (await fetch("/api/avr/ai/projects/motion-example")).json();
    await window.UartDebugAvrMiniProjects.install(project);
    window.UartDebugNotifications.notify({ title: "Compile", message: "Older result", silent: true });
    const id = window.UartDebugNotifications.notify({ title: "Compile", message: "Built <example> successfully", tone: "success", silent: true });
    window.UartDebugNotifications.dismiss(id);
  });

  const projects = page.getByRole("button", { name: "Open projects", exact: true });
  const notifications = page.getByRole("button", { name: "Notifications", exact: true });
  const latest = page.locator("#latestNotificationCardDetail");
  await expect(projects).toHaveAccessibleDescription("Motion example");
  await expect(notifications).toHaveAccessibleDescription("Built <example> successfully");
  await expect(latest).toHaveText("Built <example> successfully");
  await expect(latest).toHaveAttribute("data-tone", "success");

  const creditStyle = await page.locator("#projectAiBudgetValue").evaluate(output => {
    const { color, fontWeight } = getComputedStyle(output);
    return { color, fontWeight };
  });
  for (const detail of await page.locator(".avr-card-detail").all()) {
    await expect(detail).toHaveCSS("color", creditStyle.color);
    await expect(detail).toHaveCSS("font-weight", creditStyle.fontWeight);
    await expect(detail).toHaveCSS("text-overflow", "ellipsis");
    await expect(detail).toBeVisible();
  }

  for (const [card, detailId, modalId] of [
    [projects, "currentProjectCardDetail", "filesModal"],
    [notifications, "latestNotificationCardDetail", "notificationModal"],
  ]) {
    const point = await page.locator(`#${detailId}`).boundingBox();
    await page.mouse.click(point.x + 3, point.y + point.height / 2);
    await expect(page.locator(`#${modalId}`)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(`#${modalId}`)).toBeHidden();
    await expect(card).toBeFocused();
  }

  await page.reload();
  await expect(projects).toHaveAccessibleDescription("Motion example");
  await expect(notifications).toHaveAccessibleDescription("Built <example> successfully");

  await page.evaluate(() => window.addEventListener("pagehide", () => {
    sessionStorage.removeItem("ud_notifications_session_v1");
  }, { once: true }));
  await page.reload();
  await expect(projects).toHaveAccessibleDescription("Motion example");
  await expect(latest).toHaveCSS("visibility", "hidden");
  await expect(latest).not.toHaveAttribute("data-tone", /./);
  await expect(notifications).toHaveAccessibleDescription("");
});

for (const signedIn of [false, true]) {
  test(`overview card titles line up in expanded and compact mode, ${signedIn ? "signed in" : "signed out"}`, async ({ page }, testInfo) => {
    await page.route("**/api/avr/ai/auth/session", route => route.fulfill({ json: {
      ok: true, mode: "google", configured: true, authenticated: signedIn,
      ...(signedIn ? { accountKey: "overview-test", user: { displayName: "Example account" }, quota: { unlimited: true } } : {}),
    } }));
    await page.route("**/api/avr/ai/account/workspace**", route => route.fulfill({ json: route.request().method() === "PUT"
      ? { ok: true, document: { revision: 1, schemaVersion: 3 } }
      : { ok: true, accountKey: "overview-test", documents: { files: { revision: 0, data: null }, instruction: { revision: 0, data: null } } },
    }));
    await page.goto("/avr");
    const account = page.locator(".project-ai-account-trigger-label");
    await expect(account).toHaveText(signedIn ? "Example account" : "Continue with Google");
    await page.evaluate(() => document.fonts.ready);
    const section = page.locator("#avrDeviceSection");
    const handle = page.locator("#devicePanelToggle");
    for (const width of [1920, 1543, 900]) {
      await page.setViewportSize({ width, height: 884 });
      for (const [key, state] of [["End", "expanded"], ["ArrowUp", "compact"]]) {
        await handle.focus();
        await page.keyboard.press(key);
        await expect(section).toHaveAttribute("data-state", state);
        await expect(section).not.toHaveClass(/is-device-panel-transitioning/);
        const cards = await page.locator(".avr-action-title").evaluateAll(titles => titles.map(title => {
          const label = title.querySelector(":scope > span");
          const range = document.createRange();
          range.selectNodeContents(label);
          const lines = Array.from(range.getClientRects());
          const card = title.closest(".ui-panel").getBoundingClientRect();
          const labelBox = label.getBoundingClientRect();
          return { firstTop: lines[0].top, leftInset: labelBox.left - card.left, width: card.width, height: card.height, lines: lines.length,
            fullLabelVisible: lines.every(line => line.right <= labelBox.right + 1 && line.bottom <= card.bottom) };
        }));
        expect(cards).toHaveLength(3);
        for (const card of cards.slice(1)) {
          expect(card.firstTop).toBeCloseTo(cards[0].firstTop, 0);
          expect(card.leftInset).toBeCloseTo(cards[0].leftInset, 0);
          expect(card.width).toBeCloseTo(cards[0].width, 0);
          expect(card.height).toBeCloseTo(cards[0].height, 0);
        }
        if (!signedIn) {
          expect(cards[2].fullLabelVisible).toBe(true);
          expect(cards[2].lines).toBeLessThanOrEqual(width === 900 ? 2 : 1);
        }
        if (signedIn) await expect(page.locator("#projectAiBudgetValue")).toHaveText("Unlimited");
        if (width !== 1920) await page.locator(".avr-overview-row").screenshot({ path: testInfo.outputPath(`${width}-${state}.png`) });
      }
    }
  });
}
