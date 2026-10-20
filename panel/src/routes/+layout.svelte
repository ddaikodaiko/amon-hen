<script lang="ts">
  import { page } from "$app/state";
  import type { Snippet } from "svelte";
  import { onMount } from "svelte";
  import { api, type Meta } from "#lib/api.ts";
  import "../app.css";

  let { children }: { children: Snippet } = $props();

  const nav = [
    { href: "/", label: "Map" },
    { href: "/cases", label: "Alerts" },
    { href: "/briefs", label: "Daily brief" },
    { href: "/label", label: "Label" },
    { href: "/eval", label: "Accuracy" },
    { href: "/health", label: "Feed health" },
  ];

  const active = (href: string) => (href === "/" ? page.url.pathname === "/" : page.url.pathname.startsWith(href));

  // The system's state on the right of the bar: refreshed every 30 s, the clock every second.
  let meta = $state.raw<Meta | null>(null);
  let now = $state(Date.now());
  onMount(() => {
    const load = () =>
      api
        .meta()
        .then((m) => (meta = m))
        .catch(() => {});
    void load();
    const metaTimer = setInterval(load, 30_000);
    const clock = setInterval(() => (now = Date.now()), 1000);
    return () => {
      clearInterval(metaTimer);
      clearInterval(clock);
    };
  });

  const ai = $derived.by(() => {
    if (meta === null || meta.mode !== "live") return null;
    if (meta.model.available === true) return { tone: "ok", text: "AI analyst online" };
    if (meta.model.available === false) return { tone: "off", text: "AI analyst offline" };
    return { tone: "idle", text: "AI analyst: checking" };
  });
  const clock = $derived(new Date(now).toISOString().slice(11, 19));
</script>

<header class="bar">
  <a class="brand" href="/" aria-label="Vigía, home">
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
      <path d="M10 1 19 10 10 19 1 10Z" fill="none" stroke="currentColor" stroke-width="1.6" />
      <circle cx="10" cy="10" r="2.6" fill="currentColor" />
    </svg>
    <span class="word">VIGÍA</span>
    <span class="sub">Gulf of Finland · maritime watch</span>
  </a>
  <nav>
    {#each nav as item (item.href)}
      <a href={item.href} aria-current={active(item.href) ? "page" : undefined}>{item.label}</a>
    {/each}
  </nav>
  <div class="status">
    {#if meta}
      {#if meta.mode === "live"}
        <span class="chip ok" title="Ship positions arrive as they are broadcast">Live</span>
      {:else if meta.mode === "replay"}
        <span class="chip accent" title="A recorded day, replayed">Replay</span>
      {:else}
        <span class="chip" title="Read-only view">Public</span>
      {/if}
      {#if ai}
        <span class="chip {ai.tone}" title={meta.model.reason ?? "The model that investigates each alert"}>{ai.text}</span>
      {/if}
    {/if}
    <span class="clock mono" title="All times are UTC">{clock} UTC</span>
  </div>
</header>

<main class:full={page.url.pathname === "/"}>
  {@render children()}
</main>

<footer>
  <span>Educational project, no warranty. Vigía looks at ships, never at people.</span>
  <span>AIS: Fintraffic / digitraffic.fi, CC BY 4.0 · Map data © OpenStreetMap contributors, ODbL</span>
</footer>

<style>
  .bar {
    position: sticky;
    top: 0;
    z-index: 10;
    display: flex;
    align-items: center;
    gap: 8px 28px;
    min-height: 48px;
    padding: 0 20px;
    border-bottom: 1px solid var(--line);
    background: color-mix(in srgb, var(--surface) 96%, transparent);
    backdrop-filter: blur(6px);
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
    color: var(--text);
    text-decoration: none;
    white-space: nowrap;
  }

  .brand svg {
    color: var(--accent);
  }

  .word {
    font-weight: 700;
    letter-spacing: 0.22em;
    font-size: 13px;
  }

  .sub {
    padding-left: 10px;
    border-left: 1px solid var(--line-strong);
    font-size: 10.5px;
    letter-spacing: 0.09em;
    text-transform: uppercase;
    color: var(--muted);
  }

  nav {
    display: flex;
    align-self: stretch;
    gap: 2px;
    overflow-x: auto;
    scrollbar-width: none;
  }

  nav a {
    display: flex;
    align-items: center;
    padding: 0 12px;
    border-bottom: 2px solid transparent;
    color: var(--muted);
    font-size: 11.5px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    text-decoration: none;
    white-space: nowrap;
  }

  nav a:hover {
    color: var(--text);
  }

  nav a[aria-current="page"] {
    color: var(--text);
    border-bottom-color: var(--accent);
  }

  .status {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-left: auto;
    white-space: nowrap;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 2px 8px;
    border: 1px solid var(--line-strong);
    border-radius: 2px;
    font-size: 10.5px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-2);
  }

  .chip::before {
    content: "";
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--muted);
  }

  .chip.ok::before {
    background: var(--ok);
    box-shadow: 0 0 6px var(--ok);
  }

  .chip.accent::before {
    background: var(--accent);
  }

  .chip.off {
    color: #ffc766;
  }

  .chip.off::before {
    background: var(--warn);
  }

  .clock {
    color: var(--text-2);
    font-size: 12px;
  }

  footer {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 4px 16px;
    padding: 8px 20px;
    border-top: 1px solid var(--line);
    color: var(--muted);
    font-size: 11.5px;
  }

  @media (max-width: 900px) {
    .bar {
      flex-wrap: wrap;
      padding: 8px 16px 0;
    }

    .sub {
      display: none;
    }

    nav {
      order: 3;
      width: 100%;
      min-height: 38px;
    }
  }
</style>
