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
- public and admin `rpc.Auth.*` endpoints
- emitted auth events

It does not define language-specific client APIs.

Headings in this document use logical names like `rpc.Auth.Logout`. The wire
subjects remain versioned forms such as `rpc.v1.Auth.Logout` and
`rpc.v1.Auth.ActivateWorkload`.

## HTTP Endpoints

Browser auth endpoints:

- `POST /auth/requests`
- `GET /auth/login/:provider`
- `GET /auth/callback/:provider`
- `GET /auth/flow/:flowId`
- `POST /auth/flow/:flowId/approval`
- `POST /auth/flow/:flowId/bind`
- `POST /auth/bind`

Activated-device endpoints are defined in
[device-activation.md](./device-activation.md):

- `GET /auth/devices/activate`
- `POST /auth/devices/activate/wait`
- `POST /auth/devices/connect-info`

`GET /auth/devices/activate` creates the activation handoff, preserves login continuity through the resolved activation portal, and then routes into that portal. Portal resolution comes from the preregistered device instance and deployment-owned device portal policy, with fallback to the deployment device default custom portal when configured and finally to the built-in Trellis device portal. Callers do not provide a portal id or profile id in the normal path.

### POST /auth/requests

Starts the normal auth flow for a browser app or other contract-bearing user
client. The caller sends the initiating contract in the request body so auth can
either auto-complete reauth immediately or create an auth-owned browser flow and
return a short `flowId`-based login URL.

Request body:

| Name         | Required | Description                                              |
| ------------ | -------- | -------------------------------------------------------- |
| `provider`   | no       | Preferred provider id for direct provider continuation   |
| `redirectTo` | yes      | Post-login redirect URL                                  |
| `sessionKey` | yes      | Client public session key                                |
| `sig`        | yes      | `sign(hash("oauth-init:" + redirectTo + ":" + canonicalJson(context ?? null)))` by `sessionKey` |
| `contract`   | yes      | Initiating browser-app contract manifest JSON for portal routing and approval planning |
| `context`    | no       | Opaque JSON payload for app and portal coordination      |

Behavior:

1. Validate `redirectTo`
2. Verify `sig` by `sessionKey`
3. Validate the initiating contract and compute its digest
4. If an existing delegated user session for that `sessionKey` already covers the
   requested contract envelope, rebind immediately and return `status: "bound"`
5. Otherwise create an auth-owned browser flow record
6. Resolve the matching login portal selection for the initiating contract id
   when one exists
7. Otherwise fall back to the deployment login default custom portal when configured
8. Otherwise use the built-in Trellis login portal served by the Trellis HTTP server
9. Return `status: "flow_started"` with `{ flowId, loginUrl }`

Rules:

- browser apps send their contract manifest when they initiate login; they are approved per-user during auth rather than pre-installed like services
- bind later uses the contract already stored on the auth-owned browser flow rather than requiring the browser app to resubmit it
- if present, `context` is stored on the browser flow and returned to portals as app-owned opaque data
- a portal is trusted for this redirect only because deployment configuration registered its `entryUrl`; portal registration does not grant service authority
- first login does not require pre-registering a portal because the built-in Trellis login portal is always available
- auth MAY also apply a matching deployment-wide instance grant policy for the app's contract lineage and optional app origin; when it matches, or when an existing delegated session already grants a strict superset of the requested subjects and capabilities for the same contract lineage, auth may skip browser UX and return `bound` directly

### GET /auth/login/:provider

Initiates authentication for a configured provider for an existing browser flow,
usually after portal has chosen a provider.

Query parameters:

| Name     | Required | Description                                  |
| -------- | -------- | -------------------------------------------- |
| `flowId` | yes      | Browser flow id created by `POST /auth/requests` |

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
5. Provision or refresh the auth-local user projection
6. Generate `authToken`
7. Update the browser flow and pending auth state
8. Delete cookie
9. Redirect back into portal with `flowId` so portal can reload browser-flow
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
        context?: unknown;
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
- portal MUST treat `redirect.location` as an opaque next auth step
- `redirect.location` may point back to the originating browser app or into an activation route that continues a preserved `handoffId`
- portal does not invent auth-protocol next-step URLs locally, though it may still use its own local routes and UI state while rendering the flow
- portal-specific customization data travels through `app.context` rather than ad hoc query parameters between app and portal

