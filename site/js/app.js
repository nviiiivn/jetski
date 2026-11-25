import { baseStyle, lightStyle } from "./map-style.js";
import { lineChart } from "./charts.js";
import { GROUPS, fetchSnapshot, fetchPointForecast, setRegion } from "./data.js";
import { REGIONS, DEFAULT_REGION } from "../../shared/stations.js";
import { FLOOD_LEVELS, floodTiles, snapLevel, nearest, gaugeAboveHigh, inGeometry, spotFloodLevel, distM, miles } from "./floods.js";

// ---------- region + timeline (tides.alola.lol, 2026-11-24) ----------
// Region: ?region= in the address, else the last one picked in this browser, else SF Bay.
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } },
};
const REGION = REGIONS[new URLSearchParams(location.search).get("region")] || REGIONS[store.get("tides-region")] || REGIONS[DEFAULT_REGION];
setRegion(REGION.id);
store.set("tides-region", REGION.id);

// Theme: light unless the viewer picked dark here, or picked a dark theme on alola.lol (cookie alola-theme).
const THEME = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
const INK = THEME === "light"
  ? { text: "#16202c", halo: "#ffffff", stroke: "#ffffff", wx: "#3b4655", ring: "#16202c", buoyArrow: "#0b7a8c" }
  : { text: "#e6eaf0", halo: "#0d1117", stroke: "#0d1117", wx: "#d7dde7", ring: "#e6eaf0", buoyArrow: "#9fe6f2" };

// Timeline: how far back every chart and "highest" figure looks.
const RANGES = { "1h": 1, "6h": 6, "24h": 24, "3d": 72 };
const RANGE_LABEL = { "1h": "1 hour", "6h": "6 hours", "24h": "24 hours", "3d": "3 days" };
let range = RANGES[store.get("tides-range")] ? store.get("tides-range") : "24h";
const rangeMs = () => RANGES[range] * 3600e3;
const inWindow = (data, t0, t1 = Infinity) => (data || []).filter((d) => +d.t >= t0 && +d.t <= t1);

// Snapshots are cached server-side per data type, so polling is cheap.
const REFRESH_MS = 5 * 60 * 1000;
const $ = (s) => document.querySelector(s);
const fmt = (v, d = 1) => (v == null || !isFinite(v) ? "—" : v.toFixed(d));
const signed = (v, d = 2) => (v == null || !isFinite(v) ? "—" : (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(d));
const timeAgo = (t) => {
  if (!t || !isFinite(t)) return "";
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
};
const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---------- color scales (shared by map + legends) ----------

function mix(a, b, t) {
  const pa = a.match(/\w\w/g).map((h) => parseInt(h, 16));
  const pb = b.match(/\w\w/g).map((h) => parseInt(h, 16));
  return "#" + pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, "0")).join("");
}
function ramp(stops) {
  return (v) => {
    if (v == null || !isFinite(v)) return "#5b6476";
    if (v <= stops[0][0]) return stops[0][1];
    for (let i = 1; i < stops.length; i++) {
      if (v <= stops[i][0]) {
        const [v0, c0] = stops[i - 1], [v1, c1] = stops[i];
        return mix(c0, c1, (v - v0) / (v1 - v0));
      }
    }
    return stops.at(-1)[1];
  };
}
const css = (stops) => `linear-gradient(90deg, ${stops.map(([, c]) => c).join(", ")})`;

const DIVERGING = (max) => [[-max, "#2f7fe0"], [-max / 3, "#6fa8e8"], [0, "#8b95a7"], [max / 3, "#f08a6e"], [max, "#ff4d3d"]];
const RESID_STOPS = DIVERGING(1.0);
const SLA_STOPS = DIVERGING(0.75);
const TEMP_STOPS = REGION.tempStops;
const WAVE_STOPS = [[2, "#2a6f8f"], [6, "#2fb7c4"], [10, "#b8e07a"], [15, "#f2c14e"], [20, "#f0643c"]];
const residColor = ramp(RESID_STOPS);
const slaColor = ramp(SLA_STOPS);
const tempColor = ramp(TEMP_STOPS);
const waveColor = ramp(WAVE_STOPS);
const ALERT_COLORS = { warning: "#ff5a5f", watch: "#ff9f43", advisory: "#f7d154", statement: "#7aa7ff" };

// ---------- layer registry ----------
// Listed top → bottom, i.e. first entry draws on top of the map.

const REPORT_COLORS = { coastal: "#00d5ff", flood: "#4d8dff", "311": "#c08cff", other: "#9fb3c8" };
const RIVER_COLORS = { action: "#f7d154", minor: "#ff9f43", moderate: "#ff5a5f", major: "#d63cff" };
const reportClass = (r) => (r.kind === "311" ? "311" : /COASTAL|TIDE|SURGE/i.test(r.type) ? "coastal" : /FLOOD/i.test(r.type) ? "flood" : "other");

const LAYERS = [
  {
    id: "reports", title: "Flood reports", meta: "NWS spotters, police, public, media" + (REGION.sf311 ? " · SF 311" : ""), swatch: REPORT_COLORS.coastal,
    mapLayers: ["reports-circle"], visible: true, opacity: 1,
    legend: () => `<div class="legend-item"><i style="background:${REPORT_COLORS.coastal}"></i>Coastal / tidal flooding (NWS report)</div>
      <div class="legend-item"><i style="background:${REPORT_COLORS.flood}"></i>Flooding (NWS report)</div>
      ${REGION.sf311 ? `<div class="legend-item"><i style="background:${REPORT_COLORS["311"]}"></i>SF 311 street / sewer flooding request</div>` : ""}
      <div class="legend-note">Real sightings, filtered to the timeline at the bottom. NWS reports come from trained spotters, police, the public and TV news.</div>`,
  },
  {
    id: "rivers", title: "Gauges in flood", meta: "NOAA water prediction service", swatch: RIVER_COLORS.minor,
    mapLayers: ["rivers-circle", "rivers-label"], visible: true, opacity: 1,
    legend: () => Object.entries(RIVER_COLORS).map(([k, c]) => `<div class="legend-item"><i style="background:${c}"></i>${k[0].toUpperCase() + k.slice(1)} stage (now or forecast)</div>`).join("") +
      `<div class="legend-note">River, creek and tide gauges NOAA tracks with official flood stages; only the ones at action stage or flooding are drawn.</div>`,
  },
  {
    id: "wx", title: "Weather stations", meta: "NWS · airport observations", swatch: "#d7dde7",
    mapLayers: ["wx-circle", "wx-arrow", "wx-label"], visible: true, opacity: 1,
    legend: () => `<div class="legend-note">Air temperature °F · arrow shows wind direction (blowing toward), length ∝ speed.</div>`,
  },
  {
    id: "buoys", title: "Buoys & bay sensors", meta: "NOAA NDBC · waves offshore, wind in the Bay", swatch: "#2fb7c4",
    mapLayers: ["buoys-circle", "buoys-arrow", "buoys-label"], visible: true, opacity: 1,
    legend: () => rampLegend(WAVE_STOPS, "Significant wave height", "ft"),
  },
  {
    id: "tides", title: "Tide gauges", meta: "NOAA CO-OPS · water level", swatch: "#ff6b5b",
    mapLayers: ["tides-circle", "tides-label"], visible: true, opacity: 1,
    legend: () => rampLegend(RESID_STOPS, "Surge / residual (observed − predicted)", "ft", true) +
      `<div class="legend-note">Label: current level above MLLW · residual. Storm surge and El Niño both push residuals positive.</div>`,
  },
  {
    id: "sst", title: "Water temperature", meta: "CO-OPS + NDBC sensors", swatch: "#f2c14e",
    mapLayers: ["sst-circle", "sst-label"], visible: false, opacity: 1,
    legend: () => rampLegend(TEMP_STOPS, "Water temperature", "°F"),
  },
  {
    id: "sla", title: "Sea-level anomaly", meta: "CO-OPS monthly mean vs 1983–2001", swatch: "#ff4d3d",
    mapLayers: ["sla-halo", "sla-label"], visible: true, opacity: 1,
    legend: () => rampLegend(SLA_STOPS, "Last monthly mean sea level vs. MSL epoch", "ft", true) +
      `<div class="legend-note">${REGION.id === "sfla" ? "South Florida's monthly mean sea level runs highest in the fall, when king tides and sunny-day flooding peak." : "El Niño typically raises West Coast sea level by several inches for months at a time."}</div>`,
  },
  {
    id: "floodmap", title: "Flood map (NOAA)", meta: "land the water reaches at a height", swatch: "#2f7fe0",
    mapLayers: ["floodmap-raster"], visible: true, opacity: 0.75,
    legend: () => `<label class="flood-pick">Water height
        <select id="flood-level">
          <option value="now">Now (nearest tide gauge)</option>
          <option value="next">Highest in the next 48 h</option>
          ${FLOOD_LEVELS.filter((v) => v > 0 && v <= 6).map((v) => `<option value="${v}">${v} ft above normal high tide</option>`).join("")}
        </select></label>
      <div class="legend-item"><i style="background:#2f7fe0"></i>Blue: water reaches it (connected to the bay or sea)</div>
      <div class="legend-item"><i style="background:#3fbf6f"></i>Green: low ground behind a barrier (can flood through drains or gaps)</div>
      <div class="legend-note">NOAA's sea-level maps, shaded at the chosen height above normal high tide (MHHW). A model of ground height, not a sighting: drains, pumps and levees change what really floods. "Now" uses the tide gauge nearest the middle of the map.</div>`,
  },
  {
    id: "alerts", title: "NWS alerts", meta: REGION.alertOffice, swatch: "#ff9f43",
    mapLayers: ["alerts-fill", "alerts-line"], visible: true, opacity: 1,
    legend: () => Object.entries(ALERT_COLORS)
      .map(([k, c]) => `<div class="legend-item"><i style="background:${c}"></i>${k[0].toUpperCase() + k.slice(1)}</div>`).join(""),
  },
];

