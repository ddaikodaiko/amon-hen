<script lang="ts">
  import { CONFIDENCE_LABEL, DISCARD_LABEL, minutes, usd, utc, VERDICT_LABEL } from "#lib/format.ts";
  import type { PageProps } from "./$types";

  // The daily briefs (FR-023): the sections are written at 08:00 Madrid time; the paragraph comes
  // from the model when it is there (R11).

  let { data }: PageProps = $props();
  const b = $derived(data.brief);
  const s = $derived(b?.sections);
  const waiting = $derived(s === undefined ? 0 : s.waiting.pending + s.waiting.pending_no_model + s.waiting.pending_budget + s.waiting.error);
  const discarded = $derived(s === undefined ? 0 : s.discarded.own_outage + s.discarded.left_region + s.discarded.berth);
  const n = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
  const weekday = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
</script>

<svelte:head><title>Briefs · Vigía</title></svelte:head>

<h1>Briefs</h1>

{#if b === null || s === undefined}
  <p class="empty">
    No brief yet. One is written every day at 08:00 Madrid time (<code>deploy/vigia-brief.timer</code>), or by hand with
    <code>bun run brief</code>.
  </p>
{:else}
  <div class="layout">
    <nav class="dates" aria-label="Briefs">
      {#each data.list as item (item.date)}
        <a href="?date={item.date}" aria-current={item.date === b.date ? "page" : undefined}>
          <span>{weekday(item.date)} {item.date}</span>
          <span class="muted">
            {#if item.verdicts.cases === 0}
              no cases
            {:else}
              {n(item.verdicts.cases, "case")}{item.verdicts.likely_dark > 0 ? ` · ${item.verdicts.likely_dark} dark` : ""}
            {/if}
          </span>
        </a>
      {/each}
    </nav>

    <article>
      <h2>{weekday(b.date)} {b.date}</h2>
      <p class="muted">From {utc(s.window.start)} to {utc(s.window.end)} UTC · written {utc(b.generated_at)} UTC</p>

      {#if b.narrative_state === "done" && b.narrative}
        <p class="narrative">{b.narrative}</p>
      {:else if b.narrative_state === "pending"}
        <p class="muted narrative">The paragraph waits for the model: it is written when the model answers.</p>
      {/if}

      <div class="counts">
        <span class="badge big">{n(s.verdicts.cases, "case")}</span>
        <span class="badge big verdict-likely_dark">{s.verdicts.likely_dark} likely dark</span>
        <span class="badge big verdict-coverage_gap">{n(s.verdicts.coverage_gap, "coverage gap")}</span>
        <span class="badge big verdict-inconclusive">{s.verdicts.inconclusive} inconclusive</span>
      </div>

      {#if s.top.length === 0}
        <p class="empty">No case was investigated in these 24 hours.</p>
      {:else}
        <h3>Top cases</h3>
        <table>
          <thead>
            <tr><th>Vessel</th><th>Verdict</th><th>Silent from</th><th class="num">For</th></tr>
          </thead>
          <tbody>
            {#each s.top as c (c.id)}
              <tr>
                <td>
                  <a href="/cases/{c.id}">{c.name ?? `MMSI ${c.mmsi}`}</a>
                  {#if c.flag}<span class="muted"> · {c.flag}</span>{/if}
                </td>
                <td>
                  <span class="badge verdict-{c.verdict}">{VERDICT_LABEL[c.verdict]}</span>
                  <span class="muted">{CONFIDENCE_LABEL[c.confidence]}</span>
                </td>
                <td>{utc(c.gap_start)}</td>
                <td class="num">{minutes(c.duration_min)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}

      <ul class="facts">
        {#if waiting > 0}
          <li>
            Waiting when it was written:
            {[
              s.waiting.pending && `${s.waiting.pending} for the agent`,
              s.waiting.pending_no_model && `${s.waiting.pending_no_model} for the model`,
              s.waiting.pending_budget && `${s.waiting.pending_budget} for budget`,
              s.waiting.error && `${s.waiting.error} in error`,
            ]
              .filter(Boolean)
              .join(", ")}.
          </li>
        {/if}
        <li>
          Thrown out by the detector: {discarded === 0
            ? "none"
            : (Object.entries(s.discarded) as [keyof typeof DISCARD_LABEL, number][])
                .filter(([, n]) => n > 0)
                .map(([r, n]) => `${n} ${DISCARD_LABEL[r]}`)
                .join(", ")}.
        </li>
        <li>
          Our ingest:
          {#if s.health.minutes === 0}
            no minutes recorded.
          {:else}
            {s.health.down} of {s.health.minutes} minutes down, {n(s.health.outages.length, "outage")},
            {s.health.messages.toLocaleString("en")} messages.
            <a href="/health">Health</a>
          {/if}
        </li>
        <li>Spent: {usd(s.spend.day_usd)} on these investigations; {usd(s.spend.month_usd)} of {usd(s.spend.cap_usd)} this month.</li>
      </ul>
    </article>
  </div>
{/if}

<style>
  .layout {
    display: grid;
    grid-template-columns: 200px minmax(0, 1fr);
    gap: 24px;
  }

  @media (max-width: 700px) {
    .layout {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  .dates {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .dates a {
    display: flex;
    flex-direction: column;
    padding: 6px 10px;
    border-radius: 6px;
    color: var(--text);
    text-decoration: none;
  }

  .dates a:hover {
    background: var(--panel);
  }

  .dates a[aria-current="page"] {
    background: var(--line);
  }

  .dates .muted {
    font-size: 12px;
  }

  article {
    max-width: 900px;
    overflow-x: auto;
  }

  h3 {
    font-size: 14px;
    margin: 16px 0 6px;
  }

  .narrative {
    max-width: 70ch;
    font-size: 15px;
    line-height: 1.6;
  }

  .counts {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 12px 0;
  }

  .facts {
    margin: 16px 0 0;
    padding-left: 18px;
  }

  .facts li {
    margin: 4px 0;
  }
</style>
