<script lang="ts">
  import { goto, invalidateAll } from "$app/navigation";
  import { page } from "$app/state";
  import { ApiError, api, type ProfileName, type TraceStep } from "#lib/api.ts";
  import {
    CONFIDENCE_LABEL,
    DISCARD_LABEL,
    minutes,
    ms,
    prettyJson,
    STATE_HELP,
    STATE_LABEL,
    tokens,
    usd,
    utc,
    VERDICT_LABEL,
  } from "#lib/format.ts";
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();
  const c = $derived(data.detail.candidate);
  const dossiers = $derived(data.detail.dossiers);

  // ?v=N picks a version; the newest by default.
  const wanted = $derived(Number(page.url.searchParams.get("v")));
  const dossier = $derived(dossiers.find((d) => d.version === wanted) ?? dossiers.at(-1) ?? null);
  const cited = $derived(new Set(dossier?.evidence.map((e) => e.step) ?? []));
  // The step an evidence link points at (scenario 5). From the URL rather than :target, so a
  // shared link to #step-N also lights up once the trace has rendered.
  const targeted = $derived(page.url.hash.startsWith("#step-") ? Number(page.url.hash.slice(6)) : null);

  function pickVersion(v: number) {
    const url = new URL(page.url.href);
    url.hash = "";
    if (v === dossiers.at(-1)?.version) url.searchParams.delete("v");
    else url.searchParams.set("v", String(v));
    void goto(url, { replace: true });
  }

  function stepTitle(s: TraceStep): string {
    if (s.kind === "model_call") return "Model call";
    if (s.kind === "nudge") return "Nudge";
    if (s.kind === "error") return s.tool === null ? "Error" : `${s.tool} (failed)`;
    return s.tool ?? "Tool call";
  }

  const canInvestigate = $derived(data.meta.mode === "live" && !["discarded", "detected"].includes(c.state));
  let profile = $state<ProfileName>("local");
  let queued = $state<string | null>(null);
  let failure = $state<string | null>(null);
  let before: { trigger_at: number | null; versions: number } | null = null;

  async function reinvestigate() {
    failure = null;
    try {
      const r = await api.reinvestigate(c.id, profile);
      before = { trigger_at: c.trigger_at, versions: dossiers.length };
      queued = r.position === 1 ? "Queued: next." : `Queued: ${r.position - 1} ahead.`;
    } catch (err) {
      failure = err instanceof ApiError ? err.message : String(err);
    }
  }

  // While a reinvestigation is queued, refresh until it has run (a new version, or a new attempt
  // that ended in a waiting state). The live stream (SSE) will replace this.
  $effect(() => {
    if (queued === null) return;
    const timer = setInterval(() => void invalidateAll(), 4000);
    return () => clearInterval(timer);
  });
  $effect(() => {
    if (before === null) return;
    const ran = dossiers.length > before.versions || (c.trigger_at !== before.trigger_at && c.state !== "investigating");
    if (ran) {
      queued = null;
      before = null;
    }
  });
</script>

<svelte:head><title>{c.name ?? c.mmsi} · Cases · Vigía</title></svelte:head>

<p><a href="/cases">← Cases</a></p>

