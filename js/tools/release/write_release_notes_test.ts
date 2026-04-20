import { assertEquals, assertThrows } from "@std/assert";
import { join } from "@std/path";
import {
  extractChangelogSection,
  writeReleaseNotes,
} from "./write_release_notes.ts";

Deno.test("extractChangelogSection returns the requested release body", () => {
  const changelog = `# Changelog

## [Unreleased]

## [0.8.0] - 2026-04-19

### Added

- Added release notes.

## [0.7.0] - 2026-03-01

- Older notes.
`;

  assertEquals(
    extractChangelogSection(changelog, "0.8.0"),
    "### Added\n\n- Added release notes.\n",
  );
});

Deno.test("extractChangelogSection fails when the release section is missing", () => {
  assertThrows(
    () => {
      extractChangelogSection("# Changelog\n", "0.8.0");
    },
    Error,
    "CHANGELOG.md does not contain a section for version 0.8.0.",
  );
});

Deno.test("writeReleaseNotes extracts the section matching TRELLIS_RELEASE_TAG", async () => {
  const tempDir = await Deno.makeTempDir();
  const changelogPath = join(tempDir, "CHANGELOG.md");
  const outputPath = join(tempDir, "dist", "release-notes.md");

  await Deno.writeTextFile(
    changelogPath,
    `# Changelog

## [Unreleased]

## [0.8.0] - 2026-04-19

### Fixed

- Released from the changelog.
`,
  );

  await writeReleaseNotes({
    changelogPath,
    outputPath,
    releaseTag: "v0.8.0",
  });

  assertEquals(
    await Deno.readTextFile(outputPath),
    "### Fixed\n\n- Released from the changelog.\n",
  );
});
