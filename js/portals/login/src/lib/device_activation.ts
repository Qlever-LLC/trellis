import {
  bindFlow,
  getOrCreateSessionKey,
  TrellisClient,
  type BindResponse,
  type SessionKeyHandle,
} from "@qlever-llc/trellis";
import { startAuthRequest } from "@qlever-llc/trellis/auth";
import {
  createDeviceActivationController,
  type DeviceActivationAuth,
  type DeviceActivationOperationRef,
} from "@qlever-llc/trellis-svelte";
import { contract } from "./contract.ts";
import { trellisUrl } from "./config.ts";

type DeviceActivationBindResult = Exclude<
  Awaited<ReturnType<DeviceActivationAuth["handleCallback"]>>,
  null
>;

type PortalAuthState = Omit<DeviceActivationAuth, "init"> & {
  init(): Promise<SessionKeyHandle>;
};

type ActivateDeviceOperationClient = {
  operation(operation: "Auth.ActivateDevice"): {
    input(input: { flowId: string }): {
      start(): {
        orThrow(): Promise<DeviceActivationOperationRef>;
      };
    };
  };
};

function mapBindResponse(response: BindResponse): DeviceActivationBindResult {
  if (response.status === "bound") return { status: "bound" };
  return {
    status: "insufficient_capabilities",
    missingCapabilities: response.missingCapabilities,
  };
}

function createPortalAuthState(): PortalAuthState {
  let handle: SessionKeyHandle | null = null;

  async function init(): Promise<SessionKeyHandle> {
    handle ??= await getOrCreateSessionKey();
    return handle;
  }

  return {
    init,
    async handleCallback(callbackUrl) {
      const flowId = new URL(callbackUrl).searchParams.get("flowId");
      if (!flowId) return null;

      try {
        return mapBindResponse(await bindFlow({ authUrl: trellisUrl }, await init(), flowId));
      } catch (error) {
        return {
          status: "error",
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },
    async signIn(options) {
      const redirectTo = new URL(
        options?.redirectTo ?? "/_trellis/portal/users/login",
        window.location.href,
      ).toString();
      const response = await startAuthRequest({
        authUrl: trellisUrl,
        redirectTo,
        handle: await init(),
        contract: contract.CONTRACT,
        context: options?.context,
      });

      if (response.status === "flow_started") {
        window.location.href = response.loginUrl;
        throw new Error("Redirecting to auth for provider selection");
      }

      if (response.status === "bound") {
        window.location.href = redirectTo;
        throw new Error("Redirecting to device activation");
      }

      throw new Error("Authentication completed without a browser redirect");
    },
  };
}

/**
 * Creates the device activation controller used by the portal route.
 */
export function createPortalDeviceActivationController() {
  const authState = createPortalAuthState();

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
        onAuthRequired: () => ({ status: "handled" }),
        contract,
      }).orThrow();
      const operation = Reflect.get(trellis as object, "operation");
      if (typeof operation !== "function") {
        throw new TypeError("Connected Trellis client is missing operation support");
      }
      const activationClient: ActivateDeviceOperationClient = {
        operation: operation.bind(trellis),
      };

      return {
        async activateDevice(input): Promise<DeviceActivationOperationRef> {
          return await activationClient
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