function rampLegend(stops, title, unit, signedScale) {
  const lo = stops[0][0], hi = stops.at(-1)[0], mid = stops[Math.floor(stops.length / 2)][0];
  const f = (v) => (signedScale && v > 0 ? "+" : "") + v + (unit === "°F" ? "°" : "");
  return `<div>${title}</div><div class="legend-ramp" style="background:${css(stops)}"></div>
    <div class="legend-scale"><span>${f(lo)}</span><span>${f(mid)}</span><span>${f(hi)} ${unit}</span></div>`;
}

// Base paint opacity for each map layer, scaled by the user's layer opacity.
const OPACITY_PROPS = {
  fill: ["fill-opacity"], line: ["line-opacity"], circle: ["circle-opacity", "circle-stroke-opacity"],
  symbol: ["text-opacity", "icon-opacity"], raster: ["raster-opacity"],
};
const baseOpacity = {}; // mapLayerId -> { prop: value }

// ---------- map ----------
const flood = { pick: store.get("tides-floodmap") || "now", level: null };

const map = new maplibregl.Map({
  container: "map",
  style: THEME === "light" ? lightStyle : baseStyle,
  center: REGION.center,
  zoom: window.innerWidth < 820 ? REGION.zoom - 0.7 : REGION.zoom,
  minZoom: 5,
  maxZoom: 15,
  maxBounds: REGION.maxBounds,
  attributionControl: { compact: false },
  hash: true,
});
window.__map = map; // handy for debugging from the console
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
map.addControl(new maplibregl.ScaleControl({ unit: "imperial" }), "bottom-right");

const empty = () => ({ type: "FeatureCollection", features: [] });

function addArrowImage() {
  const s = 48, c = document.createElement("canvas");
  c.width = c.height = s;
  const g = c.getContext("2d");
  g.translate(s / 2, s / 2);
  g.fillStyle = "#ffffff";
  g.beginPath();
  g.moveTo(0, -20); g.lineTo(9, -4); g.lineTo(3, -6); g.lineTo(3, 18); g.lineTo(-3, 18); g.lineTo(-3, -6); g.lineTo(-9, -4);
  g.closePath(); g.fill();
  map.addImage("arrow", g.getImageData(0, 0, s, s), { pixelRatio: 2, sdf: true });
}

function addDataLayers() {
  addArrowImage();
  for (const id of ["alerts", "sla", "tides", "sst", "buoys", "wx", "reports", "rivers"]) map.addSource(id, { type: "geojson", data: empty() });
  map.addSource("floodmap", {
    type: "raster", tiles: floodTiles(flood.level ?? 0), tileSize: 256, maxzoom: 16,
    attribution: '<a href="https://coast.noaa.gov/slr/" target="_blank" rel="noopener">NOAA sea level maps</a>',
  });

  const label = (id, src, extra = {}) => ({
    id, type: "symbol", source: src,
    layout: {
      "text-field": ["get", "label"], "text-font": ["Noto Sans Bold"], "text-size": 11,
      "text-offset": [0, 1.25], "text-anchor": "top", "text-allow-overlap": false, "text-line-height": 1.15,
      ...extra.layout,
    },
    paint: { "text-color": INK.text, "text-halo-color": INK.halo, "text-halo-width": 1.4, ...extra.paint },
  });
  const arrow = (id, src, color) => ({
    id, type: "symbol", source: src,
    filter: ["has", "rot"],
    layout: {
      "icon-image": "arrow", "icon-rotate": ["get", "rot"], "icon-rotation-alignment": "map",
      "icon-size": ["interpolate", ["linear"], ["get", "spd"], 0, 0.35, 30, 1.0],
      "icon-allow-overlap": true, "icon-offset": [0, -26],
    },
    paint: { "icon-color": color, "icon-opacity": 0.85 },
  });

  const defs = [
    { id: "floodmap-raster", type: "raster", source: "floodmap", paint: { "raster-opacity": 0.7, "raster-fade-duration": 0 } },
    { id: "rivers-circle", type: "circle", source: "rivers",
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 6, 5, 12, 9],
        "circle-color": ["get", "color"], "circle-opacity": 1,
        "circle-stroke-width": 2, "circle-stroke-color": INK.stroke, "circle-stroke-opacity": 1,
      } },
    label("rivers-label", "rivers", { layout: { "text-size": 10.5 }, paint: { "text-color": ["get", "color"] } }),
    { id: "reports-circle", type: "circle", source: "reports",
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 6, 4, 12, 7],
        "circle-color": ["get", "color"], "circle-opacity": 0.95,
        "circle-stroke-width": 1.5, "circle-stroke-color": "#ffffff", "circle-stroke-opacity": 0.85,
      } },
    { id: "alerts-fill", type: "fill", source: "alerts",
      paint: { "fill-color": alertColorExpr(), "fill-opacity": 0.07 } },
    { id: "alerts-line", type: "line", source: "alerts",
      paint: { "line-color": alertColorExpr(), "line-width": 1, "line-opacity": 0.55 } },

    { id: "sla-halo", type: "circle", source: "sla",
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 6, 14, 11, 34],
        "circle-color": ["get", "color"], "circle-blur": 0.55, "circle-opacity": 0.55, "circle-stroke-opacity": 0,
      } },
    label("sla-label", "sla", { layout: { "text-offset": [0, -2.6], "text-anchor": "bottom", "text-size": 10.5 },
      paint: { "text-color": ["get", "color"] } }),

    { id: "sst-circle", type: "circle", source: "sst",
      paint: {
        "circle-radius": 7, "circle-color": ["get", "color"], "circle-opacity": 0.95,
        "circle-stroke-width": 2, "circle-stroke-color": INK.stroke, "circle-stroke-opacity": 1,
      } },
    label("sst-label", "sst", { layout: { "text-offset": [1.0, 0], "text-anchor": "left" } }),

    { id: "tides-circle", type: "circle", source: "tides",
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 6, 5, 12, 9],
        "circle-color": ["get", "color"], "circle-opacity": 1,
        "circle-stroke-width": ["case", ["get", "flooding"], 4, 2], "circle-stroke-color": ["get", "stroke"], "circle-stroke-opacity": 0.9,
      } },
    label("tides-label", "tides"),

    { id: "buoys-circle", type: "circle", source: "buoys",
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 6, 5, 12, 9],
        "circle-color": ["get", "color"], "circle-opacity": 1,
        "circle-stroke-width": 2, "circle-stroke-color": INK.stroke, "circle-stroke-opacity": 1,
      } },
    arrow("buoys-arrow", "buoys", INK.buoyArrow),
    label("buoys-label", "buoys"),

    { id: "wx-circle", type: "circle", source: "wx",
      paint: {
        "circle-radius": 4, "circle-color": INK.wx, "circle-opacity": 1,
        "circle-stroke-width": 1.5, "circle-stroke-color": INK.stroke, "circle-stroke-opacity": 1,
      } },
    arrow("wx-arrow", "wx", INK.wx),
    label("wx-label", "wx", { layout: { "text-size": 10.5 } }),
  ];
  for (const d of defs) {
    map.addLayer(d);
    baseOpacity[d.id] = {};
    for (const p of OPACITY_PROPS[d.type]) baseOpacity[d.id][p] = d.paint?.[p] ?? 1;
  }
  applyLayerOrder();
  for (const L of LAYERS) applyVisibility(L);
  wireInteractions();
}

