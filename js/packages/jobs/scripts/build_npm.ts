import { buildDntPackage } from "../../../tools/package_build/build_dnt_package.ts";

await buildDntPackage({
  entryPoints: ["./mod.ts"],
  description: "Trellis job models and client helpers for TypeScript services and applications.",
  dependencies: {
    "@qlever-llc/trellis": "^0.5.1",
    "@qlever-llc/trellis-result": "^0.5.1",
    "@qlever-llc/trellis-server": "^0.5.1",
    ulid: "^3.0.1",
    typebox: "^1.0.15",
  },
  npmInstallDeps: {
    ulid: "^3.0.1",
    typebox: "^1.0.15",
  },
});
