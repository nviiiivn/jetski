// Data fetching + parsing for every source. All requests go through the local
// caching proxy at /api/* (see server.js).

// ---------- Station catalogs ----------

export const TIDE_STATIONS = [
  { id: "9415020", name: "Point Reyes", lon: -122.9736, lat: 37.9942 },
  { id: "9414290", name: "San Francisco (Golden Gate)", lon: -122.4659, lat: 37.8063 },
  { id: "9414863", name: "Richmond", lon: -122.4, lat: 37.9283 },
  { id: "9414750", name: "Alameda", lon: -122.3003, lat: 37.772 },
  { id: "9414523", name: "Redwood City", lon: -122.2119, lat: 37.5068 },
  { id: "9415102", name: "Martinez-Amorco Pier", lon: -122.1252, lat: 38.0346 },
  { id: "9415144", name: "Port Chicago", lon: -122.0395, lat: 38.056 },
  { id: "9413450", name: "Monterey", lon: -121.8914, lat: 36.6089 },
];

export const BUOYS = [
  { id: "46013", name: "Bodega Bay", lon: -123.317, lat: 38.235 },
  { id: "46214", name: "Point Reyes", lon: -123.466, lat: 37.944 },
  { id: "46026", name: "San Francisco", lon: -122.838, lat: 37.75 },
  { id: "46237", name: "San Francisco Bar", lon: -122.634, lat: 37.788 },
  { id: "46012", name: "Half Moon Bay", lon: -122.881, lat: 37.356 },
  { id: "46042", name: "Monterey", lon: -122.408, lat: 36.787 },
  { id: "46236", name: "Monterey Canyon Outer", lon: -121.95, lat: 36.759 },
];

export const WX_STATIONS = [
  "KSTS", "KAPC", "KDVO", "KCCR", "KSFO", "KOAK", "KHWD", "KLVK",
  "KHAF", "KPAO", "KNUQ", "KSJC", "KMRY",
];

// ---------- helpers ----------

async function getJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}
async function getText(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.text();
}

const pad = (n) => String(n).padStart(2, "0");
// CO-OPS wants "yyyyMMdd HH:mm" (we always ask in GMT)
const coopsDate = (d) =>
  `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())} ${pad(
    d.getUTCHours()
  )}:${pad(d.getUTCMinutes())}`;
const parseCoopsTime = (t) => new Date(t.replace(" ", "T") + ":00Z");

function coops(params) {
  const q = new URLSearchParams({
    units: "english",
    time_zone: "gmt",
    format: "json",
    application: "bay_coast_dashboard",
    ...params,
  });
  // Round the cache key: stable URLs within a few minutes = proxy cache hits.
  return getJSON(`/api/coops/api/prod/datagetter?${q}`).then((j) => {
    if (j.error) throw new Error(j.error.message);
    return j;
  });
}

// Round "now" down to 6-minute boundary so URLs stay cacheable.
function nowRounded() {
  const d = new Date();
  d.setUTCSeconds(0, 0);
  d.setUTCMinutes(d.getUTCMinutes() - (d.getUTCMinutes() % 6));
  return d;
}

// ---------- CO-OPS: tides, water temp, monthly mean sea level ----------

export async function fetchTideStation(st) {
  const now = nowRounded();
  const past = new Date(now - 36 * 3600e3);
  const future = new Date(+now + 48 * 3600e3);

  const [obs, pred, hilo] = await Promise.all([
    coops({
      station: st.id,
      product: "water_level",
      datum: "MLLW",
      begin_date: coopsDate(past),
      end_date: coopsDate(now),
    }).catch(() => null),
    coops({
      station: st.id,
      product: "predictions",
      datum: "MLLW",
      interval: "6",
      begin_date: coopsDate(past),
      end_date: coopsDate(future),
    }).catch(() => null),
    coops({
      station: st.id,
      product: "predictions",
      datum: "MLLW",
      interval: "hilo",
      begin_date: coopsDate(now),
      end_date: coopsDate(future),
    }).catch(() => null),
  ]);

  const observed = (obs?.data || [])
    .filter((d) => d.v !== "")
    .map((d) => ({ t: parseCoopsTime(d.t), v: +d.v }));
  const predicted = (pred?.predictions || []).map((d) => ({
    t: parseCoopsTime(d.t),
    v: +d.v,
  }));
  const extremes = (hilo?.predictions || []).map((d) => ({
    t: parseCoopsTime(d.t),
    v: +d.v,
    type: d.type,
  }));

  const latest = observed.at(-1) || null;
  let residual = null;
  if (latest && predicted.length) {
    const p = predicted.find((x) => +x.t === +latest.t) ||
      predicted.reduce((a, b) =>
        Math.abs(b.t - latest.t) < Math.abs(a.t - latest.t) ? b : a
      );
    residual = latest.v - p.v;
  }
  return { ...st, observed, predicted, extremes, latest, residual };
}

