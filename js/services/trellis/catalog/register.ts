import type { ContractsModule } from "./runtime.ts";
import type {
  SqlDeploymentContractEvidenceRepository,
  SqlDeploymentEnvelopeRepository,
  SqlDeviceDeploymentRepository,
  SqlDeviceInstanceRepository,
  SqlServiceDeploymentRepository,
  SqlServiceInstanceRepository,
} from "../auth/storage.ts";
import type { AuthRuntimeDeps } from "../auth/runtime_deps.ts";
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
  mount(method: CatalogRpcMethod, handler: unknown): Promise<void>;
};

type CatalogRegistrationDeps = {
  trellis: RpcRegistrar;
  contracts: ContractsModule;
  serviceInstanceStorage: SqlServiceInstanceRepository;
  serviceDeploymentStorage: SqlServiceDeploymentRepository;
  deviceInstanceStorage: SqlDeviceInstanceRepository;
  deviceDeploymentStorage: SqlDeviceDeploymentRepository;
  deploymentEnvelopeStorage: SqlDeploymentEnvelopeRepository;
  deploymentContractEvidenceStorage: SqlDeploymentContractEvidenceRepository;
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
    serviceInstanceStorage: deps.serviceInstanceStorage,
    logger: deps.logger,
  });
  const trellisSurfaceStatusHandler = createTrellisSurfaceStatusHandler({
    contracts: deps.contracts,
    serviceInstanceStorage: deps.serviceInstanceStorage,
    serviceDeploymentStorage: deps.serviceDeploymentStorage,
    deviceInstanceStorage: deps.deviceInstanceStorage,
    deviceDeploymentStorage: deps.deviceDeploymentStorage,
    deploymentEnvelopeStorage: deps.deploymentEnvelopeStorage,
    deploymentContractEvidenceStorage: deps.deploymentContractEvidenceStorage,
    connectionsKV: deps.connectionsKV,
    logger: deps.logger,
  });

  try {
    await deps.contracts.refreshActiveContracts();
  } catch (error) {
    deps.logger.warn(
      { error },
      "Active contract catalog is degraded; admin repair RPCs will still be mounted",
    );
  }

  await deps.trellis.mount(
    "Trellis.Catalog",
    createTrellisCatalogHandler(
      deps.contracts,
      deps.deploymentEnvelopeStorage,
      deps.deploymentContractEvidenceStorage,
      deps.logger,
    ),
  );
  await deps.trellis.mount(
    "Trellis.Contract.Get",
    ({ input }: { input: ContractGetInput }) =>
      createTrellisContractGetHandler(
        deps.contracts,
        deps.logger,
      )(
        input,
      ),
  );
  await deps.trellis.mount(
    "Trellis.Bindings.Get",
    ({ input, context }: BindingsGetEnvelope) =>
      trellisBindingsGetHandler(input, context),
  );
  await deps.trellis.mount(
    "Trellis.Surface.Status",
    ({ input, context }: SurfaceStatusEnvelope) =>
      trellisSurfaceStatusHandler(input, context),
  );
}
