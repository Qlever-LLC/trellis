import {
  dirname,
  fromFileUrl,
  isAbsolute,
  resolve,
  toFileUrl,
} from "@std/path";
import { startTrellisIntegrationSharedRuntimeHost } from "./shared_runtime_host.ts";
import type { TrellisIntegrationSharedRuntimeHost } from "./shared_runtime_host.ts";
import type {
  TrellisIntegrationCase,
  TrellisIntegrationRuntimeOptions,
} from "./types.ts";

/** Configuration loaded by the generic Trellis integration test runner. */
export type TrellisIntegrationRunnerConfig = {
  /** Runtime startup options used by direct tests and the shared runtime host. */
  readonly runtime: TrellisIntegrationRuntimeOptions;
  /**
   * Additional arguments passed to child `deno test` before runner-managed flags
   * and selected files, for example `-A`, `-c`, or lockfile options.
   */
  readonly denoTestArgs?: readonly string[];
  /** Integration cases known to this repo. */
  readonly cases: readonly TrellisIntegrationCase[];
  /** Optional conformance hook for repo-specific case validation. */
  readonly conformance?: () => Promise<void> | void;
};

/** Options for programmatic execution of the generic integration runner. */
export type TrellisIntegrationRunnerOptions = {
  /** CLI-style arguments to parse. Defaults to `Deno.args`. */
  readonly args?: readonly string[];
  /** Preloaded runner config, primarily for unit tests and custom wrappers. */
  readonly config?: TrellisIntegrationRunnerConfig;
  /** Directory used for relative config paths and `deno test`. Defaults to `Deno.cwd()`. */
  readonly cwd?: string;
  /** Additional child `deno test` arguments supplied by programmatic callers. */
  readonly denoTestArgs?: readonly string[];
  /**
   * Runs the constructed `deno test` command.
   *
   * Tests can inject this hook to assert command construction without spawning a
   * child Deno process. Production callers normally use the default runner.
   */
  readonly commandRunner?: (command: {
    /** Executable path for the Deno binary. */
    readonly executable: string;
    /** Arguments passed to the Deno executable. */
    readonly args: readonly string[];
    /** Working directory for the child test process. */
    readonly cwd: string;
    /** Environment overrides for the child test process. */
    readonly env?: Record<string, string>;
  }) => Promise<number>;
  /**
   * Starts the shared runtime host used by `--parallel`.
   *
   * Tests can inject this hook to avoid starting Trellis while verifying the
   * command environment passed to worker tests.
   */
  readonly sharedRuntimeHostStarter?: (args: {
    /** Runtime options from the loaded runner config. */
    readonly runtime: TrellisIntegrationRuntimeOptions;
  }) => Promise<TrellisIntegrationSharedRuntimeHost>;
  /** Output hook used for help text. Defaults to `console`. */
  readonly output?: {
    /** Writes ordinary runner output. */
    log(message: string): void;
  };
};

type ParsedRunnerArgs = {
  readonly configPath: string | undefined;
  readonly fixtureFilters: readonly string[];
  readonly caseFilters: readonly string[];
  readonly coverageFilters: readonly string[];
  readonly skipConformance: boolean;
  readonly parallel: boolean;
  readonly jobs: number | undefined;
  readonly denoTestArgs: readonly string[];
  readonly help: boolean;
};

type LoadedRunnerConfig = {
  readonly config: TrellisIntegrationRunnerConfig;
  readonly baseDir: string;
};

type SelectedCases = {
  readonly files: readonly string[];
  readonly testNames: readonly string[];
};

/**
 * Runs Trellis integration tests from a loaded config or `--config` module.
 *
 * The runner is intentionally generic: it does not add repo-local Deno config,
 * lockfile, permission, or Trellis command defaults. Case file paths are
 * resolved relative to the config module when a config path is supplied.
 */
