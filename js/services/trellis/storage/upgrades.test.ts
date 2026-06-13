import { assertEquals, assertInstanceOf, assertMatch } from "@std/assert";
import {
  digestContractManifest,
  type TrellisContractV1,
} from "@qlever-llc/trellis/contracts";
import { eq } from "drizzle-orm";

import {
  applyTrellisStorageSqlMigrations,
  initializeTrellisStorageSchema,
  openTrellisStorageDb,
} from "./db.ts";
import { SqlSessionRepository } from "../auth/storage/sessions_users_approvals.ts";
import { SqlMaterializedAuthorityRepository } from "../auth/storage/authority.ts";
import {
  contracts,
  deploymentAuthorityPlans,
  materializedAuthority,
  serviceInstances,
  sessions,
  trellisUpgrades,
} from "./schema.ts";
import {
  CONTRACT_DIGEST_REINDEX_UPGRADE_ID,
  DEPLOYMENT_AUTHORITY_GROUPED_NEEDS_UPGRADE_ID,
  MATERIALIZED_AUTHORITY_GROUPED_GRANTS_UPGRADE_ID,
  runTrellisStorageUpgrades,
  SERVICE_SESSION_CONTRACT_FIELDS_UPGRADE_ID,
} from "./upgrades.ts";

function testContract(id: string, subject: string): TrellisContractV1 {
  return {
    format: "trellis.contract.v1",
    id,
    displayName: id,
    description: `${id} test contract`,
    kind: "service",
    schemas: {
      Input: { type: "object" },
      Output: { type: "object" },
    },
    rpc: {
      Query: {
        version: "v1",
        subject,
        input: { schema: "Input" },
        output: { schema: "Output" },
      },
    },
  };
}

async function withMigratedStorage(
  prefix: string,
  test: (
    storage: Awaited<ReturnType<typeof openTrellisStorageDb>>,
  ) => Promise<void>,
): Promise<void> {
  const dbPath = await Deno.makeTempFile({
    dir: "/tmp",
    prefix,
    suffix: ".sqlite",
  });
  const storage = await openTrellisStorageDb(dbPath);

  try {
    await applyTrellisStorageSqlMigrations(storage);
    await test(storage);
  } finally {
    storage.client.close();
    await Deno.remove(dbPath).catch(() => undefined);
  }
}

function emptyGroupedGrants() {
  return { capabilities: [], surfaces: [], nats: [] };
}

function emptyGroupedNeeds() {
  return { contracts: [], surfaces: [], capabilities: [], resources: [] };
}

async function insertMaterializedAuthorityRow(
  storage: Awaited<ReturnType<typeof openTrellisStorageDb>>,
  values: {
    deploymentId: string;
    grantsJson: string;
    status?: string;
    error?: string | null;
  },
): Promise<void> {
  await storage.db.insert(materializedAuthority).values({
    deploymentId: values.deploymentId,
    desiredVersion: "v1",
    status: values.status ?? "current",
    grantsJson: values.grantsJson,
    reconciledAt: "2026-01-01T00:00:00.000Z",
    error: values.error ?? null,
  });
}

async function insertAuthorityPlanRow(
  storage: Awaited<ReturnType<typeof openTrellisStorageDb>>,
  values: {
    planId: string;
    proposalJson: string;
    desiredChangeJson?: string;
    materializationPreviewJson?: string;
  },
): Promise<void> {
  await storage.db.insert(deploymentAuthorityPlans).values({
    planId: values.planId,
    deploymentId: "svc-a",
    classification: "update",
    state: "pending",
    proposalJson: values.proposalJson,
    desiredChangeJson: values.desiredChangeJson ?? JSON.stringify(
      emptyGroupedNeeds(),
    ),
    materializationPreviewJson: values.materializationPreviewJson ??
      JSON.stringify({}),
    warningsJson: JSON.stringify([]),
    acknowledgementRequired: null,
    decisionAt: null,
    decisionByJson: null,
    decisionReason: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    expiresAt: null,
  });
}

