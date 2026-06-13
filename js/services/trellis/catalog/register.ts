import type { ContractsModule } from "./runtime.ts";
import type {
  SqlDeviceDeploymentRepository,
  SqlDeviceInstanceRepository,
  SqlImplementationOfferRepository,
  SqlMaterializedAuthorityRepository,
  SqlServiceDeploymentRepository,
  SqlServiceInstanceRepository,
} from "../auth/storage.ts";
import type { AuthRuntimeDeps } from "../auth/runtime_deps.ts";
import type { DeploymentAuthority } from "../auth/schemas.ts";
import {
  createTrellisBindingsGetHandler,
  createTrellisCatalogHandler,
  createTrellisContractGetHandler,
  createTrellisSurfaceStatusHandler,
} from "./rpc.ts";

type CatalogRpcMethod =
  | "Trellis.Catalog"
  | "Trellis.Contract.Get"
  | "Trellis.Bindings.Get"
  | "Trellis.Surface.Status";

type RpcRegistrar = {
  handle: {
    rpc: {
      trellis: {
        catalog(handler: unknown): Promise<void>;
        contractGet(handler: unknown): Promise<void>;
        bindingsGet(handler: unknown): Promise<void>;
        surfaceStatus(handler: unknown): Promise<void>;
      };
    };
  };
};

type CatalogRegistrationDeps = {
  trellis: RpcRegistrar;
  contracts: ContractsModule;
  serviceInstanceStorage: SqlServiceInstanceRepository;
  serviceDeploymentStorage: SqlServiceDeploymentRepository;
  deviceInstanceStorage: SqlDeviceInstanceRepository;
  deviceDeploymentStorage: SqlDeviceDeploymentRepository;
  deploymentAuthorityStorage: {
    get(deploymentId: string): Promise<DeploymentAuthority | undefined>;
    listEnabledBySurface(surface: {
      contractId: string;
      kind: "rpc" | "operation" | "event" | "feed";
      name: string;
      action?: "call" | "publish" | "subscribe" | "observe" | "cancel";
    }): Promise<DeploymentAuthority[]>;
  };
  materializedAuthorityStorage: SqlMaterializedAuthorityRepository;
  implementationOfferStorage: SqlImplementationOfferRepository;
  connectionsKV: AuthRuntimeDeps["connectionsKV"];
  logger: {
    trace: (fields: Record<string, unknown>, message: string) => void;
    warn: (fields: Record<string, unknown>, message: string) => void;
  };
};

type ContractGetInput = Parameters<
  ReturnType<typeof createTrellisContractGetHandler>
>[0];
type BindingsGetHandler = ReturnType<typeof createTrellisBindingsGetHandler>;
type BindingsGetEnvelope = Parameters<BindingsGetHandler> extends
  [infer Input, infer Context] ? { input: Input; context: Context }
  : never;
type SurfaceStatusHandler = ReturnType<
  typeof createTrellisSurfaceStatusHandler
>;
type SurfaceStatusEnvelope = Parameters<SurfaceStatusHandler> extends
  [infer Input, infer Context] ? { input: Input; context: Context }
  : never;

/**
 * Registers Trellis catalog RPCs.
 */
export async function registerCatalog(
  deps: CatalogRegistrationDeps,
): Promise<void> {
  const trellisBindingsGetHandler = createTrellisBindingsGetHandler({
    contracts: deps.contracts,
    serviceInstanceStorage: deps.serviceInstanceStorage,
    deploymentAuthorityStorage: deps.deploymentAuthorityStorage,
    materializedAuthorityStorage: deps.materializedAuthorityStorage,
    implementationOfferStorage: deps.implementationOfferStorage,
    logger: deps.logger,
  });
  const trellisSurfaceStatusHandler = createTrellisSurfaceStatusHandler({
    contracts: deps.contracts,
    serviceInstanceStorage: deps.serviceInstanceStorage,
    serviceDeploymentStorage: deps.serviceDeploymentStorage,
    deviceInstanceStorage: deps.deviceInstanceStorage,
    deviceDeploymentStorage: deps.deviceDeploymentStorage,
    deploymentAuthorityStorage: deps.deploymentAuthorityStorage,
    implementationOfferStorage: deps.implementationOfferStorage,
    connectionsKV: deps.connectionsKV,
    logger: deps.logger,
  });

  try {
    await deps.contracts.pruneInvalidCachedContracts();
  } catch (error) {
    deps.logger.warn(
      { error },
      "Invalid cached contract pruning failed",
    );
  }

  try {
    await deps.contracts.refreshActiveContracts();
  } catch (error) {
    deps.logger.warn(
      { error },
      "Active contract catalog is degraded; forced update admin RPCs will still be mounted",
    );
  }

  await deps.trellis.handle.rpc.trellis.catalog(
    createTrellisCatalogHandler(
      deps.contracts,
      deps.logger,
    ),
  );
  await deps.trellis.handle.rpc.trellis.contractGet(
    ({ input }: { input: ContractGetInput }) =>
      createTrellisContractGetHandler(
        deps.contracts,
        deps.logger,
      )(
        input,
      ),
  );
  await deps.trellis.handle.rpc.trellis.bindingsGet(
    ({ input, context }: BindingsGetEnvelope) =>
      trellisBindingsGetHandler(input, context),
  );
  await deps.trellis.handle.rpc.trellis.surfaceStatus(
    ({ input, context }: SurfaceStatusEnvelope) =>
      trellisSurfaceStatusHandler(input, context),
  );
}
