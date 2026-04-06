---
title: Auth API
description: Public auth HTTP endpoints, rpc.Auth APIs, and auth event surfaces.
order: 30
---

# Design: Auth API

## Prerequisites

- [trellis-auth.md](./trellis-auth.md) - auth architecture and approval model
- [auth-protocol.md](./auth-protocol.md) - proofs, connect tokens, and internal state rules

## Scope

This document defines the public Trellis auth API.

It covers:

- HTTP OAuth and bind endpoints
- HTTP device activation endpoints
- auth-owned device activation operations
- public and admin `rpc.Auth.*` endpoints
- emitted auth events

It does not define language-specific client APIs.

Headings in this document use logical names like `rpc.Auth.Logout`. The wire subjects remain versioned forms such as `rpc.v1.Auth.Logout` and `operations.v1.Auth.RequestDeviceActivation`.

## HTTP Endpoints

Device activation HTTP endpoints are defined in [device-activation.md](./device-activation.md):

- `GET /auth/device/activate`
- `POST /auth/device/activate/wait`

`GET /auth/device/activate` creates the activation handoff, resolves the onboarding handler from auth-owned deployment bindings for the device type, and then returns or redirects into that handler. Each device type needs an explicit handler binding. A binding may target a custom onboarding app or the Trellis default onboarding app.

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

Rules:

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

Rules:

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

## Device Activation Public Surface

Detailed activation flow semantics, event ordering, and confirmation-code behavior are defined in [device-activation.md](./device-activation.md). This section defines the canonical public API shapes that other auth docs refer to.

Public auth-owned surfaces:

- operation subject `operations.v1.Auth.RequestDeviceActivation`
- HTTP endpoints `GET /auth/device/activate` and `POST /auth/device/activate/wait`
- RPC subject `rpc.v1.Auth.ReviewDeviceActivation`
- onboarding handler, device profile, and device lifecycle admin RPCs under `rpc.v1.Auth.*`

Shared request and response types:

```ts
type DeviceActivationDecisionReason = string; // deployment-defined machine-readable code

type DeviceOnboardingHandler = {
  handlerId: string;
  matchDeviceType: string;
  mode: "custom" | "trellis_default";
  contractId?: string;
  entryUrl?: string;
  disabled: boolean;
};

type DeviceProfile = {
  profileId: string;
  deviceType: string;
  contractId: string;
  allowedDigests: string[];
  preferredDigest: string;
  disabled: boolean;
};

type DeviceActivationRecord = {
  requestId: string;
  deviceId: string;
  runtimePublicKey: string;
  profileId: string;
  state: "approved" | "revoked";
  approvedAt: string;
  activatedAt: string | null;
  revokedAt: string | null;
};

type ReviewDeviceActivationRequest = {
  requestId: string;
  approved: boolean;
  profileId?: string;
  reason?: DeviceActivationDecisionReason;
};

type ReviewDeviceActivationResponse =
  | {
      requestId: string;
      decision: "approved";
      profileId: string;
      approvedAt: string;
    }
  | {
      requestId: string;
      decision: "rejected";
      reason?: DeviceActivationDecisionReason;
      rejectedAt: string;
    };

type RequestDeviceActivationOutput = {
  requestId: string;
  profileId: string;
  confirmationCode: string;
};

type WaitForDeviceActivationCodeResponse =
  | {
      status: "approved";
      requestId: string;
      profileId: string;
      confirmationCode: string;
    }
  | {
      status: "rejected";
      requestId: string;
      reason?: DeviceActivationDecisionReason;
    }
  | {
      status: "pending";
    };

type CreateDeviceOnboardingHandlerRequest = {
  handlerId: string;
  matchDeviceType: string;
  mode: "custom" | "trellis_default";
  contractId?: string;
  entryUrl?: string;
};
type CreateDeviceOnboardingHandlerResponse = { handler: DeviceOnboardingHandler };

type ListDeviceOnboardingHandlersRequest = {
  matchDeviceType?: string;
  mode?: "custom" | "trellis_default";
  disabled?: boolean;
};

type ListDeviceOnboardingHandlersResponse = {
  handlers: DeviceOnboardingHandler[];
};

type DisableDeviceOnboardingHandlerRequest = { handlerId: string };

type CreateDeviceProfileRequest = {
  profileId: string;
  deviceType: string;
  contractId: string;
  allowedDigests: string[];
  preferredDigest: string;
};
type CreateDeviceProfileResponse = { profile: DeviceProfile };

type ListDeviceProfilesRequest = {
  deviceType?: string;
  contractId?: string;
  disabled?: boolean;
};

type ListDeviceProfilesResponse = { profiles: DeviceProfile[] };

type GetDeviceProfileRequest = { profileId: string };
type GetDeviceProfileResponse = { profile: DeviceProfile };

type DisableDeviceProfileRequest = { profileId: string };

type SetDeviceProfilePreferredDigestRequest = {
  profileId: string;
  preferredDigest: string;
};

type SetDeviceProfilePreferredDigestResponse = { profile: DeviceProfile };

type AddDeviceProfileDigestRequest = {
  profileId: string;
  digest: string;
};

type AddDeviceProfileDigestResponse = { profile: DeviceProfile };

type RemoveDeviceProfileDigestRequest = {
  profileId: string;
  digest: string;
};

type RemoveDeviceProfileDigestResponse = { profile: DeviceProfile };

type ListDeviceActivationsRequest = {
  deviceId?: string;
  runtimePublicKey?: string;
  profileId?: string;
  state?: "approved" | "revoked";
};

type ListDeviceActivationsResponse = {
  activations: DeviceActivationRecord[];
};

type RevokeDeviceActivationRequest = {
  deviceId: string;
};
```

Canonical RPC inventory:

- `rpc.v1.Auth.ReviewDeviceActivation`
- `rpc.v1.Auth.CreateDeviceOnboardingHandler`
- `rpc.v1.Auth.ListDeviceOnboardingHandlers`
- `rpc.v1.Auth.DisableDeviceOnboardingHandler`
- `rpc.v1.Auth.CreateDeviceProfile`
- `rpc.v1.Auth.ListDeviceProfiles`
- `rpc.v1.Auth.GetDeviceProfile`
- `rpc.v1.Auth.DisableDeviceProfile`
- `rpc.v1.Auth.SetDeviceProfilePreferredDigest`
- `rpc.v1.Auth.AddDeviceProfileDigest`
- `rpc.v1.Auth.RemoveDeviceProfileDigest`
- `rpc.v1.Auth.ListDeviceActivations`
- `rpc.v1.Auth.RevokeDeviceActivation`

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

`userNkey` is the final connection-identity token embedded in the `key` returned by `rpc.Auth.ListConnections`.


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
- `events.v1.Auth.DeviceActivationRequested`
- `events.v1.Auth.DeviceActivationApproved`
- `events.v1.Auth.DeviceActivationRejected`
- `events.v1.Auth.DeviceActivated`
- `events.v1.Auth.DeviceActivationRevoked`

Services may subscribe only when their installed contract explicitly declares them in `uses`.

## Non-Goals

- defining the proof/signature protocol
- defining TypeScript or Rust helper packages
- deployment/runbook guidance
