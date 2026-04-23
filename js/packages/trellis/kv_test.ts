import { assertEquals, assertExists } from "@std/assert";
import { Kvm } from "@nats-io/kv";
import type { BaseError } from "../result/mod.ts";
import { Result } from "../result/mod.ts";
import { Type as T } from "typebox";
import { ValidationError } from "./errors/index.ts";

function unwrapOk<T, E extends BaseError>(result: Result<T, E>, message: string): T {
  return result.match({
    ok: (value) => value,
    err: () => {
      throw new Error(message);
    },
  });
}
import { NatsTest } from "./testing/nats.ts";
import { type TypedKV, type WatchEvent, type WatchOptions } from "./kv.ts";

const RUN_NATS_TESTS = Deno.env.get("TRELLIS_TEST_NATS") === "1";

// Schema for testing
const TestSchema = T.Object({
  name: T.String(),
  count: T.Number(),
});

// Helper to open a typed KV bucket
async function openTestKV(
  nc: import("@nats-io/nats-core/internal").NatsConnection,
  bucketName: string,
): Promise<TypedKV<typeof TestSchema>> {
  const { TypedKV } = await import("./kv.ts");
  const result = await TypedKV.open(nc, bucketName, TestSchema, {
    history: 5,
    ttl: 60_000,
  });
  if (result.isErr()) throw new Error("Failed to open KV");
  return unwrapOk(result, "Failed to open KV");
}

Deno.test("WatchEvent type shape", async (t) => {
  await t.step("WatchEvent has correct properties for update events", () => {
    // Type-level test: WatchEvent must have specific structure
    const updateEvent: WatchEvent<typeof TestSchema> = {
      type: "update",
      key: "test-key",
      value: { name: "test", count: 1 },
      revision: 1,
      timestamp: new Date(),
    };

    assertEquals(updateEvent.type, "update");
    assertExists(updateEvent.key);
    assertExists(updateEvent.value);
    assertExists(updateEvent.revision);
    assertExists(updateEvent.timestamp);
  });

  await t.step("WatchEvent has correct properties for delete events", () => {
    // Type-level test: delete events should not require value
    const deleteEvent: WatchEvent<typeof TestSchema> = {
      type: "delete",
      key: "test-key",
      revision: 2,
      timestamp: new Date(),
    };

    assertEquals(deleteEvent.type, "delete");
    assertExists(deleteEvent.key);
    assertEquals(deleteEvent.value, undefined);
    assertExists(deleteEvent.revision);
    assertExists(deleteEvent.timestamp);
  });

  await t.step("WatchEvent has correct properties for error events", () => {
    const errorEvent: WatchEvent<typeof TestSchema> = {
      type: "error",
      key: "test-key",
      error: new ValidationError({
        errors: [{ path: "/count", message: "Expected number" }],
      }),
      revision: 3,
      timestamp: new Date(),
    };

    assertEquals(errorEvent.type, "error");
    assertExists(errorEvent.key);
    assertExists(errorEvent.error);
    assertEquals(errorEvent.value, undefined);
    assertExists(errorEvent.revision);
    assertExists(errorEvent.timestamp);
  });
});

