// SplitMate service worker (SPEC §16). Deliberately minimal:
// - caches only static, content-hashed build assets and icons (cache first);
// - shows a static offline page when a page can't be loaded;
// - never caches pages, Server Action or API responses, or anything with user
//   or financial data. Non-GET requests and other origins are not touched.
// Bump VERSION when the precached files change.

const VERSION = "v1";
const STATIC_CACHE = `splitmate-static-${VERSION}`;
const OFFLINE_URL = "/offline.html";
const PRECACHE = [OFFLINE_URL, "/icons/icon-192.png", "/icons/logo.svg"];

/** Files that are safe to keep: build output with hashed names, and icons. */
function isStaticAsset(url) {
  if (url.origin !== self.location.origin || url.search !== "") return false;
  return url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/");
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== STATIC_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok && response.type === "basic") {
    const cache = await caches.open(STATIC_CACHE);
    await cache.put(request, response.clone());
  }
  return response;
}

async function pageOrOffline(request) {
  try {
    // Straight to the network: pages are never stored.
    return await fetch(request);
  } catch {
    return (await caches.match(OFFLINE_URL)) ?? Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === "navigate") {
    event.respondWith(pageOrOffline(request));
    return;
  }
  if (isStaticAsset(url)) event.respondWith(cacheFirst(request));
  // Everything else (RSC payloads, route handlers, Server Actions) goes to the
  // network as if there were no service worker.
});
