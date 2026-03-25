import { buildDntPackage } from "../../../tools/npm/build_dnt_package.ts";

await buildDntPackage({
  entryPoints: ["./mod.ts", "./node.ts"],
  description: "Server-side Trellis helpers with runtime-neutral core and Node adapter entrypoints.",
  dependencies: {
    "@nats-io/transport-node": "^3.3.1",
    "@trellis/auth": "^0.1.0",
    "@trellis/result": "^0.1.0",
    "@trellis/trellis": "^0.1.0",
    pino: "^9.11.0"
  },
  npmInstallDeps: {
    "@nats-io/transport-node": "^3.3.1",
    pino: "^9.11.0"
  }
});
