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
- HTTP workload activation endpoints
- public and admin `rpc.Auth.*` endpoints
- emitted auth events

It does not define language-specific client APIs.

Headings in this document use logical names like `rpc.Auth.Logout`. The wire
subjects remain versioned forms such as `rpc.v1.Auth.Logout` and
`rpc.v1.Auth.ActivateWorkload`.

## HTTP Endpoints

Browser auth endpoints:

- `GET /auth/login`
- `GET /auth/login/:provider`
- `GET /auth/callback/:provider`
- `GET /auth/flow/:flowId`
- `POST /auth/flow/:flowId/approval`
- `POST /auth/flow/:flowId/bind`
- `POST /auth/bind`

Activated-workload endpoints are defined in
[workload-activation.md](./workload-activation.md):

- `GET /auth/workloads/activate`
- `POST /auth/workloads/activate/wait`
- `POST /auth/workloads/connect-info`

`GET /auth/workloads/activate` creates the activation handoff, preserves login continuity through the resolved activation portal, and then routes into that portal. Portal resolution comes from the preregistered workload instance and deployment-owned workload portal policy, with fallback to the deployment workload default custom portal when configured and finally to the built-in Trellis workload portal. Callers do not provide a portal id or profile id in the normal path.

### GET /auth/login

Validates the caller's login intent, creates a browser flow, resolves the matching login portal selection for the initiating contract when one exists, otherwise falls back to the deployment login default custom portal and finally to the built-in Trellis login portal, and redirects the browser into that portal. The portal owns provider chooser and approval UX.

Query parameters:

| Name         | Required | Description                                              |
| ------------ | -------- | -------------------------------------------------------- |
| `redirectTo` | yes      | Post-login redirect URL                                  |
| `sessionKey` | yes      | Client public session key                                |
| `sig`        | yes      | `sign(hash("oauth-init:" + redirectTo + ":" + canonicalJson(context ?? null)))` by `sessionKey` |
| `contract`   | yes      | Initiating browser-app contract manifest JSON for portal routing and approval planning |
| `context`    | no       | Opaque JSON payload for app and portal coordination      |

Behavior:

1. Validate `redirectTo`
2. Verify `sig` by `sessionKey`
3. Create an auth-owned browser flow record
4. Resolve the matching login portal selection for the initiating contract id when one exists
5. Otherwise fall back to the deployment login default custom portal when configured
6. Otherwise use the built-in Trellis login portal served by the Trellis HTTP server
7. Redirect to the portal `entryUrl` with `flowId` or an equivalent signed flow
   token

Rules:

- browser apps send their contract manifest when they initiate login; they are approved per-user during auth rather than pre-installed like services
- bind later uses the contract already stored on the auth-owned browser flow rather than requiring the browser app to resubmit it
- if present, `context` is stored on the browser flow and returned to portals as app-owned opaque data
- a portal is trusted for this redirect only because deployment configuration registered its `entryUrl`; portal registration does not grant service authority
- first login does not require pre-registering a portal because the built-in Trellis login portal is always available

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

