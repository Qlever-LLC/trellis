import { fromFileUrl } from "@std/path";
import { runTrellisIntegrationTests } from "@qlever-llc/trellis-test/integration/runner";
import type { TrellisIntegrationRunnerConfig } from "@qlever-llc/trellis-test/integration/runner";
import { jsCaseById, jsIntegrationCases } from "./_support/cases.ts";
import { loadClientTestMatrix } from "./_support/matrix.ts";
import { trellisRepoRuntimeOptions } from "./_support/runtime.ts";

const integrationRoot = fromFileUrl(new URL("./", import.meta.url));
const CONFORMANCE_FILE = "matrix_conformance_test.ts";
const REPO_DENO_TEST_ARGS = [
  "--no-check",
  "-A",
  "-c",
  "deno.json",
  "--lock",
  "../deno.lock",
] as const;

/** Runs the JS client integration suite selected by command-line filters. */
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
      config: await trellisRepoRunnerConfig(),
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (import.meta.main) {
  Deno.exit(await main(Deno.args));
}

/** Returns the Deno.test names for the given matrix case IDs. */
export function testNamesForCaseIds(ids: readonly string[]): string[] {
  const names: string[] = [];
  for (const id of ids) {
    const localCase = jsCaseById(id);
    if (localCase !== undefined) {
      names.push(localCase.testName);
    }
  }
  return names;
}

async function trellisRepoRunnerConfig(): Promise<
  TrellisIntegrationRunnerConfig
> {
  const matrix = await loadClientTestMatrix();
  const matrixById = new Map(
    matrix.cases.map((caseEntry) => [caseEntry.id, caseEntry]),
  );
  return {
    runtime: trellisRepoRuntimeOptions(),
    denoTestArgs: REPO_DENO_TEST_ARGS,
    cases: jsIntegrationCases.map((localCase) => {
      const matrixCase = matrixById.get(localCase.id);
      if (matrixCase === undefined) {
        throw new Error(
          `JS integration case ${localCase.id} is not present in the shared matrix`,
        );
      }
      return {
        id: localCase.id,
        fixture: matrixCase.fixture,
        file: localCase.file,
        testName: localCase.testName,
        coverage: matrixCase.coverage,
      };
    }),
    conformance: runMatrixConformance,
  };
}

async function runMatrixConformance(): Promise<void> {
  const command = new Deno.Command(Deno.execPath(), {
    args: ["test", ...REPO_DENO_TEST_ARGS, CONFORMANCE_FILE],
    cwd: integrationRoot,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const status = await command.spawn().status;
  if (status.code !== 0) {
    throw new Error(`matrix conformance failed with exit code ${status.code}`);
  }
}

function helpText(): string {
  return `Run JS client integration tests.

Usage:
  deno task -c js/deno.json test:client-integration [options]
  deno task -c js/deno.json test:client-integration -- --parallel [options]

Options:
  --fixture <id>       Select matrix cases by fixture id. May be repeated.
  --case <id>          Select a matrix case id. May be repeated.
  --coverage <id>      Select matrix cases by coverage id. May be repeated.
  --parallel           Run behavior tests in parallel using one shared
                       Trellis runtime. Conformance always runs serially.
  --jobs <n>           Max parallel worker count via DENO_JOBS.
  --skip-conformance   Run only selected behavior tests.
  --help, -h           Print this help text.`;
}
