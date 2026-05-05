export type ActiveDeploymentContractRecord = {
  appliedContracts: Array<{ contractId: string; allowedDigests: string[] }>;
};

export type ActiveServiceDeploymentRecord = ActiveDeploymentContractRecord & {
  deploymentId: string;
  disabled?: boolean;
};

export type ActiveDeviceDeploymentRecord = ActiveDeploymentContractRecord & {
  deploymentId: string;
  disabled?: boolean;
};

export type ActiveDeviceInstanceRecord = {
  deploymentId: string;
};

export type ActiveCatalogRecordSet = {
  builtinDigests: Iterable<string>;
  builtinContractIds?: Iterable<string>;
  serviceDeployments: Iterable<ActiveServiceDeploymentRecord>;
  deviceDeployments: Iterable<ActiveDeviceDeploymentRecord>;
  deviceInstances?: Iterable<ActiveDeviceInstanceRecord>;
};

/** Adds all allowed deployment contract digests to the active set. */
export function addDeploymentAllowedDigests<
  T extends ActiveDeploymentContractRecord,
>(
  active: Set<string>,
  records: Iterable<T>,
  isActive: (record: T) => boolean,
  opts?: { skipContractIds?: ReadonlySet<string> },
): void {
  for (const record of records) {
    if (!isActive(record)) continue;
    for (const applied of record.appliedContracts) {
      if (opts?.skipContractIds?.has(applied.contractId)) continue;
      for (const digest of applied.allowedDigests) active.add(digest);
    }
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

  addDeploymentAllowedDigests(
    active,
    records.serviceDeployments,
    (deployment) => !deployment.disabled,
    { skipContractIds: builtinContractIds },
  );

  addDeploymentAllowedDigests(
    active,
    records.deviceDeployments,
    (deployment) =>
      !deployment.disabled && deployment.appliedContracts.length > 0,
    { skipContractIds: builtinContractIds },
  );

  return active;
}
