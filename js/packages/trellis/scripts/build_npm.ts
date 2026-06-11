import { buildDntPackage } from "../../../tools/package_build/build_dnt_package.ts";

const npmPackageJsonPath = new URL("../npm/package.json", import.meta.url);
const npmDirUrl = new URL("../npm/", import.meta.url);
const generatedSdkSourceUrl = new URL(
  "../../../../generated/packages/jsr/",
  import.meta.url,
);
const generatedSdkBuildUrl = new URL(
  "../.build/generated-sdk/",
  import.meta.url,
);
const sdkExportDirs: Record<string, string> = {
  auth: "auth",
  core: "trellis-core",
  health: "health",
  jobs: "jobs",
  state: "state",
};
const moduleSpecifierPattern =
  /(?:import|export)\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|require\(\s*["']([^"']+)["']\s*\)/g;

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

async function pathExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(new URL(path, npmPackageJsonPath));
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return false;
    }
    throw error;
  }
}

async function urlExists(url: URL): Promise<boolean> {
  try {
    await Deno.stat(url);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return false;
    }
    throw error;
  }
}

async function removeFileDntPolyfills(fileUrl: URL) {
  const original = await Deno.readTextFile(fileUrl);
  const updated = original
    .replace(/^import ["'](?:\.\/|\.\.\/)_dnt\.polyfills\.js["'];\r?\n/gm, "")
    .replace(
      /^require\(["'](?:\.\/|\.\.\/)_dnt\.polyfills\.js["']\);\r?\n/gm,
      "",
    );

  if (updated !== original) {
    await Deno.writeTextFile(fileUrl, updated);
  }
}

async function collectRelativeJavaScriptGraph(
  entrypoint: URL,
): Promise<URL[]> {
  const pending = [entrypoint];
  const visited = new Map<string, URL>();

  while (pending.length) {
    const fileUrl = pending.pop();
    if (!fileUrl || visited.has(fileUrl.href)) continue;

    const source = await Deno.readTextFile(fileUrl);
    visited.set(fileUrl.href, fileUrl);

    for (const match of source.matchAll(moduleSpecifierPattern)) {
      const specifier = match[1] ?? match[2] ?? match[3];
      if (!specifier?.startsWith(".")) continue;
      if (!specifier.endsWith(".js")) continue;
      pending.push(new URL(specifier, fileUrl));
    }
  }

  return [...visited.values()];
}

async function removeBrowserGraphDntPolyfills() {
  for (const format of ["esm", "script"]) {
    const entrypoint = new URL(
      `../npm/${format}/browser.js`,
      import.meta.url,
    );
    for (const fileUrl of await collectRelativeJavaScriptGraph(entrypoint)) {
      await removeFileDntPolyfills(fileUrl);
    }
  }
}

async function normalizeExportTargets(
  _key: string,
  value: unknown,
): Promise<unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  if (_key.startsWith("./sdk/")) {
    const sdkName = _key.slice("./sdk/".length);
    if (sdkExportDirs[sdkName] === undefined) {
      return {};
    }

    const importPath = `./esm/sdk/${sdkName}.js`;
    const requirePath = `./script/sdk/${sdkName}.js`;
    const legacyImportPath = `./esm/npm/src/sdk/${sdkName}.js`;
    const legacyRequirePath = `./script/npm/src/sdk/${sdkName}.js`;
    return {
      ...(await pathExists(importPath)
        ? { import: importPath }
        : await pathExists(legacyImportPath)
        ? { import: legacyImportPath }
        : {}),
      ...(await pathExists(requirePath)
        ? { require: requirePath }
        : await pathExists(legacyRequirePath)
        ? { require: legacyRequirePath }
        : {}),
    };
  }

  const entries = await Promise.all(
    Object.entries(value).map(async ([condition, nestedValue]) => {
      if (
        (condition !== "import" && condition !== "require") ||
        typeof nestedValue !== "string"
      ) {
        return [condition, nestedValue] as const;
      }

      if (await pathExists(nestedValue)) {
        return [condition, nestedValue] as const;
      }

      const fallback = nestedValue.replace(
        /^\.\/(esm|script)\//,
        "./$1/npm/src/",
      );
      if (fallback !== nestedValue && await pathExists(fallback)) {
        return [condition, fallback] as const;
      }

      return undefined;
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

async function normalizeModuleSpecifiers() {
  const relativeTsSpecifierPattern = /(["'])(\.{1,2}\/[^"']+)\.ts\1/g;

  for await (const fileUrl of walkFiles(npmDirUrl)) {
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

async function stageCanonicalGeneratedSdkArtifacts() {
  for (const format of ["esm", "script"]) {
    const legacySourceRoot = new URL(
      `../npm/${format}/npm/src/.build/generated-sdk/`,
      import.meta.url,
    );
    const packageSourceRoot = new URL(
      `../npm/${format}/npm/src/sdk/_generated/`,
      import.meta.url,
    );
    const directSourceRoot = new URL(
      `../npm/${format}/sdk/_generated/`,
      import.meta.url,
    );
    const targetRoot = new URL(
      `../npm/${format}/generated-sdk/`,
      import.meta.url,
    );
    await Deno.remove(targetRoot, { recursive: true }).catch((error) => {
      if (!(error instanceof Deno.errors.NotFound)) {
        throw error;
      }
    });
    await Deno.mkdir(targetRoot, { recursive: true });

    for (const [sdkName, sdkDir] of Object.entries(sdkExportDirs)) {
      const legacySource = new URL(`${sdkDir}/`, legacySourceRoot);
      const packageSource = new URL(`${sdkName}/`, packageSourceRoot);
      const directSource = new URL(`${sdkName}/`, directSourceRoot);
      const source = await urlExists(legacySource)
        ? legacySource
        : await urlExists(packageSource)
        ? packageSource
        : directSource;
      if (!await urlExists(source)) {
        throw new Error(
          `missing generated SDK source for ${sdkName} in ${format} npm build`,
        );
      }
      await copyDir(source, new URL(`${sdkDir}/`, targetRoot));
    }

    await Deno.remove(legacySourceRoot, { recursive: true }).catch((error) => {
      if (!(error instanceof Deno.errors.NotFound)) {
        throw error;
      }
    });
    await Deno.remove(packageSourceRoot, { recursive: true }).catch((error) => {
      if (!(error instanceof Deno.errors.NotFound)) {
        throw error;
      }
    });
    await Deno.remove(directSourceRoot, { recursive: true }).catch((error) => {
      if (!(error instanceof Deno.errors.NotFound)) {
        throw error;
      }
    });
  }
}

async function addGeneratedSdkTypeImports() {
  const trellisApiImport =
    'import type { TrellisAPI } from "@qlever-llc/trellis/contracts";\n';

  for (const format of ["esm", "script"]) {
    const formatDir = new URL(
      `../npm/${format}/`,
      import.meta.url,
    );

    for await (const fileUrl of walkFiles(formatDir)) {
      if (!fileUrl.pathname.endsWith(".d.ts")) {
        continue;
      }

      const original = await Deno.readTextFile(fileUrl);
      if (
        !original.includes("TrellisAPI") ||
        /^import\b.*\bTrellisAPI\b.*$/m.test(original) ||
        /^export\s+(?:declare\s+)?(?:type|interface)\s+TrellisAPI\b/m.test(
          original,
        )
      ) {
        continue;
      }

      await Deno.writeTextFile(fileUrl, trellisApiImport + original);
    }
  }
}

async function rewriteCanonicalGeneratedSdkSelfImports() {
  for (const format of ["esm", "script"]) {
    const generatedSdkDir = new URL(
      `../npm/${format}/generated-sdk/`,
      import.meta.url,
    );

    for await (const fileUrl of walkFiles(generatedSdkDir)) {
      if (
        !fileUrl.pathname.endsWith(".js") && !fileUrl.pathname.endsWith(".d.ts")
      ) {
        continue;
      }

      const original = await Deno.readTextFile(fileUrl);
      let updated = original
        .replaceAll("../../../contracts.js", "@qlever-llc/trellis/contracts")
        .replaceAll("../../contracts.js", "@qlever-llc/trellis/contracts")
        .replaceAll("../../../contract.js", "@qlever-llc/trellis")
        .replaceAll("../../contract.js", "@qlever-llc/trellis")
        .replaceAll("../../../index.js", "@qlever-llc/trellis")
        .replaceAll("../../index.js", "@qlever-llc/trellis");
      for (const [sdkName, sdkDir] of Object.entries(sdkExportDirs)) {
        updated = updated
          .replaceAll(
            `../${sdkName}/mod.js`,
            `@qlever-llc/trellis/sdk/${sdkName}`,
          )
          .replaceAll(
            `../${sdkDir}/mod.js`,
            `@qlever-llc/trellis/sdk/${sdkName}`,
          )
          .replaceAll(
            `../../${sdkName}/mod.js`,
            `@qlever-llc/trellis/sdk/${sdkName}`,
          )
          .replaceAll(
            `../../${sdkDir}/mod.js`,
            `@qlever-llc/trellis/sdk/${sdkName}`,
          )
          .replaceAll(
            `../../${sdkName}.js`,
            `@qlever-llc/trellis/sdk/${sdkName}`,
          )
          .replaceAll(
            `../../../sdk/${sdkName}.js`,
            `@qlever-llc/trellis/sdk/${sdkName}`,
          )
          .replaceAll(
            `../../sdk/${sdkName}.js`,
            `@qlever-llc/trellis/sdk/${sdkName}`,
          );
      }
      if (updated !== original) {
        await Deno.writeTextFile(fileUrl, updated);
      }
    }
  }
}

async function removeSdkWrapperPolyfills() {
  for (const sdkName of Object.keys(sdkExportDirs)) {
    for (const format of ["esm", "script"]) {
      for (const extension of ["js", "d.ts"]) {
        for (
          const fileUrl of [
            new URL(
              `../npm/${format}/sdk/${sdkName}.${extension}`,
              import.meta.url,
            ),
            new URL(
              `../npm/${format}/npm/src/sdk/${sdkName}.${extension}`,
              import.meta.url,
            ),
          ]
        ) {
          await removeFileDntPolyfills(fileUrl).catch((error) => {
            if (!(error instanceof Deno.errors.NotFound)) {
              throw error;
            }
          });
        }
      }
    }
  }
}

async function rewriteSdkWrapperTargets() {
  for (const [sdkName, sdkDir] of Object.entries(sdkExportDirs)) {
    for (const format of ["esm", "script"]) {
      for (const extension of ["js", "d.ts"]) {
        for (
          const [fileUrl, canonicalTarget] of [
            [
              new URL(
                `../npm/${format}/sdk/${sdkName}.${extension}`,
                import.meta.url,
              ),
              `../generated-sdk/${sdkDir}/mod.js`,
            ],
            [
              new URL(
                `../npm/${format}/npm/src/sdk/${sdkName}.${extension}`,
                import.meta.url,
              ),
              `../../../generated-sdk/${sdkDir}/mod.js`,
            ],
          ] as const
        ) {
          const original = await Deno.readTextFile(fileUrl).catch((error) => {
            if (error instanceof Deno.errors.NotFound) return undefined;
            throw error;
          });
          if (original === undefined) {
            continue;
          }

          const updated = original.replaceAll(
            `../.build/generated-sdk/${sdkDir}/mod.js`,
            canonicalTarget,
          ).replaceAll(
            `./_generated/${sdkName}/mod.js`,
            canonicalTarget,
          );
          if (updated !== original) {
            await Deno.writeTextFile(fileUrl, updated);
          }
        }
      }
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
        await normalizeExportTargets(normalizedKey, normalizedValue),
      ];
    }),
  );

  packageJson.exports = Object.fromEntries(normalizedEntries);
  packageJson.bin = {
    "trellis-generate": "./bin/trellis-generate.js",
  };
  if (typeof packageJson.main === "string") {
    packageJson.main = rewriteCjsPath(packageJson.main);
  }
  await Deno.writeTextFile(
    npmPackageJsonPath,
    JSON.stringify(packageJson, null, 2) + "\n",
  );
}

async function stageNodeGenerateBin() {
  const binDir = new URL("../npm/bin/", import.meta.url);
  const binPath = new URL("trellis-generate.js", binDir);
  await Deno.mkdir(binDir, { recursive: true });
  await Deno.writeTextFile(binPath, nodeGenerateBinSource());
  await Deno.chmod(binPath, 0o755);
}

function nodeGenerateBinSource(): string {
  return String.raw`#!/usr/bin/env node
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const https = require("node:https");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const REPO_OWNER = "qlever-llc";
const REPO_NAME = "trellis";
const BIN_NAME = "trellis-generate";
const SUPPORTED_TARGETS = new Set([
  "x86_64-unknown-linux-gnu",
  "aarch64-unknown-linux-gnu",
  "x86_64-apple-darwin",
  "aarch64-apple-darwin",
]);

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  const packageVersion = readPackageVersion();
  const binary = (process.env.TRELLIS_GENERATE_BIN || "").trim() ||
    await ensureCachedReleaseBinary(packageVersion);
  verifyBinaryVersion(binary, packageVersion);
  const status = spawnSync(binary, process.argv.slice(2), { stdio: "inherit" });
  if (status.error) throw status.error;
  process.exit(status.status ?? 1);
}

function readPackageVersion() {
  const manifestPath = path.resolve(__dirname, "../package.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (typeof manifest.version !== "string" || !manifest.version.trim()) {
    throw new Error("@qlever-llc/trellis package manifest does not declare a version");
  }
  return manifest.version.trim();
}

async function ensureCachedReleaseBinary(version) {
  const target = releaseTarget();
  const cacheDir = path.join(cacheRoot(), version, target);
  const binary = path.join(cacheDir, BIN_NAME);
  if (fs.existsSync(binary)) return binary;

  fs.mkdirSync(cacheDir, { recursive: true });
  const tag = "v" + version;
  const archiveName = BIN_NAME + "-" + tag + "-" + target + ".tar.gz";
  const checksumName = "checksum-" + tag + "-" + target + "-" + BIN_NAME + ".sha256";
  const releaseBase = "https://github.com/" + REPO_OWNER + "/" + REPO_NAME + "/releases/download/" + tag;
  const [archive, checksumText] = await Promise.all([
    downloadBytes(releaseBase + "/" + archiveName),
    downloadText(releaseBase + "/" + checksumName),
  ]);
  verifyChecksum(archive, checksumText, archiveName);

  const archivePath = path.join(cacheDir, archiveName);
  fs.writeFileSync(archivePath, archive);
  const extract = spawnSync("tar", ["-xzf", archivePath, "-C", cacheDir], { stdio: "inherit" });
  if (extract.error) throw extract.error;
  if (extract.status !== 0) throw new Error("tar failed with exit code " + extract.status);
  fs.chmodSync(binary, 0o755);
  return binary;
}

function releaseTarget() {
  const arch = os.arch() === "x64" ? "x86_64" : os.arch() === "arm64" ? "aarch64" : os.arch();
  const platform = os.platform() === "darwin" ? "apple-darwin" : os.platform() === "linux" ? "unknown-linux-gnu" : undefined;
  const target = platform ? arch + "-" + platform : undefined;
  if (target && SUPPORTED_TARGETS.has(target)) return target;
  throw new Error("no " + BIN_NAME + " release binary is available for " + os.platform() + " " + os.arch());
}

function cacheRoot() {
  if ((process.env.TRELLIS_GENERATE_CACHE || "").trim()) return process.env.TRELLIS_GENERATE_CACHE.trim();
  if ((process.env.XDG_CACHE_HOME || "").trim()) return path.join(process.env.XDG_CACHE_HOME.trim(), "trellis", BIN_NAME);
  if ((process.env.LOCALAPPDATA || "").trim()) return path.join(process.env.LOCALAPPDATA.trim(), "trellis", BIN_NAME);
  if ((process.env.HOME || "").trim()) return path.join(process.env.HOME.trim(), ".cache", "trellis", BIN_NAME);
  throw new Error("HOME, LOCALAPPDATA, or TRELLIS_GENERATE_CACHE must be set to cache trellis-generate");
}

function downloadBytes(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        resolve(downloadBytes(response.headers.location));
        return;
      }
      if (response.statusCode !== 200) {
        reject(new Error("failed to download " + url + ": HTTP " + response.statusCode));
        response.resume();
        return;
      }
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve(Buffer.concat(chunks)));
    }).on("error", reject);
  });
}

async function downloadText(url) {
  return (await downloadBytes(url)).toString("utf8");
}

function verifyChecksum(bytes, checksumText, label) {
  const expected = checksumText.trim().split(/\s+/)[0]?.toLowerCase();
  if (!expected || !/^[0-9a-f]{64}$/.test(expected)) {
    throw new Error("release checksum asset did not contain a SHA-256 digest");
  }
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== expected) {
    throw new Error("checksum mismatch for " + label + ": expected " + expected + ", got " + actual);
  }
}

function verifyBinaryVersion(binary, expectedVersion) {
  const output = spawnSync(binary, ["--version"], { encoding: "utf8" });
  if (output.error) throw output.error;
  if (output.status !== 0) throw new Error("failed to run " + binary + " --version");
  const text = (output.stdout || "").trim();
  const actualVersion = text.split(/\s+/).find((part) => /^v?\d+\.\d+\.\d+/.test(part));
  if (!actualVersion || normalizeVersion(actualVersion) !== normalizeVersion(expectedVersion)) {
    throw new Error(binary + " is " + (text || "unknown version") + "; expected " + BIN_NAME + " " + expectedVersion);
  }
}

function normalizeVersion(version) {
  return version.trim().replace(/^v/, "").split("+")[0];
}
`;
}

await stageGeneratedSdks();

await buildDntPackage({
  buildRoot: "../../..",
  denoConfigPath: "./deno.npm.json",
  importMap: "./import_map.npm.json",
  skipNpmInstall: true,
  compilerOptions: {
    stripInternal: true,
  },
  entryPoints: [
    "./js/packages/trellis/index.ts",
    "./js/packages/trellis/auth.ts",
    "./js/packages/trellis/auth/browser.ts",
    "./js/packages/trellis/browser.ts",
    "./js/packages/trellis/contracts.ts",
    "./js/packages/trellis/device.ts",
    "./js/packages/trellis/device/deno.ts",
    "./js/packages/trellis/generate.ts",
    "./js/packages/trellis/health.ts",
    "./js/packages/trellis/sdk/auth.ts",
    "./js/packages/trellis/sdk/core.ts",
    "./js/packages/trellis/sdk/health.ts",
    "./js/packages/trellis/sdk/jobs.ts",
    "./js/packages/trellis/sdk/state.ts",
    "./js/packages/trellis/errors/index.ts",
    "./js/packages/trellis/host/mod.ts",
    "./js/packages/trellis/host/node.ts",
    "./js/packages/trellis/service/mod.ts",
    "./js/packages/trellis/service/deno.ts",
    "./js/packages/trellis/service/node.ts",
    "./js/packages/trellis/telemetry.ts",
  ],
  description:
    "Client-side Trellis runtime, models, and contract helpers for TypeScript applications.",
  dependencies: {
    "@opentelemetry/api": "^1.9.0",
    "@opentelemetry/exporter-metrics-otlp-proto": "^0.56.0",
    "@opentelemetry/exporter-trace-otlp-proto": "^0.56.0",
    "@opentelemetry/resources": "^1.30.1",
    "@opentelemetry/sdk-metrics": "^1.30.1",
    "@opentelemetry/sdk-trace-base": "^1.30.1",
    "@opentelemetry/sdk-trace-node": "^1.30.1",
    "@opentelemetry/semantic-conventions": "^1.28.0",
    "@nats-io/jetstream": "^3.3.0",
    "@nats-io/kv": "^3.2.0",
    "@nats-io/obj": "^3.3.1",
    "@nats-io/nats-core": "^3.3.1",
    "@nats-io/transport-node": "^3.3.1",
    "@qlever-llc/result": "^0.10.14",
    "js-sha256": "^0.11.1",
    pino: "^9.11.0",
    tweetnacl: "^1.0.3",
    "ts-deepmerge": "^7.0.3",
    typebox: "^1.0.15",
    ulid: "^3.0.1",
  },
  npmInstallDeps: {
    "@opentelemetry/api": "^1.9.0",
    "@opentelemetry/exporter-metrics-otlp-proto": "^0.56.0",
    "@opentelemetry/exporter-trace-otlp-proto": "^0.56.0",
    "@opentelemetry/resources": "^1.30.1",
    "@opentelemetry/sdk-metrics": "^1.30.1",
    "@opentelemetry/sdk-trace-base": "^1.30.1",
    "@opentelemetry/sdk-trace-node": "^1.30.1",
    "@opentelemetry/semantic-conventions": "^1.28.0",
    "@nats-io/jetstream": "^3.3.0",
    "@nats-io/kv": "^3.2.0",
    "@nats-io/obj": "^3.3.1",
    "@nats-io/nats-core": "^3.3.1",
    "@nats-io/transport-node": "^3.3.1",
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

await normalizeModuleSpecifiers();
await stageCanonicalGeneratedSdkArtifacts();
await addGeneratedSdkTypeImports();
await rewriteCanonicalGeneratedSdkSelfImports();
await removeSdkWrapperPolyfills();
await rewriteSdkWrapperTargets();
await removeBrowserGraphDntPolyfills();
await stageNodeGenerateBin();
await normalizePackageJsonExports();
await Deno.remove(generatedSdkBuildUrl, { recursive: true });
