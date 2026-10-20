<script lang="ts">
  import { goto, invalidateAll } from "$app/navigation";
  import { page } from "$app/state";
  import { ApiError, api, type ProfileName, type TraceStep } from "#lib/api.ts";
  import { factsOf } from "#lib/facts.ts";
  import {
    ago,
    alertStatus,
    CONFIDENCE_LABEL,
    DISCARD_LABEL,
    minutes,
    ms,
    placeText,
    prettyJson,
    STATE_HELP,
    tokens,
    usd,
    utc,
    VERDICT_HELP,
    VERDICT_LABEL,
    vesselLine,
    when,
  } from "#lib/format.ts";
  import GapMap from "#lib/map/GapMap.svelte";
  import type { PageProps } from "./$types";

  // One alert as an intelligence report: what happened in a sentence, the track, the AI analyst's
  // verdict, the facts the data gives without it, and, folded away, how the AI got there.

  let { data }: PageProps = $props();
  const c = $derived(data.detail.candidate);
  const x = $derived(data.detail.context);
  const dossiers = $derived(data.detail.dossiers);
  const status = $derived(alertStatus(c));
  const facts = $derived(factsOf(c, x));

  // ?v=N picks a version; the newest by default.
  const wanted = $derived(Number(page.url.searchParams.get("v")));
  const dossier = $derived(dossiers.find((d) => d.version === wanted) ?? dossiers.at(-1) ?? null);
  const cited = $derived(new Set(dossier?.evidence.map((e) => e.step) ?? []));
  // The step an evidence link points at (scenario 5). From the URL rather than :target, so a
  // shared link to #step-N also lights up once the trace has rendered.
  const targeted = $derived(page.url.hash.startsWith("#step-") ? Number(page.url.hash.slice(6)) : null);
  // A link to a step opens the AI's working, folded by default.
  let showWork = $state(false);
  $effect(() => {
    if (targeted !== null) showWork = true;
  });

  const headline = $derived(
    c.gap_end === null
      ? `Stopped transmitting ${placeText(x.near_start)}, on ${when(c.gap_start)} UTC, and has not been heard from since.`
      : `Stopped transmitting for ${minutes(c.duration_min)}, ${placeText(x.near_start)}, on ${when(c.gap_start)} UTC.`,
  );
  const confidenceLevel = { low: 1, medium: 2, high: 3 } as const;

  function pickVersion(v: number) {
    const url = new URL(page.url.href);
    url.hash = "";
    if (v === dossiers.at(-1)?.version) url.searchParams.delete("v");
    else url.searchParams.set("v", String(v));
    void goto(url, { replace: true });
  }

  function stepTitle(s: TraceStep): string {
    if (s.kind === "model_call") return "AI reasoning";
    if (s.kind === "nudge") return "Reminder to the AI";
    if (s.kind === "error") return s.tool === null ? "Error" : `${s.tool} (failed)`;
    return s.tool ?? "Tool call";
  }

  const PROFILE_LABEL: Record<ProfileName, string> = { local: "Local model (free)", haiku: "Claude Haiku", sonnet: "Claude Sonnet" };
  let profile = $state<ProfileName>("local");
  // Why the button is off, in words that say what is missing (scenario 3 of US2, FR-026).
  const blocked = $derived.by((): string | null => {
    const m = data.meta;
    if (m.mode === "replay") {
      return "This is a recorded demo, so it is read-only. To analyse alerts, run Vigía live (bun run server) with Ollama serving qwen3:8b at VIGIA_LOCAL_URL, or with ANTHROPIC_API_KEY for the paid models.";
    }
    if (m.mode === "public") return "This is a public, read-only view.";
    if (c.state === "discarded" || c.state === "detected") return "Vigía ignored this silence, so there is nothing to analyse.";
    if (profile === "local" && m.model.available === false) {
      const paid = m.paid_ready ? ", or pick a paid model" : "";
      return `The local model does not answer (${m.model.reason ?? "no reason given"}). Start Ollama at VIGIA_LOCAL_URL${paid}.`;
    }
    if (profile !== "local" && !m.paid_ready) return "The paid models need ANTHROPIC_API_KEY in .env.";
    if (profile !== "local" && m.budget.spent_usd >= m.budget.cap_usd) {
      return `This month's cap of ${usd(m.budget.cap_usd)} is spent (VIGIA_BUDGET_USD).`;
    }
    return null;
  });
  const canInvestigate = $derived(blocked === null);
  let queued = $state<string | null>(null);
  let failure = $state<string | null>(null);
  let before: { started_at: number | null; versions: number } | null = null;

  async function reinvestigate() {
    failure = null;
    try {
      const r = await api.reinvestigate(c.id, profile);
      before = { started_at: c.started_at, versions: dossiers.length };
      queued = r.position === 1 ? "Queued: next." : `Queued: ${r.position - 1} ahead.`;
    } catch (err) {
      failure = err instanceof ApiError ? err.message : String(err);
    }
  }

  // While a request is queued, refresh until it has run (a new version, or a new attempt that
  // ended in a waiting state).
  $effect(() => {
    if (queued === null) return;
    const timer = setInterval(() => void invalidateAll(), 4000);
    return () => clearInterval(timer);
  });
  $effect(() => {
    if (before === null) return;
    const ran = dossiers.length > before.versions || (c.started_at !== before.started_at && c.state !== "investigating");
    if (ran) {
      queued = null;
      before = null;
    }
  });

  const mapLink = $derived(
    data.meta.mode === "replay" ? `/?at=${c.gap_start - 15 * 60_000}&vessel=${c.mmsi}` : `/?vessel=${c.mmsi}`,
  );
