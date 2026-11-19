// Tiered snapshot cache with stale-while-revalidate.
//
//   1. Edge cache (Workers Cache API) — per data centre, fastest.
//   2. R2 (SNAPSHOTS bucket)          — global and durable; Cron Triggers
//      write here so every data centre finds a warm copy on its first miss.
//   3. Upstream build                  — fan out to the agencies.
//
// Freshness is judged by the snapshot's own `generatedAt`, not by cache
// expiry, so one copy can be served as fresh, then stale (while a background
// refresh runs), and finally as a fallback if the agencies are down.

const EDGE_ORIGIN = "https://snapshot-cache.internal/";
const inflight = new Map(); // per-isolate de-dupe of concurrent refreshes

const r2Key = (id) => `snapshots/${id}.json`;
const edgeKey = (id) => new Request(EDGE_ORIGIN + id);

function parse(text) {
  try {
    const s = JSON.parse(text);
    return typeof s?.generatedAt === "number" ? s : null;
  } catch {
    return null;
  }
}

async function readEdge(id) {
  const hit = await globalThis.caches?.default?.match(edgeKey(id));
  return hit ? parse(await hit.text()) : null;
}

async function writeEdge(id, snap, keepSeconds) {
  const cache = globalThis.caches?.default;
  if (!cache) return;
  await cache
    .put(edgeKey(id), new Response(JSON.stringify(snap), {
      headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${Math.max(1, Math.ceil(keepSeconds))}` },
    }))
    .catch(() => {});
}

async function readR2(env, id) {
  const obj = await env.SNAPSHOTS?.get(r2Key(id));
  return obj ? parse(await obj.text()) : null;
}

async function writeR2(env, id, snap) {
  await env.SNAPSHOTS?.put(r2Key(id), JSON.stringify(snap), {
    httpMetadata: { contentType: "application/json" },
    customMetadata: { generatedAt: String(snap.generatedAt) },
  });
}

const ageOf = (snap, now) => (now - snap.generatedAt) / 1000;

/**
 * Build a snapshot from upstream and store it in every tier.
 * @param {{ id:string, ttl:number, stale:number, persist?:boolean, build:()=>Promise<any> }} spec
 */
export function refresh(env, spec, now = () => Date.now()) {
  if (inflight.has(spec.id)) return inflight.get(spec.id);
  const p = (async () => {
    const data = await spec.build();
    const snap = { id: spec.id, generatedAt: now(), ttl: spec.ttl, data };
    await Promise.all([
      writeEdge(spec.id, snap, spec.ttl + spec.stale),
      spec.persist === false ? null : writeR2(env, spec.id, snap),
    ]);
    return snap;
  })().finally(() => inflight.delete(spec.id));
  inflight.set(spec.id, p);
  return p;
}

/**
 * Resolve a snapshot through the tiers.
 * @returns {Promise<{ snap: object|null, status: "hit"|"r2"|"stale"|"miss"|"stale-error"|"error", error?: string }>}
 */
export async function getSnapshot(env, ctx, spec, now = () => Date.now()) {
  const t = now();
  const fresh = (s) => s && ageOf(s, t) < spec.ttl;
  const usable = (s) => s && ageOf(s, t) < spec.ttl + spec.stale;

  const edge = await readEdge(spec.id);
  if (fresh(edge)) return { snap: edge, status: "hit" };

  let best = edge;
  if (spec.persist !== false) {
    const r2 = await readR2(env, spec.id).catch(() => null);
    if (r2 && (!best || r2.generatedAt > best.generatedAt)) best = r2;
    if (fresh(r2) && best === r2) {
      // Keep it at the edge for as long as it stays usable.
      ctx.waitUntil(writeEdge(spec.id, r2, spec.ttl + spec.stale - ageOf(r2, t)));
      return { snap: r2, status: "r2" };
    }
  }

  if (usable(best)) {
    ctx.waitUntil(refresh(env, spec, now).catch((e) => console.error(`refresh ${spec.id}:`, e)));
    return { snap: best, status: "stale" };
  }

  try {
    return { snap: await refresh(env, spec, now), status: "miss" };
  } catch (e) {
    const error = String(e?.message || e);
    console.error(`refresh ${spec.id}:`, error);
    // Too old to count as stale, but better than nothing while upstreams are down.
    return best ? { snap: best, status: "stale-error", error } : { snap: null, status: "error", error };
  }
}

export { r2Key };
