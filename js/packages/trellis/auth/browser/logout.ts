import { clearSessionKey } from "./session.ts";

/** Browser-specific options for the Auth.Sessions.Logout RPC. */
export type BrowserLogoutInput = {
  browser?: {
    returnTo?: string;
    includeProviderLogout?: boolean;
    federatedProviderLogout?: boolean;
  };
};

/** Minimal browser logout response shape returned by Auth.Sessions.Logout. */
export type BrowserLogoutResponse = {
  success: boolean;
  providerLogoutUrl?: string;
};

/** Arguments for completing a browser logout and navigating away. */
export type CompleteBrowserLogoutArgs = {
  logoutRequest: (input: BrowserLogoutInput) => Promise<BrowserLogoutResponse>;
  returnTo?: string;
  includeProviderLogout?: boolean;
  federatedProviderLogout?: boolean;
  location?: Pick<Location, "href">;
};

/**
 * Calls the logout RPC, clears the browser session key, then redirects away.
 */
export async function completeBrowserLogout(
  args: CompleteBrowserLogoutArgs,
): Promise<never> {
  let response: BrowserLogoutResponse | undefined;

  try {
    response = await args.logoutRequest(buildBrowserLogoutInput(args));
  } catch {
    response = undefined;
  } finally {
    try {
      await clearSessionKey();
    } catch {
      // Preserve logout completion in non-browser/test runtimes without IndexedDB.
    }
  }

  const target = response?.providerLogoutUrl ?? args.returnTo ?? "/";
  (args.location ?? globalThis.location).href = target;
  throw new Error("Redirecting after logout");
}

function buildBrowserLogoutInput(
  args: Pick<
    CompleteBrowserLogoutArgs,
    "returnTo" | "includeProviderLogout" | "federatedProviderLogout"
  >,
): BrowserLogoutInput {
  if (
    args.returnTo === undefined && args.includeProviderLogout === undefined &&
    args.federatedProviderLogout === undefined
  ) {
    return {};
  }

  return {
    browser: {
      ...(args.returnTo === undefined ? {} : { returnTo: args.returnTo }),
      ...(args.includeProviderLogout === undefined
        ? args.returnTo === undefined ? {} : { includeProviderLogout: true }
        : { includeProviderLogout: args.includeProviderLogout }),
      ...(args.federatedProviderLogout === undefined
        ? {}
        : { federatedProviderLogout: args.federatedProviderLogout }),
    },
  };
}
