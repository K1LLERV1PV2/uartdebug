"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { create } = require("../public/avr-hardware-flow.js");

function fixture() {
  const animations = [];
  const listeners = new Set();
  const preference = {
    matches: false,
    addEventListener(type, fn) { listeners.add(fn); },
    removeEventListener(type, fn) { listeners.delete(fn); },
  };
  const beam = {
    style: {}, position: -75, opacity: 1,
    animate(frames, options) {
      const animation = {
        frames, options: { ...options }, currentTime: 0, cancelled: false,
        effect: { updateTiming(patch) { Object.assign(animation.options, patch); } },
        cancel() { this.cancelled = true; },
        finish() { this.onfinish?.(); },
      };
      animations.push(animation);
      return animation;
    },
  };
  const light = {
    dataset: {}, querySelector: () => beam,
    getBoundingClientRect: () => ({ left: 20, right: 648, width: 628 }),
    ownerDocument: { defaultView: {
      matchMedia: () => preference,
      getComputedStyle: element => element === beam
        ? { backgroundPositionX: `${beam.position}%`, opacity: String(beam.opacity) }
        : { borderTopRightRadius: "12px", borderBottomRightRadius: "12px" },
    } },
  };
  const stages = Array.from({ length: 4 }, (_, index) => ({ getBoundingClientRect: () => ({
    left: 20 + index * 160, right: 168 + index * 160, width: 148,
  }) }));
  const stage = index => stages[index];
  return { light, beam, animations, preference, stage, flow: create(light),
    changePreference(reduce) { preference.matches = reduce; for (const fn of listeners) fn(); } };
}

test("idle, menu and operation owners share one wave without stopping pending work", () => {
  const f = fixture();
  assert.equal(f.animations.length, 0);
  assert.equal(f.light.dataset.phase, "idle");
  f.flow.setActive("connection", true);
  const pass = f.animations.at(-1);
  assert.equal(pass.options.iterations, Infinity);
  f.flow.setActive("chip-menu", true);
  f.flow.pulse();
  f.flow.setActive("chip-menu", false);
  assert.equal(f.animations.length, 1);
  assert.equal(pass.options.iterations, Infinity, "closing a menu must not stop pending connection work");
  pass.currentTime = 3000;
  f.flow.setActive("connection", false);
  assert.equal(pass.options.iterations, 2, "finish the visible pass rather than cutting it off");
  pass.finish();
  assert.equal(f.light.dataset.phase, "idle");
  assert.equal(f.beam.style.opacity, "0");
});

test("selection pulses once, while a new owner can extend that pass", () => {
  const f = fixture();
  f.flow.pulse();
  const pass = f.animations.at(-1);
  assert.equal(pass.options.iterations, 1);
  f.flow.setActive("package-menu", true);
  assert.equal(f.animations.length, 1);
  assert.equal(pass.options.iterations, Infinity);
  f.flow.setActive("package-menu", false);
  pass.finish();
  assert.equal(f.light.dataset.phase, "idle");
});

test("an early failure preserves the current pass and reaches the failed field's right edge", () => {
  const f = fixture();
  f.flow.setActive("chip-menu", true);
  const pass = f.animations.at(-1);
  const originalFrames = structuredClone(pass.frames);
  const oldFinish = pass.onfinish;
  pass.currentTime = 720;
  f.beam.position = 0;
  f.beam.opacity = 0.35;
  f.flow.fail(f.stage(1));
  assert.equal(f.animations.length, 1, "do not replace the moving wave");
  assert.equal(pass.cancelled, false);
  assert.deepEqual(pass.frames, originalFrames, "retain the original motion and opacity keyframes");
  assert.equal(f.beam.position, 0);
  assert.equal(f.beam.opacity, 0.35);
  assert.equal(f.light.dataset.phase, "approach");
  oldFinish();
  assert.equal(f.light.dataset.phase, "approach", "the old idle callback cannot finish a retargeted same Animation");
  assert.equal(pass.cancelled, false);
  const inset = Number.parseFloat(f.beam.style.clipPath.split(" ")[1]);
  assert.equal(Math.round(648 - 628 * inset / 100), 328,
    "the fault clip ends at the Port field's right edge");
  assert.match(f.beam.style.clipPath, /round 0 12px 12px 0\)$/,
    "the collision must retain the field's rounded right corners");
  const impact = -75 + 250 * pass.options.iterations;
  assert.ok(Math.abs(20 + 628 * (0.62 * impact / 100 + 0.38 * 0.56) - 328) < 1e-9);
  pass.finish();
  const reflection = f.animations.at(-1);
  assert.equal(f.light.dataset.tone, "error");
  assert.equal(f.light.dataset.phase, "reflect");
  assert.ok(Math.abs(Number.parseFloat(reflection.frames[0].backgroundPosition) - impact) < 1e-9);
  assert.equal(reflection.frames[1].backgroundPosition, "-75% 50%");
  reflection.finish();
  assert.equal(f.light.dataset.phase, "idle");
  assert.equal(f.animations.length, 2, "an old open menu must not resume green motion after the error");
});

test("a late failure waits for the current ordinary cycle without cancellation or fading", () => {
  const f = fixture();
  f.flow.setActive("connection", true);
  const pass = f.animations.at(-1);
  const frames = structuredClone(pass.frames);
  pass.currentTime = 2064;
  f.beam.position = 140;
  f.flow.fail(f.stage(1));
  assert.equal(f.animations.length, 1);
  assert.equal(pass.cancelled, false);
  assert.equal(pass.options.iterations, 1);
  assert.deepEqual(pass.frames, frames);
  assert.equal(f.beam.position, 140);
  assert.equal(f.beam.opacity, 1);
  assert.equal(f.beam.style.clipPath, "", "do not cut off the already-passed packet");
  pass.finish();
  const nextPass = f.animations.at(-1);
  assert.equal(f.animations.length, 2);
  assert.deepEqual(nextPass.frames, frames, "the next natural pass keeps the same ordinary trajectory");
  assert.equal(nextPass.options.duration, 2400);
  assert.ok(nextPass.options.iterations > 0 && nextPass.options.iterations < 1);
  nextPass.finish();
  assert.equal(f.light.dataset.phase, "reflect");
});