### POST /auth/flow/:flowId/approval

Records an approval decision for the contract attached to the browser flow and
returns the next `PortalFlowState`. This endpoint replaces server-rendered
approval forms.

Rules:

- the portal is not trusted as a service when it submits an approval decision
- auth trusts only the active browser flow identified by `flowId` and the server-owned state attached to that flow

### POST /auth/flow/:flowId/bind

Binds a session key to an authenticated identity and approved contract digest for
the normal browser flow path.

Request:

```ts
{
  sessionKey: string;
  sig: string; // sign(hash("bind-flow:" + flowId))
}
```

Response: `BindResponse`

Behavior:

1. Load the browser flow by `flowId`
2. Load the pending authenticated state already attached to that flow
3. Verify `sessionKey` and `sig`
4. Read the contract already associated with the pending login
5. Validate the contract, compute digest, derive required capabilities, and
   check approval
6. Reject the bind if the user projection is inactive
7. Consume the pending auth state
8. Create or recover the session record for `<sessionKey>.<trellisId>`
9. Mint `bindingToken`

### POST /auth/bind

Binds a session key to an authenticated identity and approved contract digest.
This is the lower-level auth-token bind path retained for non-portal or legacy
callers. Normal browser flows SHOULD use `POST /auth/flow/:flowId/bind`.

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
5. Reject the bind if the user projection is inactive
6. CAS-delete `pendingAuth[authToken]`
7. Create or recover the session record for `<sessionKey>.<trellisId>`
8. Persist delegated contract metadata and delegated publish/subscribe subjects
   into the session
9. Mint `bindingToken`
10. Compute `inboxPrefix = _INBOX.${sessionKey.slice(0, 16)}`
11. Refresh the Trellis-local auth projection entry without overwriting
    admin-managed `active` state or granted capabilities
12. Return the bind response

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

The following self-service auth RPCs intentionally require no granted
capabilities beyond successful authenticated user context:

- `rpc.Auth.Me`
- `rpc.Auth.Logout`
- `rpc.Auth.RenewBindingToken`

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
{
  contractDigest: string;
}
```

Response:

```ts
type RenewBindingTokenResponse =
  | {
      status: "bound";
      bindingToken: string;
      inboxPrefix: string;
      expires: string;
      sentinel: {
        jwt: string;
        seed: string;
      };
      transports: ClientTransports;
    }
  | {
      status: "contract_changed";
    };
```

Rules:

- binding tokens are reusable until `expiresAt`
- this RPC is digest-only; it does not accept a replacement contract body or
  perform approval evaluation
- if `contractDigest` differs from the currently delegated session digest, auth
  returns `contract_changed` and the caller must start the normal HTTP auth flow
- if a later HTTP auth request returns `bound`, the caller MUST reconnect NATS
  before using newly granted subjects because the current connection JWT still
  carries the old permissions
- this is a zero-capability authenticated self-service RPC

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
  } | null;
  device: {
    type: "device";
    instanceId: string;
    publicIdentityKey: string;
    profileId: string;
    capabilities: string[];
    active: boolean;
  } | null;
  service: {
    type: "service";
    id: string;
    name: string;
    capabilities: string[];
    active: boolean;
  } | null;
}
```

Rules:

- this is a zero-capability authenticated self-service RPC
- user sessions receive the user envelope and null device/service entries
- device sessions receive the device envelope and, when available, the activating user in `user`
- service sessions receive the service envelope and null user/device entries

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
    trellisId: string;
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
    instanceId: string;
    publicIdentityKey: string;
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

This RPC is the capability and session lookup service used by other Trellis services. The caller shape is a union because users and devices all share the same post-auth authorization pipeline.

## Device Activation Public Surface

