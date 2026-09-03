import type { CallerContract } from "@qlever-llc/trellis";
import { TrellisTestRuntime } from "@qlever-llc/trellis-test";
import type { TrellisTestRuntimeStartOptions } from "@qlever-llc/trellis-test";
import {
  runtimeScopeForCase,
  runtimeScopeIsolated,
  trellisIntegrationTest,
  withTrellisIntegrationRuntime,
} from "@qlever-llc/trellis-test/integration";
import type {
  TrellisIntegrationRuntime,
  TrellisIntegrationRuntimeOptions,
  TrellisIntegrationScope,
} from "@qlever-llc/trellis-test/integration";
import { fromFileUrl } from "@std/path";

const repoJsRoot = fromFileUrl(new URL("../../", import.meta.url));

const DEFAULT_TIMEOUTS = {
  startupMs: 60_000,
  reconciliationMs: 60_000,
  waitForMs: 10_000,
  shutdownMs: 10_000,
};

/** Describes how a live integration test manages its Trellis runtime. */
export type LiveRuntimeScope = TrellisIntegrationScope;

/** Structural interface for a live Trellis test runtime. */
export type LiveTrellisRuntime = TrellisIntegrationRuntime;

/** Contract module accepted by TypeScript integration fixture helpers. */
export type RuntimeContract = CallerContract;

export { runtimeScopeForCase, runtimeScopeIsolated };

/** Returns the Trellis repo default runtime options for TypeScript integration tests. */
export function trellisRepoRuntimeOptions(
  options: Partial<TrellisTestRuntimeStartOptions> = {},
): TrellisIntegrationRuntimeOptions {
  return {
    ...options,
    keepWorkdir: options.keepWorkdir ?? keepWorkdirFromEnv(),
    trellis: {
      command: options.trellis?.command ?? repoTrellisCommand(),
    },
    timeouts: {
      ...DEFAULT_TIMEOUTS,
      ...options.timeouts,
    },
  };
}

function repoTrellisCommand() {
  const server = Deno.env.get("TRELLIS_TEST_SERVER_BIN");
  if (server !== undefined) {
    return { cmd: server, args: ["--config", "{config}", "all"] };
  }
  if (Deno.env.get("TRELLIS_TEST_PREBUILT_ONLY") === "1") {
    throw new Error(
      "TRELLIS_TEST_SERVER_BIN is required while TRELLIS_TEST_PREBUILT_ONLY=1; refusing Cargo fallback",
    );
  }
  return {
    cmd: "cargo",
    args: [
      "run",
      "--manifest-path",
      "../rust/Cargo.toml",
      "-p",
      "trellis-server",
      "--",
      "--config",
      "{config}",
      "all",
    ],
    cwd: repoJsRoot,
  };
}

/** Starts the repo-local Trellis runtime for TypeScript integration tests. */
export async function startTrellisRuntime(
  options: Partial<TrellisTestRuntimeStartOptions> = {},
): Promise<TrellisTestRuntime> {
  return await TrellisTestRuntime.start(trellisRepoRuntimeOptions(options));
}

/** Runs an integration test body with deterministic Trellis runtime cleanup. */
export async function withTrellisRuntime<T>(
  fn: (runtime: LiveTrellisRuntime) => Promise<T>,
  options: Partial<TrellisTestRuntimeStartOptions> = {},
): Promise<T> {
  return await withTrellisIntegrationRuntime(
    fn,
    trellisRepoRuntimeOptions(options),
  );
}

/** Registers a Deno integration test backed by the repo-local Trellis runtime. */
export function liveTrellisTest(args: {
  readonly name: string;
  readonly scope: LiveRuntimeScope;
  readonly runtime?: Partial<TrellisTestRuntimeStartOptions>;
  readonly fn: (runtime: LiveTrellisRuntime) => Promise<void>;
}): void {
  if (args.scope.kind !== "shared-case") {
    throw new Error("liveTrellisTest requires a case-scoped runtime");
  }
  trellisIntegrationTest({
    ...args,
    caseId: args.scope.caseId,
    runtime: trellisRepoRuntimeOptions(args.runtime),
  });
}

function keepWorkdirFromEnv(): boolean {
  const value = Deno.env.get("TRELLIS_TEST_KEEP_WORKDIR")?.toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}
