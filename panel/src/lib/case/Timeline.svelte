<script lang="ts">
  import type { Near } from "../api.ts";
  import { ago, minutes, placeText, utc } from "../format.ts";

  // Last message, how long it was silent, and when and where it came back.

  let {
    gap_start,
    gap_end,
    duration_min,
    near_end = null,
    still = null,
  }: {
    gap_start: number;
    gap_end: number | null;
    duration_min: number | null;
    near_end?: Near | null;
    /** What to say while it is still silent; by default, how long ago it went quiet. */
    still?: string | null;
  } = $props();
</script>

<ol class="timeline">
  <li>
    <span class="label">Last message</span>
    <span class="mono">{utc(gap_start)}</span>
  </li>
  <li class="silent">
    <span class="label">Silent for</span>
    <span class="mono">{gap_end === null ? (still ?? `${ago(gap_start)}, ongoing`) : minutes(duration_min)}</span>
  </li>
  <li>
    <span class="label">Back on air</span>
    <span class="mono">{gap_end === null ? "—" : utc(gap_end)}</span>
    {#if near_end}<span class="muted">{placeText(near_end)}</span>{/if}
  </li>
</ol>

<style>
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
</style>
