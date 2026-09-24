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

function referenceCorpus() {
  const features = () => ({ tables: [], formulas: [], figures: [] });
  return {
    schemaVersion: 1,
    documents: [
      {
        id: "datasheet",
        sourceId: "datasheet-pdf",
        title: "ATtiny1624/1626/1627 Datasheet",
        revision: "DS40002234B",
        sourceFile: "sources/ATtiny1624-26-27-DataSheet-DS40002234B.pdf",
        sourceUrl:
          "https://ww1.microchip.com/downloads/aemDocuments/documents/MCU08/ProductDocuments/DataSheets/ATtiny1624-26-27-DataSheet-DS40002234B.pdf",
        sha256: "a".repeat(64),
        pageCount: 575,
        sections: [
          { id: "adc", title: "29 ADC", level: 1, startPage: 419, endPage: 425 },
          {
            id: "adc-operation",
            title: "29.3 Functional Description",
            level: 2,
            startPage: 420,
            endPage: 424,
          },
          {
            id: "adc-sampling",
            title: "29.3.1 Sampling",
            level: 3,
            startPage: 420,
            endPage: 423,
          },
          { id: "tcd", title: "30 TCD", level: 1, startPage: 426, endPage: 450 },
        ],
        pages: [
          {
            page: 419,
            text: "ADC overview and conversion modes.",
            sectionIds: ["adc"],
            features: features(),
          },
          {
            page: 420,
            text: "SAMPLEN controls the ADC sample duration.\nBit | Field\n7:0 | SAMPLEN",
            sectionIds: ["adc", "adc-operation", "adc-sampling"],
            features: {
              tables: [{ label: "Sampling control register", text: "7:0 | SAMPLEN" }],
              formulas: [],
              figures: [],
            },
          },
          {
            page: 421,
            text: "ADC acquisition duration equation: t = cycles / f_ADC.",
            sectionIds: ["adc", "adc-operation", "adc-sampling"],
            features: {
              tables: [],
              formulas: [{ label: "Acquisition duration", text: "t = cycles / f_ADC" }],
              figures: [],
            },
          },
          {
            page: 422,
            text: "ADC sampling timing continues across this page.",
            sectionIds: ["adc", "adc-operation", "adc-sampling"],
            features: features(),
          },
          {
            page: 423,
            text: "ADC acquisition timing diagram. Read the image for edge alignment.",
            sectionIds: ["adc", "adc-operation", "adc-sampling"],
            features: {
              tables: [],
              formulas: [],
              figures: [{ label: "ADC acquisition timing", requiresVisualReview: true }],
            },
          },
          {
            page: 424,
            text: "ADC functional description outside the sampling subsection.",
            sectionIds: ["adc", "adc-operation"],
            features: features(),
          },
          {
            page: 425,
            text: "ADC chapter summary.",
            sectionIds: ["adc"],
            features: features(),
          },
        ],
      },
      {
        id: "errata",
        sourceId: "errata-pdf",
        title: "ATtiny1624/1626/1627 Silicon Errata",
        revision: "DS80000902F",
        sourceFile: "sources/ATtiny1624-26-27-SilConErrataClarif-DS80000902.pdf",
        sourceUrl:
          "https://ww1.microchip.com/downloads/aemDocuments/documents/MCU08/ProductDocuments/Errata/ATtiny1624-26-27-SilConErrataClarif-DS80000902.pdf",
        sha256: "b".repeat(64),
        pageCount: 16,
        sections: [
          { id: "errata-adc", title: "ADC errata", level: 1, startPage: 5, endPage: 5 },
        ],
        pages: [
          {
            page: 5,
            text: "ADC silicon revision applicability must be checked before using a workaround.",
            sectionIds: ["errata-adc"],
            features: features(),
          },
        ],
      },
    ],
  };
}

const samplingFact = {
  id: "reviewed-sampling-table",
  kind: "register-table",
  title: "Reviewed ADC sampling control",
  sourceId: "datasheet-pdf",
  pages: [420],
  section: "29.3.1 Sampling",
  verification: "reviewed-against-pdf",
  text: "The SAMPLEN field controls sampling duration; this fixture is not a device recipe.",
  appliesTo: ["ATtiny1624", "ATtiny1626", "ATtiny1627"],
  recipeIds: [],
};

