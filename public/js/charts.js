// Minimal SVG charts — no dependencies.

const NS = "http://www.w3.org/2000/svg";
const el = (tag, attrs = {}, parent) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
};

function extent(vals) {
  let lo = Infinity, hi = -Infinity;
  for (const v of vals) if (v != null && isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  return [lo, hi];
}

/**
 * lineChart(container, {
 *   series: [{ data:[{t,v}], color, width, dash, area }],
 *   height, yLabel, zero:true, now:true, band:[lo,hi], markers:[{t,v,label}],
 *   bars: [{t,v}] (diverging bars around 0, colored by sign)
 * })
 */
export function lineChart(container, opts) {
  const W = container.clientWidth || 320;
  const H = opts.height || 140;
  const m = { t: 10, r: 10, b: 20, l: 34 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  container.innerHTML = "";
  const svg = el("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: "chart" }, container);

  const all = [...(opts.series || []).flatMap((s) => s.data), ...(opts.bars || [])];
  if (!all.length) {
    el("text", { x: W / 2, y: H / 2, "text-anchor": "middle", class: "chart-empty" }, svg).textContent = "No data";
    return;
  }
  let [t0, t1] = extent(all.map((d) => +d.t));
  if (opts.xDomain) [t0, t1] = opts.xDomain.map(Number);
  let [y0, y1] = extent(all.map((d) => d.v).concat(opts.band || [], opts.zero ? [0] : []));
  if (y0 === y1) { y0 -= 1; y1 += 1; }
  const padY = (y1 - y0) * 0.08; y0 -= padY; y1 += padY;
  const bw = opts.bars ? iw / Math.max(opts.bars.length, 1) : 0;
  const x = (t) => m.l + bw / 2 + ((+t - t0) / (t1 - t0 || 1)) * (iw - bw);
  const y = (v) => m.t + (1 - (v - y0) / (y1 - y0)) * ih;

  // grid + y ticks
  const ticks = niceTicks(y0, y1, 4);
  for (const v of ticks) {
    el("line", { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: "grid" }, svg);
    el("text", { x: m.l - 6, y: y(v) + 3, "text-anchor": "end", class: "tick" }, svg).textContent =
      opts.yFormat ? opts.yFormat(v) : +v.toFixed(2);
  }
  // x ticks
  const span = t1 - t0;
  const nx = Math.max(2, Math.floor(iw / 70));
  for (let i = 0; i <= nx; i++) {
    const t = t0 + (span * i) / nx;
    el("text", { x: x(t), y: H - 5, "text-anchor": "middle", class: "tick" }, svg).textContent =
      fmtTick(new Date(t), span);
  }
  if (opts.band) {
    el("rect", {
      x: m.l, width: iw, y: y(opts.band[1]), height: Math.max(0, y(opts.band[0]) - y(opts.band[1])),
      class: "band",
    }, svg);
  }
  if (opts.zero && y0 < 0 && y1 > 0)
    el("line", { x1: m.l, x2: W - m.r, y1: y(0), y2: y(0), class: "zero" }, svg);

  if (opts.bars) {
    for (const d of opts.bars) {
      const yy = y(Math.max(0, d.v)), h = Math.abs(y(d.v) - y(0));
      el("rect", {
        x: x(d.t) - bw * 0.4, width: bw * 0.8, y: yy, height: Math.max(1, h), rx: 1.5,
        fill: d.v >= 0 ? "var(--pos)" : "var(--neg)",
      }, svg);
    }
  }
  for (const s of opts.series || []) {
    const pts = s.data.filter((d) => d.v != null);
    if (!pts.length) continue;
    const path = pts.map((d, i) => `${i ? "L" : "M"}${x(d.t).toFixed(1)},${y(d.v).toFixed(1)}`).join("");
    if (s.area) {
      el("path", {
        d: `${path}L${x(pts.at(-1).t)},${y(Math.max(y0, 0))}L${x(pts[0].t)},${y(Math.max(y0, 0))}Z`,
        fill: s.color, opacity: 0.12,
      }, svg);
    }
    el("path", {
      d: path, fill: "none", stroke: s.color, "stroke-width": s.width || 1.6,
      "stroke-dasharray": s.dash || "", "stroke-linejoin": "round", "stroke-linecap": "round",
    }, svg);
  }
  for (const mk of opts.markers || []) {
    el("circle", { cx: x(mk.t), cy: y(mk.v), r: 2.6, class: "marker" }, svg);
    if (mk.label)
      el("text", { x: x(mk.t), y: y(mk.v) + (mk.below ? 12 : -6), "text-anchor": "middle", class: "marker-label" }, svg)
        .textContent = mk.label;
  }
  if (opts.now) {
    const n = Date.now();
    if (n > t0 && n < t1) {
      el("line", { x1: x(n), x2: x(n), y1: m.t, y2: m.t + ih, class: "now" }, svg);
      el("text", { x: x(n) + 3, y: m.t + 8, class: "now-label" }, svg).textContent = "now";
    }
  }
}

function niceTicks(lo, hi, n) {
  const step0 = (hi - lo) / n;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((s) => s * mag).find((s) => s >= step0) || step0;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}

function fmtTick(d, span) {
  const day = 864e5;
  if (span > 400 * day) return d.toLocaleDateString(undefined, { year: "2-digit", month: "short" }).replace(" ", " '");
  if (span > 20 * day) return d.toLocaleDateString(undefined, { month: "short" });
  if (span > 2 * day) return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric" });
  return d.toLocaleTimeString(undefined, { hour: "numeric" });
}
