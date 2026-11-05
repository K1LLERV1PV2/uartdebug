// One notification history and toast surface for the desktop workspaces.
(() => {
  "use strict";
  const STORAGE_KEY = "ud_notifications_session_v1";
  const MAX_RECORDS = 100;
  const MAX_DETAILS = 48000;
  const records = [];
  const toasts = new Map();
  const exitingToasts = new Map();
  const dismissedPending = new Set();
  let selectedId = null;
  let persistTimer = null;
  let renderFrame = null;
  let modal = null;
  let stack = null;
  let announcer = null;
  const text = (value, limit = MAX_DETAILS) => String(value ?? "").replace(/\r\n/g, "\n").slice(0, limit);
  const tones = new Set(["info", "success", "warning", "error"]);
  const time = value => new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const status = record => record.pending ? "In progress" : ({ info: "Notice", success: "Success", warning: "Warning", error: "Error" })[record.tone];

  function tail(value, limit) {
    const output = String(value ?? "").replace(/\r\n/g, "\n");
    const marker = "[Earlier details omitted]\n";
    return output.length > limit ? marker + output.slice(-limit + marker.length) : output;
  }

  function redactSourceLocations(value) {
    // Consume each non-space token once. Repeated attempts inside long dotted
    // filenames or repeated URL prefixes can otherwise make restore quadratic.
    return value.replace(/\S+/g, token => {
      let start = 0, end = token.length;
      while (start < end && "([{\"'`".includes(token[start])) start++;
      while (end > start && ")]},\"'`.;".includes(token[end - 1])) end--;
      const candidate = token.slice(start, end);
      if (/^(?:https?|file):\/\//.test(candidate)) {
        const sourcePath = candidate.split(/[?#]/, 1)[0];
        return /\.m?js(?::\d+(?::\d+)?)?$/.test(sourcePath) || /:\d+:\d+$/.test(candidate)
          ? "[source location]" : token;
      }
      return /^(?:[A-Za-z]:[\\/]|\/(?:Users|home|var|tmp|etc|opt|usr|private|mnt|app|srv)\/)/.test(candidate) ||
        /\.m?js(?::\d+){1,2}$/.test(candidate) ? "[source location]" : token;
    });
  }

  function visibleStackLines(value, redact = false) {
    const raw = String(value ?? "").replace(/\r\n?/g, "\n");
    const lines = raw.split("\n");
    const frame = /^\s*(?:\[\d{2}:\d{2}:\d{2}\]\s*)?at (?:async )?(?:.*:\d+(?::\d+)?\)?|.*\((?:<anonymous>|native)\))\s*$/;
    const hasStack = lines.some(line => frame.test(line));
    if (!hasStack && !redact) return { raw, visible: raw, hasStack };
    return { raw, hasStack, visible: lines.filter(line => !frame.test(line))
      .map(redactSourceLocations).join("\n").trim() };
  }

  function content(message, details, diagnostics = "") {
    message = text(message).trim();
    const messageBlock = visibleStackLines(message);
    const detailBlock = visibleStackLines(details);
    diagnostics = String(diagnostics ?? "").replace(/\r\n/g, "\n");
    // Remove call frames, preserving the operation log before and after them.
    // Runtime source locations belong in the console; compiler file.c:line
    // diagnostics remain part of the useful output.
    if (messageBlock.hasStack) {
      diagnostics = [diagnostics, message].filter(Boolean).join("\n");
      message = "The operation could not be completed.";
    } else if (detailBlock.hasStack) {
      message = redactSourceLocations(message);
    }
    if (detailBlock.hasStack && detailBlock.raw.trim() !== messageBlock.raw.trim()) {
      diagnostics = [diagnostics, detailBlock.raw].filter(Boolean).join("\n");
    }
    message = text(message, 500);
    if (diagnostics.trim()) console.info("[UARTDebug diagnostics]", diagnostics);
    details = tail(detailBlock.visible, MAX_DETAILS);
    return { message, details };
  }

  try {
    const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "null");
    if (saved?.schemaVersion === 1 && Array.isArray(saved.records)) {
      for (const record of saved.records.slice(-MAX_RECORDS)) {
        if (!record || typeof record.id !== "string" || !Number.isFinite(record.createdAt)) continue;
        records.push({ id: text(record.id, 100), key: text(visibleStackLines(record.key, visibleStackLines(record.details).hasStack).visible, 400),
          title: text(record.title, 120), ...content(record.pending ? "Operation interrupted by page reload." : record.message, record.details, record.diagnostics),
          source: text(record.source, 160),
          tone: record.pending ? "warning" : tones.has(record.tone) ? record.tone : "info",
          pending: false, read: !record.pending && record.read === true, createdAt: record.createdAt,
          updatedAt: Number.isFinite(record.updatedAt) ? record.updatedAt : record.createdAt });
      }
    }
  } catch { /* Notification history remains available in memory. */ }

  function persist() {
    clearTimeout(persistTimer);
    persistTimer = null;
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ schemaVersion: 1, records })); } catch {}
  }
  if (records.length) persist();

  function changed() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(persist, 250);
    if (renderFrame !== null) return;
    renderFrame = requestAnimationFrame(() => {
      renderFrame = null;
      render();
    });
  }

  function dismiss(id, { makeRoom = false } = {}) {
    const toast = toasts.get(id);
    if (!toast) return;
    if (records.find(record => record.id === id)?.pending) dismissedPending.add(id);
    clearTimeout(toast.timer);
    toasts.delete(id);
    if (makeRoom) for (const exiting of [...exitingToasts.values()]) exiting.finishDismiss();

    const element = toast.element;
    if (element.contains(document.activeElement)) {
      const next = [...toasts.values()].at(-1)?.element.querySelector(".notification-toast-close") ||
        document.querySelector("[data-notifications-open]");
      next?.focus({ preventScroll: true });
    }
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const height = element.getBoundingClientRect?.().height;
    if (stack.hidden || reducedMotion || !height) {
      element.remove();
      return;
    }
    const style = window.getComputedStyle(element);
    element.style.setProperty("--toast-dismiss-height", `${height}px`);
    element.style.setProperty("--toast-dismiss-opacity", style.opacity);
    element.style.setProperty("--toast-dismiss-transform", style.transform === "none" ? "translate(0)" : style.transform);
    element.style.setProperty("--toast-dismiss-gap", style.marginTop);
    element.inert = true;
    element.setAttribute("aria-hidden", "true");
    toast.finishDismiss = () => {
      clearTimeout(toast.exitTimer);
      element.removeEventListener("animationend", onExit);
      element.removeEventListener("animationcancel", onExit);
      element.remove();
      if (exitingToasts.get(id) === toast) exitingToasts.delete(id);
    };
    const onExit = event => {
      if (event.target === element && event.animationName === "notification-exit") toast.finishDismiss();
    };
    element.addEventListener("animationend", onExit);
    element.addEventListener("animationcancel", onExit);
    exitingToasts.set(id, toast);
    element.classList.add("is-leaving");
    toast.exitTimer = setTimeout(toast.finishDismiss, 280);
  }

  function scheduleDismiss(record, toast) {
    clearTimeout(toast.timer);
    if (toasts.get(record.id) !== toast || record.pending || toast.element.matches(":hover, :focus-within")) return;
    toast.timer = setTimeout(() => dismiss(record.id), record.tone === "error" ? 12000 : 6500);
  }

  function showToast(record) {
    if (!stack) return;
    exitingToasts.get(record.id)?.finishDismiss();
    let toast = toasts.get(record.id);
    if (!toast) {
      while (toasts.size >= 3) dismiss(toasts.keys().next().value, { makeRoom: true });
      const element = document.createElement("section");
      element.className = "notification-toast ui-panel";
      const openButton = document.createElement("button");
      openButton.type = "button";
      openButton.className = "notification-toast-open";
      openButton.setAttribute("aria-haspopup", "dialog");
      const heading = document.createElement("strong");
      const message = document.createElement("span");
      openButton.append(heading, message);
      openButton.addEventListener("click", () => open(record.id));
      const closeButton = document.createElement("button");
      closeButton.type = "button";
      closeButton.className = "notification-toast-close ui-icon-button";
      closeButton.setAttribute("aria-label", "Dismiss notification");
      closeButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>';
      closeButton.addEventListener("click", () => dismiss(record.id));
      element.append(openButton, closeButton);
      toast = { element, heading, message, timer: null };
      for (const event of ["mouseenter", "focusin"]) element.addEventListener(event, () => clearTimeout(toast.timer));
      for (const event of ["mouseleave", "focusout"]) element.addEventListener(event, () => {
        const current = records.find(item => item.id === record.id);
        if (current) scheduleDismiss(current, toast);
      });
      toasts.set(record.id, toast);
      stack.prepend(element);
    }
    toast.element.dataset.tone = record.tone;
    toast.element.classList.toggle("is-pending", record.pending);
    toast.heading.textContent = record.title;
    toast.message.textContent = record.message;
    scheduleDismiss(record, toast);
  }

  function notify(options = {}) {
    const fresh = options.key === null || (!options.id && options.pending === true && options.key === undefined);
    const hasStackDetails = visibleStackLines(options.details).hasStack;
    const requestedKey = text(visibleStackLines(options.key || `${options.title || "Notice"}\n${options.message || ""}`,
      hasStackDetails).visible, 400);
    const existing = options.id ? records.find(item => item.id === options.id) : fresh ? null : records.find(item => item.key === requestedKey);
    const output = content(options.message ?? existing?.message ?? "", options.details ?? existing?.details ?? options.message ?? "",
      options.diagnostics ?? "");
    const message = output.message;
    const title = text(options.title ?? existing?.title ?? "Notice", 120).trim();
    const key = fresh ? "" : text(visibleStackLines(options.key ?? existing?.key ?? requestedKey, hasStackDetails).visible, 400);
    const now = Date.now();
    const record = { id: existing?.id || options.id || `notice-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      key, title, ...output,
      source: text(options.source ?? existing?.source ?? "", 160),
      tone: tones.has(options.tone) ? options.tone : existing?.tone || "info",
      pending: options.pending ?? existing?.pending ?? false,
      read: existing?.read || false, createdAt: existing?.createdAt || now, updatedAt: now };
    const unchanged = existing && ["title", "message", "details", "source", "tone", "pending"].every(field => existing[field] === record[field]);
    if (unchanged) return existing.id;
    if (existing) records.splice(records.indexOf(existing), 1);
    const inspecting = modal && !modal.hidden && selectedId === record.id;
    record.read = inspecting;
    records.push(record);
    while (records.length > MAX_RECORDS) {
      const removedId = records.shift().id;
      dismiss(removedId);
      dismissedPending.delete(removedId);
    }
    const muted = record.pending && dismissedPending.has(record.id);
    if (!record.pending) dismissedPending.delete(record.id);
    if (!options.silent && !muted) {
      showToast(record);
      if (announcer && (!existing || ["message", "tone", "pending"].some(field => existing[field] !== record[field]))) {
        announcer.setAttribute("aria-live", record.tone === "error" ? "assertive" : "polite");
        announcer.textContent = `${record.title}. ${record.message}`;
      }
    }
    changed();
    return record.id;
  }

  function append(id, value, patch = {}) {
    const record = records.find(item => item.id === id);
    const addition = text(value).trim();
    if (!record) return notify({ ...patch, id, details: addition });
    const combined = [record.details, addition].filter(Boolean).join("\n");
    return notify({ ...record, ...patch, details: tail(combined, MAX_DETAILS),
      silent: !toasts.has(id) && !patch.message && !patch.tone && patch.pending === undefined });
  }

  function render() {
    const unread = records.filter(record => !record.read).length;
    for (const button of document.querySelectorAll("[data-notifications-open]")) {
      const badge = button.querySelector("[data-notifications-count]");
      if (!badge) continue;
      button.setAttribute("aria-label", unread ? `Notifications, ${unread} unread` : "Notifications");
      badge.textContent = unread > 99 ? "99+" : String(unread);
      badge.hidden = !unread;
    }
    if (!modal || modal.hidden) return;
    const list = modal.querySelector(".notification-history-list");
    const focusedId = document.activeElement?.dataset.notificationId;
    list.replaceChildren();
    if (!records.length) {
      const empty = document.createElement("p");
      empty.className = "ui-empty-state";
      empty.textContent = "No notifications yet.";
      list.append(empty);
    }
    for (const record of [...records].reverse()) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "notification-history-item ui-list-item ui-list-item--record";
      item.dataset.notificationId = record.id;
      item.dataset.tone = record.tone;
      item.classList.toggle("is-unread", !record.read);
      item.setAttribute("aria-pressed", String(selectedId === record.id));
      const meta = document.createElement("span");
      meta.className = "notification-item-meta";
      meta.textContent = `${status(record)} · ${time(record.updatedAt)}`;
      const title = document.createElement("strong");
      title.className = "ui-list-item-title";
      title.textContent = record.title;
      const summary = document.createElement("span"); summary.textContent = record.message;
      item.append(meta, title, summary);
      item.addEventListener("click", () => { selectedId = record.id; record.read = true; changed(); });
      list.append(item);
    }
    if (focusedId) [...list.children].find(item => item.dataset.notificationId === focusedId)?.focus({ preventScroll: true });
    const selected = records.find(record => record.id === selectedId);
    const detail = modal.querySelector(".notification-detail");
    detail.hidden = !selected;
    if (selected) {
      detail.dataset.tone = selected.tone;
      detail.querySelector("h4").textContent = selected.title;
      detail.querySelector(".notification-detail-meta").textContent = [status(selected), selected.source, new Date(selected.updatedAt).toLocaleString()].filter(Boolean).join(" · ");
      detail.querySelector(".notification-detail-summary").textContent = selected.message;
      const output = detail.querySelector(".notification-detail-output");
      output.hidden = !selected.details.trim() || selected.details.trim() === selected.message.trim();
      if (output.textContent !== selected.details) {
        const atEnd = output.scrollHeight - output.scrollTop - output.clientHeight < 24;
        output.textContent = selected.details;
        if (atEnd && selected.pending) output.scrollTop = output.scrollHeight;
      }
    }
  }

  function open(id) {
    if (!modal) return;
    selectedId = records.some(record => record.id === id) ? id : records.at(-1)?.id || null;
    const selected = records.find(record => record.id === selectedId);
    if (selected) selected.read = true;
    stack.hidden = true;
    window.UartDebugControls.openModal(modal, {
      focusTarget: modal.querySelector(".ui-dialog-close"),
      onClose: close,
    });
    changed();
    render();
  }

  function close() {
    stack.hidden = false;
    window.UartDebugControls.closeModal(modal);
  }

  function init() {
    stack = document.createElement("div");
    stack.className = "notification-toasts";
    stack.setAttribute("aria-label", "Recent notifications");
    announcer = document.createElement("div");
    announcer.className = "notification-announcer";
    announcer.setAttribute("role", "status");
    announcer.setAttribute("aria-live", "polite");
    modal = document.createElement("div");
    modal.className = "ui-modal notification-modal";
    modal.id = "notificationModal";
    modal.hidden = true;
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-labelledby", "notificationModalTitle");
    modal.innerHTML = '<div class="ui-dialog-card notification-dialog"><div class="ui-dialog-header"><h3 class="editor-title" id="notificationModalTitle">Notifications</h3><button class="ui-dialog-close" type="button" aria-label="Close notifications"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button></div><div class="notification-history ui-dialog-columns"><nav class="notification-history-list ui-scroll-region ui-dialog-sidebar" aria-label="Notification history"></nav><section class="notification-detail" hidden><h4></h4><p class="notification-detail-meta"></p><div class="notification-detail-body ui-scroll-region"><p class="notification-detail-summary"></p><pre class="notification-detail-output scroll-frame ui-scroll-region" tabindex="0" aria-label="Notification details"></pre></div></section></div></div>';
    modal.querySelector(".ui-dialog-close").addEventListener("click", close);
    modal.addEventListener("click", event => { if (event.target === modal) close(); });
    // Handle only this modal. Other dialogs keep the shared stack's page handlers.
    modal.addEventListener("keydown", event => {
      if (window.UartDebugControls.getTopModal()?.modal !== modal) return;
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
      else if (event.key === "Tab" && window.UartDebugControls.trapModalFocus(event)) event.stopPropagation();
    });
    document.body.append(stack, announcer, modal);
    for (const button of document.querySelectorAll("[data-notifications-open]")) button.addEventListener("click", () => open());
    render();
  }

  window.UartDebugNotifications = Object.freeze({ notify, append, open, dismiss,
    getAll: () => records.map(record => ({ ...record })) });
  window.addEventListener("pagehide", persist);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
