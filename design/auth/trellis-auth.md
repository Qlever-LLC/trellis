---
title: Trellis Auth
description: Trellis authentication and authorization architecture, including identity authority, session keys, and deployment authority.
order: 10
---

# Design: Trellis Authentication And Authorization

## Prerequisites

- [../core/type-system-patterns.md](./../core/type-system-patterns.md) - Result
  and error conventions
- [../core/capability-patterns.md](./../core/capability-patterns.md) -
  capability naming and deployment policy guidance
- [../contracts/trellis-contracts-catalog.md](./../contracts/trellis-contracts-catalog.md) -
  contract manifests, catalog projection, and planning inputs

## Context

Trellis needs one authentication and authorization model that works for:

- browser applications
- agents, including the Trellis CLI
- backend services
- activated devices
- NATS transport permissions
- application-layer request authorization

The model must avoid long-lived bearer tokens, must fit NATS auth callout, and
must preserve Trellis's contract-authored surface and capability model while
making deployment ownership and materialized runtime authority explicit.

## Design

### 0) Auth state has explicit persistence boundaries

Trellis auth separates durable authorization/control-plane records from
short-lived flow and presence state.

Durable SQL-backed records:

- users and admin-managed user capabilities
- identity authority, identity grants, deployment authority, materialized
  authority, and deployment grant overrides
- auth-owned login portal route selectors and deployment-owned device portal
  route metadata
- service deployments and service instances
- device deployments, device instances, provisioning secrets, activations, and
  review records
- global normalized contract manifests keyed by digest
- contract proposals, accepted authority changes, implementation offers, and
  resource bindings
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
- deployment authority is the durable deployment-owned desired state; service
  and device instances only affect runtime availability, liveness, and
  implementation-offer freshness
- connection-time lookups must use explicit repositories or injected
  dependencies, not hidden global state
- session TTL is enforced from the session's `lastAuth` timestamp using the
  deployment `ttlMs.sessions` setting
- sessions are SQL-backed durable records; revocation deletes matching SQL
  sessions and cleans up short-lived connection-presence KV before kicking live
  NATS clients

### 1) Deployment authority is desired state

Deployment authority is the deployment-owned desired state for access,
capabilities, resource definitions, and runtime authority. It is the canonical
admin-controlled source of truth for service, device, app, CLI, native, portal,
and device-user deployments.

Materialized authority is the reconciled actual state that is safe to expose to
runtimes. It includes resource-specific grants, runtime bindings, and the
resolved authority view used by NATS auth callout and service bootstrap.

Terms:

- **deployment authority**: desired state owned by the deployment
- **materialized authority**: reconciled actual state exposed to runtimes
- **contract proposal**: requested needs plus provided surfaces derived from a
  presented contract
- **authority update**: safe or non-breaking deployment authority change
- **authority migration**: dangerous or potentially breaking deployment
  authority change, including incompatible replacement of a previously accepted
  digest for the same contract id. In `strict` mode it requires explicit admin
  acknowledgement. In `mutable-dev`, Trellis may auto-accept the migration, but
  still records the plan and decision in authority plan/history.
- **reconciliation**: convergence from desired deployment authority to
  materialized resources and bindings
- **identity authority**: durable identity-owned authority for delegated user,
  CLI, native, or device-user access
- **identity grant**: a specific delegated grant record or grant-facing UI item
- **grant override**: deployment-owned metadata that may pre-authorize delegated
  identity grant decisions, but cannot create materialized authority that the
  deployment does not own
- **implementation offer**: an accepted runtime statement that an enabled
  service or device instance currently implements one contract id at one digest;
  non-builtin offers describe availability and dependency inputs, not desired
  authority

The core deployment decision is:

```ts
contractProposal.requestedNeeds <= deploymentAuthority.desiredState;
```

Deployment authority proposals and desired state expose `needs` as grouped
families: `contracts`, `surfaces`, `capabilities`, and `resources`. The family
key is part of the wire shape; child records do not carry a generic need-family
discriminator solely to recover that grouping.

The core runtime decision is:

```ts
runtimeRequest <= materializedAuthority;
```

Materialized authority exposes runtime `grants` as grouped families:
`capabilities`, `surfaces`, and `nats`. Materialized authority is a projection
of accepted desired authority and reconciliation output, not the source of
desired authority. Stale or obsolete persisted projections may be repaired by
Trellis storage upgrade and reconciliation, but runtime credentials and
permissions still come only from current materialization.

Contracts are proposals, not ongoing authority. A presented contract can request
needs and declare provided surfaces. Once an authority update or migration is
accepted, Trellis mutates deployment authority desired state. Later contract
changes are compared against that desired state; they do not silently redefine
it.

