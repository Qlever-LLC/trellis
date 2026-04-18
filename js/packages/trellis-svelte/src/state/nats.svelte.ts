import { type NatsConnection, wsconnect } from "@nats-io/nats-core";
import type { Trellis } from "../../../trellis/trellis.ts";
import {
  getPublicSessionKey,
  natsConnectSigForBindingToken,
  type SentinelCreds,
  type SessionKeyHandle,
  signBytes,
} from "@qlever-llc/trellis/auth/browser";
import { AsyncResult, UnexpectedError } from "@qlever-llc/result";
import {
  API as AUTH_API,
  type AuthRenewBindingTokenInput,
  type AuthRenewBindingTokenOutput,
} from "@qlever-llc/trellis-sdk/auth";
import type { AuthState } from "./auth.svelte.ts";
import { createClient } from "../../../trellis/client.ts";
import {
  buildBrowserNatsConnectionOptions,
  type SentinelRef,
  type TokenRef,
} from "./nats_connect.ts";

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
  return createClient<typeof AUTH_RENEW_API>(
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
  servers?: string[];
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

function resolveServers(
  authState: AuthState,
  config: NatsStateConfig,
): string[] {
  const servers = config.servers ?? authState.natsServers;
  if (!servers || servers.length === 0) {
    throw new Error("Not authenticated: missing natsServers from auth state");
  }
  return servers;
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
  #tokenRef: TokenRef;
  #sentinelRef: SentinelRef;
  #trellis: ReturnType<typeof createAuthRenewClient>;
  #renewTimer: ReturnType<typeof setTimeout> | undefined;
  #reconnectPromise: Promise<void> | null = null;
  #shouldReconnect = true;

  private constructor(
    nc: NatsConnection,
    status: Status,
    servers: string[],
    authState: AuthState,
    config: NatsStateConfig,
    handle: SessionKeyHandle,
    tokenRef: TokenRef,
    sentinelRef: SentinelRef,
  ) {
    this.nc = nc;
    this.status = status;
    this.#servers = servers;
    this.#authState = authState;
    this.#config = config;
    this.#handle = handle;
    this.#tokenRef = tokenRef;
    this.#sentinelRef = sentinelRef;
    this.#trellis = createAuthRenewClient(nc, handle);
    void this.#monitorStatus(nc);
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
    const servers = resolveServers(authState, config);
    const inboxPrefix = authState.inboxPrefix ?? undefined;
    const tokenRef = { value: await buildNatsAuthToken(handle, bindingToken) };
    const sentinelRef = { jwt: sentinel.jwt, seed: sentinel.seed };

    const nc = await wsconnect(
      buildBrowserNatsConnectionOptions({
        servers,
        sentinelRef,
        tokenRef,
        inboxPrefix,
      }),
    );

    config.onConnected?.();

    const state = new NatsState(
      nc,
      "connected",
      servers,
      authState,
      config,
      handle,
      tokenRef,
      sentinelRef,
    );

    // Immediately renew binding token so localStorage has a valid (unconsumed) token.
    // This prevents stale token issues on page reload.
    await state.#renewBindingToken();

    return state;
  }

  static async fromConnection(
    nc: NatsConnection,
    authState: AuthState,
    config: NatsStateConfig,
  ): Promise<NatsState> {
    config.onConnecting?.();

    await authState.init();

    if (!authState.isAuthenticated) {
      config.onAuthRequired?.();
      throw new Error("Not authenticated: missing binding token or sentinel");
    }

    const { handle, sentinel } = requireBrowserAuth(authState);
    const servers = resolveServers(authState, config);
    const bindingToken = authState.bindingToken;
    if (!bindingToken) {
      throw new Error("Not authenticated: missing binding token or sentinel");
    }

    const state = new NatsState(
      nc,
      "connected",
      servers,
      authState,
      config,
      handle,
      { value: await buildNatsAuthToken(handle, bindingToken) },
      { jwt: sentinel.jwt, seed: sentinel.seed },
    );

    config.onConnected?.();
    await state.#renewBindingToken();

    return state;
  }

  /**
   * Reconnect to NATS with the existing binding token (if still valid).
   * Uses stored sentinel credentials with jwtAuthenticator per ADR.
   */
  async reconnect(): Promise<void> {
    if (this.#reconnectPromise) {
      return await this.#reconnectPromise;
    }

    this.#reconnectPromise = (async () => {
      this.status = "connecting";

      await AsyncResult.try(() => this.nc.close());

      const result = await AsyncResult.try(async () => {
        await this.#authState.init();
        if (!this.#authState.isAuthenticated) {
          throw new UnexpectedError({
            context: { message: "Not authenticated: binding token expired" },
          });
        }
        const { handle, bindingToken, sentinel } = requireBrowserAuth(
          this.#authState,
        );
        this.#handle = handle;
        this.#servers = resolveServers(this.#authState, this.#config);
        this.#sentinelRef.jwt = sentinel.jwt;
        this.#sentinelRef.seed = sentinel.seed;
        const inboxPrefix = this.#authState.inboxPrefix ?? undefined;
        this.#tokenRef.value = await buildNatsAuthToken(handle, bindingToken);

        this.nc = await wsconnect(
          buildBrowserNatsConnectionOptions({
            servers: this.#servers,
            sentinelRef: this.#sentinelRef,
            tokenRef: this.#tokenRef,
            inboxPrefix,
          }),
        );

        this.#trellis = createAuthRenewClient(this.nc, this.#handle);
      });

      if (result.isErr()) {
        console.error("NATS reconnect failed:", result.error);
        this.status = "error";
        this.#config.onError?.(result.error);
        return;
      }

      this.status = "connected";
      this.#shouldReconnect = true;
      this.#config.onReconnect?.();
      void this.#monitorStatus(this.nc);

      await this.#renewBindingToken();
    })();

    try {
      await this.#reconnectPromise;
    } finally {
      this.#reconnectPromise = null;
    }
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
      const bindingResult = await this.#trellis.request(
        "Auth.RenewBindingToken",
        {
          contractDigest: this.#authState.contractDigest,
        } satisfies AuthRenewBindingTokenInput,
      );
      if (bindingResult.isErr()) {
        throw bindingResult.error;
      }
      const binding = bindingResult.take() as AuthRenewBindingTokenOutput;
      if (binding.status === "bound") {
        this.#authState.setBindingToken(binding);
        const nextSentinel = this.#authState.sentinel;
        if (nextSentinel) {
          this.#sentinelRef.jwt = nextSentinel.jwt;
          this.#sentinelRef.seed = nextSentinel.seed;
        }
        this.#tokenRef.value = await buildNatsAuthToken(
          this.#handle,
          binding.bindingToken,
        );
        return;
      }

      if (binding.status !== "contract_changed") {
        return;
      }

      const authStart = await this.#authState.startAuthRequest({
        redirectTo: window.location.href,
      });
      if (authStart.status === "bound") {
        this.#authState.setBindingToken(authStart);
        await this.reconnect();
        return;
      }

      window.location.href = authStart.loginUrl;
    };

    const result = await AsyncResult.try(renew);
    this.#scheduleRenew();

    if (result.isErr()) {
      const message = result.error.message.toLowerCase();
      const authRequired = message.includes("auth") ||
        message.includes("session_not_found") ||
        message.includes("insufficient_permissions");

      if (authRequired) {
        this.#config.onAuthRequired?.();
        return;
      }

      this.status = "error";
      this.#config.onError?.(result.error);
    }
  }

  /**
   * Disconnect from NATS.
   */
  async disconnect(): Promise<void> {
    if (this.#renewTimer) clearTimeout(this.#renewTimer);
    this.#shouldReconnect = false;
    await AsyncResult.try(() => this.nc.close());
    this.status = "disconnected";
  }

  async #monitorStatus(connection: NatsConnection): Promise<void> {
    for await (const s of connection.status()) {
      if (connection !== this.nc) {
        break;
      }

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
          if (this.#shouldReconnect) {
            void this.reconnect();
          }
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

export async function createConnectedNatsState(
  nc: NatsConnection,
  authState: AuthState,
  config: NatsStateConfig,
): Promise<NatsState> {
  return NatsState.fromConnection(nc, authState, config);
}
