import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import vm from "node:vm";
import { parseHTML } from "linkedom";
import {
  VERSION,
  analyze,
  decorations,
  parse,
  renderInto,
} from "../src/index.js";

const featureMarkdown = `# Runtime

Visit www.example.com and ~~remove this~~.

- [x] Parsed task
- [ ] Open task

| Pin | Mode |
| :-- | ---: |
| PA1 | output |

<script>alert("not executable")</script>
`;

test("parses CommonMark and GFM into position-bearing mdast", () => {
  const tree = parse(featureMarkdown);
  assert.equal(tree.type, "root");
  assert.equal(tree.position.start.offset, 0);
  assert.equal(tree.position.end.offset, featureMarkdown.length);

  const nodeTypes = collectTypes(tree);
  for (const type of ["heading", "link", "delete", "list", "table", "html"]) {
    assert.ok(nodeTypes.has(type), `expected ${type} node`);
  }

  const taskItems = findNodes(tree, "listItem");
  assert.deepEqual(
    taskItems.map((item) => item.checked),
    [true, false]
  );
});

test("analyze exposes offsets, lines, heading levels, and CM5 decorations", () => {
  const markdown = "# Héading\n\nText with **bold** and `code`.";
  const analysis = analyze(markdown);
  const heading = analysis.headings[0];
  assert.equal(heading.level, 1);
  assert.equal(heading.start, 0);
  assert.equal(heading.end, markdown.indexOf("\n"));
  assert.equal(heading.startLine, 1);
  assert.equal(heading.endLine, 1);
  assert.equal(heading.id, "heading");
  assert.ok(analysis.blocks.some((entry) => entry.type === "paragraph"));
  assert.ok(analysis.inline.some((entry) => entry.type === "strong"));
  assert.ok(analysis.inline.some((entry) => entry.type === "inlineCode"));

  const marks = decorations(markdown);
  const strong = marks.find((entry) => entry.type === "strong");
  assert.deepEqual(strong.from, { line: 2, ch: 10 });
  assert.deepEqual(strong.to, { line: 2, ch: 18 });
  assert.equal(strong.className, "ud-markdown-inline-strong");
  assert.equal(marks.some((entry) => entry.type === "text"), false);
  assert.equal(decorations(markdown, { includeText: true }).some(
    (entry) => entry.type === "text"
  ), true);

  const rawHtml = analyze("<section>literal</section>");
  assert.equal(rawHtml.blocks[0].type, "html");
  assert.equal(rawHtml.blocks[0].start, 0);
  assert.equal(rawHtml.blocks[0].end, 26);
});

test("renders GFM safely without interpreting raw HTML", () => {
  const { document } = parseHTML('<main id="target"></main>');
  const target = document.querySelector("#target");
  const headingCallbacks = [];

  const result = renderInto(target, featureMarkdown, {
    sourceId: "project-instruction",
    onHeading(heading) {
      headingCallbacks.push(heading);
    },
  });

  assert.equal(result.tree.type, "root");
  assert.equal(result.headings[0].id, "runtime");
  assert.equal(target.querySelector("h1").id, "runtime");
  assert.equal(headingCallbacks[0].element, target.querySelector("h1"));
  assert.equal(headingCallbacks[0].sourceId, "project-instruction");
  assert.equal(
    target.querySelector("h1").getAttribute("data-source-start"),
    "0"
  );
  assert.equal(
    target.querySelector("h1").getAttribute("data-source-id"),
    "project-instruction"
  );

  assert.equal(target.querySelectorAll("table").length, 1);
  assert.equal(target.querySelectorAll("thead th").length, 2);
  assert.equal(target.querySelector("thead th").style.textAlign, "left");
  assert.equal(target.querySelectorAll(".task-list-item input").length, 2);
  assert.equal(target.querySelectorAll("del").length, 1);
  assert.equal(target.querySelector('a[href="http://www.example.com"]').textContent,
    "www.example.com"
  );

  assert.equal(target.querySelectorAll("script").length, 0);
  assert.match(target.textContent, /<script>alert\("not executable"\)<\/script>/);
  assert.equal(target.innerHTML.includes("onclick="), false);
});

