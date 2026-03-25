import {
  type BindResponse,
  type BindSuccessResponse,
  bindSession,
  buildLoginUrl,
  clearSessionKey,
  extractAuthTokenFromFragment,
  getOrCreateSessionKey,
  getPublicSessionKey,
  type SentinelCreds,
  type SessionKeyHandle,
} from "@trellis/auth";
import { Result } from "@trellis/result";
import { SvelteDate } from "svelte/reactivity";
import { Type } from "typebox";
import { Value } from "typebox/value";

const STORAGE_KEY = "trellis_auth";

type AuthStateData = {
  handle: SessionKeyHandle | null;
  bindingToken: string | null;
  inboxPrefix: string | null;
  expiresMs: number | null;
  sentinel: SentinelCreds | null;
};

type PersistedAuth = {
  bindingToken: string;
  inboxPrefix: string;
  expires: string;
  sentinel: SentinelCreds;
};

const PersistedAuthSchema = Type.Object({
  bindingToken: Type.String(),
  inboxPrefix: Type.String(),
  expires: Type.String({ format: "date-time" }),
  sentinel: Type.Object({
    jwt: Type.String(),
    seed: Type.String(),
  }, { additionalProperties: false }),
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
}): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      bindingToken: state.bindingToken,
      inboxPrefix: state.inboxPrefix,
      expires: state.expires.toISOString(),
      sentinel: state.sentinel,
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
  contract: { CONTRACT: Record<string, unknown> };
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
  });

  #config: AuthStateConfig;
  #bindingInProgress: Promise<BindResponse> | null = null;

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
    }

    return handle;
  }

  /**
   * Initiate OAuth sign-in flow by redirecting to the auth provider.
   * This method does not return - it redirects the browser.
   */
  async signIn(provider: string, redirectTo: string): Promise<never> {
    const handle = await this.init();
    const url = await buildLoginUrl(
      { authUrl: this.#config.authUrl },
      provider,
      redirectTo,
      handle,
      this.#config.contract.CONTRACT,
    );
    window.location.href = url;
    throw new Error(`Redirecting to ${provider} for authentication`);
  }

  /**
   * Handle OAuth callback by extracting the authToken from the URL fragment
   * and binding it to the session key.
   *
   * Returns the bind response if a fragment exists, null otherwise.
   * Includes a guard to prevent double binding when multiple components call this.
   */
  async handleCallback(url: string = window.location.href): Promise<BindResponse | null> {
    // Guard to prevent race conditions when multiple components call handleCallback
    if (this.#bindingInProgress) return this.#bindingInProgress;

    const authToken = extractAuthTokenFromFragment(url);
    if (!authToken) return null;

    this.#bindingInProgress = this.bind(authToken);
    try {
      return await this.#bindingInProgress;
    } finally {
      this.#bindingInProgress = null;
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
    },
  ): void {
    this.#state.bindingToken = response.bindingToken;
    this.#state.inboxPrefix = response.inboxPrefix;
    this.#state.expiresMs = Date.parse(String(response.expires));
    // Keep existing sentinel if not provided (e.g., from RenewBindingToken)
    if (response.sentinel) {
      this.#state.sentinel = response.sentinel;
    }

    // Only persist if we have sentinel credentials
    if (this.#state.sentinel) {
      persistAuth({
        bindingToken: response.bindingToken,
        inboxPrefix: response.inboxPrefix,
        expires: new SvelteDate(String(response.expires)),
        sentinel: this.#state.sentinel,
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
