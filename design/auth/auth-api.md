---
title: Auth API
description: Public auth HTTP endpoints, rpc.Auth APIs, and auth event surfaces.
order: 30
---

# Design: Auth API

## Prerequisites

- [trellis-auth.md](./trellis-auth.md) - auth architecture and identity-envelope
  model
- [auth-protocol.md](./auth-protocol.md) - proofs, connect tokens, and internal
  state rules

## Scope

This document defines the public Trellis auth API.

It covers:

- browser-flow broker, OAuth, and bind endpoints
- browser-flow APIs consumed by portals, including detached CLI/native login
- HTTP device activation endpoints
- public and admin `rpc.Auth.*` endpoints
- emitted auth events

It does not define language-specific client APIs.

Headings in this document use logical grouped resource-first names such as
`rpc.Auth.Devices.List`. The wire subjects remain versioned forms such as
`rpc.v1.Auth.Devices.List` and
`operations.v1.Auth.DeviceUserAuthorities.Resolve`.

Public names use the resource group before the action. Examples:

- `Auth.Deployments.Create`
- `Auth.Devices.List`
- `Auth.Envelopes.Expand`
- `Auth.Envelopes.Shrink`
- `Auth.EnvelopeExpansions.Approve`
- `Auth.EnvelopeExpansions.List`

Shared approval capability views use this shape:

```ts
type ContractApprovalCapability = {
  displayName: string;
  description: string;
  consequence?: string;
};
```

## HTTP Endpoints

Browser auth endpoints:

- `POST /auth/requests`
- `GET /auth/login/:provider`
- `GET /auth/callback/:provider`
- `GET /auth/flow/:flowId`
- `POST /auth/flow/:flowId/register/local`
- `POST /auth/flow/:flowId/approval`
- `POST /auth/flow/:flowId/bind`

Global CORS behavior derives from `web.origins`:

- `web.origins: ["*"]` allows arbitrary browser origins without credentials.
  This is appropriate for public Trellis APIs where requests carry explicit
  Trellis proofs rather than ambient cookies.
- Specific `web.origins` entries allow only those configured origins and enable
  credentialed CORS for those origins.
- Flow-specific routes still perform stricter flow-local validation. Portal
  endpoints allow the selected portal origin for the flow. Bind allows only the
  app origin recorded when the flow was created from `redirectTo`. Credentialed
  routes such as OAuth callback state handling keep their stricter CORS/cookie
  rules.

Public Trellis URLs and public NATS/WebSocket transports should use HTTPS/WSS.
Loopback HTTP/WS remains valid for local development, and explicit
`web.allowInsecureOrigins` entries may permit other insecure public origins for
controlled deployments. Internal HTTP behind a trusted HTTPS reverse proxy is
still valid when the public browser-facing URL is secure.

Activated-device endpoints are defined in
[device-activation.md](./device-activation.md):

- `POST /auth/devices/activate/requests`
- `POST /auth/devices/activate/wait`
- `POST /auth/devices/connect-info`

`POST /auth/devices/activate/requests` validates the outbound device activation
payload, creates a short-lived auth-owned browser flow with
`kind: "device_activation"`, resolves the activation portal, and returns a short
`flowId`-based `activationUrl`. Portal resolution comes from the preregistered
device instance and deployment-owned portal-route metadata, with fallback to the
built-in Trellis device portal. Callers do not provide portal ids or profile ids
in the normal path.

### POST /auth/requests

Starts the normal auth flow for a contract-bearing user client such as a browser
app, CLI, or native app. The caller sends the initiating contract in the request
body so auth can either auto-complete reauth immediately or create an auth-owned
browser flow and return a short `flowId`-based login URL.

Request body:

| Name         | Required | Description                                                                                                                                              |
| ------------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `provider`   | no       | Preferred provider id for direct provider continuation                                                                                                   |
| `redirectTo` | yes      | Post-login redirect URL                                                                                                                                  |
| `sessionKey` | yes      | Client public session key                                                                                                                                |
| `sig`        | yes      | `sign(hash("oauth-init:" + redirectTo + ":" + (provider ?? "") + ":" + canonicalJson(contract) + ":" + canonicalJson(context ?? null)))` by `sessionKey` |
| `contract`   | yes      | Initiating user-client contract manifest JSON for portal routing and approval planning                                                                   |
| `context`    | no       | Opaque JSON payload for app and portal coordination                                                                                                      |

Behavior:

1. Validate `redirectTo`
2. Verify `sig` by `sessionKey`
3. Validate the initiating contract and compute its digest
4. If an existing delegated user session for that `sessionKey` already covers
   the requested contract envelope, rebind immediately and return
   `status: "bound"`
5. Otherwise create an auth-owned browser flow record
6. Resolve login portal routing from auth-owned portal route selectors using app
   contract id and origin
7. Otherwise use the DB-projected built-in Trellis login portal served by the
   Trellis HTTP server
8. Return `status: "flow_started"` with `{ flowId, loginUrl }`

Rules:

- user-facing apps and tools send their contract manifest when they initiate
  login; they are approved per-user during auth rather than pre-installed like
  services
- app, CLI, and native auth may present a contract digest first; when auth does
  not know that digest it returns `manifest_required`, and the client retries
  with the full manifest for validation, digest verification, and flow storage
- bind later uses the contract already stored on the auth-owned browser flow
  rather than requiring the browser app to resubmit it
- if present, `context` is stored on the browser flow and returned to portals as
  app-owned opaque data
- a portal is trusted for this redirect only because auth-owned login portal
  routing selected it for the flow; portal routes do not by themselves grant
  delegated approval or service authority
