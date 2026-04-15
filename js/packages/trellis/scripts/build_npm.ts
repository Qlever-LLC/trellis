import { join } from "@std/path";
import { buildDntPackage } from "../../../tools/package_build/build_dnt_package.ts";

const packageDir = Deno.cwd();
const npmDir = join(packageDir, "npm");

type SdkVendor = {
  name: "activity" | "auth" | "core" | "state";
  packageName: string;
  sourceDir: string;
  buildDir: string;
};

const sdkVendors: SdkVendor[] = [
  {
    name: "activity",
    packageName: "@qlever-llc/trellis-sdk-activity",
    sourceDir: join(packageDir, "../../../generated/js/sdks/activity/npm"),
    buildDir: join(packageDir, "../../../generated/js/sdks/activity"),
  },
  {
    name: "auth",
    packageName: "@qlever-llc/trellis-sdk-auth",
    sourceDir: join(packageDir, "../../../generated/js/sdks/auth/npm"),
    buildDir: join(packageDir, "../../../generated/js/sdks/auth"),
  },
  {
    name: "core",
    packageName: "@qlever-llc/trellis-sdk-core",
    sourceDir: join(packageDir, "../../../generated/js/sdks/trellis-core/npm"),
    buildDir: join(packageDir, "../../../generated/js/sdks/trellis-core"),
  },
  {
    name: "state",
    packageName: "@qlever-llc/trellis-sdk-state",
    sourceDir: join(packageDir, "../../../generated/js/sdks/state/npm"),
    buildDir: join(packageDir, "../../../generated/js/sdks/state"),
  },
];

const workspaceConfigPath = join(packageDir, "../../deno.json");
const contractsNpmDir = join(packageDir, "../contracts/npm");
const contractsBuildDir = join(packageDir, "../contracts");

async function exists(path: string) {
  try {
    await Deno.stat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return false;
    }
    throw error;
  }
}

async function runDenoBuildScript(workDir: string) {
  const command = new Deno.Command(Deno.execPath(), {
    args: ["run", "--config", workspaceConfigPath, "-A", "./scripts/build_npm.ts"],
    cwd: workDir,
    stdin: "null",
    stdout: "inherit",
    stderr: "inherit",
  });
  const { code } = await command.spawn().status;
  if (code !== 0) {
    throw new Error(`Failed to build npm artifacts in ${workDir}`);
  }
}

async function ensureContractsNpmArtifacts() {
  if (await exists(join(contractsNpmDir, "esm"))) {
    return;
  }
  await runDenoBuildScript(contractsBuildDir);
}

async function ensureSdkNpmArtifacts() {
  await ensureContractsNpmArtifacts();

  for (const sdk of sdkVendors) {
    if (await exists(join(sdk.sourceDir, "esm"))) {
      continue;
    }
    await runDenoBuildScript(sdk.buildDir);
  }
}

