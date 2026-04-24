import { assertEquals } from "@std/assert";

import {
  buildDeviceActivationCallbackPath,
  buildDeviceActivationConnectAuthUrlState,
  cleanupDeviceActivationCallbackUrl,
  resolveDeviceActivationUrlState,
} from "./portal_url.ts";

Deno.test("buildDeviceActivationCallbackPath adds explicit activation callback marker", () => {
  assertEquals(
    buildDeviceActivationCallbackPath(
      new URL(
        "https://auth.example.com/_trellis/portal/devices/activate?flowId=device-flow#confirm",
      ),
      "callback-token",
    ),
    "/_trellis/portal/devices/activate?portalCallback=callback-token&deviceFlowId=device-flow#confirm",
  );
});

Deno.test("buildDeviceActivationConnectAuthUrlState keeps redirectTo but strips callback binding state", () => {
  const state = buildDeviceActivationConnectAuthUrlState(
    new URL(
      "https://auth.example.com/_trellis/portal/devices/activate?flowId=device-flow&portalCallback=callback-token&deviceFlowId=device-flow&authError=approval_denied#confirm",
    ),
  );

  assertEquals(
    state.currentUrl.toString(),
    "https://auth.example.com/_trellis/portal/devices/activate#confirm",
  );
  assertEquals(
    state.redirectTo,
    "https://auth.example.com/_trellis/portal/devices/activate?flowId=device-flow#confirm",
  );
});

Deno.test("cleanupDeviceActivationCallbackUrl preserves the activation flow id", () => {
  assertEquals(
    cleanupDeviceActivationCallbackUrl(
      new URL(
        "https://auth.example.com/_trellis/portal/devices/activate?portalCallback=callback-token&deviceFlowId=device-flow&authError=approval_denied#confirm",
      ),
      "device-flow",
    ),
    "/_trellis/portal/devices/activate?flowId=device-flow#confirm",
  );
});

Deno.test("resolveDeviceActivationUrlState restores flowId from callback URL fallback", () => {
  assertEquals(
    resolveDeviceActivationUrlState(
      new URL(
        "https://auth.example.com/_trellis/portal/devices/activate?portalCallback=callback-token&deviceFlowId=device-flow&flowId=auth-flow",
      ),
      null,
    ),
    { flowId: "device-flow", isAuthCallback: true },
  );
});

Deno.test("resolveDeviceActivationUrlState restores flowId from callback state", () => {
  assertEquals(
    resolveDeviceActivationUrlState(
      new URL(
        "https://auth.example.com/_trellis/portal/devices/activate?portalCallback=callback-token&flowId=auth-flow",
      ),
      { flowId: "device-flow", callbackToken: "callback-token" },
    ),
    { flowId: "device-flow", isAuthCallback: true },
  );
});
