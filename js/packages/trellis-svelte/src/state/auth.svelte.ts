import {
  type AuthStartResponse,
  bindFlow,
  type BindResponse,
  bindSession,
  clearSessionKey,
  getOrCreateSessionKey,
  getPublicSessionKey,
  startAuthRequest as browserStartAuthRequest,
  type SessionKeyHandle,
} from "@qlever-llc/trellis/auth/browser";
import { Result } from "@qlever-llc/result";
import type { TrellisClientContract } from "./trellis.svelte.ts";

type AuthContract = Pick<TrellisClientContract, "CONTRACT">;

export type BindErrorResult =
  | { status: "insufficient_capabilities"; missingCapabilities: string[] }
  | { status: "approval_required" }
  | { status: "approval_denied" }
  | { status: "error"; message: string };

export type BindResult = { status: "bound" } | BindErrorResult;

const STORAGE_KEY = "trellis_auth";
const AUTH_URL_STORAGE_KEY = "trellis_auth_url";

type AuthStateData = {
  handle: SessionKeyHandle | null;
};

function clearPersistedAuth(): void {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
}

export type AuthStateConfig = {
  authUrl?: string; // https://auth.example.com
  loginPath?: string;
  contract?: AuthContract;
};

export type SignInOptions = {
  authUrl?: string;
  redirectTo?: string;
  landingPath?: string;
  context?: unknown;
};

function normalizeAuthUrl(authUrl: string): string {
  return new URL(authUrl).toString().replace(/\/$/, "");
}

function loadPersistedAuthUrl(): string | null {
  if (typeof localStorage === "undefined") return null;
  const stored = localStorage.getItem(AUTH_URL_STORAGE_KEY);
  if (!stored) return null;

  return Result.try(() => normalizeAuthUrl(stored)).unwrapOr(null);
}

function persistAuthUrl(authUrl: string): string {
  const normalized = normalizeAuthUrl(authUrl);
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(AUTH_URL_STORAGE_KEY, normalized);
  }
  return normalized;
}

function resolveRedirectTo(
  options: SignInOptions,
  currentUrl: URL,
): string {
  if (options.redirectTo) {
    return new URL(options.redirectTo, currentUrl.origin).toString();
  }

  const queryRedirect = currentUrl.searchParams.get("redirectTo");
  if (queryRedirect) {
    return new URL(queryRedirect, currentUrl.origin).toString();
  }

  if (options.landingPath) {
    return new URL(options.landingPath, currentUrl.origin).toString();
  }

  return currentUrl.toString();
}

/**
 * Svelte 5 runes-based reactive authentication state.
 *
 * Manages session-key based authentication including:
 * - Session key generation and storage (IndexedDB/WebCrypto)
 * - OAuth sign-in flow initiation (signed)
  * - Callback handling (authToken in URL fragment) + bind
 * - Auth URL persistence and legacy auth cleanup
 */
