import { build, emptyDir } from "@deno/dnt";
import { basename, join } from "@std/path";
import {
  resolveInternalNpmDependenciesForBuild,
  resolvePackageBuildVersion,
} from "../release/release_version.ts";

type BuildDntPackageOptions = {
  buildRoot?: string;
  denoConfigPath?: string;
  entryPoints: string[];
    description: string;
  dependencies?: Record<string, string>;
  outDir?: string;
  peerDependencies?: Record<string, string>;
  npmInstallDeps?: Record<string, string>;
  typeCheck?: false | "both" | "single";
  externalizePackageDirs?: Record<string, string>;
};

const repositoryUrl = "git+https://github.com/Qlever-LLC/trellis.git";

function commonPackageMetadata() {
  return {
    homepage: "https://github.com/Qlever-LLC/trellis#readme",
    bugs: {
      url: "https://github.com/Qlever-LLC/trellis/issues",
    },
    repository: {
      type: "git",
      url: repositoryUrl,
    },
  };
}

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
  const packageDir = Deno.cwd();
  const buildRoot = options.buildRoot ? join(packageDir, options.buildRoot) : packageDir;
  const denoConfigPath = options.denoConfigPath ? join(packageDir, options.denoConfigPath) : join(packageDir, "deno.json");
  const denoConfig = JSON.parse(await Deno.readTextFile(denoConfigPath));
  const name = denoConfig.name as string;
  const version = resolvePackageBuildVersion(denoConfig.version as string);
  const outDir = options.outDir ? join(packageDir, options.outDir) : join(packageDir, "npm");
  const npmInstallDeps = resolveInternalNpmDependenciesForBuild(options.npmInstallDeps);
  const dependencies = resolveInternalNpmDependenciesForBuild(options.dependencies);
  const peerDependencies = resolveInternalNpmDependenciesForBuild(options.peerDependencies);

  await emptyDir(outDir);

  const previousCwd = Deno.cwd();
  Deno.chdir(buildRoot);
  try {
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
        ...commonPackageMetadata(),
        publishConfig: {
          access: "public",
        },
        dependencies: {
          ...(npmInstallDeps ?? {}),
        },
        peerDependencies,
      },
    });
  } finally {
    Deno.chdir(previousCwd);
  }

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
    ...(dependencies ?? {}),
  };
  if (!Object.keys(packageJson.dependencies).length) {
    delete packageJson.dependencies;
  }
  if (peerDependencies && Object.keys(peerDependencies).length) {
    packageJson.peerDependencies = peerDependencies;
  }
  await Deno.writeTextFile(packageJsonPath, JSON.stringify(packageJson, null, 2) + "\n");

  for (const [dirName, packageName] of Object.entries(options.externalizePackageDirs ?? {})) {
    await externalizeCopiedPackageDir(outDir, dirName, packageName);
  }

  try {
    await Deno.copyFile(join(packageDir, "README.md"), join(outDir, "README.md"));
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) {
      throw error;
    }
  }

  console.log(`Built ${name}@${version} in ${basename(outDir)}`);
}