test("resolves links and images through callbacks and rejects unsafe protocols", () => {
  const { document } = parseHTML('<main id="target"></main>');
  const target = document.querySelector("#target");
  const seen = [];
  const markdown = [
    "[Guide](guide.md)",
    "[Unsafe](safe.md)",
    "![LED](led.png)",
    "![Blocked](blocked.png)",
  ].join("\n\n");

  renderInto(target, markdown, {
    allowImages: true,
    resolveLinkUrl(url, node, context) {
      seen.push([context.kind, node.type, url]);
      return url === "safe.md" ? "javascript:alert(1)" : `/docs/${url}`;
    },
    resolveImageUrl(url) {
      return url === "blocked.png" ? "data:text/html,unsafe" : `/assets/${url}`;
    },
  });

  assert.equal(target.querySelector('a[href="/docs/guide.md"]').textContent, "Guide");
  assert.equal(target.querySelectorAll("a").length, 1);
  assert.match(target.textContent, /Unsafe/);
  assert.equal(target.querySelector('img[src="/assets/led.png"]').alt, "LED");
  assert.equal(target.querySelectorAll("img").length, 1);
  assert.match(target.textContent, /Blocked/);
  assert.deepEqual(seen[0], ["link", "link", "guide.md"]);

  renderInto(target, "![Hidden](led.png)");
  assert.equal(target.querySelectorAll("img").length, 0);
  assert.equal(target.textContent, "Hidden");

  const rasterDataUrl = "data:image/png;base64,iVBORw0KGgo=";
  renderInto(target, `![Embedded](${rasterDataUrl})`, { allowImages: true });
  assert.equal(target.querySelector("img").getAttribute("src"), rasterDataUrl);
  renderInto(target, "![SVG](data:image/svg+xml;base64,PHN2Zz4=)", {
    allowImages: true,
  });
  assert.equal(target.querySelectorAll("img").length, 0);
  assert.equal(target.textContent, "SVG");
});

test("opens only cross-origin HTTP links in a protected new tab", () => {
  const { document, window } = parseHTML('<main id="target"></main>');
  window.location = {
    href: "https://uartdebug.com/avr",
    origin: "https://uartdebug.com",
  };
  const target = document.querySelector("#target");
  renderInto(
    target,
    [
      "[Local](/guide)",
      "[Same](https://uartdebug.com/docs)",
      "[External](https://example.com/docs)",
      "[Email](mailto:team@uartdebug.com)",
    ].join("\n\n")
  );

  const links = [...target.querySelectorAll("a")];
  assert.equal(links[0].hasAttribute("target"), false);
  assert.equal(links[1].hasAttribute("target"), false);
  assert.equal(links[2].getAttribute("target"), "_blank");
  assert.equal(links[2].getAttribute("rel"), "noopener noreferrer");
  assert.equal(links[3].hasAttribute("target"), false);
});

test("renders reference links and produces unique heading ids", () => {
  const { document } = parseHTML('<main id="target"></main>');
  const target = document.querySelector("#target");
  const markdown = [
    "# Same",
    "# Same",
    "[Reference][guide]",
    "",
    "[guide]: /guide.md \"Guide\"",
  ].join("\n");

  const { headings } = renderInto(target, markdown);
  assert.deepEqual(
    headings.map((heading) => heading.id),
    ["same", "same-2"]
  );
  assert.equal(target.querySelector('a[href="/guide.md"]').title, "Guide");
  assert.equal(target.querySelectorAll("[data-source-end]").length > 0, true);
});

test("resolves full, collapsed, and shortcut reference images safely", () => {
  const { document } = parseHTML('<main id="target"></main>');
  const target = document.querySelector("#target");
  const markdown = [
    "![Full][HeRo   Image]",
    "![Collapsed][]",
    "![Shortcut]",
    "![Missing][unknown]",
    "",
    '[hero image]: hero.png "Hero title"',
    "[collapsed]: collapsed.png",
    "[shortcut]: shortcut.png",
  ].join("\n");

  renderInto(target, markdown, {
    allowImages: true,
    resolveImageUrl(url) {
      return `/assets/${url}`;
    },
  });

  const images = [...target.querySelectorAll("img")];
  assert.deepEqual(
    images.map((image) => image.getAttribute("src")),
    ["/assets/hero.png", "/assets/collapsed.png", "/assets/shortcut.png"]
  );
  assert.equal(images[0].getAttribute("title"), "Hero title");
  assert.match(target.textContent, /Missing/);
  assert.equal(target.querySelectorAll("img").length, 3);
});

