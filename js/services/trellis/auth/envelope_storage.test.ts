import { assertEquals, assertRejects } from "@std/assert";

import {
  initializeTrellisStorageSchema,
  openTrellisStorageDb,
} from "../storage/db.ts";
import type { TrellisStorage } from "../storage/db.ts";
import { deploymentEnvelopeCapabilities } from "../storage/schema.ts";
import type {
  DeploymentContractEvidence,
  DeploymentEnvelope,
  DeploymentGrantOverride,
  DeploymentPortalRoute,
  DeploymentResourceBinding,
  EnvelopeExpansionRequest,
} from "./schemas.ts";
import {
  SqlDeploymentContractEvidenceRepository,
  SqlDeploymentEnvelopeRepository,
  SqlDeploymentGrantOverrideRepository,
  SqlDeploymentPortalRouteRepository,
  SqlDeploymentResourceBindingRepository,
  SqlEnvelopeExpansionRequestRepository,
} from "./storage.ts";

async function withEnvelopeRepositories(
  test: (
    repos: {
      envelopes: SqlDeploymentEnvelopeRepository;
      portalRoutes: SqlDeploymentPortalRouteRepository;
      grantOverrides: SqlDeploymentGrantOverrideRepository;
      resourceBindings: SqlDeploymentResourceBindingRepository;
      contractEvidence: SqlDeploymentContractEvidenceRepository;
      expansionRequests: SqlEnvelopeExpansionRequestRepository;
    },
    storage: TrellisStorage,
  ) => Promise<void>,
): Promise<void> {
  const dbPath = await Deno.makeTempFile({
    dir: "/tmp",
    prefix: "trellis-envelope-storage-",
    suffix: ".sqlite",
  });
  const storage = await openTrellisStorageDb(dbPath);

  try {
    await initializeTrellisStorageSchema(storage);
    await test({
      envelopes: new SqlDeploymentEnvelopeRepository(storage.db),
      portalRoutes: new SqlDeploymentPortalRouteRepository(storage.db),
      grantOverrides: new SqlDeploymentGrantOverrideRepository(storage.db),
      resourceBindings: new SqlDeploymentResourceBindingRepository(storage.db),
      contractEvidence: new SqlDeploymentContractEvidenceRepository(storage.db),
      expansionRequests: new SqlEnvelopeExpansionRequestRepository(storage.db),
    }, storage);
  } finally {
    storage.client.close();
    await Deno.remove(dbPath).catch(() => undefined);
  }
}

function makeEnvelope(
  overrides: Partial<DeploymentEnvelope> = {},
): DeploymentEnvelope {
  return {
    deploymentId: "svc-a",
    kind: "service",
    disabled: false,
    createdAt: "2026-05-07T00:00:00.000Z",
    updatedAt: "2026-05-07T00:00:01.000Z",
    boundary: {
      contracts: [
        { contractId: "z.contract@v1", required: false },
        { contractId: "a.contract@v1", required: true },
      ],
      surfaces: [
        {
          contractId: "z.contract@v1",
          kind: "event",
          name: "Events.Created",
          action: "subscribe",
          required: false,
        },
        {
          contractId: "a.contract@v1",
          kind: "rpc",
          name: "Rpc.Call",
          action: "call",
          required: true,
        },
      ],
      capabilities: ["z.use", "a.use"],
      resources: [
        { kind: "store", alias: "records", required: true },
        { kind: "kv", alias: "cache", required: false },
      ],
    },
    ...overrides,
  };
}

function makeExpansionRequest(
  overrides: Partial<EnvelopeExpansionRequest> = {},
): EnvelopeExpansionRequest {
  return {
    requestId: "req-a",
    deploymentId: "svc-a",
    requestedByKind: "service",
    requestedBy: { instanceId: "svc-instance-a" },
    contractId: "a.contract@v1",
    contractDigest: "sha256-a",
    contract: { id: "a.contract@v1" },
    state: "pending",
    createdAt: "2026-05-07T00:00:02.000Z",
    decidedAt: null,
    decidedBy: null,
    decisionReason: null,
    delta: {
      contracts: [{ contractId: "a.contract@v1", required: true }],
      surfaces: [{
        contractId: "a.contract@v1",
        kind: "rpc",
        name: "Rpc.Call",
        action: "call",
        required: true,
      }],
      capabilities: ["a.use"],
      resources: [{ kind: "kv", alias: "cache", required: true }],
    },
    ...overrides,
  };
}

