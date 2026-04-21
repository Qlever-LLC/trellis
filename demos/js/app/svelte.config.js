import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

const rootDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(rootDir, "../../..");

function aliasPath(path) {
  return resolve(repoRoot, path);
}

const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({
      pages: "build",
      assets: "build",
      fallback: "index.html",
    }),
    alias: {
      "@qlever-llc/result": aliasPath("js/packages/result/mod.ts"),
      "@qlever-llc/trellis": aliasPath("js/packages/trellis/index.ts"),
      "@qlever-llc/trellis/auth": aliasPath("js/packages/trellis/auth.ts"),
      "@qlever-llc/trellis/auth/browser": aliasPath("js/packages/trellis/auth/browser.ts"),
      "@qlever-llc/trellis/contracts": aliasPath("js/packages/trellis/contracts.ts"),
      "@qlever-llc/trellis-sdk/jobs": aliasPath("js/packages/trellis-sdk/jobs.ts"),
      "@qlever-llc/trellis-sdk": aliasPath("js/packages/trellis-sdk/mod.ts"),
      "@qlever-llc/trellis-sdk/auth": aliasPath("js/packages/trellis-sdk/auth.ts"),
      "@qlever-llc/trellis-sdk/state": aliasPath("js/packages/trellis-sdk/state.ts"),
      "@qlever-llc/trellis-svelte": resolve(rootDir, "src/runtime/trellis-svelte.js"),
      "@trellis-demo/rpc-service-sdk": aliasPath("demos/generated/js/sdks/demo-rpc-service/mod.ts"),
      "@trellis-demo/operation-service-sdk": aliasPath("demos/generated/js/sdks/demo-operation-service/mod.ts"),
      "@trellis-demo/transfer-service-sdk": aliasPath("demos/generated/js/sdks/demo-transfer-service/mod.ts"),
      "@trellis-demo/kv-service-sdk": aliasPath("demos/generated/js/sdks/demo-kv-service/mod.ts"),
      "@trellis-demo/jobs-service-sdk": aliasPath("demos/generated/js/sdks/demo-jobs-service/mod.ts"),
    },
  },
};

export default config;
