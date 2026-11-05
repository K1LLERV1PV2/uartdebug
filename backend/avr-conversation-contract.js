"use strict";

const CONVERSATION_SCHEMA_VERSION = 5;
const CONVERSATION_LIMITS = Object.freeze({
  messageBytes: 32 * 1024,
  requestBytes: 16 * 1024,
  historyMessages: 40,
  historyBytes: 128 * 1024,
  storedMessages: 100,
  storedBytes: 256 * 1024,
  threads: 32,
  titleBytes: 256,
  collectionBytes: 2 * 1024 * 1024,
});

const object = value => value && typeof value === "object" && !Array.isArray(value);
const text = (value, limit) => typeof value === "string" && !value.includes("\0") && Buffer.byteLength(value) <= limit;
const keys = (value, allowed) => Object.keys(value).every(key => allowed.includes(key));
const id = value => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);

const conversationContentMessages = messages => messages.map(({ requestSource, parentId, status, ...message }) =>
  status && status !== "complete" ? { ...message, status } : message);

// Chat management metadata must not consume an older conversation's content
// budget during migration. The whole workspace still has its raw byte limit.
function conversationContent(value) {
  return { schemaVersion: 1, messages: conversationContentMessages(value.messages), draft: value.draft };
}

function collectionContent(value) {
  return { schemaVersion: 2, activeThreadId: value.activeThreadId, threads: value.threads.map(thread => ({
    id: thread.id, title: thread.title, messages: conversationContentMessages(thread.messages), draft: thread.draft,
  })) };
}

function normalizeChatInput(raw) {
  if (!object(raw) || !text(raw.message, CONVERSATION_LIMITS.requestBytes) || !raw.message.trim()) {
    throw new Error("A chat message of at most 16 KiB is required.");
  }
  const requestSource = Object.hasOwn(raw, "requestSource") ? raw.requestSource : "message";
  if (!["message", "review"].includes(requestSource)) throw new Error("The chat request source is invalid.");
  const history = raw.history ?? [];
  if (!Array.isArray(history) || history.length > CONVERSATION_LIMITS.historyMessages ||
      history.some(message => !object(message) || !keys(message, ["role", "content"]) ||
        !["user", "assistant"].includes(message.role) || !text(message.content, CONVERSATION_LIMITS.messageBytes)) ||
      Buffer.byteLength(JSON.stringify(history)) > CONVERSATION_LIMITS.historyBytes) {
    throw new Error("The chat history is invalid or exceeds its limit.");
  }
  return {
    message: raw.message.replace(/\r\n?/g, "\n"),
    requestSource,
    history: history.map(message => ({ role: message.role, content: message.content.replace(/\r\n?/g, "\n") })),
  };
}

function validateStoredMessages(value, { allowRequestSource = false, tree = false } = {}) {
  if (!Array.isArray(value.messages) || value.messages.length > CONVERSATION_LIMITS.storedMessages ||
      !text(value.draft, CONVERSATION_LIMITS.requestBytes)) {
    throw new Error("The project conversation is invalid.");
  }
  const ids = new Set();
  const messageKeys = ["id", "role", "content", "createdAt", "status", ...(allowRequestSource ? ["requestSource"] : []), ...(tree ? ["parentId"] : [])];
  for (const message of value.messages) {
    if (!object(message) || !keys(message, messageKeys) ||
        !id(message.id) || ids.has(message.id) ||
        (tree && !(message.parentId === null || id(message.parentId) && ids.has(message.parentId))) ||
        !["user", "assistant"].includes(message.role) || !text(message.content, CONVERSATION_LIMITS.messageBytes) ||
        !Number.isSafeInteger(message.createdAt) || message.createdAt < 0 ||
        (Object.hasOwn(message, "status") && !["complete", "pending", "error"].includes(message.status)) ||
        (tree && !["complete", "pending", "error"].includes(message.status)) ||
        (Object.hasOwn(message, "requestSource") &&
          (message.role !== "user" || !["message", "review"].includes(message.requestSource)))) {
      throw new Error("The project conversation contains an invalid message.");
    }
    ids.add(message.id);
  }
  if (tree && !(value.messages.length ? ids.has(value.activeLeafId) : value.activeLeafId === null)) {
    throw new Error("The project conversation has an invalid selected branch.");
  }
  if (tree && Object.hasOwn(value, "selectedChildIds")) {
    if (!Array.isArray(value.selectedChildIds) || value.selectedChildIds.length > value.messages.length) {
      throw new Error("The project conversation has invalid branch selections.");
    }
    const parents = new Set(), byId = new Map(value.messages.map(message => [message.id, message]));
    for (const selected of value.selectedChildIds) {
      const child = byId.get(selected);
      if (!child || parents.has(child.parentId)) throw new Error("The project conversation has invalid branch selections.");
      parents.add(child.parentId);
    }
  }
  if (Buffer.byteLength(JSON.stringify(allowRequestSource ? conversationContent(value) : value)) > CONVERSATION_LIMITS.storedBytes) {
    throw new Error("The project conversation exceeds its storage limit.");
  }
}

function validateStoredConversation(value) {
  // Accept the original single conversation until the client migrates it into
  // the project's collection. Both forms stay in the same atomic workspace.
  if (object(value) && value.schemaVersion === 1 && keys(value, ["schemaVersion", "messages", "draft"])) {
    validateStoredMessages(value);
    return value;
  }
  if (!object(value) || ![2, 3, 4, CONVERSATION_SCHEMA_VERSION].includes(value.schemaVersion) || !keys(value, ["schemaVersion", "activeThreadId", "threads"]) ||
      !id(value.activeThreadId) || !Array.isArray(value.threads) || !value.threads.length ||
      value.threads.length > CONVERSATION_LIMITS.threads) {
    throw new Error("The project chat collection is invalid.");
  }
  const current = value.schemaVersion >= 3;
  const tree = value.schemaVersion === CONVERSATION_SCHEMA_VERSION;
  const legacyManagement = value.schemaVersion === 3;
  const threadKeys = ["id", "title", "messages", "draft", ...(current ? ["titleMode"] : []), ...(tree ? ["activeLeafId", "selectedChildIds"] : []),
    ...(legacyManagement ? ["pinned", "archived"] : [])];
  const ids = new Set();
  for (const thread of value.threads) {
    if (!object(thread) || !keys(thread, threadKeys) || !id(thread.id) ||
        ids.has(thread.id) || !text(thread.title, CONVERSATION_LIMITS.titleBytes) ||
        (current && !["auto", "manual"].includes(thread.titleMode)) ||
        (legacyManagement && (typeof thread.pinned !== "boolean" || typeof thread.archived !== "boolean"))) {
      throw new Error("The project chat collection contains an invalid chat.");
    }
    ids.add(thread.id);
    validateStoredMessages(thread, { allowRequestSource: current, tree });
  }
  if (!ids.has(value.activeThreadId)) throw new Error("The active project chat must identify a stored chat.");
  if (Buffer.byteLength(JSON.stringify(current ? collectionContent(value) : value)) > CONVERSATION_LIMITS.collectionBytes) {
    throw new Error("The project chat collection exceeds its storage limit.");
  }
  return value;
}

module.exports = { CONVERSATION_SCHEMA_VERSION, CONVERSATION_LIMITS, normalizeChatInput, validateStoredConversation };
