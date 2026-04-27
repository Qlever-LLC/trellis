import type {
  JsonValue,
  TrellisContractV1,
} from "@qlever-llc/trellis/contracts";
import { digestJson } from "@qlever-llc/trellis/contracts";
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

function makeOperationContract(
  id: string,
  subject: string,
  displayName = "Billing",
): TrellisContractV1 {
  return {
    format: "trellis.contract.v1",
    id,
    displayName,
    description: `${displayName} test contract`,
    kind: "service",
    schemas: {
      RefundInput: { type: "object" },
      RefundProgress: { type: "object" },
      RefundOutput: { type: "object" },
    },
    operations: {
      Refund: {
        version: "v1",
        subject,
        input: { schema: "RefundInput" },
        progress: { schema: "RefundProgress" },
        output: { schema: "RefundOutput" },
      },
    },
  };
}

function makeJobsContract(id: string, displayName = "Jobs"): TrellisContractV1 {
  return {
    format: "trellis.contract.v1",
    id,
    displayName,
    description: `${displayName} test contract`,
    kind: "service",
    schemas: {
      JobPayload: { type: "object" },
      JobResult: { type: "object" },
    },
    jobs: {
      process: {
        payload: { schema: "JobPayload" },
        result: { schema: "JobResult" },
      },
    },
  };
}

function makeStoreContract(
  id: string,
  displayName = "Store",
): TrellisContractV1 {
  return {
    format: "trellis.contract.v1",
    id,
    displayName,
    description: `${displayName} test contract`,
    kind: "service",
    resources: {
      store: {
        uploads: {
          purpose: "Temporary uploads",
        },
      },
    },
  };
}

