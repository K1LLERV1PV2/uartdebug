"use strict";

function eventSurface() {
  const listeners = new Map(), classes = new Set(), attributes = new Map();
  const surface = {
    listeners, classes, attributes, dataset: {}, style: { setProperty() {} },
    focusCount: 0,
    focus() { surface.focusCount += 1; },
    addEventListener(type, callback) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(callback);
    },
    removeEventListener(type, callback) {
      listeners.get(type)?.delete(callback);
      if (!listeners.get(type)?.size) listeners.delete(type);
    },
    emit(type, detail = {}) {
      const event = { type, defaultPrevented: false, ...detail,
        preventDefault() { this.defaultPrevented = true; } };
      for (const callback of [...(listeners.get(type) || [])]) callback(event);
      return event;
    },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    classList: {
      add: (...names) => names.forEach(name => classes.add(name)),
      remove: (...names) => names.forEach(name => classes.delete(name)),
    },
  };
  return surface;
}

function resizeEnvironment() {
  const document = eventSurface(), window = eventSurface();
  document.body = eventSurface();
  document.querySelectorAll = () => [];
  const handle = eventSurface(), captured = new Set(), released = [];
  handle.setPointerCapture = id => captured.add(id);
  handle.hasPointerCapture = id => captured.has(id);
  handle.releasePointerCapture = id => { captured.delete(id); released.push(id); };
  const pointer = (pointerId, clientX, detail = {}) => ({
    pointerId, clientX, clientY: clientX, button: 0, isPrimary: true, ...detail,
  });
  return { document, window, handle, captured, released, pointer };
}

module.exports = { eventSurface, resizeEnvironment };
