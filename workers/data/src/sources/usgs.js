// USGS Water Services instantaneous values: creek, river, canal and Bay gauges (tides.alola.lol, 2026-11-24, her ask:
// "more gauges around the cities"). One request per region covers every gauge in its list.
//   00065 gage height (ft, against each gauge's own datum, so compare a gauge with itself, not with another)
//   00060 discharge (ft³/s), where the site measures it
// Docs: https://waterservices.usgs.gov/docs/instantaneous-values/

import { encodeSeries, round } from "../../../../shared/series.js";

const BASE = "https://waterservices.usgs.gov/nwis/iv/";

export function usgsURL(ids, period = "P1D") {
  const q = new URLSearchParams({ format: "json", sites: ids.join(","), parameterCd: "00065,00060", period, siteStatus: "all" });
  return `${BASE}?${q}`;
}

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > -999999 ? n : null; // USGS uses -999999 for "no value"
};

/** Pure: USGS IV JSON -> one record per listed gauge (gauges without data are left out). */
export function parseUsgs(json, gauges) {
  const byId = new Map(gauges.map((g) => [g.id, { ...g, stageFt: null, flowCfs: null, updated: null, series: {} }]));
  for (const ts of json?.value?.timeSeries || []) {
    const id = ts.sourceInfo?.siteCode?.[0]?.value;
    const rec = byId.get(id);
    if (!rec) continue;
    const code = ts.variable?.variableCode?.[0]?.value;
    const pts = (ts.values || [])
      .flatMap((b) => b.value || [])
      .map((p) => ({ t: Date.parse(p.dateTime), v: num(p.value) }))
      .filter((p) => Number.isFinite(p.t) && p.v != null)
      .sort((a, b) => a.t - b.t);
    if (!pts.length) continue;
    const last = pts.at(-1);
    if (code === "00065") {
      rec.stageFt = round(last.v, 2);
      rec.series.stageFt = encodeSeries(pts, 2);
      // change over the last 24 h, so a reader sees rising or falling without knowing the gauge's datum
      rec.change24hFt = round(last.v - pts[0].v, 2);
    } else if (code === "00060") {
      rec.flowCfs = round(last.v, 0);
    }
    rec.updated = Math.max(rec.updated || 0, last.t);
  }
  return [...byId.values()].filter((r) => r.updated);
}

export async function fetchGauges(up, gauges) {
  if (!gauges?.length) return [];
  const json = await up.json(usgsURL(gauges.map((g) => g.id)));
  const out = parseUsgs(json, gauges);
  if (!out.length) throw new Error("USGS: no gauge reported");
  return out;
}
