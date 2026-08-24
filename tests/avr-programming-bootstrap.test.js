"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const core = require("../public/avr-mini-projects.js");
const {
  extractDocumentationMarkers,
  extractMarkdownHeadings,
} = require("../backend/avr-documentation-markers");

test("exposes the mini-project bridge before DOMContentLoaded", () => {
  const windowListeners = new Map();
  const documentListeners = new Map();
  const fakeWindow = {
    UartDebugAvrMiniProjectCore: core,
    addEventListener(type, listener) {
      windowListeners.set(type, listener);
    },
    dispatchEvent() {
      return true;
    },
  };
  const fakeDocument = {
    addEventListener(type, listener) {
      documentListeners.set(type, listener);
    },
  };
  const source = fs.readFileSync(
    path.join(__dirname, "../public/AVR-Programming.js"),
    "utf8"
  );

  vm.runInNewContext(source, {
    window: fakeWindow,
    document: fakeDocument,
    CodeMirror: { registerHelper() {} },
    console,
    Promise,
    Map,
    Set,
    URL,
  });

  const bridge = fakeWindow.UartDebugAvrMiniProjects;
  assert.ok(bridge);
  assert.equal(bridge.schemaVersion, core.SCHEMA_VERSION);
  assert.equal(typeof bridge.install, "function");
  assert.equal(typeof bridge.updateInstance, "function");
  assert.equal(typeof bridge.renameInstance, "function");
  assert.equal(typeof bridge.ready?.then, "function");
  assert.equal(typeof windowListeners.get(bridge.importEvent), "function");
  assert.equal(typeof documentListeners.get("DOMContentLoaded"), "function");
});

test("uses the MP badge for mini-projects in the AVR outliner", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../public/AVR-Programming.js"),
    "utf8"
  );

  assert.match(
    source,
    /row\.dataset\.outlinerIcon\s*=\s*isMiniProjectSource\s*\?\s*"MP"/
  );
});

