"use strict";

const crypto = require("node:crypto");
const path = require("node:path");
const fs = require("node:fs/promises");
const { parse } = require("parse5");
const { createMethodologyIndex } = require("./avr-methodology");

// Restrict retrieval to the pilot device's full datasheet and silicon errata.
// New device families must register their reviewed official roots explicitly.
const DOCUMENT_ROOTS = [
  "https://onlinedocs.microchip.com/oxy/GUID-7056F141-DF07-46C5-A4B8-97EB46E9B945-en-US-12/",
  "https://onlinedocs.microchip.com/oxy/GUID-CB68AD87-CF90-4076-861C-33A2E4841D9C-en-US-19/",
];
const LOOKUP_TOOL = {
  type: "function",
  name: "read_avr_documentation",
  strict: true,
  description:
    "Browse, search and read local coding methodology, its original colleague sources, complete official PDFs and DFP definitions. Maintained methodology guides coding within its stated scope; original work-in-progress texts and extracted PDF pages are reference data. External HTML requires a prior search across ALL local documents (empty documentId and sectionId) for the same query plus an explicit remaining knowledge gap; at most two network requests are allowed.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      operation: { type: "string", enum: ["catalog", "search", "read", "registers", "external"], description: "catalog browses documents and sections; search finds PDF and methodology candidates; read retrieves up to three PDF pages or 12000 bytes of methodology sections with nextSectionId; registers finds DFP definitions; external requests an official HTML section." },
      documentId: { type: "string", description: "Local document id from the catalog, or empty for a search across ALL documents. Only an unrestricted search with empty documentId and sectionId satisfies the local-first external-lookup requirement." },
      sectionId: { type: "string", description: "Local section id for catalog/read, module name for registers, or empty. Catalog without a section lists top-level sections." },
      page: { type: "integer", minimum: 0, description: "One-based PDF page for read; 0 starts at the chosen section. Use nextPage to continue PDFs. Methodology and original colleague documents use page=0 and nextSectionId instead; results cite source line ranges." },
      url: {
        type: "string",
        description:
          "Empty for local operations. For external only, a section URL from the registered official HTML roots; index.html may discover links.",
      },
      query: {
        type: "string",
        description:
          "Specific register, field, or operating condition to find, preferably with the English reference terminology. Required for search/external; keep the same query when reading its section. Empty is allowed for catalog/read.",
      },
      gap: {
        type: "string",
        description:
          "Empty for local operations. For external, explain precisely which necessary fact remains missing after local results and why the project needs it.",
      },
    },
    required: ["operation", "documentId", "sectionId", "page", "url", "query", "gap"],
  },
};

function checkedUrl(value, roots) {
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    !roots.some((root) => url.href.startsWith(root)) ||
    !/^\/(?:oxy)\/[A-Za-z0-9-]+\/(?:index|GUID-[A-Za-z0-9-]+)\.html$/.test(
      url.pathname,
    )
  ) {
    throw new Error(
      "Only registered official device HTML sections may be retrieved.",
    );
  }
  url.hash = "";
  return url.href;
}