export async function runTrellisIntegrationTests(
  options: TrellisIntegrationRunnerOptions = {},
): Promise<number> {
  const args = parseRunnerArgs(options.args ?? Deno.args);
  const output = options.output ?? console;
  const cwd = options.cwd ?? Deno.cwd();

  if (args.help) {
    output.log(helpText());
    return 0;
  }

  const loaded = options.config === undefined
    ? await loadRunnerConfig(args.configPath, cwd)
    : {
      config: options.config,
      baseDir: args.configPath === undefined
        ? cwd
        : resolveConfigLocation(args.configPath, cwd).baseDir,
    };

  validateFilters(args, loaded.config.cases);
  const selected = selectCases(args, loaded.config.cases, loaded.baseDir);
  if (selected.files.length === 0) {
    throw new Error("no Trellis integration test cases selected");
  }

  if (!args.skipConformance) {
    await loaded.config.conformance?.();
  }

  const commandRunner = options.commandRunner ?? runDenoTestCommand;
  const childDenoTestArgs = [
    ...(loaded.config.denoTestArgs ?? []),
    ...(options.denoTestArgs ?? []),
    ...args.denoTestArgs,
  ];
  if (args.parallel) {
    const startHost = options.sharedRuntimeHostStarter ??
      startTrellisIntegrationSharedRuntimeHost;
    const host = await startHost({ runtime: loaded.config.runtime });
    const env = { ...host.env };
    if (args.jobs !== undefined) {
      env.DENO_JOBS = String(args.jobs);
    }

    try {
      return await commandRunner({
        executable: Deno.execPath(),
        args: denoTestArgs({
          parallel: true,
          extraArgs: childDenoTestArgs,
          files: selected.files,
          filter: testNameFilter(selected.testNames),
        }),
        cwd,
        env,
      });
    } finally {
      await host.stop();
    }
  }

  return await commandRunner({
    executable: Deno.execPath(),
    args: denoTestArgs({
      parallel: false,
      extraArgs: childDenoTestArgs,
      files: selected.files,
      filter: testNameFilter(selected.testNames),
    }),
    cwd,
  });
}

/**
 * CLI entrypoint for the generic Trellis integration test runner.
 *
 * This function returns the desired process exit code so tests and wrappers can
 * call it directly. The module only calls `Deno.exit` from the `import.meta.main`
 * branch below.
 */
export async function main(
  args: readonly string[] = Deno.args,
): Promise<number> {
  try {
    return await runTrellisIntegrationTests({ args });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (import.meta.main) {
  Deno.exit(await main());
}

function parseRunnerArgs(args: readonly string[]): ParsedRunnerArgs {
  const fixtureFilters: string[] = [];
  const caseFilters: string[] = [];
  const coverageFilters: string[] = [];
  let configPath: string | undefined;
  let skipConformance = false;
  let parallel = false;
  let jobs: number | undefined;
  const denoTestArgs: string[] = [];
  let help = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") {
      denoTestArgs.push(...args.slice(index + 1));
      break;
    } else if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg === "--config") {
      configPath = setSingleValue(
        configPath,
        readFlagValue(args, index, arg),
        arg,
      );
      index += 1;
    } else if (arg.startsWith("--config=")) {
      configPath = setSingleValue(
        configPath,
        readInlineFlagValue(arg, "--config"),
        "--config",
      );
    } else if (arg === "--fixture") {
      fixtureFilters.push(readFlagValue(args, index, arg));
      index += 1;
    } else if (arg.startsWith("--fixture=")) {
      fixtureFilters.push(readInlineFlagValue(arg, "--fixture"));
    } else if (arg === "--case") {
      caseFilters.push(readFlagValue(args, index, arg));
      index += 1;
    } else if (arg.startsWith("--case=")) {
      caseFilters.push(readInlineFlagValue(arg, "--case"));
    } else if (arg === "--coverage") {
      coverageFilters.push(readFlagValue(args, index, arg));
      index += 1;
    } else if (arg.startsWith("--coverage=")) {
      coverageFilters.push(readInlineFlagValue(arg, "--coverage"));
    } else if (arg === "--parallel") {
      parallel = true;
    } else if (arg === "--jobs") {
      jobs = parsePositiveInteger(readFlagValue(args, index, arg), arg);
      index += 1;
    } else if (arg.startsWith("--jobs=")) {
      jobs = parsePositiveInteger(readInlineFlagValue(arg, "--jobs"), "--jobs");
    } else if (arg === "--deno-test-arg") {
      denoTestArgs.push(readFlagValue(args, index, arg));
      index += 1;
    } else if (arg.startsWith("--deno-test-arg=")) {
      denoTestArgs.push(readInlineFlagValue(arg, "--deno-test-arg"));
    } else if (arg === "--skip-conformance") {
      skipConformance = true;
    } else {
      throw new Error(`unknown Trellis integration runner argument: ${arg}`);
    }
  }

  return {
    configPath,
    fixtureFilters,
    caseFilters,
    coverageFilters,
    skipConformance,
    parallel,
    jobs,
    denoTestArgs,
    help,
  };
}

