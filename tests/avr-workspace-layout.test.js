"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const layout = require("../public/avr-workspace-layout.js");

const workspacePanelSpecs = [
  { min: 180, compact: 62 },
  { min: 238, compact: 62 },
  { min: 500, compact: 62 },
  { min: 267, compact: 62 },
];

test("the capsule divider keeps the vertical clearance through the entire bend", () => {
  const width = 34, depth = 44, distance = 15;
  const points = layout.getCapsuleNotchPoints(width, depth, distance);
  // Sample the original cubic independently. The returned notch is expressed
  // relative to the next pane, whose vertical edge is distance pixels away.
  const original = Array.from({ length: 4001 }, (_, index) => {
    const t = index / 4000, u = 1 - t;
    return {
      x: width * (u * u * u + 3 * u * u * t),
      y: 3 * u * u * t * depth / 2 + 3 * u * t * t * depth / 2 + t * t * t * depth,
    };
  });
  assert.deepEqual(points[0], { x: width, y: 0 });
  assert.deepEqual(points.at(-1), { x: 0, y: depth });
  for (const [index, point] of points.entries()) {
    const clearance = Math.min(...original.map(other => Math.hypot(
      point.x + distance - other.x, point.y - other.y
    )));
    assert.ok(Math.abs(clearance - distance) < 0.01, `clearance changed at point ${index}`);
    if (index) {
      assert.ok(point.x <= points[index - 1].x, "the notch must never fold back on itself");
      assert.ok(point.y >= points[index - 1].y, "the notch must join the vertical edges smoothly");
    }
  }
});

test("initial PC viewport fitting keeps chat visible before secondary documents", () => {
  const specs = [62, 28, 62, 62].map(compact => ({ min: 240, compact }));
  const preferred = [305, 318, 500, 360];
  const widths = Array.from(layout.fitWorkspaceWidths(preferred, 946, specs));
  assert.deepEqual(widths, [240, 240, 404, 62],
    "a 1024px PC window must compact the guide before hiding the conversation");
  assert.equal(widths.reduce((sum, width) => sum + width, 0), 946);

  const narrower = Array.from(layout.fitWorkspaceWidths(preferred, 760, specs));
  assert.deepEqual(narrower, [240, 28, 430, 62],
    "the specification compacts next while chat and code remain usable");
  assert.deepEqual(preferred, [305, 318, 500, 360], "fitting must not mutate saved preferences");
});

test("automatic fit retains explicitly closed panes while an expanded pane can absorb space", () => {
  const specs = [62, 28, 62, 62].map(compact => ({ min: 240, compact }));
  for (const closed of [0, 1, 2, 3]) {
    const preferred = [305, 318, 500, 360];
    preferred[closed] = specs[closed].compact;
    for (const budget of [946, 1400]) {
      const widths = Array.from(layout.fitWorkspaceWidths(preferred, budget, specs));
      assert.equal(widths[closed], specs[closed].compact, `saved pane ${closed} must remain closed at ${budget}px`);
      assert.equal(widths.reduce((sum, width) => sum + width, 0), budget);
      widths.forEach((width, index) => assert.ok(width === specs[index].compact || width >= specs[index].min));
    }
  }
});

test("every boundary can collapse and restore the panel on either side", () => {
  const { resizeWorkspaceBoundary } = layout;
  const start = [305, 618, 839, 660];
  for (const boundary of [0, 1, 2]) {
    for (const index of [boundary, boundary + 1]) {
      const sign = index === boundary ? -1 : 1;
      const closed = Array.from(resizeWorkspaceBoundary(start, workspacePanelSpecs, boundary, sign * (start[index] - workspacePanelSpecs[index].min + 120)));
      assert.equal(closed[index], 62, `boundary ${boundary} must close panel ${index}`);
      for (const restoreBoundary of [index - 1, index].filter(value => value >= 0 && value < 3)) {
        const restored = Array.from(resizeWorkspaceBoundary(closed, workspacePanelSpecs, restoreBoundary,
          (restoreBoundary === index ? 1 : -1) * workspacePanelSpecs[index].min));
        assert.ok(restored[index] >= workspacePanelSpecs[index].min, `boundary ${restoreBoundary} must reopen panel ${index}`);
        assert.equal(restored.reduce((sum, width) => sum + width, 0), start.reduce((sum, width) => sum + width, 0));
      }
    }
  }
});

