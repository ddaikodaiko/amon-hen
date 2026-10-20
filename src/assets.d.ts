// Files imported as text with `with { type: "text" }` (Bun).
declare module "*.sql" {
  const text: string;
  export default text;
}
declare module "*.md" {
  const text: string;
  export default text;
}
// GeoJSON imported with `with { type: "json" }`.
declare module "*.geojson" {
  const collection: { type: "FeatureCollection"; features: import("./geo/polygons").PortFeature[] };
  export default collection;
}
