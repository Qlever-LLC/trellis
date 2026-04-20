import { parseArgs } from "@std/cli/parse-args";
import { fromFileUrl, join } from "@std/path";
import { parse as parseJsonc } from "jsonc-parser";
import {
  normalizeVersionBase,
  parseReleaseVersion,
  replaceJsonManifestVersion,
  rewriteCargoManifestVersions,
} from "./release_version.ts";

const repoRoot = fromFileUrl(new URL("../../../", import.meta.url));

type JsonManifest = {
  version?: unknown;
};

function expectStableBaseVersion(version: string, label: string): string {
  const parsed = parseReleaseVersion(version);
  if (parsed.prerelease || parsed.version !== parsed.baseVersion) {
    throw new Error(`${label} must be a stable base version like 0.8.0.`);
  }
  return parsed.baseVersion;
}

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

export function rewriteCheckedInJsonManifestVersion(
  contents: string,
  nextBaseVersion: string,
  currentBaseVersion: string,
  label: string,
): string {
  const manifest = parseJsonc(contents) as JsonManifest;
  if (typeof manifest.version !== "string" || !manifest.version.trim()) {
    throw new Error(`${label} does not declare a string version.`);
  }

  if (
    label.endsWith("package.json") &&
    normalizeVersionBase(manifest.version) === "0.0.0"
  ) {
    return contents;
  }

  return replaceJsonManifestVersion(
    contents,
    nextBaseVersion,
    currentBaseVersion,
    label,
  );
}

export async function updateJsonVersions(
  rootDir: string,
  nextBaseVersion: string,
  currentBaseVersion: string,
): Promise<string[]> {
  const updatedPaths: string[] = [];

  for await (const path of walk(rootDir)) {
    if (
      !path.endsWith("deno.json") && !path.endsWith("deno.npm.json") &&
      !path.endsWith("package.json")
    ) {
      continue;
    }

    const original = await Deno.readTextFile(path);
    let updated: string;
    try {
      updated = rewriteCheckedInJsonManifestVersion(
        original,
        nextBaseVersion,
        currentBaseVersion,
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
      updatedPaths.push(path);
    }
  }

  return updatedPaths;
}

export async function updateCargoVersions(
  rootDir: string,
  nextBaseVersion: string,
  currentBaseVersion: string,
): Promise<string[]> {
  const updatedPaths: string[] = [];

  for await (const path of walk(rootDir)) {
    if (!path.endsWith("Cargo.toml")) {
      continue;
    }

    const original = await Deno.readTextFile(path);
    const updated = rewriteCargoManifestVersions(
      original,
      nextBaseVersion,
      currentBaseVersion,
    );
    if (updated !== original) {
      await Deno.writeTextFile(path, updated);
      updatedPaths.push(path);
    }
  }

  return updatedPaths;
}

async function main(): Promise<void> {
  const args = parseArgs(Deno.args, {
    string: ["from", "to"],
    alias: {
      from: "f",
      to: "t",
    },
  });

  const currentBaseVersion = expectStableBaseVersion(args.from ?? "", "--from");
  const nextBaseVersion = expectStableBaseVersion(args.to ?? "", "--to");

  const jsonPaths = await updateJsonVersions(
    join(repoRoot, "js"),
    nextBaseVersion,
    currentBaseVersion,
  );
  const cargoPaths = await updateCargoVersions(
    join(repoRoot, "rust"),
    nextBaseVersion,
    currentBaseVersion,
  );

  console.log(
    `Bumped checked-in base versions from ${currentBaseVersion} to ${nextBaseVersion} in ${jsonPaths.length} JS manifests and ${cargoPaths.length} Cargo manifests.`,
  );
}

if (import.meta.main) {
  await main();
}