### 2) Authority changes are classified as updates or migrations

Trellis uses one backend planning flow for deployment-owned changes. The flow
derives a contract proposal, compares it with current deployment authority, and
classifies the proposed change:

- **Authority updates** are safe or non-breaking changes, such as adding a
  compatible requested surface, adding an optional resource, or refreshing
  metadata without reducing usable authority.
- **Authority migrations** are dangerous or potentially breaking changes, such
  as removing required access, replacing a resource shape incompatibly, changing
  a durable consumer identity, making a change that could invalidate running
  clients, or replacing an accepted same-contract digest with an incompatible
  digest.

Accepting either classification approves the desired authority change, including
any resulting resource definition changes. Acceptance mutates desired state and
automatically triggers or schedules reconciliation after the desired-state
commit. It never creates, updates, removes, adopts, or purges runtime resources
directly; all physical convergence stays in reconciliation.

Rejected plans do not mutate desired or materialized authority. Trellis does not
provide a user-facing remediation flow for deployment authority. Operators
inspect the plan, accept an update, explicitly accept a migration, reject it, or
trigger reconciliation for already-accepted desired state.

Same-contract incompatible replacement uses this same planning flow. In `strict`
mode, Trellis records a pending authority migration plan and does not accept the
replacement until an admin explicitly accepts the migration. In `mutable-dev`
mode, Trellis auto-accepts the same migration plan for local development,
records the auto-accepted decision in plan/history, mutates desired state, and
schedules reconciliation like any other accepted migration.

### 3) Reconciliation materializes desired authority

Reconciliation is the only path that creates, updates, removes, or adopts
materialized resources and bindings. It compares deployment authority desired
state with the current materialized state, applies safe convergence actions, and
records the resulting materialized authority.

Rules:

- accepting an authority update or authority migration mutates desired state and
  schedules reconciliation after commit
- reconciliation materializes desired state into resource bindings and runtime
  grants, and is the only path that creates, updates, removes, adopts, or purges
  those resources and bindings
- runtime credentials and service bindings are derived only from materialized
  authority where `status === "current"` and `desiredVersion` matches deployment
  authority `version`
- stale or obsolete persisted materialized-authority projections are repaired by
  storage upgrade and reconciliation; callers must still wait for current
  materialization before treating grants as runtime permissions
- reconciliation may be triggered by control-plane workers, admin RPC, or other
  Trellis-owned scheduling, but runtime bootstrap does not provision resources
- manual admin reconciliation is for repair, retry, or manual convergence; it is
  not the normal happy path after every accepted plan
- failed reconciliation leaves desired authority intact and reports materialized
  state as incomplete or stale until convergence succeeds
- materialized authority may lag desired authority; callers must treat that lag
  as a waiting state, not as implicit permission to run with desired-but-missing
  resources

### 4) Runtime bootstrap waits for materialization

Service and device runtimes present contracts during bootstrap and reconnect.
Trellis derives a contract proposal and checks it against deployment authority.

Runtime behavior:

1. If the proposal's requested needs are already present in desired authority,
   Trellis checks whether those needs are materialized.
2. If materialized authority is complete, bootstrap returns scoped credentials,
   permissions, and resolved resource bindings.
3. If desired authority is missing, Trellis records or returns an authority plan
   for admin handling and the runtime waits or retries.
4. If desired authority exists but materialization is incomplete, bootstrap
   waits or retries until reconciliation converges.
5. If the presented contract is an incompatible same-contract replacement,
   bootstrap treats the replacement as an authority migration. In `strict` mode
   it records or returns a pending migration plan for admin handling and the
   runtime waits or retries. In `mutable-dev` mode it records and auto-accepts
   the migration plan before continuing through normal desired-state and
   materialization checks.

Rules:

- bootstrap never provisions resources
- bootstrap never treats the latest contract as the source of truth for accepted
  deployment-owned resources
- stale service binaries or unavailable materialized bindings are rejected
  during NATS auth callout or bootstrap rather than receiving a partially scoped
  JWT
- successful bootstrap returns the resolved binding payload for the presented
  digest; services use `TrellisService.connect(...)` and the returned handles
  rather than querying low-level binding APIs

Implementation offers remain separate from materialized authority. They record
accepted runtime availability, freshness, and dependency evidence for service or
device instances; they do not grant materialized runtime permissions or create
resources.

### 5) Trellis uses a two-layer auth model

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

### 6) Prove session-key ownership before granting access

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
  identity authority
- service runtimes must present a current contract whose requested needs fit the
  parent deployment authority and whose required resources are materialized
- permissions are always derived from the caller's contract context plus current
  grants, never from hard-coded static ACLs
