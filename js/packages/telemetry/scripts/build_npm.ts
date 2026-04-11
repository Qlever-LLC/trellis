import { buildDntPackage } from "../../../tools/package_build/build_dnt_package.ts";

await buildDntPackage({
  entryPoints: ["./mod.ts", "./core.ts", "./env.ts", "./nats.ts", "./result.ts", "./trellis.ts"],
  description: "Shared OpenTelemetry helpers for Trellis runtimes, clients, and jobs.",
  dependencies: {
    "@opentelemetry/api": "^1.9.0",
    "@opentelemetry/exporter-trace-otlp-http": "^0.56.0",
    "@opentelemetry/resources": "^1.30.1",
    "@opentelemetry/sdk-trace-base": "^1.30.1",
    "@opentelemetry/sdk-trace-node": "^1.30.1",
    "@opentelemetry/semantic-conventions": "^1.28.0",
    "@qlever-llc/result": "^0.6.1"
  },
  npmInstallDeps: {
    "@opentelemetry/api": "^1.9.0",
    "@opentelemetry/exporter-trace-otlp-http": "^0.56.0",
    "@opentelemetry/resources": "^1.30.1",
    "@opentelemetry/sdk-trace-base": "^1.30.1",
    "@opentelemetry/sdk-trace-node": "^1.30.1",
    "@opentelemetry/semantic-conventions": "^1.28.0"
  }
});