function extractReference(html, url, roots) {
  const document = parse(html);
  const ignored = new Set(["script", "style", "nav", "footer"]);
  const block = new Set([
    "p",
    "div",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "tr",
    "li",
    "section",
  ]);
  const nodes = [];
  // Walk iteratively so unusually nested references cannot overflow our stack.
  const pending = [document];
  while (pending.length) {
    const node = pending.pop();
    nodes.push(node);
    // Navigation may contain the only index links; ignore it for body text,
    // but retain its official section links for bounded discovery.
    for (const child of (node.childNodes || []).slice().reverse())
      pending.push(child);
  }
  function plainText(root) {
    const chunks = [],
      work = [{ node: root, close: false }];
    while (work.length) {
      const { node, close } = work.pop();
      if (ignored.has(node.tagName)) continue;
      if (close) {
        if (node.tagName === "td" || node.tagName === "th") chunks.push(" | ");
        else if (block.has(node.tagName)) chunks.push("\n");
      } else if (node.nodeName === "#text") chunks.push(node.value);
      else {
        if (node.tagName === "br") chunks.push("\n");
        work.push({ node, close: true });
        for (const child of (node.childNodes || []).slice().reverse())
          work.push({ node: child, close: false });
      }
    }
    return chunks
      .join("")
      .replace(/[ \t]+/g, " ")
      .replace(/\n\s*\n/g, "\n")
      .trim();
  }
  const title =
    plainText(
      nodes.find((node) => node.tagName === "title") || { childNodes: [] },
    ) || "Microchip reference";
  const links = [];
  for (const node of nodes) {
    if (node.tagName !== "a") continue;
    const attribute = node.attrs?.find(
      (attribute) => attribute.name === "href",
    );
    if (!attribute) continue;
    try {
      const href = checkedUrl(new URL(attribute.value, url).href, roots);
      const label = plainText(node).replace(/\s+/g, " ").trim();
      if (label && !links.some((link) => link.url === href))
        links.push({ title: label, url: href });
    } catch {
      /* Outside the reviewed corpus. */
    }
    if (links.length === 250) break;
  }
  const main = nodes.find((node) => node.tagName === "main") || document;
  return {
    title: title.slice(0, 300),
    text: plainText(main).slice(0, 180000),
    links,
  };
}

function excerpt(text, query) {
  const words = query.toLowerCase().match(/[a-z0-9_]{3,}/g) || [];
  const lines = text.split("\n");
  let best = 0,
    score = -1;
  for (let i = 0; i < lines.length; i++) {
    const segment = lines
      .slice(i, i + 15)
      .join(" ")
      .toLowerCase();
    const count = words.filter((word) => segment.includes(word)).length;
    if (count > score) {
      score = count;
      best = Math.max(0, i - 3);
    }
  }
  return lines.slice(best).join("\n").slice(0, 18000);
}

const LOCAL_NOTICE = "Local reference candidates, not proof that the requested fact is covered or an approved recipe. PDF extraction can misorder columns, flatten tables and lose mathematical symbols; machine-detected figures/formulas are not reviewed. Use separately reviewed facts when present and retain page/revision applicability.";
const queryKey = (value) => String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
const queryTerms = (value) => [...new Set(queryKey(value).match(/[\p{L}\p{N}_]{2,}/gu) || [])].slice(0, 30);

