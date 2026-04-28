import { assertEquals } from "@std/assert";
import { AsyncResult, type BaseError, Result } from "@qlever-llc/result";
import { KVError, UnexpectedError, ValidationError } from "@qlever-llc/trellis";
import { Type } from "typebox";

import { StateStore } from "./storage.ts";
import { FakeStateKV } from "./test_helpers.ts";

function unwrapOk<T, E extends BaseError>(value: Result<T, E>): T {
  if (value.isErr()) throw value.error;
  return value.unwrapOrElse((error) => {
    throw error;
  });
}

function assertFound(value: unknown): asserts value is {
  found: true;
  entry: {
    key?: string;
    value: unknown;
    revision: string;
    updatedAt: string;
    expiresAt?: string;
  };
} {
  if (
    value === null || typeof value !== "object" ||
    "migrationRequired" in value || !("found" in value) || value.found !== true
  ) {
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

function assertValidationError(
  error: unknown,
): asserts error is ValidationError {
  if (!(error instanceof ValidationError)) {
    throw new Error("expected ValidationError");
  }
}

function assertUnexpectedError(
  error: unknown,
): asserts error is UnexpectedError {
  if (!(error instanceof UnexpectedError)) {
    throw new Error("expected UnexpectedError");
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

function assertRecord(
  value: unknown,
): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object") {
    throw new Error("expected record");
  }
}

class CountingGetStateKV extends FakeStateKV {
  getCalls = 0;

  override get(key: string) {
    this.getCalls += 1;
    return super.get(key);
  }
}

class FailingCreateStateKV extends FakeStateKV {
  override create(key: string, _value: unknown) {
    return AsyncResult.err(
      new KVError({
        operation: "create",
        context: { key, reason: "temporarily unavailable" },
      }),
    );
  }
}

class FailingEntryPutStateKV extends FakeStateKV {
  override get(key: string) {
    return AsyncResult.from((async () => {
      const result = await super.get(key);
      if (result.isErr()) return result;
      const entry = result.orThrow();
      return Result.ok({
        ...entry,
        put(_value: unknown, _vcc?: boolean) {
          return AsyncResult.err(
            new KVError({
              operation: "put",
              context: { key, reason: "temporarily unavailable" },
            }),
          );
        },
      });
    })());
  }
}

class RevisionConflictDeleteStateKV extends FakeStateKV {
  override get(key: string) {
    return AsyncResult.from((async () => {
      const result = await super.get(key);
      if (result.isErr()) return result;
      const entry = result.orThrow();
      return Result.ok({
        ...entry,
        delete(_vcc?: boolean) {
          return AsyncResult.err(
            new KVError({
              operation: "delete",
              context: { key, reason: "revision mismatch" },
            }),
          );
        },
      });
    })());
  }
}

Deno.test("StateStore put/get/list returns lexicographic pages for map stores", async () => {
  const kv = new FakeStateKV();
  const store = new StateStore({
    kv,
    now: () => new Date("2026-01-01T00:00:00.000Z"),
  });
  const target = {
    ownerType: "user" as const,
    contractId: "acme.notes@v1",
    contractDigest: "digest-v1",
    ownerKey: "user-1",
    store: "drafts",
    kind: "map" as const,
    schema: Type.Object({ label: Type.String() }),
    stateVersion: "v1",
    acceptedVersions: {},
  };

  unwrapOk(await store.put(target, { key: "b", value: { label: "b" } }));
  unwrapOk(await store.put(target, { key: "a", value: { label: "a" } }));
  unwrapOk(await store.put(target, { key: "c", value: { label: "c" } }));

  const got = unwrapOk(await store.get(target, { key: "a" }));
  assertFound(got);

  const listed = unwrapOk(
    await store.list(target, { prefix: "", offset: 0, limit: 2 }),
  );
  assertEquals(listed.entries.map(listedKey), ["a", "b"]);
  assertEquals(listed.count, 3);
  assertEquals(listed.next, 2);
  assertEquals(listed.prev, undefined);

  const secondPage = unwrapOk(
    await store.list(target, { prefix: "", offset: 2, limit: 2 }),
  );
  assertEquals(secondPage.entries.map(listedKey), ["c"]);
  assertEquals(secondPage.prev, 0);

  const emptyPage = unwrapOk(
    await store.list(target, { prefix: "", offset: 0, limit: 0 }),
  );
  assertEquals(emptyPage.entries, []);
  assertEquals(emptyPage.next, undefined);
});

Deno.test("StateStore put supports conditional writes for value stores", async () => {
  const kv = new FakeStateKV();
  const store = new StateStore({
    kv,
    now: () => new Date("2026-01-01T00:00:00.000Z"),
  });
  const target = {
    ownerType: "user" as const,
    contractId: "acme.notes@v1",
    contractDigest: "digest-v1",
    ownerKey: "user-1",
    store: "preferences",
    kind: "value" as const,
    schema: Type.Object({ theme: Type.String() }),
    stateVersion: "v1",
    acceptedVersions: {},
  };

  const created = unwrapOk(
    await store.put(target, {
      expectedRevision: null,
      value: { theme: "light" },
    }),
  );
  assertEquals(created.applied, true);
  if (!created.entry) throw new Error("expected created entry");
  assertStateEntry(created.entry);
  assertEquals(created.entry.value, { theme: "light" });
  assertEquals(created.entry.key, undefined);

  const duplicate = unwrapOk(
    await store.put(target, {
      expectedRevision: null,
      value: { theme: "dark" },
    }),
  );
  assertEquals(duplicate.applied, false);
  assertEquals("found" in duplicate ? duplicate.found : undefined, true);

  const mismatch = unwrapOk(
    await store.put(target, {
      expectedRevision: "999",
      value: { theme: "dark" },
    }),
  );
  assertEquals(mismatch.applied, false);
  assertEquals("found" in mismatch ? mismatch.found : undefined, true);

  const updated = unwrapOk(
    await store.put(target, {
      expectedRevision: created.entry.revision,
      value: { theme: "dark" },
    }),
  );
  assertEquals(updated.applied, true);
  if (!updated.entry) throw new Error("expected updated entry");
  assertStateEntry(updated.entry);
  assertEquals(updated.entry.value, { theme: "dark" });

  const got = unwrapOk(await store.get(target));
  assertEquals(got, { found: true, entry: updated.entry });
});

Deno.test("StateStore unconditional put does not load the existing entry before writing", async () => {
  const kv = new CountingGetStateKV();
  const store = new StateStore({
    kv,
    now: () => new Date("2026-01-01T00:00:00.000Z"),
  });
  const target = {
    ownerType: "user" as const,
    contractId: "acme.notes@v1",
    contractDigest: "digest-v1",
    ownerKey: "user-1",
    store: "preferences",
    kind: "value" as const,
    schema: Type.Object({ theme: Type.String() }),
    stateVersion: "v1",
    acceptedVersions: {},
  };

  kv.seed("user.user-1.acme=2Enotes=40v1.preferences.~value", {
    value: { theme: "light" },
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    stateVersion: "v1",
    writerContractDigest: "digest-v1",
  });

  const written = unwrapOk(
    await store.put(target, { value: { theme: "dark" } }),
  );

  assertEquals(written.applied, true);
  assertEquals(kv.getCalls, 1);
});

Deno.test("StateStore treats expired entries as absent and supports conditional delete", async () => {
  let now = new Date("2026-01-01T00:00:00.000Z");
  const kv = new FakeStateKV();
  const store = new StateStore({ kv, now: () => now });
  const target = {
    ownerType: "device" as const,
    contractId: "acme.reader@v1",
    contractDigest: "digest-v1",
    ownerKey: "device-1",
    store: "cache",
    kind: "map" as const,
    schema: Type.Object({ ok: Type.Boolean() }),
    stateVersion: "v1",
    acceptedVersions: {},
  };

  const created = unwrapOk(
    await store.put(target, {
      key: "page-1",
      ttlMs: 1_000,
      value: { ok: true },
    }),
  );
  if (!created.entry) throw new Error("expected created entry");
  assertStateEntry(created.entry);

  now = new Date("2026-01-01T00:00:02.000Z");

  const expired = unwrapOk(await store.get(target, { key: "page-1" }));
  assertEquals(expired, { found: false });

  const recreated = unwrapOk(
    await store.put(target, {
      key: "page-1",
      expectedRevision: null,
      value: { ok: false },
    }),
  );
  assertEquals(recreated.applied, true);
  if (!recreated.entry) throw new Error("expected recreated entry");
  assertStateEntry(recreated.entry);

  const wrongDelete = unwrapOk(
    await store.delete(target, {
      key: "page-1",
      expectedRevision: created.entry.revision,
    }),
  );
  assertEquals(wrongDelete.deleted, false);

  const deleted = unwrapOk(
    await store.delete(target, {
      key: "page-1",
      expectedRevision: recreated.entry.revision,
    }),
  );
  assertEquals(deleted.deleted, true);
});

Deno.test("StateStore encodes contract ids and caller keys for KV-safe storage", async () => {
  const kv = new FakeStateKV();
  const store = new StateStore({
    kv,
    now: () => new Date("2026-01-01T00:00:00.000Z"),
  });
  const target = {
    ownerType: "device" as const,
    contractId: "trellis.demo-state-device@v1",
    contractDigest: "digest-v1",
    ownerKey: "device.with.dot",
    store: "drafts.with.dot",
    kind: "map" as const,
    schema: Type.Object({ label: Type.String() }),
    stateVersion: "v1",
    acceptedVersions: {},
  };

  const written = unwrapOk(
    await store.put(target, {
      key: "inspection.v1/open",
      value: { label: "draft" },
    }),
  );
  assertEquals(written.applied, true);

  const got = unwrapOk(await store.get(target, { key: "inspection.v1/open" }));
  assertFound(got);

  const listed = unwrapOk(
    await store.list(target, {
      prefix: "inspection.v1/",
      offset: 0,
      limit: 10,
    }),
  );
  assertEquals(listed.entries.map(listedKey), [
    "inspection.v1/open",
  ]);
});

Deno.test("StateStore encoding prevents dotted component tuple collisions", async () => {
  const kv = new FakeStateKV();
  const store = new StateStore({
    kv,
    now: () => new Date("2026-01-01T00:00:00.000Z"),
  });
  const baseTarget = {
    ownerType: "user" as const,
    contractDigest: "digest-v1",
    kind: "map" as const,
    schema: Type.Object({ label: Type.String() }),
    stateVersion: "v1",
    acceptedVersions: {},
  };
  const leftTarget = {
    ...baseTarget,
    ownerKey: "one.two",
    contractId: "three",
    store: "four",
  };
  const rightTarget = {
    ...baseTarget,
    ownerKey: "one",
    contractId: "two.three",
    store: "four",
  };

  unwrapOk(
    await store.put(leftTarget, {
      key: "five.six",
      value: { label: "left" },
    }),
  );
  unwrapOk(
    await store.put(rightTarget, {
      key: "five.six",
      value: { label: "right" },
    }),
  );

  const left = unwrapOk(await store.get(leftTarget, { key: "five.six" }));
  assertFound(left);
  assertEquals(left.entry.value, { label: "left" });

  const right = unwrapOk(await store.get(rightTarget, { key: "five.six" }));
  assertFound(right);
  assertEquals(right.entry.value, { label: "right" });
});

Deno.test("StateStore lists map keys that look like value-store sentinels", async () => {
  const kv = new FakeStateKV();
  const store = new StateStore({
    kv,
    now: () => new Date("2026-01-01T00:00:00.000Z"),
  });
  const target = {
    ownerType: "user" as const,
    contractId: "acme.notes@v1",
    contractDigest: "digest-v1",
    ownerKey: "user-1",
    store: "drafts",
    kind: "map" as const,
    schema: Type.Object({ label: Type.String() }),
    stateVersion: "v1",
    acceptedVersions: {},
  };

  unwrapOk(
    await store.put(target, {
      key: "__value",
      value: { label: "old sentinel" },
    }),
  );
  unwrapOk(
    await store.put(target, {
      key: "~value",
      value: { label: "new sentinel text" },
    }),
  );

  const listed = unwrapOk(
    await store.list(target, { offset: 0, limit: 10 }),
  );

  assertEquals(listed.entries.map(listedKey), [
    "__value",
    "~value",
  ]);
});

Deno.test("StateStore stamps state provenance and keeps namespace contract-id scoped", async () => {
  const kv = new FakeStateKV();
  const store = new StateStore({
    kv,
    now: () => new Date("2026-01-01T00:00:00.000Z"),
  });
  const target = {
    ownerType: "user" as const,
    contractId: "acme.notes@v1",
    contractDigest: "digest-a",
    ownerKey: "user-1",
    store: "preferences",
    kind: "value" as const,
    schema: Type.Object({ theme: Type.String() }),
    stateVersion: "prefs.v2",
    acceptedVersions: {},
  };

  const written = unwrapOk(
    await store.put(target, { value: { theme: "dark" } }),
  );
  assertEquals(written.applied, true);

  const currentDigestTarget = { ...target, contractDigest: "digest-b" };
  const got = unwrapOk(await store.get(currentDigestTarget));
  assertFound(got);

  const stored = kv.snapshot(
    "user.user-1.acme=2Enotes=40v1.preferences.~value",
  );
  assertRecord(stored?.value);
  assertEquals(stored?.value.stateVersion, "prefs.v2");
  assertEquals(stored?.value.writerContractDigest, "digest-a");
});

Deno.test("StateStore surfaces accepted older state versions as migration-required", async () => {
  const kv = new FakeStateKV();
  const store = new StateStore({
    kv,
    now: () => new Date("2026-01-01T00:00:00.000Z"),
  });
  const oldTarget = {
    ownerType: "user" as const,
    contractId: "acme.notes@v1",
    contractDigest: "digest-v1",
    ownerKey: "user-1",
    store: "drafts",
    kind: "map" as const,
    schema: Type.Object({ title: Type.String() }),
    stateVersion: "draft.v1",
    acceptedVersions: {},
  };
  const currentTarget = {
    ...oldTarget,
    contractDigest: "digest-v2",
    schema: Type.Object({ title: Type.String(), done: Type.Boolean() }),
    stateVersion: "draft.v2",
    acceptedVersions: {
      "draft.v1": Type.Object({ title: Type.String() }),
    },
  };

  const written = unwrapOk(
    await store.put(oldTarget, { key: "a", value: { title: "old" } }),
  );
  if (!written.entry) throw new Error("expected written entry");
  assertStateEntry(written.entry);

  const got = unwrapOk(await store.get(currentTarget, { key: "a" }));
  if (!isMigrationRequired(got)) throw new Error("expected migration");
  assertEquals(got.entry, written.entry);
  assertEquals(got.stateVersion, "draft.v1");
  assertEquals(got.currentStateVersion, "draft.v2");
  assertEquals(got.writerContractDigest, "digest-v1");

  const listed = unwrapOk(
    await store.list(currentTarget, { offset: 0, limit: 10 }),
  );
  assertEquals(listed.entries.length, 1);
  const listedMigration = listed.entries[0];
  if (!isMigrationRequired(listedMigration)) {
    throw new Error("expected listed migration");
  }
  assertEquals(listedMigration.entry, written.entry);
});

Deno.test("StateStore surfaces migration metadata on failed conditional put", async () => {
  const kv = new FakeStateKV();
  const store = new StateStore({
    kv,
    now: () => new Date("2026-01-01T00:00:00.000Z"),
  });
  const oldTarget = {
    ownerType: "user" as const,
    contractId: "acme.notes@v1",
    contractDigest: "digest-v1",
    ownerKey: "user-1",
    store: "drafts",
    kind: "map" as const,
    schema: Type.Object({ title: Type.String() }),
    stateVersion: "draft.v1",
    acceptedVersions: {},
  };
  const currentTarget = {
    ...oldTarget,
    contractDigest: "digest-v2",
    schema: Type.Object({ title: Type.String(), done: Type.Boolean() }),
    stateVersion: "draft.v2",
    acceptedVersions: {
      "draft.v1": Type.Object({ title: Type.String() }),
    },
  };

  unwrapOk(await store.put(oldTarget, { key: "a", value: { title: "old" } }));

  const conflict = unwrapOk(
    await store.put(currentTarget, {
      key: "a",
      expectedRevision: null,
      value: { title: "new", done: false },
    }),
  );

  assertEquals(conflict.applied, false);
  if (!conflict.entry || !isMigrationRequired(conflict.entry)) {
    throw new Error("expected migration conflict entry");
  }
  assertEquals(conflict.entry.stateVersion, "draft.v1");
  assertEquals(conflict.entry.currentStateVersion, "draft.v2");
});

Deno.test("StateStore reports malformed stored envelopes as unexpected corruption", async () => {
  const kv = new FakeStateKV();
  const store = new StateStore({
    kv,
    now: () => new Date("2026-01-01T00:00:00.000Z"),
  });
  const target = {
    ownerType: "user" as const,
    contractId: "acme.notes@v1",
    contractDigest: "digest-v1",
    ownerKey: "user-1",
    store: "preferences",
    kind: "value" as const,
    schema: Type.Object({ theme: Type.String() }),
    stateVersion: "prefs.v1",
    acceptedVersions: {},
  };

  kv.seedRaw(
    "user.user-1.acme=2Enotes=40v1.preferences.~value",
    "not-envelope",
  );

  const got = await store.get(target);
  assertEquals(got.isErr(), true);
  if (!got.isErr()) throw new Error("expected stored envelope corruption");
  assertUnexpectedError(got.error);
});

Deno.test("StateStore reports malformed stored metadata as unexpected corruption", async () => {
  const kv = new FakeStateKV();
  const store = new StateStore({
    kv,
    now: () => new Date("2026-01-01T00:00:00.000Z"),
  });
  const currentTarget = {
    ownerType: "user" as const,
    contractId: "acme.notes@v1",
    contractDigest: "digest-v2",
    ownerKey: "user-1",
    store: "preferences",
    kind: "value" as const,
    schema: Type.Object({ theme: Type.String(), done: Type.Boolean() }),
    stateVersion: "prefs.v2",
    acceptedVersions: {
      "prefs.v1": Type.Object({ theme: Type.String() }),
    },
  };

  kv.seedRaw("user.user-1.acme=2Enotes=40v1.preferences.~value", {
    value: { theme: "dark" },
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  });

  const got = await store.get(currentTarget);
  assertEquals(got.isErr(), true);
  if (!got.isErr()) throw new Error("expected metadata corruption error");
  assertUnexpectedError(got.error);

  const compatibleTarget = {
    ...currentTarget,
    schema: Type.Object({
      theme: Type.String(),
      compact: Type.Optional(Type.Boolean()),
    }),
  };
  const compatible = await store.get(compatibleTarget);
  assertEquals(compatible.isErr(), true);
  if (!compatible.isErr()) {
    throw new Error("expected metadata corruption error");
  }
  assertUnexpectedError(compatible.error);
});

Deno.test("StateStore keeps caller value schema failures as validation errors", async () => {
  const kv = new FakeStateKV();
  const store = new StateStore({
    kv,
    now: () => new Date("2026-01-01T00:00:00.000Z"),
  });
  const target = {
    ownerType: "user" as const,
    contractId: "acme.notes@v1",
    contractDigest: "digest-v1",
    ownerKey: "user-1",
    store: "preferences",
    kind: "value" as const,
    schema: Type.Object({ theme: Type.String() }),
    stateVersion: "prefs.v1",
    acceptedVersions: {},
  };

  const written = await store.put(target, { value: { theme: 123 } });
  assertEquals(written.isErr(), true);
  if (!written.isErr()) throw new Error("expected caller validation error");
  assertValidationError(written.error);
});

Deno.test("StateStore returns unexpected errors for unrecognized create and revision write failures", async () => {
  const createKv = new FailingCreateStateKV();
  const createStore = new StateStore({
    kv: createKv,
    now: () => new Date("2026-01-01T00:00:00.000Z"),
  });
  const target = {
    ownerType: "user" as const,
    contractId: "acme.notes@v1",
    contractDigest: "digest-v1",
    ownerKey: "user-1",
    store: "drafts",
    kind: "map" as const,
    schema: Type.Object({ label: Type.String() }),
    stateVersion: "v1",
    acceptedVersions: {},
  };

  const createResult = await createStore.put(target, {
    key: "a",
    expectedRevision: null,
    value: { label: "a" },
  });
  assertEquals(createResult.isErr(), true);
  if (!createResult.isErr()) throw new Error("expected create error");
  assertEquals(createResult.error instanceof UnexpectedError, true);

  const putKv = new FailingEntryPutStateKV();
  putKv.seed("user.user-1.acme=2Enotes=40v1.drafts.a", {
    value: { label: "a" },
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    stateVersion: "v1",
    writerContractDigest: "digest-v1",
  });
  const putStore = new StateStore({
    kv: putKv,
    now: () => new Date("2026-01-01T00:00:00.000Z"),
  });
  const putResult = await putStore.put(target, {
    key: "a",
    expectedRevision: "1",
    value: { label: "b" },
  });
  assertEquals(putResult.isErr(), true);
  if (!putResult.isErr()) throw new Error("expected put error");
  assertEquals(putResult.error instanceof UnexpectedError, true);
});

Deno.test("StateStore conditional delete revision races return not deleted", async () => {
  const kv = new RevisionConflictDeleteStateKV();
  kv.seed("user.user-1.acme=2Enotes=40v1.drafts.a", {
    value: { label: "a" },
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    stateVersion: "v1",
    writerContractDigest: "digest-v1",
  });
  const store = new StateStore({
    kv,
    now: () => new Date("2026-01-01T00:00:00.000Z"),
  });
  const target = {
    ownerType: "user" as const,
    contractId: "acme.notes@v1",
    contractDigest: "digest-v1",
    ownerKey: "user-1",
    store: "drafts",
    kind: "map" as const,
    schema: Type.Object({ label: Type.String() }),
    stateVersion: "v1",
    acceptedVersions: {},
  };

  const deleted = unwrapOk(
    await store.delete(target, { key: "a", expectedRevision: "1" }),
  );

  assertEquals(deleted, { deleted: false });
});

Deno.test("StateStore rejects unstamped entries before value schema validation", async () => {
  const kv = new FakeStateKV();
  const store = new StateStore({
    kv,
    now: () => new Date("2026-01-01T00:00:00.000Z"),
  });
  const target = {
    ownerType: "user" as const,
    contractId: "acme.notes@v1",
    contractDigest: "digest-v2",
    ownerKey: "user-1",
    store: "preferences",
    kind: "value" as const,
    schema: Type.Object({ theme: Type.String(), done: Type.Boolean() }),
    stateVersion: "prefs.v2",
    acceptedVersions: {
      "prefs.v1": Type.Object({ theme: Type.String() }),
    },
  };

  kv.seedRaw("user.user-1.acme=2Enotes=40v1.preferences.~value", {
    value: { theme: 123 },
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  });

  const got = await store.get(target);
  assertEquals(got.isErr(), true);
  if (!got.isErr()) throw new Error("expected metadata corruption error");
  assertUnexpectedError(got.error);
});
