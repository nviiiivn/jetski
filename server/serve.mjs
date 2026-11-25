// tides.alola.lol (2026-11-24): runs jetski's Cloudflare Workers code as one plain Node server on the Pi.
//
//   GET /snapshot/<group>?region=..  /forecast  /snapshot   -> workers/data (unchanged request handler)
//   everything else                                         -> static files from dist/
//
// What Cloudflare provided, and what stands in for it here:
//   Workers Cache API (caches.default)  -> an in-memory cache that honours max-age
//   R2 bucket (env.SNAPSHOTS)           -> JSON files under ./.data/ (survive restarts)
//   Cron Triggers                       -> none: snapshots build on first request, then refresh in the
//                                          background when stale (the worker's own stale-while-revalidate)
//
// Listens on 127.0.0.1:${PORT} only; Caddy (host tides.alola.lol) is the front door.

import { createServer } from "node:http";
import net from "node:net";

// The Pi has no IPv6 route and the home link is slow to connect, so Node's default 250 ms per address attempt made
// whole bursts of NOAA/NWS requests fail with ETIMEDOUT (stations went missing from snapshots). 2.5 s fixes it.
net.setDefaultAutoSelectFamilyAttemptTimeout(2500);
import { readFile, writeFile, mkdir, stat, rename } from "node:fs/promises";
import { join, normalize, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");
// tido.alola.lol: her retro green telemetry viewer, a static page in ~/projects/tido that reads the same snapshots.
const TIDO = process.env.TIDO_DIR || join(ROOT, "..", "tido");
const DATA = join(ROOT, ".data");
const PORT = Number(process.env.PORT) || 8970;
const HOST = process.env.HOST || "127.0.0.1";

// ---- caches.default stand-in -------------------------------------------------------------
const mem = new Map(); // url -> { body, headers, expires }
globalThis.caches = {
  default: {
    async match(req) {
      const k = typeof req === "string" ? req : req.url;
      const e = mem.get(k);
      if (!e) return undefined;
      if (Date.now() > e.expires) { mem.delete(k); return undefined; }
      return new Response(e.body, { headers: e.headers });
    },
    async put(req, res) {
      const k = typeof req === "string" ? req : req.url;
      const cc = res.headers.get("Cache-Control") || "";
      const age = Number((cc.match(/max-age=(\d+)/) || [])[1] || 0);
      if (!age) return;
      mem.set(k, { body: await res.text(), headers: Object.fromEntries(res.headers), expires: Date.now() + age * 1000 });
      if (mem.size > 2000) mem.delete(mem.keys().next().value);
    },
  },
};

// ---- R2 stand-in: one JSON file per key ----------------------------------------------------
const fileOf = (key) => join(DATA, key.replace(/[^a-zA-Z0-9/_.-]/g, "_"));
const SNAPSHOTS = {
  async get(key) {
    try {
      const text = await readFile(fileOf(key), "utf8");
      return { text: async () => text };
    } catch { return null; }
  },
  async head(key) {
    const o = await SNAPSHOTS.get(key);
    if (!o) return null;
    try { return { customMetadata: { generatedAt: String(JSON.parse(await o.text()).generatedAt) } }; } catch { return null; }
  },
  async put(key, body) {
    const f = fileOf(key);
    await mkdir(dirname(f), { recursive: true });
    await writeFile(f + ".tmp", body);
    await rename(f + ".tmp", f);
  },
};

const env = {
  SNAPSHOTS,
  // api.weather.gov asks every app to identify itself; set NWS_USER_AGENT to your own site and a contact
  NWS_USER_AGENT: process.env.NWS_USER_AGENT || "(coast-watch, self-hosted tide and coast dashboard)",
  UPSTREAM_TIMEOUT_MS: process.env.UPSTREAM_TIMEOUT_MS,
};
const ctx = { waitUntil: (p) => { Promise.resolve(p).catch((e) => console.error("background:", e?.message || e)); } };

const { default: data } = await import("../workers/data/src/index.js");

// ---- static files --------------------------------------------------------------------------
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".txt": "text/plain; charset=utf-8",
};

