# Bay Coast Watch

A small, map-first dashboard for following **El Niño and its effects on the San Francisco Bay Area coast**: tides and storm surge, monthly sea-level anomalies, coastal water temperature, offshore waves, and NWS weather alerts. Everything comes from free public U.S. government data.

Each dataset is a **layer on the map** that you can show or hide, fade, and drag to change its stacking order. Your layer settings are remembered in the browser.

## Run it

Requires Node 18+ and has no npm dependencies.

```sh
npm start            # or: node server.js
# → http://localhost:8080
```

Environment variables (both optional):

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8080` | HTTP port |
| `NWS_USER_AGENT` | generic | api.weather.gov asks clients to identify themselves, e.g. `(my-dashboard, you@example.com)` |

## Layers

| Layer | Source | What it shows |
| --- | --- | --- |
| Weather stations | [NWS API](https://www.weather.gov/documentation/services-web-api) | Latest airport observations: temperature, and wind as arrows |
| Offshore buoys | [NOAA NDBC](https://www.ndbc.noaa.gov/) | Wave height and period, wind, sea temperature, with 3-day charts |
| Tide gauges | [NOAA CO-OPS](https://api.tidesandcurrents.noaa.gov/api/prod/) | Water level above MLLW, plus the **residual** (observed minus predicted, i.e. surge) |
| Water temperature | CO-OPS + NDBC | Bay and offshore water temperatures |
| Sea-level anomaly | CO-OPS monthly means | Last monthly mean sea level compared with the 1983–2001 epoch. El Niño lifts this |
| NWS alerts | NWS API | Active alerts from the Bay Area office (land and marine zones) |

**El Niño watch** card: the [CPC](https://www.cpc.ncep.noaa.gov/data/indices/) Oceanic Niño Index (ONI) and the weekly Niño 3.4 and Niño 1+2 anomalies, with a summary of current Bay signals.

**Click** a station for charts and details, an alert for its full text, or anywhere else on the map for the NWS point forecast.

## How it works

```
browser ──► server.js ──► api.weather.gov / CO-OPS / NDBC / CPC   (proxied + cached)
   └──────────────────► tiles.openstreetmap.us                     (map tiles, direct)
```

- `server.js` serves `public/` and proxies a fixed allowlist of upstreams under `/api/*`, caching responses in memory (5 min to 6 h, and a day for zone shapes). This is needed because NDBC and CPC don't send CORS headers and NWS wants a `User-Agent`. The cache also keeps traffic to each agency low however many tabs are open.
- `public/js/map-style.js`: a dark MapLibre style over the [OpenStreetMap US Tileservice](https://tiles.openstreetmap.us/) OpenMapTiles vector tiles and fonts.
- `public/js/data.js`: station lists, fetching and parsing.
- `public/js/app.js`: the map, the layer stack, the panels and the detail views.
- `public/js/charts.js`: tiny dependency-free SVG charts.

Data refreshes every 10 minutes.

## Notes

- The OSM US Tileservice is for **non-commercial** use and requires the attribution shown in the map corner. See its [usage policy](https://tiles.openstreetmap.us/usage-policy/).
- To add stations, edit the lists at the top of `public/js/data.js`. CO-OPS station IDs can be found at [tidesandcurrents.noaa.gov](https://tidesandcurrents.noaa.gov/).
- Behind a corporate HTTPS proxy, Node 22.21+ can be told to use it with `NODE_USE_ENV_PROXY=1`, and `NODE_EXTRA_CA_CERTS=...` if the proxy needs its own certificate.
