import {
  digestJson,
  type TrellisContractV1,
} from "@qlever-llc/trellis/contracts";

import {
  startAuthCallout,
  startDisconnectCleanup,
} from "../auth/callout/callout.ts";
import { CONTRACT as trellisAuthContract } from "../contracts/trellis_auth.ts";
import { CONTRACT as trellisCoreContract } from "../contracts/trellis_core.ts";
import { CONTRACT as trellisStateContract } from "../contracts/trellis_state.ts";
import type { ContractStore } from "../catalog/store.ts";

type BuiltinContract = { digest: string; contract: TrellisContractV1 };

export async function resolveBuiltinContracts(): Promise<BuiltinContract[]> {
  const [coreDigest, authDigest, stateDigest] = await Promise.all([
    digestJson(trellisCoreContract),
    digestJson(trellisAuthContract),
    digestJson(trellisStateContract),
  ]);

  return [
    { digest: coreDigest.digest, contract: trellisCoreContract },
    { digest: authDigest.digest, contract: trellisAuthContract },
    { digest: stateDigest.digest, contract: trellisStateContract },
  ];
}

export function startControlPlaneBackgroundTasks(opts?: { contractStore?: ContractStore }) {
  const disconnectCleanup = startDisconnectCleanup();
  const authCallout = startAuthCallout({ contractStore: opts?.contractStore });

  return {
    async stop() {
      await Promise.all([
        disconnectCleanup.stop(),
        authCallout.stop(),
      ]);
    },
  };
}
