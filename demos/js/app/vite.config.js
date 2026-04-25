import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { frontendWorkspaceAliases } from "../../../js/frontend-workspace-aliases.js";

const rootDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(rootDir, "../../..");
const demoWorkspaceAliasOptions = {
  configPath: resolve(rootDir, "../deno.json"),
  localImportPrefixes: ["@qlever-llc/", "@trellis-demo/", "#"],
};

const config = {
  plugins: [tailwindcss(), sveltekit()],
  resolve: {
    dedupe: ["svelte"],
    alias: frontendWorkspaceAliases(demoWorkspaceAliasOptions),
  },
  server: {
    fs: {
      allow: [repoRoot],
    },
  },
};

export default config;
