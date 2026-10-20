<script lang="ts">
  import { page } from "$app/state";
  import type { EvalScores, Interval } from "#lib/api.ts";
  import { DISCARD_LABEL, interval, usd, utc } from "#lib/format.ts";
  import type { PageProps } from "./$types";

  // The eval (FR-020 to FR-022): the agent against the 60-minute rule, on the hand-labelled
  // sample. ?id= shows an older report.

  let { data }: PageProps = $props();
  const chosen = $derived(Number(page.url.searchParams.get("id")));
  const r = $derived(data.reports.find((x) => x.id === chosen) ?? data.reports[0]);
  const m = $derived(r?.metrics);
  const measured = $derived(r === undefined ? 0 : r.n_labeled - r.metrics.not_investigated);

  const rows = (s: { agent: EvalScores; naive: EvalScores }) => [
    { name: "Agent", s: s.agent },
    { name: "60-minute rule", s: s.naive },
  ];
  /** Left and width of an interval on a 0 to 1 bar, in %. */
  const span = (i: Interval) => `left: ${i.low * 100}%; width: ${Math.max(0.5, (i.high - i.low) * 100)}%`;
</script>

<svelte:head><title>Eval · Vigía</title></svelte:head>

<h1>Eval</h1>

{#if r === undefined || m === undefined}
  <p class="empty">
    No report yet. Label cases at <a href="/label">Label</a>, then run <code>bun run eval</code> (or
    <code>bun run eval --profile local</code> to investigate them again with one model).
  </p>
{:else}
  <p class="muted">
    Report #{r.id} · {utc(r.created_at)} UTC · agent version <code>{r.agent_version}</code> ·
    {r.profile === null ? "each case's newest dossier" : `${r.profile} on its own`}
  </p>

  {#if m.stopping.status === "insufficient"}
    <p class="banner warn">
      <strong>Insufficient sample.</strong> The rule is 100 cases with at least 15 likely dark, or 300 cases. Missing:
      {m.stopping.missing_cases} cases and {m.stopping.missing_positives} likely dark. These figures are not the ones to publish.
    </p>
  {:else if m.stopping.status === "rare_positives"}
    <p class="banner">
      <strong>300 cases without 15 likely dark:</strong> the positives are rare, and the recall intervals are wide because of it.
    </p>
  {/if}

  <section>
    <h2>Likely dark against the rest</h2>
    <p class="muted">
      {r.n_labeled} labelled cases: {r.n_positive} likely dark, {r.n_undeterminable} undeterminable (left out). The rule is judged on all of
      them; the agent on the {measured} it has a dossier for{m.not_investigated > 0 ? ` (${m.not_investigated} without one)` : ""}.
    </p>
    <table class="scores">
      <thead>
        <tr>
          <th></th>
          <th>Precision</th>
          <th class="bar-col"></th>
          <th>Recall</th>
          <th class="bar-col"></th>
        </tr>
      </thead>
      <tbody>
        {#each rows(m) as row (row.name)}
          <tr>
            <th scope="row">{row.name}</th>
            {#each [row.s.precision, row.s.recall] as i, k (k)}
              <td class="num">{interval(i)}</td>
              <td class="bar-col">
                {#if i}
                  <div class="bar" title={interval(i)}>
                    <span class="ci" style={span(i)}></span>
                    <span class="point" style="left: {i.p * 100}%"></span>
                  </div>
                {/if}
              </td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
    <p class="muted small">
      Precision: of the cases called likely dark, how many were. Recall: of the likely dark cases, how many were called so. In brackets,
      the 95 % Wilson interval.
    </p>
  </section>

  <section class="matrices">
    {#each rows(m) as row (row.name)}
      <div>
        <h2>{row.name}</h2>
        <table class="matrix">
          <thead>
            <tr><th></th><th>Labelled dark</th><th>Labelled not</th></tr>
          </thead>
          <tbody>
            <tr><th scope="row">Called dark</th><td class="num hit">{row.s.tp}</td><td class="num">{row.s.fp}</td></tr>
            <tr><th scope="row">Called not</th><td class="num">{row.s.fn}</td><td class="num hit">{row.s.tn}</td></tr>
          </tbody>
        </table>
      </div>
    {/each}
  </section>

  <section class="facts">
    <div>
      <h2>Cost</h2>
      <p>{m.cost.mean_usd_per_case === null ? "—" : usd(m.cost.mean_usd_per_case)} per case</p>
      <ul class="muted">
        {#each Object.entries(m.cost.by_profile) as [profile, c] (profile)}
          <li>{profile}: {usd(c.mean_usd)} × {c.cases}</li>
        {/each}
      </ul>
    </div>
    <div>
      <h2>Not in the sample</h2>
      <p class="muted">Gaps the detector threw out over the same period:</p>
      <ul class="muted">
        {#each Object.entries(m.discarded) as [reason, n] (reason)}
          <li>{DISCARD_LABEL[reason as keyof typeof DISCARD_LABEL]}: {n}</li>
        {/each}
      </ul>
    </div>
  </section>

  <section>
    <h2>History</h2>
    <table>
      <thead>
        <tr>
          <th>Report</th>
          <th>Version</th>
          <th>Profile</th>
          <th class="num">Labelled</th>
          <th class="num">Dark</th>
          <th>Agent precision</th>
          <th>Agent recall</th>
          <th>Rule precision</th>
          <th>Rule recall</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {#each data.reports as h (h.id)}
          <tr class:current={h.id === r.id}>
            <td><a href="?id={h.id}">#{h.id} · {utc(h.created_at)}</a></td>
            <td><code>{h.agent_version}</code></td>
            <td>{h.profile ?? "newest"}</td>
            <td class="num">{h.n_labeled}</td>
            <td class="num">{h.n_positive}</td>
            <td>{interval(h.metrics.agent.precision)}</td>
            <td>{interval(h.metrics.agent.recall)}</td>
            <td>{interval(h.metrics.naive.precision)}</td>
            <td>{interval(h.metrics.naive.recall)}</td>
            <td>{h.stopping_rule_met ? "" : "insufficient"}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </section>
{/if}

<style>
  section {
    margin: 0 0 24px;
    overflow-x: auto;
  }

  .banner {
    padding: 8px 12px;
    border: 1px solid var(--line);
    border-radius: 6px;
  }

  .banner.warn {
    border-color: var(--warn);
    color: var(--warn);
  }

  .scores {
    width: auto;
  }

  .scores th[scope="row"] {
    color: var(--text);
    font-size: 14px;
  }

  .bar-col {
    width: 180px;
  }

  .bar {
    position: relative;
    height: 10px;
    border-radius: 5px;
    background: var(--line);
  }

  .ci {
    position: absolute;
    top: 0;
    bottom: 0;
    border-radius: 5px;
    background: color-mix(in srgb, var(--accent) 45%, transparent);
  }

  .point {
    position: absolute;
    top: -3px;
    width: 2px;
    height: 16px;
    margin-left: -1px;
    background: var(--text);
  }

  .small {
    font-size: 12px;
  }

  .matrices,
  .facts {
    display: flex;
    flex-wrap: wrap;
    gap: 16px 48px;
  }

  .matrix {
    width: auto;
  }

  .hit {
    color: var(--ok);
  }

  ul {
    margin: 4px 0;
    padding-left: 18px;
  }

  .current td {
    background: var(--panel);
  }
</style>
