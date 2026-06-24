import { main as runClientIntegration } from "./runner.ts";
import { jsIntegrationCases } from "./_support/cases.ts";
import { loadClientTestMatrix } from "./_support/matrix.ts";
import { main as runServiceIntegration } from "../services/trellis/integration/runner.ts";
import { controlPlaneIntegrationCases } from "../services/trellis/integration/_support/cases.ts";
import { serviceTestMatrix } from "../services/trellis/integration/_support/matrix.ts";

type ParsedArgs = {
  readonly fixtureFilters: readonly string[];
  readonly caseFilters: readonly string[];
  readonly coverageFilters: readonly string[];
  readonly passthrough: readonly string[];
  readonly help: boolean;
};

type MatrixCase = {
  readonly id: string;
  readonly fixture: string;
  readonly coverage: readonly string[];
};

/** Runs all TypeScript integration cases selected from the unified matrix. */
export async function main(args: readonly string[]): Promise<number> {
  try {
    const runnerArgs = args[0] === "--" ? args.slice(1) : args;
    const parsed = parseArgs(runnerArgs);
    if (parsed.help) {
      console.log(helpText());
      return 0;
    }

    const clientMatrix = await loadClientTestMatrix();
    const clientIds = selectCaseIds(
      clientMatrix.cases,
      jsIntegrationCases.map((caseEntry) => caseEntry.id),
      parsed,
    );
    const serviceIds = selectCaseIds(
      serviceTestMatrix.cases,
      controlPlaneIntegrationCases.map((caseEntry) => caseEntry.id),
      parsed,
    );

    if (clientIds.length === 0 && serviceIds.length === 0) {
      throw new Error("no TypeScript integration cases selected");
    }

    if (clientIds.length > 0) {
      const code = await runClientIntegration(toRunnerArgs(clientIds, parsed));
      if (code !== 0) return code;
    }
    if (serviceIds.length > 0) {
      const code = await runServiceIntegration(
        toRunnerArgs(serviceIds, parsed),
      );
      if (code !== 0) return code;
    }

    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (import.meta.main) {
  Deno.exit(await main(Deno.args));
}

function parseArgs(args: readonly string[]): ParsedArgs {
  const fixtureFilters: string[] = [];
  const caseFilters: string[] = [];
  const coverageFilters: string[] = [];
  const passthrough: string[] = [];
  let help = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      help = true;
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
    } else if (arg === "--") {
      passthrough.push(arg, ...args.slice(index + 1));
      break;
    } else {
      passthrough.push(arg);
    }
  }

  return { fixtureFilters, caseFilters, coverageFilters, passthrough, help };
}

function selectCaseIds(
  matrixCases: readonly MatrixCase[],
  localIds: readonly string[],
  args: ParsedArgs,
): string[] {
  const localIdSet = new Set(localIds);
  return matrixCases
    .filter((caseEntry) => localIdSet.has(caseEntry.id))
    .filter((caseEntry) => matchesFilters(caseEntry, args))
    .map((caseEntry) => caseEntry.id);
}

function matchesFilters(caseEntry: MatrixCase, args: ParsedArgs): boolean {
  if (
    args.caseFilters.length > 0 && !args.caseFilters.includes(caseEntry.id)
  ) {
    return false;
  }
  if (
    args.fixtureFilters.length > 0 &&
    !args.fixtureFilters.includes(caseEntry.fixture)
  ) {
    return false;
  }
  if (
    args.coverageFilters.length > 0 &&
    !args.coverageFilters.some((coverage) =>
      caseEntry.coverage.includes(coverage)
    )
  ) {
    return false;
  }
  return true;
}

function toRunnerArgs(caseIds: readonly string[], args: ParsedArgs): string[] {
  const selected = caseIds.flatMap((caseId) => ["--case", caseId]);
  return [...selected, ...args.passthrough];
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
  const value = arg.slice(flag.length + 1);
  if (value === "") {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function helpText(): string {
  return `Run all TypeScript integration tests from integration/test-matrix.json.

Usage:
  deno task -c js/deno.json test:integration [options]

Options:
  --fixture <id>       Select matrix cases by fixture id. May be repeated.
  --case <id>          Select a matrix case id. May be repeated.
  --coverage <id>      Select matrix cases by coverage id. May be repeated.
  --parallel           Pass through to each physical runner.
  --jobs <n>           Pass through to each physical runner.
  --skip-conformance   Pass through to each physical runner.
  --help, -h           Print this help text.`;
}
