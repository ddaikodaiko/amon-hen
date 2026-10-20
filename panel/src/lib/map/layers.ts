import type { LayerSpecification, StyleSpecification } from "maplibre-gl";
import region from "../../../../data/region.json";
import type { CoverageLayer, TrackPoint, VesselTick } from "../api.ts";
import type { Mark } from "./feed.svelte.ts";

// The map's style and layers. No remote tiles: a sea background and the land polygons the server
// has in data/land.geojson (FR-024). No text either, so no glyphs to fetch. The main map is a 3D
// console: a tilted view with a grid, glowing coasts, fading trails behind the vessels and a column
// on every silence, as tall as the silence is long.

// The GeoJSON shapes used here (@types/geojson only comes in through MapLibre).
type Point = { type: "Point"; coordinates: [number, number] };
type LineString = { type: "LineString"; coordinates: [number, number][] };
type Polygon = { type: "Polygon"; coordinates: [number, number][][] };
export interface Collection<G = Point | LineString | Polygon> {
  type: "FeatureCollection";
  features: { type: "Feature"; geometry: G; properties: Record<string, unknown> }[];
}

export const BOUNDS: [[number, number], [number, number]] = [
  [region.lon_min, region.lat_min],
  [region.lon_max, region.lat_max],
];

const COLOR = {
  sea: "#03080d",
  land: "#0e1b26",
  coast: "#1f8db5",
  horizon: "#0b3346",
  grid: "#123447",
  vessel: "#a8ecff",
  trail: "#38d1ff",
  selected: "#3d9bff",
  likely_dark: "#ff4d4f",
  coverage_gap: "#6f8fbf",
  inconclusive: "#f5a524",
  open: "#4fb8d8",
  low: "#ff3b3b",
  mid: "#f2b84b",
  high: "#5cc98a",
};
export const VERDICT_COLOR = COLOR;

export function baseStyle(): StyleSpecification {
  return {
    version: 8,
    sources: { land: { type: "geojson", data: { type: "FeatureCollection", features: [] } } },
    // What the tilted view shows past the horizon: dark, with a haze where sea meets sky.
    sky: {
      "sky-color": COLOR.sea,
      "horizon-color": COLOR.horizon,
      "fog-color": COLOR.sea,
      "sky-horizon-blend": 0.6,
      "horizon-fog-blend": 0.8,
      "fog-ground-blend": 0.75,
    },
    layers: [
      { id: "sea", type: "background", paint: { "background-color": COLOR.sea } },
      { id: "land", type: "fill", source: "land", paint: { "fill-color": COLOR.land } },
      { id: "coast-glow", type: "line", source: "land", paint: { "line-color": COLOR.coast, "line-width": 4, "line-blur": 4, "line-opacity": 0.25 } },
      { id: "coast", type: "line", source: "land", paint: { "line-color": COLOR.coast, "line-width": 0.7, "line-opacity": 0.85 } },
    ],
  };
}

const empty = (): Collection => ({ type: "FeatureCollection", features: [] });
export const SOURCES = ["graticule", "coverage", "track", "trails", "marks", "columns", "vessels"] as const;
// Trails fade along their length: line-gradient needs the line's metrics.
export const emptySource = (id?: string) => ({ type: "geojson" as const, data: empty(), ...(id === "trails" ? { lineMetrics: true } : {}) });

/** A column this tall stands for a 30-minute silence; longer ones grow with the square root, up to a cap. */
const COLUMN_BASE_M = 6_000;
const COLUMN_MAX_M = 30_000;
const COLUMN_RADIUS_KM = 2.2;