function alertColorExpr() {
  return ["match", ["get", "kind"], ...Object.entries(ALERT_COLORS).flat(), "#7aa7ff"];
}

function applyLayerOrder() {
  // bottom → top: moving each to the top in turn yields the final order.
  for (const L of [...LAYERS].reverse()) for (const id of L.mapLayers) map.moveLayer(id);
}
function applyVisibility(L) {
  const on = L.visible && (L.id !== "floodmap" || flood.level != null);
  for (const id of L.mapLayers) map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
}
function applyOpacity(L) {
  for (const id of L.mapLayers)
    for (const [p, base] of Object.entries(baseOpacity[id])) map.setPaintProperty(id, p, base * L.opacity);
}

// ---------- layer panel (toggle / opacity / drag-to-reorder) ----------

const prefs = (() => {
  try { return JSON.parse(localStorage.getItem("bcw-layers") || "null"); } catch { return null; }
})();
if (prefs) {
  for (const L of LAYERS) {
    const p = prefs.layers?.[L.id];
    if (p) { L.visible = p.visible; L.opacity = p.opacity; }
  }
  if (Array.isArray(prefs.order))
    LAYERS.sort((a, b) => prefs.order.indexOf(a.id) - prefs.order.indexOf(b.id));
}
function savePrefs() {
  try {
    localStorage.setItem("bcw-layers", JSON.stringify({
      order: LAYERS.map((l) => l.id),
      layers: Object.fromEntries(LAYERS.map((l) => [l.id, { visible: l.visible, opacity: l.opacity }])),
    }));
  } catch { /* storage unavailable */ }
}

function renderLayerList() {
  const ul = $("#layer-list");
  ul.innerHTML = "";
  for (const L of LAYERS) {
    const li = document.createElement("li");
    li.className = "layer" + (L.visible ? "" : " off") + (L.open ? " open" : "");
    li.draggable = true;
    li.dataset.id = L.id;
    li.innerHTML = `
      <div class="layer-row">
        <span class="grip" title="Drag to reorder"><svg viewBox="0 0 12 16"><circle cx="3" cy="3" r="1.4"/><circle cx="9" cy="3" r="1.4"/><circle cx="3" cy="8" r="1.4"/><circle cx="9" cy="8" r="1.4"/><circle cx="3" cy="13" r="1.4"/><circle cx="9" cy="13" r="1.4"/></svg></span>
        <span class="swatch" style="background:${L.swatch}"></span>
        <div class="layer-text">
          <div class="layer-title">${L.title}</div>
          <div class="layer-meta ${L.error ? "err" : ""}">${esc(L.status || L.meta)}</div>
        </div>
        <label class="switch" title="Show / hide"><input type="checkbox" ${L.visible ? "checked" : ""} aria-label="Show ${L.title}"><span></span></label>
      </div>
      <div class="layer-extra">
        <div class="opacity"><span>Opacity</span><input type="range" min="0.1" max="1" step="0.05" value="${L.opacity}" aria-label="${L.title} opacity"></div>
        <div class="legend">${L.legend()}</div>
      </div>`;
    const cb = li.querySelector("input[type=checkbox]");
    cb.addEventListener("change", () => {
      L.visible = cb.checked;
      li.classList.toggle("off", !L.visible);
      if (map.getLayer(L.mapLayers[0])) applyVisibility(L);
      savePrefs();
    });
    li.querySelector(".switch").addEventListener("click", (e) => e.stopPropagation());
    li.querySelector(".layer-row").addEventListener("click", () => {
      L.open = !L.open;
      li.classList.toggle("open", L.open);
    });
    const range = li.querySelector("input[type=range]");
    range.addEventListener("input", () => {
      L.opacity = +range.value;
      if (map.getLayer(L.mapLayers[0])) applyOpacity(L);
      savePrefs();
    });

    // drag & drop reordering
    li.addEventListener("dragstart", (e) => {
      li.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", L.id);
    });
    li.addEventListener("dragend", () => li.classList.remove("dragging"));
    li.addEventListener("dragover", (e) => {
      e.preventDefault();
      const after = e.offsetY > li.offsetHeight / 2;
      li.classList.toggle("drop-after", after);
      li.classList.toggle("drop-before", !after);
    });
    li.addEventListener("dragleave", () => li.classList.remove("drop-after", "drop-before"));
    li.addEventListener("drop", (e) => {
      e.preventDefault();
      const after = li.classList.contains("drop-after");
      li.classList.remove("drop-after", "drop-before");
      const fromId = e.dataTransfer.getData("text/plain");
      if (fromId === L.id) return;
      const from = LAYERS.findIndex((l) => l.id === fromId);
      const [moved] = LAYERS.splice(from, 1);
      let to = LAYERS.findIndex((l) => l.id === L.id) + (after ? 1 : 0);
      LAYERS.splice(to, 0, moved);
      if (map.getLayer(moved.mapLayers[0])) applyLayerOrder();
      savePrefs();
      renderLayerList();
    });
    ul.appendChild(li);
  }
}
function setStatus(id, status, error = false) {
  const L = LAYERS.find((l) => l.id === id);
  L.status = status;
  L.error = error;
  const meta = document.querySelector(`.layer[data-id="${id}"] .layer-meta`);
  if (meta) { meta.textContent = status; meta.classList.toggle("err", error); }
}

// ---------- state + loading ----------

const state = { tides: [], temps: new Map(), monthly: new Map(), buoys: [], wx: [], alerts: null, oni: [], weekly: [], phase: null, climateStations: [], generated: {}, reports: [], rivers: { watched: 0, flooding: [] }, news: [] };
const pt = (lon, lat, props) => ({ type: "Feature", geometry: { type: "Point", coordinates: [lon, lat] }, properties: props });
const newest = (ts) => Math.max(...ts.filter(Boolean).map(Number));

