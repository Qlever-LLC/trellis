import { authRuntimeDeps } from "../runtime_deps.ts";
import type { InstanceGrantPolicy, PortalProfile } from "../schemas.ts";
import type {
  SqlInstanceGrantPolicyRepository,
  SqlPortalProfileRepository,
  SqlPortalRepository,
} from "../storage.ts";
import { portalProfileToGrantPolicy } from "./policy.ts";

export type EffectiveGrantPolicyDeps = {
  instanceGrantPolicyStorage: Pick<SqlInstanceGrantPolicyRepository, "get">;
  portalProfileStorage: Pick<SqlPortalProfileRepository, "list">;
  portalStorage: Pick<SqlPortalRepository, "get">;
};

async function listPortalProfiles(
  deps: Pick<EffectiveGrantPolicyDeps, "portalProfileStorage">,
): Promise<PortalProfile[]> {
  return await deps.portalProfileStorage.list();
}

/** Creates a grant policy loader from explicit storage dependencies. */
export function createEffectiveGrantPolicyLoader(
  deps: EffectiveGrantPolicyDeps,
): (contractId: string) => Promise<InstanceGrantPolicy[]> {
  return async (contractId) => {
    const policies: InstanceGrantPolicy[] = [];

    const instancePolicy = await deps.instanceGrantPolicyStorage.get(
      contractId,
    );
    if (instancePolicy !== undefined) {
      policies.push(instancePolicy);
    }

    for (const deployment of await listPortalProfiles(deps)) {
      if (deployment.contractId !== contractId) continue;
      const portal = await deps.portalStorage.get(deployment.portalId);
      if (portal === undefined || portal.disabled) continue;
      policies.push(portalProfileToGrantPolicy(deployment));
    }

    return policies;
  };
}

export async function loadEffectiveGrantPolicies(
  contractId: string,
): Promise<InstanceGrantPolicy[]> {
  const { instanceGrantPolicyStorage, portalProfileStorage, portalStorage } =
    authRuntimeDeps();
  return await createEffectiveGrantPolicyLoader({
    instanceGrantPolicyStorage,
    portalProfileStorage,
    portalStorage,
  })(contractId);
}
