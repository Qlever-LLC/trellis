import {
  type BindResponse,
  type BindSuccessResponse,
  bindSession,
  buildLoginUrl,
  clearSessionKey,
  extractAuthErrorFromFragment,
  extractAuthTokenFromFragment,
  getOrCreateSessionKey,
  getPublicSessionKey,
  type SentinelCreds,
  type SessionKeyHandle,
} from "@qlever-llc/trellis-auth";
import { Result } from "@qlever-llc/trellis-result";
import { SvelteDate } from "svelte/reactivity";
import { Type } from "typebox";
import { Value } from "typebox/value";

export type BindErrorResult =
  | { status: "insufficient_capabilities"; missingCapabilities: string[] }
  | { status: "approval_required" }
  | { status: "approval_denied" }
  | { status: "error"; message: string };

export type BindResult = { status: "bound" } | BindErrorResult;

const buildLoginHref = buildLoginUrl as unknown as (
  config: { authUrl: string },
  provider: string | undefined,
  redirectTo: string,
  handle: SessionKeyHandle,
  contract: Record<string, unknown>,
) => Promise<string>;

const STORAGE_KEY = "trellis_auth";

type AuthStateData = {
  handle: SessionKeyHandle | null;
  bindingToken: string | null;
  inboxPrefix: string | null;
  expiresMs: number | null;
  sentinel: SentinelCreds | null;
  natsServers: string[] | null;
};

type PersistedAuth = {
  bindingToken: string;
  inboxPrefix: string;
  expires: string;
  sentinel: SentinelCreds;
  natsServers: string[];
};

const PersistedAuthSchema = Type.Object({
  bindingToken: Type.String(),
  inboxPrefix: Type.String(),
  expires: Type.String({ format: "date-time" }),
  sentinel: Type.Object({
    jwt: Type.String(),
    seed: Type.String(),
  }, { additionalProperties: false }),
  natsServers: Type.Array(Type.String()),
}, { additionalProperties: false });

function loadPersistedAuth(): PersistedAuth | null {
  if (typeof localStorage === "undefined") return null;
  const result = Result.try(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;
    const parsed = Value.Parse(PersistedAuthSchema, JSON.parse(stored)) as PersistedAuth;
    if (new Date(parsed.expires) < new Date()) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    if (!parsed.sentinel) return null;
    return parsed;
  });
  return result.unwrapOr(null);
}

function persistAuth(state: {
  bindingToken: string;
  expires: Date;
  inboxPrefix: string;
  sentinel: SentinelCreds;
  natsServers: string[];
}): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
        bindingToken: state.bindingToken,
        inboxPrefix: state.inboxPrefix,
        expires: state.expires.toISOString(),
        sentinel: state.sentinel,
        natsServers: state.natsServers,
      }),
  );
}

function clearPersistedAuth(): void {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
}

export type AuthStateConfig = {
  authUrl: string; // https://auth.example.com
  loginPath?: string;
  contract?: { CONTRACT: Record<string, unknown> };
};

/**
 * Svelte 5 runes-based reactive authentication state.
 *
 * Manages session-key based authentication including:
 * - Session key generation and storage (IndexedDB/WebCrypto)
 * - OAuth sign-in flow initiation (signed)
 * - Callback handling (authToken in URL fragment) + bind
 * - Binding token persistence (short lived)
 */
