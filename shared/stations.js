// Station catalogs. Edit these to add or remove stations; the data Worker
// fans out to every entry, and the snapshot carries names + coordinates to the
// browser, so the front end needs no copy of these lists.

export const TIDE_STATIONS = [
  { id: "9415020", name: "Point Reyes", lon: -122.9736, lat: 37.9942 },
  { id: "9414290", name: "San Francisco (Golden Gate)", lon: -122.4659, lat: 37.8063 },
  { id: "9414863", name: "Richmond", lon: -122.4, lat: 37.9283 },
  { id: "9414750", name: "Alameda", lon: -122.3003, lat: 37.772 },
  { id: "9414523", name: "Redwood City", lon: -122.2119, lat: 37.5068 },
  { id: "9415102", name: "Martinez-Amorco Pier", lon: -122.1252, lat: 38.0346 },
  { id: "9415144", name: "Port Chicago", lon: -122.0395, lat: 38.056 },
  { id: "9413450", name: "Monterey", lon: -121.8914, lat: 36.6089 },
];

export const BUOYS = [
  { id: "46013", name: "Bodega Bay", lon: -123.317, lat: 38.235 },
  { id: "46214", name: "Point Reyes", lon: -123.466, lat: 37.944 },
  { id: "46026", name: "San Francisco", lon: -122.838, lat: 37.75 },
  { id: "46237", name: "San Francisco Bar", lon: -122.634, lat: 37.788 },
  { id: "46012", name: "Half Moon Bay", lon: -122.881, lat: 37.356 },
  { id: "46042", name: "Monterey", lon: -122.408, lat: 36.787 },
  { id: "46236", name: "Monterey Canyon Outer", lon: -121.95, lat: 36.759 },
];

export const WX_STATIONS = [
  "KSTS", "KAPC", "KDVO", "KCCR", "KSFO", "KOAK", "KHWD", "KLVK",
  "KHAF", "KPAO", "KNUQ", "KSJC", "KMRY",
];

// NWS forecast office whose alerts we show (San Francisco Bay Area / Monterey).
export const ALERT_SENDER = /San Francisco|Monterey/i;
