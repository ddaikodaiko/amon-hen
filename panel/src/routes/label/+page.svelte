<script lang="ts">
  import { invalidateAll } from "$app/navigation";
  import { ApiError, api, type LabelSaved, type LabelValue } from "#lib/api.ts";
  import Facts from "#lib/case/Facts.svelte";
  import Timeline from "#lib/case/Timeline.svelte";
  import { factsOf } from "#lib/facts.ts";
  import { CONFIDENCE_LABEL, LABEL_LABEL, placeText, VERDICT_LABEL, VERDICT_TONE, vesselLine } from "#lib/format.ts";
  import GapMap from "#lib/map/GapMap.svelte";
  import type { PageProps } from "./$types";

  // Blind labelling (FR-018): the next case in the order the gaps started, never a chosen one.
  // The agent's verdict only comes back with the saved label.

  let { data }: PageProps = $props();
  const c = $derived(data.next.case);
  const writable = $derived(data.meta.mode === "live");

  const KEYS: Record<string, LabelValue> = { "1": "coverage_gap", "2": "likely_dark", "3": "undeterminable" };
  const CHOICES: { key: string; value: LabelValue; help: string }[] = [
    { key: "1", value: "coverage_gap", help: "The receivers did not hear it: the vessel was transmitting" },
    { key: "2", value: "likely_dark", help: "The transponder was most likely off" },
    { key: "3", value: "undeterminable", help: "There is not enough to tell" },
  ];

  let note = $state("");
  let saving = $state(false);
  let saved = $state<LabelSaved | null>(null);
  let failure = $state<string | null>(null);
  const progress = $derived(saved?.progress ?? data.next.progress);
  // How far the sample is from what the eval needs (FR-021).
  const target = $derived(progress.labeled + (progress.stopping.met ? 0 : progress.stopping.missing_cases));
  const done = $derived(target === 0 ? 0 : Math.min(1, progress.labeled / target));
  const facts = $derived(c === null ? [] : factsOf(c, c.context));
  const LABEL_TONE: Record<LabelValue, string> = { coverage_gap: "range", likely_dark: "dark", undeterminable: "unclear" };

  async function save(value: LabelValue) {
    if (c === null || saving || saved !== null || !writable) return;
    saving = true;
    failure = null;
    try {
      saved = await api.label(c.id, value, note);
    } catch (err) {
      failure = err instanceof ApiError ? err.message : String(err);
    } finally {
      saving = false;
    }
  }

  async function nextCase() {
    await invalidateAll();
    saved = null;
    note = "";
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const field = e.target instanceof HTMLElement ? e.target.closest<HTMLElement>("textarea, input, select") : null;
    if (field !== null) {
      if (e.key === "Escape") field.blur();
      return;
    }
    if (saved !== null) {
      if (e.key === "Enter" || e.key === "n") {
        e.preventDefault();
        void nextCase();
      }
      return;
    }
    const value = KEYS[e.key];
    if (value !== undefined) {
      e.preventDefault();
      void save(value);
    }
  }

  const dark = (v: string) => v === "likely_dark";
</script>

<svelte:head><title>Label · Vigía</title></svelte:head>
<svelte:window {onkeydown} />

