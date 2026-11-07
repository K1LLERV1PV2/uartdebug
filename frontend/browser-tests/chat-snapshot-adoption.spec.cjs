"use strict";

const { test, expect } = require("playwright/test");

test.beforeEach(async ({ page }) => {
  await page.goto("/avr", { waitUntil: "load" });
  await expect(page).toHaveTitle("AVR Programming - Uart Debug");
  await page.evaluate(() => {
    // Exercise the actual shared controller in an isolated document, so its
    // owner model can be replaced independently of the app's first controller.
    window.createSnapshotFixture = () => {
      const frame = document.createElement("iframe"); document.body.append(frame);
      const doc = frame.contentDocument;
      doc.body.append(doc.importNode(document.querySelector(".project-chat-panel"), true));
      const root = doc.querySelector(".project-chat-panel");
      for (const menu of root.querySelectorAll("[popover]")) menu.remove();
      const collection = (id, answer) => window.UartDebugProjectChat.normalize({ schemaVersion: 6, activeThreadId: id, threads: [{
        id, title: answer, draft: "", messages: [
          { id: "q", parentId: null, role: "user", content: "Question", createdAt: 100, status: "complete" },
          { id: "a", parentId: "q", role: "assistant", content: answer, createdAt: 101, status: "complete" },
        ], activeLeafId: "a",
      }] });
      const models = { first: collection("old-chat", "Original answer"), second: collection("other-chat", "Other project answer") };
      const writes = [];
      let project = "first", request, complete;
      const control = window.UartDebugProjectChat.create({ root,
        getContext: () => ({ key: project, instanceId: project, accountEpoch: 1, threadId: models[project].activeThreadId, conversation: models[project] }),
        save: (scope, value) => { writes.push({ scope, value }); models[scope.instanceId] = value; return true; },
        request: options => { request = options; return new Promise(resolve => { complete = resolve; }); },
      });
      return { control, models, writes, collection, root,
        get request() { return request; }, finish: value => complete(value),
        selectProject: value => { project = value; },
        type: text => { const input = root.querySelector("#projectChatInput"); input.value = text; input.dispatchEvent(new frame.contentWindow.Event("input", { bubbles: true })); },
        close: () => { control.destroy(); frame.remove(); },
      };
    };
  });
});

for (const sameThread of [false, true]) test(`authoritative adoption cancels stale writes and late responses with ${sameThread ? "unchanged" : "changed"} chat identity`, async ({ page }) => {
  const result = await page.evaluate(async sameThread => {
    const fixture = window.createSnapshotFixture();
    const pending = fixture.control.submit("An outgoing request");
    fixture.request.onMessageDelta("An outgoing partial answer");
    fixture.type("A debounced outgoing draft");
    const incoming = fixture.collection(sameThread ? "old-chat" : "cloud-chat", "Authoritative cloud answer");
    incoming.threads[0].draft = "Authoritative cloud draft";
    fixture.models.first = incoming;
    const writesBefore = fixture.writes.length;
    fixture.control.refresh({ force: true });
    const aborted = fixture.request.signal.aborted;
    // A provider that finishes despite abort cannot replace the adopted state.
    fixture.request.onProgress({ id: "generation", status: "completed", label: "Late progress" });
    fixture.request.onCommentary({ id: "late-comment", text: "Late commentary" });
    fixture.request.onMessageDelta("Late fragment");
    fixture.request.onMessageReset();
    fixture.finish({ message: "Late terminal answer" });
    await pending;
    await new Promise(resolve => setTimeout(resolve, 450));
    const report = { aborted, busy: fixture.control.busy, writesAfterAdoption: fixture.writes.length - writesBefore,
      model: fixture.models.first, controller: fixture.control.getChats(), incoming,
      rendered: fixture.root.querySelector("#projectChatThread").textContent };
    fixture.close();
    return report;
  }, sameThread);
  expect(result.aborted).toBe(true);
  expect(result.busy).toBe(false);
  expect(result.writesAfterAdoption).toBe(0);
  expect(result.model).toEqual(result.incoming);
  expect(result.controller).toEqual(result.incoming);
  expect(result.rendered).toContain("Authoritative cloud answer");
  expect(result.rendered).not.toMatch(/Outgoing|outgoing|Late/);
});

test("authoritative adoption clears an idle draft debounce without writing to its owner", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const fixture = window.createSnapshotFixture();
    fixture.type("A pending local draft already captured by the owner");
    const incoming = fixture.collection("cloud-chat", "Authoritative answer");
    fixture.models.first = incoming;
    fixture.control.refresh({ force: true });
    await new Promise(resolve => setTimeout(resolve, 300));
    const report = { writes: fixture.writes.length, model: fixture.models.first, controller: fixture.control.getChats(), incoming };
    fixture.close();
    return report;
  });
  expect(result.writes).toBe(0);
  expect(result.model).toEqual(result.incoming);
  expect(result.controller).toEqual(result.incoming);
});

test("an ordinary project switch still flushes a pending local draft", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const fixture = window.createSnapshotFixture();
    fixture.type("Keep this outgoing draft");
    fixture.selectProject("second");
    fixture.control.refresh();
    await new Promise(resolve => setTimeout(resolve, 200));
    const report = { savedDraft: fixture.models.first.threads[0].draft,
      current: fixture.control.getChats(), expected: fixture.models.second };
    fixture.close();
    return report;
  });
  expect(result.savedDraft).toBe("Keep this outgoing draft");
  expect(result.current).toEqual(result.expected);
});
