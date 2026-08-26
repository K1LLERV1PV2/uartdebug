# UartDebugMarkdown browser runtime

This package builds the vendored `public/vendor/uartdebug-markdown.js` IIFE.
It parses CommonMark with GitHub Flavored Markdown extensions (autolinks,
footnotes, strikethrough, tables, task lists, and tag filtering) and renders the
resulting mdast without using `innerHTML`.

## Browser API

Loading the generated classic script creates `window.UartDebugMarkdown`:

```js
const tree = UartDebugMarkdown.parse(markdown);

const { tree: renderedTree, headings } = UartDebugMarkdown.renderInto(
  targetElement,
  markdown,
  {
    allowImages: true,
    sourceId: "project-instruction",
    resolveLinkUrl(url, node, context) {
      return url;
    },
    resolveImageUrl(url, node, context) {
      return url;
    },
    onHeading(heading) {
      console.log(heading.id, heading.element);
    },
  }
);

const { tree: analyzedTree, blocks, inline, headings: outline } =
  UartDebugMarkdown.analyze(markdown);

const marks = UartDebugMarkdown.decorations(markdown);
```

- `parse(markdown)` returns the position-bearing mdast root.
- `renderInto(target, markdown, options)` replaces the target's children and
  returns `{ tree, headings }`. Raw HTML is displayed as text. Images are
  disabled unless `allowImages` is true. URL callbacks may rewrite a URL or
  return `null` to reject it; unsafe protocols are rejected after callbacks.
  Each callback receives `(url, node, { kind, sourceId })`. `onHeading`
  receives the heading descriptor plus its newly created `element` and
  `sourceId`.
- `analyze(markdown)` returns `{ tree, blocks, inline, headings }`. Every block
  and inline descriptor includes `type`, zero-based `start`/`end` offsets,
  one-based line and column fields, the mdast `node`, and heading `level` where
  applicable.
- `decorations(markdown, { includeText })` returns source-ordered descriptors
  with CodeMirror 5 compatible, zero-based `from`/`to` positions and a stable
  `className`. Text nodes are omitted by default.

Rendered elements with mdast positions receive `data-source-start`,
`data-source-end`, `data-source-start-line`, and `data-source-end-line`.
`sourceId` additionally becomes `data-source-id`.

## Development

```sh
npm ci --prefix frontend/markdown-runtime
npm test --prefix frontend/markdown-runtime
npm run build --prefix frontend/markdown-runtime
npm run build:check --prefix frontend/markdown-runtime
```

The build also regenerates `LICENSES/UartDebugMarkdownRuntime.txt` and its
deployed `public/vendor/uartdebug-markdown.LICENSE.txt` copy from the exact
packages included in the browser bundle. CI runs `build:check`, so all generated
artifacts must match the source and lockfile.
