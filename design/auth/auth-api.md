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
- browser-flow APIs consumed by portal, including detached agent login
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

Activated-device endpoints are defined in
[device-activation.md](./device-activation.md):

- `POST /auth/devices/activate/requests`
- `POST /auth/devices/activate/wait`
- `POST /auth/devices/connect-info`

`POST /auth/devices/activate/requests` validates the outbound device activation
payload, creates a short-lived auth-owned browser flow with
`kind: "device_activation"`, resolves the activation portal, and returns a short
`flowId`-based `activationUrl`. Portal resolution comes from the preregistered
device instance and deployment-owned device portal policy, with fallback to the
deployment device default custom portal when configured and finally to the
built-in Trellis device portal. Callers do not provide portal ids or profile ids
in the normal path.

### POST /auth/requests

Starts the normal auth flow for an `app` or `agent` participant. The caller
sends the initiating contract in the request body so auth can either
auto-complete reauth immediately or create an auth-owned browser flow and return
a short `flowId`-based login URL.

Request body:

| Name         | Required | Description                                                                                                                                              |
| ------------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `provider`   | no       | Preferred provider id for direct provider continuation                                                                                                   |
| `redirectTo` | yes      | Post-login redirect URL                                                                                                                                  |
| `sessionKey` | yes      | Client public session key                                                                                                                                |
| `sig`        | yes      | `sign(hash("oauth-init:" + redirectTo + ":" + (provider ?? "") + ":" + canonicalJson(contract) + ":" + canonicalJson(context ?? null)))` by `sessionKey` |
| `contract`   | yes      | Initiating browser-app contract manifest JSON for portal routing and approval planning                                                                   |
| `context`    | no       | Opaque JSON payload for app and portal coordination                                                                                                      |

Behavior:

1. Validate `redirectTo`
2. Verify `sig` by `sessionKey`
3. Validate the initiating contract and compute its digest
4. If an existing delegated user session for that `sessionKey` already covers
   the requested contract envelope, rebind immediately and return
   `status: "bound"`
5. Otherwise create an auth-owned browser flow record
6. Resolve the matching login portal selection for the initiating contract id
   when one exists
7. Otherwise fall back to the deployment login default custom portal when
   configured
8. Otherwise use the built-in Trellis login portal served by the Trellis HTTP
   server
9. Return `status: "flow_started"` with `{ flowId, loginUrl }`

Rules:

- browser apps send their contract manifest when they initiate login; they are
  approved per-user during auth rather than pre-installed like services
- bind later uses the contract already stored on the auth-owned browser flow
  rather than requiring the browser app to resubmit it
- if present, `context` is stored on the browser flow and returned to portals as
  app-owned opaque data
- a portal is trusted for this redirect only because deployment configuration
  routed the flow there; portal records remain routing-only config and do not by
  themselves grant delegated approval or service authority
- first login does not require pre-registering a portal because the built-in
  Trellis login portal is always available
- auth MAY also apply a matching deployment-wide instance grant policy or
  portal-profile policy for the app's contract lineage and optional app origin;
  when one matches, or when an existing delegated session already grants a
  strict superset of the requested subjects and capabilities for the same
  contract lineage, auth may skip browser UX and return `bound` directly

### GET /auth/login/:provider

Initiates authentication for a configured provider for an existing browser flow,
usually after portal has chosen a provider.

Query parameters:

| Name     | Required | Description                                      |
| -------- | -------- | ------------------------------------------------ |
| `flowId` | yes      | Browser flow id created by `POST /auth/requests` |

Behavior:

1. Load the browser flow
2. Generate OAuth state and PKCE challenge
3. Store `{ provider, flowId, codeVerifier, createdAt }`
4. Set `trellis_oauth=state`
5. Redirect to the provider

Rules:

- the OAuth state cookie is `Secure` for HTTPS public origins
- loopback HTTP origins remain allowed without extra configuration for local
  development
- non-loopback HTTP public origins MUST be explicitly allowlisted with
  `web.allowInsecureOrigins`

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

Rules:

- callback redirects preserve `flowId`; they do not need to carry `trellisUrl`
  in the default model because the selected portal deployment already has an
  explicit Trellis instance URL configuration

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
      origin?: string;
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
- `redirect.location` may point back to the originating browser app or to
  another auth-owned step in the same login flow
