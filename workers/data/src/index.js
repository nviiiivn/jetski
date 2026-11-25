// bcw-data: hydrates the static Bay Coast Watch page.
//
//   GET  /snapshot/{weather|tides|buoys|climate}   grouped, cached snapshots
//   GET  /forecast?lat=..&lon=..                   NWS point forecast
//   GET  /snapshot                                 index: groups, ages, TTLs
//   POST /admin/refresh?group=all|<id>             force a refresh (Bearer REFRESH_TOKEN)
//
// scheduled(): Cron Triggers pre-warm groups into R2 (see groups.js).

import { GROUPS, FORECAST, groupsForCron } from "./groups.js";
import { getSnapshot, refresh, r2Key } from "./cache.js";
import { upstream } from "./upstream.js";
import { fetchPointForecast } from "./sources/nws.js";
import { REGIONS, REGION_IDS, DEFAULT_REGION } from "../../../shared/stations.js";

// tides.alola.lol: every snapshot is per region (?region=sfbay|puget|la|sfla).
const regionOf = (url) => REGIONS[url.searchParams.get("region")] || REGIONS[DEFAULT_REGION];

const specFor = (env, id, region = REGIONS[DEFAULT_REGION]) => {
  const g = GROUPS[id];
  const up = upstream(env);
  return { id: `${region.id}/${id}`, ttl: g.ttl, stale: g.stale, build: () => g.build(up, region) };
};

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}

/** Browser/CDN caching: only for the snapshot's remaining fresh lifetime. */
function snapshotResponse({ snap, status, error }, spec) {
  if (!snap) return json({ error: error || "unavailable" }, 502, { "Cache-Control": "no-store", "X-Snapshot-Status": status });
  const age = Math.max(0, Math.floor((Date.now() - snap.generatedAt) / 1000));
  const fresh = Math.max(0, spec.ttl - age);
  const maxAge = status === "hit" || status === "r2" || status === "miss" ? Math.min(fresh, 300) : 30;
  return json(snap, 200, {
    "Cache-Control": `public, max-age=${maxAge}, stale-while-revalidate=60`,
    Age: String(age),
    "X-Snapshot-Status": status,
    "X-Generated-At": new Date(snap.generatedAt).toISOString(),
  });
}

async function handleForecast(url, env, ctx) {
  const lat = Number(url.searchParams.get("lat"));
  const lon = Number(url.searchParams.get("lon"));
  const [[lonMin, latMin], [lonMax, latMax]] = regionOf(url).maxBounds;
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < latMin || lat > latMax || lon < lonMin || lon > lonMax)
    return json({ error: "lat/lon outside the region" }, 400);
  // ~1 km cells: NWS grids are 2.5 km, so nearby clicks share one cache entry.
  const rl = Math.round(lat * 100) / 100;
  const rn = Math.round(lon * 100) / 100;
  const up = upstream(env);
  const spec = { id: `forecast/${rl},${rn}`, ...FORECAST, persist: false, build: () => fetchPointForecast(up, rl, rn) };
  return snapshotResponse(await getSnapshot(env, ctx, spec), spec);
}

async function handleIndex(env) {
  const now = Date.now();
  const out = {};
  await Promise.all(
    REGION_IDS.flatMap((r) => Object.keys(GROUPS).map((id) => [`${r}/${id}`, GROUPS[id]])).map(async ([id, g]) => {
      const head = await env.SNAPSHOTS?.head(r2Key(id)).catch(() => null);
      const gen = Number(head?.customMetadata?.generatedAt) || null;
      out[id] = { ttl: g.ttl, stale: g.stale, cron: g.cron, generatedAt: gen, ageSeconds: gen ? Math.round((now - gen) / 1000) : null };
    })
  );
  return json({ groups: out }, 200, { "Cache-Control": "no-store" });
}

async function handleAdmin(req, url, env) {
  if (!env.REFRESH_TOKEN) return json({ error: "not found" }, 404);
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  if (req.headers.get("Authorization") !== `Bearer ${env.REFRESH_TOKEN}`) return json({ error: "unauthorized" }, 401);
  const g = url.searchParams.get("group") || "all";
  const ids = g === "all" ? Object.keys(GROUPS) : g.split(",");
  if (ids.some((id) => !GROUPS[id])) return json({ error: `unknown group: ${g}` }, 400);
  return json(await refreshGroups(env, ids, regionOf(url)), 200, { "Cache-Control": "no-store" });
}

export async function refreshGroups(env, ids, region = REGIONS[DEFAULT_REGION]) {
  const out = {};
  await Promise.all(
    ids.map(async (id) => {
      try {
        const s = await refresh(env, specFor(env, id, region));
        out[id] = { ok: true, generatedAt: new Date(s.generatedAt).toISOString(), errors: s.data.errors?.length || 0 };
      } catch (e) {
        out[id] = { ok: false, error: String(e?.message || e) };
      }
    })
  );
  return out;
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "");

    if (path.startsWith("/admin/refresh")) return handleAdmin(req, url, env);
    if (req.method !== "GET" && req.method !== "HEAD") return json({ error: "method not allowed" }, 405);

    if (path === "/snapshot") return handleIndex(env);
    const m = path.match(/^\/snapshot\/([a-z]+)$/);
    if (m && GROUPS[m[1]]) {
      const spec = specFor(env, m[1], regionOf(url));
      return snapshotResponse(await getSnapshot(env, ctx, spec), spec);
    }
    if (path === "/forecast") return handleForecast(url, env, ctx);
    return json({ error: "not found" }, 404);
  },

  async scheduled(event, env, ctx) {
    const ids = groupsForCron(event.cron);
    if (!ids.length) return console.warn(`no groups for cron "${event.cron}"`);
    const res = await refreshGroups(env, ids);
    console.log(`cron ${event.cron}:`, JSON.stringify(res));
    if (Object.values(res).some((r) => !r.ok)) throw new Error(`refresh failed: ${JSON.stringify(res)}`);
  },
};
