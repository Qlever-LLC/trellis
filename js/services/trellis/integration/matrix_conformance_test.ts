import { assertExists } from "@std/assert";
import { controlPlaneIntegrationCases } from "./_support/cases.ts";
import {
  type MatrixCase,
  matrixCaseIds,
  serviceTestMatrix,
} from "./_support/matrix.ts";

Deno.test("service integration manifest conforms to shared matrix", async () => {
  const matrixIds = matrixCaseIds(serviceTestMatrix);
  const localIds = controlPlaneIntegrationCases.map((caseEntry) => caseEntry.id)
    .toSorted();
  const report = buildConformanceReport(
    serviceTestMatrix.cases,
    matrixIds,
    localIds,
  );

  if (report !== "") {
    throw new Error(report);
  }

  const rustRequiredIds = serviceTestMatrix.cases
    .filter((caseEntry) => caseEntry.completion.rust === "required")
    .map((caseEntry) => caseEntry.id);
  if (rustRequiredIds.length > 0) {
    console.info(
      `service integration Rust completion required: ${
        rustRequiredIds.join(", ")
      }`,
    );
  }

  for (const caseEntry of controlPlaneIntegrationCases) {
    const stat = await Deno.stat(new URL(caseEntry.file, import.meta.url));
    assertExists(stat);

    if (caseEntry.runtime !== "live-trellis") {
      throw new Error(
        `case ${caseEntry.id} has runtime "${caseEntry.runtime}", expected "live-trellis"`,
      );
    }

    const content = await Deno.readTextFile(
      new URL(caseEntry.file, import.meta.url),
    );

    const expectedName = `"${caseEntry.testName}"`;
    if (!content.includes(expectedName)) {
      throw new Error(
        `case ${caseEntry.id} expects test with name "${caseEntry.testName}" not found in ${caseEntry.file}`,
      );
    }

    const liveTrellisTestCount = countMatches(content, /liveTrellisTest\s*\(/g);
    if (liveTrellisTestCount !== 1) {
      throw new Error(
        `case ${caseEntry.id} has ${liveTrellisTestCount} liveTrellisTest declaration(s) in ${caseEntry.file}, expected exactly 1`,
      );
    }

    const usesCaseScope = content.includes("runtimeScopeForCase(");
    const usesIsolatedScope = content.includes("runtimeScopeIsolated(");

    if (!usesCaseScope && !usesIsolatedScope) {
      throw new Error(
        `case ${caseEntry.id} in ${caseEntry.file} must use runtimeScopeForCase( or runtimeScopeIsolated(`,
      );
    }

    if (
      usesIsolatedScope && !content.includes("failOnceHooks") &&
      !content.includes("restartControlPlane") &&
      !content.includes("restartWithFailOnceHook")
    ) {
      throw new Error(
        `case ${caseEntry.id} in ${caseEntry.file} uses runtimeScopeIsolated( without fail-once or restart behavior`,
      );
    }

    if (content.includes("runtimeScopeForFixture(")) {
      throw new Error(
        `case ${caseEntry.id} in ${caseEntry.file} must not use runtimeScopeForFixture(`,
      );
    }
  }
});

function countMatches(content: string, pattern: RegExp): number {
  return Array.from(content.matchAll(pattern)).length;
}

function buildConformanceReport(
  matrixCases: readonly MatrixCase[],
  matrixIds: readonly string[],
  localIds: readonly string[],
): string {
  const missing = matrixIds.filter((id) => !localIds.includes(id));
  const extra = localIds.filter((id) => !matrixIds.includes(id));
  const matrixDuplicates = duplicates(matrixIds);
  const localDuplicates = duplicates(localIds);
  const fixturePrefixMismatches = fixturePrefixErrors(matrixCases);
  const missingTypeScriptImplementations = matrixCases
    .filter((caseEntry) => caseEntry.implementations.typescript === undefined)
    .map((caseEntry) => caseEntry.id)
    .toSorted();
  const rustCompletionErrors = rustCompletionStatusErrors(matrixCases);
  const messages = [];

  if (missing.length > 0) {
    messages.push(`missing service integration cases: ${missing.join(", ")}`);
  }
  if (extra.length > 0) {
    messages.push(
      `extra service integration cases not in matrix: ${extra.join(", ")}`,
    );
  }
  if (matrixDuplicates.length > 0) {
    messages.push(
      `duplicate service matrix case ids: ${matrixDuplicates.join(", ")}`,
    );
  }
  if (localDuplicates.length > 0) {
    messages.push(
      `duplicate service integration case ids: ${localDuplicates.join(", ")}`,
    );
  }
  if (fixturePrefixMismatches.length > 0) {
    messages.push(
      `service matrix case ids with wrong fixture prefix: ${
        fixturePrefixMismatches.join(", ")
      }`,
    );
  }
  if (missingTypeScriptImplementations.length > 0) {
    messages.push(
      `service matrix cases missing TypeScript implementations: ${
        missingTypeScriptImplementations.join(", ")
      }`,
    );
  }
  if (rustCompletionErrors.length > 0) {
    messages.push(rustCompletionErrors.join("\n"));
  }

  return messages.join("\n");
}

function fixturePrefixErrors(matrixCases: readonly MatrixCase[]): string[] {
  const errors = [];
  for (const caseEntry of matrixCases) {
    const expectedPrefix = `${caseEntry.fixture}.`;
    if (!caseEntry.id.startsWith(expectedPrefix)) {
      errors.push(`${caseEntry.id} expected prefix ${expectedPrefix}`);
    }
  }
  return errors;
}

function rustCompletionStatusErrors(
  matrixCases: readonly MatrixCase[],
): string[] {
  const errors = [];
  for (const caseEntry of matrixCases) {
    if (
      caseEntry.completion.rust !== "required" &&
      caseEntry.completion.rust !== "implemented"
    ) {
      errors.push(
        `case ${caseEntry.id} completion.rust must be required or implemented`,
      );
      continue;
    }
    if (
      caseEntry.completion.rust === "implemented" &&
      caseEntry.implementations.rust === undefined
    ) {
      errors.push(
        `case ${caseEntry.id} completion.rust is implemented but implementations.rust is missing`,
      );
    }
    if (
      caseEntry.completion.rust === "required" &&
      caseEntry.implementations.rust !== undefined
    ) {
      errors.push(
        `case ${caseEntry.id} completion.rust is required and must not include implementations.rust`,
      );
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
