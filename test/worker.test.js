import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { FakeR2, fakeCtx, installCaches, installUpstream } from "./helpers.js";
import data from "../workers/data/src/index.js";
import site from "../workers/site/src/index.js";
import { GROUPS, CRON } from "../workers/data/src/groups.js";
import { TIDE_STATIONS, BUOYS, WX_STATIONS } from "../shared/stations.js";

let env, calls;
const get = (path, init) => data.fetch(new Request(`https://bcw.test${path}`, init), env, fakeCtx());

beforeEach(() => {
  installCaches();
  calls = installUpstream();
  env = { SNAPSHOTS: new FakeR2(), NWS_USER_AGENT: "(test-suite)", REFRESH_TOKEN: "s3cret" };
});

test("GET /snapshot/weather: observations + alerts with deduped zone shapes", async () => {
  const res = await get("/snapshot/weather");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("Cache-Control"), /max-age=\d+/);
  assert.equal(res.headers.get("X-Snapshot-Status"), "miss");
  const { data: d, generatedAt } = await res.json();
  assert.equal(typeof generatedAt, "number");
  assert.equal(d.stations.length, WX_STATIONS.length);
  assert.equal(d.alerts.count, 2, "only the Bay Area office's alerts");
  assert.deepEqual(Object.keys(d.alerts.zones).sort(), ["forecast/PZZ530", "forecast/PZZ535"]);
  assert.equal(d.alerts.features.length, 3);
  assert.equal(d.alerts.features.at(-1).properties.kind, "warning", "warnings sort last (drawn on top)");
  assert.equal(d.alerts.items.a1.description, "Winds.");
  assert.ok(!("description" in d.alerts.features[0].properties), "text not repeated per polygon");
  // NWS asks for a User-Agent
  const nws = calls.find((c) => c.url.startsWith("https://api.weather.gov/"));
  assert.equal(nws.headers["User-Agent"], "(test-suite)");
});

test("GET /snapshot/tides, /buoys, /climate return every station", async () => {
  const tides = (await (await get("/snapshot/tides")).json()).data;
  assert.equal(tides.stations.length, TIDE_STATIONS.length);
  assert.equal(tides.stations[0].temp.v, 58.3);
  const buoys = (await (await get("/snapshot/buoys")).json()).data;
  assert.equal(buoys.buoys.length, BUOYS.length);
  const climate = (await (await get("/snapshot/climate")).json()).data;
  assert.ok(climate.phase.label);
  assert.ok(climate.oni.length > 0 && climate.weekly.length <= 12);
  assert.equal(climate.monthly.length, TIDE_STATIONS.length);
});

test("second request is served from cache without touching upstream", async () => {
  await get("/snapshot/buoys");
  const before = calls.length;
  const res = await get("/snapshot/buoys");
  assert.equal(res.headers.get("X-Snapshot-Status"), "hit");
  assert.equal(calls.length, before);
});

test("partial upstream failure still produces a snapshot and reports errors", async () => {
  calls = installUpstream({ fail: (u) => u.includes("46026") || u.includes("KSFO") });
  const w = (await (await get("/snapshot/weather")).json()).data;
  assert.equal(w.stations.length, WX_STATIONS.length - 1);
  assert.equal(w.errors.length, 1);
});

test("total upstream failure returns 502, never an empty snapshot", async () => {
  installUpstream({ fail: (u) => u.includes("ndbc") });
  const res = await get("/snapshot/buoys");
  assert.equal(res.status, 502);
  assert.equal(res.headers.get("Cache-Control"), "no-store");
  assert.equal(env.SNAPSHOTS.puts, 0);
});

test("GET /forecast: trimmed periods, offshore = unavailable, bounds checked", async () => {
  const fc = (await (await get("/forecast?lat=37.7749&lon=-122.4194")).json()).data;
  assert.equal(fc.place, "San Francisco, CA");
  assert.equal(fc.periods.length, 7);
  assert.equal(fc.periods[0].detailedForecast, undefined);
  assert.ok(calls.some((c) => c.url.endsWith("/points/37.7700,-122.4200")), "rounded to ~1 km cell");

  assert.deepEqual((await (await get("/forecast?lat=37.5&lon=-123.3")).json()).data, { unavailable: true });
  assert.equal((await get("/forecast?lat=10&lon=-122")).status, 400);
  assert.equal((await get("/forecast?lat=abc")).status, 400);
});

test("unknown routes and methods", async () => {
  assert.equal((await get("/snapshot/nope")).status, 404);
  assert.equal((await get("/elsewhere")).status, 404);
  assert.equal((await get("/snapshot/tides", { method: "POST" })).status, 405);
});

test("POST /admin/refresh requires the bearer token", async () => {
  assert.equal((await get("/admin/refresh?group=buoys", { method: "POST" })).status, 401);
  assert.equal((await get("/admin/refresh?group=nope", { method: "POST", headers: { Authorization: "Bearer s3cret" } })).status, 400);
  const res = await get("/admin/refresh?group=buoys,climate", { method: "POST", headers: { Authorization: "Bearer s3cret" } });
  const body = await res.json();
  assert.equal(body.buoys.ok, true);
  assert.equal(body.climate.ok, true);
  assert.equal(env.SNAPSHOTS.puts, 2);

  delete env.REFRESH_TOKEN;
  assert.equal((await get("/admin/refresh", { method: "POST" })).status, 404, "disabled without a token");
});

test("GET /snapshot lists groups with their age from R2", async () => {
  await get("/snapshot/tides");
  const idx = (await (await get("/snapshot")).json()).groups;
  assert.deepEqual(Object.keys(idx).sort(), Object.keys(GROUPS).sort());
  assert.ok(idx.tides.ageSeconds >= 0);
  assert.equal(idx.buoys.generatedAt, null);
});

test("scheduled(): each cron refreshes exactly its groups into R2", async () => {
  await data.scheduled({ cron: CRON.QUARTER_HOUR }, env, fakeCtx());
  assert.deepEqual([...env.SNAPSHOTS.objects.keys()], ["snapshots/buoys.json"]);
  await data.scheduled({ cron: CRON.FIVE_MIN }, env, fakeCtx());
  assert.deepEqual([...env.SNAPSHOTS.objects.keys()].sort(), ["snapshots/buoys.json", "snapshots/tides.json", "snapshots/weather.json"]);
});

test("scheduled(): a failed refresh throws so Cloudflare records the failure", async () => {
  installUpstream({ fail: (u) => u.includes("ndbc") });
  await assert.rejects(data.scheduled({ cron: CRON.QUARTER_HOUR }, env, fakeCtx()), /refresh failed/);
});

test("site worker: data routes go to the DATA binding, the rest to static assets", async () => {
  const seen = [];
  const senv = {
    DATA: { fetch: (r) => (seen.push(["data", new URL(r.url).pathname]), new Response("d")) },
    ASSETS: { fetch: (r) => (seen.push(["assets", new URL(r.url).pathname]), new Response("a")) },
  };
  for (const p of ["/", "/assets/app-1.js", "/snapshot/tides", "/snapshot", "/forecast?lat=1", "/admin/refresh", "/snapshots-are-not-data"])
    await site.fetch(new Request(`https://bcw.test${p}`), senv);
  assert.deepEqual(seen, [
    ["assets", "/"], ["assets", "/assets/app-1.js"], ["data", "/snapshot/tides"], ["data", "/snapshot"],
    ["data", "/forecast"], ["data", "/admin/refresh"], ["assets", "/snapshots-are-not-data"],
  ]);
});
