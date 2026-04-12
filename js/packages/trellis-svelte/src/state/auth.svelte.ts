import {
  type BindResponse,
  type BindSuccessResponse,
  bindFlow,
  bindSession,
  clearSessionKey,
  getOrCreateSessionKey,
  getPublicSessionKey,
  type SentinelCreds,
  type SessionKeyHandle,
} from "@qlever-llc/trellis/auth";
import { canonicalizeJsonValue } from "../../../auth/utils.ts";
import { oauthInitSig } from "../../../auth/browser/session.ts";
import { Result } from "@qlever-llc/result";
import { SvelteDate } from "svelte/reactivity";
import type { TrellisContractV1 } from "@qlever-llc/trellis";
import { Type } from "typebox";
import { Value } from "typebox/value";
import type { TrellisClientContract } from "./trellis.svelte.ts";

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
  authUrl?: string; // https://auth.example.com
  loginPath?: string;
  contract?: TrellisClientContract;
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

function encodeJsonForQuery(value: unknown): string {
  const json = canonicalizeJsonValue(value);
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function buildLoginUrl(options: {
  authUrl: string;
  redirectTo: string;
  handle: SessionKeyHandle;
  contract: Record<string, unknown>;
  context?: unknown;
}): Promise<string> {
  const sessionKey = getPublicSessionKey(options.handle);
  const sig = await oauthInitSig(options.handle, options.redirectTo, options.context);
  const url = new URL(`${options.authUrl}/auth/login`);

  url.searchParams.set("redirectTo", options.redirectTo);
  url.searchParams.set("sessionKey", sessionKey);
  url.searchParams.set("sig", sig);
  url.searchParams.set("contract", encodeJsonForQuery(options.contract));
  if (options.context !== undefined) {
    url.searchParams.set("context", encodeJsonForQuery(options.context));
  }

  return url.href;
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
  get contract(): TrellisClientContract | undefined {
    return this.#config.contract;
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

    this.#getConfiguredAuthUrl();

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
  async signIn(options: SignInOptions = {}): Promise<never> {
    const authUrl = options.authUrl ? this.setAuthUrl(options.authUrl) : this.#requireAuthUrl();
    const handle = await this.init();
    const currentUrl = new URL(window.location.href);
    const url = await buildLoginUrl({
      authUrl,
      redirectTo: resolveRedirectTo(options, currentUrl),
      handle,
      contract: this.#config.contract?.CONTRACT ?? {},
      context: options.context,
    });
    window.location.href = url;
    throw new Error("Redirecting to auth for provider selection");
  }

  async handleCallback(url: string = window.location.href): Promise<BindResult | null> {
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
   * Clean up the callback URL by removing the auth flow query params.
   */
  cleanupCallbackUrl(url: string = window.location.href): string | null {
    const parsed = new URL(url);
    if (parsed.searchParams.has("flowId") || parsed.searchParams.has("authError")) {
      parsed.searchParams.delete("flowId");
      parsed.searchParams.delete("authError");
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    }

    return null;
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
      { authUrl: this.#requireAuthUrl() },
      handle,
      authToken,
    );

    if (response.status === "bound") {
      this.setBindingToken(response);
    }

    return response;
  }

  async bindFlow(flowId: string): Promise<BindResponse> {
    const handle = await this.init();
    const response = await bindFlow(
      { authUrl: this.#requireAuthUrl() },
      handle,
      flowId,
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
