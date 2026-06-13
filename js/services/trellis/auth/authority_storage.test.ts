import { assertEquals } from "@std/assert";

import {
  initializeTrellisStorageSchema,
  openTrellisStorageDb,
} from "../storage/db.ts";
import type { TrellisStorage } from "../storage/db.ts";
import {
  deploymentAuthorities,
  deploymentAuthorityCapabilities,
  deploymentAuthorityContracts,
  deploymentAuthorityPlans,
  deploymentAuthorityResources,
  deploymentAuthoritySurfaces,
  materializedAuthority,
} from "../storage/schema.ts";
import type {
  DeploymentAuthority,
  DeploymentAuthorityCapabilityDefinition,
  DeploymentAuthorityGrantOverride,
  DeploymentAuthorityMaterialization,
  DeploymentAuthorityPlan,
  DeploymentAuthorityReconciliationStatus,
  DeploymentAuthorityUpdate,
} from "./schemas.ts";
import {
  SqlAuthorityReconciliationRepository,
  SqlDeploymentAuthorityCapabilityDefinitionRepository,
  SqlDeploymentAuthorityGrantOverrideRepository,
  SqlDeploymentAuthorityPlanRepository,
  SqlDeploymentAuthorityRepository,
  SqlMaterializedAuthorityRepository,
} from "./storage.ts";

async function withAuthorityRepositories(
  test: (
    repos: {
      authorities: SqlDeploymentAuthorityRepository;
      plans: SqlDeploymentAuthorityPlanRepository;
      materialized: SqlMaterializedAuthorityRepository;
      reconciliation: SqlAuthorityReconciliationRepository;
      grantOverrides: SqlDeploymentAuthorityGrantOverrideRepository;
      capabilityDefinitions:
        SqlDeploymentAuthorityCapabilityDefinitionRepository;
    },
    storage: TrellisStorage,
  ) => Promise<void>,
): Promise<void> {
  const dbPath = await Deno.makeTempFile({
    dir: "/tmp",
    prefix: "trellis-authority-storage-",
    suffix: ".sqlite",
  });
  const storage = await openTrellisStorageDb(dbPath);

  try {
    await initializeTrellisStorageSchema(storage);
    await test({
      authorities: new SqlDeploymentAuthorityRepository(storage.db),
      plans: new SqlDeploymentAuthorityPlanRepository(storage.db),
      materialized: new SqlMaterializedAuthorityRepository(storage.db),
      reconciliation: new SqlAuthorityReconciliationRepository(storage.db),
      grantOverrides: new SqlDeploymentAuthorityGrantOverrideRepository(
        storage.db,
      ),
      capabilityDefinitions:
        new SqlDeploymentAuthorityCapabilityDefinitionRepository(storage.db),
    }, storage);
  } finally {
    storage.client.close();
    await Deno.remove(dbPath).catch(() => undefined);
  }
}

function makeAuthority(
  overrides: Partial<DeploymentAuthority> = {},
): DeploymentAuthority {
  return {
    deploymentId: "svc-a",
    kind: "service",
    disabled: false,
    version: "v1",
    createdAt: "2026-05-07T00:00:00.000Z",
    updatedAt: "2026-05-07T00:00:01.000Z",
    desiredState: {
      needs: {
        contracts: [{ contractId: "a.contract@v1", required: true }],
        surfaces: [],
        capabilities: [{ capability: "a.use", required: false }],
        resources: [],
      },
      capabilities: ["z.use"],
      resources: [
        { kind: "kv", alias: "cache", required: true, definition: { ttl: 60 } },
      ],
      surfaces: [{
        contractId: "a.contract@v1",
        kind: "rpc",
        name: "Rpc.Call",
        action: "call",
      }],
    },
    ...overrides,
  };
}

function makePlan(
  overrides: Partial<DeploymentAuthorityUpdate> = {},
): DeploymentAuthorityPlan {
  return {
    planId: "plan-a",
    deploymentId: "svc-a",
    classification: "update",
    proposal: {
      deploymentId: "svc-a",
      contractId: "a.contract@v1",
      contractDigest: "sha256-a",
      requestedNeeds: {
        contracts: [],
        surfaces: [],
        capabilities: [{ capability: "a.use", required: true }],
        resources: [],
      },
      providedSurfaces: [],
    },
    desiredChange: { add: ["a.use"] },
    materializationPreview: { resources: [] },
    warnings: [],
    createdAt: "2026-05-07T00:00:02.000Z",
    state: "pending",
    ...overrides,
  };
}

function makeMaterialized(
  overrides: Partial<DeploymentAuthorityMaterialization> = {},
): DeploymentAuthorityMaterialization {
  return {
    deploymentId: "svc-a",
    desiredVersion: "v1",
    status: "current",
    resourceBindings: [{
      deploymentId: "svc-a",
      kind: "kv",
      alias: "cache",
      binding: { bucket: "svc-a-cache" },
      limits: null,
      createdAt: "2026-05-07T00:00:03.000Z",
      updatedAt: "2026-05-07T00:00:03.000Z",
    }],
    grants: {
      capabilities: [{ capability: "a.use" }],
      surfaces: [],
      nats: [],
    },
    reconciledAt: "2026-05-07T00:00:03.000Z",
    ...overrides,
  };
}