Deno.test("deployment envelopes round-trip modeled child rows in stable order", async () => {
  await withEnvelopeRepositories(async ({ envelopes }) => {
    await envelopes.put(makeEnvelope());

    assertEquals(
      await envelopes.get("svc-a"),
      makeEnvelope({
        boundary: {
          contracts: [
            { contractId: "a.contract@v1", required: true },
            { contractId: "z.contract@v1", required: false },
          ],
          surfaces: [
            {
              contractId: "a.contract@v1",
              kind: "rpc",
              name: "Rpc.Call",
              action: "call",
              required: true,
            },
            {
              contractId: "z.contract@v1",
              kind: "event",
              name: "Events.Created",
              action: "subscribe",
              required: false,
            },
          ],
          capabilities: ["a.use", "z.use"],
          resources: [
            { kind: "kv", alias: "cache", required: false },
            { kind: "store", alias: "records", required: true },
          ],
        },
      }),
    );

    await envelopes.put(makeEnvelope({ deploymentId: "app-b", kind: "app" }));
    assertEquals(
      (await envelopes.listPage({ limit: 10 })).map((envelope) =>
        envelope.deploymentId
      ),
      ["app-b", "svc-a"],
    );
  });
});

Deno.test("deployment envelope repository validates records and enforces unique children", async () => {
  await withEnvelopeRepositories(async ({ envelopes }, storage) => {
    const invalid = structuredClone(makeEnvelope());
    Object.assign(invalid, { kind: "not-a-kind" });
    await assertRejects(() => envelopes.put(invalid));

    await envelopes.put(makeEnvelope());
    await assertRejects(() =>
      storage.db.insert(deploymentEnvelopeCapabilities).values({
        deploymentId: "svc-a",
        capability: "a.use",
      })
    );
  });
});

Deno.test("deployment envelope replacement is transactional for one deployment", async () => {
  await withEnvelopeRepositories(async ({ envelopes }) => {
    const original = makeEnvelope();
    await envelopes.put(original);

    await assertRejects(() =>
      envelopes.put(makeEnvelope({
        boundary: {
          ...original.boundary,
          capabilities: ["duplicate", "duplicate"],
        },
      }))
    );

    assertEquals((await envelopes.get("svc-a"))?.boundary.capabilities, [
      "a.use",
      "z.use",
    ]);
  });
});

Deno.test("deployment envelope expansion appends deltas without replacing concurrent rows", async () => {
  await withEnvelopeRepositories(async ({
    envelopes,
    resourceBindings,
    contractEvidence,
  }) => {
    const original = makeEnvelope();
    await envelopes.put(original);

    await envelopes.putExpansion({
      envelope: makeEnvelope({
        kind: "app",
        disabled: true,
        updatedAt: "2026-05-07T00:00:02.000Z",
        boundary: {
          ...original.boundary,
          contracts: [
            ...original.boundary.contracts,
            { contractId: "new-a.contract@v1", required: true },
          ],
        },
      }),
      delta: {
        contracts: [{ contractId: "new-a.contract@v1", required: true }],
        surfaces: [],
        capabilities: [],
        resources: [],
      },
      resourceBindings: [],
      contractEvidence: {
        deploymentId: "svc-a",
        contractId: "new-a.contract@v1",
        contractDigest: "sha256-expansion-a",
        contract: { id: "new-a.contract@v1" },
        firstSeenAt: "2026-05-07T00:00:02.000Z",
        lastSeenAt: "2026-05-07T00:00:02.000Z",
      },
    });

    await envelopes.putExpansion({
      envelope: makeEnvelope({
        updatedAt: "2026-05-07T00:00:03.000Z",
        boundary: {
          ...original.boundary,
          contracts: [
            ...original.boundary.contracts,
            { contractId: "new-b.contract@v1", required: true },
          ],
        },
      }),
      delta: {
        contracts: [{ contractId: "new-b.contract@v1", required: true }],
        surfaces: [],
        capabilities: [],
        resources: [{ kind: "kv", alias: "cache-b", required: true }],
      },
      resourceBindings: [{
        deploymentId: "svc-a",
        kind: "kv",
        alias: "cache-b",
        binding: { bucket: "svc_cache_b" },
        limits: null,
        createdAt: "2026-05-07T00:00:03.000Z",
        updatedAt: "2026-05-07T00:00:03.000Z",
      }],
      contractEvidence: {
        deploymentId: "svc-a",
        contractId: "new-b.contract@v1",
        contractDigest: "sha256-expansion-b",
        contract: { id: "new-b.contract@v1" },
        firstSeenAt: "2026-05-07T00:00:03.000Z",
        lastSeenAt: "2026-05-07T00:00:03.000Z",
      },
    });

    assertEquals(
      await envelopes.get("svc-a"),
      makeEnvelope({
        kind: "service",
        disabled: false,
        updatedAt: "2026-05-07T00:00:03.000Z",
        boundary: {
          contracts: [
            { contractId: "a.contract@v1", required: true },
            { contractId: "new-a.contract@v1", required: true },
            { contractId: "new-b.contract@v1", required: true },
            { contractId: "z.contract@v1", required: false },
          ],
          surfaces: [
            {
              contractId: "a.contract@v1",
              kind: "rpc",
              name: "Rpc.Call",
              action: "call",
              required: true,
            },
            {
              contractId: "z.contract@v1",
              kind: "event",
              name: "Events.Created",
              action: "subscribe",
              required: false,
            },
          ],
          capabilities: ["a.use", "z.use"],
          resources: [
            { kind: "kv", alias: "cache", required: false },
            { kind: "kv", alias: "cache-b", required: true },
            { kind: "store", alias: "records", required: true },
          ],
        },
      }),
    );
    assertEquals(
      (await resourceBindings.listByDeployment("svc-a")).map((binding) => ({
        kind: binding.kind,
        alias: binding.alias,
        binding: binding.binding,
      })),
      [{ kind: "kv", alias: "cache-b", binding: { bucket: "svc_cache_b" } }],
    );
    assertEquals(
      (await contractEvidence.listByDeployment("svc-a")).map((evidence) =>
        evidence.contractDigest
      ),
      ["sha256-expansion-a", "sha256-expansion-b"],
    );
  });
});

