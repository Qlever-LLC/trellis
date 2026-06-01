const REPO_OWNER = "qlever-llc";
const REPO_NAME = "trellis";
const BIN_NAME = "trellis-generate";
const SUPPORTED_TARGETS = new Set([
  "x86_64-unknown-linux-gnu",
  "aarch64-unknown-linux-gnu",
  "x86_64-apple-darwin",
  "aarch64-apple-darwin",
]);

type PackageManifest = {
  version?: unknown;
};

class ManifestNotFoundError extends Error {}

type CommandStatus = {
  success: boolean;
  code: number;
};

async function main(): Promise<void> {
  const localRepoRoot = await findLocalTrellisRepoRoot();
  if (localRepoRoot) {
    await runLocalGenerator(localRepoRoot, denoRuntime().args);
    return;
  }

  const packageVersion = await readPackageVersion();
  const binary = denoRuntime().env.get("TRELLIS_GENERATE_BIN")?.trim() ||
    await ensureCachedReleaseBinary(packageVersion);
  await verifyBinaryVersion(binary, packageVersion);
  await runBinary(binary, denoRuntime().args);
}

function denoRuntime(): typeof Deno {
  const getGlobalThis = Function("return globalThis") as () => {
    Deno?: typeof Deno;
  };
  const deno = getGlobalThis().Deno;
  if (!deno) {
    throw new Error("@qlever-llc/trellis/generate requires the Deno runtime");
  }
  return deno;
}

async function findLocalTrellisRepoRoot(): Promise<string | undefined> {
  if (new URL(import.meta.url).protocol !== "file:") {
    return undefined;
  }

  let current = urlDirname(import.meta.url);
  while (current !== dirname(current)) {
    if (
      await pathExists(joinPath(current, "rust/tools/generate/Cargo.toml")) &&
      await pathExists(joinPath(current, "js/deno.json"))
    ) {
      return current;
    }
    current = dirname(current);
  }
  return undefined;
}

async function runLocalGenerator(
  repoRoot: string,
  args: string[],
): Promise<void> {
  return await runCommand("cargo", [
    "run",
    "--manifest-path",
    joinPath(repoRoot, "rust/tools/generate/Cargo.toml"),
    "--bin",
    BIN_NAME,
    "--",
    ...args,
  ]);
}

async function readPackageVersion(): Promise<string> {
  const manifest = await readFirstManifest([
    new URL("./deno.json", import.meta.url),
    new URL("../package.json", import.meta.url),
    new URL("../../../package.json", import.meta.url),
  ]);
  if (typeof manifest.version !== "string" || !manifest.version.trim()) {
    throw new Error(
      "@qlever-llc/trellis package manifest does not declare a version",
    );
  }
  return manifest.version.trim();
}

async function readFirstManifest(urls: URL[]): Promise<PackageManifest> {
  const deno = denoRuntime();
  for (const url of urls) {
    try {
      return JSON.parse(await readManifestText(url)) as PackageManifest;
    } catch (error) {
      if (
        error instanceof deno.errors.NotFound ||
        error instanceof ManifestNotFoundError
      ) {
        continue;
      }
      throw error;
    }
  }
  throw new Error("@qlever-llc/trellis package manifest was not found");
}

async function readManifestText(url: URL): Promise<string> {
  if (url.protocol === "file:") {
    return await denoRuntime().readTextFile(url);
  }

  if (url.protocol === "http:" || url.protocol === "https:") {
    const response = await fetch(url);
    if (response.status === 404) {
      throw new ManifestNotFoundError(`package manifest was not found: ${url}`);
    }
    if (!response.ok) {
      throw new Error(`failed to read ${url}: HTTP ${response.status}`);
    }
    return await response.text();
  }

  throw new Error(`unsupported package manifest URL protocol: ${url.protocol}`);
}

async function ensureCachedReleaseBinary(version: string): Promise<string> {
  const target = releaseTarget();
  const cacheDir = joinPath(cacheRoot(), version, target);
  const binary = joinPath(cacheDir, BIN_NAME);
  if (await pathExists(binary)) {
    return binary;
  }

  const deno = denoRuntime();
  await deno.mkdir(cacheDir, { recursive: true });
  const tag = `v${version}`;
  const archiveName = `${BIN_NAME}-${tag}-${target}.tar.gz`;
  const archiveUrl =
    `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/download/${tag}/${archiveName}`;
  const checksumName = `checksum-${tag}-${target}-${BIN_NAME}.sha256`;
  const checksumUrl =
    `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/download/${tag}/${checksumName}`;

  const [archive, checksumText] = await Promise.all([
    downloadBytes(archiveUrl),
    downloadText(checksumUrl),
  ]);
  await verifyChecksum(archive, checksumText, archiveUrl);

  const archivePath = joinPath(cacheDir, archiveName);
  await deno.writeFile(archivePath, archive);
  await runCommandChecked("tar", ["-xzf", archivePath, "-C", cacheDir]);
  await deno.chmod(binary, 0o755);
  return binary;
}

