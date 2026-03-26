import { build, emptyDir } from "jsr:@deno/dnt@^0.41.3";
import { basename, join } from "@std/path";

type BuildDntPackageOptions = {
  entryPoints: string[];
  description: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  npmInstallDeps?: Record<string, string>;
  typeCheck?: false | "both" | "single";
  externalizePackageDirs?: Record<string, string>;
};

async function* walkFiles(dir: string): AsyncGenerator<string> {
  for await (const entry of Deno.readDir(dir)) {
    const entryPath = join(dir, entry.name);
    if (entry.isDirectory) {
      yield* walkFiles(entryPath);
    } else {
      yield entryPath;
    }
  }
}

async function externalizeCopiedPackageDir(
  outDir: string,
  dirName: string,
  packageName: string,
) {
  const matcher = new RegExp(`(["'])((?:../)+)${dirName}/(?:mod|index)\\.js\\1`, "g");
  const requireMatcher = new RegExp(`require\\((["'])((?:../)+)${dirName}/(?:mod|index)\\.js\\1\\)`, "g");

  for await (const filePath of walkFiles(outDir)) {
    if (!filePath.endsWith(".js") && !filePath.endsWith(".d.ts")) {
      continue;
    }

    const original = await Deno.readTextFile(filePath);
    const updated = original
      .replace(matcher, `$1${packageName}$1`)
      .replace(requireMatcher, `require($1${packageName}$1)`);

    if (updated !== original) {
      await Deno.writeTextFile(filePath, updated);
    }
  }

  for (const formatDir of ["esm", "script"]) {
    const copiedDir = join(outDir, formatDir, dirName);
    await Deno.remove(copiedDir, { recursive: true }).catch((error) => {
      if (!(error instanceof Deno.errors.NotFound)) {
        throw error;
      }
    });
  }
}

export async function buildDntPackage(options: BuildDntPackageOptions) {
  const denoConfig = JSON.parse(await Deno.readTextFile("./deno.json"));
  const name = denoConfig.name as string;
  const version = denoConfig.version as string;
  const outDir = "./npm";

  await emptyDir(outDir);

  await build({
    entryPoints: options.entryPoints,
    outDir,
    shims: {
      deno: true,
    },
    test: false,
    typeCheck: options.typeCheck ?? false,
    package: {
      name,
      version,
      description: options.description,
      license: "Apache-2.0",
      publishConfig: {
        access: "restricted",
      },
      dependencies: {
        ...(options.npmInstallDeps ?? {}),
      },
      peerDependencies: options.peerDependencies,
    },
  });

  const packageJsonPath = join(outDir, "package.json");
  const packageJson = JSON.parse(await Deno.readTextFile(packageJsonPath));
  if (packageJson.exports) {
    packageJson.exports = Object.fromEntries(
      Object.entries(packageJson.exports).map(([key, value]) => [
        key.endsWith(".js") ? key.slice(0, -3) : key,
        value,
      ]),
    );
  }
  packageJson.dependencies = {
    ...(packageJson.dependencies ?? {}),
    ...(options.dependencies ?? {}),
  };
  if (!Object.keys(packageJson.dependencies).length) {
    delete packageJson.dependencies;
  }
  if (options.peerDependencies && Object.keys(options.peerDependencies).length) {
    packageJson.peerDependencies = options.peerDependencies;
  }
  await Deno.writeTextFile(packageJsonPath, JSON.stringify(packageJson, null, 2) + "\n");

  for (const [dirName, packageName] of Object.entries(options.externalizePackageDirs ?? {})) {
    await externalizeCopiedPackageDir(outDir, dirName, packageName);
  }

  try {
    await Deno.copyFile("README.md", join(outDir, "README.md"));
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) {
      throw error;
    }
  }

  console.log(`Built ${name}@${version} in ${basename(outDir)}`);
}
