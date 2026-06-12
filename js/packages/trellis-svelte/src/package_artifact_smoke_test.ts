import { assertEquals, assertStringIncludes } from "@std/assert";

const forbiddenBrowserArtifactPattern =
  /_dnt\.shims|@deno\/shim-deno|node:(?:fs|os|module)/;

type NpmPackageJson = {
  types: string;
  exports: {
    ".": {
      types: string;
      svelte: string;
      default: string;
    };
  };
};

type JsrDenoJson = {
  exports: {
    ".": string;
  };
  imports: Record<string, string>;
};

async function exists(url: URL): Promise<boolean> {
  try {
    await Deno.stat(url);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

async function readJson<T>(url: URL): Promise<T> {
  return JSON.parse(await Deno.readTextFile(url)) as T;
}

async function* walkFiles(dir: URL): AsyncGenerator<URL> {
  for await (const entry of Deno.readDir(dir)) {
    const url = new URL(`${entry.name}${entry.isDirectory ? "/" : ""}`, dir);
    if (entry.isDirectory) {
      yield* walkFiles(url);
      continue;
    }
    yield url;
  }
}

Deno.test("trellis-svelte npm artifact uses generated declaration entrypoints", async () => {
  const packageJsonUrl = new URL("../npm/package.json", import.meta.url);
  if (!(await exists(packageJsonUrl))) return;

  const packageJson = await readJson<NpmPackageJson>(packageJsonUrl);
  assertEquals(packageJson.types, "./dist/index.d.ts");
  assertEquals(packageJson.exports["."].types, "./dist/index.d.ts");
  assertEquals(packageJson.exports["."].svelte, "./dist/index.js");
  assertEquals(packageJson.exports["."].default, "./dist/index.js");
  await Deno.stat(new URL("../npm/dist/index.d.ts", import.meta.url));
});

Deno.test("trellis-svelte npm provider imports Trellis browser entrypoint", async () => {
  const providerUrl = new URL(
    "../npm/dist/components/TrellisProvider.svelte",
    import.meta.url,
  );
  if (!(await exists(providerUrl))) return;

  const source = await Deno.readTextFile(providerUrl);
  assertStringIncludes(source, 'from "@qlever-llc/trellis/browser"');
  assertEquals(source.includes('from "@qlever-llc/trellis"'), false);
  assertEquals(forbiddenBrowserArtifactPattern.test(source), false);
});

Deno.test("trellis-svelte JSR artifact exports compiled JavaScript with self types", async () => {
  const denoJsonUrl = new URL("../jsr/deno.json", import.meta.url);
  if (!(await exists(denoJsonUrl))) return;

  const denoJson = await readJson<JsrDenoJson>(denoJsonUrl);
  assertEquals(denoJson.exports["."], "./dist/index.js");
  assertStringIncludes(
    denoJson.imports["@qlever-llc/trellis/browser"],
    "/browser",
  );
  assertStringIncludes(
    denoJson.imports["@qlever-llc/trellis/contracts"],
    "/contracts",
  );

  const indexSource = await Deno.readTextFile(
    new URL("../jsr/dist/index.js", import.meta.url),
  );
  assertStringIncludes(indexSource, '// @ts-self-types="./index.d.ts"');
  assertStringIncludes(
    indexSource,
    'from "./components/TrellisProvider.js"',
  );
  assertEquals(indexSource.includes(".svelte"), false);

  const providerSource = await Deno.readTextFile(
    new URL("../jsr/dist/components/TrellisProvider.js", import.meta.url),
  );
  assertStringIncludes(providerSource, 'from "@qlever-llc/trellis/browser"');
  assertEquals(providerSource.includes('from "@qlever-llc/trellis"'), false);
  assertEquals(forbiddenBrowserArtifactPattern.test(providerSource), false);
});

Deno.test("trellis-svelte JSR dist contains only generated JavaScript and declarations", async () => {
  const distUrl = new URL("../jsr/dist/", import.meta.url);
  if (!(await exists(distUrl))) return;

  let jsFiles = 0;
  for await (const fileUrl of walkFiles(distUrl)) {
    assertEquals(fileUrl.pathname.endsWith(".svelte"), false, fileUrl.pathname);
    if (!fileUrl.pathname.endsWith(".js")) continue;

    jsFiles += 1;
    const source = await Deno.readTextFile(fileUrl);
    assertStringIncludes(source, "@ts-self-types", fileUrl.pathname);
  }

  assertEquals(jsFiles > 0, true);
});