// Snapshots start downloading immediately (index.html preloads them), in
// parallel with MapLibre and the base map; they're applied once the map is ready.
let pending = Object.fromEntries(GROUPS.map((g) => [g, fetchSnapshot(g)]));

function applyWeather(w) {
  state.wx = w.stations;
  map.getSource("wx").setData({
    type: "FeatureCollection",
    features: state.wx.map((o) => pt(o.lon, o.lat, {
      id: o.id, kind: "wx", name: o.name,
      label: `${fmt(o.tempF, 0)}°${o.windMph != null ? ` · ${fmt(o.windMph, 0)} mph` : ""}`,
      ...(o.windDir != null && o.windMph ? { rot: (o.windDir + 180) % 360, spd: o.windMph * 0.87 } : {}),
    })),
  });
  setStatus("wx", `${state.wx.length} stations · NWS · ${timeAgo(newest(state.wx.map((o) => o.t)))}`);

  state.alerts = w.alerts;
  if (!w.alerts) return setStatus("alerts", "Failed to load — will retry", true);
  map.getSource("alerts").setData(w.alerts);
  const n = w.alerts.count;
  setStatus("alerts", n ? `${n} active · ${REGION.alertOffice}` : "No active alerts");
}

function applyTides(t) {
  state.tides = t.stations;
  const live = state.tides.filter((s) => s.latest);
  map.getSource("tides").setData({
    type: "FeatureCollection",
    features: live.map((s) => pt(s.lon, s.lat, {
      id: s.id, kind: "tide", name: s.name, color: residColor(s.residual),
      ...floodState(s),
      label: `${fmt(s.latest.v, 1)} ft\n${signed(s.residual, 2)}${s.flood?.minor != null && s.latest.v >= s.flood.minor ? "\nFLOODING" : ""}`,
    })),
  });
  setStatus("tides", `${live.length} gauges · CO-OPS · ${timeAgo(newest(live.map((s) => s.latest.t)))}`);
  state.temps = new Map(state.tides.filter((s) => s.temp).map((s) => [s.id, s.temp]));
}

function applyBuoys(b) {
  state.buoys = b.buoys;
  map.getSource("buoys").setData({
    type: "FeatureCollection",
    features: state.buoys.map((b) => pt(b.lon, b.lat, {
      id: b.id, kind: "buoy", name: b.name, color: waveColor(b.waveFt),
      label: b.waveFt != null ? `${fmt(b.waveFt, 0)} ft @ ${fmt(b.period, 0)}s` : `${fmt(b.windKt, 0)} kt`,
      ...(b.windDir != null ? { rot: (b.windDir + 180) % 360, spd: b.windKt ?? 0 } : {}),
    })),
  });
  setStatus("buoys", `${state.buoys.filter((b) => b.waveFt != null).length} wave buoys · ${state.buoys.filter((b) => b.waveFt == null).length} wind sensors · NDBC · ${timeAgo(newest(state.buoys.map((b) => b.updated)))}`);
}

// Water temperature merges CO-OPS gauges (tides snapshot) and buoy SSTs.
function renderTemps() {
  const feats = state.tides.filter((s) => s.temp).map((s) => pt(s.lon, s.lat, {
    id: s.id, kind: "tide", name: s.name, color: tempColor(s.temp.v), label: `${fmt(s.temp.v, 0)}°`,
  }));
  for (const b of state.buoys)
    if (b.sstF != null)
      feats.push(pt(b.lon, b.lat, { id: b.id, kind: "buoy", name: b.name, color: tempColor(b.sstF), label: `${fmt(b.sstF, 0)}°` }));
  map.getSource("sst").setData({ type: "FeatureCollection", features: feats });
  setStatus("sst", feats.length ? `${feats.length} sensors · CO-OPS + NDBC` : "No readings", !feats.length);
}

function applyClimate(c) {
  state.monthly = new Map(c.monthly.map((s) => [s.id, s.series]));
  state.climateStations = c.monthly;
  const feats = [];
  for (const s of c.monthly) {
    const last = s.series.at(-1);
    if (!last) continue;
    feats.push(pt(s.lon, s.lat, {
      id: s.id, kind: "tide", name: s.name, color: slaColor(last.v), v: last.v,
      label: `${signed(last.v, 2)} ft · ${last.t.toLocaleDateString(undefined, { month: "short", timeZone: "UTC" })}`,
    }));
  }
  map.getSource("sla").setData({ type: "FeatureCollection", features: feats });
  setStatus("sla", `${feats.length} gauges · monthly mean vs 1983–2001`);

  state.oni = c.oni;
  state.weekly = c.weekly;
  state.phase = c.phase;
  const last = c.oni.at(-1), wk = c.weekly.at(-1);
  const chip = $("#enso-phase");
  chip.textContent = c.phase.label;
  chip.className = "chip " + c.phase.cls;
  const big = (v) => (v == null ? "—" : `<span class="${v >= 0 ? "pos" : "neg"}">${signed(v, 1)}</span><small>°C</small>`);
  $("#oni-season").textContent = last ? `${last.season} ${last.year}` : "";
  $("#oni-value").innerHTML = big(last?.v);
  $("#n34-value").innerHTML = big(wk?.nino34);
  $("#n12-value").innerHTML = big(wk?.nino12);
  drawOni();
}
function drawOni() {
  if (!state.oni.length) return;
  lineChart($("#oni-chart"), {
    height: 120, bars: state.oni.filter((d) => d.t >= Date.UTC(new Date().getUTCFullYear() - 12, 0, 1)), zero: true, band: [-0.5, 0.5],
    yFormat: (v) => (v > 0 ? "+" : "") + v,
  });
}

// Highest observed water level / residual (observed − predicted) inside the timeline window.
function peakLevel(s) {
  const obs = inWindow(s.observed, Date.now() - rangeMs());
  return obs.length ? obs.reduce((a, b) => (b.v > a.v ? b : a)) : null;
}
function peakResidual(s) {
  const pred = new Map((s.predicted || []).map((d) => [+d.t, d.v]));
  let best = null;
  for (const d of inWindow(s.observed, Date.now() - rangeMs())) {
    const p = pred.get(+d.t);
    if (p != null && (!best || d.v - p > best.v)) best = { t: d.t, v: d.v - p };
  }
  return best;
}

function renderSignals() {
  const resid = state.tides.filter((s) => s.residual != null).map((s) => s.residual);
  const sla = [...state.monthly.values()].map((s) => s.at(-1)?.v).filter((v) => v != null);
  const temps = [...state.temps.values()].map((t) => t.v);
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const coastal = Object.values(state.alerts?.items ?? {}).filter((a) => /coastal|surf|surge|tsunami|gale|storm|flood/i.test(a.event)).length;
  const peak = state.tides.map((s) => ({ s, p: peakResidual(s) })).filter((x) => x.p).sort((a, b) => b.p.v - a.p.v)[0];
  const cell = (k, v) => `<div class="signal"><div class="k">${k}</div><div class="v">${v}</div></div>`;
  $("#bay-signals").innerHTML =
    cell("Avg tide residual", `${signed(avg(resid), 2)} ft`) +
    cell("Avg monthly sea level", `${signed(avg(sla), 2)} ft`) +
    cell("Avg water temp", `${fmt(avg(temps), 1)} °F`) +
    cell("Coastal / marine alerts", coastal) +
    cell(`Flood reports · last ${RANGE_LABEL[range]}`, state.reports.filter((r) => inRange(r.t)).length) +
    cell("Gauges at flood level now", (() => { const w = state.tides.filter((s) => s.flood?.minor != null && s.latest); const n = w.filter((s) => s.latest.v >= s.flood.minor).length; return `${n} <small>of ${w.length} with a flood level</small>`; })()) +
    cell(`Highest surge · last ${RANGE_LABEL[range]}`, peak ? `${signed(peak.p.v, 2)} ft <small>${esc(peak.s.name)}</small>` : "—") +
    cell(`Highest water · last ${RANGE_LABEL[range]}`, (() => { const h = state.tides.map((s) => ({ s, p: peakLevel(s) })).filter((x) => x.p).sort((a, b) => b.p.v - a.p.v)[0]; return h ? `${fmt(h.p.v, 2)} ft <small>${esc(h.s.name)}</small>` : "—"; })()) +
    `<p class="explain">${esc(REGION.ensoNote)}</p>`;
}