- first login does not require pre-registering a portal because the built-in
  Trellis login portal is always available
- auth MAY apply a matching grant override for the app's contract id and origin;
  when one matches, or when an existing identity envelope already grants a
  strict superset of the requested boundary for the same app identity, auth may
  skip browser UX and return `bound` directly

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
- if an OAuth/OIDC callback resolves to an unknown federated identity, Trellis
  may self-register it only when the selected login portal's effective policy
  allows federated registration and the provider is configured for the instance
- the selected login portal may further restrict federated providers; `null`
  means all configured providers are allowed, `[]` means none are allowed, and a
  non-empty list means only those configured provider ids may continue

### GET /auth/flow/:flowId

Returns machine-readable browser flow state for portal.

Response model:

```ts
type PortalFlowState =
  | {
    status: "choose_provider";
    flowId: string;
    // Effective providers after the selected portal policy is applied.
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
    portal?: {
      portalId: string;
      displayName: string;
      entryUrl: string | null;
      builtIn: boolean;
      disabled: boolean;
      createdAt: string;
      updatedAt: string;
    };
    registration?: {
      localIdentity: { available: boolean };
      federatedIdentity: {
        available: boolean;
        providers: Array<{ id: string; displayName: string }>;
      };
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
      capabilities: Record<string, ContractApprovalCapability>;
    };
  }
  | {
    status: "approval_denied";
    flowId: string;
    returnLocation?: string;
    approval: {
      contractId: string;
      contractDigest: string;
      displayName: string;
      description: string;
      capabilities: Record<string, ContractApprovalCapability>;
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
      capabilities: Record<string, ContractApprovalCapability>;
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
- custom portal libraries should use `flowId` as their browser URL state and
  call this endpoint to render auth state; they should not depend on
  provider-specific fragments or portal-local query conventions as protocol
  authority
- portal MUST treat `redirect.location` as an opaque next auth step
- `redirect.location` may point back to the originating browser app or to
  another auth-owned step in the same login flow
- `approval_denied` is a compatibility/fallback state for already-materialized
  denied flow state; normal user denial returns `redirect` to the originating
  app with `authError=approval_denied`, and portal helpers MAY treat an
  `approval_denied.returnLocation` as an immediate redirect target
- for detached CLI/native login, `redirect.location` may resolve to the same
  portal login page; the built-in Trellis portal treats that same-page redirect
  as completion UX and tells the user to return to the Trellis CLI rather than
  redirecting again
- portal does not invent auth-protocol next-step URLs locally, though it may
  still use its own local routes and UI state while rendering the flow
- portal-specific customization data travels through `app.context` rather than
  ad hoc query parameters between app and portal
- portal registration UI is gated by auth-owned flow state; clients MUST use
  `registration.localIdentity` and `registration.federatedIdentity` rather than
  inferring registration availability from provider lists or local UI defaults
- framework-neutral browser helpers and thin framework wrappers may hide the
  fetch and redirect plumbing, but exact helper declarations belong in the
  generated `/api` reference rather than in design docs

### POST /auth/flow/:flowId/register/local

Registers a local username/password identity for the selected browser login flow
and returns the next browser-flow state.

Local password credentials use Argon2id. The default minimum length is 12
characters; deployments may lower it only to the hard floor of 8. Trellis does
not impose composition rules, and the current implementation does not maintain a
PBKDF2 compatibility path for old hashes.

Request body:

```ts
{
  username: string;
  password: string;
  name: string;
  email: string;
}
```

Rules:

- local self-registration is allowed only when the selected login portal's
  effective policy enables local registration and the instance-level
  `auth.localIdentity.enabled` gate is enabled
- the request body uses `name` and `email`; portals MUST NOT split this into
  `firstName` or `familyName` wire fields
- successful local registration creates the account, local identity, password
  credential, and pending browser auth state atomically for the active flow
- duplicate local usernames and unavailable local registration are expected
  caller-visible failures, not unexpected server errors

### POST /auth/flow/:flowId/approval

Accepts the portal approval decision for the contract attached to the browser
flow and returns the next `PortalFlowState`. This endpoint replaces
server-rendered approval forms.

Rules:

- the portal is not trusted as a service when it submits an approval decision
- auth trusts only the active browser flow identified by `flowId` and the
  server-owned state attached to that flow
- public portal helpers may expose decisions as `"approved" | "denied"`, but the
  HTTP request body remains the canonical boolean shape below
- `approved: true` persists the approved contract decision when no existing
  account-scoped identity envelope or grant override already covers the request,
  then returns the normal redirect/bind continuation
- persisted approval reuse is scoped to the Trellis user account and app
  identity anchor; the current provider origin/subject is retained as audit
  evidence and is not the approval matching key
- `approved: false` does not persist a denied contract decision; it consumes the
  pending browser flow and returns a redirect to the caller's `redirectTo` with
  `authError=approval_denied`
- callers that receive `authError=approval_denied` SHOULD surface a denial
  result and clean the callback query parameters rather than immediately
  starting another sign-in flow

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
      capabilities: Record<string, ContractApprovalCapability>;
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

- normal browser and detached CLI/native flows bind only through the auth-owned
  browser flow after Trellis has already recorded an approval decision
- flow bind still rechecks approval and capabilities defensively
- portal is a browser UX surface only; bind remains auth-owned

## Identity Envelope RPCs

### rpc.Auth.Identities.List

Request:

```ts
{
  user?: string;
  offset?: number;
  limit: number;
}
```

Response:

```ts
type AuthIdentityGrantRow = {
  user: string;
  answer: "approved" | "denied";
  answeredAt: string;
  updatedAt: string;
  identityEnvelopeId: string;
  identityAnchor:
    | { kind: "web"; contractId: string; origin: string }
    | { kind: "cli"; contractId: string; sessionPublicKey: string }
    | { kind: "native"; contractId: string; sessionPublicKey: string }
    | { kind: "device-user"; contractId: string; devicePublicKey: string };
  contractEvidence: {
    contractDigest: string;
    contractId: string;
  };
  displayName: string;
  description: string;
  capabilities: Record<string, ContractApprovalCapability>;
  participantKind: "app" | "agent";
};