test("PDF search finds a topic outside the pilot digests locally and preserves source provenance", async () => {
  let calls = 0;
  const corpus = referenceCorpus();
  const lookup = createDocumentationLookup({
    corpus,
    reviewedFacts: { schemaVersion: 1, facts: [samplingFact] },
    fetch: async () => {
      calls++;
      return htmlResponse();
    },
  });
  const result = await lookup.lookup({ operation: "search", query: "SAMPLEN" });
  assert.equal(result.ok, true);
  assert.equal(result.origin, "local");
  assert.equal(result.operation, "search");
  assert.equal(result.coverage, "reference-candidates");
  const hit = result.results.find((item) => item.documentId === "datasheet" && item.page === 420);
  assert.ok(hit, "the ADC sampling page should be available without its HTML URL");
  assert.equal(hit.sourceId, "datasheet-pdf");
  assert.equal(hit.revision, "DS40002234B");
  assert.equal(hit.sha256, corpus.documents[0].sha256);
  assert.deepEqual(hit.sectionIds, ["adc", "adc-operation", "adc-sampling"]);
  assert.deepEqual(hit.features.tables, corpus.documents[0].pages[1].features.tables);
  assert.equal(hit.reviewStatus, "machine-extracted-reference");
  assert.equal(hit.complete, undefined);
  assert.notEqual(hit.verification, "reviewed-against-pdf");
  assert.deepEqual(hit.reviewedFacts, [samplingFact]);
  assert.equal(calls, 0);
  assert.equal(lookup.externalRequests, 0);
});

test("PDF catalog exposes documents and immediate section children without downloading anything", async () => {
  let calls = 0;
  const lookup = createDocumentationLookup({
    corpus: referenceCorpus(),
    fetch: async () => {
      calls++;
      return htmlResponse();
    },
  });
  const catalog = await lookup.lookup({ operation: "catalog" });
  assert.equal(catalog.ok, true);
  assert.equal(catalog.origin, "local");
  assert.equal(catalog.coverage, "catalog");
  assert.deepEqual(catalog.documents.map((document) => document.id).sort(), ["datasheet", "errata"]);
  const document = await lookup.lookup({ operation: "catalog", documentId: "datasheet" });
  assert.deepEqual(document.sections.map((section) => section.id), ["adc", "tcd"]);
  const chapter = await lookup.lookup({ operation: "catalog", documentId: "datasheet", sectionId: "adc" });
  assert.deepEqual(chapter.sections.map((section) => section.id), ["adc-operation"]);
  const subsection = await lookup.lookup({ operation: "catalog", documentId: "datasheet", sectionId: "adc-operation" });
  assert.deepEqual(subsection.sections.map((section) => section.id), ["adc-sampling"]);
  assert.equal(calls, 0);
});

test("PDF section reads use bounded continuation and retain formula and figure review metadata", async () => {
  let calls = 0;
  const corpus = referenceCorpus();
  const lookup = createDocumentationLookup({
    corpus,
    reviewedFacts: { schemaVersion: 1, facts: [samplingFact] },
    fetch: async () => {
      calls++;
      return htmlResponse();
    },
  });
  const first = await lookup.lookup({
    operation: "read",
    documentId: "datasheet",
    sectionId: "adc-sampling",
    page: 0,
  });
  assert.equal(first.ok, true);
  assert.equal(first.origin, "local");
  assert.equal(first.coverage, "section-pages");
  assert.deepEqual(first.results.map((result) => result.page), [420, 421, 422]);
  assert.equal(first.nextPage, 423);
  assert.deepEqual(first.results[1].features.formulas, corpus.documents[0].pages[2].features.formulas);
  assert.ok(first.results.every((result) => result.reviewStatus === "machine-extracted-reference"));
  assert.deepEqual(first.results[0].reviewedFacts, [samplingFact]);
  assert.equal(first.results[1].reviewedFacts?.length || 0, 0, "reviewed facts must not leak onto unrelated pages");
  const continuation = await lookup.lookup({
    operation: "read",
    documentId: "datasheet",
    sectionId: "adc-sampling",
    page: first.nextPage,
  });
  assert.equal(continuation.ok, true);
  assert.deepEqual(continuation.results.map((result) => result.page), [423]);
  assert.ok(continuation.nextPage == null);
  assert.deepEqual(continuation.results[0].features.figures, corpus.documents[0].pages[4].features.figures);
  assert.equal(calls, 0);
});

