import type { ContractsModule } from "../../catalog/runtime.ts";
import type { trellisControlPlaneApi } from "../../bootstrap/control_plane_api.ts";
import type { API as trellisAuthApi } from "../../contracts/trellis_auth.ts";
import type { AuthRuntimeDeps } from "../runtime_deps.ts";
import type {
  ServiceTrellis,
  TrellisService,
} from "@qlever-llc/trellis/service";

type AuthOwnedApi = typeof trellisAuthApi.owned;
type ControlPlaneTrellisApi = typeof trellisControlPlaneApi.trellis;
type AuthOperationName = keyof AuthOwnedApi["operations"] & string;
type AuthOperationRegistration<O extends AuthOperationName> = TrellisService<
  AuthOwnedApi,
  ControlPlaneTrellisApi
> extends { operation(name: O): infer TRegistration } ? TRegistration
  : never;

export type AuthRpcMethod = keyof AuthOwnedApi["rpc"] & string;

export type RpcRegistrar = Pick<
  ServiceTrellis<AuthOwnedApi, ControlPlaneTrellisApi>,
  "mount"
>;

export type OperationRegistrar = {
  operation<O extends AuthOperationName>(
    name: O,
  ): Pick<AuthOperationRegistration<O>, "handle">;
  operationCompletion: Pick<
    TrellisService<AuthOwnedApi, ControlPlaneTrellisApi>,
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
  | "validateContract"
  | "refreshActiveContracts"
  | "refreshActiveContractsForRemoval"
  | "validateActiveCatalog"
  | "validateActiveCatalogForRemoval"
>;
