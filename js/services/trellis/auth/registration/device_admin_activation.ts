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
        | "getActiveCatalogIssues"
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
      | "natsSystem"
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
    getActiveCatalogIssues: deps.contracts.getActiveCatalogIssues,
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
    validateActiveCatalogForRemoval:
      deps.contracts.validateActiveCatalogForRemoval,
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
    deploymentResourceBindingStorage: deps.deploymentResourceBindingStorage,
  });
  await deps.trellis.handle.rpc.auth.deploymentsCreate(async (args) => {
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
  await deps.trellis.handle.rpc.auth.deploymentsList(async (args) => {
    if (args.input.kind === "service") {
      const result = await listServiceDeployments(args);
      return result.map((page) => ({
        ...page,
        entries: page.entries.map((deployment) => ({
          kind: "service" as const,
          ...deployment,
        })),
      }));
    }
    if (args.input.kind === "device") {
      const result = await handlers.listDeviceDeployments(args);
      return result.map((page) => ({
        ...page,
        entries: page.entries.map((deployment) => ({
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
    const devicePage = deviceResult.take();
    if (!("entries" in devicePage)) return devicePage;
    return serviceResult.map((servicePage) => {
      const nextOffset = servicePage.nextOffset !== undefined ||
          devicePage.nextOffset !== undefined
        ? (args.input.offset ?? 0) + args.input.limit
        : undefined;
      return {
        entries: [
          ...servicePage.entries.map((deployment) => ({
            kind: "service" as const,
            ...deployment,
          })),
          ...devicePage.entries.map((deployment) => ({
            kind: "device" as const,
            ...deployment,
          })),
        ],
        count: servicePage.count + devicePage.count,
        offset: args.input.offset ?? 0,
        limit: args.input.limit,
        ...(nextOffset !== undefined ? { nextOffset } : {}),
      };
    });
  });
  await deps.trellis.handle.rpc.auth.deploymentsDisable(async (args) => {
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
  await deps.trellis.handle.rpc.auth.catalogIssuesResolve(
    handlers.resolveCatalogIssue,
  );
  await deps.trellis.handle.rpc.auth.deploymentsEnable(async (args) => {
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
  await deps.trellis.handle.rpc.auth.deploymentsRemove(async (args) => {
    return args.input.kind === "service"
      ? await removeServiceDeployment(args)
      : await handlers.removeDeviceDeployment(args);
  });
  await deps.trellis.handle.rpc.auth.devicesProvision(
    handlers.provisionDeviceInstance,
  );
  await deps.trellis.handle.rpc.auth.devicesList(handlers.listDeviceInstances);
  await deps.trellis.handle.rpc.auth.devicesDisable(
    handlers.disableDeviceInstance,
  );
  await deps.trellis.handle.rpc.auth.devicesEnable(
    handlers.enableDeviceInstance,
  );
  await deps.trellis.handle.rpc.auth.devicesRemove(
    handlers.removeDeviceInstance,
  );
  await deps.trellis.handle.rpc.auth.deviceUserAuthoritiesList(
    handlers.listDeviceActivations,
  );
  await deps.trellis.handle.rpc.auth.deviceUserAuthoritiesRevoke(
    handlers.revokeDeviceActivation,
  );
  await deps.trellis.handle.operation.auth.deviceUserAuthoritiesResolve(
    createResolveDeviceUserAuthoritiesHandler({
      ...deps,
      contracts: deps.contracts,
    }),
  );
  await deps.trellis.handle.rpc.auth.devicesConnectInfoGet(
    createGetDeviceConnectInfoHandler({
      ...deps,
      contracts: deps.contracts,
    }),
  );
  await deps.trellis.handle.rpc.auth.deviceUserAuthoritiesReviewsList(
    handlers.listDeviceActivationReviews,
  );
  await deps.trellis.handle.rpc.auth.deviceUserAuthoritiesReviewsDecide(
    handlers.decideDeviceActivationReview,
  );
}
