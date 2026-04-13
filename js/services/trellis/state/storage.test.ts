import { assertEquals } from "@std/assert";
import type { BaseError, Result } from "@qlever-llc/result";

import { StateStore } from "./storage.ts";
import { FakeStateKV } from "./test_helpers.ts";

function unwrapOk<T, E extends BaseError>(value: Result<T, E>): T {
  if (value.isErr()) throw value.error;
  return value.unwrapOrElse((error) => {
    throw error;
  });
}

Deno.test("StateStore put/get/list returns lexicographic pages", async () => {
  const kv = new FakeStateKV();
  const store = new StateStore({ kv, now: () => new Date("2026-01-01T00:00:00.000Z") });
  const namespace = { scope: "userApp" as const, ownerKey: "user-1", contractId: "acme.notes@v1" };

  unwrapOk(await store.put(namespace, "b", { label: "b" }));
  unwrapOk(await store.put(namespace, "a", { label: "a" }));
  unwrapOk(await store.put(namespace, "c", { label: "c" }));

  const got = unwrapOk(await store.get(namespace, "a"));
  assertEquals(got.found, true);

  const listed = unwrapOk(await store.list(namespace, { offset: 0, limit: 2 }));
  assertEquals(listed.entries.map((entry) => entry.key), ["a", "b"]);
  assertEquals(listed.count, 3);
  assertEquals(listed.next, 2);
});

Deno.test("StateStore compareAndSet supports create-if-absent and revision checks", async () => {
  const kv = new FakeStateKV();
  const store = new StateStore({ kv, now: () => new Date("2026-01-01T00:00:00.000Z") });
  const namespace = { scope: "userApp" as const, ownerKey: "user-1", contractId: "acme.notes@v1" };

  const created = unwrapOk(await store.compareAndSet(namespace, "draft", null, { step: 1 }));
  assertEquals(created.applied, true);
  if (!created.entry) throw new Error("expected created entry");

  const duplicate = unwrapOk(await store.compareAndSet(namespace, "draft", null, { step: 2 }));
  assertEquals(duplicate.applied, false);
  assertEquals("found" in duplicate ? duplicate.found : undefined, true);

  const mismatch = unwrapOk(await store.compareAndSet(namespace, "draft", "999", { step: 3 }));
  assertEquals(mismatch.applied, false);
  assertEquals("found" in mismatch ? mismatch.found : undefined, true);

  const updated = unwrapOk(await store.compareAndSet(namespace, "draft", created.entry.revision, { step: 4 }));
  assertEquals(updated.applied, true);
  if (!updated.entry) throw new Error("expected updated entry");
  assertEquals(updated.entry.value, { step: 4 });
});

Deno.test("StateStore treats expired entries as absent and supports conditional delete", async () => {
  let now = new Date("2026-01-01T00:00:00.000Z");
  const kv = new FakeStateKV();
  const store = new StateStore({ kv, now: () => now });
  const namespace = { scope: "deviceApp" as const, ownerKey: "device-1", contractId: "acme.reader@v1" };

  const created = unwrapOk(await store.put(namespace, "cache", { ok: true }, 1_000));
  now = new Date("2026-01-01T00:00:02.000Z");

  const expired = unwrapOk(await store.get(namespace, "cache"));
  assertEquals(expired, { found: false });

  const recreated = unwrapOk(await store.compareAndSet(namespace, "cache", null, { ok: false }));
  assertEquals(recreated.applied, true);
  if (!recreated.entry) throw new Error("expected recreated entry");

  const wrongDelete = unwrapOk(await store.delete(namespace, "cache", created.entry.revision));
  assertEquals(wrongDelete.deleted, false);

  const deleted = unwrapOk(await store.delete(namespace, "cache", recreated.entry.revision));
  assertEquals(deleted.deleted, true);
});