Deno.test({
  name: "TypedKV invalid entries surface errors without deleting data",
  ignore: !RUN_NATS_TESTS,
  async fn(t) {
    await using nats = await NatsTest.start();
    const kv = await openTestKV(nats.nc, "invalid-entry-test");

    await t.step("get() returns ValidationError and preserves the raw entry", async () => {
      await kv.kv.put("invalid-get", JSON.stringify({ name: "missing-count" }));

      const result = await kv.get("invalid-get");
      assertEquals(result.isErr(), true);
      assertEquals(result.error instanceof ValidationError, true);

      const raw = await kv.kv.get("invalid-get");
      assertExists(raw, "Invalid entry should not be auto-deleted");
    });

    await t.step("watch() emits an error event and preserves the raw entry", async () => {
      const key = "invalid-watch";
      const createResult = await kv.create(key, { name: "initial", count: 1 });
      if (createResult.isErr()) throw new Error("Failed to create entry");

      const entryResult = await kv.get(key);
      if (entryResult.isErr()) throw new Error("Failed to get entry");
      const entry = unwrapOk(entryResult, "Failed to get entry");

      const events: WatchEvent<typeof TestSchema>[] = [];
      const unsubscribe = await entry.watch((event) => {
        events.push(event);
      }, { includeDeletes: true });

      await delay(100);
      await kv.kv.put(key, JSON.stringify({ name: "missing-count" }));
      await delay(200);

      const errorEvent = events.find((event) => event.type === "error");
      assertExists(errorEvent, "Should receive an error event");
      assertEquals(errorEvent.key, key);
      assertEquals(errorEvent.error instanceof ValidationError, true);

      const raw = await kv.kv.get(key);
      assertExists(raw, "Invalid watch entry should not be auto-deleted");

      unsubscribe();
    });

    await t.step("TypedKVEntry.create() returns ValidationError and preserves the raw entry", async () => {
      const rawKv = await new Kvm(nats.nc).open("invalid-entry-test");
      await rawKv.put("invalid-entry-create", JSON.stringify({ count: 10 }));

      const rawEntry = await rawKv.get("invalid-entry-create");
      assertExists(rawEntry);

      const { TypedKVEntry } = await import("./kv.ts");
      const result = await TypedKVEntry.create(TestSchema, rawKv, rawEntry);
      assertEquals(result.isErr(), true);
      assertEquals(result.error instanceof ValidationError, true);

      const preserved = await rawKv.get("invalid-entry-create");
      assertExists(preserved, "Invalid entry should remain present after validation failure");
    });
  },
});

Deno.test({
  name: "TypedKVEntry.watch()",
  ignore: !RUN_NATS_TESTS,
  async fn(t) {
  await using nats = await NatsTest.start();
  const kv = await openTestKV(nats.nc, "watch-test");

  await t.step("watch() returns an unsubscribe function", async () => {
    // Create an entry to watch
    const createResult = await kv.create("watch-unsub-test", {
      name: "test",
      count: 0,
    });
    if (createResult.isErr()) throw new Error("Failed to create entry");

    const entryResult = await kv.get("watch-unsub-test");
    if (entryResult.isErr()) throw new Error("Failed to get entry");
    const entry = unwrapOk(entryResult, "Failed to get entry");

    // Watch should return an unsubscribe function
    const unsubscribe = await entry.watch(() => {});

    assertExists(unsubscribe);
    assertEquals(typeof unsubscribe, "function");

    // Clean up
    unsubscribe();
  });

  await t.step("watch() calls callback on updates with decoded values", async () => {
    // Create an entry
    const key = "watch-update-test";
    const createResult = await kv.create(key, { name: "initial", count: 0 });
    if (createResult.isErr()) throw new Error("Failed to create entry");

    const entryResult = await kv.get(key);
    if (entryResult.isErr()) throw new Error("Failed to get entry");
    const entry = unwrapOk(entryResult, "Failed to get entry");

    // Set up watch with callback that collects events
    const events: WatchEvent<typeof TestSchema>[] = [];
    const unsubscribe = await entry.watch((event: WatchEvent<typeof TestSchema>) => {
      events.push(event);
    });

    // Give watcher time to initialize
    await delay(100);

    // Update the entry
    const putResult = await entry.put({ name: "updated", count: 42 });
    if (putResult.isErr()) throw new Error("Failed to put entry");

    // Wait for event to be received
    await delay(200);

    // Verify we received an update event
    assertEquals(events.length >= 1, true, "Should receive at least one event");

    const updateEvent = events.find((e) => e.type === "update" && e.value?.count === 42);
    assertExists(updateEvent, "Should receive update event with new value");
    assertEquals(updateEvent.type, "update");
    assertEquals(updateEvent.key, key);
    assertEquals(updateEvent.value?.name, "updated");
    assertEquals(updateEvent.value?.count, 42);
    assertExists(updateEvent.revision);
    assertExists(updateEvent.timestamp);

    // Clean up
    unsubscribe();
  });

  await t.step("watch() calls callback on deletes when includeDeletes is true", async () => {
    // Create an entry
    const key = "watch-delete-test";
    const createResult = await kv.create(key, { name: "to-delete", count: 99 });
    if (createResult.isErr()) throw new Error("Failed to create entry");

    const entryResult = await kv.get(key);
    if (entryResult.isErr()) throw new Error("Failed to get entry");
    const entry = unwrapOk(entryResult, "Failed to get entry");

    // Set up watch with includeDeletes option
    const events: WatchEvent<typeof TestSchema>[] = [];
    const unsubscribe = await entry.watch(
      (event: WatchEvent<typeof TestSchema>) => {
        events.push(event);
      },
      { includeDeletes: true },
    );

    // Give watcher time to initialize
    await delay(100);

    // Delete the entry
    const deleteResult = await entry.delete();
    if (deleteResult.isErr()) throw new Error("Failed to delete entry");

    // Wait for event to be received
    await delay(200);

    // Verify we received a delete event
    const deleteEvent = events.find((e) => e.type === "delete");
    assertExists(deleteEvent, "Should receive delete event");
    assertEquals(deleteEvent.type, "delete");
    assertEquals(deleteEvent.key, key);
    assertEquals(deleteEvent.value, undefined);
    assertExists(deleteEvent.revision);
    assertExists(deleteEvent.timestamp);

    // Clean up
    unsubscribe();
  });

  await t.step("unsubscribe stops the watcher", async () => {
    // Create an entry
    const key = "watch-stop-test";
    const createResult = await kv.create(key, { name: "stop-test", count: 0 });
    if (createResult.isErr()) throw new Error("Failed to create entry");

    const entryResult = await kv.get(key);
    if (entryResult.isErr()) throw new Error("Failed to get entry");
    const entry = unwrapOk(entryResult, "Failed to get entry");

    // Set up watch
    const events: WatchEvent<typeof TestSchema>[] = [];
    const unsubscribe = await entry.watch((event: WatchEvent<typeof TestSchema>) => {
      events.push(event);
    });

    // Give watcher time to initialize
    await delay(100);

    // Make one update
    await entry.put({ name: "first-update", count: 1 });
    await delay(100);

    const eventsBeforeUnsubscribe = events.length;

    // Unsubscribe
    unsubscribe();

    // Wait a moment for unsubscribe to take effect
    await delay(50);

    // Try to update again via the KV bucket
    await kv.put(key, { name: "after-unsubscribe", count: 999 });

    // Wait for potential event
    await delay(200);

    // No new events should have been received after unsubscribe
    assertEquals(
      events.length,
      eventsBeforeUnsubscribe,
      "Should not receive events after unsubscribe",
    );
  });
  },
});

