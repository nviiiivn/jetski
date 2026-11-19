import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { FakeR2, fakeCtx, installCaches } from "./helpers.js";
import { getSnapshot, refresh, r2Key } from "../workers/data/src/cache.js";

let cache, env, clock, builds;
const spec = (over = {}) => ({
  id: "g", ttl: 60, stale: 600,
  build: async () => { builds++; return { n: builds }; },
  ...over,
});
const now = () => clock;
const seed = (where, ageSeconds, data = { n: 0 }) => {
  const snap = { id: "g", generatedAt: clock - ageSeconds * 1000, ttl: 60, data };
  if (where === "edge") return cache.put(new Request("https://snapshot-cache.internal/g"), new Response(JSON.stringify(snap)));
  return env.SNAPSHOTS.put(r2Key("g"), JSON.stringify(snap), { customMetadata: {} });
};

beforeEach(() => {
  cache = installCaches();
  env = { SNAPSHOTS: new FakeR2() };
  clock = Date.UTC(2026, 10, 19);
  builds = 0;
});

test("cold miss builds, then stores at the edge and in R2", async () => {
  const ctx = fakeCtx();
  const r = await getSnapshot(env, ctx, spec(), now);
  assert.equal(r.status, "miss");
  assert.deepEqual(r.snap.data, { n: 1 });
  assert.equal(env.SNAPSHOTS.puts, 1);
  const again = await getSnapshot(env, fakeCtx(), spec(), now);
  assert.equal(again.status, "hit");
  assert.equal(builds, 1);
});

test("fresh R2 copy is used on an edge miss (cron pre-warm path) and copied to the edge", async () => {
  await seed("r2", 10);
  const ctx = fakeCtx();
  const r = await getSnapshot(env, ctx, spec(), now);
  assert.equal(r.status, "r2");
  assert.equal(builds, 0);
  await ctx.settle();
  assert.equal((await getSnapshot(env, fakeCtx(), spec(), now)).status, "hit");
});

test("stale copy is served immediately while a background refresh runs", async () => {
  await seed("edge", 120); // older than ttl (60) but within ttl+stale
  const ctx = fakeCtx();
  const r = await getSnapshot(env, ctx, spec(), now);
  assert.equal(r.status, "stale");
  assert.deepEqual(r.snap.data, { n: 0 });
  assert.equal(ctx.tasks.length, 1);
  await ctx.settle();
  assert.equal(builds, 1);
  assert.equal((await getSnapshot(env, fakeCtx(), spec(), now)).status, "hit");
});

test("a newer R2 copy wins over an older edge copy", async () => {
  await seed("edge", 300, { n: "edge" });
  await seed("r2", 5, { n: "r2" });
  const r = await getSnapshot(env, fakeCtx(), spec(), now);
  assert.equal(r.status, "r2");
  assert.equal(r.snap.data.n, "r2");
});

test("too-old copy triggers a blocking refresh", async () => {
  await seed("edge", 10_000);
  const r = await getSnapshot(env, fakeCtx(), spec(), now);
  assert.equal(r.status, "miss");
  assert.equal(builds, 1);
});

test("upstream failure falls back to whatever we have, else reports an error", async () => {
  const failing = spec({ build: async () => { throw new Error("NOAA down"); } });
  const none = await getSnapshot(env, fakeCtx(), failing, now);
  assert.equal(none.status, "error");
  assert.equal(none.snap, null);
  assert.match(none.error, /NOAA down/);

  await seed("r2", 10_000, { n: "old" });
  const old = await getSnapshot(env, fakeCtx(), failing, now);
  assert.equal(old.status, "stale-error");
  assert.equal(old.snap.data.n, "old");
});

test("concurrent refreshes of one group share a single upstream build", async () => {
  let release;
  const slow = spec({ build: () => new Promise((r) => { builds++; release = () => r({ ok: 1 }); }) });
  const a = refresh(env, slow, now);
  const b = refresh(env, slow, now);
  release();
  assert.equal(await a, await b);
  assert.equal(builds, 1);
});

test("persist:false (point forecasts) never touches R2", async () => {
  await getSnapshot(env, fakeCtx(), spec({ persist: false }), now);
  assert.equal(env.SNAPSHOTS.puts, 0);
  assert.equal((await getSnapshot(env, fakeCtx(), spec({ persist: false }), now)).status, "hit");
});

test("works without an R2 binding (edge cache only)", async () => {
  const r = await getSnapshot({}, fakeCtx(), spec(), now);
  assert.equal(r.status, "miss");
});