export class AuthState {
  #state: AuthStateData = $state({
    handle: null,
    bindingToken: null,
    inboxPrefix: null,
    expiresMs: null,
    sentinel: null,
    natsServers: null,
  });

  #config: AuthStateConfig;
  #bindingInProgress: Promise<BindResult> | null = null;

  constructor(config: AuthStateConfig) {
    this.#config = config;
  }

  get handle(): SessionKeyHandle | null {
    return this.#state.handle;
  }
  get sessionKey(): string | null {
    return this.#state.handle ? getPublicSessionKey(this.#state.handle) : null;
  }
  get bindingToken(): string | null {
    return this.#state.bindingToken;
  }
  get inboxPrefix(): string | null {
    return this.#state.inboxPrefix;
  }
  get expires(): Date | null {
    return this.#state.expiresMs === null ? null : new SvelteDate(this.#state.expiresMs);
  }
  get sentinel(): SentinelCreds | null {
    return this.#state.sentinel;
  }
  get natsServers(): string[] | null {
    return this.#state.natsServers;
  }
  get isAuthenticated(): boolean {
    if (!this.#state.bindingToken) return false;
    if (this.#state.expiresMs === null) return false;
    if (!this.#state.sentinel) return false;
    return this.#state.expiresMs > Date.now();
  }
  /**
   * Initialize the auth state by loading or creating a session key,
   * and restoring any persisted binding token (if still valid).
   */
  async init(): Promise<SessionKeyHandle> {
    if (this.#state.handle) return this.#state.handle;

    const handle = await getOrCreateSessionKey();
    this.#state.handle = handle;

    const persisted = loadPersistedAuth();
    if (persisted) {
      this.#state.bindingToken = persisted.bindingToken;
      this.#state.inboxPrefix = persisted.inboxPrefix;
      this.#state.expiresMs = Date.parse(persisted.expires);
      this.#state.sentinel = persisted.sentinel;
      this.#state.natsServers = persisted.natsServers;
    }

    return handle;
  }

  /**
   * Initiate OAuth sign-in flow by redirecting to the auth provider.
   * This method does not return - it redirects the browser.
   */
  async signIn(provider: string | undefined, redirectTo: string): Promise<never> {
    const handle = await this.init();
    const url = await buildLoginHref(
      { authUrl: this.#config.authUrl },
      provider,
      redirectTo,
      handle,
      this.#config.contract?.CONTRACT ?? {},
    );
    window.location.href = url;
    throw new Error(provider ? `Redirecting to ${provider} for authentication` : "Redirecting to auth for provider selection");
  }

  async handleCallback(url: string = window.location.href): Promise<BindResult | null> {
    if (this.#bindingInProgress) return this.#bindingInProgress;

    const authError = extractAuthErrorFromFragment(url);
    if (authError === "approval_denied") return { status: "approval_denied" };
    if (authError) return { status: "error", message: authError };

    const authToken = extractAuthTokenFromFragment(url);
    if (!authToken) return null;

    this.#bindingInProgress = this.#resolveCallback(authToken);
    try {
      return await this.#bindingInProgress;
    } finally {
      this.#bindingInProgress = null;
    }
  }

  async #resolveCallback(authToken: string): Promise<BindResult> {
    try {
      const response = await this.bind(authToken);
      return response.status === "bound"
        ? { status: "bound" }
        : { status: "insufficient_capabilities", missingCapabilities: response.missingCapabilities };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("approval_denied")) return { status: "approval_denied" };
      if (message.includes("approval_required")) return { status: "approval_required" };
      return { status: "error", message };
    }
  }

  /**
   * Clean up the callback URL by removing the authToken fragment.
   */
  cleanupCallbackUrl(url: string = window.location.href): void {
    const parsed = new URL(url);
    if (parsed.hash) {
      parsed.hash = "";
      window.history.replaceState({}, "", parsed.pathname + parsed.search);
    }
  }

  /**
   * Bind an authToken (returned from OAuth callback) to the session key,
   * producing a short-lived binding token and inboxPrefix for NATS.
   */
  async bind(authToken: string): Promise<BindResponse> {
    return this.#bind(authToken);
  }

  async #bind(authToken: string): Promise<BindResponse> {
    const handle = await this.init();
    const response = await bindSession(
      { authUrl: this.#config.authUrl },
      handle,
      authToken,
    );

    if (response.status === "bound") {
      this.setBindingToken(response);
    }

    return response;
  }

  setBindingToken(
    response: Pick<BindSuccessResponse, "bindingToken" | "inboxPrefix" | "expires"> & {
      sentinel?: SentinelCreds;
      natsServers?: string[];
    },
  ): void {
    this.#state.bindingToken = response.bindingToken;
    this.#state.inboxPrefix = response.inboxPrefix;
    this.#state.expiresMs = Date.parse(String(response.expires));
    // Keep existing sentinel if not provided (e.g., from RenewBindingToken)
    if (response.sentinel) {
      this.#state.sentinel = response.sentinel;
    }
    if (response.natsServers) {
      this.#state.natsServers = response.natsServers;
    }

    // Only persist if we have sentinel credentials
    if (this.#state.sentinel && this.#state.natsServers) {
      persistAuth({
        bindingToken: response.bindingToken,
        inboxPrefix: response.inboxPrefix,
        expires: new SvelteDate(String(response.expires)),
        sentinel: this.#state.sentinel,
        natsServers: this.#state.natsServers,
      });
    }
  }

  /**
   * Clear persisted auth state without clearing session key or redirecting.
   * Use this when auth fails and you need to force re-authentication.
   */
  clearAuth(): void {
    clearPersistedAuth();
    this.#state.bindingToken = null;
    this.#state.inboxPrefix = null;
    this.#state.expiresMs = null;
    this.#state.sentinel = null;
    this.#state.natsServers = null;
  }

  /**
   * Sign out by clearing all credentials and redirecting to login.
   * This method does not return - it redirects the browser.
   */
  async signOut(remoteLogout?: () => Promise<unknown> | unknown): Promise<never> {
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

    const loginPath = this.#config.loginPath ?? "/login";
    window.location.href = loginPath;
    throw new Error("Signed out, redirecting to login");
  }
}

/**
 * Factory function to create an AuthState instance.
 */
export function createAuthState(config: AuthStateConfig): AuthState {
  return new AuthState(config);
}