test("boundary previews hold the toolbar minimum for 120px before collapse", () => {
  const { resizeWorkspaceBoundary, getWorkspaceResizePreview } = layout;
  const start = [305, 618, 839, 660];
  for (const boundary of [0, 1, 2]) {
    for (const index of [boundary, boundary + 1]) {
      const direction = index === boundary ? -1 : 1;
      const toMinimum = start[index] - workspacePanelSpecs[index].min;
      assert.equal(getWorkspaceResizePreview(start, workspacePanelSpecs, boundary, direction * (toMinimum - 1)), null);
      for (const overtravel of [0, 48, 96, 119]) {
        const delta = direction * (toMinimum + overtravel);
        const preview = getWorkspaceResizePreview(start, workspacePanelSpecs, boundary, delta);
        assert.equal(preview.index, index);
        assert.equal(preview.direction, direction);
        assert.equal(resizeWorkspaceBoundary(start, workspacePanelSpecs, boundary, delta)[index], workspacePanelSpecs[index].min);
      }
      const delta = direction * (toMinimum + 120);
      const collapsed = resizeWorkspaceBoundary(start, workspacePanelSpecs, boundary, delta);
      assert.equal(collapsed[index], 62);
      assert.equal(getWorkspaceResizePreview(start, workspacePanelSpecs, boundary, delta), null);
      assert.equal(resizeWorkspaceBoundary(collapsed, workspacePanelSpecs, boundary, -direction * 1)[index], 62);
      assert.ok(resizeWorkspaceBoundary(collapsed, workspacePanelSpecs, boundary, -direction * 48)[index] >= workspacePanelSpecs[index].min);
    }
  }
});

test("compact panes reopen at 48px without playing a collapse cue", () => {
  const { resizeWorkspaceBoundary, getWorkspaceResizePreview } = layout;
  for (const boundary of [0, 1, 2]) {
    for (const index of [boundary, boundary + 1]) {
      const start = [305, 618, 839, 660];
      const neighbor = index === boundary ? boundary + 1 : boundary;
      start[neighbor] += start[index] - 62;
      start[index] = 62;
      const direction = index === boundary ? 1 : -1;
      assert.equal(getWorkspaceResizePreview(start, workspacePanelSpecs, boundary, 0), null);
      for (const amount of [1, 24, 47]) {
        assert.equal(getWorkspaceResizePreview(start, workspacePanelSpecs, boundary, direction * amount), null);
        assert.equal(resizeWorkspaceBoundary(start, workspacePanelSpecs, boundary, direction * amount)[index], 62);
      }
      assert.equal(getWorkspaceResizePreview(start, workspacePanelSpecs, boundary, -direction), null);
      assert.equal(getWorkspaceResizePreview(start, workspacePanelSpecs, boundary, direction * 48), null);
      assert.ok(resizeWorkspaceBoundary(start, workspacePanelSpecs, boundary, direction * 48)[index] >= workspacePanelSpecs[index].min);
    }
  }
  assert.equal(getWorkspaceResizePreview([62, 62, 62, 62], workspacePanelSpecs, 1, 24), null,
    "a pane without enough space to reopen must not invite an impossible gesture");
});

