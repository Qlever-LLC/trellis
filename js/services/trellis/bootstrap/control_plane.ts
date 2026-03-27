import {
  digestJson,
  type TrellisContractV1,
} from "@qlever-llc/trellis-contracts";

import {
  startAuthCallout,
  startDisconnectCleanup,
} from "../auth/callout/callout.ts";
import { CONTRACT as trellisAuthContract } from "../catalog/contracts/trellis_auth.ts";
import { CONTRACT as trellisCoreContract } from "../catalog/contracts/trellis_core.ts";

type BuiltinContract = { digest: string; contract: TrellisContractV1 };

export async function resolveBuiltinContracts(): Promise<BuiltinContract[]> {
  const [coreDigest, authDigest] = await Promise.all([
    digestJson(trellisCoreContract),
    digestJson(trellisAuthContract),
  ]);

  return [
    { digest: coreDigest.digest, contract: trellisCoreContract },
    { digest: authDigest.digest, contract: trellisAuthContract },
  ];
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
