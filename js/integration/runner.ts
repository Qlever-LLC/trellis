import { fromFileUrl } from "@std/path";
import { jsCaseById } from "./_support/cases.ts";
import { loadClientTestMatrix, type MatrixCase } from "./_support/matrix.ts";

type RunnerOptions = {
  readonly fixtureFilters: readonly string[];
  readonly caseFilters: readonly string[];
  readonly coverageFilters: readonly string[];
  readonly skipConformance: boolean;
  readonly help: boolean;
};

const integrationRoot = fromFileUrl(new URL("./", import.meta.url));
const CONFORMANCE_FILE = "matrix_conformance_test.ts";

/** Runs the JS client integration suite selected by command-line filters. */
export async function main(args: readonly string[]): Promise<number> {
  try {
    const options = parseRunnerArgs(args);
    if (options.help) {
      console.log(helpText());
      return 0;
    }

    const matrix = await loadClientTestMatrix();
    validateFilters(options, matrix.cases);
    const selectedCases = selectMatrixCases(options, matrix.cases);
    const selectedFiles = resolveSelectedFiles(options, selectedCases);
    const conformanceFiles = options.skipConformance ? [] : [CONFORMANCE_FILE];
    const testFiles = [
      ...conformanceFiles,
      ...selectedFiles,
    ];

    if (testFiles.length === 0) {
      throw new Error("no JS integration test files selected");
    }

    const command = new Deno.Command(Deno.execPath(), {
      args: [
        "test",
        "-A",
        "-c",
        "deno.json",
        "--lock",
        "../deno.lock",
        ...testFiles,
      ],
      cwd: integrationRoot,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    const status = await command.spawn().status;
    return status.code;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (import.meta.main) {
  Deno.exit(await main(Deno.args));
}

function parseRunnerArgs(args: readonly string[]): RunnerOptions {
  const fixtureFilters: string[] = [];
  const caseFilters: string[] = [];
  const coverageFilters: string[] = [];
  let skipConformance = false;
  let help = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") {
      continue;
    } else if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg === "--skip-conformance") {
      skipConformance = true;
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
    } else {
      throw new Error(`unknown JS integration runner argument: ${arg}`);
    }
  }

  return {
    fixtureFilters,
    caseFilters,
    coverageFilters,
    skipConformance,
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
  const prefix = `${flag}=`;
  const value = arg.slice(prefix.length);
  if (value === "") {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function validateFilters(
  options: RunnerOptions,
  matrixCases: readonly MatrixCase[],
): void {
  const fixtureIds = new Set(matrixCases.map((caseEntry) => caseEntry.fixture));
  const caseIds = new Set(matrixCases.map((caseEntry) => caseEntry.id));
  const coverageIds = new Set(
    matrixCases.flatMap((caseEntry) => [...caseEntry.coverage]),
  );

  rejectUnknownFilters("fixture", options.fixtureFilters, fixtureIds);
  rejectUnknownFilters("case", options.caseFilters, caseIds);
  rejectUnknownFilters("coverage", options.coverageFilters, coverageIds);
}

function rejectUnknownFilters(
  kind: string,
  filters: readonly string[],
  validIds: ReadonlySet<string>,
): void {
  const unknown = filters.filter((id) => !validIds.has(id)).toSorted();
  if (unknown.length > 0) {
    throw new Error(
      `unknown JS integration ${kind} filter(s): ${unknown.join(", ")}`,
    );
  }
}

function selectMatrixCases(
  options: RunnerOptions,
  matrixCases: readonly MatrixCase[],
): readonly MatrixCase[] {
  if (
    options.fixtureFilters.length === 0 && options.caseFilters.length === 0 &&
    options.coverageFilters.length === 0
  ) {
    return matrixCases;
  }

  const fixtureFilters = new Set(options.fixtureFilters);
  const caseFilters = new Set(options.caseFilters);
  const coverageFilters = new Set(options.coverageFilters);
  return matrixCases.filter((caseEntry) =>
    fixtureFilters.has(caseEntry.fixture) || caseFilters.has(caseEntry.id) ||
    caseEntry.coverage.some((coverageId) => coverageFilters.has(coverageId))
  );
}

function resolveSelectedFiles(
  options: RunnerOptions,
  selectedCases: readonly MatrixCase[],
): readonly string[] {
  const missingCaseIds: string[] = [];
  const files = new Set<string>();

  for (const caseEntry of selectedCases) {
    const localCase = jsCaseById(caseEntry.id);
    if (localCase === undefined) {
      missingCaseIds.push(caseEntry.id);
    } else {
      files.add(localCase.file);
    }
  }

  if (options.skipConformance && missingCaseIds.length > 0) {
    throw new Error(
      `selected matrix case(s) do not have JS integration files: ${
        missingCaseIds.toSorted().join(", ")
      }`,
    );
  }

  return [...files].toSorted();
}

function helpText(): string {
  return `Run JS client integration tests.

Usage:
  deno task -c js/deno.json test:integration [options]

Options:
  --fixture <id>       Select matrix cases by fixture id. May be repeated.
  --case <id>          Select a matrix case id. May be repeated.
  --coverage <id>      Select matrix cases by coverage id. May be repeated.
  --skip-conformance   Run only selected behavior tests. This is for focused
                       incremental migration runs; the default keeps the
                       matrix conformance gate enabled.
  --help, -h           Print this help text.`;
}
