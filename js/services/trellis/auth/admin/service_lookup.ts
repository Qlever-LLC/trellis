import type {
  SqlServiceDeploymentRepository,
  SqlServiceInstanceRepository,
} from "../storage.ts";
import type { ServiceDeployment, ServiceInstance } from "./shared.ts";

export type ServiceLookupDeps = {
  serviceDeploymentStorage: Pick<SqlServiceDeploymentRepository, "get">;
  serviceInstanceStorage: Pick<
    SqlServiceInstanceRepository,
    "getByInstanceKey"
  >;
};

export type ServiceLookup = {
  loadServiceInstanceByKey(
    instanceKey: string,
  ): Promise<ServiceInstance | null>;
  loadServiceDeployment(
    deploymentId: string,
  ): Promise<ServiceDeployment | null>;
};

/** Creates service lookup helpers without coupling callers to admin RPC handlers. */
export function createServiceLookup(deps: ServiceLookupDeps): ServiceLookup {
  return {
    loadServiceInstanceByKey: async (instanceKey) => {
      return await deps.serviceInstanceStorage.getByInstanceKey(instanceKey) ??
        null;
    },
    loadServiceDeployment: async (deploymentId) => {
      return await deps.serviceDeploymentStorage.get(deploymentId) ?? null;
    },
  };
}
