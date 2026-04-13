import { emptyDir } from "@deno/dnt";
import { dirname, join } from "@std/path";
import {
  resolveInternalNpmDependenciesForBuild,
  resolvePackageBuildVersion,
} from "../release/release_version.ts";

type BuildSourcePackageOptions = {
  description: string;
  files: string[];
  exports: Record<string, unknown>;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  extraPackageJson?: Record<string, unknown>;
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

export async function buildSourcePackage(options: BuildSourcePackageOptions) {
  const denoConfig = JSON.parse(await Deno.readTextFile("./deno.json"));
  const name = denoConfig.name as string;
  const version = resolvePackageBuildVersion(denoConfig.version as string);
  const outDir = "./npm";
  const dependencies = resolveInternalNpmDependenciesForBuild(options.dependencies);
  const peerDependencies = resolveInternalNpmDependenciesForBuild(options.peerDependencies);

  await emptyDir(outDir);

  for (const file of options.files) {
    const destination = join(outDir, file);
    await Deno.mkdir(dirname(destination), { recursive: true });
    await Deno.copyFile(file, destination);
  }

  try {
    await Deno.copyFile("README.md", join(outDir, "README.md"));
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) {
      throw error;
    }
  }

  await Deno.writeTextFile(
    join(outDir, "package.json"),
    JSON.stringify(
      {
        name,
        version,
        type: "module",
        description: options.description,
        license: "Apache-2.0",
        ...commonPackageMetadata(),
        publishConfig: {
          access: "public",
        },
        files: ["src", "README.md"],
        exports: options.exports,
        dependencies,
        peerDependencies,
        ...options.extraPackageJson,
      },
      null,
      2,
    ) + "\n",
  );

  console.log(`Built ${name}@${version} in npm`);
}
