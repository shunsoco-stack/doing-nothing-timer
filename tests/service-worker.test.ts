import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const ORIGIN = "https://doing-nothing-timer.test";
const APP_CACHE = "doing-nothing-timer-v1";
const workerSource = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");

type FetchInput = string | URL | { url: string };
type MockRequest = Pick<Request, "url" | "method" | "mode" | "headers">;
type WorkerEvent = {
  request?: MockRequest;
  waitUntil: (promise: Promise<unknown>) => void;
  respondWith?: (response: Response | Promise<Response>) => void;
};
type FetchOptions = {
  method?: string;
  mode?: RequestMode;
  headers?: HeadersInit;
};

function inputUrl(input: FetchInput): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

/** Execute the actual worker with isolated, browser-shaped in-memory dependencies. */
function createWorker() {
  const handlers = new Map<string, (event: WorkerEvent) => void>();
  const cacheMaps = new Map<string, Map<string, Response>>();
  const writes: string[] = [];
  const state: {
    offline: boolean;
    cacheUnavailable: boolean;
    version: number;
    missingAsset: string | null;
    rootStatus: number;
    rootContentType: string;
    htmlOverride: string | null;
  } = {
    offline: false,
    cacheUnavailable: false,
    version: 1,
    missingAsset: null,
    rootStatus: 200,
    rootContentType: "text/html; charset=utf-8",
    htmlOverride: null,
  };

  function documentHtml() {
    return state.htmlOverride ?? `<html><head>
      <link rel="stylesheet" href="/_next/static/chunks/style.css">
      <script src="/_next/static/chunks/app-${state.version}.js?dpl=test&amp;v=1"></script>
      <script src="/_vercel/insights/script.js"></script>
      <script src="https://outside.test/script.js"></script>
      </head><body>version ${state.version}</body></html>`;
  }

  const caches = {
    async open(name: string) {
      if (state.cacheUnavailable) throw new Error("Storage is unavailable.");
      const entries = cacheMaps.get(name) ?? new Map<string, Response>();
      cacheMaps.set(name, entries);
      return {
        async match(request: FetchInput) {
          return entries.get(inputUrl(request))?.clone();
        },
        async put(request: FetchInput, response: Response) {
          const url = inputUrl(request);
          entries.set(url, response.clone());
          writes.push(url);
        },
      };
    },
    async keys() {
      return [...cacheMaps.keys()];
    },
    async delete(name: string) {
      return cacheMaps.delete(name);
    },
  };

  const fetchMock = vi.fn(async (input: FetchInput): Promise<Response> => {
    const url = new URL(inputUrl(input));
    if (state.offline) throw new TypeError("Network is offline.");
    if (url.pathname === "/") {
      return new Response(documentHtml(), {
        status: state.rootStatus,
        headers: { "Content-Type": state.rootContentType },
      });
    }
    if (url.pathname === state.missingAsset) return new Response("missing", { status: 404 });
    if (url.pathname.endsWith(".css")) {
      return new Response(
        "@font-face{src:url(../media/quiet.woff2)} .art{background:url(https://outside.test/art.svg)}",
        { headers: { "Content-Type": "text/css" } },
      );
    }
    return new Response(`asset:${url.pathname}`, {
      headers: { "Content-Type": "application/octet-stream" },
    });
  });

  const skipWaiting = vi.fn(async () => {});
  const claim = vi.fn(async () => {});
  const navigate = vi.fn(async () => {});
  const openWindow = vi.fn(async () => {});
  const clients = {
    claim,
    openWindow,
    matchAll: vi.fn(async () => [{ navigate }]),
  };

  runInNewContext(workerSource, {
    self: {
      location: { origin: ORIGIN },
      addEventListener: (name: string, handler: (event: WorkerEvent) => void) => handlers.set(name, handler),
      skipWaiting,
      clients,
    },
    clients,
    caches,
    fetch: fetchMock,
    URL,
    Response,
    Request,
    Headers,
  }, { filename: "public/sw.js" });

  async function lifecycle(name: "install" | "activate") {
    const promises: Promise<unknown>[] = [];
    const handler = handlers.get(name);
    if (!handler) throw new Error(`Missing ${name} handler.`);
    handler({ waitUntil: (promise) => { promises.push(promise); } });
    await Promise.all(promises);
  }

  async function dispatch(path: string, options: FetchOptions = {}): Promise<Response | undefined> {
    const promises: Promise<unknown>[] = [];
    let responsePromise: Promise<Response> | undefined;
    const handler = handlers.get("fetch");
    if (!handler) throw new Error("Missing fetch handler.");
    handler({
      request: {
        url: new URL(path, ORIGIN).href,
        method: options.method ?? "GET",
        mode: options.mode ?? "navigate",
        headers: new Headers(options.headers),
      },
      waitUntil: (promise) => { promises.push(promise); },
      respondWith: (response) => { responsePromise = Promise.resolve(response); },
    });
    const response = await responsePromise;
    await Promise.all(promises);
    return response;
  }

  async function respond(path: string, options?: FetchOptions): Promise<Response> {
    const response = await dispatch(path, options);
    if (!response) throw new Error("Expected the service worker to handle this request.");
    return response;
  }

  function cached(path: string) {
    return cacheMaps.get(APP_CACHE)?.get(new URL(path, ORIGIN).href)?.clone();
  }

  return {
    state, cacheMaps, writes, fetchMock, lifecycle, dispatch, respond, cached,
    skipWaiting, claim, navigate, openWindow,
  };
}

