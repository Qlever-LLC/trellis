---
title: Auth API
description: Public auth HTTP endpoints, rpc.Auth APIs, and auth event surfaces.
order: 30
---

# Design: Auth API

## Prerequisites

- [trellis-auth.md](./trellis-auth.md) - auth architecture and approval model
- [auth-protocol.md](./auth-protocol.md) - proofs, connect tokens, and internal
  state rules

## Scope

This document defines the public Trellis auth API.

It covers:

- browser-flow broker, OAuth, and bind endpoints
- browser-flow APIs consumed by portal
- HTTP device activation endpoints
- auth-owned device activation operations
- public and admin `rpc.Auth.*` endpoints
- emitted auth events

It does not define language-specific client APIs.

Headings in this document use logical names like `rpc.Auth.Logout`. The wire
subjects remain versioned forms such as `rpc.v1.Auth.Logout` and
`operations.v1.Auth.RequestDeviceActivation`.

## HTTP Endpoints

Browser auth endpoints:

- `GET /auth/login`
- `GET /auth/login/:provider`
- `GET /auth/callback/:provider`
- `GET /auth/flow/:flowId`
- `POST /auth/flow/:flowId/approval`
- `POST /auth/bind`

Device activation endpoints are defined in
[device-activation.md](./device-activation.md):

- `GET /auth/device/activate`
- `POST /auth/device/activate/wait`

`GET /auth/device/activate` creates the activation handoff, preserves login
continuity through the deployment portal, and then routes into the configured
onboarding handler for the device type. Each device type still needs an explicit
onboarding handler binding. When a handler uses `trellis_default`, the default
onboarding UX may be served by the same deployed portal app that owns generic
login and approval screens.

### GET /auth/login

Validates the caller's login intent, creates a browser flow, resolves the active
deployment portal binding, and redirects the browser into that portal. The
portal owns provider chooser and approval UX.

Query parameters:

| Name         | Required | Description                                              |
| ------------ | -------- | -------------------------------------------------------- |
| `redirectTo` | yes      | Post-login redirect URL                                  |
| `sessionKey` | yes      | Client public session key                                |
| `sig`        | yes      | `sign(hash("oauth-init:" + redirectTo))` by `sessionKey` |
| `contract`   | yes      | Contract manifest JSON for approval planning             |

Behavior:

1. Validate `redirectTo`
2. Verify `sig` by `sessionKey`
3. Create an auth-owned browser flow record
4. Resolve the active deployment portal binding
5. Redirect to the portal `entryUrl` with `flowId` or an equivalent signed flow
   token

### GET /auth/login/:provider

Initiates authentication for a configured provider for an existing browser flow,
usually after portal has chosen a provider.

Query parameters:

| Name     | Required | Description                                  |
| -------- | -------- | -------------------------------------------- |
| `flowId` | yes      | Browser flow id created by `GET /auth/login` |

Behavior:

1. Load the browser flow
2. Generate OAuth state and PKCE challenge
3. Store `{ provider, flowId, codeVerifier, createdAt }`
4. Set `trellis_oauth=state`
5. Redirect to the provider

### GET /auth/callback/:provider

Handles provider callback and returns control to portal for the next
browser-flow step.

Behavior:

1. Verify cookie matches `state`
2. Lookup and CAS-delete the pending OAuth state
3. Exchange code for tokens
4. Fetch user info
5. Generate `authToken`
6. Update the browser flow and pending auth state
7. Delete cookie
8. Redirect back into portal with `flowId` so portal can reload browser-flow
   state and follow the next server-generated redirect when appropriate

### GET /auth/flow/:flowId

Returns machine-readable browser flow state for portal.

Response model:

```ts
type PortalFlowState =
  | {
    status: "choose_provider";
    flowId: string;
    providers: Array<{
      id: string;
      displayName: string;
    }>;
    app: {
      contractId: string;
      contractDigest: string;
      displayName: string;
      description: string;
      kind: string;
    };
  }
  | {
    status: "approval_required";
    flowId: string;
    user: {
      origin: string;
      id: string;
      name?: string;
      email?: string;
      image?: string;
    };
    approval: {
      contractId: string;
      contractDigest: string;
      displayName: string;
      description: string;
      kind: string;
      capabilities: string[];
    };
  }
  | {
    status: "approval_denied";
    flowId: string;
    approval: {
      contractId: string;
      contractDigest: string;
      displayName: string;
      description: string;
      kind: string;
      capabilities: string[];
    };
  }
  | {
    status: "insufficient_capabilities";
    flowId: string;
    approval: {
      contractId: string;
      contractDigest: string;
      displayName: string;
      description: string;
      kind: string;
      capabilities: string[];
    };
    missingCapabilities: string[];
    userCapabilities: string[];
  }
  | {
    status: "redirect";
    location: string;
  }
  | {
    status: "expired";
  };
```

Rules:

