import { buildDntPackage } from "../../../tools/npm/build_dnt_package.ts";

await buildDntPackage({
  entryPoints: ["./mod.ts"],
  description: "Contract and schema helpers for Trellis TypeScript services and applications.",
  dependencies: {
    "json-schema-library": "^10.5.2",
    typebox: "^1.0.15",
  },
  npmInstallDeps: {
    "json-schema-library": "^10.5.2",
    typebox: "^1.0.15",
  },
  typeCheck: "both",
});
