import { emptyDir } from "jsr:@deno/dnt@^0.41.3";
import { dirname, join } from "@std/path";

type BuildSourcePackageOptions = {
  description: string;
  files: string[];
  exports: Record<string, unknown>;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  extraPackageJson?: Record<string, unknown>;
};

export async function buildSourcePackage(options: BuildSourcePackageOptions) {
  const denoConfig = JSON.parse(await Deno.readTextFile("./deno.json"));
  const name = denoConfig.name as string;
  const version = denoConfig.version as string;
  const outDir = "./npm";

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
        publishConfig: {
          access: "restricted",
        },
        files: ["src", "README.md"],
        exports: options.exports,
        dependencies: options.dependencies,
        peerDependencies: options.peerDependencies,
        ...options.extraPackageJson,
      },
      null,
      2,
    ) + "\n",
  );

  console.log(`Built ${name}@${version} in npm`);
}