function createLocalReferenceIndex(corpus = { documents: [] }, reviewedFacts = { facts: [] }, dfpRegisters = null, mcu = "") {
  const documents = Array.isArray(corpus.documents) ? corpus.documents : [];
  const facts = Array.isArray(reviewedFacts.facts) ? reviewedFacts.facts : [];
  const pages = documents.flatMap((document) => (document.pages || []).map((page) => {
    const sections = (document.sections || []).filter((section) => page.sectionIds?.includes(section.id));
    return { document, page, sections, search: `${sections.map((section) => section.title).join(" ")}\n${page.text}`.toLowerCase() };
  }));
  const describe = (document) => ({
    id: document.id, documentId: document.id, sourceId: document.sourceId, title: document.title,
    revision: document.revision, sourceFile: document.sourceFile, sourceUrl: document.sourceUrl,
    sha256: document.sha256, pageCount: document.pageCount,
    digestScope: "raw-pdf-bytes", reviewStatus: "machine-extracted-reference",
  });
  const summarize = (item, query, reading = false) => {
    const { document, page, sections } = item;
    const sourceText = String(page.text || "");
    const text = reading ? sourceText.slice(0, 12000) : excerpt(sourceText, query).slice(0, 4500);
    const features = {};
    for (const [key, value] of Object.entries(page.features || {})) {
      // Feature metadata is a navigation aid, never independent verification.
      if (Array.isArray(value)) features[key] = value.slice(0, 12);
    }
    return {
      ...describe(document), page: page.page, sectionIds: page.sectionIds || [],
      sections, text, textComplete: text === sourceText, features,
      featureReviewStatus: "unreviewed-layout",
      reviewedFacts: facts.filter((fact) => fact.sourceId === document.sourceId && fact.pages?.includes(page.page)),
    };
  };
  const error = (code, message) => ({ ok: false, origin: "local", code, message });
  function lookup(args) {
    const operation = args.operation || "search";
    const document = documents.find((item) => item.id === args.documentId);
    if (args.documentId && !document) return error("local_document_unknown", "Choose a documentId from the local catalog.");
    const section = document?.sections?.find((item) => item.id === args.sectionId);
    if (args.sectionId && operation !== "registers" && !section) return error("local_section_unknown", "Choose a sectionId from the selected document's catalog.");
    const base = { ok: true, origin: "local", operation, verification: "source-only", notice: LOCAL_NOTICE };
    if (operation === "catalog") {
      if (!document) return { ...base, coverage: "catalog", documents: documents.map(describe) };
      const all = document.sections || [];
      let children;
      if (section) {
        const start = all.indexOf(section) + 1;
        const end = all.findIndex((item, index) => index >= start && item.level <= section.level);
        const descendants = all.slice(start, end < 0 ? undefined : end);
        const childLevel = Math.min(...descendants.map((item) => item.level));
        children = descendants.filter((item) => item.level === childLevel);
      } else {
        const level = Math.min(...all.map((item) => item.level));
        children = all.filter((item) => item.level === level);
      }
      return { ...base, coverage: "catalog", document: describe(document), section: section || null,
        sections: children.slice(0, 100), truncated: children.length > 100 };
    }
    if (operation === "read") {
      if (!document) return error("local_document_required", "Choose a local document and section or PDF page to read.");
      const start = args.page || section?.startPage || 1;
      const end = section?.endPage || document.pageCount;
      if (!Number.isSafeInteger(start) || start < (section?.startPage || 1) || start > end)
        return error("local_page_invalid", "The requested page is outside this document or section.");
      const selected = pages.filter((item) => item.document === document && item.page.page >= start && item.page.page <= Math.min(end, start + 2));
      if (!selected.length) return error("local_page_unavailable", "No extracted text exists for this PDF page; inspect its source PDF.");
      const last = selected.at(-1).page.page;
      return { ...base, coverage: "section-pages", results: selected.map((item) => summarize(item, args.query, true)),
        nextPage: last < end ? last + 1 : null };
    }
    const terms = queryTerms(args.query);
    if (!terms.length) return error("local_query_required", "Use a specific register, field or operating condition, preferably in the reference's English terminology.");
    const candidates = pages.filter((item) => (!document || item.document === document) && (!section || item.page.sectionIds?.includes(section.id)));
    const frequencies = terms.map((term) => candidates.reduce((count, item) => count + Number(item.search.includes(term)), 0));
    const ranked = candidates.map((item) => {
      const matchedTerms = terms.filter((term) => item.search.includes(term));
      const score = terms.reduce((total, term, index) => {
        if (!item.search.includes(term)) return total;
        const occurrences = Math.min(8, item.search.split(term).length - 1);
        const sectionStart = item.sections.some((section) => section.startPage === item.page.page && section.title.toLowerCase().includes(term));
        return total + (1 + Math.log(1 + candidates.length / (1 + frequencies[index]))) * (1 + Math.log(occurrences)) + (sectionStart ? 8 : 0);
      }, 0);
      return { item, matchedTerms, score };
    }).filter((item) => item.matchedTerms.length > 0).sort((a, b) => b.matchedTerms.length - a.matchedTerms.length || b.score - a.score || a.item.page.page - b.item.page.page);
    if (!ranked.length) return error("local_documentation_not_found", "No local text match. Try English register/section terms, browse the local catalog, or state the remaining gap before external lookup. Absence of a text match is not proof the PDF lacks the information.");
    return { ...base, coverage: "reference-candidates", totalMatches: ranked.length,
      results: ranked.slice(0, 5).map(({ item, matchedTerms }) => ({ ...summarize(item, args.query), matchedTerms, unmatchedTerms: terms.filter((term) => !matchedTerms.includes(term)) })) };
  }
  function registers(args) {
    const device = dfpRegisters?.devices?.find((item) => item.mcu.toLowerCase() === mcu.toLowerCase());
    if (!device) return error("local_registers_unavailable", "No DFP register snapshot is loaded for the selected MCU.");
    const instances = device.instances || [];
    const instanceModules = new Map(instances.map((instance) => [instance.name.toLowerCase(), instance.module.toLowerCase()]));
    const rawTerms = queryTerms(args.query).flatMap((term) => term.replace(/_(?:bm|gm|gc|gv|bp|gp)$/, "").split("_")).filter(Boolean);
    const terms = rawTerms.map((term) => instanceModules.get(term) || term);
    const moduleNames = new Set((device.modules || []).map((module) => module.name.toLowerCase()));
    const requestedModule = args.sectionId?.toLowerCase() || terms.find((term) => moduleNames.has(term));
    if (!terms.length) return error("local_query_required", "Specify a register, field or value-group symbol; use sectionId to restrict the module.");
    const results = [];
    for (const module of device.modules || []) {
      if (requestedModule && module.name.toLowerCase() !== requestedModule) continue;
      for (const group of module.registerGroups || []) for (const register of group.registers || []) {
        const valueNames = new Set((register.bitfields || []).map((field) => field.values).filter(Boolean));
        const valueGroups = (module.valueGroups || []).filter((value) => valueNames.has(value.name));
        const searchable = JSON.stringify({ module: module.name, group: group.name, register, valueGroups }).toLowerCase();
        if (!terms.every((term) => searchable.includes(term))) continue;
        const exactRegister = terms.includes(register.name.toLowerCase());
        const exactFields = (register.bitfields || []).filter((field) => terms.includes(field.name.toLowerCase())).length;
        const { registers: _registers, ...groupMetadata } = group;
        results.push({ module: module.name, moduleCaption: module.caption, registerGroup: group.name, groupMetadata, register, valueGroups,
          score: (exactRegister ? 100 : 0) + exactFields * 25 });
      }
    }
    if (!results.length) return error("local_register_not_found", "No matching DFP register definition. Try the module or field's ATDF spelling.");
    results.sort((a, b) => b.score - a.score);
    const selected = results.slice(0, 8).map(({ score, ...result }) => result);
    const selectedModules = new Set(selected.map((result) => result.module));
    const namedInstances = instances.filter((instance) => rawTerms.includes(instance.name.toLowerCase()));
    const relatedInstances = instances.filter((instance) => selectedModules.has(instance.module) &&
      (!namedInstances.some((named) => named.module === instance.module) || namedInstances.includes(instance)));
    return { ok: true, origin: "local", operation: "registers", coverage: "register-definitions",
      sourceId: dfpRegisters.sourceId, sha256: dfpRegisters.packSha256, digestScope: "downloaded-pack-bytes",
      sourceUrl: dfpRegisters.sourceUrl,
      mcu: device.mcu, atdfMember: device.atdfMember, atdfSha256: device.atdfSha256,
      headerMember: device.headerMember, headerSha256: device.headerSha256,
      reviewStatus: "extracted-official-atdf", totalMatches: results.length, results: selected, truncated: results.length > 8,
      instances: relatedInstances.slice(0, 12), instancesTruncated: relatedInstances.length > 12,
      notice: "DFP XML attributes are retained as strings. This describes the source pack, not installed-compiler support or reviewed operating sequences. Consult PDF sections and errata; newly added symbols may be absent from the installed pack." };
  }
  return { lookup, registers, hasCorpus: documents.length > 0 };
}

