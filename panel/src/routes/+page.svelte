<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { AttributionControl, type GeoJSONSource, Map as MapLibre, NavigationControl, setWorkerUrl } from "maplibre-gl";
  import "maplibre-gl/dist/maplibre-gl.css";
  import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
  import { onMount } from "svelte";
  import { api, type CoverageLayer, type VesselDetail } from "#lib/api.ts";
  import { minutes, placeText, type Tone, utc, VERDICT_SHORT, VERDICT_TONE, vesselLine } from "#lib/format.ts";
  import { Feed, type Mark } from "#lib/map/feed.svelte.ts";
  import {
    arrowImage,
    BOUNDS,
    baseStyle,
    type Collection,
    columnsData,
    coverageData,
    emptySource,
    graticuleData,
    LAYERS,
    marksData,
    SOURCES,
    trackData,
    trailsData,
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
  // The tilted view, the mark under the pointer and where the pointer is.
  let tilted = $state(true);
  let hover = $state<{ x: number; y: number; id: number } | null>(null);
  let cursor = $state<{ lat: number; lon: number } | null>(null);
  // A silence of the list the pointer is over, ringed on the map.
  let focus = $state<number | null>(null);

  const source = (id: string) => map?.getSource(id) as GeoJSONSource | undefined;
  const TILT = { pitch: 48, bearing: -10 };
  const FLAT = { pitch: 0, bearing: 0 };
  // The side panel covers the left of the map on wide screens: the gulf is framed beside it.
  const padding = () =>
    container.clientWidth > 760 ? { top: 40, right: 40, bottom: 70, left: 370 } : { top: 20, right: 20, bottom: container.clientHeight * 0.45, left: 20 };
  const wholeGulf = (duration = 900) => map?.fitBounds(BOUNDS, { padding: padding(), ...(tilted ? TILT : FLAT), duration });
  function setTilt(on: boolean) {
    tilted = on;
    map?.easeTo({ ...(on ? TILT : FLAT), duration: 800 });
  }

  onMount(() => {
    setWorkerUrl(workerUrl);
    const m = new MapLibre({
      container,
      style: baseStyle(),
      bounds: BOUNDS,
      fitBoundsOptions: { padding: padding(), ...TILT },
      maxPitch: 70,
      attributionControl: false,
    });
    m.addControl(new NavigationControl({ visualizePitch: true }), "top-right");
    m.addControl(
      new AttributionControl({
        compact: true,
        customAttribution: ["AIS: Fintraffic / digitraffic.fi, CC BY 4.0", "Land: © OpenStreetMap contributors, ODbL"],
      }),
      "bottom-left",
    );
    m.on("load", () => {
      m.addImage("arrow", arrowImage(), { sdf: true });
      for (const id of SOURCES) m.addSource(id, emptySource(id));
      for (const layer of LAYERS) m.addLayer(layer);
      source("graticule")?.setData(graticuleData());
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
    for (const layer of ["marks", "columns"]) {
      m.on("click", layer, (e) => void goto(`/cases/${e.features?.[0]?.properties.id}`));
      m.on("mousemove", layer, (e) => (hover = { x: e.point.x, y: e.point.y, id: Number(e.features?.[0]?.properties.id) }));
      m.on("mouseleave", layer, () => (hover = null));
    }
    for (const layer of ["vessels-moving", "vessels-still", "marks", "columns"]) {
      m.on("mouseenter", layer, () => (m.getCanvas().style.cursor = "pointer"));
      m.on("mouseleave", layer, () => (m.getCanvas().style.cursor = ""));
    }
    m.on("mousemove", (e) => (cursor = { lat: e.lngLat.lat, lon: e.lngLat.lng }));
    m.on("mouseout", () => (cursor = null));
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
  $effect(() => {
    if (ready) source("trails")?.setData(trailsData(feed.trails));
  });
  // Open silences keep growing: the columns follow the feed's clock.
  $effect(() => {
    if (ready) source("columns")?.setData(columnsData(feed.marks, feed.t ?? Date.now()));
  });
  $effect(() => {
    if (ready) map?.setFilter("focus", ["==", ["get", "id"], focus ?? -1]);
  });

  // The ring spreading out from each suspicious silence, about 20 frames a second and only while
  // there is one; still for those who ask for less motion.
  const anyDark = $derived(feed.marks.some((m) => m.verdict === "likely_dark"));
  $effect(() => {
    if (!ready || !anyDark || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;
    let last = 0;
    const step = (now: number) => {
      frame = requestAnimationFrame(step);
      if (now - last < 50) return;
      last = now;
      const k = (now % 2200) / 2200;
      map?.setPaintProperty("pulse", "circle-radius", 8 + 34 * k);
      map?.setPaintProperty("pulse", "circle-stroke-opacity", 0.75 * (1 - k));
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
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
    analysed: feed.marks.filter((m) => m.verdict !== null).length,
    waiting: feed.marks.filter((m) => m.verdict === null).length,
    dark: feed.marks.filter((m) => m.verdict === "likely_dark").length,
  });
  const latest = $derived([...feed.marks].sort((a, b) => b.gap_start - a.gap_start).slice(0, 8));
  const summary = $derived.by(() => {
    const now = feed.mode === "replay" ? "at this point of the recording" : "right now";
    const head = `${feed.vessels.length} ships are transmitting in the gulf ${now}.`;
    if (feed.marks.length === 0) return `${head} None has gone silent for long in the last 24 hours.`;
    const silent = `In the last 24 hours, ${feed.marks.length} went silent for 30 minutes or more`;
    if (counts.dark > 0) return `${head} ${silent}, and the AI analyst finds ${counts.dark} suspicious.`;
    if (counts.analysed === 0) return `${head} ${silent}; the AI analyst has not looked at them yet.`;
    return `${head} ${silent}; none looks suspicious so far.`;
  });
  const markStatus = (m: Mark): { text: string; tone: Tone } =>
    m.verdict === null ? { text: "Awaiting AI", tone: "waiting" } : { text: VERDICT_SHORT[m.verdict], tone: VERDICT_TONE[m.verdict] };
  const hhmm = (ts: number) => new Date(ts).toISOString().slice(11, 16);
  /** How long it has been silent, as of the time on screen (replay knows the end in advance). */
  const silence = (m: Mark): string => {
    const t = feed.t ?? Date.now();
    const back = m.gap_end !== null && m.gap_end <= t;
    const min = Math.round(((back ? m.gap_end! : t) - m.gap_start) / 60_000);
    return back ? `silent ${minutes(min)}` : `silent ${minutes(min)} so far`;
  };
  const hovered = $derived(hover === null ? undefined : feed.marks.find((m) => m.id === hover!.id));
  const deg = (v: number, pos: string, neg: string) => `${Math.abs(v).toFixed(3)}° ${v >= 0 ? pos : neg}`;
</script>

<svelte:head><title>Map · Vigía</title></svelte:head>

<div class="map-page">
  <div class="map" bind:this={container}></div>
  <div class="hud" aria-hidden="true"><i class="tl"></i><i class="tr"></i><i class="bl"></i><i class="br"></i></div>

  <aside class="side panel">
    <div class="panel-head">
      <span class="label">Situation</span>
      <span class="mono time">
        {#if feed.t !== null}{utc(feed.t, true)} UTC{:else}Connecting…{/if}
        {#if !feed.connected && feed.mode}<span class="danger"> · disconnected</span>{/if}
      </span>
    </div>
    <div class="panel-body">
      {#if feed.mode === "replay"}
        <div class="speeds" role="group" aria-label="Replay speed">
          <span class="label">Replay speed</span>
          {#each SPEEDS as sp (sp)}
            <button type="button" aria-pressed={feed.speed === sp} onclick={() => feed.setSpeed(sp)}>{sp}×</button>
          {/each}
        </div>
      {/if}
      <div class="kpis">
        <div><span class="label">Ships transmitting</span><span class="kpi mono">{feed.vessels.length}</span></div>
        <div><span class="label">Silences · 24 h</span><span class="kpi mono">{feed.marks.length}</span></div>
        <div class:hot={counts.dark > 0}><span class="label">Suspicious</span><span class="kpi mono">{counts.dark}</span></div>
        <div><span class="label">Awaiting AI</span><span class="kpi mono">{counts.waiting}</span></div>
      </div>
      <p class="summary">{summary}</p>

      <div class="section-head">
        <span class="label">Latest silences</span>
        <a class="label" href="/cases">All alerts →</a>
      </div>
      {#if latest.length === 0}
        <p class="muted small">Nothing yet.</p>
      {:else}
        <ul class="alerts">
          {#each latest as m (m.id)}
            {@const st = markStatus(m)}
            <li onmouseenter={() => (focus = m.id)} onmouseleave={() => (focus = null)}>
              <a href="/cases/{m.id}">
                <span class="row">
                  <span class="name">{m.name ?? "Unnamed ship"}</span>
                  <span class="pill sev-{st.tone}">{st.text}</span>
                </span>
                <span class="sub">{vesselLine(m)} · {placeText(m.near)}</span>
                <span class="sub mono">from {hhmm(m.gap_start)} UTC · {silence(m)}</span>
              </a>
            </li>
          {/each}
        </ul>
      {/if}

      <label class="toggle">
        <input type="checkbox" bind:checked={showCoverage} />
        <span>
          Show receiver coverage
          <span class="small muted">
            how well the shore receivers hear each area{#if showCoverage && hour !== null}, at {String(hour).padStart(2, "0")}:00 UTC over the last 7 days{/if}
          </span>
        </span>
      </label>
      {#if showCoverage && coverage && coverage.cells.length === 0}
        <p class="muted small">No coverage computed for this hour yet.</p>
      {/if}
    </div>
  </aside>

  <section class="legend panel">
    <span class="how"><i class="column"></i>Each column is a ship that went silent: the taller, the longer the silence</span>
    <span><i class="ring dark"></i>Suspicious: transponder likely off</span>
    <span><i class="ring unclear"></i>Unclear</span>
    <span><i class="ring range"></i>Out of receiver range</span>
    <span><i class="ring open"></i>Not analysed yet</span>
    <span><i class="arrow"></i>Ship transmitting now, with its last 20 min of route</span>
  </section>

  <section class="view panel">
    <div class="buttons" role="group" aria-label="View">
      <button type="button" aria-pressed={tilted} onclick={() => setTilt(true)}>3D</button>
      <button type="button" aria-pressed={!tilted} onclick={() => setTilt(false)}>Flat</button>
      <button type="button" onclick={() => wholeGulf()}>Whole gulf</button>
    </div>
    <span class="mono coords">{cursor ? `${deg(cursor.lat, "N", "S")}  ${deg(cursor.lon, "E", "W")}` : "—"}</span>
  </section>

  {#if hover && hovered}
    {@const st = markStatus(hovered)}
    <div class="tip panel" style="left: {hover.x + 14}px; top: {hover.y + 14}px">
      <div class="row">
        <strong>{hovered.name ?? "Unnamed ship"}</strong>
        <span class="pill sev-{st.tone}">{st.text}</span>
      </div>
      <div class="sub">{vesselLine(hovered)}</div>
      <div class="sub">{placeText(hovered.near)}</div>
      <div class="sub mono">from {hhmm(hovered.gap_start)} UTC · {silence(hovered)}</div>
      <div class="sub hint">Click to open the case</div>
    </div>
  {/if}

  {#if selected !== null}
    <section class="vessel panel">
      <div class="panel-head">
        <span class="label">Ship</span>
        <button type="button" class="close" aria-label="Close" onclick={() => (selected = null)}>×</button>
      </div>
      <div class="panel-body">
        {#if vessel}
          <h2>{vessel.name ?? "Unnamed ship"}</h2>
          <p class="muted">{vesselLine(vessel)}{#if vessel.length_m} · {vessel.length_m} m{/if}</p>
          {#if tick}
            <p>
              {#if tick[3] !== null && tick[3] >= 0.5}
                Sailing at <strong class="mono">{tick[3].toFixed(1)} kn</strong>{#if tick[4] !== null}, heading <span class="mono">{Math.round(tick[4])}°</span>{/if}
              {:else}
                Lying still
              {/if}
            </p>
          {:else}
            <p class="warn">Not heard from in the last 10 minutes.</p>
          {/if}
          {#if vessel.destination}<p class="muted">Bound for {vessel.destination}</p>{/if}
          {#if vessel.track.length > 1}
            <p class="muted small">Blue line: its route over the last {minutes(Math.round((vessel.track.at(-1)![0] - vessel.track[0]![0]) / 60_000))}.</p>
          {/if}
          <p class="muted small mono">MMSI {vessel.mmsi}</p>
        {:else}
          <p class="muted mono">MMSI {selected}…</p>
        {/if}
      </div>
    </section>
  {/if}
</div>

<style>
  .map-page {
    position: relative;
    flex: 1;
    min-height: 560px;
  }

  .map {
    position: absolute;
    inset: 0;
  }

  /* The console frame over the map: corner brackets, faint scanlines and a vignette. Decoration
     only, it lets every click through. */
  .hud {
    position: absolute;
    inset: 0;
    pointer-events: none;
    background:
      repeating-linear-gradient(to bottom, rgb(120 220 255 / 0.025) 0 1px, transparent 1px 3px),
      radial-gradient(ellipse at 60% 45%, transparent 55%, rgb(0 0 0 / 0.55));
  }

  .hud i {
    position: absolute;
    width: 22px;
    height: 22px;
    border: 0 solid rgb(56 209 255 / 0.55);
  }

  .hud .tl {
    top: 6px;
    left: 6px;
    border-width: 1px 0 0 1px;
  }

  .hud .tr {
    top: 6px;
    right: 6px;
    border-width: 1px 1px 0 0;
  }

  .hud .bl {
    bottom: 6px;
    left: 6px;
    border-width: 0 0 1px 1px;
  }

  .hud .br {
    bottom: 6px;
    right: 6px;
    border-width: 0 1px 1px 0;
  }

  .map-page > section,
  .map-page > aside {
    position: absolute;
    background: color-mix(in srgb, var(--surface) 94%, transparent);
    backdrop-filter: blur(4px);
    font-size: 13px;
  }

  .side {
    top: 12px;
    left: 12px;
    bottom: 64px;
    width: 340px;
    display: flex;
    flex-direction: column;
  }

  .side .panel-body {
    overflow-y: auto;
    flex: 1;
  }

  .time {
    color: var(--text-2);
    font-size: 11.5px;
  }

  .speeds {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-bottom: 12px;
  }

  .speeds .label {
    margin-right: auto;
  }

  .speeds button {
    padding: 1px 8px;
    font-size: 12px;
  }

  .speeds button[aria-pressed="true"] {
    border-color: var(--accent);
  }

  .kpis {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1px;
    background: var(--line);
    border: 1px solid var(--line);
  }

  .kpis > div {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 8px 10px;
    background: var(--surface);
  }

  .kpi {
    font-size: 24px;
    font-weight: 600;
    line-height: 1.2;
  }

  .kpis .hot .kpi {
    color: #ff8a8b;
  }

  .summary {
    margin: 12px 0 16px;
    color: var(--text-2);
    line-height: 1.5;
  }

  .section-head {
    display: flex;
    justify-content: space-between;
    margin-bottom: 6px;
  }

  .section-head a {
    color: var(--accent);
    text-decoration: none;
  }

  .alerts {
    margin: 0 0 16px;
    padding: 0;
    list-style: none;
    border-top: 1px solid var(--line);
  }

  .alerts a {
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 8px 2px;
    border-bottom: 1px solid var(--line);
    color: var(--text);
    text-decoration: none;
  }

  .alerts a:hover {
    background: var(--surface-2);
  }

  .row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
  }

  .name {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sub {
    font-size: 12px;
    color: var(--muted);
  }

  .small {
    font-size: 12px;
  }

  .toggle {
    display: flex;
    align-items: start;
    gap: 8px;
    cursor: pointer;
  }

  .toggle input {
    margin-top: 3px;
  }

  .toggle .small {
    display: block;
  }

  .legend {
    left: 364px;
    bottom: 28px;
    display: flex;
    flex-wrap: wrap;
    gap: 4px 16px;
    padding: 8px 12px;
    color: var(--text-2);
    font-size: 12px;
    max-width: calc(100% - 376px - 230px);
  }

  .legend .how {
    flex-basis: 100%;
    color: var(--text);
  }

  .column {
    display: inline-block;
    width: 6px;
    height: 13px;
    margin-right: 8px;
    background: linear-gradient(to top, #4fb8d8, color-mix(in srgb, #4fb8d8 30%, transparent));
    vertical-align: -2px;
  }

  .view {
    right: 12px;
    bottom: 28px;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 6px;
    padding: 8px;
  }

  .view .buttons {
    display: flex;
    gap: 4px;
  }

  .view button {
    padding: 1px 8px;
    font-size: 12px;
  }

  .view button[aria-pressed="true"] {
    border-color: var(--accent);
    color: #8cc4ff;
  }

  .coords {
    min-width: 21ch;
    color: #7fdcff;
    font-size: 11.5px;
    text-align: right;
    white-space: pre;
  }

  .tip {
    position: absolute;
    z-index: 5;
    width: 260px;
    padding: 8px 10px;
    pointer-events: none;
    background: color-mix(in srgb, var(--surface) 96%, transparent);
    border-color: rgb(56 209 255 / 0.45);
    box-shadow: 0 0 18px rgb(56 209 255 / 0.12);
    font-size: 13px;
  }

  .tip .row {
    margin-bottom: 2px;
  }

  .tip .hint {
    margin-top: 4px;
    color: var(--accent);
  }

  .ring {
    display: inline-block;
    width: 10px;
    height: 10px;
    margin-right: 6px;
    border: 2px solid;
    border-radius: 50%;
    vertical-align: -1px;
  }

  .ring.dark {
    border-color: #ff4d4f;
    background: color-mix(in srgb, #ff4d4f 35%, transparent);
  }

  .ring.unclear {
    border-color: #f5a524;
  }

  .ring.range {
    border-color: #6f8fbf;
  }

  .ring.open {
    width: 8px;
    height: 8px;
    border-width: 1px;
    border-color: #4fb8d8;
  }

  .arrow {
    display: inline-block;
    width: 0;
    height: 0;
    margin-right: 6px;
    border-left: 5px solid transparent;
    border-right: 5px solid transparent;
    border-bottom: 10px solid #a8ecff;
    vertical-align: -1px;
  }

  .vessel {
    top: 12px;
    right: 56px;
    width: 300px;
  }

  .vessel h2 {
    margin: 0 0 2px;
  }

  .vessel p {
    margin: 4px 0;
  }

  .warn {
    color: #ffc766;
  }

  .close {
    border: none;
    background: none;
    padding: 0 4px;
    font-size: 18px;
    line-height: 1;
  }

  @media (max-width: 760px) {
    .side {
      top: auto;
      left: 8px;
      right: 8px;
      bottom: 8px;
      width: auto;
      max-height: 45%;
    }

    .legend,
    .view {
      display: none;
    }

    .vessel {
      top: 8px;
      right: 8px;
      left: 8px;
      width: auto;
    }
  }
</style>