<header class="head">
  <div>
    <h1>Label</h1>
    <p class="lede">
      Decide what each silence was before you see the AI's answer. Your labels are the ground truth that measures how often the AI
      analyst is right. Cases come in the order they happened, never picked.
    </p>
  </div>
  <section class="panel progress" aria-label="Progress">
    <div class="panel-head">
      <span class="label">Sample for the accuracy test</span>
      <span class="mono">{progress.stopping.met ? progress.labeled : `${progress.labeled} / ${target}`}</span>
    </div>
    <div class="panel-body">
      <div class="bar" class:met={progress.stopping.met}><i style="width: {Math.round(done * 100)}%"></i></div>
      <p class:ok={progress.stopping.met}>
        {#if progress.stopping.status === "enough"}
          Enough cases to measure the AI.
        {:else if progress.stopping.status === "rare_positives"}
          300 cases reached: enough, though suspicious ones are rare.
        {:else}
          {progress.stopping.missing_cases} more cases, of which {progress.stopping.missing_positives} more suspicious, to measure the AI.
        {/if}
      </p>
      <p class="muted small mono">
        {progress.positives} suspicious · {progress.undeterminable} can't tell · {progress.remaining} waiting
      </p>
    </div>
  </section>
</header>

{#if !writable}
  <p class="notice">This is a {data.meta.mode === "replay" ? "recorded demo" : "public view"}, so it is read-only: labels are saved only by a live Vigía, into its own database.</p>
{/if}

{#if c === null}
  <p class="empty">Every case is labelled. New ones come as the detector finds them.</p>
{:else}
  <div class="who">
    <h2>{c.vessel.name ?? "Unnamed ship"}</h2>
    <p class="muted">{vesselLine(c.vessel)} · went silent {placeText(c.context.near_start)}</p>
    <p class="muted small mono">
      {[
        `MMSI ${c.mmsi}`,
        `class ${c.vessel.ais_class}`,
        c.vessel.length_m && `${c.vessel.length_m} m`,
        c.vessel.destination && `bound for ${c.vessel.destination}`,
      ]
        .filter(Boolean)
        .join(" · ")}
    </p>
  </div>

  <div class="grid">
    <section class="panel">
      <div class="panel-head"><span class="label">Track</span></div>
      <GapMap gap={c} height={360} />
      <Timeline {...c} near_end={c.context.near_end} still="6 h or more, not back yet" />
    </section>

    <section class="panel call">
      {#if saved === null}
        <div class="panel-head"><span class="label">Your call: what was it?</span></div>
        <div class="panel-body">
          <div class="choices">
            {#each CHOICES as choice (choice.value)}
              <button type="button" class="sev-{LABEL_TONE[choice.value]}" disabled={!writable || saving} onclick={() => save(choice.value)}>
                <kbd>{choice.key}</kbd>
                <span>
                  <strong>{LABEL_LABEL[choice.value]}</strong>
                  <small>{choice.help}</small>
                </span>
              </button>
            {/each}
          </div>
          <label class="note">
            <span class="label">Note (optional)</span>
            <textarea bind:value={note} rows="3" maxlength="500" disabled={!writable}></textarea>
          </label>
          <p class="muted small">Keys 1, 2 and 3 save; Esc leaves the note. The AI's answer shows once your label is saved.</p>
          {#if failure}<p class="danger">{failure}</p>{/if}
        </div>
      {:else}
        <div class="panel-head"><span class="label">Saved</span></div>
        <div class="panel-body reveal">
          <div class="side-by-side">
            <div>
              <span class="label">You</span>
              <span class="pill big sev-{LABEL_TONE[saved.label.value]}">{LABEL_LABEL[saved.label.value]}</span>
            </div>
            <div>
              <span class="label">AI analyst</span>
              {#if saved.dossier}
                <span class="pill big sev-{VERDICT_TONE[saved.dossier.verdict]}">{VERDICT_LABEL[saved.dossier.verdict]}</span>
                <span class="muted small">{CONFIDENCE_LABEL[saved.dossier.confidence]} confidence · {saved.dossier.profile} · v{saved.dossier.version}</span>
              {:else}
                <span class="muted">Not investigated yet</span>
              {/if}
            </div>
          </div>
          {#if saved.dossier && saved.label.value !== "undeterminable"}
            {@const agree = dark(saved.label.value) === dark(saved.dossier.verdict)}
            <p class="agree" class:ok={agree} class:off={!agree}>
              {agree ? "You agree on whether it went dark." : "You disagree on whether it went dark."}
            </p>
          {/if}
          {#if saved.dossier}<blockquote>{saved.dossier.explanation}</blockquote>{/if}
          <div class="actions">
            <button type="button" class="primary" onclick={nextCase}>Next case <kbd>Enter</kbd></button>
            <a href="/cases/{saved.label.candidate_id}">Open the full case →</a>
          </div>
        </div>
      {/if}
    </section>
  </div>

  <section class="block">
    <h2 class="label">What the data says</h2>
    <Facts {facts} />
  </section>
{/if}

<style>
  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px 32px;
    margin-bottom: 20px;
  }

  .head .lede {
    margin: 0;
  }

  .progress {
    width: 340px;
    font-size: 13px;
  }

  .progress p {
    margin: 8px 0 0;
  }

  .bar {
    height: 6px;
    background: var(--surface-2);
    border: 1px solid var(--line);
  }

  .bar i {
    display: block;
    height: 100%;
    background: var(--accent);
  }

  .bar.met i {
    background: var(--ok);
  }

  .notice {
    color: #ffc766;
  }

  .who h2 {
    margin: 0;
    font-size: 20px;
  }

  .who p {
    margin: 2px 0;
  }

  .grid {
    display: grid;
    grid-template-columns: minmax(0, 3fr) minmax(300px, 2fr);
    gap: 16px;
    align-items: start;
    margin-top: 12px;
  }

  @media (max-width: 900px) {
    .grid {
      grid-template-columns: minmax(0, 1fr);
    }

    .progress {
      width: 100%;
    }
  }

  .call {
    position: sticky;
    top: 64px;
  }

  .choices {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .choices button {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 10px 12px;
    text-align: left;
    background: var(--surface-2);
    border-color: var(--line-strong);
    color: var(--text);
  }

  .choices button:not(:disabled):hover {
    border-color: currentColor;
  }

  .choices button strong {
    color: inherit;
  }

  .choices button.sev-dark strong {
    color: #ff8a8b;
  }

  .choices button.sev-range strong {
    color: #a9c1e6;
  }

  .choices button.sev-unclear strong {
    color: #ffc766;
  }

  .choices span {
    display: flex;
    flex-direction: column;
  }

  .choices small {
    color: var(--text-2);
  }

  kbd {
    display: inline-block;
    min-width: 20px;
    padding: 0 5px;
    border: 1px solid var(--line-strong);
    border-radius: 3px;
    font: 12px/18px var(--mono);
    text-align: center;
    color: var(--muted);
  }

  .note {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 12px 0 8px;
  }

  textarea {
    resize: vertical;
  }

  .small {
    font-size: 12px;
  }

  .side-by-side {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }

  .side-by-side > div {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
  }

  .agree {
    margin: 12px 0 0;
    padding: 6px 10px;
    border: 1px solid;
    font-weight: 600;
  }

  .agree.ok {
    color: #7fe0ad;
    border-color: color-mix(in srgb, var(--ok) 45%, transparent);
    background: color-mix(in srgb, var(--ok) 10%, transparent);
  }

  .agree.off {
    color: #ffc766;
    border-color: color-mix(in srgb, var(--warn) 50%, transparent);
    background: color-mix(in srgb, var(--warn) 12%, transparent);
  }

  blockquote {
    margin: 12px 0 0;
    padding: 6px 12px;
    border-left: 3px solid var(--line-strong);
    color: var(--text-2);
  }

  .actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-top: 16px;
  }

  .actions a {
    text-decoration: none;
  }

  .ok {
    color: #7fe0ad;
  }

  .block {
    margin-top: 28px;
  }

  .block > h2.label {
    margin-bottom: 10px;
  }
</style>
