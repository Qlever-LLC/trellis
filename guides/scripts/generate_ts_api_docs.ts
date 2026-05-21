const repoRoot = new URL("../../", import.meta.url);
const jsRoot = new URL("js/", repoRoot);
const output = new URL("guides/static/api/typescript", repoRoot);
const outputParent = new URL("./", output);
const workspaceConfigUrl = new URL("deno.json", jsRoot);

type PackageExports = string | Record<string, string>;

const npmOnlyPublicEntrypointsByPackage: Record<string, string[]> = {
  "packages/trellis": [
    "device.ts",
    "host/mod.ts",
    "host/node.ts",
  ],
};

interface JsWorkspaceConfig {
  workspace: string[];
}

interface JsPackageConfig {
  name: string;
  exports: PackageExports;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) &&
    Object.values(value).every((entry) => typeof entry === "string");
}

function isJsWorkspaceConfig(value: unknown): value is JsWorkspaceConfig {
  return isRecord(value) && Array.isArray(value.workspace) &&
    value.workspace.every((entry) => typeof entry === "string");
}

function isPackageExports(value: unknown): value is PackageExports {
  return typeof value === "string" || isStringRecord(value);
}

function isJsPackageConfig(value: unknown): value is JsPackageConfig {
  if (!isRecord(value) || typeof value.name !== "string") {
    return false;
  }

  return isPackageExports(value.exports);
}

function exportPaths(exports: PackageExports) {
  return typeof exports === "string" ? [exports] : Object.values(exports);
}

async function existingNpmOnlyEntrypoints(
  packageRoot: string,
): Promise<string[]> {
  const entrypoints = npmOnlyPublicEntrypointsByPackage[packageRoot] ?? [];
  const existing = await Promise.all(
    entrypoints.map(async (entrypoint) => {
      try {
        const stat = await Deno.stat(
          new URL(`${packageRoot}/${entrypoint}`, jsRoot),
        );
        return stat.isFile ? `${packageRoot}/${entrypoint}` : null;
      } catch (error) {
        if (error instanceof Deno.errors.NotFound) return null;
        throw error;
      }
    }),
  );

  return existing.filter((entrypoint) => entrypoint !== null);
}

const workspaceConfig: unknown = JSON.parse(
  await Deno.readTextFile(workspaceConfigUrl),
);

if (!isJsWorkspaceConfig(workspaceConfig)) {
  throw new Error("Expected js/deno.json to contain a string workspace list");
}

const packageWorkspaces = workspaceConfig.workspace.filter((workspace) =>
  workspace.startsWith("./packages/")
);

const packageEntryPoints = await Promise.all(
  packageWorkspaces.map(async (workspace) => {
    const packageConfigUrl = new URL(`${workspace}/deno.json`, jsRoot);
    const packageConfig: unknown = JSON.parse(
      await Deno.readTextFile(packageConfigUrl),
    );

    if (!isJsPackageConfig(packageConfig)) {
      throw new Error(
        `Expected ${workspace}/deno.json to contain a package name and string exports`,
      );
    }

    const packageRoot = workspace.replace(/^\.\//, "");
    const denoEntrypoints = exportPaths(packageConfig.exports).map((
      exportPath,
    ) => `${packageRoot}/${exportPath.replace(/^\.\//, "")}`);
    const npmOnlyEntrypoints = await existingNpmOnlyEntrypoints(packageRoot);
    return [...denoEntrypoints, ...npmOnlyEntrypoints];
  }),
);

const entrypoints = [...new Set(packageEntryPoints.flat())];

await Deno.mkdir(outputParent, { recursive: true });
await Deno.remove(output, { recursive: true }).catch((error) => {
  if (!(error instanceof Deno.errors.NotFound)) {
    throw error;
  }
});

const command = new Deno.Command(Deno.execPath(), {
  cwd: jsRoot,
  args: [
    "doc",
    "--html",
    "--quiet",
    "--name=Trellis TypeScript API",
    "--output=../guides/static/api/typescript",
    ...entrypoints,
  ],
});

const result = await command.spawn().status;
if (!result.success) {
  Deno.exit(result.code);
}

console.log(
  `Generated TypeScript API docs for ${entrypoints.length} package entrypoints from ${packageWorkspaces.length} packages`,
);
