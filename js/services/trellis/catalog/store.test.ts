import type { JsonValue, TrellisContractV1 } from "@qlever-llc/trellis-contracts";
import { digestJson } from "@qlever-llc/trellis-contracts";
import { assertEquals, assertRejects } from "@std/assert";

import { ContractStore } from "./store.ts";

async function digestContract(contract: TrellisContractV1): Promise<string> {
  const json: JsonValue = JSON.parse(JSON.stringify(contract));
  return (await digestJson(json)).digest;
}

function makeContract(
  id: string,
  subject: string,
  displayName = "Graph",
): TrellisContractV1 {
  return {
    format: "trellis.contract.v1",
    id,
    displayName,
    description: `${displayName} test contract`,
    kind: "service",
    schemas: {
      PingInput: { type: "object" },
      PingOutput: { type: "object" },
    },
    rpc: {
      Ping: {
        version: "v1",
        subject,
        input: { schema: "PingInput" },
        output: { schema: "PingOutput" },
      },
    },
  };
}

Deno.test("contract store allows multiple digests for one contract id when only one is active", async () => {
  const store = new ContractStore();
  const contract1 = makeContract("graph@v1", "rpc.v1.Graph.Ping", "graph");
  const contract2 = makeContract("graph@v1", "rpc.v1.Graph.Ping2", "graph");
  const digest1 = await digestContract(contract1);
  const digest2 = await digestContract(contract2);

  store.activate(digest1, contract1);
  store.add(digest2, contract2);

  assertEquals(store.getContract(digest1, { includeInactive: true }), contract1);
  assertEquals(store.getContract(digest2, { includeInactive: true }), contract2);
  assertEquals(store.findActiveDigestById("graph@v1"), digest1);
});

Deno.test("contract store rejects two active digests for one contract id", async () => {
  const store = new ContractStore();
  const contract1 = makeContract("graph@v1", "rpc.v1.Graph.Ping", "graph");
  const contract2 = makeContract("graph@v1", "rpc.v1.Graph.Ping2", "graph");
  const digest1 = await digestContract(contract1);
  const digest2 = await digestContract(contract2);

  store.activate(digest1, contract1);
  store.add(digest2, contract2);

  await assertRejects(
    async () => {
      store.setActiveDigests([digest1, digest2]);
    },
    Error,
    "already active with a different digest",
  );
});

Deno.test("contract store rejects activating duplicate subjects", async () => {
  const store = new ContractStore();
  const contract1 = makeContract("graph@v1", "rpc.v1.Shared.Ping", "graph");
  const contract2 = makeContract("other@v1", "rpc.v1.Shared.Ping", "other");
  const digest1 = await digestContract(contract1);
  const digest2 = await digestContract(contract2);

  store.activate(digest1, contract1);

  await assertRejects(
    async () => {
      store.activate(digest2, contract2);
    },
    Error,
    "already registered by",
  );
});

Deno.test("contract store catalog includes active contracts in id order", async () => {
  const store = new ContractStore();
  const graph = makeContract("graph@v1", "rpc.v1.Graph.Ping", "graph");
  const auth = makeContract("auth@v1", "rpc.v1.Auth.Ping", "auth");
  const graphDigest = await digestContract(graph);
  const authDigest = await digestContract(auth);

  store.activate(graphDigest, graph);
  store.activate(authDigest, auth);

  assertEquals(store.getActiveCatalog(), {
    format: "trellis.catalog.v1",
    contracts: [
      {
        id: "auth@v1",
        digest: authDigest,
        displayName: auth.displayName,
        description: auth.description,
        kind: auth.kind,
      },
      {
        id: "graph@v1",
        digest: graphDigest,
        displayName: graph.displayName,
        description: graph.description,
        kind: graph.kind,
      },
    ],
  });
});

Deno.test("contract store ignores unknown top-level contract fields", async () => {
  const store = new ContractStore();

  const validated = await store.validate({
    ...makeContract("graph@v1", "rpc.v1.Graph.Ping", "graph"),
    xFutureMetadata: { hello: "world" },
  });

  assertEquals(validated.contract.id, "graph@v1");
  assertEquals((validated.contract as Record<string, unknown>).xFutureMetadata, undefined);
});
