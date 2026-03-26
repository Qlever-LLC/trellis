import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sveltekit } from "npm:@sveltejs/kit/vite";
import tailwindcss from "npm:@tailwindcss/vite";

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
      { find: "@qlever-llc/trellis-auth/browser", replacement: aliasPath("packages/auth/browser.ts") },
      { find: "@qlever-llc/trellis-auth", replacement: aliasPath("packages/auth/mod.ts") },
      { find: "@qlever-llc/trellis-auth/", replacement: `${aliasPath("packages/auth")}/` },
      { find: "@qlever-llc/trellis-contracts", replacement: aliasPath("packages/contracts/mod.ts") },
      { find: "@qlever-llc/trellis-contracts/", replacement: `${aliasPath("packages/contracts")}/` },
      { find: "@qlever-llc/trellis-result", replacement: aliasPath("packages/result/mod.ts") },
      { find: "@qlever-llc/trellis-result/", replacement: `${aliasPath("packages/result")}/` },
      { find: /^@qlever-llc\/trellis-telemetry$/, replacement: aliasPath("packages/telemetry/mod.ts") },
      { find: "@qlever-llc/trellis-telemetry/", replacement: `${aliasPath("packages/telemetry")}/` },
      { find: /^@qlever-llc\/trellis-sdk-core$/, replacement: aliasPath("../generated/js/sdks/trellis-core/mod.ts") },
      { find: "@qlever-llc/trellis-sdk-core/", replacement: `${aliasPath("../generated/js/sdks/trellis-core")}/` },
      { find: "@qlever-llc/trellis-sdk-auth", replacement: aliasPath("../generated/js/sdks/auth/mod.ts") },
      { find: "@qlever-llc/trellis-sdk-auth/", replacement: `${aliasPath("../generated/js/sdks/auth")}/` },
      { find: "@qlever-llc/trellis-server", replacement: aliasPath("packages/server/mod.ts") },
      { find: "@qlever-llc/trellis-server/", replacement: `${aliasPath("packages/server")}/` },
      { find: "@qlever-llc/trellis-svelte", replacement: aliasPath("packages/trellis-svelte/src/index.ts") },
      { find: "@qlever-llc/trellis-svelte/", replacement: `${aliasPath("packages/trellis-svelte/src")}/` },
      { find: "@qlever-llc/trellis-trellis", replacement: aliasPath("packages/trellis/index.ts") },
      { find: "@qlever-llc/trellis-trellis/", replacement: `${aliasPath("packages/trellis")}/` },
    ]
  },
  server: {
    fs: {
      allow: [resolve(rootDir, "../../..")]
    }
  }
};

export default config;
