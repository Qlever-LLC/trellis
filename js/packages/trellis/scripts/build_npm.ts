import { buildDntPackage } from "../../../tools/package_build/build_dnt_package.ts";

const npmPackageJsonPath = new URL("../npm/package.json", import.meta.url);
const npmScriptDirUrl = new URL("../npm/script/", import.meta.url);
const generatedSdkSourceUrl = new URL(
  "../../../../generated/js/sdks/",
  import.meta.url,
);
const generatedSdkBuildUrl = new URL(
  "../.build/generated-sdk/",
  import.meta.url,
);

function rewriteCjsPath(path: string): string {
  return path;
}

function normalizeExportValue(value: unknown): unknown {
  if (typeof value === "string") {
    return rewriteCjsPath(value);
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, nestedValue]) => [
      key,
      key === "require" ? normalizeExportValue(nestedValue) : nestedValue,
    ]),
  );
}

function removeRequireCondition(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== "require"),
  );
}

async function removeMissingRequireCondition(value: unknown): Promise<unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  const entries = await Promise.all(
    Object.entries(value).map(async ([key, nestedValue]) => {
      if (key !== "require" || typeof nestedValue !== "string") {
        return [key, nestedValue] as const;
      }

      const fileUrl = new URL(nestedValue, npmPackageJsonPath);
      try {
        await Deno.stat(fileUrl);
        return [key, nestedValue] as const;
      } catch (error) {
        if (error instanceof Deno.errors.NotFound) {
          return undefined;
        }
        throw error;
      }
    }),
  );

  return Object.fromEntries(entries.filter((entry) => entry !== undefined));
}

async function* walkFiles(dir: URL): AsyncGenerator<URL> {
  for await (const entry of Deno.readDir(dir)) {
    const entryUrl = new URL(entry.name, dir);
    if (entry.isDirectory) {
      yield* walkFiles(new URL(`${entry.name}/`, dir));
      continue;
    }

    yield entryUrl;
  }
}

async function copyDir(source: URL, target: URL) {
  await Deno.mkdir(target, { recursive: true });
  for await (const entry of Deno.readDir(source)) {
    if (["node_modules", "npm", "scripts"].includes(entry.name)) {
      continue;
    }
    const sourceUrl = new URL(entry.name, source);
    const targetUrl = new URL(entry.name, target);
    if (entry.isDirectory) {
      await copyDir(
        new URL(`${entry.name}/`, source),
        new URL(`${entry.name}/`, target),
      );
      continue;
    }
    await Deno.copyFile(sourceUrl, targetUrl);
  }
}

async function stageGeneratedSdks() {
  await Deno.remove(generatedSdkBuildUrl, { recursive: true }).catch(
    (error) => {
      if (!(error instanceof Deno.errors.NotFound)) {
        throw error;
      }
    },
  );
  await copyDir(generatedSdkSourceUrl, generatedSdkBuildUrl);
}

async function normalizeScriptModuleSpecifiers() {
  const relativeTsSpecifierPattern = /(["'])(\.{1,2}\/[^"']+)\.ts\1/g;

  for await (const fileUrl of walkFiles(npmScriptDirUrl)) {
    if (!fileUrl.pathname.endsWith(".js")) {
      continue;
    }

    const original = await Deno.readTextFile(fileUrl);
    const updated = original.replace(
      relativeTsSpecifierPattern,
      (_match, quote, specifier) => `${quote}${specifier}.js${quote}`,
    );

    if (updated !== original) {
      await Deno.writeTextFile(fileUrl, updated);
    }
  }
}

async function normalizePackageJsonExports() {
  const packageJson = JSON.parse(await Deno.readTextFile(npmPackageJsonPath));
  const exports = packageJson.exports ?? {};
  const normalizedEntries = await Promise.all(
    Object.entries(exports).map(async ([key, value]) => {
      if (key === ".") {
        return [
          key,
          await removeMissingRequireCondition(normalizeExportValue(value)),
        ];
      }

      const normalizedKey = key
        .replace("./js/packages/trellis", ".")
        .replace(/\/mod$/, "")
        .replace(/\/index$/, "");

      const normalizedValue = normalizeExportValue(value);
      return [
        normalizedKey,
        await removeMissingRequireCondition(
          normalizedKey.startsWith("./sdk/")
            ? removeRequireCondition(normalizedValue)
            : normalizedValue,
        ),
      ];
    }),
  );

  packageJson.exports = Object.fromEntries(normalizedEntries);
  if (typeof packageJson.main === "string") {
    packageJson.main = rewriteCjsPath(packageJson.main);
  }
  await Deno.writeTextFile(
    npmPackageJsonPath,
    JSON.stringify(packageJson, null, 2) + "\n",
  );
}

await stageGeneratedSdks();

await buildDntPackage({
  buildRoot: "../../..",
  denoConfigPath: "./deno.npm.json",
  importMap: "./import_map.npm.json",
  skipNpmInstall: true,
  entryPoints: [
    "./js/packages/trellis/index.ts",
    "./js/packages/trellis/auth.ts",
    "./js/packages/trellis/auth/browser.ts",
    "./js/packages/trellis/browser.ts",
    "./js/packages/trellis/contracts.ts",
    "./js/packages/trellis/device.ts",
    "./js/packages/trellis/device/deno.ts",
    "./js/packages/trellis/health.ts",
    "./js/packages/trellis/sdk/activity.ts",
    "./js/packages/trellis/sdk/auth.ts",
    "./js/packages/trellis/sdk/core.ts",
    "./js/packages/trellis/sdk/health.ts",
    "./js/packages/trellis/sdk/jobs.ts",
    "./js/packages/trellis/sdk/state.ts",
    "./js/packages/trellis/errors/index.ts",
    "./js/packages/trellis/service/mod.ts",
    "./js/packages/trellis/service/deno.ts",
    "./js/packages/trellis/service/node.ts",
    "./js/packages/trellis/tracing.ts",
  ],
  description:
    "Client-side Trellis runtime, models, and contract helpers for TypeScript applications.",
  dependencies: {
    "@opentelemetry/api": "^1.9.0",
    "@opentelemetry/exporter-trace-otlp-proto": "^0.56.0",
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
    "js-sha256": "^0.11.1",
    pino: "^9.11.0",
    tweetnacl: "^1.0.3",
    "ts-deepmerge": "^7.0.3",
    typebox: "^1.0.15",
    ulid: "^3.0.1",
  },
  npmInstallDeps: {
    "@opentelemetry/api": "^1.9.0",
    "@opentelemetry/exporter-trace-otlp-proto": "^0.56.0",
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
    "js-sha256": "^0.11.1",
    pino: "^9.11.0",
    tweetnacl: "^1.0.3",
    "ts-deepmerge": "^7.0.3",
    typebox: "^1.0.15",
    ulid: "^3.0.1",
  },
  externalizePackageDirs: {
    result: "@qlever-llc/result",
  },
});

await normalizeScriptModuleSpecifiers();
await normalizePackageJsonExports();
await Deno.remove(generatedSdkBuildUrl, { recursive: true });
