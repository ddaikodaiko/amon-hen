# Data

What is in this folder, where it comes from and under which licence.

| File | What | Source | Licence |
|---|---|---|---|
| `region.json` | The Gulf of Finland box the whole project works in | Our own | MIT, as the code |
| `ports.geojson` | Berths, quays, harbour basins, and industrial or port areas on the sea coast, grown 150 m towards the water and merged where they overlap. The detector drops gaps that start inside them | OpenStreetMap, through Overpass: `bun run scripts/ports-from-osm.ts --cache data/raw/overpass` (it runs `bunx mapshaper` for the merge) | © OpenStreetMap contributors, [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/) |
| `land.geojson` | The land of the base map: OSM's simplified land polygons, clipped to the region with a margin. Data of 2026-10-20, 600 KB. How it was made is below | [`simplified-land-polygons-complete-3857.zip`](https://osmdata.openstreetmap.de/data/land-polygons.html) from osmdata.openstreetmap.de | © OpenStreetMap contributors, ODbL 1.0 |
| `vigia.sqlite`, `raw/` | What the recorder stores: positions, health, candidates, dossiers, and the raw messages by hour. Not in the repository | Digitraffic marine AIS, by Fintraffic | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |

## Remaking `land.geojson`

Download and unzip `simplified-land-polygons-complete-3857.zip` (25 MB), then:

```bash
bunx mapshaper -i simplified_land_polygons.shp -proj wgs84 -clip bbox=21.5,58.7,31.4,61.3 \
  -filter-fields '' -o format=geojson geojson-type=FeatureCollection precision=0.00001 data/land.geojson
```

They are the polygons OSM simplifies for low zooms: zoomed in on a gap, islands look angular. The full ones are hundreds of MB, and the map only needs to show where land and islands are.

## Attribution

- **AIS:** "Source: Fintraffic / digitraffic.fi, CC BY 4.0". The panel shows it in its footer and on the map. Under CC BY 4.0 the recordings can be shared, the demo database (`demo/vigia-demo.sqlite`) and the eval set included, as long as this attribution goes with them.
- **Map data:** "© OpenStreetMap contributors", ODbL 1.0. `ports.geojson` and `land.geojson` are derived databases, so they are under the ODbL too.

The positions in the demo and in the eval set are what the vessels broadcast in public AIS messages. Vigía looks at vessels, never at people.
