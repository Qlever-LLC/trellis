import { assertEquals, assertRejects } from "@std/assert";
import type { BaseError, Result } from "@qlever-llc/result";
import { Type } from "typebox";

import { trellisIdFromOriginId } from "@qlever-llc/trellis/auth";
import { AuthError, ValidationError } from "@qlever-llc/trellis";

import { createStateHandlers } from "./rpc.ts";
import { StateStore } from "./storage.ts";
import {
  FakeSessionKV,
  FakeStateKV,
  makeDeviceSession,
  makeUserSession,
} from "./test_helpers.ts";

function unwrapOk<T, E extends BaseError>(value: Result<T, E>): T {
  if (value.isErr()) throw value.error;
  return value.unwrapOrElse((error) => {
    throw error;
  });
}

function createContractStore() {
  return {
    getContract(digest: string) {
      if (digest === "acme.notes@v1-digest") {
        return {
          id: "acme.notes@v1",
          displayName: "Notes",
          description: "Test notes app",
          format: "trellis.contract.v1",
          kind: "app",
          schemas: {
            Preferences: Type.Object({ theme: Type.String() }),
            Draft: Type.Object({ text: Type.String() }),
          },
          state: {
            preferences: { kind: "value", schema: { schema: "Preferences" } },
            drafts: { kind: "map", schema: { schema: "Draft" } },
          },
        } as const;
      }

      if (digest === "acme.tasks@v1-digest") {
        return {
          id: "acme.tasks@v1",
          displayName: "Tasks",
          description: "Test tasks app",
          format: "trellis.contract.v1",
          kind: "app",
          schemas: {
            Draft: Type.Object({ text: Type.String() }),
          },
          state: {
            drafts: { kind: "map", schema: { schema: "Draft" } },
          },
        } as const;
      }

      if (digest === "acme.reader@v1-digest") {
        return {
          id: "acme.reader@v1",
          displayName: "Reader",
          description: "Test reader app",
          format: "trellis.contract.v1",
          kind: "device",
          schemas: {
            Preferences: Type.Object({ page: Type.Number() }),
            CacheEntry: Type.Object({ ok: Type.Boolean() }),
          },
          state: {
            preferences: { kind: "value", schema: { schema: "Preferences" } },
            cache: { kind: "map", schema: { schema: "CacheEntry" } },
          },
        } as const;
      }

      return undefined;
    },
  };
}

Deno.test("State RPC isolates named store state by contract id without caller scope", async () => {
  const sessionKV = new FakeSessionKV();
  const state = new StateStore({ kv: new FakeStateKV(), now: () => new Date("2026-01-01T00:00:00.000Z") });
  const handlers = createStateHandlers({ sessionKV, state, contractStore: createContractStore() });

  sessionKV.seed("session-one.user-1", makeUserSession({ trellisId: "user-1", contractId: "acme.notes@v1" }));
  sessionKV.seed("session-two.user-1", makeUserSession({ trellisId: "user-1", contractId: "acme.tasks@v1" }));

  await handlers.put(
    { store: "drafts", key: "draft", value: { text: "hello" } },
    { caller: { type: "user", origin: "github", id: "123" }, sessionKey: "session-one" },
  );

  const own = unwrapOk(await handlers.get(
    { store: "drafts", key: "draft" },
    { caller: { type: "user", origin: "github", id: "123" }, sessionKey: "session-one" },
  ));
  assertEquals(own.found, true);

  const other = unwrapOk(await handlers.get(
    { store: "drafts", key: "draft" },
    { caller: { type: "user", origin: "github", id: "123" }, sessionKey: "session-two" },
  ));
  assertEquals(other, { found: false });
});