test("a narrow workspace reopens at the same 48px intent threshold by closing its adjacent pane", () => {
  const { resizeWorkspaceBoundary, getWorkspaceResizePreview } = layout;
  const specs = [240, 240, 240, 262].map(min => ({ min, compact: 62 }));
  const start = [62, 240, 354, 262];
  for (const delta of [1, 24, 47]) {
    const current = resizeWorkspaceBoundary(start, specs, 0, delta);
    assert.equal(current[0], 62);
    assert.equal(getWorkspaceResizePreview(start, specs, 0, delta), null);
  }
  const reopened = resizeWorkspaceBoundary(start, specs, 0, 48);
  assert.ok(reopened[0] >= specs[0].min);
  assert.equal(reopened[1], 62);
  assert.equal(getWorkspaceResizePreview(start, specs, 0, 48), null);
  assert.equal(getWorkspaceResizePreview(start, specs, 0, -24), null);
  const roomy = [62, 600, 500, 400];
  assert.equal(getWorkspaceResizePreview(roomy, specs, 0, 48), null,
    "compact panes do not animate even when the first reopening threshold cannot fit");
});

test("either side of every boundary can reopen at 48px without closing unrelated panes", () => {
  const { resizeWorkspaceBoundary } = layout;
  const specs = [240, 240, 240, 262].map(min => ({ min, compact: 62 }));
  for (const boundary of [0, 1, 2]) {
    for (const growing of [boundary, boundary + 1]) {
      const shrinking = growing === boundary ? boundary + 1 : boundary;
      const direction = growing === boundary ? 1 : -1;
      const start = specs.map(spec => spec.min);
      start[growing] = 62;
      start[shrinking] = Math.max(specs[growing].min, specs[shrinking].min);
      assert.deepEqual(Array.from(resizeWorkspaceBoundary(start, specs, boundary, direction * 47)), start);
      const reopened = Array.from(resizeWorkspaceBoundary(start, specs, boundary, direction * 48));
      assert.ok(reopened[growing] >= specs[growing].min);
      assert.equal(reopened[shrinking], 62);
      assert.equal(reopened.reduce((sum, width) => sum + width, 0), start.reduce((sum, width) => sum + width, 0));
      for (const index of [0, 1, 2, 3]) {
        if (index !== growing && index !== shrinking) assert.equal(reopened[index], start[index]);
      }
    }
  }
  assert.deepEqual(Array.from(resizeWorkspaceBoundary([62, 62, 240, 62], specs, 0, 48)),
    [62, 62, 240, 62], "a farther expanded pane must not be closed to force a reopen");
});

test("boundary drags conserve width and never collapse an unrelated pane", () => {
  const { resizeWorkspaceBoundary, fitWorkspaceWidths } = layout;
  for (const budget of [686, 1000, 1522, 2400]) {
    for (const preferred of [[305, 318, 500, 360], [62, 62, 500, 62], [305, 700, 62, 360], [62, 62, 62, 62]]) {
      const start = fitWorkspaceWidths(preferred, budget, workspacePanelSpecs);
      for (const boundary of [0, 1, 2]) {
        for (let delta = -budget; delta <= budget; delta += 31) {
          const sizes = Array.from(resizeWorkspaceBoundary(start, workspacePanelSpecs, boundary, delta));
          assert.equal(sizes.reduce((sum, size) => sum + size, 0), budget);
          sizes.forEach((size, index) => {
            assert.ok(size === 62 || size >= workspacePanelSpecs[index].min, `invalid ${sizes}`);
            if (index !== boundary && index !== boundary + 1) {
              assert.equal(size === 62, start[index] === 62, "a different pane must retain its open/closed state");
            }
          });
        }
      }
    }
  }
});

test("reopening a wide toolbar borrows from its adjacent expanded pane first", () => {
  const { resizeWorkspaceBoundary } = layout;
  const specs = workspacePanelSpecs.map((spec, index) => ({ ...spec, min: index === 2 ? 700 : spec.min }));
  const start = [62, 1115, 62, 62];
  assert.deepEqual(Array.from(resizeWorkspaceBoundary(start, specs, 1, -47)), start);
  assert.deepEqual(Array.from(resizeWorkspaceBoundary(start, specs, 1, -48)), [62, 477, 700, 62]);
});

