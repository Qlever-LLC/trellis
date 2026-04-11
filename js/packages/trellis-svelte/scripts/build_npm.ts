import { buildSourcePackage } from "../../../tools/package_build/build_source_package.ts";

await buildSourcePackage({
  description: "Svelte components and state helpers for Trellis browser applications.",
  files: [
    "src/index.ts",
    "src/context.svelte.ts",
    "src/portal_flow.svelte.ts",
    "src/components/TrellisProvider.svelte",
    "src/state/auth.svelte.ts",
    "src/state/nats.svelte.ts",
    "src/state/trellis.svelte.ts",
  ],
  exports: {
    ".": {
      types: "./src/index.ts",
      svelte: "./src/index.ts",
      default: "./src/index.ts"
    }
  },
  dependencies: {
    "@nats-io/nats-core": "^3.3.1",
    "@qlever-llc/trellis": "^0.6.1",
    typebox: "^1.0.15"
  },
  peerDependencies: {
    svelte: "^5.0.0"
  },
  extraPackageJson: {
    svelte: "./src/index.ts"
  }
});