function readFlagValue(
  args: readonly string[],
  index: number,
  flag: string,
): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function readInlineFlagValue(arg: string, flag: string): string {
  const value = arg.slice(`${flag}=`.length);
  if (value === "") {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function setSingleValue(
  previous: string | undefined,
  value: string,
  flag: string,
): string {
  if (previous !== undefined) {
    throw new Error(`${flag} may only be provided once`);
  }
  return value;
}

function parsePositiveInteger(value: string, flag: string): number {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error(`${flag} requires a positive integer`);
  }
  return Number(value);
}

async function loadRunnerConfig(
  configPath: string | undefined,
  cwd: string,
): Promise<LoadedRunnerConfig> {
  if (configPath === undefined) {
    throw new Error("--config is required");
  }

  const location = resolveConfigLocation(configPath, cwd);
  const moduleValue: unknown = await import(location.specifier);
  if (!isRecord(moduleValue) || !isRunnerConfig(moduleValue.default)) {
    throw new Error(
      `Trellis integration runner config ${configPath} must export a default config`,
    );
  }

  return { config: moduleValue.default, baseDir: location.baseDir };
}

function resolveConfigLocation(
  configPath: string,
  cwd: string,
): { readonly specifier: string; readonly baseDir: string } {
  if (configPath.startsWith("file:")) {
    const url = new URL(configPath);
    return { specifier: url.href, baseDir: dirname(fromFileUrl(url)) };
  }

  if (/^[A-Za-z][A-Za-z\d+.-]*:\/\//.test(configPath)) {
    throw new Error("--config must be a local path or file URL");
  }

  const absolutePath = isAbsolute(configPath)
    ? configPath
    : resolve(cwd, configPath);
  return {
    specifier: toFileUrl(absolutePath).href,
    baseDir: dirname(absolutePath),
  };
}

function isRunnerConfig(
  value: unknown,
): value is TrellisIntegrationRunnerConfig {
  if (
    !isRecord(value) || !isRecord(value.runtime) || !Array.isArray(value.cases)
  ) {
    return false;
  }

  if (
    value.conformance !== undefined && typeof value.conformance !== "function"
  ) {
    return false;
  }

  return value.cases.every(isIntegrationCase);
}

function isIntegrationCase(value: unknown): value is TrellisIntegrationCase {
  if (!isRecord(value)) return false;
  if (
    typeof value.id !== "string" || typeof value.fixture !== "string" ||
    typeof value.file !== "string" || typeof value.testName !== "string"
  ) {
    return false;
  }

  return value.coverage === undefined ||
    (Array.isArray(value.coverage) &&
      value.coverage.every((tag) => typeof tag === "string"));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function validateFilters(
  options: ParsedRunnerArgs,
  cases: readonly TrellisIntegrationCase[],
): void {
  const fixtures = new Set(cases.map((caseEntry) => caseEntry.fixture));
  const caseIds = new Set(cases.map((caseEntry) => caseEntry.id));
  const coverageTags = new Set(
    cases.flatMap((caseEntry) => [...(caseEntry.coverage ?? [])]),
  );

  rejectUnknownFilters("fixture", options.fixtureFilters, fixtures);
  rejectUnknownFilters("case", options.caseFilters, caseIds);
  rejectUnknownFilters("coverage", options.coverageFilters, coverageTags);
}

function rejectUnknownFilters(
  kind: string,
  filters: readonly string[],
  validValues: ReadonlySet<string>,
): void {
  const unknown = filters.filter((filter) => !validValues.has(filter))
    .toSorted();
  if (unknown.length > 0) {
    throw new Error(
      `unknown Trellis integration ${kind} filter(s): ${unknown.join(", ")}`,
    );
  }
}

function selectCases(
  options: ParsedRunnerArgs,
  cases: readonly TrellisIntegrationCase[],
  baseDir: string,
): SelectedCases {
  const fixtureFilters = new Set(options.fixtureFilters);
  const caseFilters = new Set(options.caseFilters);
  const coverageFilters = new Set(options.coverageFilters);
  const files: string[] = [];
  const seenFiles = new Set<string>();
  const testNames: string[] = [];

  for (const caseEntry of cases) {
    if (
      hasFilters(options) && !fixtureFilters.has(caseEntry.fixture) &&
      !caseFilters.has(caseEntry.id) &&
      !(caseEntry.coverage ?? []).some((tag) => coverageFilters.has(tag))
    ) {
      continue;
    }

    const file = resolveCaseFile(baseDir, caseEntry.file);
    if (!seenFiles.has(file)) {
      files.push(file);
      seenFiles.add(file);
    }
    testNames.push(caseEntry.testName);
  }

  return { files, testNames };
}

function resolveCaseFile(baseDir: string, file: string): string {
  return isAbsolute(file) ? file : resolve(baseDir, file);
}

function hasFilters(options: ParsedRunnerArgs): boolean {
  return options.fixtureFilters.length > 0 || options.caseFilters.length > 0 ||
    options.coverageFilters.length > 0;
}

function denoTestArgs(args: {
  readonly parallel: boolean;
  readonly extraArgs: readonly string[];
  readonly files: readonly string[];
  readonly filter: string | undefined;
}): readonly string[] {
  const denoArgs = ["test"];
  denoArgs.push(...args.extraArgs);
  if (args.parallel) {
    denoArgs.push("--parallel");
  }
  if (args.filter !== undefined) {
    denoArgs.push("--filter", args.filter);
  }
  denoArgs.push(...args.files);
  return denoArgs;
}

function testNameFilter(testNames: readonly string[]): string | undefined {
  if (testNames.length === 0) return undefined;
  return `/^(?:${testNames.map(escapeRegExp).join("|")})$/`;
}

function escapeRegExp(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function runDenoTestCommand(command: {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env?: Record<string, string>;
}): Promise<number> {
  const process = new Deno.Command(command.executable, {
    args: [...command.args],
    cwd: command.cwd,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
    env: command.env === undefined
      ? undefined
      : { ...Deno.env.toObject(), ...command.env },
  });
  const status = await process.spawn().status;
  return status.code;
}

function helpText(): string {
  return `Run Trellis integration tests.

Usage:
  deno run -A jsr:@qlever-llc/trellis-test/integration/runner --config trellis.integration.ts [options]

Options:
  --config <path>       Required. Module exporting default runner config.
  --fixture <fixture>   Select cases by fixture. May be repeated.
  --case <case-id>      Select a case id. May be repeated.
  --coverage <tag>      Select cases by coverage tag. May be repeated.
  --parallel            Run selected tests with one shared Trellis runtime.
  --jobs <n>            Max parallel worker count via DENO_JOBS.
  --deno-test-arg <arg> Pass one argument through to child deno test. May be repeated.
  --                    Pass all remaining arguments through to child deno test.
  --skip-conformance    Skip the optional config conformance hook.
  --help, -h            Print this help text.`;
}
