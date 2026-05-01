import { assertEquals, assertStringIncludes } from "@std/assert";

const decoder = new TextDecoder();

Deno.test("result package is published as @qlever-llc/result", async () => {
  const source = await Deno.readFile(new URL("../deno.json", import.meta.url));
  const config = JSON.parse(decoder.decode(source));

  assertEquals(config.name, "@qlever-llc/result");
});

Deno.test("result package readme uses the standalone result package name", async () => {
  const source = await Deno.readTextFile(
    new URL("../README.md", import.meta.url),
  );

  assertStringIncludes(source, "@qlever-llc/result");
});

Deno.test("result npm build opts out of DNT Deno shims", async () => {
  const source = await Deno.readTextFile(
    new URL("../scripts/build_npm.ts", import.meta.url),
  );

  assertStringIncludes(source, "denoShims: false");
});

Deno.test("result npm declarations do not import DNT polyfills", async () => {
  const modTypes = await Deno.readTextFile(
    new URL("../npm/esm/mod.d.ts", import.meta.url),
  ).catch((error) => {
    if (error instanceof Deno.errors.NotFound) return "";
    throw error;
  });

  assertEquals(modTypes.includes("_dnt.polyfills"), false);
});
