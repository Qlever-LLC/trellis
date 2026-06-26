import { Value } from "typebox/value";

import {
  type AuthLogoutRequest,
  type AuthLogoutResponse,
  AuthLogoutResponseSchema,
} from "../schemas.ts";
import {
  clearSessionKey,
  logoutSessionSig,
  type SessionKeyHandle,
} from "./session.ts";

type LogoutLocation =
  & Pick<Location, "href">
  & Partial<Pick<Location, "assign">>;

export type CompleteSessionLogoutArgs = {
  authUrl: string;
  handle: SessionKeyHandle;
  returnTo?: string;
  providerLogout?: boolean;
  federatedProviderLogout?: boolean;
  location?: LogoutLocation;
};

export async function logoutSession(args: {
  authUrl: string;
  handle: SessionKeyHandle;
  returnTo?: string;
  providerLogout?: boolean;
  federatedProviderLogout?: boolean;
  responseMode?: "json";
  fetch?: typeof fetch;
}): Promise<AuthLogoutResponse> {
  const iat = Math.floor(Date.now() / 1000);
  const responseMode = args.responseMode ?? "json";
  const sig = await logoutSessionSig(args.handle, {
    iat,
    ...(args.providerLogout === undefined
      ? {}
      : { providerLogout: args.providerLogout }),
    ...(args.federatedProviderLogout === undefined
      ? {}
      : { federatedProviderLogout: args.federatedProviderLogout }),
    ...(args.returnTo === undefined ? {} : { returnTo: args.returnTo }),
    responseMode,
  });
  const body: AuthLogoutRequest = {
    sessionKey: args.handle.sessionKey,
    iat,
    sig,
    ...(args.providerLogout === undefined
      ? {}
      : { providerLogout: args.providerLogout }),
    ...(args.federatedProviderLogout === undefined
      ? {}
      : { federatedProviderLogout: args.federatedProviderLogout }),
    ...(args.returnTo === undefined ? {} : { returnTo: args.returnTo }),
    responseMode,
  };
  const fetchImpl = args.fetch ?? globalThis.fetch;
  const response = await fetchImpl(logoutUrl(args.authUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Logout request failed with HTTP ${response.status}`);
  }

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch (cause) {
    throw new Error("Logout response was not valid JSON", { cause });
  }
  if (!Value.Check(AuthLogoutResponseSchema, parsed)) {
    throw new Error("Logout response did not match expected schema");
  }
  return parsed;
}

export async function completeSessionLogout(
  args: CompleteSessionLogoutArgs,
): Promise<never> {
  let response: AuthLogoutResponse | undefined;

  try {
    response = await logoutSession(args);
  } catch {
    response = undefined;
  } finally {
    try {
      await clearSessionKey();
    } catch {
      // Preserve logout completion in non-browser/test runtimes without IndexedDB.
    }
  }

  const target = response?.redirectTo ?? args.returnTo ?? "/";
  const location = args.location ?? globalThis.location;
  if (typeof location.assign === "function") {
    location.assign(target);
  } else {
    location.href = target;
  }
  throw new Error("Redirecting after logout");
}

function logoutUrl(authUrl: string): string {
  return `${authUrl.replace(/\/+$/, "")}/auth/sessions/logout`;
}
