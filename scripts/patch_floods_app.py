#!/usr/bin/env python3
"""tides.alola.lol (2026-11-24): adds flooding to site/js/app.js: NOAA flood map layer, flood reports, gauges in
flood, flood news, gauge flood levels, and "Flooding here?" on the point forecast. One-shot: stops if already applied."""
import sys

P = 'site/js/app.js'
s = open(P, encoding='utf-8').read()
if 'floodHereHTML' in s:
    sys.exit('already applied')


def sub(old, new, count=1):
    global s
    n = s.count(old)
    if n != count:
        sys.exit(f'STOP {n} matches for {old[:90]!r}')
    s = s.replace(old, new)


# 1 imports
sub('import { REGIONS, DEFAULT_REGION } from "../../shared/stations.js";\n',
'''import { REGIONS, DEFAULT_REGION } from "../../shared/stations.js";
import { FLOOD_LEVELS, floodTiles, snapLevel, nearest, gaugeAboveHigh, inGeometry, spotFloodLevel, distM, miles } from "./floods.js";
''')

# 2 layers
sub('''const LAYERS = [
  {
    id: "wx",''', '''const REPORT_COLORS = { coastal: "#00d5ff", flood: "#4d8dff", "311": "#c08cff", other: "#9fb3c8" };
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
    id: "wx",''')
sub('''  {
    id: "alerts", title: "NWS alerts", meta: REGION.alertOffice,''', '''  {
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
    id: "alerts", title: "NWS alerts", meta: REGION.alertOffice,''')

# 3 opacity props + sources + layer defs
sub('''  symbol: ["text-opacity", "icon-opacity"],
};''', '''  symbol: ["text-opacity", "icon-opacity"], raster: ["raster-opacity"],
};''')
sub('''  for (const id of ["alerts", "sla", "tides", "sst", "buoys", "wx"]) map.addSource(id, { type: "geojson", data: empty() });''',
'''  for (const id of ["alerts", "sla", "tides", "sst", "buoys", "wx", "reports", "rivers"]) map.addSource(id, { type: "geojson", data: empty() });
  map.addSource("floodmap", {
    type: "raster", tiles: floodTiles(flood.level ?? 0), tileSize: 256, maxzoom: 16,
    attribution: '<a href="https://coast.noaa.gov/slr/" target="_blank" rel="noopener">NOAA sea level maps</a>',
  });''')
sub('''  const defs = [
    { id: "alerts-fill", type: "fill", source: "alerts",''', '''  const defs = [
    { id: "floodmap-raster", type: "raster", source: "floodmap", paint: { "raster-opacity": 0.7, "raster-fade-duration": 0 } },
    { id: "rivers-circle", type: "circle", source: "rivers",
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 6, 5, 12, 9],
        "circle-color": ["get", "color"], "circle-opacity": 1,
        "circle-stroke-width": 2, "circle-stroke-color": "#0d1117", "circle-stroke-opacity": 1,
      } },
    label("rivers-label", "rivers", { layout: { "text-size": 10.5 }, paint: { "text-color": ["get", "color"] } }),
    { id: "reports-circle", type: "circle", source: "reports",
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 6, 4, 12, 7],
        "circle-color": ["get", "color"], "circle-opacity": 0.95,
        "circle-stroke-width": 1.5, "circle-stroke-color": "#ffffff", "circle-stroke-opacity": 0.85,
      } },
    { id: "alerts-fill", type: "fill", source: "alerts",''')
sub('''        "circle-color": ["get", "color"], "circle-opacity": 1,
        "circle-stroke-width": 2, "circle-stroke-color": "#e6eaf0", "circle-stroke-opacity": 0.9,''',
'''        "circle-color": ["get", "color"], "circle-opacity": 1,
        "circle-stroke-width": ["case", ["get", "flooding"], 4, 2], "circle-stroke-color": ["get", "stroke"], "circle-stroke-opacity": 0.9,''')

sub('''function applyVisibility(L) {
  for (const id of L.mapLayers) map.setLayoutProperty(id, "visibility", L.visible ? "visible" : "none");
}''', '''function applyVisibility(L) {
  const on = L.visible && (L.id !== "floodmap" || flood.level != null);
  for (const id of L.mapLayers) map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
}''')

