// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createContext, runInContext } from "node:vm";

import { beforeEach, describe, expect, it, vi } from "vitest";

// public/sw.js runs in a sandbox with a fake `self`, Cache Storage and network,
// to check what it caches (SPEC §16: static assets and the offline page only).

const ORIGIN = "https://splitmate.example";
const source = readFileSync(join(process.cwd(), "public", "sw.js"), "utf8");

type Handler = (event: Record<string, unknown>) => void;

function loadWorker() {
  const handlers = new Map<string, Handler>();
  const stores = new Map<string, Map<string, Response>>();
  const network = vi.fn<(request: Request) => Promise<Response>>();
  const open = async (name: string) => {
    const store = stores.get(name) ?? new Map<string, Response>();
    stores.set(name, store);
    return {
      put: async (request: Request, response: Response) => void store.set(request.url, response),
      addAll: async (urls: string[]) => {
        for (const url of urls) store.set(new URL(url, ORIGIN).toString(), new Response(`cached ${url}`));
      },
    };
  };
  const caches = {
    open,
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
    match: async (request: Request | string) => {
      const url = typeof request === "string" ? new URL(request, ORIGIN).toString() : request.url;
      for (const store of stores.values()) if (store.has(url)) return store.get(url)!.clone();
      return undefined;
    },
  };
  const self = {
    location: new URL(ORIGIN),
    addEventListener: (type: string, handler: Handler) => handlers.set(type, handler),
    skipWaiting: async () => undefined,
    clients: { claim: async () => undefined },
  };
  runInContext(source, createContext({ self, caches, fetch: network, URL, Response, Promise }));

  /** Runs the fetch handler; returns the response it chose, or "passthrough" if it didn't respond. */
  async function request(url: string, init: { method?: string; mode?: string } = {}) {
    let responded: Promise<Response> | undefined;
    const req = Object.assign(new Request(new URL(url, ORIGIN), { method: init.method ?? "GET" }), {});
    Object.defineProperty(req, "mode", { value: init.mode ?? "cors" });
    handlers.get("fetch")!({ request: req, respondWith: (value: Promise<Response>) => (responded = value) });
    return responded ? await responded : "passthrough";
  }
  async function lifecycle(type: "install" | "activate") {
    let pending: Promise<unknown> = Promise.resolve();
    handlers.get(type)!({ waitUntil: (value: Promise<unknown>) => (pending = value) });
    await pending;
  }
  return { request, lifecycle, network, stores };
}

let worker: ReturnType<typeof loadWorker>;

beforeEach(async () => {
  worker = loadWorker();
  await worker.lifecycle("install");
});

describe("service worker", () => {
  it("precaches only the offline page and icons", () => {
    const cached = [...worker.stores.values()].flatMap((store) => [...store.keys()]);
    expect(cached.sort()).toEqual([`${ORIGIN}/icons/icon-192.png`, `${ORIGIN}/icons/logo.svg`, `${ORIGIN}/offline.html`]);
  });

  it("loads pages from the network and never stores them", async () => {
    worker.network.mockResolvedValue(new Response("<h1>Dashboard ₹600</h1>"));
    const response = await worker.request("/dashboard", { mode: "navigate" });
    expect(await (response as Response).text()).toContain("Dashboard");
    const cached = [...worker.stores.values()].flatMap((store) => [...store.keys()]);
    expect(cached).not.toContain(`${ORIGIN}/dashboard`);
  });

  it("shows the offline page when a page can't be loaded", async () => {
    worker.network.mockRejectedValue(new TypeError("Failed to fetch"));
    const response = await worker.request("/groups/123", { mode: "navigate" });
    expect(await (response as Response).text()).toBe("cached /offline.html");
  });

  it("caches hashed build assets, first from the network, then from the cache", async () => {
    worker.network.mockResolvedValue(new Response("chunk", { status: 200 }));
    Object.defineProperty(Response.prototype, "type", { configurable: true, get: () => "basic" });
    try {
      await worker.request("/_next/static/chunks/app-123.js");
      await worker.request("/_next/static/chunks/app-123.js");
    } finally {
      delete (Response.prototype as { type?: unknown }).type;
    }
    expect(worker.network).toHaveBeenCalledTimes(1);
  });

  it("leaves data requests, Server Actions, exports and other origins alone", async () => {
    for (const [url, init] of [
      ["/notifications/unread-count", {}],
      ["/analytics/export?kind=expenses", {}],
      ["/settings/export?format=json", {}],
      ["/dashboard?_rsc=abc", {}],
      ["/_next/static/chunks/app.js?v=1", {}],
      ["/expenses/new", { method: "POST" }],
      ["https://abc.supabase.co/rest/v1/expenses", {}],
    ] as const) {
      expect(await worker.request(url, init), url).toBe("passthrough");
    }
    expect(worker.network).not.toHaveBeenCalled();
  });

  it("drops caches from older versions when it activates", async () => {
    worker.stores.set("splitmate-static-v0", new Map([[`${ORIGIN}/old.js`, new Response("old")]]));
    await worker.lifecycle("activate");
    expect([...worker.stores.keys()]).toEqual(["splitmate-static-v1"]);
  });
});
