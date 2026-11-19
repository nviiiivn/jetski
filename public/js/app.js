import { baseStyle } from "./map-style.js";
import { lineChart } from "./charts.js";
import {
  TIDE_STATIONS, BUOYS, WX_STATIONS,
  fetchTideStation, fetchWaterTemp, fetchMonthlyMean, fetchBuoy,
  fetchObservation, fetchAlerts, fetchPointForecast,
  fetchONI, fetchWeeklyNino, ensoPhase,
} from "./data.js";

const REFRESH_MS = 10 * 60 * 1000;
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
const TEMP_STOPS = [[48, "#3d6fe0"], [53, "#2fb7c4"], [57, "#7fcf74"], [61, "#f2c14e"], [66, "#f0643c"]];
const WAVE_STOPS = [[2, "#2a6f8f"], [6, "#2fb7c4"], [10, "#b8e07a"], [15, "#f2c14e"], [20, "#f0643c"]];
const residColor = ramp(RESID_STOPS);
const slaColor = ramp(SLA_STOPS);
const tempColor = ramp(TEMP_STOPS);
const waveColor = ramp(WAVE_STOPS);
const ALERT_COLORS = { warning: "#ff5a5f", watch: "#ff9f43", advisory: "#f7d154", statement: "#7aa7ff" };

// ---------- layer registry ----------
// Listed top → bottom, i.e. first entry draws on top of the map.

const LAYERS = [
  {
    id: "wx", title: "Weather stations", meta: "NWS · airport observations", swatch: "#d7dde7",
    mapLayers: ["wx-circle", "wx-arrow", "wx-label"], visible: true, opacity: 1,
    legend: () => `<div class="legend-note">Air temperature °F · arrow shows wind direction (blowing toward), length ∝ speed.</div>`,
  },
  {
    id: "buoys", title: "Offshore buoys", meta: "NOAA NDBC · waves & wind", swatch: "#2fb7c4",
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
      `<div class="legend-note">El Niño typically raises West Coast sea level by several inches for months at a time.</div>`,
  },
  {
    id: "alerts", title: "NWS alerts", meta: "Bay Area forecast office", swatch: "#ff9f43",
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
  symbol: ["text-opacity", "icon-opacity"],
};
const baseOpacity = {}; // mapLayerId -> { prop: value }

// ---------- map ----------

const map = new maplibregl.Map({
  container: "map",
  style: baseStyle,
  center: [-122.38, 37.72],
  zoom: window.innerWidth < 820 ? 8 : 8.7,
  minZoom: 5,
  maxZoom: 15,
  maxBounds: [[-126.5, 34.5], [-118.5, 40.8]],
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
  for (const id of ["alerts", "sla", "tides", "sst", "buoys", "wx"]) map.addSource(id, { type: "geojson", data: empty() });

  const label = (id, src, extra = {}) => ({
    id, type: "symbol", source: src,
    layout: {
      "text-field": ["get", "label"], "text-font": ["Noto Sans Bold"], "text-size": 11,
      "text-offset": [0, 1.25], "text-anchor": "top", "text-allow-overlap": false, "text-line-height": 1.15,
      ...extra.layout,
    },
    paint: { "text-color": "#e6eaf0", "text-halo-color": "#0d1117", "text-halo-width": 1.4, ...extra.paint },
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
        "circle-stroke-width": 2, "circle-stroke-color": "#0d1117", "circle-stroke-opacity": 1,
      } },
    label("sst-label", "sst", { layout: { "text-offset": [1.0, 0], "text-anchor": "left" } }),

    { id: "tides-circle", type: "circle", source: "tides",
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 6, 5, 12, 9],
        "circle-color": ["get", "color"], "circle-opacity": 1,
        "circle-stroke-width": 2, "circle-stroke-color": "#e6eaf0", "circle-stroke-opacity": 0.9,
      } },
    label("tides-label", "tides"),

    { id: "buoys-circle", type: "circle", source: "buoys",
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 6, 5, 12, 9],
        "circle-color": ["get", "color"], "circle-opacity": 1,
        "circle-stroke-width": 2, "circle-stroke-color": "#0d1117", "circle-stroke-opacity": 1,
      } },
    arrow("buoys-arrow", "buoys", "#9fe6f2"),
    label("buoys-label", "buoys"),

    { id: "wx-circle", type: "circle", source: "wx",
      paint: {
        "circle-radius": 4, "circle-color": "#d7dde7", "circle-opacity": 1,
        "circle-stroke-width": 1.5, "circle-stroke-color": "#0d1117", "circle-stroke-opacity": 1,
      } },
    arrow("wx-arrow", "wx", "#d7dde7"),
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
  for (const id of L.mapLayers) map.setLayoutProperty(id, "visibility", L.visible ? "visible" : "none");
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

