export type ActiveContractDigestRecord = {
  currentContractDigest?: string | null;
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
