const CACHE_NAME = "uartdebug-shell-v1";
const APP_SHELL_ASSETS = [
  "/",
  "/index.html",
  "/uart.css",
  "/uart.js",
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
]);

const CACHEABLE_DESTINATIONS = new Set(["style", "script", "image", "font"]);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL_ASSETS))
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
    )
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

  if (shouldUseShellCache) {
    event.respondWith(cacheFirstWithBackgroundUpdate(event, request));
  }
});

async function handleNavigationRequest(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const freshResponse = await fetch(request);
    if (freshResponse && freshResponse.ok) {
      cache.put("/index.html", freshResponse.clone());
    }
    return freshResponse;
  } catch (error) {
    const cachedPage =
      (await cache.match(request)) || (await cache.match("/index.html"));
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
