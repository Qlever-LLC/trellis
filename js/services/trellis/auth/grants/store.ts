import {
  instanceGrantPolicyStorage,
  portalProfileStorage,
  portalStorage,
} from "../../bootstrap/globals.ts";
import type {
  InstanceGrantPolicy,
  PortalProfile,
} from "../../state/schemas.ts";
import { portalProfileToGrantPolicy } from "./policy.ts";

async function listPortalProfiles(): Promise<PortalProfile[]> {
  return await portalProfileStorage.list();
}

export async function loadEffectiveGrantPolicies(
  contractId: string,
): Promise<InstanceGrantPolicy[]> {
  const policies: InstanceGrantPolicy[] = [];

  const instancePolicy = await instanceGrantPolicyStorage.get(contractId);
  if (instancePolicy !== undefined) {
    policies.push(instancePolicy);
  }

  for (const profile of await listPortalProfiles()) {
    if (profile.contractId !== contractId) continue;
    const portal = await portalStorage.get(profile.portalId);
    if (portal === undefined || portal.disabled) continue;
    policies.push(portalProfileToGrantPolicy(profile));
  }

  return policies;
}
