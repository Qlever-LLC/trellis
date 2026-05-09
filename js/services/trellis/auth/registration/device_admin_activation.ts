import { createDeviceAdminHandlers } from "../admin/rpc.ts";
import {
  createAuthDeploymentsServiceCreateHandler,
  createAuthDeploymentsServiceDisableHandler,
  createAuthDeploymentsServiceEnableHandler,
  createAuthDeploymentsServiceListHandler,
  createAuthDeploymentsServiceRemoveHandler,
} from "../admin/service_rpc.ts";
import { createKick } from "../callout/kick.ts";
import {
  createGetDeviceConnectInfoHandler,
  createResolveDeviceUserAuthoritiesHandler,
} from "../device_activation/operation.ts";
import type { AuthRuntimeDeps } from "../runtime_deps.ts";
import type { AuthContractsRuntime, AuthRuntime } from "./types.ts";
import type { Config } from "../../config.ts";
import type { SqlContractStorageRepository } from "../../catalog/storage.ts";
import type {
  SqlDeploymentContractEvidenceRepository,
  SqlDeploymentEnvelopeRepository,
  SqlDeploymentResourceBindingRepository,
  SqlServiceDeploymentRepository,
  SqlServiceInstanceRepository,
} from "../storage.ts";

export async function registerDeviceAdminAndActivation(
  deps:
    & {
      trellis: AuthRuntime;
      config: Config;
      contracts: Pick<
        AuthContractsRuntime,
        | "getActiveContractsById"
        | "getActiveEntries"
        | "getBuiltinDigests"
        | "getContract"
        | "validateContract"
        | "refreshActiveContracts"
        | "refreshActiveContractsForRemoval"
        | "validateActiveCatalog"
        | "validateActiveCatalogForRemoval"
      >;
      publishSessionRevoked: (
        event: {
          origin: string;
          id: string;
          sessionKey: string;
          revokedBy: string;
        },
      ) => Promise<void>;
      contractStorage: SqlContractStorageRepository;
      deploymentContractEvidenceStorage:
        SqlDeploymentContractEvidenceRepository;
      deploymentEnvelopeStorage: SqlDeploymentEnvelopeRepository;
      deploymentResourceBindingStorage: SqlDeploymentResourceBindingRepository;
      serviceDeploymentStorage: SqlServiceDeploymentRepository;
      serviceInstanceStorage: SqlServiceInstanceRepository;
    }
    & Pick<
      AuthRuntimeDeps,
      | "browserFlowsKV"
      | "connectionsKV"
      | "contractApprovalStorage"
      | "deploymentPortalRouteStorage"
      | "deviceActivationReviewStorage"
      | "deviceActivationStorage"
      | "deviceDeploymentStorage"
      | "deviceInstanceStorage"
      | "deviceProvisioningSecretStorage"
      | "logger"
      | "natsAuth"
      | "natsTrellis"
      | "sentinelCreds"
      | "sessionStorage"
      | "userStorage"
    >,
): Promise<void> {
  const handlers = createDeviceAdminHandlers({
    ...deps,
    eventPublisher: deps.trellis,
    kick: createKick(deps),
    operationCompletion: deps.trellis.operationCompletion,
    refreshActiveContracts: deps.contracts.refreshActiveContracts,
    refreshActiveContractsForRemoval:
      deps.contracts.refreshActiveContractsForRemoval,
    validateActiveCatalog: deps.contracts.validateActiveCatalog,
    validateActiveCatalogForRemoval:
      deps.contracts.validateActiveCatalogForRemoval,
    builtinContractDigests: deps.contracts.getBuiltinDigests(),
  });
  const kick = createKick(deps);
  const serviceAdminDeps = {
    logger: deps.logger,
    deploymentEnvelopeStorage: deps.deploymentEnvelopeStorage,
    serviceDeploymentStorage: deps.serviceDeploymentStorage,
    serviceInstanceStorage: deps.serviceInstanceStorage,
  };
  const createServiceDeployment = createAuthDeploymentsServiceCreateHandler(
    serviceAdminDeps,
  );
  const listServiceDeployments = createAuthDeploymentsServiceListHandler(
    serviceAdminDeps,
  );
  const disableServiceDeployment = createAuthDeploymentsServiceDisableHandler({
    kick,
    refreshActiveContracts: deps.contracts.refreshActiveContracts,
    validateActiveCatalog: deps.contracts.validateActiveCatalog,
    connectionsKV: deps.connectionsKV,
    sessionStorage: deps.sessionStorage,
    deploymentEnvelopeStorage: deps.deploymentEnvelopeStorage,
    serviceDeploymentStorage: deps.serviceDeploymentStorage,
    serviceInstanceStorage: deps.serviceInstanceStorage,
  });
  const enableServiceDeployment = createAuthDeploymentsServiceEnableHandler({
    refreshActiveContracts: deps.contracts.refreshActiveContracts,
    validateActiveCatalog: deps.contracts.validateActiveCatalog,
    deploymentEnvelopeStorage: deps.deploymentEnvelopeStorage,
    serviceDeploymentStorage: deps.serviceDeploymentStorage,
  });
  const removeServiceDeployment = createAuthDeploymentsServiceRemoveHandler({
    connectionsKV: deps.connectionsKV,
    kick,
    nats: deps.natsTrellis,
    logger: deps.logger,
    refreshActiveContracts: deps.contracts.refreshActiveContracts,
    refreshActiveContractsForRemoval:
      deps.contracts.refreshActiveContractsForRemoval,
    sessionStorage: deps.sessionStorage,
    validateActiveCatalog: deps.contracts.validateActiveCatalog,
    validateActiveCatalogForRemoval:
      deps.contracts.validateActiveCatalogForRemoval,
    serviceDeploymentStorage: deps.serviceDeploymentStorage,
    serviceInstanceStorage: deps.serviceInstanceStorage,
    builtinContractDigests: deps.contracts.getBuiltinDigests(),
    contractApprovalStorage: deps.contractApprovalStorage,
    contractStorage: deps.contractStorage,
    deploymentResourceBindingStorage: deps.deploymentResourceBindingStorage,
    deploymentContractEvidenceStorage: deps.deploymentContractEvidenceStorage,
    deviceDeploymentStorage: deps.deviceDeploymentStorage,
  });
  await deps.trellis.mount("Auth.Deployments.Create", async (args) => {
    if (args.input.kind === "service") {
      const result = await createServiceDeployment({
        ...args,
        input: {
          deploymentId: args.input.deploymentId,
          namespaces: args.input.namespaces,
        },
      });
      return result.map(({ deployment }) => ({
        deployment: { kind: "service" as const, ...deployment },
      }));
    }
    const result = await handlers.createDeviceDeployment({
      ...args,
      input: {
        deploymentId: args.input.deploymentId,
        ...(args.input.reviewMode ? { reviewMode: args.input.reviewMode } : {}),
      },
    });
    return result.map(({ deployment }) => ({
      deployment: { kind: "device" as const, ...deployment },
    }));
  });
  await deps.trellis.mount("Auth.Deployments.List", async (args) => {
    if (args.input.kind === "service") {
      const result = await listServiceDeployments(args);
      return result.map(({ deployments }) => ({
        deployments: deployments.map((deployment) => ({
          kind: "service" as const,
          ...deployment,
        })),
      }));
    }
    if (args.input.kind === "device") {
      const result = await handlers.listDeviceDeployments(args);
      return result.map(({ deployments }) => ({
        deployments: deployments.map((deployment) => ({
          kind: "device" as const,
          ...deployment,
        })),
      }));
    }
    const [serviceResult, deviceResult] = await Promise.all([
      listServiceDeployments(args),
      handlers.listDeviceDeployments(args),
    ]);
    if (serviceResult.isErr()) return serviceResult;
    if (deviceResult.isErr()) return deviceResult;
    const deviceDeployments = (deviceResult.take() as {
      deployments: Array<{
        deploymentId: string;
        reviewMode?: "none" | "required";
        disabled: boolean;
      }>;
    }).deployments;
    return serviceResult.map(({ deployments }) => ({
      deployments: [
        ...deployments.map((deployment) => ({
          kind: "service" as const,
          ...deployment,
        })),
        ...deviceDeployments.map((deployment) => ({
          kind: "device" as const,
          ...deployment,
        })),
      ],
    }));
  });
  await deps.trellis.mount("Auth.Deployments.Disable", async (args) => {
    if (args.input.kind === "service") {
      const result = await disableServiceDeployment(args);
      return result.map(({ deployment }) => ({
        deployment: { kind: "service" as const, ...deployment },
      }));
    }
    const result = await handlers.disableDeviceDeployment(args);
    return result.map(({ deployment }) => ({
      deployment: { kind: "device" as const, ...deployment },
    }));
  });
  await deps.trellis.mount("Auth.Deployments.Enable", async (args) => {
    if (args.input.kind === "service") {
      const result = await enableServiceDeployment(args);
      return result.map(({ deployment }) => ({
        deployment: { kind: "service" as const, ...deployment },
      }));
    }
    const result = await handlers.enableDeviceDeployment(args);
    return result.map(({ deployment }) => ({
      deployment: { kind: "device" as const, ...deployment },
    }));
  });
  await deps.trellis.mount("Auth.Deployments.Remove", async (args) => {
    return args.input.kind === "service"
      ? await removeServiceDeployment(args)
      : await handlers.removeDeviceDeployment(args);
  });
  await deps.trellis.mount(
    "Auth.Devices.Provision",
    handlers.provisionDeviceInstance,
  );
  await deps.trellis.mount(
    "Auth.Devices.List",
    handlers.listDeviceInstances,
  );
  await deps.trellis.mount(
    "Auth.Devices.Disable",
    handlers.disableDeviceInstance,
  );
  await deps.trellis.mount(
    "Auth.Devices.Enable",
    handlers.enableDeviceInstance,
  );
  await deps.trellis.mount(
    "Auth.Devices.Remove",
    handlers.removeDeviceInstance,
  );
  await deps.trellis.mount(
    "Auth.DeviceUserAuthorities.List",
    handlers.listDeviceActivations,
  );
  await deps.trellis.mount(
    "Auth.DeviceUserAuthorities.Revoke",
    handlers.revokeDeviceActivation,
  );
  await deps.trellis.operation("Auth.DeviceUserAuthorities.Resolve").handle(
    createResolveDeviceUserAuthoritiesHandler({
      ...deps,
      contracts: deps.contracts,
    }),
  );
  await deps.trellis.mount(
    "Auth.Devices.ConnectInfo.Get",
    createGetDeviceConnectInfoHandler({
      ...deps,
      contracts: deps.contracts,
    }),
  );
  await deps.trellis.mount(
    "Auth.DeviceUserAuthorities.Reviews.List",
    handlers.listDeviceActivationReviews,
  );
  await deps.trellis.mount(
    "Auth.DeviceUserAuthorities.Reviews.Decide",
    handlers.decideDeviceActivationReview,
  );
}
