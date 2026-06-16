import { assertEquals, assertExists } from "@std/assert";
import { jsIntegrationCases } from "./_support/cases.ts";
import {
  loadClientTestMatrix,
  type MatrixCase,
  matrixCaseIds,
} from "./_support/matrix.ts";

Deno.test("JS integration manifest conforms to shared matrix", async () => {
  const matrix = await loadClientTestMatrix();
  assertEquals(matrix.schemaVersion, 1);

  const matrixIds = matrixCaseIds(matrix);
  const localIds = jsIntegrationCases.map((caseEntry) => caseEntry.id)
    .toSorted();
  const report = buildConformanceReport(matrix.cases, matrixIds, localIds);

  if (report !== "") {
    throw new Error(report);
  }

  for (const caseEntry of jsIntegrationCases) {
    const stat = await Deno.stat(new URL(caseEntry.file, import.meta.url));
    assertExists(stat);
  }
});

function buildConformanceReport(
  matrixCases: readonly MatrixCase[],
  matrixIds: readonly string[],
  localIds: readonly string[],
): string {
  const missing = matrixIds.filter((id) => !localIds.includes(id));
  const extra = localIds.filter((id) => !matrixIds.includes(id));
  const localDuplicates = duplicates(localIds);
  const fixturePrefixMismatches = fixturePrefixErrors(matrixCases, localIds);
  const messages = [];

  if (missing.length > 0) {
    messages.push(`missing JS integration cases: ${missing.join(", ")}`);
  }
  if (extra.length > 0) {
    messages.push(
      `extra JS integration cases not in matrix: ${extra.join(", ")}`,
    );
  }
  if (localDuplicates.length > 0) {
    messages.push(
      `duplicate JS integration case ids: ${localDuplicates.join(", ")}`,
    );
  }
  if (fixturePrefixMismatches.length > 0) {
    messages.push(
      `JS integration case ids with wrong fixture prefix: ${
        fixturePrefixMismatches.join(", ")
      }`,
    );
  }

  return messages.join("\n");
}

function fixturePrefixErrors(
  matrixCases: readonly MatrixCase[],
  localIds: readonly string[],
): string[] {
  const matrixById = new Map(
    matrixCases.map((caseEntry) => [caseEntry.id, caseEntry]),
  );
  const errors = [];
  for (const id of localIds) {
    const matrixCase = matrixById.get(id);
    if (matrixCase === undefined) {
      continue;
    }
    const expectedPrefix = `${matrixCase.fixture}.`;
    if (!id.startsWith(expectedPrefix)) {
      errors.push(`${id} expected prefix ${expectedPrefix}`);
    }
  }
  return errors;
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