async function copyDir(sourceDir: string, targetDir: string) {
  await Deno.mkdir(targetDir, { recursive: true });
  for await (const entry of Deno.readDir(sourceDir)) {
    const sourcePath = join(sourceDir, entry.name);
    const targetPath = join(targetDir, entry.name);
    if (entry.isDirectory) {
      await copyDir(sourcePath, targetPath);
    } else {
      await Deno.copyFile(sourcePath, targetPath);
    }
  }
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

async function replaceInFiles(
  dir: string,
  rewrite: (text: string, filePath: string) => string,
) {
  for await (const filePath of walkFiles(dir)) {
    if (
      !filePath.endsWith(".js") && !filePath.endsWith(".d.ts") &&
      !filePath.endsWith(".ts")
    ) {
      continue;
    }

    const original = await Deno.readTextFile(filePath);
    const updated = rewrite(original, filePath);
    if (updated !== original) {
      await Deno.writeTextFile(filePath, updated);
    }
  }
}

async function normalizePackageJson() {
  const packageJsonPath = join(npmDir, "package.json");
  const packageJson = JSON.parse(await Deno.readTextFile(packageJsonPath));

  packageJson.exports = {
    ".": {
      import: "./esm/trellis/index.js",
      require: "./script/trellis/index.js",
    },
    "./auth": {
      import: "./esm/trellis/auth.js",
      require: "./script/trellis/auth.js",
    },
    "./auth/browser": {
      import: "./esm/trellis/auth/browser.js",
      require: "./script/trellis/auth/browser.js",
    },
    "./browser": {
      import: "./esm/trellis/browser.js",
      require: "./script/trellis/browser.js",
    },
    "./contracts": {
      import: "./esm/trellis/contracts.js",
      require: "./script/trellis/contracts.js",
    },
    "./errors": {
      import: "./esm/trellis/errors/index.js",
      require: "./script/trellis/errors/index.js",
    },
    "./server": {
      import: "./esm/trellis/server/mod.js",
      require: "./script/trellis/server/mod.js",
    },
    "./server/health": {
      import: "./esm/trellis/server/health.js",
      require: "./script/trellis/server/health.js",
    },
    "./server/deno": {
      import: "./esm/trellis/server/deno.js",
      require: "./script/trellis/server/deno.js",
    },
    "./server/node": {
      import: "./esm/trellis/server/node.js",
      require: "./script/trellis/server/node.js",
    },
    "./server/runtime": {
      import: "./esm/trellis/server/runtime.js",
      require: "./script/trellis/server/runtime.js",
    },
    "./sdk/activity": {
      import: "./esm/trellis/sdk/activity.js",
      require: "./script/trellis/sdk/activity.js",
    },
    "./sdk/auth": {
      import: "./esm/trellis/sdk/auth.js",
      require: "./script/trellis/sdk/auth.js",
    },
    "./sdk/core": {
      import: "./esm/trellis/sdk/core.js",
      require: "./script/trellis/sdk/core.js",
    },
    "./sdk/state": {
      import: "./esm/trellis/sdk/state.js",
      require: "./script/trellis/sdk/state.js",
    },
    "./tracing": {
      import: "./esm/trellis/tracing.js",
      require: "./script/trellis/tracing.js",
    },
  };

  await Deno.writeTextFile(
    packageJsonPath,
    JSON.stringify(packageJson, null, 2) + "\n",
  );
}

async function removeIfExists(path: string) {
  await Deno.remove(path, { recursive: true }).catch((error) => {
    if (!(error instanceof Deno.errors.NotFound)) {
      throw error;
    }
  });
}

async function trimArtifact() {
  await removeIfExists(join(npmDir, "src"));
  await removeIfExists(join(npmDir, "esm", "trellis", "npm"));
  await removeIfExists(join(npmDir, "script", "trellis", "npm"));
}

async function vendorSdkArtifacts() {
  await ensureSdkNpmArtifacts();

  for (const sdk of sdkVendors) {
    for (const format of ["esm", "script"] as const) {
      const sourceDir = join(sdk.sourceDir, format);
      const targetDir = join(npmDir, format, "trellis", "_sdk", sdk.name);
      await copyDir(sourceDir, targetDir);
    }
  }

  for (const format of ["esm", "script"] as const) {
    const formatDir = join(npmDir, format, "trellis");

    await replaceInFiles(formatDir, (text, filePath) => {
      const sdkPathPrefix = filePath.includes(
          `${join("trellis", "sdk")}${filePath.includes("\\") ? "\\" : "/"}`,
        )
        ? "../_sdk"
        : "./_sdk";

      return text
        .replaceAll(
          "@qlever-llc/trellis-sdk-auth",
          `${sdkPathPrefix}/auth/mod.js`,
        )
        .replaceAll(
          "@qlever-llc/trellis-sdk-core",
          `${sdkPathPrefix}/core/mod.js`,
        )
        .replaceAll(
          "@qlever-llc/trellis-sdk-activity",
          `${sdkPathPrefix}/activity/mod.js`,
        )
        .replaceAll(
          "@qlever-llc/trellis-sdk-state",
          `${sdkPathPrefix}/state/mod.js`,
        );
    });

  }
}

await buildDntPackage({
  buildRoot: "../../..",
  denoConfigPath: "./deno.json",
  entryPoints: [
    "./js/packages/trellis/index.ts",
    "./js/packages/trellis/auth.ts",
    "./js/packages/trellis/auth/browser.ts",
    "./js/packages/trellis/browser.ts",
    "./js/packages/trellis/contracts.ts",
    "./js/packages/trellis/errors/index.ts",
    "./js/packages/trellis/server/mod.ts",
    "./js/packages/trellis/server/health.ts",
    "./js/packages/trellis/server/deno.ts",
    "./js/packages/trellis/server/node.ts",
    "./js/packages/trellis/server/runtime.ts",
    "./js/packages/trellis/sdk/activity.ts",
    "./js/packages/trellis/sdk/auth.ts",
    "./js/packages/trellis/sdk/core.ts",
    "./js/packages/trellis/sdk/state.ts",
    "./js/packages/trellis/tracing.ts",
  ],
  description:
    "Client-side Trellis runtime, models, and contract helpers for TypeScript applications.",
  dependencies: {
    "@opentelemetry/api": "^1.9.0",
    "@opentelemetry/exporter-trace-otlp-http": "^0.56.0",
    "@opentelemetry/resources": "^1.30.1",
    "@opentelemetry/sdk-trace-base": "^1.30.1",
    "@opentelemetry/sdk-trace-node": "^1.30.1",
    "@opentelemetry/semantic-conventions": "^1.28.0",
    "@nats-io/jetstream": "^3.3.0",
    "@nats-io/kv": "^3.2.0",
    "@nats-io/obj": "^3.3.1",
    "@nats-io/nats-core": "^3.3.1",
    "@nats-io/transport-node": "^3.3.1",
    "@qlever-llc/result": "^0.7.0",
    "json-schema-library": "^10.5.2",
    pino: "^9.11.0",
    "ts-deepmerge": "^7.0.3",
    typebox: "^1.0.15",
    ulid: "^3.0.1",
  },
  npmInstallDeps: {
    "@opentelemetry/api": "^1.9.0",
    "@opentelemetry/exporter-trace-otlp-http": "^0.56.0",
    "@opentelemetry/resources": "^1.30.1",
    "@opentelemetry/sdk-trace-base": "^1.30.1",
    "@opentelemetry/sdk-trace-node": "^1.30.1",
    "@opentelemetry/semantic-conventions": "^1.28.0",
    "@nats-io/jetstream": "^3.3.0",
    "@nats-io/kv": "^3.2.0",
    "@nats-io/obj": "^3.3.1",
    "@nats-io/nats-core": "^3.3.1",
    "@nats-io/transport-node": "^3.3.1",
    "json-schema-library": "^10.5.2",
    pino: "^9.11.0",
    "ts-deepmerge": "^7.0.3",
    typebox: "^1.0.15",
    ulid: "^3.0.1",
  },
  externalizePackageDirs: {
    result: "@qlever-llc/result",
  },
});

await normalizePackageJson();
await vendorSdkArtifacts();
await trimArtifact();
