// Station catalogs, one per region. The data server fans out to every entry of
// the region a page asks for, and the snapshot carries names + coordinates to
// the browser. The region picker in the page lists these in this order.
//
// tides.alola.lol (2026-11-24): regions added on top of jetski's Bay Area lists.
// Every new station id below was checked live on 2026-11-24 (CO-OPS water level,
// NDBC realtime2, NWS latest observation). KPBI and KTMB answer 404 at NWS.

const SFBAY = {
  id: "sfbay",
  name: "SF Bay Area",
  center: [-122.38, 37.72],
  zoom: 8.7,
  maxBounds: [[-126.5, 34.5], [-118.5, 40.8]],
  alertArea: "CA,PZ",
  alertSender: /San Francisco|Monterey/i,
  alertOffice: "NWS San Francisco Bay Area",
  wfos: ["MTR"],
  sf311: true,
  newsQuery: '("king tide" OR flooding OR flooded OR "coastal flood" OR "high tide") ("Bay Area" OR "San Francisco" OR Oakland OR Marin OR "San Mateo" OR Alameda OR "Santa Cruz")',
  tempStops: [[48, "#3d6fe0"], [53, "#2fb7c4"], [57, "#7fcf74"], [61, "#f2c14e"], [66, "#f0643c"]],
  ensoNote: "El Niño tends to lift Bay Area sea levels, warm coastal water and steer stronger storms in, so king tides plus storm surge flood more easily.",
  tides: [
    { id: "9415020", name: "Point Reyes", lon: -122.9736, lat: 37.9942 },
    { id: "9414290", name: "San Francisco (Golden Gate)", lon: -122.4659, lat: 37.8063 },
    { id: "9414863", name: "Richmond", lon: -122.4, lat: 37.9283 },
    { id: "9414750", name: "Alameda", lon: -122.3003, lat: 37.772 },
    { id: "9414523", name: "Redwood City", lon: -122.2119, lat: 37.5068 },
    { id: "9415102", name: "Martinez-Amorco Pier", lon: -122.1252, lat: 38.0346 },
    { id: "9415144", name: "Port Chicago", lon: -122.0395, lat: 38.056 },
    { id: "9413450", name: "Monterey", lon: -121.8914, lat: 36.6089 },
  ],
  buoys: [
    { id: "46013", name: "Bodega Bay", lon: -123.317, lat: 38.235 },
    { id: "46214", name: "Point Reyes", lon: -123.466, lat: 37.944 },
    { id: "46026", name: "San Francisco", lon: -122.838, lat: 37.75 },
    { id: "46237", name: "San Francisco Bar", lon: -122.634, lat: 37.788 },
    { id: "46012", name: "Half Moon Bay", lon: -122.881, lat: 37.356 },
    { id: "46042", name: "Monterey", lon: -122.408, lat: 36.787 },
    { id: "46236", name: "Monterey Canyon Outer", lon: -121.95, lat: 36.759 },
  ],
  wx: ["KSTS", "KAPC", "KDVO", "KCCR", "KSFO", "KOAK", "KHWD", "KLVK", "KHAF", "KPAO", "KNUQ", "KSJC", "KMRY"],
};

const PUGET = {
  id: "puget",
  name: "Seattle / Puget Sound",
  center: [-122.85, 47.9],
  zoom: 7.9,
  maxBounds: [[-127.5, 45.6], [-119.5, 50.3]],
  alertArea: "WA,PZ",
  alertSender: /Seattle/i,
  alertOffice: "NWS Seattle",
  wfos: ["SEW"],
  newsQuery: '("king tide" OR flooding OR flooded OR "coastal flood") (Seattle OR Tacoma OR "Puget Sound" OR Everett OR Olympia OR Bellingham OR Bremerton)',
  tempStops: [[44, "#3d6fe0"], [48, "#2fb7c4"], [51, "#7fcf74"], [54, "#f2c14e"], [58, "#f0643c"]],
  ensoNote: "El Niño tends to raise Pacific Northwest sea levels and warm the water; king tides on top of a storm surge are what floods the low shoreline around Seattle, Tacoma and the San Juans.",
  tides: [
    { id: "9447130", name: "Seattle", lon: -122.3393, lat: 47.6026 },
    { id: "9446484", name: "Tacoma", lon: -122.4133, lat: 47.2667 },
    { id: "9445958", name: "Bremerton", lon: -122.623, lat: 47.5617 },
    { id: "9444900", name: "Port Townsend", lon: -122.7597, lat: 48.1112 },
    { id: "9449880", name: "Friday Harbor", lon: -123.0125, lat: 48.5453 },
    { id: "9449424", name: "Cherry Point", lon: -122.7586, lat: 48.8627 },
    { id: "9444090", name: "Port Angeles", lon: -123.44, lat: 48.125 },
    { id: "9443090", name: "Neah Bay", lon: -124.6016, lat: 48.3707 },
  ],
  buoys: [
    { id: "46088", name: "New Dungeness", lon: -123.179, lat: 48.332 },
    { id: "46267", name: "Angeles Point", lon: -123.6, lat: 48.171 },
    { id: "46087", name: "Neah Bay", lon: -124.727, lat: 48.493 },
    { id: "46041", name: "Cape Elizabeth", lon: -124.741, lat: 47.351 },
    { id: "46211", name: "Grays Harbor", lon: -124.243, lat: 46.857 },
    { id: "WPOW1", name: "West Point (wind only)", lon: -122.435, lat: 47.662 },
  ],
  wx: ["KSEA", "KBFI", "KRNT", "KPAE", "KTIW", "KPWT", "KOLM", "KBLI", "KNUW", "KFHR", "KCLM", "KUIL"],
};

