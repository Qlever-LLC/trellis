import { assertEquals, assertStringIncludes } from "@std/assert";
import { parse } from "jsonc-parser";

const decoder = new TextDecoder();

Deno.test("workspace npm build task only builds the supported published packages", async () => {
  const source = await Deno.readFile(
    new URL("../../../deno.json", import.meta.url),
  );
  const config = parse(decoder.decode(source)) as {
    tasks: Record<string, string>;
  };

  assertEquals(
    config.tasks["packages:build:npm"],
    "deno task -c packages/result/deno.json build:npm && deno task -c packages/trellis/deno.json build:npm && deno task -c packages/trellis-svelte/deno.json build:npm",
  );
  assertEquals(
    config.tasks["build:npm"],
    "deno task prepare && deno task packages:build:npm",
  );
});

Deno.test("release workflows use generated package-manager targets", async () => {
  let releaseWorkflow = "";
  for (
    const workflow of [
      "release.yml",
      "pages.yml",
    ]
  ) {
    const source = await Deno.readTextFile(
      new URL(`../../../../.github/workflows/${workflow}`, import.meta.url),
    );

    assertEquals(source.includes("generated/rust/sdks"), false, workflow);
    assertEquals(source.includes("generate rust"), false, workflow);
    if (workflow === "release.yml") releaseWorkflow = source;
  }

  assertStringIncludes(
    releaseWorkflow,
    'npm publish --dry-run --access public --tag "$npm_tag" "$pkg"',
  );
  assertStringIncludes(
    releaseWorkflow,
    "cargo run --manifest-path rust/tools/generate/Cargo.toml -- -f prepare --no-npm .",
  );
  assertStringIncludes(
    releaseWorkflow,
    "denoland/setup-deno@v2",
  );
  assertStringIncludes(
    releaseWorkflow,
    "FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true",
  );
  assertEquals(
    releaseWorkflow.includes(
      "false && needs.prepare-release.outputs.should-publish",
    ),
    false,
  );
  assertStringIncludes(releaseWorkflow, "publish_or_skip js/packages/result");
  assertStringIncludes(releaseWorkflow, "publish_or_skip js/packages/trellis");
});

Deno.test("pages workflow cleans generator fallback temp dirs explicitly", async () => {
  const source = await Deno.readTextFile(
    new URL("../../../../.github/workflows/pages.yml", import.meta.url),
  );

  assertEquals(source.includes("trap cleanup_temp RETURN"), false);
  assertStringIncludes(source, "cleanup_temp");
  assertStringIncludes(source, "release_worktree_path");
  assertStringIncludes(source, "release_worktree_created");
  assertStringIncludes(
    source,
    "Published trellis-generate archive is not available",
  );
  assertStringIncludes(
    source,
    "Published trellis-generate checksum is not available",
  );
  assertStringIncludes(source, "Latest release tag worktree is missing docs");
  assertStringIncludes(
    source,
    "Latest release tag worktree is missing console sources",
  );
  assertStringIncludes(source, "FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true");
});

Deno.test("release workflow publishes only public Rust crates", async () => {
  const source = await Deno.readTextFile(
    new URL("../../../../.github/workflows/release.yml", import.meta.url),
  );

  for (const crate of ["trellis-contracts", "trellis-rs"]) {
    assertStringIncludes(source, `publish_workspace_crate ${crate}`);
  }
  for (
    const crate of [
      "trellis-auth",
      "trellis-cli",
      "trellis-client",
      "trellis-codegen-rust",
      "trellis-codegen-ts",
      "trellis-generate-runner",
      "trellis-local-bootstrap",
      "trellis-sdk-auth",
      "trellis-sdk-core",
      "trellis-service",
    ]
  ) {
    assertEquals(source.includes(`publish_workspace_crate ${crate}`), false);
    assertEquals(source.includes(`publish_generated_crate`), false);
  }
});

Deno.test("trellis package exports the first-party SDK subpaths", async () => {
  const source = await Deno.readTextFile(
    new URL("../deno.json", import.meta.url),
  );

  assertStringIncludes(source, '"./sdk/auth": "./sdk/auth.ts"');
  assertStringIncludes(source, '"./sdk/core": "./sdk/core.ts"');
  assertStringIncludes(source, '"./sdk/health": "./sdk/health.ts"');
  assertStringIncludes(source, '"./sdk/jobs": "./sdk/jobs.ts"');
  assertStringIncludes(source, '"./sdk/state": "./sdk/state.ts"');
});

Deno.test("workspace config does not shadow publishable package members", async () => {
  const source = await Deno.readTextFile(
    new URL("../../../deno.json", import.meta.url),
  );

  assertEquals(source.includes('"@qlever-llc/result":'), false);
  assertEquals(source.includes('"@qlever-llc/trellis":'), false);
  assertEquals(source.includes('"@qlever-llc/trellis/sdk/jobs":'), false);
  assertEquals(source.includes('"@qlever-llc/trellis-svelte":'), false);
});

Deno.test("trellis npm build depends on the standalone result package name", async () => {
  const source = await Deno.readTextFile(
    new URL("../scripts/build_npm.ts", import.meta.url),
  );

  assertStringIncludes(source, '"@qlever-llc/result"');
});

Deno.test("trellis package exports the errors and health subpaths", async () => {
  const source = await Deno.readTextFile(
    new URL("../deno.json", import.meta.url),
  );

  assertStringIncludes(source, '"./errors": "./errors/index.ts"');
  assertStringIncludes(source, '"./health": "./health.ts"');
  assertStringIncludes(source, '"./host": "./host/mod.ts"');
  assertStringIncludes(source, '"./jobs": "./jobs.ts"');
});
