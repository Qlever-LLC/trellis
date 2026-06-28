import { assert, assertEquals, assertInstanceOf } from "@std/assert";
import { type TSchema, Type } from "typebox";
import { encode, encodeSchema, parse, parseSchema } from "../codec.ts";
import {
  SchemaValidationError,
  UnexpectedError,
  ValidationError,
} from "../errors/index.ts";
import { withTrellisValidation } from "../contract_support/mod.ts";
import { BUILTIN_RPC_ERRORS } from "../errors/index.ts";

// Retained unit coverage: pure error serialization and annotation parsing are
// function-level invariants. Over-wire schema failures are covered by TS/Rust
// live RPC matrix rows.

Deno.test("SchemaValidationError class", async (t) => {
  await t.step("constructor stores issues", () => {
    const issues = [
      {
        path: "/test",
        keyword: "minItems",
        code: "test.code",
        message: "Test message",
      },
    ];
    const error = new SchemaValidationError({ issues });
    assertEquals(error.issues, issues);
  });

  await t.step("get issues() returns the same instance", () => {
    const issues = [
      { path: "/a", keyword: "minItems", code: "a.code", message: "A" },
      { path: "/b", keyword: "minLength", code: "b.code", message: "B" },
    ];
    const error = new SchemaValidationError({ issues });
    assertEquals(error.issues, issues);
    assertEquals(error.issues.length, 2);
  });

  await t.step(
    "message is generated from issue messages joined by newline",
    () => {
      const error = new SchemaValidationError({
        issues: [
          {
            path: "/a",
            keyword: "minItems",
            code: "a",
            message: "First issue.",
          },
          {
            path: "/b",
            keyword: "minLength",
            code: "b",
            message: "Second issue.",
          },
        ],
      });
      assertEquals(error.message, "First issue.\nSecond issue.");
    },
  );

  await t.step("message falls back when issues array is empty", () => {
    const error = new SchemaValidationError({ issues: [] });
    assertEquals(error.message, "Schema validation failed.");
  });

  await t.step("toSerializable() produces correct schema shape", () => {
    const issues = [
      {
        path: "/title",
        keyword: "required",
        code: "title.required",
        message: "Title is required.",
      },
    ];
    const error = new SchemaValidationError({ issues });
    const serialized = error.toSerializable();

    assertEquals(serialized.type, "SchemaValidationError");
    assertEquals(typeof serialized.id, "string");
    assertEquals(typeof serialized.message, "string");
    assertEquals(serialized.issues, issues);
  });

  await t.step("toSerializable() preserves id from constructor", () => {
    const error = new SchemaValidationError({
      issues: [{ path: "/x", keyword: "minItems", code: "x", message: "X" }],
      id: "custom-id",
    });
    const serialized = error.toSerializable();
    assertEquals(serialized.id, "custom-id");
  });

  await t.step("error is reconstructible via BUILTIN_RPC_ERRORS", () => {
    const issues = [
      {
        path: "/test",
        keyword: "minItems",
        code: "test.code",
        message: "Test",
      },
    ];
    const original = new SchemaValidationError({ issues });
    const serialized = original.toSerializable();
    const reconstructed = BUILTIN_RPC_ERRORS.SchemaValidationError
      .fromSerializable(serialized);

    assertInstanceOf(reconstructed, SchemaValidationError);
    assertEquals(reconstructed.issues[0].code, "test.code");
    assertEquals(reconstructed.issues[0].path, "/test");
    assertEquals(reconstructed.issues[0].keyword, "minItems");
    assertEquals(reconstructed.issues[0].message, "Test");
  });
});

