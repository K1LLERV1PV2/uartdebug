"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { normalize, activeMessages, continuationTip } = require("../public/avr-project-chat");
const { validateStoredConversation } = require("../backend/avr-conversation-contract");

const node = (id, parentId, content = id, role = "user") => ({ id, parentId, content, role, status: "complete", createdAt: 1,
  ...(role === "user" ? { requestSource: "message" } : {}) });
const fixture = () => ({ schemaVersion: 5, activeThreadId: "same-chat", threads: [{ id: "same-chat", title: "Manual title",
  titleMode: "manual", draft: "Unsent draft", activeLeafId: "a2-edited", selectedChildIds: ["q1", "a1", "q2-edited", "a2-edited", "a2", "a1-edited"], messages: [
    node("q1", null), node("a1", "q1", "First response", "assistant"),
    node("q2", "a1"), node("a2", "q2", "Original tail", "assistant"),
    node("q2-edited", "a1"), node("a2-edited", "q2-edited", "Edited tail", "assistant"),
    node("q1-edited", null), node("a1-edited", "q1-edited", "Alternate root", "assistant"),
  ] }] });

test("message trees retain both nested alternatives and select the whole saved continuation", () => {
  const value = fixture();
  validateStoredConversation(value);
  const restored = normalize(JSON.parse(JSON.stringify(value)));
  assert.deepEqual(restored, value);
  const thread = restored.threads[0];
  assert.deepEqual(activeMessages(thread).map(item => item.id), ["q1", "a1", "q2-edited", "a2-edited"]);
  assert.equal(continuationTip(thread, "q2"), "a2");
  assert.equal(continuationTip(thread, "q1"), "a2-edited");
  assert.equal(continuationTip(thread, "q1-edited"), "a1-edited");
  thread.activeLeafId = "a1";
  validateStoredConversation(restored);
  assert.deepEqual(activeMessages(normalize(restored).threads[0]).map(item => item.id), ["q1", "a1"], "a selected prefix may stop before saved descendants");
  assert.equal(thread.messages.length, 8, "selecting a prefix never removes a saved continuation");
  let selected = normalize({ ...restored, threads: [{ ...thread, activeLeafId: "a2" }] });
  selected = normalize({ ...selected, threads: [{ ...selected.threads[0], activeLeafId: "a1-edited" }] });
  assert.equal(continuationTip(selected.threads[0], "q1"), "a2", "returning to an outer branch restores the last chosen nested alternative");
  selected = normalize(JSON.parse(JSON.stringify(selected)));
  assert.equal(continuationTip(selected.threads[0], "q1"), "a2", "nested selections survive a snapshot round-trip");
});

test("tree restore rejects corrupt references, duplicate identities, cycles and future schemas", () => {
  const changes = [
    value => { value.threads[0].messages[0].parentId = "missing"; },
    value => { value.threads[0].messages[0].parentId = "a1"; },
    value => { value.threads[0].messages[1].parentId = "a1"; },
    value => { value.threads[0].messages[1].id = "q1"; },
    value => { value.threads[0].activeLeafId = "missing"; },
    value => { delete value.threads[0].activeLeafId; },
    value => { value.activeThreadId = "missing"; },
    value => { value.threads.push(structuredClone(value.threads[0])); },
    value => { value.threads[0].selectedChildIds = ["missing"]; },
    value => { value.threads[0].selectedChildIds = ["q1", "q1-edited"]; },
    value => { value.schemaVersion = 99; },
  ];
  for (const change of changes) {
    const value = fixture(); change(value);
    assert.throws(() => normalize(value));
    assert.throws(() => validateStoredConversation(value));
  }
});

test("all alternatives count towards node and content limits without pruning the tree", () => {
  const value = fixture(), thread = value.threads[0];
  thread.messages = Array.from({ length: 100 }, (_, index) => node(`root-${index}`, null));
  thread.selectedChildIds = [];
  thread.activeLeafId = "root-99";
  validateStoredConversation(value);
  assert.equal(normalize(value).threads[0].messages.length, 100);
  thread.messages.push(node("one-too-many", null));
  assert.throws(() => normalize(value), /100 messages/);
  assert.throws(() => validateStoredConversation(value));
  thread.messages.pop();
  for (const item of thread.messages) item.content = "x".repeat(3000);
  assert.throws(() => validateStoredConversation(value), /storage limit/);
  assert.equal(normalize(value).threads[0].messages.length, 100, "unsaved over-budget content remains available for recovery, not silently trimmed");
});

test("legacy linear messages migrate into a tree without changing their content or draft", () => {
  const legacy = { schemaVersion: 4, activeThreadId: "existing", threads: [{ id: "existing", title: "Existing name", titleMode: "manual",
    draft: "Keep this draft", messages: [
      { id: "old-question", content: "Review requirements", role: "user", createdAt: 1, status: "complete", requestSource: "review" },
      { id: "old-answer", content: "Which clock?", role: "assistant", createdAt: 2, status: "pending" },
    ] }] };
  const current = normalize(legacy, { recoverPending: true });
  assert.equal(current.schemaVersion, 5);
  assert.equal(current.threads[0].id, "existing");
  assert.equal(current.threads[0].title, "Existing name");
  assert.equal(current.threads[0].draft, "Keep this draft");
  assert.deepEqual(current.threads[0].messages.map(item => [item.id, item.parentId, item.content, item.status]), [
    ["old-question", null, "Review requirements", "complete"], ["old-answer", "old-question", "Which clock?", "error"],
  ]);
  assert.equal(current.threads[0].messages[0].requestSource, "review");
  validateStoredConversation(current);
});