Deno.test("deployment authority storage round-trips desired state", async () => {
  await withAuthorityRepositories(async ({ authorities }) => {
    await authorities.put(makeAuthority());

    assertEquals(
      await authorities.get("svc-a"),
      makeAuthority({
        desiredState: {
          needs: {
            contracts: [{
              contractId: "a.contract@v1",
              required: true,
            }],
            surfaces: [],
            capabilities: [
              { capability: "a.use", required: false },
            ],
            resources: [{
              kind: "kv",
              alias: "cache",
              required: true,
              definition: { ttl: 60 },
            }],
          },
          capabilities: ["z.use"],
          resources: [
            {
              kind: "kv",
              alias: "cache",
              required: true,
              definition: { ttl: 60 },
            },
          ],
          surfaces: [{
            contractId: "a.contract@v1",
            kind: "rpc",
            name: "Rpc.Call",
            action: "call",
          }],
        },
      }),
    );
  });
});

Deno.test("deployment authority storage decodes relational rows into grouped needs", async () => {
  await withAuthorityRepositories(async ({ authorities }, storage) => {
    await storage.db.insert(deploymentAuthorities).values({
      deploymentId: "svc-a",
      kind: "service",
      disabled: false,
      version: "v1",
      createdAt: "2026-05-07T00:00:00.000Z",
      updatedAt: "2026-05-07T00:00:01.000Z",
    });
    await storage.db.insert(deploymentAuthorityContracts).values({
      deploymentId: "svc-a",
      contractId: "a.contract@v1",
      required: true,
    });
    await storage.db.insert(deploymentAuthoritySurfaces).values([{
      deploymentId: "svc-a",
      contractId: "a.contract@v1",
      surfaceKind: "rpc",
      surfaceName: "Rpc.Call",
      action: "call",
      required: true,
      source: "need",
    }, {
      deploymentId: "svc-a",
      contractId: "a.contract@v1",
      surfaceKind: "event",
      surfaceName: "Event.Emitted",
      action: "subscribe",
      required: true,
      source: "surface",
    }]);
    await storage.db.insert(deploymentAuthorityResources).values({
      deploymentId: "svc-a",
      resourceKind: "kv",
      resourceAlias: "cache",
      required: false,
      definitionJson: JSON.stringify({ ttl: 60 }),
    });
    await storage.db.insert(deploymentAuthorityCapabilities).values([{
      deploymentId: "svc-a",
      capability: "a.use",
      required: false,
      source: "need",
    }, {
      deploymentId: "svc-a",
      capability: "a.use",
      required: true,
      source: "capability",
    }]);

    assertEquals(
      await authorities.get("svc-a"),
      makeAuthority({
        desiredState: {
          needs: {
            contracts: [{ contractId: "a.contract@v1", required: true }],
            surfaces: [{
              contractId: "a.contract@v1",
              kind: "rpc",
              name: "Rpc.Call",
              action: "call",
              required: true,
            }],
            capabilities: [{ capability: "a.use", required: false }],
            resources: [{
              kind: "kv",
              alias: "cache",
              required: false,
              definition: { ttl: 60 },
            }],
          },
          capabilities: ["a.use"],
          resources: [{
            kind: "kv",
            alias: "cache",
            required: false,
            definition: { ttl: 60 },
          }],
          surfaces: [{
            contractId: "a.contract@v1",
            kind: "event",
            name: "Event.Emitted",
            action: "subscribe",
          }],
        },
      }),
    );
  });
});

Deno.test("deployment authority plans round-trip state and decision metadata", async () => {
  await withAuthorityRepositories(async ({ plans }, storage) => {
    await plans.put(makePlan());
    await plans.put(makePlan({
      state: "accepted",
      decisionAt: "2026-05-07T00:00:04.000Z",
      decisionBy: { userId: "admin" },
      decisionReason: "accepted",
    }));

    assertEquals(
      await plans.get("plan-a"),
      makePlan({
        state: "accepted",
        decisionAt: "2026-05-07T00:00:04.000Z",
        decisionBy: { userId: "admin" },
        decisionReason: "accepted",
      }),
    );

    const rows = await storage.db.select().from(deploymentAuthorityPlans);
    assertEquals(
      JSON.parse(rows[0]?.proposalJson ?? "{}"),
      makePlan({
        state: "accepted",
        decisionAt: "2026-05-07T00:00:04.000Z",
        decisionBy: { userId: "admin" },
        decisionReason: "accepted",
      }).proposal,
    );
  });
});

