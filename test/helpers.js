// Test doubles for the Workers runtime: Cache API, R2, ExecutionContext and
// an upstream `fetch` that serves fixtures instead of hitting the agencies.

import { readFileSync } from "node:fs";

export const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

export class FakeCache {
  constructor() { this.store = new Map(); }
  async match(req) {
    const e = this.store.get(typeof req === "string" ? req : req.url);
    return e ? new Response(e.body, { headers: e.headers }) : undefined;
  }
  async put(req, res) {
    this.store.set(typeof req === "string" ? req : req.url, { body: await res.text(), headers: Object.fromEntries(res.headers) });
  }
}

export class FakeR2 {
  constructor() { this.objects = new Map(); this.puts = 0; }
  async get(key) {
    const o = this.objects.get(key);
    return o ? { text: async () => o.body, customMetadata: o.customMetadata } : null;
  }
  async head(key) { return this.objects.get(key) ? { customMetadata: this.objects.get(key).customMetadata } : null; }
  async put(key, body, opts = {}) { this.puts++; this.objects.set(key, { body, customMetadata: opts.customMetadata }); }
}

export function fakeCtx() {
  const tasks = [];
  return { waitUntil: (p) => tasks.push(p), passThroughOnException() {}, settle: () => Promise.allSettled(tasks), tasks };
}

export function installCaches() {
  const cache = new FakeCache();
  globalThis.caches = { default: cache };
  return cache;
}

// ---- upstream fixtures ----

const t0 = Date.UTC(2026, 10, 19, 6, 0);
const coopsT = (ms) => new Date(ms).toISOString().slice(0, 16).replace("T", " ");
const steps = (n, every = 6) => Array.from({ length: n }, (_, i) => t0 + i * every * 60e3);

export const UPSTREAM = {
  water_level: { data: steps(10).map((t, i) => ({ t: coopsT(t), v: String(3 + i * 0.1), s: "0.01", f: "0,0,0,0", q: "p" })) },
  predictions: { predictions: steps(20).map((t, i) => ({ t: coopsT(t), v: String(2.5 + i * 0.1) })) },
  hilo: { predictions: [{ t: coopsT(t0 + 3 * 3600e3), v: "5.3", type: "H" }, { t: coopsT(t0 + 9 * 3600e3), v: "1.7", type: "L" }] },
  water_temperature: { data: [{ t: coopsT(t0), v: "58.3", f: "0,0,0" }] },
  monthly_mean: { data: [{ year: "2026", month: "9", MSL: "0.9" }, { year: "2026", month: "10", MSL: "1.1" }] },
  observation: (id) => ({
    geometry: { coordinates: [-122.4, 37.6] },
    properties: { stationName: `Station ${id}`, timestamp: new Date(t0).toISOString(), textDescription: "Cloudy",
      temperature: { value: 12 }, windSpeed: { value: 20 }, windGust: { value: null }, windDirection: { value: 270 },
      barometricPressure: { value: 101300 }, precipitationLastHour: { value: null } },
  }),
  alerts: {
    features: [
      { geometry: null, properties: { id: "a1", senderName: "NWS San Francisco CA", event: "Small Craft Advisory", affectedZones: ["https://api.weather.gov/zones/forecast/PZZ530", "https://api.weather.gov/zones/forecast/PZZ535"], areaDesc: "SF Bay", description: "Winds." } },
      { geometry: { type: "Polygon", coordinates: [[[-122, 37], [-121.9, 37], [-121.9, 37.1], [-122, 37]]] }, properties: { id: "a2", senderName: "NWS San Francisco CA", event: "Flood Warning", affectedZones: [], areaDesc: "Santa Clara" } },
      { geometry: null, properties: { id: "x", senderName: "NWS Los Angeles CA", event: "Wind Advisory", affectedZones: [] } },
    ],
  },
  zone: (id) => ({ geometry: { type: "Polygon", coordinates: [[[-122.5, 37.7], [-122.3, 37.7], [-122.3, 37.9], [-122.5, 37.9], [-122.5, 37.7]]] }, properties: { id } }),
  point: { properties: { forecast: "https://api.weather.gov/gridpoints/MTR/85,105/forecast", relativeLocation: { properties: { city: "San Francisco", state: "CA" } } } },
  forecast: { properties: { periods: Array.from({ length: 10 }, (_, i) => ({ name: `P${i}`, temperature: 55 + i, shortForecast: "Rain", windSpeed: "10 mph", windDirection: "W", detailedForecast: "long text" })) } },
};

/**
 * Install a fake global fetch. `fail` is a predicate on the URL that forces a
 * 503 for matching requests. Returns the list of URLs requested.
 */
export function installUpstream({ fail = () => false } = {}) {
  const calls = [];
  const ok = (body, type = "application/json") => new Response(typeof body === "string" ? body : JSON.stringify(body), { headers: { "Content-Type": type } });
  globalThis.fetch = async (input, init) => {
    const url = String(input?.url || input);
    calls.push({ url, headers: init?.headers });
    if (fail(url)) return new Response("down", { status: 503 });
    const u = new URL(url);
    if (u.host === "api.tidesandcurrents.noaa.gov") {
      const product = u.searchParams.get("product");
      if (product === "predictions") return ok(u.searchParams.get("interval") === "hilo" ? UPSTREAM.hilo : UPSTREAM.predictions);
      return ok(UPSTREAM[product]);
    }
    if (u.host === "www.ndbc.noaa.gov") return ok(fixture("ndbc-46026.txt"), "text/plain");
    if (u.pathname.endsWith("oni.ascii.txt")) return ok(fixture("oni.ascii.txt"), "text/plain");
    if (u.pathname.endsWith("wksst9120.for")) return ok(fixture("wksst9120.for"), "text/plain");
    if (u.host === "api.weather.gov") {
      let m;
      if ((m = u.pathname.match(/^\/stations\/(\w+)\/observations\/latest$/))) return ok(UPSTREAM.observation(m[1]));
      if (u.pathname === "/alerts/active") return ok(UPSTREAM.alerts);
      if ((m = u.pathname.match(/^\/zones\/forecast\/(\w+)$/))) return ok(UPSTREAM.zone(m[1]));
      if (u.pathname.startsWith("/points/")) {
        const [lat, lon] = u.pathname.slice(8).split(",").map(Number);
        return lon < -123 ? new Response("{}", { status: 404 }) : ok(UPSTREAM.point);
      }
      if (u.pathname.endsWith("/forecast")) return ok(UPSTREAM.forecast);
    }
    return new Response("no fixture for " + url, { status: 404 });
  };
  return calls;
}
