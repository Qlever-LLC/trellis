import { assertEquals } from "@std/assert";

import { registerCatalog } from "./register.ts";

function createTrellisRegistrar(mounted: string[]) {
  return {
    handle: {
      rpc: {
        trellis: {
          catalog: async (_handler: unknown) => {
            mounted.push("Trellis.Catalog");
          },
          contractGet: async (_handler: unknown) => {
            mounted.push("Trellis.Contract.Get");
          },
          bindingsGet: async (_handler: unknown) => {
            mounted.push("Trellis.Bindings.Get");
          },
          surfaceStatus: async (_handler: unknown) => {
            mounted.push("Trellis.Surface.Status");
          },
        },
      },
    },
  };
}

function assertAllCatalogRpcsMounted(mounted: string[]) {
  assertEquals(mounted, [
    "Trellis.Catalog",
    "Trellis.Contract.Get",
    "Trellis.Bindings.Get",
    "Trellis.Surface.Status",
  ]);
}

Deno.test("registerCatalog mounts all catalog RPCs when active contract refresh fails", async () => {
  const mounted: string[] = [];
  const warnings: Array<{ fields: Record<string, unknown>; message: string }> =
    [];
  const refreshError = new Error("refresh failed");

  await registerCatalog({
    trellis: createTrellisRegistrar(mounted),
    contracts: {
      async pruneInvalidCachedContracts() {
        return { scanned: 0, valid: 0, pruned: 0 };
      },
      async refreshActiveContracts() {
        throw refreshError;
      },
    } as never,
    serviceInstanceStorage: {} as never,
    serviceDeploymentStorage: {} as never,
    deviceInstanceStorage: {} as never,
    deviceDeploymentStorage: {} as never,
    deploymentAuthorityStorage: {} as never,
    materializedAuthorityStorage: {} as never,
    implementationOfferStorage: {} as never,
    connectionsKV: {} as never,
    logger: {
      trace() {},
      warn(fields, message) {
        warnings.push({ fields, message });
      },
    },
  });

  assertAllCatalogRpcsMounted(mounted);
  assertEquals(warnings, [
    {
      fields: { error: refreshError },
      message:
        "Active contract catalog is degraded; forced update admin RPCs will still be mounted",
    },
  ]);
});

Deno.test("registerCatalog mounts all catalog RPCs when invalid cache pruning fails", async () => {
  const mounted: string[] = [];
  const warnings: Array<{ fields: Record<string, unknown>; message: string }> =
    [];
  const pruneError = new Error("prune failed");
  let refreshCalls = 0;

  await registerCatalog({
    trellis: createTrellisRegistrar(mounted),
    contracts: {
      async pruneInvalidCachedContracts() {
        throw pruneError;
      },
      async refreshActiveContracts() {
        refreshCalls += 1;
      },
    } as never,
    serviceInstanceStorage: {} as never,
    serviceDeploymentStorage: {} as never,
    deviceInstanceStorage: {} as never,
    deviceDeploymentStorage: {} as never,
    deploymentAuthorityStorage: {} as never,
    materializedAuthorityStorage: {} as never,
    implementationOfferStorage: {} as never,
    connectionsKV: {} as never,
    logger: {
      trace() {},
      warn(fields, message) {
        warnings.push({ fields, message });
      },
    },
  });

  assertEquals(refreshCalls, 1);
  assertAllCatalogRpcsMounted(mounted);
  assertEquals(warnings, [
    {
      fields: { error: pruneError },
      message: "Invalid cached contract pruning failed",
    },
  ]);
});
