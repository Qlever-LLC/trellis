// Generated from ./generated/contracts/manifests/trellis.activity@v1.json
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
    name: "@qlever-llc/trellis-sdk-activity",
    version: "0.5.1",
    description: "Generated Trellis SDK for contract trellis.activity@v1",
    license: "Apache-2.0",
    homepage: "https://github.com/Qlever-LLC/trellis#readme",
    bugs: {
      url: "https://github.com/Qlever-LLC/trellis/issues",
    },
    repository: {
      type: "git",
      url: "https://github.com/Qlever-LLC/trellis",
    },
    publishConfig: {
      access: "public",
    },
    dependencies: {
      "@qlever-llc/trellis-contracts": "file:../../../../js/packages/contracts/npm",
    },
  },
});

const packageJsonPath = new URL("../npm/package.json", import.meta.url);
const packageJson = JSON.parse(await Deno.readTextFile(packageJsonPath));
packageJson.dependencies = {
  ...(packageJson.dependencies ?? {}),
  "@qlever-llc/trellis-contracts": "^0.5.1",
};
await Deno.writeTextFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}
`);
