// Snapshot groups: one per data type with a distinct cadence. This file is
// the single source of truth for cache lifetimes and pre-warm schedules.
//
//   ttl    seconds a snapshot is served as fresh
//   stale  extra seconds it may be served while a refresh runs in the
//          background (stale-while-revalidate), or if upstreams are down
//   cron   Cron Trigger that pre-warms the snapshot into R2. Every cron listed
//          here must also appear in wrangler.jsonc `triggers.crons`
//          (test/config.test.js enforces this).
//
// Why these numbers:
//   weather  NWS observations update ~hourly per station, alerts any minute.
//   tides    CO-OPS samples every 6 min; predictions are fixed.
//   buoys    NDBC realtime2 files update every 10–60 min per buoy.
//   climate  ONI and monthly sea level are monthly, Niño weekly.

import { encodeSeries } from "../../../shared/series.js";
import { settled } from "./upstream.js";
import { fetchTideStation, fetchMonthlyMean } from "./sources/coops.js";
import { fetchBuoy } from "./sources/ndbc.js";
import { fetchObservation, fetchAlerts } from "./sources/nws.js";
import { fetchONI, fetchWeekly, ensoPhase } from "./sources/cpc.js";
import { fetchLsr, fetchSf311, fetchRivers, fetchNews } from "./sources/floods.js";
import { fetchGauges } from "./sources/usgs.js";

const MIN = 60;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const HOUR_MS = HOUR * 1000; // ttl/stale above are seconds; carry-over ages are milliseconds

export const CRON = {
  FIVE_MIN: "*/5 * * * *",
  QUARTER_HOUR: "*/15 * * * *",
  SIX_HOURLY: "7 */6 * * *",
};

/**
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

/** Reject a snapshot where every station failed, so a good one isn't overwritten. */
function requireSome(name, { ok, errors }) {
  if (!ok.length) throw new Error(`${name}: all upstream requests failed (${errors[0] || "no data"})`);
  return ok;
}

export const GROUPS = {
  weather: {
    ttl: 5 * MIN,
    stale: 30 * MIN,
    cron: CRON.FIVE_MIN,
    async build(up, region, prev = null, now = Date.now()) {
      const [obs, alerts] = await Promise.all([
        settled(region.wx.map((id) => fetchObservation(up, id))),
        fetchAlerts(up, region).catch((e) => ({ error: String(e.message || e) })),
      ]);
      if (!obs.ok.length && alerts.error) throw new Error(`weather: ${alerts.error}`);
      prev = await prev; // the previous snapshot (cache.js passes it as a promise)
      // Alerts can be cancelled any minute, so the last good list is only reused for an hour.
      const prevAlertsAt = prev?.data?.alertsAt ?? prev?.generatedAt;
      const keepAlerts = alerts.error && prev?.data?.alerts && now - prevAlertsAt < HOUR_MS;
      return {
        stations: withCarried(obs.ok, prev, "stations", region.wx, 3 * HOUR_MS, now),
        alerts: alerts.error ? (keepAlerts ? prev.data.alerts : null) : alerts,
        alertsAt: alerts.error ? (keepAlerts ? prevAlertsAt : null) : now,
        errors: [...obs.errors, ...(alerts.error ? [alerts.error] : [])],
      };
    },
  },

  tides: {
    ttl: 6 * MIN,
    stale: 30 * MIN,
    cron: CRON.FIVE_MIN,
    async build(up, region, prev = null) {
      const r = await settled(region.tides.map((s) => fetchTideStation(up, s)));
      prev = await prev;
      return { stations: withCarried(requireSome("tides", r), prev, "stations", region.tides.map((s) => s.id), 3 * HOUR_MS), errors: r.errors };
    },
  },

  buoys: {
    ttl: 15 * MIN,
    stale: 2 * HOUR,
    cron: CRON.QUARTER_HOUR,
    async build(up, region, prev = null) {
      const r = await settled(region.buoys.map((b) => fetchBuoy(up, b)));
      prev = await prev;
      return { buoys: withCarried(requireSome("buoys", r), prev, "buoys", region.buoys.map((b) => b.id), 6 * HOUR_MS), errors: r.errors };
    },
  },

  // tides.alola.lol 2026-11-24: USGS creek / river / canal / Bay gauges near the cities (sources/usgs.js).
  // USGS posts every 15 min (some sites hourly); one request per region.
  gauges: {
    ttl: 15 * MIN,
    stale: 2 * HOUR,
    cron: CRON.QUARTER_HOUR,
    async build(up, region) {
      const gauges = await fetchGauges(up, region.gauges || []);
      return { gauges, errors: [] };
    },
  },

  climate: {
    ttl: 6 * HOUR,
    stale: 7 * DAY,
    cron: CRON.SIX_HOURLY,
    async build(up, region, prev = null, now = Date.now()) {
      const [oni, weekly, monthly] = await Promise.all([
        fetchONI(up).catch(() => []),
        fetchWeekly(up).catch(() => []),
        settled(region.tides.map(async (s) => ({ ...s, series: await fetchMonthlyMean(up, s, now) }))),
      ]);
      if (!oni.length && !weekly.length && !monthly.ok.length) throw new Error("climate: all upstream requests failed");
      const since = Date.UTC(new Date(now).getUTCFullYear() - 13, 0, 1);
      const last = oni.at(-1);
      return {
        phase: ensoPhase(last?.v),
        oni: oni.filter((d) => d.t >= since),
        weekly: weekly.slice(-12),
        monthly: monthly.ok.map(({ series, ...s }) => ({ ...s, series: encodeSeries(series, 3) })),
        errors: monthly.errors,
      };
    },
  },

  // tides.alola.lol: reports of actual flooding + river gauges + flood news (sources/floods.js).
  floods: {
    ttl: 10 * MIN,
    stale: 1 * HOUR,
    cron: CRON.QUARTER_HOUR,
    async build(up, region, prev = null, now = Date.now()) {
      const err = (name) => (e) => ({ error: `${name}: ${String(e?.message || e)}` });
      const [lsr, sf311, rivers, news] = await Promise.all([
        fetchLsr(up, region).catch(err("NWS reports")),
        region.sf311 ? fetchSf311(up).catch(err("SF 311")) : [],
        fetchRivers(up, region).catch(err("river gauges")),
        fetchNews(up, region).catch(err("news")),
      ]);
      const parts = { lsr, sf311, rivers, news };
      const errors = Object.values(parts).filter((p) => p && p.error).map((p) => p.error);
      if (errors.length === 4) throw new Error(`floods: ${errors.join("; ")}`);
      prev = await prev;
      const pd = prev && now - prev.generatedAt < 3 * HOUR_MS ? prev.data || {} : {};
      const is311 = (r) => /^SF 311/.test(r.source || "");
      const lsrOk = lsr && lsr.error ? (pd.reports || []).filter((r) => !is311(r)) : lsr;
      const sfOk = sf311 && sf311.error ? (pd.reports || []).filter(is311) : sf311;
      return {
        reports: [...lsrOk, ...sfOk].sort((a, b) => b.t - a.t),
        rivers: rivers && rivers.error ? pd.rivers || { watched: 0, flooding: [] } : rivers,
        news: news && news.error ? pd.news || [] : news,
        errors,
      };
    },
  },
};

// On-demand point forecasts: not pre-warmed and not persisted to R2 (the key
// space is every point on the map), just edge-cached per ~1 km grid cell.
export const FORECAST = { ttl: 30 * MIN, stale: 6 * HOUR };

export const groupsForCron = (cron) => Object.keys(GROUPS).filter((k) => GROUPS[k].cron === cron);
