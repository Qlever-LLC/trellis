import {
  jwtAuthenticator,
  type NatsConnection,
  wsconnect,
} from "@nats-io/nats-core";
import { createClient, type Trellis } from "@qlever-llc/trellis";
import {
  getPublicSessionKey,
  natsConnectSigForBindingToken,
  type SentinelCreds,
  type SessionKeyHandle,
  signBytes,
} from "@qlever-llc/trellis-auth";
import { AsyncResult, UnexpectedError } from "@qlever-llc/trellis-result";
import {
  API as AUTH_API,
  type AuthRenewBindingTokenInput,
} from "@qlever-llc/trellis-sdk-auth";
import type { AuthState } from "./auth.svelte.ts";

const AUTH_RENEW_API = {
  rpc: {
    "Auth.RenewBindingToken": AUTH_API.owned.rpc["Auth.RenewBindingToken"],
  },
  events: {},
  subjects: {},
  operations: {},
} as const;

const AUTH_RENEW_CONTRACT = {
  API: {
    trellis: AUTH_RENEW_API,
  },
} as const;

function createAuthRenewClient(
  nc: NatsConnection,
  handle: SessionKeyHandle,
): Trellis<typeof AUTH_RENEW_API> {
  return createClient(
    AUTH_RENEW_CONTRACT,
    nc,
    {
      sessionKey: getPublicSessionKey(handle),
      sign: (data: Uint8Array) => signBytes(handle, data),
    },
    { name: "auth-renew" },
  );
};

export type Status = "disconnected" | "connecting" | "connected" | "error";

export type NatsStateConfig = {
  servers: string[];
  onConnecting?: () => void;
  onConnected?: () => void;
  onDisconnect?: () => void;
  onReconnecting?: () => void;
  onReconnect?: () => void;
  onError?: (error: Error) => void;
  onAuthRequired?: () => void;
};

function requireBrowserAuth(authState: AuthState): {
  handle: SessionKeyHandle;
  bindingToken: string;
  sentinel: SentinelCreds;
} {
  const handle = authState.handle;
  const bindingToken = authState.bindingToken;
  const sentinel = authState.sentinel;

  if (!handle || !bindingToken || !sentinel) {
    throw new Error("Not authenticated: missing binding token or sentinel");
  }

  return { handle, bindingToken, sentinel };
}

async function buildNatsAuthToken(
  handle: SessionKeyHandle,
  bindingToken: string,
): Promise<string> {
  const sessionKey = getPublicSessionKey(handle);
  const sig = await natsConnectSigForBindingToken(handle, bindingToken);
  return JSON.stringify({ v: 1, sessionKey, bindingToken, sig });
}

/**
 * Svelte 5 runes-based reactive NATS connection state.
 *
 * Manages WebSocket connection to NATS server including:
 * - Initial connection with authentication
 * - Connection status monitoring
 * - Automatic reconnection (within binding token TTL)
 */
export class NatsState {
  nc: NatsConnection;
  status: Status = $state("disconnected");

  #servers: string[];
  #authState: AuthState;
  #config: NatsStateConfig;
  #handle: SessionKeyHandle;
  #tokenRef: { value: string };
  #sentinel: SentinelCreds;
  #trellis: ReturnType<typeof createAuthRenewClient>;
  #renewTimer: ReturnType<typeof setTimeout> | undefined;

  private constructor(
    nc: NatsConnection,
    status: Status,
    servers: string[],
    authState: AuthState,
    config: NatsStateConfig,
    handle: SessionKeyHandle,
    tokenRef: { value: string },
    sentinel: SentinelCreds,
  ) {
    this.nc = nc;
    this.status = status;
    this.#servers = servers;
    this.#authState = authState;
    this.#config = config;
    this.#handle = handle;
    this.#tokenRef = tokenRef;
    this.#sentinel = sentinel;
    this.#trellis = createAuthRenewClient(nc, handle);
    this.#monitorStatus();
    this.#scheduleRenew();
  }

  /**
   * Connect to NATS servers with authenticated credentials.
   * Per ADR, browser clients use sentinel creds with jwtAuthenticator.
   * The auth_token is passed via the token option for auth callout.
   */
  static async connect(
    authState: AuthState,
    config: NatsStateConfig,
  ): Promise<NatsState> {
    config.onConnecting?.();

    await authState.init();
    await authState.handleCallback();

    if (!authState.isAuthenticated) {
      config.onAuthRequired?.();
      throw new Error("Not authenticated: missing binding token or sentinel");
    }

    const { handle, bindingToken, sentinel } = requireBrowserAuth(authState);
    const inboxPrefix = authState.inboxPrefix ?? undefined;
    const tokenRef = { value: await buildNatsAuthToken(handle, bindingToken) };

    // Use jwtAuthenticator with sentinel credentials per ADR
    const authenticator = jwtAuthenticator(
      sentinel.jwt,
      new TextEncoder().encode(sentinel.seed),
    );

    const nc = await wsconnect({
      servers: config.servers,
      authenticator,
      token: tokenRef.value, // auth_token for auth callout
      reconnect: true,
      maxReconnectAttempts: 5,
      reconnectTimeWait: 2000,
      inboxPrefix,
    });

    config.onConnected?.();

    const state = new NatsState(
      nc,
      "connected",
      config.servers,
      authState,
      config,
      handle,
      tokenRef,
      sentinel,
    );

    // Immediately renew binding token so localStorage has a valid (unconsumed) token.
    // This prevents stale token issues on page reload.
    await state.#renewBindingToken();

    return state;
  }