- service/device runtime contracts are resolved against materialized authority;
  user-facing app, CLI, native, and device-user presented contracts are resolved
  against identity authority bound to the user session
- reconnect authorization is re-evaluated against the presented contract and the
  bound app identity

### 7) Identity binding differs by principal class

| Principal Class   | Identity Source                        | Binding Mechanism                                                            |
| ----------------- | -------------------------------------- | ---------------------------------------------------------------------------- |
| Users             | External IdP, OIDC, or local identity  | Portal-mediated browser auth flow binds Trellis user account to session key  |
| Installed devices | Trellis device registry                | Admin provisioning binds a public device key to deployment authority         |
| Activated devices | Preregistered device instance registry | Activation binds device public identity key to a device principal and grants |

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

### 8) Session keys are the long-lived application identity

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

### 9) Sentinel credentials trigger auth callout; they grant no real access

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

### 10) User identity is provisioned before delegated consent

Successful external authentication provisions or refreshes the auth-local user
projection before any delegated contract consent or bind step completes.

Rules:

- first successful external authentication MUST create the user projection if it
  does not already exist
- reprovisioning MUST preserve admin-managed user state such as `active` and
  explicitly granted capabilities
- grant overrides MUST NOT be copied onto the user projection; they remain
  deployment-owned metadata considered while resolving delegated access
- delegated consent gates app/session access, not whether the user exists in
  auth-local state

### 11) User auth is consent-gated by identity authority

Trellis treats `app` and `agent` participants as contract-bearing delegated user
clients.

Rules:

- portal owns browser UX such as provider chooser and consent screens, but auth
  remains the protocol and state authority
- TypeScript browser runtimes own the normal browser flow lifecycle: creating or
  loading the non-extractable session key, starting auth requests, preserving
  the auth-owned `flowId` through redirects, fetching portal flow state, and
  binding only with the contract already stored on that flow
- portal routes are routing config only and do not imply consent, capabilities,
  or service authority
- delegated consent is recorded as an account-scoped identity grant for the
  presented contract and app identity
- durable grant reuse is keyed by Trellis user account plus app identity anchor;
  the provider origin and provider subject/id captured at grant time are audit
  evidence and do not prevent reuse by another linked local or OIDC identity on
  the same account
- consent payloads expose capability metadata from the owning contract so UIs
  can render human-readable consequences while keeping raw capability keys as
  technical details
- contract digest changes create a new presented contract context; they require
  renewed user consent only when the requested access exceeds current identity
  authority for the same app identity
- deployments MAY configure grant overrides keyed by `contractId + origin` for
  browser apps or by `contractId + sessionPublicKey` for session-keyed clients
- grant overrides cannot invent materialized availability; requested access must
  still fit deployment authority and be materialized where runtime resources are
  involved
- user denial in the portal is a one-time browser-flow outcome that redirects
  the caller back with `authError=approval_denied` and does not create a durable
  denial record
- a later sign-in attempt after user denial MUST ask for permission again unless
  a grant override or existing identity grant already covers the requested
  access
- if the user's capabilities no longer satisfy the delegated contract, the
  delegated session becomes invalid until renewed consent
- inactive users MUST NOT complete bind even if they still have a stored
  identity grant
- after any successful rebind or digest change, callers MUST reconnect NATS
  before using the new rights because transport JWTs are issued per connection

### 12) Activated devices are deployment-owned

Activated devices are preregistered through Trellis-admin flows and bound to a
deployment-owned device deployment. The device identity is durable; the device
presents a contract at runtime, and that contract must fit deployment authority
and any user-delegated identity grant created by activation.

Rules:

- the preregistered public key is the device identity
- device runtime authority comes from materialized authority and, after
  activation, the user-delegated identity grant
- individual device instances do not persist independent authority
- the private device seed never crosses the network to the Trellis runtime
- key rotation is a separate explicit administrative operation

### 13) Auth remains unified after binding

After identity binding, users and devices share the same auth-callout-based NATS
connection model. Activated devices join that same runtime model after
activation is complete.

Before activation completes, device setup uses Trellis-owned browser
auth/bootstrap flows with `kind: "device_activation"`, the
`Auth.DeviceUserAuthorities.Resolve` operation, and pre-auth wait surfaces
defined in [device-activation.md](./device-activation.md). Browser login UX runs
through auth-owned login portal selectors keyed by app contract id and origin,
with a global default and the built-in login portal as fallback. Device
activation UX continues to use deployment-owned portal routing.

Language runtimes expose this model through thin helper layers rather than
separate protocols. Exact TypeScript declarations belong in the generated `/api`
reference, and exact Rust functions and structs belong in Rustdoc.

Rules:

