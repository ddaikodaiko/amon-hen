<script lang="ts">
  import { invalidateAll } from "$app/navigation";
  import { minutes, utc } from "#lib/format.ts";
  import { _SPANS } from "./+page.ts";
  import type { PageProps } from "./$types";

  // The ingest's own health (FR-017): messages per minute, the connection, and our outages. An
  // outage is ours, not the vessels': gaps that overlap one never become candidates.

  let { data }: PageProps = $props();
  const h = $derived(data.health);
  const live = $derived(data.meta.mode === "live");

  // In live, a minute more of health every minute.
  $effect(() => {
    if (!live) return;
    const timer = setInterval(() => void invalidateAll(), 60_000);
    return () => clearInterval(timer);
  });

  const MIN = 60_000;
  /** At most this many bars: a 7-day span is shown in buckets of several minutes. */
  const MAX_BARS = 720;

  interface Bucket {
    start: number;
    minutes: number;
    perMin: number;
    down: number;
  }

  const buckets = $derived.by((): Bucket[] => {
    const span = Math.max(1, Math.round((h.to - h.from) / MIN));
    const size = Math.max(1, Math.ceil(span / MAX_BARS));
    const out: Bucket[] = [];
    for (let i = 0; i < Math.ceil(span / size); i++) out.push({ start: h.from + i * size * MIN, minutes: 0, perMin: 0, down: 0 });
    for (const [ts, n, c] of h.minutes) {
      const b = out[Math.floor((ts - h.from) / MIN / size)];
      if (b === undefined) continue;
      b.perMin += (n - b.perMin) / ++b.minutes;
      if (n === 0 || c === 0) b.down++;
    }
    return out;
  });
  const bucketMin = $derived(buckets.length === 0 ? 1 : Math.round((h.to - h.from) / MIN / buckets.length));
  const peak = $derived(Math.max(1, ...buckets.map((b) => b.perMin)));
  // After an outage the feed sends what it held back in one burst, ten times the usual rate. The
  // scale follows the usual rate, so the rest of the chart stays readable; bursts are cut at the top.
  const top = $derived.by(() => {
    const rates = buckets
      .filter((b) => b.perMin > 0)
      .map((b) => b.perMin)
      .sort((a, b) => a - b);
    const usual = rates[Math.floor(rates.length * 0.99)] ?? peak;
    return Math.min(peak, Math.max(1, usual * 1.25));
  });

  const W = 1000;
  const H = 160;
  const x = (ts: number) => ((ts - h.from) / (h.to - h.from)) * W;
  const area = $derived.by(() => {
    const bw = W / Math.max(1, buckets.length);
    const y = (b: Bucket) => H - (Math.min(b.perMin, top) / top) * H;
    const line = buckets.map((b, i) => `L${(i * bw).toFixed(1)},${y(b).toFixed(1)}h${bw.toFixed(1)}`).join("");
    return `M0,${H}${line}L${W},${H}Z`;
  });

  let hover = $state<Bucket | null>(null);
  function onmove(e: PointerEvent) {
    const r = (e.currentTarget as SVGElement).getBoundingClientRect();
    hover = buckets[Math.floor(((e.clientX - r.left) / r.width) * buckets.length)] ?? null;
  }

  const last = $derived(h.minutes.at(-1));
  const open = $derived(h.outages.find((o) => o.end_ts === null));
  /** In live, whether the ingest is still closing minutes. */
  const stale = $derived(live && h.closed_until !== null && Date.now() - h.closed_until > 3 * MIN);
  const CAUSE = { no_messages: "no messages arrived", disconnected: "disconnected from Digitraffic" } as const;

  const up = $derived(h.totals.minutes - h.totals.down);
  const n = (v: number) => v.toLocaleString("en");
  const spanLabel = (s: number) => (s === 168 ? "7 days" : `${s} h`);
</script>

<svelte:head><title>Feed health · Vigía</title></svelte:head>

