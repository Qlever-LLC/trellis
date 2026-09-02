---
title: Auth API
description: Current Rust-owned authentication and authorization boundaries.
---

# Design: Auth API

## Source Of Truth

The generated Auth RPC, operation, and event surface is owned by the
source-owned `trellis.api.v1` artifact at
`rust/crates/runtime/trellis.api.json`. The Rust and TypeScript generated SDKs
are derived from that artifact and MUST NOT be edited by hand. Rust route-owned
DTOs are authoritative for browser, account, bootstrap, and refresh HTTP
boundaries; TypeScript mirrors those DTOs with strict schemas verified by
conformance and live integration tests.

This document describes boundary and lifecycle semantics. It intentionally does
not duplicate every request or response field. For exact generated NATS
surfaces, use the artifact and generated API docs. For exact HTTP shapes, use
the Rust route DTOs.

The paired runtime identity is `rust/crates/runtime/trellis.participant.json`.
The built-in Trellis CLI uses the separate ordinary app participant artifact
`rust/crates/trellis/artifacts/trellis.cli.participant.json`, with participant
ID `trellis-app.cli@v1` and display name `Trellis CLI`. It receives no namespace
exception; first-admin authority remains bound to its exact artifact and needs
digests like any other participant.

`trellis.auth::admin` is the durable capability marker that classifies an
effective identity authority as administrative. It does not replace granular
action capabilities such as `trellis.auth::capabilities.delegate`,
`trellis.auth::authorities.mutate`, or `trellis.auth::devices.review`. The
protected `admin` capability group is a platform-owned, read-only policy bundle
of the marker and canonical granular administrator capabilities. Startup
reconciles its persisted projection from the hard-coded platform definition; the
group name is never runtime authority and is not derived from CLI, Console, or
Portal participant artifacts.

## Ownership

The Rust platform runtime is the sole owner of:

- browser auth and account flows
- first-admin bootstrap
- service, device, and client bootstrap
- sessions and connection presence
- authority proposals, decisions, and reconciliation
- provisioning and device activation reviews
- NATS Auth Callout
- authorization trust distribution, context issuance, refresh, and revocation
- Auth RPC, operation, and event surfaces

TypeScript owns portal source, generated SDK consumption, session-proof
bindings, client/service/device integration, and tests. It does not register an
auth runtime, access auth tables, proxy mutations, or validate migrated auth
state.

## HTTP Surface

The Rust auth router is installed only after platform ownership, migrations,
repository construction, startup reconciliation, and required KV resources are
ready.

HTTP is limited to these boundary families:

- browser/account and portal flows, including auth-request, provider callback,
  flow, bind, and portal-asset routes
- initial service and device bootstrap
- proof-bound context recovery through `/auth/context/refresh`

Pending devices retry `/bootstrap/device` using the returned delay. Trust
material is returned in bootstrap/refresh responses; there is no public trust
lookup endpoint.

The built-in login portal is served under `/login/*`, and the built-in Console
is served under `/console/*`. Their static assets use `/assets/login/*` and
`/console/assets/*`. The embedded Console is bound to its serving Trellis origin
and starts the same-origin login flow automatically. Separately hosted Console
deployments remain supported through explicit runtime origin configuration and
CORS policy. The retired device connect-info preflight route does not exist;
`POST /bootstrap/device` is the shared initial and reconnect boundary.

There is no HTTP client bootstrap or authorization-registry route, or logout
endpoint. Connected control uses generated Auth RPC, operation, and event
surfaces over NATS. Context refresh is the recovery exception, not a general
connected-control API; it is used after a restart or expired context or route
credential.

Router-wide controls include strict request body limits, configured-origin CORS,
security headers, optional HSTS, and Governor rate limiting keyed from the
actual peer address. Flow-specific origin and redirect checks remain domain
checks.

## Proof Boundary

Bootstrap requests use purpose-specific `trellis.session-proof.v1` envelopes.
Proofs include a format, signer identity, request id, safe-integer issue time,
payload digest, domain-separated purpose, and Ed25519 signature over the
protocol-owned length-prefixed transcript.

Browser bind is durably idempotent by immutable `flowId`. Its
`trellis.session-proof.v1` request carries only canonical ULID `requestId`,
safe-integer `issuedAt`, and the proof; `requestId` is signed freshness
metadata, not a second durable idempotency identity.