- TypeScript service helpers expose the same proof domains as browser helpers,
  but return direct runtime values rather than redirect- or callback-oriented
  flow state
- TypeScript portal helpers should own auth-owned URL construction, flow-state
  fetches, consent submission shape, provider continuation URLs, and redirect
  extraction while remaining thin wrappers over the HTTP surfaces in
  [auth-api.md](./auth-api.md)
- Rust public APIs return `Result` directly and hide proof-string construction
  and token formatting from callers
- Rust agent login is detached-only: helpers create an auth-owned browser flow
  and return a login URL for the user or CLI to present manually
- Rust admin clients are thin typed facades over generated auth/admin SDK
  models; they may group calls ergonomically but must not hand-maintain
  independent wire shapes or redefine auth semantics
- users and devices all prove long-lived key ownership before receiving
  authenticated runtime access
- users and devices all receive transport permissions derived from current
  grants and their presented contract context; activated devices use
  materialized authority, while user app/agent sessions use identity authority
- activated devices do not use browser bind or user session flows; they
  establish their session from activation state plus identity-key proof and
  presented contract context
- browser sessions that are revoked or missing surface as `session_not_found`
  and should re-enter the browser login flow rather than displaying a terminal
  application error
- higher-level runtimes should resolve bindings eagerly and expose typed
  resource handles rather than raw connect details

### 14) Contracts drive planning; materialized authority drives runtime

Authorization is derived from:

- deployment authority and materialized authority
- identity authority, identity grants, grant overrides, and caller grants
- declared `operations`, `rpc`, `events`, and `uses`
- materialized resource bindings

Rules:

- Trellis MUST derive reviewable surfaces, capability metadata, and authority
  plans from contracts rather than from a parallel scope system.
- runtime transport permissions MUST be issued from current materialized
  authority and stored identity grants, not from active catalog membership or
  the latest known contract manifest.
- planning resolves `uses` dependencies against effective active contracts.
  Bootstrap and planning may use the latest accepted dependency fallback when no
  active offer exists. Unknown required dependencies fail closed instead of
  being treated as advisory metadata.
- contract dependencies are authored and emitted only under `uses.required` or
  `uses.optional`; flat aliases directly under `uses` are invalid and must not
  be interpreted as required dependencies.
- planning must not derive reviewable surfaces or capabilities from inactive
  historical manifests. Required dependency surfaces must come from the
  dependency's effective active contract or latest accepted dependency fallback
  and be covered by deployment authority.
- missing optional dependency contracts or optional requested surfaces are
  skipped during planning and grant no runtime authority; if they later become
  active, they require a new authority update or migration before a fresh
  reconnect can use them.
- auth callout, bootstrap, and catalog flows resolve full manifests from
  built-in Trellis contracts or the global contract store.
- across the runtime, non-builtin runtime authority comes from materialized
  authority. Service reconnects whose presented contract no longer fits accepted
  deployment authority fail with `contract_changed`. Same-contract incompatible
  replacement is handled as an authority migration: `strict` records a pending
  migration plan, while `mutable-dev` records and auto-accepts that plan for
  development use.
- user consent planning collects required capability keys from declared RPC,
  operation, and event capability lists and attaches the owning contract's
  capability metadata when available
- operation, RPC, and event access are contract-authored authorization concerns;
  reconciliation materializes their runtime subject permissions from accepted
  authority, transfer declarations, and materialized resource bindings
- `uses.events.subscribe` authorizes the logical event subscription surface.
  Durable service event processing also requires a matching `eventConsumers`
  resource binding materialized by reconciliation.
- `required: false` controls generated optional typing for service code; it does
  not allow auth or reconciliation to silently skip a declared resource after
  the desired authority has been accepted.
- event-consumer resource permissions MUST be least-privilege grants for the
  bound stream and consumer name.
- transfer permissions MUST be derived from explicit contract transfer
  declarations rather than broad transfer or download subject grants
- Trellis MUST NOT grant unconditional broad transfer upload or download subject
  access
- devices may subscribe to auth events only when their contracts explicitly
  declare them in `uses`

### 15) Reply subjects and operation streams are part of the auth model

The auth model must protect reply subjects and support operation streaming
replies.

Rules:

- devices MUST validate reply subjects against the caller's inbox prefix
- operation `watch()` and streamed `wait()` responses are allowed as bounded
  multi-response replies to validated caller inbox subjects
- Trellis MUST NOT grant arbitrary inbox publish rights just to support
  operation streams

### 16) Trellis maintains runtime-local auth state for fast authorization

The Trellis runtime/control-plane service maintains Trellis-local auth state
such as:

- sessions
- user projections
- installed device registry entries
- identity grants
- deployment authority and materialized authority projections
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
