import { fromMarkdown } from "mdast-util-from-markdown";
import { gfm } from "micromark-extension-gfm";
import { gfmFromMarkdown } from "mdast-util-gfm";

export const VERSION = "1.0.0";

const BLOCK_TYPES = new Set([
  "blockquote",
  "code",
  "definition",
  "footnoteDefinition",
  "heading",
  "list",
  "listItem",
  "paragraph",
  "table",
  "tableCell",
  "tableRow",
  "thematicBreak",
]);

const PHRASING_PARENTS = new Set([
  "delete",
  "emphasis",
  "heading",
  "link",
  "linkReference",
  "paragraph",
  "strong",
  "tableCell",
]);

const LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);
const IMAGE_PROTOCOLS = new Set(["http:", "https:", "blob:"]);

export function parse(markdown) {
  return fromMarkdown(String(markdown ?? ""), {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });
}

export function analyze(markdown) {
  const tree = parse(markdown);
  const blocks = [];
  const inline = [];

  walk(tree, null, 0, (node, parent, depth) => {
    if (node === tree || !hasOffsets(node)) return;
    const descriptor = describeNode(node, parent, depth);
    const isInline = parent ? PHRASING_PARENTS.has(parent.type) : false;
    const isBlock = BLOCK_TYPES.has(node.type) || (node.type === "html" && !isInline);
    if (isInline || !isBlock) inline.push(descriptor);
    else blocks.push(descriptor);
  });

  const headings = collectHeadingDescriptors(tree);
  return { tree, blocks, inline, headings };
}

export function decorations(markdown, { includeText = false } = {}) {
  const analysis = analyze(markdown);
  const entries = [
    ...analysis.blocks.map((descriptor) => ({
      ...descriptor,
      kind: "block",
    })),
    ...analysis.inline
      .filter((descriptor) => includeText || descriptor.type !== "text")
      .map((descriptor) => ({
        ...descriptor,
        kind: "inline",
      })),
  ];

  return entries
    .map((descriptor) => ({
      ...descriptor,
      from: {
        line: Math.max(0, descriptor.startLine - 1),
        ch: Math.max(0, descriptor.startColumn - 1),
      },
      to: {
        line: Math.max(0, descriptor.endLine - 1),
        ch: Math.max(0, descriptor.endColumn - 1),
      },
      className: `ud-markdown-${descriptor.kind}-${toClassToken(
        descriptor.type
      )}`,
    }))
    .sort((left, right) => left.start - right.start || right.end - left.end);
}

export function renderInto(
  target,
  markdown,
  {
    allowImages = false,
    resolveLinkUrl,
    resolveImageUrl,
    onHeading,
    sourceId = "",
  } = {}
) {
  if (!target || typeof target.replaceChildren !== "function") {
    throw new TypeError("renderInto target must be a DOM element.");
  }
  const document = target.ownerDocument || globalThis.document;
  if (!document || typeof document.createElement !== "function") {
    throw new TypeError("renderInto requires a DOM Document.");
  }

  const tree = parse(markdown);
  const definitions = collectDefinitions(tree);
  const footnotes = collectFootnotes(tree);
  const headings = collectHeadingDescriptors(tree);
  const headingByNode = new Map(headings.map((heading) => [heading.node, heading]));
  const nextFootnoteIndex = indexReferencedFootnotes(tree, footnotes);
  const fragment = document.createDocumentFragment();
  const context = {
    allowImages: Boolean(allowImages),
    definitions,
    document,
    footnoteIdPrefix: `ud-md-footnote-${
      toClassToken(sourceId) || "source"
    }-${nextRenderId()}`,
    footnoteReferenceCounts: new Map(),
    footnotes,
    headingByNode,
    onHeading: typeof onHeading === "function" ? onHeading : null,
    resolveImageUrl:
      typeof resolveImageUrl === "function" ? resolveImageUrl : null,
    resolveLinkUrl: typeof resolveLinkUrl === "function" ? resolveLinkUrl : null,
    sourceId: String(sourceId || ""),
    nextFootnoteIndex,
  };

  appendRenderedChildren(fragment, tree, context, { tightParagraph: false });
  const renderedFootnotes = renderFootnotes(context);
  if (renderedFootnotes) fragment.appendChild(renderedFootnotes);
  target.replaceChildren(fragment);
  return { tree, headings };
}

