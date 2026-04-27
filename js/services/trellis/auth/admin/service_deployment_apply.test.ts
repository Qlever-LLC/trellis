import { assert, assertEquals } from "@std/assert";

import {
  createAuthApplyServiceDeploymentContractHandler,
  type ServiceDeploymentStorage,
} from "./service_deployment_apply.ts";
import type { ServiceDeployment } from "./shared.ts";

class InMemoryServiceDeploymentStorage implements ServiceDeploymentStorage {
  #deployments = new Map<string, ServiceDeployment>();

  seed(deployment: ServiceDeployment): void {
    this.#deployments.set(deployment.deploymentId, deployment);
  }

  getValue(deploymentId: string): ServiceDeployment | undefined {
    return this.#deployments.get(deploymentId);
  }

  async get(deploymentId: string): Promise<ServiceDeployment | undefined> {
    await Promise.resolve();
    return this.#deployments.get(deploymentId);
  }

  async put(deployment: ServiceDeployment): Promise<void> {
    await Promise.resolve();
    this.#deployments.set(deployment.deploymentId, deployment);
  }
}

Deno.test("Auth.ApplyServiceDeploymentContract refreshes active contracts after persisting deployment", async () => {
  const serviceDeploymentStorage = new InMemoryServiceDeploymentStorage();
  serviceDeploymentStorage.seed({
    deploymentId: "billing.default",
    namespaces: ["billing"],
    disabled: false,
    appliedContracts: [],
  });
  const observedDeployments: ServiceDeployment[] = [];

  const handler = createAuthApplyServiceDeploymentContractHandler({
    serviceDeploymentStorage,
    installServiceContract: async () => ({
      id: "acme.billing@v1",
      digest: "digest-a",
      displayName: "Billing",
      description: "Billing service",
      usedNamespaces: ["billing", "audit"],
    }),
    refreshActiveContracts: async () => {
      const deployment = serviceDeploymentStorage.getValue("billing.default");
      assert(deployment !== undefined);
      observedDeployments.push(deployment);
    },
  });

  const result = await handler({
    input: { deploymentId: "billing.default", contract: {} },
    context: { caller: { type: "user", id: "admin" } },
  });
  assert(!result.isErr());
  const value = result.take() as {
    deployment: ServiceDeployment;
    contract: { digest: string };
  };

  assertEquals(observedDeployments.length, 1);
  assertEquals(observedDeployments[0], value.deployment);
  assertEquals(value.deployment.namespaces, ["audit", "billing"]);
  assertEquals(value.deployment.appliedContracts, [{
    contractId: "acme.billing@v1",
    allowedDigests: ["digest-a"],
  }]);
});
