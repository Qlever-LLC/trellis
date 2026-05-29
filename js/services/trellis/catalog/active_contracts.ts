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

export type ActiveDeploymentAuthorityRecord = {
  deploymentId: string;
  disabled?: boolean;
  desiredState: {
    needs: Array<
      | { kind: "contract"; contractId: string }
      | { kind: "surface"; surface: { contractId: string } }
    >;
  };
};

export type ActiveImplementationOfferRecord = {
  deploymentKind: "service" | "device";
  deploymentId: string;
  instanceId: string | null;
  contractId: string;
  contractDigest: string;
  status: "offered" | "accepted" | "stale" | "expired" | "withdrawn";
  acceptedAt: string | null;
  firstOfferedAt: string;
  lastRefreshedAt: string;
  staleAt: string | null;
  expiresAt: string | null;
};

export type ActiveCatalogRecordSet = {
  builtinDigests: Iterable<string>;
  builtinContractIds?: Iterable<string>;
  deploymentAuthorities: Iterable<ActiveDeploymentAuthorityRecord>;
  implementationOffers?: Iterable<ActiveImplementationOfferRecord>;
  evaluationTime?: string | Date;
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

  const evaluationTime = records.evaluationTime instanceof Date
    ? records.evaluationTime.toISOString()
    : records.evaluationTime ?? new Date().toISOString();
  for (const offer of records.implementationOffers ?? []) {
    if (offer.status !== "accepted") continue;
    if (offer.acceptedAt === null) continue;
    if (offer.staleAt !== null && offer.staleAt <= evaluationTime) continue;
    if (offer.expiresAt !== null && offer.expiresAt <= evaluationTime) continue;
    active.add(offer.contractDigest);
  }

  return active;
}
