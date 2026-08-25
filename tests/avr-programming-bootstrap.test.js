"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
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

test("vendored Markdown mode uses a non-ambiguous HTML tag lookahead", () => {
  const markdownMode = fs.readFileSync(
    path.join(
      __dirname,
      "../public/vendor/codemirror/5.65.16/mode/markdown/markdown.js"
    ),
    "utf8"
  );

  assert.match(
    markdownMode,
    /\[a-z\]\[a-z0-9-\]\*\(\?=\[\\s\/>\]\|\$\)/
  );
  assert.doesNotMatch(
    markdownMode,
    /\(\?:\\s\+\[a-z_:\.\\-\]\+\(\?:\\s\*\=\\s\*\[\^>\]\+\)\?\)\*/
  );
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

test("keeps documentation separate and uses a full-height AI workspace rail", () => {
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
  const stageStart = html.indexOf('id="projectWorkspaceStage"');
  const documentationStart = html.indexOf('id="projectDocumentationPane"');
  const documentationEnd = html.indexOf("</aside>", documentationStart);
  const aiSceneStart = html.indexOf('id="projectAiScene"');
  const aiViewStart = html.indexOf('id="projectAiView"');
  const aiToggleIndex = html.indexOf('id="projectAiToggle"');

  assert.ok(stageStart >= 0);
  assert.ok(documentationStart > stageStart);
  assert.ok(documentationEnd > documentationStart);
  assert.ok(aiSceneStart > documentationEnd);
  assert.ok(aiViewStart > aiSceneStart);
  assert.ok(aiToggleIndex > aiViewStart);
  assert.doesNotMatch(
    html.slice(documentationStart, documentationEnd),
    /projectAiView|projectAiHeader|projectAiToggle/
  );
  assert.match(html.slice(aiToggleIndex), /icons\/logo-512\.png/);
  assert.match(
    css,
    /\.project-ai-toggle\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?top:\s*0;[\s\S]*?bottom:\s*0;[\s\S]*?left:\s*calc\(100% - var\(--project-workspace-rail-width\)\);/
  );
  assert.match(
    css,
    /\.project-workspace-stage\[data-mode="ai"\] \.project-ai-toggle\s*\{[\s\S]*?left:\s*0;/
  );
  assert.match(
    html.slice(aiToggleIndex),
    /project-ai-toggle-label-word[\s\S]*?<span>A<\/span><span>I<\/span>[\s\S]*?project-ai-toggle-label-word[\s\S]*?<span>A<\/span><span>S<\/span><span>S<\/span>/
  );
  assert.match(
    css,
    /\.project-ai-toggle\s*\{[\s\S]*?background:\s*var\(--avr-window-bg\);/
  );
  assert.match(
    css,
    /\.project-ai-toggle::before\s*\{[\s\S]*?linear-gradient\(90deg, transparent, var\(--avr-bg\)\)/
  );
  assert.match(
    css,
    /\.project-ai-toggle-arrow::before,[\s\S]*?\.project-ai-toggle-arrow::after\s*\{[\s\S]*?height:\s*50%;/
  );
  assert.doesNotMatch(css, /project-workspace-rail-breathe/);
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

  assert.match(html, /id="projectWorkspaceStage"[\s\S]*data-mode="avr"/);
  assert.match(html, /id="avrWorkspaceScene"/);
  assert.match(html, /id="projectAiScene"[\s\S]*aria-hidden="true"[\s\S]*inert/);
  assert.match(html, /id="projectAiHeader"/);
  assert.match(html, /id="projectAiTitle">Uart Debug AI/);
  assert.match(html, /id="projectAiView"/);
  assert.match(html, /id="projectAiWorkspace"/);
  assert.match(html, /id="projectAiHistory"[\s\S]*role="log"/);
  assert.match(html, /id="projectAiForm"/);
  assert.match(
    html,
    /id="projectAiAuth"[\s\S]*?aria-label="AI access"[\s\S]*?hidden[\s\S]*?id="projectAiAccountBtn"/
  );
  assert.match(
    html,
    /id="projectAiAccountStatus"[\s\S]*?role="status"[\s\S]*?aria-live="polite"/
  );
  assert.match(html, /id="projectAiAccountBtn"/);
  assert.match(html, /id="projectAiSignInBtn"[\s\S]*Continue with Google/);
  assert.match(html, /id="projectAiAccount"/);
  assert.match(html, /id="projectAiCredits"/);
  assert.match(html, /id="projectAiBudget"[\s\S]*role="progressbar"/);
  assert.match(html, /id="projectAiBudgetFill"/);
  assert.match(html, /id="projectAiSignOutBtn"[\s\S]*Sign out/);
  assert.match(html, /id="projectInstructionEditor"/);
  assert.doesNotMatch(html, /id="projectInstructionPreview"/);
  assert.match(
    html,
    /vendor\/codemirror\/5\.65\.16\/mode\/markdown\/markdown\.js/
  );
  assert.match(html, /id="projectSkillsList"[\s\S]*role="list"/);
  assert.doesNotMatch(html, /accounts\.google\.com\/gsi|gsi\/client/);
  assert.doesNotMatch(html, /id="projectAiAccessToken"/);
  assert.doesNotMatch(html, /id="projectAiClearBtn"/);
  assert.doesNotMatch(html, /project-ai-status-label/);
  assert.doesNotMatch(html, /id="projectAiStatus"/);
  assert.doesNotMatch(html, /Describe the mini-project you need/);
  assert.doesNotMatch(source, /fetch\("\/api\/avr\/ai\/status"/);
  assert.match(source, /fetch\("\/api\/avr\/ai\/respond"/);
  assert.match(source, /PROJECT_AI_SKILLS_URL\s*=\s*"\/api\/avr\/ai\/skills"/);
  assert.doesNotMatch(source, /AI_BROWSER_INSTALLATION_STORAGE_KEY/);
  assert.doesNotMatch(source, /X-UartDebug-Installation/);
  assert.doesNotMatch(source, /getAiBrowserInstallationHeader/);
  assert.match(
    source,
    /if \(session\?\.mode !== "google"\) \{[\s\S]*?closeProjectAiAccountModal\(\{ restoreFocus: false \}\);[\s\S]*?return;[\s\S]*?\}/
  );
  assert.match(source, /PROJECT_AI_AUTH_SESSION_URL[\s\S]*method: "GET"/);
  assert.match(source, /credentials: "same-origin"/);
  assert.match(
    source,
    /fetch\("\/api\/avr\/ai\/respond"[\s\S]*credentials: "same-origin"/
  );
  assert.match(
    source,
    /fetchProjectAiAuthSession\(\)[\s\S]*fetch\(PROJECT_AI_GOOGLE_START_URL[\s\S]*credentials: "same-origin"[\s\S]*redirectUrl\.hostname !== "accounts\.google\.com"[\s\S]*window\.location\.assign\(redirectUrl\.toString\(\)\)/
  );
  assert.match(source, /PROJECT_AI_LOGOUT_URL[\s\S]*method: "POST"/);
  assert.match(source, /google_sign_in_required/);
  assert.match(source, /free_quota_exhausted/);
  assert.match(source, /browser installation are exhausted/);
  assert.match(source, /data\.kind === "answer"/);
  assert.match(source, /data\.kind === "instruction"/);
  assert.match(
    source,
    /instructionDocument:\s*getProjectInstructionSnapshot\(\{ forRequest: true \}\)/
  );
  assert.match(source, /assertProjectAiInstructionIsFresh\(requestPayload\)/);
  assert.match(source, /updateProjectAiQuota\(data\.quota\)/);
  assert.match(source, /schemaVersion !== 1/);
  assert.match(source, /responseRevision !== baseRevision \+ 1/);
  assert.match(source, /typeof revisedMarkdown !== "string"/);
  assert.match(source, /projectAiQuotaUpdateSequence/);
  assert.match(source, /projectAiLatestQuota/);
  assert.match(source, /projectAiAuthRequestEpoch/);
  assert.match(source, /projectAiAuthSessionPromise === sessionPromise/);
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
  assert.match(source, /PROJECT_AI_REQUEST_TARGET_BYTES\s*=\s*768 \* 1024/);
  assert.match(source, /selectProjectAiConversation\(payload\)/);
  assert.match(source, /selected\.unshift\(\.\.\.added\)/);
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
    /placeholder="Ask, revise the instruction, or request a project"/
  );
  assert.match(html, />\s*Send\s*<\/button>/);
});

test("keeps Google AI account controls in an accessible account modal", () => {
  const html = fs.readFileSync(
    path.join(__dirname, "../public/avr.html"),
    "utf8"
  );
  const source = fs.readFileSync(
    path.join(__dirname, "../public/AVR-Programming.js"),
    "utf8"
  );
  const css = fs.readFileSync(
    path.join(__dirname, "../public/AVR-Programming.css"),
    "utf8"
  );

  const headerStart = html.indexOf('id="projectAiHeader"');
  const headerEnd = html.indexOf('id="projectAiBudget"', headerStart);
  const accountModalStart = html.indexOf('id="projectAiAccountModal"');
  const accountModalEnd = html.indexOf('id="siteDialog"', accountModalStart);
  assert.ok(headerStart >= 0 && headerEnd > headerStart);
  assert.ok(accountModalStart >= 0 && accountModalEnd > accountModalStart);

  const header = html.slice(headerStart, headerEnd);
  const modal = html.slice(accountModalStart, accountModalEnd);
  assert.match(
    header,
    /id="projectAiAccountBtn"[\s\S]*?aria-haspopup="dialog"[\s\S]*?aria-controls="projectAiAccountModal"[\s\S]*?aria-expanded="false"/
  );
  assert.doesNotMatch(
    header,
    /project-ai-google-sign-in-asset|id="projectAiPrivacyNote"|id="projectAiAccount"|id="projectAiCredits"|id="projectAiSignOutBtn"/
  );
  assert.match(
    modal,
    /role="dialog"[\s\S]*?aria-modal="true"[\s\S]*?aria-labelledby="projectAiAccountModalTitle"[\s\S]*?hidden/
  );
  assert.match(modal, /id="projectAiAccountCard"[\s\S]*?tabindex="-1"/);
  assert.match(modal, /id="projectAiAccountCloseBtn"/);
  assert.match(modal, /id="projectAiAccountStatus"[\s\S]*?role="status"/);
  for (const requiredControl of [
    "project-ai-google-sign-in-asset",
    'id="projectAiPrivacyNote"',
    'id="projectAiAccount"',
    'id="projectAiCredits"',
    'id="projectAiSignOutBtn"',
  ]) {
    assert.ok(
      modal.includes(requiredControl),
      `account modal is missing ${requiredControl}`
    );
  }

  const openStart = source.indexOf("function openProjectAiAccountModal()");
  const closeStart = source.indexOf(
    "function closeProjectAiAccountModal",
    openStart
  );
  const renderStart = source.indexOf(
    "function renderProjectAiAuthSession",
    closeStart
  );
  assert.ok(openStart >= 0 && closeStart > openStart && renderStart > closeStart);
  const openSource = source.slice(openStart, closeStart);
  const closeSource = source.slice(closeStart, renderStart);
  assert.match(openSource, /modal\.hidden = false/);
  assert.match(openSource, /trigger\.setAttribute\("aria-expanded", "true"\)/);
  assert.match(
    openSource,
    /const focusTarget = signIn && !signIn\.hidden \? signIn : card/
  );
  assert.match(openSource, /focusTarget\.focus\(\{ preventScroll: true \}\)/);
  assert.match(closeSource, /modal\.hidden = true/);
  assert.match(closeSource, /trigger\.setAttribute\("aria-expanded", "false"\)/);
  assert.match(closeSource, /trigger\.focus\(\{ preventScroll: true \}\)/);
  assert.match(
    source,
    /projectAiAccountBtn &&[\s\S]*?projectAiAccountBtn\.addEventListener\("click", openProjectAiAccountModal\)/
  );
  assert.match(
    source,
    /projectAiAccountCloseBtn &&[\s\S]*?projectAiAccountCloseBtn\.addEventListener\([\s\S]*?"click",[\s\S]*?closeProjectAiAccountModal/
  );
  assert.match(
    source,
    /if \(event\.target === projectAiAccountModal\) \{\s*closeProjectAiAccountModal\(\);\s*\}/
  );
  assert.match(
    source,
    /if \(e\.key === "Escape"\) \{[\s\S]*?if \(projectAiAccountModal && !projectAiAccountModal\.hidden\) \{\s*closeProjectAiAccountModal\(\);\s*return;/
  );
  assert.match(source, /function trapProjectAiAccountFocus\(event\)/);
  assert.match(
    source,
    /document\.addEventListener\("keydown", \(e\) => \{\s*if \(trapProjectAiAccountFocus\(e\)\) return;/
  );
  assert.match(
    source,
    /projectAiAuthSession = \{\s*mode: "google",\s*configured: true,\s*authenticated: false,\s*quota: null,\s*\};\s*renderProjectAiAuthSession\(projectAiAuthSession\);/
  );
  assert.match(source, /setProjectAiAccountStatus\(message, "error"\)/);
  assert.match(
    css,
    /\.project-ai-account-modal\s*\{[\s\S]*?backdrop-filter:\s*blur\(8px\);/
  );
  assert.match(
    css,
    /\.project-ai-account-card\s*\{[\s\S]*?width:\s*min\(100%, 520px\);[\s\S]*?background:\s*var\(--avr-window-bg\);/
  );
  assert.match(
    css,
    /\.project-ai-google-sign-in\s*\{[\s\S]*?width:\s*100%;[\s\S]*?background:\s*rgba\(39, 174, 96, 0\.1\);/
  );
  assert.match(
    css,
    /\.project-ai-account-status\[data-tone="error"\]\s*\{[\s\S]*?color:\s*#ffe0aa;/
  );
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
  const oauthCallbackLocation = fs.readFileSync(
    path.join(
      __dirname,
      "../backend/deploy/nginx-avr-ai-oauth-callback-location.conf"
    ),
    "utf8"
  );
  const oauthLogRedaction = fs.readFileSync(
    path.join(
      __dirname,
      "../backend/deploy/redact-oauth-callback-logging.sh"
    ),
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
  assert.match(
    oauthCallbackLocation,
    /location = \/api\/avr\/ai\/auth\/google\/callback\s*\{[\s\S]*?access_log off;/
  );
  assert.match(oauthLogRedaction, /BEGIN uartdebug-ai-oauth-callback/);
  assert.match(oauthLogRedaction, /unmanaged exact OAuth callback location/);
  assert.match(serverSource, /AI_MAX_CONCURRENT/);
  assert.match(nginxCleanup, /zone=uartdebug_ai_per_ip/);
  assert.match(
    deployWorkflow,
    /run_sudo \/bin\/bash[\s\\\n]+"\$\{BE_SRC\}\/deploy\/remove-ai-request-limits\.sh"/
  );
  assert.match(
    deployWorkflow,
    /run_sudo \/bin\/bash[\s\\\n]+"\$\{BE_SRC\}\/deploy\/redact-oauth-callback-logging\.sh"/
  );
  assert.match(deployWorkflow, /run_sudo nginx -t/);
});

test("scopes the AI credential umask to secret generation", () => {
  const installer = fs.readFileSync(
    path.join(__dirname, "../backend/deploy/install-ai-service.sh"),
    "utf8"
  );

  assert.match(
    installer,
    /\(\s*umask 0077\s*openssl rand -hex 32 > "\$\{credential_path\}"\s*\)/
  );
});

test("installs OAuth callback log redaction idempotently", (t) => {
  const bash =
    process.platform === "win32"
      ? "C:\\Program Files\\Git\\bin\\bash.exe"
      : "bash";
  if (process.platform === "win32" && !fs.existsSync(bash)) {
    t.skip("Git Bash is not installed");
    return;
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "uartdebug-nginx-"));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const siteFile = path.join(tempRoot, "uartdebug.com");
  const scriptFile = path.join(
    __dirname,
    "../backend/deploy/redact-oauth-callback-logging.sh"
  );
  const snippetFile = path.join(
    __dirname,
    "../backend/deploy/nginx-avr-ai-oauth-callback-location.conf"
  );
  fs.writeFileSync(
    siteFile,
    [
      "server {",
      "    location ^~ /api/avr/ai/ {",
      "        proxy_pass http://127.0.0.1:8083;",
      "    }",
      "}",
      "",
    ].join("\n")
  );

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = childProcess.spawnSync(
      bash,
      [scriptFile, siteFile, snippetFile],
      { encoding: "utf8" }
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
  }

  const migrated = fs.readFileSync(siteFile, "utf8");
  assert.equal(
    (migrated.match(/location = \/api\/avr\/ai\/auth\/google\/callback/g) || [])
      .length,
    1
  );
  assert.match(migrated, /access_log off;/);
  assert.match(migrated, /location \^~ \/api\/avr\/ai\//);
});

test("treats the staged AI skills catalog as authoritative during deploy", () => {
  const installer = fs.readFileSync(
    path.join(__dirname, "../backend/deploy/install-ai-service.sh"),
    "utf8"
  );

  assert.match(installer, /shopt -s nullglob/);
  assert.match(
    installer,
    /rm -f -- "\$\{backend_dir\}\/ai\/skills\/"\*\.md/
  );
  assert.match(installer, /if \[ "\$\{#skill_markdown\[@\]\}" -gt 0 \]/);
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

test("uses three sibling AI panels with live Markdown and a framed composer", () => {
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
  const aiLayoutStart = html.indexOf("project-ai-layout");
  const chatPanel = html.indexOf("project-ai-chat-panel", aiLayoutStart);
  const instructionPanel = html.indexOf(
    "project-instruction-panel",
    aiLayoutStart
  );
  const skillsPanel = html.indexOf("project-skills-panel", aiLayoutStart);
  const chatResizer = html.indexOf('id="projectAiChatResizer"', aiLayoutStart);
  const skillsResizer = html.indexOf(
    'id="projectAiSkillsResizer"',
    aiLayoutStart
  );

  assert.ok(viewStart >= 0);
  assert.ok(aiLayoutStart >= 0);
  assert.ok(chatPanel > aiLayoutStart);
  assert.ok(chatResizer > chatPanel);
  assert.ok(instructionPanel > chatResizer);
  assert.ok(skillsResizer > instructionPanel);
  assert.ok(skillsPanel > skillsResizer);
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
  assert.match(
    css,
    /\.project-ai-layout\s*\{[\s\S]*?grid-template-columns:[\s\S]*?minmax\(270px,[\s\S]*?var\(--project-ai-resizer-width\)[\s\S]*?minmax\(350px,[\s\S]*?var\(--project-ai-resizer-width\)[\s\S]*?minmax\(240px,/
  );
  assert.match(css, /\.project-ai-layout\s*\{[\s\S]*?gap:\s*0;/);
  assert.match(
    html,
    /id="projectAiChatResizer"[\s\S]*?role="separator"[\s\S]*?aria-orientation="vertical"/
  );
  assert.match(
    html,
    /id="projectAiSkillsResizer"[\s\S]*?role="separator"[\s\S]*?aria-orientation="vertical"/
  );
  assert.match(
    source,
    /projectAiChatPreferredWidth\s*=\s*resolved\.chat;[\s\S]*?projectAiSkillsPreferredWidth\s*=\s*resolved\.skills;/
  );
  assert.match(
    css,
    /\.project-instruction-workspace\s*\{[\s\S]*?display:\s*flex;/
  );
  assert.match(source, /AI_SKILL_DRAG_MIME/);
  assert.match(source, /CodeMirror\.fromTextArea\(editorElement/);
  assert.match(source, /name:\s*"markdown"/);
  assert.match(source, /inputField\.setAttribute\("role", "textbox"\)/);
  assert.match(
    source,
    /inputField\.setAttribute\("data-tooltip-disabled", ""\)/
  );
  assert.match(source, /projectInstructionEditor\.markText\(/);
  assert.match(source, /"cursorActivity"/);
  assert.match(source, /projectInstructionEditor\.replaceRange\(/);
  assert.doesNotMatch(source, /setRangeText\(/);
  assert.match(source, /insertProjectAiSkill\(skillId, \{ append: true \}\)/);
  assert.match(source, /function bindProjectAiResizers\(\)/);
  assert.match(source, /STORAGE_PROJECT_AI_CHAT_WIDTH/);
  assert.match(source, /STORAGE_PROJECT_AI_SKILLS_WIDTH/);
  assert.match(
    html,
    /project-instruction-live-editor scroll-frame[\s\S]*?id="projectInstructionDropZone"/
  );
  assert.doesNotMatch(html, /project-skills-help|Saved locally/);
  assert.doesNotMatch(source, /Saved locally/);
  assert.match(source, /getCompatibleInstructionSkillRefs/);
  assert.match(
    source,
    /skillRefs:\s*projectAiSkillsLoaded\s*\?\s*responseInstruction\.skillRefs\s*:\s*undefined/
  );
  assert.match(source, /projectInstructionStorageReadFailed && !recover/);
  assert.match(source, /Stored instruction is unreadable/);
  assert.match(source, /const DEFAULT_PROJECT_INSTRUCTION = "";/);
  assert.match(source, /ud_avr_ai_project_instruction_v2/);
  assert.match(source, /ud_avr_ai_project_instruction_v1/);
  assert.match(source, /const LEGACY_DEFAULT_PROJECT_INSTRUCTION = \[/);
  assert.match(
    source,
    /legacyDocument\.markdown === LEGACY_DEFAULT_PROJECT_INSTRUCTION[\s\S]*?markdown:\s*DEFAULT_PROJECT_INSTRUCTION[\s\S]*?skillRefs:\s*\[\]/
  );
  assert.match(
    source,
    /localStorage\.setItem\(\s*STORAGE_PROJECT_INSTRUCTION,[\s\S]*?JSON\.stringify\(projectInstructionDocument\)/
  );
  assert.doesNotMatch(
    html,
    /placeholder="# Initialization|Describe what the project should do/
  );
  for (const level of [1, 2, 3, 4, 5, 6]) {
    assert.match(
      css,
      new RegExp(
        `pre\\.CodeMirror-line\\.project-instruction-line-heading-${level}`
      )
    );
  }
  assert.match(source, /setextHeading/);
  assert.match(source, /previousLineIsParagraph/);
  assert.match(source, /previousLineIsThematicBreak/);
  assert.match(source, /orderedMarker/);
  assert.match(source, /underscoreExpression/);
  assert.match(source, /function decorateProjectInstructionInline[\s\S]*?isEscaped/);
  assert.match(source, /const imageExpression = \/!\\\[/);
  const inlinePreviewStart = source.indexOf(
    "function decorateProjectInstructionInline"
  );
  const codePriority = source.indexOf("const codeRunExpression", inlinePreviewStart);
  const strongPriority = source.indexOf(
    '"project-instruction-live-strong"',
    inlinePreviewStart
  );
  assert.ok(
    codePriority > inlinePreviewStart && strongPriority > codePriority,
    "code spans must reserve their content before strong/emphasis"
  );
  assert.match(source, /project-instruction-task-marker/);
  assert.match(source, /const orderedTask = \/\^\\d\//);
  assert.match(source, /renderMarkdownInto\(markdown, message, null, \{ allowImages: false \}\)/);
  assert.match(source, /match\[0\]\.startsWith\("\*\*"\)/);
  assert.match(source, /document\.createElement\("strong"\)/);
  assert.match(source, /document\.createElement\("em"\)/);
  assert.match(source, /document\.createElement\("del"\)/);
  assert.match(source, /\(\?<!\[A-Za-z0-9\]\)_/);
  const headingSixRule = css.match(
    /pre\.CodeMirror-line\.project-instruction-line-heading-6\s*\{[\s\S]*?\}/
  )?.[0];
  assert.ok(headingSixRule);
  assert.doesNotMatch(headingSixRule, /text-transform:\s*uppercase/);
  assert.match(source, /control\.readOnly = !!busy/);
  assert.match(source, /prompt\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(source, /function consumeProjectAiAuthReturn\(\)/);
  assert.match(source, /url\.searchParams\.delete\("ai_auth"\)/);
  assert.match(source, /window\.history\.replaceState\(/);
  assert.match(source, /google_sign_in_denied:\s*"Google sign-in was cancelled\."/);
  assert.match(
    source,
    /setProjectWorkspaceMode\(projectAiAuthReturn \? "ai" : "avr"/
  );
  assert.match(
    css,
    /animation:\s*project-workspace-card-switch 980ms/
  );
  assert.match(
    css,
    /\.project-workspace-stage\.is-switching \.project-workspace-track\s*\{[\s\S]*?transition-delay:\s*250ms;/
  );
  assert.match(css, /\.is-toggle-departing[\s\S]*?\.project-ai-toggle/);
  assert.match(css, /\.is-toggle-hidden[\s\S]*?\.project-ai-toggle/);
  assert.match(source, /PROJECT_WORKSPACE_TOGGLE_EXIT_MS\s*=\s*180/);
  assert.match(source, /PROJECT_WORKSPACE_SWITCH_MS\s*=\s*1000/);
  assert.match(source, /PROJECT_WORKSPACE_TOGGLE_ENTER_MS\s*=\s*200/);
  assert.match(
    css,
    /\.project-workspace-track\s*\{[\s\S]*?transition:\s*transform 440ms/
  );
  assert.match(css, /@media \(max-width: 989px\)/);
  assert.match(css, /height:\s*clamp\(560px, 78vh, 700px\)/);
});

test("uses a full-width three-stage draggable device-panel separator", () => {
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
  const viewportStart = html.indexOf('id="avrDevicePanelViewport"');
  const persistentToggle = html.indexOf('id="devicePanelToggle"');

  assert.ok(viewportStart >= 0);
  assert.ok(persistentToggle > viewportStart);
  assert.match(html, /id="avrDeviceSection"[\s\S]*data-state="expanded"/);
  assert.match(
    html,
    /class="split-resizer device-panel-resizer"[\s\S]*?id="devicePanelToggle"[\s\S]*?role="separator"[\s\S]*?aria-orientation="horizontal"/
  );
  assert.doesNotMatch(html, /devicePanelHoverToggle|device-panel-toggle-arrow/);
  assert.match(
    css,
    /\.avr-device-panel-viewport\s*\{[\s\S]*?height:\s*var\(--device-panel-height\);/
  );
  assert.match(css, /--device-panel-height:\s*112px;/);
  assert.match(
    html,
    /id="devicePanelToggle"[\s\S]*?aria-valuemax="112"[\s\S]*?aria-valuenow="112"/
  );
  assert.match(
    css,
    /\.split-resizer\.device-panel-resizer\s*\{[\s\S]*?width:\s*100%;[\s\S]*?cursor:\s*row-resize;/
  );
  assert.match(
    css,
    /\.split-resizer\.device-panel-resizer::before\s*\{[\s\S]*?width:\s*58px;[\s\S]*?height:\s*2px;/
  );
  assert.doesNotMatch(css, /device-panel-toggle-arrow::after/);
  assert.match(
    css,
    /data-state="compact"[\s\S]*?\.detect-chip-btn\s*\{[\s\S]*?height:\s*36px;[\s\S]*?padding:\s*0;/
  );
  assert.match(
    css,
    /data-state="compact"[\s\S]*?\.detect-chip-label\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?inset:\s*0;[\s\S]*?display:\s*flex;[\s\S]*?align-items:\s*center;[\s\S]*?justify-content:\s*center;/
  );
  assert.match(
    css,
    /data-state="compact"[\s\S]*?\.avr-status-value\s*\{[\s\S]*?height:\s*36px;[\s\S]*?min-height:\s*36px;/
  );
  assert.match(
    css,
    /\.feature-panel:has\(\s*> \.canvas-section > \.avr-device-section\[data-state="collapsed"\]\s*\)\s*\{\s*padding-top:\s*0;/
  );
  assert.match(
    source,
    /STORAGE_DEVICE_PANEL_STATE\s*=\s*\n\s*"ud_avr_programming_device_panel_state_v2"/
  );
  assert.match(source, /const states = \["collapsed", "compact", "expanded"\]/);
  assert.match(source, /DEVICE_PANEL_EXPANDED_HEIGHT\s*=\s*112/);
  assert.match(source, /DEVICE_PANEL_COMPACT_HEIGHT\s*=\s*54/);
  assert.match(source, /DEVICE_PANEL_COLLAPSED_HEIGHT\s*=\s*0/);
  assert.match(source, /DEVICE_PANEL_DRAG_THRESHOLD\s*=\s*18/);
  assert.match(source, /function getAdjacentDevicePanelState\(state, direction\)/);
  assert.match(source, /anchorY:\s*event\.clientY/);
  assert.doesNotMatch(source, /getNearestDevicePanelState|getLiveDevicePanelState/);
  const pointerMoveStart = source.indexOf(
    'handle.addEventListener("pointermove"'
  );
  const pointerMoveEnd = source.indexOf(
    'handle.addEventListener("pointerup"',
    pointerMoveStart
  );
  assert.ok(pointerMoveStart >= 0 && pointerMoveEnd > pointerMoveStart);
  const pointerMoveSource = source.slice(pointerMoveStart, pointerMoveEnd);
  assert.match(
    pointerMoveSource,
    /const delta = event\.clientY - devicePanelResizeState\.anchorY/
  );
  assert.match(
    pointerMoveSource,
    /Math\.floor\(\s*Math\.abs\(delta\) \/ DEVICE_PANEL_DRAG_THRESHOLD\s*\)/
  );
  assert.match(pointerMoveSource, /const direction = delta < 0 \? -1 : 1/);
  assert.match(
    pointerMoveSource,
    /while \(appliedSteps < requestedSteps\)[\s\S]*?getAdjacentDevicePanelState\(\s*nextState,\s*direction\s*\)/
  );
  assert.match(
    pointerMoveSource,
    /devicePanelResizeState\.anchorY \+=[\s\S]*?DEVICE_PANEL_DRAG_THRESHOLD \* appliedSteps/
  );
  assert.match(
    pointerMoveSource,
    /setDevicePanelState\(nextState, \{ persist: false, animate: false \}\)/
  );
  assert.match(
    source,
    /event\.key === "ArrowUp"[\s\S]*?Math\.max\(0, index - 1\)[\s\S]*?event\.key === "ArrowDown"[\s\S]*?Math\.min\(states\.length - 1, index \+ 1\)/
  );
  assert.match(
    source,
    /handle\.addEventListener\("pointercancel", finishResize\)/
  );
  assert.match(source, /lostpointercapture/);
  assert.match(source, /if \(collapsed\) viewport\.setAttribute\("inert", ""\)/);
  assert.match(source, /restoreDevicePanelState\(\)/);
});

test("publishes legal pages and links them to Google sign-in", () => {
  const index = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
  const avr = fs.readFileSync(path.join(__dirname, "../public/avr.html"), "utf8");
  const privacy = fs.readFileSync(
    path.join(__dirname, "../public/privacy.html"),
    "utf8"
  );
  const terms = fs.readFileSync(
    path.join(__dirname, "../public/terms.html"),
    "utf8"
  );
  const sw = fs.readFileSync(path.join(__dirname, "../public/sw.js"), "utf8");

  assert.match(index, /href="\/privacy"/);
  assert.match(index, /href="\/terms"/);
  assert.match(avr, /id="projectAiPrivacyNote"[\s\S]*?href="\/privacy"/);
  assert.match(
    avr,
    /id="projectAiSignInBtn"[\s\S]*?icons\/sign-in-with-google-light\.svg/
  );
  assert.match(avr, /shared free AI-credit[\s\S]*?Google identity data is not sent/);
  assert.match(privacy, /Privacy Policy[\s\S]*?Google sign-in[\s\S]*?OpenAI/);
  assert.match(privacy, /stable pseudonymous browser safety identifier/);
  assert.match(privacy, /uartdebug@gmail\.com/);
  assert.match(terms, /Terms of Service[\s\S]*?AI Credits[\s\S]*?hardware/);
  for (const route of ["/privacy", "/privacy.html", "/terms", "/terms.html"]) {
    assert.ok(sw.includes(`"${route}"`), `service worker is missing ${route}`);
  }
  assert.match(sw, /icons\/sign-in-with-google-light\.svg/);
  assert.match(index, /optional AI assistant[\s\S]*?Google sign-in is required only/);
});

test("deploy verifies legal page content rather than accepting an SPA fallback", () => {
  const workflow = fs.readFileSync(
    path.join(__dirname, "../.github/workflows/deploy.yml"),
    "utf8"
  );
  const legalCheck = fs.readFileSync(
    path.join(__dirname, "../backend/deploy/check-legal-pages.sh"),
    "utf8"
  );

  assert.match(workflow, /check-legal-pages\.sh/);
  assert.match(legalCheck, /for legal_route in privacy terms/);
  assert.match(
    legalCheck,
    /rel=\\"canonical\\" href=\\"https:\/\/uartdebug\.com\/\$\{legal_route\}\\"/
  );
  assert.match(legalCheck, /<title>\$\{expected_title\}/);
  assert.match(workflow, /smoke-ai-service\.sh/);

  const remoteScript = workflow.match(
    /          script: \|\r?\n([\s\S]*?)\r?\n      - name: Cleanup temp on server/
  );
  assert.ok(remoteScript, "remote deploy script block is missing");
  const evaluatedInput = remoteScript[1]
    .split(/\r?\n/)
    .map((line) => line.replace(/^ {12}/, ""))
    .join("\n");
  assert.ok(
    evaluatedInput.length < 21000,
    `remote deploy action input exceeds GitHub's 21000-character expression limit: ${evaluatedInput.length}`
  );
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
