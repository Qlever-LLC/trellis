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
import {
  contracts,
  serviceInstances,
  sessions,
  trellisUpgrades,
} from "./schema.ts";
import {
  CONTRACT_DIGEST_REINDEX_UPGRADE_ID,
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
