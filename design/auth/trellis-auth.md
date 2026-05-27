---
title: Trellis Auth
description: Trellis authentication and authorization architecture, including identity envelopes, session keys, and deployment envelopes.
order: 10
---

# Design: Trellis Authentication And Authorization

## Prerequisites

- [../core/type-system-patterns.md](./../core/type-system-patterns.md) - Result
  and error conventions
- [../core/capability-patterns.md](./../core/capability-patterns.md) -
  capability naming and deployment policy guidance
- [../contracts/trellis-contracts-catalog.md](./../contracts/trellis-contracts-catalog.md) -
  contract-driven permission derivation

## Context

Trellis needs one authentication and authorization model that works for:

- browser applications
- agents, including the Trellis CLI
- backend services
- activated devices
- NATS transport permissions
- application-layer request authorization

The model must avoid long-lived bearer tokens, must fit NATS auth callout, and
must preserve Trellis's contract-driven permission model.

## Design

### 0) Auth state has explicit persistence boundaries

Trellis auth separates durable authorization/control-plane records from
short-lived flow and presence state.

Durable SQL-backed records:

- users and admin-managed user capabilities
- identity envelopes, deployment envelopes, approval decisions, and deployment
  grant overrides
- auth-owned login portal route selectors and deployment-owned device portal
  route metadata
- service deployments and service instances
- device deployments, device instances, provisioning secrets, activations, and
  review records
- global normalized contract manifests keyed by digest
- contract expansion/retraction history, implementation offers, and resource
  bindings
- sessions bound to a principal, session key, contract context, and `lastAuth`
- one-time account-management flows keyed by hashed flow id, including admin
  bootstrap, identity-link, and local-password setup/reset flows

KV-backed runtime records:

- OAuth state
- pending authenticated bind records
- browser login and device-activation flow state
- active NATS connection presence
- public Trellis State API entries

Rules:

- durable auth and catalog records are owned by the Trellis
  runtime/control-plane service storage layer
- KV flow records are scratch state and must be safe to expire
- connection records describe live transport presence and are not durable
  authority
- envelopes are the durable authority primitive; service and device instances
  only affect runtime availability, liveness, and implementation-offer freshness
- connection-time lookups must use explicit repositories or injected
  dependencies, not hidden global state
- session TTL is enforced from the session's `lastAuth` timestamp using the
  deployment `ttlMs.sessions` setting
- sessions are SQL-backed durable records; revocation deletes matching SQL
  sessions and cleans up short-lived connection-presence KV before kicking live
  NATS clients

### 1) Envelopes are the authority primitive

An envelope is the only Trellis authority primitive. It describes the contracts,
surfaces, resources, and optional integrations available to a scope, and the
capabilities that scope may use against those available things.

Terms:

- **envelope**: the authority set for one identity or deployment scope
- **boundary**: the required or optional contract-derived surface that a
  participant asks to use
- **delta**: the boundary difference that must be added to an envelope before a
  request can proceed
- **availability**: whether a contract, surface, integration, or resource exists
  in the relevant deployment envelope
- **liveness**: whether the runtime session, service instance, device instance,
  or connection is currently usable
- **identity envelope**: the envelope bound to a user app, CLI, native app,
  device-user flow, or other stable identity
- **deployment envelope**: the envelope owned by a deployment, including
  service, device, app, CLI, native, portal, and device-user deployments
- **grant override**: deployment-owned metadata that may pre-authorize envelope
  and capability decisions, but cannot create availability that the deployment
  envelope lacks
- **presented contract**: the manifest or digest supplied by a participant for
  approval, bootstrap, reconnect, or activation; it is scoped to that request
- **implementation offer**: an accepted runtime statement that an enabled
  service or device instance currently implements one contract id at one digest;
  non-builtin offers describe availability and dependency inputs, not authority

The core decision is:

```ts
requestedRequiredBoundary <= effectiveEnvelope;
```

If the required boundary fits, the participant may bind or connect once the
non-envelope prerequisites also pass. If the boundary does not fit, Trellis
creates an envelope expansion request for the missing delta. Approval expands an
envelope; it does not approve contract digest lists. Optional boundaries are
used only when both available and authorized.

