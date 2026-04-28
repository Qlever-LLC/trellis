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
  SqlDeviceActivationRepository,
  SqlDeviceDeploymentRepository,
  SqlInstanceGrantPolicyRepository,
  SqlSessionRepository,
  SqlUserProjectionRepository,
} from "../auth/storage.ts";
import type { AuthRuntimeDeps } from "../auth/runtime_deps.ts";
import { createServiceLookup } from "../auth/admin/service_lookup.ts";
import { createEffectiveGrantPolicyLoader } from "../auth/grants/store.ts";

type BuiltinContract = { digest: string; contract: TrellisContractV1 };

export function resolveBuiltinContracts(): BuiltinContract[] {
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
  deviceActivationStorage: SqlDeviceActivationRepository;
  deviceDeploymentStorage: SqlDeviceDeploymentRepository;
  instanceGrantPolicyStorage: SqlInstanceGrantPolicyRepository;
  serviceDeploymentStorage: AuthRuntimeDeps["serviceDeploymentStorage"];
  serviceInstanceStorage: AuthRuntimeDeps["serviceInstanceStorage"];
  portalProfileStorage: AuthRuntimeDeps["portalProfileStorage"];
  portalStorage: AuthRuntimeDeps["portalStorage"];
  connectionsKV: AuthRuntimeDeps["connectionsKV"];
  logger: AuthRuntimeDeps["logger"];
  natsAuth: AuthRuntimeDeps["natsAuth"];
  sessionStorage: SqlSessionRepository;
  trellis: AuthRuntimeDeps["trellis"];
  contractStore?: ContractStore;
}) {
  const serviceLookup = createServiceLookup(opts);
  const loadInstanceGrantPolicies = createEffectiveGrantPolicyLoader(opts);
  const disconnectCleanup = startDisconnectCleanup({
    connectionsKV: opts.connectionsKV,
    logger: opts.logger,
    natsAuth: opts.natsAuth,
    sessionStorage: opts.sessionStorage,
    trellis: opts.trellis,
  });
  const authCallout = startAuthCallout({
    contractStorage: opts.contractStorage,
    userStorage: opts.userStorage,
    contractApprovalStorage: opts.contractApprovalStorage,
    connectionsKV: opts.connectionsKV,
    deviceActivationStorage: opts.deviceActivationStorage,
    deviceDeploymentStorage: opts.deviceDeploymentStorage,
    logger: opts.logger,
    natsAuth: opts.natsAuth,
    sessionStorage: opts.sessionStorage,
    trellis: opts.trellis,
    loadServiceInstanceByKey: serviceLookup.loadServiceInstanceByKey,
    loadServiceDeployment: serviceLookup.loadServiceDeployment,
    loadInstanceGrantPolicies,
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