export const LAYERS: LayerSpecification[] = [
  {
    id: "graticule",
    type: "line",
    source: "graticule",
    paint: { "line-color": COLOR.grid, "line-width": 0.6, "line-opacity": 0.55 },
  },
  {
    id: "coverage",
    type: "fill",
    source: "coverage",
    layout: { visibility: "none" },
    paint: {
      "fill-color": ["interpolate", ["linear"], ["get", "ratio"], 0, COLOR.low, 0.6, COLOR.mid, 0.95, COLOR.high],
      "fill-opacity": ["case", ["get", "sample_ok"], 0.45, 0.12],
    },
  },
  {
    id: "track",
    type: "line",
    source: "track",
    filter: ["==", ["geometry-type"], "LineString"],
    paint: { "line-color": COLOR.selected, "line-width": 2, "line-opacity": 0.8 },
  },
  {
    // Where the selected vessel was last heard: it stays visible while the vessel is silent.
    id: "track-end",
    type: "circle",
    source: "track",
    filter: ["==", ["geometry-type"], "Point"],
    paint: { "circle-radius": 9, "circle-color": "transparent", "circle-stroke-width": 2, "circle-stroke-color": COLOR.selected },
  },
  {
    id: "trails",
    type: "line",
    source: "trails",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-width": ["interpolate", ["linear"], ["zoom"], 6, 1, 11, 2.5],
      "line-gradient": ["interpolate", ["linear"], ["line-progress"], 0, "rgba(56, 209, 255, 0)", 1, "rgba(56, 209, 255, 0.85)"],
    },
  },
  {
    id: "marks",
    type: "circle",
    source: "marks",
    paint: {
      // Suspicious ones stand out; the ones nobody has looked at yet stay quiet.
      "circle-radius": [
        "interpolate",
        ["linear"],
        ["zoom"],
        6,
        ["match", ["get", "verdict"], "likely_dark", 8, "inconclusive", 6, 4],
        11,
        ["match", ["get", "verdict"], "likely_dark", 16, "inconclusive", 12, 9],
      ],
      "circle-color": ["match", ["get", "verdict"], "likely_dark", COLOR.likely_dark, "coverage_gap", COLOR.coverage_gap, "inconclusive", COLOR.inconclusive, COLOR.open],
      "circle-opacity": ["match", ["get", "verdict"], "likely_dark", 0.35, "open", 0.08, 0.2],
      "circle-stroke-width": ["match", ["get", "verdict"], "likely_dark", 2.5, "open", 1, 1.5],
      "circle-stroke-opacity": ["match", ["get", "verdict"], "open", 0.7, 1],
      "circle-stroke-color": ["match", ["get", "verdict"], "likely_dark", COLOR.likely_dark, "coverage_gap", COLOR.coverage_gap, "inconclusive", COLOR.inconclusive, COLOR.open],
      "circle-pitch-alignment": "map",
    },
  },
  {
    // The silence the pointer is over in the side list.
    id: "focus",
    type: "circle",
    source: "marks",
    filter: ["==", ["get", "id"], -1],
    paint: {
      "circle-radius": 22,
      "circle-color": "transparent",
      "circle-stroke-width": 2,
      "circle-stroke-color": "#ffffff",
      "circle-pitch-alignment": "map",
    },
  },
  {
    // A ring that keeps spreading out from each suspicious silence (animated by the page).
    id: "pulse",
    type: "circle",
    source: "marks",
    filter: ["==", ["get", "verdict"], "likely_dark"],
    paint: {
      "circle-radius": 10,
      "circle-color": "transparent",
      "circle-stroke-width": 2,
      "circle-stroke-color": COLOR.likely_dark,
      "circle-stroke-opacity": 0.6,
      "circle-pitch-alignment": "map",
    },
  },
  {
    // A column per silence, as tall as it is long; flatter as you zoom in, so it does not hide the
    // detail.
    id: "columns",
    type: "fill-extrusion",
    source: "columns",
    paint: {
      "fill-extrusion-color": ["match", ["get", "verdict"], "likely_dark", COLOR.likely_dark, "coverage_gap", COLOR.coverage_gap, "inconclusive", COLOR.inconclusive, COLOR.open],
      "fill-extrusion-height": ["interpolate", ["linear"], ["zoom"], 6, ["get", "h"], 11, ["*", ["get", "h"], 0.12]],
      "fill-extrusion-opacity": 0.8,
      "fill-extrusion-vertical-gradient": true,
    },
  },
  {
    id: "vessels-moving",
    type: "symbol",
    source: "vessels",
    filter: ["get", "moving"],
    layout: {
      "icon-image": "arrow",
      "icon-rotate": ["get", "cog"],
      "icon-rotation-alignment": "map",
      "icon-allow-overlap": true,
      "icon-size": ["interpolate", ["linear"], ["zoom"], 6, 0.45, 11, 0.9],
    },
    paint: { "icon-color": ["case", ["get", "selected"], COLOR.selected, COLOR.vessel] },
  },
  {
    id: "vessels-still",
    type: "circle",
    source: "vessels",
    filter: ["!", ["get", "moving"]],
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 6, 1.5, 11, 3.5],
      "circle-color": ["case", ["get", "selected"], COLOR.selected, COLOR.vessel],
      "circle-opacity": 0.7,
    },
  },
];

