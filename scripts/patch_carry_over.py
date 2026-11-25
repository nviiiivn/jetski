#!/usr/bin/env python3
"""Coast Watch (2026-11-25): when one station or feed fails for one refresh (api.weather.gov answers 503 now and then),
keep its last good reading from the previous snapshot instead of dropping it from the map until the next refresh.
Carried items keep their own reading time (the page still says how old it is) and age out. One-shot."""
import sys


def rw(path, pairs):
    s = open(path, encoding='utf-8').read()
    for old, new in pairs:
        if s.count(old) != 1:
            sys.exit(f'STOP {path}: {s.count(old)}x {old[:80]!r}')
        s = s.replace(old, new)
    open(path, 'w', encoding='utf-8').write(s)
    print('ok', path)


if 'withCarried' in open('workers/data/src/groups.js', encoding='utf-8').read():
    sys.exit('already applied')

rw('workers/data/src/cache.js', [
    ('''  const p = (async () => {
    const data = await spec.build();''',
     '''  const p = (async () => {
    // The previous snapshot goes to the build, so a station that fails this time can keep its last good reading.
    const prev = (await readEdge(spec.id).catch(() => null)) || (spec.persist === false ? null : await readR2(env, spec.id).catch(() => null));
    const data = await spec.build(prev);'''),
])

rw('workers/data/src/index.js', [
    ('build: () => g.build(up, region) };', 'build: (prev) => g.build(up, region, prev || null) };'),
])

rw('workers/data/src/groups.js', [
    ('''/** Reject a snapshot where every station failed, so a good one isn't overwritten. */''',
     '''/**
 * tides.alola.lol 2026-11-25: items that failed this refresh are carried over from the previous snapshot for up to
 * maxAgeMs (marked `carried` = when they were last fetched), so one 503 doesn't make a station vanish from the map.
 * Output follows the configured station order.
 */
function withCarried(fresh, prev, key, wantIds, maxAgeMs, now = Date.now()) {
  const byId = new Map(fresh.map((x) => [x.id, x]));
  const prevAt = prev?.generatedAt;
  for (const p of prev?.data?.[key] || []) {
    if (byId.has(p.id) || !wantIds.includes(p.id)) continue;
    const since = p.carried || prevAt;
    if (since && now - since < maxAgeMs) byId.set(p.id, { ...p, carried: since });
  }
  const out = wantIds.filter((id) => byId.has(id)).map((id) => byId.get(id));
  return [...out, ...fresh.filter((x) => !wantIds.includes(x.id))];
}

/** Reject a snapshot where every station failed, so a good one isn't overwritten. */'''),
    # weather: stations + alerts
    ('''    async build(up, region) {
      const [obs, alerts] = await Promise.all([
        settled(region.wx.map((id) => fetchObservation(up, id))),
        fetchAlerts(up, region).catch((e) => ({ error: String(e.message || e) })),
      ]);
      if (!obs.ok.length && alerts.error) throw new Error(`weather: ${alerts.error}`);
      return {
        stations: obs.ok,
        alerts: alerts.error ? null : alerts,
        errors: [...obs.errors, ...(alerts.error ? [alerts.error] : [])],
      };''',
     '''    async build(up, region, prev = null, now = Date.now()) {
      const [obs, alerts] = await Promise.all([
        settled(region.wx.map((id) => fetchObservation(up, id))),
        fetchAlerts(up, region).catch((e) => ({ error: String(e.message || e) })),
      ]);
      if (!obs.ok.length && alerts.error) throw new Error(`weather: ${alerts.error}`);
      // Alerts can be cancelled any minute, so the last good list is only reused for an hour.
      const prevAlertsAt = prev?.data?.alertsAt ?? prev?.generatedAt;
      const keepAlerts = alerts.error && prev?.data?.alerts && now - prevAlertsAt < HOUR;
      return {
        stations: withCarried(obs.ok, prev, "stations", region.wx, 3 * HOUR, now),
        alerts: alerts.error ? (keepAlerts ? prev.data.alerts : null) : alerts,
        alertsAt: alerts.error ? (keepAlerts ? prevAlertsAt : null) : now,
        errors: [...obs.errors, ...(alerts.error ? [alerts.error] : [])],
      };'''),
    # tides
    ('''    async build(up, region) {
      const r = await settled(region.tides.map((s) => fetchTideStation(up, s)));
      return { stations: requireSome("tides", r), errors: r.errors };''',
     '''    async build(up, region, prev = null) {
      const r = await settled(region.tides.map((s) => fetchTideStation(up, s)));
      return { stations: withCarried(requireSome("tides", r), prev, "stations", region.tides.map((s) => s.id), 3 * HOUR), errors: r.errors };'''),
    # buoys
    ('''    async build(up, region) {
      const r = await settled(region.buoys.map((b) => fetchBuoy(up, b)));
      return { buoys: requireSome("buoys", r), errors: r.errors };''',
     '''    async build(up, region, prev = null) {
      const r = await settled(region.buoys.map((b) => fetchBuoy(up, b)));
      return { buoys: withCarried(requireSome("buoys", r), prev, "buoys", region.buoys.map((b) => b.id), 6 * HOUR), errors: r.errors };'''),
    # climate keeps its `now` parameter, after prev
    ('''    async build(up, region, now = Date.now()) {
      const [oni, weekly, monthly] = await Promise.all([''',
     '''    async build(up, region, prev = null, now = Date.now()) {
      const [oni, weekly, monthly] = await Promise.all(['''),
    # floods: a failed part keeps the previous snapshot's copy of that part (up to 3 h)
    ('''    async build(up, region) {
      const err = (name) => (e) => ({ error: `${name}: ${String(e?.message || e)}` });''',
     '''    async build(up, region, prev = null, now = Date.now()) {
      const err = (name) => (e) => ({ error: `${name}: ${String(e?.message || e)}` });'''),
    ('''      const ok = (p, empty) => (p && p.error ? empty : p);
      return {
        reports: [...ok(lsr, []), ...ok(sf311, [])].sort((a, b) => b.t - a.t),
        rivers: ok(rivers, { watched: 0, flooding: [] }),
        news: ok(news, []),
        errors,
      };''',
     '''      const ok = (p, empty) => (p && p.error ? empty : p);
      const pd = prev && now - prev.generatedAt < 3 * HOUR ? prev.data || {} : {};
      const is311 = (r) => /^SF 311/.test(r.source || "");
      const lsrOk = lsr && lsr.error ? (pd.reports || []).filter((r) => !is311(r)) : lsr;
      const sfOk = sf311 && sf311.error ? (pd.reports || []).filter(is311) : sf311;
      return {
        reports: [...lsrOk, ...sfOk].sort((a, b) => b.t - a.t),
        rivers: rivers && rivers.error ? pd.rivers || { watched: 0, flooding: [] } : rivers,
        news: news && news.error ? pd.news || [] : news,
        errors,
      };'''),
])
print('done')