Deno.test("collectValidationIssues via parse", async (t) => {
  await t.step(
    "minItems with full annotation returns SchemaValidationError",
    () => {
      const schema = Type.Object({
        items: withTrellisValidation(
          Type.Array(Type.String(), { minItems: 1 }),
          {
            label: "Items",
            issues: {
              minItems: {
                code: "test.items.required",
                message: "Add at least one item.",
              },
            },
          },
        ),
      });
      const result = parse(schema as TSchema, { items: [] });

      assert(result.isErr());
      assertInstanceOf(result.error, SchemaValidationError);
      assertEquals(result.error.issues[0].code, "test.items.required");
      assertEquals(result.error.issues[0].keyword, "minItems");
      assertEquals(result.error.issues[0].label, "Items");
    },
  );

  await t.step(
    "two annotated minItems failures returns SchemaValidationError with two issues",
    () => {
      const schema = Type.Object({
        a: withTrellisValidation(Type.Array(Type.String(), { minItems: 1 }), {
          label: "A",
          issues: { minItems: { code: "test.a", message: "A required" } },
        }),
        b: withTrellisValidation(Type.Array(Type.String(), { minItems: 1 }), {
          label: "B",
          issues: { minItems: { code: "test.b", message: "B required" } },
        }),
      });
      const result = parse(schema as TSchema, { a: [], b: [] });

      assert(result.isErr());
      assertInstanceOf(result.error, SchemaValidationError);
      assertEquals(result.error.issues.length, 2);
    },
  );

  await t.step(
    "wrong type (structural) + annotated minItems returns ValidationError",
    () => {
      const schema = Type.Object({
        items: withTrellisValidation(
          Type.Array(Type.String(), { minItems: 1 }),
          {
            label: "Items",
            issues: { minItems: { code: "test.items", message: "Add items" } },
          },
        ),
      });
      const result = parse(schema as TSchema, { items: "not-an-array" });

      assert(result.isErr());
      assertInstanceOf(result.error, ValidationError);
      assert(!(result.error instanceof SchemaValidationError));
    },
  );

  await t.step("unannotated minLength returns ValidationError", () => {
    const schema = Type.Object({
      name: Type.String({ minLength: 3 }),
    });
    const result = parse(schema as TSchema, { name: "ab" });

    assert(result.isErr());
    assertInstanceOf(result.error, ValidationError);
    assert(!(result.error instanceof SchemaValidationError));
  });

  await t.step(
    "required field with annotation returns SchemaValidationError",
    () => {
      const schema = Type.Object({
        title: withTrellisValidation(Type.String(), {
          label: "Title",
          issues: {
            required: {
              code: "test.title.required",
              message: "Enter a title.",
            },
          },
        }),
      });
      const result = parse(schema as TSchema, {});

      assert(result.isErr());
      assertInstanceOf(result.error, SchemaValidationError);
      assertEquals(result.error.issues[0].code, "test.title.required");
    },
  );

  await t.step(
    "nested field with annotation returns SchemaValidationError with nested path",
    () => {
      const nameSchema = withTrellisValidation(Type.String({ minLength: 3 }), {
        label: "Name",
        issues: {
          minLength: {
            code: "test.name.too_short",
            message: "Name too short.",
          },
        },
      });
      const schema = Type.Object({
        nested: Type.Object({ name: nameSchema }),
      });
      const result = parse(schema as TSchema, { nested: { name: "ab" } });

      assert(result.isErr());
      assertInstanceOf(result.error, SchemaValidationError);
      assertEquals(result.error.issues[0].path, "/nested/name");
      assertEquals(result.error.issues[0].code, "test.name.too_short");
    },
  );

  await t.step("valid input returns ok", () => {
    const schema = Type.Object({
      items: withTrellisValidation(Type.Array(Type.String(), { minItems: 1 }), {
        label: "Items",
        issues: { minItems: { code: "test.items", message: "Add items" } },
      }),
    });
    const result = parse(schema as TSchema, { items: ["a"] });

    assert(result.isOk());
  });
});

