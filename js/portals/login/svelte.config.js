import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

const rootDir = dirname(fileURLToPath(import.meta.url));

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    appDir: "_trellis/assets",
    adapter: adapter({
      pages: "build",
      assets: "build",
      fallback: "200.html",
    }),
    alias: {
      "@qlever-llc/result": resolve(rootDir, "../../packages/result/mod.ts"),
      "@qlever-llc/trellis-svelte": resolve(
        rootDir,
        "../../packages/trellis-svelte/src/index.ts",
      ),
      "@qlever-llc/trellis/auth/browser": resolve(
        rootDir,
        "../../packages/trellis/auth/browser.ts",
      ),
      "@qlever-llc/trellis/auth": resolve(
        rootDir,
        "../../packages/trellis/auth.ts",
      ),
      "@qlever-llc/trellis/browser": resolve(
        rootDir,
        "../../packages/trellis/browser.ts",
      ),
      "@qlever-llc/trellis/contracts": resolve(
        rootDir,
        "../../packages/trellis/contracts.ts",
      ),
      "@qlever-llc/trellis/device/deno": resolve(
        rootDir,
        "../../packages/trellis/device/deno.ts",
      ),
      "@qlever-llc/trellis/device": resolve(
        rootDir,
        "../../packages/trellis/device.ts",
      ),
      "@qlever-llc/trellis/health": resolve(
        rootDir,
        "../../packages/trellis/health.ts",
      ),
      "@qlever-llc/trellis/sdk/auth": resolve(
        rootDir,
        "../../../generated/js/sdks/auth/mod.ts",
      ),
      "@qlever-llc/trellis/sdk/core": resolve(
        rootDir,
        "../../../generated/js/sdks/trellis-core/mod.ts",
      ),
      "@qlever-llc/trellis/sdk/health": resolve(
        rootDir,
        "../../../generated/js/sdks/health/mod.ts",
      ),
      "@qlever-llc/trellis/sdk/jobs": resolve(
        rootDir,
        "../../../generated/js/sdks/jobs/mod.ts",
      ),
      "@qlever-llc/trellis/sdk/state": resolve(
        rootDir,
        "../../../generated/js/sdks/state/mod.ts",
      ),
      "@qlever-llc/trellis/service/deno": resolve(
        rootDir,
        "../../packages/trellis/service/deno.ts",
      ),
      "@qlever-llc/trellis/service/node": resolve(
        rootDir,
        "../../packages/trellis/service/node.ts",
      ),
      "@qlever-llc/trellis/service": resolve(
        rootDir,
        "../../packages/trellis/service/mod.ts",
      ),
      "@qlever-llc/trellis/jobs": resolve(
        rootDir,
        "../../packages/trellis/jobs.ts",
      ),
      "@qlever-llc/trellis/host/deno": resolve(
        rootDir,
        "../../packages/trellis/host/deno.ts",
      ),
      "@qlever-llc/trellis/host/node": resolve(
        rootDir,
        "../../packages/trellis/host/node.ts",
      ),
      "@qlever-llc/trellis/host": resolve(
        rootDir,
        "../../packages/trellis/host/mod.ts",
      ),
      "@qlever-llc/trellis/tracing": resolve(
        rootDir,
        "../../packages/trellis/tracing.ts",
      ),
      "@qlever-llc/trellis": resolve(
        rootDir,
        "../../packages/trellis/index.ts",
      ),
    },
  },
};

export default config;
