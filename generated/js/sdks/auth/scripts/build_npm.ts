// Generated from ./generated/contracts/manifests/trellis.auth@v1.json
import { build, emptyDir } from "jsr:@deno/dnt@^0.41.3";

await emptyDir(new URL("../npm", import.meta.url));

await build({
  entryPoints: ["./mod.ts"],
  outDir: "./npm",
  shims: {
    deno: true,
  },
  test: false,
  typeCheck: false,
  package: {
    name: "@trellis/sdk-auth",
    version: "0.1.0",
    description: "Generated Trellis SDK for contract trellis.auth@v1",
    dependencies: {
      "@trellis/contracts": "file:../../../../js/packages/contracts/npm",
    },
  },
});
