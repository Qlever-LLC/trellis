import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

const rootDir = dirname(fileURLToPath(import.meta.url));
const buildDir = process.env.TRELLIS_WEB_BUILD_DIR ?? "build";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    appDir: "assets/web",
    version: { name: process.env.TRELLIS_WEB_VERSION ?? "standalone" },
    paths: { base: process.env.SITE_BASE_PATH ?? "" },
    adapter: adapter({
      pages: buildDir,
      assets: buildDir,
      fallback: "200.html",
    }),
    alias: {
      "@qlever-llc/result": resolve(rootDir, "../ts/packages/result/mod.ts"),
      "@qlever-llc/trellis-svelte": resolve(
        rootDir,
        "../ts/packages/trellis-svelte/src/index.ts",
      ),
      "@qlever-llc/trellis/auth/browser": resolve(
        rootDir,
        "../ts/packages/trellis/auth/browser.ts",
      ),
      "@qlever-llc/trellis/auth": resolve(
        rootDir,
        "../ts/packages/trellis/auth.ts",
      ),
      "@qlever-llc/trellis/browser": resolve(
        rootDir,
        "../ts/packages/trellis/browser.ts",
      ),
      "@qlever-llc/trellis/contracts": resolve(
        rootDir,
        "../ts/packages/trellis/contracts.ts",
      ),
      "@qlever-llc/trellis/errors": resolve(
        rootDir,
        "../ts/packages/trellis/errors/index.ts",
      ),
      "@qlever-llc/trellis/device/deno": resolve(
        rootDir,
        "../ts/packages/trellis/device/deno.ts",
      ),
      "@qlever-llc/trellis/device": resolve(
        rootDir,
        "../ts/packages/trellis/device.ts",
      ),
      "@qlever-llc/trellis/health": resolve(
        rootDir,
        "../ts/packages/trellis/health.ts",
      ),
      "@trellis/apis/trellis.auth": resolve(
        rootDir,
        "contracts/console/.trellis/generated/ts/trellis-apis/trellis.auth.ts",
      ),
      "@trellis/apis/trellis.core": resolve(
        rootDir,
        "contracts/console/.trellis/generated/ts/trellis-apis/trellis.core.ts",
      ),
      "@trellis/apis/trellis.eventlog": resolve(
        rootDir,
        "contracts/console/.trellis/generated/ts/trellis-apis/trellis.eventlog.ts",
      ),
      "@trellis/apis/trellis.health": resolve(
        rootDir,
        "contracts/console/.trellis/generated/ts/trellis-apis/trellis.health.ts",
      ),
      "@trellis/apis/trellis.jobs": resolve(
        rootDir,
        "contracts/console/.trellis/generated/ts/trellis-apis/trellis.jobs.ts",
      ),
      "@trellis/apis/trellis.state": resolve(
        rootDir,
        "contracts/console/.trellis/generated/ts/trellis-apis/trellis.state.ts",
      ),
      "@qlever-llc/trellis/service/deno": resolve(
        rootDir,
        "../ts/packages/trellis/service/deno.ts",
      ),
      "@qlever-llc/trellis/service/node": resolve(
        rootDir,
        "../ts/packages/trellis/service/node.ts",
      ),
      "@qlever-llc/trellis/service": resolve(
        rootDir,
        "../ts/packages/trellis/service/mod.ts",
      ),
      "@qlever-llc/trellis/jobs": resolve(
        rootDir,
        "../ts/packages/trellis/jobs.ts",
      ),
      "@qlever-llc/trellis/telemetry": resolve(
        rootDir,
        "../ts/packages/trellis/telemetry.ts",
      ),
      "@qlever-llc/trellis": resolve(
        rootDir,
        "../ts/packages/trellis/index.ts",
      ),
    },
  },
};

export default config;
