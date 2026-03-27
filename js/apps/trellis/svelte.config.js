import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import adapter from "npm:@sveltejs/adapter-static";
import { vitePreprocess } from "npm:@sveltejs/vite-plugin-svelte";

const rootDir = dirname(fileURLToPath(import.meta.url));
const jsRoot = resolve(rootDir, "../..");

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
      fallback: "index.html"
    }),
    alias: {
      "@qlever-llc/trellis-auth": aliasPath("packages/auth/mod.ts"),
      "@qlever-llc/trellis-auth/*": `${aliasPath("packages/auth")}/*`,
      "@qlever-llc/trellis-auth/browser": aliasPath("packages/auth/browser.ts"),
      "@qlever-llc/trellis-contracts": aliasPath("packages/contracts/mod.ts"),
      "@qlever-llc/trellis-contracts/*": `${aliasPath("packages/contracts")}/*`,
      "@qlever-llc/trellis-result": aliasPath("packages/result/mod.ts"),
      "@qlever-llc/trellis-result/*": `${aliasPath("packages/result")}/*`,
      "@qlever-llc/trellis-sdk-auth": aliasPath("../generated/js/sdks/auth/mod.ts"),
      "@qlever-llc/trellis-sdk-auth/*": `${aliasPath("../generated/js/sdks/auth")}/*`,
      "@qlever-llc/trellis-server": aliasPath("packages/server/mod.ts"),
      "@qlever-llc/trellis-server/*": `${aliasPath("packages/server")}/*`,
      "@qlever-llc/trellis-svelte": aliasPath("packages/trellis-svelte/src/index.ts"),
      "@qlever-llc/trellis-svelte/*": `${aliasPath("packages/trellis-svelte/src")}/*`,
      "@qlever-llc/trellis": aliasPath("packages/trellis/index.ts"),
      "@qlever-llc/trellis/*": `${aliasPath("packages/trellis")}/*`
    }
  }
};

export default config;
