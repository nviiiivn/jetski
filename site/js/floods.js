// tides.alola.lol (2026-11-24): flood helpers for the page.
//
// NOAA's Sea Level Rise Viewer publishes, for every half foot of water above normal high tide (MHHW, 0 to 10 ft),
// a map of the land that water reaches: blue = connected to the sea (it floods), green = low ground behind
// something (levee, road, seawall) that can still flood through drains or gaps. Those maps are a model of ground
// height, not a report of water on the street; "Flood reports" are the real sightings.

const SLR = "https://coast.noaa.gov/arcgis/rest/services/dc_slr";
export const FLOOD_LEVELS = Array.from({ length: 21 }, (_, i) => i / 2); // 0, 0.5 … 10 ft above MHHW
const slug = (lv) => (Number.isInteger(lv) ? `${lv}ft` : `${Math.floor(lv)}_5ft`);
export const floodTiles = (lv) => [`${SLR}/slr_${slug(lv)}/MapServer/tile/{z}/{y}/{x}`];
export const snapLevel = (ft) => Math.min(10, Math.max(0, Math.round(ft * 2) / 2));

const R = 6371e3;
export function distM(aLon, aLat, bLon, bLat) {
  const r = Math.PI / 180, dLat = (bLat - aLat) * r, dLon = (bLon - aLon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
export const miles = (m) => (m < 1609 ? `${Math.round(m * 3.28084 / 10) * 10} ft` : `${(m / 1609.34).toFixed(m < 16093 ? 1 : 0)} mi`);

export function nearest(list, lon, lat, ok = () => true) {
  let best = null;
  for (const s of list) {
    if (!ok(s)) continue;
    const d = distM(lon, lat, s.lon, s.lat);
    if (!best || d < best.d) best = { s, d };
  }
  return best;
}

// Water at a gauge in feet above its normal high tide (MHHW), now and the highest expected in the next 48 h
// (forecast tide plus the surge the gauge shows right now, which is how NWS coastal flood outlooks reason too).
export function gaugeAboveHigh(s, now = Date.now()) {
  if (s?.mhhw == null) return null;
  const nowFt = s.latest ? s.latest.v - s.mhhw : null;
  const surge = s.residual ?? 0;
  let next = null;
  for (const p of s.predicted || []) {
    if (+p.t <= now || +p.t > now + 48 * 3600e3) continue;
    const v = p.v + surge - s.mhhw;
    if (!next || v > next.v) next = { t: p.t, v };
  }
  return { now: nowFt, next, surge };
}

// ---- point-in-polygon for alert areas ------------------------------------------------------------
function inRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const inPoly = (lon, lat, rings) => inRing(lon, lat, rings[0]) && !rings.slice(1).some((h) => inRing(lon, lat, h));
export function inGeometry(lon, lat, g) {
  if (!g) return false;
  if (g.type === "Polygon") return inPoly(lon, lat, g.coordinates);
  if (g.type === "MultiPolygon") return g.coordinates.some((p) => inPoly(lon, lat, p));
  if (g.type === "GeometryCollection") return g.geometries.some((x) => inGeometry(lon, lat, x));
  return false;
}

// ---- "how high does the water have to get before it reaches this spot?" ----------------------------
// Reads the colour of one pixel of NOAA's map tiles at zoom 16 (about 2 m per pixel), searching the
// half-foot steps. Returns { level, kind } with kind "water" (connected) or "low" (low-lying, behind a barrier),
// { level: null } when even 10 ft doesn't reach it, or null when the maps can't be read here.
const Z = 16;
function pixelOf(lon, lat) {
  const n = 2 ** Z * 256;
  const x = ((lon + 180) / 360) * n;
  const s = Math.sin((lat * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n;
  return { tx: Math.floor(x / 256), ty: Math.floor(y / 256), px: Math.floor(x % 256), py: Math.floor(y % 256) };
}
const cache = new Map();
function sample(lv, p) {
  const key = `${lv}/${p.tx}/${p.ty}/${p.px}/${p.py}`;
  if (cache.has(key)) return cache.get(key);
  const job = new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = c.height = 1;
        const g = c.getContext("2d", { willReadFrequently: true });
        g.drawImage(img, p.px, p.py, 1, 1, 0, 0, 1, 1);
        const [r, gr, b, a] = g.getImageData(0, 0, 1, 1).data;
        resolve(a < 40 ? "dry" : b >= gr ? "water" : "low");
      } catch { resolve("error"); }
    };
    img.onerror = () => resolve("dry"); // NOAA answers 404 for tiles with nothing on them
    img.src = floodTiles(lv)[0].replace("{z}", Z).replace("{y}", p.ty).replace("{x}", p.tx);
  });
  cache.set(key, job);
  return job;
}
export async function spotFloodLevel(lon, lat) {
  const p = pixelOf(lon, lat);
  const top = await sample(10, p);
  if (top === "error") return null;
  if (top === "dry") return { level: null };
  let lo = 0, hi = FLOOD_LEVELS.length - 1, kind = top; // invariant: FLOOD_LEVELS[hi] reaches the spot
  if ((await sample(0, p)) !== "dry") return { level: 0, kind: await sample(0, p) };
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    const k = await sample(FLOOD_LEVELS[mid], p);
    if (k === "dry" || k === "error") lo = mid; else { hi = mid; kind = k; }
  }
  return { level: FLOOD_LEVELS[hi], kind };
}
