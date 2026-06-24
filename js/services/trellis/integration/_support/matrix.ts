import matrixJson from "../../../../../integration/test-matrix.json" with {
  type: "json",
};

export type ScenarioParticipantKind =
  | "admin"
  | "app"
  | "control-plane"
  | "service";

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

export type TypeScriptMatrixImplementation = {
  readonly file: string;
  readonly testName: string;
};

export type RustMatrixImplementation = {
  readonly module: string;
  readonly function: string;
};

export type MatrixImplementations = {
  readonly typescript: TypeScriptMatrixImplementation;
  readonly rust?: RustMatrixImplementation;
};

export type CompletionStatus = "implemented" | "required";

export type MatrixCompletion = {
  readonly typescript: CompletionStatus;
  readonly rust: CompletionStatus;
};

export type MatrixCase = {
  readonly id: string;
  readonly fixture: string;
  readonly title: string;
  readonly coverage: readonly string[];
  readonly description: string;
  readonly scenario: Scenario;
  readonly implementations: MatrixImplementations;
  readonly completion: MatrixCompletion;
};

export type ServiceTestMatrix = {
  readonly cases: readonly MatrixCase[];
};

/** Shared service-integration matrix parsed from the repository registry. */
export const serviceTestMatrix = parseServiceTestMatrix(matrixJson);

/** Returns sorted service matrix case IDs. */
export function matrixCaseIds(matrix: ServiceTestMatrix): string[] {
  return matrix.cases.map((caseEntry) => caseEntry.id).toSorted();
}

/** Parses and validates the shared service-integration matrix shape. */
export function parseServiceTestMatrix(value: unknown): ServiceTestMatrix {
  const root = expectRecord(value, "service matrix root");
  expectKeys(root, ["cases"], "service matrix root");

  if (!Array.isArray(root.cases)) {
    throw new Error("service matrix cases must be an array");
  }

  const cases = root.cases
    .filter((caseEntry) => isMatrixCaseKind(caseEntry, "service"))
    .map((caseEntry, index) => parseMatrixCase(caseEntry, index));
  const duplicateIds = duplicates(cases.map((caseEntry) => caseEntry.id));
  if (duplicateIds.length > 0) {
    throw new Error(
      `service matrix has duplicate case ids: ${duplicateIds.join(", ")}`,
    );
  }

  return { cases };
}

function parseMatrixCase(value: unknown, index: number): MatrixCase {
  const context = `service matrix case ${index + 1}`;
  const caseEntry = expectRecord(value, context);
  expectKeys(
    caseEntry,
    [
      "id",
      "kind",
      "fixture",
      "title",
      "coverage",
      "description",
      "scenario",
      "implementations",
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

  const implementations = parseImplementations(
    caseEntry.implementations,
    context,
  );
  const completion = parseCompletion(caseEntry.completion, context);
  if (completion.typescript !== "implemented") {
    throw new Error(`${context} completion.typescript must be implemented`);
  }
  if (completion.rust === "implemented" && implementations.rust === undefined) {
    throw new Error(
      `${context} completion.rust is implemented but implementations.rust is missing`,
    );
  }
  if (completion.rust === "required" && implementations.rust !== undefined) {
    throw new Error(
      `${context} completion.rust is required and must not include implementations.rust`,
    );
  }

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
    implementations,
    completion,
  };
}

function parseImplementations(
  value: unknown,
  context: string,
): MatrixImplementations {
  const implementations = expectRecord(
    value,
    `${context} implementations`,
  );
  expectKeys(
    implementations,
    ["typescript", "rust"],
    `${context} implementations`,
  );
  if (implementations.typescript === undefined) {
    throw new Error(`${context} implementations.typescript is required`);
  }

  return {
    typescript: parseImplementation(
      implementations.typescript,
      `${context} implementations.typescript`,
    ),
    rust: implementations.rust === undefined
      ? undefined
      : parseRustImplementation(
        implementations.rust,
        `${context} implementations.rust`,
      ),
  };
}

function parseImplementation(
  value: unknown,
  context: string,
): TypeScriptMatrixImplementation {
  const implementation = expectRecord(value, context);
  expectKeys(implementation, ["file", "testName"], context);

  return {
    file: expectNonEmptyString(implementation.file, `${context} file`),
    testName: expectNonEmptyString(
      implementation.testName,
      `${context} testName`,
    ),
  };
}

function parseRustImplementation(
  value: unknown,
  context: string,
): RustMatrixImplementation {
  const implementation = expectRecord(value, context);
  expectKeys(implementation, ["module", "function"], context);

  return {
    module: expectNonEmptyString(implementation.module, `${context} module`),
    function: expectNonEmptyString(
      implementation.function,
      `${context} function`,
    ),
  };
}

function parseCompletion(value: unknown, context: string): MatrixCompletion {
  const completion = expectRecord(value, `${context} completion`);
  expectKeys(completion, ["typescript", "rust"], `${context} completion`);

  return {
    typescript: parseCompletionStatus(
      completion.typescript,
      `${context} completion.typescript`,
    ),
    rust: parseCompletionStatus(completion.rust, `${context} completion.rust`),
  };
}

function parseCompletionStatus(
  value: unknown,
  context: string,
): CompletionStatus {
  if (value === "implemented" || value === "required") {
    return value;
  }
  throw new Error(`${context} must be required or implemented`);
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
    (participant: unknown, participantIndex: number) =>
      parseParticipant(
        participant,
        `${context} scenario participant ${participantIndex + 1}`,
      ),
  );

  return {
    participants,
    given: validateStringArray(scenario.given, `${context} scenario given`),
    when: validateStringArray(scenario.when, `${context} scenario when`),
    then: validateStringArray(scenario.then, `${context} scenario then`),
  };
}

function parseParticipant(
  value: unknown,
  context: string,
): ScenarioParticipant {
  const participant = expectRecord(value, context);
  expectKeys(participant, ["name", "kind", "contract"], context);

  const kind = expectNonEmptyString(participant.kind, `${context} kind`);
  const validKinds = ["admin", "app", "control-plane", "service"] as const;
  if (!validKinds.includes(kind as ScenarioParticipantKind)) {
    throw new Error(
      `${context} kind must be one of: ${validKinds.join(", ")}`,
    );
  }

  return {
    name: expectNonEmptyString(participant.name, `${context} name`),
    kind: kind as ScenarioParticipantKind,
    contract: expectNonEmptyString(participant.contract, `${context} contract`),
  };
}

function validateStringArray(value: unknown, context: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${context} must be a non-empty array of strings`);
  }
  return value.map((entry, index) =>
    expectNonEmptyString(entry, `${context} ${index + 1}`)
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