const state = { tides: [], temps: new Map(), monthly: new Map(), buoys: [], wx: [], alerts: null, oni: [], weekly: [] };
const pt = (lon, lat, props) => ({ type: "Feature", geometry: { type: "Point", coordinates: [lon, lat] }, properties: props });
const settled = (ps) => Promise.allSettled(ps).then((rs) => rs.filter((r) => r.status === "fulfilled").map((r) => r.value));

async function loadTides() {
  setStatus("tides", "Loading…");
  const stations = await settled(TIDE_STATIONS.map(fetchTideStation));
  state.tides = stations;
  const live = stations.filter((s) => s.latest);
  map.getSource("tides").setData({
    type: "FeatureCollection",
    features: live.map((s) => pt(s.lon, s.lat, {
      id: s.id, kind: "tide", name: s.name, color: residColor(s.residual),
      label: `${fmt(s.latest.v, 1)} ft\n${signed(s.residual, 2)}`,
    })),
  });
  setStatus("tides", `${live.length} gauges · CO-OPS · ${timeAgo(Math.max(...live.map((s) => +s.latest.t)))}`);
}

async function loadMonthly() {
  setStatus("sla", "Loading…");
  const res = await settled(TIDE_STATIONS.map(async (s) => [s, await fetchMonthlyMean(s)]));
  const feats = [];
  for (const [s, series] of res) {
    state.monthly.set(s.id, series);
    const last = series.at(-1);
    if (!last) continue;
    feats.push(pt(s.lon, s.lat, {
      id: s.id, kind: "tide", name: s.name, color: slaColor(last.v), v: last.v,
      label: `${signed(last.v, 2)} ft · ${last.t.toLocaleDateString(undefined, { month: "short" })}`,
    }));
  }
  map.getSource("sla").setData({ type: "FeatureCollection", features: feats });
  setStatus("sla", `${feats.length} gauges · monthly mean vs 1983–2001`);
}

async function loadBuoys() {
  setStatus("buoys", "Loading…");
  state.buoys = await settled(BUOYS.map(fetchBuoy));
  map.getSource("buoys").setData({
    type: "FeatureCollection",
    features: state.buoys.map((b) => pt(b.lon, b.lat, {
      id: b.id, kind: "buoy", name: b.name, color: waveColor(b.waveFt),
      label: b.waveFt != null ? `${fmt(b.waveFt, 0)} ft @ ${fmt(b.period, 0)}s` : `${fmt(b.windKt, 0)} kt`,
      ...(b.windDir != null ? { rot: (b.windDir + 180) % 360, spd: b.windKt ?? 0 } : {}),
    })),
  });
  setStatus("buoys", `${state.buoys.length} buoys · NDBC · ${timeAgo(Math.max(...state.buoys.map((b) => +b.updated)))}`);
}

async function loadTemps() {
  setStatus("sst", "Loading…");
  const res = await settled(TIDE_STATIONS.map(async (s) => [s, await fetchWaterTemp(s)]));
  for (const [s, t] of res) state.temps.set(s.id, t);
  const feats = res.map(([s, t]) => pt(s.lon, s.lat, {
    id: s.id, kind: "tide", name: s.name, color: tempColor(t.v), label: `${fmt(t.v, 0)}°`,
  }));
  // buoy SSTs too (buoys load in parallel; merge whatever has arrived)
  await buoysReady;
  for (const b of state.buoys)
    if (b.sstF != null)
      feats.push(pt(b.lon, b.lat, { id: b.id, kind: "buoy", name: b.name, color: tempColor(b.sstF), label: `${fmt(b.sstF, 0)}°` }));
  map.getSource("sst").setData({ type: "FeatureCollection", features: feats });
  setStatus("sst", `${feats.length} sensors · CO-OPS + NDBC`);
}

