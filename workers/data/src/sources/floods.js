// tides.alola.lol (2026-11-24): actual flooding, not just water levels.
//
//   reports  NWS Local Storm Reports (spotters, police, public, media) of flooding, via Iowa Environmental
//            Mesonet's keyless GeoJSON feed of every LSR the region's NWS offices issued
//   sf311    San Francisco 311 "Sewer > flooding" requests (DataSF open data), SF Bay region only
//   rivers   NOAA National Water Prediction Service gauges inside the region that are at action stage or
//            flooding, now or in their forecast
//   news     Google News search results for flooding / king tides in the region (headline, outlet, link)
//
// Every item carries t (epoch ms); the page filters them to its timeline window (1 h … 3 days).

import { round } from "../../../../shared/series.js";

const DAYS_BACK = 3;
const FLOODY = /FLOOD|SURGE|TIDE/i;
const RIVER_BAD = new Set(["action", "minor", "moderate", "major"]);

const ymdhm = (d) => d.toISOString().replace(/[-:T]/g, "").slice(0, 12);

export async function fetchLsr(up, region, now = Date.now()) {
  const sts = ymdhm(new Date(now - DAYS_BACK * 86400e3));
  const ets = ymdhm(new Date(now));
  const j = await up.json(`https://mesonet.agron.iastate.edu/geojson/lsr.php?wfos=${region.wfos.join(",")}&sts=${sts}&ets=${ets}`);
  const seen = new Set();
  const out = [];
  for (const f of j.features || []) {
    const p = f.properties || {};
    if (!FLOODY.test(p.typetext || "")) continue;
    const [lon, lat] = f.geometry?.coordinates || [];
    const key = `${p.valid}|${p.typetext}|${p.remark}|${lon}|${lat}`;
    if (seen.has(key) || !isFinite(lon) || !isFinite(lat)) continue;
    seen.add(key);
    out.push({
      kind: "lsr", t: Date.parse(p.valid), type: p.typetext, place: [p.city, p.county && `${p.county} Co.`, p.state].filter(Boolean).join(", "),
      source: p.source || "", remark: p.remark || "", lon: round(lon, 4), lat: round(lat, 4), wfo: p.wfo || "",
    });
  }
  return out.sort((a, b) => b.t - a.t);
}

// DataSF timestamps are San Francisco wall-clock time with no zone.
function sfLocalToEpoch(s) {
  const guess = Date.parse(s + "Z");
  const name = new Date(guess).toLocaleString("en-US", { timeZone: "America/Los_Angeles", timeZoneName: "shortOffset" });
  const m = name.match(/GMT([+-]\d+)/);
  return guess - (m ? Number(m[1]) : -8) * 3600e3;
}

export async function fetchSf311(up, now = Date.now()) {
  const since = new Date(now - DAYS_BACK * 86400e3 - 86400e3).toISOString().slice(0, 19); // a day of slack for the zone
  const q = new URLSearchParams({
    $where: `service_subtype='flooding' AND requested_datetime > '${since}'`,
    $select: "service_request_id,requested_datetime,service_details,address,lat,long,status_description",
    $order: "requested_datetime DESC",
    $limit: "300",
  });
  const rows = await up.json(`https://data.sf.gov/resource/vw6y-z8j6.json?${q}`);
  return rows
    .filter((r) => isFinite(+r.lat) && isFinite(+r.long) && +r.lat !== 0)
    .map((r) => ({
      kind: "311", t: sfLocalToEpoch(r.requested_datetime), type: `311 flooding · ${(r.service_details || "").replace(/_/g, " ")}`,
      place: (r.address || "").replace(/, SAN FRANCISCO, CA \d+, US$/i, ""), source: `SF 311 #${r.service_request_id}`,
      remark: r.status_description ? `Request ${String(r.status_description).toLowerCase()}` : "", lon: round(+r.long, 5), lat: round(+r.lat, 5),
    }))
    .filter((r) => now - r.t < DAYS_BACK * 86400e3);
}

export async function fetchRivers(up, region) {
  const [[xmin, ymin], [xmax, ymax]] = region.maxBounds;
  const j = await up.json(`https://api.water.noaa.gov/nwps/v1/gauges?bbox.xmin=${xmin}&bbox.ymin=${ymin}&bbox.xmax=${xmax}&bbox.ymax=${ymax}&srid=EPSG_4326`);
  const all = j.gauges || [];
  const watched = all.filter((g) => {
    const o = g.status?.observed?.floodCategory, f = g.status?.forecast?.floodCategory;
    return o === "no_flooding" || RIVER_BAD.has(o) || RIVER_BAD.has(f);
  });
  const flooding = watched
    .filter((g) => RIVER_BAD.has(g.status?.observed?.floodCategory) || RIVER_BAD.has(g.status?.forecast?.floodCategory))
    .map((g) => ({
      id: g.lid, name: g.name, lon: round(g.longitude, 4), lat: round(g.latitude, 4),
      now: g.status.observed.floodCategory, nowValue: g.status.observed.primary, unit: g.status.observed.primaryUnit,
      t: Date.parse(g.status.observed.validTime) || null,
      forecast: RIVER_BAD.has(g.status.forecast?.floodCategory) ? g.status.forecast.floodCategory : null,
      forecastValue: g.status.forecast?.primary, forecastT: Date.parse(g.status.forecast?.validTime) || null,
    }));
  return { watched: watched.length, flooding };
}

const ENTITIES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'" };
const unxml = (s = "") => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&(amp|lt|gt|quot|apos|#39);/g, (m) => ENTITIES[m]).trim();

export async function fetchNews(up, region, now = Date.now()) {
  const q = encodeURIComponent(`${region.newsQuery} when:${DAYS_BACK}d`);
  const xml = await up.text(`https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`);
  const items = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const get = (tag) => unxml((m[1].match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`)) || [])[1]);
    const source = get("source");
    let title = get("title");
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3));
    const link = get("link");
    const t = Date.parse(get("pubDate"));
    if (!title || !/^https:\/\//.test(link) || !isFinite(t) || now - t > DAYS_BACK * 86400e3) continue;
    items.push({ t, title, source, link });
  }
  return items.sort((a, b) => b.t - a.t).slice(0, 40);
}
