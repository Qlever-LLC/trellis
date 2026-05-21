import { equal } from "node:assert/strict";

import { errorMessage } from "./format.ts";

Deno.test("errorMessage prefers explicit server messages", () => {
  equal(
    errorMessage({
      getContext: () => ({ message: "Current password is incorrect." }),
      message: "Auth failed: invalid_request",
      reason: "invalid_request",
    }),
    "Current password is incorrect.",
  );
});

Deno.test("errorMessage renders auth reasons as actionable copy", () => {
  equal(
    errorMessage({ reason: "insufficient_permissions" }),
    "This Console session is missing permission for that action. Sign out and connect the Console again to approve the updated access.",
  );
  equal(
    errorMessage({ error: { remoteError: { reason: "session_not_found" } } }),
    "Your session has expired. Sign in again.",
  );
});