test("all fields use the same travel speed for the normal, bounded and returning wave", () => {
  for (let index = 0; index < 4; index += 1) {
    const f = fixture();
    f.flow.fail(f.stage(index));
    const incoming = f.animations.at(-1);
    const impact = -75 + 250 * incoming.options.iterations;
    const distance = impact + 75;
    assert.equal(incoming.options.easing, "linear");
    assert.ok(Math.abs(incoming.options.duration * incoming.options.iterations / distance - 9.6) < 1e-9);
    const right = f.stage(index).getBoundingClientRect().right;
    assert.ok(Math.abs(20 + 628 * (0.62 * impact / 100 + 0.38 * 0.56) - right) < 1e-9);
    incoming.finish();
    const outgoing = f.animations.at(-1);
    assert.equal(outgoing.options.easing, "linear");
    assert.ok(Math.abs(outgoing.options.duration / distance - 9.6) < 1e-9);
    outgoing.finish();
    assert.equal(f.light.dataset.phase, "idle");
  }
});

test("duplicate faults do not interrupt queued, approaching or returning waves", () => {
  const f = fixture();
  f.flow.pulse();
  f.beam.position = 140;
  f.flow.fail(f.stage(1));
  const pending = f.animations.at(-1);
  const pendingFinish = pending.onfinish;
  f.flow.fail(f.stage(1));
  assert.equal(f.animations.length, 1);
  assert.equal(pending.onfinish, pendingFinish);
  pending.finish();
  const incoming = f.animations.at(-1);
  f.flow.fail(f.stage(1));
  assert.equal(f.animations.at(-1), incoming);
  assert.equal(incoming.cancelled, false);
  incoming.finish();
  const returning = f.animations.at(-1);
  f.flow.fail(f.stage(1));
  f.flow.fail(f.stage(2));
  f.flow.fail(f.stage(2));
  assert.equal(f.animations.at(-1), returning, "a different fault waits for the visible red return");
  assert.equal(returning.cancelled, false);
  returning.finish();
  assert.equal(f.light.dataset.phase, "approach");
  f.animations.at(-1).finish();
  f.animations.at(-1).finish();
  assert.equal(f.light.dataset.phase, "idle");
});

test("retry cancels reflection and its obsolete finish callback cannot stop the new pass", () => {
  const f = fixture();
  f.flow.fail(f.stage(2));
  f.animations.at(-1).finish();
  const oldReflection = f.animations.at(-1);
  const oldFinish = oldReflection.onfinish;
  f.flow.setActive("connection", true);
  assert.equal(oldReflection.cancelled, true);
  oldFinish();
  assert.equal(f.light.dataset.phase, "forward");
  assert.equal(f.light.dataset.tone, "green");
  assert.equal(f.animations.at(-1).cancelled, false);
});

test("retry replaces a queued late fault and ignores its obsolete completion", () => {
  const f = fixture();
  f.flow.pulse();
  f.beam.position = 140;
  f.flow.fail(f.stage(1));
  const pending = f.animations.at(-1);
  const oldFinish = pending.onfinish;
  f.flow.setActive("connection", true);
  assert.equal(pending.cancelled, true);
  const retry = f.animations.at(-1);
  assert.equal(retry.options.duration, 2400);
  assert.equal(retry.options.iterations, Infinity);
  oldFinish();
  assert.equal(f.light.dataset.phase, "forward");
  assert.equal(f.animations.at(-1), retry);
});

test("an errored menu retains its owner atomically and can resume genuine non-fault activity", () => {
  const f = fixture();
  f.flow.setActive("chip-menu", true, f.stage(1));
  assert.equal(f.animations.length, 1, "do not start a full green pass before handling the existing error");
  assert.ok(f.animations.at(-1).options.iterations < 1);
  f.flow.setActive("chip-menu", true, f.stage(1));
  assert.equal(f.animations.length, 1);
  f.animations.at(-1).finish();
  f.animations.at(-1).finish();
  f.flow.setActive("chip-menu", true);
  const pass = f.animations.at(-1);
  assert.equal(f.light.dataset.phase, "forward", "the same recorded owner can start genuine cleared-fault activity");
  f.flow.setActive("connection", true);
  f.flow.setActive("connection", false);
  assert.equal(pass.options.iterations, Infinity, "the still-open menu survives the retry's completion");
  f.flow.setActive("chip-menu", false);
  assert.equal(pass.options.iterations, 1);
  pass.finish();
  assert.equal(f.light.dataset.phase, "idle");
});

test("reduced motion cancels the wave and restores only currently active work", () => {
  const f = fixture();
  f.changePreference(true);
  f.flow.setActive("connection", true);
  assert.equal(f.animations.length, 0);
  f.changePreference(false);
  assert.equal(f.animations.length, 1);
  f.changePreference(true);
  assert.equal(f.animations.at(-1).cancelled, true);
  assert.equal(f.light.dataset.phase, "idle");
  f.flow.setActive("connection", false);
  f.changePreference(false);
  assert.equal(f.animations.length, 1);
  f.flow.destroy();
  f.flow.pulse();
  assert.equal(f.animations.length, 1);
});
