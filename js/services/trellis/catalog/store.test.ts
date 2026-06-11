import type { TrellisContractV1 } from "@qlever-llc/trellis/contracts";
import { digestContractManifest } from "@qlever-llc/trellis/contracts";
import { assertEquals, assertRejects, assertThrows } from "@std/assert";

import { createTestContracts } from "./test_contracts.ts";

function digestContract(contract: TrellisContractV1): string {
  return digestContractManifest(contract);
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

function makeEventContract(
  subject: string,
  params?: string[],
): TrellisContractV1 {
  return {
    format: "trellis.contract.v1",
    id: "partners@v1",
    displayName: "Partners",
    description: "Partners test contract",
    kind: "service",
    schemas: {
      PartnerChanged: {
        type: "object",
        properties: {
          partner: {
            type: "object",
            properties: {
              id: {
                type: "object",
                properties: {
                  origin: { type: "string" },
                  id: { type: "string" },
                },
              },
            },
          },
        },
      },
    },
    events: {
      "Partner.Changed": {
        version: "v1",
        subject,
        ...(params ? { params } : {}),
        event: { schema: "PartnerChanged" },
      },
    },
  };
}

type ContractSchema = NonNullable<TrellisContractV1["schemas"]>[string];

function makeEventContractWithPayloadSchema(
  subject: string,
  params: string[],
  payloadSchema: ContractSchema,
): TrellisContractV1 {
  return {
    ...makeEventContract(subject, params),
    schemas: {
      PartnerChanged: payloadSchema,
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
  const store = createTestContracts();
  const contract1 = makeContract("graph@v1", "rpc.v1.Graph.Ping", "graph");
  const contract2 = makeContract("graph@v1", "rpc.v1.Graph.Ping2", "graph");
  const digest1 = await digestContract(contract1);
  const digest2 = await digestContract(contract2);

  store.activateTestContract({ digest: digest1, contract: contract1 });
  store.addKnownTestContract({ digest: digest2, contract: contract2 });

  assertEquals(
    await store.getContract(digest1, { includeInactive: true }),
    contract1,
  );
  assertEquals(
    await store.getContract(digest2, { includeInactive: true }),
    contract2,
  );
  assertEquals(await store.getActiveContractsById("graph@v1"), [contract1]);
});

Deno.test("contract store allows two active digests for one contract id during rollout", async () => {
  const store = createTestContracts();
  const contract1 = makeContract("graph@v1", "rpc.v1.Graph.Ping", "graph");
  const contract2 = makeContract("graph@v1", "rpc.v1.Graph.Ping2", "graph");
  const digest1 = await digestContract(contract1);
  const digest2 = await digestContract(contract2);

  store.activateTestContract({ digest: digest1, contract: contract1 });
  store.addKnownTestContract({ digest: digest2, contract: contract2 });

  store.setActiveTestDigests([digest1, digest2]);

  assertEquals(await store.getContract(digest1), contract1);
  assertEquals(await store.getContract(digest2), contract2);
  assertEquals(
    store.findActiveSubject("rpc.v1.Graph.Ping")?.contractId,
    "graph@v1",
  );
  assertEquals(
    store.findActiveSubject("rpc.v1.Graph.Ping2")?.contractId,
    "graph@v1",
  );
  assertEquals(await store.getActiveContractsById("graph@v1"), [
    contract1,
    contract2,
  ]);
});

Deno.test("contract store rejects same-lineage subject collisions across logical surfaces", async () => {
  const store = createTestContracts();
  const contract1 = makeContract("graph@v1", "rpc.v1.Graph.Ping", "graph");
  const contract2 = {
    ...makeContract("graph@v1", "rpc.v1.Graph.Ping", "graph"),
    rpc: {
      Pong: {
        ...contract1.rpc!.Ping!,
        subject: "rpc.v1.Graph.Ping",
      },
    },
  } satisfies TrellisContractV1;
  const digest1 = await digestContract(contract1);
  const digest2 = await digestContract(contract2);

  store.activateTestContract({ digest: digest1, contract: contract1 });
  store.addKnownTestContract({ digest: digest2, contract: contract2 });

  assertThrows(
    () => store.setActiveTestDigests([digest1, digest2]),
    Error,
    "already registered by",
  );
  assertEquals(await store.getActiveContractsById("graph@v1"), [contract1]);
});

Deno.test("contract store validates proposed active digests without mutating active state", async () => {
  const store = createTestContracts();
  const contract1 = makeContract("graph@v1", "rpc.v1.Graph.Ping", "graph");
  const contract2 = {
    ...makeContract("graph@v1", "rpc.v1.Graph.Ping", "graph"),
    rpc: {
      Pong: {
        ...contract1.rpc!.Ping!,
        subject: "rpc.v1.Graph.Ping",
      },
    },
  } satisfies TrellisContractV1;
  const digest1 = await digestContract(contract1);
  const digest2 = await digestContract(contract2);

  store.activateTestContract({ digest: digest1, contract: contract1 });
  store.addKnownTestContract({ digest: digest2, contract: contract2 });

  assertThrows(
    () => store.validateActiveTestDigests([digest1, digest2]),
    Error,
    "already registered by",
  );
  assertEquals(
    (await store.getActiveCatalog()).contracts.map((entry) => entry.digest),
    [
      digest1,
    ],
  );
  assertEquals(await store.getActiveContractsById("graph@v1"), [contract1]);
});

Deno.test("contract store rejects unknown active digests", async () => {
  const store = createTestContracts();
  const contract = makeContract("graph@v1", "rpc.v1.Graph.Ping", "graph");

  store.activateTestContract({ digest: "known-digest", contract });

  assertThrows(
    () => store.setActiveTestDigests(["known-digest", "missing-digest"]),
    Error,
    "Unknown active contract digest 'missing-digest'",
  );
  assertEquals(
    (await store.getActiveCatalog()).contracts.map((entry) => entry.digest),
    [
      "known-digest",
    ],
  );
});

Deno.test("contract store rejects activating duplicate subjects", async () => {
  const store = createTestContracts();
  const contract1 = makeContract("graph@v1", "rpc.v1.Shared.Ping", "graph");
  const contract2 = makeContract("other@v1", "rpc.v1.Shared.Ping", "other");
  const digest1 = await digestContract(contract1);
  const digest2 = await digestContract(contract2);

  store.activateTestContract({ digest: digest1, contract: contract1 });

  await assertRejects(
    async () => {
      store.activateTestContract({ digest: digest2, contract: contract2 });
    },
    Error,
    "already registered by",
  );
});

Deno.test("contract store rejects activating subject templates with colliding wildcard subjects", async () => {
  const store = createTestContracts();
  const contract1 = {
    ...makeEventContract("events.v1.Shared.Changed.{/partner/id/origin}", [
      "/partner/id/origin",
    ]),
    id: "partners-origin@v1",
    displayName: "partners-origin",
  } satisfies TrellisContractV1;
  const contract2 = {
    ...makeEventContract("events.v1.Shared.Changed.{/partner/id/id}", [
      "/partner/id/id",
    ]),
    id: "partners-id@v1",
    displayName: "partners-id",
  } satisfies TrellisContractV1;
  const digest1 = await digestContract(contract1);
  const digest2 = await digestContract(contract2);

  store.activateTestContract({ digest: digest1, contract: contract1 });

  assertThrows(
    () => store.activateTestContract({ digest: digest2, contract: contract2 }),
    Error,
    "Subject 'events.v1.Shared.Changed.*' already registered by",
  );
});

Deno.test("contract store catalog includes active contracts in id order", async () => {
  const store = createTestContracts();
  const graph = makeContract("graph@v1", "rpc.v1.Graph.Ping", "graph");
  const auth = makeContract("auth@v1", "rpc.v1.Auth.Ping", "auth");
  const graphDigest = await digestContract(graph);
  const authDigest = await digestContract(auth);

  store.activateTestContract({ digest: graphDigest, contract: graph });
  store.activateTestContract({ digest: authDigest, contract: auth });

  assertEquals(await store.getActiveCatalog(), {
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

Deno.test("contract store catalog orders active contracts by id then digest", async () => {
  const store = createTestContracts();
  const graph = makeContract("graph@v1", "rpc.v1.Graph.Ping", "graph");
  const graphNewer = makeContract(
    "graph@v1",
    "rpc.v1.Graph.Ping2",
    "graph",
  );
  const auth = makeContract("auth@v1", "rpc.v1.Auth.Ping", "auth");

  store.activateTestContract({ digest: "graph-b", contract: graphNewer });
  store.activateTestContract({ digest: "auth-a", contract: auth });
  store.activateTestContract({ digest: "graph-a", contract: graph });

  assertEquals(
    (await store.getActiveCatalog()).contracts.map(({ id, digest }) => ({
      id,
      digest,
    })),
    [
      { id: "auth@v1", digest: "auth-a" },
      { id: "graph@v1", digest: "graph-a" },
      { id: "graph@v1", digest: "graph-b" },
    ],
  );
});

Deno.test("contract store ignores unknown top-level contract fields", async () => {
  const store = createTestContracts();

  const validated = await store.validateContract({
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
  const store = createTestContracts();

  const validated = await store.validateContract(
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

Deno.test("contract store rejects operation descriptors without output", async () => {
  const store = createTestContracts();
  const contract = makeOperationContract(
    "billing@v1",
    "operations.v1.Billing.Refund",
  );
  const { output: _output, ...operationWithoutOutput } = contract.operations!
    .Refund!;

  await assertRejects(
    () =>
      store.validateContract({
        ...contract,
        operations: {
          Refund: operationWithoutOutput,
        },
      }),
    Error,
    "Invalid contract",
  );
});

Deno.test("contract store preserves exported schema declarations when validating contracts", async () => {
  const store = createTestContracts();

  const validated = await store.validateContract({
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
  const store = createTestContracts();

  await assertRejects(
    async () => {
      await store.validateContract({
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

Deno.test("contract store rejects embedded schemas that are not Draft 2019-09 schemas", async () => {
  const store = createTestContracts();

  await assertRejects(
    () =>
      store.validateContract({
        ...makeContract(
          "schema-invalid@v1",
          "rpc.v1.SchemaInvalid.Ping",
          "schema",
        ),
        schemas: {
          PingInput: { type: "definitely-not-a-json-schema-type" },
          PingOutput: { type: "object" },
        },
      }),
    Error,
    "schemas.PingInput",
  );
});

Deno.test("contract store rejects remote refs in embedded schemas", async () => {
  const store = createTestContracts();

  await assertRejects(
    () =>
      store.validateContract({
        ...makeContract("schema-ref@v1", "rpc.v1.SchemaRef.Ping", "schema"),
        schemas: {
          PingInput: { $ref: "https://example.com/schemas/input.json" },
          PingOutput: { type: "object" },
        },
      }),
    Error,
    "schemas.PingInput: remote $ref is not supported",
  );
});

Deno.test("contract store rejects local refs in embedded schemas", async () => {
  const store = createTestContracts();

  await assertRejects(
    () =>
      store.validateContract({
        ...makeContract(
          "schema-local-ref@v1",
          "rpc.v1.SchemaLocalRef.Ping",
          "schema",
        ),
        schemas: {
          PingInput: {
            $defs: {
              Payload: { type: "object" },
            },
            $ref: "#/$defs/Payload",
          },
          PingOutput: { type: "object" },
        },
      }),
    Error,
    "schemas.PingInput: $ref is not supported in embedded schemas",
  );
});

Deno.test("contract store rejects KV resource schema names missing from the registry", async () => {
  const store = createTestContracts();

  await assertRejects(
    async () => {
      await store.validateContract({
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
  const store = createTestContracts();
  const contract = makeStateContract("state-invalid@v1");

  await assertRejects(
    async () => {
      await store.validateContract({
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
  const store = createTestContracts();

  const validated = await store.validateContract(makeJobsContract("jobs@v1"));

  assertEquals(validated.contract.jobs?.process?.payload?.schema, "JobPayload");
  assertEquals(validated.contract.jobs?.process?.result?.schema, "JobResult");
});

Deno.test("contract store rejects legacy resources.jobs contracts", async () => {
  const store = createTestContracts();

  await assertRejects(
    async () => {
      await store.validateContract({
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

Deno.test("contract store accepts event template params in subject order", async () => {
  const store = createTestContracts();

  const validated = await store.validateContract(
    makeEventContract(
      "events.v1.Partner.Changed.{/partner/id/origin}.{/partner/id/id}",
      ["/partner/id/origin", "/partner/id/id"],
    ),
  );

  assertEquals(
    validated.contract.events?.["Partner.Changed"]?.params,
    ["/partner/id/origin", "/partner/id/id"],
  );
});

Deno.test("contract store accepts top-level anyOf event params when all variants contain origin", async () => {
  const store = createTestContracts();

  const validated = await store.validateContract(
    makeEventContractWithPayloadSchema(
      "events.v1.Partner.Changed.{/origin}",
      ["/origin"],
      {
        anyOf: [
          { type: "object", properties: { origin: { type: "string" } } },
          { type: "object", properties: { origin: { type: "number" } } },
        ],
      },
    ),
  );

  assertEquals(validated.contract.events?.["Partner.Changed"]?.params, [
    "/origin",
  ]);
});

Deno.test("contract store accepts top-level oneOf event params when all variants contain origin", async () => {
  const store = createTestContracts();

  const validated = await store.validateContract(
    makeEventContractWithPayloadSchema(
      "events.v1.Partner.Changed.{/origin}",
      ["/origin"],
      {
        oneOf: [
          { type: "object", properties: { origin: { type: "string" } } },
          { type: "object", properties: { origin: { type: "integer" } } },
        ],
      },
    ),
  );

  assertEquals(validated.contract.events?.["Partner.Changed"]?.params, [
    "/origin",
  ]);
});

Deno.test("contract store rejects top-level anyOf event params when a variant is missing origin", async () => {
  const store = createTestContracts();

  await assertRejects(
    () =>
      store.validateContract(
        makeEventContractWithPayloadSchema(
          "events.v1.Partner.Changed.{/origin}",
          ["/origin"],
          {
            anyOf: [
              { type: "object", properties: { origin: { type: "string" } } },
              { type: "object", properties: { id: { type: "string" } } },
            ],
          },
        ),
      ),
    Error,
    "path not found",
  );
});

Deno.test("contract store rejects top-level oneOf event params when a variant is missing origin", async () => {
  const store = createTestContracts();

  await assertRejects(
    () =>
      store.validateContract(
        makeEventContractWithPayloadSchema(
          "events.v1.Partner.Changed.{/origin}",
          ["/origin"],
          {
            oneOf: [
              { type: "object", properties: { origin: { type: "string" } } },
              { type: "object", properties: { id: { type: "string" } } },
            ],
          },
        ),
      ),
    Error,
    "path not found",
  );
});

Deno.test("contract store rejects event params when a union variant origin is non-tokenable", async () => {
  const store = createTestContracts();
  const invalidOrigins: Array<[string, ContractSchema]> = [
    ["object", { type: "object", properties: { id: { type: "string" } } }],
    ["array", { type: "array", items: { type: "string" } }],
    ["boolean", { type: "boolean" }],
  ];

  for (const [label, origin] of invalidOrigins) {
    await assertRejects(
      () =>
        store.validateContract(
          makeEventContractWithPayloadSchema(
            `events.v1.Partner.Changed.${label}.{/origin}`,
            ["/origin"],
            {
              anyOf: [
                { type: "object", properties: { origin: { type: "string" } } },
                { type: "object", properties: { origin } },
              ],
            },
          ),
        ),
      Error,
      "must resolve to string/number",
    );
  }
});

Deno.test("contract store accepts nested event params through union variants", async () => {
  const store = createTestContracts();

  const validated = await store.validateContract(
    makeEventContractWithPayloadSchema(
      "events.v1.Partner.Changed.{/partner/id/origin}",
      ["/partner/id/origin"],
      {
        anyOf: [
          {
            type: "object",
            properties: {
              partner: {
                type: "object",
                properties: {
                  id: {
                    type: "object",
                    properties: { origin: { type: "string" } },
                  },
                },
              },
            },
          },
          {
            type: "object",
            properties: {
              partner: {
                type: "object",
                properties: {
                  id: {
                    type: "object",
                    properties: { origin: { type: "number" } },
                  },
                },
              },
            },
          },
        ],
      },
    ),
  );

  assertEquals(validated.contract.events?.["Partner.Changed"]?.params, [
    "/partner/id/origin",
  ]);
});

Deno.test("contract store rejects malformed event subject template tokens", async () => {
  const store = createTestContracts();

  await assertRejects(
    () =>
      store.validateContract(
        makeEventContract(
          "events.v1.Partner.Changed.{partner/id}",
          ["/partner/id"],
        ),
      ),
    Error,
    "event 'Partner.Changed' subject template token 'partner/id' must be a JSON Pointer",
  );
});

Deno.test("contract store rejects missing event params for template subjects", async () => {
  const store = createTestContracts();

  await assertRejects(
    () =>
      store.validateContract(
        makeEventContract(
          "events.v1.Partner.Changed.{/partner/id/origin}",
        ),
      ),
    Error,
    "event 'Partner.Changed' params must list subject template pointers in order",
  );
});

Deno.test("contract store rejects mismatched event template params", async () => {
  const store = createTestContracts();

  await assertRejects(
    () =>
      store.validateContract(
        makeEventContract(
          "events.v1.Partner.Changed.{/partner/id/origin}",
          ["/partner/id/id"],
        ),
      ),
    Error,
    "event 'Partner.Changed' params must list subject template pointers in order",
  );
});

Deno.test("contract store rejects reordered event template params", async () => {
  const store = createTestContracts();

  await assertRejects(
    () =>
      store.validateContract(
        makeEventContract(
          "events.v1.Partner.Changed.{/partner/id/origin}.{/partner/id/id}",
          ["/partner/id/id", "/partner/id/origin"],
        ),
      ),
    Error,
    "event 'Partner.Changed' params must list subject template pointers in order",
  );
});

Deno.test("contract store rejects event template params missing from payload schema", async () => {
  const store = createTestContracts();

  await assertRejects(
    () =>
      store.validateContract(
        makeEventContract(
          "events.v1.Partner.Changed.{/partner/missing}",
          ["/partner/missing"],
        ),
      ),
    Error,
    "path not found",
  );
});

Deno.test("contract store rejects event template params against boolean false payload schemas", async () => {
  const store = createTestContracts();

  await assertRejects(
    () =>
      store.validateContract(
        makeEventContractWithPayloadSchema(
          "events.v1.Partner.Changed.{/origin}",
          ["/origin"],
          false,
        ),
      ),
    Error,
    "path not found",
  );
});

Deno.test("contract store rejects event template params through non-object payload properties", async () => {
  const store = createTestContracts();

  await assertRejects(
    () =>
      store.validateContract(
        makeEventContract(
          "events.v1.Partner.Changed.{/partner/id/origin/value}",
          ["/partner/id/origin/value"],
        ),
      ),
    Error,
    "path not found",
  );
});

Deno.test("contract store rejects raw subject declarations", async () => {
  const store = createTestContracts();

  await assertRejects(
    () =>
      store.validateContract({
        ...makeContract("subjects@v1", "rpc.v1.Subjects.Ping", "subjects"),
        subjects: {
          Audit: { subject: "nats.audit" },
        },
      }),
    Error,
    "Contract subjects are not supported in v1",
  );
});

Deno.test("contract store rejects raw subject uses", async () => {
  const store = createTestContracts();

  await assertRejects(
    () =>
      store.validateContract({
        ...makeContract("subject-uses@v1", "rpc.v1.SubjectUses.Ping", "uses"),
        uses: {
          required: {
            audit: {
              contract: "audit@v1",
              subjects: { publish: ["Audit"] },
            },
          },
        },
      }),
    Error,
    "declares unsupported subjects",
  );
});

Deno.test("contract store rejects stream resources", async () => {
  const store = createTestContracts();

  await assertRejects(
    () =>
      store.validateContract({
        ...makeContract("streams@v1", "rpc.v1.Streams.Ping", "streams"),
        resources: {
          stream: {
            audit: { subjects: ["events.v1.Audit.>"] },
          },
        },
      }),
    Error,
    "/resources/stream",
  );
});

Deno.test("contract store preserves store resources when validating contracts", async () => {
  const store = createTestContracts();

  const validated = await store.validateContract(makeStoreContract("store@v1"));

  assertEquals(
    validated.contract.resources?.store?.uploads?.purpose,
    "Temporary uploads",
  );
});

Deno.test("contract store preserves top-level state when validating contracts", async () => {
  const store = createTestContracts();

  const validated = await store.validateContract(
    makeStateContract("stateful@v1"),
  );

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
  const store = createTestContracts();
  const contract = makeOperationContract(
    "billing@v1",
    "operations.v1.Billing.Refund",
  );
  const digest = await digestContract(contract);

  store.activateTestContract({ digest, contract });

  assertEquals(
    store.findActiveSubject("operations.v1.Billing.Refund")?.contractId,
    "billing@v1",
  );
});