- for detached agent login, `redirect.location` may resolve to the same portal
  login page; the built-in Trellis portal treats that same-page redirect as
  completion UX and tells the user to return to the Trellis CLI rather than
  redirecting again
- portal does not invent auth-protocol next-step URLs locally, though it may
  still use its own local routes and UI state while rendering the flow
- portal-specific customization data travels through `app.context` rather than
  ad hoc query parameters between app and portal

### POST /auth/flow/:flowId/approval

Records an approval decision for the contract attached to the browser flow and
returns the next `PortalFlowState`. This endpoint replaces server-rendered
approval forms.

Rules:

- the portal is not trusted as a service when it submits an approval decision
- auth trusts only the active browser flow identified by `flowId` and the
  server-owned state attached to that flow
- public portal helpers may expose decisions as `"approved" | "denied"`, but the
  HTTP request body remains the canonical boolean shape below

Request:

```ts
{
  approved: boolean;
}
```

### POST /auth/flow/:flowId/bind

Binds a session key to an authenticated identity and approved contract digest
for the normal browser flow path.

Request:

```ts
{
  sessionKey: string;
  sig: string; // sign(hash("bind-flow:" + flowId))
}
```

Response:

```ts
type BindResponse =
  | {
    status: "bound";
    inboxPrefix: string;
    expires: string;
    sentinel: {
      jwt: string;
      seed: string;
    };
    transports: {
      native?: {
        natsServers: string[];
      };
      websocket?: {
        natsServers: string[];
      };
    };
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

1. Load the browser flow by `flowId`
2. Load the pending authenticated state already attached to that flow
3. Verify `sessionKey` and `sig`
4. Read the contract already associated with the pending login
5. Validate the contract, compute digest, derive required capabilities, and
   check approval
6. Reject the bind if the user projection is inactive
7. Consume the pending auth state
8. Create or recover the session record keyed by `sessionKey`
9. Persist delegated contract metadata and delegated publish/subscribe subjects
   into the session
10. Compute `inboxPrefix = _INBOX.${sessionKey.slice(0, 16)}`
11. Refresh the Trellis-local auth projection entry without overwriting
    admin-managed `active` state or granted capabilities
12. Return the bind response with `inboxPrefix`, `expires`, `sentinel`, and
    `transports`

Rules:

- normal browser and detached agent flows bind only through the auth-owned
  browser flow after Trellis has already recorded an approval decision
- flow bind still rechecks approval and capabilities defensively
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

Revocation removes the stored delegated approval for that exact digest, revokes
matching active delegated sessions, and removes reconnect authority until a new
approval is granted.

## Authenticated User RPCs

These RPCs require `session-key` and `proof` headers.

The following self-service auth RPCs intentionally require no granted
capabilities beyond successful authenticated user context:

- `rpc.Auth.Me`
- `rpc.Auth.Logout`

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

Digest changes are handled by restarting the normal auth request flow with the
current contract body. Runtime reconnect auth is regenerated locally from
`sessionKey + contractDigest + iat + sig`; auth does not issue renewable binding
tokens.

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
    deviceId: string;
    deviceType: string;
    runtimePublicKey: string;
    deploymentId: string;
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
- device sessions receive the device envelope and, when available, the
  activating user in `user`
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
    deviceId: string;
    deviceType: string;
    runtimePublicKey: string;
    deploymentId: string;
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
services. The caller shape is a union because users and devices all share the
same post-auth authorization pipeline.

## Device Activation Public Surface

Detailed activation flow semantics, event ordering, and confirmation-code
behavior are defined in [device-activation.md](./device-activation.md). This
section defines the canonical public API shapes that other auth docs refer to.

Public auth-owned surfaces:

- HTTP endpoints `POST /auth/devices/activate/requests`,
  `POST /auth/devices/activate/wait`, and `POST /auth/devices/connect-info`
- operation subject `operations.v1.Auth.ActivateDevice`
- portal, portal-override, device-deployment, device-instance, and device
  lifecycle admin RPCs under `rpc.v1.Auth.*`
- event subject `events.v1.Auth.DeviceActivationReviewRequested`

Shared request and response types:

```ts
type ActivationDecisionReason = string; // deployment-defined machine-readable code