Detailed activation flow semantics, event ordering, and confirmation-code
behavior are defined in [device-activation.md](./device-activation.md). This
section defines the canonical public API shapes that other auth docs refer to.

Public auth-owned surfaces:

- HTTP endpoints `GET /auth/devices/activate`,
  `POST /auth/devices/activate/wait`, and
  `POST /auth/devices/connect-info`
- RPC subject `rpc.v1.Auth.ActivateDevice`
- RPC subject `rpc.v1.Auth.GetDeviceActivationStatus`
- portal, portal-override, device-profile, device-instance, and device
  lifecycle admin RPCs under `rpc.v1.Auth.*`
- event subject `events.v1.Auth.DeviceActivationReviewRequested`

Shared request and response types:

```ts
type ActivationDecisionReason = string; // deployment-defined machine-readable code

type Portal = {
  portalId: string;
  appContractId?: string;
  entryUrl: string;
  disabled: boolean;
};

type LoginPortalDefault = {
  portalId: string | null; // null means use the built-in Trellis login portal
};

type DevicePortalDefault = {
  portalId: string | null; // null means use the built-in Trellis device portal
};

type LoginPortalSelection = {
  contractId: string;
  portalId: string | null; // null forces the built-in Trellis login portal for this contract
};

type DevicePortalSelection = {
  profileId: string;
  portalId: string | null; // null forces the built-in Trellis device portal for this profile
};

type InstanceGrantPolicy = {
  contractId: string;
  allowedOrigins?: string[];
  impliedCapabilities: string[];
  disabled: boolean;
  createdAt: string;
  updatedAt: string;
  source: {
    kind: "admin_policy";
    createdBy?: {
      origin: string;
      id: string;
    };
    updatedBy?: {
      origin: string;
      id: string;
    };
  };
};

type DeviceProfile = {
  profileId: string;
  contractId: string;
  allowedDigests: string[];
  reviewMode?: "none" | "required";
  disabled: boolean;
};

type DeviceInstance = {
  instanceId: string;
  publicIdentityKey: string;
  profileId: string;
  metadata?: Record<string, string>;
  state: "registered" | "activated" | "revoked" | "disabled";
  createdAt: string;
  activatedAt: string | null;
  revokedAt: string | null;
};

type DeviceActivationRecord = {
  instanceId: string;
  publicIdentityKey: string;
  profileId: string;
  activatedBy?: {
    origin: string;
    id: string;
  };
  state: "activated" | "revoked";
  activatedAt: string;
  revokedAt: string | null;
};

type DeviceActivationReview = {
  reviewId: string;
  instanceId: string;
  publicIdentityKey: string;
  profileId: string;
  state: "pending" | "approved" | "rejected";
  requestedAt: string;
  decidedAt: string | null;
  reason?: ActivationDecisionReason;
};

type DeviceConnectInfo = {
  instanceId: string;
  profileId: string;
  contractId: string;
  contractDigest: string;
  transport: {
    natsServers: string[];
    sentinel: {
      jwt: string;
      seed: string;
    };
  };
  auth: {
    mode: "device_identity";
    iatSkewSeconds: number;
  };
};

type ActivateDeviceRequest = {
  handoffId: string;
};

type ActivateDeviceResponse =
  | {
      status: "activated";
      instanceId: string;
      profileId: string;
      activatedAt: string;
      confirmationCode?: string;
    }
  | {
      status: "pending_review";
      reviewId: string;
      instanceId: string;
      profileId: string;
      requestedAt: string;
    }
  | {
      status: "rejected";
      reason?: ActivationDecisionReason;
    };

type GetDeviceActivationStatusRequest = {
  handoffId: string;
};

type GetDeviceActivationStatusResponse = ActivateDeviceResponse;

type WaitForDeviceActivationResponse =
  | { status: "pending" }
  | {
      status: "activated";
      activatedAt: string;
      confirmationCode?: string;
      connectInfo: DeviceConnectInfo;
    }
  | {
      status: "rejected";
      reason?: ActivationDecisionReason;
    };

type GetDeviceConnectInfoRequest = {
  publicIdentityKey: string;
  contractDigest: string;
  iat: number;
  sig: string;
};

type GetDeviceConnectInfoResponse = {
  status: "ready";
  connectInfo: DeviceConnectInfo;
};

type CreatePortalRequest = {
  portalId: string;
  appContractId?: string;
  entryUrl: string;
};
type CreatePortalResponse = { portal: Portal };

type ListPortalsResponse = { portals: Portal[] };
type DisablePortalRequest = { portalId: string };

type GetLoginPortalDefaultResponse = { defaultPortal: LoginPortalDefault };
type ListInstanceGrantPoliciesResponse = { policies: InstanceGrantPolicy[] };
type UpsertInstanceGrantPolicyRequest = {
  contractId: string;
  allowedOrigins?: string[];
  impliedCapabilities: string[];
};
type UpsertInstanceGrantPolicyResponse = { policy: InstanceGrantPolicy };
type DisableInstanceGrantPolicyRequest = { contractId: string };
type DisableInstanceGrantPolicyResponse = { policy: InstanceGrantPolicy };
type SetLoginPortalDefaultRequest = { portalId: string | null };
type SetLoginPortalDefaultResponse = { defaultPortal: LoginPortalDefault };

type SetLoginPortalSelectionRequest = {
  contractId: string;
  portalId: string | null;
};
type SetLoginPortalSelectionResponse = { selection: LoginPortalSelection };

type ListLoginPortalSelectionsResponse = { selections: LoginPortalSelection[] };
type ClearLoginPortalSelectionRequest = { contractId: string };

type GetDevicePortalDefaultResponse = { defaultPortal: DevicePortalDefault };
type SetDevicePortalDefaultRequest = { portalId: string | null };
type SetDevicePortalDefaultResponse = { defaultPortal: DevicePortalDefault };

type SetDevicePortalSelectionRequest = {
  profileId: string;
  portalId: string | null;
};
type SetDevicePortalSelectionResponse = { selection: DevicePortalSelection };

type ListDevicePortalSelectionsResponse = { selections: DevicePortalSelection[] };
type ClearDevicePortalSelectionRequest = { profileId: string };

type CreateDeviceProfileRequest = {
  profileId: string;
  contractId: string;
  allowedDigests: string[];
  reviewMode?: "none" | "required";
};
type CreateDeviceProfileResponse = { profile: DeviceProfile };

type ListDeviceProfilesResponse = { profiles: DeviceProfile[] };
type DisableDeviceProfileRequest = { profileId: string };

type ProvisionDeviceInstanceRequest = {
  profileId: string;
  publicIdentityKey: string;
  activationKey: string;
  metadata?: Record<string, string>;
};
type ProvisionDeviceInstanceResponse = { instance: DeviceInstance };

type ListDeviceInstancesResponse = { instances: DeviceInstance[] };
type DisableDeviceInstanceRequest = { instanceId: string };

type ListDeviceActivationsResponse = { activations: DeviceActivationRecord[] };
type RevokeDeviceActivationRequest = { instanceId: string };

type ListDeviceActivationReviewsResponse = { reviews: DeviceActivationReview[] };

type DecideDeviceActivationReviewRequest = {
  reviewId: string;
  decision: "approve" | "reject";
  reason?: ActivationDecisionReason;
};

type DecideDeviceActivationReviewResponse = {
  review: DeviceActivationReview;
  activation?: DeviceActivationRecord;
  confirmationCode?: string;
};
```

