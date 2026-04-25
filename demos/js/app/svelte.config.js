import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import { frontendWorkspaceSvelteAliases } from "../../../js/frontend-workspace-aliases.js";

const rootDir = dirname(fileURLToPath(import.meta.url));
const demoWorkspaceAliasOptions = {
  configPath: resolve(rootDir, "../deno.json"),
  localImportPrefixes: ["@qlever-llc/", "@trellis-demo/", "#"],
};

const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({
      pages: "build",
      assets: "build",
      fallback: "index.html",
    }),
    alias: frontendWorkspaceSvelteAliases(demoWorkspaceAliasOptions),
  },
};

export default config;
