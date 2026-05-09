import type { IdentityEnvelopeRecord, Session } from "../schemas.ts";

type Deployment = {
  deploymentId: string;
  disabled?: boolean;
};

type DeploymentContractEvidence = {
  deploymentId: string;
  contractId: string;
  contractDigest: string;
};

type ServiceInstanceWithCurrentContract = {
  currentContractDigest?: string | null;
};

type SessionEntry = {
  session: Session;
};

type InstalledContractCleanupDeps = {
  builtinContractDigests: Iterable<string>;
  contractStorage: { delete(digest: string): Promise<void> };
  serviceDeploymentStorage: {
    listByDeploymentIds(
      deploymentIds: Iterable<string>,
      filters?: { disabled?: boolean },
    ): Promise<Deployment[]>;
  };
  deviceDeploymentStorage: {
    listByDeploymentIds(
      deploymentIds: Iterable<string>,
      filters?: { disabled?: boolean },
    ): Promise<Deployment[]>;
  };
  deploymentContractEvidenceStorage: {
    listByDigests(
      contractDigests: Iterable<string>,
    ): Promise<DeploymentContractEvidence[]>;
  };
  serviceInstanceStorage: {
    listByCurrentContractDigests(
      contractDigests: Iterable<string>,
    ): Promise<ServiceInstanceWithCurrentContract[]>;
  };
  sessionStorage: {
    listEntriesByContractDigests(
      contractDigests: Iterable<string>,
    ): Promise<SessionEntry[]>;
  };
  contractApprovalStorage: {
    listByApprovalEvidenceContractDigests(
      contractDigests: Iterable<string>,
    ): Promise<IdentityEnvelopeRecord[]>;
  };
};

/** Returns all digests from deployment contract evidence records. */
export function collectDeploymentContractEvidenceDigests(
  evidence: Iterable<DeploymentContractEvidence>,
): string[] {
  return [...evidence].map((record) => record.contractDigest);
}

function addDeploymentReferences(
  referenced: Set<string>,
  deployments: Deployment[],
  evidence: DeploymentContractEvidence[],
): void {
  const activeDeploymentIds = new Set(
    deployments.map((deployment) => deployment.deploymentId),
  );
  for (const record of evidence) {
    if (activeDeploymentIds.has(record.deploymentId)) {
      referenced.add(record.contractDigest);
    }
  }
}

function sessionContractDigest(session: Session): string | undefined {
  if (session.type === "service") {
    return session.currentContractDigest ?? undefined;
  }
  return session.contractDigest;
}

/**
 * Deletes installed contract records for candidate digests that no durable auth
 * or deployment reference still uses. Built-in digests are never deleted.
 */
export async function purgeUnusedInstalledContracts(
  candidateDigests: Iterable<string>,
  deps: InstalledContractCleanupDeps,
): Promise<void> {
  const builtins = new Set(deps.builtinContractDigests);
  const candidates = new Set<string>();
  for (const digest of candidateDigests) {
    if (!builtins.has(digest)) candidates.add(digest);
  }
  if (candidates.size === 0) return;

  const referenced = new Set<string>();
  const deploymentContractEvidence = await deps
    .deploymentContractEvidenceStorage
    .listByDigests(candidates);
  const candidateDeploymentIds = deploymentContractEvidence.map((record) =>
    record.deploymentId
  );
  addDeploymentReferences(
    referenced,
    await deps.serviceDeploymentStorage.listByDeploymentIds(
      candidateDeploymentIds,
      { disabled: false },
    ),
    deploymentContractEvidence,
  );
  addDeploymentReferences(
    referenced,
    await deps.deviceDeploymentStorage.listByDeploymentIds(
      candidateDeploymentIds,
      { disabled: false },
    ),
    deploymentContractEvidence,
  );
  for (
    const instance of await deps.serviceInstanceStorage
      .listByCurrentContractDigests(candidates)
  ) {
    if (instance.currentContractDigest) {
      referenced.add(instance.currentContractDigest);
    }
  }
  for (
    const entry of await deps.sessionStorage.listEntriesByContractDigests(
      candidates,
    )
  ) {
    const digest = sessionContractDigest(entry.session);
    if (digest) referenced.add(digest);
  }
  for (
    const envelope of await deps.contractApprovalStorage
      .listByApprovalEvidenceContractDigests(candidates)
  ) {
    referenced.add(envelope.approvalEvidence.contractDigest);
  }

  for (const digest of candidates) {
    if (!referenced.has(digest)) {
      await deps.contractStorage.delete(digest);
    }
  }
}
