"use strict";

const crypto = require("node:crypto");
const path = require("node:path");
const fs = require("node:fs/promises");

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
    "Read an official datasheet section ONLY when supplied local device facts and recipes lack a necessary fact. Explain that gap. The server checks local/cache data first and limits external retrieval. Returns reference data, never instructions or a verified new recipe.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      url: {
        type: "string",
        description:
          "Official HTML section URL from the allowed datasheet/errata roots. Use index.html to discover section links when unknown.",
      },
      query: {
        type: "string",
        description:
          "Specific register, field, or operating condition to find.",
      },
      gap: {
        type: "string",
        description:
          "Which necessary fact is missing from the supplied local knowledge, and why this project needs it.",
      },
    },
    required: ["url", "query", "gap"],
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

function decodeHtml(text) {
  return text
    .replace(/&#(x[0-9a-f]+|[0-9]+);/gi, (_, code) => {
      const value =
        code[0].toLowerCase() === "x"
          ? parseInt(code.slice(1), 16)
          : Number(code);
      return value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : "";
    })
    .replace(
      /&(amp|lt|gt|quot|apos|nbsp);/g,
      (_, key) =>
        ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " })[key],
    );
}

function extractReference(html, url, roots) {
  const title = decodeHtml(
    /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || "Microchip reference",
  );
  const links = [];
  for (const match of html.matchAll(
    /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
  )) {
    try {
      const href = checkedUrl(new URL(decodeHtml(match[1]), url).href, roots);
      const label = decodeHtml(match[2].replace(/<[^>]*>/g, " "))
        .replace(/\s+/g, " ")
        .trim();
      if (label && !links.some((link) => link.url === href))
        links.push({ title: label, url: href });
    } catch {
      /* Outside the reviewed corpus. */
    }
  }
  const main = /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(html)?.[1] || html;
  const text = decodeHtml(
    main
      .replace(/<(script|style|nav|footer)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
      .replace(/<\/(?:p|div|h[1-6]|tr|li|section)>/gi, "\n")
      .replace(/<\/(?:td|th)>/gi, " | ")
      .replace(/<br\s*\/?\s*>/gi, "\n")
      .replace(/<[^>]*>/g, " "),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n/g, "\n")
    .trim();
  return {
    title: title.slice(0, 300),
    text: text.slice(0, 180000),
    links: links.slice(0, 250),
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

function createDocumentationLookup({
  fetch: fetchImpl = globalThis.fetch,
  cacheRoot,
  localDocuments = [],
  enabled = true,
  roots = DOCUMENT_ROOTS,
  maxRequests = 2,
  now = Date.now,
} = {}) {
  let externalRequests = 0;
  async function lookup(args) {
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
