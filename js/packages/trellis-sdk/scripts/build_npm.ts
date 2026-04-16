import { buildDntPackage } from "../../../tools/package_build/build_dnt_package.ts";

const npmPackageJsonPath = new URL("../npm/package.json", import.meta.url);

async function normalizePackageJsonExports() {
  const packageJson = JSON.parse(await Deno.readTextFile(npmPackageJsonPath));
  const exports = packageJson.exports ?? {};
  const normalizedEntries = Object.entries(exports).map(([key, value]) => {
    const normalizedKey = key
      .replace(/^\.$/, "./activity")
      .replace(/^\.\/generated\/js\/sdks\/activity\/mod$/, "./activity")
      .replace(/^\.\/generated\/js\/sdks\/auth\/mod$/, "./auth")
      .replace(/^\.\/generated\/js\/sdks\/trellis-core\/mod$/, "./core")
      .replace(/^\.\/generated\/js\/sdks\/health\/mod$/, "./health")
      .replace(/^\.\/generated\/js\/sdks\/state\/mod$/, "./state");

    return [normalizedKey, value];
  });

  packageJson.exports = Object.fromEntries(normalizedEntries);
  delete packageJson.main;
  delete packageJson.module;
  await Deno.writeTextFile(
    npmPackageJsonPath,
    JSON.stringify(packageJson, null, 2) + "\n",
  );
}

await buildDntPackage({
  buildRoot: "../../..",
  denoConfigPath: "./deno.json",
  importMap: "./import_map.npm.json",
  skipNpmInstall: true,
  entryPoints: [
    "./generated/js/sdks/activity/mod.ts",
    "./generated/js/sdks/auth/mod.ts",
    "./generated/js/sdks/trellis-core/mod.ts",
    "./generated/js/sdks/health/mod.ts",
    "./generated/js/sdks/state/mod.ts",
  ],
  description:
    "First-party generated SDKs for Trellis-owned contracts.",
  dependencies: {
    "@qlever-llc/trellis": "^0.7.0",
  },
  npmInstallDeps: {
    "@qlever-llc/trellis": "^0.7.0",
  },
});

await normalizePackageJsonExports();
