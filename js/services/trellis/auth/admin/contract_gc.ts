import type { ContractApprovalRecord, Session } from "../schemas.ts";

type AppliedDeploymentContract = {
  allowedDigests: string[];
};

type DeploymentWithAppliedContracts = {
  appliedContracts: AppliedDeploymentContract[];
};

type ServiceInstanceWithCurrentContract = {
  currentContractDigest?: string | null;
};

type SessionEntry = {
  session: Session;
};

type ContractGcDeps = {
  builtinContractDigests: Iterable<string>;
  contractStorage: { delete(digest: string): Promise<void> };
  serviceDeploymentStorage: {
    list(): Promise<DeploymentWithAppliedContracts[]>;
  };
  deviceDeploymentStorage: {
    list(): Promise<DeploymentWithAppliedContracts[]>;
  };
  serviceInstanceStorage: {
    list(): Promise<ServiceInstanceWithCurrentContract[]>;
  };
  sessionStorage: { listEntries(): Promise<SessionEntry[]> };
  contractApprovalStorage: { list(): Promise<ContractApprovalRecord[]> };
};

/** Returns all allowed digests from applied deployment contract records. */
export function collectAppliedContractDigests(
  deployment: DeploymentWithAppliedContracts,
): string[] {
  return deployment.appliedContracts.flatMap((applied) =>
    applied.allowedDigests
  );
}

function addDeploymentReferences(
  referenced: Set<string>,
  deployments: DeploymentWithAppliedContracts[],
): void {
  for (const deployment of deployments) {
    for (const digest of collectAppliedContractDigests(deployment)) {
      referenced.add(digest);
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
  deps: ContractGcDeps,
): Promise<void> {
  const builtins = new Set(deps.builtinContractDigests);
  const candidates = new Set<string>();
  for (const digest of candidateDigests) {
    if (!builtins.has(digest)) candidates.add(digest);
  }
  if (candidates.size === 0) return;

  const referenced = new Set<string>();
  addDeploymentReferences(
    referenced,
    await deps.serviceDeploymentStorage.list(),
  );
  addDeploymentReferences(
    referenced,
    await deps.deviceDeploymentStorage.list(),
  );
  for (const instance of await deps.serviceInstanceStorage.list()) {
    if (instance.currentContractDigest) {
      referenced.add(instance.currentContractDigest);
    }
  }
  for (const entry of await deps.sessionStorage.listEntries()) {
    const digest = sessionContractDigest(entry.session);
    if (digest) referenced.add(digest);
  }
  for (const approval of await deps.contractApprovalStorage.list()) {
    referenced.add(approval.approval.contractDigest);
  }

  for (const digest of candidates) {
    if (!referenced.has(digest)) {
      await deps.contractStorage.delete(digest);
    }
  }
}
