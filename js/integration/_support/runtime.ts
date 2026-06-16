import { fromFileUrl } from "@std/path";
import { TrellisTestRuntime } from "@qlever-llc/trellis-test";
import type { TrellisTestRuntimeStartOptions } from "@qlever-llc/trellis-test";

const repoJsRoot = fromFileUrl(new URL("../../", import.meta.url));

const DEFAULT_TIMEOUTS = {
  startupMs: 60_000,
  reconciliationMs: 15_000,
  waitForMs: 10_000,
  shutdownMs: 10_000,
};

/** Starts the repo-local Trellis runtime for JS integration tests. */
export async function startTrellisRuntime(
  options: Partial<TrellisTestRuntimeStartOptions> = {},
): Promise<TrellisTestRuntime> {
  return await TrellisTestRuntime.start({
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
  });
}

/** Runs an integration test body with deterministic Trellis runtime cleanup. */
export async function withTrellisRuntime<T>(
  fn: (runtime: TrellisTestRuntime) => Promise<T>,
  options: Partial<TrellisTestRuntimeStartOptions> = {},
): Promise<T> {
  const runtime = await startTrellisRuntime(options);
  try {
    return await fn(runtime);
  } finally {
    await runtime.stop();
  }
}

function keepWorkdirFromEnv(): boolean {
  const value = Deno.env.get("TRELLIS_TEST_KEEP_WORKDIR")?.toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}
