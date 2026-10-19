<script lang="ts">
  import { page } from "$app/state";
  import type { Snippet } from "svelte";
  import "../app.css";

  let { children }: { children: Snippet } = $props();

  const nav = [
    { href: "/", label: "Map" },
    { href: "/cases", label: "Cases" },
    { href: "/label", label: "Label" },
    { href: "/eval", label: "Eval" },
    { href: "/briefs", label: "Briefs" },
    { href: "/health", label: "Health" },
  ];

  const active = (href: string) =>
    href === "/" ? page.url.pathname === "/" : page.url.pathname.startsWith(href);
</script>

<header>
  <a class="brand" href="/">VIGÍA <span>Gulf of Finland</span></a>
  <nav>
    {#each nav as item (item.href)}
      <a href={item.href} aria-current={active(item.href) ? "page" : undefined}>{item.label}</a>
    {/each}
  </nav>
</header>

<main>
  {@render children()}
</main>

<footer>
  Educational project, no warranty · AIS: Fintraffic / digitraffic.fi, CC BY 4.0
</footer>