Deno.test("contract digest reindex upgrade reindexes valid stale contract rows", async () => {
  await withMigratedStorage(
    "trellis-storage-upgrade-reindex-",
    async (storage) => {
      const contract = testContract("billing@v1", "rpc.v1.Billing.Query");
      const currentDigest = digestContractManifest(contract);
      await storage.db.insert(contracts).values({
        digest: "legacy-digest",
        contractId: contract.id,
        displayName: contract.displayName,
        description: contract.description,
        installedAt: "2026-01-01T00:00:00.000Z",
        contract: JSON.stringify(contract),
        resources: null,
        analysisSummary: null,
        analysis: null,
      });
      await storage.db.insert(serviceInstances).values({
        instanceId: "billing.instance",
        deploymentId: "billing.default",
        instanceKey: "billing-key",
        disabled: false,
        capabilities: "[]",
        resourceBindings: null,
        createdAt: "2026-01-01T00:00:00.000Z",
      });

      await initializeTrellisStorageSchema(storage);

      const currentRows = await storage.db.select().from(contracts).where(
        eq(contracts.digest, currentDigest),
      );
      const legacyRows = await storage.db.select().from(contracts).where(
        eq(contracts.digest, "legacy-digest"),
      );
      const [instance] = await storage.db.select().from(serviceInstances).where(
        eq(serviceInstances.instanceId, "billing.instance"),
      );
      const [marker] = await storage.db.select().from(trellisUpgrades).where(
        eq(trellisUpgrades.upgradeId, CONTRACT_DIGEST_REINDEX_UPGRADE_ID),
      );

      assertEquals(currentRows.length, 1);
      assertEquals(currentRows[0].analysisSummary === null, false);
      assertEquals(currentRows[0].analysis === null, false);
      assertEquals(legacyRows.length, 0);
      assertEquals(instance?.instanceId, "billing.instance");
      assertMatch(marker?.appliedAt ?? "", /^\d{4}-\d{2}-\d{2}T/);
      assertEquals(JSON.parse(marker?.summary ?? "{}"), {
        scanned: 1,
        skipped: 0,
        unchanged: 0,
        reindexed: 1,
      });
    },
  );
});

Deno.test("materialized authority grouped grants upgrade rewrites flat grants pending", async () => {
  await withMigratedStorage(
    "trellis-storage-upgrade-flat-grants-",
    async (storage) => {
      await insertMaterializedAuthorityRow(storage, {
        deploymentId: "svc-a",
        grantsJson: JSON.stringify([
          { kind: "capability", capability: "svc.use" },
          {
            kind: "surface",
            contractId: "svc.contract@v1",
            surfaceKind: "rpc",
            name: "Svc.Query",
            action: "call",
          },
          {
            kind: "nats",
            direction: "subscribe",
            subject: "rpc.v1.Svc.Query",
            requiredCapabilities: ["svc.use"],
            grantSource: "used-surface",
          },
        ]),
      });

      await runTrellisStorageUpgrades(storage.db);

      const [row] = await storage.db.select().from(materializedAuthority).where(
        eq(materializedAuthority.deploymentId, "svc-a"),
      );
      const [marker] = await storage.db.select().from(trellisUpgrades).where(
        eq(
          trellisUpgrades.upgradeId,
          MATERIALIZED_AUTHORITY_GROUPED_GRANTS_UPGRADE_ID,
        ),
      );

      assertEquals(row?.status, "pending");
      assertMatch(row?.error ?? "", /repaired from a legacy projection/);
      assertEquals(JSON.parse(row?.grantsJson ?? "{}"), {
        capabilities: [{ capability: "svc.use" }],
        surfaces: [{
          contractId: "svc.contract@v1",
          surfaceKind: "rpc",
          name: "Svc.Query",
          action: "call",
        }],
        nats: [{
          direction: "subscribe",
          subject: "rpc.v1.Svc.Query",
          requiredCapabilities: ["svc.use"],
          grantSource: "used-surface",
        }],
      });
      assertEquals(JSON.parse(marker?.summary ?? "{}"), {
        scanned: 1,
        unchanged: 0,
        rewritten: 1,
        markedPending: 1,
        droppedResourceGrants: 0,
        droppedUnknownGrants: 0,
        invalidJson: 0,
      });
    },
  );
});

