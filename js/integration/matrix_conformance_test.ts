import { assertExists } from "@std/assert";
import { jsIntegrationCases } from "./_support/cases.ts";
import {
  loadClientTestMatrix,
  type MatrixCase,
  matrixCaseIds,
} from "./_support/matrix.ts";

Deno.test("JS integration manifest conforms to shared matrix", async () => {
  const matrix = await loadClientTestMatrix();

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

    if (caseEntry.runtime !== "live-trellis") {
      throw new Error(
        `case ${caseEntry.id} has runtime "${caseEntry.runtime}", expected "live-trellis"`,
      );
    }

    const content = await Deno.readTextFile(
      new URL(caseEntry.file, import.meta.url),
    );

    // Check via the test name string itself (handles single-line and multi-line Deno.test(
    const expectedName = `"${caseEntry.testName}"`;
    if (!content.includes(expectedName)) {
      throw new Error(
        `case ${caseEntry.id} expects Deno.test with name "${caseEntry.testName}" not found in ${caseEntry.file}`,
      );
    }

    const testDecls = content.split("Deno.test(");
    let idDeclCount = 0;
    for (let i = 1; i < testDecls.length; i++) {
      const afterParen = testDecls[i];
      const firstQuote = afterParen.indexOf('"');
      if (firstQuote !== -1) {
        const afterFirstQuote = afterParen.slice(firstQuote + 1);
        const secondQuote = afterFirstQuote.indexOf('"');
        if (secondQuote !== -1) {
          const testName = afterFirstQuote.slice(0, secondQuote);
          if (testName.includes(caseEntry.id)) {
            idDeclCount++;
          }
        }
      }
    }
    if (idDeclCount !== 1) {
      throw new Error(
        `case ${caseEntry.id} appears in ${idDeclCount} Deno.test name(s) in ${caseEntry.file}, expected exactly 1`,
      );
    }
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
