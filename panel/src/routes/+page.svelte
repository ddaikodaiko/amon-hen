<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { AttributionControl, type GeoJSONSource, Map as MapLibre, NavigationControl, setWorkerUrl } from "maplibre-gl";
  import "maplibre-gl/dist/maplibre-gl.css";
  import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
  import { onMount } from "svelte";
  import { api, type CoverageLayer, type VesselDetail } from "#lib/api.ts";
  import { minutes, utc, VERDICT_LABEL } from "#lib/format.ts";
  import { Feed } from "#lib/map/feed.svelte.ts";
  import {
    arrowImage,
    BOUNDS,
    baseStyle,
    type Collection,
    coverageData,
    emptySource,
    LAYERS,
    marksData,
    SOURCES,
    trackData,
    VERDICT_COLOR,
    vesselsData,
  } from "#lib/map/layers.ts";

  const SPEEDS = [1, 10, 60, 300];
  const feed = new Feed();
  // /?at=<ms>&vessel=<mmsi>: a moment of the replay (live ignores `at`) and a vessel to follow.
  const param = (k: string) => {
    const v = Number(page.url.searchParams.get(k));
    return Number.isInteger(v) && v > 0 ? v : undefined;
  };
  let container: HTMLDivElement;
  let map: MapLibre | null = null;
  let ready = $state(false);
  let showCoverage = $state(false);
  let coverage = $state.raw<CoverageLayer | null>(null);
  let selected = $state<number | null>(param("vessel") ?? null);
  let vessel = $state.raw<VesselDetail | null>(null);

  const source = (id: string) => map?.getSource(id) as GeoJSONSource | undefined;

  onMount(() => {
    setWorkerUrl(workerUrl);
    const m = new MapLibre({
      container,
      style: baseStyle(),
      bounds: BOUNDS,
      fitBoundsOptions: { padding: 20 },
      attributionControl: false,
    });
    m.addControl(new NavigationControl({ showCompass: false }), "top-right");
    m.addControl(
      new AttributionControl({
        compact: true,
        customAttribution: ["AIS: Fintraffic / digitraffic.fi, CC BY 4.0", "Land: © OpenStreetMap contributors, ODbL"],
      }),
    );
    m.on("load", () => {
      m.addImage("arrow", arrowImage(), { sdf: true });
      for (const id of SOURCES) m.addSource(id, emptySource());
      for (const layer of LAYERS) m.addLayer(layer);
      // The base map is optional: without data/land.geojson the sea is all there is.
      fetch("/api/land")
        .then((r) => (r.ok ? r.json() : null))
        .then((land: Collection | null) => land && source("land")?.setData(land))
        .catch(() => {});
      ready = true;
    });
    for (const layer of ["vessels-moving", "vessels-still"]) {
      m.on("click", layer, (e) => (selected = Number(e.features?.[0]?.properties.mmsi)));
    }
    m.on("click", "marks", (e) => void goto(`/cases/${e.features?.[0]?.properties.id}`));
    for (const layer of ["vessels-moving", "vessels-still", "marks"]) {
      m.on("mouseenter", layer, () => (m.getCanvas().style.cursor = "pointer"));
      m.on("mouseleave", layer, () => (m.getCanvas().style.cursor = ""));
    }
    map = m;
    feed.connect({ at: param("at") });
    return () => {
      feed.close();
      m.remove();
    };
  });

  $effect(() => {
    if (ready) source("vessels")?.setData(vesselsData(feed.vessels, selected));
  });
  $effect(() => {
    if (ready) source("marks")?.setData(marksData(feed.marks));
  });

  // Coverage of the hour on screen, fetched when the hour changes.
  const hour = $derived(feed.t === null ? null : new Date(feed.t).getUTCHours());
  $effect(() => {
    if (!ready || !showCoverage || hour === null) return;
    void fetch(`/api/coverage?hour=${hour}`)
      .then((r) => r.json() as Promise<CoverageLayer>)
      .then((c) => {
        coverage = c;
        source("coverage")?.setData(coverageData(c));
      });
  });
  $effect(() => {
    if (ready) map?.setLayoutProperty("coverage", "visibility", showCoverage ? "visible" : "none");
  });

  // The selected vessel's card and track, refreshed every 10 s of wall time.
  $effect(() => {
    if (selected === null) {
      vessel = null;
      if (ready) source("track")?.setData(trackData([]));
      return;
    }
    const mmsi = selected;
    const load = () =>
      fetch(`/api/vessels/${mmsi}?at=${Math.round(feed.t ?? Date.now())}`)
        .then((r) => (r.ok ? (r.json() as Promise<VesselDetail>) : null))
        .then((v) => {
          if (v === null || selected !== mmsi) return;
          vessel = v;
          source("track")?.setData(trackData(v.track));
        });
    void load();
    const timer = setInterval(load, 10_000);
    return () => clearInterval(timer);
  });

  const tick = $derived(selected === null ? undefined : feed.vessels.find((v) => v[0] === selected));
  const counts = $derived({
    open: feed.marks.filter((m) => m.verdict === null).length,
    dark: feed.marks.filter((m) => m.verdict === "likely_dark").length,
  });
