/* TimeX kiosk service worker.
 *
 * Goal: the backup web kiosk must open with no signal. The app shell for
 * /kiosk and /adjustments is cached on install and refreshed on every online
 * visit (network first, cache fallback). Scripts, styles, images and fonts are
 * cached as they load (stale-while-revalidate), so a release is picked up on
 * the next online visit and the previous build keeps working offline until then.
 *
 * Nothing else is intercepted: the office portal, server functions and API
 * routes always go straight to the network.
 */

const VERSION = "timex-kiosk-v1";
const SHELL_CACHE = `${VERSION}-shell`;
const ASSET_CACHE = `${VERSION}-assets`;
const SHELL_PATHS = ["/kiosk", "/adjustments"];
const NETWORK_TIMEOUT_MS = 4000;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      await Promise.allSettled(
        SHELL_PATHS.map((path) => cache.add(new Request(path, { cache: "reload" }))),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;

  if (request.mode === "navigate") {
    if (sameOrigin && SHELL_PATHS.includes(url.pathname)) {
      event.respondWith(networkFirstShell(request, url.pathname));
    }
    return;
  }

  const isFont = url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";
  const isAsset =
    sameOrigin &&
    (request.destination === "script" ||
      request.destination === "style" ||
      request.destination === "image" ||
      request.destination === "font" ||
      request.destination === "manifest" ||
      url.pathname.startsWith("/assets/") ||
      url.pathname.startsWith("/icons/") ||
      url.pathname.startsWith("/__l5e/"));
  if (isFont || isAsset) {
    event.respondWith(staleWhileRevalidate(request));
  }
});

async function networkFirstShell(request, pathname) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetchWithTimeout(request);
    if (response && response.ok) {
      await cache.put(pathname, response.clone());
      return response;
    }
    const cached = await cache.match(pathname);
    return cached || response;
  } catch {
    const cached = (await cache.match(pathname)) || (await cache.match("/kiosk"));
    if (cached) return cached;
    return new Response(offlinePage(), {
      status: 503,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(ASSET_CACHE);
  const cached = await cache.match(request);
  const refresh = fetch(request)
    .then((response) => {
      if (response && (response.ok || response.type === "opaque")) {
        cache.put(request, response.clone()).catch(() => {});
      }
      return response;
    })
    .catch(() => null);
  if (cached) {
    refresh.catch(() => {});
    return cached;
  }
  const fresh = await refresh;
  return fresh || new Response("", { status: 504 });
}

function fetchWithTimeout(request) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), NETWORK_TIMEOUT_MS);
    fetch(request).then(
      (response) => {
        clearTimeout(timer);
        resolve(response);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function offlinePage() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>TimeX kiosk — offline</title>
<style>body{font:16px/1.5 system-ui,sans-serif;background:#1c232b;color:#fff;display:grid;place-items:center;min-height:100vh;margin:0;padding:24px;text-align:center}
p{color:#c7cdd4;max-width:26rem}button{margin-top:16px;padding:12px 20px;border-radius:12px;border:0;background:#f0b323;color:#1c232b;font-weight:700;font-size:16px}</style></head>
<body><div><h1>No signal</h1><p>The kiosk has not been opened on this device while online yet, so it cannot start offline. Connect once, open the kiosk, and it will work offline from then on.</p>
<button onclick="location.reload()">Try again</button></div></body></html>`;
}
