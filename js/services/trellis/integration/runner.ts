import { fromFileUrl } from "@std/path";
import { runTrellisIntegrationTests } from "@qlever-llc/trellis-test/integration/runner";
import type { TrellisIntegrationRunnerConfig } from "@qlever-llc/trellis-test/integration/runner";
import {
  controlPlaneCaseById,
  controlPlaneIntegrationCases,
} from "./_support/cases.ts";
import { trellisRepoRuntimeOptions } from "./_support/runtime.ts";

const integrationRoot = fromFileUrl(new URL("./", import.meta.url));
const REPO_DENO_TEST_ARGS = [
  "--no-check",
  "-A",
  "-c",
  "deno.json",
  "--lock",
  "../../../deno.lock",
] as const;

/** Runs Trellis service-integration tests selected by filters. */
export async function main(args: readonly string[]): Promise<number> {
  try {
    const runnerArgs = args[0] === "--" ? args.slice(1) : args;

    if (runnerArgs.includes("--help") || runnerArgs.includes("-h")) {
      console.log(helpText());
      return 0;
    }

    return await runTrellisIntegrationTests({
      args: runnerArgs,
      cwd: integrationRoot,
      config: trellisControlPlaneRunnerConfig(),
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (import.meta.main) {
  Deno.exit(await main(Deno.args));
}

/** Returns the Deno.test names for the given control-plane case IDs. */
export function testNamesForCaseIds(ids: readonly string[]): string[] {
  const names: string[] = [];
  for (const id of ids) {
    const localCase = controlPlaneCaseById(id);
    if (localCase !== undefined) {
      names.push(localCase.testName);
    }
  }
  return names;
}

function trellisControlPlaneRunnerConfig(): TrellisIntegrationRunnerConfig {
  return {
    runtime: trellisRepoRuntimeOptions(),
    denoTestArgs: REPO_DENO_TEST_ARGS,
    cases: controlPlaneIntegrationCases,
  };
}

function helpText(): string {
  return `Run Trellis service-integration tests.

Usage:
  deno task -c js/deno.json test:service-integration [options]
  deno task -c js/deno.json test:service-integration -- --parallel [options]

Options:
  --fixture <id>       Select cases by fixture id. May be repeated.
  --case <id>          Select a case id. May be repeated.
  --coverage <id>      Select cases by coverage id. May be repeated.
  --parallel           Run behavior tests in parallel using one shared
                       Trellis runtime.
  --jobs <n>           Max parallel worker count via DENO_JOBS.
  --help, -h           Print this help text.`;
}