Envelope expansion is distinct from same-contract replacement compatibility.
Production service deployments default to `strict`, which rejects incompatible
replacement for an existing service instance. Development deployments may opt
into `mutable-dev` compatibility for unreleased local iteration. Neither mode
expands an envelope; only envelope review can add authority.

Non-envelope prerequisites stay separate from envelopes:

- session, service, device, and activation proof verification
- `iat` freshness checks
- OAuth provider and state checks
- redirect and origin validation for web and PWA identity
- disabled, revoked, and deleted lifecycle checks
- rate limiting and CORS
- NATS permission construction from resolved envelopes
- connection tracking, kicking, session cleanup, and revocation events

### 2) Trellis uses a two-layer auth model

Authentication operates at two separate layers:

| Layer               | Mechanism                                              | Purpose                                                |
| ------------------- | ------------------------------------------------------ | ------------------------------------------------------ |
| NATS transport      | Trellis auth callout with server-generated `user_nkey` | Connection identity and pub/sub permissions            |
| Trellis application | Session-key signatures                                 | Application identity proofs and role/capability checks |

The NATS connection identity and the Trellis session key are separate.

Rules:

- NATS handles per-connection transport identity
- Trellis session keys handle application identity proofs across connections
- the same session key may back multiple concurrent NATS connections

### 3) Prove session-key ownership before granting access

Users, services, and devices follow the same core runtime pattern:

1. bind a stable identity to a key
2. connect to NATS with sentinel credentials plus a Trellis auth proof
3. receive a scoped NATS JWT from the Trellis auth callout

For contract-bearing user runtimes, the reconnect proof carries:

- `sessionKey`
- `contractDigest`
- `iat`
- `sig`

Rules:

- session-key proof alone is not enough for ordinary user clients
- contract-bearing clients must present a contract that fits their effective
  identity envelope
- service runtimes must present a current contract that fits the parent
  deployment envelope; stale service binaries or unavailable boundaries are
  rejected during NATS auth callout rather than receiving a partially scoped JWT
- permissions are always derived from the caller's contract context plus current
  grants, never from hard-coded static ACLs; service/device runtime contracts
  are resolved against deployment envelopes, while user-facing app, CLI, native,
  and device-user presented contracts are resolved against identity envelopes
  bound to the user session
- reconnect authorization is re-evaluated against the presented contract and the
  bound app identity

### 4) Identity binding differs by principal class

| Principal Class   | Identity Source                        | Binding Mechanism                                                           |
| ----------------- | -------------------------------------- | --------------------------------------------------------------------------- |
| Users             | External IdP, OIDC, or local identity  | Portal-mediated browser auth flow binds Trellis user account to session key |
| Installed devices | Trellis device registry                | Admin provisioning binds a public device key to a deployment envelope       |
| Activated devices | Preregistered device instance registry | Activation binds device public identity key to a device principal           |

The identity source is pluggable. The core requirement is that Trellis can bind
a stable identity to a session key before allowing authenticated access.

For users, the stable Trellis principal is the Trellis user account, not the
individual provider identity used during the current login. Account linking may
attach many OIDC identities to one Trellis account. It may attach at most one
local username/password identity, and an OIDC identity can link to a local
identity only when the target Trellis account does not already have a local
identity.

Local password setup/reset links are bound to an existing local identity. The
local username is chosen when the account's local identity is created, including
admin-created local users and the initial `admin` bootstrap identity; reset
completion only sets credential material for that bound identity.

For activated devices, the public identity key is the durable principal
identity. That identity is not allowed online until the preregistered device
instance has been activated.

### 5) Session keys are the long-lived application identity

Browser clients:

- use Ed25519 keys
- keep private keys non-extractable
- may use a temporary memory-only non-extractable key for the current
  tab/session
- may use a remembered IndexedDB non-extractable key with expiry metadata for
  longer-lived browser sessions

Server and service clients:

- use Ed25519 keys
- load the private seed from configuration such as `sessionKeySeedFile`

Rules:

- the private session key seed is the real application credential
- the public session key is an identifier, not a secret credential
- persistent session keys survive reconnects until expiry or explicit rotation;
  memory-only browser keys are deliberately discarded with the page/session

### 6) Sentinel credentials trigger auth callout; they grant no real access

Clients connect to NATS using sentinel credentials that exist only to trigger
the Trellis auth callout.

Rules:

