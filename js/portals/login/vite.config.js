import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { frontendWorkspaceAliases } from "../../frontend-workspace-aliases.js";

const rootDir = dirname(fileURLToPath(import.meta.url));

function manualChunks(id) {
  if (!id.includes("node_modules")) return undefined;

  if (id.includes("@opentelemetry")) return "vendor-observability";
  if (id.includes("@nats-io")) return "vendor-nats";
  if (id.includes("typebox") || id.includes("json-schema-library")) {
    return "vendor-schema";
  }
  if (
    id.includes("@sveltejs") ||
    id.includes("svelte") ||
    id.includes("esrap") ||
    id.includes("clsx")
  )
    return "vendor-ui";
  return "vendor-misc";
}

const config = {
  plugins: [tailwindcss(), sveltekit()],
  build: {
    chunkSizeWarningLimit: 450,
    rollupOptions: {
      output: {
        manualChunks,
      },
    },
  },
  resolve: {
    dedupe: ["svelte"],
    alias: frontendWorkspaceAliases(),
  },
  server: {
    fs: {
      allow: [resolve(rootDir, "../../..")],
    },
  },
};

export default config;
