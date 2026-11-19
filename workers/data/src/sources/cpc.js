// NOAA Climate Prediction Center ENSO indices.

const SEASONS = ["DJF", "JFM", "FMA", "MAM", "AMJ", "MJJ", "JJA", "JAS", "ASO", "SON", "OND", "NDJ"];
const MONTHS = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };

/** Oceanic Niño Index — 3-month running mean SST anomaly in Niño 3.4. */
export function parseONI(txt) {
  return txt
    .split("\n")
    .slice(1)
    .map((l) => l.trim().split(/\s+/))
    .filter((p) => p.length === 4 && SEASONS.includes(p[0]))
    .map(([season, yr, , anom]) => ({
      season,
      year: +yr,
      t: Date.UTC(+yr, SEASONS.indexOf(season), 15), // centre month of the season
      v: +anom,
    }));
}

/** Weekly OISST anomalies for Niño 1+2, 3, 3.4 and 4 (fixed-width text). */
export function parseWeekly(txt) {
  return txt
    .split("\n")
    .map((l) => l.match(/^\s*(\d{2})([A-Z]{3})(\d{4})(.*)$/))
    .filter(Boolean)
    .map(([, d, m, y, rest]) => {
      const n = (rest.match(/-?\d+\.\d/g) || []).map(Number);
      return { t: Date.UTC(+y, MONTHS[m], +d), nino12: n[1], nino3: n[3], nino34: n[5], nino4: n[7] };
    })
    .filter((r) => r.nino34 != null);
}

export function ensoPhase(v) {
  if (v == null || !Number.isFinite(v)) return { label: "Unavailable", cls: "neutral" };
  if (v >= 2.0) return { label: "Very strong El Niño", cls: "hot" };
  if (v >= 1.5) return { label: "Strong El Niño", cls: "hot" };
  if (v >= 1.0) return { label: "Moderate El Niño", cls: "warm" };
  if (v >= 0.5) return { label: "Weak El Niño", cls: "warm" };
  if (v > -0.5) return { label: "ENSO-neutral", cls: "neutral" };
  if (v > -1.0) return { label: "Weak La Niña", cls: "cool" };
  if (v > -1.5) return { label: "Moderate La Niña", cls: "cool" };
  return { label: "Strong La Niña", cls: "cold" };
}

export const fetchONI = async (up) => parseONI(await up.text("https://www.cpc.ncep.noaa.gov/data/indices/oni.ascii.txt"));
export const fetchWeekly = async (up) => parseWeekly(await up.text("https://www.cpc.ncep.noaa.gov/data/indices/wksst9120.for"));