test("a missing PDF topic returns a local miss instead of automatically requesting the web", async () => {
  let calls = 0;
  const lookup = createDocumentationLookup({
    corpus: referenceCorpus(),
    fetch: async () => {
      calls++;
      return htmlResponse();
    },
  });
  const result = await lookup.lookup({ operation: "search", query: "unrepresentedregister" });
  assert.equal(result.ok, false);
  assert.equal(result.code, "local_documentation_not_found");
  assert.equal(calls, 0);
  assert.equal(lookup.externalRequests, 0);
});

test("external PDF-corpus fallback requires a matching local investigation and an explicit remaining gap", async () => {
  let calls = 0;
  const lookup = createDocumentationLookup({
    corpus: referenceCorpus(),
    fetch: async () => {
      calls++;
      return htmlResponse();
    },
  });
  const external = { ...args, operation: "external", query: "unrepresentedregister" };
  assert.equal((await lookup.lookup(external)).ok, false);
  assert.equal(calls, 0);
  await lookup.lookup({ operation: "catalog" });
  assert.equal((await lookup.lookup(external)).ok, false, "listing documents is not a search for the missing fact");
  await lookup.lookup({ operation: "search", query: "SAMPLEN" });
  assert.equal((await lookup.lookup(external)).ok, false, "an unrelated search must not authorize external retrieval");
  assert.equal(calls, 0);
  await lookup.lookup({ operation: "search", query: `  ${external.query.toUpperCase()}  ` });
  assert.equal((await lookup.lookup({ ...external, gap: "" })).ok, false);
  assert.equal(calls, 0);
  const result = await lookup.lookup(external);
  assert.equal(result.ok, true);
  assert.equal(result.origin, "web");
  assert.equal(calls, 1);
});

test("arbitrary page reads and scoped searches cannot unlock external access without an all-document search", async () => {
  let calls = 0;
  const options = {
    corpus: referenceCorpus(),
    fetch: async () => {
      calls++;
      return htmlResponse();
    },
  };
  const lookup = createDocumentationLookup(options);
  const local = await lookup.lookup({ operation: "read", documentId: "datasheet", page: 420 });
  assert.equal(local.ok, true);
  const external = { ...args, operation: "external" };
  assert.equal((await lookup.lookup(external)).ok, false, "a page read without a query must not authorize unrelated external retrieval");
  assert.equal(calls, 0);
  await lookup.lookup({ operation: "read", documentId: "datasheet", page: 420, query: external.query });
  assert.equal((await lookup.lookup(external)).code, "local_documentation_first", "supplying a query does not make an arbitrary page read a corpus-wide investigation");
  await lookup.lookup({ operation: "search", documentId: "datasheet", query: external.query });
  assert.equal((await lookup.lookup(external)).code, "local_documentation_first", "datasheet-only search could miss an erratum");
  await lookup.lookup({ operation: "search", documentId: "datasheet", sectionId: "adc", query: external.query });
  assert.equal((await lookup.lookup(external)).code, "local_documentation_first", "a section-only search is insufficient");
  assert.equal(calls, 0);
  await lookup.lookup({ operation: "search", documentId: "", sectionId: "", query: external.query });
  assert.equal((await lookup.lookup(external)).origin, "web");
  assert.equal(calls, 1);
  assert.equal((await createDocumentationLookup(options).lookup(external)).ok, false);
  assert.equal(calls, 1, "another generation must perform its own local investigation");
});

