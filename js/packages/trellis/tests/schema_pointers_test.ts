import { assertEquals, assertThrows } from "@std/assert";
import { Type } from "typebox";
import { defineServiceContract } from "../contract_support/mod.ts";
import {
  assertDataPointersExistAndAreTokenable,
  getSubschemaAtDataPointer,
} from "../contract_support/schema_pointers.ts";

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

  function schemaRef<const TName extends keyof typeof schemas & string>(
    schema: TName,
  ) {
    return { schema } as const;
  }

  await t.step("getSubschemaAtDataPointer returns subschema", () => {
    const s = getSubschemaAtDataPointer(eventSchema, "/foo") as {
      type?: unknown;
    };
    assertEquals(s.type, "string");
  });

  await t.step(
    "getSubschemaAtDataPointer returns undefined for missing",
    () => {
      assertEquals(getSubschemaAtDataPointer(eventSchema, "/nope"), undefined);
    },
  );

  await t.step(
    "getSubschemaAtDataPointer returns first reachable union subschema",
    () => {
      const s = getSubschemaAtDataPointer({
        anyOf: [
          Type.Object({ origin: Type.String() }),
          Type.Object({ id: Type.String() }),
        ],
      }, "/origin") as { type?: unknown };
      assertEquals(s.type, "string");
    },
  );

  await t.step(
    "getSubschemaAtDataPointer keeps combinator-first traversal order",
    () => {
      const s = getSubschemaAtDataPointer({
        anyOf: [Type.Object({ origin: Type.String() })],
        properties: { origin: Type.Number() },
      }, "/origin") as { type?: unknown };
      assertEquals(s.type, "string");
    },
  );

  await t.step(
    "assertDataPointersExistAndAreTokenable accepts string/number/integer",
    () => {
      assertDataPointersExistAndAreTokenable("Test.Event", eventSchema, [
        "/foo",
        "/num",
        "/int",
      ]);
    },
  );

  await t.step(
    "assertDataPointersExistAndAreTokenable rejects missing pointer",
    () => {
      assertThrows(
        () =>
          assertDataPointersExistAndAreTokenable("Test.Event", eventSchema, [
            "/missing",
          ]),
        Error,
        "path not found",
      );
    },
  );

  await t.step("assertDataPointersExistAndAreTokenable rejects object", () => {
    assertThrows(
      () =>
        assertDataPointersExistAndAreTokenable("Test.Event", eventSchema, [
          "/nested",
        ]),
      Error,
      "must resolve to string/number",
    );
  });

  await t.step("assertDataPointersExistAndAreTokenable rejects array", () => {
    assertThrows(
      () =>
        assertDataPointersExistAndAreTokenable("Test.Event", eventSchema, [
          "/arr",
        ]),
      Error,
      "must resolve to string/number",
    );
  });

  await t.step("assertDataPointersExistAndAreTokenable rejects boolean", () => {
    assertThrows(
      () =>
        assertDataPointersExistAndAreTokenable("Test.Event", eventSchema, [
          "/bool",
        ]),
      Error,
      "must resolve to string/number",
    );
  });

  await t.step(
    "assertDataPointersExistAndAreTokenable rejects nullable union",
    () => {
      assertThrows(
        () =>
          assertDataPointersExistAndAreTokenable("Test.Event", eventSchema, [
            "/nullable",
          ]),
        Error,
        "must resolve to string/number",
      );
    },
  );

  await t.step(
    "assertDataPointersExistAndAreTokenable accepts top-level anyOf when all variants contain tokenable pointer",
    () => {
      assertDataPointersExistAndAreTokenable("Test.Event", {
        anyOf: [
          Type.Object({ origin: Type.String() }),
          Type.Object({ origin: Type.Number() }),
        ],
      }, ["/origin"]);
    },
  );

  await t.step(
    "assertDataPointersExistAndAreTokenable accepts top-level oneOf when all variants contain tokenable pointer",
    () => {
      assertDataPointersExistAndAreTokenable("Test.Event", {
        oneOf: [
          Type.Object({ origin: Type.String() }),
          Type.Object({ origin: Type.Integer() }),
        ],
      }, ["/origin"]);
    },
  );

  await t.step(
    "assertDataPointersExistAndAreTokenable rejects anyOf when a variant is missing pointer",
    () => {
      assertThrows(
        () =>
          assertDataPointersExistAndAreTokenable("Test.Event", {
            anyOf: [
              Type.Object({ origin: Type.String() }),
              Type.Object({ id: Type.String() }),
            ],
          }, ["/origin"]),
        Error,
        "path not found",
      );
    },
  );

  await t.step(
    "assertDataPointersExistAndAreTokenable rejects oneOf when a variant is missing pointer",
    () => {
      assertThrows(
        () =>
          assertDataPointersExistAndAreTokenable("Test.Event", {
            oneOf: [
              Type.Object({ origin: Type.String() }),
              Type.Object({ id: Type.String() }),
            ],
          }, ["/origin"]),
        Error,
        "path not found",
      );
    },
  );

  await t.step(
    "assertDataPointersExistAndAreTokenable rejects union variants with non-tokenable pointer",
    () => {
      for (
        const origin of [
          Type.Object({ id: Type.String() }),
          Type.Array(Type.String()),
          Type.Boolean(),
        ]
      ) {
        assertThrows(
          () =>
            assertDataPointersExistAndAreTokenable("Test.Event", {
              anyOf: [
                Type.Object({ origin: Type.String() }),
                Type.Object({ origin }),
              ],
            }, ["/origin"]),
          Error,
          "must resolve to string/number",
        );
      }
    },
  );

  await t.step(
    "assertDataPointersExistAndAreTokenable accepts nested pointers through union variants",
    () => {
      assertDataPointersExistAndAreTokenable("Test.Event", {
        anyOf: [
          Type.Object({
            partner: Type.Object({
              id: Type.Object({ origin: Type.String() }),
            }),
          }),
          Type.Object({
            partner: Type.Object({
              id: Type.Object({ origin: Type.Number() }),
            }),
          }),
        ],
      }, ["/partner/id/origin"]);
    },
  );

  await t.step(
    "assertDataPointersExistAndAreTokenable accepts allOf when one branch resolves pointer",
    () => {
      assertDataPointersExistAndAreTokenable("Test.Event", {
        allOf: [
          Type.Object({ origin: Type.String() }),
          Type.Object({ id: Type.String() }),
        ],
      }, ["/origin"]);
    },
  );

  await t.step(
    "assertDataPointersExistAndAreTokenable rejects allOf when a resolving branch is non-tokenable",
    () => {
      assertThrows(
        () =>
          assertDataPointersExistAndAreTokenable("Test.Event", {
            allOf: [
              Type.Object({ origin: Type.String() }),
              Type.Object({ origin: Type.Boolean() }),
            ],
          }, ["/origin"]),
        Error,
        "must resolve to string/number",
      );
    },
  );

  await t.step(
    "assertDataPointersExistAndAreTokenable rejects nested union constraints inside allOf",
    () => {
      assertThrows(
        () =>
          assertDataPointersExistAndAreTokenable("Test.Event", {
            allOf: [
              Type.Object({ origin: Type.String() }),
              {
                anyOf: [
                  Type.Object({ origin: Type.Number() }),
                  Type.Object({ origin: Type.Boolean() }),
                ],
              },
            ],
          }, ["/origin"]),
        Error,
        "must resolve to string/number",
      );
    },
  );

  await t.step("emitted contract constructs subject from params", () => {
    const contract = defineServiceContract(
      { schemas },
      () => ({
        id: "test@v1",
        displayName: "Pointer Test",
        description:
          "Validate schema pointer tokenization during event emission.",
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
    assertEquals(
      contract.events?.["Test.Subject"]?.subject,
      "events.v1.Test.Subject.{/foo}",
    );
  });
});
