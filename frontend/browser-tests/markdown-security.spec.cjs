"use strict";

const { test, expect } = require("playwright/test");

test("legacy Markdown highlighting bounds malformed long lines without changing the document or following tokens", async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/avr", { waitUntil: "load" });
  await page.waitForFunction(() => window.CodeMirror && window.UartDebugMarkdown);
  const result = await page.evaluate(() => {
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;left:-9999px;width:1px;height:1px";
    document.body.append(host);
    const malformed = "<" + "a@".repeat(20000);
    const source = ["*unclosed emphasis", malformed, "", "# Following heading", "<user@example.com>", "```", "int main(void) {}", "```", "Ordinary text"].join("\n");
    const started = performance.now();
    const editor = CodeMirror(host, { value: source, mode: "markdown", lineNumbers: false });
    const large = editor.getTokenAt({ line: 1, ch: malformed.length });
    const elapsed = performance.now() - started;
    const heading = editor.getTokenAt({ line: 3, ch: 5 }).type;
    const link = editor.getTokenAt({ line: 4, ch: 8 }).type;
    const fenced = editor.getTokenAt({ line: 6, ch: 8 }).type;
    const afterFence = editor.getTokenAt({ line: 8, ch: 8 }).type;
    const preserved = editor.getValue() === source;
    const preview = document.createElement("div");
    UartDebugMarkdown.renderInto(preview, source);
    const previewPreserved = preview.textContent.includes(malformed);
    const previewLink = preview.querySelector('a[href="mailto:user@example.com"]')?.textContent;
    host.remove();
    return { large: { start: large.start, end: large.end, type: large.type }, inlineEm: large.state.em, elapsed, heading, link, fenced, afterFence,
      preserved, previewPreserved, previewLink, length: malformed.length };
  });
  expect(result.preserved && result.previewPreserved).toBe(true);
  expect(result.large).toEqual({ start: 0, end: result.length, type: null });
  expect(result.inlineEm).toBe(false);
  expect(result.elapsed).toBeLessThan(2000);
  expect(result.heading).toContain("header");
  expect(result.link).toContain("link");
  expect(result.fenced).toContain("comment");
  expect(result.afterFence).toBeNull();
  expect(result.previewLink).toBe("user@example.com");
  expect(errors).toEqual([]);
});

test("Markdown never turns hostile HTML or obfuscated executable links into live DOM", async ({ page }) => {
  await page.goto("/avr", { waitUntil: "load" });
  await page.waitForFunction(() => window.UartDebugMarkdown);
  const result = await page.evaluate(() => {
    const target = document.createElement("div"); document.body.append(target);
    window.__markdownSecurityExecuted = false;
    const payloads = [
      '<img src=x onerror="window.__markdownSecurityExecuted=true">',
      '<svg onload="window.__markdownSecurityExecuted=true"><script>window.__markdownSecurityExecuted=true</script></svg>',
      '<iframe srcdoc="<script>parent.__markdownSecurityExecuted=true</script>"></iframe>',
      '[link](javascript:window.__markdownSecurityExecuted=true)',
      '[link](java&#x73;cript:window.__markdownSecurityExecuted=true)',
      '[link](java&#x09;script:window.__markdownSecurityExecuted=true)',
      '[link](data:text/html,<script>window.__markdownSecurityExecuted=true</script>)',
      '![image](data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9ImFsZXJ0KDEpIi8+)',
      '<form name="UartDebugControls"><input name="openModal"></form>',
      '```html\n<script>window.__markdownSecurityExecuted=true</script>\n```',
    ];
    const failures = [];
    payloads.forEach((payload, index) => {
      UartDebugMarkdown.renderInto(target, payload, { allowImages: true });
      if (target.querySelector('script,iframe,svg,form,object,embed') ||
        [...target.querySelectorAll('*')].some(node => [...node.attributes].some(attribute => /^on/i.test(attribute.name))) ||
        [...target.querySelectorAll('a')].some(node => !['http:', 'https:', 'mailto:', 'tel:'].includes(new URL(node.href, location.href).protocol))) failures.push(index);
    });
    target.remove();
    return { failures, executed: window.__markdownSecurityExecuted };
  });
  expect(result).toEqual({ failures: [], executed: false });
});