</script>

<svelte:head><title>{c.name ?? c.mmsi} · Alerts · Vigía</title></svelte:head>

<nav class="crumbs label" aria-label="Breadcrumb"><a href="/cases">Alerts</a> <span>/</span> <span class="mono">#{c.id}</span></nav>

<header class="head">
  <div>
    <h1>{c.name ?? "Unnamed ship"}</h1>
    <p class="who">
      {vesselLine(c.vessel)}{#if c.vessel.length_m} · {c.vessel.length_m} m long{/if}{#if c.vessel.destination} · bound for {c.vessel.destination}{/if}
    </p>
    <p class="ids mono muted">
      MMSI {c.mmsi}{#if c.vessel.imo} · IMO {c.vessel.imo}{/if}{#if c.vessel.callsign} · call sign {c.vessel.callsign}{/if}
    </p>
  </div>
  <span class="pill big sev-{status.tone}">{status.text}</span>
</header>

<p class="headline">{headline}</p>

<div class="grid">
  <section class="panel">
    <div class="panel-head">
      <span class="label">Track</span>
      <a class="label" href={mapLink}>Open on the map →</a>
    </div>
    <GapMap gap={{ ...c, track: x.track }} height={360} />
    <ol class="timeline">
      <li>
        <span class="label">Last message</span>
        <span class="mono">{utc(c.gap_start)}</span>
      </li>
      <li class="silent">
        <span class="label">Silent for</span>
        <span class="mono">{c.gap_end === null ? `${ago(c.gap_start)}, ongoing` : minutes(c.duration_min)}</span>
      </li>
      <li>
        <span class="label">Back on air</span>
        <span class="mono">{c.gap_end === null ? "—" : utc(c.gap_end)}</span>
        {#if x.near_end}<span class="muted">{placeText(x.near_end)}</span>{/if}
      </li>
    </ol>
  </section>

  <section class="panel ai">
    <div class="panel-head">
      <span class="label">AI analyst's verdict</span>
      {#if dossiers.length > 1}
        <span class="versions" role="group" aria-label="Analyses">
          {#each dossiers as d (d.id)}
            <button type="button" aria-pressed={d.id === dossier?.id} onclick={() => pickVersion(d.version)}>v{d.version}</button>
          {/each}
        </span>
      {/if}
    </div>
    <div class="panel-body">
      {#if dossier}
        <p class="verdict sev-text-{dossier.verdict}">{VERDICT_LABEL[dossier.verdict]}</p>
        <div class="confidence" title="How sure the AI analyst is">
          <span class="label">Confidence</span>
          <span class="meter" aria-hidden="true">
            {#each [1, 2, 3] as i (i)}<i class:on={i <= confidenceLevel[dossier.confidence]}></i>{/each}
          </span>
          <span>{CONFIDENCE_LABEL[dossier.confidence]}</span>
        </div>
        <p class="meaning muted">{VERDICT_HELP[dossier.verdict]}</p>
        <p class="explanation">“{dossier.explanation}”</p>
        <h3 class="label">What it based this on</h3>
        <ul class="evidence">
          {#each dossier.evidence as e, i (i)}
            <li>{e.claim} <a class="mono" href="#step-{e.step}" title="See this step of the AI's work">step {e.step}</a></li>
          {/each}
        </ul>
        <p class="small muted">
          {dossier.profile === "local" ? "Local model" : `Claude ${dossier.profile}`}{dossier.escalated ? " (asked after the local model was unsure)" : ""}
          · {ms(dossier.duration_ms)} · {usd(dossier.cost_usd)} · analysed {when(dossier.created_at)} UTC
        </p>
      {:else if c.discard_reason}
        <p class="verdict">Not analysed</p>
        <p class="meaning">Vigía ignored this silence because {DISCARD_LABEL[c.discard_reason]}.</p>
      {:else}
        <p class="verdict">Not analysed yet</p>
        {#if STATE_HELP[c.state]}<p class="meaning">{STATE_HELP[c.state]}</p>{/if}
        <p class="meaning muted">Meanwhile, the facts below are what the data already says.</p>
      {/if}

      <div class="actions">
        <select bind:value={profile} disabled={data.meta.mode !== "live" || queued !== null} aria-label="Model">
          {#each Object.entries(PROFILE_LABEL) as [value, label] (value)}
            <option {value} disabled={value !== "local" && !data.meta.paid_ready}>{label}</option>
          {/each}
        </select>
        <button type="button" class="primary" disabled={!canInvestigate || queued !== null} onclick={reinvestigate}>
          {dossiers.length === 0 ? "Ask the AI analyst" : "Ask again"}
        </button>
        {#if queued}<span>{queued}</span>{/if}
        {#if failure}<span class="danger">{failure}</span>{/if}
      </div>
      {#if blocked}<p class="small muted">{blocked}</p>{/if}
    </div>
  </section>
</div>

<section class="block">
  <h2 class="label">What the data says</h2>
  <dl class="facts">
    {#each facts as f (f.label)}
      <div class="fact {f.tone}">
        <dt class="label">{f.label}</dt>
        <dd class="value">{f.value}</dd>
        <dd class="note">{f.note}</dd>
      </div>
    {/each}
  </dl>
  <p class="small muted legend">
    <span class="tick notable"></span>points to the ship going quiet itself
    <span class="tick calm"></span>points to a reception problem
  </p>
</section>

{#if x.other_silences.length > 0}
  <section class="block">
    <h2 class="label">Other silences of this ship</h2>
    <ul class="others">
      {#each x.other_silences as o (o.id)}
        <li>
          <a href="/cases/{o.id}"><span class="mono">{when(o.gap_start)}</span> · {minutes(o.duration_min)}</a>
        </li>
      {/each}
      {#if x.other_silences_total > x.other_silences.length}
        <li class="muted">and {x.other_silences_total - x.other_silences.length} more</li>
      {/if}
    </ul>
  </section>
{/if}

{#if dossier}
  <details class="block work" bind:open={showWork}>
    <summary>
      <span class="label">How the AI reached this</span>
      <span class="muted small">{dossier.steps.length} steps · the tools it used and what each one showed</span>
    </summary>
    <ol class="trace">
      {#each dossier.steps as s (s.idx)}
        <li id="step-{s.idx}" class="step {s.kind}" class:cited={cited.has(s.idx)} class:targeted={targeted === s.idx}>
          <div class="step-head">
            <span class="idx mono">{s.idx}</span>
            <strong>{stepTitle(s)}</strong>
            {#if s.model}<span class="muted">{s.model}</span>{/if}
            <span class="meta mono">
              {#if s.kind === "model_call"}{tokens(s.input_tokens)} in · {tokens(s.output_tokens)} out · {usd(s.cost_usd)} ·{/if}
              {ms(s.duration_ms)}
            </span>
          </div>
          <p>{s.output_summary}</p>
          {#if s.kind !== "model_call" && s.kind !== "nudge"}
            <details>
              <summary>Input</summary>
              <pre>{prettyJson(s.input_json)}</pre>
            </details>
          {/if}
          {#if s.output_json !== null}
            <details>
              <summary>Output</summary>
              <pre>{prettyJson(s.output_json)}</pre>
            </details>
          {/if}
        </li>
      {/each}
    </ol>
    <p class="small muted">
      Analysis v{dossier.version} · {tokens(dossier.input_tokens)} tokens in, {tokens(dossier.output_tokens)} out · agent {dossier.agent_version}
    </p>
  </details>
{/if}

<style>
  .crumbs {
    display: flex;
    gap: 8px;
    margin-bottom: 14px;
  }

  .crumbs a {
    color: var(--text-2);
    text-decoration: none;
  }

  .head {
    display: flex;
    align-items: start;
    justify-content: space-between;
    gap: 16px;
  }

  .who {
    margin: 0;
    color: var(--text-2);
  }

  .ids {
    margin: 2px 0 0;
    font-size: 12px;
  }

  .headline {
    margin: 18px 0 20px;
    padding-left: 14px;
    border-left: 2px solid var(--accent);
    font-size: 18px;
    line-height: 1.45;
    max-width: 80ch;
  }

  .grid {
    display: grid;
    grid-template-columns: minmax(0, 3fr) minmax(300px, 2fr);
    gap: 16px;
    align-items: start;
  }

  @media (max-width: 900px) {
    .grid {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  .panel-head a {
    text-decoration: none;
    color: var(--accent);
  }

  .timeline {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    margin: 0;
    padding: 0;
    list-style: none;
    border-top: 1px solid var(--line);
  }

  .timeline li {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 10px 12px;
    font-size: 13px;
  }

  .timeline li + li {
    border-left: 1px solid var(--line);
  }

  .timeline .silent .mono {
    color: #ffc766;
  }

  .ai .verdict {
    margin: 0 0 8px;
    font-size: 20px;
    font-weight: 600;
  }

  .sev-text-likely_dark {
    color: #ff8a8b;
  }

  .sev-text-inconclusive {
    color: #ffc766;
  }

  .sev-text-coverage_gap {
    color: #a9c1e6;
  }

  .confidence {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 13px;
  }

  .meter {
    display: inline-flex;
    gap: 3px;
  }

  .meter i {
    width: 18px;
    height: 6px;
    background: var(--line-strong);
  }

  .meter i.on {
    background: var(--accent);
  }

  .meaning {
    margin: 10px 0;
  }

  .explanation {
    margin: 12px 0;
    padding: 10px 12px;
    background: var(--surface-2);
    border-left: 2px solid var(--line-strong);
    font-style: italic;
  }

  h3.label {
    margin: 14px 0 6px;
  }

  .evidence {
    margin: 0 0 12px;
    padding-left: 18px;
  }

  .evidence li {
    margin: 4px 0;
  }

  .evidence a {
    font-size: 11px;
    text-decoration: none;
    white-space: nowrap;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    margin-top: 16px;
    padding-top: 14px;
    border-top: 1px solid var(--line);
  }

  .small {
    font-size: 12px;
  }

  .versions {
    display: inline-flex;
    gap: 4px;
  }

  .versions button {
    padding: 0 8px;
    font-size: 11px;
  }

  .versions button[aria-pressed="true"] {
    border-color: var(--accent);
  }

  .block {
    margin-top: 28px;
  }

  .block > h2.label {
    margin-bottom: 10px;
  }

  .legend {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    margin: 8px 0 0;
  }

  .tick {
    display: inline-block;
    width: 3px;
    height: 12px;
    margin-left: 10px;
  }

  .tick.notable {
    background: var(--danger);
    margin-left: 0;
  }

  .tick.calm {
    background: var(--range);
  }

  .others {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 16px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .others a {
    text-decoration: none;
  }

  .work summary {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 10px;
    padding: 10px 12px;
    border: 1px solid var(--line);
    background: var(--surface);
    cursor: pointer;
  }

  .trace {
    list-style: none;
    padding: 0;
    margin: 12px 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .step {
    padding: 10px 12px;
    border: 1px solid var(--line);
    border-left: 3px solid var(--line-strong);
    background: var(--surface);
    scroll-margin-top: 64px;
  }

  .step p {
    margin: 6px 0 4px;
  }

  .step.tool_call {
    border-left-color: var(--accent);
  }

  .step.error {
    border-left-color: var(--danger);
  }

  .step.nudge {
    border-left-color: var(--warn);
  }

  .step.cited .idx {
    background: var(--accent);
    color: var(--bg);
  }

  .step.targeted {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent);
    animation: flash 1.2s ease-out;
  }

  @keyframes flash {
    from {
      background: color-mix(in srgb, var(--accent) 25%, var(--surface));
    }
  }

  .step-head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 8px;
  }

  .idx {
    display: inline-block;
    min-width: 22px;
    padding: 0 6px;
    background: var(--line);
    text-align: center;
    font-size: 11px;
  }

  .meta {
    margin-left: auto;
    font-size: 11px;
    color: var(--muted);
  }

  .step details summary {
    cursor: pointer;
    font-size: 12px;
    color: var(--muted);
  }

  pre {
    max-height: 320px;
    overflow: auto;
    margin: 6px 0 0;
    padding: 8px;
    background: var(--bg);
    font-family: var(--mono);
    font-size: 12px;
  }
</style>