async function loadWx() {
  setStatus("wx", "Loading…");
  state.wx = await settled(WX_STATIONS.map(fetchObservation));
  map.getSource("wx").setData({
    type: "FeatureCollection",
    features: state.wx.map((o) => pt(o.lon, o.lat, {
      id: o.id, kind: "wx", name: o.name,
      label: `${fmt(o.tempF, 0)}°${o.windMph != null ? ` · ${fmt(o.windMph, 0)} mph` : ""}`,
      ...(o.windDir != null && o.windMph ? { rot: (o.windDir + 180) % 360, spd: o.windMph * 0.87 } : {}),
    })),
  });
  setStatus("wx", `${state.wx.length} stations · NWS · ${timeAgo(Math.max(...state.wx.map((o) => +o.t)))}`);
}

async function loadAlerts() {
  setStatus("alerts", "Loading…");
  state.alerts = await fetchAlerts();
  map.getSource("alerts").setData(state.alerts);
  const n = state.alerts.count;
  setStatus("alerts", n ? `${n} active · NWS San Francisco Bay Area` : "No active alerts");
}

async function loadEnso() {
  const [oni, weekly] = await Promise.all([fetchONI(), fetchWeeklyNino()]);
  state.oni = oni;
  state.weekly = weekly;
  const last = oni.at(-1), wk = weekly.at(-1);
  const phase = ensoPhase(last.v);
  const chip = $("#enso-phase");
  chip.textContent = phase.label;
  chip.className = "chip " + phase.cls;
  $("#oni-season").textContent = `${last.season} ${last.year}`;
  const big = (v) => `<span class="${v >= 0 ? "pos" : "neg"}">${signed(v, 1)}</span><small>°C</small>`;
  $("#oni-value").innerHTML = big(last.v);
  $("#n34-value").innerHTML = big(wk.nino34);
  $("#n12-value").innerHTML = big(wk.nino12);
  drawOni();
}
function drawOni() {
  if (!state.oni.length) return;
  const since = new Date(Date.UTC(new Date().getUTCFullYear() - 12, 0, 1));
  lineChart($("#oni-chart"), {
    height: 120, bars: state.oni.filter((d) => d.t >= since), zero: true, band: [-0.5, 0.5],
    yFormat: (v) => (v > 0 ? "+" : "") + v,
  });
}

function renderSignals() {
  const resid = state.tides.filter((s) => s.residual != null).map((s) => s.residual);
  const sla = [...state.monthly.values()].map((s) => s.at(-1)?.v).filter((v) => v != null);
  const temps = [...state.temps.values()].map((t) => t.v);
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const coastal = state.alerts?.raw?.filter((f) => /coastal|surf|surge|tsunami|gale|storm/i.test(f.properties.event)).length ?? 0;
  const cell = (k, v) => `<div class="signal"><div class="k">${k}</div><div class="v">${v}</div></div>`;
  $("#bay-signals").innerHTML =
    cell("Avg tide residual", `${signed(avg(resid), 2)} ft`) +
    cell("Avg monthly sea level", `${signed(avg(sla), 2)} ft`) +
    cell("Avg Bay water temp", `${fmt(avg(temps), 1)} °F`) +
    cell("Coastal / marine alerts", coastal) +
    `<p class="explain">El Niño tends to lift Bay Area sea levels, warm coastal water and steer stronger storms in, so king tides plus storm surge flood more easily.</p>`;
}

