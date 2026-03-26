import { buildDntPackage } from "../../../tools/npm/build_dnt_package.ts";

await buildDntPackage({
  entryPoints: ["./index.ts", "./browser.ts", "./tracing.ts"],
  description: "Client-side Trellis runtime, models, and contract helpers for TypeScript applications.",
  dependencies: {
    "@nats-io/jetstream": "^3.3.0",
    "@nats-io/kv": "^3.2.0",
    "@nats-io/nats-core": "^3.3.1",
    "@qlever-llc/trellis-contracts": "^0.4.0",
    "@qlever-llc/trellis-result": "^0.4.0",
    "@qlever-llc/trellis-telemetry": "^0.4.0",
    pino: "^9.11.0",
    "ts-deepmerge": "^7.0.3",
    typebox: "^1.0.15",
    ulid: "^3.0.1",
  },
  npmInstallDeps: {
    "@nats-io/jetstream": "^3.3.0",
    "@nats-io/kv": "^3.2.0",
    "@nats-io/nats-core": "^3.3.1",
    pino: "^9.11.0",
    "ts-deepmerge": "^7.0.3",
    typebox: "^1.0.15",
    ulid: "^3.0.1",
  },
  externalizePackageDirs: {
    result: "@qlever-llc/trellis-result",
  },
});
