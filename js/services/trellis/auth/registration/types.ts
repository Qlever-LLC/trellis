import type { ContractsModule } from "../../catalog/runtime.ts";
import type { trellisControlPlaneApi } from "../../bootstrap/control_plane_api.ts";
import type { API as trellisAuthApi } from "../../contracts/trellis_auth.ts";
import type { AuthRuntimeDeps } from "../runtime_deps.ts";
import type { TrellisService } from "@qlever-llc/trellis/service";

type AuthOwnedApi = typeof trellisAuthApi.owned;
type ControlPlaneTrellisApi = NonNullable<
  typeof trellisControlPlaneApi.trellis
>;

type AuthService = TrellisService<
  AuthOwnedApi,
  ControlPlaneTrellisApi
>;

export type AuthRpcMethod = keyof AuthOwnedApi["rpc"] & string;

export type RpcRegistrar = { handle: AuthService["handle"] };

export type OperationRegistrar = {
  operationCompletion: Pick<
    AuthService,
    "completeOperation"
  >;
};

export type AuthRuntime =
  & RpcRegistrar
  & OperationRegistrar
  & AuthRuntimeDeps["trellis"];

export type AuthContractsRuntime = Pick<
  ContractsModule,
  | "getActiveCapabilityDefinitions"
  | "getActiveContractsById"
  | "getActiveEntries"
  | "getBuiltinDigests"
  | "getContract"
  | "getKnownContract"
  | "getKnownEntriesByContractId"
  | "getKnownContractsById"
  | "getActiveCatalogIssues"
  | "validateContract"
  | "refreshActiveContracts"
  | "refreshActiveContractsForRemoval"
  | "validateActiveCatalog"
  | "validateActiveCatalogForRemoval"
>;
