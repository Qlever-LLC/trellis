import { TrellisClient } from "@qlever-llc/trellis";
import {
  createAuthState,
  createDeviceActivationController,
} from "@qlever-llc/trellis-svelte";
import { contract } from "$lib/contract";
import { trellisUrl } from "$lib/config";

/**
 * Creates the device activation controller used by the portal route.
 */
export function createPortalDeviceActivationController() {
  const authState = createAuthState({
    authUrl: trellisUrl,
    loginPath: "/_trellis/portal/users/login",
    contract,
  });

  return createDeviceActivationController({
    authState,
    createClient: async (authUrlState) => {
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
    },
    sessionStorage:
      typeof window === "undefined" ? undefined : window.sessionStorage,
  });
}
