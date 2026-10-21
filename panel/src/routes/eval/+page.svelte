<script lang="ts">
  import { page } from "$app/state";
  import type { EvalScores, Interval } from "#lib/api.ts";
  import { DISCARD_SHORT, PROFILE_LABEL, usd, utc } from "#lib/format.ts";
  import type { PageProps } from "./$types";

  // The eval (FR-020 to FR-022): the agent against the 60-minute rule, on the hand-labelled
  // sample. ?id= shows an older report.

  let { data }: PageProps = $props();
  const chosen = $derived(Number(page.url.searchParams.get("id")));
  const r = $derived(data.reports.find((x) => x.id === chosen) ?? data.reports[0]);
  const m = $derived(r?.metrics);
  const measured = $derived(r === undefined ? 0 : r.n_labeled - r.metrics.not_investigated);
  const discarded = $derived(m === undefined ? [] : (Object.entries(m.discarded) as [keyof typeof DISCARD_SHORT, number][]));

  const rows = (s: { agent: EvalScores; naive: EvalScores }) => [
    { name: "AI analyst", s: s.agent },
    { name: "60-minute rule", s: s.naive },
  ];
  const pct = (v: number) => `${Math.round(v * 100)} %`;
  const range = (i: Interval) => `${Math.round(i.low * 100)}–${Math.round(i.high * 100)} %`;
  /** Left and width of an interval on a 0 to 1 bar, in %. */
  const span = (i: Interval) => `left: ${i.low * 100}%; width: ${Math.max(0.5, (i.high - i.low) * 100)}%`;
</script>

<svelte:head><title>Accuracy · Vigía</title></svelte:head>

<h1>Accuracy</h1>
<p class="lede">
  How often the AI analyst gets it right, checked against alerts a person labelled at <a href="/label">Label</a> without seeing its answer.
  It is set against a rule anyone could apply: call every silence of an hour or more suspicious. The AI is only worth running if it beats
  that rule.
</p>

