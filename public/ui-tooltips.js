(function () {
  const TOOLTIP_ATTR = "data-ui-tooltip";
  const TOOLTIP_SOURCE_ATTR = "data-ui-tooltip-source";
  const SELECTOR = [
    "[data-tooltip]",
    "[data-ui-tooltip]",
    "[title]",
    "button[aria-label]",
    "input[aria-label]",
    "select[aria-label]",
    "[role='button'][aria-label]",
    "[tabindex][aria-label]",
  ].join(",");

  let tooltipEl = null;
  let activeTarget = null;
  let showTimer = null;
  let hideTimer = null;

  function ensureTooltip() {
    if (tooltipEl) return tooltipEl;

    tooltipEl = document.createElement("div");
    tooltipEl.className = "ui-tooltip";
    tooltipEl.setAttribute("role", "tooltip");
    tooltipEl.setAttribute("aria-hidden", "true");
    document.body.appendChild(tooltipEl);
    return tooltipEl;
  }

  function getTooltipText(element) {
    if (!element) return "";
    const text = (
      element.getAttribute("data-tooltip") ||
      element.getAttribute(TOOLTIP_ATTR) ||
      element.getAttribute("title") ||
      getAriaTooltipText(element)
    ).trim();

    return shouldSuppressTooltip(element, text) ? "" : text;
  }

  function getAriaTooltipText(element) {
    if (!element?.matches) return "";
    if (
      !element.matches(
        "button[aria-label], input[aria-label], select[aria-label], [role='button'][aria-label], [tabindex][aria-label]"
      )
    ) {
      return "";
    }
    return element.getAttribute("aria-label") || "";
  }

  function prepareTooltipElement(element) {
    if (!element || !element.matches?.(SELECTOR)) return null;

    const title = element.getAttribute("title");
    if (title) {
      if (shouldSuppressTooltip(element, title)) {
        element.removeAttribute(TOOLTIP_ATTR);
        element.removeAttribute(TOOLTIP_SOURCE_ATTR);
      } else {
        element.setAttribute(TOOLTIP_ATTR, title);
        element.setAttribute(TOOLTIP_SOURCE_ATTR, "title");
      }
      element.removeAttribute("title");
      return element.getAttribute(TOOLTIP_ATTR) ? element : null;
    }

    const dataTooltip = element.getAttribute("data-tooltip");
    if (dataTooltip) {
      if (shouldSuppressTooltip(element, dataTooltip)) {
        element.removeAttribute(TOOLTIP_ATTR);
        element.removeAttribute(TOOLTIP_SOURCE_ATTR);
        return null;
      }
      element.setAttribute(TOOLTIP_ATTR, dataTooltip);
      element.setAttribute(TOOLTIP_SOURCE_ATTR, "data-tooltip");
      return element;
    }

    if (!element.getAttribute(TOOLTIP_ATTR)) {
      const ariaText = getAriaTooltipText(element);
      if (ariaText && !shouldSuppressTooltip(element, ariaText)) {
        element.setAttribute(TOOLTIP_ATTR, ariaText);
        element.setAttribute(TOOLTIP_SOURCE_ATTR, "aria-label");
      }
    }

    return element.getAttribute(TOOLTIP_ATTR) ? element : null;
  }

  function shouldSuppressTooltip(element, text) {
    if (!text || element.hasAttribute("data-tooltip-disabled")) {
      return true;
    }

    const visibleText = getElementVisibleText(element);
    return !!visibleText && normalizeTooltipText(visibleText) === normalizeTooltipText(text);
  }

  function getElementVisibleText(element) {
    const text =
      element instanceof HTMLElement
        ? element.innerText || element.textContent || ""
        : element?.textContent || "";
    return text.replace(/\s+/g, " ").trim();
  }

  function normalizeTooltipText(text) {
    return String(text || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLocaleLowerCase();
  }

  function findTooltipTarget(start) {
    const target = start?.closest?.(SELECTOR);
    return prepareTooltipElement(target);
  }

  function showTooltip(target) {
    const text = getTooltipText(target);
    if (!text) return;

    const tooltip = ensureTooltip();
    activeTarget = target;
    tooltip.textContent = text;
    tooltip.setAttribute("aria-hidden", "false");
    tooltip.classList.remove("is-visible");

    positionTooltip(target);

    clearTimeout(showTimer);
    showTimer = window.setTimeout(() => {
      tooltip.classList.add("is-visible");
    }, 90);
  }

  function hideTooltip(target) {
    if (target && activeTarget && target !== activeTarget) return;
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    activeTarget = null;

    if (!tooltipEl) return;
    tooltipEl.classList.remove("is-visible");
    tooltipEl.setAttribute("aria-hidden", "true");
    hideTimer = window.setTimeout(() => {
      if (!activeTarget && tooltipEl) {
        tooltipEl.style.left = "-9999px";
        tooltipEl.style.top = "-9999px";
      }
    }, 140);
  }

  function positionTooltip(target) {
    const tooltip = ensureTooltip();
    const rect = target.getBoundingClientRect();
    const gap = 10;

    tooltip.style.left = "0px";
    tooltip.style.top = "0px";
    tooltip.dataset.placement = "top";

    const tooltipRect = tooltip.getBoundingClientRect();
    let left = rect.left + rect.width / 2;
    let top = rect.top - tooltipRect.height - gap;
    let placement = "top";

    if (top < 8) {
      top = rect.bottom + gap;
      placement = "bottom";
    }

    const halfWidth = tooltipRect.width / 2;
    left = Math.max(halfWidth + 8, Math.min(window.innerWidth - halfWidth - 8, left));
    top = Math.max(8, Math.min(window.innerHeight - tooltipRect.height - 8, top));

    tooltip.dataset.placement = placement;
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }

  function handlePointerOver(event) {
    const target = findTooltipTarget(event.target);
    if (!target) return;
    showTooltip(target);
  }

  function handlePointerOut(event) {
    const target = activeTarget;
    if (!target) return;
    const related = event.relatedTarget;
    if (related && target.contains(related)) return;
    hideTooltip(target);
  }

  function handleFocusIn(event) {
    const target = findTooltipTarget(event.target);
    if (!target) return;
    showTooltip(target);
  }

  function handleFocusOut(event) {
    hideTooltip(event.target);
  }

  function refreshDynamicTooltip(element, attributeName) {
    if (!element?.matches?.(SELECTOR)) return;

    if (attributeName === "title") {
      const title = element.getAttribute("title");
      if (title) {
        if (shouldSuppressTooltip(element, title)) {
          element.removeAttribute(TOOLTIP_ATTR);
          element.removeAttribute(TOOLTIP_SOURCE_ATTR);
        } else {
          element.setAttribute(TOOLTIP_ATTR, title);
          element.setAttribute(TOOLTIP_SOURCE_ATTR, "title");
        }
        element.removeAttribute("title");
      }
    } else if (attributeName === "aria-label") {
      const ariaText = getAriaTooltipText(element);
      if (
        ariaText &&
        element.getAttribute(TOOLTIP_SOURCE_ATTR) !== "title" &&
        !shouldSuppressTooltip(element, ariaText)
      ) {
        element.setAttribute(TOOLTIP_ATTR, ariaText);
        element.setAttribute(TOOLTIP_SOURCE_ATTR, "aria-label");
      } else if (shouldSuppressTooltip(element, ariaText)) {
        element.removeAttribute(TOOLTIP_ATTR);
        element.removeAttribute(TOOLTIP_SOURCE_ATTR);
      }
    } else if (attributeName === "data-tooltip") {
      prepareTooltipElement(element);
    }

    if (element === activeTarget) {
      const text = getTooltipText(element);
      if (text) {
        tooltipEl.textContent = text;
        positionTooltip(element);
      } else {
        hideTooltip(element);
      }
    }
  }

  function initTooltips() {
    document.querySelectorAll(SELECTOR).forEach(prepareTooltipElement);

    document.addEventListener("pointerover", handlePointerOver);
    document.addEventListener("pointerout", handlePointerOut);
    document.addEventListener("focusin", handleFocusIn);
    document.addEventListener("focusout", handleFocusOut);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") hideTooltip();
    });
    window.addEventListener("scroll", () => hideTooltip(), true);
    window.addEventListener("resize", () => hideTooltip());

    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === "attributes") {
          refreshDynamicTooltip(mutation.target, mutation.attributeName);
        } else if (mutation.type === "childList") {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType !== Node.ELEMENT_NODE) return;
            prepareTooltipElement(node);
            node.querySelectorAll?.(SELECTOR).forEach(prepareTooltipElement);
          });
        }
      });
    });

    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["title", "aria-label", "data-tooltip"],
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initTooltips, { once: true });
  } else {
    initTooltips();
  }
})();
