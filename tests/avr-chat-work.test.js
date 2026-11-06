"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const chat = require("../public/avr-project-chat");
const contract = require("../backend/avr-conversation-contract");

function fixture(status = "complete") {
  return { schemaVersion: 6, activeThreadId: "chat-1", threads: [{ id: "chat-1", title: "Project", titleMode: "manual", draft: "Keep this draft",
    activeLeafId: "answer", selectedChildIds: ["question", "answer"], messages: [
      { id: "question", parentId: null, role: "user", content: "Explain the project.", createdAt: 100, status: "complete", requestSource: "message" },
      { id: "answer", parentId: "question", role: "assistant", content: "Keep this answer.", createdAt: 101, status,
        work: { startedAt: 100, finishedAt: status === "pending" ? null : 200, events: [
          { id: "generation:1", text: "Preparing the response", at: 110, status: status === "pending" ? "active" : "complete" },
        ] } },
    ] }] };
}

test("activity limits match the account contract and valid records round-trip without changing content", () => {
  assert.deepEqual(chat.WORK_LIMITS, contract.WORK_LIMITS);
  const value = fixture();
  assert.deepEqual(chat.normalize(value), value);
  contract.validateStoredConversation(value);
  const legacy = fixture(); legacy.schemaVersion = 5; delete legacy.threads[0].messages[1].work;
  const migrated = chat.normalize(legacy);
  assert.equal(migrated.schemaVersion, 6);
  assert.deepEqual(migrated.threads, legacy.threads);
});

test("activity validation rejects invalid records in the client and account contract", () => {
  const corrupt = [
    value => { value.threads[0].messages[0].work = value.threads[0].messages[1].work; },
    value => { value.threads[0].messages[1].work.finishedAt = null; },
    value => { value.threads[0].messages[1].work.events[0].text = " "; },
    value => { value.threads[0].messages[1].work.events[0].at = 99; },
    value => { value.threads[0].messages[1].work.events[0].at = 201; },
    value => { value.threads[0].messages[1].work.events[0].status = "invented"; },
    value => { value.threads[0].messages[1].work.events.push({ ...value.threads[0].messages[1].work.events[0] }); },
    value => { value.threads[0].messages[1].work.privateReasoning = "Never accepted"; },
  ];
  for (const change of corrupt) {
    const value = fixture(); change(value);
    assert.throws(() => chat.normalize(value));
    assert.throws(() => contract.validateStoredConversation(value));
  }
  const legacy = fixture(); legacy.schemaVersion = 5;
  assert.throws(() => chat.normalize(legacy));
  assert.throws(() => contract.validateStoredConversation(legacy));
});

test("recovering an interrupted response freezes its last observed duration rather than counting offline time", () => {
  const value = fixture("pending");
  const restored = chat.normalize(value, { recoverPending: true });
  const message = restored.threads[0].messages[1];
  assert.equal(message.content, "Keep this answer.");
  assert.equal(message.status, "error");
  assert.equal(message.work.finishedAt, 110);
  assert.equal(message.work.events.at(-1).status, "error");
  assert.match(message.work.events.at(-1).text, /interrupted/);
  assert.deepEqual(chat.normalize(restored, { recoverPending: true }), restored);
  contract.validateStoredConversation(restored);
});

test("bounded activity never prunes messages or consumes their established content budget", () => {
  const value = fixture();
  value.threads[0].messages[1].work.events = Array.from({ length: 64 }, (_, index) => ({
    id: `stage-${index}`, at: 110, status: "complete", text: "Public activity ".repeat(50),
  }));
  const normalized = chat.normalize(value);
  assert.equal(normalized.threads[0].messages[1].content, "Keep this answer.");
  assert.equal(normalized.threads[0].messages[1].work.truncated, true);
  assert.ok(Buffer.byteLength(JSON.stringify(normalized.threads[0].messages[1].work)) <= chat.WORK_LIMITS.storedBytes);
  contract.validateStoredConversation(normalized);
  const message = normalized.threads[0].messages[1];
  value.threads = Array.from({ length: 8 }, (_, threadIndex) => ({ ...value.threads[0], id: `chat-${threadIndex}`, messages:
    Array.from({ length: 40 }, (_, index) => ({ ...structuredClone(message), id: `message-${index}`, parentId: null,
      work: { ...structuredClone(message.work), events: Array.from({ length: 3 }, (_, stage) => ({ id: `stage-${stage}`, text: "Public progress ".repeat(50), at: 110, status: "complete" })) } })),
    activeLeafId: "message-39", selectedChildIds: ["message-39"] }));
  value.activeThreadId = "chat-0";
  assert.ok(value.threads.flatMap(thread => thread.messages).reduce((total, item) => total + Buffer.byteLength(JSON.stringify(item.work)), 0) > chat.WORK_LIMITS.collectionBytes);
  const collection = chat.normalize(value);
  assert.equal(collection.threads.reduce((total, thread) => total + thread.messages.length, 0), 320);
  const workBytes = collection.threads.flatMap(thread => thread.messages).reduce((total, item) => total + Buffer.byteLength(JSON.stringify(item.work)), 0);
  assert.ok(workBytes <= chat.WORK_LIMITS.collectionBytes);
  assert.ok(collection.threads.some(thread => thread.messages.some(item => item.work.truncated && item.work.events.length === 0)));
  contract.validateStoredConversation(collection);
});

test("collection activity retention follows work age without reordering chats or message branches", () => {
  const value = fixture();
  value.threads = Array.from({ length: 8 }, (_, threadIndex) => {
    const startedAt = threadIndex === 0 ? 100_000 : threadIndex * 100;
    return { ...value.threads[0], id: `chat-${threadIndex}`, messages: Array.from({ length: 40 }, (_, index) => ({
      id: `answer-${index}`, parentId: null, role: "assistant", content: `Preserve answer ${threadIndex}/${index}`,
      createdAt: startedAt, status: "complete", work: { startedAt, finishedAt: startedAt + 100,
        events: Array.from({ length: 3 }, (_, stage) => ({ id: `stage-${stage}`, text: "Public progress ".repeat(50), at: startedAt + 10, status: "complete" })) },
    })), activeLeafId: "answer-39", selectedChildIds: ["answer-39"] };
  });
  value.activeThreadId = "chat-0";
  const result = chat.normalize(value);
  assert.deepEqual(result.threads.map(thread => thread.id), value.threads.map(thread => thread.id));
  for (const [index, thread] of result.threads.entries()) {
    assert.deepEqual(thread.messages.map(message => [message.id, message.content]), value.threads[index].messages.map(message => [message.id, message.content]));
  }
  assert.ok(result.threads[0].messages.every(message => message.work.events.length === 3), "a fresh retry in an older chat retains its recent activity");
  assert.ok(result.threads[1].messages.some(message => message.work.events.length === 0 && message.work.truncated), "older work in a later chat is shortened first");
  contract.validateStoredConversation(result);
});
