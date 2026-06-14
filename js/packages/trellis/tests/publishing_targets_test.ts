import { assertEquals, assertStringIncludes } from "@std/assert";
import { parse } from "jsonc-parser";

const decoder = new TextDecoder();
const trellisSelfImportPattern =
  /(?:from\s+|import\()\s*["']@qlever-llc\/trellis(?:\/[^"']*)?["']/;

async function* walkPublishableSources(
  dir: URL,
): AsyncGenerator<URL> {
  for await (const entry of Deno.readDir(dir)) {
    const url = new URL(`${entry.name}${entry.isDirectory ? "/" : ""}`, dir);
    if (entry.isDirectory) {
      if ([".build", "npm", "scripts", "tests"].includes(entry.name)) {
        continue;
      }
      yield* walkPublishableSources(url);
      continue;
    }

    if (
      !entry.name.endsWith(".ts") ||
      entry.name.endsWith("_test.ts") ||
      entry.name.endsWith(".test.ts") ||
      entry.name.endsWith(".api_check.ts")
    ) {
      continue;
    }

    yield url;
  }
}

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
  assertStringIncludes(
    releaseWorkflow,
    "publish_or_skip js/services/trellis",
  );
  assertStringIncludes(
    releaseWorkflow,
    "publish_or_skip js/packages/trellis-test",
  );
  assertStringIncludes(
    releaseWorkflow,
    "publish_or_skip js/packages/trellis-svelte/jsr",
  );
  assertStringIncludes(
    releaseWorkflow,
    `js/packages/trellis-test \\
            js/packages/trellis-svelte/jsr
          do
            (cd "$pkg" && time deno publish --dry-run --allow-slow-types --allow-dirty)`,
  );
  assertStringIncludes(
    releaseWorkflow,
    `js/packages/trellis \\
            js/services/trellis \\
            js/packages/trellis-test`,
  );
  assertStringIncludes(releaseWorkflow, "trellis-svelte-jsr-package");
  assertStringIncludes(
    releaseWorkflow,
    "Upload trellis-svelte JSR package artifact",
  );
  assertStringIncludes(
    releaseWorkflow,
    "Download trellis-svelte JSR package artifact",
  );
  assertEquals(
    releaseWorkflow.includes(["services/trellis", "jsr"].join("/")),
    false,
  );
  assertEquals(releaseWorkflow.includes(["prepare", "jsr"].join(":")), false);
  assertEquals(
    releaseWorkflow.includes(["trellis-service", "trellis"].join("-")),
    false,
  );
  assertStringIncludes(
    releaseWorkflow,
    "deno publish --dry-run --allow-slow-types --allow-dirty",
  );
  assertStringIncludes(
    releaseWorkflow,
    "deno publish --allow-slow-types --allow-dirty",
  );
  assertEquals(releaseWorkflow.includes("deno eval --allow-read"), false);
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

Deno.test("trellis generate wrapper reads package metadata from remote modules", async () => {
  const packageRoot = new URL("../", import.meta.url);
  const generateSource = await Deno.readTextFile(
    new URL("generate.ts", packageRoot),
  );
  const packageManifest = await Deno.readTextFile(
    new URL("deno.json", packageRoot),
  );
  const packageVersion = JSON.parse(packageManifest).version as string;
  const tempDir = await Deno.makeTempDir();
  const fakeGenerator = `${tempDir}/trellis-generate`;
  await Deno.writeTextFile(
    fakeGenerator,
    `#!/bin/sh
printf 'trellis-generate ${packageVersion}\n'
`,
  );
  await Deno.chmod(fakeGenerator, 0o755);

  const server = Deno.serve({
    hostname: "127.0.0.1",
    port: 0,
    onListen: () => {},
  }, (request) => {
    const url = new URL(request.url);
    if (url.pathname === "/generate.ts") {
      return new Response(generateSource, {
        headers: { "content-type": "application/typescript" },
      });
    }
    if (url.pathname === "/deno.json") {
      return new Response(packageManifest, {
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("not found", { status: 404 });
  });

  try {
    const output = await new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "-A",
        `http://127.0.0.1:${server.addr.port}/generate.ts`,
        "--version",
      ],
      env: { TRELLIS_GENERATE_BIN: fakeGenerator },
      stdout: "piped",
      stderr: "piped",
    }).output();

    assertEquals(output.success, true, decoder.decode(output.stderr));
  } finally {
    await server.shutdown();
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("published trellis sources do not self-import package subpaths", async () => {
  const offenders: string[] = [];
  const packageRoot = new URL("../", import.meta.url);

  for await (const sourceUrl of walkPublishableSources(packageRoot)) {
    const source = await Deno.readTextFile(sourceUrl);
    if (trellisSelfImportPattern.test(source)) {
      offenders.push(sourceUrl.pathname.replace(packageRoot.pathname, ""));
    }
  }

  assertEquals(offenders, []);
});

Deno.test("publishable trellis service sources do not import package internals by repo path", async () => {
  const offenders: string[] = [];
  const packageRoot = new URL("../../../services/trellis/", import.meta.url);
  const relativePackageImportPattern =
    /\.\.\/\.\.\/\.\.\/packages\/trellis|\.\.\/\.\.\/\.\.\/\.\.\/packages\/trellis|\.\.\/\.\.\/packages\/trellis/;

  for await (const sourceUrl of walkPublishableSources(packageRoot)) {
    const source = await Deno.readTextFile(sourceUrl);
    if (relativePackageImportPattern.test(source)) {
      offenders.push(sourceUrl.pathname.replace(packageRoot.pathname, ""));
    }
  }

  assertEquals(offenders, []);
});

Deno.test("trellis control-plane service package publishes from source", async () => {
  const source = await Deno.readTextFile(
    new URL("../../../services/trellis/deno.json", import.meta.url),
  );
  const config = parse(source) as { name?: string; exports?: unknown };

  assertEquals(config.name, "@qlever-llc/trellis-control-plane");
  assertEquals(config.exports, "./main.ts");
});

Deno.test("workspace config does not shadow publishable package members", async () => {
  const source = await Deno.readTextFile(
    new URL("../../../deno.json", import.meta.url),
  );

  assertEquals(source.includes('"@qlever-llc/result":'), false);
  assertEquals(source.includes('"@qlever-llc/trellis":'), false);
  assertEquals(source.includes('"@qlever-llc/trellis-test":'), false);
  assertEquals(source.includes('"@qlever-llc/trellis/sdk/jobs":'), false);
  assertEquals(source.includes('"@qlever-llc/trellis-svelte":'), false);
});

Deno.test("trellis npm build depends on the standalone result package name", async () => {
  const source = await Deno.readTextFile(
    new URL("../scripts/build_npm.ts", import.meta.url),
  );

  assertStringIncludes(source, '"@qlever-llc/result"');
  assertStringIncludes(source, '"@qlever-llc/result": "^0.19.0"');
});

Deno.test("trellis-svelte npm build uses current Trellis package bases", async () => {
  const source = await Deno.readTextFile(
    new URL("../../trellis-svelte/scripts/build_npm.ts", import.meta.url),
  );

  assertStringIncludes(source, '"@qlever-llc/result": "^0.19.0"');
  assertStringIncludes(source, '"@qlever-llc/trellis": "^0.19.0"');
});

Deno.test("trellis package exports the errors and health subpaths", async () => {
  const source = await Deno.readTextFile(
    new URL("../deno.json", import.meta.url),
  );

  assertStringIncludes(source, '"./errors": "./errors/index.ts"');
  assertStringIncludes(source, '"./health": "./health.ts"');
  assertStringIncludes(source, '"./host": "./host/mod.ts"');
  assertStringIncludes(source, '"./jobs": "./jobs.ts"');
  assertStringIncludes(source, '"./service/drizzle": "./service/drizzle.ts"');
  assertStringIncludes(source, '"./telemetry": "./telemetry.ts"');
  assertEquals(source.includes('"./tracing":'), false);
});