Deno.test("deployment envelope approval expands and marks request approved atomically", async () => {
  await withEnvelopeRepositories(async ({
    envelopes,
    expansionRequests,
    contractEvidence,
  }) => {
    const original = makeEnvelope();
    await envelopes.put(original);
    await expansionRequests.put(makeExpansionRequest({
      requestId: "req-approval",
      delta: {
        contracts: [{ contractId: "new.contract@v1", required: true }],
        surfaces: [],
        capabilities: ["new.use"],
        resources: [],
      },
    }));

    await envelopes.approveExpansion({
      envelope: makeEnvelope({
        kind: "app",
        disabled: true,
        updatedAt: "2026-05-07T00:00:04.000Z",
        boundary: {
          ...original.boundary,
          contracts: [
            ...original.boundary.contracts,
            { contractId: "new.contract@v1", required: true },
          ],
          capabilities: [...original.boundary.capabilities, "new.use"],
        },
      }),
      delta: {
        contracts: [{ contractId: "new.contract@v1", required: true }],
        surfaces: [],
        capabilities: ["new.use"],
        resources: [],
      },
      resourceBindings: [],
      contractEvidence: {
        deploymentId: "svc-a",
        contractId: "new.contract@v1",
        contractDigest: "sha256-new",
        contract: { id: "new.contract@v1" },
        firstSeenAt: "2026-05-07T00:00:04.000Z",
        lastSeenAt: "2026-05-07T00:00:04.000Z",
      },
      request: {
        requestId: "req-approval",
        state: "approved",
        decidedAt: "2026-05-07T00:00:04.000Z",
        decidedBy: { type: "user", id: "admin" },
        decisionReason: "approved",
      },
    });

    assertEquals(
      await envelopes.get("svc-a"),
      makeEnvelope({
        kind: "service",
        disabled: false,
        updatedAt: "2026-05-07T00:00:04.000Z",
        boundary: {
          contracts: [
            { contractId: "a.contract@v1", required: true },
            { contractId: "new.contract@v1", required: true },
            { contractId: "z.contract@v1", required: false },
          ],
          surfaces: [
            {
              contractId: "a.contract@v1",
              kind: "rpc",
              name: "Rpc.Call",
              action: "call",
              required: true,
            },
            {
              contractId: "z.contract@v1",
              kind: "event",
              name: "Events.Created",
              action: "subscribe",
              required: false,
            },
          ],
          capabilities: ["a.use", "new.use", "z.use"],
          resources: [
            { kind: "kv", alias: "cache", required: false },
            { kind: "store", alias: "records", required: true },
          ],
        },
      }),
    );
    assertEquals(
      (await expansionRequests.get("req-approval"))?.state,
      "approved",
    );
    const nextPending = await expansionRequests.putPending(
      makeExpansionRequest({
        requestId: "req-after-approval",
        contractId: "new.contract@v1",
        contractDigest: "sha256-new",
        contract: { id: "new.contract@v1" },
        delta: {
          contracts: [{ contractId: "new.contract@v1", required: true }],
          surfaces: [],
          capabilities: ["new.use"],
          resources: [{ kind: "store", alias: "records", required: true }],
        },
      }),
    );
    assertEquals(nextPending.requestId, "req-after-approval");
    assertEquals(
      (await contractEvidence.get("svc-a", "sha256-new"))?.contractId,
      "new.contract@v1",
    );
  });
});

