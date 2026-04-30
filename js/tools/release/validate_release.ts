import { fromFileUrl, join } from "@std/path";
import { extractChangelogSection } from "./write_release_notes.ts";
import { parseReleaseTag } from "./release_version.ts";

const repoRoot = fromFileUrl(new URL("../../../", import.meta.url));

const releaseTag = Deno.env.get("TRELLIS_RELEASE_TAG")?.trim();

if (!releaseTag) {
  console.log("TRELLIS_RELEASE_TAG is not set; skipping release validation.");
  Deno.exit(0);
}

const release = parseReleaseTag(releaseTag);
const changelogPath = join(repoRoot, "CHANGELOG.md");
const changelog = await Deno.readTextFile(changelogPath);
extractChangelogSection(changelog, release.version);

console.log(`Validated release metadata for ${releaseTag}.`);