Successful bootstrap or bind returns:

- current `serverNow`
- session metadata and server-owned reply inbox prefix
- exact participant artifact binding
- effective grants and structured resource evidence when applicable
- current NATS endpoints
- a deny-all Auth-account JWT bound to the session NKey
- the route JWT's exact expiry
- a signed authorization context plus pinned root, complete current manifest,
  internal trust/context bucket names, and bounded verification policy

No route returns a shared sentinel seed or reusable shared credential. Non-ready
proposal and activation states return no context. Refresh is session-key
proof-bound, requires nullable `currentContextDigest`, re-evaluates current
issuable state, enforces the client's root pin and manifest floor, and returns
the complete recovery bundle: `serverNow`, the signed context and trust
material, renewed route JWT material, session metadata, and current NATS
endpoints atomically. A null digest recovers a retained valid session after
context or route-JWT expiry; stale, revoked, or otherwise terminal session state
remains fail-closed.

## Browser And Account Flows

Browser flows are CAS-backed and use the initiating signed request ULID as both
`requestId` and `flowId`; they carry the session key and exact participant
binding established by that proof. Local login uses Argon2id. OIDC uses
discovery, PKCE, nonce verification, access-token-hash validation, and a
claim-before-exchange state transition. An exchange with an unknown outcome
becomes terminal `restart_required` rather than risking replay.

OIDC start sets a state-specific `HttpOnly`, `SameSite=Lax` cookie and stores
only its digest. Callback requires that browser binding, verifies the exact
portal and provider policy revision again, and only then claims and exchanges
the state. Unknown identities register only when current portal policy permits
it; identity-link flows remain target-bound and never self-register.

The selected portal browser generates one 32-byte verifier, retains it in
portal-origin `sessionStorage`, and sends only its SHA-256 digest during local
or OIDC authentication. Successful authentication atomically claims the
principal, provider result, and verifier digest. The public flow projection
contains no authenticated profile, principal id, or consent digest. Bodyless
`POST /auth/flow/:flowId/portal`, approval, and denial require the exact
selected portal origin plus the raw verifier in `Trellis-Portal-Binding`; the
verifier is constant-time checked against the claimed digest. It never appears
in URLs, redirects, logs, or an approval-only field. The OIDC cookie remains a
distinct callback-CSRF and continuity control.

The portal-authenticated detail contains the server-owned consent view and
digest. Approval accepts only
`{ approved, consentViewDigest, selectedOptionalBundles }`; caller-authored
grants, capabilities, expiry, resource atoms, and platform authority are
rejected. It re-resolves the exact participant before deciding the same
immutable authority proposal used by administrative flows. Bind creates the
session through the shared aggregate transaction.

Account-management flow tokens are returned once and stored only as hashes. One
`admin_account` flow creates or edits the durable bootstrap administrator.
Startup creates and emits the initial flow once; restart reuses an unexpired
pending flow without rotating or reprinting its secret. Local and configured
OIDC completion atomically create the initial account and exact administration
authority; only one concurrent completion can succeed.

`trellis-server ... --reset-admin` revokes the prior pending token and emits a
new URL. After setup, local completion atomically changes that same principal's
username and password, restores complete accepted authority for the exact
current CLI artifact and needs digest, and revokes existing sessions and
contexts. The initial CLI authority follows ordinary identity-authority
lifecycle rules after bootstrap. Additional administrators do not affect which
principal is recovered. Trellis never logs a default password.

Service and device bootstrap may present one exact participant artifact plus all
referenced API artifacts. The server parses, normalizes, resolves, and stores
the binding through the same domain method used by administrative planning.
Stable non-ready states are `authority_pending`, `authority_pending`,
`authority_rejected`, `migration_required`, `dependency_pending`,
`resource_pending`, and `disabled`. Equivalent retries reuse one semantic
proposal; additive compatible replacement is an update and incompatible API
replacement is a migration.

## RPC Surface

The API artifact defines the complete public RPC inventory. Its families cover:

- sessions and connection presence
- users, credentials, and linked identities
- portals, portal settings, and portal routes
- deployments and deployment authority
- service instances and device instances
- identity authority and device-user authority
- activation reviews and connect metadata
- read-only capability review metadata

