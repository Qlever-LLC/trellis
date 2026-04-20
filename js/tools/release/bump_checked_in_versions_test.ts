import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import {
  rewriteCheckedInJsonManifestVersion,
  updateCargoVersions,
  updateJsonVersions,
} from "./bump_checked_in_versions.ts";

Deno.test("rewriteCheckedInJsonManifestVersion leaves 0.0.0 app package manifests alone", () => {
  const manifest = JSON.stringify({
    name: "app",
    version: "0.0.0",
    private: true,
  });

  assertEquals(
    rewriteCheckedInJsonManifestVersion(
      manifest,
      "0.8.0",
      "0.7.0",
      "/repo/js/apps/console/package.json",
    ),
    manifest,
  );
});

Deno.test("updateJsonVersions bumps release-managed manifests and skips app package.json files", async () => {
  const rootDir = await Deno.makeTempDir();

  try {
    const packageDenoPath = join(
      rootDir,
      "packages",
      "trellis",
      "deno.npm.json",
    );
    const serviceDenoPath = join(rootDir, "services", "activity", "deno.json");
    const appPackagePath = join(rootDir, "apps", "console", "package.json");
    const workspaceDenoPath = join(rootDir, "deno.json");

    await Deno.mkdir(join(rootDir, "packages", "trellis"), { recursive: true });
    await Deno.mkdir(join(rootDir, "services", "activity"), {
      recursive: true,
    });
    await Deno.mkdir(join(rootDir, "apps", "console"), { recursive: true });
    await Deno.writeTextFile(
      packageDenoPath,
      '{"name":"@qlever-llc/trellis","version":"0.7.0"}\n',
    );
    await Deno.writeTextFile(
      serviceDenoPath,
      '{"name":"@qlever-llc/activity","version":"0.7.0"}\n',
    );
    await Deno.writeTextFile(
      appPackagePath,
      '{"name":"@qlever-llc/trellis-app-console","version":"0.0.0"}\n',
    );
    await Deno.writeTextFile(
      workspaceDenoPath,
      '{"workspace":["./apps/console"]}\n',
    );

    const updatedPaths = await updateJsonVersions(rootDir, "0.8.0", "0.7.0");

    assertEquals(
      updatedPaths.sort(),
      [packageDenoPath, serviceDenoPath].sort(),
    );
    assertEquals(
      JSON.parse(await Deno.readTextFile(packageDenoPath)).version,
      "0.8.0",
    );
    assertEquals(
      JSON.parse(await Deno.readTextFile(serviceDenoPath)).version,
      "0.8.0",
    );
    assertEquals(
      JSON.parse(await Deno.readTextFile(appPackagePath)).version,
      "0.0.0",
    );
  } finally {
    await Deno.remove(rootDir, { recursive: true });
  }
});

Deno.test("updateJsonVersions fails when a release-managed manifest drifts from the current base", async () => {
  const rootDir = await Deno.makeTempDir();

  try {
    const manifestPath = join(rootDir, "packages", "result", "deno.json");
    await Deno.mkdir(join(rootDir, "packages", "result"), { recursive: true });
    await Deno.writeTextFile(
      manifestPath,
      '{"name":"@qlever-llc/result","version":"0.6.0"}\n',
    );

    await assertRejects(
      () => updateJsonVersions(rootDir, "0.8.0", "0.7.0"),
      Error,
      `${manifestPath} uses 0.6.0`,
    );
  } finally {
    await Deno.remove(rootDir, { recursive: true });
  }
});

Deno.test("updateCargoVersions bumps workspace and internal crate versions", async () => {
  const rootDir = await Deno.makeTempDir();

  try {
    const cargoPath = join(rootDir, "Cargo.toml");
    await Deno.writeTextFile(
      cargoPath,
      `[workspace.package]\nversion = "0.7.0"\n\n[dependencies]\ntrellis-client = { path = "../client", version = "0.7.0" }\nserde = { version = "1.0.228" }\n`,
    );

    const updatedPaths = await updateCargoVersions(rootDir, "0.8.0", "0.7.0");

    assertEquals(updatedPaths, [cargoPath]);
    assertEquals(
      await Deno.readTextFile(cargoPath),
      `[workspace.package]\nversion = "0.8.0"\n\n[dependencies]\ntrellis-client = { path = "../client", version = "0.8.0" }\nserde = { version = "1.0.228" }\n`,
    );
  } finally {
    await Deno.remove(rootDir, { recursive: true });
  }
});
