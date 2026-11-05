"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

test("frontend resources follow new HTML, CSS, JS and manifest dependencies without manual lists", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "uartdebug-assets-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const publicRoot = path.join(root, "public");
  const files = {
    "index.html": '<link href="styles.css"><link href="styles.css"><link rel="manifest" href="manifest.webmanifest"><script src="main.js?mode=1&v=old#entry"></script><script src="https://example.com/external.js"></script><a href="old.html">Legacy</a>',
    "new-tool.html": '<script src="main.js"></script>',
    "old.html": '<meta http-equiv="refresh" content="0;url=/">',
    "styles.css": '@import "nested.css";p {background:url("picture.svg");src:url(font.woff2)}',
    "nested.css": "p {color:green}",
    "main.js": 'import "./dependency.js";',
    "dependency.js": "export const ready = true;",
    "unused.js": "const unused = true;",
    "picture.svg": "<svg/>",
    "font.woff2": "fixture-font",
    "icon.png": "fixture-icon",
    "manifest.webmanifest": JSON.stringify({ icons: [{ src: "icon.png" }] }),
    "sw.js": 'const CACHE_NAME = "uartdebug-shell-test";\nconst APP_SHELL_ASSETS = [];\n',
  };
  fs.mkdirSync(publicRoot);
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(publicRoot, name), content);
  const script = path.join(__dirname, "../.github/scripts/stamp_frontend_build.py");
  const run = (...args) => spawnSync(process.platform === "win32" ? "python" : "python3", [script, ...args], {
    cwd: root, env: { ...process.env, FRONTEND_BUILD_ID: "resources-test" }, encoding: "utf8",
  });
  const stamped = run();
  assert.equal(stamped.status, 0, stamped.stderr);
  const worker = fs.readFileSync(path.join(publicRoot, "sw.js"), "utf8");
  const assets = JSON.parse(worker.match(/const APP_SHELL_ASSETS = (\[[\s\S]*?\]);/)[1]);
  assert.deepEqual(assets, ["/", "/dependency.js", "/font.woff2", "/icon.png", "/index.html", "/main.js",
    "/manifest.webmanifest", "/nested.css", "/new-tool", "/new-tool.html", "/picture.svg", "/styles.css"]);
  const page = fs.readFileSync(path.join(publicRoot, "index.html"), "utf8");
  assert.equal((page.match(/styles\.css\?v=resources-test/g) || []).length, 2);
  assert.match(page, /main\.js\?mode=1&v=resources-test#entry/);
  assert.match(page, /https:\/\/example\.com\/external\.js"/);
  assert.equal(run("--check").status, 0);
  assert.equal(run().status, 0);
  assert.equal(fs.readFileSync(path.join(publicRoot, "sw.js"), "utf8"), worker);
  fs.writeFileSync(path.join(publicRoot, "new-runtime.js"), "const added = true;");
  fs.appendFileSync(path.join(publicRoot, "new-tool.html"), '<script src="new-runtime.js"></script>');
  assert.notEqual(run("--check").status, 0, "CI must detect a stale generated resource list");
  assert.equal(run("--generate").status, 0);
  assert.equal(run("--check").status, 0);
  assert.match(fs.readFileSync(path.join(publicRoot, "sw.js"), "utf8"), /"\/new-runtime\.js"/);
});
