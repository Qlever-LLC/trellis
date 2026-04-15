import { assertEquals, assertStringIncludes } from "@std/assert";
import { parse } from "jsonc-parser";

const decoder = new TextDecoder();

Deno.test("workspace npm build task only builds the supported published packages", async () => {
  const source = await Deno.readFile(
    new URL("../../../deno.json", import.meta.url),
  );
  const config = parse(decoder.decode(source)) as { tasks: Record<string, string> };

  assertEquals(
    config.tasks["packages:build:npm"],
    "deno task -c packages/result/deno.json build:npm && deno task -c packages/trellis-sdk/deno.json build:npm && deno task -c packages/trellis/deno.json build:npm && deno task -c packages/trellis-svelte/deno.json build:npm",
  );
  assertEquals(
    config.tasks["build:npm"],
    "deno task prepare && deno task packages:build:npm",
  );
});

Deno.test("trellis-sdk package exports the first-party SDK subpaths", async () => {
  const source = await Deno.readTextFile(
    new URL("../../trellis-sdk/deno.json", import.meta.url),
  );

  assertStringIncludes(source, '"./activity": "./activity.ts"');
  assertStringIncludes(source, '"./auth": "./auth.ts"');
  assertStringIncludes(source, '"./core": "./core.ts"');
  assertStringIncludes(source, '"./state": "./state.ts"');
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
});
