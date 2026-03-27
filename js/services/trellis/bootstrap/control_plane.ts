import { digestJson, type TrellisContractV1 } from "@qlever-llc/trellis-contracts";

import { registerApprovalRpcHandlers } from "../auth/approval/index.ts";
import { kick, startAuthCallout, startDisconnectCleanup } from "../auth/callout/index.ts";
import { hashKey, randomToken } from "../auth/index.ts";
import { registerSessionRpcHandlers, registerUserRpcHandlers } from "../auth/session/index.ts";
import { CONTRACT as trellisAuthContract } from "../catalog/contracts/trellis_auth.ts";
import { CONTRACT as trellisCoreContract } from "../catalog/contracts/trellis_core.ts";
import { createContractsModule, registerServiceRegistryRpcHandlers } from "../catalog/index.ts";

type BuiltinContract = { digest: string; contract: TrellisContractV1 };

async function resolveBuiltinContracts(): Promise<BuiltinContract[]> {
  const [coreDigest, authDigest] = await Promise.all([
    digestJson(trellisCoreContract),
    digestJson(trellisAuthContract),
  ]);

  return [
    { digest: coreDigest.digest, contract: trellisCoreContract },
    { digest: authDigest.digest, contract: trellisAuthContract },
  ];
}

export async function registerControlPlane() {
  const contracts = createContractsModule({
    builtinContracts: await resolveBuiltinContracts(),
  });

  await contracts.refreshActiveContracts();
  await contracts.registerRpcHandlers();

  await registerServiceRegistryRpcHandlers({
    refreshActiveContracts: contracts.refreshActiveContracts,
    prepareInstalledContract: contracts.prepareInstalledContract,
  });

  await registerSessionRpcHandlers({
    randomToken,
    hashKey,
    kick,
  });

  await registerApprovalRpcHandlers({ kick });
  await registerUserRpcHandlers();

  return {
    contractStore: contracts.contractStore,
    refreshActiveContracts: contracts.refreshActiveContracts,
  };
}

export function startControlPlaneBackgroundTasks() {
  const disconnectCleanup = startDisconnectCleanup();
  const authCallout = startAuthCallout();

  return {
    async stop() {
      await Promise.all([
        disconnectCleanup.stop(),
        authCallout.stop(),
      ]);
    },
  };
}