// ---------- flooding (tides.alola.lol) ----------
function floodState(s) {
  const minor = s.flood?.minor;
  if (minor == null || !s.latest) return { stroke: INK.ring, flooding: false };
  const gap = s.latest.v - minor;
  return { stroke: gap >= 0 ? "#ff3b3b" : gap > -0.5 ? "#ffb020" : INK.ring, flooding: gap >= 0 };
}

function updateFloodMap() {
  const c = map.getCenter();
  const g = nearest(state.tides, c.lng, c.lat, (s) => s.mhhw != null && s.latest);
  let ft = null, info = "";
  if (flood.pick === "now" || flood.pick === "next") {
    if (g) {
      const a = gaugeAboveHigh(g.s);
      ft = flood.pick === "now" ? a.now : a.next?.v;
      const when = flood.pick === "next" && a.next ? ` around ${a.next.t.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}` : "";
      info = ft == null ? "No reading" : `${g.s.name}: ${signed(ft, 1)} ft vs normal high tide${when}`;
    } else info = "Waiting for tide gauges";
  } else {
    ft = +flood.pick;
    info = `Fixed: ${ft} ft above normal high tide`;
  }
  const lv = ft == null || ft < 0.25 ? null : snapLevel(ft);
  flood.level = lv;
  if (map.getSource("floodmap") && lv != null) map.getSource("floodmap").setTiles(floodTiles(lv));
  const L = LAYERS.find((x) => x.id === "floodmap");
  if (map.getLayer("floodmap-raster")) applyVisibility(L);
  const sel = document.getElementById("flood-level");
  if (sel) sel.value = flood.pick;
  setStatus("floodmap", lv == null ? `${info} · nothing extra under water` : `${info} · shading ${lv} ft`);
}

function inRange(t) { return +t >= Date.now() - rangeMs(); }
function renderReports() {
  const list = state.reports.filter((r) => inRange(r.t));
  map.getSource("reports")?.setData({
    type: "FeatureCollection",
    features: list.map((r, i) => pt(r.lon, r.lat, { id: i, kind: "report", name: r.type, label: r.place, color: REPORT_COLORS[reportClass(r)] })),
  });
  const nws = list.filter((r) => r.kind === "lsr").length, sf = list.length - nws;
  setStatus("reports", `${list.length} in the last ${RANGE_LABEL[range]} · ${nws} NWS${REGION.sf311 ? ` · ${sf} SF 311` : ""}`);
}
function renderRivers() {
  const f = state.rivers.flooding;
  map.getSource("rivers")?.setData({
    type: "FeatureCollection",
    features: f.map((g) => {
      const cat = RIVER_COLORS[g.now] ? g.now : g.forecast;
      return pt(g.lon, g.lat, { id: g.id, kind: "river", name: g.name, color: RIVER_COLORS[cat] || "#9fb3c8",
        label: `${g.name.split(/ at | near /i)[0].slice(0, 24)}\n${RIVER_COLORS[g.now] ? g.now : `forecast ${g.forecast}`}` });
    }),
  });
  setStatus("rivers", f.length ? `${f.length} at action stage or flooding · of ${state.rivers.watched} watched` : `None flooding · ${state.rivers.watched} gauges watched`);
}
function renderNews() {
  const list = state.news.filter((n) => inRange(n.t));
  $("#news-count").textContent = list.length ? `${list.length} · last ${RANGE_LABEL[range]}` : "";
  $("#news-list").innerHTML = list.length
    ? list.slice(0, 25).map((n) => `<li><a href="${esc(n.link)}" target="_blank" rel="noopener noreferrer">${esc(n.title)}</a><span>${esc(n.source)} · ${timeAgo(n.t)}</span></li>`).join("")
    : `<li class="none">No flooding news in the last ${RANGE_LABEL[range]}.</li>`;
}
function applyFloods(f) {
  state.reports = f.reports;
  state.rivers = f.rivers;
  state.news = f.news;
  renderReports();
  renderRivers();
  renderNews();
}

const APPLY = {
  floods: [applyFloods, ["reports", "rivers"]],
  weather: [applyWeather, ["wx", "alerts"]],
  tides: [(t) => { applyTides(t); renderTemps(); updateFloodMap(); openDefaultStation(); }, ["tides"]],
  buoys: [(b) => { applyBuoys(b); renderTemps(); }, ["buoys"]],
  climate: [applyClimate, ["sla"]],
};

let openedDefault = false;
// Open a station as soon as the tide gauges arrive: the last one opened in this region, else Alameda in the
// SF Bay (her ask 2026-11-24), else the region's first gauge. A saved buoy waits for the buoys snapshot.
function openDefaultStation() {
  if (openedDefault || !state.tides.length || current) return;
  openedDefault = true;
  const [kind, id] = (store.get(`tides-station-${REGION.id}`) || "").split(":");
  if (kind === "tide" && state.tides.some((t) => t.id === id)) return showTide(id);
  if (kind === "buoy") {
    const tryBuoy = (n) => (state.buoys.some((b) => b.id === id) ? (current ? null : showBuoy(id)) : n > 0 && setTimeout(() => tryBuoy(n - 1), 1000));
    return tryBuoy(15);
  }
  showTide(REGION.id === "sfbay" && state.tides.some((t) => t.id === "9414750") ? "9414750" : state.tides[0].id);
}
async function loadAll({ force = false } = {}) {
  const btn = $("#refresh");
  btn.classList.add("spinning");
  $("#updated").textContent = "Updating…";
  if (!pending) pending = Object.fromEntries(GROUPS.map((g) => [g, fetchSnapshot(g, { force })]));
  const jobs = pending;
  pending = null;
  await Promise.allSettled(GROUPS.map(async (g) => {
    const [apply, layers] = APPLY[g];
    try {
      const snap = await jobs[g];
      state.generated[g] = snap.generatedAt;
      apply(snap);
    } catch (e) {
      console.error(g, e);
      for (const id of layers) setStatus(id, "Failed to load — will retry", true);
      if (g === "climate") $("#enso-phase").textContent = "Unavailable";
    }
  }));
  renderSignals();
  btn.classList.remove("spinning");

  // "As of" = the oldest snapshot on screen, i.e. the most conservative claim.
  // the climate snapshot only changes every few hours, so it doesn't count toward "data as of"
  const asOf = Math.min(...Object.entries(state.generated).filter(([g]) => g !== "climate").map(([, t]) => Number(t)));
  $("#updated").textContent = isFinite(asOf)
    ? `Data as of ${new Date(asOf).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })} · ${REGION.name}`
    : "Data unavailable — will retry";
  if (current) current.refresh?.();
}

// ---------- interactions + detail drawer ----------