describe("service worker installation", () => {
  it("precaches the first page, build assets, CSS fonts, manifest and icons before publishing HTML", async () => {
    const worker = createWorker();
    await worker.lifecycle("install");

    for (const path of [
      "/", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png",
      "/icons/maskable-512.png", "/_next/static/chunks/app-1.js?dpl=test&v=1",
      "/_next/static/chunks/style.css", "/_next/static/media/quiet.woff2",
    ]) expect(worker.cached(path), path).toBeDefined();

    expect(worker.writes.at(-1)).toBe(`${ORIGIN}/`);
    expect(worker.fetchMock).toHaveBeenCalledWith(`${ORIGIN}/`, expect.objectContaining({
      cache: "no-store", headers: { Accept: "text/html" },
    }));
  });

  it("does not precache Analytics or external assets found in HTML or CSS", async () => {
    const worker = createWorker();
    await worker.lifecycle("install");
    const requested = worker.fetchMock.mock.calls.map(([input]) => inputUrl(input));
    expect(requested.some((url) => url.includes("insights") || url.includes("outside.test"))).toBe(false);
  });

  it("fails installation without publishing partial HTML if a required asset is missing", async () => {
    const worker = createWorker();
    worker.state.missingAsset = "/_next/static/chunks/app-1.js";
    await expect(worker.lifecycle("install")).rejects.toThrow("offline asset");
    expect(worker.cached("/")).toBeUndefined();
  });

  it("rejects HTML without hydration assets instead of caching an error page", async () => {
    const worker = createWorker();
    worker.state.htmlOverride = "<html><body>Temporary error</body></html>";
    await expect(worker.lifecycle("install")).rejects.toThrow("JavaScript assets");
    expect(worker.cached("/")).toBeUndefined();
  });

  it("rejects an RSC response as the initial document", async () => {
    const worker = createWorker();
    worker.state.rootContentType = "text/x-component";
    await expect(worker.lifecycle("install")).rejects.toThrow("app shell is unavailable");
  });
});

describe("service worker offline navigation", () => {
  it("can reload the app and its JS/CSS after just one completed online installation", async () => {
    const worker = createWorker();
    await worker.lifecycle("install");
    worker.state.offline = true;

    expect(await (await worker.respond("/")).text()).toContain("version 1");
    expect(await (await worker.respond("/_next/static/chunks/app-1.js?dpl=test&v=1", { mode: "cors" })).text()).toContain("app-1.js");
    expect(await (await worker.respond("/_next/static/chunks/style.css", { mode: "cors" })).text()).toContain("@font-face");
    expect((await worker.respond("/manifest.webmanifest", { mode: "cors" })).status).toBe(200);
  });

  it("returns a clear 503 when offline with no usable app cache", async () => {
    const worker = createWorker();
    worker.state.offline = true;
    const response = await worker.respond("/");
    expect(response.status).toBe(503);
    expect(await response.text()).toContain("オフラインです");
  });

  it("uses the saved document for a transient server error", async () => {
    const worker = createWorker();
    await worker.lifecycle("install");
    worker.state.rootStatus = 503;
    const response = await worker.respond("/");
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("version 1");
  });

  it("does not hide a real 404 response behind an offline document", async () => {
    const worker = createWorker();
    await worker.lifecycle("install");
    worker.state.rootStatus = 404;
    expect((await worker.respond("/")).status).toBe(404);
  });
});

