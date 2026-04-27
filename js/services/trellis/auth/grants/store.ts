import { authRuntimeDeps } from "../runtime_deps.ts";
import type { InstanceGrantPolicy, PortalProfile } from "../schemas.ts";
import { portalProfileToGrantPolicy } from "./policy.ts";

async function listPortalProfiles(): Promise<PortalProfile[]> {
  const { portalProfileStorage } = authRuntimeDeps();
  return await portalProfileStorage.list();
}

export async function loadEffectiveGrantPolicies(
  contractId: string,
): Promise<InstanceGrantPolicy[]> {
  const { instanceGrantPolicyStorage, portalStorage } = authRuntimeDeps();
  const policies: InstanceGrantPolicy[] = [];

  const instancePolicy = await instanceGrantPolicyStorage.get(contractId);
  if (instancePolicy !== undefined) {
    policies.push(instancePolicy);
  }

  for (const deployment of await listPortalProfiles()) {
    if (deployment.contractId !== contractId) continue;
    const portal = await portalStorage.get(deployment.portalId);
    if (portal === undefined || portal.disabled) continue;
    policies.push(portalProfileToGrantPolicy(deployment));
  }

  return policies;
}
