---
title: Auth API
description: Public auth HTTP endpoints, rpc.Auth APIs, and auth event surfaces.
order: 30
---

# Design: Auth API

## Prerequisites

- [trellis-auth.md](./trellis-auth.md) - auth architecture and approval model
- [auth-protocol.md](./auth-protocol.md) - proofs, connect tokens, and internal state rules

## Design

This document defines the public Trellis auth API.

It covers:

- HTTP OAuth and bind endpoints
- HTTP device activation endpoints
- device profile management RPCs
- public and admin `rpc.Auth.*` endpoints
- emitted auth events

It does not define language-specific client APIs.

## HTTP Endpoints

Device activation HTTP endpoints are defined in [device-activation.md](./device-activation.md):

- `GET /auth/device/activate`
- `POST /auth/device/activate`

### GET /auth/login

Shows a Trellis-hosted identity provider chooser. If only one provider is configured and `oauth.alwaysShowProviderChooser` is false, Trellis MAY immediately redirect to `GET /auth/login/:provider`.

### GET /auth/login/:provider

Initiates authentication for a configured provider.

Query parameters:

| Name | Required | Description |
| --- | --- | --- |
| `redirectTo` | yes | Post-login redirect URL |
| `sessionKey` | yes | Client public session key |
| `sig` | yes | `sign(hash("oauth-init:" + redirectTo))` by `sessionKey` |

Behavior:

1. Validate `redirectTo`
2. Verify `sig` by `sessionKey`
3. Generate OAuth state and PKCE challenge
4. Store `{ provider, redirectTo, codeVerifier, sessionKey, createdAt }`
5. Set `trellis_oauth=state`
6. Redirect to the provider

### GET /auth/callback/:provider

Handles provider callback.

Behavior:

1. Verify cookie matches `state`
2. Lookup and CAS-delete the pending OAuth state
3. Exchange code for tokens
4. Fetch user info
5. Generate `authToken`
6. Store `{ user, sessionKey, redirectTo }` under pending auth
7. Delete cookie
8. Redirect to `redirectTo#authToken=<authToken>` with `Referrer-Policy: no-referrer`

### POST /auth/bind

Binds a session key to an authenticated identity and approved contract digest.

Request:

```ts
{
  authToken: string;
  sessionKey: string;
  sig: string; // sign(hash("bind:" + authToken))
}
```

Response:

```ts
type BindResponse =
  | {
      status: "bound";
      bindingToken: string;
      inboxPrefix: string;
      expires: string;
      sentinel: {
        jwt: string;
        seed: string;
      };
      natsServers: string[];
    }
  | {
      status: "insufficient_capabilities";
      approval: {
        contractDigest: string;
        contractId: string;
        displayName: string;
        description: string;
        kind: string;
        capabilities: string[];
      };
      missingCapabilities: string[];
      userCapabilities: string[];
    };
```

Behavior:

1. Lookup and validate `pendingAuth[authToken]`
2. Verify `sessionKey` and `sig`
3. Read the contract already associated with the pending login
4. Validate the contract, compute digest, derive required capabilities, and check approval
5. CAS-delete `pendingAuth[authToken]`
6. Create or recover the session record for `<sessionKey>.<trellisId>`
7. Persist delegated contract metadata and delegated publish/subscribe subjects into the session
8. Mint `bindingToken`
9. Compute `inboxPrefix = _INBOX.${sessionKey.slice(0, 16)}`
10. Refresh the Trellis-local auth projection entry
11. Return the bind response

Behavior:

- normal browser and CLI flows reach `/auth/bind` only after Trellis has already recorded an approval decision
- `/auth/bind` still rechecks approval and capabilities defensively

## Approval Management RPCs

### rpc.Auth.ListApprovals

Request:

```ts
{
  user?: string;
  digest?: string;
}
```

Response:

```ts
{
  approvals: Array<{
    user: string;
    answer: "approved" | "denied";
    answeredAt: string;
    updatedAt: string;
    approval: {
      contractDigest: string;
      contractId: string;
      displayName: string;
      description: string;
      kind: string;
      capabilities: string[];
    };
  }>;
}
```

