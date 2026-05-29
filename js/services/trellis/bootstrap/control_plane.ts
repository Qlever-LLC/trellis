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
import { createNatsAuthorityPhysicalResourceManager } from "../catalog/resources.ts";
import type { SqlContractStorageRepository } from "../catalog/storage.ts";
import type {
  SqlAuthorityReconciliationRepository,
  SqlCapabilityGroupRepository,
  SqlDeploymentAuthorityGrantOverrideRepository,
  SqlDeploymentAuthorityRepository,
  SqlDeviceActivationRepository,
  SqlDeviceDeploymentRepository,
  SqlImplementationOfferRepository,
  SqlMaterializedAuthorityRepository,
  SqlMaterializedResourceBindingRepository,
  SqlSessionRepository,
  SqlUserProjectionRepository,
} from "../auth/storage.ts";
import type { AuthRuntimeDeps } from "../auth/runtime_deps.ts";
import { createServiceLookup } from "../auth/admin/service_lookup.ts";
import { createAuthorityReconciler } from "../auth/reconciliation/authority_reconciler.ts";
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
  deploymentAuthorityStorage: SqlDeploymentAuthorityRepository;
  deploymentAuthorityGrantOverrideStorage:
    SqlDeploymentAuthorityGrantOverrideRepository;
  materializedAuthorityStorage: SqlMaterializedAuthorityRepository;
  materializedResourceBindingStorage: SqlMaterializedResourceBindingRepository;
  authorityReconciliationStorage: SqlAuthorityReconciliationRepository;
  implementationOfferStorage: SqlImplementationOfferRepository;
  deviceActivationStorage: SqlDeviceActivationRepository;
  deviceDeploymentStorage: SqlDeviceDeploymentRepository;
  deviceInstanceStorage: AuthRuntimeDeps["deviceInstanceStorage"];
  serviceDeploymentStorage: AuthRuntimeDeps["serviceDeploymentStorage"];
  serviceInstanceStorage: AuthRuntimeDeps["serviceInstanceStorage"];
  connectionsKV: AuthRuntimeDeps["connectionsKV"];
  logger: AuthRuntimeDeps["logger"];
  natsAuth: AuthRuntimeDeps["natsAuth"];
  natsSystem: AuthRuntimeDeps["natsSystem"];
  natsTrellis: AuthRuntimeDeps["natsTrellis"];
  sessionStorage: SqlSessionRepository;
  trellis: AuthRuntimeDeps["trellis"];
  contracts: Pick<
    ContractsModule,
    | "getActiveEntries"
    | "getContract"
    | "getKnownEntriesByContractId"
    | "getKnownContract"
    | "validateContract"
  >;
  config: Config;
}) {
  const serviceLookup = createServiceLookup(opts);
  const authorityReconciler = createAuthorityReconciler({
    deploymentAuthorityStorage: opts.deploymentAuthorityStorage,
    materializedAuthorityStorage: opts.materializedAuthorityStorage,
    authorityReconciliationStorage: opts.authorityReconciliationStorage,
    physicalResources: {
      manager: createNatsAuthorityPhysicalResourceManager(opts.natsTrellis),
    },
  });
  void authorityReconciler.reconcileAllEnabled()
    .then((results) => {
      for (const result of results) {
        if (result.reconciliation.state === "failed") {
          opts.logger.warn({
            deploymentId: result.authority.deploymentId,
            desiredVersion: result.authority.version,
            message: result.reconciliation.message,
          }, "Deployment authority startup reconciliation failed");
        }
      }
    })
    .catch((error) => {
      opts.logger.warn(
        { error },
        "Deployment authority startup reconciliation failed",
      );
    });
  const disconnectCleanup = startDisconnectCleanup({
    connectionsKV: opts.connectionsKV,
    implementationOfferStorage: opts.implementationOfferStorage,
    logger: opts.logger,
    natsSystem: opts.natsSystem,
    offerStaleGraceMs: opts.config.ttlMs.connections,
    sessionStorage: opts.sessionStorage,
    trellis: opts.trellis,
  });
  const authCallout = startAuthCallout({
    config: opts.config,
    contractStorage: opts.contractStorage,
    capabilityGroupStorage: opts.capabilityGroupStorage,
    userStorage: opts.userStorage,
    deploymentAuthorityStorage: opts.deploymentAuthorityStorage,
    materializedResourceBindingStorage: {
      get: (deploymentId: string) =>
        opts.materializedAuthorityStorage.get(deploymentId),
      listByDeployment: (deploymentId: string) =>
        opts.materializedResourceBindingStorage.listBindingsByDeployment(
          deploymentId,
        ),
    },
    implementationOfferStorage: opts.implementationOfferStorage,
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
