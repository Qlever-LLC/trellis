import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sveltekit } from "@sveltejs/kit/vite";

const rootDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(rootDir, "../../..");

function aliasPath(path) {
  return resolve(repoRoot, path);
}

const config = {
  plugins: [sveltekit()],
  resolve: {
    dedupe: ["svelte"],
    alias: [
      { find: "@qlever-llc/result", replacement: aliasPath("js/packages/result/mod.ts") },
      { find: "@qlever-llc/result/", replacement: `${aliasPath("js/packages/result")}/` },
      { find: "@qlever-llc/trellis/auth", replacement: aliasPath("js/packages/trellis/auth.ts") },
      { find: "@qlever-llc/trellis/auth/browser", replacement: aliasPath("js/packages/trellis/auth/browser.ts") },
      { find: "@qlever-llc/trellis/contracts", replacement: aliasPath("js/packages/trellis/contracts.ts") },
      { find: "@qlever-llc/trellis-sdk", replacement: aliasPath("js/packages/trellis-sdk/mod.ts") },
      { find: "@qlever-llc/trellis-sdk/", replacement: `${aliasPath("js/packages/trellis-sdk")}/` },
      { find: "@qlever-llc/trellis-sdk/auth", replacement: aliasPath("js/packages/trellis-sdk/auth.ts") },
      { find: "@qlever-llc/trellis-svelte", replacement: resolve(rootDir, "src/runtime/trellis-svelte.js") },
      { find: "@trellis-demo/rpc-service-sdk", replacement: aliasPath("demos/generated/js/sdks/demo-rpc-service/mod.ts") },
      { find: "@trellis-demo/operation-service-sdk", replacement: aliasPath("demos/generated/js/sdks/demo-operation-service/mod.ts") },
      { find: "@trellis-demo/transfer-service-sdk", replacement: aliasPath("demos/generated/js/sdks/demo-transfer-service/mod.ts") },
      { find: "@trellis-demo/kv-service-sdk", replacement: aliasPath("demos/generated/js/sdks/demo-kv-service/mod.ts") },
      { find: "@trellis-demo/jobs-service-sdk", replacement: aliasPath("demos/generated/js/sdks/demo-jobs-service/mod.ts") },
      { find: "@qlever-llc/trellis", replacement: aliasPath("js/packages/trellis/index.ts") },
      { find: "@qlever-llc/trellis/", replacement: `${aliasPath("js/packages/trellis")}/` }
    ],
  },
  server: {
    fs: {
      allow: [repoRoot],
    },
  },
};

export default config;
