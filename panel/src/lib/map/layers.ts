import type { LayerSpecification, StyleSpecification } from "maplibre-gl";
import region from "../../../../data/region.json";
import type { CoverageLayer, TrackPoint, VesselTick } from "../api.ts";
import type { Mark } from "./feed.svelte.ts";

// The map's style and layers. No remote tiles: a sea background and the land polygons the server
// has in data/land.geojson (FR-024). No text either, so no glyphs to fetch.

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
  sea: "#0b1620",
  land: "#252f3a",
  coast: "#3d4c5c",
  vessel: "#cfe3f5",
  selected: "#4ea1ff",
  likely_dark: "#ff4d4f",
  coverage_gap: "#6f8fbf",
  inconclusive: "#f5a524",
  open: "#8a96a3",
  low: "#ff3b3b",
  mid: "#f2b84b",
  high: "#5cc98a",
};
export const VERDICT_COLOR = COLOR;

export function baseStyle(): StyleSpecification {
  return {
    version: 8,
    sources: { land: { type: "geojson", data: { type: "FeatureCollection", features: [] } } },
    layers: [
      { id: "sea", type: "background", paint: { "background-color": COLOR.sea } },
      { id: "land", type: "fill", source: "land", paint: { "fill-color": COLOR.land, "fill-outline-color": COLOR.coast } },
    ],
  };
}

const empty = (): Collection => ({ type: "FeatureCollection", features: [] });
export const SOURCES = ["coverage", "track", "marks", "vessels"] as const;
export const emptySource = () => ({ type: "geojson" as const, data: empty() });

export const LAYERS: LayerSpecification[] = [
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
