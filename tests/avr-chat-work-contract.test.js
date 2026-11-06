"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { validateStoredConversation, CONVERSATION_SCHEMA_VERSION, WORK_LIMITS } = require("../backend/avr-conversation-contract");

const work = () => ({ startedAt: 100, finishedAt: 300, events: [
  { id: "generation-1", text: "Preparing the response", at: 100, status: "complete" },
  { id: "compilation-1", text: "Compiled the project successfully", at: 200, status: "complete" },
] });
const message = (id = "answer", parentId = null) => ({ id, parentId, role: "assistant", content: "Validated response", createdAt: 100, status: "complete", work: work() });
const collection = () => ({ schemaVersion: CONVERSATION_SCHEMA_VERSION, activeThreadId: "chat", threads: [{
  id: "chat", title: "Project chat", titleMode: "manual", draft: "Keep this draft", messages: [message()], activeLeafId: "answer", selectedChildIds: ["answer"],
}] });

test("current saved activity preserves public events and duration alongside chat data", () => {
  const value = collection();
  assert.equal(CONVERSATION_SCHEMA_VERSION, 6);
  assert.equal(validateStoredConversation(value), value);
  value.threads[0].messages[0].work.truncated = true;
  assert.equal(validateStoredConversation(value), value);
  value.threads[0].messages[0].status = "pending";
  value.threads[0].messages[0].work.finishedAt = null;
  assert.equal(validateStoredConversation(value), value);
});

test("invalid, unexpected and wrongly owned activity cannot enter an account snapshot", () => {
  const changes = [
    value => { value.schemaVersion = 5; },
    value => { value.threads[0].messages[0].role = "user"; },
    value => { value.threads[0].messages[0].work.secret = "Not a public event"; },
    value => { value.threads[0].messages[0].work.startedAt = -1; },
    value => { value.threads[0].messages[0].work.finishedAt = 99; },
    value => { value.threads[0].messages[0].work.finishedAt = null; },
    value => { value.threads[0].messages[0].status = "pending"; },
    value => { value.threads[0].messages[0].work.truncated = "yes"; },
    value => { value.threads[0].messages[0].work.events[0].at = 99; },
    value => { value.threads[0].messages[0].work.events[0].at = 301; },
    value => { value.threads[0].messages[0].work.events[0].status = "guessed"; },
    value => { value.threads[0].messages[0].work.events[0].text = " "; },
    value => { value.threads[0].messages[0].work.events[0].text = "\0"; },
    value => { value.threads[0].messages[0].work.events[0].text = "я".repeat(513); },
    value => { value.threads[0].messages[0].work.events.push({ ...value.threads[0].messages[0].work.events[0] }); },
    value => { value.threads[0].messages[0].work.events[0].privateReasoning = "Not public"; },
  ];
  for (const change of changes) {
    const value = collection();
    change(value);
    assert.throws(() => validateStoredConversation(value));
  }
});

test("activity event, per-message and collection byte budgets are independent of message text", () => {
  const value = collection();
  const events = length => Array.from({ length }, (_, index) => ({ id: `step-${index}`, text: "x", at: 100, status: "info" }));
  value.threads[0].messages[0].work.events = events(WORK_LIMITS.events + 1);
  assert.throws(() => validateStoredConversation(value), /activity record/);
  value.threads[0].messages[0].work.events = events(20).map(event => ({ ...event, text: "x".repeat(1000) }));
  assert.throws(() => validateStoredConversation(value), /activity record/);

  const thread = value.threads[0];
  thread.messages = Array.from({ length: 8 }, (_, index) => ({ ...message(`answer-${index}`, index ? `answer-${index - 1}` : null), content: "x".repeat(32600) }));
  thread.activeLeafId = "answer-7";
  thread.selectedChildIds = thread.messages.map(item => item.id);
  assert.ok(Buffer.byteLength(JSON.stringify(value)) > 256 * 1024);
  assert.equal(validateStoredConversation(value), value, "bounded activity must not consume the established text budget");

  const largeWork = { startedAt: 100, finishedAt: 300, events: events(14).map(event => ({ ...event, text: "x".repeat(1000) })) };
  value.threads = Array.from({ length: 32 }, (_, index) => ({ ...thread, id: `chat-${index}`, messages: [
    { ...message("one"), work: structuredClone(largeWork) },
    { ...message("two", "one"), work: structuredClone(largeWork) },
  ], activeLeafId: "two", selectedChildIds: ["one", "two"] }));
  value.activeThreadId = "chat-0";
  assert.throws(() => validateStoredConversation(value), /activity history exceeds/);
});

test("format five remains readable without accepting new work metadata", () => {
  const value = collection();
  value.schemaVersion = 5;
  delete value.threads[0].messages[0].work;
  assert.equal(validateStoredConversation(value), value);
});