- binding tokens are reusable until `expiresAt`
- clients that want seamless reconnect SHOULD keep a fresh token available by
  calling this RPC after connecting
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
  workload: {
    type: "workload";
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
- user sessions receive the user envelope and null workload/service entries
- workload sessions receive the workload envelope and, when available, the activating user in `user`
- service sessions receive the service envelope and null user/workload entries

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
    type: "workload";
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

This RPC is the capability and session lookup service used by other Trellis services. The caller shape is a union because users and workloads all share the same post-auth authorization pipeline.

## Workload Activation Public Surface

Detailed activation flow semantics, event ordering, and confirmation-code
behavior are defined in [workload-activation.md](./workload-activation.md). This
section defines the canonical public API shapes that other auth docs refer to.

Public auth-owned surfaces:

- HTTP endpoints `GET /auth/workloads/activate`,
  `POST /auth/workloads/activate/wait`, and
  `POST /auth/workloads/connect-info`
- RPC subject `rpc.v1.Auth.ActivateWorkload`
- RPC subject `rpc.v1.Auth.GetWorkloadActivationStatus`
- portal, portal-override, workload-profile, workload-instance, and workload
  lifecycle admin RPCs under `rpc.v1.Auth.*`
- event subject `events.v1.Auth.WorkloadActivationReviewRequested`

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

type WorkloadPortalDefault = {
  portalId: string | null; // null means use the built-in Trellis workload portal
};

type LoginPortalSelection = {
  contractId: string;
  portalId: string | null; // null forces the built-in Trellis login portal for this contract
};

type WorkloadPortalSelection = {
  profileId: string;
  portalId: string | null; // null forces the built-in Trellis workload portal for this profile
};

type WorkloadProfile = {
  profileId: string;
  contractId: string;
  allowedDigests: string[];
  reviewMode?: "none" | "required";
  disabled: boolean;
};

type WorkloadInstance = {
  instanceId: string;
  publicIdentityKey: string;
  profileId: string;
  state: "registered" | "activated" | "revoked" | "disabled";
  createdAt: string;
  activatedAt: string | null;
  revokedAt: string | null;
};

type WorkloadActivationRecord = {
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

type WorkloadActivationReview = {
  reviewId: string;
  instanceId: string;
  publicIdentityKey: string;
  profileId: string;
  state: "pending" | "approved" | "rejected";
  requestedAt: string;
  decidedAt: string | null;
  reason?: ActivationDecisionReason;
};

type WorkloadConnectInfo = {
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
    mode: "workload_identity";
    iatSkewSeconds: number;
  };
};

type ActivateWorkloadRequest = {
  handoffId: string;
};

type ActivateWorkloadResponse =
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

type GetWorkloadActivationStatusRequest = {
  handoffId: string;
};

type GetWorkloadActivationStatusResponse = ActivateWorkloadResponse;

type WaitForWorkloadActivationResponse =
  | { status: "pending" }
  | {
      status: "activated";
      activatedAt: string;
      confirmationCode?: string;
      connectInfo: WorkloadConnectInfo;
    }
  | {
      status: "rejected";
      reason?: ActivationDecisionReason;
    };

type GetWorkloadConnectInfoRequest = {
  publicIdentityKey: string;
  contractDigest: string;
  iat: number;
  sig: string;
};

type GetWorkloadConnectInfoResponse = {
  status: "ready";
  connectInfo: WorkloadConnectInfo;
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
type SetLoginPortalDefaultRequest = { portalId: string | null };
type SetLoginPortalDefaultResponse = { defaultPortal: LoginPortalDefault };

type SetLoginPortalSelectionRequest = {
  contractId: string;
  portalId: string | null;
};
type SetLoginPortalSelectionResponse = { selection: LoginPortalSelection };

type ListLoginPortalSelectionsResponse = { selections: LoginPortalSelection[] };
type ClearLoginPortalSelectionRequest = { contractId: string };

type GetWorkloadPortalDefaultResponse = { defaultPortal: WorkloadPortalDefault };
type SetWorkloadPortalDefaultRequest = { portalId: string | null };
type SetWorkloadPortalDefaultResponse = { defaultPortal: WorkloadPortalDefault };

type SetWorkloadPortalSelectionRequest = {
  profileId: string;
  portalId: string | null;
};
type SetWorkloadPortalSelectionResponse = { selection: WorkloadPortalSelection };

type ListWorkloadPortalSelectionsResponse = { selections: WorkloadPortalSelection[] };
type ClearWorkloadPortalSelectionRequest = { profileId: string };

type CreateWorkloadProfileRequest = {
  profileId: string;
  contractId: string;
  allowedDigests: string[];
  reviewMode?: "none" | "required";
};
type CreateWorkloadProfileResponse = { profile: WorkloadProfile };

type ListWorkloadProfilesResponse = { profiles: WorkloadProfile[] };
type DisableWorkloadProfileRequest = { profileId: string };

type ProvisionWorkloadInstanceRequest = {
  profileId: string;
  publicIdentityKey: string;
  activationKey: string;
};
type ProvisionWorkloadInstanceResponse = { instance: WorkloadInstance };

type ListWorkloadInstancesResponse = { instances: WorkloadInstance[] };
type DisableWorkloadInstanceRequest = { instanceId: string };

type ListWorkloadActivationsResponse = { activations: WorkloadActivationRecord[] };
type RevokeWorkloadActivationRequest = { instanceId: string };

type ListWorkloadActivationReviewsResponse = { reviews: WorkloadActivationReview[] };

type DecideWorkloadActivationReviewRequest = {
  reviewId: string;
  decision: "approve" | "reject";
  reason?: ActivationDecisionReason;
};

type DecideWorkloadActivationReviewResponse = {
  review: WorkloadActivationReview;
  activation?: WorkloadActivationRecord;
  confirmationCode?: string;
};
```

Portal rules:

- Trellis always provides a built-in portal served by the Trellis HTTP server from static assets; it includes both login and generic workload-activation routes and is not represented as a mutable portal record
- a portal record registers a custom browser destination and optional user-app identity metadata; it does not install or authenticate a service principal
- `appContractId`, when present, refers to a normal browser app contract that the portal may use after login while acting as the logged-in user
- portals MUST NOT use service-authenticated install or upgrade flows as their trust model

Portal selection rules:

- login portal selection checks an explicit `contractId -> portalId` record first, then the deployment login default custom portal, then the built-in Trellis login portal
- workload activation checks an explicit `profileId -> portalId` record first, then the deployment workload default custom portal, then the built-in Trellis workload portal
- a selection record with `portalId: null` forces the built-in Trellis portal for that contract or profile, even when a deployment custom default exists
- clearing a contract or profile selection removes the explicit rule and returns that flow to the default chain
- most deployments can rely only on the built-in portal or one of the two deployment default custom portals

Library rule:

- public client libraries MAY wrap these HTTP and RPC surfaces with higher-level
  workload-activation helpers, but those helpers MUST preserve these
  canonical wire shapes

Capability rule:

- review-decision RPCs MUST allow callers with `admin` or `workload.review`

Canonical RPC inventory:

- `rpc.v1.Auth.ActivateWorkload`
- `rpc.v1.Auth.GetWorkloadActivationStatus`
- `rpc.v1.Auth.CreatePortal`
- `rpc.v1.Auth.ListPortals`
- `rpc.v1.Auth.DisablePortal`
- `rpc.v1.Auth.GetLoginPortalDefault`
- `rpc.v1.Auth.SetLoginPortalDefault`
- `rpc.v1.Auth.ListLoginPortalSelections`
- `rpc.v1.Auth.SetLoginPortalSelection`
- `rpc.v1.Auth.ClearLoginPortalSelection`
- `rpc.v1.Auth.GetWorkloadPortalDefault`
- `rpc.v1.Auth.SetWorkloadPortalDefault`
- `rpc.v1.Auth.ListWorkloadPortalSelections`
- `rpc.v1.Auth.SetWorkloadPortalSelection`
- `rpc.v1.Auth.ClearWorkloadPortalSelection`
- `rpc.v1.Auth.CreateWorkloadProfile`
- `rpc.v1.Auth.ListWorkloadProfiles`
- `rpc.v1.Auth.DisableWorkloadProfile`
- `rpc.v1.Auth.ProvisionWorkloadInstance`
- `rpc.v1.Auth.ListWorkloadInstances`
- `rpc.v1.Auth.DisableWorkloadInstance`
- `rpc.v1.Auth.ListWorkloadActivations`
- `rpc.v1.Auth.RevokeWorkloadActivation`
- `rpc.v1.Auth.ListWorkloadActivationReviews`
- `rpc.v1.Auth.DecideWorkloadActivationReview`

Canonical event inventory:

- `events.v1.Auth.WorkloadActivationReviewRequested`

## Admin RPCs

Admin RPCs require the `admin` capability unless explicitly documented otherwise.
Workload review decision RPCs are the current exception and also allow
`workload.review`.

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
    type: "user" | "service" | "workload";
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
- `events.v1.Auth.WorkloadActivationRequested`
- `events.v1.Auth.WorkloadActivationApproved`
- `events.v1.Auth.WorkloadActivationRejected`
- `events.v1.Auth.WorkloadActivated`
- `events.v1.Auth.WorkloadActivationRevoked`

Services may subscribe only when their installed contract explicitly declares
them in `uses`.

## Non-Goals

- defining the proof/signature protocol
- defining TypeScript or Rust helper packages
- deployment/runbook guidance
