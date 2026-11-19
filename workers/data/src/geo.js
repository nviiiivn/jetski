// Geometry slimming for NWS zone shapes. Marine and coastal zones follow the
// shoreline at metre resolution; at Bay-Area zoom ~100 m is indistinguishable
// and cuts payloads by an order of magnitude.

const round = (x, d) => Math.round(x * 10 ** d) / 10 ** d;

function sqSegDist(p, a, b) {
  let [x, y] = a;
  let dx = b[0] - x, dy = b[1] - y;
  if (dx || dy) {
    const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) [x, y] = b;
    else if (t > 0) { x += dx * t; y += dy * t; }
  }
  dx = p[0] - x; dy = p[1] - y;
  return dx * dx + dy * dy;
}

/** Iterative Douglas–Peucker. */
export function simplifyLine(pts, tol) {
  if (pts.length <= 2) return pts;
  const sq = tol * tol;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    let max = 0, idx = -1;
    for (let i = first + 1; i < last; i++) {
      const d = sqSegDist(pts[i], pts[first], pts[last]);
      if (d > max) { max = d; idx = i; }
    }
    if (max > sq) { keep[idx] = 1; stack.push([first, idx], [idx, last]); }
  }
  return pts.filter((_, i) => keep[i]);
}

function ring(r, tol, d) {
  const s = simplifyLine(r, tol);
  // A ring needs ≥ 4 positions (closed triangle); tiny islets collapse — drop them.
  return s.length >= 4 ? s.map((p) => [round(p[0], d), round(p[1], d)]) : null;
}

export function simplifyGeometry(g, tol = 0.001, d = 4) {
  if (!g) return null;
  switch (g.type) {
    case "Polygon": {
      const rings = g.coordinates.map((r) => ring(r, tol, d));
      return rings[0] ? { type: "Polygon", coordinates: rings.filter(Boolean) } : null;
    }
    case "MultiPolygon": {
      const polys = g.coordinates
        .map((p) => p.map((r) => ring(r, tol, d)))
        .filter((p) => p[0])
        .map((p) => p.filter(Boolean));
      return polys.length ? { type: "MultiPolygon", coordinates: polys } : null;
    }
    case "GeometryCollection": {
      const gs = g.geometries.map((x) => simplifyGeometry(x, tol, d)).filter(Boolean);
      return gs.length ? { type: "GeometryCollection", geometries: gs } : null;
    }
    default:
      return g;
  }
}
