import adapter from "@sveltejs/adapter-static";
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

// SvelteKit 3 takes its config here (svelte.config.js is gone). A static SPA: the Bun server
// serves panel/build and answers unknown paths with index.html.
export default defineConfig({
  plugins: [sveltekit({ adapter: adapter({ fallback: "index.html" }) })],
  server: { proxy: { "/api": "http://localhost:4250" } },
});
