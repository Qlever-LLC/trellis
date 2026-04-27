import { assertEquals } from "@std/assert";
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

function unwrapErr<T, E extends BaseError>(value: Result<T, E>): E {
  if (!value.isErr()) throw new Error("expected Result.err");
  return value.error;
}

function assertFound(value: { found: boolean } | { migrationRequired: true }) {
  if ("migrationRequired" in value || !value.found) {
    throw new Error("expected found state entry");
  }
}

function assertStateEntry(entry: unknown): asserts entry is {
  key?: string;
  value: unknown;
  revision: string;
  updatedAt: string;
  expiresAt?: string;
} {
  if (
    entry === null || typeof entry !== "object" ||
    "migrationRequired" in entry
  ) {
    throw new Error("expected state entry");
  }
}

function listedKey(
  entry:
    | { key?: string }
    | { migrationRequired: true; entry: { key?: string } },
): string | undefined {
  return "migrationRequired" in entry ? entry.entry.key : entry.key;
}

function isMigrationRequired(value: unknown): value is {
  migrationRequired: true;
  entry: unknown;
  stateVersion: string;
  currentStateVersion: string;
  writerContractDigest: string;
} {
  return value !== null && typeof value === "object" &&
    "migrationRequired" in value && value.migrationRequired === true;
}

function createContractStore() {
  return {
    getContract(digest: string) {
      if (digest === "acme.notes@v0-digest") {
        return {
          id: "acme.notes@v1",
          displayName: "Notes",
          description: "Test notes app",
          format: "trellis.contract.v1",
          kind: "app",
          schemas: {
            DraftV0: Type.Object({ title: Type.String() }),
          },
          state: {
            drafts: {
              kind: "map",
              schema: { schema: "DraftV0" },
              stateVersion: "draft.v0",
            },
          },
        } as const;
      }

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
            DraftV0: Type.Object({ title: Type.String() }),
          },
          state: {
            preferences: {
              kind: "value",
              schema: { schema: "Preferences" },
              stateVersion: "prefs.v1",
            },
            drafts: {
              kind: "map",
              schema: { schema: "Draft" },
              stateVersion: "draft.v1",
              acceptedVersions: { "draft.v0": { schema: "DraftV0" } },
            },
          },
        } as const;
      }

      if (digest === "acme.notes@v2-digest") {
        return {
          id: "acme.notes@v1",
          displayName: "Notes",
          description: "Test notes app",
          format: "trellis.contract.v1",
          kind: "app",
          schemas: {
            Draft: Type.Object({ text: Type.String() }),
          },
          state: {
            drafts: {
              kind: "map",
              schema: { schema: "Draft" },
              stateVersion: "draft.v1",
            },
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
            drafts: {
              kind: "map",
              schema: { schema: "Draft" },
              stateVersion: "draft.v1",
            },
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
            preferences: {
              kind: "value",
              schema: { schema: "Preferences" },
              stateVersion: "prefs.v1",
            },
            cache: {
              kind: "map",
              schema: { schema: "CacheEntry" },
              stateVersion: "cache.v1",
            },
          },
        } as const;
      }

      return undefined;
    },
  };
}

Deno.test("State RPC isolates named store state by contract id without caller scope", async () => {
  const sessionKV = new FakeSessionKV();
  const state = new StateStore({
    kv: new FakeStateKV(),
    now: () => new Date("2026-01-01T00:00:00.000Z"),
  });
  const handlers = createStateHandlers({
    sessionStorage: sessionKV,
    state,
    contractStore: createContractStore(),
  });

  sessionKV.seed(
    "session-one",
    makeUserSession({ trellisId: "user-1", contractId: "acme.notes@v1" }),
  );
  sessionKV.seed(
    "session-two",
    makeUserSession({ trellisId: "user-1", contractId: "acme.tasks@v1" }),
  );

  await handlers.put(
    { store: "drafts", key: "draft", value: { text: "hello" } },
    {
      caller: { type: "user", origin: "github", id: "123" },
      sessionKey: "session-one",
    },
  );

  const own = unwrapOk(
    await handlers.get(
      { store: "drafts", key: "draft" },
      {
        caller: { type: "user", origin: "github", id: "123" },
        sessionKey: "session-one",
      },
    ),
  );
  assertFound(own);

  const other = unwrapOk(
    await handlers.get(
      { store: "drafts", key: "draft" },
      {
        caller: { type: "user", origin: "github", id: "123" },
        sessionKey: "session-two",
      },
    ),
  );
  assertEquals(other, { found: false });
});

