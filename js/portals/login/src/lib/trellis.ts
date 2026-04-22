import { TrellisClient } from "@qlever-llc/trellis";
import {
  createAuthState,
  createPortalFlow,
  type DeviceActivationClient,
  type DeviceActivationControllerConfig,
} from "@qlever-llc/trellis-svelte";
import contract from "../../contracts/portal_activation.ts";
export { trellisUrl } from "./config.ts";
import { trellisUrl } from "./config.ts";

type DeviceActivationAuthUrlState = Parameters<
  DeviceActivationControllerConfig["createClient"]
>[0];

export const loginPath = "/_trellis/portal/users/login";

function getCurrentPageUrl(): URL {
  return new URL(window.location.href);
}

export function createPortalLoginFlow() {
  return createPortalFlow({
    authUrl: trellisUrl,
    getUrl: getCurrentPageUrl,
  });
}

export function createPortalActivationAuthState() {
  return createAuthState({
    authUrl: trellisUrl,
    loginPath,
    contract,
  });
}

export async function connectPortalActivation(
  authState: ReturnType<typeof createPortalActivationAuthState>,
  authUrlState: DeviceActivationAuthUrlState,
): Promise<DeviceActivationClient> {
  const trellis = await TrellisClient.connect({
    trellisUrl,
    auth: {
      handle: await authState.init(),
      currentUrl: authUrlState.currentUrl,
      redirectTo: authUrlState.redirectTo,
    },
    contract,
  });

  return {
    activateDevice(input) {
      return trellis
        .operation("Auth.ActivateDevice")
        .input(input)
        .start()
        .orThrow();
    },
  };
}