Portal rules:

- Trellis always provides a built-in portal served by the Trellis HTTP server from static assets; it includes both login and generic device-activation routes and is not represented as a mutable portal record
- a portal record registers a custom browser destination and optional user-app identity metadata; it does not install or authenticate a service principal
- `appContractId`, when present, refers to a normal browser app contract that the portal may use after login while acting as the logged-in user
- portals MUST NOT use service-authenticated install or upgrade flows as their trust model

Portal selection rules:

- login portal selection checks an explicit `contractId -> portalId` record first, then the deployment login default custom portal, then the built-in Trellis login portal
- device activation checks an explicit `profileId -> portalId` record first, then the deployment device default custom portal, then the built-in Trellis device portal
- a selection record with `portalId: null` forces the built-in Trellis portal for that contract or profile, even when a deployment custom default exists
- clearing a contract or profile selection removes the explicit rule and returns that flow to the default chain
- most deployments can rely only on the built-in portal or one of the two deployment default custom portals

Library rule:

- public client libraries MAY wrap these HTTP and RPC surfaces with higher-level
  device-activation helpers, but those helpers MUST preserve these
  canonical wire shapes

Capability rule:

- review-decision RPCs MUST allow callers with `admin` or `device.review`
- instance grant policies are deployment policy, not user-owned grants; user-facing callers still see only explicit user capabilities in insufficient-capability responses

