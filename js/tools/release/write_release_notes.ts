import { dirname, fromFileUrl, join } from "@std/path";
import { parseReleaseTag } from "./release_version.ts";

const repoRoot = fromFileUrl(new URL("../../../", import.meta.url));

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function extractChangelogSection(
  changelog: string,
  version: string,
): string {
  const normalized = changelog.replace(/\r\n/g, "\n");
  const heading = new RegExp(
    `^## \\[${escapeRegExp(version)}\\](?: - \\d{4}-\\d{2}-\\d{2})?$`,
  );
  const lines = normalized.split("\n");
  const startIndex = lines.findIndex((line) => heading.test(line));

  if (startIndex === -1) {
    throw new Error(
      `CHANGELOG.md does not contain a section for version ${version}.`,
    );
  }

  let endIndex = lines.length;
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    if (/^## \[.+\](?: - \d{4}-\d{2}-\d{2})?$/.test(lines[index])) {
      endIndex = index;
      break;
    }
  }

  return `${lines.slice(startIndex + 1, endIndex).join("\n").trim()}\n`;
}

export async function writeReleaseNotes(options: {
  changelogPath: string;
  outputPath: string;
  releaseTag: string;
}): Promise<void> {
  const release = parseReleaseTag(options.releaseTag);
  const changelog = await Deno.readTextFile(options.changelogPath);
  const notes = extractChangelogSection(changelog, release.version);
  await Deno.mkdir(dirname(options.outputPath), { recursive: true });
  await Deno.writeTextFile(options.outputPath, notes);
}

if (import.meta.main) {
  const releaseTag = Deno.env.get("TRELLIS_RELEASE_TAG")?.trim();
  const outputPath = Deno.env.get("TRELLIS_RELEASE_NOTES_OUTPUT")?.trim();

  if (!releaseTag) {
    throw new Error("TRELLIS_RELEASE_TAG is required.");
  }

  if (!outputPath) {
    throw new Error("TRELLIS_RELEASE_NOTES_OUTPUT is required.");
  }

  await writeReleaseNotes({
    changelogPath: join(repoRoot, "CHANGELOG.md"),
    outputPath,
    releaseTag,
  });

  console.log(`Wrote release notes for ${releaseTag} to ${outputPath}.`);
}