</script>

<svelte:head><title>Map · Vigía</title></svelte:head>

<div class="map-page">
  <div class="map" bind:this={container}></div>

  <section class="hud">
    <div class="clock">
      {#if feed.t !== null}
        <strong>{utc(feed.t, true)}</strong> UTC
      {:else}
        Connecting…
      {/if}
      {#if feed.mode}<span class="badge">{feed.mode}</span>{/if}
      {#if !feed.connected && feed.mode}<span class="danger">disconnected</span>{/if}
    </div>
    {#if feed.mode === "replay"}
      <div class="speeds" role="group" aria-label="Replay speed">
        {#each SPEEDS as s (s)}
          <button type="button" aria-pressed={feed.speed === s} onclick={() => feed.setSpeed(s)}>{s}×</button>
        {/each}
      </div>
    {/if}
    <div class="muted">
      {feed.vessels.length} vessels · {feed.marks.length} gaps in 24 h ({counts.dark} likely dark, {counts.open} open)
    </div>
    <label class="toggle">
      <input type="checkbox" bind:checked={showCoverage} />
      Coverage {#if showCoverage && hour !== null}<span class="muted">at {String(hour).padStart(2, "0")}:00 UTC, last 7 days</span>{/if}
    </label>
    {#if showCoverage && coverage && coverage.cells.length === 0}
      <div class="muted">No coverage computed for this hour yet.</div>
    {/if}
  </section>

  <section class="legend">
    {#each ["likely_dark", "coverage_gap", "inconclusive"] as const as v (v)}
      <span><i style="border-color: {VERDICT_COLOR[v]}"></i>{VERDICT_LABEL[v]}</span>
    {/each}
    <span><i style="border-color: {VERDICT_COLOR.open}"></i>Not investigated yet</span>
  </section>

  {#if selected !== null}
    <section class="vessel">
      <button type="button" class="close" aria-label="Close" onclick={() => (selected = null)}>×</button>
      {#if vessel}
        <h2>{vessel.name ?? "Unnamed vessel"}</h2>
        <p class="muted">
          {[`MMSI ${vessel.mmsi}`, vessel.flag, vessel.type_label, `class ${vessel.ais_class}`].filter(Boolean).join(" · ")}
        </p>
        {#if tick}
          <p>{tick[3] === null ? "?" : tick[3].toFixed(1)} kn · course {tick[4] === null ? "?" : Math.round(tick[4])}°</p>
        {:else}
          <p class="danger">Not heard from in the last 10 minutes.</p>
        {/if}
        {#if vessel.destination}<p class="muted">To {vessel.destination}</p>{/if}
        {#if vessel.track.length > 1}
          <p class="muted">Track: last {minutes(Math.round((vessel.track.at(-1)![0] - vessel.track[0]![0]) / 60_000))}</p>
        {/if}
      {:else}
        <p class="muted">MMSI {selected}…</p>
      {/if}
    </section>
  {/if}
</div>

<style>
  .map-page {
    position: relative;
    flex: 1;
    min-height: 480px;
    margin: -16px;
  }

  .map {
    position: absolute;
    inset: 0;
  }

  section {
    position: absolute;
    padding: 10px 12px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: color-mix(in srgb, var(--panel) 92%, transparent);
    font-size: 13px;
  }

  .hud {
    top: 12px;
    left: 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-width: calc(100% - 80px);
  }

  .clock {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }

  .speeds {
    display: flex;
    gap: 4px;
  }

  .speeds button {
    padding: 2px 8px;
  }

  .speeds button[aria-pressed="true"] {
    border-color: var(--accent);
  }

  .toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
  }

  .legend {
    left: 12px;
    bottom: 28px;
    display: flex;
    flex-wrap: wrap;
    gap: 4px 14px;
    max-width: calc(100% - 24px);
  }

  .legend i {
    display: inline-block;
    width: 10px;
    height: 10px;
    margin-right: 6px;
    border: 2px solid;
    border-radius: 50%;
    vertical-align: -1px;
  }

  .vessel {
    top: 12px;
    right: 56px;
    width: 290px;
  }

  .vessel h2 {
    margin: 0 20px 2px 0;
  }

  .vessel p {
    margin: 4px 0;
  }

  .close {
    position: absolute;
    top: 4px;
    right: 6px;
    border: none;
    background: none;
    font-size: 18px;
    line-height: 1;
  }

  @media (max-width: 640px) {
    .vessel {
      top: auto;
      right: 12px;
      bottom: 80px;
      left: 12px;
      width: auto;
    }
  }
</style>
