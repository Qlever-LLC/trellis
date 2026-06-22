import { assertEquals } from "@std/assert";

import {
  type BrowserAuthRecoveryClassification,
  classifyBrowserAuthError,
  isRecoverableBrowserAuthError,
} from "./browser.ts";
import { AuthError, RemoteError, TransportError } from "../errors/index.ts";

function assertClassification(
  error: unknown,
  expected: Pick<BrowserAuthRecoveryClassification, "kind" | "recoverable">,
): void {
  const classification = classifyBrowserAuthError(error);
  assertEquals(classification.kind, expected.kind);
  assertEquals(classification.recoverable, expected.recoverable);
  assertEquals(isRecoverableBrowserAuthError(error), expected.recoverable);
}

Deno.test("classifyBrowserAuthError treats bind expiration as a recoverable expired flow", () => {
  assertClassification(
    new TransportError({
      code: "trellis.auth.bind_expired",
      message: "The Trellis sign-in step expired.",
      hint: "Start the sign-in flow again.",
    }),
    { kind: "recoverable_expired_flow", recoverable: true },
  );
});

Deno.test("classifyBrowserAuthError treats missing session reason as stale session recovery", () => {
  assertClassification(
    new TransportError({
      code: "trellis.bootstrap.failed",
      message: "Trellis could not prepare the client session.",
      hint: "Retry the connection.",
      context: { reason: "session_not_found" },
    }),
    { kind: "recoverable_stale_session", recoverable: true },
  );
});

Deno.test("classifyBrowserAuthError treats expired session reason as stale session recovery", () => {
  assertClassification(
    new RemoteError({
      error: new AuthError({
        reason: "session_expired",
      }).toSerializable(),
    }),
    { kind: "recoverable_stale_session", recoverable: true },
  );
});

Deno.test("classifyBrowserAuthError treats flow_expired as recoverable expired flow", () => {
  assertClassification(
    {
      type: "TransportError",
      code: "trellis.auth.login_failed",
      message: "Trellis sign-in did not complete.",
      context: { reason: "flow_expired" },
    },
    { kind: "recoverable_expired_flow", recoverable: true },
  );
});

Deno.test("classifyBrowserAuthError does not recover explicit approval denial", () => {
  assertClassification(
    new TransportError({
      code: "trellis.auth.approval_denied",
      message: "Trellis sign-in did not complete.",
      hint: "Start sign-in again if you want to approve access.",
      context: { reason: "approval_denied" },
    }),
    { kind: "policy_denied", recoverable: false },
  );
});

Deno.test("classifyBrowserAuthError does not silently recover insufficient capabilities", () => {
  assertClassification(
    new TransportError({
      code: "trellis.auth.insufficient_capabilities",
      message: "The signed-in Trellis account lacks required capabilities.",
      hint: "Ask an administrator to grant the missing capabilities.",
      context: { missingCapabilities: ["workspace.read"] },
    }),
    { kind: "insufficient_capabilities", recoverable: false },
  );
});

Deno.test("classifyBrowserAuthError treats bootstrap not_ready as runtime unavailable", () => {
  assertClassification(
    new TransportError({
      code: "trellis.bootstrap.not_ready",
      message: "Trellis is not ready to connect this client.",
      hint: "Wait for app access to become available.",
      context: { reason: "insufficient_permissions" },
    }),
    { kind: "runtime_unavailable", recoverable: false },
  );
});

Deno.test("classifyBrowserAuthError follows nested causes and cause messages", () => {
  assertClassification(
    new Error("wrapper", {
      cause: {
        code: "trellis.bootstrap.failed",
        context: { causeMessage: "Session expired while reconnecting." },
      },
    }),
    { kind: "recoverable_stale_session", recoverable: true },
  );
});
