// Compact time-series encoding shared by the data Worker (encode) and the
// browser (decode). Timestamps are epoch milliseconds.
//
//   evenly spaced  -> { start, step, v: [..] }      (tide predictions, 6-min data)
//   irregular      -> { t: [..], v: [..] }          (buoys, gappy observations)
//
// Values are rounded so the JSON stays small; nulls are allowed in `v`.

const round = (v, d) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);

/** @param {{t:number|Date, v:number}[]} points  @param {number} [digits] */
export function encodeSeries(points, digits = 2) {
  const t = points.map((p) => +p.t);
  const v = points.map((p) => round(p.v, digits));
  if (t.length > 2) {
    const step = t[1] - t[0];
    if (step > 0 && t.every((x, i) => i === 0 || x - t[i - 1] === step)) return { start: t[0], step, v };
  }
  return { t, v };
}

/** Decode to [{ t: Date, v }] — the shape the charts consume. */
export function decodeSeries(s) {
  if (!s) return [];
  const out = [];
  for (let i = 0; i < s.v.length; i++) {
    if (s.v[i] == null) continue;
    const t = s.t ? s.t[i] : s.start + i * s.step;
    out.push({ t: new Date(t), v: s.v[i] });
  }
  return out;
}

export { round };