Representative exact surfaces are `Auth.Deployments.Create`,
`Auth.Devices.List`, `Auth.DeploymentAuthority.Plan`,
`Auth.DeploymentAuthority.AcceptUpdate`,
`Auth.DeploymentAuthority.AcceptMigration`,
`Auth.DeploymentAuthority.Reconcile`, `Auth.IdentityAuthority.List`, and
`Auth.IdentityAuthority.Revoke`. The source artifact remains authoritative for
the complete inventory.

Every aggregate mutation carries an idempotency key and commits its domain
state, idempotency result, and post-commit intents in one repository
transaction. A same-digest replay returns the committed result; a conflicting
digest fails.

Expected caller-visible failures use the typed error codes declared in the API
artifact. Ordinary request and event verification is provider-local and is not
an Auth API surface. Internal storage, crypto, provider, SQL, and topology
causes are logged only; HTTP, RPC, operation, and callout payloads expose fixed
codes and safe context.

Connected Auth control is generated API control over NATS. Session logout,
session revocation, authority changes, activation review, and other
caller-visible control do not gain HTTP counterparts. Service authors use the
generated participant surfaces and returned runtime handles; authorization
registry KV handles, bucket names, and watch subjects are internal runtime
material and are not exposed as service APIs.

Provider runtimes resolve authorization evidence from the connected internal
NATS KV registry. They watch the current manifest generation and only their
active context's exact revocation key, load both initial snapshots before
becoming ready, fail closed while unready, and stop after their bounded
staleness limit. Revocations apply immediately in memory and are not undone by a
deleted record. Unknown context digests resolve exact evidence once per digest;
ordinary request and event cache hits perform zero HTTP, SQLite, Auth RPC, or
registry I/O.

## Authority

Authority proposals are immutable historical records with terminal accepted,
rejected, superseded, or expired decisions. Acceptance atomically updates the
current desired-authority projection and inserts its transition outbox record.
Reconciliation resolves the exact participant artifact and needs against
dependency/resource evidence, then atomically replaces materialized authority.

Deployment grant overrides, contract-era identity-grant objects, authored NATS
ACLs, and session-owned authority are not API concepts.
`Auth.CapabilityGroups.*` manages recursive administrative macros. The built-in
`admin` group is read-only and startup-reconciled to the hard-coded platform
definition. `Auth.Portals.GrantOverrides.*` manages exact
`portalId + participantId` trusted-login policy with base capabilities/groups
and provider-scoped exact-role mappings. Trusted-login policy writes are
administrative decisions that can mint portal-bound authorities carrying the
administrator marker, so `GrantOverrides.Put` and `GrantOverrides.Remove`
require the caller to hold `trellis.auth::admin`; portal logins and policy reads
stay granular. Both surfaces select only proposal-defined authority; neither
creates a second runtime authorization object.

Physical resource bindings never imply access. Exact participant-resource atoms
must be present in `GrantSet`; optional evidence contributes only currently
available optional atoms. Bootstrap replay stores only stable admission identity
and reruns current issuance before generating a new JWT.

## Device Activation Operation

`Auth.DeviceUserAuthorities.Resolve` is the caller-visible activation operation.
Its input identifies the durable review only; deployment and instance identity
are resolved from the locked review record. Start owns the proof-bound claim and
may mutate; get is read-only, and wait uses a process-local notifier before
rereading durable state. Cancellation is explicitly unsupported. Approval makes
the device ready only when required user delegation is absent or active, and
`Resolved(active)` is emitted only after that coherent transaction commits.

The online device wait remains a deliberate bounded pre-auth setup product
requirement. It is identity/proof-bound to the device activation flow and exact
contract evidence, is capped by the server, and is not a general pre-auth RPC or
connected control path. Once approval is observed, the device uses the shared
`/bootstrap/device` boundary for its session, context, route JWT, and NATS
metadata.

## Events And Post-Commit Work

Auth events are declared in `trellis.api.json`; durable actions may publish only
those authored event identities. The runtime signs deliveries with its
runtime-owned auth event session. Revocation and lifecycle mutations enqueue
kick/event intents in the same transaction as their state change. Delivery
failure retries after commit and never rolls the authoritative mutation back.

## Non-Goals

- PostgreSQL and federation
- compatibility adapters for retired TypeScript auth, sentinel credentials,
  deployment grant overrides, or legacy binding RPCs
- HTTP context-registry, revocation, logout, and client-bootstrap APIs
