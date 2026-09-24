"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { parseHTML } = require("../frontend/markdown-runtime/node_modules/linkedom");

function createModalHarness() {
  const { document } = parseHTML('<html><body><button id="opener">Open</button><div id="parent" hidden><div class="site-dialog-card"><button id="parentFirst">First</button><button id="parentLast">Last</button></div></div><div id="child" hidden><div class="site-dialog-card"><button id="childFirst">Confirm</button><button id="childLast">Cancel</button><button disabled>Disabled</button><button hidden>Hidden</button><button tabindex="-1">Untabbable</button></div></div></body></html>');
  let activeElement = document.body;
  const frames = [];
  Object.defineProperty(document, "activeElement", { get: () => activeElement });
  for (const element of document.querySelectorAll("*")) {
    element.focus = () => { activeElement = element; };
    element.getClientRects = () => element.closest("[hidden]") ? [] : [{}];
    Object.defineProperty(element, "tabIndex", {
      configurable: true, writable: true,
      value: element.hasAttribute("tabindex") ? Number(element.getAttribute("tabindex")) : element.tagName === "BUTTON" ? 0 : -1,
    });
  }
  const source = fs.readFileSync(path.join(__dirname, "../public/ui-controls.js"), "utf8");
  const window = { requestAnimationFrame: (callback) => frames.push(callback) };
  vm.runInNewContext(source, { window, document });
  const hooks = {
    openWorkspaceModal: window.UartDebugControls.openModal,
    closeWorkspaceModal: window.UartDebugControls.closeModal,
    trapWorkspaceModalFocus: window.UartDebugControls.trapModalFocus,
    dismissTopWorkspaceModal: window.UartDebugControls.dismissTopModal,
    getTopWorkspaceModal: window.UartDebugControls.getTopModal,
  };
  const get = (id) => document.getElementById(id);
  const open = (id, first) => hooks.openWorkspaceModal(get(id), {
    focusTarget: get(first), onClose: () => hooks.closeWorkspaceModal(get(id)),
  });
  const flush = () => { while (frames.length) frames.shift()(); };
  const tab = (shiftKey = false) => {
    const event = { key: "Tab", shiftKey, prevented: false, preventDefault() { this.prevented = true; } };
    const trapped = hooks.trapWorkspaceModalFocus(event);
    return { trapped, prevented: event.prevented };
  };
  return { document, hooks, get, open, flush, tab };
}

test("modal Tab wraps at both ends and excludes disabled, hidden and negative-tabindex controls", () => {
  const { get, open, flush, tab, document } = createModalHarness();
  open("child", "childFirst");
  flush();
  assert.equal(document.activeElement.id, "childFirst");
  assert.deepEqual(tab(true), { trapped: true, prevented: true });
  assert.equal(document.activeElement.id, "childLast");
  assert.deepEqual(tab(), { trapped: true, prevented: true });
  assert.equal(document.activeElement.id, "childFirst");
  assert.deepEqual(tab(), { trapped: false, prevented: false });
  get("opener").focus();
  assert.equal(tab().trapped, true);
  assert.equal(document.activeElement.id, "childFirst");
});

test("nested modal dismiss restores its parent trigger and leaves the parent open", () => {
  const { get, open, flush, hooks, document } = createModalHarness();
  get("opener").focus();
  get("child").style.zIndex = "1300";
  open("parent", "parentFirst");
  flush();
  get("parentLast").focus();
  open("child", "childFirst");
  flush();
  assert.ok(Number(get("child").style.zIndex) > Number(get("parent").style.zIndex));
  assert.equal(hooks.dismissTopWorkspaceModal(), true);
  assert.equal(get("child").hidden, true);
  assert.equal(get("parent").hidden, false);
  assert.equal(get("child").style.zIndex, "1300");
  assert.equal(document.activeElement.id, "parentLast");
  assert.equal(hooks.dismissTopWorkspaceModal(), true);
  assert.equal(document.activeElement.id, "opener");
  assert.equal(hooks.dismissTopWorkspaceModal(), false);
});

test("pending modal autofocus never steals focus from a newer or closed dialog", () => {
  const { get, open, flush, hooks, document } = createModalHarness();
  get("opener").focus();
  open("parent", "parentFirst");
  open("child", "childFirst");
  flush();
  assert.equal(document.activeElement.id, "childFirst");
  hooks.closeWorkspaceModal(get("child"));
  assert.equal(document.activeElement.id, "parentFirst");
  hooks.closeWorkspaceModal(get("parent"));
  open("parent", "parentFirst");
  hooks.closeWorkspaceModal(get("parent"));
  flush();
  assert.equal(document.activeElement.id, "opener");
});

test("closing a covered dialog cannot move focus out of the top modal", () => {
  const { get, open, flush, hooks, document } = createModalHarness();
  get("opener").focus();
  open("parent", "parentFirst");
  flush();
  open("child", "childFirst");
  flush();
  hooks.closeWorkspaceModal(get("parent"));
  assert.equal(document.activeElement.id, "childFirst");
  assert.equal(hooks.getTopWorkspaceModal().modal.id, "child");
  hooks.closeWorkspaceModal(get("child"));
  assert.equal(document.activeElement.id, "opener");
});
