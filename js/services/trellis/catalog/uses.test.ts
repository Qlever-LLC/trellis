import type { TrellisContractV1 } from "@qlever-llc/trellis/contracts";
import { assert, assertEquals, assertThrows } from "@std/assert";

import { createActiveContractLookup } from "./uses.ts";

type ContractSchemas = NonNullable<TrellisContractV1["schemas"]>;

function makeRpcContract(
  capabilities: string[],
): TrellisContractV1 {
  return makeSchemaRpcContract({
    schemas: {
      Input: { type: "object" },
      Output: { type: "object" },
    },
    capabilities,
  });
}

function makeSchemaRpcContract(options: {
  schemas: ContractSchemas;
  inputSchemaName?: string;
  capabilities?: string[];
}): TrellisContractV1 {
  return {
    format: "trellis.contract.v1",
    id: "graph@v1",
    displayName: "Graph",
    description: "Graph test contract",
    kind: "service",
    schemas: options.schemas,
    rpc: {
      Ping: {
        version: "v1",
        subject: "rpc.v1.Graph.Ping",
        input: { schema: options.inputSchemaName ?? "Input" },
        output: { schema: "Output" },
        capabilities: { call: options.capabilities ?? ["graph.read"] },
      },
    },
  };
}

Deno.test("active compatible projection rejects divergent RPC capabilities", () => {
  assertThrows(
    () =>
      createActiveContractLookup([
        { digest: "graph-a", contract: makeRpcContract(["graph.read"]) },
        {
          digest: "graph-b",
          contract: makeRpcContract(["graph.read", "graph.admin"]),
        },
      ]),
    Error,
    "different capabilities",
  );
});

Deno.test("active compatible projection rejects subject reuse across logical surfaces", () => {
  const first = makeRpcContract(["graph.read"]);
  const second = {
    ...makeRpcContract(["graph.read"]),
    rpc: {
      Pong: makeRpcContract(["graph.read"]).rpc!.Ping!,
    },
  } satisfies TrellisContractV1;

  assertThrows(
    () =>
      createActiveContractLookup([
        { digest: "graph-a", contract: first },
        { digest: "graph-b", contract: second },
      ]),
    Error,
    "different logical surfaces",
  );
});

Deno.test("active compatible projection rejects same schema ref name with changed required field", () => {
  assertThrows(
    () =>
      createActiveContractLookup([
        {
          digest: "graph-a",
          contract: makeSchemaRpcContract({
            schemas: {
              Input: {
                type: "object",
                properties: { id: { type: "string" } },
                required: ["id"],
              },
              Output: { type: "object" },
            },
          }),
        },
        {
          digest: "graph-b",
          contract: makeSchemaRpcContract({
            schemas: {
              Input: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  name: { type: "string" },
                },
                required: ["id", "name"],
              },
              Output: { type: "object" },
            },
          }),
        },
      ]),
    Error,
  );
});

Deno.test("active compatible projection allows optional additive field on open object", () => {
  const lookup = createActiveContractLookup([
    {
      digest: "graph-a",
      contract: makeSchemaRpcContract({
        schemas: {
          Input: {
            type: "object",
            properties: { id: { type: "string" } },
            required: ["id"],
          },
          Output: { type: "object" },
        },
      }),
    },
    {
      digest: "graph-b",
      contract: makeSchemaRpcContract({
        schemas: {
          Input: {
            type: "object",
            properties: {
              id: { type: "string" },
              displayName: { type: "string" },
            },
            required: ["id"],
          },
          Output: { type: "object" },
        },
      }),
    },
  ]);

  assertEquals(lookup.size, 1);
  assert(lookup.has("graph@v1"));
});

Deno.test("active compatible projection rejects conflicting optional additions across active digests", () => {
  assertThrows(
    () =>
      createActiveContractLookup([
        {
          digest: "graph-a",
          contract: makeSchemaRpcContract({
            schemas: {
              Input: {
                type: "object",
                properties: { id: { type: "string" } },
                required: ["id"],
              },
              Output: { type: "object" },
            },
          }),
        },
        {
          digest: "graph-b",
          contract: makeSchemaRpcContract({
            schemas: {
              Input: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  displayName: { type: "string" },
                },
                required: ["id"],
              },
              Output: { type: "object" },
            },
          }),
        },
        {
          digest: "graph-c",
          contract: makeSchemaRpcContract({
            schemas: {
              Input: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  displayName: { type: "number" },
                },
                required: ["id"],
              },
              Output: { type: "object" },
            },
          }),
        },
      ]),
    Error,
  );
});