/** A white arrow pointing north, drawn once and tinted by `icon-color` (SDF). */
export function arrowImage(size = 24): { width: number; height: number; data: Uint8Array } {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const g = canvas.getContext("2d")!;
  g.fillStyle = "#fff";
  g.beginPath();
  g.moveTo(size / 2, 1);
  g.lineTo(size - 5, size - 2);
  g.lineTo(size / 2, size - 7);
  g.lineTo(5, size - 2);
  g.closePath();
  g.fill();
  return { width: size, height: size, data: new Uint8Array(g.getImageData(0, 0, size, size).data.buffer) };
}

export function vesselsData(vessels: VesselTick[], selected: number | null): Collection<Point> {
  return {
    type: "FeatureCollection",
    features: vessels.map(([mmsi, lat, lon, sog, cog]) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [lon, lat] },
      properties: { mmsi, cog: cog ?? 0, moving: sog !== null && sog >= 0.5 && cog !== null, selected: mmsi === selected },
    })),
  };
}

/** Lines every half degree of longitude and quarter degree of latitude, around the region. */
export function graticuleData(): Collection<LineString> {
  const lines: LineString[] = [];
  const [lon0, lon1, lat0, lat1] = [Math.floor(region.lon_min), Math.ceil(region.lon_max), Math.floor(region.lat_min), Math.ceil(region.lat_max)];
  for (let lon = lon0; lon <= lon1; lon += 0.5) lines.push({ type: "LineString", coordinates: [[lon, lat0], [lon, lat1]] });
  for (let lat = lat0; lat <= lat1; lat += 0.25) lines.push({ type: "LineString", coordinates: [[lon0, lat], [lon1, lat]] });
  return { type: "FeatureCollection", features: lines.map((geometry) => ({ type: "Feature", geometry, properties: {} })) };
}

export function trailsData(trails: [number, number][][]): Collection<LineString> {
  return {
    type: "FeatureCollection",
    features: trails.map((coordinates) => ({ type: "Feature", geometry: { type: "LineString", coordinates }, properties: {} })),
  };
}

/** A hexagonal column on every silence, its height from how long it lasted up to `t`. */
export function columnsData(marks: Mark[], t: number): Collection<Polygon> {
  return {
    type: "FeatureCollection",
    features: marks.map((m) => {
      const min = Math.max(0, (Math.min(m.gap_end ?? t, t) - m.gap_start) / 60_000);
      const dLat = COLUMN_RADIUS_KM / 111.32;
      const dLon = dLat / Math.cos((m.lat * Math.PI) / 180);
      const ring = Array.from({ length: 7 }, (_, i): [number, number] => {
        const a = ((i % 6) * Math.PI) / 3;
        return [m.lon + dLon * Math.cos(a), m.lat + dLat * Math.sin(a)];
      });
      return {
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [ring] },
        properties: { id: m.id, verdict: m.verdict ?? "open", h: Math.min(COLUMN_MAX_M, COLUMN_BASE_M * Math.sqrt(Math.max(min, 30) / 30)) },
      };
    }),
  };
}

export function marksData(marks: Mark[]): Collection<Point> {
  return {
    type: "FeatureCollection",
    features: marks.map((m) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [m.lon, m.lat] },
      properties: { id: m.id, verdict: m.verdict ?? "open" },
    })),
  };
}

