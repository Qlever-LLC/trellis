import {
  jwtAuthenticator,
  tokenAuthenticator,
  type Authenticator,
  type ConnectionOptions,
} from "@nats-io/nats-core";

export type TokenRef = { value: string };

export type SentinelRef = {
  jwt: string;
  seed: string;
};

export function createBindingTokenAuthenticator(
  tokenRef: TokenRef,
): Authenticator {
  return tokenAuthenticator(() => tokenRef.value);
}

export function createBrowserNatsAuthenticators(
  sentinelRef: SentinelRef,
  tokenRef: TokenRef,
): Authenticator[] {
  return [
    jwtAuthenticator(
      () => sentinelRef.jwt,
      () => new TextEncoder().encode(sentinelRef.seed),
    ),
    createBindingTokenAuthenticator(tokenRef),
  ];
}

export function buildBrowserNatsConnectionOptions(args: {
  servers: string[];
  sentinelRef: SentinelRef;
  tokenRef: TokenRef;
  inboxPrefix?: string;
}): ConnectionOptions {
  return {
    servers: args.servers,
    authenticator: createBrowserNatsAuthenticators(
      args.sentinelRef,
      args.tokenRef,
    ),
    reconnect: true,
    maxReconnectAttempts: 5,
    reconnectTimeWait: 2000,
    ...(args.inboxPrefix ? { inboxPrefix: args.inboxPrefix } : {}),
  };
}
