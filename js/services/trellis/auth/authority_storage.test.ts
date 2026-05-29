import { assertEquals } from "@std/assert";

import {
  initializeTrellisStorageSchema,
  openTrellisStorageDb,
} from "../storage/db.ts";
import type { TrellisStorage } from "../storage/db.ts";
import type {
  DeploymentAuthority,
  DeploymentAuthorityGrantOverride,
  DeploymentAuthorityMaterialization,
  DeploymentAuthorityPlan,
  DeploymentAuthorityReconciliationStatus,
  DeploymentAuthorityUpdate,
} from "./schemas.ts";
import {
  SqlAuthorityReconciliationRepository,
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
      needs: [
        { kind: "contract", contractId: "a.contract@v1", required: true },
        { kind: "capability", capability: "a.use", required: true },
      ],
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
      requestedNeeds: [{
        kind: "capability",
        capability: "a.use",
        required: true,
      }],
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
    grants: [{ capability: "a.use" }],
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
          needs: [
            { kind: "contract", contractId: "a.contract@v1", required: true },
            {
              kind: "surface",
              surface: {
                contractId: "a.contract@v1",
                kind: "rpc",
                name: "Rpc.Call",
                action: "call",
              },
              required: true,
            },
            {
              kind: "resource",
              resource: {
                kind: "kv",
                alias: "cache",
                required: true,
                definition: { ttl: 60 },
              },
              required: true,
            },
            { kind: "capability", capability: "a.use", required: true },
            { kind: "capability", capability: "z.use", required: true },
          ],
          capabilities: ["a.use", "z.use"],
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

Deno.test("deployment authority plans round-trip state and decision metadata", async () => {
  await withAuthorityRepositories(async ({ plans }) => {
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
          needs: [{
            kind: "capability",
            capability: "new.use",
            required: true,
          }],
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
  await withAuthorityRepositories(async ({ materialized }) => {
    await materialized.put(makeMaterialized());

    assertEquals(await materialized.get("svc-a"), makeMaterialized());
    assertEquals(
      await materialized.listBindingsByDeployment("svc-a"),
      makeMaterialized().resourceBindings,
    );
  });
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