export async function fetchWaterTemp(st) {
  const j = await coops({
    station: st.id,
    product: "water_temperature",
    date: "latest",
  });
  const d = j.data?.[0];
  if (!d || d.v === "") throw new Error("no temp");
  return { t: parseCoopsTime(d.t), v: +d.v };
}

// Monthly mean sea level relative to the station's MSL datum (the 1983–2001
// National Tidal Datum Epoch). Positive = sea level running higher than the
// long-term mean — a classic West Coast El Niño signature.
export async function fetchMonthlyMean(st) {
  const end = new Date();
  const begin = new Date(end.getUTCFullYear() - 3, end.getUTCMonth(), 1);
  const ymd = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}01`;
  const j = await coops({
    station: st.id,
    product: "monthly_mean",
    datum: "MSL",
    begin_date: ymd(begin),
    end_date: ymd(end),
  });
  return (j.data || [])
    .filter((d) => d.MSL !== "")
    .map((d) => ({
      t: new Date(Date.UTC(+d.year, +d.month - 1, 15)),
      v: +d.MSL,
    }));
}

// ---------- NDBC buoys ----------

const NDBC_COLS = [
  "YY", "MM", "DD", "hh", "mm", "WDIR", "WSPD", "GST", "WVHT", "DPD",
  "APD", "MWD", "PRES", "ATMP", "WTMP", "DEWP", "VIS", "PTDY", "TIDE",
];

export async function fetchBuoy(b) {
  const txt = await getText(`/api/ndbc/data/realtime2/${b.id}.txt`);
  const rows = txt
    .split("\n")
    .filter((l) => l && !l.startsWith("#"))
    .slice(0, 24 * 6 * 3) // ~3 days of 10-min data (newest first)
    .map((l) => {
      const parts = l.trim().split(/\s+/);
      const o = {};
      NDBC_COLS.forEach((c, i) => {
        const v = parts[i];
        o[c] = v === undefined || v === "MM" ? null : +v;
      });
      o.t = new Date(Date.UTC(o.YY, o.MM - 1, o.DD, o.hh, o.mm));
      return o;
    })
    .reverse();
  const lastOf = (k) => {
    for (let i = rows.length - 1; i >= 0; i--)
      if (rows[i][k] != null) return { t: rows[i].t, v: rows[i][k] };
    return null;
  };
  const toF = (c) => (c == null ? null : c * 9 / 5 + 32);
  const sst = lastOf("WTMP");
  const wvht = lastOf("WVHT");
  return {
    ...b,
    rows,
    sstF: sst ? toF(sst.v) : null,
    waveFt: wvht ? wvht.v * 3.28084 : null,
    period: lastOf("DPD")?.v ?? null,
    windKt: lastOf("WSPD") ? lastOf("WSPD").v * 1.94384 : null,
    windDir: lastOf("WDIR")?.v ?? null,
    updated: rows.at(-1)?.t ?? null,
    series: {
      sstF: rows.filter((r) => r.WTMP != null).map((r) => ({ t: r.t, v: toF(r.WTMP) })),
      waveFt: rows.filter((r) => r.WVHT != null).map((r) => ({ t: r.t, v: r.WVHT * 3.28084 })),
    },
  };
}

// ---------- NWS ----------

export async function fetchObservation(id) {
  const j = await getJSON(`/api/nws/stations/${id}/observations/latest`);
  const p = j.properties;
  const [lon, lat] = j.geometry.coordinates;
  const cToF = (c) => (c == null ? null : c * 9 / 5 + 32);
  const kmhToMph = (k) => (k == null ? null : k * 0.621371);
  return {
    id,
    name: p.stationName || id,
    lon,
    lat,
    t: new Date(p.timestamp),
    text: p.textDescription,
    tempF: cToF(p.temperature?.value),
    windMph: kmhToMph(p.windSpeed?.value),
    gustMph: kmhToMph(p.windGust?.value),
    windDir: p.windDirection?.value,
    pressureMb: p.barometricPressure?.value != null ? p.barometricPressure.value / 100 : null,
    precipLastHourIn:
      p.precipitationLastHour?.value != null ? p.precipitationLastHour.value / 25.4 : null,
  };
}

const zoneCache = new Map();
async function zoneGeometry(url) {
  if (!zoneCache.has(url)) {
    const path = url.replace("https://api.weather.gov/", "/api/nws/");
    zoneCache.set(
      url,
      getJSON(path)
        .then((j) => j.geometry)
        .catch(() => null)
    );
  }
  return zoneCache.get(url);
}

// Active alerts issued by the NWS Bay Area office (San Francisco/Monterey),
// land + coastal waters. Alerts without their own polygon are drawn using the
// geometry of the forecast zones they apply to.
export async function fetchAlerts() {
  const j = await getJSON(`/api/nws/alerts/active?area=CA,PZ`);
  const mine = j.features.filter((f) =>
    /San Francisco|Monterey/i.test(f.properties.senderName || "")
  );
  const out = [];
  await Promise.all(
    mine.map(async (f) => {
      const p = f.properties;
      const props = {
        id: p.id,
        event: p.event,
        severity: p.severity,
        headline: p.headline,
        description: p.description,
        instruction: p.instruction,
        areaDesc: p.areaDesc,
        onset: p.onset,
        ends: p.ends || p.expires,
        kind: alertKind(p.event),
      };
      if (f.geometry) {
        out.push({ type: "Feature", geometry: f.geometry, properties: props });
        return;
      }
      const geoms = await Promise.all((p.affectedZones || []).map(zoneGeometry));
      for (const g of geoms)
        if (g) out.push({ type: "Feature", geometry: g, properties: props });
    })
  );
  // Draw lower-priority alerts first so warnings sit on top.
  const rank = { statement: 0, advisory: 1, watch: 2, warning: 3 };
  out.sort((a, b) => rank[a.properties.kind] - rank[b.properties.kind]);
  return { type: "FeatureCollection", features: out, count: mine.length, raw: mine };
}

function alertKind(event = "") {
  if (/warning/i.test(event)) return "warning";
  if (/watch/i.test(event)) return "watch";
  if (/advisory/i.test(event)) return "advisory";
  return "statement";
}

export async function fetchPointForecast(lon, lat) {
  const pt = await getJSON(`/api/nws/points/${lat.toFixed(4)},${lon.toFixed(4)}`);
  const p = pt.properties;
  const fc = await getJSON(p.forecast.replace("https://api.weather.gov/", "/api/nws/"));
  return {
    place: `${p.relativeLocation?.properties?.city ?? ""}, ${
      p.relativeLocation?.properties?.state ?? ""
    }`,
    periods: fc.properties.periods,
  };
}

// ---------- CPC: El Niño / ENSO ----------

// Oceanic Niño Index — 3-month running mean SST anomaly in Niño 3.4.
export async function fetchONI() {
  const txt = await getText(`/api/cpc/data/indices/oni.ascii.txt`);
  const seasons = ["DJF", "JFM", "FMA", "MAM", "AMJ", "MJJ", "JJA", "JAS", "ASO", "SON", "OND", "NDJ"];
  return txt
    .split("\n")
    .slice(1)
    .map((l) => l.trim().split(/\s+/))
    .filter((p) => p.length === 4)
    .map(([seas, yr, , anom]) => ({
      season: seas,
      year: +yr,
      // center month of the 3-month season
      t: new Date(Date.UTC(+yr, seasons.indexOf(seas), 15)),
      v: +anom,
    }));
}

// Weekly OISST anomalies for Niño 1+2, 3, 3.4, 4.
export async function fetchWeeklyNino() {
  const txt = await getText(`/api/cpc/data/indices/wksst9120.for`);
  const months = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
  return txt
    .split("\n")
    .map((l) => l.match(/^\s*(\d{2})([A-Z]{3})(\d{4})(.*)$/))
    .filter(Boolean)
    .map(([, d, m, y, rest]) => {
      const n = (rest.match(/-?\d+\.\d/g) || []).map(Number);
      return {
        t: new Date(Date.UTC(+y, months[m], +d)),
        nino12: n[1],
        nino3: n[3],
        nino34: n[5],
        nino4: n[7],
      };
    })
    .filter((r) => r.nino34 != null);
}

export function ensoPhase(v) {
  if (v >= 2.0) return { label: "Very strong El Niño", cls: "hot" };
  if (v >= 1.5) return { label: "Strong El Niño", cls: "hot" };
  if (v >= 1.0) return { label: "Moderate El Niño", cls: "warm" };
  if (v >= 0.5) return { label: "Weak El Niño", cls: "warm" };
  if (v > -0.5) return { label: "ENSO-neutral", cls: "neutral" };
  if (v > -1.0) return { label: "Weak La Niña", cls: "cool" };
  if (v > -1.5) return { label: "Moderate La Niña", cls: "cool" };
  return { label: "Strong La Niña", cls: "cold" };
}
