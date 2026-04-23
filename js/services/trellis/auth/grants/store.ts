import { isErr } from "@qlever-llc/result";

import {
  instanceGrantPoliciesKV,
  portalsKV,
  portalProfilesKV,
} from "../../bootstrap/globals.ts";
import type {
  InstanceGrantPolicy,
  PortalProfile,
} from "../../state/schemas.ts";
import { portalProfileToGrantPolicy } from "./policy.ts";

async function listPortalProfiles(): Promise<PortalProfile[]> {
  const iter = await portalProfilesKV.keys(">").take();
  if (isErr(iter)) return [];

  const profiles: PortalProfile[] = [];
  for await (const key of iter) {
    const entry = await portalProfilesKV.get(key).take();
    if (!isErr(entry)) {
      profiles.push(entry.value as PortalProfile);
    }
  }
  return profiles;
}

export async function loadEffectiveGrantPolicies(
  contractId: string,
): Promise<InstanceGrantPolicy[]> {
  const policies: InstanceGrantPolicy[] = [];

  const instancePolicy = await instanceGrantPoliciesKV.get(contractId).take();
  if (!isErr(instancePolicy)) {
    policies.push(instancePolicy.value as InstanceGrantPolicy);
  }

  for (const profile of await listPortalProfiles()) {
    if (profile.contractId !== contractId) continue;
    const portal = await portalsKV.get(profile.portalId).take();
    if (isErr(portal) || portal.value.disabled) continue;
    policies.push(portalProfileToGrantPolicy(profile));
  }

  return policies;
}
