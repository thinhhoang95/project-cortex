// Lightweight browser-side fetch cache using Cache Storage
// Falls back to network fetch when not in a browser.

export const DEFAULT_CACHE_NAME = "project-cortex-v1";

export type FetchCachedOptions = {
  cacheName?: string;
  // If true, bypass cache read and refresh it from network
  bust?: boolean;
};

export async function fetchCached(url: string, opts: FetchCachedOptions = {}): Promise<Response> {
  const cacheName = opts.cacheName || DEFAULT_CACHE_NAME;

  // Not in browser (SSR or Node) -> regular fetch
  if (typeof window === "undefined" || !("caches" in window)) {
    return fetch(url);
  }

  const cachesApi: CacheStorage | undefined = (window as any).caches;
  if (!cachesApi) return fetch(url);

  const cache = await cachesApi.open(cacheName);

  if (!opts.bust) {
    const cached = await cache.match(url);
    if (cached) {
      // Return a clone to keep the cached body readable again later
      return cached.clone();
    }
  }

  // No cached entry or bust requested: fetch and populate cache
  const resp = await fetch(url, { cache: "no-cache" });
  if (resp.ok) {
    try {
      await cache.put(url, resp.clone());
    } catch {
      // ignore cache write failures (quota, opaque responses, etc.)
    }
  }
  return resp;
}

export async function clearAppCache(cacheName: string = DEFAULT_CACHE_NAME): Promise<void> {
  if (typeof window === "undefined" || !("caches" in window)) return;
  try {
    await (window as any).caches.delete(cacheName);
  } catch {
    // ignore
  }
}