- sentinel credentials have zero useful publish/subscribe permissions by
  themselves
- real connection permissions are issued only after the Trellis auth callout
  validates the auth token
- browser clients receive sentinel credentials only after bind succeeds
- services load sentinel credentials from deployment configuration
- service runtimes and reconnect-capable clients regenerate auth payloads at
  connect and reconnect time from their session key, presented contract digest,
  corrected issue time, and signature; auth does not issue or renew reusable
  binding tokens
- high-level runtime clients own bootstrap server-time handling, corrected `iat`
  calculation, a single server-time refresh retry for `iat_out_of_range`, and
  reconnect-safe auth payload generation

### 7) User identity is provisioned before envelope approval

Successful external authentication provisions or refreshes the auth-local user
projection before any contract approval or bind step completes.

Rules:

- first successful external authentication MUST create the user projection if it
  does not already exist
- reprovisioning MUST preserve admin-managed user state such as `active` and
  explicitly granted capabilities
- grant overrides MUST NOT be copied onto the user projection; they remain
  deployment-owned metadata considered while resolving the effective envelope
- envelope approval gates delegated app/session access, not whether the user
  exists in auth-local state

### 8) User auth is approval-gated by envelope fit

Trellis treats `app` and `agent` participants as contract-bearing delegated user
clients.

Rules:

- portal owns browser UX such as provider chooser and approval screens, but auth
  remains the protocol and state authority
- TypeScript browser runtimes own the normal browser flow lifecycle: creating or
  loading the non-extractable session key, starting auth requests, preserving
  the auth-owned `flowId` through redirects, fetching portal flow state, and
  binding only with the contract already stored on that flow
- fragment-delivered tokens are not the main browser UX path; browser and portal
  clients preserve and consume `flowId` as the stable continuation handle
- browser login-init proofs cover the redirect target and canonical portal
  context so a signed flow cannot be retargeted or recontextualized after
  signing; the final browser bind proof is tied to the `flowId`
- portals should use explicit Trellis URL config rather than assuming the portal
  shares an origin with the Trellis HTTP service
- Trellis ships a built-in login portal and a generic device-activation portal,
  commonly served by the Trellis HTTP server from static assets; the built-in
  login portal is a DB-projected, visible, non-deletable portal record
- login portal records, settings, and route selectors live in auth-owned
  projected storage; instance config gates only instance-level capabilities such
  as `auth.localIdentity.enabled`
- custom login portal records are auth-owned routing targets and can be created,
  updated, or removed by admin RPC, but the built-in login portal remains
  non-deletable and non-replaceable
- a portal is a browser web app selected by auth-owned login routing or
  deployment-owned device routing; it is never a service-authenticated principal
- portal routes are routing config only and do not imply approval, capabilities,
  or service authority
- login portal self-registration policy can enable local registration only when
  local identity is enabled for the instance; federated registration
  availability requires configured OAuth/OIDC providers, portal-level federated
  registration, and the portal's `allowedFederatedProviders` filter
- `allowedFederatedProviders: null` means all configured federated providers are
  allowed for that portal, `[]` means none are allowed, and a non-empty list
  allows only those configured provider ids
- there is no special portal contract kind; custom portals remain first-class
  browser UX surfaces without portal-specific contract machinery
- a portal MAY also act later as a normal user-authenticated browser app, but
  any such authority is delegated from the logged-in user rather than from a
  service deployment record
- browser apps MAY attach opaque portal context to login initiation so custom
  portals can coordinate UX without introducing portal-specific app APIs
- approval is recorded as an account-scoped identity envelope decision for the
  presented contract and app identity
- durable approval reuse is keyed by Trellis user account plus app identity
  anchor; the provider origin and provider subject/id captured at approval time
  are audit evidence and do not prevent reuse by another linked local or OIDC
  identity on the same account
- approval payloads expose `approval.capabilities` as an object keyed by global
  capability key, with `displayName`, `description`, and optional `consequence`
  metadata from the owning contract
- approval UIs should render capability metadata as the primary decision content
  and keep raw capability keys, contract ids, and digests as technical details
- contract digest changes create a new presented contract context; they require
  approval only when the requested boundary exceeds the current identity
  envelope for the same app identity
- user sessions bind user identity, session key, and explicit app identity
  together; app identity includes the app contract id and, when available, the
  app origin
