/**
 * Tests for browser-safe exports.
 */

import { assertEquals, assertExists } from "@std/assert";
import { AsyncResult, isErr, isOk, Result } from "@trellis/result";

// Import everything from browser.ts to verify exports exist
import {
  // Error types
  AuthError,
  KVError,
  RemoteError,
  // Core Trellis class
  Trellis,
  type TrellisAuth,
  type TrellisErrorInstance,
  // KV exports
  TypedKV,
  TypedKVEntry,
  UnexpectedError,
  ValidationError,
  type WatchEvent,
  type WatchOptions,
} from "./browser.ts";

Deno.test("browser exports - Trellis class is exported", () => {
  assertExists(Trellis, "Trellis class should be exported");
  assertEquals(typeof Trellis, "function", "Trellis should be a constructor");
});

Deno.test("browser exports - TypedKV class is exported", () => {
  assertExists(TypedKV, "TypedKV class should be exported");
  assertEquals(typeof TypedKV, "function", "TypedKV should be a constructor");
});

Deno.test("browser exports - TypedKVEntry class is exported", () => {
  assertExists(TypedKVEntry, "TypedKVEntry class should be exported");
  assertEquals(
    typeof TypedKVEntry,
    "function",
    "TypedKVEntry should be a constructor",
  );
});

Deno.test("browser exports - Result utilities are exported", () => {
  assertExists(Result, "Result class should be exported");
  assertExists(isOk, "isOk function should be exported");
  assertExists(isErr, "isErr function should be exported");
  assertExists(AsyncResult, "AsyncResult class should be exported");

  assertEquals(typeof isOk, "function", "isOk should be a function");
  assertEquals(typeof isErr, "function", "isErr should be a function");
});

Deno.test("browser exports - Result utilities work correctly", () => {
  const okResult = Result.ok(42);
  const errResult = Result.err(new UnexpectedError({}));

  // isOk/isErr work on Result instances
  assertEquals(isOk(okResult), true, "isOk should return true for ok results");
  assertEquals(
    isErr(errResult),
    true,
    "isErr should return true for err results",
  );

  // isErr also works on take() output for early return pattern
  const errValue = errResult.take();
  assertEquals(isErr(errValue), true, "isErr should work on take() output");

  const okValue = okResult.take();
  assertEquals(
    isErr(okValue),
    false,
    "isErr should return false for ok take() values",
  );
});

Deno.test("browser exports - Error types are exported", () => {
  assertExists(AuthError, "AuthError should be exported");
  assertExists(ValidationError, "ValidationError should be exported");
  assertExists(RemoteError, "RemoteError should be exported");
  assertExists(KVError, "KVError should be exported");
  assertExists(UnexpectedError, "UnexpectedError should be exported");

  assertEquals(
    typeof AuthError,
    "function",
    "AuthError should be a constructor",
  );
  assertEquals(
    typeof ValidationError,
    "function",
    "ValidationError should be a constructor",
  );
  assertEquals(
    typeof RemoteError,
    "function",
    "RemoteError should be a constructor",
  );
  assertEquals(typeof KVError, "function", "KVError should be a constructor");
  assertEquals(
    typeof UnexpectedError,
    "function",
    "UnexpectedError should be a constructor",
  );

  type _TestTrellisErrorInstance = TrellisErrorInstance;
});

Deno.test("browser exports - Error types can be instantiated", () => {
  const authErr = new AuthError({ reason: "invalid_request" });
  const validationErr = new ValidationError({
    errors: [{ path: "field", message: "required" }],
  });
  const kvErr = new KVError({ operation: "get" });
  const unexpectedErr = new UnexpectedError({});

  assertExists(authErr, "AuthError should be instantiable");
  assertExists(validationErr, "ValidationError should be instantiable");
  assertExists(kvErr, "KVError should be instantiable");
  assertExists(unexpectedErr, "UnexpectedError should be instantiable");
});

// Type-level tests (these compile if types are correctly exported)
Deno.test("browser exports - types compile correctly", () => {
  // These type annotations verify the types are exported
  const _auth: TrellisAuth = {
    sessionKey: "test",
    sign: async (_data: Uint8Array) => new Uint8Array(),
  };

  // WatchEvent and WatchOptions are type-only exports, so we just verify they compile
  const _watchEvent: WatchEvent<typeof import("typebox").Type.String> = {
    type: "update",
    key: "test",
    value: "value",
    revision: 1,
    timestamp: new Date(),
  };

  const _watchOpts: WatchOptions = {
    includeDeletes: true,
  };

  assertEquals(true, true, "Types should compile without errors");
});
