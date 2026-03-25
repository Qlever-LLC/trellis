import { assertEquals, assertExists } from "@std/assert";
import { Type as T } from "typebox";
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
) {
  const { TypedKV } = await import("./kv.ts");
  const result = await TypedKV.open(nc, bucketName, TestSchema, {
    history: 5,
    ttl: 60_000,
  });
  if (result.isErr()) throw new Error("Failed to open KV");
  return result.unwrapOr(null as never);
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
    const entry = entryResult.unwrapOr(null as never);

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
    const entry = entryResult.unwrapOr(null as never);

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
    const entry = entryResult.unwrapOr(null as never);

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
    const entry = entryResult.unwrapOr(null as never);

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
    const entry = entryResult.unwrapOr(null as never);

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
    const entry = entryResult.unwrapOr(null as never);

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
