import { assertEquals, assertThrows } from "@std/assert";
import { Type } from "typebox";
import { Value } from "typebox/value";

import {
  buildCursorPage,
  buildPageResponse,
  type CursorPageResponseSchema,
  CursorPageSchema,
  CursorQuerySchema,
  normalizeCursorQuery,
  normalizePageQuery,
} from "./protocol.ts";

Deno.test("cursor query schema accepts cursor and optional limit", () => {
  assertEquals(Value.Check(CursorQuerySchema, {}), true);
  assertEquals(
    Value.Check(CursorQuerySchema, { cursor: "after_1", limit: 25 }),
    true,
  );
  assertEquals(Value.Check(CursorQuerySchema, { cursor: "" }), false);
  assertEquals(Value.Check(CursorQuerySchema, { limit: -1 }), false);
  assertEquals(Value.Check(CursorQuerySchema, { limit: 1.5 }), false);
});

Deno.test("cursor page schema wraps typed items and page info", () => {
  const itemSchema = Type.Object({ id: Type.String() });
  const schema: CursorPageResponseSchema<typeof itemSchema> = CursorPageSchema(
    itemSchema,
  );

  assertEquals(
    Value.Check(schema, { items: [{ id: "item_1" }], page: {} }),
    true,
  );
  assertEquals(
    Value.Check(schema, {
      items: [{ id: "item_1" }],
      page: { nextCursor: "item_1" },
    }),
    true,
  );
  assertEquals(
    Value.Check(schema, {
      items: [{ id: "item_1" }],
      page: { nextCursor: "" },
    }),
    false,
  );
  assertEquals(Value.Check(schema, { page: {} }), false);
});

Deno.test("buildCursorPage omits next cursor when none is provided", () => {
  assertEquals(buildCursorPage([{ id: "item_1" }]), {
    items: [{ id: "item_1" }],
    page: {},
  });
});

Deno.test("buildCursorPage includes next cursor when provided", () => {
  assertEquals(buildCursorPage([{ id: "item_1" }], "item_1"), {
    items: [{ id: "item_1" }],
    page: { nextCursor: "item_1" },
  });
});

Deno.test("normalizeCursorQuery defaults limit and preserves cursor", () => {
  assertEquals(normalizeCursorQuery({}), { limit: 100 });
  assertEquals(normalizeCursorQuery({ cursor: "after_1" }), {
    cursor: "after_1",
    limit: 100,
  });
  assertEquals(normalizeCursorQuery({}, { defaultLimit: 25 }), { limit: 25 });
});

Deno.test("normalizeCursorQuery rejects limits above the maximum", () => {
  assertThrows(
    () => normalizeCursorQuery({ limit: 501 }),
    RangeError,
    "list limit must be <= 500",
  );
  assertEquals(normalizeCursorQuery({ limit: 501 }, { maxLimit: 600 }), {
    limit: 501,
  });
});

Deno.test("normalizeCursorQuery rejects empty cursor values", () => {
  assertThrows(
    () => normalizeCursorQuery({ cursor: "" }),
    RangeError,
    "list cursor must be a non-empty string",
  );
});

Deno.test("offset pagination helpers keep existing behavior", () => {
  assertEquals(normalizePageQuery({ limit: 2 }), { offset: 0, limit: 2 });
  assertEquals(buildPageResponse(["a", "b"], 3, { limit: 2 }), {
    entries: ["a", "b"],
    count: 3,
    offset: 0,
    limit: 2,
    nextOffset: 2,
  });
});