let current = null;
function openDetail(html, refresh) {
  $("#detail-body").innerHTML = html;
  $("#detail").hidden = false;
  document.body.classList.add("detail-open");
  $("#detail").scrollTop = 0;
  current = { refresh };
}
function closeDetail() {
  $("#detail").hidden = true;
  document.body.classList.remove("detail-open");
  current = null;
  if (clickMarker) { clickMarker.remove(); clickMarker = null; }
}
$("#detail-close").addEventListener("click", closeDetail);
document.addEventListener("keydown", (e) => e.key === "Escape" && closeDetail());

const hover = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12, className: "hover-pop" });
let clickMarker = null;

function wireInteractions() {
  const clickable = ["reports-circle", "rivers-circle", "wx-circle", "buoys-circle", "tides-circle", "sst-circle", "sla-halo", "alerts-fill"];
  for (const id of clickable) {
    map.on("mouseenter", id, () => (map.getCanvas().style.cursor = "pointer"));
    map.on("mouseleave", id, () => { map.getCanvas().style.cursor = ""; hover.remove(); });
    map.on("mousemove", id, (e) => {
      const p = e.features[0].properties;
      const title = p.event || p.name;
      const sub = p.event ? p.areaDesc?.split(";")[0] : p.label?.replaceAll("\n", " · ");
      hover.setLngLat(e.lngLat).setHTML(`<b>${esc(title)}</b><span>${esc(sub || "")}</span>`).addTo(map);
    });
  }
  map.on("click", (e) => {
    const feats = map.queryRenderedFeatures(e.point, { layers: clickable.filter((id) => map.getLayoutProperty(id, "visibility") !== "none") });
    if (clickMarker) { clickMarker.remove(); clickMarker = null; }
    if (!feats.length) return showPointForecast(e.lngLat);
    // prefer point features over alert polygons
    const f = feats.find((x) => x.layer.id !== "alerts-fill") || feats[0];
    const p = f.properties;
    // tides.alola.lol: inside an alert area, still answer "flooding here?" for the spot, with the alerts under it
    if (f.layer.id === "alerts-fill") return showPointForecast(e.lngLat, feats.filter((x) => x.layer.id === "alerts-fill"));
    if (p.kind === "report") return showReports(e.lngLat);
    if (p.kind === "river") return showRiver(p.id);
    if (p.kind === "tide") return showTide(p.id);
    if (p.kind === "buoy") return showBuoy(p.id);
    if (p.kind === "wx") return showWx(p.id);
  });
}

function showTide(id) {
  store.set(`tides-station-${REGION.id}`, `tide:${id}`);
  const render = () => {
    const s = state.tides.find((x) => x.id === id) ||
      state.climateStations.find((x) => x.id === id);
    if (!s) return;
    const temp = state.temps.get(id);
    const monthly = state.monthly.get(id) || [];
    const nextEx = (s.extremes || []).filter((x) => x.t > Date.now()).slice(0, 4);
    const t0 = Date.now() - rangeMs(), t1 = Date.now() + Math.min(rangeMs(), 48 * 3600e3);
    const hiLvl = peakLevel(s), hiRes = peakResidual(s);
    const when = (t) => t.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
    openDetail(`
      <div class="d-kicker">Tide gauge · ${id}</div>
      <h2 class="d-title">${esc(s.name)}</h2>
      <div class="d-big">
        <div class="stat"><div class="stat-label">Water level (MLLW)</div><div class="stat-value">${fmt(s.latest?.v, 2)}<small>ft</small></div></div>
        <div class="stat"><div class="stat-label">Residual</div><div class="stat-value ${s.residual > 0 ? "pos" : "neg"}">${signed(s.residual, 2)}<small>ft</small></div></div>
        ${temp ? `<div class="stat"><div class="stat-label">Water</div><div class="stat-value">${fmt(temp.v, 1)}<small>°F</small></div></div>` : ""}
      </div>
      <div class="d-caption">${s.latest ? `Observed ${timeAgo(s.latest.t)}` : "No recent observations"}</div>
      <ul class="d-list">
        <li><span class="lbl">Highest water · last ${RANGE_LABEL[range]}</span><span>${hiLvl ? `${fmt(hiLvl.v, 2)} ft · ${when(hiLvl.t)}` : "—"}</span></li>
        <li><span class="lbl">Highest surge · last ${RANGE_LABEL[range]}</span><span>${hiRes ? `${signed(hiRes.v, 2)} ft · ${when(hiRes.t)}` : "—"}</span></li>
        ${s.mhhw != null && s.latest ? `<li><span class="lbl">Now vs normal high tide (MHHW ${fmt(s.mhhw, 2)} ft)</span><span>${signed(s.latest.v - s.mhhw, 2)} ft</span></li>` : ""}
        ${s.flood?.minor != null ? `<li><span class="lbl">${s.flood.src} minor flood level</span><span>${fmt(s.flood.minor, 2)} ft${s.latest ? ` · ${s.latest.v >= s.flood.minor ? `<b class="pos">FLOODING, ${fmt(s.latest.v - s.flood.minor, 2)} ft over</b>` : `${fmt(s.flood.minor - s.latest.v, 2)} ft to go`}` : ""}</span></li>` : `<li><span class="lbl">Flood level</span><span>NOAA sets none for this gauge</span></li>`}
        ${s.flood?.moderate != null ? `<li><span class="lbl">Moderate · major flood level</span><span>${fmt(s.flood.moderate, 2)} · ${fmt(s.flood.major, 2)} ft</span></li>` : ""}
      </ul>
      <div class="d-section">
        <h3>Water level · past ${RANGE_LABEL[range]} / next ${range === "3d" ? "48 hours" : RANGE_LABEL[range]}</h3>
        <div><span class="legend-line"><i style="border-color:var(--accent)"></i>Observed</span><span class="legend-line"><i class="dash" style="border-color:#8b95a7"></i>Predicted</span>${s.flood?.minor != null ? `<span class="legend-line"><i class="dash" style="border-color:#ff5a5f"></i>Minor flood level</span>` : ""}</div>
        <div id="tide-chart" class="chart-wrap"></div>
      </div>
      ${nextEx.length ? `<div class="d-section"><h3>Next highs & lows</h3><ul class="d-list">${nextEx.map((x) => `
        <li><span class="lbl">${x.type === "H" || x.type === "HH" ? "High" : "Low"} · ${x.t.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}</span><span>${fmt(x.v, 2)} ft</span></li>`).join("")}</ul></div>` : ""}
      <div class="d-section">
        <h3>Monthly mean sea level vs 1983–2001</h3>
        <div id="sla-chart" class="chart-wrap"></div>
        <div class="d-caption">Months running above the epoch mean (red) are consistent with El Niño-driven coastal sea-level rise, on top of the long-term trend.</div>
      </div>
      <div class="d-section d-caption"><a href="https://tidesandcurrents.noaa.gov/stationhome.html?id=${id}" target="_blank" rel="noopener">NOAA Tides & Currents station page ↗</a></div>
    `, render);
    lineChart($("#tide-chart"), {
      height: 150, now: true, xDomain: [t0, t1],
      series: [
        { data: inWindow(s.predicted, t0, t1), color: "#8b95a7", dash: "4 3", width: 1.3 },
        { data: inWindow(s.observed, t0, t1), color: "#5ec8e5", width: 2, area: true },
        ...(s.flood?.minor != null ? [{ data: [{ t: new Date(t0), v: s.flood.minor }, { t: new Date(t1), v: s.flood.minor }], color: "#ff5a5f", dash: "2 3", width: 1.2 }] : []),
      ],
      markers: nextEx.filter((x) => +x.t <= t1).map((x) => ({ t: x.t, v: x.v, label: fmt(x.v, 1), below: x.type.startsWith("L") })),
      yFormat: (v) => v + "′",
    });
    lineChart($("#sla-chart"), { height: 110, bars: monthly, zero: true, yFormat: (v) => (v > 0 ? "+" : "") + v });
  };
  render();
}