- reconnect authorization revalidates the presented digest against the bound
  user/app context rather than relying on a renewable binding token
- deployments MAY configure grant overrides keyed by `contractId + origin` for
  browser apps or by `contractId + sessionPublicKey` for session-keyed clients;
  matching rows pre-authorize envelope and capability decisions
- grant overrides cannot invent availability; the requested boundary must still
  fit the relevant deployment envelope
- grant override approval requires the matching override rows themselves to
  cover the requested approval capabilities; user-owned capabilities remain
  separate authorization evidence and are not copied into deployment grant
  approval
- approval scopes are derived from declared contract APIs; there is no separate
  scope DSL
- stored grants, sessions, users, services, and devices continue to store
  concrete capability keys as string arrays; user accounts also carry dynamic
  `capabilityGroups`, while direct `capabilities` remain explicit per-user
  grants. The richer approval capability object is for approval review and
  stored approval records
- admin bootstrap creates or reuses the initial local `admin` account and
  identity, then issues a password-reset URL for that bound local identity;
  bootstrap admin accounts assign the built-in `admin` group instead of
  materializing that group's capabilities as direct grants. Existing
  direct-admin accounts remain valid because authorization resolves direct
  capabilities and assigned groups
- Trellis stores durable `approved` decisions; user denial in the portal is a
  one-time browser-flow outcome that redirects the caller back with
  `authError=approval_denied` and does not create a durable denial record
- a later sign-in attempt after user denial MUST ask for permission again unless
  a grant override or existing identity envelope already covers the requested
  delegated envelope
- if the user's capabilities no longer satisfy the delegated contract, the
  delegated session becomes invalid until re-approval
- if a policy change removes implied approval or implied capabilities, Trellis
  MUST revoke affected delegated sessions and require reconnect or re-auth
- inactive users MUST NOT complete bind even if they still have a stored
  approval record
- after any successful rebind or digest change, callers MUST reconnect NATS
  before using the new rights because transport JWTs are issued per connection
- browser clients treat `session_not_found` as an auth-required state and should
  re-enter the login flow rather than surfacing it as a terminal application
  error

### 9) Activated devices are deployment-owned

Activated devices are preregistered through Trellis-admin flows and bound to a
deployment-owned device deployment. The device identity is durable; the device
presents a contract at runtime, and that contract must fit the deployment
envelope plus any user-delegated identity envelope created by activation.

Rules:

- the preregistered public key is the device identity
- device runtime authority comes from the deployment envelope and, after
  activation, the user-delegated identity envelope
- individual device instances do not persist independent authority
- the private device seed never crosses the network to the Trellis runtime
- key rotation is a separate explicit administrative operation

### 10) Auth remains unified after binding

After identity binding, users and devices share the same auth-callout-based NATS
connection model.

Activated devices join that same runtime model after activation is complete.
Before that point, device setup uses Trellis-owned browser auth/bootstrap flows
with `kind: "device_activation"`, the `Auth.DeviceUserAuthorities.Resolve`
operation, and pre-auth wait surfaces defined in
[device-activation.md](./device-activation.md). Browser login UX runs through
auth-owned login portal selectors keyed by app contract id and origin, with a
global default and the built-in login portal as fallback. Device activation UX
continues to use deployment-owned portal routing. Normal auth redirects only
need to preserve `flowId`; they do not need to carry `trellisUrl` in the default
per-instance portal model because the portal deployment already knows which
Trellis instance it targets. A portal may later continue as a user-authenticated
browser app for onboarding or activation work, but that remains user-delegated
app authority rather than service authority.

Language runtimes expose this model through thin helper layers rather than
separate protocols. Exact TypeScript declarations belong in the generated `/api`
reference, and exact Rust functions and structs belong in Rustdoc.

Rules:

- TypeScript service helpers expose the same proof domains as browser helpers,
  but return direct runtime values rather than redirect- or callback-oriented
  flow state
- TypeScript portal helpers should own auth-owned URL construction, flow-state
  fetches, approval submission shape, provider continuation URLs, and redirect
  extraction while remaining thin wrappers over the HTTP surfaces in
  [auth-api.md](./auth-api.md)
- portal helper APIs should treat `flowId` as browser URL state so static SPA
  portals and non-Svelte custom portals can use the same framework-neutral
  helpers; Svelte helpers are only thin controller-style wrappers over that
  browser helper layer