Deno.test({
  name: "TypedKVEntry.delete(vcc) enforces CAS semantics",
  ignore: !RUN_NATS_TESTS,
  async fn(t) {
  await using nats = await NatsTest.start();
  const kv = await openTestKV(nats.nc, "delete-vcc-test");

  await t.step("CAS delete fails if entry was updated", async () => {
    const key = "delete-vcc-updated";
    const createResult = await kv.create(key, { name: "initial", count: 1 });
    if (createResult.isErr()) throw new Error("Failed to create entry");

    const entryResult = await kv.get(key);
    if (entryResult.isErr()) throw new Error("Failed to get entry");
    const entry = unwrapOk(entryResult, "Failed to get entry");

    const putResult = await kv.put(key, { name: "updated", count: 2 });
    if (putResult.isErr()) throw new Error("Failed to update entry");

    const deleteResult = await entry.delete(true);
    assertEquals(deleteResult.isErr(), true);
  });

  await t.step("CAS delete succeeds with correct revision and then fails on reuse", async () => {
    const key = "delete-vcc-once";
    const createResult = await kv.create(key, { name: "initial", count: 1 });
    if (createResult.isErr()) throw new Error("Failed to create entry");

    const entryResult = await kv.get(key);
    if (entryResult.isErr()) throw new Error("Failed to get entry");
    const entry = unwrapOk(entryResult, "Failed to get entry");

    const deleteResult = await entry.delete(true);
    if (deleteResult.isErr()) throw deleteResult.error;

    // A second delete using the stale revision should fail (the key now has a delete marker).
    const secondDelete = await entry.delete(true);
    assertEquals(secondDelete.isErr(), true);
  });
  },
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