test("renders GFM footnotes with stable references and backlinks", () => {
  const { document } = parseHTML('<main id="target"></main>');
  const target = document.querySelector("#target");
  const markdown = [
    "Note[^one] and again[^one].",
    "",
    "[^one]: **Footnote** text.",
  ].join("\n");

  const analysis = analyze(markdown);
  assert.ok(analysis.blocks.some((entry) => entry.type === "footnoteDefinition"));
  assert.equal(
    analysis.inline.filter((entry) => entry.type === "footnoteReference").length,
    2
  );

  renderInto(target, markdown, { sourceId: "instruction" });
  const references = [...target.querySelectorAll('[role="doc-noteref"]')];
  const definition = target.querySelector('[role="doc-endnote"]');
  assert.equal(references.length, 2);
  assert.equal(target.querySelectorAll('[role="doc-backlink"]').length, 2);
  assert.equal(references[0].getAttribute("href"), `#${definition.id}`);
  assert.match(definition.textContent, /Footnote text/);
});

test("numbers footnotes by first reference and includes nested references", () => {
  const { document } = parseHTML('<main id="target"></main>');
  const target = document.querySelector("#target");
  const markdown = [
    "Used[^used].",
    "",
    "[^unused]: Never referenced.",
    "[^nested]: Nested note.",
    "[^used]: Used note with nested reference[^nested].",
  ].join("\n");

  renderInto(target, markdown);
  const references = [...target.querySelectorAll('[role="doc-noteref"]')];
  const definitions = [...target.querySelectorAll('[role="doc-endnote"]')];
  assert.deepEqual(references.map((link) => link.textContent), ["1", "2"]);
  assert.equal(definitions.length, 2);
  assert.match(definitions[0].textContent, /Used note/);
  assert.match(definitions[1].textContent, /Nested note/);
  assert.doesNotMatch(target.textContent, /Never referenced/);
  assert.equal(definitions[1].querySelectorAll('[role="doc-backlink"]').length, 1);
});

test("keeps paragraphs inside nested blocks of tight list items", () => {
  const { document } = parseHTML('<main id="target"></main>');
  const target = document.querySelector("#target");
  renderInto(target, "- > quoted");
  assert.equal(target.querySelector("li > p"), null);
  assert.equal(target.querySelector("li > blockquote > p").textContent, "quoted");
});

test("keeps the existing target intact when URL resolution fails", () => {
  const { document } = parseHTML('<main id="target"><p>Previous</p></main>');
  const target = document.querySelector("#target");

  assert.throws(
    () => renderInto(target, "[Link](/guide)", {
      resolveLinkUrl() {
        throw new Error("resolution failed");
      },
    }),
    /resolution failed/
  );
  assert.equal(target.textContent, "Previous");
});

test("generated IIFE exposes the documented window global", async () => {
  const bundlePath = resolve(
    import.meta.dirname,
    "../../../public/vendor/uartdebug-markdown.js"
  );
  const source = await readFile(bundlePath, "utf8");
  assert.doesNotMatch(
    source,
    /\b(?:innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval)\b/
  );
  const sandbox = { console };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: "uartdebug-markdown.js" });

  assert.equal(sandbox.UartDebugMarkdown.VERSION, VERSION);
  assert.equal(typeof sandbox.window.UartDebugMarkdown.parse, "function");
  assert.equal(typeof sandbox.window.UartDebugMarkdown.renderInto, "function");
  assert.equal(typeof sandbox.window.UartDebugMarkdown.analyze, "function");
  assert.equal(typeof sandbox.window.UartDebugMarkdown.decorations, "function");
  assert.equal(sandbox.UartDebugMarkdown.parse("# Test").children[0].type, "heading");
});

function collectTypes(tree) {
  return new Set(walkNodes(tree).map((node) => node.type));
}

function findNodes(tree, type) {
  return walkNodes(tree).filter((node) => node.type === type);
}

function walkNodes(node) {
  return [
    node,
    ...(Array.isArray(node.children) ? node.children.flatMap(walkNodes) : []),
  ];
}
