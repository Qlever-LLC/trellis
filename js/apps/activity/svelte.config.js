import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import adapter from "npm:@sveltejs/adapter-auto";
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
    adapter: adapter(),
    alias: {
      "@trellis/auth": aliasPath("packages/auth/mod.ts"),
      "@trellis/auth/*": `${aliasPath("packages/auth")}/*`,
      "@trellis/auth/browser": aliasPath("packages/auth/browser.ts"),
      "@trellis/contracts": aliasPath("packages/contracts/mod.ts"),
      "@trellis/contracts/*": `${aliasPath("packages/contracts")}/*`,
      "@trellis/result": aliasPath("packages/result/mod.ts"),
      "@trellis/result/*": `${aliasPath("packages/result")}/*`,
      "@trellis/sdk-activity": aliasPath("../generated/js/sdks/activity/mod.ts"),
      "@trellis/sdk-activity/*": `${aliasPath("../generated/js/sdks/activity")}/*`,
      "@trellis/sdk-auth": aliasPath("../generated/js/sdks/auth/mod.ts"),
      "@trellis/sdk-auth/*": `${aliasPath("../generated/js/sdks/auth")}/*`,
      "@trellis/server": aliasPath("packages/server/mod.ts"),
      "@trellis/server/*": `${aliasPath("packages/server")}/*`,
      "@trellis/svelte": aliasPath("packages/trellis-svelte/src/index.ts"),
      "@trellis/svelte/*": `${aliasPath("packages/trellis-svelte/src")}/*`,
      "@trellis/trellis": aliasPath("packages/trellis/index.ts"),
      "@trellis/trellis/*": `${aliasPath("packages/trellis")}/*`
    }
  }
};

export default config;
