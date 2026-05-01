import { buildSourcePackage } from "../../../tools/package_build/build_source_package.ts";

await buildSourcePackage({
  description:
    "Svelte components and state helpers for Trellis browser applications.",
  files: [
    "src/index.ts",
    "src/context.svelte.ts",
    "src/portal_flow.svelte.ts",
    "src/device_activation.svelte.ts",
    "src/device_activation_controller.ts",
    "src/internal/activation_view.ts",
    "src/internal/callback_state.ts",
    "src/internal/portal_url.ts",
    "src/components/TrellisProvider.svelte",
    "src/components/TrellisContextProvider.svelte",
    "src/components/TrellisProvider.types.ts",
  ],
  exports: {
    ".": {
      types: "./src/index.ts",
      svelte: "./src/index.ts",
      default: "./src/index.ts",
    },
  },
  dependencies: {
    "@nats-io/nats-core": "^3.3.1",
    "@qlever-llc/result": "^0.8.0",
    "@qlever-llc/trellis": "^0.8.0",
    typebox: "^1.0.15",
  },
  peerDependencies: {
    svelte: "^5.0.0",
  },
  extraPackageJson: {
    svelte: "./src/index.ts",
  },
});
