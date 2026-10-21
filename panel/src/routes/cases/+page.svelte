<script lang="ts">
  import { goto } from "$app/navigation";
  import { candidatesQuery, type CandidateFilters } from "#lib/api.ts";
  import { ago, alertStatus, minutes, placeText, vesselLine, when } from "#lib/format.ts";
  import { _PRESETS } from "./+page.ts";
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();
  const list = $derived(data.list);
  const filters = $derived(data.filters);

  function apply(change: Partial<CandidateFilters>) {
    void goto(`/cases${candidatesQuery({ ...filters, page: 1, ...change })}`);
  }

  const same = (a: CandidateFilters["state"], b: CandidateFilters["state"]) => (a ?? []).join() === (b ?? []).join();
  const preset = $derived(_PRESETS.find((p) => p.filters.verdict === filters.verdict && same(p.filters.state, filters.state))?.key ?? null);

  const first = $derived((list.page - 1) * list.page_size + 1);
  const last = $derived(first + list.items.length - 1);
  const pages = $derived(Math.max(1, Math.ceil(list.total / list.page_size)));
  const now = Date.now();
</script>

<svelte:head><title>Alerts · Amon Hen</title></svelte:head>

<h1>Alerts</h1>
<p class="lede">
  Each alert is a ship that stopped transmitting its position for 30 minutes or more (an hour for small craft). An AI
  analyst then checks why: either the shore receivers simply could not hear it, or the ship probably switched its
  transponder off.
</p>

<div class="toolbar">
  <div class="presets" role="group" aria-label="Show">
    {#each _PRESETS as p (p.key)}
      <button
        type="button"
        class="preset {p.key}"
        aria-pressed={preset === p.key}
        onclick={() => apply({ verdict: p.filters.verdict, state: p.filters.state })}
      >
        {p.label} <span class="mono count">{data.counts[p.key]}</span>
      </button>
    {/each}
  </div>
  <div class="dates">
    <label class="label">
      From <input type="date" value={filters.from ?? ""} onchange={(e) => apply({ from: e.currentTarget.value || undefined })} />
    </label>
    <label class="label">
      To <input type="date" value={filters.to ?? ""} onchange={(e) => apply({ to: e.currentTarget.value || undefined })} />
    </label>
    {#if filters.from || filters.to}
      <button type="button" class="link" onclick={() => apply({ from: undefined, to: undefined })}>Any date</button>
    {/if}
  </div>
</div>

{#if list.items.length === 0}
  <p class="empty">No alerts here.</p>
{:else}
  <div class="panel table-wrap">
    <table>
      <thead>
        <tr>
          <th>Status</th>
          <th>Ship</th>
          <th>Where it went silent</th>
          <th>When (UTC)</th>
          <th class="num">Silent for</th>
        </tr>
      </thead>
      <tbody>
        {#each list.items as c (c.id)}
          {@const s = alertStatus(c)}
          <tr onclick={() => goto(`/cases/${c.id}`)}>
            <td><span class="pill sev-{s.tone}">{s.text}</span></td>
            <td>
              <a href="/cases/{c.id}" class="name">{c.name ?? "Unnamed ship"}</a>
              <div class="sub">{vesselLine(c)}</div>
            </td>
            <td class="where">{placeText(c.near)}</td>
            <td>
              <span class="mono">{when(c.gap_start)}</span>
              <div class="sub">{ago(c.gap_start, now)}</div>
            </td>
            <td class="num" class:open={c.gap_end === null}>{minutes(c.duration_min)}</td>
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
  .toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 14px;
  }

  .presets {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .preset {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 12.5px;
  }

  .preset[aria-pressed="true"] {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 12%, var(--surface));
  }

  .count {
    color: var(--muted);
  }

  .preset.dark .count {
    color: #ff8a8b;
  }

  .dates {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: 10px;
  }

  .dates label {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .table-wrap {
    overflow-x: auto;
  }

  tbody tr {
    cursor: pointer;
  }

  .name {
    color: var(--text);
    font-weight: 600;
  }

  .sub {
    font-size: 12px;
    color: var(--muted);
  }

  .where {
    color: var(--text-2);
  }

  .open {
    color: #ffc766;
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