- high-level browser helpers may assemble redirect URLs and hide provider
  placeholders from app code, but they must not invent portal-local query
  conventions or bypass auth-owned flow state
- when a high-level browser sign-in helper is called without an explicit return
  target, it should prefer a `redirectTo` query parameter from the current page,
  then configured landing-path behavior, and finally the current browser
  location
- Rust public APIs return `Result` directly and hide proof-string construction
  and token-envelope formatting from callers
- Rust agent login is detached-only: helpers create an auth-owned browser flow
  and return a login URL for the user or CLI to present manually; they do not
  start a local callback listener or auto-open a browser
- Rust detached login completion polls the auth-owned flow until bind is ready,
  then binds through the same browser-flow model used by other user clients
- Rust admin reauth reuses the stored session key for contract changes and may
  complete immediately when auth can prove the new delegated envelope is already
  covered; otherwise it continues through the same detached portal flow
- Rust persisted admin session state stores the session seed and delegated
  contract digest. Reconnect auth regenerates the runtime token from those
  values and the current issue time rather than persisting a renewable binding
  token
- Rust admin clients are thin typed facades over generated auth/admin SDK
  models; they may group calls ergonomically but must not hand-maintain
  independent wire shapes or redefine auth semantics
- Rust portal administration commands are thin facades over `Auth.Portals.*`;
  login portal records and route selectors are auth-owned, while device portal
  routing remains deployment-owned

The important distinction is that installed and activated devices differ in auth
establishment, not in the basic runtime treatment after auth succeeds.

Conceptually:

```ts
type Session = UserSession | InstalledDeviceSession | ActivatedDeviceSession;

type ActivatedDeviceSession = {
  type: "device";
  instanceId: string;
  publicIdentityKey: string;
  deploymentId: string;
  contractId: string;
  contractDigest: string;
  delegatedCapabilities: string[];
  createdAt: string;
  lastAuth: string;
  activatedAt: string | null;
  revokedAt: string | null;
};
```

Rules:

- users and devices all prove long-lived key ownership before receiving
  authenticated runtime access
- users and devices all receive transport permissions derived from current
  grants and their presented contract context; activated devices use deployment
  envelopes, while user app/agent sessions use identity envelopes
- activated devices do not use browser bind or user session flows; they
  establish their session from activation state plus identity-key proof and
  presented contract context
- browser sessions that are revoked or missing surface as `session_not_found`
  and should re-enter the browser login flow rather than displaying a terminal
  application error
- session-facing RPCs must not reconstruct a missing durable session from caller
  context. Missing durable session state is authoritative and returns
  `session_not_found`.
- installed device resource permissions may be augmented from installed bindings
- higher-level runtimes should resolve bindings eagerly and expose typed
  resource handles rather than raw connect details

### 11) Auth is contract-driven

Authorization is derived from:

- deployment envelopes and presented contracts
- identity envelopes, grant overrides, and caller grants
- declared `operations`, `rpc`, `events`, and `uses`
- installed resource bindings

Rules:

- Trellis MUST derive permissions from contracts rather than from a parallel
  scope system
- runtime permission derivation resolves `uses` dependencies against effective
  active contracts. Bootstrap and approval-boundary derivation may use the
  latest approved dependency fallback when no active offer exists. Unknown
  required dependencies fail closed instead of being treated as advisory
  metadata.
- contract dependencies are authored and emitted only under `uses.required` or
  `uses.optional`; flat aliases directly under `uses` are invalid and must not
  be interpreted as required dependencies.
- approval planning must not derive reviewable surfaces or capabilities from
  inactive historical manifests. Required dependency surfaces must come from the
  dependency's effective active contract or latest approved dependency fallback
  and be covered by the effective envelope.
- missing optional dependency contracts or optional requested surfaces are
  skipped during planning and grant no runtime authority; if they later become
  active, they require a new envelope expansion and approval before a fresh
  reconnect can use them.
- catalog refresh, portal routing, surface status, shrink preview, and unused
  installed-contract cleanup are derived through targeted durable-store queries
  rather than broad scans of local manifests or in-memory catalogs.
