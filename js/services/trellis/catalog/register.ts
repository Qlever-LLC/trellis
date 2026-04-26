import type { trellis as trellisRuntime } from "../bootstrap/globals.ts";
import type { createContractsModule } from "./rpc.ts";
import type { SqlServiceInstanceRepository } from "../auth/storage.ts";
import {
  createTrellisBindingsGetHandler,
  createTrellisCatalogHandler,
  createTrellisContractGetHandler,
} from "./rpc.ts";

type TrellisRuntime = typeof trellisRuntime;
type ContractsModule = ReturnType<typeof createContractsModule>;

type CatalogRegistrationDeps = {
  trellis: TrellisRuntime;
  contracts: ContractsModule;
  serviceInstanceStorage: SqlServiceInstanceRepository;
};

/**
 * Registers Trellis catalog RPCs.
 */
export async function registerCatalog(
  deps: CatalogRegistrationDeps,
): Promise<void> {
  const trellisBindingsGetHandler = createTrellisBindingsGetHandler({
    serviceInstanceStorage: deps.serviceInstanceStorage,
  });

  await deps.contracts.refreshActiveContracts();

  await deps.trellis.mount(
    "Trellis.Catalog",
    createTrellisCatalogHandler(deps.contracts.contractStore),
  );
  await deps.trellis.mount(
    "Trellis.Contract.Get",
    ({ input }) =>
      createTrellisContractGetHandler(deps.contracts.contractStore)(input),
  );
  await deps.trellis.mount(
    "Trellis.Bindings.Get",
    ({ input, context }) => trellisBindingsGetHandler(input, context),
  );
}