# 4 state (+ flood map settings, defined before the map layers are added)
sub('''const state = { tides: [], temps: new Map(), monthly: new Map(), buoys: [], wx: [], alerts: null, oni: [], weekly: [], phase: null, climateStations: [], generated: {} };''',
'''const state = { tides: [], temps: new Map(), monthly: new Map(), buoys: [], wx: [], alerts: null, oni: [], weekly: [], phase: null, climateStations: [], generated: {}, reports: [], rivers: { watched: 0, flooding: [] }, news: [] };''')
sub('''// ---------- map ----------
''', '''// ---------- map ----------
const flood = { pick: store.get("tides-floodmap") || "now", level: null };
''')

# 5 tide features: flood status
sub('''      id: s.id, kind: "tide", name: s.name, color: residColor(s.residual),
      label: `${fmt(s.latest.v, 1)} ft\\n${signed(s.residual, 2)}`,''',
'''      id: s.id, kind: "tide", name: s.name, color: residColor(s.residual),
      ...floodState(s),
      label: `${fmt(s.latest.v, 1)} ft\\n${signed(s.residual, 2)}${s.flood?.minor != null && s.latest.v >= s.flood.minor ? "\\nFLOODING" : ""}`,''')

# 6 apply table + loaders
sub('''const APPLY = {
  weather: [applyWeather, ["wx", "alerts"]],''', '''// ---------- flooding (tides.alola.lol) ----------
function floodState(s) {
  const minor = s.flood?.minor;
  if (minor == null || !s.latest) return { stroke: "#e6eaf0", flooding: false };
  const gap = s.latest.v - minor;
  return { stroke: gap >= 0 ? "#ff3b3b" : gap > -0.5 ? "#ffb020" : "#e6eaf0", flooding: gap >= 0 };
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
        label: `${g.name.split(/ at | near /i)[0].slice(0, 24)}\\n${RIVER_COLORS[g.now] ? g.now : `forecast ${g.forecast}`}` });
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
  weather: [applyWeather, ["wx", "alerts"]],''')
sub('''  tides: [(t) => { applyTides(t); renderTemps(); }, ["tides"]],''', '''  tides: [(t) => { applyTides(t); renderTemps(); updateFloodMap(); }, ["tides"]],''')

# 7 signals
sub('''    cell(`Highest surge · last ${RANGE_LABEL[range]}`,''', '''    cell(`Flood reports · last ${RANGE_LABEL[range]}`, state.reports.filter((r) => inRange(r.t)).length) +
    cell("Gauges at flood level now", (() => { const w = state.tides.filter((s) => s.flood?.minor != null && s.latest); const n = w.filter((s) => s.latest.v >= s.flood.minor).length; return `${n} <small>of ${w.length} with a flood level</small>`; })()) +
    cell(`Highest surge · last ${RANGE_LABEL[range]}`,''')

# 8 click targets
sub('''  const clickable = ["wx-circle", "buoys-circle", "tides-circle", "sst-circle", "sla-halo", "alerts-fill"];''',
    '''  const clickable = ["reports-circle", "rivers-circle", "wx-circle", "buoys-circle", "tides-circle", "sst-circle", "sla-halo", "alerts-fill"];''')
sub('''    if (p.kind === "tide") return showTide(p.id);''', '''    if (p.kind === "report") return showReports(e.lngLat);
    if (p.kind === "river") return showRiver(p.id);
    if (p.kind === "tide") return showTide(p.id);''')
sub('''      const sub = p.event ? p.areaDesc?.split(";")[0] : p.label?.replace("\\n", " · ");''',
    '''      const sub = p.event ? p.areaDesc?.split(";")[0] : p.label?.replaceAll("\\n", " · ");''')

