(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.UartDebugProjectChat = api;
})(typeof globalThis === "object" ? globalThis : this, function () {
  "use strict";

  const CONVERSATION_SCHEMA_VERSION = 5;
  const LIMITS = Object.freeze({
    messageBytes: 32 * 1024,
    draftBytes: 16 * 1024,
    messages: 100,
    storedBytes: 256 * 1024,
    threads: 32,
    titleBytes: 256,
    collectionBytes: 2 * 1024 * 1024,
    historyMessages: 40,
    historyBytes: 128 * 1024,
  });
  const encoder = new TextEncoder();
  const bytes = value => encoder.encode(value).length;
  const cleanText = value => typeof value === "string" ? value.replace(/\r\n?/g, "\n").replace(/\0/g, "") : "";
  const withoutTrailingSurrogate = value => /[\uD800-\uDBFF]$/.test(value) ? value.slice(0, -1) : value;
  const validId = value => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);

  function bounded(value, limit) {
    const text = cleanText(value);
    if (bytes(text) <= limit) return text;
    let low = 0, high = text.length;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (bytes(text.slice(0, middle)) <= limit) low = middle;
      else high = middle - 1;
    }
    return withoutTrailingSurrogate(text.slice(0, low));
  }

  function shortTitle(value) {
    const text = cleanText(value).trim().replace(/\s+/g, " ");
    const letters = Array.from(text);
    if (letters.length <= 72) return text;
    let prefix = letters.slice(0, 71).join("");
    const space = prefix.lastIndexOf(" ");
    if (space >= 40) prefix = prefix.slice(0, space);
    return `${prefix.trimEnd()}…`;
  }

  function storedMessages(messages) {
    return messages.map(({ requestSource, parentId, status, ...message }) => status === "complete" ? message : { ...message, status });
  }

  // Keep the established content budgets independent of bounded UI metadata.
  // Migrating a valid conversation must not evict a message to fit new flags.
  function threadContentBytes(thread) {
    return bytes(JSON.stringify({ schemaVersion: 1, messages: storedMessages(thread.messages), draft: thread.draft }));
  }

  function collectionContentBytes(collection) {
    return bytes(JSON.stringify({ schemaVersion: 2, activeThreadId: collection.activeThreadId,
      threads: collection.threads.map(({ id, title, messages, draft }) => ({ id, title, messages: storedMessages(messages), draft })) }));
  }

  /**
   * Return the bounded, JSON-safe project conversation used by local and account
   * storage. Only boot/account restore should request pending-response recovery.
   * @param {unknown} value
   * @param {{recoverPending?: boolean}} options
   */
  function normalizeThread(value, { recoverPending = false, tree = Object.hasOwn(value || {}, "activeLeafId") } = {}) {
    const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const ids = new Set();
    const messages = [];
    if (tree && (!Array.isArray(input.messages) || input.messages.length > LIMITS.messages)) {
      throw new RangeError("A chat can contain at most 100 messages across all branches.");
    }
    const recent = Array.isArray(input.messages) ? tree ? input.messages : input.messages.slice(-LIMITS.messages) : [];
    for (const [index, item] of recent.entries()) {
      if (!item || !["user", "assistant"].includes(item.role)) {
        if (tree) throw new TypeError("The saved chat contains an invalid message.");
        continue;
      }
      if (tree && (!validId(item.id) || ids.has(item.id) ||
          !(item.parentId === null || validId(item.parentId) && ids.has(item.parentId)) ||
          typeof item.content !== "string" || item.content.includes("\0") || bytes(item.content) > LIMITS.messageBytes ||
          !Number.isSafeInteger(item.createdAt) || item.createdAt < 0 ||
          !["complete", "pending", "error"].includes(item.status))) {
        throw new TypeError("The saved chat contains an invalid message tree.");
      }
      let status = ["complete", "pending", "error"].includes(item.status) ? item.status : "complete";
      if (item.role === "user") status = "complete";
      let content = bounded(item.content, LIMITS.messageBytes);
      if (recoverPending && status === "pending") {
        status = "error";
      }
      if (!tree && status === "complete" && !content.trim()) continue;
      const createdAt = Number.isSafeInteger(item.createdAt) && item.createdAt >= 0 ? item.createdAt : 0;
      let id = typeof item.id === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(item.id)
        ? item.id : `chat-${createdAt}-${index}`;
      if (ids.has(id)) {
        const base = id.slice(0, 105);
        let suffix = index;
        while (ids.has(id)) id = `${base}-${suffix++}`;
      }
      ids.add(id);
      messages.push({ id, parentId: tree ? item.parentId : messages.at(-1)?.id || null, role: item.role, content, createdAt, status,
        ...(item.role === "user" ? { requestSource: ["message", "review"].includes(item.requestSource) ? item.requestSource
          : content === "Review the project specification. Ask any necessary questions in this chat." ? "review" : "message" } : {}) });
    }
    const result = { id: input.id || "chat-1", title: bounded(input.title, LIMITS.titleBytes) || "New chat",
      messages, activeLeafId: tree ? input.activeLeafId : messages.at(-1)?.id || null, draft: bounded(input.draft, LIMITS.draftBytes),
      titleMode: input.titleMode === "manual" ? "manual" : "auto" };
    if (tree && !(messages.length ? ids.has(result.activeLeafId) : result.activeLeafId === null)) {
      throw new TypeError("The saved chat has an invalid selected branch.");
    }
    // Legacy valid histories fit their established content budgets. A tree is
    // never pruned: dropping an old node would destroy another saved branch.
    const size = () => threadContentBytes(result);
    while (!tree && result.messages.length > 1 && size() > LIMITS.storedBytes) result.messages.shift();
    if (!tree && result.messages.length && size() > LIMITS.storedBytes) {
      const message = result.messages[0], content = message.content;
      let low = 0, high = content.length;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        message.content = content.slice(0, middle);
        if (size() <= LIMITS.storedBytes) low = middle;
        else high = middle - 1;
      }
      message.content = withoutTrailingSurrogate(content.slice(0, low));
    }
    if (!tree) {
      for (let index = 0; index < result.messages.length; index++) result.messages[index].parentId = result.messages[index - 1]?.id || null;
      result.activeLeafId = result.messages.at(-1)?.id || null;
    }
    const selected = new Map(), byId = new Map(result.messages.map(message => [message.id, message]));
    if (Object.hasOwn(input, "selectedChildIds")) {
      if (!Array.isArray(input.selectedChildIds) || input.selectedChildIds.length > result.messages.length) {
        throw new TypeError("The saved chat contains invalid branch selections.");
      }
      for (const id of input.selectedChildIds) {
        const child = byId.get(id);
        if (!child || selected.has(child.parentId)) throw new TypeError("The saved chat contains invalid branch selections.");
        selected.set(child.parentId, child.id);
      }
    }
    for (const child of activeMessages(result)) selected.set(child.parentId, child.id);
    result.selectedChildIds = [...selected.values()];
    return result;
  }

  function normalize(value, options = {}) {
    const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    if (Object.hasOwn(input, "schemaVersion") && ![1, 2, 3, 4, CONVERSATION_SCHEMA_VERSION].includes(input.schemaVersion)) {
      throw new TypeError("This chat uses a newer or unsupported format. Refresh the application before saving.");
    }
    const tree = input.schemaVersion === CONVERSATION_SCHEMA_VERSION;
    if (tree && (!Array.isArray(input.threads) || !input.threads.length)) throw new TypeError("The saved chat collection is invalid.");
    const source = [2, 3, 4, CONVERSATION_SCHEMA_VERSION].includes(input.schemaVersion) && Array.isArray(input.threads) ? input.threads : [input];
    if (source.length > LIMITS.threads) throw new RangeError("A project can contain at most 32 chats.");
    const ids = new Set();
    const threads = (source.length ? source : [{}]).map((item, index) => {
      if (tree && (!validId(item?.id) || ids.has(item.id))) throw new TypeError("The saved chat collection contains invalid or duplicate chats.");
      let id = typeof item?.id === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(item.id)
        ? item.id : `chat-${index + 1}`;
      let suffix = index + 1;
      while (ids.has(id)) id = `${id.slice(0, 110)}-${suffix++}`;
      ids.add(id);
      const firstMessage = Array.isArray(item?.messages) ? item.messages.find(message => message?.role === "user" && cleanText(message.content).trim()) : null;
      const title = item?.title || shortTitle(firstMessage?.content) || (index ? `New chat ${index + 1}` : "New chat");
      return normalizeThread({ ...item, id, title }, { ...options, tree });
    });
    if (tree && !threads.some(item => item.id === input.activeThreadId)) throw new TypeError("The selected chat is missing.");
    return { schemaVersion: CONVERSATION_SCHEMA_VERSION,
      activeThreadId: threads.some(item => item.id === input.activeThreadId) ? input.activeThreadId : threads[0].id,
      threads };
  }

  const activeThread = collection => collection.threads.find(item => item.id === collection.activeThreadId) || collection.threads[0];
  function activeMessages(thread, tip = thread.activeLeafId) {
    const byId = new Map(thread.messages.map(message => [message.id, message])), path = [];
    for (let message = byId.get(tip); message; message = byId.get(message.parentId)) path.push(message);
    return path.reverse();
  }

  function continuationTip(thread, id) {
    let tip = id;
    const selected = new Set(thread.selectedChildIds || []);
    // Remember nested choices even while another outer branch is visible.
    // Only an unvisited fork defaults to its most recent saved continuation.
    for (;;) {
      const child = thread.messages.find(message => message.parentId === tip && selected.has(message.id))
        || thread.messages.findLast(message => message.parentId === tip);
      if (!child) return tip;
      tip = child.id;
    }
  }
  const projectStamp = scope => JSON.stringify([scope?.key ?? "draft", scope?.instanceId ?? null, scope?.accountEpoch ?? 0]);
  const scopeStamp = scope => JSON.stringify([scope?.key ?? "draft", scope?.instanceId ?? null, scope?.accountEpoch ?? 0, scope?.threadId ?? "chat-1"]);
  const scopeOf = context => ({
    key: context?.key ?? "draft",
    instanceId: context?.instanceId ?? null,
    accountEpoch: context?.accountEpoch ?? 0,
    title: cleanText(context?.title),
    threadId: context?.threadId || normalize(context?.conversation).activeThreadId,
  });

  function requestHistory(messages) {
    const history = messages.filter(item => item.status === "complete" && item.content.trim())
      .map(({ role, content }) => ({ role, content })).slice(-LIMITS.historyMessages);
    while (history.length && bytes(JSON.stringify(history)) > LIMITS.historyBytes) history.shift();
    return history;
  }

  function progressText(value) {
    if (typeof value === "string") return bounded(value, 320) || "Working…";
    if (!value || typeof value !== "object") return "Working…";
    const stages = Array.isArray(value.stages) ? value.stages : [];
    const stage = [...stages].reverse().find(item =>
      item && ["active", "running", "pending", "in_progress"].includes(item.status)) || stages.at(-1);
    return bounded(stage?.label || stage?.title || stage?.name || value.message || value.label || value.stage, 320) || "Working…";
  }

  /**
   * Mount the existing project-chat markup. Persistence and project mutations
   * remain owned by the workspace; this controller owns conversation interaction.
   *
   * getContext(): {key, instanceId, accountEpoch, title, conversation}
   * save(scope, conversation): boolean (false rejects a stale scope)
   * request({message, history, signal, onProgress, scope, requestSource}): Promise<{message, scope?}>
   * notify({title, message, tone, details?}), onBusy(boolean), openFiles()
   */
  function create(options) {
    const root = options?.root;
    if (!root?.querySelector || !["getContext", "save", "request"].every(name => typeof options[name] === "function")) {
      throw new TypeError("A chat root, getContext, save and request callbacks are required.");
    }
    const document = root.ownerDocument;
    const window = document.defaultView || globalThis;
    const find = id => root.querySelector(`#${id}`);
    const thread = find("projectChatThread"), input = find("projectChatInput"), form = find("projectChatForm");
    const send = find("projectChatSendBtn"), newChat = find("projectChatNewBtn");
    const projectName = find("projectChatProjectName"), contextButton = find("projectChatContextBtn"), jump = find("projectChatJumpBtn");
    const historyButton = find("projectChatHistoryBtn"), actionsButton = find("projectChatActionsBtn"), title = find("projectChatTitle");
    const historyView = find("projectChatHistory"), historyList = find("projectChatHistoryList");
    if (!thread || !input || !form || !send || !historyView || !historyList) throw new TypeError("The project chat markup is incomplete.");
    const chatMenu = document.createElement("div");
    chatMenu.className = "ui-context-menu ui-menu-list ui-panel ui-scroll-region";
    chatMenu.id = "projectChatMenu";
    chatMenu.setAttribute("role", "menu");
    chatMenu.setAttribute("aria-label", "Chat actions");
    chatMenu.setAttribute("popover", "auto");
    root.appendChild(chatMenu);
    let menuTarget = null, menuScope = null, menuTrigger = null, menuScrollOffsets = null;
    const rows = new Map(), listeners = [];
    let scope = null, collection = normalize(null), conversation = activeThread(collection), active = null;
    let historyOpen = false, historySignature = "", renamingId = null, renameValue = "";
    let externalBusy = false, composing = false, followingLatest = true, destroyed = false;
    let saveTimer = null, layoutFrame = null, sequence = 0;
    const messageTools = window.UartDebugChatMessageTools?.create({
      root: thread, getMessage: id => conversation.messages.find(item => item.id === id), getScope: () => scopeStamp(scope),
      notify: options.notify, onEdit: editAndResend, onBranch: branchFromMessage,
      onRetry: retryResponse, onVariant: selectVariant, onResume: resumeContinuation,
    });

    function notice(tone, message, details) {
      const output = details && typeof details === "object"
        ? { diagnostics: details.stack || String(details) } : details ? { details } : {};
      options.notify?.({ title: "Chat", tone, message, ...output });
    }

    function setConversation(value) {
      conversation = normalizeThread(value);
      const index = collection.threads.findIndex(item => item.id === conversation.id);
      if (index >= 0) collection.threads[index] = conversation;
    }

    function persist(target = scope, value = collection, fromScope = null) {
      if (!target) return false;
      try {
        if (value.threads.some(item => threadContentBytes(item) > LIMITS.storedBytes)) {
          throw new RangeError("This chat reached its 256 KiB storage limit across all branches. Copy any unsaved answer and continue in another chat.");
        }
        if (collectionContentBytes(value) > LIMITS.collectionBytes) {
          throw new RangeError("This project's chats reached the 2 MiB storage limit. Open Chats and delete an older chat from its actions menu, then save again.");
        }
        return options.save({ ...target }, normalize(value), fromScope ? { ...fromScope } : null) !== false;
      }
      catch (error) {
        if (error instanceof RangeError) notice("warning", error.message);
        else notice("error", "The conversation could not be saved.", error);
        return false;
      }
    }

    function flush() {
      if (saveTimer !== null) window.clearTimeout(saveTimer);
      saveTimer = null;
      return !destroyed && persist();
    }

    function atBottom() { return thread.scrollHeight - thread.clientHeight - thread.scrollTop < 32; }
    function updateJump() { if (jump) jump.hidden = historyOpen || followingLatest || !conversation.messages.length; }

    function autosize() {
      if (!input.getClientRects().length) return;
      const style = window.getComputedStyle?.(input);
      const minimum = Number.parseFloat(style?.minHeight) || 46;
      const maximum = Number.parseFloat(style?.maxHeight) || 160;
      input.style.height = "0px";
      input.style.height = `${Math.max(minimum, Math.min(maximum, input.scrollHeight))}px`;
      input.style.overflowY = "auto";
    }

    const frame = callback => typeof window.requestAnimationFrame === "function"
      ? window.requestAnimationFrame(callback) : window.setTimeout(callback, 16);
    const cancelFrame = id => typeof window.cancelAnimationFrame === "function"
      ? window.cancelAnimationFrame(id) : window.clearTimeout(id);

    function scheduleLayout() {
      if (destroyed || layoutFrame !== null) return;
      layoutFrame = frame(() => {
        layoutFrame = null;
        if (destroyed) return;
        if (root.closest(".canvas-split-container")?.classList.contains("is-workspace-transitioning")) {
          scheduleLayout();
          return;
        }
        if (!historyOpen && followingLatest) thread.scrollTop = thread.scrollHeight;
        updateJump();
      });
    }

    function renderControls() {
      send.disabled = !active && (externalBusy || !input.value.trim());
      send.setAttribute("aria-label", active ? "Stop response" : "Send message");
      send.title = active ? "Stop response" : "Send message";
      const sendIcon = send.querySelector(".chat-send-icon"), stopIcon = send.querySelector(".chat-stop-icon");
      if (sendIcon) sendIcon.hidden = !!active;
      if (stopIcon) stopIcon.hidden = !active;
      if (newChat) newChat.disabled = externalBusy && !active;
      if (title) title.textContent = historyOpen ? "Project chats" : conversation.title;
      if (actionsButton) actionsButton.hidden = historyOpen;
      if (historyButton) {
        historyButton.setAttribute("aria-expanded", String(historyOpen));
        historyButton.setAttribute("aria-label", historyOpen ? "Back to conversation" : "Chat history");
        historyButton.querySelector("span").textContent = historyOpen ? "Back" : "Chats";
        historyButton.querySelector("path").setAttribute("d", historyOpen ? "m15 5-7 7 7 7M8 12h12" : "M4 6h16M4 12h16M4 18h11");
      }
      root.dataset.chatView = historyOpen ? "history" : "conversation";
      historyView.hidden = !historyOpen;
      thread.hidden = historyOpen;
      form.hidden = historyOpen;
      if (projectName) projectName.textContent = scope?.title || "New project";
      if (contextButton) contextButton.title = scope?.title ? `Project: ${scope.title}` : "Choose project";
      thread.setAttribute("aria-busy", String(!!active));
      updateJump();
      if (historyOpen) renderHistory();
    }

    function openHistory(open = true) {
      closeChatMenu();
      historyOpen = open;
      renamingId = null;
      historySignature = "";
      renderControls();
      if (open) historyList.querySelector(`[data-chat-open="${collection.activeThreadId}"]`)?.focus({ preventScroll: true });
      else { autosize(); input.focus({ preventScroll: true }); scheduleLayout(); }
    }

    function renderHistory() {
      if (renamingId && historyList.querySelector("[data-chat-rename-input]")) return;
      const items = collection.threads.map((item, index) => ({ item, index,
        updated: Math.max(0, ...[Number(/^chat-(\d{11,16})-/.exec(item.id)?.[1]) || 0,
          ...item.messages.map(message => message.createdAt)].filter(value => Number.isSafeInteger(value)
            && Number.isFinite(new Date(value).valueOf()))) }))
        .sort((a, b) => b.updated - a.updated || b.index - a.index);
      const signature = JSON.stringify([collection.activeThreadId, renamingId, items]);
      if (signature === historySignature) return;
      historySignature = signature;
      const previousScroll = historyList.scrollTop;
      const focused = historyList.contains(document.activeElement) ? document.activeElement : null;
      const focusChat = focused?.dataset.chatOpen || focused?.dataset.chatMenu;
      const focusKind = focused?.dataset.chatMenu ? "chat-menu" : "chat-open";
      historyList.replaceChildren();
      for (const { item, updated } of items) {
        const row = document.createElement("div");
        row.className = "project-chat-history-row ui-list-item ui-list-item--record";
        row.classList.toggle("active", item.id === collection.activeThreadId);
        row.dataset.chatId = item.id; row.setAttribute("role", "listitem");
        if (renamingId === item.id) {
          const renameForm = document.createElement("form"); renameForm.className = "project-chat-rename";
          const field = document.createElement("input"); field.className = "ui-text-input"; field.value = renameValue;
          field.dataset.chatRenameInput = item.id; field.setAttribute("aria-label", "Chat name"); field.maxLength = 256;
          field.addEventListener("input", () => { renameValue = field.value; field.removeAttribute("aria-invalid"); });
          const controls = document.createElement("div"); controls.className = "project-chat-rename-actions";
          for (const [label, type] of [["Cancel", "button"], ["Save", "submit"]]) {
            const button = document.createElement("button"); button.type = type; button.className = "ui-action ui-action--compact";
            if (type === "button") { button.classList.add("secondary-btn"); button.addEventListener("click", () => finishRename()); }
            button.textContent = label; controls.appendChild(button);
          }
          field.addEventListener("keydown", event => { if (event.key === "Escape") { event.preventDefault(); finishRename(); } });
          renameForm.addEventListener("submit", event => {
            event.preventDefault(); const value = cleanText(renameValue).trim();
            if (!actionIsCurrent(renameForm.dataset.scope)) return;
            if (!value || bytes(value) > LIMITS.titleBytes) { field.setAttribute("aria-invalid", "true"); notice("warning", "Enter a chat name of at most 256 UTF-8 bytes."); return; }
            if (updateChat(item.id, { title: value, titleMode: "manual" })) finishRename();
          });
          renameForm.dataset.scope = scopeStamp(scope);
          renameForm.append(field, controls); row.appendChild(renameForm);
          frame(() => { field.focus({ preventScroll: true }); field.select(); });
        } else {
          const open = document.createElement("button"); open.type = "button"; open.className = "project-chat-history-open ui-record-main";
          open.dataset.chatOpen = item.id; open.setAttribute("aria-current", item.id === collection.activeThreadId ? "true" : "false");
          const name = document.createElement("span"); name.className = "project-chat-history-title ui-list-item-title"; name.textContent = item.title;
          const preview = document.createElement("span"); preview.className = "project-chat-history-preview";
          const latest = activeMessages(item).reverse().find(message => message.status !== "pending" && message.content.trim());
          const text = cleanText(latest?.content || item.draft || "No messages yet").replace(/\s+/g, " ");
          preview.textContent = text.slice(0, 130);
          open.append(name, preview);
          if (updated > 0) {
            const date = document.createElement("time"); date.dateTime = new Date(updated).toISOString();
            date.textContent = new Date(updated).toLocaleDateString([], { month: "short", day: "numeric" });
            date.className = "project-chat-history-date"; open.appendChild(date);
          }
          const menu = document.createElement("button"); menu.type = "button"; menu.className = "ui-icon-button ui-icon-button--quiet ui-menu-trigger";
          menu.dataset.chatMenu = item.id; menu.textContent = "⋯"; menu.setAttribute("aria-label", `Actions for ${item.title}`);
          menu.setAttribute("aria-haspopup", "menu"); menu.setAttribute("aria-controls", "projectChatMenu");
          row.append(open, menu);
        }
        historyList.appendChild(row);
      }
      historyList.scrollTop = previousScroll;
      if (focusChat) historyList.querySelector(`[data-${focusKind}="${focusChat}"]`)?.focus({ preventScroll: true });
    }

    function finishRename() {
      const id = renamingId; renamingId = null; historySignature = ""; renderHistory();
      historyList.querySelector(`[data-chat-menu="${id}"]`)?.focus({ preventScroll: true });
    }

    function updateChat(id, changes) {
      const candidate = normalize({ ...collection, threads: collection.threads.map(item => item.id === id ? { ...item, ...changes } : item) });
      if (!persist(scope, candidate)) return false;
      collection = candidate; conversation = activeThread(collection); historySignature = ""; renderControls();
      return true;
    }

    function makeRow(message) {
      const article = document.createElement("article");
      article.className = "project-chat-message";
      article.dataset.messageId = message.id;
      const content = document.createElement("div");
      content.className = "project-chat-message-content";
      const progress = document.createElement("div");
      progress.className = "project-chat-progress";
      progress.setAttribute("role", "status");
      const meta = document.createElement("div");
      meta.className = "project-chat-message-meta";
      const time = document.createElement("time");
      time.className = "sr-only";
      const actions = document.createElement("span");
      actions.className = "project-chat-message-actions";
      const copy = document.createElement("button");
      copy.type = "button";
      copy.className = "project-chat-copy ui-icon-button";
      copy.dataset.chatCopy = message.id;
      copy.setAttribute("aria-label", "Copy message");
      copy.title = "Copy message";
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      for (const [name, value] of Object.entries({ viewBox: "0 0 24 24", "aria-hidden": "true", fill: "none", stroke: "currentColor", "stroke-width": "1.7", "stroke-linecap": "round", "stroke-linejoin": "round" })) svg.setAttribute(name, value);
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", "M8 8h12v12H8zM16 8V4H4v12h4");
      svg.appendChild(path);
      copy.appendChild(svg);
      actions.appendChild(copy);
      meta.append(time, actions);
      article.append(content, progress, meta);
      return { article, content, progress, meta, time, actions, copy, key: null };
    }

    function renderThread(clear = false) {
      if (clear) { messageTools?.closeEditor?.(); thread.replaceChildren(); rows.clear(); }
      const visible = activeMessages(conversation);
      const valid = new Set(visible.map(message => message.id));
      for (const [id, row] of rows) if (!valid.has(id)) { row.article.remove(); rows.delete(id); }
      let anchor = thread.firstElementChild;
      for (const message of visible) {
        let row = rows.get(message.id);
        if (!row) { row = makeRow(message); rows.set(message.id, row); }
        row.article.dataset.role = message.role;
        row.article.dataset.status = message.status;
        row.article.setAttribute("aria-label", message.role === "user" ? "Your message" : "Assistant response");
        const pending = message.status === "pending";
        row.content.hidden = pending && !message.content;
        row.progress.hidden = !pending;
        row.meta.hidden = pending;
        if (pending) row.progress.textContent = active?.assistantId === message.id ? active.progress : "Working…";
        const key = `${message.role}\0${message.status}\0${message.content}`;
        if (row.key !== key) {
          row.key = key;
          row.content.replaceChildren();
          row.content.style.whiteSpace = "";
          const markdown = window.UartDebugMarkdown;
          if (message.role === "assistant" && message.status === "complete" && markdown?.renderInto) {
            try { markdown.renderInto(row.content, message.content, { allowImages: false, sourceId: `chat-${message.id}` }); }
            catch { row.content.textContent = message.content; row.content.style.whiteSpace = "pre-wrap"; }
          } else {
            row.content.textContent = message.content || (message.role === "assistant" && message.status === "error"
              ? "Response interrupted. Send another message to continue." : "");
            row.content.style.whiteSpace = "pre-wrap";
          }
          const date = new Date(message.createdAt), validDate = message.createdAt && Number.isFinite(date.valueOf());
          row.time.textContent = validDate ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
          if (validDate) row.time.dateTime = date.toISOString();
          else row.time.removeAttribute("datetime");
          row.copy.hidden = !message.content;
        }
        const siblings = conversation.messages.filter(item => item.parentId === message.parentId);
        messageTools?.decorate(row, { scope: scopeStamp(scope), isLast: message === visible.at(-1), busy: !!active || externalBusy,
          variants: siblings.map(item => item.id), variantIndex: siblings.findIndex(item => item.id === message.id),
          resume: message === visible.at(-1) && conversation.messages.some(item => item.parentId === message.id) });
        if (row.article !== anchor) thread.insertBefore(row.article, anchor);
        anchor = row.article.nextElementSibling;
      }
      renderControls();
      scheduleLayout();
    }

    function busyChanged(value) { options.onBusy?.(value); renderControls(); }

    function cancel(reason = "Response stopped.") {
      const run = active;
      if (!run) return false;
      active = null;
      run.cancelled = true;
      run.controller.abort();
      if (saveTimer !== null) window.clearTimeout(saveTimer);
      saveTimer = null;
      const pending = conversation.messages.find(message => message.id === run.assistantId);
      if (pending) { pending.status = "error"; pending.content = bounded(reason, LIMITS.messageBytes) || "Response interrupted."; }
      setConversation(conversation);
      persist(run.scope);
      busyChanged(false);
      renderThread();
      return true;
    }

    function refresh({ force = false } = {}) {
      if (destroyed) return;
      const context = options.getContext() || {};
      const nextScope = scopeOf(context);
      const changed = scopeStamp(nextScope) !== scopeStamp(scope);
      if (changed) { closeChatMenu(); historyOpen = false; renamingId = null; historySignature = ""; }
      if (scope && !changed && (!force || active)) {
        scope.title = nextScope.title;
        renderControls();
        scheduleLayout();
        return;
      }
      if (scope && changed) {
        if (active) cancel(nextScope.accountEpoch !== scope.accountEpoch
          ? "Response interrupted after changing accounts." : "Response interrupted after changing projects.");
        else flush();
      } else if (saveTimer !== null) {
        // A forced refresh adopts an authoritative account/workspace snapshot.
        window.clearTimeout(saveTimer);
        saveTimer = null;
      }
      scope = nextScope;
      collection = normalize(context.conversation);
      conversation = activeThread(collection);
      input.value = conversation.draft;
      autosize();
      followingLatest = true;
      renderThread(true);
    }

    async function submit(optionalMessage, { requestSource = "message", retryId = null, editId = null } = {}) {
      if (destroyed) return false;
      refresh();
      if (active) return false;
      if (externalBusy) { notice("info", "Wait for the current project operation to finish."); return false; }
      const visible = activeMessages(conversation);
      const retried = retryId && visible.find(item => item.id === retryId && item.role === "assistant");
      if (retryId && (!retried || !["complete", "error"].includes(retried.status) ||
          retried.status === "error" && retried !== visible.at(-1))) return false;
      const replacingFailed = retried?.status === "error";
      const edited = editId && conversation.messages.find(item => item.id === editId && item.role === "user");
      const reusedUser = retried && conversation.messages.find(item => item.id === retried.parentId && item.role === "user");
      if (editId && !edited || retryId && !reusedUser) return false;
      if (reusedUser) requestSource = reusedUser.requestSource || "message";
      const message = cleanText(reusedUser ? reusedUser.content : optionalMessage === undefined ? input.value : optionalMessage);
      if (!message.trim()) return false;
      if (bytes(message) > LIMITS.draftBytes) { notice("warning", "A message can contain at most 16 KiB of text."); return false; }
      if (!flush()) return false;
      const parentId = reusedUser ? reusedUser.parentId : edited ? edited.parentId : conversation.activeLeafId;
      const history = requestHistory(activeMessages(conversation, parentId));
      const createdAt = Date.now();
      let id;
      do { id = `chat-${createdAt}-${++sequence}`; }
      while (conversation.messages.some(item => item.id === id || item.id === `${id}-assistant`));
      const run = { scope: { ...scope }, assistantId: replacingFailed ? retried.id : `${id}-assistant`, controller: new AbortController(), progress: "Working…", cancelled: false };
      const retainedDraft = reusedUser || optionalMessage !== undefined && cleanText(input.value) !== message
        ? bounded(input.value, LIMITS.draftBytes) : "";
      const user = reusedUser || { id, parentId, role: "user", content: message, createdAt, status: "complete", requestSource };
      const assistant = { id: run.assistantId, parentId: user.id, role: "assistant", content: "", createdAt, status: "pending" };
      const messages = replacingFailed ? conversation.messages.map(item => item.id === retried.id ? assistant : item)
        : [...conversation.messages, ...(!reusedUser ? [user] : []), assistant];
      if (messages.length > LIMITS.messages) {
        notice("warning", "A chat can contain at most 100 messages across all branches. Continue in another chat; the existing branches have been kept.");
        return false;
      }
      const candidate = normalizeThread({ ...conversation,
        title: conversation.titleMode === "manual" || conversation.messages.some(item => item.role === "user")
          ? conversation.title : bounded(shortTitle(message), LIMITS.titleBytes),
        draft: retainedDraft, activeLeafId: assistant.id, messages });
      const candidateCollection = { ...collection, threads: collection.threads.map(item => item.id === candidate.id ? candidate : item) };
      if (!persist(run.scope, candidateCollection)) return false;
      setConversation(candidate);
      active = run;
      input.value = retainedDraft;
      autosize();
      followingLatest = true;
      busyChanged(true);
      renderThread();
      input.focus({ preventScroll: true });
      try {
        const result = await options.request({ message, history, signal: run.controller.signal, scope: { ...run.scope },
          requestSource: requestSource === "review" ? "review" : "message",
          onProgress: progress => {
            if (active !== run || run.cancelled) return;
            run.progress = progressText(progress);
            renderThread();
          } });
        if (active !== run || run.cancelled) return false;
        const live = scopeOf(options.getContext() || {});
        const target = result?.scope ? scopeOf(result.scope) : run.scope;
        if (!run.scope.instanceId && target.instanceId) target.threadId = run.scope.threadId;
        if (run.scope.instanceId && scopeStamp(target) !== scopeStamp(run.scope)) {
          throw new Error("A response cannot move an existing project's conversation to another project.");
        }
        if (live.accountEpoch !== run.scope.accountEpoch || target.accountEpoch !== run.scope.accountEpoch ||
            !(scopeStamp(live) === scopeStamp(run.scope) ||
              (!run.scope.instanceId && target.instanceId && projectStamp(live) === projectStamp(target)))) {
          cancel("Response interrupted after changing the chat context.");
          refresh({ force: true });
          return false;
        }
        const response = bounded(result?.message, LIMITS.messageBytes);
        if (!response.trim()) throw new Error("The assistant returned an empty response.");
        const pending = conversation.messages.find(item => item.id === run.assistantId);
        if (!pending) throw new Error("The conversation changed while the response was running.");
        pending.content = response;
        pending.status = "complete";
        setConversation(conversation);
        const moved = scopeStamp(target) !== scopeStamp(run.scope);
        if (!persist(target, collection, moved ? run.scope : null)) {
          notice("error", "Response received but could not be saved. Copy it before leaving this page.");
          renderThread();
          return false;
        }
        scope = target;
        renderThread();
        return true;
      } catch (error) {
        if (active !== run || run.cancelled) return false;
        if (scopeStamp(scopeOf(options.getContext() || {})) !== scopeStamp(run.scope)) {
          cancel("Response interrupted after changing the chat context.");
          refresh({ force: true });
          return false;
        }
        const pending = conversation.messages.find(item => item.id === run.assistantId);
        const unexpected = ["TypeError", "SyntaxError", "ReferenceError", "EvalError", "URIError"].includes(error?.name);
        const message = unexpected ? "The response could not be completed. Try again." : error.message || "The response could not be completed.";
        if (pending) { pending.status = "error"; pending.content = bounded(message, LIMITS.messageBytes); }
        setConversation(conversation);
        persist(run.scope);
        if (error.name !== "AbortError") notice("error", "The response could not be completed.", error);
        renderThread();
        return false;
      } finally {
        if (active === run) {
          active = null;
          busyChanged(false);
          renderThread();
        }
      }
    }

    function handleInput() {
      if (composing) { autosize(); return; }
      const value = bounded(input.value, LIMITS.draftBytes);
      if (value !== input.value) {
        input.value = value;
        notice("warning", "A message can contain at most 16 KiB of text.");
      }
      const previousLength = conversation.messages.length;
      setConversation({ ...conversation, draft: value });
      if (saveTimer !== null) window.clearTimeout(saveTimer);
      saveTimer = window.setTimeout(flush, 150);
      autosize();
      if (conversation.messages.length !== previousLength) renderThread();
      else renderControls();
    }

    function selectChat(id) {
      refresh();
      if (destroyed || id === collection.activeThreadId || !collection.threads.some(item => item.id === id)) return false;
      if (active) cancel("Response interrupted after changing chats.");
      if (!flush()) { renderControls(); return false; }
      const previous = collection.activeThreadId;
      collection.activeThreadId = id;
      if (!persist()) { collection.activeThreadId = previous; renderControls(); return false; }
      scope = { ...scope, threadId: id };
      conversation = activeThread(collection);
      input.value = conversation.draft;
      historyOpen = false;
      autosize();
      followingLatest = true;
      renderThread(true);
      return true;
    }

    function createChat() {
      refresh();
      if (destroyed || externalBusy && !active) return false;
      if (!conversation.messages.length && !conversation.draft && conversation.titleMode === "auto") {
        openHistory(false); return true;
      }
      if (collection.threads.length >= LIMITS.threads) {
        notice("warning", "A project can contain at most 32 chats. Open Chats and delete an older chat from its actions menu.");
        return false;
      }
      if (active) cancel("Response interrupted after creating another chat.");
      if (!flush()) return false;
      const previous = collection.activeThreadId;
      let id;
      do { id = `chat-${Date.now()}-${++sequence}`; }
      while (collection.threads.some(item => item.id === id));
      const title = `New chat ${collection.threads.length + 1}`;
      collection.threads.push(normalizeThread({ id, title }));
      collection.activeThreadId = id;
      if (!persist()) {
        collection.threads.pop(); collection.activeThreadId = previous;
        return false;
      }
      scope = { ...scope, threadId: id };
      conversation = activeThread(collection);
      input.value = "";
      historyOpen = false;
      autosize();
      followingLatest = true;
      renderThread(true);
      input.focus({ preventScroll: true });
      return true;
    }

    async function deleteChat(id) {
      if (destroyed || typeof options.confirm !== "function") return false;
      const target = collection.threads.find(item => item.id === id);
      if (!target) return false;
      const captured = scopeStamp(scope);
      const allowed = await options.confirm({ title: "Delete chat", message: `Delete “${shortTitle(target.title)}” and its messages? Project files will be kept.`,
        confirmText: "Delete chat", cancelText: "Cancel", danger: true });
      if (!allowed || destroyed || captured !== scopeStamp(scope) || captured !== scopeStamp(scopeOf(options.getContext() || {}))) return false;
      if (active && scope.threadId === id) cancel("Response interrupted after deleting this chat.");
      if (saveTimer !== null) window.clearTimeout(saveTimer);
      saveTimer = null;
      const retained = collection.threads.filter(item => item.id !== id);
      if (!retained.length) retained.push(normalizeThread({ id: `chat-${Date.now()}-${++sequence}`, title: "New chat" }));
      const candidate = { schemaVersion: CONVERSATION_SCHEMA_VERSION, threads: retained,
        activeThreadId: retained.some(item => item.id === collection.activeThreadId) ? collection.activeThreadId : retained[0].id };
      // Persist the filtered collection directly: pre-flushing the over-budget
      // collection would prevent the user from freeing its storage.
      if (!persist(scope, candidate)) return false;
      collection = candidate;
      conversation = activeThread(collection);
      scope = { ...scope, threadId: collection.activeThreadId };
      input.value = conversation.draft;
      autosize();
      followingLatest = true;
      renderThread(true);
      input.focus({ preventScroll: true });
      return true;
    }

    function closeChatMenu() {
      if (chatMenu.matches(":popover-open")) chatMenu.hidePopover();
      menuTrigger?.setAttribute("aria-expanded", "false");
      menuScrollOffsets = null;
    }

    function openChatMenu(event) {
      const target = event.target.closest?.("[data-chat-menu], [data-chat-id], #projectChatActionsBtn");
      if (!target || !root.contains(target)) return;
      event.preventDefault(); event.stopPropagation();
      closeChatMenu();
      menuTarget = target.dataset.chatMenu || target.dataset.chatId || target.closest("[data-chat-id]")?.dataset.chatId || collection.activeThreadId;
      menuScope = scopeStamp(scope); menuTrigger = target.matches("[data-chat-id]") ? target.querySelector("[data-chat-open]") || target : target;
      const item = collection.threads.find(chat => chat.id === menuTarget);
      if (!item) return;
      chatMenu.replaceChildren();
      for (const [action, label] of [["rename", "Rename"], ["export", "Download Markdown"], ["delete", "Delete chat"]]) {
        const button = document.createElement("button"); button.type = "button"; button.className = "ui-list-item";
        if (action === "delete") button.classList.add("ui-list-item--destructive");
        button.dataset.chatAction = action; button.setAttribute("role", "menuitem"); button.textContent = label;
        chatMenu.appendChild(button);
      }
      const bounds = target.getBoundingClientRect();
      menuScrollOffsets = window.UartDebugControls.captureMenuScroll(target);
      chatMenu.showPopover(); target.setAttribute("aria-expanded", "true");
      const menuBounds = chatMenu.getBoundingClientRect();
      const x = event.type === "contextmenu" && event.clientX ? event.clientX : bounds.left;
      const y = event.type === "contextmenu" && event.clientY ? event.clientY : bounds.bottom + 4;
      chatMenu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - menuBounds.width - 8))}px`;
      chatMenu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - menuBounds.height - 8))}px`;
      chatMenu.querySelector("button")?.focus({ preventScroll: true });
    }

    function exportChat(item) {
      const markdown = `# ${item.title}\n\n` + activeMessages(item).filter(message => message.content.trim())
        .map(message => `## ${message.role === "user" ? "You" : "Assistant"}\n\n${message.content}\n`).join("\n");
      const url = window.URL.createObjectURL(new window.Blob([markdown], { type: "text/markdown;charset=utf-8" }));
      const link = document.createElement("a"); link.href = url;
      link.download = `${item.title.replace(/[\\/:*?"<>|\x00-\x1f]/g, "-").slice(0, 100) || "Chat"}.md`;
      link.click(); window.setTimeout(() => window.URL.revokeObjectURL(url), 1000);
    }

    function actionIsCurrent(expectedScope) {
      return !destroyed && (!expectedScope || expectedScope === scopeStamp(scope))
        && scopeStamp(scope) === scopeStamp(scopeOf(options.getContext() || {}));
    }

    function selectTip(id, expectedScope, focusComposer = false, followLatest = true) {
      if (!actionIsCurrent(expectedScope) || !conversation.messages.some(item => item.id === id)) return false;
      if (active || externalBusy) { notice("info", "Wait for the current response before changing branches."); return false; }
      if (!flush()) return false;
      const next = normalizeThread({ ...conversation, activeLeafId: id });
      const candidate = { ...collection, threads: collection.threads.map(item => item.id === next.id ? next : item) };
      if (!persist(scope, candidate)) return false;
      setConversation(next);
      historyOpen = false; followingLatest = followLatest; renderThread(true);
      if (focusComposer) input.focus({ preventScroll: true });
      return true;
    }

    function selectVariant(id, expectedScope, direction) {
      if (!actionIsCurrent(expectedScope)) return false;
      const target = conversation.messages.find(message => message.id === id);
      if (!target) return false;
      const current = activeMessages(conversation).find(message => message.parentId === target.parentId);
      const oldGroup = rows.get(current?.id)?.variants?.group;
      const anchorOffset = oldGroup ? oldGroup.getBoundingClientRect().top - thread.getBoundingClientRect().top : null;
      if (!selectTip(continuationTip(conversation, id), expectedScope, false, false)) return false;
      const group = rows.get(id)?.variants?.group;
      if (group && anchorOffset !== null) {
        thread.scrollTop += group.getBoundingClientRect().top - thread.getBoundingClientRect().top - anchorOffset;
      }
      const preferred = ["previous", "next"].includes(direction)
        ? group?.querySelector(`[data-chat-variant-direction="${direction}"]:not(:disabled):not([hidden])`) : null;
      const control = preferred || group?.querySelector("button:not(:disabled):not([hidden])");
      (control || thread).focus({ preventScroll: true });
      return true;
    }

    function resumeContinuation(id, expectedScope) {
      return actionIsCurrent(expectedScope) && conversation.activeLeafId === id
        && selectTip(continuationTip(conversation, id), expectedScope, true);
    }

    function retryResponse(id, expectedScope) {
      if (!actionIsCurrent(expectedScope)) return false;
      return submit(undefined, { retryId: id });
    }

    function branchFromMessage(id, expectedScope) {
      if (!actionIsCurrent(expectedScope)) return false;
      return conversation.messages.some(item => item.id === id && item.status === "complete") && selectTip(id, expectedScope, true);
    }

    function editAndResend(id, content, expectedScope) {
      if (!actionIsCurrent(expectedScope) || !cleanText(content).trim()) return false;
      if (bytes(content) > LIMITS.draftBytes) { notice("warning", "A message can contain at most 16 KiB of text."); return false; }
      return submit(content, { requestSource: "message", editId: id });
    }

    async function copyMessage(event) {
      const button = event.target.closest?.("[data-chat-copy]");
      if (!button || !thread.contains(button)) return;
      const message = conversation.messages.find(item => item.id === button.dataset.chatCopy);
      if (!message?.content) return;
      try {
        if (!window.navigator?.clipboard?.writeText) throw new Error("Clipboard access is unavailable in this browser.");
        await window.navigator.clipboard.writeText(message.content);
        notice("success", "Message copied.");
      } catch (error) { notice("error", "The message could not be copied.", error); }
    }

    function listen(element, type, handler, settings) {
      if (!element) return;
      element.addEventListener(type, handler, settings);
      listeners.push(() => element.removeEventListener(type, handler, settings));
    }
    listen(form, "submit", event => {
      event.preventDefault();
      if (active) { cancel(); input.focus({ preventScroll: true }); }
      else void submit();
    });
    listen(input, "input", handleInput);
    listen(input, "compositionstart", () => { composing = true; });
    listen(input, "compositionend", () => { composing = false; handleInput(); });
    listen(input, "keydown", event => {
      if (event.key !== "Enter" || event.shiftKey || composing || event.isComposing || event.keyCode === 229) return;
      event.preventDefault();
      if (!active && !externalBusy) void submit();
    });
    listen(thread, "scroll", () => { followingLatest = atBottom(); updateJump(); });
    listen(thread, "click", event => { void copyMessage(event); });
    listen(jump, "click", () => { followingLatest = true; scheduleLayout(); thread.focus({ preventScroll: true }); });
    listen(contextButton, "click", () => options.openFiles?.());
    listen(newChat, "click", createChat);
    listen(historyButton, "click", () => openHistory(!historyOpen));
    listen(actionsButton, "click", openChatMenu);
    listen(historyList, "click", event => {
      if (event.target.closest?.("[data-chat-menu]")) { openChatMenu(event); return; }
      const button = event.target.closest?.("[data-chat-open]");
      if (!button) return;
      if (button.dataset.chatOpen === collection.activeThreadId) openHistory(false);
      else selectChat(button.dataset.chatOpen);
    });
    listen(root, "contextmenu", openChatMenu);
    listen(root, "keydown", event => {
      if (event.key === "ContextMenu" || event.key === "F10" && event.shiftKey) openChatMenu(event);
      else if (event.key === "Escape" && historyOpen && !renamingId) { event.preventDefault(); openHistory(false); }
    });
    listen(chatMenu, "click", event => {
      const action = event.target.closest?.("[data-chat-action]")?.dataset.chatAction;
      if (!action) return;
      const id = menuTarget, item = collection.threads.find(chat => chat.id === id), trigger = menuTrigger;
      closeChatMenu(); trigger?.focus({ preventScroll: true });
      if (!item || menuScope !== scopeStamp(scope) || !actionIsCurrent(menuScope)) return;
      if (action === "delete") void deleteChat(id);
      else if (action === "export") exportChat(item);
      else if (action === "rename") {
        historyOpen = true;
        renamingId = id; renameValue = item.title; historySignature = ""; renderControls();
      }
    });
    listen(chatMenu, "keydown", event => {
      const buttons = [...chatMenu.querySelectorAll("button")], index = buttons.indexOf(document.activeElement);
      if (["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
          : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next]?.focus({ preventScroll: true }); return;
      }
      if (!["Escape", "Tab"].includes(event.key)) return;
      if (event.key === "Escape") event.preventDefault();
      event.stopPropagation(); closeChatMenu();
      (menuTrigger?.isConnected ? menuTrigger : actionsButton)?.focus({ preventScroll: true });
    });
    listen(window, "resize", closeChatMenu);
    listen(document, "scroll", event => {
      if (!menuScrollOffsets || chatMenu.contains(event.target)) return;
      if (window.UartDebugControls.hasMenuScrollChanged(menuScrollOffsets, event)) closeChatMenu();
    }, true);
    const observer = typeof window.ResizeObserver === "function" ? new window.ResizeObserver(scheduleLayout) : null;
    observer?.observe(root);
    observer?.observe(thread);
    refresh();

    return Object.freeze({
      refresh, submit, cancel, flush, selectChat, createChat, retryResponse, branchFromMessage, editAndResend,
      getConversation: () => normalizeThread(conversation),
      getChats: () => normalize(collection),
      setExternalBusy(value) { externalBusy = !!value; renderControls(); },
      get busy() { return !!active; },
      destroy() {
        if (destroyed) return;
        flush();
        cancel("Response interrupted.");
        destroyed = true;
        if (layoutFrame !== null) cancelFrame(layoutFrame);
        observer?.disconnect();
        messageTools?.destroy();
        chatMenu.remove();
        for (const remove of listeners) remove();
      },
    });
  }

  return Object.freeze({ CONVERSATION_SCHEMA_VERSION, normalize, activeMessages, continuationTip, create });
});
