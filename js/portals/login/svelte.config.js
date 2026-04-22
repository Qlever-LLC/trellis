import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import { frontendWorkspaceSvelteAliases } from "../../frontend-workspace-aliases.js";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    appDir: "_trellis/assets",
    adapter: adapter({
      pages: "build",
      assets: "build",
      fallback: "200.html",
    }),
    alias: frontendWorkspaceSvelteAliases(),
  },
};

export default config;
