import { equal } from "node:assert/strict";
import { isRecoverableConsoleAuthError } from "./auth_recovery.ts";

declare const Deno: { test(name: string, fn: () => void): void };

Deno.test("isRecoverableConsoleAuthError identifies bootstrap not_ready with insufficient_permissions", () => {
  equal(
    isRecoverableConsoleAuthError({
      code: "trellis.bootstrap.not_ready",
      context: { reason: "insufficient_permissions" },
    }),
    true,
  );
});

Deno.test("isRecoverableConsoleAuthError identifies bootstrap auth_required", () => {
  equal(
    isRecoverableConsoleAuthError({
      code: "trellis.bootstrap.auth_required",
    }),
    true,
  );
});

Deno.test("isRecoverableConsoleAuthError identifies auth bind_expired", () => {
  equal(
    isRecoverableConsoleAuthError({
      code: "trellis.auth.bind_expired",
    }),
    true,
  );
});

Deno.test("isRecoverableConsoleAuthError identifies session_not_found in context reason", () => {
  equal(
    isRecoverableConsoleAuthError({
      code: "trellis.runtime.session_not_found",
      context: { reason: "session_not_found" },
    }),
    true,
  );
});

Deno.test("isRecoverableConsoleAuthError identifies flow_expired in message", () => {
  equal(
    isRecoverableConsoleAuthError({
      code: "trellis.auth.bind_failed",
      message: "Bind failed: flow_expired",
    }),
    true,
  );
});

Deno.test("isRecoverableConsoleAuthError does not classify insufficient_capabilities as recoverable", () => {
  equal(
    isRecoverableConsoleAuthError({
      code: "trellis.auth.insufficient_capabilities",
      context: { missingCapabilities: ["admin"] },
    }),
    false,
  );
});

Deno.test("isRecoverableConsoleAuthError does not classify random transport errors as recoverable", () => {
  equal(
    isRecoverableConsoleAuthError({
      code: "trellis.runtime.connect_failed",
      message: "Connection refused",
    }),
    false,
  );
});

Deno.test("isRecoverableConsoleAuthError returns false for non-objects", () => {
  equal(isRecoverableConsoleAuthError("error string"), false);
  equal(isRecoverableConsoleAuthError(null), false);
  equal(isRecoverableConsoleAuthError(undefined), false);
});