{
  entries: AuthIdentityGrantRow[];
  count: number;
  offset: number;
  limit: number;
  nextOffset?: number;
}
```

Callers without `admin` see only their own identity-envelope grants.

Identity-envelope grants are account-scoped: linked local and OIDC identities on
the same Trellis user account see and reuse the same grants for the same app
identity anchor. `contractDigest` and the provider identity that created the
grant are evidence metadata, not reuse keys.

List RPCs use the standard live offset page shape. Requests are
`{ offset?: number; limit: number }` plus documented filters. Responses are
`{ entries, count, offset, limit, nextOffset? }`. This is live offset
pagination, not snapshot or cursor pagination: concurrent inserts or deletes can
change which rows appear at later offsets. `limit` is required, `offset` is
optional and defaults to the first row, and implementations MUST apply any
filters in the database query before applying the bound.

### rpc.Auth.IdentityEnvelopes.Revoke

Request:

```ts
{
  identityEnvelopeId: string;
  user?: string;
}
```

Response:

```ts
{
  success: boolean;
}
```

Revocation removes the addressed identity-envelope grant, revokes matching
active delegated sessions, and removes reconnect authority until a new approval
expands the identity envelope again. `contractDigest` is evidence metadata, not
the revocation key.

## Authenticated User RPCs

These RPCs require `session-key` and `proof` headers. The contract digest is
authenticated during connect, bootstrap, or session binding and is resolved for
each request from stored session/principal state rather than from a per-request
header.

The following self-service auth RPCs intentionally require no granted
capabilities beyond successful authenticated user context:

- `rpc.Auth.Sessions.Me`
- `rpc.Auth.Sessions.Logout`
- `rpc.Auth.Users.IdentityLink.Create`
- `rpc.Auth.Users.Password.Change`

### rpc.Auth.Sessions.Logout

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

### rpc.Auth.Sessions.Me

Request:

```ts
{}
```

Response:

```ts
{
  participantKind: "app" | "agent" | "service" | "device";
  user: {
    userId: string;
    active: boolean;
    email: string;
    name: string;
    image?: string;
    capabilities: string[];
    identity: {
      identityId: string;
      provider: string;
      subject: string;
    };
    lastLogin?: string;
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

### rpc.Auth.Requests.Validate

Request:

```ts
{
  sessionKey: string;
  proof: string;
  subject: string;
  payloadHash: string;
  iat: number;
  requestId: string;
  capabilities?: string[];
}
```

Response:

```ts
type CallerView =
  | {
    type: "user";
    participantKind: "app" | "agent";
    userId: string;
    identity: {
      identityId: string;
      provider: string;
      subject: string;
    };
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

The `proof` covers the session key, request subject, raw payload hash, corrected
`iat`, and `requestId`. Empty proof, session, subject, payload-hash, request-id,
or capability strings are invalid. `payloadHash` is the hash of the raw request
body computed by the receiving service; callers do not get to override it with a
trusted header. Validation uses a replay cache keyed by session and request id.
The proof does not include `contractDigest`; validation resolves contract
context, principal identity, and capabilities from the authenticated session
state that was created at connect, bootstrap, or session binding time.

`Auth.Requests.Validate` is a baseline auth surface for service runtimes.
Trellis may make it available to services automatically, without requiring every
service contract to declare an explicit auth `uses` entry for this RPC.

## Device Activation Public Surface

Detailed activation flow semantics, event ordering, and confirmation-code
behavior are defined in [device-activation.md](./device-activation.md). This
section defines the canonical public API shapes that other auth docs refer to.

Public auth-owned surfaces:

- HTTP endpoints `POST /auth/devices/activate/requests`,
  `POST /auth/devices/activate/wait`, and `POST /auth/devices/connect-info`
- operation subject `operations.v1.Auth.DeviceUserAuthorities.Resolve`
- grouped deployment, envelope, service-instance, device-instance, and device
  lifecycle admin RPCs under `rpc.v1.Auth.*`
- event subjects `events.v1.Auth.DeviceUserAuthorities.Requested`,
  `events.v1.Auth.DeviceUserAuthorities.Approved`,
  `events.v1.Auth.DeviceUserAuthorities.Resolved`, and
  `events.v1.Auth.DeviceUserAuthorities.ReviewRequested`

Shared request and response types:

```ts
type ActivationDecisionReason = string; // deployment-defined machine-readable code

type EnvelopeBoundary = {
  contracts: Array<{ contractId: string; required: boolean }>;
  surfaces: Array<{
    contractId: string;
    kind: "rpc" | "operation" | "event" | "feed";
    name: string;
    action: "call" | "publish" | "subscribe" | "read" | "cancel";
    required: boolean;
  }>;
  capabilities: string[];
  resources: Array<{
    kind: "kv" | "store" | "jobs" | "transfer";
    alias: string;
    required: boolean;
  }>;
};

type DeploymentEnvelope = {
  deploymentId: string;
  kind: "service" | "device" | "app" | "cli" | "native" | "device-user";
  disabled: boolean;
  createdAt: string;
  updatedAt: string;
  boundary: EnvelopeBoundary;
};

type DeploymentContractEvidence = {
  deploymentId: string;
  contractId: string;
  contractDigest: string;
  contract: Record<string, unknown>;
  firstSeenAt: string;
  lastSeenAt: string;
  ignoredAt?: string | null;
  ignoredBy?: Record<string, unknown> | null;
  ignoreReason?: string | null;
};

type DeploymentPortalRoute = {
  deploymentId: string;
  portalId: string | null;
  entryUrl: string | null;
  disabled: boolean;
  updatedAt: string;
};

type DeploymentGrantOverride =
  & {
    deploymentId: string;
    contractId: string;
    grantKind: "capability" | "capability-group";
    capability: string | null;
    capabilityGroupKey: string | null;
  }
  & (
    | {
      identityKind: "web";
      origin: string;
      sessionPublicKey: null;
    }
    | {
      identityKind: "session";
      origin: null;
      sessionPublicKey: string;
    }
  );
```

`DeploymentContractEvidence` records the manifest digest and reviewed contract
body used for envelope resolution. It is evidence, not a standalone authority
source. Authority comes from deployment envelopes, identity envelopes, and
deployment grant overrides. The active projection uses deployment evidence only
through enabled deployment envelopes, and non-ignored reviewed evidence rows
covered by those envelopes contribute active digests. Ignored same-id rows
remain historical rollout and audit context.

```ts
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

type AuthDeployment =
  | {
    kind: "service";
    deploymentId: string;
    namespaces: string[];
    disabled: boolean;
  }
  | {
    kind: "device";
    deploymentId: string;
    reviewMode?: "none" | "required";
    disabled: boolean;
  };

type CreateDeploymentRequest =
  | { kind: "service"; deploymentId: string; namespaces: string[] }
  | { kind: "device"; deploymentId: string; reviewMode?: "none" | "required" };
type CreateDeploymentResponse = { deployment: AuthDeployment };

type ListDeploymentsRequest = {
  kind?: "service" | "device";
  disabled?: boolean;
  offset?: number;
  limit: number;
};
type ListDeploymentsResponse = PageResponse<AuthDeployment>;

type ListEnvelopesRequest = {
  kind?: "service" | "device" | "app" | "cli" | "native" | "device-user";
  disabled?: boolean;
  offset?: number;
  limit: number;
};
type ListEnvelopesResponse = PageResponse<DeploymentEnvelope>;

type GetEnvelopeRequest = { deploymentId: string };
type GetEnvelopeResponse = {
  envelope: DeploymentEnvelope;
  resourceBindings: Array<Record<string, unknown>>;
  contractEvidence: DeploymentContractEvidence[];
  expansionRequests: Array<Record<string, unknown>>;
  portalRoute: DeploymentPortalRoute | null;
  grantOverrides: DeploymentGrantOverride[];
};

type PutGrantOverridesRequest = {
  deploymentId: string;
  overrides: DeploymentGrantOverride[];
};
type ListGrantOverridesRequest = {
  offset?: number;
  limit: number;
};
type ListGrantOverridesResponse = PageResponse<DeploymentGrantOverride>;
type RemoveGrantOverridesRequest = {
  deploymentId: string;
  overrides: DeploymentGrantOverride[];
};
type GrantOverridesResponse = { grantOverrides: DeploymentGrantOverride[] };

type ExpandEnvelopeRequest = {
  deploymentId: string;
  contract: Record<string, unknown>;
  expectedDigest: string;
};
type ExpandEnvelopeResponse = {
  envelope: DeploymentEnvelope;
  delta: EnvelopeBoundary;
  contractEvidence: DeploymentContractEvidence;
  resourceBindings: Array<Record<string, unknown>>;
};

type ShrinkEnvelopeRequest = {
  deploymentId: string;
  proposedBoundary: EnvelopeBoundary;
  confirm: boolean;
};
type ShrinkEnvelopeResponse = {
  envelope: DeploymentEnvelope;
  impact: Record<string, unknown>;
  retainedResources: Array<{ kind: string; alias: string }>;
};
```

Envelope expansion and shrink are command-style control-plane mutations. They
are not long-running operations, but they must behave as all-or-nothing updates
for the durable deployment record:

- `Auth.Envelopes.Expand` requires a reviewed delta, validates any presented
  contract evidence by recomputing its digest and derived boundary, validates
  the staged deployment envelope, then persists the durable envelope/evidence
  rows and refreshes the active catalog projection.
- `Auth.Envelopes.Shrink` validates the staged deployment envelope before
  persistence, then refreshes the active catalog projection before kicking
  affected runtime connections.
- service and device deployment enable/disable mutations validate the active
  catalog with the matching staged deployment-envelope disabled state, because
  enabled deployment envelopes define the active evidence set.
- `Auth.Envelopes.GrantOverrides.Put` replaces all grant override rows for one
  deployment. `Auth.Envelopes.GrantOverrides.List` pages grant override rows
  across deployments. `Auth.Envelopes.GrantOverrides.Remove` removes exact
  matching rows. Mutations return the deployment's current grant override rows.
  Grant override rows use only two identity shapes: web rows match a
  `contractId` plus browser `origin`, and session rows match a `contractId` plus
  `sessionPublicKey`.
- service and device deployment mutations fail closed when the proposed active
  set has inactive or missing `uses` dependencies; Trellis validates that staged
  catalog state before exposing it to runtime permissions.
- catalog refresh, surface-status checks, portal routing resolution, shrink
  previews, and unused installed-contract cleanup use targeted durable-store
  queries for the addressed deployment, digest, route, or binding records rather
  than broad local scans.
- service and device deployment removal is the narrow exception: removal still
  validates active digests and active contract compatibility, but it may refresh
  the post-removal catalog without active `uses` validation so operators can
  tear down an already-broken active graph instead of being trapped by stale
  dependencies.
- service and device envelope changes are race-safe review submissions: auth
  must compare the reviewed contract evidence with the recomputed evidence
  before mutating durable deployment state.
- if active-catalog refresh fails after persistence, auth rolls the deployment
  record back; if rollback also fails, the RPC returns an unexpected aggregate
  failure rather than reporting a successful envelope change.
- service bootstrap validates that the presented contract evidence fits the
  enabled parent deployment envelope, has not been ignored, and matches the
  service instance's current runtime evidence when that instance already has
  runtime evidence. Instance state affects runtime availability; it does not
  activate catalog/auth surfaces.
- service bootstrap may create pending expansion requests from presented
  manifests whose required dependency contracts are not active yet. Unknown
  required dependencies are recorded as unresolved contract blockers; known
  inactive dependencies can be used for review-time surface and capability
  display, but not for runtime grants.
- missing optional dependency contracts or optional requested surfaces are
  absent from the requested delta and grant no authority. If they later become
  active, a fresh reconnect requests a normal expansion before receiving that
  optional authority.
- if the deployment envelope fits but the required dependency closure is not
  active, service bootstrap returns `contract_activation_pending` and must not
  persist liveness state, resource bindings, or active deployment evidence for
  that ready attempt.
- if the digest presented at bootstrap has been ignored or no longer fits the
  enabled deployment envelope, service bootstrap returns `contract_changed` and
  must not refresh that evidence row back into the active set.
- the successful service bootstrap response includes the resolved resource
  binding payload for the presented digest; service runtimes use that binding to
  initialize KV, store, jobs, and transfer helpers without requiring a
  post-connect `Trellis.Catalog` or `Trellis.Bindings.Get` call from the service
  principal.

```ts
type DisableDeploymentRequest = {
  kind: "service" | "device";
  deploymentId: string;
};
type EnableDeploymentRequest = {
  kind: "service" | "device";
  deploymentId: string;
};
type RemoveDeploymentRequest = {
  kind: "service" | "device";
  deploymentId: string;
  cascade?: boolean;
  // Also run unused installed-contract cleanup for contract digests that are no
  // longer referenced by any installed deployment record.
  purgeUnusedContracts?: boolean;
};
type RemoveDeploymentResponse = { success: boolean };

type ProvisionServiceInstanceRequest = {
  deploymentId: string;
  instanceKey: string;
};
type ProvisionServiceInstanceResponse = { instance: ServiceInstance };

type ListServiceInstancesRequest = {
  deploymentId?: string;
  disabled?: boolean;
  offset?: number;
  limit: number;
};
type ListServiceInstancesResponse = PageResponse<ServiceInstance>;
type DisableServiceInstanceRequest = { instanceId: string };
type EnableServiceInstanceRequest = { instanceId: string };
type RemoveServiceInstanceRequest = { instanceId: string };
type RemoveServiceInstanceResponse = { success: boolean };

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
    authority: "admin_reviewed" | "user_delegated";
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

type WaitForDeviceActivationRequest = {
  flowId: string;
  publicIdentityKey: string;
  nonce: string;
  contractDigest: string;
  iat: number;
  sig: string;
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

// `POST /auth/devices/connect-info` and `Auth.Devices.ConnectInfo.Get` return
// `auth.authority: "user_delegated"` for activated devices and
// `auth.authority: "admin_reviewed"` for admin/review-approved setup flows.
// Runtime access still requires the presented contract evidence to fit the
// device deployment envelope.
//
// `POST /auth/devices/activate/wait` verifies the signed `flowId` and then
// loads the browser flow directly by that id before matching `publicIdentityKey`
// and `nonce`. The QR/MAC activation payload remains the intended bearer
// artifact for handing the setup flow from the device to a browser.

type ProvisionDeviceInstanceRequest = {
  deploymentId: string;
  publicIdentityKey: string;
  activationKey: string;
  metadata?: Record<string, string>;
};
type ProvisionDeviceInstanceResponse = { instance: DeviceInstance };

type ListDeviceInstancesRequest = {
  deploymentId?: string;
  state?: "registered" | "activated" | "revoked" | "disabled";
  offset?: number;
  limit: number;
};
type ListDeviceInstancesResponse = PageResponse<DeviceInstance>;
type DisableDeviceInstanceRequest = { instanceId: string };
type EnableDeviceInstanceRequest = { instanceId: string };
type RemoveDeviceInstanceRequest = { instanceId: string };
type RemoveDeviceInstanceResponse = { success: boolean };

type ListDeviceActivationsRequest = {
  instanceId?: string;
  deploymentId?: string;
  state?: "activated" | "revoked";
  offset?: number;
  limit: number;
};
type ListDeviceActivationsResponse = PageResponse<DeviceActivationRecord>;
type RevokeDeviceActivationRequest = { instanceId: string };

type ListDeviceActivationReviewsRequest = {
  instanceId?: string;
  deploymentId?: string;
  state?: "pending" | "approved" | "rejected";
  offset?: number;
  limit: number;
};
type ListDeviceActivationReviewsResponse = PageResponse<DeviceActivationReview>;

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

- Trellis always provides built-in login and generic device-activation portal
  routes; they are commonly served by the Trellis HTTP server from static assets
  and the built-in login portal is represented as a visible, non-deletable
  auth-owned portal record
- login portal records, policy, and route selection live in auth-owned projected
  storage and are exposed through `Auth.Portals.*` admin RPCs; device-activation
  portal routing remains deployment-owned unless its design explicitly changes
- non-built-in login portal records can be created or updated through
  `Auth.Portals.Put`; the built-in login portal remains visible and
  non-deletable and cannot be replaced by a portal upsert
- non-built-in login portal records can be removed through `Auth.Portals.Remove`
  only when no login route targets them; built-in portal records cannot be
  removed
- login portal settings include `allowedFederatedProviders: string[] | null`;
  `null` allows every configured OAuth/OIDC provider, `[]` allows no federated
  providers, and an array allows only that configured subset
- `Auth.Portals.Get` returns the portal record, login settings, portal-scoped
  routes, default grants, and `federatedProviders` for admin display of
  configured provider ids, display names, and provider types; it does not expose
  provider secrets or mutate provider configuration
- custom portal apps should use explicit Trellis URL config rather than
  same-origin inference
- portal routing metadata does not imply approval, capabilities, or
  availability; approval and capabilities come from identity envelopes,
  deployment envelopes, and grant overrides
- custom portals remain first-class browser apps, but there is no
  portal-specific contract kind or portal-specific auth machinery
- if a portal later calls Trellis after bind, it does so as a normal
  user-authenticated browser app contract rather than through portal-specific
  contract handling
- portals MUST NOT use service deployment authority as their trust model

Portal routing rules:

- login flows resolve portal routing from auth-owned selectors in this order:
  contract id plus origin, contract id, origin, global default, built-in login
  portal fallback
- device activation resolves portal routing from the device deployment envelope,
  then falls back to the built-in Trellis device portal
- for login routes, the built-in login portal has the explicit id
  `trellis.builtin.login`
- the built-in device activation portal is a Trellis-owned app contract with the
  id `trellis.portal.activation@v1`
- custom login portals must have a visible portal record before a login route
  can target them
- route keys are selector-derived RPC identity for one `contractId + origin`
  selector; operator UI should present routes as app/contract selectors owned by
  each portal instead of as a global route inventory
- adding a portal-scoped route for a selector already targeting another portal
  is rejected rather than silently moving the selector
- most deployments can rely on the built-in portal; custom routing is optional

Library rule:

- public client libraries MAY wrap these HTTP and RPC surfaces with higher-level
  browser-flow, portal, admin, service, and device-activation helpers, but those
  helpers MUST preserve these canonical wire shapes and the
  `Auth.DeviceUserAuthorities.Resolve` operation model
- exact TypeScript helper declarations belong in the generated `/api` reference;
  exact Rust helper declarations belong in Rustdoc

Device-activation observation rule:

- portal-side review state is observed through normal operation `progress`,
  `watch()`, and `wait()` semantics on `Auth.DeviceUserAuthorities.Resolve`, not
  through a separate status-poll RPC
- when `Auth.DeviceUserAuthorities.Reviews.Decide` approves or rejects a review,
  it completes the original device-user authority operation durably; retrying
  the decision is accepted only when the existing completed operation output
  matches the requested terminal result

Capability rule:

- review-decision RPCs MUST allow callers with `admin` or
  `trellis.auth::device.review`
- grant overrides are deployment metadata, not user-owned grants; user-facing
  callers still see only explicit user capabilities in insufficient-capability
  responses
- deployment grant approval applies only when matching grant overrides
  themselves cover the required approval capabilities; user capabilities do not
  turn a grant override into approval authority
- portal routes, defaults, selections, and registration settings do not imply
  approval, service authority, or capability grants; registration availability
  is reported explicitly in browser-flow state

Canonical RPC inventory:

- `rpc.v1.Auth.Deployments.Create`
- `rpc.v1.Auth.Deployments.List`
- `rpc.v1.Auth.Deployments.Disable`
- `rpc.v1.Auth.Deployments.Enable`
- `rpc.v1.Auth.Deployments.Remove`
- `rpc.v1.Auth.Envelopes.List`
- `rpc.v1.Auth.Envelopes.Get`
- `rpc.v1.Auth.Envelopes.GrantOverrides.Put`
- `rpc.v1.Auth.Envelopes.GrantOverrides.List`
- `rpc.v1.Auth.Envelopes.GrantOverrides.Remove`
- `rpc.v1.Auth.Envelopes.Expand`
- `rpc.v1.Auth.Envelopes.Shrink`
- `rpc.v1.Auth.EnvelopeExpansions.Approve`
- `rpc.v1.Auth.EnvelopeExpansions.List`
- `rpc.v1.Auth.EnvelopeExpansions.Reject`
- `rpc.v1.Auth.Envelopes.Changes.Preview`
- `rpc.v1.Auth.ServiceInstances.Provision`
- `rpc.v1.Auth.ServiceInstances.List`
- `rpc.v1.Auth.ServiceInstances.Disable`
- `rpc.v1.Auth.ServiceInstances.Enable`
- `rpc.v1.Auth.ServiceInstances.Remove`
- `rpc.v1.Auth.Identities.List`
- `rpc.v1.Auth.Identities.Grants.List`
- `rpc.v1.Auth.IdentityEnvelopes.Revoke`
- `rpc.v1.Auth.Devices.Provision`
- `rpc.v1.Auth.Devices.List`
- `rpc.v1.Auth.Devices.Disable`
- `rpc.v1.Auth.Devices.Enable`
- `rpc.v1.Auth.Devices.Remove`
- `rpc.v1.Auth.Devices.ConnectInfo.Get`
- `rpc.v1.Auth.DeviceUserAuthorities.List`
- `rpc.v1.Auth.DeviceUserAuthorities.Revoke`
- `rpc.v1.Auth.DeviceUserAuthorities.Reviews.List`
- `rpc.v1.Auth.DeviceUserAuthorities.Reviews.Decide`
- `rpc.v1.Auth.Sessions.List`
- `rpc.v1.Auth.Sessions.Logout`
- `rpc.v1.Auth.Sessions.Me`
- `rpc.v1.Auth.Sessions.Revoke`
- `rpc.v1.Auth.Users.List`
- `rpc.v1.Auth.Users.Get`
- `rpc.v1.Auth.Users.Create`
- `rpc.v1.Auth.Users.Update`
- `rpc.v1.Auth.UserIdentities.List`
- `rpc.v1.Auth.UserIdentities.Unlink`
- `rpc.v1.Auth.Portals.List`
- `rpc.v1.Auth.Portals.Get`
- `rpc.v1.Auth.Portals.Put`
- `rpc.v1.Auth.Portals.Remove`
- `rpc.v1.Auth.Portals.LoginSettings.Get`
- `rpc.v1.Auth.Portals.LoginSettings.Update`
- `rpc.v1.Auth.Portals.Routes.Put`
- `rpc.v1.Auth.Portals.Routes.Remove`
- `rpc.v1.Auth.Users.IdentityLink.Create`
- `rpc.v1.Auth.Users.Password.Change`
- `rpc.v1.Auth.Users.PasswordReset.Create`
- `rpc.v1.Auth.Capabilities.List`
- `rpc.v1.Auth.CapabilityGroups.List`
- `rpc.v1.Auth.CapabilityGroups.Get`
- `rpc.v1.Auth.CapabilityGroups.Put`
- `rpc.v1.Auth.CapabilityGroups.Delete`

Canonical operation inventory:

- `operations.v1.Auth.DeviceUserAuthorities.Resolve`

Canonical event inventory:

- `events.v1.Auth.Connections.Opened`
- `events.v1.Auth.Connections.Closed`
- `events.v1.Auth.Connections.Kicked`
- `events.v1.Auth.Sessions.Revoked`
- `events.v1.Auth.DeviceUserAuthorities.Requested`
- `events.v1.Auth.DeviceUserAuthorities.Approved`
- `events.v1.Auth.DeviceUserAuthorities.ReviewRequested`
- `events.v1.Auth.DeviceUserAuthorities.Resolved`

## Admin RPCs

Admin RPCs require the `admin` capability unless explicitly documented
otherwise. Device review decision RPCs are the current exception and also allow
`trellis.auth::device.review`.

Admin RPCs also require fresh primary authentication. The default freshness
window is 10 minutes from the session's `lastAuth`; stale admin sessions fail
with `reauth_required` so browser, CLI, and Rust admin clients can send the user
through the normal reauth flow before retrying the admin action.

Admin list RPCs are bounded production queries using the standard live offset
page shape. Requests are `{ offset?: number; limit: number }` plus documented
filters. Responses are `{ entries, count, offset, limit, nextOffset? }`. This is
live offset pagination, not snapshot or cursor pagination: concurrent inserts or
deletes can change which rows appear at later offsets. Admin list RPCs MUST NOT
expose an unbounded "list all" mode.

### rpc.Auth.Sessions.List

Request:

```ts
{
  user?: string;
  offset?: number;
  limit: number;
}
```

Response:

```ts
type AuthSessionRow =
  | {
      key: string;
      sessionKey: string;
      participantKind: "app" | "agent";
      principal: {
        type: "user";
        userId: string;
        name: string;
        identity: { identityId: string; provider: string; subject: string };
      };
      contractId: string;
      contractDisplayName: string;
      createdAt: string;
      lastAuth: string;
    }
  | {
      key: string;
      sessionKey: string;
      participantKind: "device";
      principal: {
        type: "device";
        deviceId: string;
        deviceType: string;
        deploymentId: string;
        runtimePublicKey: string;
      };
      contractId: string;
      contractDisplayName?: string;
      createdAt: string;
      lastAuth: string;
    }
  | {
      key: string;
      sessionKey: string;
      participantKind: "service";
      principal: {
        type: "service";
        id: string;
        instanceId: string;
        deploymentId: string;
        name: string;
      };
      createdAt: string;
      lastAuth: string;
    };

{
  entries: AuthSessionRow[];
  count: number;
  offset: number;
  limit: number;
  nextOffset?: number;
}
```

### rpc.Auth.Users.List

Request:

```ts
{
  offset?: number;
  limit: number;
}
```

Response:

```ts
type AuthUserRow = {
  userId: string;
  name?: string;
  email?: string;
  active: boolean;
  capabilities: string[];
  capabilityGroups: string[];
  identities: Array<{
    identityId: string;
    provider: string;
    subject: string;
    displayName: string | null;
    email: string | null;
    emailVerified: boolean;
    linkedAt: string;
    lastLoginAt: string | null;
  }>;
};

{
  entries: AuthUserRow[];
  count: number;
  offset: number;
  limit: number;
  nextOffset?: number;
}
```

`Auth.Users.Create` uses the same account fields except `userId` and
`identities`: callers may supply `name`, `email`, `active`, direct
`capabilities`, `capabilityGroups`, and optional `username`; Trellis always
generates the canonical `userId`. When `username` is present, Trellis atomically
creates the account and its initial local username identity. Each Trellis
account may have at most one local username/password identity; it may have many
linked OIDC identities.

Admin bootstrap creates or reuses the initial local `admin` account and local
identity before issuing a password-reset URL for that identity. Bootstrap admin
accounts assign the built-in `admin` group by storing
`capabilityGroups: ["admin"]`; they do not copy the admin group's current
capabilities into the account's direct `capabilities` grant. Older accounts may
still carry direct `"admin"` grants; authorization resolves both direct
capabilities and assigned groups.

### rpc.Auth.Capabilities.List

Request:

```ts
{
  offset?: number;
  limit: number;
}
```

Response:

```ts
type AuthCapabilityRow = {
  key: string;
  displayName: string;
  description: string;
  consequence?: string;
  source: "contract" | "platform";
  contractId?: string;
  contractDigest?: string;
  contractDisplayName?: string;
};

{
  entries: AuthCapabilityRow[];
  count: number;
  offset: number;
  limit: number;
  nextOffset?: number;
}
```

Rules:

- `Auth.Capabilities.List` returns capabilities known to the current auth
  runtime: Trellis platform capabilities plus capability metadata projected from
  the fail-closed active catalog projection. Durable deployment envelope and
  contract-evidence rows remain the authority.
- The response is an assignment catalog for admin UX; it is not a grant source
  by itself.
- Capability keys are canonical global keys such as
  `trellis.auth::device.review`; contract-owned keys are emitted from declared
  top-level capability metadata, while platform keys are explicitly defined by
  Trellis.

### rpc.Auth.Users.Update

Request:

```ts
{
  userId: string;
  active?: boolean;
  capabilities?: string[];
  capabilityGroups?: string[];
  name?: string;
  email?: string;
}
```

Response:

```ts
{
  success: boolean;
}
```

Rules:

- `capabilities`, when present, replaces the user's explicit capability grants
  with the exact canonical keys supplied by the admin caller.
- `capabilityGroups`, when present, replaces the user's assigned dynamic group
  keys. Groups are resolved at authorization time; direct capabilities are kept
  as explicit per-user grants.
- Unknown or uncataloged existing capability strings may remain on a user
  record, but new Trellis-owned assignments SHOULD use keys returned by
  `Auth.Capabilities.List`.

### rpc.Auth.Users.IdentityLink.Create

Request:

```ts
{}
```

Response:

```ts
{
  flowId: string;
  url: string;
  expiresAt: string;
}
```

Rules:

- this is a self-service authenticated-user RPC with no capability requirement
- the flow always targets the caller's own `userId`
- callers cannot pass another account id or provider filters
- the returned `url` is intended for clients such as the Console profile to open
  the account-link flow directly; users should not need to copy a generated link
  by hand
- completing the flow may add another OIDC identity to the account
- completing a local username/password link is allowed only when the target
  account has no existing local identity
- admins may view and unlink user identities through management surfaces, but do
  not generate identity-link URLs for other users

### rpc.Auth.Users.Password.Change

Request:

```ts
{
  currentPassword: string;
  newPassword: string;
}
```

Response:

```ts
{
  success: boolean;
}
```

Rules:

- this is a self-service authenticated-user RPC with no capability requirement
- the target is always the caller's own `userId`; callers cannot pass another
  account id
- the target account must have exactly one local identity and an existing local
  credential
- Trellis verifies `currentPassword` against the existing local credential
  before replacing it with `newPassword`
- successful password change revokes other active sessions for the target user
  when session storage is available, while preserving the caller's current
  session when the RPC context includes `sessionKey`

### rpc.Auth.Users.PasswordReset.Create

Request:

```ts
{
  userId: string;
  expiresInSeconds?: number;
}
```

Response:

```ts
{
  flowId: string;
  url: string;
  expiresAt: string;
}
```

Rules:

- this is an admin RPC and requires fresh primary authentication
- the flow targets the supplied `userId`
- the target user must already have exactly one local identity; reset creation
  fails rather than allowing the link holder to choose a username
- the same durable flow kind covers first-time credential setup for an existing
  local identity and later password reset
- completion is local-provider only and creates or replaces the bound local
  identity's credential
- successful completion revokes active sessions for the target user
- `expiresInSeconds` is bounded by auth policy; omitted values use the default
  account-flow TTL

### rpc.Auth.CapabilityGroups.*

Capability groups are admin-managed dynamic authorization inputs. Assigning a
group stores the group key on the user account; it does not copy the group's
current capabilities into the user's direct grants. The built-in `admin` group
is read-only in management surfaces, but can be assigned to users.

`Auth.CapabilityGroups.Put` accepts only capability keys returned by
`Auth.Capabilities.List`. Requests that include uncataloged capability strings
fail with `invalid_request` instead of preserving or creating hidden grants.

Admin UX SHOULD make the distinction visible: capabilities provided by selected
groups should appear resolved for review but should not be editable as direct
grants unless the group is removed from the user.

### rpc.Auth.Sessions.Revoke

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

## Emitted Events

Trellis publishes these events as part of `trellis.auth@v1`:

- `events.v1.Auth.Connections.Opened`
- `events.v1.Auth.Connections.Closed`
- `events.v1.Auth.Sessions.Revoked`
- `events.v1.Auth.Connections.Kicked`
- `events.v1.Auth.DeviceUserAuthorities.Requested`
- `events.v1.Auth.DeviceUserAuthorities.ReviewRequested`
- `events.v1.Auth.DeviceUserAuthorities.Approved`
- `events.v1.Auth.DeviceUserAuthorities.Resolved`

Services may subscribe only when the presented contract evidence fits the
service deployment envelope and declares the events in grouped `uses.required`
or `uses.optional` entries that are active and authorized.

## Non-Goals

- defining the proof/signature protocol
- defining TypeScript or Rust helper packages
- deployment/runbook guidance
