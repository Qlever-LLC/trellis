import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import { frontendWorkspaceSvelteAliases } from "../../frontend-workspace-aliases.js";

const basePath = process.env.SITE_BASE_PATH ?? "";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({
      pages: "build",
      assets: "build",
      fallback: "index.html",
    }),
    paths: {
      base: basePath,
    },
    alias: frontendWorkspaceSvelteAliases(),
  },
};

export default config;
