<script lang="ts">
  import { goto } from "$app/navigation";
  import { candidatesQuery, type CandidateFilters, type CandidateState, type VerdictValue } from "#lib/api.ts";
  import { CONFIDENCE_LABEL, DISCARD_LABEL, minutes, STATE_LABEL, usd, utc, VERDICT_LABEL } from "#lib/format.ts";
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();
  const list = $derived(data.list);
  const filters = $derived(data.filters);

  // "" is "all cases": every state except the gaps the detector discarded.
  const STATE_OPTIONS: CandidateState[] = [
    "investigated",
    "pending",
    "investigating",
    "pending_no_model",
    "pending_budget",
    "error",
    "discarded",
  ];

  function apply(change: Partial<CandidateFilters>) {
    void goto(`/cases${candidatesQuery({ ...filters, page: 1, ...change })}`);
  }

  const first = $derived((list.page - 1) * list.page_size + 1);
  const last = $derived(first + list.items.length - 1);
  const pages = $derived(Math.max(1, Math.ceil(list.total / list.page_size)));
</script>

<svelte:head><title>Cases · Vigía</title></svelte:head>

<h1>Cases</h1>

<form class="filters" onsubmit={(e) => e.preventDefault()}>
  <label>
    Verdict
    <select
      value={filters.verdict ?? ""}
      onchange={(e) => apply({ verdict: (e.currentTarget.value || undefined) as VerdictValue | undefined })}
    >
      <option value="">Any</option>
      {#each Object.entries(VERDICT_LABEL) as [value, label] (value)}
        <option {value}>{label}</option>
      {/each}
    </select>
  </label>
  <label>
    State
    <select
      value={filters.state?.join(",") ?? ""}
      onchange={(e) => {
        const v = e.currentTarget.value;
        apply({ state: v === "" ? undefined : (v.split(",") as CandidateState[]) });
      }}
    >
      <option value="">All cases</option>
      {#each STATE_OPTIONS as s (s)}
        <option value={s}>{STATE_LABEL[s]}</option>
      {/each}
    </select>
  </label>
  <label>
    From
    <input type="date" value={filters.from ?? ""} onchange={(e) => apply({ from: e.currentTarget.value || undefined })} />
  </label>
  <label>
    To
    <input type="date" value={filters.to ?? ""} onchange={(e) => apply({ to: e.currentTarget.value || undefined })} />
  </label>
  {#if filters.verdict || filters.state || filters.from || filters.to}
    <button type="button" class="link" onclick={() => goto("/cases")}>Clear</button>
  {/if}
</form>

{#if list.items.length === 0}
  <p class="empty">No cases match these filters.</p>
{:else}
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>Silent from (UTC)</th>
          <th>Vessel</th>
          <th>Class</th>
          <th class="num">Gap</th>
          <th>State</th>
          <th>Verdict</th>
          <th>Model</th>
          <th class="num">Cost</th>
        </tr>
      </thead>
      <tbody>
        {#each list.items as c (c.id)}
          <tr>
            <td><a href="/cases/{c.id}">{utc(c.gap_start)}</a></td>
            <td>
              <a href="/cases/{c.id}">{c.name ?? "Unnamed"}</a>
              <span class="muted">{c.mmsi}</span>
            </td>
            <td>{c.ais_class}</td>
            <td class="num">{minutes(c.duration_min)}</td>
            <td>
              <span class="badge state-{c.state}">{STATE_LABEL[c.state]}</span>
              {#if c.discard_reason}<span class="muted">{DISCARD_LABEL[c.discard_reason]}</span>{/if}
            </td>
            <td>
              {#if c.dossier}
                <span class="badge verdict-{c.dossier.verdict}">{VERDICT_LABEL[c.dossier.verdict]}</span>
                <span class="muted">{CONFIDENCE_LABEL[c.dossier.confidence]}</span>
              {:else}
                <span class="muted">—</span>
              {/if}
            </td>
            <td>
              {#if c.dossier}
                {c.dossier.profile}{#if c.dossier.escalated}{" "}<span class="muted">escalated</span>{/if}
                {#if c.dossier.version > 1}<span class="muted"> v{c.dossier.version}</span>{/if}
              {/if}
            </td>
            <td class="num">{c.dossier ? usd(c.dossier.cost_usd) : ""}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  <nav class="pager" aria-label="Pages">
    <span class="muted">{first}–{last} of {list.total}</span>
    <button type="button" disabled={list.page <= 1} onclick={() => apply({ page: list.page - 1 })}>Previous</button>
    <button type="button" disabled={list.page >= pages} onclick={() => apply({ page: list.page + 1 })}>Next</button>
  </nav>
{/if}

<style>
  .filters {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: 12px;
    margin-bottom: 16px;
  }

  .filters label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
    color: var(--muted);
  }

  .table-wrap {
    overflow-x: auto;
  }

  .pager {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 12px;
  }

  .pager span {
    margin-right: auto;
  }
</style>
