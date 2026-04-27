import {
  digestContractManifest,
  type TrellisContractV1,
} from "@qlever-llc/trellis/contracts";

import {
  startAuthCallout,
  startDisconnectCleanup,
} from "../auth/callout/callout.ts";
import { CONTRACT as trellisAuthContract } from "../contracts/trellis_auth.ts";
import { CONTRACT as trellisCoreContract } from "../contracts/trellis_core.ts";
import { CONTRACT as trellisHealthContract } from "../contracts/trellis_health.ts";
import { CONTRACT as trellisStateContract } from "../contracts/trellis_state.ts";
import type { ContractStore } from "../catalog/store.ts";
import type { SqlContractStorageRepository } from "../catalog/storage.ts";
import type {
  SqlContractApprovalRepository,
  SqlUserProjectionRepository,
} from "../auth/storage.ts";

type BuiltinContract = { digest: string; contract: TrellisContractV1 };

export async function resolveBuiltinContracts(): Promise<BuiltinContract[]> {
  return [
    {
      digest: digestContractManifest(trellisCoreContract),
      contract: trellisCoreContract,
    },
    {
      digest: digestContractManifest(trellisAuthContract),
      contract: trellisAuthContract,
    },
    {
      digest: digestContractManifest(trellisHealthContract),
      contract: trellisHealthContract,
    },
    {
      digest: digestContractManifest(trellisStateContract),
      contract: trellisStateContract,
    },
  ];
}

export function startControlPlaneBackgroundTasks(opts: {
  contractStorage: SqlContractStorageRepository;
  userStorage: SqlUserProjectionRepository;
  contractApprovalStorage: SqlContractApprovalRepository;
  contractStore?: ContractStore;
}) {
  const disconnectCleanup = startDisconnectCleanup();
  const authCallout = startAuthCallout({
    contractStorage: opts.contractStorage,
    userStorage: opts.userStorage,
    contractApprovalStorage: opts.contractApprovalStorage,
    contractStore: opts.contractStore,
  });

  return {
    async stop() {
      await Promise.all([
        disconnectCleanup.stop(),
        authCallout.stop(),
      ]);
    },
  };
}