Deno.test("parseSchema with validation annotation", async (t) => {
  await t.step("returns SchemaValidationError for annotated failure", () => {
    const schema = Type.Object({
      items: withTrellisValidation(Type.Array(Type.String(), { minItems: 1 }), {
        label: "Items",
        issues: { minItems: { code: "test.items.min", message: "Add items" } },
      }),
    });
    const result = parseSchema(schema, { items: [] });

    assert(result.isErr());
    assertInstanceOf(result.error, SchemaValidationError);
    assertEquals(result.error.issues[0].code, "test.items.min");
  });

  await t.step("returns ValidationError for unannotated failure", () => {
    const schema = Type.Object({
      name: Type.String({ minLength: 3 }),
    });
    const result = parseSchema(schema, { name: "ab" });

    assert(result.isErr());
    assertInstanceOf(result.error, ValidationError);
  });

  await t.step("returns ok for valid data", () => {
    const schema = Type.Object({
      name: Type.String({ minLength: 3 }),
    });
    const result = parseSchema(schema, { name: "valid" });

    assert(result.isOk());
  });
});

Deno.test("encode with validation annotation", async (t) => {
  await t.step(
    "encode returns SchemaValidationError for annotated failure",
    () => {
      const schema = Type.Object({
        items: withTrellisValidation(
          Type.Array(Type.String(), { minItems: 1 }),
          {
            label: "Items",
            issues: {
              minItems: {
                code: "test.items.min",
                message: "Add at least one item.",
              },
            },
          },
        ),
      });
      const result = encode(schema as TSchema, { items: [] });

      assert(result.isErr());
      assertInstanceOf(result.error, SchemaValidationError);
      assertEquals(result.error.issues[0].code, "test.items.min");
    },
  );
});

Deno.test("encodeSchema with validation annotation", async (t) => {
  await t.step("returns SchemaValidationError for annotated failure", () => {
    const schema = Type.Object({
      items: withTrellisValidation(Type.Array(Type.String(), { minItems: 1 }), {
        label: "Items",
        issues: { minItems: { code: "test.items.min", message: "Add items" } },
      }),
    });
    const result = encodeSchema(schema, { items: [] });

    assert(result.isErr());
    assertInstanceOf(result.error, SchemaValidationError);
    assertEquals(result.error.issues[0].code, "test.items.min");
  });
});

Deno.test("BUILTIN_RPC_ERRORS SchemaValidationError round-trip", async (t) => {
  await t.step("reconstructs error with single issue", () => {
    const original = new SchemaValidationError({
      issues: [{
        path: "/test",
        keyword: "minItems",
        code: "test.code",
        message: "Test",
      }],
    });
    const serialized = original.toSerializable();
    const reconstructed = BUILTIN_RPC_ERRORS.SchemaValidationError
      .fromSerializable(serialized);

    assertInstanceOf(reconstructed, SchemaValidationError);
    assertEquals(reconstructed.issues[0].code, "test.code");
    assertEquals(reconstructed.issues[0].path, "/test");
    assertEquals(reconstructed.issues[0].keyword, "minItems");
    assertEquals(reconstructed.issues[0].message, "Test");
  });

  await t.step("reconstructs error with multiple issues", () => {
    const original = new SchemaValidationError({
      issues: [
        { path: "/a", keyword: "minItems", code: "a", message: "A" },
        { path: "/b", keyword: "minLength", code: "b", message: "B" },
      ],
    });
    const serialized = original.toSerializable();
    const reconstructed = BUILTIN_RPC_ERRORS.SchemaValidationError
      .fromSerializable(serialized);

    assertInstanceOf(reconstructed, SchemaValidationError);
    assertEquals(reconstructed.issues.length, 2);
    assertEquals(reconstructed.issues[0].code, "a");
    assertEquals(reconstructed.issues[1].code, "b");
  });

  await t.step("reconstructs error with context and id", () => {
    const original = new SchemaValidationError({
      issues: [{ path: "/x", keyword: "required", code: "x", message: "X" }],
      context: { source: "handler" },
      id: "custom-id",
    });
    const serialized = original.toSerializable();
    const reconstructed = BUILTIN_RPC_ERRORS.SchemaValidationError
      .fromSerializable(serialized);

    assertInstanceOf(reconstructed, SchemaValidationError);
    assertEquals(reconstructed.issues[0].code, "x");
    assertEquals(serialized.id, "custom-id");
  });
});
