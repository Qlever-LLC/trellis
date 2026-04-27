import { assertEquals } from "@std/assert";
import type { BaseError, Result } from "@qlever-llc/result";
import { Type } from "typebox";

import { StateStore } from "./storage.ts";
import { FakeStateKV } from "./test_helpers.ts";

function unwrapOk<T, E extends BaseError>(value: Result<T, E>): T {
  if (value.isErr()) throw value.error;
  return value.unwrapOrElse((error) => {
    throw error;
  });
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
    ownerKey: "user-1",
    store: "drafts",
    kind: "map" as const,
    schema: Type.Object({ label: Type.String() }),
  };

  unwrapOk(await store.put(target, { key: "b", value: { label: "b" } }));
  unwrapOk(await store.put(target, { key: "a", value: { label: "a" } }));
  unwrapOk(await store.put(target, { key: "c", value: { label: "c" } }));

  const got = unwrapOk(await store.get(target, { key: "a" }));
  assertEquals(got.found, true);

  const listed = unwrapOk(
    await store.list(target, { prefix: "", offset: 0, limit: 2 }),
  );
  assertEquals(listed.entries.map((entry) => entry.key), ["a", "b"]);
  assertEquals(listed.count, 3);
  assertEquals(listed.next, 2);
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
    ownerKey: "user-1",
    store: "preferences",
    kind: "value" as const,
    schema: Type.Object({ theme: Type.String() }),
  };

  const created = unwrapOk(
    await store.put(target, {
      expectedRevision: null,
      value: { theme: "light" },
    }),
  );
  assertEquals(created.applied, true);
  if (!created.entry) throw new Error("expected created entry");
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
  assertEquals(updated.entry.value, { theme: "dark" });

  const got = unwrapOk(await store.get(target));
  assertEquals(got, { found: true, entry: updated.entry });
});

Deno.test("StateStore treats expired entries as absent and supports conditional delete", async () => {
  let now = new Date("2026-01-01T00:00:00.000Z");
  const kv = new FakeStateKV();
  const store = new StateStore({ kv, now: () => now });
  const target = {
    ownerType: "device" as const,
    contractId: "acme.reader@v1",
    ownerKey: "device-1",
    store: "cache",
    kind: "map" as const,
    schema: Type.Object({ ok: Type.Boolean() }),
  };

  const created = unwrapOk(
    await store.put(target, {
      key: "page-1",
      ttlMs: 1_000,
      value: { ok: true },
    }),
  );
  if (!created.entry) throw new Error("expected created entry");

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
    ownerKey: "device.with.dot",
    store: "drafts.with.dot",
    kind: "map" as const,
    schema: Type.Object({ label: Type.String() }),
  };

  const written = unwrapOk(
    await store.put(target, {
      key: "inspection.v1/open",
      value: { label: "draft" },
    }),
  );
  assertEquals(written.applied, true);

  const got = unwrapOk(await store.get(target, { key: "inspection.v1/open" }));
  assertEquals(got.found, true);

  const listed = unwrapOk(
    await store.list(target, {
      prefix: "inspection.v1/",
      offset: 0,
      limit: 10,
    }),
  );
  assertEquals(listed.entries.map((entry) => entry.key), [
    "inspection.v1/open",
  ]);
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
    ownerKey: "user-1",
    store: "drafts",
    kind: "map" as const,
    schema: Type.Object({ label: Type.String() }),
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

  assertEquals(listed.entries.map((entry) => entry.key), [
    "__value",
    "~value",
  ]);
});
