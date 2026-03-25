import { assertEquals, assertThrows } from "@std/assert";
import { Type } from "typebox";
import { defineContract } from "../../contracts/mod.ts";
import {
  assertDataPointersExistAndAreTokenable,
  getSubschemaAtDataPointer,
} from "../../contracts/schema_pointers.ts";

Deno.test("schema pointers", async (t) => {
  const schema = Type.Object({
    header: Type.Object({
      id: Type.String(),
      time: Type.String({ format: "date-time" }),
    }, { additionalProperties: false }),
    foo: Type.String(),
    num: Type.Number(),
    int: Type.Integer(),
    nested: Type.Object({ id: Type.String() }, { additionalProperties: false }),
    arr: Type.Array(Type.String()),
    bool: Type.Boolean(),
    nullable: Type.Union([Type.String(), Type.Null()]),
  }, { additionalProperties: false });

  await t.step("getSubschemaAtDataPointer returns subschema", () => {
    const s = getSubschemaAtDataPointer(schema, "/foo") as { type?: unknown };
    assertEquals(s.type, "string");
  });

  await t.step("getSubschemaAtDataPointer returns undefined for missing", () => {
    assertEquals(getSubschemaAtDataPointer(schema, "/nope"), undefined);
  });

  await t.step("assertDataPointersExistAndAreTokenable accepts string/number/integer", () => {
    assertDataPointersExistAndAreTokenable("Test.Event", schema, ["/foo", "/num", "/int"]);
  });

  await t.step("assertDataPointersExistAndAreTokenable rejects missing pointer", () => {
    assertThrows(
      () => assertDataPointersExistAndAreTokenable("Test.Event", schema, ["/missing"]),
      Error,
      "path not found",
    );
  });

  await t.step("assertDataPointersExistAndAreTokenable rejects object", () => {
    assertThrows(
      () => assertDataPointersExistAndAreTokenable("Test.Event", schema, ["/nested"]),
      Error,
      "must resolve to string/number",
    );
  });

  await t.step("assertDataPointersExistAndAreTokenable rejects array", () => {
    assertThrows(
      () => assertDataPointersExistAndAreTokenable("Test.Event", schema, ["/arr"]),
      Error,
      "must resolve to string/number",
    );
  });

  await t.step("assertDataPointersExistAndAreTokenable rejects boolean", () => {
    assertThrows(
      () => assertDataPointersExistAndAreTokenable("Test.Event", schema, ["/bool"]),
      Error,
      "must resolve to string/number",
    );
  });

  await t.step("assertDataPointersExistAndAreTokenable rejects nullable union", () => {
    assertThrows(
      () => assertDataPointersExistAndAreTokenable("Test.Event", schema, ["/nullable"]),
      Error,
      "must resolve to string/number",
    );
  });

  await t.step("emitted contract constructs subject from params", () => {
    const contract = defineContract({
      id: "test@v1",
      displayName: "Pointer Test",
      description: "Validate schema pointer tokenization during event emission.",
      kind: "service",
      events: {
        "Test.Subject": {
          version: "v1",
          params: ["/foo"],
          eventSchema: schema,
          capabilities: { publish: [], subscribe: [] },
        },
      },
    }).CONTRACT;
    assertEquals(contract.events?.["Test.Subject"]?.subject, "events.v1.Test.Subject.{/foo}");
  });
});
