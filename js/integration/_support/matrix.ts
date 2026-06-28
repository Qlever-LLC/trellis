export type ScenarioParticipantKind =
  | "app"
  | "agent"
  | "service"
  | "device"
  | "admin";

export type ScenarioParticipant = {
  readonly name: string;
  readonly kind: ScenarioParticipantKind;
  readonly contract: string;
};

export type Scenario = {
  readonly participants: readonly ScenarioParticipant[];
  readonly given: readonly string[];
  readonly when: readonly string[];
  readonly then: readonly string[];
};

export type MatrixCase = {
  readonly id: string;
  readonly fixture: string;
  readonly title: string;
  readonly coverage: readonly string[];
  readonly description: string;
  readonly scenario: Scenario;
};

export type ClientTestMatrix = {
  readonly cases: readonly MatrixCase[];
};

const MATRIX_URL = new URL(
  "../../../integration/test-matrix.json",
  import.meta.url,
);

/** Loads and validates the shared client integration matrix. */
export async function loadClientTestMatrix(): Promise<ClientTestMatrix> {
  const text = await Deno.readTextFile(MATRIX_URL);
  const parsed: unknown = JSON.parse(text);
  return parseClientTestMatrix(parsed);
}

/** Returns sorted matrix case IDs. */
export function matrixCaseIds(matrix: ClientTestMatrix): string[] {
  return matrix.cases.map((caseEntry) => caseEntry.id).toSorted();
}

/** Returns matrix cases grouped by fixture name. */
export function matrixCasesByFixture(
  matrix: ClientTestMatrix,
): ReadonlyMap<string, readonly MatrixCase[]> {
  const groups = new Map<string, MatrixCase[]>();
  for (const caseEntry of matrix.cases) {
    const group = groups.get(caseEntry.fixture) ?? [];
    group.push(caseEntry);
    groups.set(caseEntry.fixture, group);
  }
  return groups;
}

function parseClientTestMatrix(value: unknown): ClientTestMatrix {
  const root = expectRecord(value, "matrix root");
  expectKeys(root, ["cases"], "matrix root");

  if (!Array.isArray(root.cases)) {
    throw new Error("client integration matrix cases must be an array");
  }

  const cases = root.cases
    .filter((caseEntry) => isMatrixCaseKind(caseEntry, "client"))
    .map((caseEntry, index) => parseMatrixCase(caseEntry, index));
  const duplicateIds = duplicates(cases.map((caseEntry) => caseEntry.id));
  if (duplicateIds.length > 0) {
    throw new Error(
      `client integration matrix has duplicate case ids: ${
        duplicateIds.join(
          ", ",
        )
      }`,
    );
  }

  return { cases };
}

function parseMatrixCase(
  value: unknown,
  index: number,
): MatrixCase {
  const context = `matrix case ${index + 1}`;
  const caseEntry = expectRecord(value, context);
  expectKeys(
    caseEntry,
    [
      "kind",
      "id",
      "fixture",
      "title",
      "coverage",
      "description",
      "scenario",
      "completion",
    ],
    context,
  );

  const id = expectNonEmptyString(caseEntry.id, `${context} id`);
  const fixture = expectNonEmptyString(caseEntry.fixture, `${context} fixture`);
  if (!id.startsWith(`${fixture}.`)) {
    throw new Error(
      `${context} id ${id} must start with fixture prefix ${fixture}.`,
    );
  }
  if (!Array.isArray(caseEntry.coverage)) {
    throw new Error(`${context} coverage must be an array`);
  }
  const coverage = caseEntry.coverage.map((entry, coverageIndex) =>
    expectNonEmptyString(entry, `${context} coverage ${coverageIndex + 1}`)
  );

  return {
    id,
    fixture,
    title: expectNonEmptyString(caseEntry.title, `${context} title`),
    coverage,
    description: expectNonEmptyString(
      caseEntry.description,
      `${context} description`,
    ),
    scenario: parseScenario(caseEntry.scenario, context),
  };
}

function parseScenario(value: unknown, context: string): Scenario {
  const scenario = expectRecord(value, `${context} scenario`);
  expectKeys(
    scenario,
    ["participants", "given", "when", "then"],
    `${context} scenario`,
  );

  if (
    !Array.isArray(scenario.participants) || scenario.participants.length === 0
  ) {
    throw new Error(
      `${context} scenario participants must be a non-empty array`,
    );
  }
  const participants = scenario.participants.map(
    (p: unknown, i: number) =>
      parseParticipant(p, `${context} scenario participant ${i + 1}`),
  );

  const given = validateStringArray(
    scenario.given,
    `${context} scenario given`,
  );
  const when = validateStringArray(scenario.when, `${context} scenario when`);
  const then = validateStringArray(scenario.then, `${context} scenario then`);

  return { participants, given, when, then };
}

function parseParticipant(
  value: unknown,
  context: string,
): ScenarioParticipant {
  const p = expectRecord(value, context);
  expectKeys(p, ["name", "kind", "contract"], context);

  const name = expectNonEmptyString(p.name, `${context} name`);
  const kind = expectNonEmptyString(p.kind, `${context} kind`);
  const validKinds = ["app", "agent", "service", "device", "admin"];
  if (!validKinds.includes(kind)) {
    throw new Error(
      `${context} kind must be one of: ${validKinds.join(", ")}`,
    );
  }
  const contract = expectNonEmptyString(p.contract, `${context} contract`);

  return { name, kind: kind as ScenarioParticipantKind, contract };
}

function validateStringArray(value: unknown, context: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${context} must be a non-empty array of strings`);
  }
  return value.map((entry, i) =>
    expectNonEmptyString(entry, `${context} ${i + 1}`)
  );
}

function expectRecord(
  value: unknown,
  context: string,
): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${context} must be an object`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMatrixCaseKind(value: unknown, kind: "client" | "service"): boolean {
  return isRecord(value) && value.kind === kind;
}

function expectKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
  context: string,
): void {
  const allowed = new Set(allowedKeys);
  const unknownKeys = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknownKeys.length > 0) {
    throw new Error(`${context} has unknown keys: ${unknownKeys.join(", ")}`);
  }
}

function expectNonEmptyString(value: unknown, context: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${context} must be a non-empty string`);
  }
  return value;
}

function duplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicateValues = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      duplicateValues.add(value);
    }
    seen.add(value);
  }
  return [...duplicateValues].toSorted();
}
