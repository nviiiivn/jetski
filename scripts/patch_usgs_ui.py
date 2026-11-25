#!/usr/bin/env python3
"""Coast Watch (2026-11-24): USGS creek / river / canal / Bay gauges in the page (snapshot group "gauges").
Stage is against each gauge's own datum, so the map shows the 24 h change (rising / falling), never a cross-gauge
comparison. One-shot: stops if already applied."""
import sys


def rw(path, pairs):
    s = open(path, encoding='utf-8').read()
    for old, new in pairs:
        if s.count(old) != 1:
            sys.exit(f'STOP {path}: {s.count(old)}x {old[:80]!r}')
        s = s.replace(old, new)
    open(path, 'w', encoding='utf-8').write(s)
    print('ok', path)


if 'applyUsgs' in open('site/js/app.js', encoding='utf-8').read():
    sys.exit('already applied')

rw('site/js/data.js', [
    ('export const GROUPS = ["weather", "tides", "buoys", "climate", "floods"];',
     'export const GROUPS = ["weather", "tides", "buoys", "climate", "floods", "gauges"];'),
    ('  floods: (d) => ({',
     '  gauges: (d) => ({ gauges: (d.gauges || []).map((g) => ({ ...g, series: { stageFt: g.series?.stageFt ? decodeSeries(g.series.stageFt) : [] } })) }),\n  floods: (d) => ({'),
])

rw('site/js/app.js', [
    # layer entry, right after the "Gauges in flood" layer
    ('''      `<div class="legend-note">River, creek and tide gauges NOAA tracks with official flood stages; only the ones at action stage or flooding are drawn.</div>`,
  },''',
     '''      `<div class="legend-note">River, creek and tide gauges NOAA tracks with official flood stages; only the ones at action stage or flooding are drawn.</div>`,
  },
  {
    id: "usgs", title: "Creek, river & canal gauges", meta: "USGS water level", swatch: "#8a63ff",
    mapLayers: ["usgs-circle", "usgs-label"], visible: true, opacity: 1,
    legend: () => rampLegend(CHANGE_STOPS, "Change in the last 24 h", "ft", true) +
      `<div class="legend-note">USGS stream, canal and Bay gauges near the cities. Each gauge reads against its own zero, so compare a gauge with itself (rising or falling), not with its neighbours.</div>`,
  },'''),
    ('const WAVE_STOPS = ', 'const CHANGE_STOPS = DIVERGING(1.5);\nconst changeColor = ramp(CHANGE_STOPS);\nconst WAVE_STOPS = '),
    # source + layers
    ('''  for (const id of ["alerts", "sla", "tides", "sst", "buoys", "wx", "reports", "rivers"]) map.addSource(id, { type: "geojson", data: empty() });''',
     '''  for (const id of ["alerts", "sla", "tides", "sst", "buoys", "wx", "reports", "rivers", "usgs"]) map.addSource(id, { type: "geojson", data: empty() });'''),
    ('''    { id: "reports-circle", type: "circle", source: "reports",''',
     '''    { id: "usgs-circle", type: "circle", source: "usgs",
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 6, 3.5, 12, 7],
        "circle-color": ["get", "color"], "circle-opacity": 1,
        "circle-stroke-width": 1.5, "circle-stroke-color": "#8a63ff", "circle-stroke-opacity": 1,
      } },
    label("usgs-label", "usgs", { layout: { "text-size": 10, "text-optional": true }, paint: { "text-color": INK.text } }),
    { id: "reports-circle", type: "circle", source: "reports",'''),
    # apply + render
    ('''const APPLY = {
  floods: [applyFloods, ["reports", "rivers"]],''',
     '''function applyUsgs(g) {
  state.usgs = g.gauges;
  map.getSource("usgs")?.setData({
    type: "FeatureCollection",
    features: state.usgs.filter((x) => x.stageFt != null || x.flowCfs != null).map((x) => pt(x.lon, x.lat, {
      id: x.id, kind: "usgs", name: x.name, color: changeColor(x.change24hFt),
      label: x.stageFt != null ? `${signed(x.change24hFt, 1)} ft/24h` : `${fmt(x.flowCfs, 0)} cfs`,
    })),
  });
  setStatus("usgs", `${state.usgs.length} gauges · USGS · ${timeAgo(newest(state.usgs.map((x) => x.updated)))}`);
}

const APPLY = {
  gauges: [applyUsgs, ["usgs"]],
  floods: [applyFloods, ["reports", "rivers"]],'''),
    ('''const state = { tides: [],''', '''const state = { usgs: [], tides: [],'''),
    # click + hover
    ('''  const clickable = ["reports-circle", "rivers-circle",''', '''  const clickable = ["reports-circle", "rivers-circle", "usgs-circle",'''),
    ('''    if (p.kind === "river") return showRiver(p.id);''', '''    if (p.kind === "river") return showRiver(p.id);
    if (p.kind === "usgs") return showUsgs(p.id);'''),
    # detail view, before showRiver
    ('''function showRiver(id) {''', '''function showUsgs(id) {
  const render = () => {
    const g = state.usgs.find((x) => x.id === id);
    if (!g) return;
    const t0 = Date.now() - rangeMs();
    const pts = inWindow(g.series.stageFt, t0);
    const hi = pts.length ? pts.reduce((a, b) => (b.v > a.v ? b : a)) : null;
    openDetail(`<div class="d-kicker">USGS gauge · ${esc(g.id)}</div><h2 class="d-title">${esc(g.name)}</h2>
      <div class="d-big">
        <div class="stat"><div class="stat-label">Water level</div><div class="stat-value">${fmt(g.stageFt, 2)}<small>ft</small></div></div>
        <div class="stat"><div class="stat-label">24 h change</div><div class="stat-value ${g.change24hFt > 0 ? "pos" : "neg"}">${signed(g.change24hFt, 2)}<small>ft</small></div></div>
        ${g.flowCfs != null ? `<div class="stat"><div class="stat-label">Flow</div><div class="stat-value">${fmt(g.flowCfs, 0)}<small>cfs</small></div></div>` : ""}
      </div>
      <div class="d-caption">Updated ${timeAgo(g.updated)} · level is against this gauge's own zero, not sea level</div>
      ${hi ? `<ul class="d-list"><li><span class="lbl">Highest · last ${RANGE_LABEL[range]}</span><span>${fmt(hi.v, 2)} ft · ${new Date(hi.t).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}</span></li></ul>` : ""}
      <div class="d-section"><h3>Water level · last ${RANGE_LABEL[range]} (ft)</h3><div id="usgs-chart" class="chart-wrap"></div></div>
      <div class="d-section d-caption"><a href="https://waterdata.usgs.gov/monitoring-location/${encodeURIComponent(g.id)}/" target="_blank" rel="noopener">USGS station page ↗</a></div>`, render);
    lineChart($("#usgs-chart"), { height: 120, xDomain: [t0, Date.now()], series: [{ data: pts, color: "#8a63ff", area: true }] });
  };
  render();
}

function showRiver(id) {'''),
])
print('done')
