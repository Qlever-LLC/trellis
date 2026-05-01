import { assertEquals } from "@std/assert";
import { join } from "@std/path";

const forbiddenImportPattern =
  /(?:from|require\()\s*["']@qlever-llc\/trellis-(?!sdk\b)[^"']+["']/;
const staleCliArtifactPattern =
  /defineCliContract|"service" \| "app" \| "device" \| "cli"|defineClientContract\("cli"/;
const privateGeneratedSdkBuildPattern = /\.build\/generated-sdk/;
const dntShimDenoRuntimeDetectionPattern = /"Deno" in dntShim\.dntGlobalThis/;

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
    assertEquals(privateGeneratedSdkBuildPattern.test(source), false, filePath);
  }

  for await (const filePath of walkFiles(join(npmDir.pathname, "script"))) {
    if (!filePath.endsWith(".js") && !filePath.endsWith(".d.ts")) continue;
    const source = await Deno.readTextFile(filePath);
    assertEquals(forbiddenImportPattern.test(source), false, filePath);
    assertEquals(staleCliArtifactPattern.test(source), false, filePath);
    assertEquals(privateGeneratedSdkBuildPattern.test(source), false, filePath);
  }
});

Deno.test("trellis npm SDK exports resolve through public wrapper modules", async () => {
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
  assertEquals(packageJson.exports["./sdk/activity"], {
    import: "./esm/npm/src/sdk/activity.js",
    require: "./script/npm/src/sdk/activity.js",
  });
  assertEquals(packageJson.exports["./sdk/auth"], {
    import: "./esm/npm/src/sdk/auth.js",
    require: "./script/npm/src/sdk/auth.js",
  });
  assertEquals(packageJson.exports["./sdk/core"], {
    import: "./esm/npm/src/sdk/core.js",
    require: "./script/npm/src/sdk/core.js",
  });
  assertEquals(packageJson.exports["./sdk/health"], {
    import: "./esm/npm/src/sdk/health.js",
    require: "./script/npm/src/sdk/health.js",
  });
  assertEquals(packageJson.exports["./sdk/jobs"], {
    import: "./esm/npm/src/sdk/jobs.js",
    require: "./script/npm/src/sdk/jobs.js",
  });
  assertEquals(packageJson.exports["./sdk/state"], {
    import: "./esm/npm/src/sdk/state.js",
    require: "./script/npm/src/sdk/state.js",
  });

  const authWrapper = await Deno.readTextFile(
    new URL("../npm/esm/npm/src/sdk/auth.js", import.meta.url),
  );
  assertEquals(authWrapper.includes("useDefaults"), false);
  const authGeneratedMod = await Deno.readTextFile(
    new URL("../npm/esm/generated-sdk/auth/mod.js", import.meta.url),
  );
  assertEquals(authGeneratedMod.includes("useDefaults"), false);
  const coreGeneratedMod = await Deno.readTextFile(
    new URL("../npm/esm/generated-sdk/trellis-core/mod.js", import.meta.url),
  );
  assertEquals(coreGeneratedMod.includes(" use,"), true);
  const healthWrapper = await Deno.readTextFile(
    new URL("../npm/esm/npm/src/sdk/health.js", import.meta.url),
  );
  assertEquals(healthWrapper.includes("useDefaults"), false);
  const stateWrapper = await Deno.readTextFile(
    new URL("../npm/esm/npm/src/sdk/state.js", import.meta.url),
  );
  assertEquals(stateWrapper.includes("useDefaults"), false);

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

  const healthWrapperTypes = await Deno.readTextFile(
    new URL("../npm/esm/npm/src/sdk/health.d.ts", import.meta.url),
  );
  assertEquals(
    healthWrapperTypes.includes(
      'import type { TrellisAPI } from "@qlever-llc/trellis/contracts";',
    ),
    true,
  );
  const stateWrapperTypes = await Deno.readTextFile(
    new URL("../npm/esm/npm/src/sdk/state.d.ts", import.meta.url),
  );
  assertEquals(
    stateWrapperTypes.includes(
      'import type { TrellisAPI } from "@qlever-llc/trellis/contracts";',
    ),
    true,
  );

  const activityApi = await Deno.readTextFile(
    new URL("../npm/esm/generated-sdk/activity/api.js", import.meta.url),
  );
  assertEquals(activityApi.includes("../../../sdk/"), false);
  assertEquals(activityApi.includes("../../sdk/"), false);
  assertEquals(
    activityApi.includes('from "@qlever-llc/trellis/sdk/health"'),
    true,
  );

  await assertNotExists(
    new URL("../npm/esm/npm/src/.build/generated-sdk", import.meta.url),
  );
  await assertNotExists(
    new URL("../npm/script/npm/src/.build/generated-sdk", import.meta.url),
  );
});

Deno.test("trellis npm runtime transport falls back to npm native transport in Deno", async () => {
  const packageJsonUrl = new URL("../npm/package.json", import.meta.url);
  const esmRuntimeTransport = new URL(
    "../npm/esm/npm/src/runtime_transport.js",
    import.meta.url,
  );
  const scriptRuntimeTransport = new URL(
    "../npm/script/npm/src/runtime_transport.js",
    import.meta.url,
  );

  try {
    await Deno.stat(packageJsonUrl);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return;
    throw error;
  }

  await Deno.stat(esmRuntimeTransport);
  await Deno.stat(scriptRuntimeTransport);

  for (const path of [esmRuntimeTransport, scriptRuntimeTransport]) {
    const source = await Deno.readTextFile(path);
    assertEquals(
      source.includes('["@nats-io", "transport-deno"].join("/")'),
      true,
      path.pathname,
    );
    assertEquals(
      source.includes('"transport-node"'),
      true,
      path.pathname,
    );
    assertEquals(
      dntShimDenoRuntimeDetectionPattern.test(source),
      false,
      path.pathname,
    );
  }
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
