import { buildDntPackage } from "../../../tools/package_build/build_dnt_package.ts";

await buildDntPackage({
  entryPoints: ["./mod.ts", "./browser.ts", "./protocol.ts"],
  description: "Authentication helpers for Trellis browser and service clients.",
  dependencies: {
    "@qlever-llc/trellis-result": "^0.5.0",
    typebox: "^1.0.15",
  },
  npmInstallDeps: {
    typebox: "^1.0.15",
  },
});