function releaseTarget(): string {
  const deno = denoRuntime();
  if (SUPPORTED_TARGETS.has(deno.build.target)) {
    return deno.build.target;
  }

  const buildArch: string = deno.build.arch;
  const arch = buildArch === "x86_64" || buildArch === "x64"
    ? "x86_64"
    : buildArch;
  const os = deno.build.os === "darwin"
    ? "apple-darwin"
    : deno.build.os === "linux"
    ? "unknown-linux-gnu"
    : undefined;
  const target = os ? `${arch}-${os}` : undefined;
  if (target && SUPPORTED_TARGETS.has(target)) {
    return target;
  }

  throw new Error(
    `no ${BIN_NAME} release binary is available for ${deno.build.target}`,
  );
}

function cacheRoot(): string {
  const deno = denoRuntime();
  const explicit = deno.env.get("TRELLIS_GENERATE_CACHE")?.trim();
  if (explicit) {
    return explicit;
  }
  const xdg = deno.env.get("XDG_CACHE_HOME")?.trim();
  if (xdg) {
    return joinPath(xdg, "trellis", BIN_NAME);
  }
  const home = deno.env.get("HOME")?.trim();
  if (!home) {
    throw new Error(
      "HOME or TRELLIS_GENERATE_CACHE must be set to cache trellis-generate",
    );
  }
  return joinPath(home, ".cache", "trellis", BIN_NAME);
}

async function downloadBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`failed to download ${url}: HTTP ${response.status}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

async function downloadText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`failed to download ${url}: HTTP ${response.status}`);
  }
  return await response.text();
}

async function verifyChecksum(
  bytes: Uint8Array,
  checksumText: string,
  label: string,
): Promise<void> {
  const expected = checksumText.trim().split(/\s+/)[0]?.toLowerCase();
  if (!expected || !/^[0-9a-f]{64}$/.test(expected)) {
    throw new Error("release checksum asset did not contain a SHA-256 digest");
  }

  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  const actual = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  if (actual !== expected) {
    throw new Error(
      `checksum mismatch for ${label}: expected ${expected}, got ${actual}`,
    );
  }
}

async function verifyBinaryVersion(
  binary: string,
  expectedVersion: string,
): Promise<void> {
  const Command = denoRuntime().Command;
  const output = await new Command(binary, {
    args: ["--version"],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!output.success) {
    throw new Error(`failed to run ${binary} --version`);
  }
  const text = new TextDecoder().decode(output.stdout).trim();
  const actualVersion = text.split(/\s+/).find((part) =>
    /^v?\d+\.\d+\.\d+/.test(part)
  );
  if (
    !actualVersion ||
    normalizeVersion(actualVersion) !== normalizeVersion(expectedVersion)
  ) {
    throw new Error(
      `${binary} is ${
        text || "unknown version"
      }; expected ${BIN_NAME} ${expectedVersion}`,
    );
  }
}

function normalizeVersion(version: string): string {
  return version.trim().replace(/^v/, "").split("+")[0];
}

async function runBinary(binary: string, args: string[]): Promise<void> {
  return await runCommand(binary, args);
}

async function runCommand(
  command: string,
  args: string[],
  options: { cwd?: string } = {},
): Promise<void> {
  const status = await spawnCommand(command, args, options);
  denoRuntime().exit(status.code);
}

async function runCommandChecked(
  command: string,
  args: string[],
  options: { cwd?: string } = {},
): Promise<void> {
  const status = await spawnCommand(command, args, options);
  if (!status.success) {
    throw new Error(`${command} failed with exit code ${status.code}`);
  }
}

async function spawnCommand(
  command: string,
  args: string[],
  options: { cwd?: string } = {},
): Promise<CommandStatus> {
  const Command = denoRuntime().Command;
  const status = await new Command(command, {
    args,
    cwd: options.cwd,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  }).spawn().status;
  return status;
}

async function pathExists(path: string): Promise<boolean> {
  const deno = denoRuntime();
  try {
    await deno.stat(path);
    return true;
  } catch (error) {
    if (error instanceof deno.errors.NotFound) {
      return false;
    }
    throw error;
  }
}

function urlDirname(url: string): string {
  return dirname(decodeURIComponent(new URL(url).pathname));
}

function dirname(path: string): string {
  const normalized = path.replace(/\/+$/, "");
  const index = normalized.lastIndexOf("/");
  if (index <= 0) {
    return "/";
  }
  return normalized.slice(0, index);
}

function joinPath(...parts: string[]): string {
  return parts
    .filter((part) => part.length > 0)
    .join("/")
    .replace(/\/+/g, "/");
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error);
    denoRuntime().exit(1);
  });
}
