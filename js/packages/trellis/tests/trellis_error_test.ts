import { assert, assertEquals } from "@std/assert";
import {
  ValidationError,
  RemoteError,
  AuthError,
} from "../errors/index.ts";
import { Result, UnexpectedError } from "../../result/mod.ts";

Deno.test("Verify errors serialize and validate", async (t) => {
  await t.step("UnexpectedError", () => {
    const error = new UnexpectedError({ context: { userId: "123" } });
    const json = error.toJSON();

    const result = RemoteError.parseJSON(json);
    const value = result.take();
    assert(!Result.isErr(value), "Expected successful parse");

    assertEquals(value.type, "UnexpectedError");
    assertEquals(value.message, "An unexpected error has occurred");
    assertEquals(value.context, { userId: "123" });
  });

  await t.step("AuthError", () => {
    const error = new AuthError({ reason: "invalid_request" });
    const json = error.toJSON();

    const result = RemoteError.parseJSON(json);
    const value = result.take();
    assert(!Result.isErr(value), "Expected successful parse");

    assertEquals(value.type, "AuthError");
    assertEquals(value.message, "Auth failed: invalid_request");
    if (value.type === "AuthError") {
      assertEquals(value.reason, "invalid_request");
    }
  });

  await t.step("ValidationError", () => {
    const error = new ValidationError({
      errors: [
        { path: "/email", message: "Invalid email format" },
        { path: "/age", message: "Must be a number" },
      ],
    });
    const json = error.toJSON();

    const result = RemoteError.parseJSON(json);
    const value = result.take();
    assert(!Result.isErr(value), "Expected successful parse");

    assertEquals(value.type, "ValidationError");
    if (value.type === "ValidationError") {
      assertEquals(value.issues.length, 2);
      assertEquals(value.issues[0].path, "/email");
      assertEquals(value.issues[0].message, "Invalid email format");
    }
  });

  await t.step("returns error on invalid JSON", () => {
    const result = RemoteError.parseJSON("{ invalid json }");
    assert(result.isErr(), "Expected parse to fail");
    const value = result.take();
    assert(Result.isErr(value));
    assertEquals(value.error.name, "UnexpectedError");
  });

  await t.step("returns error on data that doesn't match schema", () => {
    const invalidData = JSON.stringify({
      id: "123",
      type: "UnknownErrorType",
      message: "Some message",
    });

    const result = RemoteError.parseJSON(invalidData);
    assert(result.isErr(), "Expected parse to fail");
    const value = result.take();
    assert(Result.isErr(value));
    assertEquals(value.error.name, "ValidationError");
  });

  await t.step("returns error on missing required fields", () => {
    const invalidData = JSON.stringify({
      type: "UnexpectedError",
    });

    const result = RemoteError.parseJSON(invalidData);
    assert(result.isErr(), "Expected parse to fail");
    const value = result.take();
    assert(Result.isErr(value));
    assertEquals(value.error.name, "ValidationError");
  });
});

Deno.test("Type narrowing", async (t) => {
  await t.step("enables type narrowing based on type field", () => {
    const error = new AuthError({ reason: "forbidden" });
    const json = error.toJSON();
    const result = RemoteError.parseJSON(json);
    const value = result.take();

    assert(!Result.isErr(value), "Expected successful parse");

    if (value.type === "AuthError") {
      assertEquals(value.reason, "forbidden");
    } else if (value.type === "ValidationError") {
      assert(false, "Should not reach this branch");
    } else if (value.type === "UnexpectedError") {
      assert(false, "Should not reach this branch");
    } else if (value.type === "KVError") {
      assert(false, "Should not reach this branch");
    }
  });
});

Deno.test("RemoteError - Wrapper pattern", async (t) => {
  await t.step("wraps remote AuthError", () => {
    const remoteError = new AuthError({
      reason: "invalid_request",
      context: { requestId: "req-123" },
    });
    const json = remoteError.toJSON();

    const result = RemoteError.parseJSON(json);
    const value = result.take();
    assert(!Result.isErr(value), "Expected successful parse");

    const wrappedError = new RemoteError({ error: value });

    assertEquals(wrappedError.name, "RemoteError");
    assertEquals(
      wrappedError.message,
      "Remote error: Auth failed: invalid_request",
    );
    assertEquals(wrappedError.remoteError.type, "AuthError");

    if (wrappedError.remoteError.type === "AuthError") {
      assertEquals(wrappedError.remoteError.reason, "invalid_request");
    }
  });

  await t.step("wraps remote ValidationError", () => {
    const remoteError = new ValidationError({
      errors: [
        { path: "/phoneNumber", message: "Required field" },
      ],
    });
    const json = remoteError.toJSON();

    const result = RemoteError.parseJSON(json);
    const value = result.take();
    assert(!Result.isErr(value), "Expected successful parse");

    const wrappedError = new RemoteError({ error: value });

    if (wrappedError.remoteError.type === "ValidationError") {
      assertEquals(wrappedError.remoteError.issues.length, 1);
      assertEquals(wrappedError.remoteError.issues[0].path, "/phoneNumber");
    }
  });

  await t.step("can add local context to wrapper", () => {
    const remoteError = new UnexpectedError();
    const json = remoteError.toJSON();
    const result = RemoteError.parseJSON(json);
    const value = result.take();
    assert(!Result.isErr(value), "Expected successful parse");

    const wrappedError = new RemoteError({
      error: value,
      context: { serviceUrl: "https://api.example.com" },
    });

    const serialized = wrappedError.toSerializable();
    assertEquals(serialized.context, { serviceUrl: "https://api.example.com" });
  });

  await t.step("serializes with embedded remote error", () => {
    const remoteError = new AuthError({ reason: "forbidden" });
    const json = remoteError.toJSON();
    const result = RemoteError.parseJSON(json);
    const value = result.take();
    assert(!Result.isErr(value), "Expected successful parse");

    const wrappedError = new RemoteError({ error: value });
    const serialized = wrappedError.toSerializable();

    assertEquals(serialized.type, "RemoteError");
    assertEquals(serialized.remoteError.type, "AuthError");

    if (serialized.remoteError.type === "AuthError") {
      assertEquals(serialized.remoteError.reason, "forbidden");
    }
  });

  await t.step("Full remote error handling flow", () => {
    const originalError = new ValidationError({
      errors: [{ path: "/name", message: "Required field" }],
    });

    const json = originalError.toJSON();

    const result = RemoteError.parseJSON(json);
    const value = result.take();
    assert(!Result.isErr(value), "Expected successful parse");

    const wrappedError = new RemoteError({
      error: value,
      context: { receivedFrom: "service-a" },
    });

    try {
      throw wrappedError;
    } catch (e) {
      assert(e instanceof RemoteError);

      if (e.remoteError.type === "ValidationError") {
        assertEquals(e.remoteError.issues[0].message, "Required field");
      }

      const logData = e.toSerializable();
      assertEquals(logData.type, "RemoteError");
      assertEquals(logData.remoteError.type, "ValidationError");
    }
  });
});