{#if r === undefined || m === undefined}
  <p class="empty">
    No measurement yet. Label alerts at <a href="/label">Label</a>, then run <code>bun run eval</code> (or
    <code>bun run eval --profile local</code> to analyse them all again with one model).
  </p>
{:else}
  <p class="meta mono">
    Report #{r.id} · {utc(r.created_at)} UTC · agent {r.agent_version} ·
    {r.profile === null ? "each alert's newest analysis" : `${PROFILE_LABEL[r.profile]} only`}
  </p>

  {#if m.stopping.status === "insufficient"}
    <p class="notice warn">
      <strong>Too few labels to trust these figures yet.</strong> They need 100 labelled alerts with at least 15 suspicious ones, or 300
      alerts: {m.stopping.missing_cases} more, {m.stopping.missing_positives} of them suspicious. <a href="/label">Label alerts →</a>
    </p>
  {:else if m.stopping.status === "rare_positives"}
    <p class="notice">
      <strong>300 alerts, fewer than 15 suspicious.</strong> Suspicious silences are rare here, so how many of them the AI catches is only
      known roughly: its range is wide.
    </p>
  {/if}

  <dl class="facts">
    <div class="fact">
      <dt class="label">Labelled alerts</dt>
      <dd class="value mono">{r.n_labeled}</dd>
      <dd class="note">{r.n_positive} suspicious · {r.n_undeterminable} "can't tell", left out of the scores</dd>
    </div>
    <div class="fact">
      <dt class="label">Analysed by the AI</dt>
      <dd class="value mono">{measured}</dd>
      <dd class="note">
        {m.not_investigated === 0 ? "Every labelled alert" : `${m.not_investigated} labelled alerts have no analysis yet`}; the rule is
        judged on all of them
      </dd>
    </div>
    <div class="fact">
      <dt class="label">Cost per alert</dt>
      <dd class="value mono">{m.cost.mean_usd_per_case === null ? "—" : usd(m.cost.mean_usd_per_case)}</dd>
      <dd class="note">
        {Object.entries(m.cost.by_profile)
          .map(([p, c]) => `${PROFILE_LABEL[p as keyof typeof PROFILE_LABEL]}: ${usd(c.mean_usd)} × ${c.cases}`)
          .join(" · ") || "No analysis in the sample"}
      </dd>
    </div>
    <div class="fact">
      <dt class="label">Ignored by the detector</dt>
      <dd class="value mono">{discarded.reduce((s, [, n]) => s + n, 0)}</dd>
      <dd class="note">
        Silences over the same days that never became alerts: {discarded.map(([reason, n]) => `${n} ${DISCARD_SHORT[reason]}`).join(", ")}
      </dd>
    </div>
  </dl>

  <section class="panel">
    <div class="panel-head"><span class="label">AI analyst against the 60-minute rule</span></div>
    <div class="table-wrap">
      <table class="scores">
        <thead>
          <tr>
            <th></th>
            <th colspan="2">Right when it says suspicious</th>
            <th colspan="2">Suspicious ones it catches</th>
          </tr>
        </thead>
        <tbody>
          {#each rows(m) as row (row.name)}
            <tr>
              <th scope="row">{row.name}</th>
              {#each [row.s.precision, row.s.recall] as i, k (k)}
                <td class="num">
                  {#if i}
                    <span class="mono score">{pct(i.p)}</span>
                    <span class="mono muted">{range(i)}</span>
                  {:else}
                    <span class="muted" title={k === 0 ? "It called none suspicious" : "No labelled alert was suspicious"}>—</span>
                  {/if}
                </td>
                <td class="bar-col">
                  {#if i}
                    <div class="bar" title="{pct(i.p)}, between {range(i)}">
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
    </div>
    <p class="panel-body note">
      The first is what experts call precision, the second recall. The shaded band is where the true figure lies, with 95 % confidence
      (Wilson interval): with few labels it is wide.
    </p>
  </section>

  <div class="matrices">
    {#each rows(m) as row (row.name)}
      <section class="panel">
        <div class="panel-head"><span class="label">{row.name}: every call</span></div>
        <table class="matrix">
          <thead>
            <tr><th></th><th class="num">Labelled suspicious</th><th class="num">Labelled not</th></tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Said suspicious</th>
              <td class="num hit" class:zero={row.s.tp === 0}>{row.s.tp}</td>
              <td class="num miss" class:zero={row.s.fp === 0}>{row.s.fp}</td>
            </tr>
            <tr>
              <th scope="row">Said not</th>
              <td class="num miss" class:zero={row.s.fn === 0}>{row.s.fn}</td>
              <td class="num hit" class:zero={row.s.tn === 0}>{row.s.tn}</td>
            </tr>
          </tbody>
        </table>
      </section>
    {/each}
  </div>
  <p class="note key">In green, the calls that matched the person's label; in red, the ones that did not.</p>

  <section class="panel">
    <div class="panel-head">
      <span class="label">Every measurement</span>
      <span class="muted small">newest first</span>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Report</th>
            <th>Analyses</th>
            <th class="num">Labelled</th>
            <th class="num">Suspicious</th>
            <th class="num">AI right</th>
            <th class="num">AI catches</th>
            <th class="num">Rule right</th>
            <th class="num">Rule catches</th>
            <th>Sample</th>
          </tr>
        </thead>
        <tbody>
          {#each data.reports as h (h.id)}
            {@const s = h.metrics}
            <tr class:current={h.id === r.id}>
              <td><a href="?id={h.id}" class="mono">#{h.id} · {utc(h.created_at)}</a></td>
              <td>{h.profile === null ? "newest" : PROFILE_LABEL[h.profile]} <span class="muted mono">{h.agent_version}</span></td>
              <td class="num">{h.n_labeled}</td>
              <td class="num">{h.n_positive}</td>
              {#each [s.agent.precision, s.agent.recall, s.naive.precision, s.naive.recall] as i, k (k)}
                <td class="num">{i === null ? "—" : pct(i.p)}</td>
              {/each}
              <td>
                {#if h.stopping_rule_met}<span class="pill enough">Enough</span>{:else}<span class="pill few">Too few</span>{/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </section>
{/if}

<style>
  .meta {
    margin: 0 0 14px;
    color: var(--muted);
    font-size: 12px;
  }

  .notice {
    margin: 0 0 16px;
    padding: 10px 14px;
    border: 1px solid var(--line);
    border-left: 3px solid var(--line-strong);
    background: var(--surface);
    color: var(--text-2);
    max-width: 110ch;
  }

  .notice.warn {
    border-left-color: var(--warn);
  }

  .notice strong {
    color: var(--text);
  }

  .facts {
    margin-bottom: 16px;
  }

  section.panel {
    margin-bottom: 16px;
  }

  .table-wrap {
    overflow-x: auto;
  }

  .scores th[scope="row"] {
    color: var(--text);
    font-size: 13px;
    letter-spacing: 0.04em;
  }

  .scores td.num {
    width: 1%;
  }

  .score {
    font-size: 15px;
    font-weight: 600;
    margin-right: 6px;
  }

  .bar-col {
    width: 30%;
    min-width: 140px;
  }

  .bar {
    position: relative;
    height: 8px;
    background: var(--line);
  }

  .ci {
    position: absolute;
    top: 0;
    bottom: 0;
    background: color-mix(in srgb, var(--accent) 45%, transparent);
  }

  .point {
    position: absolute;
    top: -4px;
    width: 2px;
    height: 16px;
    margin-left: -1px;
    background: var(--text);
  }

  .note {
    margin: 0;
    font-size: 12.5px;
    color: var(--muted);
  }

  .matrices {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 16px;
  }

  .matrices section.panel {
    margin-bottom: 0;
  }

  .matrix th[scope="row"] {
    color: var(--text-2);
  }

  .matrix tbody tr:last-child td,
  .matrix tbody tr:last-child th {
    border-bottom: none;
  }

  .matrix td {
    font-family: var(--mono);
    font-size: 16px;
    font-weight: 600;
  }

  .hit {
    color: #7fe0ad;
  }

  .miss {
    color: #ff8a8b;
  }

  .matrix td.zero {
    color: var(--muted);
  }

  .key {
    margin: 8px 0 16px;
  }

  .current td {
    background: var(--surface-2);
  }

  .pill.enough {
    color: #7fe0ad;
    border-color: color-mix(in srgb, var(--ok) 45%, transparent);
    background: color-mix(in srgb, var(--ok) 10%, transparent);
  }

  .pill.few {
    color: #ffc766;
    border-color: color-mix(in srgb, var(--warn) 50%, transparent);
    background: color-mix(in srgb, var(--warn) 12%, transparent);
  }

  .small {
    font-size: 12px;
  }
</style>