export function coverageData(layer: CoverageLayer): Collection<Polygon> {
  const d = layer.cell_deg;
  return {
    type: "FeatureCollection",
    features: layer.cells.map(([lat, lon, ratio, expected]) => ({
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [lon, lat],
            [lon + d, lat],
            [lon + d, lat + d],
            [lon, lat + d],
            [lon, lat],
          ],
        ],
      },
      properties: { ratio, sample_ok: expected >= layer.sample_min },
    })),
  };
}

/** The track as a line, and its last point. */
export function trackData(track: TrackPoint[]): Collection<LineString | Point> {
  const last = track.at(-1);
  if (last === undefined) return { type: "FeatureCollection", features: [] };
  const end: Point = { type: "Point", coordinates: [last[2], last[1]] };
  const line: LineString = { type: "LineString", coordinates: track.map(([, lat, lon]) => [lon, lat]) };
  return {
    type: "FeatureCollection",
    features: [
      ...(track.length > 1 ? [{ type: "Feature" as const, geometry: line, properties: {} }] : []),
      { type: "Feature", geometry: end, properties: {} },
    ],
  };
}

/** The track around a gap: before and after it as lines, the silence dashed between them. */
export function gapData(g: {
  gap_start: number;
  gap_end: number | null;
  start: { lat: number; lon: number };
  end: { lat: number; lon: number } | null;
  track: TrackPoint[];
}): Collection<LineString | Point> {
  const line = (part: string, pts: [number, number][]) =>
    pts.length > 1 ? [{ type: "Feature" as const, geometry: { type: "LineString" as const, coordinates: pts }, properties: { part } }] : [];
  const point = (part: string, p: { lat: number; lon: number }) => ({
    type: "Feature" as const,
    geometry: { type: "Point" as const, coordinates: [p.lon, p.lat] as [number, number] },
    properties: { part },
  });
  const lonlat = ([, lat, lon]: TrackPoint): [number, number] => [lon, lat];
  const before = g.track.filter(([ts]) => ts <= g.gap_start).map(lonlat);
  const after = g.gap_end === null ? [] : g.track.filter(([ts]) => ts >= g.gap_end!).map(lonlat);
  const s: [number, number] = [g.start.lon, g.start.lat];
  return {
    type: "FeatureCollection",
    features: [
      ...line("before", before),
      ...line("after", after),
      ...(g.end === null ? [] : line("gap", [s, [g.end.lon, g.end.lat]])),
      point("start", g.start),
      ...(g.end === null ? [] : [point("end", g.end)]),
    ],
  };
}

export const GAP_LAYERS: LayerSpecification[] = [
  {
    id: "gap-track",
    type: "line",
    source: "gap",
    filter: ["in", ["get", "part"], ["literal", ["before", "after"]]],
    paint: { "line-color": ["match", ["get", "part"], "before", COLOR.vessel, COLOR.selected], "line-width": 2 },
  },
  {
    id: "gap-silence",
    type: "line",
    source: "gap",
    filter: ["==", ["get", "part"], "gap"],
    paint: { "line-color": COLOR.inconclusive, "line-width": 2, "line-dasharray": [2, 2] },
  },
  {
    id: "gap-points",
    type: "circle",
    source: "gap",
    filter: ["==", ["geometry-type"], "Point"],
    paint: {
      "circle-radius": 5,
      "circle-color": ["match", ["get", "part"], "start", COLOR.vessel, COLOR.selected],
      "circle-stroke-color": COLOR.sea,
      "circle-stroke-width": 2,
    },
  },
];

/** The box around every coordinate of a collection. */
export function boundsOf(c: Collection<LineString | Point>): [[number, number], [number, number]] | null {
  const pts = c.features.flatMap((f) => (f.geometry.type === "Point" ? [f.geometry.coordinates] : f.geometry.coordinates));
  if (pts.length === 0) return null;
  const lons = pts.map((p) => p[0]);
  const lats = pts.map((p) => p[1]);
  return [
    [Math.min(...lons), Math.min(...lats)],
    [Math.max(...lons), Math.max(...lats)],
  ];
}