function showBuoy(id) {
  store.set(`tides-station-${REGION.id}`, `buoy:${id}`);
  const render = () => {
    const b = state.buoys.find((x) => x.id === id);
    if (!b) return;
    openDetail(`
      <div class="d-kicker">NDBC buoy · ${id}</div>
      <h2 class="d-title">${esc(b.name)}</h2>
      <div class="d-big">
        <div class="stat"><div class="stat-label">Waves</div><div class="stat-value">${fmt(b.waveFt, 1)}<small>ft</small></div></div>
        <div class="stat"><div class="stat-label">Period</div><div class="stat-value">${fmt(b.period, 0)}<small>s</small></div></div>
        <div class="stat"><div class="stat-label">Wind</div><div class="stat-value">${fmt(b.windKt, 0)}<small>kt</small></div></div>
        <div class="stat"><div class="stat-label">Sea temp</div><div class="stat-value">${fmt(b.sstF, 1)}<small>°F</small></div></div>
      </div>
      <div class="d-caption">Updated ${timeAgo(b.updated)}</div>
      <div class="d-section"><h3>Wave height · last ${RANGE_LABEL[range]} (ft)</h3><div id="wave-chart" class="chart-wrap"></div></div>
      <div class="d-section"><h3>Sea surface temperature · last ${RANGE_LABEL[range]} (°F)</h3><div id="sst-chart" class="chart-wrap"></div></div>
      <div class="d-section d-caption"><a href="https://www.ndbc.noaa.gov/station_page.php?station=${id}" target="_blank" rel="noopener">NDBC station page ↗</a></div>
    `, render);
    const t0 = Date.now() - rangeMs(), xDomain = [t0, Date.now()];
    lineChart($("#wave-chart"), { height: 110, xDomain, series: [{ data: inWindow(b.series.waveFt, t0), color: "#2fb7c4", area: true }] });
    lineChart($("#sst-chart"), { height: 110, xDomain, series: [{ data: inWindow(b.series.sstF, t0), color: "#f2c14e" }] });
  };
  render();
}

async function forecastHTML(lon, lat) {
  try {
    const fc = await fetchPointForecast(lon, lat);
    return `<div class="d-section"><h3>NWS forecast · near ${esc(fc.place)}</h3><div class="forecast">${fc.periods.slice(0, 7).map((p) => `
      <div class="fc"><span class="n">${esc(p.name)}</span><span class="t">${p.temperature}°</span><span class="s">${esc(p.shortForecast)}${p.windSpeed ? ` · ${esc(p.windDirection)} ${esc(p.windSpeed)}` : ""}</span></div>`).join("")}</div></div>`;
  } catch (e) {
    return `<div class="d-section d-caption">Forecast unavailable for this spot (NWS forecasts cover land and nearshore points only).</div>`;
  }
}

async function showWx(id) {
  const o = state.wx.find((x) => x.id === id);
  if (!o) return;
  const head = `
    <div class="d-kicker">NWS observation · ${id}</div>
    <h2 class="d-title">${esc(o.name)}</h2>
    <div class="d-big">
      <div class="stat"><div class="stat-label">Temp</div><div class="stat-value">${fmt(o.tempF, 0)}<small>°F</small></div></div>
      <div class="stat"><div class="stat-label">Wind</div><div class="stat-value">${fmt(o.windMph, 0)}<small>mph</small></div></div>
      <div class="stat"><div class="stat-label">Pressure</div><div class="stat-value">${fmt(o.pressureMb, 0)}<small>mb</small></div></div>
    </div>
    <div class="d-caption">${esc(o.text || "")} · ${timeAgo(o.t)}${o.gustMph ? ` · gusts ${fmt(o.gustMph, 0)} mph` : ""}${o.precipLastHourIn ? ` · ${fmt(o.precipLastHourIn, 2)}″ rain last hour` : ""}</div>`;
  openDetail(head + `<div class="loading">Loading forecast…</div>`);
  const fc = await forecastHTML(o.lon, o.lat);
  if (!$("#detail").hidden) openDetail(head + fc);
}

async function showPointForecast(lngLat, alertFeats = []) {
  clickMarker = new maplibregl.Marker({ color: "#5ec8e5", scale: 0.7 }).setLngLat(lngLat).addTo(map);
  const head = `<div class="d-kicker">Point forecast</div><h2 class="d-title">${lngLat.lat.toFixed(3)}°, ${lngLat.lng.toFixed(3)}°</h2>`;
  openDetail(head + `<div class="loading">Checking flooding and the forecast…</div>`);
  const [fl, fc] = await Promise.all([floodHereHTML(lngLat.lng, lngLat.lat), forecastHTML(lngLat.lng, lngLat.lat)]);
  if (!$("#detail").hidden) openDetail(head + fl + (alertFeats.length ? alertsHTML(alertFeats) : "") + fc);
}

// "Is it flooding here / is it going to?" for a clicked spot: NWS alerts covering it, real reports near it,
// gauges in flood near it, and NOAA's map of how high the water must get to reach it vs. the nearest tide gauge.
async function floodHereHTML(lon, lat) {
  const when = (t) => new Date(t).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
  const lines = [];
  const hits = {};
  for (const f of state.alerts?.features ?? []) if (inGeometry(lon, lat, f.geometry)) hits[f.properties.id] = f.properties;
  for (const a of Object.values(hits).filter((x) => /flood|surge|surf|tsunami/i.test(x.event))) {
    const ends = state.alerts.items[a.id]?.ends;
    lines.push(`<li class="bad"><b>${esc(a.event)}</b> covers this spot${ends ? ` until ${when(ends)}` : ""}.</li>`);
  }

  const near = state.reports.filter((r) => inRange(r.t)).map((r) => ({ r, d: distM(lon, lat, r.lon, r.lat) })).filter((x) => x.d < 3219).sort((a, b) => a.d - b.d);
  if (near.length) lines.push(`<li class="bad"><b>${near.length} flood report${near.length > 1 ? "s" : ""}</b> within 2 mi in the last ${RANGE_LABEL[range]}; closest ${miles(near[0].d)} away, ${timeAgo(near[0].r.t)}: ${esc(near[0].r.remark || near[0].r.type)}</li>`);
  else lines.push(`<li>No flood reports within 2 mi in the last ${RANGE_LABEL[range]}.</li>`);

  const river = nearest(state.rivers.flooding, lon, lat);
  if (river && river.d < 16093) lines.push(`<li class="warn"><b>${esc(river.s.name)}</b> (${miles(river.d)} away) is at <b>${esc(RIVER_COLORS[river.s.now] ? river.s.now : `forecast ${river.s.forecast}`)}</b> stage.</li>`);

  const g = nearest(state.tides, lon, lat, (s) => s.mhhw != null && s.latest);
  let spot = null;
  try { spot = await spotFloodLevel(lon, lat); } catch { spot = null; }
  if (g) {
    const a = gaugeAboveHigh(g.s);
    const gaugeLine = `Nearest tide gauge, <b>${esc(g.s.name)}</b> (${miles(g.d)} away), reads <b>${signed(a.now, 1)} ft</b> vs normal high tide${a.next ? `; highest expected in the next 48 h <b>${signed(a.next.v, 1)} ft</b> around ${when(a.next.t)}` : ""}.`;
    if (!spot) lines.push(`<li>${gaugeLine} NOAA's flood map couldn't be read for this spot.</li>`);
    else if (spot.level == null) lines.push(`<li class="good">Water would have to rise <b>more than 10 ft above normal high tide</b> to reach this spot on NOAA's map, so tides won't flood it. ${gaugeLine}</li>`);
    else if (spot.level === 0) lines.push(`<li>This spot is water, marsh or tideland: NOAA's map has it wet at every normal high tide. ${gaugeLine}</li>`);
    else {
      const kind = spot.kind === "low" ? " (low ground behind a barrier: it floods through drains or gaps, not straight over the edge)" : "";
      const wetNow = a.now != null && a.now >= spot.level;
      const wetNext = a.next && a.next.v >= spot.level;
      const verdict = wetNow ? `<li class="bad"><b>Likely flooding now.</b>` : wetNext ? `<li class="warn"><b>Could flood around ${when(a.next.t)}.</b>` : `<li class="good"><b>Not expected to flood from the tide in the next 48 h.</b>`;
      lines.push(`${verdict} On NOAA's map the water reaches this spot at <b>${spot.level} ft above normal high tide</b>${kind}. ${gaugeLine}</li>`);
    }
  }
  return `<div class="d-section flood-here"><h3>Flooding here?</h3><ul class="flood-lines">${lines.join("")}</ul>
    <div class="d-caption">Tide check = NOAA ground-height map vs. the nearest gauge's water and forecast (tide + today's surge). Rain, drains and waves can flood places the tide check misses; reports and alerts are what people actually saw.</div></div>`;
}

