const CACHE_NAME = "uartdebug-shell-v3";
const APP_SHELL_ASSETS = [
  "/",
  "/index.html",
  "/terminal.html",
  "/terminal/",
  "/AVR-Programming.html",
  "/AVR-Programming/",
  "/uart/",
  "/manifest.webmanifest",
  "/uart.css",
  "/uart.js",
  "/AVR-Programming.css",
  "/AVR-Programming.js",
  "/updi-test.js",
  "/updi-test.css",
  "/vendor/chart.umd.js",
  "/favicon.ico",
  "/icons/favicon-192.png",
  "/icons/logo-512.png",
  "/icons/apple-touch-icon.png",
];

const APP_SHELL_PATHS = new Set(APP_SHELL_ASSETS);
const LEGACY_PATHS = new Set([
  "/index_old.html",
  "/c-canvas.html",
  "/c-canvas.js",
  "/c-canvas.css",
  "/updi-test.html",
  "/updi-test.js",
  "/updi-test.css",
]);

const CACHEABLE_DESTINATIONS = new Set(["style", "script", "image", "font"]);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith("uartdebug-shell-") && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/api/")) return;
  if (LEGACY_PATHS.has(url.pathname)) return;

  if (request.mode === "navigate") {
    event.respondWith(handleNavigationRequest(request));
    return;
  }

  const shouldUseShellCache =
    APP_SHELL_PATHS.has(url.pathname) &&
    CACHEABLE_DESTINATIONS.has(request.destination);

  if (shouldUseShellCache && shouldUseNetworkFirstForAsset(request)) {
    event.respondWith(networkFirstWithCacheFallback(request));
    return;
  }

  if (shouldUseShellCache) {
    event.respondWith(cacheFirstWithBackgroundUpdate(event, request));
  }
});

function shouldUseNetworkFirstForAsset(request) {
  return request.destination === "style" || request.destination === "script";
}

async function handleNavigationRequest(request) {
  const cache = await caches.open(CACHE_NAME);
  const url = new URL(request.url);
  const cacheKey = APP_SHELL_PATHS.has(url.pathname) ? url.pathname : "/index.html";

  try {
    const freshResponse = await fetch(request);
    if (freshResponse && freshResponse.ok && APP_SHELL_PATHS.has(url.pathname)) {
      cache.put(cacheKey, freshResponse.clone());
    }
    return freshResponse;
  } catch (error) {
    const cachedPage = (await cache.match(cacheKey)) || (await cache.match("/index.html"));
    if (cachedPage) return cachedPage;

    return new Response("Offline", {
      status: 503,
      statusText: "Offline",
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}

async function cacheFirstWithBackgroundUpdate(event, request) {
  const cache = await caches.open(CACHE_NAME);
  const cachedResponse = await cache.match(request);

  if (cachedResponse) {
    event.waitUntil(updateCachedAsset(cache, request));
    return cachedResponse;
  }

  const networkResponse = await fetch(request);
  if (networkResponse && networkResponse.ok) {
    cache.put(request, networkResponse.clone());
  }
  return networkResponse;
}

async function networkFirstWithCacheFallback(request) {
  const cache = await caches.open(CACHE_NAME);

  try {
    const freshResponse = await fetch(request);
    if (freshResponse && freshResponse.ok) {
      await cache.put(request, freshResponse.clone());
    }
    return freshResponse;
  } catch (error) {
    const cachedResponse = await cache.match(request);
    if (cachedResponse) return cachedResponse;
    throw error;
  }
}

async function updateCachedAsset(cache, request) {
  try {
    const freshResponse = await fetch(request);
    if (freshResponse && freshResponse.ok) {
      await cache.put(request, freshResponse.clone());
    }
  } catch (error) {
    // Keep serving last cached version when update fails.
  }
}