function renderNode(node, context, renderState) {
  const { document } = context;
  switch (node.type) {
    case "paragraph": {
      if (renderState.tightParagraph) {
        const fragment = document.createDocumentFragment();
        appendRenderedChildren(fragment, node, context, renderState);
        return fragment;
      }
      return renderContainer("p", node, context, renderState);
    }
    case "heading": {
      const level = clampHeadingLevel(node.depth);
      const element = renderContainer(`h${level}`, node, context, renderState);
      const heading = context.headingByNode.get(node);
      if (heading) element.id = heading.id;
      if (heading && context.onHeading) {
        context.onHeading({
          ...heading,
          element,
          sourceId: context.sourceId,
        });
      }
      return element;
    }
    case "blockquote":
      return renderContainer("blockquote", node, context, renderState);
    case "thematicBreak":
      return annotate(document.createElement("hr"), node, context.sourceId);
    case "code": {
      const pre = annotate(document.createElement("pre"), node, context.sourceId);
      const code = document.createElement("code");
      const language = String(node.lang || "").trim().split(/\s+/)[0];
      if (language) code.className = `language-${toClassToken(language)}`;
      code.textContent = String(node.value || "");
      pre.appendChild(code);
      return pre;
    }
    case "list":
      return renderList(node, context, renderState);
    case "listItem":
      return renderListItem(node, context, renderState);
    case "table":
      return renderTable(node, context, renderState);
    case "tableRow":
      return renderTableRow(node, context, renderState);
    case "tableCell":
      return renderContainer(
        renderState.tableCellTag || "td",
        node,
        context,
        renderState
      );
    case "definition":
    case "footnoteDefinition":
      return null;
    case "text":
      return document.createTextNode(String(node.value || ""));
    case "html": {
      const element = annotate(
        document.createElement("span"),
        node,
        context.sourceId
      );
      element.className = "ud-markdown-raw-html";
      element.textContent = String(node.value || "");
      return element;
    }
    case "emphasis":
      return renderContainer("em", node, context, renderState);
    case "strong":
      return renderContainer("strong", node, context, renderState);
    case "delete":
      return renderContainer("del", node, context, renderState);
    case "inlineCode": {
      const code = annotate(document.createElement("code"), node, context.sourceId);
      code.textContent = String(node.value || "");
      return code;
    }
    case "break":
      return annotate(document.createElement("br"), node, context.sourceId);
    case "link":
      return renderLink(node, node.url, context, renderState);
    case "linkReference": {
      const definition = context.definitions.get(normalizeIdentifier(node.identifier));
      return definition
        ? renderLink(node, definition.url, context, renderState, definition.title)
        : renderChildrenFragment(node, context, renderState);
    }
    case "footnoteReference":
      return renderFootnoteReference(node, context);
    case "image":
      return renderImage(node, node.url, context, node.title);
    case "imageReference": {
      const definition = context.definitions.get(normalizeIdentifier(node.identifier));
      return definition
        ? renderImage(node, definition.url, context, definition.title)
        : renderImageFallback(node, context);
    }
    default:
      if (Array.isArray(node.children)) {
        return renderChildrenFragment(node, context, renderState);
      }
      if (Object.prototype.hasOwnProperty.call(node, "value")) {
        return document.createTextNode(String(node.value || ""));
      }
      return null;
  }
}

function renderContainer(tagName, node, context, renderState) {
  const element = annotate(
    context.document.createElement(tagName),
    node,
    context.sourceId
  );
  appendRenderedChildren(element, node, context, renderState);
  return element;
}

function renderChildrenFragment(node, context, renderState) {
  const fragment = context.document.createDocumentFragment();
  appendRenderedChildren(fragment, node, context, renderState);
  return fragment;
}

function appendRenderedChildren(parent, node, context, renderState) {
  for (const child of Array.isArray(node.children) ? node.children : []) {
    const rendered = renderNode(child, context, renderState);
    if (rendered) parent.appendChild(rendered);
  }
}

function renderList(node, context, renderState) {
  const ordered = Boolean(node.ordered);
  const element = annotate(
    context.document.createElement(ordered ? "ol" : "ul"),
    node,
    context.sourceId
  );
  if (ordered && Number.isSafeInteger(node.start) && node.start !== 1) {
    element.setAttribute("start", String(node.start));
  }
  if (
    Array.isArray(node.children) &&
    node.children.some((item) => typeof item.checked === "boolean")
  ) {
    element.classList.add("contains-task-list");
  }
  for (const item of Array.isArray(node.children) ? node.children : []) {
    const rendered = renderNode(item, context, {
      ...renderState,
      tightParagraph: !node.spread && !item.spread,
    });
    if (rendered) element.appendChild(rendered);
  }
  return element;
}

