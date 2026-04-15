import { assertEquals, assertThrows } from "@std/assert";
import { Type } from "typebox";
import { defineContract } from "../../contracts/mod.ts";
import {
  assertDataPointersExistAndAreTokenable,
  getSubschemaAtDataPointer,
} from "../../contracts/schema_pointers.ts";

Deno.test("schema pointers", async (t) => {
  const eventSchema = Type.Object({
    header: Type.Object({
      id: Type.String(),
      time: Type.String({ format: "date-time" }),
    }),
    foo: Type.String(),
    num: Type.Number(),
    int: Type.Integer(),
    nested: Type.Object({ id: Type.String() }),
    arr: Type.Array(Type.String()),
    bool: Type.Boolean(),
    nullable: Type.Union([Type.String(), Type.Null()]),
  });

  const schemas = {
    EventSchema: eventSchema,
  } as const;

  function schemaRef<const TName extends keyof typeof schemas & string>(schema: TName) {
    return { schema } as const;
  }

  await t.step("getSubschemaAtDataPointer returns subschema", () => {
    const s = getSubschemaAtDataPointer(eventSchema, "/foo") as { type?: unknown };
    assertEquals(s.type, "string");
  });

  await t.step("getSubschemaAtDataPointer returns undefined for missing", () => {
    assertEquals(getSubschemaAtDataPointer(eventSchema, "/nope"), undefined);
  });

  await t.step("assertDataPointersExistAndAreTokenable accepts string/number/integer", () => {
    assertDataPointersExistAndAreTokenable("Test.Event", eventSchema, ["/foo", "/num", "/int"]);
  });

  await t.step("assertDataPointersExistAndAreTokenable rejects missing pointer", () => {
    assertThrows(
      () => assertDataPointersExistAndAreTokenable("Test.Event", eventSchema, ["/missing"]),
      Error,
      "path not found",
    );
  });

  await t.step("assertDataPointersExistAndAreTokenable rejects object", () => {
    assertThrows(
      () => assertDataPointersExistAndAreTokenable("Test.Event", eventSchema, ["/nested"]),
      Error,
      "must resolve to string/number",
    );
  });

  await t.step("assertDataPointersExistAndAreTokenable rejects array", () => {
    assertThrows(
      () => assertDataPointersExistAndAreTokenable("Test.Event", eventSchema, ["/arr"]),
      Error,
      "must resolve to string/number",
    );
  });

  await t.step("assertDataPointersExistAndAreTokenable rejects boolean", () => {
    assertThrows(
      () => assertDataPointersExistAndAreTokenable("Test.Event", eventSchema, ["/bool"]),
      Error,
      "must resolve to string/number",
    );
  });

  await t.step("assertDataPointersExistAndAreTokenable rejects nullable union", () => {
    assertThrows(
      () => assertDataPointersExistAndAreTokenable("Test.Event", eventSchema, ["/nullable"]),
      Error,
      "must resolve to string/number",
    );
  });

  await t.step("emitted contract constructs subject from params", () => {
    const contract = defineContract(
      { schemas },
      () => ({
        id: "test@v1",
        displayName: "Pointer Test",
        description: "Validate schema pointer tokenization during event emission.",
        kind: "service",
        events: {
          "Test.Subject": {
            version: "v1",
            params: ["/foo"],
            event: schemaRef("EventSchema"),
            capabilities: { publish: [], subscribe: [] },
          },
        },
      }),
    ).CONTRACT;
    assertEquals(contract.events?.["Test.Subject"]?.subject, "events.v1.Test.Subject.{/foo}");
  });
});
