/**
 * Returns a stable ASCII slug safe for contract IDs, subjects, deployment IDs,
 * and participant or resource names.
 *
 * The slug keeps ASCII letters, digits, `_`, and `-`; replaces `.` with `-`;
 * and replaces all other characters with `-`.
 */
export function integrationSlug(caseId: string): string {
  return caseId.replaceAll(".", "-").replaceAll(/[^a-zA-Z0-9_-]/g, "-");
}

/** Returns a deterministic deployment ID for one case in a shared runtime run. */
export function caseDeploymentId(runId: string, caseId: string): string {
  return `js-it-${runId}-${integrationSlug(caseId)}`;
}

/** Prefixes a deterministic case slug with a local participant or resource prefix. */
export function caseScopedName(prefix: string, caseId: string): string {
  return `${prefix}-${integrationSlug(caseId)}`;
}

/** Creates a NATS subject scoped to one integration test case. */
export function caseScopedSubject(
  prefix: string,
  caseId: string,
  suffix: string,
): string {
  return `${prefix}.${integrationSlug(caseId)}.${suffix}`;
}

/** Creates a contract ID scoped to one integration test case. */
export function caseScopedContractId(base: string, caseId: string): string {
  return `${base}.${integrationSlug(caseId)}@v1`;
}
