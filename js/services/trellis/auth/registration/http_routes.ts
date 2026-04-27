import type { Hono } from "@hono/hono";
import type { AuthContractsRuntime } from "./types.ts";
import type { SqlContractStorageRepository } from "../../catalog/storage.ts";
import { registerBuiltinPortalStaticRoutes } from "../http/builtin_portal.ts";
import { registerHttpRoutes } from "../http/routes.ts";
import type {
  SqlContractApprovalRepository,
  SqlDeviceActivationRepository,
  SqlDeviceDeploymentRepository,
  SqlDeviceInstanceRepository,
  SqlDevicePortalSelectionRepository,
  SqlLoginPortalSelectionRepository,
  SqlPortalDefaultRepository,
  SqlPortalRepository,
  SqlServiceDeploymentRepository,
  SqlServiceInstanceRepository,
  SqlUserProjectionRepository,
} from "../storage.ts";

export function registerAuthHttpRoutes(deps: {
  app: Hono;
  contracts: Pick<
    AuthContractsRuntime,
    "contractStore" | "refreshActiveContracts"
  >;
  contractStorage: SqlContractStorageRepository;
  userStorage: SqlUserProjectionRepository;
  contractApprovalStorage: SqlContractApprovalRepository;
  portalStorage: SqlPortalRepository;
  portalDefaultStorage: SqlPortalDefaultRepository;
  loginPortalSelectionStorage: SqlLoginPortalSelectionRepository;
  devicePortalSelectionStorage: SqlDevicePortalSelectionRepository;
  deviceDeploymentStorage: SqlDeviceDeploymentRepository;
  deviceInstanceStorage: SqlDeviceInstanceRepository;
  deviceActivationStorage: SqlDeviceActivationRepository;
  serviceDeploymentStorage: SqlServiceDeploymentRepository;
  serviceInstanceStorage: SqlServiceInstanceRepository;
}): void {
  registerBuiltinPortalStaticRoutes(deps.app);
  registerHttpRoutes(deps.app, {
    contractStorage: deps.contractStorage,
    userStorage: deps.userStorage,
    contractApprovalStorage: deps.contractApprovalStorage,
    portalStorage: deps.portalStorage,
    portalDefaultStorage: deps.portalDefaultStorage,
    loginPortalSelectionStorage: deps.loginPortalSelectionStorage,
    devicePortalSelectionStorage: deps.devicePortalSelectionStorage,
    deviceDeploymentStorage: deps.deviceDeploymentStorage,
    deviceInstanceStorage: deps.deviceInstanceStorage,
    deviceActivationStorage: deps.deviceActivationStorage,
    serviceDeploymentStorage: deps.serviceDeploymentStorage,
    serviceInstanceStorage: deps.serviceInstanceStorage,
    contractStore: deps.contracts.contractStore,
    refreshActiveContracts: deps.contracts.refreshActiveContracts,
  });
}
