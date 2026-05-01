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

type PackageJson = {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

type PackedPackage = {
  packageJson: PackageJson;
  tarball: string;
};

type Semver = {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
};

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

function parseSemver(version: string): Semver | undefined {
  const match = version.match(
    /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/,
  );
  if (!match) return undefined;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4]?.split(".") ?? [],
  };
}

function compareIdentifiers(left: string, right: string): number {
  const leftNumber = left.match(/^\d+$/) ? Number(left) : undefined;
  const rightNumber = right.match(/^\d+$/) ? Number(right) : undefined;
  if (leftNumber !== undefined && rightNumber !== undefined) {
    return Math.sign(leftNumber - rightNumber);
  }
  if (leftNumber !== undefined) return -1;
  if (rightNumber !== undefined) return 1;
  return left.localeCompare(right);
}

function compareSemver(left: Semver, right: Semver): number {
  const releaseDiff = left.major - right.major || left.minor - right.minor ||
    left.patch - right.patch;
  if (releaseDiff !== 0) return Math.sign(releaseDiff);
  if (!left.prerelease.length && !right.prerelease.length) return 0;
  if (!left.prerelease.length) return 1;
  if (!right.prerelease.length) return -1;
  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftIdentifier = left.prerelease[index];
    const rightIdentifier = right.prerelease[index];
    if (leftIdentifier === undefined) return -1;
    if (rightIdentifier === undefined) return 1;
    const diff = compareIdentifiers(leftIdentifier, rightIdentifier);
    if (diff !== 0) return diff;
  }
  return 0;
}

function caretUpperBound(version: Semver): Semver {
  if (version.major > 0) {
    return { major: version.major + 1, minor: 0, patch: 0, prerelease: [] };
  }
  if (version.minor > 0) {
    return { major: 0, minor: version.minor + 1, patch: 0, prerelease: [] };
  }
  return { major: 0, minor: 0, patch: version.patch + 1, prerelease: [] };
}

function satisfiesVersionSpec(version: string, spec: string): boolean {
  const actual = parseSemver(version);
  if (!actual) return false;
  const exact = parseSemver(spec);
  if (exact) return compareSemver(actual, exact) === 0;
  const caretMatch = spec.match(/^\^(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/);
  if (!caretMatch) return true;
  const minimum = parseSemver(caretMatch[1]);
  if (!minimum) return false;
  return compareSemver(actual, minimum) >= 0 &&
    compareSemver(actual, caretUpperBound(minimum)) < 0;
}

function internalDependencies(
  packageJson: PackageJson,
): Record<string, string> {
  return {
    ...packageJson.dependencies,
    ...packageJson.peerDependencies,
    ...packageJson.devDependencies,
  };
}

function assertLocalInternalDependencyVersions(packages: PackedPackage[]) {
  const localVersions = new Map(
    packages.map(({ packageJson }) => [packageJson.name, packageJson.version]),
  );
  const failures: string[] = [];

  for (const { packageJson } of packages) {
    for (
      const [dependencyName, spec] of Object.entries(
        internalDependencies(packageJson),
      )
    ) {
      const localVersion = localVersions.get(dependencyName);
      if (!localVersion || satisfiesVersionSpec(localVersion, spec)) continue;
      failures.push(
        `Stale npm artifact: ${dependencyName} package is ${localVersion} but ${packageJson.name} requires ${spec}.`,
      );
    }
  }

  if (failures.length) {
    throw new Error(
      `${failures.join("\n")}\nRun deno task packages:build:npm.`,
    );
  }
}

async function packPackages(): Promise<PackedPackage[]> {
  await Deno.remove(distDir, { recursive: true }).catch((error) => {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  });
  await Deno.mkdir(distDir, { recursive: true });

  const packedPackages: PackedPackage[] = [];
  for (const packageDir of packages) {
    const packageJsonPath = join(jsRoot, packageDir, "package.json");
    const packageJson = JSON.parse(
      await Deno.readTextFile(packageJsonPath),
    ) as PackageJson;
    await run("npm", [
      "pack",
      join(jsRoot, packageDir),
      "--pack-destination",
      distDir,
    ]);
    packedPackages.push({
      packageJson,
      tarball: join(distDir, tarballName(packageJson)),
    });
  }
  assertLocalInternalDependencyVersions(packedPackages);
  return packedPackages;
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
import { useDefaults as useHealthDefaults } from "@qlever-llc/trellis/sdk/health";
import { useDefaults as useStateDefaults } from "@qlever-llc/trellis/sdk/state";
import { createTrellisApp, TrellisProvider, type TrellisProviderProps } from "@qlever-llc/trellis-svelte";

type AuthClient = Client;
type ProviderProps = TrellisProviderProps;

const defaults = useDefaults();
const healthDefaults = useHealthDefaults();
const stateDefaults = useStateDefaults();
const rpc = API.owned.rpc;

void Result;
void ValidationError;
void createTrellisApp;
void TrellisProvider;
void defaults;
void healthDefaults;
void stateDefaults;
void rpc;

export type { AuthClient, ProviderProps };
`,
  );
}

const packedPackages = await packPackages();
const tarballs = packedPackages.map(({ tarball }) => tarball);
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
