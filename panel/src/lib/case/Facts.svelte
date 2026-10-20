<script lang="ts">
  import type { Fact } from "../facts.ts";

  // The key facts of a silence, with the key to their marks. The case page and /label show them.

  let { facts }: { facts: Fact[] } = $props();
</script>

<dl class="facts">
  {#each facts as f (f.label)}
    <div class="fact {f.tone}">
      <dt class="label">{f.label}</dt>
      <dd class="value">{f.value}</dd>
      <dd class="note">{f.note}</dd>
    </div>
  {/each}
</dl>
<p class="key">
  <span class="tick notable"></span>points to the ship going quiet itself
  <span class="tick calm"></span>points to a reception problem
</p>

<style>
  .key {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    margin: 8px 0 0;
    font-size: 12px;
    color: var(--muted);
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
</style>
