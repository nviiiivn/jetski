// NOAA NDBC buoys: realtime2 standard meteorological text files.

import { encodeSeries, round } from "../../../../shared/series.js";

const COLS = ["YY", "MM", "DD", "hh", "mm", "WDIR", "WSPD", "GST", "WVHT", "DPD", "APD", "MWD", "PRES", "ATMP", "WTMP", "DEWP", "VIS", "PTDY", "TIDE"];
const toF = (c) => (c == null ? null : (c * 9) / 5 + 32);
const M_TO_FT = 3.28084;
const MS_TO_KT = 1.94384;

/** Pure: parse a realtime2 .txt file into oldest-first rows (≈3 days). */
export function parseNdbc(txt, maxRows = 24 * 6 * 3) {
  return txt
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith("#"))
    .slice(0, maxRows)
    .map((l) => {
      const parts = l.trim().split(/\s+/);
      const o = {};
      COLS.forEach((c, i) => {
        const v = parts[i];
        o[c] = v === undefined || v === "MM" ? null : +v;
      });
      o.t = Date.UTC(o.YY, o.MM - 1, o.DD, o.hh, o.mm);
      return o;
    })
    .reverse();
}

export function summarizeBuoy(b, rows) {
  const lastOf = (k) => {
    for (let i = rows.length - 1; i >= 0; i--) if (rows[i][k] != null) return rows[i][k];
    return null;
  };
  const sst = lastOf("WTMP");
  const wvht = lastOf("WVHT");
  const wspd = lastOf("WSPD");
  return {
    ...b,
    sstF: round(toF(sst), 1),
    waveFt: wvht == null ? null : round(wvht * M_TO_FT, 1),
    period: lastOf("DPD"),
    windKt: wspd == null ? null : round(wspd * MS_TO_KT, 1),
    windDir: lastOf("WDIR"),
    // 2026-11-24: water level (NDBC "TIDE", feet, as the station reports it). Only gauge-style stations, such as the
    // Everglades National Park ones on Florida Bay, send it; null everywhere else.
    levelFt: round(lastOf("TIDE"), 2),
    updated: rows.at(-1)?.t ?? null,
    series: {
      sstF: encodeSeries(rows.filter((r) => r.WTMP != null).map((r) => ({ t: r.t, v: toF(r.WTMP) })), 1),
      waveFt: encodeSeries(rows.filter((r) => r.WVHT != null).map((r) => ({ t: r.t, v: r.WVHT * M_TO_FT })), 1),
      levelFt: encodeSeries(rows.filter((r) => r.TIDE != null).map((r) => ({ t: r.t, v: r.TIDE })), 2),
    },
  };
}

export async function fetchBuoy(up, b) {
  const txt = await up.text(`https://www.ndbc.noaa.gov/data/realtime2/${b.id}.txt`);
  const rows = parseNdbc(txt);
  if (!rows.length) throw new Error(`no NDBC rows for ${b.id}`);
  return summarizeBuoy(b, rows);
}
