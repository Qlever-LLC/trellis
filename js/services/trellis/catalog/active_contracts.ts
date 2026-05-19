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
};

export type ActiveCatalogRecordSet = {
  builtinDigests: Iterable<string>;
  builtinContractIds?: Iterable<string>;
  deploymentEnvelopes: Iterable<ActiveDeploymentEnvelopeRecord>;
  deploymentContractEvidence: Iterable<ActiveDeploymentContractEvidenceRecord>;
};

/** Adds all deployment evidence digests for active deployments to the active set. */
export function addDeploymentEvidenceDigests<
  T extends ActiveDeploymentEnvelopeRecord,
>(
  active: Set<string>,
  deployments: Iterable<T>,
  evidence: Iterable<ActiveDeploymentContractEvidenceRecord>,
  isActive: (record: T) => boolean,
  ignoredContractIds: Set<string> = new Set(),
): void {
  const activeContractsByDeployment = new Map<string, Set<string>>();
  for (const deployment of deployments) {
    if (!isActive(deployment)) continue;
    activeContractsByDeployment.set(
      deployment.deploymentId,
      new Set([
        ...deployment.boundary.contracts.map((contract) => contract.contractId),
        ...deployment.boundary.surfaces.map((surface) => surface.contractId),
      ]),
    );
  }
  for (const record of evidence) {
    if (ignoredContractIds.has(record.contractId)) continue;
    if (
      !activeContractsByDeployment.get(record.deploymentId)?.has(
        record.contractId,
      )
    ) continue;
    active.add(record.contractDigest);
  }
}

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
  const builtinContractIds = new Set(records.builtinContractIds ?? []);

  addDeploymentEvidenceDigests(
    active,
    records.deploymentEnvelopes,
    records.deploymentContractEvidence,
    (deployment) => !deployment.disabled,
    builtinContractIds,
  );

  return active;
}