test("resizes only the adjacent pair and stops at its minimum widths", () => {
  const { resizeWorkspacePanels } = layout;
  const start = [305, 318, 539, 360];
  const resize = (index, width) => Array.from(resizeWorkspacePanels(start, workspacePanelSpecs, index, width));
  assert.deepEqual(resize(0, 285), [285, 338, 539, 360]);
  assert.deepEqual(resize(0, 405), [385, 238, 539, 360]);
  assert.deepEqual(resize(0, 455), [385, 238, 539, 360]);
  assert.deepEqual(resize(1, 418), [305, 357, 500, 360]);
  assert.deepEqual(resize(3, 460), [305, 318, 500, 399]);
  assert.deepEqual(start, [305, 318, 539, 360], "drag snapshots must remain immutable");
});

test("all side columns snap without intermediate invalid widths and reopen", () => {
  const { resizeWorkspacePanels } = layout;
  const start = [305, 318, 539, 360];
  for (const index of [0, 1, 2, 3]) {
    assert.equal(resizeWorkspacePanels(start, workspacePanelSpecs, index, 113)[index], workspacePanelSpecs[index].min);
    const collapsed = resizeWorkspacePanels(start, workspacePanelSpecs, index, 112);
    assert.equal(collapsed[index], 62);
    const restored = resizeWorkspacePanels(collapsed, workspacePanelSpecs, index, workspacePanelSpecs[index].min);
    assert.equal(restored[index], workspacePanelSpecs[index].min);
  }
});

test("a collapsed editor does not prevent collapsing or restoring the neighboring guide", () => {
  const { resizeWorkspacePanels } = layout;
  const start = [305, 700, 62, 360];
  const collapsed = Array.from(resizeWorkspacePanels(start, workspacePanelSpecs, 3, 62));
  assert.deepEqual(collapsed, [305, 998, 62, 62]);
  assert.equal(collapsed.reduce((a, b) => a + b), start.reduce((a, b) => a + b));
  // The shared fit used by the restore action can reopen the editor after both close.
  assert.deepEqual(Array.from(resizeWorkspacePanels(collapsed, workspacePanelSpecs, 2, 500)), [305, 560, 500, 62]);
  assert.deepEqual(Array.from(resizeWorkspacePanels(collapsed, workspacePanelSpecs, 3, 267)), [305, 793, 62, 267]);
});

test("workspace resizing conserves space and minima across viewport and drag extremes", () => {
  const { resizeWorkspacePanels, fitWorkspaceWidths } = layout;
  const valid = (widths, budget) => {
    assert.equal(widths.reduce((sum, width) => sum + width, 0), budget);
    widths.forEach((width, i) => assert.ok(
      Number.isFinite(width) && (width === workspacePanelSpecs[i].compact || width >= workspacePanelSpecs[i].min),
      `panel ${i}: invalid ${width} in ${widths}`
    ));
  };
  for (const budget of [686, 964, 1000, 1202, 1522, 2200]) {
    for (const preferred of [[305, 318, 500, 360], [62, 62, 500, 62], [1600, 900, 500, 1500], [305, 700, 62, 360], [62, 62, 62, 62]]) {
      const start = fitWorkspaceWidths(preferred, budget, workspacePanelSpecs);
      valid(start, budget);
      for (const index of [0, 1, 2, 3]) {
        let previous = 0;
        for (let requested = -100; requested <= budget + 400; requested += 7) {
          const widths = resizeWorkspacePanels(start, workspacePanelSpecs, index, requested);
          valid(widths, budget);
          for (let i = 0; i < widths.length; i++) {
            const neighbor = index === 0 || index === 2 ? 1 : 2;
            if (i !== index && i !== neighbor && start[neighbor] !== workspacePanelSpecs[neighbor].compact) {
              assert.equal(widths[i], start[i], "a divider must not resize unrelated panels");
            }
          }
          assert.ok(widths[index] >= previous, "one-way dragging must never reverse the resized panel");
          previous = widths[index];
        }
      }
    }
  }
});