  /**
   * Reconnect to NATS with the existing binding token (if still valid).
   * Uses stored sentinel credentials with jwtAuthenticator per ADR.
   */
  async reconnect(): Promise<void> {
    if (this.status === "connecting") return;
    this.status = "connecting";

    await AsyncResult.try(() => this.nc.close());

    const result = await AsyncResult.try(async () => {
      await this.#authState.init();
      if (!this.#authState.isAuthenticated) {
        throw new UnexpectedError({
          context: { message: "Not authenticated: binding token expired" },
        });
      }
      const { handle, bindingToken } = requireBrowserAuth(this.#authState);
      const inboxPrefix = this.#authState.inboxPrefix ?? undefined;
      this.#tokenRef.value = await buildNatsAuthToken(handle, bindingToken);

      const authenticator = jwtAuthenticator(
        this.#sentinel.jwt,
        new TextEncoder().encode(this.#sentinel.seed),
      );

      this.nc = await wsconnect({
        servers: this.#servers,
        authenticator,
        token: this.#tokenRef.value,
        reconnect: true,
        maxReconnectAttempts: 5,
        reconnectTimeWait: 2000,
        inboxPrefix,
      });

      this.#trellis = createAuthRenewClient(this.nc, this.#handle);
    });

    if (result.isErr()) {
      console.error("NATS reconnect failed:", result.error);
      this.status = "error";
      this.#config.onError?.(result.error);
      return;
    }

    this.status = "connected";
    this.#config.onReconnect?.();
    this.#monitorStatus();

    await this.#renewBindingToken();
  }

  #scheduleRenew(): void {
    if (this.#renewTimer) clearTimeout(this.#renewTimer);

    const expires = this.#authState.expires;
    if (!expires) return;

    const delayMs = Math.max(30_000, expires.getTime() - Date.now() - 60_000);
    this.#renewTimer = setTimeout(() => {
      void this.#renewBindingToken();
    }, delayMs);
  }

  async #renewBindingToken(): Promise<void> {
    const renew = async () => {
      if (this.status !== "connected") return;
      const binding = await this.#trellis.requestOrThrow(
        "Auth.RenewBindingToken",
        {} satisfies AuthRenewBindingTokenInput,
      );
      this.#authState.setBindingToken(binding);
      this.#tokenRef.value = await buildNatsAuthToken(
        this.#handle,
        binding.bindingToken,
      );
    };

    await AsyncResult.try(renew);
    this.#scheduleRenew();
  }

  /**
   * Disconnect from NATS.
   */
  async disconnect(): Promise<void> {
    if (this.#renewTimer) clearTimeout(this.#renewTimer);
    await AsyncResult.try(() => this.nc.close());
    this.status = "disconnected";
  }

  async #monitorStatus(): Promise<void> {
    for await (const s of this.nc.status()) {
      switch (s.type) {
        case "error": {
          const data = "data" in s ? s.data : s.error;
          const msg = data instanceof Error ? data.message : String(data);
          const isAuthError =
            msg.includes("authorization") || msg.includes("Authentication");
          if (isAuthError) {
            console.log(
              "Auth error detected, attempting reconnect with fresh credentials",
            );
            void this.reconnect();
          } else if (this.status !== "connected") {
            this.status = "error";
          }
          break;
        }

        case "reconnect":
          this.status = "connected";
          this.#config.onReconnect?.();
          break;

        case "reconnecting":
        case "forceReconnect":
        case "staleConnection":
          this.status = "connecting";
          this.#config.onReconnecting?.();
          break;

        case "disconnect":
        case "close":
          this.status = "disconnected";
          this.#config.onDisconnect?.();
          void this.reconnect();
          break;

        case "ping":
        case "update":
        case "ldm":
        case "slowConsumer":
          // Informational events, no action needed
          break;

        default:
          console.error("Unhandled NATS status event:", s);
          this.status = "error";
          break;
      }
    }
  }
}

/**
 * Factory function to create and connect a NatsState instance.
 */
export async function createNatsState(
  authState: AuthState,
  config: NatsStateConfig,
): Promise<NatsState> {
  return NatsState.connect(authState, config);
}
