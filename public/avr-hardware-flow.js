(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.UartDebugHardwareFlow = api;
})(typeof globalThis === "object" ? globalThis : this, function () {
  "use strict";

  const START = -75, END = 175, PASS_MS = 2400;
  const MS_PER_POSITION = PASS_MS / (END - START);
  const position = value => `${value}% 50%`;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  function create(light) {
    const beam = light?.querySelector(".hardware-flow-beam");
    const view = light?.ownerDocument?.defaultView || globalThis;
    const preference = view.matchMedia?.("(prefers-reduced-motion: reduce)");
    const owners = new Set();
    let animation = null, blocked = false, destroyed = false;
    let fault = null, nextFault = null;
    const permitted = () => beam && typeof beam.animate === "function" && !preference?.matches && !destroyed;

    function cancel() {
      if (!animation) return;
      animation.onfinish = null;
      animation.cancel();
      animation = null;
    }

    function idle() {
      cancel();
      fault = nextFault = null;
      if (!beam) return;
      beam.style.opacity = "0";
      beam.style.backgroundPosition = position(START);
      beam.style.clipPath = "";
      light.dataset.phase = "idle";
      light.dataset.tone = "green";
    }

    function finishWith(current, done) {
      const handler = () => {
        if (animation !== current || current.onfinish !== handler || destroyed) return;
        animation = null;
        current.onfinish = null;
        current.cancel();
        done();
      };
      current.onfinish = handler;
    }

    function run(frames, duration, done, iterations = 1) {
      cancel();
      const current = beam.animate(frames, {
        duration, iterations, easing: "linear", fill: "both",
      });
      animation = current;
      finishWith(current, done);
    }

    function passFrames() {
      return [
        { backgroundPosition: position(START), opacity: 1 },
        { backgroundPosition: position(END), opacity: 1 },
      ];
    }

    function forward() {
      if (!permitted()) return;
      light.dataset.phase = "forward";
      light.dataset.tone = "green";
      beam.style.clipPath = "";
      fault = nextFault = null;
      run(passFrames(), PASS_MS, idle, owners.size ? Infinity : 1);
    }

    function finishPass() {
      if (!animation || light.dataset.phase !== "forward") return;
      const iteration = Math.floor(Number(animation.currentTime || 0) / PASS_MS);
      animation.effect.updateTiming({ iterations: iteration + 1 });
    }

    function setActive(owner, active, failure = null) {
      if (destroyed) return;
      if (!active) {
        owners.delete(owner);
        if (!owners.size && !blocked) finishPass();
        return;
      }
      if (failure) {
        owners.add(owner);
        fail(failure);
        return;
      }
      if (owners.has(owner) && !blocked) return;
      owners.add(owner);
      blocked = false;
      if (animation && light.dataset.phase === "forward") {
        animation.effect.updateTiming({ iterations: Infinity });
      } else forward();
    }

    function pulse() {
      if (destroyed) return;
      blocked = false;
      if (animation && light.dataset.phase === "forward") return;
      forward();
    }

    function collision(field) {
      const bounds = light.getBoundingClientRect();
      const frame = field.getBoundingClientRect();
      const shape = view.getComputedStyle(field);
      const topRight = shape.borderTopRightRadius || "0px";
      const bottomRight = shape.borderBottomRightRadius || topRight;
      const right = clamp((frame.right - bounds.left) / (bounds.width || 1), 0, 1);
      // CSS uses a 38%-wide band whose brightest point is 56% across it.
      const impact = clamp(100 * (right - 0.38 * 0.56) / (1 - 0.38), START, END);
      return { right, impact, progress: (impact - START) / (END - START),
        clip: `inset(0 ${100 * (1 - right)}% 0 0 round 0 ${topRight} ${bottomRight} 0)` };
    }

    function reflect(contact) {
      light.dataset.phase = "reflect";
      light.dataset.tone = "error";
      run([
        { backgroundPosition: position(contact.impact), opacity: 1 },
        { backgroundPosition: position(START), opacity: 1 },
      ], (contact.impact - START) * MS_PER_POSITION, () => {
        if (!nextFault) { idle(); return; }
        fault = nextFault;
        nextFault = null;
        boundedPass(fault);
      });
    }

    function boundedPass(field) {
      const contact = collision(field);
      light.dataset.phase = "approach";
      light.dataset.tone = "green";
      beam.style.clipPath = contact.clip;
      run(passFrames(), PASS_MS, () => reflect(contact), contact.progress);
    }

    function fail(field) {
      if (destroyed) return;
      blocked = true;
      if (!permitted() || !field) { idle(); return; }
      if (fault === field || nextFault === field) return;
      if (fault) {
        // A second fault must not interrupt the existing collision or return.
        nextFault = field;
        return;
      }
      fault = field;
      const current = animation;
      if (!current || current.playState === "finished") { boundedPass(field); return; }
      const contact = collision(field);
      const sampled = Number.parseFloat(view.getComputedStyle(beam).backgroundPositionX);
      const from = Number.isFinite(sampled) ? sampled : START;
      const iteration = Math.floor(Number(current.currentTime || 0) / PASS_MS);
      light.dataset.phase = "approach";
      if ((1 - 0.38) * from / 100 + 0.38 <= contact.right) {
        beam.style.clipPath = contact.clip;
        current.effect.updateTiming({ iterations: iteration + contact.progress });
        finishWith(current, () => reflect(contact));
      } else {
        // This packet has passed the wall. Finish its ordinary cycle; the next
        // natural pass can hit the wall without cutting off visible light.
        current.effect.updateTiming({ iterations: iteration + 1 });
        finishWith(current, () => boundedPass(field));
      }
    }

    function onPreferenceChange() {
      idle();
      if (owners.size && !blocked) forward();
    }
    preference?.addEventListener?.("change", onPreferenceChange);
    idle();

    return Object.freeze({
      setActive, pulse, fail,
      destroy() {
        destroyed = true;
        owners.clear();
        idle();
        preference?.removeEventListener?.("change", onPreferenceChange);
      },
    });
  }

  return Object.freeze({ create });
});
