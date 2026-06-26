import { resolve } from "$app/paths";
import {
  bindFlow,
  type BindResponse,
  clearSessionKey,
  completeSessionLogout,
  getOrCreateSessionKey,
  type SessionKeyHandle,
} from "@qlever-llc/trellis/auth/browser";
import { startAuthRequest } from "@qlever-llc/trellis/auth";
import contract from "../../contract.ts";
import { APP_CONFIG, buildAppCallbackUrl, buildAppLoginUrl } from "./config.ts";

type AuthCallbackResult =
  | BindResponse
  | { status: "approval_denied" }
  | { status: "approval_required" }
  | { status: "error"; code?: string; message: string };

/** Converts auth callback reason codes into console-facing messages. */
export function formatConsoleAuthError(error: string): string {
  switch (error) {
    case "approval_denied":
      return "App access was denied.";
    case "flow_expired":
      return "This sign-in request expired. Start sign-in again.";
    default:
      return error;
  }
}

class ConsoleAuthState {
  #authUrl: string | undefined = APP_CONFIG.authUrl;
  #handle: SessionKeyHandle | null = null;

  setAuthUrl(authUrl: string): void {
    this.#authUrl = authUrl;
  }

  async init(): Promise<SessionKeyHandle> {
    this.#handle ??= await getOrCreateSessionKey();
    return this.#handle;
  }

  async handleCallback(
    callbackUrl: string,
  ): Promise<AuthCallbackResult | null> {
    const url = new URL(callbackUrl);
    const authError = url.searchParams.get("authError");
    if (authError === "approval_denied") {
      return { status: "approval_denied" };
    }
    if (authError) {
      return {
        status: "error",
        code: authError,
        message: formatConsoleAuthError(authError),
      };
    }

    const flowId = url.searchParams.get("flowId");
    if (!flowId) return null;

    try {
      return await bindFlow(
        { authUrl: this.#requireAuthUrl() },
        await this.init(),
        flowId,
      );
    } catch (error) {
      return {
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async signIn(
    options: { authUrl?: string; redirectTo: string },
  ): Promise<never> {
    if (options.authUrl) {
      this.setAuthUrl(options.authUrl);
    }

    const response = await startAuthRequest({
      authUrl: this.#requireAuthUrl(),
      redirectTo: options.redirectTo,
      handle: await this.init(),
      contract: contract.CONTRACT,
    });

    if (response.status === "flow_started") {
      window.location.href = response.loginUrl;
      throw new Error("Redirecting to auth for provider selection");
    }

    if (response.status === "bound") {
      window.location.href = options.redirectTo;
      throw new Error("Redirecting to signed-in app");
    }

    throw new Error("Authentication completed without a browser redirect");
  }

  async signOut(): Promise<never> {
    const returnTo = buildConsoleLoginUrl({
      redirectTo: "/profile",
      authUrl: this.#authUrl,
    });

    return await completeSessionLogout({
      authUrl: this.#requireAuthUrl(),
      handle: await this.init(),
      returnTo,
      providerLogout: true,
    });
  }

  async resetSession(): Promise<void> {
    this.#handle = null;
    await clearSessionKey();
  }

  #requireAuthUrl(): string {
    if (!this.#authUrl) {
      throw new Error("Trellis auth URL is required.");
    }
    return this.#authUrl;
  }
}

export const auth = new ConsoleAuthState();

function toUrl(location: URL | Location): URL {
  return location instanceof URL
    ? new URL(location.toString())
    : new URL(location.href);
}

export function resolveConsolePath(
  path: string,
  location: URL | Location = globalThis.location,
): string {
  const url = new URL(path, toUrl(location));
  const appBase = resolve("/").replace(/\/$/, "");
  const currentUrl = toUrl(location);

  if (url.origin !== currentUrl.origin) {
    return url.toString();
  }

  if (appBase && url.pathname === appBase) {
    return `${appBase}/${url.search}${url.hash}`;
  }

  if (appBase && url.pathname.startsWith(`${appBase}/`)) {
    return `${appBase}${
      url.pathname.slice(appBase.length)
    }${url.search}${url.hash}`;
  }

  return `${appBase}${url.pathname}${url.search}${url.hash}`;
}

export function getConsoleRedirectTarget(
  location: URL | Location = globalThis.location,
  fallback = "/profile",
): string {
  const currentUrl = toUrl(location);
  const redirectTo = currentUrl.searchParams.get("redirectTo");
  if (!redirectTo) {
    return resolveConsolePath(fallback, currentUrl);
  }

  const redirectUrl = new URL(redirectTo, currentUrl);
  if (redirectUrl.origin !== currentUrl.origin) {
    return resolveConsolePath(fallback, currentUrl);
  }

  return resolveConsolePath(
    redirectTo,
    currentUrl,
  );
}

export function buildConsoleLoginUrl(options: {
  redirectTo: string;
  location?: URL | Location;
  authError?: string;
  authUrl?: string;
}): string {
  const location = options.location ?? globalThis.location;
  return buildAppLoginUrl(
    resolveConsolePath(options.redirectTo, location),
    location,
    options.authError,
    options.authUrl,
    resolve("/login"),
  );
}

export function buildConsoleCallbackUrl(options: {
  redirectTo: string;
  location?: URL | Location;
  authUrl?: string;
}): string {
  const location = options.location ?? globalThis.location;
  return buildAppCallbackUrl(
    resolveConsolePath(options.redirectTo, location),
    location,
    options.authUrl,
    resolve("/callback"),
  );
}

export async function startConsoleSignIn(options: {
  authUrl?: string;
  redirectTo: string;
  location?: URL | Location;
}): Promise<never> {
  return await auth.signIn({
    authUrl: options.authUrl,
    redirectTo: buildConsoleCallbackUrl(options),
  });
}
