import type { ContractsModule } from "./runtime.ts";
import type { SqlServiceInstanceRepository } from "../auth/storage.ts";
import {
  createTrellisBindingsGetHandler,
  createTrellisCatalogHandler,
  createTrellisContractGetHandler,
} from "./rpc.ts";

type CatalogRpcMethod =
  | "Trellis.Catalog"
  | "Trellis.Contract.Get"
  | "Trellis.Bindings.Get";

type RpcRegistrar = {
  mount: {
    bivarianceHack(method: CatalogRpcMethod, handler: unknown): Promise<void>;
  }["bivarianceHack"];
};

type CatalogRegistrationDeps = {
  trellis: RpcRegistrar;
  contracts: ContractsModule;
  serviceInstanceStorage: SqlServiceInstanceRepository;
  logger: { trace: (fields: Record<string, unknown>, message: string) => void };
};

type ContractGetInput = Parameters<
  ReturnType<typeof createTrellisContractGetHandler>
>[0];
type BindingsGetHandler = ReturnType<typeof createTrellisBindingsGetHandler>;
type BindingsGetEnvelope = Parameters<BindingsGetHandler> extends
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

  await deps.contracts.refreshActiveContracts();

  await deps.trellis.mount(
    "Trellis.Catalog",
    createTrellisCatalogHandler(deps.contracts.contractStore, deps.logger),
  );
  await deps.trellis.mount(
    "Trellis.Contract.Get",
    ({ input }: { input: ContractGetInput }) =>
      createTrellisContractGetHandler(
        deps.contracts.contractStore,
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
}
