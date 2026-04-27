import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";

const rootDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(rootDir, "../../..");

const config = {
  plugins: [tailwindcss(), sveltekit()],
  resolve: {
    dedupe: ["svelte"],
  },
  server: {
    fs: {
      allow: [repoRoot],
    },
  },
};

export default config;