Deno.test("State RPC uses contract id lineage and state versions for migration decisions", async () => {
  const sessionKV = new FakeSessionKV();
  const state = new StateStore({
    kv: new FakeStateKV(),
    now: () => new Date("2026-01-01T00:00:00.000Z"),
  });
  const handlers = createStateHandlers({
    sessionStorage: sessionKV,
    state,
    contractStore: createContractStore(),
  });

  sessionKV.seed(
    "old-version-session",
    makeUserSession({
      trellisId: "user-1",
      contractId: "acme.notes@v1",
      contractDigest: "acme.notes@v0-digest",
    }),
  );
  sessionKV.seed(
    "current-digest-a",
    makeUserSession({ trellisId: "user-1", contractId: "acme.notes@v1" }),
  );
  sessionKV.seed(
    "current-digest-b",
    makeUserSession({
      trellisId: "user-1",
      contractId: "acme.notes@v1",
      contractDigest: "acme.notes@v2-digest",
    }),
  );

  const caller = { caller: { type: "user", origin: "github", id: "123" } };
  await handlers.put(
    { store: "drafts", key: "old", value: { title: "legacy" } },
    { ...caller, sessionKey: "old-version-session" },
  );
  await handlers.put(
    { store: "drafts", key: "current", value: { text: "same version" } },
    { ...caller, sessionKey: "current-digest-a" },
  );

  const sameVersion = unwrapOk(
    await handlers.get(
      { store: "drafts", key: "current" },
      { ...caller, sessionKey: "current-digest-b" },
    ),
  );
  assertFound(sameVersion);

  const oldVersion = unwrapOk(
    await handlers.get(
      { store: "drafts", key: "old" },
      { ...caller, sessionKey: "current-digest-a" },
    ),
  );
  if (!isMigrationRequired(oldVersion)) throw new Error("expected migration");
  assertEquals(oldVersion.entry, {
    key: "old",
    value: { title: "legacy" },
    revision: "1",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  assertEquals(oldVersion.stateVersion, "draft.v0");
  assertEquals(oldVersion.currentStateVersion, "draft.v1");
  assertEquals(oldVersion.writerContractDigest, "acme.notes@v0-digest");
});

Deno.test("State RPC derives store metadata and enforces value versus map key semantics", async () => {
  const sessionKV = new FakeSessionKV();
  const state = new StateStore({
    kv: new FakeStateKV(),
    now: () => new Date("2026-01-01T00:00:00.000Z"),
  });
  const handlers = createStateHandlers({
    sessionStorage: sessionKV,
    state,
    contractStore: createContractStore(),
  });

  sessionKV.seed(
    "user-session",
    makeUserSession({ trellisId: "user-1", contractId: "acme.notes@v1" }),
  );

  const created = unwrapOk(
    await handlers.put(
      {
        store: "preferences",
        expectedRevision: null,
        value: { theme: "light" },
      },
      {
        caller: { type: "user", origin: "github", id: "123" },
        sessionKey: "user-session",
      },
    ),
  );
  assertEquals(created.applied, true);
  if (!created.entry) throw new Error("expected created entry");
  assertStateEntry(created.entry);
  assertEquals(created.entry.key, undefined);

  const duplicate = unwrapOk(
    await handlers.put(
      {
        store: "preferences",
        expectedRevision: null,
        value: { theme: "dark" },
      },
      {
        caller: { type: "user", origin: "github", id: "123" },
        sessionKey: "user-session",
      },
    ),
  );
  assertEquals(duplicate.applied, false);

  assertEquals(
    unwrapErr(
      await handlers.get(
        { store: "preferences", key: "unexpected" },
        {
          caller: { type: "user", origin: "github", id: "123" },
          sessionKey: "user-session",
        },
      ),
    ) instanceof ValidationError,
    true,
  );

  assertEquals(
    unwrapErr(
      await handlers.list(
        { store: "preferences", offset: 0, limit: 10 },
        {
          caller: { type: "user", origin: "github", id: "123" },
          sessionKey: "user-session",
        },
      ),
    ) instanceof ValidationError,
    true,
  );

  assertEquals(
    unwrapErr(
      await handlers.get(
        { store: "drafts" },
        {
          caller: { type: "user", origin: "github", id: "123" },
          sessionKey: "user-session",
        },
      ),
    ) instanceof ValidationError,
    true,
  );

  assertEquals(
    unwrapErr(
      await handlers.put(
        { store: "preferences", value: { theme: 123 } },
        {
          caller: { type: "user", origin: "github", id: "123" },
          sessionKey: "user-session",
        },
      ),
    ) instanceof ValidationError,
    true,
  );
});

Deno.test("State RPC derives normal caller ownership from the session", async () => {
  const sessionKV = new FakeSessionKV();
  const state = new StateStore({
    kv: new FakeStateKV(),
    now: () => new Date("2026-01-01T00:00:00.000Z"),
  });
  const handlers = createStateHandlers({
    sessionStorage: sessionKV,
    state,
    contractStore: createContractStore(),
  });

  sessionKV.seed(
    "device-session",
    makeDeviceSession({ deviceId: "device-1", contractId: "acme.reader@v1" }),
  );
  sessionKV.seed(
    "user-session",
    makeUserSession({ trellisId: "user-1", contractId: "acme.reader@v1" }),
  );

  const written = unwrapOk(
    await handlers.put(
      { store: "preferences", value: { page: 1 } },
      {
        caller: { type: "device", id: "device-1" },
        sessionKey: "device-session",
      },
    ),
  );
  assertEquals(written.applied, true);

  const otherOwner = unwrapOk(
    await handlers.get(
      { store: "preferences" },
      {
        caller: { type: "user", origin: "github", id: "123" },
        sessionKey: "user-session",
      },
    ),
  );
  assertEquals(otherOwner, { found: false });
});

Deno.test("State admin RPCs inspect and delete named stores", async () => {
  const sessionKV = new FakeSessionKV();
  const state = new StateStore({
    kv: new FakeStateKV(),
    now: () => new Date("2026-01-01T00:00:00.000Z"),
  });
  const handlers = createStateHandlers({
    sessionStorage: sessionKV,
    state,
    contractStore: createContractStore(),
  });
  const trellisId = await trellisIdFromOriginId("github", "123");

  sessionKV.seed(
    "session-one",
    makeUserSession({ trellisId, contractId: "acme.notes@v1" }),
  );

  const put = unwrapOk(
    await handlers.put(
      { store: "drafts", key: "draft", value: { text: "hello" } },
      {
        caller: { type: "user", origin: "github", id: "123" },
        sessionKey: "session-one",
      },
    ),
  );
  if (!put.entry) throw new Error("expected put entry");
  assertStateEntry(put.entry);

  const adminCaller = { caller: { type: "user", capabilities: ["admin"] } };
  const target = {
    scope: "userApp" as const,
    contractId: "acme.notes@v1",
    contractDigest: "acme.notes@v1-digest",
    store: "drafts",
    user: { origin: "github", id: "123" },
  };

  const got = unwrapOk(
    await handlers.adminGet({ ...target, key: "draft" }, adminCaller),
  );
  assertFound(got);

  const listed = unwrapOk(
    await handlers.adminList({ ...target, offset: 0, limit: 10 }, adminCaller),
  );
  assertEquals(listed.entries.map(listedKey), ["draft"]);

  const deleted = unwrapOk(
    await handlers.adminDelete(
      { ...target, key: "draft", expectedRevision: put.entry.revision },
      adminCaller,
    ),
  );
  assertEquals(deleted, { deleted: true });

  const missing = unwrapOk(
    await handlers.adminGet({ ...target, key: "draft" }, adminCaller),
  );
  assertEquals(missing, { found: false });

  assertEquals(
    unwrapErr(
      await handlers.adminGet(
        { ...target, store: "missing", key: "draft" },
        adminCaller,
      ),
    ) instanceof ValidationError,
    true,
  );

  assertEquals(
    unwrapErr(
      await handlers.adminGet({ ...target, key: "draft" }, {
        caller: { type: "user" },
      }),
    ) instanceof AuthError,
    true,
  );

  assertEquals(
    unwrapErr(
      await handlers.adminGet(
        {
          ...target,
          contractId: "acme.tasks@v1",
        },
        adminCaller,
      ),
    ) instanceof ValidationError,
    true,
  );
});