Deno.test("materialized authority grouped grants upgrade marks empty legacy flat grants pending", async () => {
  await withMigratedStorage(
    "trellis-storage-upgrade-empty-flat-grants-",
    async (storage) => {
      await insertMaterializedAuthorityRow(storage, {
        deploymentId: "svc-a",
        grantsJson: JSON.stringify([]),
      });

      await runTrellisStorageUpgrades(storage.db);

      const [row] = await storage.db.select().from(materializedAuthority).where(
        eq(materializedAuthority.deploymentId, "svc-a"),
      );
      const [marker] = await storage.db.select().from(trellisUpgrades).where(
        eq(
          trellisUpgrades.upgradeId,
          MATERIALIZED_AUTHORITY_GROUPED_GRANTS_UPGRADE_ID,
        ),
      );

      assertEquals(row?.status, "pending");
      assertMatch(row?.error ?? "", /repaired from a legacy projection/);
      assertEquals(JSON.parse(row?.grantsJson ?? "{}"), emptyGroupedGrants());
      assertEquals(JSON.parse(marker?.summary ?? "{}"), {
        scanned: 1,
        unchanged: 0,
        rewritten: 1,
        markedPending: 1,
        droppedResourceGrants: 0,
        droppedUnknownGrants: 0,
        invalidJson: 0,
      });
    },
  );
});

Deno.test("materialized authority grouped grants upgrade drops resource grants and marks pending", async () => {
  await withMigratedStorage(
    "trellis-storage-upgrade-resource-grants-",
    async (storage) => {
      await insertMaterializedAuthorityRow(storage, {
        deploymentId: "svc-a",
        grantsJson: JSON.stringify([
          { kind: "capability", capability: "svc.use" },
          { kind: "resource", resourceKind: "kv", alias: "cache" },
          { kind: "future", value: true },
        ]),
      });

      await runTrellisStorageUpgrades(storage.db);

      const [row] = await storage.db.select().from(materializedAuthority).where(
        eq(materializedAuthority.deploymentId, "svc-a"),
      );
      const [marker] = await storage.db.select().from(trellisUpgrades).where(
        eq(
          trellisUpgrades.upgradeId,
          MATERIALIZED_AUTHORITY_GROUPED_GRANTS_UPGRADE_ID,
        ),
      );

      assertEquals(row?.status, "pending");
      assertMatch(row?.error ?? "", /repaired from a legacy projection/);
      assertEquals(JSON.parse(row?.grantsJson ?? "{}"), {
        ...emptyGroupedGrants(),
        capabilities: [{ capability: "svc.use" }],
      });
      assertEquals(JSON.parse(marker?.summary ?? "{}"), {
        scanned: 1,
        unchanged: 0,
        rewritten: 1,
        markedPending: 1,
        droppedResourceGrants: 1,
        droppedUnknownGrants: 1,
        invalidJson: 0,
      });
    },
  );
});

Deno.test("materialized authority grouped grants upgrade repairs invalid JSON to pending empty grants", async () => {
  await withMigratedStorage(
    "trellis-storage-upgrade-invalid-grants-",
    async (storage) => {
      await insertMaterializedAuthorityRow(storage, {
        deploymentId: "svc-a",
        grantsJson: "not-json",
      });

      await runTrellisStorageUpgrades(storage.db);

      const [row] = await storage.db.select().from(materializedAuthority).where(
        eq(materializedAuthority.deploymentId, "svc-a"),
      );
      const [marker] = await storage.db.select().from(trellisUpgrades).where(
        eq(
          trellisUpgrades.upgradeId,
          MATERIALIZED_AUTHORITY_GROUPED_GRANTS_UPGRADE_ID,
        ),
      );

      assertEquals(row?.status, "pending");
      assertMatch(row?.error ?? "", /invalid JSON/);
      assertEquals(JSON.parse(row?.grantsJson ?? "{}"), emptyGroupedGrants());
      assertEquals(JSON.parse(marker?.summary ?? "{}"), {
        scanned: 1,
        unchanged: 0,
        rewritten: 1,
        markedPending: 1,
        droppedResourceGrants: 0,
        droppedUnknownGrants: 0,
        invalidJson: 1,
      });
    },
  );
});

