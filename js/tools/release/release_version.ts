import { parse as parseJsonc } from "jsonc-parser";

const SEMVER_RE = /^(?<base>\d+\.\d+\.\d+)(?<suffix>-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const RELEASE_TAG_RE = /^v(?<version>\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/;

const INTERNAL_RUST_CRATES = new Set([
  "trellis-auth",
  "trellis-auth-adapters",
  "trellis-cli",
  "trellis-client",
  "trellis-codegen-rust",
  "trellis-codegen-ts",
  "trellis-contracts",
  "trellis-core-bootstrap",
  "trellis-jobs",
  "trellis-sdk-auth",
  "trellis-sdk-core",
  "trellis-sdk-jobs",
  "trellis-server",
  "trellis-service-jobs",
  "trellis-tooling-support",
]);

const INTERNAL_NPM_SCOPE = "@qlever-llc/";

export type ParsedReleaseVersion = {
  version: string;
  baseVersion: string;
  prerelease: boolean;
};

function requiredMatch(regex: RegExp, value: string, label: string): RegExpMatchArray {
  const match = value.match(regex);
  if (!match?.groups) {
    throw new Error(`Invalid ${label} '${value}'. Expected semver like v0.7.0 or v0.7.0-rc.1.`);
  }
  return match;
}

export function parseReleaseVersion(version: string): ParsedReleaseVersion {
  const trimmed = version.trim();
  const match = requiredMatch(SEMVER_RE, trimmed, "release version");
  const groups = match.groups as { base: string; suffix?: string };
  return {
    version: trimmed,
    baseVersion: groups.base,
    prerelease: Boolean(groups.suffix),
  };
}

export function parseReleaseTag(tag: string): ParsedReleaseVersion {
  const trimmed = tag.trim();
  const match = requiredMatch(RELEASE_TAG_RE, trimmed, "release tag");
  const groups = match.groups as { version: string };
  return parseReleaseVersion(groups.version);
}

export function normalizeVersionBase(version: string): string {
  return parseReleaseVersion(version).baseVersion;
}

export function validateVersionBase(
  actualVersion: string,
  expectedBaseVersion: string,
  label: string,
): void {
  const actualBaseVersion = normalizeVersionBase(actualVersion);
  if (actualBaseVersion !== expectedBaseVersion) {
    throw new Error(
      `${label} uses ${actualVersion}, but release tag requires base version ${expectedBaseVersion}.`,
    );
  }
}

export function replaceJsonManifestVersion(
  contents: string,
  releaseVersion: string,
  expectedBaseVersion: string,
  label: string,
): string {
  const manifest = parseJsonc(contents) as { version?: unknown };
  if (typeof manifest.version !== "string" || !manifest.version.trim()) {
    throw new Error(`${label} does not declare a string version.`);
  }
  validateVersionBase(manifest.version, expectedBaseVersion, label);
  manifest.version = releaseVersion;
  return JSON.stringify(manifest, null, 2) + "\n";
}

function replaceDependencyVersionSpec(
  packageName: string,
  currentSpec: string,
  releaseVersion: string,
  expectedBaseVersion: string,
): string {
  const match = currentSpec.match(/^(?<prefix>[~^<>= ]*)(?<version>\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)(?<suffix>.*)$/);
  if (!match?.groups) {
    return currentSpec;
  }
  const groups = match.groups as { prefix: string; version: string; suffix: string };
  validateVersionBase(groups.version, expectedBaseVersion, `${packageName} dependency`);
  return `${groups.prefix}${releaseVersion}${groups.suffix}`;
}

export function rewriteInternalNpmDependencies(
  dependencies: Record<string, string> | undefined,
  releaseVersion: string,
  expectedBaseVersion: string,
): Record<string, string> | undefined {
  if (!dependencies) {
    return dependencies;
  }

  return Object.fromEntries(
    Object.entries(dependencies).map(([packageName, spec]) => {
      if (!packageName.startsWith(INTERNAL_NPM_SCOPE)) {
        return [packageName, spec];
      }
      return [
        packageName,
        replaceDependencyVersionSpec(packageName, spec, releaseVersion, expectedBaseVersion),
      ];
    }),
  );
}

export function resolvePackageBuildVersion(checkedInVersion: string): string {
  const releaseVersion = Deno.env.get("TRELLIS_RELEASE_VERSION")?.trim();
  if (!releaseVersion) {
    return checkedInVersion;
  }

  const expectedBaseVersion =
    Deno.env.get("TRELLIS_RELEASE_BASE_VERSION")?.trim() || parseReleaseVersion(releaseVersion).baseVersion;
  validateVersionBase(checkedInVersion, expectedBaseVersion, "package version");
  return releaseVersion;
}

export function resolveInternalNpmDependenciesForBuild(
  dependencies: Record<string, string> | undefined,
): Record<string, string> | undefined {
  const releaseVersion = Deno.env.get("TRELLIS_RELEASE_VERSION")?.trim();
  if (!releaseVersion) {
    return dependencies;
  }

  const expectedBaseVersion =
    Deno.env.get("TRELLIS_RELEASE_BASE_VERSION")?.trim() || parseReleaseVersion(releaseVersion).baseVersion;
  return rewriteInternalNpmDependencies(dependencies, releaseVersion, expectedBaseVersion);
}

export function rewriteCargoManifestVersions(
  contents: string,
  releaseVersion: string,
  expectedBaseVersion: string,
): string {
  let inWorkspacePackage = false;
  const lines = contents.split("\n");

  return lines.map((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("[")) {
      inWorkspacePackage = trimmed === "[workspace.package]";
      return line;
    }

    if (inWorkspacePackage) {
      const workspaceVersionMatch = line.match(/^(\s*version\s*=\s*")([^"]+)("\s*)$/);
      if (workspaceVersionMatch) {
        validateVersionBase(workspaceVersionMatch[2], expectedBaseVersion, "rust workspace version");
        return `${workspaceVersionMatch[1]}${releaseVersion}${workspaceVersionMatch[3]}`;
      }
    }

    const dependencyMatch = line.match(/^([\w-]+\s*=\s*\{.*\bversion\s*=\s*")([^"]+)(".*\}\s*)$/);
    if (!dependencyMatch) {
      return line;
    }

    const crateName = dependencyMatch[1].split("=")[0].trim();
    if (!INTERNAL_RUST_CRATES.has(crateName)) {
      return line;
    }

    validateVersionBase(dependencyMatch[2], expectedBaseVersion, `${crateName} dependency`);
    return `${dependencyMatch[1]}${releaseVersion}${dependencyMatch[3]}`;
  }).join("\n");
}