function renderListItem(node, context, renderState) {
  const item = annotate(
    context.document.createElement("li"),
    node,
    context.sourceId
  );
  const isTask = typeof node.checked === "boolean";
  if (isTask) item.classList.add("task-list-item");

  let taskControlAdded = false;
  for (const child of Array.isArray(node.children) ? node.children : []) {
    const rendered = renderNode(child, context, {
      ...renderState,
      tightParagraph:
        child.type === "paragraph" ? renderState.tightParagraph : false,
    });
    if (!rendered) continue;
    if (isTask && !taskControlAdded) {
      const checkbox = context.document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.disabled = true;
      checkbox.checked = node.checked;
      checkbox.setAttribute("aria-hidden", "true");
      if (rendered.nodeType === 11) {
        item.append(checkbox, context.document.createTextNode(" "), rendered);
      } else {
        rendered.prepend(checkbox, context.document.createTextNode(" "));
        item.appendChild(rendered);
      }
      taskControlAdded = true;
    } else {
      item.appendChild(rendered);
    }
  }
  return item;
}

function renderTable(node, context, renderState) {
  const table = annotate(
    context.document.createElement("table"),
    node,
    context.sourceId
  );
  const rows = Array.isArray(node.children) ? node.children : [];
  if (!rows.length) return table;
  const head = context.document.createElement("thead");
  head.appendChild(
    renderTableRow(rows[0], context, {
      ...renderState,
      tableAlign: node.align,
      tableCellTag: "th",
    })
  );
  table.appendChild(head);
  if (rows.length > 1) {
    const body = context.document.createElement("tbody");
    for (const row of rows.slice(1)) {
      body.appendChild(
        renderTableRow(row, context, {
          ...renderState,
          tableAlign: node.align,
          tableCellTag: "td",
        })
      );
    }
    table.appendChild(body);
  }
  return table;
}

function renderTableRow(node, context, renderState) {
  const row = annotate(
    context.document.createElement("tr"),
    node,
    context.sourceId
  );
  const cells = Array.isArray(node.children) ? node.children : [];
  cells.forEach((cell, index) => {
    const rendered = renderNode(cell, context, renderState);
    const alignment = renderState.tableAlign?.[index];
    if (rendered && alignment) rendered.style.textAlign = alignment;
    if (rendered) row.appendChild(rendered);
  });
  return row;
}

function renderLink(node, rawUrl, context, renderState, fallbackTitle) {
  const url = resolveUrl("link", rawUrl, node, context);
  if (!url) return renderChildrenFragment(node, context, renderState);
  const link = annotate(
    context.document.createElement("a"),
    node,
    context.sourceId
  );
  link.setAttribute("href", url);
  markExternalLink(link, url, context.document);
  const title = node.title ?? fallbackTitle;
  if (title) link.setAttribute("title", String(title));
  appendRenderedChildren(link, node, context, renderState);
  return link;
}

function renderImage(node, rawUrl, context, fallbackTitle) {
  if (!context.allowImages) return renderImageFallback(node, context);
  const url = resolveUrl("image", rawUrl, node, context);
  if (!url) return renderImageFallback(node, context);
  const image = annotate(
    context.document.createElement("img"),
    node,
    context.sourceId
  );
  image.setAttribute("src", url);
  image.setAttribute("alt", String(node.alt || ""));
  image.setAttribute("loading", "lazy");
  image.setAttribute("decoding", "async");
  const title = node.title ?? fallbackTitle;
  if (title) image.setAttribute("title", String(title));
  return image;
}

function renderImageFallback(node, context) {
  const fallback = annotate(
    context.document.createElement("span"),
    node,
    context.sourceId
  );
  fallback.className = "ud-markdown-image-alt";
  fallback.textContent = String(node.alt || "");
  return fallback;
}

