// NWS api.weather.gov: latest station observations, active alerts (with zone
// geometry for alerts that have no polygon of their own) and point forecasts.

import { round } from "../../../../shared/series.js";
import { simplifyGeometry } from "../geo.js";

const API = "https://api.weather.gov";
const DAY = 86_400;

const cToF = (c) => (c == null ? null : round((c * 9) / 5 + 32, 1));
const kmhToMph = (k) => (k == null ? null : round(k * 0.621371, 1));

export function normalizeObservation(id, j) {
  const p = j.properties;
  const [lon, lat] = j.geometry.coordinates;
  return {
    id,
    name: p.stationName || id,
    lon,
    lat,
    t: Date.parse(p.timestamp),
    text: p.textDescription,
    tempF: cToF(p.temperature?.value),
    windMph: kmhToMph(p.windSpeed?.value),
    gustMph: kmhToMph(p.windGust?.value),
    windDir: p.windDirection?.value ?? null,
    pressureMb: p.barometricPressure?.value != null ? round(p.barometricPressure.value / 100, 1) : null,
    precipLastHourIn: p.precipitationLastHour?.value != null ? round(p.precipitationLastHour.value / 25.4, 2) : null,
  };
}

export const fetchObservation = async (up, id) =>
  normalizeObservation(id, await up.json(`${API}/stations/${id}/observations/latest`));

export function alertKind(event = "") {
  if (/warning/i.test(event)) return "warning";
  if (/watch/i.test(event)) return "watch";
  if (/advisory/i.test(event)) return "advisory";
  return "statement";
}

/**
 * Active alerts for the Bay Area office, shaped to keep the payload small:
 *   items     full text, once per alert
 *   zones     simplified zone geometry, once per zone (alerts share zones)
 *   features  one per (alert, area): { geometry } for alerts with their own
 *             polygon, or { zone } pointing into `zones`. The browser expands
 *             these into a GeoJSON FeatureCollection.
 */
export async function fetchAlerts(up, region) {
  const j = await up.json(`${API}/alerts/active?area=${region.alertArea}`);
  const mine = j.features.filter((f) => region.alertSender.test(f.properties.senderName || ""));
  const rank = { statement: 0, advisory: 1, watch: 2, warning: 3 };
  const items = {};
  const zoneUrls = new Set();
  const features = [];
  for (const f of mine) {
    const p = f.properties;
    const kind = alertKind(p.event);
    items[p.id] = {
      event: p.event,
      severity: p.severity,
      headline: p.headline,
      description: p.description,
      instruction: p.instruction,
      areaDesc: p.areaDesc,
      onset: p.onset,
      ends: p.ends || p.expires,
      kind,
    };
    const props = { id: p.id, event: p.event, kind, areaDesc: p.areaDesc };
    if (f.geometry) features.push({ geometry: simplifyGeometry(f.geometry, 0.0005), properties: props });
    else for (const z of p.affectedZones || []) { zoneUrls.add(z); features.push({ zone: zoneId(z), properties: props }); }
  }
  const zones = {};
  await Promise.all(
    [...zoneUrls].map(async (z) => {
      const g = await up.cachedJSON(z, DAY).then((zj) => simplifyGeometry(zj.geometry)).catch(() => null);
      if (g) zones[zoneId(z)] = g;
    })
  );
  const drawn = features.filter((f) => f.geometry || zones[f.zone]);
  // Lower-priority alerts first so warnings draw on top.
  drawn.sort((a, b) => rank[a.properties.kind] - rank[b.properties.kind]);
  return { count: mine.length, items, zones, features: drawn };
}

const zoneId = (url) => url.split("/").slice(-2).join("/"); // "forecast/CAZ006"

/**
 * Point forecast. The /points lookup (grid metadata) is effectively static and
 * cached for a week; the forecast itself is cached by the caller (30 min).
 * Offshore points have no forecast: NWS answers 404, which we report as
 * `{ unavailable: true }` so it can be cached like any other answer.
 */
export async function fetchPointForecast(up, lat, lon) {
  let p, fc;
  try {
    p = (await up.cachedJSON(`${API}/points/${lat.toFixed(4)},${lon.toFixed(4)}`, 7 * DAY)).properties;
    // Offshore grid cells can resolve but have no forecast (also a 404).
    fc = await up.json(p.forecast);
  } catch (e) {
    if (e.status === 404) return { unavailable: true };
    throw e;
  }
  const rl = p.relativeLocation?.properties;
  return {
    place: [rl?.city, rl?.state].filter(Boolean).join(", "),
    periods: fc.properties.periods.slice(0, 7).map((x) => ({
      name: x.name,
      temperature: x.temperature,
      shortForecast: x.shortForecast,
      windSpeed: x.windSpeed,
      windDirection: x.windDirection,
    })),
  };
}
