# Data

What is in this folder, where it comes from and under which licence.

| File | What | Source | Licence |
|---|---|---|---|
| `region.json` | The Gulf of Finland box the whole project works in | Our own | MIT, as the code |
| `ports.geojson` | Berths, quays and harbour basins, grown 150 m towards the water. The detector drops gaps that start inside them | OpenStreetMap, through Overpass: `bun run scripts/ports-from-osm.ts` | © OpenStreetMap contributors, [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/) |
| `land.geojson` | The land of the base map, clipped to the region and simplified (not here yet: T039) | OpenStreetMap land polygons from [osmdata.openstreetmap.de](https://osmdata.openstreetmap.de/data/land-polygons.html) | © OpenStreetMap contributors, ODbL 1.0 |
| `vigia.sqlite`, `raw/` | What the recorder stores: positions, health, candidates, dossiers, and the raw messages by hour. Not in the repository | Digitraffic marine AIS, by Fintraffic | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |

## Attribution

- **AIS:** "Source: Fintraffic / digitraffic.fi, CC BY 4.0". The panel shows it in its footer and on the map. Under CC BY 4.0 the recordings can be shared, the demo database (`demo/vigia-demo.sqlite`) and the eval set included, as long as this attribution goes with them.
- **Map data:** "© OpenStreetMap contributors", ODbL 1.0. `ports.geojson` and `land.geojson` are derived databases, so they are under the ODbL too.

The positions in the demo and in the eval set are what the vessels broadcast in public AIS messages. Vigía looks at vessels, never at people.