type Portal = {
  portalId: string;
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
  deploymentId: string;
  portalId: string | null; // null forces the built-in Trellis device portal for this deployment
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

type ServiceDeployment = {
  deploymentId: string;
  namespaces: string[];
  disabled: boolean;
  appliedContracts: Array<{
    contractId: string;
    allowedDigests: string[];
  }>;
};

type ServiceInstance = {
  instanceId: string;
  deploymentId: string;
  instanceKey: string;
  disabled: boolean;
  currentContractId?: string;
  currentContractDigest?: string;
  capabilities: string[];
  resourceBindings?: Record<string, unknown>;
  createdAt: string;
};

type CreateServiceDeploymentRequest = {
  deploymentId: string;
  namespaces: string[];
};
type CreateServiceDeploymentResponse = { deployment: ServiceDeployment };

type ListServiceDeploymentsResponse = { deployments: ServiceDeployment[] };

type ApplyServiceDeploymentContractRequest = {
  deploymentId: string;
  contract: Record<string, unknown>;
};
type ApplyServiceDeploymentContractResponse = {
  deployment: ServiceDeployment;
  contract: {
    id: string;
    digest: string;
    displayName: string;
    description: string;
    installedAt: string;
  };
};

type UnapplyServiceDeploymentContractRequest = {
  deploymentId: string;
  contractId: string;
  digests?: string[];
};
type UnapplyServiceDeploymentContractResponse = {
  deployment: ServiceDeployment;
};

type DisableServiceDeploymentRequest = { deploymentId: string };
type EnableServiceDeploymentRequest = { deploymentId: string };
type RemoveServiceDeploymentRequest = { deploymentId: string };
type RemoveServiceDeploymentResponse = { success: boolean };

type ProvisionServiceInstanceRequest = {
  deploymentId: string;
  instanceKey: string;
};
type ProvisionServiceInstanceResponse = { instance: ServiceInstance };

type ListServiceInstancesResponse = { instances: ServiceInstance[] };
type DisableServiceInstanceRequest = { instanceId: string };
type EnableServiceInstanceRequest = { instanceId: string };
type RemoveServiceInstanceRequest = { instanceId: string };
type RemoveServiceInstanceResponse = { success: boolean };

type DeviceDeployment = {
  deploymentId: string;
  appliedContracts: Array<{
    contractId: string;
    allowedDigests: string[];
  }>;
  reviewMode?: "none" | "required";
  disabled: boolean;
};

type DeviceInstance = {
  instanceId: string;
  publicIdentityKey: string;
  deploymentId: string;
  metadata?: Record<string, string>;
  state: "registered" | "activated" | "revoked" | "disabled";
  createdAt: string;
  activatedAt: string | null;
  revokedAt: string | null;
};

type DeviceActivationRecord = {
  instanceId: string;
  publicIdentityKey: string;
  deploymentId: string;
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
  deploymentId: string;
  state: "pending" | "approved" | "rejected";
  requestedAt: string;
  decidedAt: string | null;
  reason?: ActivationDecisionReason;
};

type DeviceConnectInfo = {
  instanceId: string;
  deploymentId: string;
  contractId: string;
  contractDigest: string;
  transports: {
    native?: { natsServers: string[] };
    websocket?: { natsServers: string[] };
  };
  transport: {
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
  flowId: string;
};

type ActivateDeviceProgress = {
  status: "pending_review";
  reviewId: string;
  instanceId: string;
  deploymentId: string;
  requestedAt: string;
};

type ActivateDeviceResponse =
  | {
    status: "activated";
    instanceId: string;
    deploymentId: string;
    activatedAt: string;
    confirmationCode?: string;
  }
  | {
    status: "rejected";
    reason?: ActivationDecisionReason;
  };

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
  deploymentId: string;
  portalId: string | null;
};
type SetDevicePortalSelectionResponse = { selection: DevicePortalSelection };

type ListDevicePortalSelectionsResponse = {
  selections: DevicePortalSelection[];
};
type ClearDevicePortalSelectionRequest = { deploymentId: string };

type CreateDeviceDeploymentRequest = {
  deploymentId: string;
  reviewMode?: "none" | "required";
};
type CreateDeviceDeploymentResponse = { deployment: DeviceDeployment };

type ListDeviceDeploymentsResponse = { deployments: DeviceDeployment[] };
type ApplyDeviceDeploymentContractRequest = {
  deploymentId: string;
  contract: Record<string, unknown>;
};
type ApplyDeviceDeploymentContractResponse = {
  deployment: DeviceDeployment;
  contract: {
    id: string;
    digest: string;
    displayName: string;
    description: string;
    installedAt: string;
  };
};
type UnapplyDeviceDeploymentContractRequest = {
  deploymentId: string;
  contractId: string;
  digests?: string[];
};
type UnapplyDeviceDeploymentContractResponse = { deployment: DeviceDeployment };
type DisableDeviceDeploymentRequest = { deploymentId: string };
type EnableDeviceDeploymentRequest = { deploymentId: string };
type RemoveDeviceDeploymentRequest = { deploymentId: string };
type RemoveDeviceDeploymentResponse = { success: boolean };

type ProvisionDeviceInstanceRequest = {
  deploymentId: string;
  publicIdentityKey: string;
  activationKey: string;
  metadata?: Record<string, string>;
};
type ProvisionDeviceInstanceResponse = { instance: DeviceInstance };

type ListDeviceInstancesResponse = { instances: DeviceInstance[] };
type DisableDeviceInstanceRequest = { instanceId: string };
type EnableDeviceInstanceRequest = { instanceId: string };
type RemoveDeviceInstanceRequest = { instanceId: string };
type RemoveDeviceInstanceResponse = { success: boolean };

type ListDeviceActivationsResponse = { activations: DeviceActivationRecord[] };
type RevokeDeviceActivationRequest = { instanceId: string };

type ListDeviceActivationReviewsResponse = {
  reviews: DeviceActivationReview[];
};

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

- Trellis always provides a built-in portal deployment for login and generic
  device-activation routes; it is commonly served by the Trellis HTTP server
  from static assets and is not represented as a mutable portal record
- portals are per-instance deployments by default, and built-in or custom portal
  apps should use explicit Trellis URL config rather than same-origin inference
- a portal record registers only custom browser routing config: `portalId`,
  `entryUrl`, and `disabled`
- a portal profile is the auth-owned portal trust policy keyed by `portalId`; it
  binds one browser app contract lineage and optional allowed origins to one
  routed portal entry point and stores the server-derived implied capabilities
- custom portals remain first-class, but there is no portal-specific contract
  kind or portal-specific auth machinery
- if a portal later calls Trellis after bind, it does so as a normal
  user-authenticated browser app contract rather than through portal-specific
  contract handling
- portals MUST NOT use service-authenticated install or upgrade flows as their
  trust model

Portal selection rules:

- login portal selection checks an explicit `contractId -> portalId` record
  first, then the deployment login default custom portal, then the built-in
  Trellis login portal
- device activation checks an explicit `deploymentId -> portalId` record first,
  then the deployment device default custom portal, then the built-in Trellis
  device portal
- a selection record with `portalId: null` forces the built-in Trellis portal
  for that contract or device deployment, even when a deployment custom default
  exists
- clearing a contract or device-deployment selection removes the explicit rule
  and returns that flow to the default chain
- most deployments can rely only on the built-in portal or one of the two
  deployment default custom portals

Library rule:

- public client libraries MAY wrap these HTTP and RPC surfaces with higher-level
  device-activation helpers, but those helpers MUST preserve these canonical
  wire shapes and the `Auth.ActivateDevice` operation model

Device-activation observation rule:

- portal-side review state is observed through normal operation `progress`,
  `watch()`, and `wait()` semantics on `Auth.ActivateDevice`, not through a
  separate status-poll RPC

Capability rule:

- review-decision RPCs MUST allow callers with `admin` or `device.review`
- instance grant policies are deployment policy, not user-owned grants;
  user-facing callers still see only explicit user capabilities in
  insufficient-capability responses
- portal profiles are also deployment policy, not user-owned grants; they imply
  approval only while both the portal profile and routed portal record remain
  enabled

Canonical RPC inventory:

- `rpc.v1.Auth.CreatePortal`
- `rpc.v1.Auth.ListPortals`
- `rpc.v1.Auth.DisablePortal`
- `rpc.v1.Auth.ListPortalProfiles`
- `rpc.v1.Auth.SetPortalProfile`
- `rpc.v1.Auth.DisablePortalProfile`
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
- `rpc.v1.Auth.CreateServiceDeployment`
- `rpc.v1.Auth.ListServiceDeployments`
- `rpc.v1.Auth.ApplyServiceDeploymentContract`
- `rpc.v1.Auth.UnapplyServiceDeploymentContract`
- `rpc.v1.Auth.DisableServiceDeployment`
- `rpc.v1.Auth.EnableServiceDeployment`
- `rpc.v1.Auth.RemoveServiceDeployment`
- `rpc.v1.Auth.ProvisionServiceInstance`
- `rpc.v1.Auth.ListServiceInstances`
- `rpc.v1.Auth.DisableServiceInstance`
- `rpc.v1.Auth.EnableServiceInstance`
- `rpc.v1.Auth.RemoveServiceInstance`
- `rpc.v1.Auth.CreateDeviceDeployment`
- `rpc.v1.Auth.ListDeviceDeployments`
- `rpc.v1.Auth.ApplyDeviceDeploymentContract`
- `rpc.v1.Auth.UnapplyDeviceDeploymentContract`
- `rpc.v1.Auth.DisableDeviceDeployment`
- `rpc.v1.Auth.EnableDeviceDeployment`
- `rpc.v1.Auth.RemoveDeviceDeployment`
- `rpc.v1.Auth.ProvisionDeviceInstance`
- `rpc.v1.Auth.ListDeviceInstances`
- `rpc.v1.Auth.DisableDeviceInstance`
- `rpc.v1.Auth.EnableDeviceInstance`
- `rpc.v1.Auth.RemoveDeviceInstance`
- `rpc.v1.Auth.ListDeviceActivations`
- `rpc.v1.Auth.RevokeDeviceActivation`
- `rpc.v1.Auth.ListDeviceActivationReviews`
- `rpc.v1.Auth.DecideDeviceActivationReview`

Canonical operation inventory:

- `operations.v1.Auth.ActivateDevice`

Canonical event inventory:

- `events.v1.Auth.DeviceActivationReviewRequested`

## Admin RPCs

Admin RPCs require the `admin` capability unless explicitly documented
otherwise. Device review decision RPCs are the current exception and also allow
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
- `allowedOrigins`, when present, further restrict the policy to matching
  browser-app origins and are independent of the deployment `redirectTo`
  allowlist
- matching enabled policies imply app approval and implied capabilities
  dynamically; they do not copy those capabilities onto the user projection
- policy updates SHOULD revoke affected delegated user sessions so reconnect
  re-evaluates current policy

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

### rpc.Auth.ListPortalProfiles

Request:

```ts
{}
```

Response:

```ts
{
  profiles: Array<{
    portalId: string;
    entryUrl: string;
    contractId: string;
    allowedOrigins?: string[];
    impliedCapabilities: string[];
    disabled: boolean;
    createdAt: string;
    updatedAt: string;
  }>;
}
```

### rpc.Auth.SetPortalProfile

Request:

```ts
{
  portalId: string;
  entryUrl: string;
  contractId: string;
  allowedOrigins?: string[];
}
```

Response:

```ts
{
  profile: {
    portalId: string;
    entryUrl: string;
    contractId: string;
    allowedOrigins?: string[];
    impliedCapabilities: string[];
    disabled: boolean;
    createdAt: string;
    updatedAt: string;
  };
}
```

Rules:

- `portalId` targets one routed custom portal entry point
- `contractId` targets a browser app contract lineage and MUST resolve to an
  installed browser app contract
- `allowedOrigins`, when present, further restrict matching browser-app origins;
  omitting them allows any origin that otherwise matches the contract lineage
- auth derives `impliedCapabilities` from the active installed contracts in that
  lineage rather than trusting caller-provided capability lists
- saving a portal profile also upserts the corresponding routed portal record so
  operators can register portal routing and portal trust in one admin action
- policy updates SHOULD revoke affected delegated user sessions so reconnect
  re-evaluates current policy

### rpc.Auth.DisablePortalProfile

Request:

```ts
{
  portalId: string;
}
```

Response:

```ts
{
  profile: {
    portalId: string;
    entryUrl: string;
    contractId: string;
    allowedOrigins?: string[];
    impliedCapabilities: string[];
    disabled: boolean;
    createdAt: string;
    updatedAt: string;
  };
}
```

Rules:

- disabling a portal profile removes the portal-owned implied approval path but
  does not by itself disable the routed portal record

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
