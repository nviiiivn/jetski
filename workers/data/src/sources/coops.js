// NOAA CO-OPS (Tides & Currents): water level, predictions, water temperature
// and monthly mean sea level.

import { encodeSeries, round } from "../../../../shared/series.js";

const BASE = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter";
const pad = (n) => String(n).padStart(2, "0");

// CO-OPS wants "yyyyMMdd HH:mm"; we always ask in GMT.
export const coopsDate = (d) =>
  `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
export const parseCoopsTime = (t) => Date.parse(t.replace(" ", "T") + ":00Z");

/** Round down to the 6-minute CO-OPS sampling boundary. */
export function nowRounded(now = Date.now()) {
  const d = new Date(now);
  d.setUTCSeconds(0, 0);
  d.setUTCMinutes(d.getUTCMinutes() - (d.getUTCMinutes() % 6));
  return d;
}

export function coopsURL(params) {
  const q = new URLSearchParams({
    units: "english",
    time_zone: "gmt",
    format: "json",
    application: "bay_coast_watch",
    ...params,
  });
  return `${BASE}?${q}`;
}

async function coops(up, params) {
  const j = await up.json(coopsURL(params));
  if (j.error) throw new Error(j.error.message);
  return j;
}

/** Pure: turn raw CO-OPS responses into the compact tide-station record. */
export function normalizeTide(st, { obs, pred, hilo, temp }) {
  const observed = (obs?.data || []).filter((d) => d.v !== "").map((d) => ({ t: parseCoopsTime(d.t), v: +d.v }));
  const predicted = (pred?.predictions || []).map((d) => ({ t: parseCoopsTime(d.t), v: +d.v }));
  const extremes = (hilo?.predictions || []).map((d) => ({ t: parseCoopsTime(d.t), v: round(+d.v, 2), type: d.type }));

  const latest = observed.at(-1) || null;
  let residual = null;
  if (latest && predicted.length) {
    const p = predicted.reduce((a, b) => (Math.abs(b.t - latest.t) < Math.abs(a.t - latest.t) ? b : a));
    residual = round(latest.v - p.v, 3);
  }
  const td = temp?.data?.[0];
  return {
    ...st,
    latest: latest && { t: latest.t, v: round(latest.v, 2) },
    residual,
    temp: td && td.v !== "" ? { t: parseCoopsTime(td.t), v: +td.v } : null,
    observed: encodeSeries(observed),
    predicted: encodeSeries(predicted),
    extremes,
  };
}

export async function fetchTideStation(up, st, now = Date.now()) {
  const n = nowRounded(now);
  const past = new Date(+n - 36 * 3600e3);
  const future = new Date(+n + 48 * 3600e3);
  const opt = (p) => coops(up, { station: st.id, ...p }).catch(() => null);
  const [obs, pred, hilo, temp] = await Promise.all([
    opt({ product: "water_level", datum: "MLLW", begin_date: coopsDate(past), end_date: coopsDate(n) }),
    opt({ product: "predictions", datum: "MLLW", interval: "6", begin_date: coopsDate(past), end_date: coopsDate(future) }),
    opt({ product: "predictions", datum: "MLLW", interval: "hilo", begin_date: coopsDate(n), end_date: coopsDate(future) }),
    opt({ product: "water_temperature", date: "latest" }),
  ]);
  if (!obs && !pred) throw new Error(`no CO-OPS data for ${st.id}`);
  return normalizeTide(st, { obs, pred, hilo, temp });
}

/**
 * Monthly mean sea level relative to the station's MSL datum (the 1983–2001
 * National Tidal Datum Epoch). Positive = running above the long-term mean,
 * a classic West Coast El Niño signature.
 */
export function normalizeMonthly(j) {
  return (j.data || [])
    .filter((d) => d.MSL !== "")
    .map((d) => ({ t: Date.UTC(+d.year, +d.month - 1, 15), v: +d.MSL }));
}

export async function fetchMonthlyMean(up, st, now = Date.now()) {
  const end = new Date(now);
  const begin = new Date(Date.UTC(end.getUTCFullYear() - 3, end.getUTCMonth(), 1));
  const ymd = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}01`;
  const j = await coops(up, { station: st.id, product: "monthly_mean", datum: "MSL", begin_date: ymd(begin), end_date: ymd(end) });
  return normalizeMonthly(j);
}