<div class="case">
  <div>
    <h1>{c.name ?? "Unnamed vessel"}</h1>
    <p class="muted">
      MMSI {c.mmsi}
      {#if c.vessel.flag}· {c.vessel.flag}{/if}
      {#if c.vessel.type_label}· {c.vessel.type_label}{/if}
      · class {c.ais_class}
      {#if c.vessel.length_m}· {c.vessel.length_m} m{/if}
      {#if c.vessel.imo}· IMO {c.vessel.imo}{/if}
    </p>
  </div>
  <span class="badge state-{c.state}">{STATE_LABEL[c.state]}</span>
</div>

<section class="gap">
  <p>
    Silent from <strong>{utc(c.gap_start)}</strong>
    {#if c.gap_end !== null}
      to <strong>{utc(c.gap_end)}</strong> UTC ({minutes(c.duration_min)})
    {:else}
      UTC, and still silent
    {/if}
  </p>
  <p class="muted">
    Last seen at {c.start.lat.toFixed(4)} N, {c.start.lon.toFixed(4)} E
    {#if c.end}· back at {c.end.lat.toFixed(4)} N, {c.end.lon.toFixed(4)} E{/if}
    {#if data.meta.mode === "replay"}
      · <a href="/?at={c.gap_start - 15 * 60_000}&vessel={c.mmsi}">Show on the map</a>
    {:else}
      · <a href="/?vessel={c.mmsi}">Show on the map</a>
    {/if}
  </p>
  {#if c.discard_reason}
    <p>Discarded by the detector: {DISCARD_LABEL[c.discard_reason]}.</p>
  {:else if STATE_HELP[c.state]}
    <p class="help">{STATE_HELP[c.state]}</p>
  {/if}
</section>

{#if canInvestigate || data.meta.mode !== "live"}
  <section class="actions">
    <label>
      <span class="muted">Profile</span>
      <select bind:value={profile} disabled={!canInvestigate || queued !== null}>
        <option value="local">local</option>
        <option value="haiku">haiku</option>
        <option value="sonnet">sonnet</option>
      </select>
    </label>
    <button type="button" disabled={!canInvestigate || queued !== null} onclick={reinvestigate}>
      {dossiers.length === 0 ? "Investigate" : "Investigate again"}
    </button>
    {#if data.meta.mode !== "live"}<span class="muted">Read-only in {data.meta.mode} mode.</span>{/if}
    {#if queued}<span>{queued}</span>{/if}
    {#if failure}<span class="danger">{failure}</span>{/if}
  </section>
{/if}

{#if dossier === null}
  <p class="empty">No dossier yet.</p>
{:else}
  {#if dossiers.length > 1}
    <nav class="versions" aria-label="Versions">
      {#each dossiers as d (d.id)}
        <button type="button" aria-pressed={d.id === dossier.id} onclick={() => pickVersion(d.version)}>
          v{d.version} · {VERDICT_LABEL[d.verdict]} · {d.profile}
        </button>
      {/each}
    </nav>
  {/if}

  <section class="verdict">
    <h2>
      <span class="badge big verdict-{dossier.verdict}">{VERDICT_LABEL[dossier.verdict]}</span>
      <span class="muted">{CONFIDENCE_LABEL[dossier.confidence]} confidence</span>
    </h2>
    <p class="explanation">{dossier.explanation}</p>
    <dl>
      <div><dt>Model</dt><dd>{dossier.profile}{dossier.escalated ? ", escalated from local" : ""}</dd></div>
      <div><dt>Cost</dt><dd>{usd(dossier.cost_usd)}</dd></div>
      <div><dt>Tokens</dt><dd>{tokens(dossier.input_tokens)} in · {tokens(dossier.output_tokens)} out</dd></div>
      <div><dt>Took</dt><dd>{ms(dossier.duration_ms)}</dd></div>
      <div><dt>Version</dt><dd>v{dossier.version} · {utc(dossier.created_at)} · agent {dossier.agent_version}</dd></div>
    </dl>
  </section>

  <section>
    <h2>Evidence</h2>
    <ol class="evidence">
      {#each dossier.evidence as e, i (i)}
        <li><a href="#step-{e.step}">Step {e.step}</a> {e.claim}</li>
      {/each}
    </ol>
  </section>

  <section>
    <h2>Trace</h2>
    <ol class="trace">
      {#each dossier.steps as s (s.idx)}
        <li id="step-{s.idx}" class="step {s.kind}" class:cited={cited.has(s.idx)} class:targeted={targeted === s.idx}>
          <div class="step-head">
            <span class="idx">{s.idx}</span>
            <strong>{stepTitle(s)}</strong>
            {#if s.model}<span class="muted">{s.model}</span>{/if}
            <span class="meta">
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
  </section>
{/if}

<style>
  .case {
    display: flex;
    align-items: start;
    justify-content: space-between;
    gap: 12px;
  }

  .case h1 {
    margin: 0;
  }

  .case p {
    margin: 2px 0 0;
  }

  section {
    margin: 20px 0;
  }

  .gap p {
    margin: 4px 0;
  }

  .help {
    color: var(--warn);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: 10px;
  }

  .actions label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
  }

  .versions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .versions button[aria-pressed="true"] {
    border-color: var(--accent);
    color: var(--text);
  }

  .verdict {
    padding: 14px 16px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--panel);
  }

  .verdict h2 {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 0 0 8px;
  }

  .explanation {
    font-size: 15px;
    max-width: 70ch;
  }

  dl {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 24px;
    margin: 12px 0 0;
  }

  dt {
    font-size: 12px;
    color: var(--muted);
  }

  dd {
    margin: 0;
  }

  .evidence li {
    margin: 4px 0;
  }

  .trace {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .step {
    padding: 10px 12px;
    border: 1px solid var(--line);
    border-left: 3px solid var(--line);
    border-radius: 6px;
    background: var(--panel);
    scroll-margin-top: 16px;
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
    box-shadow: 0 0 0 2px var(--accent);
    animation: flash 1.2s ease-out;
  }

  @keyframes flash {
    from {
      background: color-mix(in srgb, var(--accent) 25%, var(--panel));
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
    border-radius: 10px;
    background: var(--line);
    text-align: center;
    font-size: 12px;
  }

  .meta {
    margin-left: auto;
    font-size: 12px;
    color: var(--muted);
  }

  details summary {
    cursor: pointer;
    font-size: 12px;
    color: var(--muted);
  }

  pre {
    max-height: 320px;
    overflow: auto;
    margin: 6px 0 0;
    padding: 8px;
    border-radius: 4px;
    background: var(--bg);
    font-size: 12px;
  }
</style>
