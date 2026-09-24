"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  DOCUMENT_ROOTS,
  createDocumentationLookup,
  extractReference,
} = require("../backend/avr-documentation-lookup");
const url = DOCUMENT_ROOTS[0] + "GUID-TEST.html";
const args = {
  url,
  query: "USART BAUD",
  gap: "Local recipes lack the exact operating condition.",
};
const html =
  '<html><title>USART reference</title><main><h1>USART BAUD</h1><p>The USART BAUD register controls the fractional baud generator. Always check clock and sample count against device limits.</p><table><tr><th>Bit</th><th>Field</th></tr><tr><td>0</td><td>ENABLE</td></tr></table><script>malicious()</script><a href="GUID-NEXT.html">Next section</a><a href="https://example.com">Outside</a></main></html>';
const htmlResponse = () =>
  new Response(html, { headers: { "content-type": "text/html" } });
test("official lookup uses a matching local digest without external calls", async () => {
  let calls = 0;
  const lookup = createDocumentationLookup({
    localDocuments: [
      {
        url,
        title: "Local",
        text: "USART BAUD known local values",
        sha256: "digest",
      },
    ],
    fetch: async () => {
      calls++;
      return htmlResponse();
    },
  });
  const result = await lookup.lookup(args);
  assert.equal(result.origin, "local");
  assert.equal(result.verification, "source-only");
  assert.equal(calls, 0);
});
test("partial local digests do not hide a missing topic; fetched sections are cached", async (t) => {
  const cacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), "avr-docs-"));
  t.after(() => fs.rm(cacheRoot, { recursive: true, force: true }));
  let calls = 0;
  const options = {
    cacheRoot,
    localDocuments: [{ url, title: "Local", text: "USART only" }],
    fetch: async (_url, opts) => {
      calls++;
      assert.equal(opts.redirect, "error");
      return htmlResponse();
    },
  };
  const first = await createDocumentationLookup(options).lookup(args);
  assert.equal(first.origin, "web");
  assert.equal(first.digestScope, "raw-html-bytes");
  assert.match(first.sha256, /^[a-f0-9]{64}$/);
  assert.equal(first.links.length, 1);
  const second = await createDocumentationLookup(options).lookup(args);
  assert.equal(second.origin, "cache");
  assert.equal(calls, 1);
});
test("URL allowlist rejects nonofficial sources, other devices, credentials and parameters", async () => {
  let calls = 0;
  const lookup = createDocumentationLookup({
    fetch: async () => {
      calls++;
      return htmlResponse();
    },
  });
  for (const target of [
    "http://127.0.0.1/",
    "https://onlinedocs.microchip.com.evil.test/index.html",
    DOCUMENT_ROOTS[0] + "../../index.html",
    url + "?redirect=evil",
    "https://user:pass@onlinedocs.microchip.com/oxy/GUID-TEST/index.html",
    "file:///etc/passwd",
  ])
    assert.equal(
      (await lookup.lookup({ ...args, url: target })).code,
      "documentation_url_forbidden",
    );
  assert.equal(calls, 0);
});
test("required gap, external switch and per-request cap are enforced", async () => {
  let calls = 0;
  const lookup = createDocumentationLookup({
    maxRequests: 1,
    fetch: async () => {
      calls++;
      return htmlResponse();
    },
  });
  assert.equal(
    (await lookup.lookup({ ...args, gap: "" })).code,
    "knowledge_gap_required",
  );
  assert.equal((await lookup.lookup(args)).ok, true);
  assert.equal((await lookup.lookup(args)).code, "documentation_unavailable");
  assert.equal(calls, 1);
  assert.equal(
    (await createDocumentationLookup({ enabled: false }).lookup(args)).code,
    "documentation_unavailable",
  );
});
test("nonHTML, excessive response sizes and failed redirects produce no trusted result", async () => {
  for (const fetch of [
    async () =>
      new Response("binary", {
        headers: { "content-type": "application/pdf" },
      }),
    async () =>
      new Response(html, {
        headers: { "content-type": "text/html", "content-length": "800000" },
      }),
    async () =>
      new Response("x".repeat(750001), {
        headers: { "content-type": "text/html" },
      }),
    async () => {
      throw Error("redirect");
    },
  ])
    assert.equal(
      (await createDocumentationLookup({ fetch }).lookup(args)).code,
      "documentation_fetch_failed",
    );
});
test("HTML extraction retains table separators and only corpus links", () => {
  const value = extractReference(html, url, DOCUMENT_ROOTS);
  assert.match(value.text, /Bit \|/);
  assert.doesNotMatch(value.text, /malicious/);
  assert.deepEqual(value.links, [
    { title: "Next section", url: DOCUMENT_ROOTS[0] + "GUID-NEXT.html" },
  ]);
});

test("a non-ASCII query does not treat a partial local digest as complete", async () => {
  let calls = 0;
  const lookup = createDocumentationLookup({
    localDocuments: [{ url, title: "Partial", text: "Known UART basics" }],
    fetch: async () => {
      calls++;
      return htmlResponse();
    },
  });
  assert.equal(
    (await lookup.lookup({ ...args, query: "ошибки приёма" })).origin,
    "web",
  );
  assert.equal(calls, 1);
});

test("parsed references retain encoded code text and navigation links without active markup", () => {
  const value = extractReference(
    '<title>Clock &amp; UART</title><nav><a href="GUID-CLOCK.html">Clock section</a></nav><main><p>if (value &lt; 3) &amp;&amp; ready</p><script>ignore_me()</script><p data-example=">">End</p></main>',
    url,
    DOCUMENT_ROOTS,
  );
  assert.equal(value.title, "Clock & UART");
  assert.match(value.text, /value < 3/);
  assert.doesNotMatch(value.text, /ignore_me|<p|<script/);
  assert.equal(value.links[0].title, "Clock section");
});
