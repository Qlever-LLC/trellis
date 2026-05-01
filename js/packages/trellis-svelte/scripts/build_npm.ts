import { emptyDir } from "@deno/dnt";
import { dirname, join } from "@std/path";
import { compileModule } from "svelte/compiler";
import ts from "typescript";
import {
  resolveInternalNpmDependenciesForBuild,
  resolvePackageBuildVersion,
} from "../../../tools/release/release_version.ts";

const description =
  "Svelte components and state helpers for Trellis browser applications.";
const repositoryUrl = "git+https://github.com/Qlever-LLC/trellis.git";
const outDir = "./npm";

const sourceFiles = [
  "src/index.ts",
  "src/context.svelte.ts",
  "src/portal_flow.svelte.ts",
  "src/device_activation.svelte.ts",
  "src/device_activation_controller.ts",
  "src/internal/activation_view.ts",
  "src/internal/callback_state.ts",
  "src/internal/portal_url.ts",
  "src/components/TrellisProvider.svelte",
  "src/components/TrellisContextProvider.svelte",
  "src/components/TrellisProvider.types.ts",
];

const dependencies = resolveInternalNpmDependenciesForBuild({
  "@nats-io/nats-core": "^3.3.1",
  "@qlever-llc/result": "^0.8.0",
  "@qlever-llc/trellis": "^0.8.0",
  typebox: "^1.0.15",
});
const peerDependencies = resolveInternalNpmDependenciesForBuild({
  svelte: "^5.0.0",
});

function rewriteRuntimeImports(code: string): string {
  return code
    .replace(
      /(from\s+["'])(\.{1,2}\/[^"']+?)\.svelte\.ts(["'])/g,
      "$1$2.js$3",
    )
    .replace(
      /(from\s+["'])(\.{1,2}\/[^"']+?)\.ts(["'])/g,
      "$1$2.js$3",
    );
}

function transpileTypeScript(code: string): string {
  return ts.transpileModule(code, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
      verbatimModuleSyntax: true,
    },
  }).outputText;
}

function distPathFor(sourceFile: string): string {
  if (sourceFile.endsWith(".svelte.ts")) {
    return join(
      outDir,
      sourceFile.replace(/^src\//, "dist/").replace(/\.svelte\.ts$/, ".js"),
    );
  }
  if (sourceFile.endsWith(".ts")) {
    return join(
      outDir,
      sourceFile.replace(/^src\//, "dist/").replace(/\.ts$/, ".js"),
    );
  }
  return join(outDir, sourceFile.replace(/^src\//, "dist/"));
}

async function writeFile(path: string, contents: string): Promise<void> {
  await Deno.mkdir(dirname(path), { recursive: true });
  await Deno.writeTextFile(path, contents);
}

async function copyFile(source: string, destination: string): Promise<void> {
  await Deno.mkdir(dirname(destination), { recursive: true });
  await Deno.copyFile(source, destination);
}

async function buildRuntimeFile(sourceFile: string): Promise<void> {
  const source = await Deno.readTextFile(sourceFile);
  const rewritten = rewriteRuntimeImports(source);
  const destination = distPathFor(sourceFile);

  if (sourceFile.endsWith(".svelte.ts")) {
    const transpiled = transpileTypeScript(rewritten);
    const compiled = compileModule(transpiled, {
      filename: destination,
      generate: "client",
      dev: false,
    });
    await writeFile(destination, compiled.js.code + "\n");
    return;
  }

  if (sourceFile.endsWith(".ts")) {
    await writeFile(destination, transpileTypeScript(rewritten));
    return;
  }

  await writeFile(destination, rewritten);
}

const denoConfig = JSON.parse(await Deno.readTextFile("./deno.json"));
const name = denoConfig.name as string;
const version = resolvePackageBuildVersion(denoConfig.version as string);

await emptyDir(outDir);

for (const sourceFile of sourceFiles) {
  await copyFile(sourceFile, join(outDir, sourceFile));
  await buildRuntimeFile(sourceFile);
}

try {
  await copyFile("README.md", join(outDir, "README.md"));
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
      description,
      license: "Apache-2.0",
      homepage: "https://github.com/Qlever-LLC/trellis#readme",
      bugs: {
        url: "https://github.com/Qlever-LLC/trellis/issues",
      },
      repository: {
        type: "git",
        url: repositoryUrl,
      },
      publishConfig: {
        access: "public",
      },
      files: ["dist", "src", "README.md"],
      exports: {
        ".": {
          types: "./src/index.ts",
          svelte: "./dist/index.js",
          default: "./dist/index.js",
        },
      },
      dependencies,
      peerDependencies,
      svelte: "./dist/index.js",
    },
    null,
    2,
  ) + "\n",
);

console.log(`Built ${name}@${version} in npm`);