<header class="head">
  <div>
    <h1>Feed health</h1>
    <p class="lede">
      Vigía hears ships through Fintraffic's shore receivers. This page shows whether that feed was reaching us. While it is down every
      ship looks silent, so silences that overlap one of our own outages are ignored, never turned into alerts.
    </p>
  </div>
  <nav class="spans" aria-label="Span">
    {#each _SPANS as s (s)}
      <a href="?hours={s}" aria-current={s === data.hours ? "page" : undefined}>{spanLabel(s)}</a>
    {/each}
  </nav>
</header>

{#if h.closed_until === null}
  <p class="empty">No feed health yet. It starts with <code>bun run ingest</code>.</p>
{:else}
  <p class="status">
    {#if stale}
      <span class="pill warn">Not updating</span>
      <span>The last minute closed at <span class="mono">{utc(h.closed_until)}</span> UTC. Is <code>bun run ingest</code> running?</span>
    {:else if open}
      <span class="pill bad">Outage</span>
      <span>Since <span class="mono">{utc(open.start_ts)}</span> UTC: {CAUSE[open.cause ?? "no_messages"]}. Silences that overlap it are ignored.</span>
    {:else if last}
      {#if last[2] === 1}<span class="pill ok">Receiving</span>{:else}<span class="pill bad">Disconnected</span>{/if}
      <span>
        <span class="mono">{n(last[1])}</span> messages in the minute to <span class="mono">{utc(last[0] + MIN)}</span> UTC{live
          ? ""
          : ", the last one recorded"}.
      </span>
    {/if}
  </p>

  <dl class="facts">
    <div class="fact" class:notable={h.totals.minutes > 0 && h.totals.down / h.totals.minutes > 0.1}>
      <dt class="label">Feed up</dt>
      <dd class="value mono">{h.totals.minutes === 0 ? "—" : `${Math.round((up / h.totals.minutes) * 100)} %`}</dd>
      <dd class="note">{minutes(up)} of the {minutes(h.totals.minutes)} recorded</dd>
    </div>
    <div class="fact">
      <dt class="label">Outages</dt>
      <dd class="value mono">{h.outages.length}</dd>
      <dd class="note">{h.outage_after_min} minutes or more without messages, or disconnected</dd>
    </div>
    <div class="fact">
      <dt class="label">Messages</dt>
      <dd class="value mono">{n(h.totals.messages)}</dd>
      <dd class="note">Positions and voyage details sent by every ship in the gulf</dd>
    </div>
    <div class="fact">
      <dt class="label">Per minute</dt>
      <dd class="value mono">{up === 0 ? "—" : n(Math.round(h.totals.messages / up))}</dd>
      <dd class="note">On average, while the feed was up</dd>
    </div>
  </dl>

  <section class="panel chart-panel">
    <div class="panel-head">
      <span class="label">Messages per minute</span>
      <span class="readout mono">
        {#if hover}
          {utc(hover.start)}{bucketMin > 1 ? ` +${bucketMin} min` : ""} ·
          {hover.minutes === 0 ? "not recorded" : `${n(Math.round(hover.perMin))} per minute`}{hover.down > 0 ? ` · ${hover.down} min down` : ""}
        {:else}
          scale to {n(Math.round(top))}{peak > top ? ` · bursts up to ${n(Math.round(peak))} cut off` : ""}{bucketMin > 1
            ? ` · bars of ${bucketMin} min`
            : ""}
        {/if}
      </span>
    </div>
    <div class="panel-body">
      <svg
        viewBox="0 0 {W} {H}"
        preserveAspectRatio="none"
        class="chart"
        role="img"
        aria-label="Messages per minute, with our outages in red"
        onpointermove={onmove}
        onpointerleave={() => (hover = null)}
      >
        {#each h.outages as o (o.start_ts)}
          <rect
            class="outage"
            x={x(Math.max(o.start_ts, h.from))}
            width={Math.max(2, x(Math.min(o.end_ts ?? h.to, h.to)) - x(Math.max(o.start_ts, h.from)))}
            y="0"
            height={H}
          />
        {/each}
        <path class="area" d={area} />
        {#if hover}
          <line class="cursor" x1={x(hover.start)} x2={x(hover.start)} y1="0" y2={H} />
        {/if}
      </svg>
      <div class="axis mono">
        <span>{utc(h.from)}</span>
        <span>{utc(h.to)} UTC</span>
      </div>
      <p class="legend">
        <span class="swatch area-swatch"></span>messages per minute
        <span class="swatch outage-swatch"></span>our own outage: nothing was heard, so no silence there becomes an alert
      </p>
    </div>
  </section>

  <section class="panel">
    <div class="panel-head">
      <span class="label">Our outages</span>
      <span class="muted small">newest first</span>
    </div>
    {#if h.outages.length === 0}
      <p class="panel-body muted">None in this span.</p>
    {:else}
      <div class="table-wrap">
        <table>
          <thead><tr><th>From (UTC)</th><th>To (UTC)</th><th class="num">Lasted</th><th>What happened</th></tr></thead>
          <tbody>
            {#each [...h.outages].reverse() as o (o.start_ts)}
              <tr>
                <td class="mono">{utc(o.start_ts)}</td>
                <td class="mono">{#if o.end_ts === null}<span class="danger">still down</span>{:else}{utc(o.end_ts)}{/if}</td>
                <td class="num">{minutes(Math.round(((o.end_ts ?? h.closed_until) - o.start_ts) / MIN))}</td>
                <td>{o.cause === null ? "—" : CAUSE[o.cause]}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>
{/if}

<style>
  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px 32px;
  }

  .spans {
    display: flex;
    gap: 6px;
  }

  .spans a {
    padding: 4px 10px;
    border: 1px solid var(--line-strong);
    border-radius: 3px;
    color: var(--text-2);
    font-size: 12.5px;
    text-decoration: none;
  }

  .spans a:hover {
    border-color: var(--accent);
  }

  .spans a[aria-current="page"] {
    color: var(--text);
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 12%, var(--surface));
  }

  .status {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 10px;
    margin: 0 0 16px;
    color: var(--text-2);
  }

  .pill.ok {
    color: #7fe0ad;
    border-color: color-mix(in srgb, var(--ok) 45%, transparent);
    background: color-mix(in srgb, var(--ok) 10%, transparent);
  }

  .pill.warn {
    color: #ffc766;
    border-color: color-mix(in srgb, var(--warn) 50%, transparent);
    background: color-mix(in srgb, var(--warn) 12%, transparent);
  }

  .pill.bad {
    color: #ff8a8b;
    border-color: color-mix(in srgb, var(--danger) 55%, transparent);
    background: color-mix(in srgb, var(--danger) 14%, transparent);
  }

  .facts {
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    margin-bottom: 16px;
  }

  .chart-panel {
    margin-bottom: 16px;
  }

  .readout {
    color: var(--text-2);
    font-size: 12px;
    text-align: right;
  }

  .chart {
    display: block;
    width: 100%;
    height: 160px;
    background: var(--bg);
    border: 1px solid var(--line);
  }

  .area {
    fill: color-mix(in srgb, var(--accent) 55%, transparent);
  }

  .outage {
    fill: color-mix(in srgb, var(--danger) 30%, transparent);
  }

  .cursor {
    stroke: var(--text);
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
  }

  .axis {
    display: flex;
    justify-content: space-between;
    margin-top: 4px;
    font-size: 11.5px;
    color: var(--muted);
  }

  .legend {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    margin: 8px 0 0;
    font-size: 12px;
    color: var(--muted);
  }

  .swatch {
    display: inline-block;
    width: 10px;
    height: 10px;
  }

  .outage-swatch {
    margin-left: 12px;
    background: color-mix(in srgb, var(--danger) 30%, transparent);
  }

  .area-swatch {
    background: color-mix(in srgb, var(--accent) 55%, transparent);
  }

  .table-wrap {
    overflow-x: auto;
  }

  tbody tr:last-child td {
    border-bottom: none;
  }

  .small {
    font-size: 12px;
  }
</style>
