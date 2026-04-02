---
title: Auth TypeScript API
description: TypeScript browser and service auth helpers for session keys, bind flows, reconnect, and auth clients.
order: 40
---

# Design: Auth TypeScript API

## Prerequisites

- [trellis-auth.md](./trellis-auth.md) - auth architecture and flow model
- [auth-protocol.md](./auth-protocol.md) - proof and connect token rules
- [auth-api.md](./auth-api.md) - public HTTP and RPC endpoints
- [../core/type-system-patterns.md](./../core/type-system-patterns.md) - Result and error-model guidance

## Scope

This document defines the normative TypeScript public API surface for Trellis auth.

It covers:

- browser session-key helpers
- bind and reconnect helpers
- service auth helpers
- NATS connect option helpers

## Design Rules

- browser and service helpers expose the same underlying auth model through different ergonomics
- public TypeScript APIs use `Result` / `AsyncResult` for expected failures
- session-key seeds remain protected from normal application code where possible
- helpers hide protocol string construction such as `sign(hash("bind:" + authToken))`

## Browser Surface

```ts
type SessionKeyHandle = {
  publicKey(): string;
};

type BindSessionOptions = {
  authUrl: string;
};

type BindSessionResult = {
  bindingToken: string;
  inboxPrefix: string;
  expires: string;
  sentinel: {
    jwt: string;
    seed: string;
  };
  natsServers: string[];
};

declare function getOrCreateSessionKey(): Promise<Result<SessionKeyHandle, AuthError>>;
declare function bindSession(
  options: BindSessionOptions,
  handle: SessionKeyHandle,
  authToken: string,
): Promise<Result<BindSessionResult, AuthError>>;
declare function natsConnectSigForBindingToken(
  handle: SessionKeyHandle,
  bindingToken: string,
): Promise<Result<string, AuthError>>;
declare function getPublicSessionKey(handle: SessionKeyHandle): string;
```

Example:

```ts
const handleResult = await getOrCreateSessionKey();
if (handleResult.isErr()) throw handleResult.error;

const bindResult = await bindSession({ authUrl }, handleResult.value, authToken);
if (bindResult.isErr()) throw bindResult.error;

const sigResult = await natsConnectSigForBindingToken(
  handleResult.value,
  bindResult.value.bindingToken,
);
if (sigResult.isErr()) throw sigResult.error;

const authTokenPayload = JSON.stringify({
  v: 1,
  sessionKey: getPublicSessionKey(handleResult.value),
  bindingToken: bindResult.value.bindingToken,
  sig: sigResult.value,
});
```

Rules:

- browser session keys SHOULD be stored in IndexedDB via WebCrypto with `extractable=false`
- after reading `authToken` from a URL fragment, the client MUST immediately clear it from browser history

## Service Surface

```ts
type CreateAuthOptions = {
  sessionKeySeed: string;
};

type NatsConnectOptions = {
  token: string;
  inboxPrefix: string;
};

type AuthHandle = {
  natsConnectOptions(): Promise<Result<NatsConnectOptions, AuthError>>;
};

declare function createAuth(options: CreateAuthOptions): Promise<Result<AuthHandle, AuthError>>;
```

Example:

```ts
const auth = await createAuth({ sessionKeySeed: config.sessionKeySeed });
if (auth.isErr()) throw auth.error;

const connectOptions = await auth.value.natsConnectOptions();
if (connectOptions.isErr()) throw connectOptions.error;

const nc = await connect({
  servers: config.nats.servers,
  authenticator: credsAuthenticator(sentinelCreds),
  ...connectOptions.value,
});
```

Returned connect options:

```ts
{
  token: string;      // JSON auth token with { v, sessionKey, iat, sig }
  inboxPrefix: string; // _INBOX.${sessionKey.slice(0, 16)}
}
```

## Auth RPC Client Surface

Typed auth clients SHOULD expose at least:

```ts
type AuthClient = {
  me(): Promise<Result<AuthMeResponse, AuthError>>;
  logout(): Promise<Result<{ success: boolean }, AuthError>>;
  renewBindingToken(): Promise<Result<RenewBindingTokenResponse, AuthError>>;
};

type AuthAdminClient = {
  listApprovals(input: ListApprovalsRequest): Promise<Result<ListApprovalsResponse, AuthError>>;
  revokeApproval(input: RevokeApprovalRequest): Promise<Result<{ success: boolean }, AuthError>>;
  listSessions(input: ListSessionsRequest): Promise<Result<ListSessionsResponse, AuthError>>;
  revokeSession(input: RevokeSessionRequest): Promise<Result<{ success: boolean }, AuthError>>;
  listConnections(input: ListConnectionsRequest): Promise<Result<ListConnectionsResponse, AuthError>>;
  kickConnection(input: KickConnectionRequest): Promise<Result<{ success: boolean }, AuthError>>;
};
```

## Non-Goals

- redefining HTTP or RPC payload schemas
- defining Rust APIs
- deployment/runbook guidance