export class AuthState {
  #state: AuthStateData = $state({
    handle: null,
  });

  #config: AuthStateConfig;
  #bindingInProgress: Promise<BindResult> | null = null;

  constructor(config: AuthStateConfig) {
    this.#config = {
      ...config,
      authUrl: config.authUrl ? normalizeAuthUrl(config.authUrl) : undefined,
    };
  }

  #getConfiguredAuthUrl(): string | null {
    if (this.#config.authUrl) return this.#config.authUrl;

    const persisted = loadPersistedAuthUrl();
    if (!persisted) return null;

    this.#config.authUrl = persisted;
    return persisted;
  }

  #requireAuthUrl(): string {
    const authUrl = this.#getConfiguredAuthUrl();
    if (!authUrl) {
      throw new Error("Auth URL is not configured");
    }
    return authUrl;
  }

  #requireContract(): AuthContract {
    const contract = this.#config.contract;
    if (!contract) {
      throw new Error("Auth contract is not configured");
    }
    return contract;
  }

  setAuthUrl(authUrl: string): string {
    const normalized = persistAuthUrl(authUrl);
    this.#config.authUrl = normalized;
    return normalized;
  }

  get handle(): SessionKeyHandle | null {
    return this.#state.handle;
  }
  get authUrl(): string | null {
    return this.#getConfiguredAuthUrl();
  }
  get loginPath(): string {
    return this.#config.loginPath ?? "/login";
  }
  get contract(): AuthContract | undefined {
    return this.#config.contract;
  }
  get sessionKey(): string | null {
    return this.#state.handle ? getPublicSessionKey(this.#state.handle) : null;
  }
  /**
   * Initialize the auth state by loading or creating a session key.
   */
  async init(): Promise<SessionKeyHandle> {
    if (this.#state.handle) return this.#state.handle;

    this.#getConfiguredAuthUrl();

    const handle = await getOrCreateSessionKey();
    this.#state.handle = handle;

    return handle;
  }

  /**
   * Initiate OAuth sign-in flow by redirecting to the auth provider.
   * This method does not return - it redirects the browser.
   */
  async signIn(options: SignInOptions = {}): Promise<never> {
    const currentUrl = new URL(window.location.href);
    const redirectTo = resolveRedirectTo(options, currentUrl);
    const response = await this.startAuthRequest({
      ...options,
      redirectTo,
    });
    window.location.href = response.status === "bound"
      ? redirectTo
      : response.loginUrl;
    throw new Error("Redirecting to auth for provider selection");
  }

  async startAuthRequest(options: SignInOptions = {}): Promise<AuthStartResponse> {
    const authUrl = options.authUrl
      ? this.setAuthUrl(options.authUrl)
      : this.#requireAuthUrl();
    const handle = await this.init();
    const currentUrl = new URL(window.location.href);
    const response = await browserStartAuthRequest({
      authUrl,
      redirectTo: resolveRedirectTo(options, currentUrl),
      handle,
      contract: this.#requireContract().CONTRACT,
      context: options.context,
    });

    return response;
  }

  async handleCallback(
    url: string = window.location.href,
  ): Promise<BindResult | null> {
    if (this.#bindingInProgress) return this.#bindingInProgress;

    const flowId = new URL(url).searchParams.get("flowId");
    if (!flowId) return null;

    this.#bindingInProgress = this.#resolveCallback(flowId);
    try {
      return await this.#bindingInProgress;
    } finally {
      this.#bindingInProgress = null;
    }
  }

  async #resolveCallback(flowId: string): Promise<BindResult> {
    try {
      const response = await this.bindFlow(flowId);
      return response.status === "bound" ? { status: "bound" } : {
        status: "insufficient_capabilities",
        missingCapabilities: response.missingCapabilities,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("approval_denied")) {
        return { status: "approval_denied" };
      }
      if (message.includes("approval_required")) {
        return { status: "approval_required" };
      }
      return { status: "error", message };
    }
  }

  /**
   * Clean up the callback URL by removing the auth flow query params.
   */
  cleanupCallbackUrl(url: string = window.location.href): string | null {
    const parsed = new URL(url);
    if (
      parsed.searchParams.has("flowId") || parsed.searchParams.has("authError")
    ) {
      parsed.searchParams.delete("flowId");
      parsed.searchParams.delete("authError");
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    }

    return null;
  }

  /**
   * Bind an authToken (returned from OAuth callback) to the session key.
   */
  async bind(authToken: string): Promise<BindResponse> {
    return this.#bind(authToken);
  }

  async #bind(authToken: string): Promise<BindResponse> {
    const handle = await this.init();
    return await bindSession(
      { authUrl: this.#requireAuthUrl() },
      handle,
      authToken,
    );
  }

  async bindFlow(flowId: string): Promise<BindResponse> {
    const handle = await this.init();
    return await bindFlow(
      { authUrl: this.#requireAuthUrl() },
      handle,
      flowId,
    );
  }

  /**
   * Clear persisted auth state without clearing session key or redirecting.
   * Use this when auth fails and you need to force re-authentication.
   */
  clearAuth(): void {
    clearPersistedAuth();
  }

  /**
   * Sign out by clearing all credentials and redirecting to login.
   * This method does not return - it redirects the browser.
   */
  async signOut(
    remoteLogout?: () => Promise<unknown> | unknown,
  ): Promise<never> {
    if (remoteLogout) {
      try {
        await remoteLogout();
      } catch {
        // Best-effort remote logout; local credential cleanup still proceeds.
      }
    }

    await clearSessionKey();
    this.clearAuth();
    this.#state.handle = null;

    window.location.href = this.loginPath;
    throw new Error("Signed out, redirecting to login");
  }
}

/**
 * Factory function to create an AuthState instance.
 */
export function createAuthState(config: AuthStateConfig): AuthState {
  return new AuthState(config);
}
