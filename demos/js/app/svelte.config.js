import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

const rootDir = dirname(fileURLToPath(import.meta.url));

const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({
      pages: "build",
      assets: "build",
      fallback: "index.html",
    }),
    alias: {
      "@qlever-llc/result": resolve(
        rootDir,
        "../../../js/packages/result/mod.ts",
      ),
      "@qlever-llc/trellis/auth/browser": resolve(
        rootDir,
        "../../../js/packages/trellis/auth/browser.ts",
      ),
      "@qlever-llc/trellis/auth": resolve(
        rootDir,
        "../../../js/packages/trellis/auth.ts",
      ),
      "@qlever-llc/trellis/contracts": resolve(
        rootDir,
        "../../../js/packages/trellis/contracts.ts",
      ),
      "@qlever-llc/trellis/device/deno": resolve(
        rootDir,
        "../../../js/packages/trellis/device/deno.ts",
      ),
      "@qlever-llc/trellis/errors": resolve(
        rootDir,
        "../../../js/packages/trellis/errors/index.ts",
      ),
      "@qlever-llc/trellis/service/deno": resolve(
        rootDir,
        "../../../js/packages/trellis/service/deno.ts",
      ),
      "@qlever-llc/trellis/service": resolve(
        rootDir,
        "../../../js/packages/trellis/service/mod.ts",
      ),
      "@qlever-llc/trellis-svelte": resolve(
        rootDir,
        "../../../js/packages/trellis-svelte/src/index.ts",
      ),
      "@qlever-llc/trellis/sdk/activity": resolve(
        rootDir,
        "../../../js/packages/trellis/sdk/activity.ts",
      ),
      "@qlever-llc/trellis/sdk/auth": resolve(
        rootDir,
        "../../../js/packages/trellis/sdk/auth.ts",
      ),
      "@qlever-llc/trellis/sdk/core": resolve(
        rootDir,
        "../../../js/packages/trellis/sdk/core.ts",
      ),
      "@qlever-llc/trellis/sdk/health": resolve(
        rootDir,
        "../../../js/packages/trellis/sdk/health.ts",
      ),
      "@qlever-llc/trellis/sdk/jobs": resolve(
        rootDir,
        "../../../js/packages/trellis/sdk/jobs.ts",
      ),
      "@qlever-llc/trellis/sdk/state": resolve(
        rootDir,
        "../../../js/packages/trellis/sdk/state.ts",
      ),
      "@qlever-llc/trellis": resolve(
        rootDir,
        "../../../js/packages/trellis/index.ts",
      ),
      "#trellis-generated-sdk/activity": resolve(
        rootDir,
        "../../../generated/js/sdks/activity/mod.ts",
      ),
      "#trellis-generated-sdk/auth": resolve(
        rootDir,
        "../../../generated/js/sdks/auth/mod.ts",
      ),
      "#trellis-generated-sdk/core": resolve(
        rootDir,
        "../../../generated/js/sdks/trellis-core/mod.ts",
      ),
      "#trellis-generated-sdk/health": resolve(
        rootDir,
        "../../../generated/js/sdks/health/mod.ts",
      ),
      "#trellis-generated-sdk/jobs": resolve(
        rootDir,
        "../../../generated/js/sdks/jobs/mod.ts",
      ),
      "#trellis-generated-sdk/state": resolve(
        rootDir,
        "../../../generated/js/sdks/state/mod.ts",
      ),
      "@trellis-demo/service-sdk": resolve(
        rootDir,
        "../generated/js/sdks/demo-service/mod.ts",
      ),
    },
  },
};

export default config;