- auth callout, bootstrap, and catalog flows resolve full manifests from
  built-in Trellis contracts or the global contract store. Latest approved
  expansion requests may provide dependency fallback shape for bootstrap and
  approval planning only; expansion/retraction history and implementation offers
  are not broad manifest lookup fallbacks and do not grant authority by
  themselves.
- bootstrap and approval planning report `dependency_not_active` when a required
  dependency has neither an effective active contract nor a latest approved
  dependency fallback. If active offers for that dependency are incompatible,
  Trellis reports a catalog repair issue for that active lineage rather than
  falling back to approved or historical manifests.
- across the runtime, non-builtin runtime authority comes from envelope fit.
  Service reconnects whose presented contract no longer fits fail with
  `contract_changed`; same-instance incompatible replacement in `strict` mode
  fails with `contract_compatibility_violation`.
- user approval planning collects required capability keys from declared RPC,
  operation, and event capability lists and attaches the owning contract's
  capability metadata when available
- if a required capability key has no contract-authored metadata, auth may
  expose fallback metadata for completeness, but contract authors should not
  rely on that fallback for production approval copy
- operation, RPC, and event access are contract-level authorization concerns;
  runtime subject permissions are derived from those surfaces, transfer
  declarations, and installed resource bindings
- `uses.events.subscribe` authorizes the logical event subscription surface.
  Durable service event processing also requires a matching `eventConsumers`
  resource binding, which Trellis provisions during approval and scopes to one
  physical JetStream consumer.
- approval provisions or adopts every declared `kv`, `store`, `jobs`, and
  `eventConsumers` binding atomically from Trellis's perspective; if approval
  fails, returns pending/waiting, or cannot persist SQL state after creating
  NATS resources, Trellis best-effort cleans up resources created by that
  attempt.
- `required: false` controls generated optional typing for service code; it does
  not allow auth or provisioning to silently skip a declared resource after
  approval.
- event-consumer resource permissions MUST be least-privilege grants for the
  bound stream and consumer name. Services must not receive broad durable
  consumer-create or wildcard consumer-control subjects for ordinary event
  processing.
- transfer permissions MUST be derived from explicit contract transfer
  declarations rather than broad transfer or download subject grants
- operations that declare `transfer: { direction: "send", ... }` authorize
  caller upload subjects only when the operation use also grants
  `capabilities.call`
- RPCs that declare `transfer: { direction: "receive" }` authorize caller
  download subjects only when the RPC use also grants `capabilities.call`
- Trellis MUST NOT grant unconditional broad transfer upload or download subject
  access
- devices may subscribe to auth events only when their contracts explicitly
  declare them in `uses`

### 12) Reply subjects and operation streams are part of the auth model

The auth model must protect reply subjects and support operation streaming
replies.

Rules:

- devices MUST validate reply subjects against the caller's inbox prefix
- operation `watch()` and streamed `wait()` responses are allowed as bounded
  multi-response replies to validated caller inbox subjects
- Trellis MUST NOT grant arbitrary inbox publish rights just to support
  operation streams

### 13) Trellis maintains runtime-local auth state for fast authorization

The Trellis runtime/control-plane service maintains Trellis-local auth state
such as:

- sessions
- user projections
- installed device registry entries
- identity-envelope approval records
- deployment-envelope portal-route metadata
- auth browser flow records
- device deployments
- device instances
- device activation flows
- device activation records
- active connection records

Rules:

- these records are part of the Trellis runtime/control-plane service's internal
  auth state model
- auth lookup must remain fast enough for connection-time and request-time
  validation
- connection revocation is implemented by kicking live NATS connections and
  removing auth state, rather than by bloating account JWT state

## Companion Documents

This document defines the auth subsystem architecture. Detailed companion docs
are split by concern:

- [auth-protocol.md](./auth-protocol.md) - connect tokens, proofs, auth callout,
  reply validation, internal state records
- [auth-api.md](./auth-api.md) - HTTP endpoints, `operations.v1.Auth.*`,
  `rpc.v1.Auth.*`, and emitted auth events
- [device-activation.md](./device-activation.md) - known-device activation,
  connect info, and activation flow
- Generated `/api` reference and Rustdoc - exact TypeScript and Rust helper
  declarations for auth client libraries
- [auth-operations.md](./auth-operations.md) - deployment, HA, rate limits,
  rotation, and accepted operational risks
