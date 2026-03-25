import { assert, assertEquals } from "@std/assert";
import {
  ValidationError,
  RemoteError,
  AuthError,
} from "../errors/index.ts";
import { Result } from "../../result/mod.ts";

Deno.test("AuthError", async (t) => {
  await t.step("serialization and validation", () => {
    const original = new AuthError({
      reason: "invalid_request",
      context: { userId: "123", endpoint: "/api/users" },
    });

    const json = original.toJSON();

    const result = RemoteError.parseJSON(json);
    const value = result.take();
    assert(!Result.isErr(value), "Expected successful parse");

    assertEquals(value.type, "AuthError");
    if (value.type === "AuthError") {
      assertEquals(value.id, original.id);
      assertEquals(value.reason, "invalid_request");
      assertEquals(value.context, { userId: "123", endpoint: "/api/users" });
    }
  });

  await t.step("serialization includes all fields", () => {
    const error = new AuthError({
      reason: "forbidden",
      context: { userId: "456" },
    });

    const serialized = error.toSerializable();

    assertEquals(serialized.id, error.id);
    assertEquals(serialized.type, "AuthError");
    assertEquals(serialized.message, "Auth failed: forbidden");
    assertEquals(serialized.reason, "forbidden");
    assertEquals(serialized.context, { userId: "456" });
  });
});

Deno.test("ValidationError", async (t) => {
  await t.step("serialization transforms errors to issues", () => {
    const original = new ValidationError({
      errors: [
        {
          path: "/email",
          message: "Invalid email format",
        },
        {
          path: "/password",
          message: "Password too short",
        },
      ],
      context: { requestId: "req-456" },
    });

    const serialized = original.toSerializable();

    assertEquals(serialized.issues.length, 2);
    assertEquals(serialized.issues[0], {
      path: "/email",
      message: "Invalid email format",
    });
    assertEquals(serialized.issues[1], {
      path: "/password",
      message: "Password too short",
    });
  });

  await t.step("serialization and validation", () => {
    const original = new ValidationError({
      errors: [
        {
          path: "/name",
          message: "Required field",
        },
      ],
    });

    const json = original.toJSON();
    const result = RemoteError.parseJSON(json);
    const value = result.take();
    assert(!Result.isErr(value), "Expected successful parse");

    assertEquals(value.type, "ValidationError");
    if (value.type === "ValidationError") {
      assertEquals(value.id, original.id);
      assertEquals(value.issues.length, 1);
      assertEquals(value.issues[0].path, "/name");
      assertEquals(value.issues[0].message, "Required field");
    }
  });
});


Deno.test("RemoteError", async (t) => {
  await t.step("wraps validated remote error", () => {
    const remoteError = new AuthError({
      reason: "invalid_request",
    });

    const json = remoteError.toJSON();
    const result = RemoteError.parseJSON(json);
    const value = result.take();
    assert(!Result.isErr(value), "Expected successful parse");

    const original = new RemoteError({
      error: value,
      context: { service: "auth" },
    });

    assertEquals(original.remoteError.type, "AuthError");
    if (original.remoteError.type === "AuthError") {
      assertEquals(original.remoteError.reason, "invalid_request");
    }

    const serialized = original.toSerializable();
    assertEquals(serialized.context, { service: "auth" });
    assertEquals(serialized.remoteError.type, "AuthError");
  });

  await t.step("serialization and validation", () => {
    const remoteError = new ValidationError({
      errors: [{ path: "/userId", message: "Required field" }],
    });
    const json = remoteError.toJSON();
    const result = RemoteError.parseJSON(json);
    const value = result.take();
    assert(!Result.isErr(value), "Expected successful parse");

    const wrapper = new RemoteError({
      error: value,
    });

    const wrapperJson = wrapper.toJSON();
    const parsed = JSON.parse(wrapperJson);

    assertEquals(parsed.type, "RemoteError");
    assertEquals(parsed.remoteError.type, "ValidationError");
    assertEquals(parsed.remoteError.issues[0].path, "/userId");
  });
});

Deno.test("Error - instance properties appear in serialization", () => {
  const error = new AuthError({
    reason: "invalid_request",
    context: { userId: "123" },
  });

  const serialized = error.toSerializable();

  assertEquals(serialized.id, error.id);
  assertEquals(serialized.type, "AuthError");
  assertEquals(serialized.message, "Auth failed: invalid_request");
  assertEquals(serialized.reason, "invalid_request");
  assertEquals(serialized.context, { userId: "123" });
});