function registerSnapshot() {
  const module = {
    name: "ADC",
    caption: "Analog to Digital Converter",
    registerGroups: [{
      name: "ADC",
      registers: [{
        name: "CTRLC",
        offset: "0x02",
        size: "1",
        caption: "Control C",
        bitfields: [{ name: "REFSEL", values: "ADC_REFSEL", mask: "0x03" }],
      }],
    }],
    valueGroups: [{
      name: "ADC_REFSEL",
      values: [{ name: "VDDREF", value: "0x01", caption: "VDD reference" }],
    }],
  };
  return {
    schemaVersion: 1,
    sourceId: "microchip-attiny-dfp",
    packSha256: "c".repeat(64),
    devices: [
      {
        mcu: "ATtiny1626",
        atdfMember: "atdf/ATtiny1626.atdf",
        atdfSha256: "d".repeat(64),
        headerMember: "include/avr/iotn1626.h",
        headerSha256: "e".repeat(64),
        modules: [{
          ...module,
          registerGroups: [{
            name: "ADC",
            registers: [{
              ...module.registerGroups[0].registers[0],
              name: "OTHER_DEVICE_ONLY",
            }],
          }],
        }],
      },
      {
        mcu: "ATtiny1624",
        atdfMember: "atdf/ATtiny1624.atdf",
        atdfSha256: "f".repeat(64),
        headerMember: "include/avr/iotn1624.h",
        headerSha256: "1".repeat(64),
        modules: [module],
      },
    ],
  };
}

test("DFP lookup returns the selected MCU's raw register fields and value groups with pack provenance", async () => {
  let calls = 0;
  const dfpRegisters = registerSnapshot();
  dfpRegisters.devices[1].modules[0].registerGroups[0].modes = [{ name: "NORMAL", qualifier: "CTRLA.MODE", value: "0x00" }];
  const lookup = createDocumentationLookup({
    corpus: referenceCorpus(),
    dfpRegisters,
    mcu: "ATtiny1624",
    fetch: async () => {
      calls++;
      return htmlResponse();
    },
  });
  const result = await lookup.lookup({ operation: "registers", query: "REFSEL", sectionId: "ADC" });
  assert.equal(result.ok, true);
  assert.equal(result.origin, "local");
  assert.equal(result.operation, "registers");
  assert.equal(result.coverage, "register-definitions");
  assert.equal(result.reviewStatus, "extracted-official-atdf");
  assert.equal(result.digestScope, "downloaded-pack-bytes");
  assert.equal(result.sourceId, dfpRegisters.sourceId);
  assert.equal(result.sha256, dfpRegisters.packSha256);
  const device = dfpRegisters.devices[1];
  assert.equal(result.mcu, device.mcu);
  assert.equal(result.atdfMember, device.atdfMember);
  assert.equal(result.atdfSha256, device.atdfSha256);
  assert.equal(result.headerMember, device.headerMember);
  assert.equal(result.headerSha256, device.headerSha256);
  assert.equal(result.results.length, 1);
  const hit = result.results[0];
  assert.equal(hit.module, "ADC");
  assert.deepEqual(hit.register, device.modules[0].registerGroups[0].registers[0]);
  assert.deepEqual(hit.groupMetadata.modes, device.modules[0].registerGroups[0].modes, "register mode conditions must accompany definitions");
  assert.deepEqual(hit.valueGroups, device.modules[0].valueGroups);
  assert.equal(hit.register.offset, "0x02");
  assert.equal(hit.register.size, "1");
  assert.equal(hit.register.bitfields[0].mask, "0x03");
  assert.equal(hit.valueGroups[0].values[0].value, "0x01");
  assert.equal(hit.page, undefined, "DFP definitions must not claim a PDF page citation");
  assert.equal(calls, 0);
  assert.equal(lookup.externalRequests, 0);
});

test("DFP lookup bounds register results and honors the module restriction", async () => {
  let calls = 0;
  const dfpRegisters = registerSnapshot();
  const device = dfpRegisters.devices[1];
  const register = device.modules[0].registerGroups[0].registers[0];
  device.modules[0].registerGroups[0].registers = Array.from({ length: 11 }, (_, index) => ({
    ...register,
    name: `CTRLA${index}`,
  }));
  device.modules.push({
    name: "USART",
    caption: "Universal Synchronous and Asynchronous Receiver and Transmitter",
    registerGroups: [{ name: "USART", registers: [{ ...register, name: "CTRLA" }] }],
    valueGroups: [],
  });
  const lookup = createDocumentationLookup({
    dfpRegisters,
    mcu: "ATtiny1624",
    fetch: async () => {
      calls++;
      return htmlResponse();
    },
  });
  const result = await lookup.lookup({ operation: "registers", query: "CTRLA", sectionId: "ADC" });
  assert.equal(result.ok, true);
  assert.equal(result.totalMatches, 11);
  assert.equal(result.results.length, 8);
  assert.equal(result.truncated, true);
  assert.ok(result.results.every((hit) => hit.module === "ADC"));
  const usart = await lookup.lookup({ operation: "registers", query: "CTRLA", sectionId: "USART" });
  assert.equal(usart.totalMatches, 1);
  assert.equal(usart.results[0].module, "USART");
  assert.equal(usart.truncated, false);
  assert.equal(calls, 0);
});

