import { buildDntPackage } from "../../../tools/npm/build_dnt_package.ts";

await buildDntPackage({
  entryPoints: ["./mod.ts", "./browser.ts", "./protocol.ts"],
  description: "Authentication helpers for Trellis browser and service clients.",
  dependencies: {
    "@trellis/result": "^0.1.0",
    typebox: "^1.0.15",
  },
  npmInstallDeps: {
    typebox: "^1.0.15",
  },
});
