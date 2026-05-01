import { assertEquals, assertThrows } from "@std/assert";
import {
  normalizeVersionBase,
  parseReleaseTag,
  replaceJsonManifestVersion,
  rewriteCargoManifestVersions,
  rewriteInternalNpmDependencies,
} from "./release_version.ts";

Deno.test("parseReleaseTag extracts stable and prerelease versions", () => {
  assertEquals(parseReleaseTag("v0.7.0"), {
    version: "0.7.0",
    baseVersion: "0.7.0",
    prerelease: false,
  });
  assertEquals(parseReleaseTag("v0.7.0-rc.1"), {
    version: "0.7.0-rc.1",
    baseVersion: "0.7.0",
    prerelease: true,
  });
});

Deno.test("normalizeVersionBase strips prerelease suffixes", () => {
  assertEquals(normalizeVersionBase("0.7.0-rc.1"), "0.7.0");
  assertEquals(normalizeVersionBase("0.7.0"), "0.7.0");
});

Deno.test("replaceJsonManifestVersion validates the checked-in base version", () => {
  const manifest = JSON.stringify({ name: "pkg", version: "0.7.0" });
  assertEquals(
    replaceJsonManifestVersion(manifest, "0.7.0-rc.1", "0.7.0", "pkg"),
    '{\n  "name": "pkg",\n  "version": "0.7.0-rc.1"\n}\n',
  );

  assertThrows(
    () => replaceJsonManifestVersion(manifest, "0.8.0-rc.1", "0.8.0", "pkg"),
    Error,
    "pkg uses 0.7.0",
  );
});

Deno.test("replaceJsonManifestVersion leaves 0.0.0 app manifests alone", () => {
  const manifest = JSON.stringify({ name: "app", version: "0.0.0" });

  assertEquals(
    replaceJsonManifestVersion(manifest, "0.8.0", "0.7.0", "app"),
    manifest,
  );
});

Deno.test("rewriteInternalNpmDependencies updates internal package specs", () => {
  assertEquals(
    rewriteInternalNpmDependencies(
      {
        "@qlever-llc/result": "^0.7.0",
        "@qlever-llc/trellis": "~0.7.0",
        typebox: "^1.0.15",
      },
      "0.7.0-rc.1",
      "0.7.0",
    ),
    {
      "@qlever-llc/result": "^0.7.0-rc.1",
      "@qlever-llc/trellis": "~0.7.0-rc.1",
      typebox: "^1.0.15",
    },
  );
});

Deno.test("rewriteCargoManifestVersions updates workspace and internal dependency versions", () => {
  const manifest =
    `[workspace.package]\nversion = "0.7.0"\n\n[dependencies]\ntrellis-client = { path = "../client", version = "0.7.0" }\nserde = { version = "1.0.228", features = ["derive"] }\n`;

  assertEquals(
    rewriteCargoManifestVersions(manifest, "0.7.0-rc.1", "0.7.0"),
    `[workspace.package]\nversion = "0.7.0-rc.1"\n\n[dependencies]\ntrellis-client = { path = "../client", version = "0.7.0-rc.1" }\nserde = { version = "1.0.228", features = ["derive"] }\n`,
  );
});

Deno.test("rewriteCargoManifestVersions updates internal package versions", () => {
  const manifest =
    `[package]\nname = "trellis-generate"\nversion = "0.7.0"\npublish = false\n\n[dependencies]\nserde = "1.0.228"\n`;

  assertEquals(
    rewriteCargoManifestVersions(manifest, "0.7.0-rc.1", "0.7.0"),
    `[package]\nname = "trellis-generate"\nversion = "0.7.0-rc.1"\npublish = false\n\n[dependencies]\nserde = "1.0.228"\n`,
  );
});

Deno.test("rewriteCargoManifestVersions leaves external package versions alone", () => {
  const manifest =
    `[package]\nname = "external-helper"\nversion = "1.2.3"\n\n[dependencies]\nserde = "1.0.228"\n`;

  assertEquals(
    rewriteCargoManifestVersions(manifest, "0.7.0-rc.1", "0.7.0"),
    manifest,
  );
});

Deno.test("rewriteCargoManifestVersions fails when a checked-in dependency base version diverges", () => {
  const manifest =
    `[dependencies]\ntrellis-client = { path = "../client", version = "0.6.0" }\n`;
  assertThrows(
    () => rewriteCargoManifestVersions(manifest, "0.7.0-rc.1", "0.7.0"),
    Error,
    "trellis-client dependency uses 0.6.0",
  );
});