test("DFP lookup cannot substitute another MCU or use the network for missing definitions", async () => {
  let calls = 0;
  const options = {
    dfpRegisters: registerSnapshot(),
    mcu: "ATtiny1624",
    fetch: async () => {
      calls++;
      return htmlResponse();
    },
  };
  const lookup = createDocumentationLookup(options);
  for (const query of ["OTHER_DEVICE_ONLY", "unrepresentedregister"])
    assert.equal((await lookup.lookup({ operation: "registers", query })).code, "local_register_not_found");
  const unknownMcu = createDocumentationLookup({ ...options, mcu: "ATmega328P" });
  assert.equal(
    (await unknownMcu.lookup({ operation: "registers", query: "REFSEL" })).code,
    "local_registers_unavailable",
  );
  assert.equal(calls, 0);
});

test("DFP C instance queries resolve only explicit device instances and prioritize their own registers", async () => {
  const dfpRegisters = registerSnapshot();
  const device = dfpRegisters.devices[1];
  const module = (name, group, registers, valueGroups = []) => ({ name, registerGroups: [{ name: group, registers }], valueGroups });
  device.modules.push(
    module("USART", "USART", [{ name: "CTRLB", offset: "0x06", bitfields: [] }]),
    module("CCL", "CCL", [{ name: "LUT0CTRLB", bitfields: [{ name: "INSEL0", values: "CCL_INSEL0" }] }],
      [{ name: "CCL_INSEL0", values: [{ name: "USART0", caption: "USART0 signal" }] }]),
    module("TCA", "TCA_SINGLE", [{ name: "CTRLA", caption: "Periodic counter enable", bitfields: [] }, { name: "PER", offset: "0x26", bitfields: [] }]),
    module("PORT", "PORT", [{ name: "PIN3CTRL", offset: "0x13", bitfields: [] }]),
  );
  device.instances = [
    { module: "ADC", name: "ADC0", registerGroups: [{ name: "ADC0", offset: "0x0600" }] },
    { module: "USART", name: "USART0", registerGroups: [{ name: "USART0", offset: "0x0800" }] },
    { module: "USART", name: "USART1", registerGroups: [{ name: "USART1", offset: "0x0820" }] },
    { module: "TCA", name: "TCA0", registerGroups: [{ name: "TCA0", offset: "0x0A00" }] },
    { module: "PORT", name: "PORTA", registerGroups: [{ name: "PORTA", offset: "0x0400" }] },
    { module: "PORT", name: "PORTB", registerGroups: [{ name: "PORTB", offset: "0x0420" }] },
  ];
  const lookup = createDocumentationLookup({ dfpRegisters, mcu: device.mcu, fetch: async () => { throw Error("Unexpected network"); } });
  for (const [query, expectedModule, register, instance] of [
    ["ADC0.CTRLC", "ADC", "CTRLC", "ADC0"],
    ["TCA0.SINGLE.PER", "TCA", "PER", "TCA0"],
    ["USART0.CTRLB", "USART", "CTRLB", "USART0"],
    ["PORTA.PIN3CTRL", "PORT", "PIN3CTRL", "PORTA"],
  ]) {
    const result = await lookup.lookup({ operation: "registers", query });
    assert.equal(result.ok, true, query);
    assert.equal(result.results[0].register.name, register, query);
    assert.ok(result.results.every((hit) => hit.module === expectedModule), query);
    assert.deepEqual(result.instances, device.instances.filter((item) => item.name === instance));
  }
  const usart = await lookup.lookup({ operation: "registers", query: "USART CTRLB" });
  assert.equal(usart.results[0].module, "USART");
  assert.equal(usart.results[0].register.name, "CTRLB");
  assert.ok(usart.results.every((hit) => hit.module !== "CCL"), "USART enum values in CCL are not a USART register match");
  assert.equal((await lookup.lookup({ operation: "registers", query: "ADC9.CTRLC" })).code, "local_register_not_found");
  assert.equal(lookup.externalRequests, 0);
});