Deno.test("portal routes, grant overrides, resources, and evidence support create read update list", async () => {
  await withEnvelopeRepositories(async ({
    portalRoutes,
    grantOverrides,
    resourceBindings,
    contractEvidence,
  }) => {
    const route: DeploymentPortalRoute = {
      deploymentId: "svc-a",
      portalId: "portal-a",
      entryUrl: "https://portal.example.com/start",
      disabled: false,
      updatedAt: "2026-05-07T00:00:00.000Z",
    };
    await portalRoutes.put(route);
    await portalRoutes.put({ ...route, disabled: true });
    assertEquals(await portalRoutes.get("svc-a"), { ...route, disabled: true });

    const grants: DeploymentGrantOverride[] = [{
      deploymentId: "svc-a",
      identityKind: "web",
      grantKind: "capability",
      contractId: "app@v1",
      origin: "https://app.example.com",
      sessionPublicKey: null,
      capability: "items.read",
      capabilityGroupKey: null,
    }, {
      deploymentId: "svc-a",
      identityKind: "session",
      grantKind: "capability-group",
      contractId: "app@v1",
      origin: null,
      sessionPublicKey: "session-a",
      capability: null,
      capabilityGroupKey: "reviewers",
    }];
    await grantOverrides.replaceForDeployment("svc-a", grants);
    assertEquals(
      (await grantOverrides.listByDeployment("svc-a")).map((grant) =>
        grant.grantKind === "capability"
          ? grant.capability
          : grant.capabilityGroupKey
      ),
      ["items.read", "reviewers"],
    );
    assertEquals(
      (await grantOverrides.listPage({ limit: 10 })).map((grant) =>
        grant.grantKind === "capability"
          ? grant.capability
          : grant.capabilityGroupKey
      ),
      ["items.read", "reviewers"],
    );
    await assertRejects(() =>
      grantOverrides.replaceForDeployment("svc-a", [grants[0], grants[0]])
    );
    assertEquals(
      (await grantOverrides.listByDeployment("svc-a")).map((grant) =>
        grant.grantKind === "capability"
          ? grant.capability
          : grant.capabilityGroupKey
      ),
      ["items.read", "reviewers"],
    );

    const binding: DeploymentResourceBinding = {
      deploymentId: "svc-a",
      kind: "kv",
      alias: "cache",
      binding: { bucket: "cache-a" },
      limits: { ttlMs: 1000 },
      createdAt: "2026-05-07T00:00:00.000Z",
      updatedAt: "2026-05-07T00:00:00.000Z",
    };
    await resourceBindings.put(binding);
    await resourceBindings.put({ ...binding, binding: { bucket: "cache-b" } });
    assertEquals(
      (await resourceBindings.listByDeployment("svc-a"))[0]?.binding,
      {
        bucket: "cache-b",
      },
    );

    const evidence: DeploymentContractEvidence = {
      deploymentId: "svc-a",
      contractId: "app@v1",
      contractDigest: "sha256-app",
      contract: { id: "app@v1" },
      firstSeenAt: "2026-05-07T00:00:00.000Z",
      lastSeenAt: "2026-05-07T00:00:01.000Z",
    };
    await contractEvidence.put(evidence);
    await contractEvidence.put({
      ...evidence,
      lastSeenAt: "2026-05-07T00:00:02.000Z",
    });
    assertEquals(
      (await contractEvidence.listByDeployment("svc-a"))[0]?.lastSeenAt,
      "2026-05-07T00:00:02.000Z",
    );
    await contractEvidence.put({
      ...evidence,
      contractDigest: "sha256-app-next",
      lastSeenAt: "2026-05-07T00:00:03.000Z",
    });
    const deleted = await contractEvidence.deleteEvidence({
      contractId: "app@v1",
      contractDigests: ["sha256-app"],
    });
    assertEquals(deleted.map((record) => record.contractDigest), [
      "sha256-app",
    ]);
    assertEquals(
      (await contractEvidence.listByContractId("app@v1")).map((record) =>
        record.contractDigest
      ),
      ["sha256-app-next"],
    );
  });
});

