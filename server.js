// Tiny zero-dependency server: serves ./public and proxies a fixed allowlist of
// public government data APIs with an in-memory cache.
//
// Why a proxy at all?
//  - NDBC (buoys) and CPC (El Niño indices) don't send CORS headers, so the
//    browser can't call them directly.
//  - api.weather.gov asks clients to identify themselves with a User-Agent,
//    which browsers won't let us set.
//  - Caching keeps request volume to every upstream low no matter how many
//    tabs are open.
//
// Map tiles are NOT proxied: the browser fetches them directly from the
// OpenStreetMap US Tileservice.

import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT) || 8080;
const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "public");
const USER_AGENT =
  process.env.NWS_USER_AGENT || "(bay-coast-dashboard, https://github.com/)";

const MIN = 60_000;
// prefix -> upstream origin + cache TTL
const UPSTREAMS = {
  "/nws/": { origin: "https://api.weather.gov/", ttl: 5 * MIN },
  "/coops/": { origin: "https://api.tidesandcurrents.noaa.gov/", ttl: 6 * MIN },
  "/ndbc/": { origin: "https://www.ndbc.noaa.gov/", ttl: 10 * MIN },
  "/cpc/": { origin: "https://www.cpc.ncep.noaa.gov/", ttl: 6 * 60 * MIN },
};
// Static-ish NWS resources (zone shapes) change rarely; cache them a day.
const LONG_TTL = [/^\/nws\/zones\//, /^\/coops\/.*product=monthly_mean/];

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

const cache = new Map(); // key -> { expires, status, type, body }
const inflight = new Map(); // key -> Promise

async function fetchUpstream(url, ttl) {
  const hit = cache.get(url);
  if (hit && hit.expires > Date.now()) return hit;
  if (inflight.has(url)) return inflight.get(url);

  const p = (async () => {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "*/*" },
        signal: AbortSignal.timeout(20_000),
      });
      const body = Buffer.from(await res.arrayBuffer());
      const entry = {
        status: res.status,
        type: res.headers.get("content-type") || "application/octet-stream",
        body,
        // Cache failures briefly so a flaky upstream isn't hammered.
        expires: Date.now() + (res.ok ? ttl : 30_000),
      };
      cache.set(url, entry);
      return entry;
    } catch (err) {
      // Serve stale data if we have it.
      if (hit) return hit;
      return {
        status: 502,
        type: "application/json",
        body: Buffer.from(JSON.stringify({ error: String(err.message || err) })),
      };
    } finally {
      inflight.delete(url);
    }
  })();
  inflight.set(url, p);
  return p;
}

async function handleProxy(req, res, prefix, conf) {
  const rest = req.url.slice(prefix.length);
  const url = conf.origin + rest;
  const ttl = LONG_TTL.some((re) => re.test(req.url)) ? 24 * 60 * MIN : conf.ttl;
  const r = await fetchUpstream(url, ttl);
  res.writeHead(r.status, {
    "Content-Type": r.type,
    "Cache-Control": `public, max-age=${Math.floor(ttl / 1000)}`,
  });
  res.end(r.body);
}

async function handleStatic(req, res) {
  let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (path.endsWith("/")) path += "index.html";
  const file = normalize(join(ROOT, path));
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      "Content-Type": MIME[extname(file)] || "application/octet-stream",
    });
    res.end(body);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method !== "GET") {
    res.writeHead(405).end();
    return;
  }
  if (req.url.startsWith("/api/")) {
    req.url = req.url.slice(4); // strip "/api"
    for (const [prefix, conf] of Object.entries(UPSTREAMS)) {
      if (req.url.startsWith(prefix)) return handleProxy(req, res, prefix, conf);
    }
    res.writeHead(404).end();
    return;
  }
  return handleStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`Bay Coast dashboard → http://localhost:${PORT}`);
});
