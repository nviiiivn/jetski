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

export const CRON = {
  FIVE_MIN: "*/5 * * * *",
  QUARTER_HOUR: "*/15 * * * *",
  SIX_HOURLY: "7 */6 * * *",
};

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
    async build(up, region) {
      const [obs, alerts] = await Promise.all([
        settled(region.wx.map((id) => fetchObservation(up, id))),
        fetchAlerts(up, region).catch((e) => ({ error: String(e.message || e) })),
      ]);
      if (!obs.ok.length && alerts.error) throw new Error(`weather: ${alerts.error}`);
      return {
        stations: obs.ok,
        alerts: alerts.error ? null : alerts,
        errors: [...obs.errors, ...(alerts.error ? [alerts.error] : [])],
      };
    },
  },

  tides: {
    ttl: 6 * MIN,
    stale: 30 * MIN,
    cron: CRON.FIVE_MIN,
    async build(up, region) {
      const r = await settled(region.tides.map((s) => fetchTideStation(up, s)));
      return { stations: requireSome("tides", r), errors: r.errors };
    },
  },

  buoys: {
    ttl: 15 * MIN,
    stale: 2 * HOUR,
    cron: CRON.QUARTER_HOUR,
    async build(up, region) {
      const r = await settled(region.buoys.map((b) => fetchBuoy(up, b)));
      return { buoys: requireSome("buoys", r), errors: r.errors };
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
    async build(up, region, now = Date.now()) {
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
    async build(up, region) {
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
      const ok = (p, empty) => (p && p.error ? empty : p);
      return {
        reports: [...ok(lsr, []), ...ok(sf311, [])].sort((a, b) => b.t - a.t),
        rivers: ok(rivers, { watched: 0, flooding: [] }),
        news: ok(news, []),
        errors,
      };
    },
  },
};

// On-demand point forecasts: not pre-warmed and not persisted to R2 (the key
// space is every point on the map), just edge-cached per ~1 km grid cell.
export const FORECAST = { ttl: 30 * MIN, stale: 6 * HOUR };

export const groupsForCron = (cron) => Object.keys(GROUPS).filter((k) => GROUPS[k].cron === cron);