Deno.test("active compatible projection allows different schema ref names with identical resolved schema", () => {
  const lookup = createActiveContractLookup([
    {
      digest: "graph-a",
      contract: makeSchemaRpcContract({
        schemas: {
          Input: {
            type: "object",
            properties: { id: { type: "string" } },
            required: ["id"],
          },
          Output: { type: "object" },
        },
      }),
    },
    {
      digest: "graph-b",
      contract: makeSchemaRpcContract({
        inputSchemaName: "PingInput",
        schemas: {
          PingInput: {
            type: "object",
            properties: { id: { type: "string" } },
            required: ["id"],
          },
          Output: { type: "object" },
        },
      }),
    },
  ]);

  assertEquals(lookup.size, 1);
  assert(lookup.has("graph@v1"));
});

Deno.test("active compatible projection rejects optional additive field when old schema is closed", () => {
  assertThrows(
    () =>
      createActiveContractLookup([
        {
          digest: "graph-a",
          contract: makeSchemaRpcContract({
            schemas: {
              Input: {
                type: "object",
                properties: { id: { type: "string" } },
                required: ["id"],
                additionalProperties: false,
              },
              Output: { type: "object" },
            },
          }),
        },
        {
          digest: "graph-b",
          contract: makeSchemaRpcContract({
            schemas: {
              Input: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  displayName: { type: "string" },
                },
                required: ["id"],
              },
              Output: { type: "object" },
            },
          }),
        },
      ]),
    Error,
  );
});

Deno.test("active compatible projection rejects property-set divergence when either schema is closed", () => {
  assertThrows(
    () =>
      createActiveContractLookup([
        {
          digest: "graph-a",
          contract: makeSchemaRpcContract({
            schemas: {
              Input: {
                type: "object",
                properties: { id: { type: "string" } },
                required: ["id"],
              },
              Output: { type: "object" },
            },
          }),
        },
        {
          digest: "graph-b",
          contract: makeSchemaRpcContract({
            schemas: {
              Input: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  displayName: { type: "string" },
                },
                required: ["id"],
                additionalProperties: false,
              },
              Output: { type: "object" },
            },
          }),
        },
      ]),
    Error,
  );
});

Deno.test("active compatible projection rejects enum narrowing", () => {
  assertThrows(
    () =>
      createActiveContractLookup([
        {
          digest: "graph-a",
          contract: makeSchemaRpcContract({
            schemas: {
              Input: {
                type: "object",
                properties: {
                  status: { enum: ["active", "paused"] },
                },
                required: ["status"],
              },
              Output: { type: "object" },
            },
          }),
        },
        {
          digest: "graph-b",
          contract: makeSchemaRpcContract({
            schemas: {
              Input: {
                type: "object",
                properties: {
                  status: { enum: ["active"] },
                },
                required: ["status"],
              },
              Output: { type: "object" },
            },
          }),
        },
      ]),
    Error,
  );
});

Deno.test("active compatible projection rejects duplicate required entries", () => {
  assertThrows(
    () =>
      createActiveContractLookup([
        {
          digest: "graph-a",
          contract: makeSchemaRpcContract({
            schemas: {
              Input: {
                type: "object",
                properties: { id: { type: "string" } },
                required: ["id", "id"],
              },
              Output: { type: "object" },
            },
          }),
        },
        {
          digest: "graph-b",
          contract: makeSchemaRpcContract({
            schemas: {
              Input: {
                type: "object",
                properties: { id: { type: "string" } },
                required: ["id"],
              },
              Output: { type: "object" },
            },
          }),
        },
      ]),
    Error,
  );
});

Deno.test("active compatible projection rejects required property narrowing from missing declaration", () => {
  assertThrows(
    () =>
      createActiveContractLookup([
        {
          digest: "graph-a",
          contract: makeSchemaRpcContract({
            schemas: {
              Input: {
                type: "object",
                required: ["id"],
              },
              Output: { type: "object" },
            },
          }),
        },
        {
          digest: "graph-b",
          contract: makeSchemaRpcContract({
            schemas: {
              Input: {
                type: "object",
                properties: { id: { type: "string" } },
                required: ["id"],
              },
              Output: { type: "object" },
            },
          }),
        },
      ]),
    Error,
  );
});

Deno.test("active compatible projection rejects divergent duplicate job queues", () => {
  const baseContract = makeSchemaRpcContract({
    schemas: {
      Input: { type: "object" },
      Output: { type: "object" },
      JobPayload: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
      JobResult: { type: "object" },
    },
  });

  assertThrows(
    () =>
      createActiveContractLookup([
        {
          digest: "graph-a",
          contract: {
            ...baseContract,
            jobs: {
              refresh: {
                payload: { schema: "JobPayload" },
                result: { schema: "JobResult" },
              },
            },
          },
        },
        {
          digest: "graph-b",
          contract: {
            ...baseContract,
            jobs: {
              refresh: {
                payload: { schema: "JobPayload" },
                result: { schema: "JobResult" },
                concurrency: 2,
              },
            },
          },
        },
      ]),
    Error,
  );
});