Deno.test("expansion requests round-trip deltas and update state", async () => {
  await withEnvelopeRepositories(async ({ expansionRequests }) => {
    await expansionRequests.put(makeExpansionRequest());
    assertEquals(await expansionRequests.get("req-a"), makeExpansionRequest());

    await expansionRequests.updateState({
      requestId: "req-a",
      state: "approved",
      decidedAt: "2026-05-07T00:00:03.000Z",
      decidedBy: { origin: "github", id: "admin" },
      decisionReason: "approved for bootstrap",
    });

    assertEquals((await expansionRequests.get("req-a"))?.state, "approved");
    assertEquals(
      (await expansionRequests.listByDeployment("svc-a")).map((request) =>
        request.requestId
      ),
      ["req-a"],
    );
  });
});

Deno.test("pending expansion request insert reuses equivalent pending rows", async () => {
  await withEnvelopeRepositories(async ({ expansionRequests }) => {
    const first = await expansionRequests.putPending(makeExpansionRequest({
      requestId: "req-first",
    }));
    const second = await expansionRequests.putPending(makeExpansionRequest({
      requestId: "req-second",
      requestedBy: { instanceId: "svc-instance-b" },
      createdAt: "2026-05-07T00:00:03.000Z",
    }));

    assertEquals(first.requestId, "req-first");
    assertEquals(second.requestId, "req-first");
    assertEquals(
      (await expansionRequests.listByDeployment("svc-a")).map((request) =>
        request.requestId
      ),
      ["req-first"],
    );

    await expansionRequests.updateState({
      requestId: "req-first",
      state: "rejected",
      decidedAt: "2026-05-07T00:00:04.000Z",
      decidedBy: { type: "user", id: "admin" },
      decisionReason: "superseded",
    });
    const third = await expansionRequests.putPending(makeExpansionRequest({
      requestId: "req-third",
      createdAt: "2026-05-07T00:00:05.000Z",
    }));

    assertEquals(third.requestId, "req-third");
    assertEquals(
      (await expansionRequests.listByDeployment("svc-a")).map((request) =>
        request.requestId
      ),
      ["req-first", "req-third"],
    );
  });
});

Deno.test("pending service expansion requests can be deleted by requester instance", async () => {
  await withEnvelopeRepositories(async ({ expansionRequests }) => {
    await expansionRequests.putPending(makeExpansionRequest({
      requestId: "req-service-a",
      requestedBy: { instanceId: "svc-instance-a" },
    }));
    await expansionRequests.putPending(makeExpansionRequest({
      requestId: "req-service-b",
      requestedBy: { instanceId: "svc-instance-b" },
      contractDigest: "sha256-b",
      createdAt: "2026-05-07T00:00:03.000Z",
    }));
    await expansionRequests.put(makeExpansionRequest({
      requestId: "req-service-a-approved",
      requestedBy: { instanceId: "svc-instance-a" },
      contractDigest: "sha256-approved",
      state: "approved",
      createdAt: "2026-05-07T00:00:04.000Z",
      decidedAt: "2026-05-07T00:00:05.000Z",
      decidedBy: { type: "user", id: "admin" },
      decisionReason: "approved",
    }));
    await expansionRequests.put(makeExpansionRequest({
      requestId: "req-user-a",
      requestedByKind: "user",
      requestedBy: { instanceId: "svc-instance-a" },
      contractDigest: "sha256-user",
      createdAt: "2026-05-07T00:00:06.000Z",
    }));

    assertEquals(
      await expansionRequests.deletePendingServiceRequestsByRequesterInstanceId(
        "svc-instance-a",
      ),
      1,
    );

    assertEquals(await expansionRequests.get("req-service-a"), undefined);
    assertEquals(
      (await expansionRequests.listByDeployment("svc-a")).map((request) =>
        request.requestId
      ),
      ["req-service-b", "req-service-a-approved", "req-user-a"],
    );
  });
});