let buoysReady;
async function loadAll() {
  const btn = $("#refresh");
  btn.classList.add("spinning");
  $("#updated").textContent = "Updating…";
  const fail = (id) => (e) => { console.error(id, e); setStatus(id, "Failed to load — will retry", true); };
  buoysReady = loadBuoys().catch(fail("buoys"));
  await Promise.allSettled([
    loadTides().catch(fail("tides")),
    loadMonthly().catch(fail("sla")),
    buoysReady,
    loadTemps().catch(fail("sst")),
    loadWx().catch(fail("wx")),
    loadAlerts().catch(fail("alerts")),
    loadEnso().catch((e) => { console.error(e); $("#enso-phase").textContent = "Unavailable"; }),
  ]);
  renderSignals();
  btn.classList.remove("spinning");
  $("#updated").textContent = `Updated ${new Date().toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })} · Bay Area`;
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
  const clickable = ["wx-circle", "buoys-circle", "tides-circle", "sst-circle", "sla-halo", "alerts-fill"];
  for (const id of clickable) {
    map.on("mouseenter", id, () => (map.getCanvas().style.cursor = "pointer"));
    map.on("mouseleave", id, () => { map.getCanvas().style.cursor = ""; hover.remove(); });
    map.on("mousemove", id, (e) => {
      const p = e.features[0].properties;
      const title = p.event || p.name;
      const sub = p.event ? p.areaDesc?.split(";")[0] : p.label?.replace("\n", " · ");
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
    if (f.layer.id === "alerts-fill") return showAlerts(feats.filter((x) => x.layer.id === "alerts-fill"), e.lngLat);
    if (p.kind === "tide") return showTide(p.id);
    if (p.kind === "buoy") return showBuoy(p.id);
    if (p.kind === "wx") return showWx(p.id);
  });
}

function showTide(id) {
  const render = () => {
    const s = state.tides.find((x) => x.id === id) || TIDE_STATIONS.find((x) => x.id === id);
    const temp = state.temps.get(id);
    const monthly = state.monthly.get(id) || [];
    const nextEx = (s.extremes || []).filter((x) => x.t > Date.now()).slice(0, 4);
    openDetail(`
      <div class="d-kicker">Tide gauge · ${id}</div>
      <h2 class="d-title">${esc(s.name)}</h2>
      <div class="d-big">
        <div class="stat"><div class="stat-label">Water level (MLLW)</div><div class="stat-value">${fmt(s.latest?.v, 2)}<small>ft</small></div></div>
        <div class="stat"><div class="stat-label">Residual</div><div class="stat-value ${s.residual > 0 ? "pos" : "neg"}">${signed(s.residual, 2)}<small>ft</small></div></div>
        ${temp ? `<div class="stat"><div class="stat-label">Water</div><div class="stat-value">${fmt(temp.v, 1)}<small>°F</small></div></div>` : ""}
      </div>
      <div class="d-caption">${s.latest ? `Observed ${timeAgo(s.latest.t)}` : "No recent observations"}</div>
      <div class="d-section">
        <h3>Water level · past 36 h / next 48 h</h3>
        <div><span class="legend-line"><i style="border-color:var(--accent)"></i>Observed</span><span class="legend-line"><i class="dash" style="border-color:#8b95a7"></i>Predicted</span></div>
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
      height: 150, now: true,
      series: [
        { data: s.predicted || [], color: "#8b95a7", dash: "4 3", width: 1.3 },
        { data: s.observed || [], color: "#5ec8e5", width: 2, area: true },
      ],
      markers: nextEx.map((x) => ({ t: x.t, v: x.v, label: fmt(x.v, 1), below: x.type.startsWith("L") })),
      yFormat: (v) => v + "′",
    });
    lineChart($("#sla-chart"), { height: 110, bars: monthly, zero: true, yFormat: (v) => (v > 0 ? "+" : "") + v });
  };
  render();
}

function showBuoy(id) {
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
      <div class="d-section"><h3>Wave height · 3 days (ft)</h3><div id="wave-chart" class="chart-wrap"></div></div>
      <div class="d-section"><h3>Sea surface temperature · 3 days (°F)</h3><div id="sst-chart" class="chart-wrap"></div></div>
      <div class="d-section d-caption"><a href="https://www.ndbc.noaa.gov/station_page.php?station=${id}" target="_blank" rel="noopener">NDBC station page ↗</a></div>
    `, render);
    lineChart($("#wave-chart"), { height: 110, series: [{ data: b.series.waveFt, color: "#2fb7c4", area: true }] });
    lineChart($("#sst-chart"), { height: 110, series: [{ data: b.series.sstF, color: "#f2c14e" }] });
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

async function showPointForecast(lngLat) {
  clickMarker = new maplibregl.Marker({ color: "#5ec8e5", scale: 0.7 }).setLngLat(lngLat).addTo(map);
  const head = `<div class="d-kicker">Point forecast</div><h2 class="d-title">${lngLat.lat.toFixed(3)}°, ${lngLat.lng.toFixed(3)}°</h2>`;
  openDetail(head + `<div class="loading">Loading forecast…</div>`);
  const fc = await forecastHTML(lngLat.lng, lngLat.lat);
  if (!$("#detail").hidden) openDetail(head + fc);
}

function showAlerts(feats) {
  const seen = new Set();
  const list = feats.map((f) => f.properties).filter((p) => !seen.has(p.id) && seen.add(p.id));
  const dt = (s) => (s ? new Date(s).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" }) : "—");
  openDetail(`
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
  setInterval(loadAll, REFRESH_MS);
});
$("#refresh").addEventListener("click", () => loadAll());
window.addEventListener("resize", () => { drawOni(); });
