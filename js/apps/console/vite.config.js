import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";

const rootDir = dirname(fileURLToPath(import.meta.url));
const jsRoot = resolve(rootDir, "../..");

function aliasPath(path) {
  return resolve(jsRoot, path);
}

function manualChunks(id) {
  if (!id.includes("node_modules")) return undefined;

  if (id.includes("@opentelemetry")) return "vendor-observability";
  if (id.includes("@nats-io")) return "vendor-nats";
  if (id.includes("typebox") || id.includes("json-schema-library")) return "vendor-schema";
  if (id.includes("@sveltejs") || id.includes("svelte") || id.includes("esrap") || id.includes("clsx")) return "vendor-ui";
  return "vendor-misc";
}

const config = {
  plugins: [tailwindcss(), sveltekit()],
  build: {
    chunkSizeWarningLimit: 450,
    rollupOptions: {
      external: ["@nats-io/transport-deno"],
      output: {
        manualChunks
      }
    }
  },
  resolve: {
    dedupe: ["svelte"],
    alias: [
      // Internal workspace-only aliases for local source resolution.
      // Public app code should import the canonical `@qlever-llc/trellis...` paths.
      { find: "@qlever-llc/result", replacement: aliasPath("packages/result/mod.ts") },
      { find: "@qlever-llc/result/", replacement: `${aliasPath("packages/result")}/` },
      { find: "@qlever-llc/trellis/auth/browser", replacement: aliasPath("packages/trellis/auth/browser.ts") },
      { find: "@qlever-llc/trellis/auth", replacement: aliasPath("packages/trellis/auth.ts") },
      { find: "@qlever-llc/trellis/contracts", replacement: aliasPath("packages/trellis/contracts.ts") },
      { find: "@qlever-llc/trellis/server/deno", replacement: aliasPath("packages/trellis/server/deno.ts") },
      { find: "@qlever-llc/trellis/server/node", replacement: aliasPath("packages/trellis/server/node.ts") },
      { find: "@qlever-llc/trellis/server/runtime", replacement: aliasPath("packages/trellis/server/runtime.ts") },
      { find: "@qlever-llc/trellis/server", replacement: aliasPath("packages/trellis/server/mod.ts") },
      { find: "@qlever-llc/trellis/sdk/core", replacement: aliasPath("packages/trellis/sdk/core.ts") },
      { find: "@qlever-llc/trellis/sdk/auth", replacement: aliasPath("packages/trellis/sdk/auth.ts") },
      { find: "@qlever-llc/trellis/sdk/activity", replacement: aliasPath("packages/trellis/sdk/activity.ts") },
      { find: "@qlever-llc/trellis-svelte", replacement: aliasPath("packages/trellis-svelte/src/index.ts") },
      { find: "@qlever-llc/trellis-svelte/", replacement: `${aliasPath("packages/trellis-svelte/src")}/` },
      { find: "@qlever-llc/trellis/browser", replacement: aliasPath("packages/trellis/browser.ts") },
      { find: "@qlever-llc/trellis", replacement: aliasPath("packages/trellis/index.ts") },
      { find: "@qlever-llc/trellis/", replacement: `${aliasPath("packages/trellis")}/` },
    ]
  },
  server: {
    fs: {
      allow: [resolve(rootDir, "../../..")]
    }
  }
};

export default config;
