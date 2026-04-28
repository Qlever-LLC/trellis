export type ActiveContractDigestRecord = {
  currentContractDigest?: string | null;
};

export type ActiveDeploymentContractRecord = {
  appliedContracts: Array<{ allowedDigests: string[] }>;
};

/** Adds concrete instance contract digests to the active set. */
export function addCurrentContractDigests<T extends ActiveContractDigestRecord>(
  active: Set<string>,
  records: Iterable<T>,
  isActive: (record: T) => boolean,
): void {
  for (const record of records) {
    if (!isActive(record) || !record.currentContractDigest) continue;
    active.add(record.currentContractDigest);
  }
}

/** Adds all allowed deployment contract digests to the active set. */
export function addDeploymentAllowedDigests<
  T extends ActiveDeploymentContractRecord,
>(
  active: Set<string>,
  records: Iterable<T>,
  isActive: (record: T) => boolean,
): void {
  for (const record of records) {
    if (!isActive(record)) continue;
    for (const applied of record.appliedContracts) {
      for (const digest of applied.allowedDigests) active.add(digest);
    }
  }
}