function showReports(lngLat) {
  const list = state.reports.filter((r) => inRange(r.t)).map((r) => ({ r, d: distM(lngLat.lng, lngLat.lat, r.lon, r.lat) })).filter((x) => x.d < 800).sort((a, b) => b.r.t - a.r.t);
  if (!list.length) return;
  openDetail(`<div class="d-kicker">${list.length} flood report${list.length > 1 ? "s" : ""} here · last ${RANGE_LABEL[range]}</div>
    ${list.slice(0, 20).map(({ r }) => `<div class="d-section">
      <span class="chip" style="background:${REPORT_COLORS[reportClass(r)]}22;color:${REPORT_COLORS[reportClass(r)]}">${esc(r.type)}</span>
      <h2 class="d-title" style="margin-top:8px;font-size:14px">${esc(r.place)}</h2>
      <div class="d-caption">${new Date(r.t).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} · ${timeAgo(r.t)}${r.source ? ` · ${esc(r.source)}` : ""}</div>
      ${r.remark ? `<div class="d-section d-text">${esc(r.remark)}</div>` : ""}
    </div>`).join("")}`);
}

function showRiver(id) {
  const g = state.rivers.flooding.find((x) => x.id === id);
  if (!g) return;
  const dt = (t) => (t ? new Date(t).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" }) : "—");
  openDetail(`<div class="d-kicker">NOAA gauge · ${esc(g.id)}</div><h2 class="d-title">${esc(g.name)}</h2>
    <ul class="d-list">
      <li><span class="lbl">Now</span><span>${esc(String(g.now).replace(/_/g, " "))}${g.nowValue > -999 ? ` · ${fmt(g.nowValue, 2)} ${esc(g.unit)}` : ""} · ${dt(g.t)}</span></li>
      <li><span class="lbl">Forecast</span><span>${g.forecast ? `${esc(g.forecast)}${g.forecastValue > -999 ? ` · ${fmt(g.forecastValue, 2)}` : ""} · ${dt(g.forecastT)}` : "no flooding forecast"}</span></li>
    </ul>
    <div class="d-section d-caption"><a href="https://water.noaa.gov/gauges/${encodeURIComponent(g.id)}" target="_blank" rel="noopener">NOAA water prediction page ↗</a></div>`);
}

function showAlerts(feats) {
  const html = alertsHTML(feats);
  if (html) openDetail(html);
}
function alertsHTML(feats) {
  const ids = [...new Set(feats.map((f) => f.properties.id))];
  const list = ids.map((id) => ({ id, ...state.alerts?.items?.[id] })).filter((p) => p.event);
  if (!list.length) return "";
  const dt = (s) => (s ? new Date(s).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" }) : "—");
  return (`
    <div class="d-kicker">${list.length} active alert${list.length > 1 ? "s" : ""} here</div>
    ${list.map((p) => `
      <div class="d-section">
        <span class="chip ${p.kind}">${esc(p.event)}</span>
        <h2 class="d-title" style="margin-top:8px;font-size:14px">${esc(p.headline || "")}</h2>
        <ul class="d-list"><li><span class="lbl">Until</span><span>${dt(p.ends)}</span></li></ul>
        <div class="d-section d-text">${esc(p.description || "")}${p.instruction ? "\n\n" + esc(p.instruction) : ""}</div>
      </div>`).join("")}
  `);
}

// ---------- boot ----------

renderLayerList();
map.on("load", () => {
  addDataLayers();
  for (const L of LAYERS) applyOpacity(L);
  loadAll();
  setInterval(() => { if (!document.hidden) loadAll(); }, REFRESH_MS);
});
$("#refresh").addEventListener("click", () => loadAll({ force: true }));
// Theme picker: Alola CSS palettes. Writes the shared `alola-theme` cookie (across *.alola.lol when hosted there),
// so alola.lol, EMON, TIDO and this page all change together.
{
  const sel = $("#theme");
  const now = document.documentElement.dataset.alola || "white";
  sel.innerHTML = Object.keys(window.ALOLA_THEMES || { white: 1 }).map((n) => `<option value="${n}"${n === now ? " selected" : ""}>${n}</option>`).join("");
  sel.addEventListener("change", () => {
    const dom = /(^|\.)alola\.lol$/.test(location.hostname) ? ";domain=.alola.lol" : "";
    document.cookie = `alola-theme=${encodeURIComponent(sel.value)}${dom};path=/;max-age=31536000;SameSite=Lax`;
    const q = new URLSearchParams(location.search);
    q.delete("alola");
    location.href = location.pathname + (q.toString() ? `?${q}` : "") + location.hash;
  });
}

const picker = $("#region");
picker.innerHTML = Object.values(REGIONS).map((r) => `<option value="${r.id}"${r.id === REGION.id ? " selected" : ""}>${esc(r.name)}</option>`).join("");
picker.addEventListener("change", () => {
  store.set("tides-region", picker.value);
  location.href = `${location.pathname}?region=${encodeURIComponent(picker.value)}`; // fresh map view for the new region
});
document.title = `Coast Watch · ${REGION.name}`;

function paintTimeline() {
  for (const b of document.querySelectorAll("#timeline button")) b.setAttribute("aria-pressed", String(b.dataset.range === range));
}
for (const b of document.querySelectorAll("#timeline button")) {
  b.addEventListener("click", () => {
    range = b.dataset.range;
    store.set("tides-range", range);
    paintTimeline();
    renderSignals();
    renderReports();
    renderNews();
    if (current) current.refresh?.();
  });
}
paintTimeline();

// The header grows with the fonts and pickers; keep the layer panel just under it on wide screens.
function placeLayers() {
  const below = Math.ceil($(".brand").getBoundingClientRect().bottom);
  const wide = window.innerWidth > 820;
  $("#layers").style.top = wide ? `${below + 12}px` : "";
  $("#right").style.top = wide ? "" : `${below + 8}px`; // phones: the details sheet starts under the header
}
placeLayers();
window.addEventListener("resize", placeLayers);
document.fonts?.ready.then(placeLayers);

document.addEventListener("change", (e) => {
  if (e.target?.id !== "flood-level") return;
  flood.pick = e.target.value;
  store.set("tides-floodmap", flood.pick);
  updateFloodMap();
});
document.addEventListener("focusin", (e) => { if (e.target?.id === "flood-level") e.target.value = flood.pick; });
map.on("moveend", () => { if (state.tides.length && (flood.pick === "now" || flood.pick === "next")) updateFloodMap(); });
window.addEventListener("resize", () => { drawOni(); });
