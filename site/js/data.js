// Snapshot client. All fetching and parsing happens in the bcw-data Worker;
// the page just asks for a few pre-built, cached JSON snapshots grouped by how
// often the underlying data changes (see workers/data/src/groups.js).

import { decodeSeries } from "../../shared/series.js";

export const GROUPS = ["weather", "tides", "buoys", "climate", "floods"];

// Epoch-ms fields become Dates so the views and charts can use them directly.
const DATE_KEYS = new Set(["t", "updated", "generatedAt", "forecastT"]);
const revive = (k, v) => (DATE_KEYS.has(k) && typeof v === "number" ? new Date(v) : v);

async function getJSON(url, init) {
  const r = await fetch(url, init);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return JSON.parse(await r.text(), revive);
}

// The first request for each group is started by <link rel="preload"> in
// index.html, so it is usually already in flight (or done) by the time this
// runs. `force` bypasses the browser cache for the refresh button.
// tides.alola.lol: every request names the region picked in the header.
let REGION = "sfbay";
export const setRegion = (id) => { REGION = id; };

export async function fetchSnapshot(group, { force = false } = {}) {
  const snap = await getJSON(`/snapshot/${group}?region=${REGION}`, force ? { cache: "no-cache" } : undefined);
  return { generatedAt: snap.generatedAt, ...decode[group](snap.data) };
}

const decode = {
  weather: (d) => ({ stations: d.stations, alerts: d.alerts && expandAlerts(d.alerts) }),
  tides: (d) => ({
    stations: d.stations.map((s) => ({ ...s, observed: decodeSeries(s.observed), predicted: decodeSeries(s.predicted) })),
  }),
  buoys: (d) => ({
    buoys: d.buoys.map((b) => ({ ...b, series: { sstF: decodeSeries(b.series.sstF), waveFt: decodeSeries(b.series.waveFt) } })),
  }),
  floods: (d) => ({ reports: d.reports || [], rivers: d.rivers || { watched: 0, flooding: [] }, news: d.news || [], errors: d.errors || [] }),
  climate: (d) => ({
    phase: d.phase,
    oni: d.oni,
    weekly: d.weekly,
    monthly: d.monthly.map((s) => ({ ...s, series: decodeSeries(s.series) })),
  }),
};

// Alerts arrive with each zone's shape sent once; rebuild plain GeoJSON.
function expandAlerts(a) {
  return {
    type: "FeatureCollection",
    count: a.count,
    items: a.items,
    features: a.features.map((f) => ({ type: "Feature", geometry: f.geometry || a.zones[f.zone], properties: f.properties })),
  };
}

export async function fetchPointForecast(lon, lat) {
  const snap = await getJSON(`/forecast?lat=${lat.toFixed(2)}&lon=${lon.toFixed(2)}&region=${REGION}`);
  if (snap.data.unavailable) throw new Error("no forecast here");
  return snap.data;
}