Deno.test("materialized authority grouped grants upgrade leaves grouped grants unchanged", async () => {
  await withMigratedStorage(
    "trellis-storage-upgrade-grouped-grants-",
    async (storage) => {
      const grouped = {
        ...emptyGroupedGrants(),
        capabilities: [{ capability: "svc.use" }],
      };
      await insertMaterializedAuthorityRow(storage, {
        deploymentId: "svc-a",
        grantsJson: JSON.stringify(grouped),
      });

      await runTrellisStorageUpgrades(storage.db);

      const [row] = await storage.db.select().from(materializedAuthority).where(
        eq(materializedAuthority.deploymentId, "svc-a"),
      );
      const [marker] = await storage.db.select().from(trellisUpgrades).where(
        eq(
          trellisUpgrades.upgradeId,
          MATERIALIZED_AUTHORITY_GROUPED_GRANTS_UPGRADE_ID,
        ),
      );

      assertEquals(JSON.parse(row?.grantsJson ?? "{}"), grouped);
      assertEquals(JSON.parse(marker?.summary ?? "{}"), {
        scanned: 1,
        unchanged: 1,
        rewritten: 0,
        markedPending: 0,
        droppedResourceGrants: 0,
        droppedUnknownGrants: 0,
        invalidJson: 0,
      });
    },
  );
});

Deno.test("materialized authority grouped grants upgrade removes obsolete grouped child kind", async () => {
  await withMigratedStorage(
    "trellis-storage-upgrade-grouped-child-kind-",
    async (storage) => {
      await insertMaterializedAuthorityRow(storage, {
        deploymentId: "svc-a",
        grantsJson: JSON.stringify({
          capabilities: [{ kind: "capability", capability: "svc.use" }],
          surfaces: [{
            kind: "surface",
            contractId: "svc.contract@v1",
            surfaceKind: "rpc",
            name: "Svc.Query",
            action: "call",
          }],
          nats: [{
            kind: "nats",
            direction: "subscribe",
            subject: "rpc.v1.Svc.Query",
            requiredCapabilities: ["svc.use"],
            grantSource: "used-surface",
          }],
        }),
      });

      await runTrellisStorageUpgrades(storage.db);

      const [row] = await storage.db.select().from(materializedAuthority).where(
        eq(materializedAuthority.deploymentId, "svc-a"),
      );
      const [marker] = await storage.db.select().from(trellisUpgrades).where(
        eq(
          trellisUpgrades.upgradeId,
          MATERIALIZED_AUTHORITY_GROUPED_GRANTS_UPGRADE_ID,
        ),
      );

      assertEquals(row?.status, "current");
      assertEquals(row?.error, null);
      assertEquals(JSON.parse(row?.grantsJson ?? "{}"), {
        capabilities: [{ capability: "svc.use" }],
        surfaces: [{
          contractId: "svc.contract@v1",
          surfaceKind: "rpc",
          name: "Svc.Query",
          action: "call",
        }],
        nats: [{
          direction: "subscribe",
          subject: "rpc.v1.Svc.Query",
          requiredCapabilities: ["svc.use"],
          grantSource: "used-surface",
        }],
      });
      assertEquals(JSON.parse(marker?.summary ?? "{}"), {
        scanned: 1,
        unchanged: 0,
        rewritten: 1,
        markedPending: 0,
        droppedResourceGrants: 0,
        droppedUnknownGrants: 0,
        invalidJson: 0,
      });
    },
  );
});

