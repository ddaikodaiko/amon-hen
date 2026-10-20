<script lang="ts">
  // A small map of one gap: the track before it, the silence, and the track after it.
  import { AttributionControl, type GeoJSONSource, Map as MapLibre, NavigationControl, setWorkerUrl } from "maplibre-gl";
  import "maplibre-gl/dist/maplibre-gl.css";
  import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
  import { onMount } from "svelte";
  import { BOUNDS, baseStyle, boundsOf, type Collection, emptySource, GAP_LAYERS, gapData } from "#lib/map/layers.ts";

  let { gap, height = 340 }: { gap: Parameters<typeof gapData>[0]; height?: number } = $props();
  let container: HTMLDivElement;
  let map = $state.raw<MapLibre | null>(null);
  let ready = $state(false);

  onMount(() => {
    setWorkerUrl(workerUrl);
    const m = new MapLibre({ container, style: baseStyle(), bounds: BOUNDS, attributionControl: false });
    m.addControl(new NavigationControl({ showCompass: false }), "top-right");
    m.addControl(
      new AttributionControl({
        compact: true,
        customAttribution: ["AIS: Fintraffic / digitraffic.fi, CC BY 4.0", "Land: © OpenStreetMap contributors, ODbL"],
      }),
    );
    m.on("load", () => {
      // Compact attribution starts open and would cover the bottom of a small map: folded behind its "i".
      container.querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show");
      m.addSource("gap", emptySource());
      for (const layer of GAP_LAYERS) m.addLayer(layer);
      fetch("/api/land")
        .then((r) => (r.ok ? r.json() : null))
        .then((land: Collection | null) => land && (m.getSource("land") as GeoJSONSource | undefined)?.setData(land))
        .catch(() => {});
      ready = true;
    });
    map = m;
    return () => m.remove();
  });

  $effect(() => {
    if (!ready || map === null) return;
    const data = gapData(gap);
    (map.getSource("gap") as GeoJSONSource).setData(data);
    const box = boundsOf(data);
    // At least ~2 km across, so a vessel that stood still is not zoomed into a single pixel.
    if (box !== null) {
      const pad = 0.01;
      map.fitBounds(
        [
          [box[0][0] - pad, box[0][1] - pad],
          [box[1][0] + pad, box[1][1] + pad],
        ],
        { padding: 30, duration: 0, maxZoom: 13 },
      );
    }
  });
</script>

<div class="gap-map" style:height="{height}px" bind:this={container}></div>
<ul class="key">
  <li><span class="swatch before"></span>Its route before going silent</li>
  <li><span class="swatch silence"></span>Silent (straight line: the real route is unknown)</li>
  <li><span class="swatch after"></span>After it came back</li>
</ul>

<style>
  .gap-map {
    border: 1px solid var(--line);
  }

  .key {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 16px;
    margin: 6px 0 0;
    padding: 0;
    list-style: none;
    font-size: 12px;
    color: var(--text-2);
  }

  .swatch {
    display: inline-block;
    width: 22px;
    height: 0;
    margin-right: 6px;
    vertical-align: middle;
    border-top: 2px solid;
  }

  .before {
    border-color: #cfe3f5;
  }

  .silence {
    border-top-style: dashed;
    border-color: #f2b84b;
  }

  .after {
    border-color: #4ea1ff;
  }
</style>
