import { fromFileUrl } from "@std/path";
import type { ContractModule, TrellisApiLike } from "@qlever-llc/trellis";
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

const repoJsRoot = fromFileUrl(new URL("../../", import.meta.url));

const DEFAULT_TIMEOUTS = {
  startupMs: 60_000,
  reconciliationMs: 15_000,
  waitForMs: 10_000,
  shutdownMs: 10_000,
};

/** Describes how a live integration test manages its Trellis runtime. */
export type LiveRuntimeScope = TrellisIntegrationScope;

/** Structural interface for a live Trellis test runtime. */
export type LiveTrellisRuntime = TrellisIntegrationRuntime;

/** Contract module accepted by JS integration fixture helpers. */
export type RuntimeContract = ContractModule<
  string,
  TrellisApiLike,
  TrellisApiLike,
  TrellisApiLike
>;

export { runtimeScopeForCase, runtimeScopeIsolated };

/** Returns the Trellis repo default runtime options for JS integration tests. */
export function trellisRepoRuntimeOptions(
  options: Partial<TrellisTestRuntimeStartOptions> = {},
): TrellisIntegrationRuntimeOptions {
  return {
    ...options,
    keepWorkdir: options.keepWorkdir ?? keepWorkdirFromEnv(),
    trellis: {
      mutableDev: options.trellis?.mutableDev ?? true,
      command: options.trellis?.command ?? {
        cmd: Deno.execPath(),
        args: ["run", "-A", "./services/trellis/main.ts"],
        cwd: repoJsRoot,
      },
    },
    timeouts: {
      ...DEFAULT_TIMEOUTS,
      ...options.timeouts,
    },
  };
}

/** Starts the repo-local Trellis runtime for JS integration tests. */
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
  readonly fn: (runtime: LiveTrellisRuntime) => Promise<void>;
}): void {
  trellisIntegrationTest({
    ...args,
    runtime: trellisRepoRuntimeOptions(),
  });
}

function keepWorkdirFromEnv(): boolean {
  const value = Deno.env.get("TRELLIS_TEST_KEEP_WORKDIR")?.toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}
