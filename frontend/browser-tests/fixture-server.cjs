"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const publicRoot = path.resolve(__dirname, "../../public");
const paragraph = "Keep the current text layout stable while its window opens or closes. Repeated words make changes in wrapping visible during the animation. ";
const project = {
  schemaVersion: 1, contract: "uartdebug-project/v2", id: "motion-example", title: "Motion example", version: "Ver.1.0",
  defaultLocale: "en", canvasName: "Motion example.md", projectPath: "Target_Projects/Motion example",
  canvas: { locale: "en", markdown: "# Project Motion example\n\nProject version - Ver.1.0\n\n## Hardware requirements\n\nATtiny1624, SOIC-14.\n\n## Software requirements\n\n" + paragraph.repeat(18) },
  files: [
    { role: "source", name: "Motion example.c", content: "#include <xc.h>\n\n" +
      Array.from({ length: 80 }, (_, index) => `// Source row ${index}: ${paragraph}`).join("\n") + "\nint main(void) { while (1) {} return 0; }\n" },
    { role: "guide", name: "Motion example (description).md", locale: "en", content: "# Motion example\n\n" +
      Array.from({ length: 24 }, (_, index) => `## Section ${index}\n\n${paragraph.repeat(3)}`).join("\n\n") },
    { role: "specification", name: "Motion example.yaml", content: "microcontroller:\n  model: ATtiny1624\n  package: SOIC-14\nhardware_resources: {}\nsoftware_dependencies: {}\n" },
  ],
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://127.0.0.1:8766");
  const json = (status, data) => {
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(data));
  };
  if (req.method !== "GET" && req.method !== "HEAD") return json(405, { ok: false, code: "browser_fixture_read_only" });
  if (url.pathname === "/health") return json(200, { ok: true });
  if (url.pathname === "/api/avr/ai/auth/session") return json(200, { ok: true, mode: "google", configured: false, authenticated: false });
  if (url.pathname === "/api/avr/ai/status") return json(200, { ok: true, enabled: false, configured: false, ready: false,
    knowledge: { devices: [{ mcu: "ATtiny1624", packages: ["SOIC-14", "TSSOP-14"] }] } });
  if (url.pathname === "/api/avr/ai/projects") return json(200, { ok: true, projects: [{ id: project.id, title: project.title, displayName: project.title, kind: "example" }] });
  if (url.pathname === "/api/avr/ai/projects/" + project.id) return json(200, { ok: true, project });
  if (url.pathname.startsWith("/api/")) return json(404, { ok: false, code: "browser_fixture_unknown_route" });
  try {
    const route = url.pathname === "/avr" ? "/avr.html" : url.pathname === "/" ? "/index.html" : url.pathname;
    const file = path.resolve(publicRoot, "." + decodeURIComponent(route));
    if (!file.startsWith(publicRoot + path.sep) || !fs.statSync(file).isFile()) return json(404, { ok: false });
    const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };
    res.writeHead(200, { "Content-Type": mime[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(req.method === "HEAD" ? undefined : fs.readFileSync(file));
  } catch { json(404, { ok: false }); }
});

server.listen(8766, "127.0.0.1");
