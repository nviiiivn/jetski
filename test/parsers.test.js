import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, UPSTREAM } from "./helpers.js";
import { encodeSeries, decodeSeries } from "../shared/series.js";
import { parseNdbc, summarizeBuoy } from "../workers/data/src/sources/ndbc.js";
import { parseONI, parseWeekly, ensoPhase } from "../workers/data/src/sources/cpc.js";
import { normalizeTide, normalizeMonthly, coopsDate, nowRounded } from "../workers/data/src/sources/coops.js";
import { normalizeObservation, alertKind } from "../workers/data/src/sources/nws.js";
import { simplifyLine, simplifyGeometry } from "../workers/data/src/geo.js";

test("series: regular data encodes as start/step and round-trips", () => {
  const pts = [0, 1, 2, 3].map((i) => ({ t: 1000 + i * 360000, v: i + 0.123456 }));
  const enc = encodeSeries(pts);
  assert.deepEqual(Object.keys(enc).sort(), ["start", "step", "v"]);
  assert.deepEqual(enc.v, [0.12, 1.12, 2.12, 3.12]);
  const dec = decodeSeries(enc);
  assert.equal(dec.length, 4);
  assert.ok(dec[2].t instanceof Date);
  assert.equal(+dec[3].t, 1000 + 3 * 360000);
});

test("series: irregular data keeps explicit times; nulls are skipped on decode", () => {
  const enc = encodeSeries([{ t: 0, v: 1 }, { t: 10, v: null }, { t: 25, v: 3 }]);
  assert.deepEqual(enc, { t: [0, 10, 25], v: [1, null, 3] });
  assert.deepEqual(decodeSeries(enc).map((p) => +p.t), [0, 25]);
  assert.deepEqual(decodeSeries(null), []);
});

test("NDBC: parses realtime2 text oldest-first with MM as null", () => {
  const rows = parseNdbc(fixture("ndbc-46026.txt"));
  assert.ok(rows.length > 10);
  assert.ok(rows[0].t < rows.at(-1).t, "oldest first");
  assert.ok(rows.some((r) => r.ATMP === null), "MM -> null");
  const b = summarizeBuoy({ id: "46026", name: "SF", lon: 0, lat: 0 }, rows);
  assert.ok(b.waveFt > 0 && b.sstF > 40 && b.sstF < 90);
  assert.equal(b.updated, rows.at(-1).t);
  assert.ok(b.series.waveFt.v.length > 0);
  assert.equal(b.rows, undefined, "raw rows are not shipped to the browser");
});

test("CPC: ONI and weekly Niño parse, including glued negative numbers", () => {
  const oni = parseONI(fixture("oni.ascii.txt"));
  assert.equal(oni.length, 30);
  assert.ok(oni.every((d) => typeof d.v === "number" && d.season.length === 3));
  const wk = parseWeekly(fixture("wksst9120.for"));
  assert.equal(wk.length, 8);
  assert.equal(wk[0].nino12, -0.1); // "20.6-0.1"
  assert.equal(wk[0].nino34, -0.2);
  assert.equal(wk.at(-1).nino34, 3.2);
  assert.equal(new Date(wk.at(-1).t).toISOString().slice(0, 10), "2026-11-11");
});

test("ENSO phase thresholds", () => {
  assert.equal(ensoPhase(2.4).label, "Very strong El Niño");
  assert.equal(ensoPhase(0.6).cls, "warm");
  assert.equal(ensoPhase(0).label, "ENSO-neutral");
  assert.equal(ensoPhase(-1.7).label, "Strong La Niña");
  assert.equal(ensoPhase(undefined).label, "Unavailable");
});

test("CO-OPS: tide normalization computes residual against nearest prediction", () => {
  const s = normalizeTide({ id: "1", name: "X", lon: 0, lat: 0 }, {
    obs: UPSTREAM.water_level, pred: UPSTREAM.predictions, hilo: UPSTREAM.hilo, temp: UPSTREAM.water_temperature,
  });
  // last obs = 3.9, prediction at same time = 2.5 + 9*0.1 = 3.4
  assert.equal(s.latest.v, 3.9);
  assert.equal(s.residual, 0.5);
  assert.equal(s.temp.v, 58.3);
  assert.equal(s.extremes.length, 2);
  assert.ok("start" in s.predicted, "regular predictions use compact encoding");
});

test("CO-OPS: missing responses yield nulls, not throws", () => {
  const s = normalizeTide({ id: "1" }, {});
  assert.equal(s.latest, null);
  assert.equal(s.residual, null);
  assert.equal(s.temp, null);
});

test("CO-OPS: dates and monthly means are UTC", () => {
  assert.equal(coopsDate(new Date(Date.UTC(2026, 0, 2, 3, 4))), "20260102 03:04");
  assert.equal(nowRounded(Date.UTC(2026, 0, 1, 10, 17, 33)).toISOString(), "2026-01-01T10:12:00.000Z");
  const m = normalizeMonthly(UPSTREAM.monthly_mean);
  assert.equal(new Date(m[1].t).toISOString().slice(0, 10), "2026-10-15");
});

test("NWS: observation units", () => {
  const o = normalizeObservation("KSFO", UPSTREAM.observation("KSFO"));
  assert.equal(o.tempF, 53.6);
  assert.equal(o.windMph, 12.4);
  assert.equal(o.pressureMb, 1013);
  assert.equal(o.gustMph, null);
  assert.equal(alertKind("Coastal Flood Warning"), "warning");
  assert.equal(alertKind("Special Weather Statement"), "statement");
});

test("geo: simplification drops near-collinear points and keeps rings closed", () => {
  const line = [[0, 0], [1, 0.00001], [2, 0], [3, 1]];
  assert.deepEqual(simplifyLine(line, 0.001), [[0, 0], [2, 0], [3, 1]]);
  const ring = [[0, 0], [0.5, 0.00001], [1, 0], [1, 1], [0, 1], [0, 0]];
  const g = simplifyGeometry({ type: "Polygon", coordinates: [ring] });
  assert.equal(g.coordinates[0].length, 5);
  assert.deepEqual(g.coordinates[0][0], g.coordinates[0].at(-1));
  // a sliver island collapses and is dropped from a MultiPolygon
  const mp = simplifyGeometry({ type: "MultiPolygon", coordinates: [[ring], [[[5, 5], [5.00001, 5], [5, 5.00001], [5, 5]]]] });
  assert.equal(mp.coordinates.length, 1);
});