function renderFootnoteReference(node, context) {
  const identifier = normalizeIdentifier(node.identifier);
  const footnote = context.footnotes.get(identifier);
  if (!footnote) {
    return context.document.createTextNode(`[^${String(node.label || identifier)}]`);
  }
  if (!Number.isSafeInteger(footnote.index)) {
    footnote.index = context.nextFootnoteIndex;
    context.nextFootnoteIndex += 1;
  }
  const referenceCount = (context.footnoteReferenceCounts.get(identifier) || 0) + 1;
  context.footnoteReferenceCounts.set(identifier, referenceCount);
  const referenceId = `${context.footnoteIdPrefix}-ref-${footnote.index}-${referenceCount}`;
  const definitionId = `${context.footnoteIdPrefix}-definition-${footnote.index}`;
  const sup = annotate(
    context.document.createElement("sup"),
    node,
    context.sourceId
  );
  sup.className = "footnote-ref";
  const link = context.document.createElement("a");
  link.id = referenceId;
  link.setAttribute("href", `#${definitionId}`);
  link.setAttribute("role", "doc-noteref");
  link.setAttribute("aria-label", `Footnote ${footnote.index}`);
  link.textContent = String(footnote.index);
  sup.appendChild(link);
  footnote.referenceIds.push(referenceId);
  return sup;
}

function renderFootnotes(context) {
  const referenced = [...context.footnotes.values()].filter(
    (footnote) => Number.isSafeInteger(footnote.index)
  ).sort((left, right) => left.index - right.index);
  if (!referenced.length) return null;

  const section = context.document.createElement("section");
  section.className = "footnotes";
  section.setAttribute("data-footnotes", "");
  section.setAttribute("role", "doc-endnotes");
  section.setAttribute("aria-label", "Footnotes");
  const list = context.document.createElement("ol");

  const renderedItems = referenced.map((footnote) => {
    const item = annotate(
      context.document.createElement("li"),
      footnote.node,
      context.sourceId
    );
    item.id = `${context.footnoteIdPrefix}-definition-${footnote.index}`;
    item.setAttribute("role", "doc-endnote");
    appendRenderedChildren(item, footnote.node, context, {
      tightParagraph: false,
    });
    const backlinkContainer =
      item.lastElementChild?.tagName?.toLowerCase() === "p"
        ? item.lastElementChild
        : item;
    return { backlinkContainer, footnote, item };
  });

  for (const { backlinkContainer, footnote, item } of renderedItems) {
    footnote.referenceIds.forEach((referenceId, index) => {
      backlinkContainer.appendChild(context.document.createTextNode(" "));
      const backlink = context.document.createElement("a");
      backlink.className = "footnote-backref";
      backlink.setAttribute("href", `#${referenceId}`);
      backlink.setAttribute("role", "doc-backlink");
      backlink.setAttribute(
        "aria-label",
        `Back to footnote ${footnote.index} reference${
          footnote.referenceIds.length > 1 ? ` ${index + 1}` : ""
        }`
      );
      backlink.textContent = "↩";
      backlinkContainer.appendChild(backlink);
    });
    list.appendChild(item);
  }
  section.appendChild(list);
  return section;
}

function resolveUrl(kind, rawUrl, node, context) {
  const callback =
    kind === "image" ? context.resolveImageUrl : context.resolveLinkUrl;
  let resolved = rawUrl;
  if (callback) {
    resolved = callback(String(rawUrl || ""), node, {
      kind,
      sourceId: context.sourceId,
    });
  }
  if (resolved === null || resolved === undefined || resolved === false) {
    return null;
  }
  return sanitizeUrl(String(resolved), kind);
}

function sanitizeUrl(rawUrl, kind) {
  const url = rawUrl.trim();
  if (!url) return null;
  if (kind === "image" && isSafeRasterDataUrl(url)) return url;
  const probe = url
    .replace(/[\u0000-\u0020\u007f-\u009f]/g, "")
    .toLowerCase();
  const scheme = probe.match(/^[a-z][a-z0-9+.-]*:/)?.[0];
  if (!scheme) return url;
  const allowed = kind === "image" ? IMAGE_PROTOCOLS : LINK_PROTOCOLS;
  return allowed.has(scheme) ? url : null;
}

function collectDefinitions(tree) {
  const definitions = new Map();
  walk(tree, null, 0, (node) => {
    if (node.type !== "definition") return;
    const identifier = normalizeIdentifier(node.identifier);
    if (identifier && !definitions.has(identifier)) {
      definitions.set(identifier, node);
    }
  });
  return definitions;
}

function collectFootnotes(tree) {
  const footnotes = new Map();
  walk(tree, null, 0, (node) => {
    if (node.type !== "footnoteDefinition") return;
    const identifier = normalizeIdentifier(node.identifier);
    if (!identifier || footnotes.has(identifier)) return;
    footnotes.set(identifier, {
      identifier,
      index: null,
      node,
      referenceIds: [],
    });
  });
  return footnotes;
}

