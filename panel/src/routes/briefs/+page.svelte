<script lang="ts">
  import { CONFIDENCE_LABEL, DISCARD_SHORT, minutes, usd, utc, VERDICT_SHORT, when } from "#lib/format.ts";
  import type { PageProps } from "./$types";

  // The daily briefs (FR-023): the sections are written at 08:00 Madrid time; the paragraph comes
  // from the model when it is there (R11).

  let { data }: PageProps = $props();
  const b = $derived(data.brief);
  const s = $derived(b?.sections);
  const waiting = $derived(s === undefined ? 0 : s.waiting.pending + s.waiting.pending_no_model + s.waiting.pending_budget + s.waiting.error);
  const discarded = $derived(s === undefined ? [] : (Object.entries(s.discarded) as [keyof typeof DISCARD_SHORT, number][]));
  const up = $derived(s === undefined ? 0 : s.health.minutes - s.health.down);
  const n = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
  const weekday = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
</script>

<svelte:head><title>Daily brief · Vigía</title></svelte:head>

<h1>Daily brief</h1>
<p class="lede">
  Every morning at 08:00 Madrid time, Vigía writes up the 24 hours before: what the AI analyst found, what is still waiting, and whether our
  own feed held up.
</p>

{#if b === null || s === undefined}
  <p class="empty">
    No brief yet. One is written every day at 08:00 Madrid time (<code>deploy/vigia-brief.timer</code>), or by hand with
    <code>bun run brief</code>.
  </p>
{:else}
  <div class="layout">
    <nav class="panel days" aria-label="Briefs">
      <div class="panel-head"><span class="label">Days</span></div>
      {#each data.list as item (item.date)}
        <a href="?date={item.date}" aria-current={item.date === b.date ? "page" : undefined}>
          <span class="mono">{weekday(item.date)} {item.date}</span>
          <span class="sub">
            {#if item.verdicts.cases === 0}
              no alerts analysed
            {:else}
              {n(item.verdicts.cases, "alert")}{#if item.verdicts.likely_dark > 0}{" · "}<span class="dark">{item.verdicts.likely_dark} suspicious</span>{/if}
            {/if}
          </span>
        </a>
      {/each}
    </nav>

    <article>
      <header>
        <h2>{weekday(b.date)} {b.date}</h2>
        <p class="window mono">{utc(s.window.start)} to {utc(s.window.end)} UTC · written {utc(b.generated_at)} UTC</p>
      </header>

      {#if b.narrative_state === "done" && b.narrative}
        <p class="narrative">{b.narrative}</p>
      {:else if b.narrative_state === "pending"}
        <p class="narrative waiting">The AI's summary of the day is written as soon as the model answers.</p>
      {/if}

      <dl class="facts">
        <div class="fact">
          <dt class="label">Alerts analysed</dt>
          <dd class="value mono">{s.verdicts.cases}</dd>
          <dd class="note">Silences the AI analyst looked at in these 24 hours</dd>
        </div>
        <div class="fact" class:notable={s.verdicts.likely_dark > 0}>
          <dt class="label">Suspicious</dt>
          <dd class="value mono" class:dark={s.verdicts.likely_dark > 0}>{s.verdicts.likely_dark}</dd>
          <dd class="note">The ship itself probably switched its transponder off</dd>
        </div>
        <div class="fact calm">
          <dt class="label">Out of range</dt>
          <dd class="value mono">{s.verdicts.coverage_gap}</dd>
          <dd class="note">The shore receivers could not hear it there</dd>
        </div>
        <div class="fact">
          <dt class="label">Unclear</dt>
          <dd class="value mono">{s.verdicts.inconclusive}</dd>
          <dd class="note">The evidence pointed both ways</dd>
        </div>
      </dl>

      <section class="panel">
        <div class="panel-head">
          <span class="label">Alerts to look at first</span>
          <a class="label" href="/cases">All alerts →</a>
        </div>
        {#if s.top.length === 0}
          <p class="panel-body muted">No alert was analysed in these 24 hours.</p>
        {:else}
          <div class="table-wrap">
            <table>
              <thead>
                <tr><th>Ship</th><th>AI verdict</th><th>Went silent (UTC)</th><th class="num">Silent for</th></tr>
              </thead>
              <tbody>
                {#each s.top as c (c.id)}
                  <tr>
                    <td>
                      <a href="/cases/{c.id}" class="name">{c.name ?? `MMSI ${c.mmsi}`}</a>
                      {#if c.flag}<span class="sub"> · {c.flag} flag</span>{/if}
                    </td>
                    <td>
                      <span class="pill verdict-{c.verdict}">{VERDICT_SHORT[c.verdict]}</span>
                      <span class="sub">{CONFIDENCE_LABEL[c.confidence]} confidence</span>
                    </td>
                    <td class="mono">{when(c.gap_start)}</td>
                    <td class="num" class:open={c.duration_min === null}>{minutes(c.duration_min)}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </section>

      <h3 class="label">Around it</h3>
      <dl class="facts">
        <div class="fact">
          <dt class="label">Still waiting</dt>
          <dd class="value mono">{waiting}</dd>
          <dd class="note">
            {waiting === 0
              ? "Nothing was waiting when the brief was written"
              : [
                  s.waiting.pending && `${s.waiting.pending} in the AI's queue`,
                  s.waiting.pending_no_model && `${s.waiting.pending_no_model} for the AI to come back online`,
                  s.waiting.pending_budget && `${s.waiting.pending_budget} for budget`,
                  s.waiting.error && `${s.waiting.error} where the AI failed`,
                ]
                  .filter(Boolean)
                  .join(", ")}
          </dd>
        </div>
        <div class="fact">
          <dt class="label">Ignored by the detector</dt>
          <dd class="value mono">{discarded.reduce((t, [, k]) => t + k, 0)}</dd>
          <dd class="note">
            Silences that never became alerts: {discarded.map(([reason, k]) => `${k} ${DISCARD_SHORT[reason]}`).join(", ")}
          </dd>
        </div>
        <div class="fact" class:notable={s.health.minutes > 0 && s.health.down / s.health.minutes > 0.1}>
          <dt class="label">Our feed</dt>
          <dd class="value mono">{s.health.minutes === 0 ? "—" : `${Math.round((up / s.health.minutes) * 100)} % up`}</dd>
          <dd class="note">
            {#if s.health.minutes === 0}
              No minutes recorded.
            {:else}
              {minutes(up)} of {minutes(s.health.minutes)} recorded, {n(s.health.outages.length, "outage")},
              {s.health.messages.toLocaleString("en")} messages. <a href="/health">Feed health →</a>
            {/if}
          </dd>
        </div>
        <div class="fact">
          <dt class="label">Spent</dt>
          <dd class="value mono">{usd(s.spend.day_usd)}</dd>
          <dd class="note">
            {s.spend.cap_usd === 0
              ? "Only the free local model: there is no budget for paid ones"
              : `${usd(s.spend.month_usd)} of the ${usd(s.spend.cap_usd)} monthly cap so far`}
          </dd>
        </div>
      </dl>
    </article>
  </div>
{/if}

<style>
  .layout {
    display: grid;
    grid-template-columns: 220px minmax(0, 1fr);
    gap: 20px;
    align-items: start;
  }

  @media (max-width: 760px) {
    .layout {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  .days {
    display: flex;
    flex-direction: column;
  }

  .days a {
    display: flex;
    flex-direction: column;
    padding: 8px 12px;
    border-bottom: 1px solid var(--line);
    border-left: 2px solid transparent;
    color: var(--text);
    text-decoration: none;
  }

  .days a:last-child {
    border-bottom: none;
  }

  .days a:hover {
    background: var(--surface-2);
  }

  .days a[aria-current="page"] {
    border-left-color: var(--accent);
    background: var(--surface-2);
  }

  .sub {
    font-size: 12px;
    color: var(--muted);
  }

  .dark {
    color: #ff8a8b;
  }

  article {
    min-width: 0;
  }

  article header h2 {
    margin: 0;
    font-size: 18px;
  }

  .window {
    margin: 2px 0 0;
    font-size: 12px;
    color: var(--muted);
  }

  .narrative {
    margin: 16px 0;
    padding-left: 14px;
    border-left: 2px solid var(--accent);
    max-width: 80ch;
    font-size: 16px;
    line-height: 1.55;
  }

  .narrative.waiting {
    border-left-color: var(--line-strong);
    font-size: 14px;
    color: var(--muted);
  }

  .facts {
    grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
    margin: 16px 0;
  }

  .table-wrap {
    overflow-x: auto;
  }

  tbody tr:last-child td {
    border-bottom: none;
  }

  .name {
    color: var(--text);
    font-weight: 600;
  }

  .panel-head a {
    text-decoration: none;
  }

  .open {
    color: #ffc766;
  }

  h3.label {
    margin: 20px 0 0;
  }
</style>