function makeStateContract(
  id: string,
  displayName = "State App",
): TrellisContractV1 {
  return {
    format: "trellis.contract.v1",
    id,
    displayName,
    description: `${displayName} test contract`,
    kind: "device",
    schemas: {
      Preferences: {
        type: "object",
        properties: {
          theme: { type: "string" },
        },
        required: ["theme"],
        additionalProperties: false,
      },
    },
    state: {
      preferences: {
        kind: "value",
        schema: { schema: "Preferences" },
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

  assertEquals(
    store.getContract(digest1, { includeInactive: true }),
    contract1,
  );
  assertEquals(
    store.getContract(digest2, { includeInactive: true }),
    contract2,
  );
  assertEquals(store.findSingleActiveDigestById("graph@v1"), digest1);
});

Deno.test("contract store allows two active digests for one contract id during rollout", async () => {
  const store = new ContractStore();
  const contract1 = makeContract("graph@v1", "rpc.v1.Graph.Ping", "graph");
  const contract2 = makeContract("graph@v1", "rpc.v1.Graph.Ping2", "graph");
  const digest1 = await digestContract(contract1);
  const digest2 = await digestContract(contract2);

  store.activate(digest1, contract1);
  store.add(digest2, contract2);

  store.setActiveDigests([digest1, digest2]);

  assertEquals(store.getContract(digest1), contract1);
  assertEquals(store.getContract(digest2), contract2);
  assertEquals(
    store.findActiveSubject("rpc.v1.Graph.Ping")?.contractId,
    "graph@v1",
  );
  assertEquals(
    store.findActiveSubject("rpc.v1.Graph.Ping2")?.contractId,
    "graph@v1",
  );
  assertRejects(
    async () => store.findSingleActiveDigestById("graph@v1"),
    Error,
    "multiple active digests",
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
      },
      {
        id: "graph@v1",
        digest: graphDigest,
        displayName: graph.displayName,
        description: graph.description,
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
  assertEquals(
    (validated.contract as Record<string, unknown>).xFutureMetadata,
    undefined,
  );
});

Deno.test("contract store preserves operations when validating contracts", async () => {
  const store = new ContractStore();

  const validated = await store.validate(
    makeOperationContract("billing@v1", "operations.v1.Billing.Refund"),
  );

  assertEquals(
    validated.contract.operations?.Refund?.subject,
    "operations.v1.Billing.Refund",
  );
  assertEquals(
    validated.contract.operations?.Refund?.progress?.schema,
    "RefundProgress",
  );
  assertEquals(
    validated.contract.operations?.Refund?.output?.schema,
    "RefundOutput",
  );
});

Deno.test("contract store preserves exported schema declarations when validating contracts", async () => {
  const store = new ContractStore();

  const validated = await store.validate({
    ...makeContract("exports@v1", "rpc.v1.Exports.Ping", "exports"),
    exports: {
      schemas: ["PingOutput"],
    },
  });

  assertEquals(validated.contract.exports, {
    schemas: ["PingOutput"],
  });
});

Deno.test("contract store rejects exported schema names missing from the registry", async () => {
  const store = new ContractStore();

  await assertRejects(
    async () => {
      await store.validate({
        ...makeContract("exports-invalid@v1", "rpc.v1.Exports.Ping", "exports"),
        exports: {
          schemas: ["MissingSchema"],
        },
      });
    },
    Error,
    "exports.schemas: unknown schema 'MissingSchema'",
  );
});

Deno.test("contract store rejects KV resource schema names missing from the registry", async () => {
  const store = new ContractStore();

  await assertRejects(
    async () => {
      await store.validate({
        ...makeContract("kv-invalid@v1", "rpc.v1.Kv.Ping", "kv"),
        resources: {
          kv: {
            cache: {
              purpose: "Cache values",
              schema: { schema: "MissingSchema" },
            },
          },
        },
      });
    },
    Error,
    "resources.kv 'cache': unknown schema 'MissingSchema'",
  );
});

Deno.test("contract store rejects state accepted version schemas missing from the registry", async () => {
  const store = new ContractStore();
  const contract = makeStateContract("state-invalid@v1");

  await assertRejects(
    async () => {
      await store.validate({
        ...contract,
        state: {
          preferences: {
            ...contract.state!.preferences,
            acceptedVersions: {
              "preferences.v0": { schema: "MissingSchema" },
            },
          },
        },
      });
    },
    Error,
    "state 'preferences' acceptedVersions 'preferences.v0': unknown schema 'MissingSchema'",
  );
});

Deno.test("contract store preserves top-level jobs when validating contracts", async () => {
  const store = new ContractStore();

  const validated = await store.validate(makeJobsContract("jobs@v1"));

  assertEquals(validated.contract.jobs?.process?.payload?.schema, "JobPayload");
  assertEquals(validated.contract.jobs?.process?.result?.schema, "JobResult");
});

Deno.test("contract store rejects legacy resources.jobs contracts", async () => {
  const store = new ContractStore();

  await assertRejects(
    async () => {
      await store.validate({
        format: "trellis.contract.v1",
        id: "jobs@v1",
        displayName: "Jobs",
        description: "Jobs test contract",
        kind: "service",
        schemas: {
          JobPayload: { type: "object" },
        },
        resources: {
          jobs: {
            queues: {
              process: {
                payload: { schema: "JobPayload" },
              },
            },
          },
        },
      });
    },
    Error,
    "/resources/jobs",
  );
});

Deno.test("contract store preserves store resources when validating contracts", async () => {
  const store = new ContractStore();

  const validated = await store.validate(makeStoreContract("store@v1"));

  assertEquals(
    validated.contract.resources?.store?.uploads?.purpose,
    "Temporary uploads",
  );
});

Deno.test("contract store preserves top-level state when validating contracts", async () => {
  const store = new ContractStore();

  const validated = await store.validate(makeStateContract("stateful@v1"));

  assertEquals(
    validated.contract.state?.preferences?.kind,
    "value",
  );
  assertEquals(
    validated.contract.state?.preferences?.schema?.schema,
    "Preferences",
  );
});

Deno.test("contract store indexes active operation subjects", async () => {
  const store = new ContractStore();
  const contract = makeOperationContract(
    "billing@v1",
    "operations.v1.Billing.Refund",
  );
  const digest = await digestContract(contract);

  store.activate(digest, contract);

  assertEquals(
    store.findActiveSubject("operations.v1.Billing.Refund")?.contractId,
    "billing@v1",
  );
});
