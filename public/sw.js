/* Bump this version when changing the offline cache format or worker behavior. */
const CACHE_PREFIX = "doing-nothing-timer-";
const CACHE_NAME = `${CACHE_PREFIX}v1`;
const ROOT_URL = new URL("/", self.location.origin).href;
const CORE_ASSETS = [
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/maskable-512.png",
];

function isBuildAsset(url) {
  return (
    url.origin === self.location.origin &&
    url.pathname.startsWith("/_next/static/") &&
    /\.(?:js|css|woff2?|ttf|otf|png|jpe?g|webp|avif|svg|ico)$/i.test(url.pathname)
  );
}

function isCoreAsset(url) {
  return url.origin === self.location.origin && CORE_ASSETS.includes(url.pathname) && !url.search;
}

function isFullDocument(response) {
  return (
    response.ok &&
    !response.redirected &&
    response.headers.get("content-type")?.includes("text/html")
  );
}

function isRscRequest(request, url) {
  return (
    url.searchParams.has("_rsc") ||
    request.headers.has("rsc") ||
    request.headers.has("next-router-state-tree") ||
    request.headers.has("next-router-prefetch") ||
    request.headers.has("next-router-segment-prefetch") ||
    request.headers.get("accept")?.includes("text/x-component")
  );
}

function htmlBuildAssets(html) {
  const assets = new Set();
  for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
    const url = new URL(match[1].replaceAll("&amp;", "&"), ROOT_URL);
    if (isBuildAsset(url)) assets.add(url.href);
  }
  return assets;
}

async function cacheAsset(cache, assetUrl, seen) {
  const url = new URL(assetUrl, ROOT_URL);
  if ((!isBuildAsset(url) && !isCoreAsset(url)) || seen.has(url.href)) return;
  seen.add(url.href);

  const response = await fetch(url.href, {
    cache: "no-cache",
    credentials: "same-origin",
    redirect: "error",
  });
  if (!response.ok || response.type === "opaque") {
    throw new Error("An offline asset could not be cached.");
  }

  // Include CSS-referenced fonts even when they were not preloaded in the HTML.
  if (url.pathname.endsWith(".css")) {
    const css = await response.clone().text();
    const dependencies = [];
    for (const match of css.matchAll(/url\(\s*["']?([^"')\s]+)["']?\s*\)/g)) {
      const dependency = new URL(match[1], url);
      if (isBuildAsset(dependency)) {
        dependencies.push(cacheAsset(cache, dependency.href, seen));
      }
    }
    await Promise.all(dependencies);
  }

  await cache.put(url.href, response);
}

async function cacheDocument(response) {
  if (!isFullDocument(response)) return;
  const html = await response.clone().text();
  const buildAssets = htmlBuildAssets(html);
  // Do not replace a usable app shell with an error page or a non-hydratable page.
  if (![...buildAssets].some((asset) => new URL(asset).pathname.endsWith(".js"))) {
    throw new Error("The app shell did not include its JavaScript assets.");
  }

  const cache = await caches.open(CACHE_NAME);
  const seen = new Set();
  await Promise.all(
    [...CORE_ASSETS, ...buildAssets].map((asset) => cacheAsset(cache, asset, seen)),
  );
  // Publish HTML last: a partially fetched update must not break offline startup.
  await cache.put(ROOT_URL, response);
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      // A page's first JS/CSS requests may precede SW control. Fetching the full
      // HTML and its build assets here makes that very first visit offline-ready.
      const response = await fetch(ROOT_URL, {
        cache: "no-store",
        credentials: "same-origin",
        redirect: "error",
        headers: { Accept: "text/html" },
      });
      if (!isFullDocument(response)) throw new Error("The app shell is unavailable.");
      await cacheDocument(response);
    })(),
  );
  // No skipWaiting: an update must not take over while an existing timer is open.
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
          .map((name) => caches.delete(name)),
      );
    })(),
  );
  // No clients.claim or forced navigation. New tabs use this worker naturally.
});

async function navigate(event) {
  try {
    const response = await fetch(event.request);
    if (isFullDocument(response)) {
      if (!new URL(event.request.url).search) {
        event.waitUntil(cacheDocument(response.clone()).catch(() => {}));
      }
      return response;
    }
    if (response.status < 500) return response;
    return (await offlineDocument()) || response;
  } catch {
    const cached = await offlineDocument();
    if (cached) return cached;
    return new Response("オフラインです。接続後にもう一度開いてください。", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}

async function offlineDocument() {
  try {
    const cache = await caches.open(CACHE_NAME);
    return await cache.match(ROOT_URL, { ignoreVary: true });
  } catch {
    return undefined;
  }
}

async function cacheFirst(request) {
  let cache;
  try {
    cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request, { ignoreVary: true });
    if (cached) return cached;
  } catch {
    // Storage access can be revoked independently of the network connection.
  }
  const response = await fetch(request);
  if (cache && response.ok && !response.redirected && response.type !== "opaque") {
    // A full cache or disabled storage must not break an otherwise good response.
    await cache.put(request, response.clone()).catch(() => {});
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (
    request.method !== "GET" ||
    url.origin !== self.location.origin ||
    isRscRequest(request, url)
  ) {
    return;
  }

  if (request.mode === "navigate" && url.pathname === "/") {
    event.respondWith(navigate(event));
    return;
  }

  if (isBuildAsset(url) || isCoreAsset(url)) {
    event.respondWith(cacheFirst(request));
  }
  // Everything else, including /_vercel/insights/*, is network-only. Never cache
  // analytics, RSC payloads, arbitrary pages, or user-generated exports.
});
