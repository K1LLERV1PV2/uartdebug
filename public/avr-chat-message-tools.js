(function (root) {
  "use strict";

  const paths = Object.freeze({
    edit: "m15 5 4 4M4 20l4-1L20 7a2.1 2.1 0 0 0-3-3L5 16Z",
    branch: "M4 12h4a5 5 0 0 0 4-2l7-6m-5 0h5v5M8 12a5 5 0 0 1 4 2l7 6m-5 0h5v-5",
    retry: "M20 7v5h-5M20 12a8 8 0 1 0-2 6",
    copy: "M8 8h12v12H8zM16 8V4H4v12h4",
  });

  function create(options) {
    const host = options?.root;
    if (!host?.ownerDocument || typeof options.getMessage !== "function" || typeof options.getScope !== "function") {
      throw new TypeError("A chat root, getMessage and getScope are required.");
    }
    const document = host.ownerDocument;
    const window = document.defaultView;
    let editor = null;
    const feedbackTimers = new Map();

    function icon(path) {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      for (const [name, value] of Object.entries({ viewBox: "0 0 24 24", "aria-hidden": "true", fill: "none", stroke: "currentColor", "stroke-width": "1.7", "stroke-linecap": "round", "stroke-linejoin": "round" })) svg.setAttribute(name, value);
      const shape = document.createElementNS(svg.namespaceURI, "path");
      shape.setAttribute("d", path);
      svg.append(shape);
      return svg;
    }

    function notice(message, error) {
      options.notify?.({ title: "Chat", tone: "error", message, diagnostics: error?.stack || String(error || message) });
    }

    function closeEditor({ focus = false } = {}) {
      if (!editor) return;
      const previous = editor;
      editor = null;
      previous.form.remove();
      previous.content.hidden = false;
      previous.article.classList.remove("is-editing");
      if (focus && previous.trigger.isConnected) previous.trigger.focus({ preventScroll: true });
    }

    function startEditor(article, message, scope, trigger) {
      if (editor?.article === article) { editor.input.focus(); return; }
      closeEditor();
      const content = article.querySelector(".project-chat-message-content");
      if (!content) return;
      const form = document.createElement("form");
      form.className = "project-chat-edit";
      const frame = document.createElement("div");
      frame.className = "project-chat-edit-input scroll-frame";
      const input = document.createElement("textarea");
      input.className = "ui-text-input ui-text-input--embedded ui-scroll-region";
      input.setAttribute("aria-label", "Edit message");
      input.rows = 5;
      input.value = message.content;
      const note = document.createElement("p");
      note.className = "project-chat-edit-note";
      note.textContent = "Earlier versions stay available in this chat. Project files stay current.";
      const actions = document.createElement("div");
      actions.className = "project-chat-edit-actions";
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "ui-action ui-action--compact";
      cancel.textContent = "Cancel";
      const send = document.createElement("button");
      send.type = "submit";
      send.className = "ui-action ui-action--compact";
      send.textContent = "Save and send";
      actions.append(cancel, send);
      frame.append(input);
      form.append(frame, note, actions);
      const state = { form, input, article, content, trigger, scope, send, busy: false };
      editor = state;
      content.hidden = true;
      article.classList.add("is-editing");
      content.after(form);
      cancel.addEventListener("click", () => closeEditor({ focus: true }));
      input.addEventListener("input", () => { send.disabled = state.busy || !input.value.trim(); });
      form.addEventListener("keydown", event => {
        if (event.key === "Escape") {
          event.preventDefault(); event.stopPropagation(); closeEditor({ focus: true });
        } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.isComposing) {
          event.preventDefault(); form.requestSubmit();
        }
      });
      form.addEventListener("submit", async event => {
        event.preventDefault();
        if (editor !== state || options.getScope() !== scope || send.disabled || !input.value.trim()) return;
        send.disabled = true;
        try {
          const accepted = await options.onEdit?.(message.id, input.value, scope);
          if (accepted !== false || options.getScope() !== scope) closeEditor();
        } catch (error) { notice("The edited message could not be sent.", error); }
        finally { if (editor === state) send.disabled = state.busy || !input.value.trim(); }
      });
      input.focus({ preventScroll: true });
      input.setSelectionRange(input.value.length, input.value.length);
    }

    function decorateCode(content) {
      for (const pre of content.querySelectorAll("pre")) {
        if (pre.parentElement?.classList.contains("project-chat-code-block")) continue;
        const code = pre.querySelector("code");
        if (!code) continue;
        pre.classList.add("ui-scroll-region");
        pre.tabIndex = 0;
        pre.setAttribute("aria-label", "Code block");
        const block = document.createElement("div");
        block.className = "project-chat-code-block";
        const header = document.createElement("div");
        header.className = "project-chat-code-header";
        const language = document.createElement("span");
        const match = [...code.classList].map(value => /^language-([A-Za-z0-9_+-]+)$/.exec(value)).find(Boolean);
        language.textContent = match?.[1] || "Code";
        const copy = document.createElement("button");
        copy.type = "button";
        copy.className = "ui-action ui-action--compact project-chat-code-copy";
        copy.dataset.chatCodeCopy = "";
        copy.setAttribute("aria-label", "Copy code");
        copy.append(icon(paths.copy));
        const label = document.createElement("span");
        label.textContent = "Copy code";
        copy.append(label);
        header.append(language, copy);
        pre.before(block);
        block.append(header, pre);
      }
    }

    function decorate(row, context) {
      const message = options.getMessage(row.article.dataset.messageId);
      if (!message) return;
      if (editor && editor.scope !== context.scope) closeEditor();
      row.article.dataset.chatScope = context.scope;
      if (message.role === "assistant" && message.status === "complete") decorateCode(row.content);
      const actions = row.actions || row.article.querySelector(".project-chat-message-actions");
      if (!actions) return;
      const available = message.role === "user"
        ? [["edit", "Edit message"], ["branch", "Branch from here"]]
        : message.status === "complete" ? [["retry", "Retry response"], ["branch", "Branch from here"]]
          : message.status === "error" && context.isLast ? [["retry", "Retry response"]] : [];
      const valid = new Set(available.map(([action]) => action));
      for (const button of actions.querySelectorAll("[data-chat-action]")) {
        if (!valid.has(button.dataset.chatAction)) button.remove();
      }
      for (const [action, label] of available) {
        let button = actions.querySelector(`[data-chat-action="${action}"]`);
        if (!button) {
          button = document.createElement("button");
          button.type = "button";
          button.className = "ui-icon-button";
          button.dataset.chatAction = action;
          button.setAttribute("aria-label", label);
          button.title = label;
          button.append(icon(paths[action]));
          actions.append(button);
        }
        button.disabled = !!context.busy;
      }
      // Keep pager nodes stable while progress, busy state or unrelated rows
      // update; a keyboard user's focused control must not be recreated.
      if (!row.variants) {
        const group = document.createElement("span");
        group.className = "project-chat-message-variants";
        group.setAttribute("role", "group"); group.setAttribute("aria-label", "Conversation branches");
        const count = document.createElement("span"); count.className = "project-chat-variant-count";
        const arrows = [-1, 1].map(direction => {
          const button = document.createElement("button"); button.type = "button"; button.className = "ui-icon-button";
          const label = direction < 0 ? "Previous branch" : "Next branch";
          button.dataset.chatVariantDirection = direction < 0 ? "previous" : "next";
          button.setAttribute("aria-label", label); button.title = label;
          button.append(icon(direction < 0 ? "m14 6-6 6 6 6" : "m10 6 6 6-6 6"));
          return button;
        });
        const resume = document.createElement("button"); resume.type = "button";
        resume.className = "ui-action ui-action--compact project-chat-resume";
        resume.textContent = "Resume saved continuation";
        group.append(arrows[0], count, arrows[1], resume); row.meta.prepend(group);
        row.variants = { group, count, arrows, resume };
      }
      const { group, count, arrows, resume } = row.variants;
      const multiple = context.variants.length > 1;
      group.hidden = !multiple && !context.resume;
      count.hidden = !multiple;
      count.textContent = `${context.variantIndex + 1}/${context.variants.length}`;
      count.setAttribute("aria-label", `Branch ${context.variantIndex + 1} of ${context.variants.length}`);
      arrows.forEach((button, index) => {
        const target = context.variantIndex + (index ? 1 : -1);
        button.hidden = !multiple;
        button.dataset.chatVariant = context.variants[target] || "";
        button.disabled = !!context.busy || target < 0 || target >= context.variants.length;
      });
      resume.hidden = !context.resume; resume.disabled = !!context.busy;
      resume.dataset.chatResume = message.id;
      if (editor?.article === row.article) {
        row.content.hidden = true;
        editor.busy = !!context.busy;
        editor.send.disabled = editor.busy || !editor.input.value.trim();
      }
    }

    async function handleClick(event) {
      const variant = event.target.closest?.("[data-chat-variant], [data-chat-resume]");
      if (variant && !variant.disabled && host.contains(variant)) {
        const scope = variant.closest(".project-chat-message")?.dataset.chatScope;
        if (scope !== options.getScope()) return;
        const callback = variant.hasAttribute("data-chat-resume") ? options.onResume : options.onVariant;
        try { await callback?.(variant.dataset.chatResume || variant.dataset.chatVariant, scope, variant.dataset.chatVariantDirection); }
        catch (error) { notice("The saved branch could not be opened.", error); }
        return;
      }
      const copy = event.target.closest?.("[data-chat-code-copy]");
      if (copy && host.contains(copy)) {
        const code = copy.closest(".project-chat-code-block")?.querySelector("pre code");
        if (!code) return;
        try {
          if (!window.navigator?.clipboard?.writeText) throw new Error("Clipboard access is unavailable in this browser.");
          await window.navigator.clipboard.writeText(code.textContent);
          const label = copy.querySelector("span");
          label.textContent = "Copied";
          copy.setAttribute("aria-label", "Code copied");
          if (feedbackTimers.has(copy)) window.clearTimeout(feedbackTimers.get(copy));
          feedbackTimers.set(copy, window.setTimeout(() => {
            feedbackTimers.delete(copy);
            label.textContent = "Copy code";
            copy.setAttribute("aria-label", "Copy code");
          }, 1400));
        } catch (error) { notice("The code could not be copied.", error); }
        return;
      }
      const button = event.target.closest?.("[data-chat-action]");
      if (!button || button.disabled || !host.contains(button)) return;
      const article = button.closest(".project-chat-message");
      const scope = article?.dataset.chatScope;
      if (!article || scope !== options.getScope()) return;
      const message = options.getMessage(article.dataset.messageId);
      if (!message) return;
      const action = button.dataset.chatAction;
      if (action === "edit") { startEditor(article, message, scope, button); return; }
      const callback = { retry: options.onRetry, branch: options.onBranch }[action];
      if (typeof callback !== "function") return;
      try { await callback(message.id, scope); }
      catch (error) { notice("The chat action could not be completed.", error); }
    }

    host.addEventListener("click", handleClick);
    return Object.freeze({
      decorate, closeEditor,
      destroy() {
        closeEditor();
        host.removeEventListener("click", handleClick);
        for (const timer of feedbackTimers.values()) window.clearTimeout(timer);
        feedbackTimers.clear();
      },
    });
  }

  root.UartDebugChatMessageTools = Object.freeze({ create });
})(typeof globalThis === "object" ? globalThis : this);