- portal renders UX only from this auth-owned flow state
- portal MUST treat `redirect.location` as an opaque next step
- `redirect.location` may point back to the originating browser app or into a
  device-onboarding route that continues a preserved `handoffId`
- portal does not invent next-step URLs locally

### POST /auth/flow/:flowId/approval

Records an approval decision for the contract attached to the browser flow and
returns the next `PortalFlowState`. This endpoint replaces server-rendered
approval forms.

### POST /auth/bind

Binds a session key to an authenticated identity and approved contract digest.
Browser flows reach this endpoint through portal after auth-owned login and
approval steps are complete.

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
4. Validate the contract, compute digest, derive required capabilities, and
   check approval
5. CAS-delete `pendingAuth[authToken]`
6. Create or recover the session record for `<sessionKey>.<trellisId>`
7. Persist delegated contract metadata and delegated publish/subscribe subjects
   into the session
8. Mint `bindingToken`
9. Compute `inboxPrefix = _INBOX.${sessionKey.slice(0, 16)}`
10. Refresh the Trellis-local auth projection entry
11. Return the bind response

Rules:

- normal browser and CLI flows reach `/auth/bind` only after Trellis has already
  recorded an approval decision
- `/auth/bind` still rechecks approval and capabilities defensively
- portal is a browser UX surface only; bind remains auth-owned

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
{
  success: boolean;
}
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
{
  success: boolean;
}
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
- clients that want seamless reconnect SHOULD keep a fresh token available by
  calling this RPC after connecting

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
type CallerView =
  | {
    type: "user";
    id: string;
    origin: string;
    email: string;
    name: string;
    image?: string;
    capabilities: string[];
    active: boolean;
  }
  | {
    type: "service";
    id: string;
    name: string;
    capabilities: string[];
    active: boolean;
  }
  | {
    type: "device";
    deviceId: string;
    deviceType: string;
    runtimePublicKey: string;
    profileId: string;
    capabilities: string[];
    active: boolean;
  };

{
  allowed: boolean;
  inboxPrefix: string;
  caller: CallerView;
}
```

This RPC is the capability and session lookup service used by other Trellis
services. The caller shape is a union because users, services, and devices all
share the same post-auth authorization pipeline.

## Device Activation Public Surface

Detailed activation flow semantics, event ordering, and confirmation-code
behavior are defined in [device-activation.md](./device-activation.md). This
section defines the canonical public API shapes that other auth docs refer to.

Public auth-owned surfaces:

- operation subject `operations.v1.Auth.RequestDeviceActivation`
- HTTP endpoints `GET /auth/device/activate` and
  `POST /auth/device/activate/wait`
- RPC subject `rpc.v1.Auth.ReviewDeviceActivation`
- portal binding, onboarding handler, device profile, and device lifecycle admin
  RPCs under `rpc.v1.Auth.*`

Shared request and response types:

```ts
type DeviceActivationDecisionReason = string; // deployment-defined machine-readable code

type PortalBinding = {
  authAppId: string;
  mode: "custom" | "trellis_default";
  contractId?: string;
  entryUrl: string;
  defaultOnboardingUrl?: string;
  disabled: boolean;
};

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

type CreatePortalBindingRequest = {
  authAppId: string;
  mode: "custom" | "trellis_default";
  contractId?: string;
  entryUrl: string;
  defaultOnboardingUrl?: string;
};
type CreatePortalBindingResponse = { binding: PortalBinding };

type GetPortalBindingRequest = {};
type GetPortalBindingResponse = { binding: PortalBinding | null };

type ListPortalBindingsRequest = {
  mode?: "custom" | "trellis_default";
  disabled?: boolean;
};
type ListPortalBindingsResponse = { bindings: PortalBinding[] };

type DisablePortalBindingRequest = { authAppId: string };

type CreateDeviceOnboardingHandlerRequest = {
  handlerId: string;
  matchDeviceType: string;
  mode: "custom" | "trellis_default";
  contractId?: string;
  entryUrl?: string;
};
type CreateDeviceOnboardingHandlerResponse = {
  handler: DeviceOnboardingHandler;
};

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
- `rpc.v1.Auth.CreatePortalBinding`
- `rpc.v1.Auth.GetPortalBinding`
- `rpc.v1.Auth.ListPortalBindings`
- `rpc.v1.Auth.DisablePortalBinding`
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

Admin RPCs require the `admin` capability unless a narrower auth contract later
replaces that global rule.

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
    type: "user" | "service" | "device";
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
{
  success: boolean;
}
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

`userNkey` is the final connection-identity token embedded in the `key` returned
by `rpc.Auth.ListConnections`.

Response:

```ts
{
  success: boolean;
}
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

Services may subscribe only when their installed contract explicitly declares
them in `uses`.

## Non-Goals

- defining the proof/signature protocol
- defining TypeScript or Rust helper packages
- deployment/runbook guidance
