import { buildDntPackage } from "../../../tools/package_build/build_dnt_package.ts";

await buildDntPackage({
  entryPoints: ["./mod.ts", "./node.ts"],
  description: "Server-side Trellis helpers with runtime-neutral core and Node adapter entrypoints.",
  dependencies: {
    "@nats-io/transport-node": "^3.3.1",
    "@qlever-llc/trellis-auth": "^0.5.1",
    "@qlever-llc/trellis-result": "^0.5.1",
    "@qlever-llc/trellis-trellis": "^0.5.1",
    pino: "^9.11.0"
  },
  npmInstallDeps: {
    "@nats-io/transport-node": "^3.3.1",
    pino: "^9.11.0"
  }
});