Deno.test("deployment authority grouped needs upgrade rewrites flat requested needs and previews", async () => {
  await withMigratedStorage(
    "trellis-storage-upgrade-flat-needs-",
    async (storage) => {
      const legacyRequestedNeeds = [{
        kind: "contract",
        contractId: "svc.contract@v1",
        required: true,
      }, {
        kind: "surface",
        surface: {
          contractId: "svc.contract@v1",
          kind: "rpc",
          name: "Svc.Query",
          action: "call",
        },
        required: true,
      }, {
        kind: "capability",
        capability: "svc.use",
        required: true,
      }, {
        kind: "resource",
        resource: { kind: "kv", alias: "cache", required: false },
        required: false,
      }];
      await insertAuthorityPlanRow(storage, {
        planId: "plan-a",
        proposalJson: JSON.stringify({
          deploymentId: "svc-a",
          contractId: "svc.contract@v1",
          contractDigest: "sha256-a",
          requestedNeeds: legacyRequestedNeeds,
          providedSurfaces: [],
        }),
        desiredChangeJson: JSON.stringify({
          contracts: [],
          surfaces: [],
          capabilities: ["svc.use"],
          resources: [],
        }),
        materializationPreviewJson: JSON.stringify({
          requestedNeeds: legacyRequestedNeeds,
          desiredState: {
            needs: {
              contracts: [],
              surfaces: [],
              capabilities: ["svc.use"],
              resources: [],
            },
          },
          metadata: { capabilities: ["not-a-need-set"] },
          audit: {
            contracts: [],
            surfaces: [],
            capabilities: ["metadata-only"],
            resources: [],
          },
        }),
      });

      await runTrellisStorageUpgrades(storage.db);

      const [row] = await storage.db.select().from(deploymentAuthorityPlans)
        .where(eq(deploymentAuthorityPlans.planId, "plan-a"));
      const [marker] = await storage.db.select().from(trellisUpgrades).where(
        eq(
          trellisUpgrades.upgradeId,
          DEPLOYMENT_AUTHORITY_GROUPED_NEEDS_UPGRADE_ID,
        ),
      );
      const proposal = JSON.parse(row?.proposalJson ?? "{}");
      const desiredChange = JSON.parse(row?.desiredChangeJson ?? "{}");
      const preview = JSON.parse(row?.materializationPreviewJson ?? "{}");
      const expectedNeeds = {
        contracts: [{ contractId: "svc.contract@v1", required: true }],
        surfaces: [{
          contractId: "svc.contract@v1",
          kind: "rpc",
          name: "Svc.Query",
          action: "call",
          required: true,
        }],
        capabilities: [{ capability: "svc.use", required: true }],
        resources: [{ kind: "kv", alias: "cache", required: false }],
      };

      assertEquals(proposal.requestedNeeds, expectedNeeds);
      assertEquals(desiredChange, {
        ...emptyGroupedNeeds(),
        capabilities: [{ capability: "svc.use", required: true }],
      });
      assertEquals(preview.requestedNeeds, expectedNeeds);
      assertEquals(preview.desiredState.needs, {
        ...emptyGroupedNeeds(),
        capabilities: [{ capability: "svc.use", required: true }],
      });
      assertEquals(preview.metadata, { capabilities: ["not-a-need-set"] });
      assertEquals(preview.audit, {
        contracts: [],
        surfaces: [],
        capabilities: ["metadata-only"],
        resources: [],
      });
      assertEquals(JSON.parse(marker?.summary ?? "{}"), {
        scanned: 1,
        unchanged: 0,
        rewritten: 1,
        invalidJson: 0,
        skippedInvalidJson: 0,
      });
    },
  );
});

