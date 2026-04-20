import { assertEquals } from "@std/assert";

import {
  buildActivationConnectAuthUrlState,
  buildActivationCallbackPath,
  clearPreservedActivationCallbackState,
  getPreservedActivationCallbackState,
  preserveActivationCallbackState,
  shouldHandleActivationAuthCallback,
} from "./page_state.ts";

function createStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  const values = new Map<string, string>();

  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

Deno.test("buildActivationCallbackPath adds explicit activation callback marker", () => {
  assertEquals(
    buildActivationCallbackPath(
      new URL("https://auth.example.com/_trellis/portal/devices/activate?flowId=device-flow#confirm"),
      "callback-token",
    ),
    "/_trellis/portal/devices/activate?portalCallback=callback-token#confirm",
  );
});

Deno.test("buildActivationConnectAuthUrlState keeps redirectTo but strips callback flow binding state", () => {
  const state = buildActivationConnectAuthUrlState(
    new URL(
      "https://auth.example.com/_trellis/portal/devices/activate?flowId=device-flow&portalCallback=callback-token&authError=approval_denied#confirm",
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

Deno.test("shouldHandleActivationAuthCallback only matches explicit callback markers", () => {
  assertEquals(
    shouldHandleActivationAuthCallback(
      new URL("https://auth.example.com/_trellis/portal/devices/activate?flowId=device-flow"),
      { flowId: "device-flow", callbackToken: "callback-token" },
    ),
    false,
  );

  assertEquals(
    shouldHandleActivationAuthCallback(
      new URL(
        "https://auth.example.com/_trellis/portal/devices/activate?portalCallback=callback-token&flowId=auth-flow",
      ),
      { flowId: "device-flow", callbackToken: "callback-token" },
    ),
    true,
  );

  assertEquals(
    shouldHandleActivationAuthCallback(
      new URL(
        "https://auth.example.com/_trellis/portal/devices/activate?portalCallback=callback-token",
      ),
      { flowId: "device-flow", callbackToken: "callback-token" },
    ),
    true,
  );
});

Deno.test("activation callback state round-trips through storage", () => {
  const storage = createStorage();
  clearPreservedActivationCallbackState(storage);

  preserveActivationCallbackState(storage, {
    flowId: "device-flow",
    callbackToken: "callback-token",
  });

  assertEquals(getPreservedActivationCallbackState(storage), {
    flowId: "device-flow",
    callbackToken: "callback-token",
  });

  clearPreservedActivationCallbackState(storage);
  assertEquals(getPreservedActivationCallbackState(storage), null);
});