# 9 tide detail: flood levels
sub('''        <li><span class="lbl">Highest surge · last ${RANGE_LABEL[range]}</span><span>${hiRes ? `${signed(hiRes.v, 2)} ft · ${when(hiRes.t)}` : "—"}</span></li>
      </ul>''', '''        <li><span class="lbl">Highest surge · last ${RANGE_LABEL[range]}</span><span>${hiRes ? `${signed(hiRes.v, 2)} ft · ${when(hiRes.t)}` : "—"}</span></li>
        ${s.mhhw != null && s.latest ? `<li><span class="lbl">Now vs normal high tide (MHHW ${fmt(s.mhhw, 2)} ft)</span><span>${signed(s.latest.v - s.mhhw, 2)} ft</span></li>` : ""}
        ${s.flood?.minor != null ? `<li><span class="lbl">${s.flood.src} minor flood level</span><span>${fmt(s.flood.minor, 2)} ft${s.latest ? ` · ${s.latest.v >= s.flood.minor ? `<b class="pos">FLOODING, ${fmt(s.latest.v - s.flood.minor, 2)} ft over</b>` : `${fmt(s.flood.minor - s.latest.v, 2)} ft to go`}` : ""}</span></li>` : `<li><span class="lbl">Flood level</span><span>NOAA sets none for this gauge</span></li>`}
        ${s.flood?.moderate != null ? `<li><span class="lbl">Moderate · major flood level</span><span>${fmt(s.flood.moderate, 2)} · ${fmt(s.flood.major, 2)} ft</span></li>` : ""}
      </ul>''')
sub('''        { data: inWindow(s.observed, t0, t1), color: "#5ec8e5", width: 2, area: true },
      ],''', '''        { data: inWindow(s.observed, t0, t1), color: "#5ec8e5", width: 2, area: true },
        ...(s.flood?.minor != null ? [{ data: [{ t: new Date(t0), v: s.flood.minor }, { t: new Date(t1), v: s.flood.minor }], color: "#ff5a5f", dash: "2 3", width: 1.2 }] : []),
      ],''')
sub('''        <div><span class="legend-line"><i style="border-color:var(--accent)"></i>Observed</span><span class="legend-line"><i class="dash" style="border-color:#8b95a7"></i>Predicted</span></div>''',
    '''        <div><span class="legend-line"><i style="border-color:var(--accent)"></i>Observed</span><span class="legend-line"><i class="dash" style="border-color:#8b95a7"></i>Predicted</span>${s.flood?.minor != null ? `<span class="legend-line"><i class="dash" style="border-color:#ff5a5f"></i>Minor flood level</span>` : ""}</div>''')

# 10 point forecast with "flooding here?"
sub('''async function showPointForecast(lngLat) {
  clickMarker = new maplibregl.Marker({ color: "#5ec8e5", scale: 0.7 }).setLngLat(lngLat).addTo(map);
  const head = `<div class="d-kicker">Point forecast</div><h2 class="d-title">${lngLat.lat.toFixed(3)}°, ${lngLat.lng.toFixed(3)}°</h2>`;
  openDetail(head + `<div class="loading">Loading forecast…</div>`);
  const fc = await forecastHTML(lngLat.lng, lngLat.lat);
  if (!$("#detail").hidden) openDetail(head + fc);
}''', '''async function showPointForecast(lngLat) {
  clickMarker = new maplibregl.Marker({ color: "#5ec8e5", scale: 0.7 }).setLngLat(lngLat).addTo(map);
  const head = `<div class="d-kicker">Point forecast</div><h2 class="d-title">${lngLat.lat.toFixed(3)}°, ${lngLat.lng.toFixed(3)}°</h2>`;
  openDetail(head + `<div class="loading">Checking flooding and the forecast…</div>`);
  const [fl, fc] = await Promise.all([floodHereHTML(lngLat.lng, lngLat.lat), forecastHTML(lngLat.lng, lngLat.lat)]);
  if (!$("#detail").hidden) openDetail(head + fl + fc);
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
}''')

# 11 boot wiring: flood level picker, map moves, timeline repaint
sub('''\npaintTimeline();\n''', '''\npaintTimeline();

document.addEventListener("change", (e) => {
  if (e.target?.id !== "flood-level") return;
  flood.pick = e.target.value;
  store.set("tides-floodmap", flood.pick);
  updateFloodMap();
});
document.addEventListener("focusin", (e) => { if (e.target?.id === "flood-level") e.target.value = flood.pick; });
map.on("moveend", () => { if (state.tides.length && (flood.pick === "now" || flood.pick === "next")) updateFloodMap(); });
''')
sub('''    paintTimeline();
    renderSignals();''', '''    paintTimeline();
    renderSignals();
    renderReports();
    renderNews();''')
open(P, 'w', encoding='utf-8').write(s)
print('ok')
