import { assertEquals } from "@std/assert";

import { AuthError } from "@qlever-llc/trellis";

import { mapDeviceActivationFailure } from "./activation_view.ts";

Deno.test("mapDeviceActivationFailure uses auth error context reasons for invalid links", () => {
  assertEquals(
    mapDeviceActivationFailure(
      "flow_123",
      new AuthError({
        reason: "invalid_request",
        context: { reason: "device_flow_not_found" },
      }),
    ),
    {
      mode: "invalid_flow",
      flowId: "flow_123",
      reason: "This activation link is no longer valid.",
    },
  );
});

Deno.test("mapDeviceActivationFailure uses auth error context reasons for expired links", () => {
  assertEquals(
    mapDeviceActivationFailure(
      "flow_123",
      new AuthError({
        reason: "invalid_request",
        context: { reason: "device_flow_expired" },
      }),
    ),
    {
      mode: "expired",
      flowId: "flow_123",
      reason: "The activation request expired. Start again from the auth service.",
    },
  );
});
