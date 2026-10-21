// Builds data/ports.geojson (berths and basins, R8) from OpenStreetMap: one polygon per port
// area, pier, quay, dock, marina or nautical-chart harbour/berth point, and per industrial,
// port or wharf area on the sea coast (shipyards and terminals are often tagged only so),
// grown by BUFFER_M towards the water, where ships lie alongside. Overlapping polygons are
// merged into one. Anchorages are not port areas in OSM, so they stay out, as the spec asks.
// Review the result on a map.
//   bun run scripts/ports-from-osm.ts [--url https://overpass-api.de/api/interpreter] [--cache dir]
// With --cache, each answer is kept there and reused, so a failure halfway does not ask again.
// Data © OpenStreetMap contributors, ODbL 1.0.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { inPolygon, loadPorts, type PortFeature } from "../src/geo/polygons";

const BUFFER_M = 150;
const MAX_AREA_KM2 = 25;
// Well under the buffer: the merged outlines keep their shape and the file stays near 1 MB.
const SIMPLIFY_M = 25;
// The whole gulf in one request times out on the public Overpass, so it goes in 1° tiles.
const TILES = Array.from({ length: 8 }, (_, i) => `59.2,${22.5 + i},60.8,${Math.min(23.5 + i, 30.4)}`);

const tileQuery = (box: string) => `[out:json][timeout:120];(
  way["landuse"="harbour"](${box}); relation["landuse"="harbour"](${box});
  way["industrial"="port"](${box}); relation["industrial"="port"](${box});
  way["man_made"~"^(pier|quay)$"](${box}); way["waterway"="dock"](${box});
  way["leisure"="marina"](${box}); relation["leisure"="marina"](${box});
  node["seamark:type"~"^(harbour|berth)$"](${box});
);out geom;`;
// Industrial, port and wharf areas count only on the sea coast, which is told here with the
// land of the base map. That land is simplified, so the test is loose (the sea within COAST_M):
// a factory just inland only adds a polygon on land, where no ship can be. Overpass's own
// "around the coastline" answers nothing for a whole tile.
const COAST_M = 500;
const areaQuery = (box: string) => `[out:json][timeout:180];(
  wr["landuse"~"^(industrial|port|wharf)$"](${box});
  wr["industrial"](${box});
  wr["seamark:type"="harbour"](${box});
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

const { values } = parseArgs({ options: { url: { type: "string" }, cache: { type: "string" } } });
const url = values.url ?? "https://overpass-api.de/api/interpreter";

/**
 * One request, retried with exponential backoff while the server is busy, as it asks. An empty
 * answer is retried too: every query here has something, and the public servers sometimes
 * answer a heavy query with nothing and no error.
 */
async function overpass(query: string): Promise<Element[]> {
  for (let attempt = 0, waitS = 15; ; attempt++, waitS *= 2) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "User-Agent": "vigia/0.1 (educational project)" },
      body: new URLSearchParams({ data: query }),
    });
    const elements = res.ok ? ((await res.json()) as { elements: Element[] }).elements : null;
    if (elements !== null && elements.length > 0) return elements;
    if (attempt === 4 || (elements === null && ![429, 502, 503, 504].includes(res.status))) {
      throw new Error(`${url}: ${elements === null ? `HTTP ${res.status}` : "empty answer"}`);
    }
    console.log(`${elements === null ? `HTTP ${res.status}` : "empty answer"}, retrying in ${waitS} s`);
    await Bun.sleep(waitS * 1000);
  }
}

// Ways that cross a tile edge come in both tiles. An element that also answers a port query
// needs no coast test.
const byId = new Map<string, { e: Element; coast: boolean }>();
const queries = [
  ...TILES.map((box) => ({ q: tileQuery(box), coast: false })),
  ...TILES.map((box) => ({ q: areaQuery(box), coast: true })),
];
for (const [i, { q, coast }] of queries.entries()) {
  const file = values.cache === undefined ? null : join(values.cache, `${new Bun.CryptoHasher("sha256").update(q).digest("hex").slice(0, 16)}.json`);
  const cached = file !== null && existsSync(file);
  const got = cached ? (JSON.parse(readFileSync(file, "utf8")) as Element[]) : await overpass(q);
  if (file !== null && !cached) {
    mkdirSync(values.cache!, { recursive: true });
    writeFileSync(file, JSON.stringify(got));
  }
  for (const e of got) {
    const id = `${e.type}/${e.id}`;
    byId.set(id, { e, coast: coast && (byId.get(id)?.coast ?? true) });
  }
  console.log(`request ${i + 1}/${queries.length}: ${got.length} elements${cached ? " (cached)" : ""}`);
}


const M_PER_DEG_LAT = 111_320;

/** Convex hull (monotone chain) in a local metric projection around lat0. */
function hull(points: Pt[], lat0: number): Pt[] {
  // A lone point (a berth on the nautical chart) is its own hull; the chain below would drop it.
  if (points.length < 2) return points;
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

/** Hull grown by m metres: every vertex becomes an octagon, then the hull of all of them. */
function buffered(points: Pt[], m = BUFFER_M): Pt[] {
  const lat0 = points.reduce((s, q) => s + q.lat, 0) / points.length;
  const dLat = m / M_PER_DEG_LAT;
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

interface Box {
  lon0: number;
  lon1: number;
  lat0: number;
  lat1: number;
}
const bbox = (ring: [number, number][]): Box => ({
  lon0: Math.min(...ring.map((c) => c[0])), lon1: Math.max(...ring.map((c) => c[0])),
  lat0: Math.min(...ring.map((c) => c[1])), lat1: Math.max(...ring.map((c) => c[1])),
});
const inBox = (q: Pt, b: Box) => q.lon >= b.lon0 && q.lon <= b.lon1 && q.lat >= b.lat0 && q.lat <= b.lat1;

const land = loadPorts(JSON.parse(readFileSync("data/land.geojson", "utf8")) as { features: PortFeature[] })
  .flatMap((l) => l.polygons)
  .map((p) => ({ p, box: bbox(p[0]!) }));
const onLand = (q: Pt) => land.some(({ p, box }) => inBox(q, box) && inPolygon(q.lat, q.lon, p));

interface Merged {
  features: { geometry: { coordinates: [number, number][][] } }[];
}
interface Part {
  /** A point of the element itself, well inside its grown polygon. */
  at: Pt;
  name: string | undefined;
  osm: string;
  km2: number;
}

const parts: Part[] = [];
const grown = [];
const skipped: string[] = [];
let inland = 0;
for (const { e, coast } of byId.values()) {
  const node = e.type === "node" && e.lat !== undefined && e.lon !== undefined ? [{ lat: e.lat, lon: e.lon }] : [];
  // A relation goes member by member: the hull of parts far apart would span the water between.
  const pieces = e.members?.map((m) => m.geometry ?? []) ?? [e.geometry ?? node];
  const t = e.tags ?? {};
  const name = t.name ?? t["name:en"] ?? t["name:fi"] ?? t["name:et"];
  for (const pts of pieces.filter((p) => p.length > 0)) {
    if (coast && buffered(pts, COAST_M).every(onLand)) {
      inland++;
      continue;
    }
    const ring = buffered(pts);
    const km2 = areaKm2(ring);
    if (km2 > MAX_AREA_KM2) {
      skipped.push(`${name ?? `${e.type}/${e.id}`} (${km2.toFixed(1)} km²)`);
      continue;
    }
    parts.push({ at: pts[0]!, name, osm: `${e.type}/${e.id}`, km2 });
    grown.push({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[...ring, ring[0]!].map((q) => [q.lon, q.lat])] } });
  }
}

// The piers of one harbour overlap, so they become one polygon, and a basin closed by berths
// is filled in as one more. mapshaper does the union and the simplification, as for land.geojson.
const tmp = mkdtempSync(join(tmpdir(), "vigia-ports-"));
writeFileSync(join(tmp, "parts.geojson"), JSON.stringify({ type: "FeatureCollection", features: grown }));
const ms = Bun.spawnSync(
  ["bunx", "mapshaper", "-i", join(tmp, "parts.geojson"), "-dissolve", "-explode", "-simplify", `interval=${SIMPLIFY_M}`,
    "-o", "format=geojson", "geojson-type=FeatureCollection", "precision=0.00001", join(tmp, "merged.geojson")],
  { stdout: "inherit", stderr: "inherit" },
);
if (!ms.success) throw new Error("mapshaper failed");
const rings = (JSON.parse(readFileSync(join(tmp, "merged.geojson"), "utf8")) as Merged).features.map((f) => f.geometry.coordinates[0]!);
rmSync(tmp, { recursive: true });

// Each merged polygon takes the name of its largest named element, or the id of its largest one.
const best = new Map<number, Part>();
const boxes = rings.map(bbox);
const rank = (p: Part) => (p.name === undefined ? 0 : 1e6) + p.km2;
for (const p of parts) {
  const i = rings.findIndex((r, j) => inBox(p.at, boxes[j]!) && inPolygon(p.at.lat, p.at.lon, [r]));
  if (i >= 0 && (best.get(i) === undefined || rank(p) > rank(best.get(i)!))) best.set(i, p);
}
const features = rings.map((r, i) => {
  const p = best.get(i);
  const ring = r.map(([lon, lat]) => ({ lat, lon }));
  return {
    type: "Feature",
    properties: { name: p?.name ?? p?.osm ?? "unnamed", kind: "berth", osm: p?.osm, area_km2: Math.round(areaKm2(ring) * 100) / 100 },
    geometry: { type: "Polygon", coordinates: [r] },
  };
});

writeFileSync(
  "data/ports.geojson",
  `{"type":"FeatureCollection","attribution":"© OpenStreetMap contributors, ODbL 1.0","features":[\n${features.map((f) => JSON.stringify(f)).join(",\n")}\n]}\n`,
);
console.log(`${parts.length} parts (${inland} inland areas left out), merged into ${features.length} berth polygons → data/ports.geojson`);
if (skipped.length > 0) console.log(`skipped as too large (check by hand): ${skipped.join(", ")}`);