describe("service worker cache boundaries", () => {
  const excluded: [string, string, FetchOptions][] = [
    ["RSC query", "/?_rsc=value", {}],
    ["RSC header", "/", { headers: { RSC: "1" } }],
    ["RSC content negotiation", "/", { headers: { Accept: "text/x-component" } }],
    ["router state", "/", { headers: { "Next-Router-State-Tree": "[]" } }],
    ["router prefetch", "/", { headers: { "Next-Router-Prefetch": "1" } }],
    ["segment prefetch", "/", { headers: { "Next-Router-Segment-Prefetch": "/" } }],
    ["Analytics script", "/_vercel/insights/script.js", { mode: "cors" }],
    ["Analytics event", "/_vercel/insights/event", { method: "POST", mode: "cors" }],
    ["foreign build asset", "https://outside.test/_next/static/chunks/app.js", { mode: "cors" }],
    ["POST static asset", "/_next/static/chunks/app.js", { method: "POST", mode: "cors" }],
    ["another page", "/not-the-app", {}],
    ["CSV export", "/records.csv", { mode: "cors" }],
  ];

  it.each(excluded)("leaves %s requests entirely to the network", async (_label, path, options) => {
    const worker = createWorker();
    expect(await worker.dispatch(path, options)).toBeUndefined();
    expect(worker.fetchMock).not.toHaveBeenCalled();
    expect(worker.cacheMaps.size).toBe(0);
  });

  it("never overwrites the canonical document with a query-specific page", async () => {
    const worker = createWorker();
    await worker.lifecycle("install");
    worker.state.version = 2;
    expect(await (await worker.respond("/?source=shared")).text()).toContain("version 2");
    expect(await worker.cached("/")?.text()).toContain("version 1");
  });

  it("does not replace cached HTML with an RSC response", async () => {
    const worker = createWorker();
    await worker.lifecycle("install");
    worker.state.version = 2;
    worker.state.rootContentType = "text/x-component";
    await worker.respond("/");
    expect(await worker.cached("/")?.text()).toContain("version 1");
  });
});

describe("service worker updates and storage failures", () => {
  it("preserves the last complete shell when refreshing an asset fails", async () => {
    const worker = createWorker();
    await worker.lifecycle("install");
    worker.state.version = 2;
    worker.state.missingAsset = "/_next/static/chunks/app-2.js";

    expect(await (await worker.respond("/")).text()).toContain("version 2");
    expect(await worker.cached("/")?.text()).toContain("version 1");
    worker.state.offline = true;
    expect(await (await worker.respond("/")).text()).toContain("version 1");
  });

  it("publishes a new shell only after its required assets have been saved", async () => {
    const worker = createWorker();
    await worker.lifecycle("install");
    worker.state.version = 2;
    await worker.respond("/");

    expect(worker.cached("/_next/static/chunks/app-2.js?dpl=test&v=1")).toBeDefined();
    expect(worker.writes.at(-1)).toBe(`${ORIGIN}/`);
    worker.state.offline = true;
    expect(await (await worker.respond("/")).text()).toContain("version 2");
  });

  it("removes only obsolete caches owned by this application", async () => {
    const worker = createWorker();
    await worker.lifecycle("install");
    worker.cacheMaps.set("doing-nothing-timer-v0", new Map());
    worker.cacheMaps.set("another-app-v1", new Map());
    await worker.lifecycle("activate");

    expect(worker.cacheMaps.has("doing-nothing-timer-v0")).toBe(false);
    expect(worker.cacheMaps.has(APP_CACHE)).toBe(true);
    expect(worker.cacheMaps.has("another-app-v1")).toBe(true);
  });

  it("does not take over or navigate open clients during installation or activation", async () => {
    const worker = createWorker();
    await worker.lifecycle("install");
    await worker.lifecycle("activate");
    expect(worker.skipWaiting).not.toHaveBeenCalled();
    expect(worker.claim).not.toHaveBeenCalled();
    expect(worker.navigate).not.toHaveBeenCalled();
    expect(worker.openWindow).not.toHaveBeenCalled();
  });

  it("keeps online assets usable when Cache Storage becomes unavailable", async () => {
    const worker = createWorker();
    worker.state.cacheUnavailable = true;
    const response = await worker.respond("/_next/static/chunks/uncached.js", { mode: "cors" });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("uncached.js");
  });

  it("handles unavailable storage and network without an unhandled rejection", async () => {
    const worker = createWorker();
    worker.state.cacheUnavailable = true;
    worker.state.offline = true;
    expect((await worker.respond("/")).status).toBe(503);
  });
});