Deno.test("State RPC derives store metadata and enforces value versus map key semantics", async () => {
  const sessionKV = new FakeSessionKV();
  const state = new StateStore({ kv: new FakeStateKV(), now: () => new Date("2026-01-01T00:00:00.000Z") });
  const handlers = createStateHandlers({ sessionKV, state, contractStore: createContractStore() });

  sessionKV.seed("user-session.user-1", makeUserSession({ trellisId: "user-1", contractId: "acme.notes@v1" }));

  const created = unwrapOk(await handlers.put(
    { store: "preferences", expectedRevision: null, value: { theme: "light" } },
    { caller: { type: "user", origin: "github", id: "123" }, sessionKey: "user-session" },
  ));
  assertEquals(created.applied, true);
  if (!created.entry) throw new Error("expected created entry");
  assertEquals(created.entry.key, undefined);

  const duplicate = unwrapOk(await handlers.put(
    { store: "preferences", expectedRevision: null, value: { theme: "dark" } },
    { caller: { type: "user", origin: "github", id: "123" }, sessionKey: "user-session" },
  ));
  assertEquals(duplicate.applied, false);

  await assertRejects(
    async () => {
      unwrapOk(await handlers.get(
        { store: "preferences", key: "unexpected" },
        { caller: { type: "user", origin: "github", id: "123" }, sessionKey: "user-session" },
      ));
    },
    ValidationError,
  );

  await assertRejects(
    async () => {
      unwrapOk(await handlers.get(
        { store: "drafts" },
        { caller: { type: "user", origin: "github", id: "123" }, sessionKey: "user-session" },
      ));
    },
    ValidationError,
  );

  await assertRejects(
    async () => {
      unwrapOk(await handlers.put(
        { store: "preferences", value: { theme: 123 } },
        { caller: { type: "user", origin: "github", id: "123" }, sessionKey: "user-session" },
      ));
    },
    ValidationError,
  );
});

Deno.test("State RPC derives normal caller ownership from the session", async () => {
  const sessionKV = new FakeSessionKV();
  const state = new StateStore({ kv: new FakeStateKV(), now: () => new Date("2026-01-01T00:00:00.000Z") });
  const handlers = createStateHandlers({ sessionKV, state, contractStore: createContractStore() });

  sessionKV.seed("device-session.device-1", makeDeviceSession({ deviceId: "device-1", contractId: "acme.reader@v1" }));
  sessionKV.seed("user-session.user-1", makeUserSession({ trellisId: "user-1", contractId: "acme.reader@v1" }));

  const written = unwrapOk(await handlers.put(
    { store: "preferences", value: { page: 1 } },
    { caller: { type: "device", id: "device-1" }, sessionKey: "device-session" },
  ));
  assertEquals(written.applied, true);

  const otherOwner = unwrapOk(await handlers.get(
    { store: "preferences" },
    { caller: { type: "user", origin: "github", id: "123" }, sessionKey: "user-session" },
  ));
  assertEquals(otherOwner, { found: false });
});

Deno.test("State admin RPCs inspect and delete named stores", async () => {
  const sessionKV = new FakeSessionKV();
  const state = new StateStore({ kv: new FakeStateKV(), now: () => new Date("2026-01-01T00:00:00.000Z") });
  const handlers = createStateHandlers({ sessionKV, state, contractStore: createContractStore() });
  const trellisId = await trellisIdFromOriginId("github", "123");

  sessionKV.seed("session-one.user-1", makeUserSession({ trellisId, contractId: "acme.notes@v1" }));

  const put = unwrapOk(await handlers.put(
    { store: "drafts", key: "draft", value: { text: "hello" } },
    { caller: { type: "user", origin: "github", id: "123" }, sessionKey: "session-one" },
  ));
  if (!put.entry) throw new Error("expected put entry");

  const adminCaller = { caller: { type: "user", capabilities: ["admin"] } };
  const target = {
    scope: "userApp" as const,
    contractId: "acme.notes@v1",
    contractDigest: "acme.notes@v1-digest",
    store: "drafts",
    user: { origin: "github", id: "123" },
  };

  const got = unwrapOk(await handlers.adminGet({ ...target, key: "draft" }, adminCaller));
  assertEquals(got.found, true);

  const listed = unwrapOk(await handlers.adminList({ ...target, offset: 0, limit: 10 }, adminCaller));
  assertEquals(listed.entries.map((entry) => entry.key), ["draft"]);

  const deleted = unwrapOk(await handlers.adminDelete(
    { ...target, key: "draft", expectedRevision: put.entry.revision },
    adminCaller,
  ));
  assertEquals(deleted, { deleted: true });

  const missing = unwrapOk(await handlers.adminGet({ ...target, key: "draft" }, adminCaller));
  assertEquals(missing, { found: false });

  await assertRejects(
    () => handlers.adminGet({ ...target, store: "missing", key: "draft" }, adminCaller),
    ValidationError,
  );

  await assertRejects(
    () => handlers.adminGet({ ...target, key: "draft" }, { caller: { type: "user" } }),
    AuthError,
  );

  await assertRejects(
    () => handlers.adminGet(
      {
        ...target,
        contractId: "acme.tasks@v1",
      },
      adminCaller,
    ),
    ValidationError,
  );
});