Callers without `admin` see only their own approvals.

### rpc.Auth.RevokeApproval

Request:

```ts
{
  contractDigest: string;
  user?: string;
}
```

Response:

```ts
{ success: boolean }
```

Revocation SHOULD also revoke matching active delegated sessions.

## Authenticated User RPCs

These RPCs require `session-key` and `proof` headers.

### rpc.Auth.Logout

Request:

```ts
{}
```

Response:

```ts
{ success: boolean }
```

Behavior:

1. Validate headers
2. Lookup session
3. List connections for the session
4. Delete the session
5. Kick all connections
6. Delete connection entries

### rpc.Auth.RenewBindingToken

Request:

```ts
{}
```

Response:

```ts
{
  bindingToken: string;
  inboxPrefix: string;
  expires: string;
  sentinel: {
    jwt: string;
    seed: string;
  };
  natsServers: string[];
}
```

Behavior:

- binding tokens are single-use
- clients that want seamless reconnect SHOULD keep a fresh token available by calling this RPC after connecting

### rpc.Auth.Me

Request:

```ts
{}
```

Response:

```ts
{
  user: {
    id: string;
    origin: string;
    email: string;
    name: string;
    capabilities: string[];
    active: boolean;
  };
}
```

### rpc.Auth.ValidateRequest

Request:

```ts
{
  sessionKey: string;
  proof: string;
  subject: string;
  payloadHash: string;
  capabilities?: string[];
}
```

Response:

```ts
{
  allowed: boolean;
  inboxPrefix: string;
  user: {
    id: string;
    origin: string;
    email: string;
    name: string;
    capabilities: string[];
    active: boolean;
  };
}
```

This RPC is the capability and session lookup service used by other Trellis services.

### Device activation and profile RPCs

Device activation and device profile RPCs are defined in [device-activation.md](./device-activation.md):

- `rpc.Auth.CreateDeviceProfile`
- `rpc.Auth.ListDeviceProfiles`
- `rpc.Auth.GetDeviceProfile`
- `rpc.Auth.DisableDeviceProfile`
- `rpc.Auth.SetDeviceProfilePreferredDigest`
- `rpc.Auth.AddDeviceProfileDigest`
- `rpc.Auth.RemoveDeviceProfileDigest`
- `rpc.Auth.ActivateDevice`
- `rpc.Auth.ListDeviceActivations`
- `rpc.Auth.RevokeDeviceActivation`

## Admin RPCs

Admin RPCs require the `admin` capability unless a narrower auth contract later replaces that global rule.

### rpc.Auth.ListSessions

Request:

```ts
{
  user?: string;
}
```

Response:

```ts
{
  sessions: Array<{
    key: string;
    type: "user" | "service";
    createdAt: string;
    lastAuth: string;
  }>;
}
```

### rpc.Auth.RevokeSession

Request:

```ts
{
  sessionKey: string;
}
```

Response:

```ts
{ success: boolean }
```

### rpc.Auth.ListConnections

Request:

```ts
{
  user?: string;
  sessionKey?: string;
}
```

Response:

```ts
{
  connections: Array<{
    key: string;
    serverId: string;
    clientId: number;
    connectedAt: string;
  }>;
}
```

### rpc.Auth.KickConnection

Request:

```ts
{
  userNkey: string;
}
```

Response:

```ts
{ success: boolean }
```

## Emitted Events

Trellis publishes these events as part of `trellis.auth@v1`:

- `events.v1.Auth.Connect`
- `events.v1.Auth.Disconnect`
- `events.v1.Auth.SessionRevoked`
- `events.v1.Auth.ConnectionKicked`
- `events.v1.Auth.DeviceActivationApproved`
- `events.v1.Auth.DeviceActivationOnlineConfirmed`
- `events.v1.Auth.DeviceActivationRevoked`

Services may subscribe only when their installed contract explicitly declares them in `uses`.

## Non-Goals

- defining the proof/signature protocol
- defining TypeScript or Rust helper packages
- deployment/runbook guidance
