import { buildDntPackage } from "../../../tools/package_build/build_dnt_package.ts";

const npmPackageJsonPath = new URL("../npm/package.json", import.meta.url);
const npmDirUrl = new URL("../npm/", import.meta.url);

async function writeRootBarrelFiles() {
  await Deno.writeTextFile(
    new URL("./esm/mod.js", npmDirUrl),
    [
      'import "./_dnt.polyfills.js";',
      'export { activity } from "./activity/mod.js";',
      'export { auth } from "./auth/mod.js";',
      'export { core } from "./trellis-core/mod.js";',
      'export { health } from "./health/mod.js";',
      'export { trellisJobs as jobs } from "./jobs/mod.js";',
      'export { state } from "./state/mod.js";',
      "",
    ].join("\n"),
  );

  await Deno.writeTextFile(
    new URL("./esm/mod.d.ts", npmDirUrl),
    [
      'import "./_dnt.polyfills.js";',
      'export { activity } from "./activity/mod.js";',
      'export { auth } from "./auth/mod.js";',
      'export { core } from "./trellis-core/mod.js";',
      'export { health } from "./health/mod.js";',
      'export { trellisJobs as jobs } from "./jobs/mod.js";',
      'export { state } from "./state/mod.js";',
      "",
    ].join("\n"),
  );

  await Deno.writeTextFile(
    new URL("./script/mod.js", npmDirUrl),
    [
      '"use strict";',
      'Object.defineProperty(exports, "__esModule", { value: true });',
      "exports.state = exports.jobs = exports.health = exports.core = exports.auth = exports.activity = void 0;",
      'require("./_dnt.polyfills.js");',
      'var mod_js_1 = require("./activity/mod.js");',
      'Object.defineProperty(exports, "activity", { enumerable: true, get: function () { return mod_js_1.activity; } });',
      'var mod_js_2 = require("./auth/mod.js");',
      'Object.defineProperty(exports, "auth", { enumerable: true, get: function () { return mod_js_2.auth; } });',
      'var mod_js_3 = require("./trellis-core/mod.js");',
      'Object.defineProperty(exports, "core", { enumerable: true, get: function () { return mod_js_3.core; } });',
      'var mod_js_4 = require("./health/mod.js");',
      'Object.defineProperty(exports, "health", { enumerable: true, get: function () { return mod_js_4.health; } });',
      'var mod_js_5 = require("./jobs/mod.js");',
      'Object.defineProperty(exports, "jobs", { enumerable: true, get: function () { return mod_js_5.trellisJobs; } });',
      'var mod_js_6 = require("./state/mod.js");',
      'Object.defineProperty(exports, "state", { enumerable: true, get: function () { return mod_js_6.state; } });',
      "",
    ].join("\n"),
  );

  await Deno.writeTextFile(
    new URL("./script/mod.d.ts", npmDirUrl),
    [
      'import "./_dnt.polyfills.js";',
      'export { activity } from "./activity/mod.js";',
      'export { auth } from "./auth/mod.js";',
      'export { core } from "./trellis-core/mod.js";',
      'export { health } from "./health/mod.js";',
      'export { trellisJobs as jobs } from "./jobs/mod.js";',
      'export { state } from "./state/mod.js";',
      "",
    ].join("\n"),
  );
}

async function normalizePackageJsonExports() {
  const packageJson = JSON.parse(await Deno.readTextFile(npmPackageJsonPath));
  const exports = packageJson.exports ?? {};
  const normalizedEntries = Object.entries(exports).map(([key, value]) => {
    const normalizedKey = key
      .replace(/^\.\/js\/packages\/trellis-sdk\/mod$/, ".")
      .replace(/^\.\/generated\/js\/sdks\/activity\/mod$/, "./activity")
      .replace(/^\.\/generated\/js\/sdks\/auth\/mod$/, "./auth")
      .replace(/^\.\/generated\/js\/sdks\/trellis-core\/mod$/, "./core")
      .replace(/^\.\/generated\/js\/sdks\/health\/mod$/, "./health")
      .replace(/^\.\/generated\/js\/sdks\/jobs\/mod$/, "./jobs")
      .replace(/^\.\/generated\/js\/sdks\/state\/mod$/, "./state");

    return [normalizedKey, value];
  });

  packageJson.exports = {
    ".": {
      types: "./esm/mod.d.ts",
      import: "./esm/mod.js",
      require: "./script/mod.js",
    },
    ...Object.fromEntries(normalizedEntries.map(([key, value]) => [key === "." ? "./activity" : key, value])),
  };
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
    "./generated/js/sdks/jobs/mod.ts",
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

await writeRootBarrelFiles();
await normalizePackageJsonExports();
