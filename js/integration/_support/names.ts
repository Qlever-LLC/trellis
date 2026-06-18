/**
 * Returns a stable lower-case slug safe for contract IDs, subjects, deployment IDs, and names.
 * Replaces `.` with `-`, strips characters outside `[a-zA-Z0-9_-]`.
 */
export function integrationSlug(caseId: string): string {
  return caseId.replaceAll(".", "-").replaceAll(/[^a-zA-Z0-9_-]/g, "-");
}

/** Returns a case-scoped deployment id for the current shared runtime run id. */
export function caseDeploymentId(runId: string, caseId: string): string {
  return `js-it-${runId}-${integrationSlug(caseId)}`;
}

/** Prefixes a case slug with a local participant/resource prefix. */
export function caseScopedName(prefix: string, caseId: string): string {
  return `${prefix}-${integrationSlug(caseId)}`;
}

/** Creates a NATS subject scoped to a case. */
export function caseScopedSubject(prefix: string, caseId: string, suffix: string): string {
  return `${prefix}.${integrationSlug(caseId)}.${suffix}`;
}

/** Creates a contract ID scoped to a case. */
export function caseScopedContractId(base: string, caseId: string): string {
  return `${base}.${integrationSlug(caseId)}@v1`;
}
