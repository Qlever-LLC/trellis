import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

const rootDir = dirname(fileURLToPath(import.meta.url));
const jsRoot = resolve(rootDir, "../..");
const basePath = process.env.SITE_BASE_PATH ?? "";

function aliasPath(path) {
  return resolve(jsRoot, path);
}

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({
      pages: "build",
      assets: "build",
      fallback: "index.html",
    }),
    paths: {
      base: basePath,
    },
    alias: {
      // Internal workspace-only aliases for local source resolution.
      // Public app code should import the canonical `@qlever-llc/trellis...` paths.
      "@qlever-llc/result": aliasPath("packages/result/mod.ts"),
      "@qlever-llc/trellis-sdk-jobs": aliasPath(
        "../generated/js/sdks/jobs/mod.ts",
      ),
      "@qlever-llc/trellis-svelte": aliasPath(
        "packages/trellis-svelte/src/index.ts",
      ),
      "@qlever-llc/trellis/auth/browser": aliasPath(
        "packages/trellis/auth/browser.ts",
      ),
      "@qlever-llc/trellis/auth": aliasPath("packages/trellis/auth.ts"),
      "@qlever-llc/trellis/contracts": aliasPath("packages/trellis/contracts.ts"),
      "@qlever-llc/trellis/jobs": aliasPath("packages/trellis/jobs.ts"),
      "@qlever-llc/trellis/health": aliasPath("packages/trellis/health.ts"),
      "@qlever-llc/trellis/host": aliasPath("packages/trellis/host/mod.ts"),
      "@qlever-llc/trellis/host/*": `${aliasPath("packages/trellis/host")}/*`,
      "@qlever-llc/trellis-sdk/auth": aliasPath("packages/trellis-sdk/auth.ts"),
      "@qlever-llc/trellis-sdk/core": aliasPath("packages/trellis-sdk/core.ts"),
      "@qlever-llc/trellis": aliasPath("packages/trellis/index.ts"),
    },
  },
};

export default config;
