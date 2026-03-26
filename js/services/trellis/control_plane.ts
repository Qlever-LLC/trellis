import { digestJson, type TrellisContractV1 } from "@qlever-llc/trellis-contracts";

import { registerApprovalRpcHandlers } from "./approval_rpc.ts";
import { startAuthCallout, startDisconnectCleanup } from "./auth_callout.ts";
import { hashKey, randomToken } from "./auth_utils.ts";
import { CONTRACT as trellisAuthContract } from "./contracts/trellis_auth.ts";
import { CONTRACT as trellisCoreContract } from "./contracts/trellis_core.ts";
import { createContractsModule } from "./contracts_rpc.ts";
import { kick } from "./kick.ts";
import { registerServiceRegistryRpcHandlers } from "./service_registry_rpc.ts";
import { registerSessionRpcHandlers } from "./session_rpc.ts";
import { registerUserRpcHandlers } from "./user_rpc.ts";

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
