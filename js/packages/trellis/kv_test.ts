import { assertEquals, assertExists } from "@std/assert";
import { Type as T } from "typebox";
import { ValidationError } from "./errors/index.ts";
import type { WatchEvent, WatchOptions } from "./kv.ts";

const TestSchema = T.Object({
  name: T.String(),
  count: T.Number(),
});

Deno.test("WatchEvent type shape", async (t) => {
  await t.step("WatchEvent has correct properties for update events", () => {
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

Deno.test("WatchOptions type shape", () => {
  const options: WatchOptions = { includeDeletes: true };

  assertEquals(options.includeDeletes, true);
});
