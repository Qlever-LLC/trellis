export type ActiveServiceDeploymentRecord = {
  deploymentId: string;
  disabled?: boolean;
};

export type ActiveDeviceDeploymentRecord = {
  deploymentId: string;
  disabled?: boolean;
};

export type ActiveDeviceInstanceRecord = {
  deploymentId: string;
};

export type ActiveDeploymentEnvelopeRecord = {
  deploymentId: string;
  disabled?: boolean;
  boundary: {
    contracts: Array<{ contractId: string }>;
    surfaces: Array<{ contractId: string }>;
  };
};

export type ActiveDeploymentContractEvidenceRecord = {
  deploymentId: string;
  contractId: string;
  contractDigest: string;
  lastSeenAt?: string;
  ignoredAt?: string | null;
};

export type ActiveCatalogRecordSet = {
  builtinDigests: Iterable<string>;
  builtinContractIds?: Iterable<string>;
  deploymentEnvelopes: Iterable<ActiveDeploymentEnvelopeRecord>;
  deploymentContractEvidence: Iterable<ActiveDeploymentContractEvidenceRecord>;
};

/** Returns persisted records with staged records overlaid by key. */
export function overlayStagedRecords<T>(
  records: Iterable<T>,
  staged: Iterable<T> | undefined,
  keyFor: (record: T) => string,
): T[] {
  const byKey = new Map<string, T>();
  for (const record of records) byKey.set(keyFor(record), record);
  for (const record of staged ?? []) byKey.set(keyFor(record), record);
  return [...byKey.values()];
}

/** Builds the active digest set from persisted or staged deployment state. */
export function collectActiveContractDigests(
  records: ActiveCatalogRecordSet,
): Set<string> {
  const active = new Set<string>();
  for (const digest of records.builtinDigests) active.add(digest);

  return active;
}