Deno.test("deployment authority plan accept is atomic on pending plan and authority version", async () => {
  await withAuthorityRepositories(async ({ authorities, plans }) => {
    await authorities.put(makeAuthority());
    await plans.put(makePlan());

    const accepted = await authorities.acceptAuthorityPlan(
      makeAuthority({
        version: "v2",
        updatedAt: "2026-05-07T00:00:05.000Z",
        desiredState: {
          needs: {
            contracts: [],
            surfaces: [],
            capabilities: [{ capability: "new.use", required: true }],
            resources: [],
          },
          capabilities: ["new.use"],
          resources: [],
          surfaces: [],
        },
      }),
      makePlan({
        state: "accepted",
        decisionAt: "2026-05-07T00:00:05.000Z",
        decisionBy: { userId: "admin" },
        decisionReason: "accepted",
      }),
      "v1",
    );

    assertEquals(accepted, true);
    assertEquals((await authorities.get("svc-a"))?.version, "v2");
    assertEquals((await plans.get("plan-a"))?.state, "accepted");

    const staleAttempt = await authorities.acceptAuthorityPlan(
      makeAuthority({ version: "v3" }),
      makePlan({ state: "accepted", decisionReason: "accepted again" }),
      "v1",
    );

    assertEquals(staleAttempt, false);
    assertEquals((await authorities.get("svc-a"))?.version, "v2");
    assertEquals((await plans.get("plan-a"))?.decisionReason, "accepted");
  });
});

Deno.test("materialized authority stores resource bindings", async () => {
  await withAuthorityRepositories(async ({ materialized }, storage) => {
    await materialized.put(makeMaterialized());

    assertEquals(await materialized.get("svc-a"), makeMaterialized());
    assertEquals(
      await materialized.listBindingsByDeployment("svc-a"),
      makeMaterialized().resourceBindings,
    );
    const rows = await storage.db.select().from(materializedAuthority);
    assertEquals(JSON.parse(rows[0]?.grantsJson ?? "{}"), {
      capabilities: [{ capability: "a.use" }],
      surfaces: [],
      nats: [],
    });
  });
});

Deno.test("materialized authority round-trips typed nats grants", async () => {
  await withAuthorityRepositories(async ({ materialized }) => {
    const record = makeMaterialized({
      grants: {
        capabilities: [],
        surfaces: [],
        nats: [{
          direction: "publish",
          subject: "rpc.v1.Example.Ping",
          surface: {
            contractId: "example@v1",
            kind: "rpc",
            name: "Example.Ping",
            action: "call",
          },
          requiredCapabilities: ["example.ping"],
          grantSource: "used-surface",
        }],
      },
    });

    await materialized.put(record);

    assertEquals(await materialized.get("svc-a"), record);
  });
});

Deno.test("authority capability definitions list enabled deployments", async () => {
  await withAuthorityRepositories(
    async ({ authorities, capabilityDefinitions }) => {
      const definition: DeploymentAuthorityCapabilityDefinition = {
        deploymentId: "svc-a",
        key: "customer.read",
        displayName: "Read customers",
        description: "Read customer records.",
        source: "contract",
        contractId: "customer@v1",
        contractDigest: "digest-customer",
        contractDisplayName: "Customer",
        direction: "creates",
      };

      await authorities.put(makeAuthority());
      await authorities.put(makeAuthority({
        deploymentId: "svc-disabled",
        disabled: true,
      }));
      await capabilityDefinitions.replaceForDeployment("svc-a", [definition]);
      await capabilityDefinitions.replaceForDeployment("svc-disabled", [{
        ...definition,
        deploymentId: "svc-disabled",
        key: "disabled.read",
      }]);

      assertEquals(await capabilityDefinitions.listEnabled(), [definition]);
    },
  );
});

Deno.test("authority reconciliation stores status and events", async () => {
  await withAuthorityRepositories(async ({ reconciliation }) => {
    const status: DeploymentAuthorityReconciliationStatus = {
      deploymentId: "svc-a",
      desiredVersion: "v1",
      state: "succeeded",
      startedAt: "2026-05-07T00:00:03.000Z",
      finishedAt: "2026-05-07T00:00:04.000Z",
      message: "done",
    };
    await reconciliation.putStatus(status);
    await reconciliation.appendEvent({
      eventId: "evt-a",
      deploymentId: "svc-a",
      desiredVersion: "v1",
      state: "succeeded",
      message: "done",
      detailsJson: JSON.stringify({ resources: 1 }),
      createdAt: "2026-05-07T00:00:04.000Z",
    });

    assertEquals(await reconciliation.getStatus("svc-a"), status);
  });
});

Deno.test("deployment authority grant overrides are scoped by deployment", async () => {
  await withAuthorityRepositories(async ({ grantOverrides }) => {
    const record: DeploymentAuthorityGrantOverride = {
      deploymentId: "svc-a",
      identityKind: "web",
      grantKind: "capability",
      contractId: "app@v1",
      origin: "https://app.example",
      sessionPublicKey: null,
      capability: "items.read",
      capabilityGroupKey: null,
    };
    await grantOverrides.replaceForDeployment("svc-a", [record]);

    assertEquals(await grantOverrides.listByDeployment("svc-a"), [record]);
  });
});
