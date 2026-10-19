// Builds data/ports.geojson (berths and basins, R8) from OpenStreetMap: one polygon per port
// area, pier, quay, dock, marina or nautical-chart harbour/berth point, grown by BUFFER_M
// towards the water, where ships lie alongside. Anchorages are
// not port areas in OSM, so they stay out, as the spec asks. Review the result on a map.
//   bun run scripts/ports-from-osm.ts [--url https://overpass-api.de/api/interpreter]
// Data © OpenStreetMap contributors, ODbL 1.0.
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

const BUFFER_M = 150;
const MAX_AREA_KM2 = 25;
const BOX = "59.2,22.5,60.8,30.4";
// Primorsk and Vysotsk terminals are not tagged as ports, so their piers and industrial
// areas are taken from around them.
const AROUND = ["6000,60.345,28.65", "5000,60.62,28.57"];

const query = `[out:json][timeout:170];(
  way["landuse"="harbour"](${BOX}); relation["landuse"="harbour"](${BOX});
  way["industrial"="port"](${BOX}); relation["industrial"="port"](${BOX});
  way["man_made"~"^(pier|quay)$"](${BOX}); way["waterway"="dock"](${BOX});
  way["leisure"="marina"](${BOX}); relation["leisure"="marina"](${BOX});
  node["seamark:type"~"^(harbour|berth)$"](${BOX});
  ${AROUND.map((a) => `nwr(around:${a})["industrial"]; nwr(around:${a})["man_made"="pier"]; nwr(around:${a})["landuse"="industrial"];`).join("\n  ")}
);out geom;`;

interface Pt {
  lat: number;
  lon: number;
}
interface Element {
  type: "node" | "way" | "relation";
  id: number;
  tags?: Record<string, string>;
  lat?: number;
  lon?: number;
  geometry?: Pt[];
  members?: { geometry?: Pt[] }[];
}

const { values } = parseArgs({ options: { url: { type: "string" } } });
const url = values.url ?? "https://overpass-api.de/api/interpreter";
const res = await fetch(url, {
  method: "POST",
  headers: { "User-Agent": "vigia/0.1 (educational project)" },
  body: new URLSearchParams({ data: query }),
});
if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
const elements = ((await res.json()) as { elements: Element[] }).elements;

const M_PER_DEG_LAT = 111_320;

/** Convex hull (monotone chain) in a local metric projection around lat0. */
function hull(points: Pt[], lat0: number): Pt[] {
  const k = Math.cos((lat0 * Math.PI) / 180);
  const p = points.map((q) => ({ ...q, x: q.lon * k, y: q.lat })).sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: (typeof p)[0], a: (typeof p)[0], b: (typeof p)[0]) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const half = (pts: typeof p) => {
    const out: typeof p = [];
    for (const q of pts) {
      while (out.length >= 2 && cross(out[out.length - 2]!, out[out.length - 1]!, q) <= 0) out.pop();
      out.push(q);
    }
    return out.slice(0, -1);
  };
  return [...half(p), ...half([...p].reverse())].map(({ lat, lon }) => ({ lat, lon }));
}

/** Hull grown by BUFFER_M: every vertex becomes an octagon, then the hull of all of them. */
function buffered(points: Pt[]): Pt[] {
  const lat0 = points.reduce((s, q) => s + q.lat, 0) / points.length;
  const dLat = BUFFER_M / M_PER_DEG_LAT;
  const dLon = dLat / Math.cos((lat0 * Math.PI) / 180);
  const grown = hull(points, lat0).flatMap((q) =>
    Array.from({ length: 8 }, (_, i) => ({
      lat: q.lat + dLat * Math.sin((i * Math.PI) / 4),
      lon: q.lon + dLon * Math.cos((i * Math.PI) / 4),
    })),
  );
  return hull(grown, lat0);
}

function areaKm2(ring: Pt[]): number {
  const lat0 = ring[0]!.lat;
  const k = Math.cos((lat0 * Math.PI) / 180) * M_PER_DEG_LAT;
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i]!;
    const q = ring[(i + 1) % ring.length]!;
    a += p.lon * k * q.lat * M_PER_DEG_LAT - q.lon * k * p.lat * M_PER_DEG_LAT;
  }
  return Math.abs(a) / 2 / 1e6;
}

const round = (n: number) => Math.round(n * 1e5) / 1e5;
const features = [];
const skipped: string[] = [];
for (const e of elements) {
  const node = e.type === "node" && e.lat !== undefined && e.lon !== undefined ? [{ lat: e.lat, lon: e.lon }] : [];
  const pts = e.geometry ?? e.members?.flatMap((m) => m.geometry ?? []) ?? node;
  if (pts.length === 0) continue;
  const ring = buffered(pts);
  const km2 = areaKm2(ring);
  const t = e.tags ?? {};
  const name = t.name ?? t["name:en"] ?? t["name:fi"] ?? t["name:et"] ?? `${e.type}/${e.id}`;
  if (km2 > MAX_AREA_KM2) {
    skipped.push(`${name} (${km2.toFixed(1)} km²)`);
    continue;
  }
  const coords = [...ring, ring[0]!].map((q) => [round(q.lon), round(q.lat)]);
  features.push({
    type: "Feature",
    properties: { name, kind: "berth", osm: `${e.type}/${e.id}`, area_km2: Math.round(km2 * 100) / 100 },
    geometry: { type: "Polygon", coordinates: [coords] },
  });
}

writeFileSync(
  "data/ports.geojson",
  `${JSON.stringify({ type: "FeatureCollection", attribution: "© OpenStreetMap contributors, ODbL 1.0", features }, null, 1)}\n`,
);
console.log(`${features.length} berth polygons → data/ports.geojson`);
if (skipped.length > 0) console.log(`skipped as too large (check by hand): ${skipped.join(", ")}`);
