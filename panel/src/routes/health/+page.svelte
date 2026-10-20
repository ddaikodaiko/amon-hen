<script lang="ts">
  import { invalidateAll } from "$app/navigation";
  import { minutes, utc } from "#lib/format.ts";
  import { SPANS } from "./+page.ts";
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

  const W = 1000;
  const H = 160;
  const x = (ts: number) => ((ts - h.from) / (h.to - h.from)) * W;
  const area = $derived.by(() => {
    const bw = W / Math.max(1, buckets.length);
    const top = buckets.map((b, i) => `L${(i * bw).toFixed(1)},${(H - (b.perMin / peak) * H).toFixed(1)}h${bw.toFixed(1)}`).join("");
    return `M0,${H}${top}L${W},${H}Z`;
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
  const CAUSE = { no_messages: "no messages", disconnected: "disconnected" } as const;
</script>

<svelte:head><title>Health · Vigía</title></svelte:head>

<div class="top">
  <h1>Health</h1>
  <nav class="spans" aria-label="Span">
    {#each SPANS as s (s)}
      <a href="?hours={s}" aria-current={s === data.hours ? "page" : undefined}>{s === 168 ? "7 days" : `${s} h`}</a>
    {/each}
  </nav>
</div>

{#if h.closed_until === null}
  <p class="empty">No ingest health yet. It starts with <code>bun run ingest</code>.</p>
{:else}
  <p class="status">
    {#if stale}
      <span class="badge warn-bg">Not closing minutes</span>
      The last closed minute is {utc(h.closed_until)} UTC. Is <code>bun run ingest</code> running?
    {:else if open}
      <span class="badge danger-bg">Outage</span>
      Since {utc(open.start_ts)} UTC ({CAUSE[open.cause ?? "no_messages"]}). Gaps that overlap it are not candidates.
    {:else if last}
      <span class="badge ok-bg">{last[2] === 1 ? "Connected" : "Disconnected"}</span>
      {last[1]} messages in the minute to {utc(last[0] + MIN)} UTC{live ? "" : ", the last one recorded"}.
    {/if}
  </p>

  <section>
    <div class="chart-head">
      <h2>Messages per minute</h2>
      <span class="muted">
        {#if hover}
          {utc(hover.start)}{bucketMin > 1 ? `, ${bucketMin} min` : ""}: {hover.minutes === 0 ? "nothing closed" : `${Math.round(hover.perMin)} per minute`}{hover.down > 0
            ? `, ${hover.down} min down`
            : ""}
        {:else}
          peak {Math.round(peak)} per minute{bucketMin > 1 ? ` · bars of ${bucketMin} min` : ""}
        {/if}
      </span>
    </div>
    <svg viewBox="0 0 {W} {H}" preserveAspectRatio="none" class="chart" role="img" aria-label="Messages per minute" onpointermove={onmove} onpointerleave={() => (hover = null)}>
      {#each h.outages as o (o.start_ts)}
        <rect class="outage" x={x(Math.max(o.start_ts, h.from))} width={Math.max(2, x(Math.min(o.end_ts ?? h.to, h.to)) - x(Math.max(o.start_ts, h.from)))} y="0" height={H} />
      {/each}
      <path class="area" d={area} />
      {#if hover}
        <line class="cursor" x1={x(hover.start)} x2={x(hover.start)} y1="0" y2={H} />
      {/if}
    </svg>
    <div class="axis muted">
      <span>{utc(h.from)}</span>
      <span>{utc(h.to)} UTC</span>
    </div>
    <p class="muted small">
      In red, our own outages: {h.outage_after_min} minutes or more in a row without messages, or disconnected from Digitraffic.
    </p>
  </section>

  <section class="totals">
    <div><span class="muted">Minutes</span><strong>{h.totals.minutes}</strong></div>
    <div>
      <span class="muted">Down</span><strong>{h.totals.down}</strong>
      <small class="muted">{h.totals.minutes === 0 ? "" : `${((h.totals.down / h.totals.minutes) * 100).toFixed(1)} %`}</small>
    </div>
    <div><span class="muted">Messages</span><strong>{h.totals.messages.toLocaleString("en")}</strong></div>
    <div>
      <span class="muted">Per minute</span><strong>{h.totals.minutes === 0 ? "—" : Math.round(h.totals.messages / h.totals.minutes)}</strong>
    </div>
  </section>

  <section>
    <h2>Outages</h2>
    {#if h.outages.length === 0}
      <p class="muted">None in this span.</p>
    {:else}
      <table>
        <thead><tr><th>From</th><th>To</th><th>Lasted</th><th>Cause</th></tr></thead>
        <tbody>
          {#each [...h.outages].reverse() as o (o.start_ts)}
            <tr>
              <td>{utc(o.start_ts)}</td>
              <td>{o.end_ts === null ? "still down" : utc(o.end_ts)}</td>
              <td>{minutes(Math.round(((o.end_ts ?? h.closed_until) - o.start_ts) / MIN))}</td>
              <td>{o.cause === null ? "—" : CAUSE[o.cause]}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </section>
{/if}

<style>
  .top {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px 24px;
  }

  .status {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 8px;
    margin: 0 0 16px;
  }

  .ok-bg {
    background: color-mix(in srgb, var(--ok) 25%, transparent);
  }

  .warn-bg {
    background: color-mix(in srgb, var(--warn) 30%, transparent);
  }

  .danger-bg {
    background: color-mix(in srgb, var(--danger) 30%, transparent);
  }

  section {
    margin: 0 0 24px;
  }

  .chart-head {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 4px 16px;
    font-size: 13px;
  }

  .chart {
    display: block;
    width: 100%;
    height: 160px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--panel);
  }

  .area {
    fill: color-mix(in srgb, var(--accent) 55%, transparent);
  }

  .outage {
    fill: color-mix(in srgb, var(--danger) 35%, transparent);
  }

  .cursor {
    stroke: var(--text);
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
  }

  .axis {
    display: flex;
    justify-content: space-between;
    font-size: 12px;
  }

  .small {
    font-size: 12px;
  }

  .totals {
    display: flex;
    flex-wrap: wrap;
    gap: 16px 40px;
  }

  .totals div {
    display: flex;
    flex-direction: column;
  }

  .totals strong {
    font-size: 20px;
  }
</style>
