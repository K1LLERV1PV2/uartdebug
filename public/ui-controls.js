// Shared controls for all Uart Debug workspaces.
(() => {
  "use strict";
  const workspaceModalStack = [];

  function getTopWorkspaceModal() {
    return [...workspaceModalStack].reverse().find((entry) => !entry.modal.hidden) || null;
  }

  function getWorkspaceModalControls(modal) {
    return Array.from(modal.querySelectorAll(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]'
    )).filter((element) => element.tabIndex >= 0 &&
      !element.closest('[hidden], [inert], [aria-hidden="true"]') && element.getClientRects().length > 0);
  }

  function focusWorkspaceModal(entry) {
    const requested = typeof entry.focusTarget === "function" ? entry.focusTarget() : entry.focusTarget;
    const target = requested && !requested.disabled && !requested.closest("[hidden]")
      ? requested : getWorkspaceModalControls(entry.modal)[0];
    const fallback = target || entry.modal.querySelector(".site-dialog-card, .file-add-dialog") || entry.modal;
    if (!target) fallback.tabIndex = -1;
    fallback.focus({ preventScroll: true });
  }

  function openWorkspaceModal(modal, { trigger = document.activeElement, focusTarget, onClose } = {}) {
    const previous = workspaceModalStack.find((entry) => entry.modal === modal);
    if (previous) workspaceModalStack.splice(workspaceModalStack.indexOf(previous), 1);
    const entry = {
      modal, focusTarget, onClose,
      returnFocus: previous?.returnFocus || trigger,
      originalZIndex: previous?.originalZIndex ?? modal.style.zIndex,
    };
    workspaceModalStack.push(entry);
    document.querySelectorAll(".custom-select.is-open").forEach(closeCustomSelect);
    modal.hidden = false;
    workspaceModalStack.forEach((item, index) => { item.modal.style.zIndex = String(1400 + index * 2); });
    window.requestAnimationFrame(() => {
      if (getTopWorkspaceModal() === entry) focusWorkspaceModal(entry);
    });
  }

  function closeWorkspaceModal(modal, { restoreFocus = true } = {}) {
    if (!modal || modal.hidden) return;
    const entry = workspaceModalStack.find((item) => item.modal === modal);
    const wasTop = getTopWorkspaceModal() === entry;
    modal.hidden = true;
    if (!entry) return;
    workspaceModalStack.splice(workspaceModalStack.indexOf(entry), 1);
    modal.style.zIndex = entry.originalZIndex;
    for (const child of workspaceModalStack) {
      if (entry.modal.contains(child.returnFocus)) child.returnFocus = entry.returnFocus;
    }
    if (!restoreFocus || !wasTop) return;
    const top = getTopWorkspaceModal();
    const trigger = entry.returnFocus;
    if (trigger?.isConnected && !trigger.disabled && !trigger.closest("[hidden], [inert]") &&
        trigger.getClientRects().length > 0 && (!top || top.modal.contains(trigger))) {
      trigger.focus({ preventScroll: true });
    } else if (top) {
      focusWorkspaceModal(top);
    } else {
      const previousTabIndex = document.body.getAttribute("tabindex");
      document.body.tabIndex = -1;
      document.body.focus({ preventScroll: true });
      if (previousTabIndex === null) document.body.removeAttribute("tabindex");
      else document.body.setAttribute("tabindex", previousTabIndex);
    }
  }

  function trapWorkspaceModalFocus(event) {
    const entry = getTopWorkspaceModal();
    if (!entry || event.key !== "Tab") return false;
    const controls = getWorkspaceModalControls(entry.modal);
    const active = document.activeElement;
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (!first || !controls.includes(active) || (event.shiftKey ? active === first : active === last)) {
      event.preventDefault();
      if (!first) focusWorkspaceModal(entry);
      else (event.shiftKey ? last : first).focus({ preventScroll: true });
      return true;
    }
    return false;
  }

  function dismissTopWorkspaceModal() {
    const entry = getTopWorkspaceModal();
    if (!entry) return false;
    entry.onClose();
    return true;
  }

  function getSelectDisplayText(select) {
    if (!select) return "";
    const selected = select.selectedOptions && select.selectedOptions[0];
    return selected ? selected.textContent.trim() : "";
  }

  function updateCustomSelectIntrinsicWidth(custom) {
    const label = custom?.querySelector(".custom-select-value");
    if (!custom || !label) return;
    custom.style.removeProperty("--custom-select-width");
    const textWidth = Math.ceil(label.scrollWidth);
    custom.style.setProperty(
      "--custom-select-width",
      `${Math.max(72, textWidth + 58)}px`
    );
  }

  function renderCustomSelectOptions(select, custom) {
    const list = custom.querySelector(".custom-select-list");
    const label = custom.querySelector(".custom-select-value");
    if (!list || !label) return;

    list.innerHTML = "";
    label.textContent = getSelectDisplayText(select) || "Select option";
    label.title = label.textContent;
    updateCustomSelectIntrinsicWidth(custom);

    const addOption = (option) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "custom-select-option";
      item.dataset.value = option.value;
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", String(option.value === select.value));
      item.textContent = option.textContent.trim();
      item.disabled = option.disabled || option.parentElement?.disabled === true;
      item.tabIndex = -1;

      item.addEventListener("click", (event) => {
        event.stopPropagation();
        if (select.value !== option.value) {
          select.value = option.value;
          select.dispatchEvent(new Event("change", { bubbles: true }));
        } else {
          updateCustomSelect(select, custom);
        }
        closeCustomSelect(custom);
        custom.querySelector(".custom-select-trigger")?.focus();
      });

      list.appendChild(item);
    };

    for (const child of Array.from(select.children)) {
      if (child.tagName === "OPTGROUP") {
        const group = document.createElement("div");
        group.className = "custom-select-group";

        const groupLabel = document.createElement("div");
        groupLabel.className = "custom-select-group-label";
        groupLabel.textContent = child.label || "";
        group.appendChild(groupLabel);
        list.appendChild(group);

        for (const option of Array.from(child.children)) {
          addOption(option);
        }
      } else if (child.tagName === "OPTION") {
        addOption(child);
      }
    }
  }

  function updateCustomSelect(select, custom) {
    if (!select || !custom) return;
    const trigger = custom.querySelector(".custom-select-trigger");
    if (trigger) trigger.disabled = !!select.disabled;
    custom.classList.toggle("is-disabled", !!select.disabled);
    custom.setAttribute("aria-disabled", String(!!select.disabled));
    renderCustomSelectOptions(select, custom);
    if (select.disabled) closeCustomSelect(custom);
    else if (custom.classList.contains("is-open")) positionCustomSelectMenu(custom);
  }

  function positionCustomSelectMenu(custom) {
    const menu = custom.querySelector(".custom-select-menu");
    if (!menu?.hasAttribute("popover")) return;
    const bounds = custom.getBoundingClientRect();
    const edge = 12;
    const gap = 6;
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = document.documentElement.clientHeight;
    const preferredWidth = custom.closest(".documentation-locale-control") ? 180 : 280;
    const width = Math.min(Math.max(bounds.width, preferredWidth), viewportWidth - edge * 2);
    const below = viewportHeight - bounds.bottom - gap - edge;
    const above = bounds.top - gap - edge;
    const opensUpward = below < 180 && above > below;
    const availableHeight = Math.max(0, opensUpward ? above : below);
    menu.style.width = `${width}px`;
    menu.style.maxHeight = `${Math.min(360, availableHeight)}px`;
    menu.style.left = `${Math.max(edge, Math.min(bounds.left, viewportWidth - width - edge))}px`;
    menu.style.top = opensUpward ? "auto" : `${bounds.bottom + gap}px`;
    menu.style.bottom = opensUpward ? `${viewportHeight - bounds.top + gap}px` : "auto";
  }

  function closeCustomSelect(custom) {
    if (!custom) return;
    const menu = custom.querySelector(".custom-select-menu");
    if (menu?.hasAttribute("popover") && menu.matches(":popover-open")) menu.hidePopover();
    custom.classList.remove("is-open");
    const trigger = custom.querySelector(".custom-select-trigger");
    if (trigger) trigger.setAttribute("aria-expanded", "false");
  }

  function openCustomSelect(select, custom, focusOption = false) {
    if (!select || !custom || select.disabled) return;
    document.querySelectorAll(".custom-select.is-open").forEach(closeCustomSelect);
    updateCustomSelect(select, custom);
    custom.classList.add("is-open");
    const trigger = custom.querySelector(".custom-select-trigger");
    if (trigger) trigger.setAttribute("aria-expanded", "true");
    const menu = custom.querySelector(".custom-select-menu");
    if (menu?.hasAttribute("popover")) menu.showPopover();
    positionCustomSelectMenu(custom);

    const active = custom.querySelector('.custom-select-option[aria-selected="true"]:not(:disabled)') ||
      custom.querySelector('.custom-select-option:not(:disabled)');
    if (focusOption) active?.focus({ preventScroll: true });
    active?.scrollIntoView({ block: "nearest" });
  }

  function initCustomSelect(select) {
    if (!select || select.dataset.customized === "true") return;

    select.dataset.customized = "true";
    select.classList.add("native-select-hidden");
    select.tabIndex = -1;
    select.setAttribute("aria-hidden", "true");

    const custom = document.createElement("div");
    custom.className = "custom-select";
    custom.setAttribute("aria-hidden", "false");

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "custom-select-trigger";
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", "false");
    const accessibleLabel =
      select.getAttribute("aria-label") ||
      select.labels?.[0]?.textContent?.trim() ||
      "Select option";
    trigger.setAttribute("aria-label", accessibleLabel);

    const value = document.createElement("span");
    value.className = "custom-select-value";
    trigger.appendChild(value);

    const menu = document.createElement("div");
    menu.className = "custom-select-menu";
    if (typeof menu.showPopover === "function") menu.setAttribute("popover", "manual");

    const list = document.createElement("div");
    list.className = "custom-select-list";
    list.setAttribute("role", "listbox");
    if (select.id) {
      list.id = `${select.id}CustomListbox`;
      trigger.setAttribute("aria-controls", list.id);
    }
    menu.appendChild(list);

    custom.appendChild(trigger);
    custom.appendChild(menu);
    select.insertAdjacentElement("afterend", custom);

    trigger.addEventListener("click", (event) => {
      event.stopPropagation();
      if (custom.classList.contains("is-open")) {
        closeCustomSelect(custom);
      } else {
        openCustomSelect(select, custom);
      }
    });

    trigger.addEventListener("keydown", (event) => {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
        event.preventDefault();
        openCustomSelect(select, custom, true);
      }
    });

    custom.addEventListener("keydown", (event) => {
      if (!custom.classList.contains("is-open")) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeCustomSelect(custom);
        trigger.focus();
      } else if (event.key === "Tab") {
        // Continue the normal tab order from the select, not its popup options.
        if (menu.contains(document.activeElement)) trigger.focus();
        closeCustomSelect(custom);
      } else if (menu.contains(event.target) && ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        const options = [...list.querySelectorAll(".custom-select-option:not(:disabled)")];
        const index = options.indexOf(document.activeElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1
          : (index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
        options[next]?.focus();
      }
    });
    custom.addEventListener("click", (event) => event.stopPropagation());
    select.addEventListener("change", () => updateCustomSelect(select, custom));

    const observer = new MutationObserver(() => updateCustomSelect(select, custom));
    observer.observe(select, {
      attributes: true,
      childList: true,
      subtree: true,
      attributeFilter: ["disabled", "label", "selected", "value"],
    });

    document.addEventListener("click", () => closeCustomSelect(custom));
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeCustomSelect(custom);
    });
    window.addEventListener("resize", () => closeCustomSelect(custom));
    document.addEventListener("scroll", (event) => {
      if (!menu.contains(event.target)) closeCustomSelect(custom);
    }, true);

    updateCustomSelect(select, custom);
  }

  window.UartDebugControls = Object.freeze({
    initSelect: initCustomSelect,
    updateSelect: updateCustomSelect,
    closeSelect: closeCustomSelect,
    refreshSelectWidth: updateCustomSelectIntrinsicWidth,
    openModal: openWorkspaceModal,
    closeModal: closeWorkspaceModal,
    trapModalFocus: trapWorkspaceModalFocus,
    dismissTopModal: dismissTopWorkspaceModal,
    getTopModal: getTopWorkspaceModal,
  });
})();
