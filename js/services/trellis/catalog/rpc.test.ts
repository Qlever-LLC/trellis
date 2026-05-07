import type { TrellisContractV1 } from "@qlever-llc/trellis/contracts";
import { assertEquals } from "@std/assert";

import {
  createTrellisCatalogHandler,
  createTrellisContractGetHandler,
} from "./rpc.ts";
import { ContractStore } from "./store.ts";

const exportedSchemaContract: TrellisContractV1 = {
  format: "trellis.contract.v1",
  id: "exports@v1",
  displayName: "Exports",
  description: "Exports public schemas.",
  kind: "service",
  schemas: {
    PublicValue: { type: "object" },
  },
  exports: {
    schemas: ["PublicValue"],
  },
};

const capabilityContract: TrellisContractV1 = {
  format: "trellis.contract.v1",
  id: "capabilities@v1",
  displayName: "Capabilities",
  description: "Declares capabilities.",
  kind: "service",
  capabilities: {
    "capabilities::items.read": {
      displayName: "Read items",
      description: "Read item records.",
      consequence: "Operators can inspect item metadata.",
    },
  },
};

Deno.test("Trellis.Contract.Get includes canonical exports", async () => {
  const store = new ContractStore();
  store.activate("digest-exports", exportedSchemaContract);

  const result = await createTrellisContractGetHandler(store)({
    digest: "digest-exports",
  });

  const value = result.take() as {
    contract: { exports?: { schemas?: string[] } };
  };
  assertEquals(value.contract.exports, {
    schemas: ["PublicValue"],
  });
});

Deno.test("Trellis.Catalog lists active contracts only", async () => {
  const store = new ContractStore();
  const appContract: TrellisContractV1 = {
    format: "trellis.contract.v1",
    id: "app@v1",
    displayName: "App",
    description: "Known app contract",
    kind: "app",
  };
  store.add("digest-app", appContract);
  store.activate("digest-exports", exportedSchemaContract);

  const result = await createTrellisCatalogHandler(store)();

  assertEquals(result.take(), {
    catalog: {
      format: "trellis.catalog.v1",
      contracts: [{
        id: "exports@v1",
        digest: "digest-exports",
        displayName: "Exports",
        description: "Exports public schemas.",
      }],
    },
  });
});

Deno.test("ContractStore lists active contract capability definitions", () => {
  const store = new ContractStore();
  store.add("digest-inactive", {
    ...capabilityContract,
    capabilities: {
      "capabilities::inactive": {
        displayName: "Inactive",
        description: "Inactive capability.",
      },
    },
  });
  store.activate("digest-capabilities", capabilityContract);

  assertEquals(store.getActiveCapabilityDefinitions(), [{
    key: "capabilities::items.read",
    displayName: "Read items",
    description: "Read item records.",
    consequence: "Operators can inspect item metadata.",
    contractId: "capabilities@v1",
    contractDigest: "digest-capabilities",
    contractDisplayName: "Capabilities",
  }]);
});