test("keeps the AI toggle at the right edge of Project guide controls", () => {
  const html = fs.readFileSync(
    path.join(__dirname, "../public/avr.html"),
    "utf8"
  );
  const css = fs.readFileSync(
    path.join(__dirname, "../public/AVR-Programming.css"),
    "utf8"
  );
  const guideControlsStart = html.indexOf(
    'aria-label="Project guide controls"'
  );
  const localeIndex = html.indexOf(
    'id="documentationLocaleSelect"',
    guideControlsStart
  );
  const editIndex = html.indexOf(
    'id="documentationEditToggle"',
    guideControlsStart
  );
  const aiToggleIndex = html.indexOf('id="projectAiToggle"', guideControlsStart);
  const documentationViewIndex = html.indexOf(
    'id="projectDocumentationView"',
    guideControlsStart
  );

  assert.ok(guideControlsStart >= 0);
  assert.ok(localeIndex > guideControlsStart);
  assert.ok(editIndex > localeIndex);
  assert.ok(aiToggleIndex > editIndex);
  assert.ok(aiToggleIndex < documentationViewIndex);
  assert.match(
    html.slice(aiToggleIndex, documentationViewIndex),
    /icons\/logo-512\.png/
  );
  assert.match(
    css,
    /\.documentation-action-strip \.project-ai-toggle\s*\{[\s\S]*?width:\s*44px !important;[\s\S]*?min-width:\s*44px !important;[\s\S]*?margin-left:\s*auto !important;/
  );
  assert.match(
    css,
    /\.documentation-action-strip\s*>\s*\[hidden\]\s*\{[\s\S]*?display:\s*none !important;/
  );
});

test("wires the project AI pane to the AVR AI API contract", () => {
  const html = fs.readFileSync(
    path.join(__dirname, "../public/avr.html"),
    "utf8"
  );
  const source = fs.readFileSync(
    path.join(__dirname, "../public/AVR-Programming.js"),
    "utf8"
  );

  assert.match(html, /id="projectAiHeader"[^>]*hidden/);
  assert.match(html, /id="projectAiTitle">Uart Debug AI/);
  assert.match(html, /id="projectAiView"/);
  assert.match(html, /id="projectAiWorkspace"/);
  assert.match(html, /id="projectAiHistory"[\s\S]*role="log"/);
  assert.match(html, /id="projectAiForm"/);
  assert.doesNotMatch(html, /id="projectAiAccessToken"/);
  assert.doesNotMatch(html, /id="projectAiClearBtn"/);
  assert.doesNotMatch(html, /project-ai-status-label/);
  assert.doesNotMatch(html, /id="projectAiStatus"/);
  assert.doesNotMatch(html, /Describe the mini-project you need/);
  assert.doesNotMatch(source, /fetch\("\/api\/avr\/ai\/status"/);
  assert.match(source, /fetch\("\/api\/avr\/ai\/respond"/);
  assert.match(source, /data\.kind === "answer"/);
  assert.match(source, /rememberProjectAiExchange\(request, answer\)/);
  assert.match(source, /appendProjectAiThinking\(\)/);
  assert.match(source, /removeProjectAiThinking\(thinkingIndicator\)/);
  assert.match(source, /data\.kind !== "project" && !data\.project/);
  assert.match(source, /operation === "update"/);
  assert.match(source, /responseTarget !== expectedTarget/);
  assert.match(source, /assertProjectAiUpdateIsFresh\(requestPayload\)/);
  assert.match(source, /Newer local edits were not overwritten/);
  assert.match(
    source,
    /UartDebugAvrMiniProjects\.updateInstance\([\s\S]*?expectedTarget/
  );
  assert.match(source, /projectAiForm\?\.requestSubmit\(\)/);
  assert.match(source, /"API key is not configured"/);
  assert.doesNotMatch(source, /"X-UartDebug-AI-Token"/);
  assert.doesNotMatch(source, /PROJECT_AI_ACCESS_STORAGE_KEY/);
  assert.doesNotMatch(source, /readProjectAiAccessToken/);
  assert.doesNotMatch(source, /clearProjectAiHistory/);
  assert.match(source, /typeof publicProject\.aiSpecRef\?\.id === "string"/);
  assert.doesNotMatch(source, /PROJECT_AI_MAX_CONVERSATION_MESSAGES/);
  assert.doesNotMatch(source, /projectAiConversation\.slice\(/);
  assert.doesNotMatch(
    source,
    /cloneJsonMetadata\(publicProject\.aiSpecRef/
  );
  assert.doesNotMatch(
    source,
    /^\s*aiSpecRef:\s*descriptor\.aiSpecRef,\s*$/m
  );
  assert.match(
    source,
    /\.\.\.\(descriptor\.aiSpecRef[\s\S]*?\{\s*aiSpecRef:\s*descriptor\.aiSpecRef\s*\}/
  );
  assert.match(
    source,
    /window\.UartDebugAvrMiniProjects\.install\(\s*definition/
  );
  assert.match(
    source,
    /rawFile\?\.role === "humanGuide"[\s\S]*miniProjectCore\.ROLES\.GUIDE/
  );
  assert.match(
    html,
    /placeholder="Ask a question or request an AVR mini-project"/
  );
  assert.match(html, />\s*Send\s*<\/button>/);
});

test("keeps only technical AI concurrency safeguards", () => {
  const serverSource = fs.readFileSync(
    path.join(__dirname, "../backend/ai-server.js"),
    "utf8"
  );
  const serviceUnit = fs.readFileSync(
    path.join(__dirname, "../backend/deploy/uartdebug-ai.service"),
    "utf8"
  );
  const nginxLocation = fs.readFileSync(
    path.join(__dirname, "../backend/deploy/nginx-avr-ai-location.conf"),
    "utf8"
  );
  const nginxCleanup = fs.readFileSync(
    path.join(__dirname, "../backend/deploy/remove-ai-request-limits.sh"),
    "utf8"
  );
  const deployWorkflow = fs.readFileSync(
    path.join(__dirname, "../.github/workflows/deploy.yml"),
    "utf8"
  );

  assert.doesNotMatch(serverSource, /AI_(?:RATE|DAILY)_/);
  assert.doesNotMatch(serviceUnit, /AI_(?:RATE|DAILY)_/);
  assert.doesNotMatch(nginxLocation, /^\s*limit_req\s/m);
  assert.match(nginxLocation, /^\s*limit_conn\s+uartdebug_conn_per_ip\s+2;/m);
  assert.match(serverSource, /AI_MAX_CONCURRENT/);
  assert.match(nginxCleanup, /zone=uartdebug_ai_per_ip/);
  assert.match(
    deployWorkflow,
    /run_sudo \/bin\/bash[\s\\\n]+"\$\{BE_SRC\}\/deploy\/remove-ai-request-limits\.sh"/
  );
});

test("gives Add file enough width and lets catalog text wrap", () => {
  const css = fs.readFileSync(
    path.join(__dirname, "../public/AVR-Programming.css"),
    "utf8"
  );

  assert.match(
    css,
    /\.file-add-dialog\s*\{[\s\S]*?width:\s*min\(96vw,\s*1100px\);/
  );
  assert.match(
    css,
    /\.file-template-card\s*\{[\s\S]*?grid-template-columns:\s*minmax\(250px,\s*0\.42fr\)\s*minmax\(0,\s*1fr\);/
  );
  assert.match(
    css,
    /\.file-template-card \.file-add-card-title,[\s\S]*?\.file-template-card \.file-add-card-copy\s*\{[\s\S]*?overflow-wrap:\s*anywhere;[\s\S]*?white-space:\s*normal;/
  );
});

test("does not render the obsolete AI context row", () => {
  const html = fs.readFileSync(
    path.join(__dirname, "../public/avr.html"),
    "utf8"
  );
  const css = fs.readFileSync(
    path.join(__dirname, "../public/AVR-Programming.css"),
    "utf8"
  );
  const source = fs.readFileSync(
    path.join(__dirname, "../public/AVR-Programming.js"),
    "utf8"
  );

  assert.doesNotMatch(html, /class="project-ai-context"/);
  assert.doesNotMatch(html, /id="projectAiContextFile"/);
  assert.doesNotMatch(html, /id="projectAiContextMcu"/);
  assert.doesNotMatch(css, /\.project-ai-context/);
  assert.doesNotMatch(source, /refreshProjectAiContext/);
  assert.match(source, /mcu:\s*String\(mcuSelect\?\.value/);
});

test("lets the guide pane grow until the editor reaches its minimum width", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../public/AVR-Programming.js"),
    "utf8"
  );

  assert.match(
    source,
    /rect\.width\s*-\s*outlinerWidth\s*-\s*OUTLINER_EDITOR_MIN_WIDTH\s*-\s*SPLIT_RESIZER_TOTAL_WIDTH/
  );
  assert.doesNotMatch(source, /halfSplitWidth/);
  assert.doesNotMatch(source, /availableDocumentationWidth\s*\/\s*2/);
});

test("uses sibling framed AI workspace and request composer", () => {
  const html = fs.readFileSync(
    path.join(__dirname, "../public/avr.html"),
    "utf8"
  );
  const css = fs.readFileSync(
    path.join(__dirname, "../public/AVR-Programming.css"),
    "utf8"
  );
  const viewStart = html.indexOf('id="projectAiView"');
  const viewEnd = html.indexOf("</aside>", viewStart);
  const view = html.slice(viewStart, viewEnd);
  const workspace = view.indexOf('id="projectAiWorkspace"');
  const formStart = html.indexOf('id="projectAiForm"');
  const formEnd = html.indexOf("</form>", formStart);
  const form = html.slice(formStart, formEnd);
  const composer = form.indexOf("project-ai-composer");
  const prompt = form.indexOf('id="projectAiPrompt"');
  const submit = form.indexOf('id="projectAiSubmitBtn"');

  assert.ok(viewStart >= 0);
  assert.ok(workspace >= 0);
  assert.ok(view.indexOf('id="projectAiForm"') > workspace);
  assert.ok(composer < prompt);
  assert.ok(prompt < submit);
  assert.doesNotMatch(form, /projectAiAccessToken|projectAiClearBtn/);
  assert.match(
    view,
    /project-ai-workspace[^"]*scroll-frame|scroll-frame[^"]*project-ai-workspace/
  );
  assert.match(
    form,
    /project-ai-composer[^"]*scroll-frame|scroll-frame[^"]*project-ai-composer/
  );
  assert.match(css, /\.project-ai-view\s*\{[\s\S]*?flex-direction:\s*column;/);
  assert.match(
    css,
    /\.project-ai-form\s*\{[\s\S]*?margin-top:\s*12px;/
  );
  assert.match(css, /\.project-ai-composer:focus-within\s*\{/);
  assert.match(css, /#projectAiPrompt\s*\{[\s\S]*?border:\s*0;/);
  assert.match(css, /#projectAiPrompt\s*\{[\s\S]*?background:\s*transparent;/);
});

test("renames a mini-project display name without renaming its linked files", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../public/AVR-Programming.js"),
    "utf8"
  );

  assert.match(source, /mode:\s*"rename-project"/);
  assert.match(
    source,
    /function renameMiniProjectInstance[\s\S]*?project\.displayName = name;/
  );
  assert.match(
    source,
    /renameInstance\(instanceId, displayName\)[\s\S]*?renameMiniProjectInstance/
  );
  assert.doesNotMatch(
    source,
    /renameBtn\.hidden\s*=\s*!!isMiniProjectSource/
  );
});

test("renders every built-in card from its catalog and default guide", () => {
  const html = fs.readFileSync(
    path.join(__dirname, "../public/avr.html"),
    "utf8"
  );
  const source = fs.readFileSync(
    path.join(__dirname, "../public/AVR-Programming.js"),
    "utf8"
  );
  const sw = fs.readFileSync(
    path.join(__dirname, "../public/sw.js"),
    "utf8"
  );
  const publicCatalog = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "../public/avr-mini-projects/catalog.json"),
      "utf8"
    )
  );
  const privateCatalog = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "../backend/ai/mini-projects/catalog.json"),
      "utf8"
    )
  );
  const templateGridStart = html.indexOf('id="fileTemplateGrid"');
  const templateGridEnd = html.indexOf("</div>", templateGridStart);
  const templateGridMarkup = html.slice(templateGridStart, templateGridEnd);

  assert.ok(templateGridStart >= 0);
  assert.doesNotMatch(templateGridMarkup, /data-template-id|file-add-card-copy/);
  assert.match(source, /function renderBuiltInMiniProjectCards\(\)/);
  assert.match(
    source,
    /title\.textContent\s*=\s*String\(descriptor\.displayName\s*\|\|\s*descriptor\.id\)/
  );
  assert.match(
    source,
    /copy\.textContent\s*=\s*description/
  );
  assert.doesNotMatch(source, /copy\.innerHTML/);
  assert.doesNotMatch(source, /summary:\s*descriptor\.summary/);
  assert.deepEqual(
    publicCatalog.projects.map((entry) => entry.id),
    [
      "01_Minimum",
      "02_CPU_Clock",
      "03_Delay-Based_Blink",
      "04_Timer_Interrupt_Blink",
      "05_UART_Basic_Transmission",
      "06_UART_Basic_Receive",
      "07_Printf_Redirect_USART0",
      "08_Printf_Redirect_USART1",
      "09_UART0_Interrupt_Transmission",
      "10_UART1_Interrupt_Transmission",
    ]
  );

  for (const project of publicCatalog.projects) {
    const privateReference = privateCatalog.projects.find(
      (entry) => entry.id === project.id
    );
    assert.equal(project.aiSpecRef, undefined);
    assert.ok(privateReference, `missing private AI reference for ${project.id}`);

    const sourcePath = path.join(
      __dirname,
      "../public",
      project.source.url.replace(/^\/+/, "")
    );
    const aiPath = path.join(
      __dirname,
      "../backend/ai/mini-projects",
      privateReference.file
    );
    assert.ok(fs.existsSync(sourcePath), sourcePath);
    assert.ok(fs.existsSync(aiPath), aiPath);
    const defaultGuide =
      project.guides.find(
        (guide) =>
          String(guide.locale || "").toLowerCase() ===
          String(project.defaultLocale || "").toLowerCase()
      ) || project.guides[0];
    const defaultGuidePath = path.join(
      __dirname,
      "../public",
      defaultGuide.url.replace(/^\/+/, "")
    );
    const extractedDescription = core.extractShortProjectDescription(
      fs.readFileSync(defaultGuidePath, "utf8")
    );
    assert.ok(
      extractedDescription,
      `${project.id}: missing Short Project Description in the default guide`
    );
    if (Object.hasOwn(project, "summary")) {
      assert.equal(project.summary, extractedDescription);
    }
    assert.equal(
      crypto.createHash("sha256").update(fs.readFileSync(aiPath)).digest("hex"),
      privateReference.sha256
    );
    assert.ok(sw.includes(project.source.url));

    const markers = extractDocumentationMarkers(
      fs.readFileSync(sourcePath, "utf8")
    );
    for (const guide of project.guides) {
      const guidePath = path.join(
        __dirname,
        "../public",
        guide.url.replace(/^\/+/, "")
      );
      assert.ok(fs.existsSync(guidePath), guidePath);
      assert.ok(sw.includes(guide.url), `${guide.url}: missing from service worker`);

      const guideMarkdown = fs.readFileSync(guidePath, "utf8");
      const headings = new Set(
        extractMarkdownHeadings(guideMarkdown).map((heading) => heading.key)
      );
      for (const marker of markers) {
        assert.ok(
          headings.has(marker.key),
          `${project.id}/${guide.locale}: ${marker.key}`
        );
      }

      for (const image of guideMarkdown.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)) {
        const assetUrl = new URL(
          image[1],
          new URL(guide.assetBaseUrl || guide.url, "https://uartdebug.test")
        ).pathname;
        const assetPath = path.join(
          __dirname,
          "../public",
          decodeURIComponent(assetUrl).replace(/^\/+/, "")
        );
        assert.ok(fs.existsSync(assetPath), assetPath);
        assert.ok(sw.includes(assetUrl), `${assetUrl}: missing from service worker`);
      }
    }
  }

  const cpuClock = publicCatalog.projects.find(
    (entry) => entry.id === "02_CPU_Clock"
  );
  const delayBlink = publicCatalog.projects.find(
    (entry) => entry.id === "03_Delay-Based_Blink"
  );
  const cpuClockReference = privateCatalog.projects.find(
    (entry) => entry.id === "02_CPU_Clock"
  );
  const delayBlinkReference = privateCatalog.projects.find(
    (entry) => entry.id === "03_Delay-Based_Blink"
  );

  assert.equal(cpuClock.version, "1.2.3-b");
  assert.equal(cpuClockReference.version, "1.2.3-a");
  assert.equal(delayBlink.displayName, "03_Delay-Based_Blink");
  assert.equal(delayBlink.version, "1.2.3-b");
  assert.equal(
    delayBlink.source.name,
    "03_Delay-Based_Blink_1.2.3-b.c"
  );
  assert.equal(
    delayBlink.guides[0].name,
    "03_Delay-Based_Blink_help_1.2.3-b.md"
  );
  assert.equal(delayBlinkReference.version, "1.2.3-b");
  assert.equal(
    delayBlinkReference.file,
    "03_Delay-Based_Blink/03_Delay-Based_Blink_AI_1.2.3-b.md"
  );
  const delayBlinkSourcePath = path.join(
    __dirname,
    "../public",
    delayBlink.source.url.replace(/^\/+/, "")
  );
  assert.equal(
    extractDocumentationMarkers(
      fs.readFileSync(delayBlinkSourcePath, "utf8")
    ).length,
    14
  );
});
