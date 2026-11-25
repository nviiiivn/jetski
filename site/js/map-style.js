// A quiet, dark basemap built on the OpenStreetMap US Tileservice
// (OpenMapTiles schema). Kept deliberately low-contrast so data layers pop.

const DARK = {
  land: "#14181f",
  water: "#0b1a29",
  waterLine: "#16324a",
  park: "#152219",
  wood: "#16201a",
  urban: "#181c24",
  road: "#262c37",
  roadMajor: "#323a48",
  motorway: "#3d4757",
  boundary: "#3a4252",
  label: "#8a94a6",
  labelStrong: "#c3cad6",
  waterLabel: "#4f7ea6",
  halo: "#0d1117",
};

export const ATTRIBUTION =
  '<a href="https://tiles.openstreetmap.us/" target="_blank" rel="noopener">Tiles by OSM US</a> ' +
  '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap</a> ' +
  '<a href="https://openmaptiles.org/" target="_blank" rel="noopener">© OpenMapTiles</a>';

const styleFor = (C) => ({
  version: 8,
  name: "Bay Coast Dark",
  glyphs: "https://tiles.openstreetmap.us/fonts/{fontstack}/{range}.pbf",
  sources: {
    omt: {
      type: "vector",
      url: "https://tiles.openstreetmap.us/vector/openmaptiles.json",
      attribution: ATTRIBUTION,
    },
  },
  layers: [
    { id: "bg", type: "background", paint: { "background-color": C.land } },
    {
      id: "landcover-wood",
      type: "fill",
      source: "omt",
      "source-layer": "landcover",
      filter: ["in", ["get", "class"], ["literal", ["wood", "forest"]]],
      paint: { "fill-color": C.wood, "fill-opacity": 0.8 },
    },
    {
      id: "landuse-urban",
      type: "fill",
      source: "omt",
      "source-layer": "landuse",
      filter: [
        "in",
        ["get", "class"],
        ["literal", ["residential", "commercial", "industrial", "retail"]],
      ],
      paint: { "fill-color": C.urban, "fill-opacity": 0.9 },
    },
    {
      id: "park",
      type: "fill",
      source: "omt",
      "source-layer": "park",
      paint: { "fill-color": C.park, "fill-opacity": 0.7 },
    },
    {
      id: "water",
      type: "fill",
      source: "omt",
      "source-layer": "water",
      paint: { "fill-color": C.water },
    },
    {
      id: "water-edge",
      type: "line",
      source: "omt",
      "source-layer": "water",
      paint: {
        "line-color": C.waterLine,
        "line-width": ["interpolate", ["linear"], ["zoom"], 6, 0.4, 12, 1.2],
      },
    },
    {
      id: "waterway",
      type: "line",
      source: "omt",
      "source-layer": "waterway",
      paint: { "line-color": C.waterLine, "line-width": 0.8 },
    },
    {
      id: "building",
      type: "fill",
      source: "omt",
      "source-layer": "building",
      minzoom: 14,
      paint: { "fill-color": "#1d222b", "fill-outline-color": "#232934" },
    },
    {
      id: "road-minor",
      type: "line",
      source: "omt",
      "source-layer": "transportation",
      minzoom: 11,
      filter: ["in", ["get", "class"], ["literal", ["minor", "service", "tertiary"]]],
      paint: {
        "line-color": C.road,
        "line-width": ["interpolate", ["linear"], ["zoom"], 11, 0.4, 16, 3],
      },
    },
    {
      id: "road-major",
      type: "line",
      source: "omt",
      "source-layer": "transportation",
      minzoom: 7,
      filter: ["in", ["get", "class"], ["literal", ["primary", "secondary", "trunk"]]],
      paint: {
        "line-color": C.roadMajor,
        "line-width": ["interpolate", ["linear"], ["zoom"], 7, 0.4, 16, 5],
      },
    },
    {
      id: "road-motorway",
      type: "line",
      source: "omt",
      "source-layer": "transportation",
      minzoom: 5,
      filter: ["==", ["get", "class"], "motorway"],
      paint: {
        "line-color": C.motorway,
        "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.5, 16, 6],
      },
    },
    {
      id: "boundary",
      type: "line",
      source: "omt",
      "source-layer": "boundary",
      filter: ["<=", ["get", "admin_level"], 6],
      paint: {
        "line-color": C.boundary,
        "line-dasharray": [3, 2],
        "line-width": 0.7,
      },
    },
    {
      id: "water-name",
      type: "symbol",
      source: "omt",
      "source-layer": "water_name",
      layout: {
        "text-field": ["coalesce", ["get", "name:en"], ["get", "name"]],
        "text-font": ["Noto Sans Italic"],
        "text-size": 12,
        "text-letter-spacing": 0.1,
      },
      paint: {
        "text-color": C.waterLabel,
        "text-halo-color": C.halo,
        "text-halo-width": 1,
      },
    },
    {
      id: "place-town",
      type: "symbol",
      source: "omt",
      "source-layer": "place",
      minzoom: 9,
      filter: ["in", ["get", "class"], ["literal", ["town", "village", "suburb"]]],
      layout: {
        "text-field": ["coalesce", ["get", "name:en"], ["get", "name"]],
        "text-font": ["Noto Sans Regular"],
        "text-size": 11,
      },
      paint: {
        "text-color": C.label,
        "text-halo-color": C.halo,
        "text-halo-width": 1.2,
      },
    },
    {
      id: "place-city",
      type: "symbol",
      source: "omt",
      "source-layer": "place",
      filter: ["==", ["get", "class"], "city"],
      layout: {
        "text-field": ["coalesce", ["get", "name:en"], ["get", "name"]],
        "text-font": ["Noto Sans Bold"],
        "text-size": ["interpolate", ["linear"], ["zoom"], 6, 11, 12, 16],
        "text-transform": "uppercase",
        "text-letter-spacing": 0.08,
      },
      paint: {
        "text-color": C.labelStrong,
        "text-halo-color": C.halo,
        "text-halo-width": 1.4,
      },
    },
  ],
});

// tides.alola.lol (2026-11-24): her rule, every page opens light unless the viewer picks dark.
const LIGHT = {
  land: "#f3f1ec",
  water: "#bcd7ec",
  waterLine: "#8fb8d8",
  park: "#dcebd4",
  wood: "#d3e5cc",
  urban: "#ebe8e2",
  road: "#ffffff",
  roadMajor: "#fbf3e1",
  motorway: "#f3d9a4",
  boundary: "#b4aec2",
  label: "#5d6877",
  labelStrong: "#27303b",
  waterLabel: "#3f72a0",
  halo: "#ffffff",
};
export const baseStyle = styleFor(DARK);
export const lightStyle = { ...styleFor(LIGHT), name: "Coast Watch Light" };
