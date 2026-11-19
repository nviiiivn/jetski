// Upstream HTTP helpers. Every call to NWS / CO-OPS / NDBC / CPC goes through
// here so the User-Agent, timeout and error handling live in one place.

export class UpstreamError extends Error {
  constructor(status, url) {
    super(`${status} ${url}`);
    this.status = status;
    this.url = url;
  }
}

const DEFAULT_UA = "(bay-coast-watch, https://github.com/rishabhbajpailab/jetski)";

export function upstream(env = {}) {
  const ua = env.NWS_USER_AGENT || DEFAULT_UA;
  const timeout = Number(env.UPSTREAM_TIMEOUT_MS) || 15_000;

  async function get(url, accept = "*/*") {
    const res = await fetch(url, {
      headers: { "User-Agent": ua, Accept: accept },
      signal: AbortSignal.timeout(timeout),
    });
    if (!res.ok) throw new UpstreamError(res.status, url);
    return res;
  }

  /**
   * Long-lived upstream resources (NWS zone shapes, NWS point metadata) are
   * cached on their own in the edge cache, independently of the snapshots that
   * use them, so a 5-minute alert refresh doesn't re-download coastlines.
   */
  async function cachedJSON(url, ttlSeconds) {
    const cache = globalThis.caches?.default;
    const key = new Request(`https://upstream-cache.internal/${encodeURIComponent(url)}`);
    if (cache) {
      const hit = await cache.match(key);
      if (hit) return hit.json();
    }
    const body = await (await get(url, "application/geo+json")).text();
    if (cache) {
      const put = cache.put(key, new Response(body, {
        headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${ttlSeconds}` },
      }));
      await put.catch(() => {});
    }
    return JSON.parse(body);
  }

  return {
    json: async (url) => (await get(url, "application/geo+json, application/json")).json(),
    text: async (url) => (await get(url, "text/plain, */*")).text(),
    cachedJSON,
  };
}

/** Promise.allSettled that keeps the fulfilled values and counts failures. */
export async function settled(promises) {
  const rs = await Promise.allSettled(promises);
  const ok = [];
  const errors = [];
  for (const r of rs) (r.status === "fulfilled" ? ok.push(r.value) : errors.push(String(r.reason?.message || r.reason)));
  return { ok, errors };
}
