<script lang="ts">
  import { invalidateAll } from "$app/navigation";
  import { ApiError, api, type LabelSaved, type LabelValue } from "#lib/api.ts";
  import { CONFIDENCE_LABEL, LABEL_LABEL, minutes, NAV_STATUS, utc, VERDICT_LABEL } from "#lib/format.ts";
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

<div class="top">
  <h1>Label</h1>
  <div class="progress">
    <span>
      {progress.labeled} labelled · {progress.positives} likely dark · {progress.undeterminable} undeterminable ·
      {progress.remaining} to go
    </span>
    <span class:ok={progress.stopping.met} class:warn={!progress.stopping.met}>
      {#if progress.stopping.status === "enough"}
        The sample is enough for the eval.
      {:else if progress.stopping.status === "rare_positives"}
        300 cases reached: enough, with likely dark rare.
      {:else}
        For the eval: {progress.stopping.missing_cases} more cases and {progress.stopping.missing_positives} more likely dark.
      {/if}
    </span>
  </div>
</div>

{#if !writable}
  <p class="warn">This is a {data.meta.mode === "replay" ? "recorded demo" : "public view"}, so it is read-only: labels are saved only by a live Vigía, into its own database.</p>
{/if}

{#if c === null}
  <p class="empty">Every case is labelled. New ones come as the detector finds them.</p>
{:else}
  <div class="layout">
    <section>
      <h2>{c.vessel.name ?? "Unnamed vessel"}</h2>
      <p class="muted">
        {[
          `MMSI ${c.mmsi}`,
          c.vessel.flag,
          c.vessel.type_label,
          `class ${c.vessel.ais_class}`,
          c.vessel.length_m && `${c.vessel.length_m} m`,
          c.vessel.destination && `to ${c.vessel.destination}`,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      <p>
        Silent from <strong>{utc(c.gap_start)}</strong>
        {#if c.gap_end !== null}
          to <strong>{utc(c.gap_end)}</strong> UTC ({minutes(c.duration_min)})
        {:else}
          UTC, and silent 6 h later
        {/if}
      </p>
      {#if c.nav_status_start !== null}
        <p class="muted">Navigation status when it went silent: {NAV_STATUS[c.nav_status_start] ?? `code ${c.nav_status_start}`}</p>
      {/if}
      <GapMap gap={c} />
    </section>

    <section class="side">
      {#if saved === null}
        <h2>What was it?</h2>
        <div class="choices">
          {#each CHOICES as choice (choice.value)}
            <button type="button" disabled={!writable || saving} onclick={() => save(choice.value)}>
              <kbd>{choice.key}</kbd>
              <span>
                <strong>{LABEL_LABEL[choice.value]}</strong>
                <small class="muted">{choice.help}</small>
              </span>
            </button>
          {/each}
        </div>
        <label class="note">
          <span class="muted">Note (optional)</span>
          <textarea bind:value={note} rows="3" maxlength="500" disabled={!writable}></textarea>
        </label>
        <p class="muted hint">Keys 1, 2, 3 save. Esc leaves the note. The agent's verdict shows once the label is saved.</p>
        {#if failure}<p class="danger">{failure}</p>{/if}
      {:else}
        <h2>Saved</h2>
        <p>You: <span class="badge big verdict-{saved.label.value}">{LABEL_LABEL[saved.label.value]}</span></p>
        {#if saved.dossier}
          <p>
            Agent: <span class="badge big verdict-{saved.dossier.verdict}">{VERDICT_LABEL[saved.dossier.verdict]}</span>
            <span class="muted">{CONFIDENCE_LABEL[saved.dossier.confidence]} confidence · {saved.dossier.profile} · v{saved.dossier.version}</span>
          </p>
          {#if saved.label.value !== "undeterminable"}
            <p class:ok={dark(saved.label.value) === dark(saved.dossier.verdict)} class:warn={dark(saved.label.value) !== dark(saved.dossier.verdict)}>
              {dark(saved.label.value) === dark(saved.dossier.verdict) ? "You agree on whether it went dark." : "You disagree on whether it went dark."}
            </p>
          {/if}
          <blockquote>{saved.dossier.explanation}</blockquote>
        {:else}
          <p class="muted">The agent has not investigated this case yet.</p>
        {/if}
        <p><a href="/cases/{saved.label.candidate_id}">Open the case</a></p>
        <button type="button" class="primary" onclick={nextCase}>Next case <kbd>Enter</kbd></button>
      {/if}
    </section>
  </div>
{/if}

<style>
  .top {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px 24px;
  }

  .progress {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    font-size: 13px;
  }

  .layout {
    display: grid;
    grid-template-columns: minmax(0, 2fr) minmax(260px, 1fr);
    gap: 24px;
  }

  @media (max-width: 800px) {
    .layout {
      grid-template-columns: minmax(0, 1fr);
    }

    .progress {
      align-items: flex-start;
    }
  }

  section p {
    margin: 4px 0;
  }

  .side {
    display: flex;
    flex-direction: column;
    gap: 8px;
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
    padding: 8px 10px;
    text-align: left;
  }

  .choices button:not(:disabled):hover {
    border-color: var(--accent);
  }

  .choices span {
    display: flex;
    flex-direction: column;
  }

  kbd {
    display: inline-block;
    min-width: 20px;
    padding: 0 5px;
    border: 1px solid var(--line);
    border-radius: 4px;
    font: 12px/18px ui-monospace, monospace;
    text-align: center;
    color: var(--muted);
  }

  .note {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  textarea {
    font: inherit;
    color: var(--text);
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 6px 8px;
    resize: vertical;
  }

  .hint {
    font-size: 12px;
  }

  blockquote {
    margin: 4px 0;
    padding: 6px 12px;
    border-left: 3px solid var(--line);
    color: var(--text);
  }

  .primary {
    align-self: flex-start;
    border-color: var(--accent);
  }

  .ok {
    color: var(--ok);
  }

  .warn {
    color: var(--warn);
  }
</style>
