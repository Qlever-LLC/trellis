import { fromFileUrl, join } from "@std/path";
import {
  parseReleaseTag,
  replaceJsonManifestVersion,
  rewriteCargoManifestVersions,
} from "./release_version.ts";

const repoRoot = fromFileUrl(new URL("../../../", import.meta.url));

async function* walk(dir: string): AsyncGenerator<string> {
  for await (const entry of Deno.readDir(dir)) {
    if (
      entry.name === ".git" || entry.name === "node_modules" ||
      entry.name === ".svelte-kit"
    ) {
      continue;
    }

    const path = join(dir, entry.name);
    if (entry.isDirectory) {
      yield* walk(path);
    } else {
      yield path;
    }
  }
}

async function writeGithubEnv(name: string, value: string): Promise<void> {
  const githubEnvPath = Deno.env.get("GITHUB_ENV")?.trim();
  if (!githubEnvPath) {
    return;
  }
  await Deno.writeTextFile(githubEnvPath, `${name}=${value}\n`, {
    append: true,
  });
}

async function updateJsonVersions(
  rootDir: string,
  releaseVersion: string,
  baseVersion: string,
) {
  for await (const path of walk(rootDir)) {
    if (!path.endsWith("deno.json")) {
      continue;
    }

    const original = await Deno.readTextFile(path);
    let updated: string;
    try {
      updated = replaceJsonManifestVersion(
        original,
        releaseVersion,
        baseVersion,
        path,
      );
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("does not declare a string version")
      ) {
        continue;
      }
      throw error;
    }

    if (updated !== original) {
      await Deno.writeTextFile(path, updated);
    }
  }
}

async function updateCargoVersions(
  rootDir: string,
  releaseVersion: string,
  baseVersion: string,
) {
  for await (const path of walk(rootDir)) {
    if (!path.endsWith("Cargo.toml")) {
      continue;
    }

    const original = await Deno.readTextFile(path);
    const updated = rewriteCargoManifestVersions(
      original,
      releaseVersion,
      baseVersion,
    );
    if (updated !== original) {
      await Deno.writeTextFile(path, updated);
    }
  }
}

const releaseTag = Deno.env.get("TRELLIS_RELEASE_TAG")?.trim();

if (!releaseTag) {
  console.log(
    "TRELLIS_RELEASE_TAG is not set; skipping release version preparation.",
  );
  Deno.exit(0);
}

const release = parseReleaseTag(releaseTag);

await updateJsonVersions(
  join(repoRoot, "js"),
  release.version,
  release.baseVersion,
);
await updateCargoVersions(
  join(repoRoot, "rust"),
  release.version,
  release.baseVersion,
);
await writeGithubEnv("TRELLIS_RELEASE_VERSION", release.version);
await writeGithubEnv("TRELLIS_RELEASE_BASE_VERSION", release.baseVersion);

console.log(
  `Prepared release version ${release.version} from tag ${releaseTag}.`,
);
