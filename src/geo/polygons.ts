import { REGION, type Region } from "../config";

type Ring = [number, number][];
type PolygonCoords = Ring[];

export interface Port {
  name: string;
  /** Each polygon is [outer ring, ...holes], rings as [lon, lat]. */
  polygons: PolygonCoords[];
}

interface Feature {
  properties: { name?: string } | null;
  geometry: { type: "Polygon"; coordinates: PolygonCoords } | { type: "MultiPolygon"; coordinates: PolygonCoords[] };
}

export function loadPorts(geojson: { features: Feature[] }): Port[] {
  return geojson.features.map((f) => ({
    name: f.properties?.name ?? "unnamed",
    polygons: f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates,
  }));
}

/** Ray casting; ring points are [lon, lat]. */
function inRing(lat: number, lon: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function inPolygon(lat: number, lon: number, polygon: PolygonCoords): boolean {
  const [outer, ...holes] = polygon;
  return outer !== undefined && inRing(lat, lon, outer) && !holes.some((h) => inRing(lat, lon, h));
}

/** Name of the berth or basin that contains the point, or null. */
export function berthAt(lat: number, lon: number, ports: Port[]): string | null {
  return ports.find((p) => p.polygons.some((poly) => inPolygon(lat, lon, poly)))?.name ?? null;
}

/**
 * True if the vessel is within the border margin of the region and its course points out
 * through that edge: the gap is then "left the region", not a candidate (R8).
 */
export function headingOut(lat: number, lon: number, cog: number | null, region: Region = REGION): boolean {
  if (cog === null) return false;
  const c = (cog * Math.PI) / 180;
  const north = Math.cos(c);
  const east = Math.sin(c);
  const nmPerDegLon = 60 * Math.cos((lat * Math.PI) / 180);
  const m = region.border_margin_nm;
  return (
    ((region.lat_max - lat) * 60 <= m && north > 0) ||
    ((lat - region.lat_min) * 60 <= m && north < 0) ||
    ((region.lon_max - lon) * nmPerDegLon <= m && east > 0) ||
    ((lon - region.lon_min) * nmPerDegLon <= m && east < 0)
  );
}
