import { assert, assertEquals, assertInstanceOf } from "@std/assert";
import { ValidationError } from "@qlever-llc/trellis";
import { isErr } from "@qlever-llc/result";

import {
  initializeTrellisStorageSchema,
  openTrellisStorageDb,
  type TrellisStorage,
} from "../../storage/db.ts";
import { SqlLoginPortalRepository } from "../storage.ts";
import {
  createAuthPortalsGetHandler,
  createAuthPortalsListHandler,
  createAuthPortalsRoutesPutHandler,
  createAuthPortalsRoutesRemoveHandler,
} from "./portals_rpc.ts";

const adminCaller = {
  type: "user" as const,
  participantKind: "app" as const,
  userId: "admin",
  identity: {
    identityId: "idn_admin",
    provider: "github",
    subject: "admin",
  },
  active: true,
  name: "Admin",
  email: "admin@example.com",
  capabilities: ["admin"],
  lastAuth: new Date().toISOString(),
};

async function withLoginPortals(
  test: (repo: SqlLoginPortalRepository) => Promise<void>,
): Promise<void> {
  const dbPath = await Deno.makeTempFile({
    dir: "/tmp",
    prefix: "trellis-portals-rpc-",
    suffix: ".sqlite",
  });
  const storage: TrellisStorage = await openTrellisStorageDb(dbPath);
  try {
    await initializeTrellisStorageSchema(storage);
    await test(new SqlLoginPortalRepository(storage.db));
  } finally {
    storage.client.close();
    await Deno.remove(dbPath).catch(() => undefined);
  }
}

Deno.test("portal route RPCs are scoped by portal and selector", async () => {
  await withLoginPortals(async (repo) => {
    const timestamp = "2026-01-01T00:00:00.000Z";
    await repo.putPortal({
      portalId: "portal.main",
      displayName: "Main Portal",
      entryUrl: "https://login.example.com",
      builtIn: false,
      disabled: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await repo.putPortal({
      portalId: "portal.alt",
      displayName: "Alt Portal",
      entryUrl: "https://alt.example.com",
      builtIn: false,
      disabled: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    const put = createAuthPortalsRoutesPutHandler(repo);
    const first = await put({
      input: {
        portalId: "portal.main",
        contractId: "app.example@v1",
        origin: "https://app.example.com",
      },
      context: { caller: adminCaller },
    });
    assert(!first.isErr());
    const firstValue = first.take();
    if (isErr(firstValue)) throw firstValue.error;
    assertEquals(
      firstValue.route.routeKey,
      "app.example@v1:https://app.example.com",
    );

    const conflict = await put({
      input: {
        portalId: "portal.alt",
        contractId: "app.example@v1",
        origin: "https://app.example.com",
      },
      context: { caller: adminCaller },
    });
    assert(conflict.isErr());
    assertInstanceOf(conflict.error, ValidationError);

    const list = await createAuthPortalsListHandler(repo)({
      input: { limit: 10 },
      context: { caller: adminCaller },
    });
    assert(!list.isErr());
    const listValue = list.take();
    if (isErr(listValue)) throw listValue.error;
    assertEquals(
      listValue.entries.find((portal) => portal.portalId === "portal.main")
        ?.routeCount,
      1,
    );
    assertEquals(
      listValue.entries.find((portal) => portal.portalId === "portal.main")
        ?.activeRouteCount,
      1,
    );

    const detail = await createAuthPortalsGetHandler(repo)({
      input: { portalId: "portal.main" },
      context: { caller: adminCaller },
    });
    assert(!detail.isErr());
    const detailValue = detail.take();
    if (isErr(detailValue)) throw detailValue.error;
    assertEquals(detailValue.routes.length, 1);

    const remove = await createAuthPortalsRoutesRemoveHandler(repo)({
      input: {
        portalId: "portal.main",
        contractId: "app.example@v1",
        origin: "https://app.example.com",
      },
      context: { caller: adminCaller },
    });
    assert(!remove.isErr());
    const removeValue = remove.take();
    if (isErr(removeValue)) throw removeValue.error;
    assertEquals(removeValue.success, true);
    assertEquals(await repo.listRoutesByPortal("portal.main"), []);
  });
});

Deno.test("portal route RPC can reclaim disabled selectors for a new portal", async () => {
  await withLoginPortals(async (repo) => {
    const timestamp = "2026-01-01T00:00:00.000Z";
    await repo.putPortal({
      portalId: "portal.main",
      displayName: "Main Portal",
      entryUrl: "https://login.example.com",
      builtIn: false,
      disabled: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await repo.putPortal({
      portalId: "portal.old",
      displayName: "Old Portal",
      entryUrl: "https://old.example.com",
      builtIn: false,
      disabled: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    const put = createAuthPortalsRoutesPutHandler(repo);
    const disabled = await put({
      input: { portalId: "portal.old", disabled: true },
      context: { caller: adminCaller },
    });
    assert(!disabled.isErr());

    const reclaimed = await put({
      input: { portalId: "portal.main" },
      context: { caller: adminCaller },
    });
    assert(!reclaimed.isErr());
    const reclaimedValue = reclaimed.take();
    if (isErr(reclaimedValue)) throw reclaimedValue.error;
    assertEquals(reclaimedValue.route, {
      routeKey: "any-contract:any-origin",
      portalId: "portal.main",
      contractId: null,
      origin: null,
      disabled: false,
      updatedAt: reclaimedValue.route.updatedAt,
    });
    assertEquals(await repo.listRoutesByPortal("portal.old"), []);
    assertEquals((await repo.listRoutesByPortal("portal.main")).length, 1);
  });
});
