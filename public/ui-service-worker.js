"use strict";

(() => {
  if (!("serviceWorker" in navigator)) return;

  let registration;
  let checking = false;

  async function checkForUpdate() {
    if (checking) return;
    checking = true;
    try {
      // Use one stable registration on every entry page, including direct AVR visits.
      registration = registration || await navigator.serviceWorker.register("/sw.js", {
        updateViaCache: "none",
      });
      await registration.update();
    } catch (_) {
      // Offline visits keep the installed shell. Never reload an active project.
    } finally {
      checking = false;
    }
  }

  if (document.readyState === "complete") checkForUpdate();
  else window.addEventListener("load", checkForUpdate, { once: true });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") checkForUpdate();
  });
})();
