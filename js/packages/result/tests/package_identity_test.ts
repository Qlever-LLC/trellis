import { assertEquals, assertStringIncludes } from "@std/assert";

const decoder = new TextDecoder();

type BuiltResultModule = {
  UnexpectedError: new (options?: { cause?: unknown }) => Error;
};

async function* walkFiles(dir: URL): AsyncGenerator<URL> {
  for await (const entry of Deno.readDir(dir)) {
    if (entry.isDirectory) {
      yield* walkFiles(new URL(`${entry.name}/`, dir));
    } else {
      yield new URL(entry.name, dir);
    }
  }
}

function isBuiltResultModule(value: unknown): value is BuiltResultModule {
  if (!value || typeof value !== "object") return false;

  return typeof Object.getOwnPropertyDescriptor(value, "UnexpectedError")
    ?.value === "function";
}

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

Deno.test("result npm build does not emit import-meta ponyfill references", async () => {
  for (const dir of [
    new URL("../npm/esm/", import.meta.url),
    new URL("../npm/script/", import.meta.url),
  ]) {
    for await (const path of walkFiles(dir)) {
      const source = await Deno.readTextFile(path);
      assertEquals(source.includes("import-meta-ponyfill"), false);
    }
  }
});

Deno.test("result npm ESM build constructs UnexpectedError", async () => {
  const moduleUrl = new URL("../npm/esm/mod.js", import.meta.url);
  const mod: unknown = await import(moduleUrl.href);
  if (!isBuiltResultModule(mod)) {
    throw new Error("Built result module did not export UnexpectedError");
  }

  const error = new mod.UnexpectedError({ cause: new Error("boom") });
  assertEquals(error instanceof Error, true);
  assertEquals(error.name, "UnexpectedError");
});