async function serveStatic(pathname, res, method, base = DIST) {
  let p = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "");
  if (p.endsWith("/")) p += "index.html";
  let file = join(base, p);
  if (!file.startsWith(base)) { res.writeHead(403).end(); return; }
  let status = 200;
  try {
    if ((await stat(file)).isDirectory()) file = join(file, "index.html");
  } catch {
    file = join(base === DIST ? DIST : base, base === DIST ? "404.html" : "index.html");
    status = base === DIST ? 404 : 200;
  }
  try {
    const body = await readFile(file);
    const hashed = base === DIST && /\/(assets|vendor)\//.test(file);
    res.writeHead(status, {
      "Content-Type": TYPES[extname(file)] || "application/octet-stream",
      "Cache-Control": hashed ? "public, max-age=31536000, immutable" : "no-cache",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
    });
    res.end(method === "HEAD" ? undefined : body);
  } catch {
    res.writeHead(500).end("error");
  }
}

// ---- server ---------------------------------------------------------------------------------
const DATA_ROUTES = /^\/(snapshot|forecast)(\/|$)/; // /admin stays off (no token is set)

// Per-visitor rate limit on the data routes, so one runaway script or crawler can't queue thousands of upstream
// requests (every new /forecast point is a fresh NWS lookup) and stall the page for everyone else. A page load is
// about 6 requests and the page refreshes every 5 minutes, so these limits are far above normal use. Behind a local
// proxy (Caddy + Cloudflare Tunnel) the visitor is the Cf-Connecting-Ip / X-Forwarded-For address.
const LIMITS = { data: Number(process.env.RATE_DATA_PER_MIN) || 240, forecast: Number(process.env.RATE_FORECAST_PER_MIN) || 30 };
const hits = new Map(); // "kind ip" -> { n, reset }
const LOOPBACK = /^(127\.|::1$|::ffff:127\.)/;
function visitor(req) {
  const peer = req.socket.remoteAddress || "";
  if (!LOOPBACK.test(peer)) return peer;
  const h = req.headers["cf-connecting-ip"] || String(req.headers["x-forwarded-for"] || "").split(",")[0];
  return String(h || peer).trim();
}
function limited(kind, ip) {
  const now = Date.now(), k = `${kind} ${ip}`;
  let e = hits.get(k);
  if (!e || now > e.reset) { e = { n: 0, reset: now + 60_000 }; hits.set(k, e); }
  return ++e.n > LIMITS[kind];
}
setInterval(() => { const now = Date.now(); for (const [k, e] of hits) if (now > e.reset) hits.delete(k); }, 60_000).unref();

// A stray promise rejection must not take the whole site down; log it and keep serving.
process.on("unhandledRejection", (e) => console.error("unhandled rejection:", e?.stack || e));

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (DATA_ROUTES.test(url.pathname)) {
      if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405).end(); return; }
      const ip = visitor(req);
      if (limited("data", ip) || (url.pathname.startsWith("/forecast") && limited("forecast", ip))) {
        res.writeHead(429, { "Content-Type": "application/json", "Retry-After": "60" }).end('{"error":"too many requests, try again in a minute"}');
        return;
      }
      const r = await data.fetch(new Request(url, { method: req.method, headers: { accept: "application/json" } }), env, ctx);
      res.writeHead(r.status, Object.fromEntries(r.headers));
      res.end(req.method === "HEAD" ? undefined : Buffer.from(await r.arrayBuffer()));
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405).end(); return; }
    // tido: by host name, or under /__tido/ for local testing
    const host = String(req.headers.host || "");
    if (host.startsWith("tido.")) { await serveStatic(url.pathname, res, req.method, TIDO); return; }
    if (url.pathname.startsWith("/__tido/")) { await serveStatic(url.pathname.slice(7), res, req.method, TIDO); return; }
    await serveStatic(url.pathname, res, req.method);
  } catch (e) {
    console.error(req.url, e);
    if (!res.headersSent) res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("error");
  }
}).listen(PORT, HOST, () => console.log(`tides: http://${HOST}:${PORT}`));