function createDocumentationLookup({
  fetch: fetchImpl = globalThis.fetch,
  cacheRoot,
  localDocuments = [],
  corpus = { documents: [] },
  reviewedFacts = { facts: [] },
  dfpRegisters = null,
  methodology = {},
  mcu = "",
  enabled = true,
  roots = DOCUMENT_ROOTS,
  maxRequests = 2,
  now = Date.now,
} = {}) {
  let externalRequests = 0;
  const local = createLocalReferenceIndex(corpus, reviewedFacts, dfpRegisters, mcu);
  const methods = createMethodologyIndex(methodology);
  const examinedQueries = new Set();
  async function lookup(args) {
    const operation = args?.operation || (args?.url ? "external" : "search");
    if (!["catalog", "search", "read", "registers", "external"].includes(operation))
      return { ok: false, code: "documentation_operation_invalid", message: "Choose a documented local operation or explicit external lookup." };
    if (operation !== "external") {
      if (!args || (args.query !== undefined && (typeof args.query !== "string" || args.query.length > 300)) ||
          (args.documentId !== undefined && typeof args.documentId !== "string") ||
          (args.sectionId !== undefined && typeof args.sectionId !== "string") ||
          (args.page !== undefined && (!Number.isSafeInteger(args.page) || args.page < 0)))
        return { ok: false, code: "local_request_invalid", message: "Use valid local catalog ids, a bounded query and a nonnegative page." };
      let result;
      if (operation !== "registers" && methods.handles(args.documentId)) {
        result = methods.lookup({ ...args, operation });
      } else {
        result = operation === "registers" ? local.registers(args) : local.lookup({ ...args, operation });
        if (!args.documentId && !args.sectionId && operation === "catalog" && result.ok && methodology.documents?.length)
          result.documents.push(...methods.catalog);
        if (!args.documentId && !args.sectionId && operation === "search" && methodology.documents?.length) {
          const methodResult = methods.lookup({ ...args, operation });
          if (methodResult.ok) {
            // Keep both result classes visible; WIP originals never displace
            // the maintained methodology or official PDF candidates.
            if (!result.ok && result.code === "local_documentation_not_found") result = { ...methodResult, results: [] };
            result.methodologyResults = methodResult.results.filter((item) => item.kind === "methodology");
            result.colleagueSourceCandidates = methodResult.results.filter((item) => item.kind === "colleague-source").map(({text, ...item}) => item);
          }
        }
      }
      if (operation === "search" && !args.documentId && !args.sectionId && (result.ok || result.code === "local_documentation_not_found")) {
        if (queryTerms(args.query).length) examinedQueries.add(queryKey(args.query));
      }
      return result;
    }
    if (
      !args ||
      typeof args.query !== "string" ||
      args.query.length < 3 ||
      args.query.length > 300 ||
      typeof args.gap !== "string" ||
      args.gap.length < 15 ||
      args.gap.length > 1000
    ) {
      return {
        ok: false,
        code: "knowledge_gap_required",
        message:
          "State the exact missing fact before requesting documentation.",
      };
    }
    let url;
    try {
      url = checkedUrl(args.url, roots);
    } catch {
      return {
        ok: false,
        code: "documentation_url_forbidden",
        message:
          "Use a section link from the registered official device documents.",
      };
    }
    if (local.hasCorpus && !examinedQueries.has(queryKey(args.query)))
      return { ok: false, code: "local_documentation_first", message: "Search ALL local documents for this exact query first with empty documentId and sectionId, then request external documentation only if a necessary fact remains missing. Reading arbitrary pages or searching only one document is insufficient. Local hits are candidates, not a completeness guarantee." };
    const key = crypto.createHash("sha256").update(url).digest("hex");
    const cacheFile = cacheRoot && path.join(cacheRoot, `${key}.json`);
    // Curated digests are partial. A request for terms absent from the digest
    // may still need the full official section, so do not mask that gap.
    const terms = args.query.toLowerCase().match(/[a-z0-9_]{3,}/g) || [];
    let entry = localDocuments.find(
      (item) =>
        item.url === url &&
        typeof item.text === "string" &&
        (item.complete === true ||
          (terms.length > 0 &&
            terms.every((term) => item.text.toLowerCase().includes(term)))),
    );
    let origin = "local";
    if (!entry && cacheFile) {
      try {
        const info = await fs.lstat(cacheFile);
        if (!info.isFile() || info.isSymbolicLink() || info.size > 700000)
          throw new Error("Invalid cache");
        const stored = JSON.parse(await fs.readFile(cacheFile, "utf8"));
        if (
          stored.url === url &&
          Number.isFinite(stored.fetchedAt) &&
          stored.fetchedAt <= now() &&
          now() - stored.fetchedAt < 30 * 86400000 &&
          typeof stored.text === "string" &&
          Array.isArray(stored.links)
        ) {
          entry = stored;
          origin = "cache";
        }
      } catch {
        /* A missing/stale cache falls back to the official document. */
      }
    }
    if (!entry) {
      if (!enabled || externalRequests >= maxRequests)
        return {
          ok: false,
          code: "documentation_unavailable",
          message:
            "External lookup is disabled or its per-request limit was reached. Clarify the knowledge gap on the canvas.",
        };
      externalRequests++;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      try {
        const response = await fetchImpl(url, {
          signal: controller.signal,
          redirect: "error",
          headers: { Accept: "text/html" },
        });
        if (
          !response.ok ||
          !/text\/html/i.test(response.headers.get("content-type") || "")
        )
          throw new Error("Unavailable HTML");
        if (Number(response.headers.get("content-length")) > 750000)
          throw new Error("Oversized HTML");
        const reader = response.body.getReader();
        const chunks = [];
        let size = 0;
        try {
          while (true) {
            const part = await reader.read();
            if (part.done) break;
            size += part.value.length;
            if (size > 750000) {
              await reader.cancel();
              throw new Error("Oversized HTML");
            }
            chunks.push(Buffer.from(part.value));
          }
        } finally {
          reader.releaseLock();
        }
        const html = Buffer.concat(chunks).toString("utf8");
        const parsed = extractReference(html, url, roots);
        if (parsed.text.length < 80) throw new Error("Empty document");
        entry = {
          url,
          ...parsed,
          sha256: crypto.createHash("sha256").update(html).digest("hex"),
          digestScope: "raw-html-bytes",
          fetchedAt: now(),
        };
        origin = "web";
        if (cacheFile) {
          await fs.mkdir(cacheRoot, { recursive: true, mode: 0o700 });
          const temp = `${cacheFile}.${crypto.randomUUID()}.tmp`;
          await fs.writeFile(temp, JSON.stringify(entry), {
            mode: 0o600,
            flag: "wx",
          });
          await fs.rename(temp, cacheFile).catch(async () => {
            await fs.unlink(temp).catch(() => {});
          });
        }
      } catch {
        return {
          ok: false,
          code: "documentation_fetch_failed",
          message:
            "The official section could not be retrieved. Do not invent its missing facts; leave a question or limitation on the canvas.",
        };
      } finally {
        clearTimeout(timeout);
      }
    }
    return {
      ok: true,
      origin,
      url,
      title: entry.title,
      sha256: entry.sha256,
      digestScope: entry.digestScope || "curated-local-text",
      verification: "source-only",
      coverage: origin === "local" ? "partial-local-digest" : "external-reference",
      text: excerpt(entry.text, args.query),
      links: (entry.links || []).slice(0, 100),
      notice:
        "Reference data only. HTML extraction may flatten merged table cells. This is not an approved recipe; verify device and revision applicability.",
    };
  }
  return {
    lookup,
    get externalRequests() {
      return externalRequests;
    },
  };
}

module.exports = {
  DOCUMENT_ROOTS,
  LOOKUP_TOOL,
  createDocumentationLookup,
  extractReference,
};
