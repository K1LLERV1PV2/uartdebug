(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.UartDebugAvrWorkspaceLayout = factory();
})(typeof globalThis === "object" ? globalThis : this, function () {
  "use strict";

  // Pure geometry for the four desktop AVR panes. No DOM or saved state.
  const WORKSPACE_PANEL_COMPACT_THRESHOLD = 112;
  const WORKSPACE_PANEL_COLLAPSE_DISTANCE = 120;
  const WORKSPACE_PANEL_REOPEN_DISTANCE = 48;

  function getCapsuleNotchPoints(width, depth, distance) {
    // Offset the existing capsule along its normal. A diagonal translation
    // makes the divider wider in the bend than along the vertical edges.
    return Array.from({ length: 33 }, (_, index) => {
      const t = index / 32;
      const dx = -6 * width * t * (1 - t);
      const dy = depth * (1.5 - 3 * t + 3 * t * t);
      const length = Math.hypot(dx, dy);
      return {
        x: width * (1 - 3 * t * t + 2 * t * t * t) + distance * (dy / length - 1),
        y: depth * (1.5 * t - 1.5 * t * t + t * t * t) - distance * dx / length,
      };
    });
  }

  function snapWorkspacePanelSize(value, spec) {
    return spec.compact && value <= WORKSPACE_PANEL_COMPACT_THRESHOLD
      ? spec.compact
      : Math.max(spec.min, value);
  }

  function workspacePanelFloor(value, spec) {
    return spec.compact && value === spec.compact ? spec.compact : spec.min;
  }

  function getWorkspaceNeighbor(index) {
    return index === 0 || index === 2 ? 1 : 2;
  }

  function getWorkspacePanelMaxWidth(index, widths, specs) {
    const neighbor = getWorkspaceNeighbor(index);
    const otherSlack = widths[neighbor] === specs[neighbor].compact
      ? widths.reduce((sum, width, i) => sum + (i === index || i === neighbor ? 0 : width - workspacePanelFloor(width, specs[i])), 0)
      : 0;
    return widths[index] + widths[neighbor] - workspacePanelFloor(widths[neighbor], specs[neighbor]) + otherSlack;
  }

  function fitWorkspaceWidths(requested, available, specs) {
    const widths = requested.map((value, i) => snapWorkspacePanelSize(value, specs[i]));
    let excess = widths.reduce((sum, width) => sum + width, 0) - available;
    // A viewport change first consumes the flexible editor, then side-panel slack.
    for (const i of [2, 0, 3, 1]) {
      const take = Math.min(Math.max(0, excess), widths[i] - workspacePanelFloor(widths[i], specs[i]));
      widths[i] -= take;
      excess -= take;
    }
    // Keep the primary conversation available before secondary documents.
    for (const i of [3, 1, 0]) {
      if (excess <= 0) break;
      const released = widths[i] - specs[i].compact;
      widths[i] = specs[i].compact;
      excess -= released;
    }
    // Only an already expanded pane absorbs spare room. If every saved pane
    // is closed, reopen the canvas to give the workspace one usable surface.
    const flexibleIndex = [2, 1, 0, 3].find(index => widths[index] !== specs[index].compact) ?? 1;
    widths[flexibleIndex] -= excess;
    return widths;
  }

  function resizeWorkspacePanels(start, specs, index, requested) {
    const widths = [...start];
    const neighbor = getWorkspaceNeighbor(index);
    const total = start[index] + start[neighbor];
    let target = Math.min(
      getWorkspacePanelMaxWidth(index, start, specs),
      snapWorkspacePanelSize(requested, specs[index])
    );
    if (target !== specs[index].compact && target < specs[index].min) return widths;
    let adjacent = total - target;
    if (start[neighbor] === specs[neighbor].compact) {
      // Keep the neighbor closed and exchange space with expanded panes,
      // preferring the editor or canvas.
      const recipients = [2, 1, 0, 3].filter(i => i !== index && i !== neighbor && widths[i] >= specs[i].min);
      if (!recipients.length) return widths;
      adjacent = specs[neighbor].compact;
      let transfer = total - target - adjacent;
      if (transfer >= 0) widths[recipients[0]] += transfer;
      else for (const recipient of recipients) {
        const borrowed = Math.min(-transfer, widths[recipient] - specs[recipient].min);
        widths[recipient] -= borrowed;
        transfer += borrowed;
      }
    } else if (adjacent !== specs[neighbor].compact && adjacent < specs[neighbor].min) {
      adjacent = snapWorkspacePanelSize(adjacent, specs[neighbor]);
      target = total - adjacent;
    }
    // A compact panel can reopen only when the available width meets its minimum.
    if (target !== specs[index].compact && target < specs[index].min) return widths;
    widths[index] = target;
    widths[neighbor] = adjacent;
    return widths;
  }

  function resizeWorkspaceBoundary(start, specs, boundary, delta, closeAdjacent = false) {
    if (!delta) return [...start];
    const growing = delta > 0 ? boundary : boundary + 1;
    const shrinking = delta > 0 ? boundary + 1 : boundary;
    const amount = Math.abs(delta);
    // A small motion on a closed rail must not immediately reopen it.
    if (start[growing] === specs[growing].compact &&
        amount < WORKSPACE_PANEL_REOPEN_DISTANCE) return [...start];
    const canCloseAdjacent = start[growing] === specs[growing].compact &&
      start[shrinking] !== specs[shrinking].compact;
    const sizes = [...start];
    const requested = start[shrinking] - amount;
    sizes[shrinking] = (closeAdjacent && canCloseAdjacent) ||
      start[shrinking] === specs[shrinking].compact ||
      requested <= specs[shrinking].min - WORKSPACE_PANEL_COLLAPSE_DISTANCE
      ? specs[shrinking].compact
      : Math.max(specs[shrinking].min, requested);
    const pairTotal = start[growing] + start[shrinking];
    sizes[growing] = Math.max(specs[growing].min, pairTotal - sizes[shrinking]);
    let missing = sizes[growing] + sizes[shrinking] - pairTotal;
    // A reopened pane first takes its minimum from its expanded neighbor.
    const adjacentSlack = sizes[shrinking] - workspacePanelFloor(sizes[shrinking], specs[shrinking]);
    const adjacentTransfer = Math.min(missing, adjacentSlack);
    sizes[shrinking] -= adjacentTransfer;
    missing -= adjacentTransfer;
    // Two closed neighbors may need space from a farther expanded pane. Never
    // close that pane implicitly or take more than its spare space.
    for (const index of [2, 1, 0, 3]) {
      if (index === growing || index === shrinking || missing <= 0) continue;
      const borrowed = Math.min(missing, sizes[index] - workspacePanelFloor(sizes[index], specs[index]));
      sizes[index] -= borrowed;
      missing -= borrowed;
    }
    if (missing > 0.001 && canCloseAdjacent && !closeAdjacent) {
      return resizeWorkspaceBoundary(start, specs, boundary, delta, true);
    }
    return missing > 0.001 ? [...start] : sizes;
  }

  function getWorkspaceResizePreview(start, specs, boundary, delta) {
    if (!delta) return null;
    const direction = delta < 0 ? -1 : 1;
    const growing = delta > 0 ? boundary : boundary + 1;
      if (start[growing] === specs[growing].compact) return null;
    const index = delta < 0 ? boundary : boundary + 1;
    if (start[index] === specs[index].compact) return null;
    const overtravel = specs[index].min - (start[index] - Math.abs(delta));
    if (overtravel < 0 || overtravel >= WORKSPACE_PANEL_COLLAPSE_DISTANCE) return null;
    return { index, direction };
  }

  function balanceWorkspaceSpacing(widths, available, previousWidths, specs) {
    const adjusted = [...widths];
    let difference = available - adjusted.reduce((sum, width) => sum + width, 0);
    const order = [2, 1, 0, 3].filter(index => adjusted[index] >= specs[index].min);
    const preferred = order.filter(index => difference >= 0
      ? adjusted[index] > previousWidths[index] : adjusted[index] < previousWidths[index]);
    const recipients = [...preferred, ...order.filter(index => !preferred.includes(index))];
    if (difference >= 0) {
      if (difference && !recipients.length) return null;
      if (recipients.length) adjusted[recipients[0]] += difference;
      return adjusted;
    }
    for (const index of recipients) {
      const released = Math.min(-difference, adjusted[index] - specs[index].min);
      adjusted[index] -= released;
      difference += released;
    }
    return difference < -0.01 ? null : adjusted;
  }

  return Object.freeze({
    WORKSPACE_PANEL_COMPACT_THRESHOLD,
    WORKSPACE_PANEL_COLLAPSE_DISTANCE,
    WORKSPACE_PANEL_REOPEN_DISTANCE,
    getCapsuleNotchPoints,
    snapWorkspacePanelSize,
    fitWorkspaceWidths,
    resizeWorkspacePanels,
    resizeWorkspaceBoundary,
    getWorkspaceResizePreview,
    balanceWorkspaceSpacing
  });
});
