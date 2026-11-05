"use strict";

const path = require("node:path");
const os = require("node:os");
const { defineConfig } = require("playwright/test");

module.exports = defineConfig({
  testDir: __dirname,
  testMatch: "*.spec.cjs",
  fullyParallel: false,
  workers: 1,
  timeout: 20000,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  outputDir: process.env.UARTDEBUG_BROWSER_OUTPUT || path.join(os.tmpdir(), "uartdebug-browser-results"),
  use: {
    baseURL: "http://127.0.0.1:8766",
    browserName: "chromium",
    headless: true,
    viewport: { width: 1543, height: 884 },
    serviceWorkers: "block",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: process.env.UARTDEBUG_BROWSER_CHANNEL ? { channel: process.env.UARTDEBUG_BROWSER_CHANNEL } : {},
  },
  webServer: {
    command: "node fixture-server.cjs",
    url: "http://127.0.0.1:8766/health",
    reuseExistingServer: false,
    timeout: 10000,
  },
});
