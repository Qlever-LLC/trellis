import { buildDntPackage } from "../../../tools/package_build/build_dnt_package.ts";

await buildDntPackage({
  entryPoints: ["./mod.ts"],
  description: "Class-based Result and AsyncResult types for Trellis TypeScript applications.",
  dependencies: {
    typebox: "^1.0.15",
    ulid: "^3.0.1",
  },
  npmInstallDeps: {
    typebox: "^1.0.15",
    ulid: "^3.0.1",
  },
  typeCheck: false,
});
