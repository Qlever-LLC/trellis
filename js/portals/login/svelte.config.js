import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

const rootDir = dirname(fileURLToPath(import.meta.url));
const jsRoot = resolve(rootDir, "../..");

function aliasPath(path) {
  return resolve(jsRoot, path);
}

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
      // Internal workspace-only aliases for local source resolution.
      // Public app code should import the canonical `@qlever-llc/trellis...` paths.
      "@qlever-llc/result": aliasPath("packages/result/mod.ts"),
      "@qlever-llc/result/*": `${aliasPath("packages/result")}/*`,
      "@qlever-llc/trellis-svelte": aliasPath(
        "packages/trellis-svelte/src/index.ts",
      ),
      "@qlever-llc/trellis-svelte/*": `${
        aliasPath("packages/trellis-svelte/src")
      }/*`,
      "@qlever-llc/trellis/auth": aliasPath("packages/trellis/auth.ts"),
      "@qlever-llc/trellis/auth/*": `${aliasPath("packages/trellis/auth")}/*`,
      "@qlever-llc/trellis/contracts": aliasPath(
        "packages/trellis/contracts.ts",
      ),
      "@qlever-llc/trellis/server": aliasPath("packages/trellis/server/mod.ts"),
      "@qlever-llc/trellis/server/*": `${
        aliasPath("packages/trellis/server")
      }/*`,
      "@qlever-llc/trellis/sdk/auth": aliasPath("packages/trellis/sdk/auth.ts"),
      "@qlever-llc/trellis/sdk/core": aliasPath("packages/trellis/sdk/core.ts"),
      "@qlever-llc/trellis": aliasPath("packages/trellis/index.ts"),
      "@qlever-llc/trellis/*": `${aliasPath("packages/trellis")}/*`,
    },
  },
};

export default config;