Canonical RPC inventory:

- `rpc.v1.Auth.ActivateDevice`
- `rpc.v1.Auth.GetDeviceActivationStatus`
- `rpc.v1.Auth.CreatePortal`
- `rpc.v1.Auth.ListPortals`
- `rpc.v1.Auth.DisablePortal`
- `rpc.v1.Auth.GetLoginPortalDefault`
- `rpc.v1.Auth.ListInstanceGrantPolicies`
- `rpc.v1.Auth.UpsertInstanceGrantPolicy`
- `rpc.v1.Auth.DisableInstanceGrantPolicy`
- `rpc.v1.Auth.SetLoginPortalDefault`
- `rpc.v1.Auth.ListLoginPortalSelections`
- `rpc.v1.Auth.SetLoginPortalSelection`
- `rpc.v1.Auth.ClearLoginPortalSelection`
- `rpc.v1.Auth.GetDevicePortalDefault`
- `rpc.v1.Auth.SetDevicePortalDefault`
- `rpc.v1.Auth.ListDevicePortalSelections`
- `rpc.v1.Auth.SetDevicePortalSelection`
- `rpc.v1.Auth.ClearDevicePortalSelection`
- `rpc.v1.Auth.CreateDeviceProfile`
- `rpc.v1.Auth.ListDeviceProfiles`
- `rpc.v1.Auth.DisableDeviceProfile`
- `rpc.v1.Auth.ProvisionDeviceInstance`
- `rpc.v1.Auth.ListDeviceInstances`
- `rpc.v1.Auth.DisableDeviceInstance`
- `rpc.v1.Auth.ListDeviceActivations`
- `rpc.v1.Auth.RevokeDeviceActivation`
- `rpc.v1.Auth.ListDeviceActivationReviews`
- `rpc.v1.Auth.DecideDeviceActivationReview`

Canonical event inventory:

- `events.v1.Auth.DeviceActivationReviewRequested`

## Admin RPCs

Admin RPCs require the `admin` capability unless explicitly documented otherwise.
Device review decision RPCs are the current exception and also allow
`device.review`.

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

### rpc.Auth.ListInstanceGrantPolicies

Request:

```ts
{}
```

Response:

```ts
{
  policies: InstanceGrantPolicy[];
}
```

### rpc.Auth.UpsertInstanceGrantPolicy

Request:

```ts
{
  contractId: string;
  allowedOrigins?: string[];
  impliedCapabilities: string[];
}
```

Response:

```ts
{
  policy: InstanceGrantPolicy;
}
```

Rules:

- `contractId` targets a contract lineage, not one exact digest
- `allowedOrigins`, when present, further restrict the policy to matching browser-app origins and are independent of the deployment `redirectTo` allowlist
- matching enabled policies imply app approval and implied capabilities dynamically; they do not copy those capabilities onto the user projection
- policy updates SHOULD revoke affected delegated user sessions so reconnect re-evaluates current policy

### rpc.Auth.DisableInstanceGrantPolicy

Request:

```ts
{
  contractId: string;
}
```

Response:

```ts
{
  policy: InstanceGrantPolicy;
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
