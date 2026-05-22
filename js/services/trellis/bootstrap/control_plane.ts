import {
  digestContractManifest,
  type TrellisContractV1,
} from "@qlever-llc/trellis/contracts";
import { CONTRACT as trellisJobsContract } from "#trellis-generated-sdk/jobs";

import {
  startAuthCallout,
  startDisconnectCleanup,
} from "../auth/callout/callout.ts";
import { CONTRACT as trellisAuthContract } from "../contracts/trellis_auth.ts";
import { CONTRACT as trellisCoreContract } from "../contracts/trellis_core.ts";
import { CONTRACT as trellisHealthContract } from "../contracts/trellis_health.ts";
import { CONTRACT as trellisStateContract } from "../contracts/trellis_state.ts";
import type { ContractsModule } from "../catalog/runtime.ts";
import type { SqlContractStorageRepository } from "../catalog/storage.ts";
import type {
  SqlCapabilityGroupRepository,
  SqlDeploymentEnvelopeRepository,
  SqlDeviceActivationRepository,
  SqlDeviceDeploymentRepository,
  SqlEnvelopeExpansionRequestRepository,
  SqlIdentityEnvelopeRepository,
  SqlSessionRepository,
  SqlUserProjectionRepository,
} from "../auth/storage.ts";
import type { AuthRuntimeDeps } from "../auth/runtime_deps.ts";
import { createServiceLookup } from "../auth/admin/service_lookup.ts";
import type { Config } from "../config.ts";

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
    {
      digest: digestContractManifest(trellisJobsContract),
      contract: trellisJobsContract,
    },
  ];
}

export function startControlPlaneBackgroundTasks(opts: {
  contractStorage: SqlContractStorageRepository;
  capabilityGroupStorage: SqlCapabilityGroupRepository;
  userStorage: SqlUserProjectionRepository;
  contractApprovalStorage: SqlIdentityEnvelopeRepository;
  deploymentEnvelopeStorage: SqlDeploymentEnvelopeRepository;
  envelopeExpansionRequestStorage: SqlEnvelopeExpansionRequestRepository;
  deviceActivationStorage: SqlDeviceActivationRepository;
  deviceDeploymentStorage: SqlDeviceDeploymentRepository;
  deviceInstanceStorage: AuthRuntimeDeps["deviceInstanceStorage"];
  serviceDeploymentStorage: AuthRuntimeDeps["serviceDeploymentStorage"];
  serviceInstanceStorage: AuthRuntimeDeps["serviceInstanceStorage"];
  connectionsKV: AuthRuntimeDeps["connectionsKV"];
  logger: AuthRuntimeDeps["logger"];
  natsAuth: AuthRuntimeDeps["natsAuth"];
  natsSystem: AuthRuntimeDeps["natsSystem"];
  sessionStorage: SqlSessionRepository;
  trellis: AuthRuntimeDeps["trellis"];
  contracts: Pick<
    ContractsModule,
    | "getActiveEntries"
    | "getKnownContract"
    | "validateContract"
  >;
  config: Config;
}) {
  const serviceLookup = createServiceLookup(opts);
  const disconnectCleanup = startDisconnectCleanup({
    connectionsKV: opts.connectionsKV,
    envelopeExpansionRequestStorage: opts.envelopeExpansionRequestStorage,
    logger: opts.logger,
    natsSystem: opts.natsSystem,
    sessionStorage: opts.sessionStorage,
    trellis: opts.trellis,
  });
  const authCallout = startAuthCallout({
    config: opts.config,
    contractStorage: opts.contractStorage,
    capabilityGroupStorage: opts.capabilityGroupStorage,
    userStorage: opts.userStorage,
    contractApprovalStorage: opts.contractApprovalStorage,
    deploymentEnvelopeStorage: opts.deploymentEnvelopeStorage,
    connectionsKV: opts.connectionsKV,
    deviceActivationStorage: opts.deviceActivationStorage,
    deviceDeploymentStorage: opts.deviceDeploymentStorage,
    deviceInstanceStorage: opts.deviceInstanceStorage,
    logger: opts.logger,
    natsAuth: opts.natsAuth,
    sessionStorage: opts.sessionStorage,
    trellis: opts.trellis,
    loadServiceInstanceByKey: serviceLookup.loadServiceInstanceByKey,
    loadServiceDeployment: serviceLookup.loadServiceDeployment,
    contracts: opts.contracts,
  });

  return {
    async stop() {
      const results = await Promise.allSettled([
        disconnectCleanup.stop(),
        authCallout.stop(),
      ]);
      const failures = results.flatMap((result) =>
        result.status === "rejected" ? [result.reason] : []
      );
      if (failures.length > 0) {
        throw new AggregateError(
          failures,
          `Failed to stop ${failures.length} Trellis background task(s)`,
        );
      }
    },
  };
}