const LA = {
  id: "la",
  name: "Los Angeles / SoCal",
  center: [-118.55, 33.75],
  zoom: 8.1,
  maxBounds: [[-122.0, 31.6], [-115.4, 35.8]],
  alertArea: "CA,PZ",
  alertSender: /Los Angeles|San Diego/i,
  alertOffice: "NWS Los Angeles + San Diego",
  wfos: ["LOX", "SGX"],
  newsQuery: '("king tide" OR flooding OR flooded OR "coastal flood" OR "high surf") ("Los Angeles" OR "Long Beach" OR "Orange County" OR "San Diego" OR Malibu OR "Santa Barbara" OR Ventura)',
  tempStops: [[56, "#3d6fe0"], [60, "#2fb7c4"], [63, "#7fcf74"], [66, "#f2c14e"], [71, "#f0643c"]],
  ensoNote: "El Niño tends to lift Southern California sea levels and send bigger winter storms and swell, so king tides plus surge and waves flood beaches and harbors more easily.",
  tides: [
    { id: "9411340", name: "Santa Barbara", lon: -119.6925, lat: 34.4046 },
    { id: "9410840", name: "Santa Monica", lon: -118.5, lat: 34.0083 },
    { id: "9410660", name: "Los Angeles", lon: -118.272, lat: 33.72 },
    { id: "9410678", name: "Long Beach", lon: -118.2158, lat: 33.7478 },
    { id: "9410230", name: "La Jolla", lon: -117.2571, lat: 32.8669 },
    { id: "9410170", name: "San Diego", lon: -117.1767, lat: 32.7156 },
  ],
  buoys: [
    { id: "46053", name: "East Santa Barbara", lon: -119.842, lat: 34.246 },
    { id: "46025", name: "Santa Monica Basin", lon: -119.077, lat: 33.765 },
    { id: "46268", name: "Topanga Nearshore", lon: -118.578, lat: 34.022 },
    { id: "46221", name: "Santa Monica Bay", lon: -118.641, lat: 33.86 },
    { id: "46222", name: "San Pedro", lon: -118.314, lat: 33.614 },
    { id: "46256", name: "Long Beach Channel", lon: -118.201, lat: 33.7 },
    { id: "46253", name: "San Pedro South", lon: -118.182, lat: 33.576 },
    { id: "46225", name: "Torrey Pines Outer", lon: -117.391, lat: 32.933 },
  ],
  wx: ["KSBA", "KOXR", "KCMA", "KVNY", "KBUR", "KSMO", "KLAX", "KHHR", "KTOA", "KLGB", "KSNA", "KSAN"],
};

const SFLA = {
  id: "sfla",
  name: "Miami / South Florida",
  center: [-80.95, 25.55],
  zoom: 7.6,
  maxBounds: [[-84.6, 23.2], [-77.8, 27.9]],
  alertArea: "FL,AM,GM",
  alertSender: /Miami|Key West/i,
  alertOffice: "NWS Miami + Key West",
  wfos: ["MFL", "KEY"],
  newsQuery: '("king tide" OR flooding OR flooded OR "sunny day flooding" OR "coastal flood") (Miami OR "Miami Beach" OR "Fort Lauderdale" OR "Florida Keys" OR "Key West" OR "Palm Beach" OR Naples)',
  tempStops: [[70, "#3d6fe0"], [74, "#2fb7c4"], [78, "#7fcf74"], [82, "#f2c14e"], [87, "#f0643c"]],
  ensoNote: "South Florida's sunny-day flooding peaks with the fall king tides; storms, onshore wind and higher seasonal sea level push water over seawalls and up through storm drains.",
  tides: [
    { id: "8722670", name: "Lake Worth Pier", lon: -80.0342, lat: 26.6128 },
    { id: "8722956", name: "South Port Everglades", lon: -80.1167, lat: 26.0817 },
    { id: "8723214", name: "Virginia Key (Miami)", lon: -80.1618, lat: 25.7314 },
    { id: "8723970", name: "Vaca Key", lon: -81.1065, lat: 24.711 },
    { id: "8724580", name: "Key West", lon: -81.8079, lat: 24.5557 },
    { id: "8725114", name: "Naples Bay", lon: -81.7883, lat: 26.1367 },
    { id: "8725520", name: "Fort Myers", lon: -81.8711, lat: 26.6478 },
  ],
  buoys: [
    { id: "41122", name: "Hollywood Beach", lon: -80.096, lat: 26.001 },
    { id: "42095", name: "Satan Shoal", lon: -81.968, lat: 24.407 },
    { id: "LONF1", name: "Long Key (wind only)", lon: -80.864, lat: 24.844 },
    { id: "SMKF1", name: "Sombrero Key (wind only)", lon: -81.109, lat: 24.628 },
  ],
  wx: ["KBCT", "KFXE", "KFLL", "KHWO", "KOPF", "KMIA", "KHST", "KMTH", "KEYW", "KAPF", "KRSW"],
};

export const REGIONS = { sfbay: SFBAY, puget: PUGET, la: LA, sfla: SFLA };
export const REGION_IDS = Object.keys(REGIONS);
export const DEFAULT_REGION = "sfbay";
export const regionFor = (id) => REGIONS[id] || REGIONS[DEFAULT_REGION];

// jetski's original single-region names, kept so its tests still import.
export const TIDE_STATIONS = SFBAY.tides;
export const BUOYS = SFBAY.buoys;
export const WX_STATIONS = SFBAY.wx;
export const ALERT_SENDER = SFBAY.alertSender;