function indexReferencedFootnotes(tree, footnotes) {
  let nextIndex = 1;
  const assignReferences = (node) => {
    if (node.type === "footnoteDefinition") return;
    if (node.type === "footnoteReference") {
      const footnote = footnotes.get(normalizeIdentifier(node.identifier));
      if (footnote && !Number.isSafeInteger(footnote.index)) {
        footnote.index = nextIndex;
        nextIndex += 1;
      }
    }
    for (const child of Array.isArray(node.children) ? node.children : []) {
      assignReferences(child);
    }
  };

  assignReferences(tree);
  for (let index = 1; index < nextIndex; index += 1) {
    const footnote = [...footnotes.values()].find(
      (candidate) => candidate.index === index
    );
    if (!footnote) continue;
    for (const child of footnote.node.children || []) assignReferences(child);
  }
  return nextIndex;
}

function isSafeRasterDataUrl(value) {
  return /^data:image\/(?:png|jpe?g|gif|webp);base64,[a-z\d+/=\s]+$/i.test(
    String(value || "")
  );
}

function markExternalLink(link, url, document) {
  const location = document.defaultView?.location;
  if (!location?.href || !location.origin) return;
  try {
    const parsed = new URL(url, location.href);
    if (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      parsed.origin !== location.origin
    ) {
      link.setAttribute("target", "_blank");
      link.setAttribute("rel", "noopener noreferrer");
    }
  } catch {}
}

function collectHeadingDescriptors(tree) {
  const headings = [];
  const slugCounts = new Map();
  walk(tree, null, 0, (node, parent, depth) => {
    if (node.type !== "heading" || !hasOffsets(node)) return;
    const text = extractText(node);
    const baseId = slugifyHeading(text);
    const count = (slugCounts.get(baseId) || 0) + 1;
    slugCounts.set(baseId, count);
    headings.push({
      ...describeNode(node, parent, depth),
      id: count === 1 ? baseId : `${baseId}-${count}`,
      level: clampHeadingLevel(node.depth),
      text,
    });
  });
  return headings;
}

function describeNode(node, parent, depth) {
  const descriptor = {
    type: node.type,
    start: node.position.start.offset,
    end: node.position.end.offset,
    startLine: node.position.start.line,
    endLine: node.position.end.line,
    startColumn: node.position.start.column,
    endColumn: node.position.end.column,
    depth,
    parentType: parent?.type || null,
    node,
  };
  if (node.type === "heading") descriptor.level = clampHeadingLevel(node.depth);
  if (node.type === "list") descriptor.ordered = Boolean(node.ordered);
  if (node.type === "listItem" && typeof node.checked === "boolean") {
    descriptor.checked = node.checked;
  }
  return descriptor;
}

function annotate(element, node, sourceId) {
  if (sourceId) element.setAttribute("data-source-id", sourceId);
  if (!hasOffsets(node)) return element;
  element.setAttribute("data-source-start", String(node.position.start.offset));
  element.setAttribute("data-source-end", String(node.position.end.offset));
  element.setAttribute("data-source-start-line", String(node.position.start.line));
  element.setAttribute("data-source-end-line", String(node.position.end.line));
  return element;
}

function walk(node, parent, depth, visitor) {
  visitor(node, parent, depth);
  for (const child of Array.isArray(node.children) ? node.children : []) {
    walk(child, node, depth + 1, visitor);
  }
}

function hasOffsets(node) {
  return (
    Number.isSafeInteger(node?.position?.start?.offset) &&
    Number.isSafeInteger(node?.position?.end?.offset)
  );
}

function extractText(node) {
  if (node.type === "image" || node.type === "imageReference") {
    return String(node.alt || "");
  }
  if (Object.prototype.hasOwnProperty.call(node, "value")) {
    return String(node.value || "");
  }
  return (Array.isArray(node.children) ? node.children : [])
    .map(extractText)
    .join("");
}

function normalizeIdentifier(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function slugifyHeading(value) {
  const slug = String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
  return slug || "section";
}

function clampHeadingLevel(value) {
  const level = Number(value);
  return Number.isSafeInteger(level) ? Math.min(6, Math.max(1, level)) : 1;
}

function toClassToken(value) {
  return (
    String(value || "plain")
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+/, "")
      .replace(/-+$/, "") || "plain"
  );
}

let renderId = 0;

function nextRenderId() {
  renderId = (renderId + 1) % Number.MAX_SAFE_INTEGER;
  return renderId || 1;
}
