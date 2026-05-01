import { basename, join, relative, SEPARATOR } from "@std/path";

const jsRootUrl = new URL("../../", import.meta.url);
const jsRoot = jsRootUrl.pathname;
const repoRoot = new URL("../", jsRootUrl).pathname;
const distDir = join(repoRoot, "dist", "npm");

const packages = [
  "packages/result/npm",
  "packages/trellis/npm",
  "packages/trellis-svelte/npm",
] as const;

const runtimeImports = [
  "@qlever-llc/result",
  "@qlever-llc/trellis",
  "@qlever-llc/trellis/auth",
  "@qlever-llc/trellis/contracts",
  "@qlever-llc/trellis/errors",
  "@qlever-llc/trellis/health",
  "@qlever-llc/trellis/host",
  "@qlever-llc/trellis/host/node",
  "@qlever-llc/trellis/sdk/activity",
  "@qlever-llc/trellis/sdk/auth",
  "@qlever-llc/trellis/sdk/core",
  "@qlever-llc/trellis/sdk/health",
  "@qlever-llc/trellis/sdk/jobs",
  "@qlever-llc/trellis/sdk/state",
  "@qlever-llc/trellis/service",
  "@qlever-llc/trellis/service/node",
  "@qlever-llc/trellis/tracing",
] as const;

async function run(
  command: string,
  args: string[],
  options: { cwd?: string; capture?: boolean } = {},
): Promise<string> {
  const process = new Deno.Command(command, {
    args,
    cwd: options.cwd,
    stdout: options.capture ? "piped" : "inherit",
    stderr: "inherit",
  });
  const output = await process.output();
  if (!output.success) {
    throw new Error(
      `Command failed: ${command} ${args.join(" ")} (${output.code})`,
    );
  }
  return options.capture ? new TextDecoder().decode(output.stdout) : "";
}

function tarballName(packageJson: { name: string; version: string }): string {
  const packageName = packageJson.name.replace(/^@/, "").replaceAll("/", "-");
  return `${packageName}-${packageJson.version}.tgz`;
}

async function packPackages(): Promise<string[]> {
  await Deno.remove(distDir, { recursive: true }).catch((error) => {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  });
  await Deno.mkdir(distDir, { recursive: true });

  const tarballs: string[] = [];
  for (const packageDir of packages) {
    const packageJsonPath = join(jsRoot, packageDir, "package.json");
    const packageJson = JSON.parse(
      await Deno.readTextFile(packageJsonPath),
    ) as {
      name: string;
      version: string;
    };
    await run("npm", [
      "pack",
      join(jsRoot, packageDir),
      "--pack-destination",
      distDir,
    ]);
    tarballs.push(join(distDir, tarballName(packageJson)));
  }
  return tarballs;
}

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

async function assertNoGeneratedBuildReferences(projectDir: string) {
  const packageDir = join(
    projectDir,
    "node_modules",
    "@qlever-llc",
    "trellis",
  );
  const offenders: string[] = [];
  for await (const filePath of walkFiles(packageDir)) {
    if (!filePath.endsWith(".js") && !filePath.endsWith(".d.ts")) continue;
    const source = await Deno.readTextFile(filePath);
    if (source.includes(".build/generated-sdk")) {
      offenders.push(relative(packageDir, filePath).replaceAll(SEPARATOR, "/"));
    }
  }

  if (offenders.length) {
    throw new Error(
      `Packed @qlever-llc/trellis references private generated SDK build paths:\n${
        offenders.join("\n")
      }`,
    );
  }
}

async function writeConsumerProject(projectDir: string) {
  await Deno.writeTextFile(
    join(projectDir, "package.json"),
    JSON.stringify({ type: "module", private: true }, null, 2) + "\n",
  );
  await Deno.writeTextFile(
    join(projectDir, "smoke.mjs"),
    runtimeImports.map((specifier) =>
      `await import(${JSON.stringify(specifier)});`
    )
      .join("\n") + '\nconsole.log("ESM imports ok");\n',
  );
  await Deno.writeTextFile(
    join(projectDir, "smoke.cjs"),
    runtimeImports.map((specifier) => `require(${JSON.stringify(specifier)});`)
      .join("\n") + '\nconsole.log("CJS imports ok");\n',
  );
  await Deno.writeTextFile(
    join(projectDir, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          strict: true,
          skipLibCheck: false,
          allowArbitraryExtensions: true,
          allowImportingTsExtensions: true,
          types: ["svelte"],
        },
        include: ["index.ts"],
      },
      null,
      2,
    ) + "\n",
  );
  await Deno.writeTextFile(
    join(projectDir, "index.ts"),
    `import { Result } from "@qlever-llc/result";
import { ValidationError } from "@qlever-llc/trellis";
import { API, useDefaults, type Client } from "@qlever-llc/trellis/sdk/auth";
import { createTrellisApp, TrellisProvider, type TrellisProviderProps } from "@qlever-llc/trellis-svelte";

type AuthClient = Client;
type ProviderProps = TrellisProviderProps;

const defaults = useDefaults();
const rpc = API.owned.rpc;

void Result;
void ValidationError;
void createTrellisApp;
void TrellisProvider;
void defaults;
void rpc;

export type { AuthClient, ProviderProps };
`,
  );
}

const tarballs = await packPackages();
const projectDir = await Deno.makeTempDir({ prefix: "trellis-npm-smoke-" });
console.log(`Created npm smoke project at ${projectDir}`);
await writeConsumerProject(projectDir);
await run("npm", [
  "install",
  "--no-package-lock",
  "--ignore-scripts",
  ...tarballs,
  "typescript",
  "svelte",
], { cwd: projectDir });
await assertNoGeneratedBuildReferences(projectDir);
await run("node", ["smoke.mjs"], { cwd: projectDir });
await run("node", ["smoke.cjs"], { cwd: projectDir });
await run("npx", ["tsc", "--noEmit"], { cwd: projectDir });

console.log(
  `NPM smoke passed for ${tarballs.map((path) => basename(path)).join(", ")}`,
);
