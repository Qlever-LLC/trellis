import {
  createAuthGetInstalledContractHandler,
  createAuthListInstalledContractsHandler,
} from "../../catalog/rpc.ts";
import type { SqlContractStorageRepository } from "../../catalog/storage.ts";
import type { RpcRegistrar } from "./types.ts";

type GetInstalledContractInput = Parameters<
  ReturnType<typeof createAuthGetInstalledContractHandler>
>[0];

export async function registerInstalledContractRpcs(deps: {
  trellis: RpcRegistrar;
  contractStorage: SqlContractStorageRepository;
}): Promise<void> {
  await deps.trellis.mount(
    "Auth.ListInstalledContracts",
    createAuthListInstalledContractsHandler(deps.contractStorage),
  );
  await deps.trellis.mount(
    "Auth.GetInstalledContract",
    ({ input }: { input: GetInstalledContractInput }) =>
      createAuthGetInstalledContractHandler(deps.contractStorage)(input),
  );
}
