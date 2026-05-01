import { assertEquals } from "@std/assert";
import { join } from "@std/path";

const forbiddenImportPattern =
  /(?:from|require\()\s*["']@qlever-llc\/trellis-(?!sdk\b)[^"']+["']/;
const staleCliArtifactPattern =
  /defineCliContract|"service" \| "app" \| "device" \| "cli"|defineClientContract\("cli"/;

async function* walkFiles(dir: string): AsyncGenerator<string> {
  for await (const entry of Deno.readDir(dir)) {
    const path = join(dir, entry.name);
    if (entry.isDirectory) {
      yield* walkFiles(path);
    } else {
      yield path;
    }
  }
}

Deno.test("trellis npm artifact only depends on allowed published Trellis packages", async () => {
  const npmDir = new URL("../npm", import.meta.url);
  try {
    await Deno.stat(new URL("../npm/package.json", import.meta.url));
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return;
    }
    throw error;
  }
  const packageJson = JSON.parse(
    await Deno.readTextFile(new URL("../npm/package.json", import.meta.url)),
  );

  assertEquals(
    Object.keys(packageJson.dependencies).includes("@qlever-llc/result"),
    true,
  );
  assertEquals(
    Object.keys(packageJson.dependencies).some((name: string) =>
      name.startsWith("@qlever-llc/trellis-")
    ),
    false,
  );

  for await (const filePath of walkFiles(join(npmDir.pathname, "esm"))) {
    if (!filePath.endsWith(".js") && !filePath.endsWith(".d.ts")) continue;
    const source = await Deno.readTextFile(filePath);
    assertEquals(forbiddenImportPattern.test(source), false, filePath);
    assertEquals(staleCliArtifactPattern.test(source), false, filePath);
  }

  for await (const filePath of walkFiles(join(npmDir.pathname, "script"))) {
    if (!filePath.endsWith(".js") && !filePath.endsWith(".d.ts")) continue;
    const source = await Deno.readTextFile(filePath);
    assertEquals(forbiddenImportPattern.test(source), false, filePath);
    assertEquals(staleCliArtifactPattern.test(source), false, filePath);
  }
});

Deno.test("trellis npm SDK exports resolve through canonical generated SDK artifacts", async () => {
  const packageJsonUrl = new URL("../npm/package.json", import.meta.url);
  try {
    await Deno.stat(packageJsonUrl);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return;
    }
    throw error;
  }

  const packageJson = JSON.parse(await Deno.readTextFile(packageJsonUrl));
  assertEquals(packageJson.exports["./sdk/auth"], {
    import: "./esm/generated-sdk/auth/mod.js",
    require: "./script/generated-sdk/auth/mod.js",
  });

  const authClientTypes = await Deno.readTextFile(
    new URL("../npm/esm/generated-sdk/auth/client.d.ts", import.meta.url),
  );
  assertEquals(authClientTypes.includes('from "@qlever-llc/trellis"'), true);
  assertEquals(authClientTypes.includes("npm/src/errors"), false);
  assertEquals(authClientTypes.includes("../errors"), false);

  const authApiTypes = await Deno.readTextFile(
    new URL("../npm/esm/generated-sdk/auth/api.d.ts", import.meta.url),
  );
  assertEquals(
    authApiTypes.includes(
      'import type { TrellisAPI } from "@qlever-llc/trellis/contracts";',
    ),
    true,
  );

  await assertNotExists(
    new URL("../npm/esm/npm/src/.build/generated-sdk", import.meta.url),
  );
  await assertNotExists(
    new URL("../npm/script/npm/src/.build/generated-sdk", import.meta.url),
  );

  const sdkWrapper = await Deno.readTextFile(
    new URL("../npm/esm/npm/src/sdk/auth.js", import.meta.url),
  );
  assertEquals(sdkWrapper.includes("_dnt.polyfills.js"), false);
});

async function assertNotExists(url: URL): Promise<void> {
  try {
    await Deno.stat(url);
    throw new Error(`Expected ${url.pathname} not to exist`);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return;
    throw error;
  }
}
