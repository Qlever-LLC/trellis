import { assertEquals } from "@std/assert";

import { registerCatalog } from "./register.ts";

Deno.test("registerCatalog mounts all catalog RPCs when active contract refresh fails", async () => {
  const mounted: string[] = [];
  const warnings: Array<{ fields: Record<string, unknown>; message: string }> =
    [];
  const refreshError = new Error("refresh failed");

  await registerCatalog({
    trellis: {
      async mount(method, _handler) {
        mounted.push(method);
      },
    },
    contracts: {
      async refreshActiveContracts() {
        throw refreshError;
      },
    } as never,
    serviceInstanceStorage: {} as never,
    serviceDeploymentStorage: {} as never,
    deviceInstanceStorage: {} as never,
    deviceDeploymentStorage: {} as never,
    deploymentEnvelopeStorage: {} as never,
    deploymentContractEvidenceStorage: {} as never,
    connectionsKV: {} as never,
    logger: {
      trace() {},
      warn(fields, message) {
        warnings.push({ fields, message });
      },
    },
  });

  assertEquals(mounted, [
    "Trellis.Catalog",
    "Trellis.Contract.Get",
    "Trellis.Bindings.Get",
    "Trellis.Surface.Status",
  ]);
  assertEquals(warnings, [
    {
      fields: { error: refreshError },
      message:
        "Active contract catalog is degraded; admin repair RPCs will still be mounted",
    },
  ]);
});
