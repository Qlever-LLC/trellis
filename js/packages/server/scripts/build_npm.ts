import { buildDntPackage } from "../../../tools/package_build/build_dnt_package.ts";

await buildDntPackage({
  entryPoints: ["./mod.ts", "./node.ts"],
  description: "Server-side Trellis helpers with runtime-neutral core and Node adapter entrypoints.",
  dependencies: {
    "@nats-io/transport-node": "^3.3.1",
    "@qlever-llc/trellis-auth": "^0.7.0",
    "@qlever-llc/result": "^0.7.0",
    "@qlever-llc/trellis": "^0.7.0",
    pino: "^9.11.0"
  },
  npmInstallDeps: {
    "@nats-io/transport-node": "^3.3.1",
    pino: "^9.11.0"
  }
});