Deno.test("deployment authority grouped needs upgrade skips invalid plan JSON", async () => {
  await withMigratedStorage(
    "trellis-storage-upgrade-invalid-plan-",
    async (storage) => {
      await insertAuthorityPlanRow(storage, {
        planId: "plan-a",
        proposalJson: "not-json",
      });

      await runTrellisStorageUpgrades(storage.db);

      const [row] = await storage.db.select().from(deploymentAuthorityPlans)
        .where(eq(deploymentAuthorityPlans.planId, "plan-a"));
      const [marker] = await storage.db.select().from(trellisUpgrades).where(
        eq(
          trellisUpgrades.upgradeId,
          DEPLOYMENT_AUTHORITY_GROUPED_NEEDS_UPGRADE_ID,
        ),
      );

      assertEquals(row?.proposalJson, "not-json");
      assertEquals(JSON.parse(marker?.summary ?? "{}"), {
        scanned: 1,
        unchanged: 0,
        rewritten: 0,
        invalidJson: 1,
        skippedInvalidJson: 1,
      });
    },
  );
});

Deno.test("initialize storage schema upgrades old flat grants before repository get", async () => {
  await withMigratedStorage(
    "trellis-storage-upgrade-repository-grants-",
    async (storage) => {
      await insertMaterializedAuthorityRow(storage, {
        deploymentId: "svc-a",
        grantsJson: JSON.stringify([
          { kind: "capability", capability: "svc.use" },
        ]),
      });

      await initializeTrellisStorageSchema(storage);

      const repository = new SqlMaterializedAuthorityRepository(storage.db);
      const materialized = await repository.get("svc-a");

      assertEquals(materialized?.grants, {
        ...emptyGroupedGrants(),
        capabilities: [{ capability: "svc.use" }],
      });
    },
  );
});

Deno.test("contract digest reindex upgrade marker prevents rerun", async () => {
  await withMigratedStorage(
    "trellis-storage-upgrade-marker-",
    async (storage) => {
      const first = testContract("first@v1", "rpc.v1.First.Query");
      await storage.db.insert(contracts).values({
        digest: "first-legacy-digest",
        contractId: first.id,
        displayName: first.displayName,
        description: first.description,
        installedAt: "2026-01-01T00:00:00.000Z",
        contract: JSON.stringify(first),
        resources: null,
        analysisSummary: null,
        analysis: null,
      });
      await runTrellisStorageUpgrades(storage.db);

      const second = testContract("second@v1", "rpc.v1.Second.Query");
      await storage.db.insert(contracts).values({
        digest: "second-legacy-digest",
        contractId: second.id,
        displayName: second.displayName,
        description: second.description,
        installedAt: "2026-01-01T00:00:00.000Z",
        contract: JSON.stringify(second),
        resources: null,
        analysisSummary: null,
        analysis: null,
      });

      await runTrellisStorageUpgrades(storage.db);

      const rows = await storage.db.select().from(contracts).where(
        eq(contracts.digest, "second-legacy-digest"),
      );
      assertEquals(rows.length, 1);
    },
  );
});

Deno.test("contract digest reindex upgrade skips invalid stored rows without deleting", async () => {
  await withMigratedStorage(
    "trellis-storage-upgrade-invalid-",
    async (storage) => {
      await storage.db.insert(contracts).values({
        digest: "invalid-digest",
        contractId: "invalid@v1",
        displayName: "Invalid",
        description: "Invalid test contract",
        installedAt: "2026-01-01T00:00:00.000Z",
        contract: "not-json",
        resources: null,
        analysisSummary: null,
        analysis: null,
      });

      await runTrellisStorageUpgrades(storage.db);

      const rows = await storage.db.select().from(contracts).where(
        eq(contracts.digest, "invalid-digest"),
      );
      const [marker] = await storage.db.select().from(trellisUpgrades).where(
        eq(trellisUpgrades.upgradeId, CONTRACT_DIGEST_REINDEX_UPGRADE_ID),
      );
      assertEquals(rows.length, 1);
      assertEquals(rows[0].contract, "not-json");
      assertEquals(JSON.parse(marker?.summary ?? "{}"), {
        scanned: 1,
        skipped: 1,
        unchanged: 0,
        reindexed: 0,
      });
    },
  );
});

Deno.test("service session contract fields upgrade deletes legacy session rows", async () => {
  await withMigratedStorage(
    "trellis-storage-upgrade-service-session-",
    async (storage) => {
      const createdAt = "2026-01-01T00:00:00.000Z";
      const lastAuth = "2026-01-01T00:05:00.000Z";
      await storage.db.insert(sessions).values({
        sessionKey: "service-session-key",
        trellisId: "service.trellis",
        type: "service",
        origin: "service",
        externalId: "service.trellis",
        identityGrantId: null,
        contractDigest: "legacy_digest",
        contractId: "legacy.contract@v1",
        participantKind: null,
        instanceId: "service.instance",
        deploymentId: "service.deployment",
        instanceKey: "service-key",
        publicIdentityKey: null,
        createdAt,
        lastAuth,
        revokedAt: null,
        session: JSON.stringify({
          type: "service",
          trellisId: "service.trellis",
          origin: "service",
          id: "service.trellis",
          email: "service@example.test",
          name: "Service",
          createdAt,
          lastAuth,
          instanceId: "service.instance",
          deploymentId: "service.deployment",
          instanceKey: "service-key",
          currentContractId: "legacy.contract@v1",
          currentContractDigest: "legacy_digest",
        }),
      });
      await storage.db.insert(sessions).values({
        sessionKey: "current-service-session-key",
        trellisId: "current.service.trellis",
        type: "service",
        origin: "service",
        externalId: "current.service.trellis",
        identityGrantId: null,
        contractDigest: "current_digest",
        contractId: "current.contract@v1",
        participantKind: null,
        instanceId: "current.service.instance",
        deploymentId: "current.service.deployment",
        instanceKey: "current-service-key",
        publicIdentityKey: null,
        createdAt,
        lastAuth,
        revokedAt: null,
        session: JSON.stringify({
          type: "service",
          trellisId: "current.service.trellis",
          origin: "service",
          id: "current.service.trellis",
          email: "current-service@example.test",
          name: "Current Service",
          createdAt,
          lastAuth,
          instanceId: "current.service.instance",
          deploymentId: "current.service.deployment",
          instanceKey: "current-service-key",
          contractId: "current.contract@v1",
          contractDigest: "current_digest",
        }),
      });

      await initializeTrellisStorageSchema(storage);

      const repository = new SqlSessionRepository(storage.db);
      const legacySession = await repository.getOneBySessionKey(
        "service-session-key",
      );
      const currentSession = await repository.getOneBySessionKey(
        "current-service-session-key",
      );
      const legacyRows = await storage.db.select().from(sessions).where(
        eq(sessions.sessionKey, "service-session-key"),
      );
      const [marker] = await storage.db.select().from(trellisUpgrades).where(
        eq(
          trellisUpgrades.upgradeId,
          SERVICE_SESSION_CONTRACT_FIELDS_UPGRADE_ID,
        ),
      );

      assertEquals(legacySession, undefined);
      assertEquals(legacyRows.length, 0);
      assertEquals(currentSession?.type, "service");
      if (currentSession?.type !== "service") {
        throw new Error("expected decoded service session");
      }
      assertEquals(currentSession.contractId, "current.contract@v1");
      assertEquals(currentSession.contractDigest, "current_digest");
      assertInstanceOf(currentSession.createdAt, Date);
      assertInstanceOf(currentSession.lastAuth, Date);

      assertMatch(marker?.appliedAt ?? "", /^\d{4}-\d{2}-\d{2}T/);
      assertEquals(JSON.parse(marker?.summary ?? "{}"), {
        scanned: 2,
        deletedInvalidJson: 0,
        deletedNonObject: 0,
        deletedLegacy: 1,
        deletedInvalidShape: 0,
        unchanged: 1,
      });
    },
  );
});
