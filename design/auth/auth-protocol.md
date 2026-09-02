---
title: Auth Protocol
description: Language-neutral auth protocol rules for proofs, connect tokens, auth callout, reply validation, and auth state.
order: 20
---

# Design: Auth Protocol

## Prerequisites

- [trellis-auth.md](./trellis-auth.md) - auth architecture and trust model
- [../contracts/trellis-api-participants.md](./../contracts/trellis-api-participants.md) -
  contract-driven permission derivation
- [../operations/trellis-operations.md](./../operations/trellis-operations.md) -
  operation watch and streaming reply semantics

## Scope

This document defines the language-neutral Trellis auth protocol.

It covers:

- cryptographic encodings and signatures
- pinned authorization roots and direct-key issuer manifests
- signed authorization contexts and context-bound request proofs
- NATS connect token shapes
- auth callout behavior
- RPC proof verification
- device activation retry behavior
- reply-subject validation and streaming reply rules
- internal auth state records required for protocol behavior

It does not define public HTTP and RPC endpoint schemas; those live in
`auth-api.md` and, for the activated-device lifecycle, `device-activation.md`.

## Cryptographic Primitives

| Notation    | Definition                                     |
| ----------- | ---------------------------------------------- |
| `hash(x)`   | SHA-256 digest of x                            |
| `sign(k,x)` | Ed25519 signature of x using key k             |
| Encoding    | base64url without padding (RFC 4648 section 5) |

Canonical byte encoding for signatures:

| Value type       | Encoding                                           |
| ---------------- | -------------------------------------------------- |
| Strings          | UTF-8 bytes                                        |
| Numbers          | JSON safe integers in the canonical request object |
| Proof transcript | Domain-separated, length-prefixed binary fields    |

Every integer carried by a signed JSON object or cross-language proof must be
within the exactly interoperable JSON safe-integer range:

```text
-9_007_199_254_740_991 through +9_007_199_254_740_991
```

This applies to validity times, manifest generations, revocation times,
authority versions, request `iat`, verification-policy time/generation inputs,
and integers nested anywhere in signed extensions. Positive counters retain
their positive/nonzero requirements. Verifiers reject unsafe values before
canonicalization or signature acceptance and report the exact RFC 6901 path.

All Trellis clients, including Rust CLIs and future non-TypeScript clients, must
match this encoding exactly.

Identity-derived account ids are no longer used for canonical users. User
accounts have generated `userId` values; provider identity ids may be derived
from provider and subject, but they are not account ids.

The signed value is always the exact UTF-8 bytes as transmitted. No URL
normalization is applied before signing.

## Connect Token Shapes

After bootstrap or browser binding, every client receives a deny-all
Auth-account JWT whose subject is the session public key encoded as a NATS User
NKey. The client uses the same session private key for the ordinary NATS nonce
signature.

The `auth_token` is a `trellis.nats-connect-token.v1` object:

```ts
{
  format: "trellis.nats-connect-token.v1",
  contextDigest: string
}
```

Rules:

- `contextDigest` is the canonical digest of the complete signed authorization
  context and the sole context identity
- NATS verifies the standard nonce signature against the bootstrap JWT subject
- Auth Callout loads the active context and requires the server-supplied
  `user_nkey` to encode the context's session public key
- each reconnect reuses the current context digest but answers a fresh ordinary
  NATS nonce challenge

## Auth Callout Behavior

When NATS calls `$SYS.REQ.USER.AUTH`:

1. Decode the encrypted request by requiring `Nats-Server-Xkey`, decrypting the
   payload, and extracting `user_nkey` plus `connect_opts.auth_token`.
2. Validate the minimal `trellis.nats-connect-token.v1` envelope and deny-all
   bootstrap JWT, then require the NATS user NKey to match the session key in
   the active context selected by `contextDigest`.
3. Load the active signed context by `contextDigest`, verify it against the
   accepted current manifest, and bind `user_nkey` to `context.sessionKey`.
4. Load the participant and current physical resource bindings needed to compile
   transport permissions from the context's exact `GrantSet`. A subject or
   binding never creates an atom.
5. Sign the target-account JWT for the server-generated `user_nkey`, bounded by
   current session, authority, and delegation expiry, then record connection
   presence.

All principal kinds use this same pipeline. Expected denials return fixed reason
codes. Unexpected storage, crypto, provider, and topology causes are logged
internally and return only `internal_error`.

## Server-Relative Time

Initial bootstrap and proof-bound context-recovery responses that expect
`iat`-based runtime auth SHOULD return `serverNow`. Recovery also returns the
route credential, session metadata, and current NATS metadata needed to rebuild
the connected runtime.

Clients SHOULD:

1. record request start and end time locally
2. estimate midpoint clock offset from `serverNow`
3. compute future `iat` values from corrected server-relative time
4. retry once after `iat_out_of_range` when a fresh `serverNow` is returned

Clients MUST NOT loop forever on repeated `iat_out_of_range`.

Auth callout payload field names use canonical snake_case names such as:

- `user_nkey`
- `server_id`
- `client_info`
- `connect_opts`

CamelCase aliases are not part of the Trellis protocol.

The auth-callout request and response MUST be XKey-encrypted. Plaintext
auth-callout payloads are not supported.

## Permission Derivation

The auth callout derives permissions from:

- verified active signed authorization context
- the exact `GrantSet` accepted for the bound participant
- exact `trellis.api.v1` descriptors
- typed materialized resource bindings
- the session reply inbox and narrow built-in subjects

Rules:

- inbox subscribe permission always includes `${inboxPrefix}.>`
- services receive resource publish/subscribe subjects only when the exact
  participant-resource atom and its matching materialized binding are both
  present; optional evidence contributes only the corresponding optional atoms
- operation-control publish permissions are derived only from operation
  `observe`/`cancel` capabilities; `call` authorizes starting an operation but
  does not authorize publishing to its control subject
- auth-callout denial paths return explicit deny responses and MUST NOT mint a
  partially scoped user JWT when the known manifest, session, deployment
  authority, materialized authority, or resource state needed for permission
  derivation is unavailable
- unexpected auth-callout exceptions are logged with internal details but return
  a stable generic external error such as `internal_error`
- operation streaming replies use `jwt.resp.max = OPERATION_RESPONSE_MAX`
- `OPERATION_RESPONSE_MAX` MUST be greater than `1` and SHOULD default to
  `65535`

## Authorization Context And Local Request Authorization

The authority proof applies to bootstrap, refresh, every NATS connect/reconnect,
and local provider authorization. A pinned authorization root verifies a
generation-numbered manifest containing active issuer public keys. The selected
issuer key verifies a short-lived context, and the session private key bound
into that context signs each exact request or event.

The trust hierarchy is:

```text
pinned root
  -> root-signed current issuer manifest
  -> issuer-signed short-lived authorization context
  -> session-key-signed request proof v1
```

All signed JSON security objects use strict recognized top-level fields. Signed
forward-compatible data belongs in `extensions`; names in the canonical
`critical` set fail closed unless understood. Each signature uses a distinct
domain and covers SHA-256 of length-prefixed domain bytes plus RFC 8785
canonical unsigned JSON. Key ids are derived as unpadded base64url SHA-256
digests of the raw 32-byte Ed25519 public key.

The manifest is the complete issuer registry for its generation. Each entry is
exactly `{keyId, publicKey}`; omission from a later generation removes an
issuer, while overlapping entries support rotation. Consumers durably pin the
root and the accepted generation/digest floor, rejecting rollback,
same-generation equivocation, and root replacement across restarts. Clearing a
session or context retains that floor.

`manifest.current` contains only the current generation and digest. Immutable
`manifest.<generation>` values preserve trust history. The bounded context
bucket contains canonical signed context JSON at `<contextDigest>` and
`{"revokedAt": ...}` at `revocation.<contextDigest>`. The root is supplied by
configuration/bootstrap and is never stored in NATS. Connected runtimes use
these two Trellis-owned KV buckets directly; there is no connected HTTP trust
lookup.

Startup reconciles only the configured manifest, optional SQLite floor, and
optional `manifest.current` pointer. It immutable-creates or exact-confirms the
configured generation, persists an accepted advance, and CAS-updates
`manifest.current` last. Historical manifests are exact-read only for historical
event verification.

A verified `manifest.current` advance durably raises the accepted
generation/digest floor before it becomes the provider's current manifest.
Current requests and NATS admission require the context generation to equal that
current generation and never fetch an older manifest. Raising the floor clears
only live context-cache entries and wakes the existing own-context refresh task.
Historical retained-event verification may exact-read the context's older
manifest without lowering the live floor.

Clients compute `refreshAt = expiresAt - refreshLead - jitter(contextDigest)`.
The protocol implementation owns this deterministic, bounded, earlier-only
calculation; it is not transmitted in the context bundle.

The refresh request always contains `currentContextDigest`, but the value is
nullable. A client with a valid context sends its digest; a client whose context
or route JWT has expired sends `null` while proving possession of the retained
session key and pinned trust floor. Context refresh is restart recovery, not a
connected-control path. Success returns `serverNow`, the signed context and
trust material, a renewed deny-all route JWT plus its expiry, session metadata,
and current NATS metadata as one atomic recovery bundle. Clients derive a
midpoint clock offset from `serverNow`, schedule against corrected
server-relative time, and reschedule even when refresh validly returns the same
context digest. Only terminal session/authority failures clear session recovery
state.

The issuer decides reuse inside the same SQLite transaction that commits the
context. Equivalent concurrent requests reuse one record, and each session has
at most two active overlapping contexts: the current lease and one replacement
for reconnect handoff. Publication actions are keyed by immutable context digest
and deduplicated transactionally.

The signed context binds its issuer manifest generation, stable principal, exact
participant artifact and accepted-needs digests, durable identity/deployment
authority, session id and public key, reply-inbox prefix, exact
`trellis.grant-set.v1`, and canonical platform capability keys. Its validity is
short-lived and entirely contained by the named manifest. Its digest over the
canonical complete signed JSON is its sole identity.

`maximum_context_bytes` and `maximumContextBytes` always mean the UTF-8 byte
length of canonical complete signed-context JSON. Issuance, protocol parsing,
WASM verification, and the context-registry value limit enforce that same unit;
there is no second encoded context representation.

Verified caller metadata exposes the source authority record and version,
deployment and instance ids, participant artifact and needs digests, context and
session identity, validity bounds, grants, capabilities, and immutable signed
context needed by auditing and later runtime integration.

Request proof v1 input is:

```text
LP("trellis.authorization-request-proof.v1")
LP(raw 32-byte signed-context digest)
LP(exact subject UTF-8)
LP(exact reply subject UTF-8, or empty)
LP(SHA-256(raw payload bytes actually received))
LP(ASCII decimal iat)
LP(request-id UTF-8)
```

The receiver verifies root, manifest, context, and session-key proof locally;
computes the raw payload hash locally; validates a nonempty reply subject
against the signed inbox prefix; and enforces generated exact permission atoms
and capabilities as subsets of the signed context. Request IDs remain signed
message identity, but receivers keep no generic replay state. Durable mutations
own transactional idempotency.

NATS authentication uses a minimal token containing only `format` and
`contextDigest`. NATS verifies its ordinary nonce challenge. Auth Callout loads
the active context, verifies it against the current manifest, requires the NATS
NKey to encode the context session key, loads the exact participant binding and
current physical resource bindings, and compiles transport permissions directly.

Providers establish a `manifest.current` watch and one exact
`revocation.<own-context-digest>` watch, verify the current manifest and exact
revocation state, then become ready. Quiet watches remain healthy. Actual
connection/watch failure makes the provider unready; reconnect recreates both
watches. Unknown contexts require exact context and revocation GETs. Historical
events additionally require one exact manifest-generation GET. Registry
permissions allow only those content-addressed reads and consumer creation for
the fixed manifest key and the caller's exact revocation key; wildcard
revocation history, stream-sequence reads, enumeration, and writes remain
denied.

## Local Request And Event Verification

Providers exact-match generated route metadata before resolving caller context.
They compute the payload hash from the raw bytes received and verify request
proof v1 over the context digest, actual subject, actual reply subject, payload
hash, corrected issue time, and request id. The resolved signed context must
bind the presented session key and contain the exact generated permission atom
and every declared capability.

Event proof v1 binds the context digest, actual event subject, raw payload hash,
event id, and canonical event time. Typed consumers use their receiver-owned
generated event descriptor for the API id, event name, actual subject, exact
Publish atom, and required capabilities. The generic Event Log verifies trust,
session binding, event signature, and publisher projection without
reconstructing arbitrary contract semantics.

Request eligibility uses current time and denies any revoked context. Event
eligibility uses the signed historical window
`notBefore <= eventTime < expiresAt`, so ordinary expiry does not invalidate a
delayed event. Explicit context revocation invalidates every event proof from
that context, including proofs signed before `revokedAt`, preventing stale proof
replay after an authority change. Retained context and manifest values support
the signed historical window; retained revocations enforce its security floor.
Durable listeners NAK retryable verification failures such as provider
readiness, registry transport, publication races, and storage availability;
cryptographically invalid or unauthorized events are permanently rejected.
JetStream owns publication deduplication and redelivery, so a redelivered event
is verified and may invoke its handler again. Business handlers that need
exactly-once effects own transactional processed-event state.

After an unknown digest is resolved once, ordinary verification is entirely
local: cache hits perform zero SQLite, HTTP, Auth RPC, or NATS registry reads.

## Device Activation Retry

An unapproved `/bootstrap/device` request returns `activation_pending` with a
review id, activation URL, and retry delay. The device retries the same
bootstrap endpoint after that delay. There is no separate activation-wait
endpoint.

## Reply-Subject Validation

Services MUST validate that a reply subject matches the caller's inbox prefix.

```ts
if (!msg.reply?.startsWith(callerInboxPrefix + ".")) {
  throw new AuthError("Reply subject mismatch");
}
```

This prevents confused deputy attacks.

## Operation Streaming Replies

Unary RPCs use one reply. Operations may use multiple replies to the same
validated caller inbox subject.

Rules:

- Trellis MUST permit bounded multi-response publishing to a reply subject that
  was supplied on an authenticated request and passed reply-subject validation
- this capability applies only to a reply subject derived from a request the
  service actually received
- it is not a general publish grant to arbitrary inbox subjects
- operation `watch()` and streamed `wait()` responses use this mechanism
- ordinary unary RPCs still respond once by convention even when the transport
  permission can support more than one response

## Error Codes

Public Auth RPCs use their declared `AuthError`, `ValidationError`, or
`UnexpectedError` envelope with stable codes and safe messages. HTTP, operation,
local verification, and Auth Callout boundaries retain the applicable reason
codes below.

| Scenario                     | Reason Code                   |
| ---------------------------- | ----------------------------- |
| SessionKey header missing    | `missing_session_key`         |
| Session not found            | `session_not_found`           |
| Session expired              | `session_expired`             |
| Invalid signature            | `invalid_signature`           |
| SessionKey mismatch in OAuth | `oauth_session_key_mismatch`  |
| Session already bound        | `session_already_bound`       |
| AuthToken already used       | `authtoken_already_used`      |
| Timestamp out of range       | `iat_out_of_range`            |
| Identity grant required      | `approval_required`           |
| Contract changed             | `contract_changed`            |
| User inactive                | `user_inactive`               |
| User not found               | `user_not_found`              |
| Unknown service              | `unknown_service`             |
| Service disabled             | `service_disabled`            |
| Unknown device               | `unknown_device`              |
| Device activation revoked    | `device_activation_revoked`   |
| Device deployment not found  | `device_deployment_not_found` |
| Device deployment disabled   | `device_deployment_disabled`  |
| Reply mismatch               | `reply_subject_mismatch`      |
| Missing capabilities         | `insufficient_permissions`    |

Internal storage, SQL, crypto, provider, and topology causes are never public,
even after connection authentication. They are recorded in structured server
logs and collapse to `internal_error` at HTTP, RPC, operation, and callout
boundaries.

Browser clients treat `session_not_found` as an authentication-required state,
not as a page-local application error. Revoked browser sessions therefore
re-enter the normal login redirect flow so the app can preserve its current
return path and show sign-in UX. Non-browser clients may surface the same
`AuthError` directly.

## Internal State Model

Rust-owned principal, provider-identity, session, desired-authority,
runtime-evidence, and materialized-authority records are specified in
[rust-authorization-state.md](./rust-authorization-state.md). Signed
authorization-context issuance consumes the current issuable-state projection.
The browser-flow records below describe external flow behavior; they are not a
parallel authority storage model.

## Browser Flow Protocol

The portal-owned browser login UX uses `flowId` as the browser-visible
identifier. The flow is proof-bound to the initiating session key and exact
participant; there is no second portal-authored authority token. `flowId` is the
canonical ULID from the signed start request, so `start.requestId == flowId`.
The selected portal's registered `entryUrl` origin is the trusted portal
principal; a requester route origin only selects a portal and does not
authenticate it. Trellis-generated account ids use `usr_` plus a ULID, and
auth-owned review ids use their semantic prefix plus a ULID. Trellis ships a
built-in portal served by the Trellis HTTP server from static assets. Login
portal records and route selectors are global auth-owned routing config; the
built-in login portal record is visible, non-removable, and non-replaceable.
Device deployments may carry deployment-owned portal-route metadata for device
flows. Neither form is standalone portal authority. Device activation uses the
same browser-visible `flowId` concept with `kind: "device_activation"` flow
records rather than a separate public identifier. Portals are web apps, not
service-authenticated principals; if a portal later continues as a Trellis app
after login, it does so under a normal user session.

Flow summary:

1. `POST /auth/requests` validates the signed login-init request and exact
   participant/API presentation, derives one server-owned required/optional
   consent proposal, and creates the Trellis-owned browser flow keyed by that
   request's canonical ULID when current authority cannot bind immediately.
2. The portal browser creates one 32-byte CSPRNG verifier, stores it in
   portal-origin `sessionStorage` under `flowId`, and supplies only its SHA-256
   digest to local authentication or OIDC start. `GET /auth/login/:provider`
   requires `flowId` and stores the provider choice in the same browser flow.
   The provider must be allowed by the selected login portal policy. If the
   referenced login flow is expired but still carries an app `redirectTo`, auth
   redirects to that app URL without adding an auth error so the app can restart
   its current auth request.
3. OIDC start creates PKCE/nonce state bound to the portal verifier digest, a
   state-specific `HttpOnly`, `SameSite=Lax` browser cookie and the exact
   portal-policy digest. Callback verifies browser possession and current
   provider/registration policy before CAS claim and exchange. Identity-link
   flows never self-register.
4. `GET /auth/flow/:flowId` is the app-visible projection: lifecycle state,
   expiry, non-user-specific presentation, and validated redirect state only. It
   never exposes the authenticated principal or consent digest. For a known
   expired browser flow, the expired state may include `returnLocation` so
   portals can return to the originating app without showing a transient
   expiration screen; missing flows do not receive an invented return URL.
5. Bodyless `POST /auth/flow/:flowId/portal` returns authenticated profile and
   consent detail only when the request has the selected portal origin and raw
   verifier in `Trellis-Portal-Binding`. Approval and denial require the same
   checks. `POST /auth/flow/:flowId/approval` accepts only the current
   consent-view digest, selected server-issued optional bundle ids, and
   decision. The server re-resolves the participant and rejects stale wording,
   unknown bundles, caller-authored grants/capabilities, and reserved authority.
6. `POST /auth/flow/:flowId/bind` completes the browser bind from
   `{ requestId, issuedAt, proof: { format: "trellis.session-proof.v1", signature } }`.
   The transcript is bound to the immutable `flowId` and the session key
   enrolled by the start request.

When a caller's participant changes, it starts the normal auth request flow with
the current canonical participant and referenced API artifacts. Human wording
may change the consent-view digest but does not change the machine proposal
digest. Auth may bind immediately only when current exact identity authority
covers the resolved required request; otherwise it returns a normal browser
flow.

Bind proof rules:

- browser flow creation uses the purpose-specific `trellis.session-proof.v1`
  request transcript over the complete request with its signature removed
- bind consumes the server-owned proof-bound flow with server-owned durable
  idempotency by `flowId`; signed `requestId` is freshness metadata only
- browser clients treat flow claims as internal auth-service state rather than a
  fragment-delivered public contract

Runtime storage responsibilities:

| Storage                       | Logical contents                                                                                                                                                                                                                                                     | TTL                                                     |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| SQL                           | Users, credentials, sessions, principals, desired and materialized authority, proposals/decisions, deployments, instances, devices, delegations, portals/routes, provisioning records, idempotency results, post-commit actions, and hashed account-management flows | Durable, with explicit expiries                         |
| `trellis_auth_oauth` KV       | PKCE/nonce state, browser-binding digest, portal-policy digest, CAS claim/result, and terminal unknown-outcome state                                                                                                                                                 | 15 min                                                  |
| `trellis_auth_browser` KV     | Proof-bound browser flow, claimed portal-verifier digest, minimal resumable provider result, and exact server-owned consent proposal keyed by `flowId`                                                                                                               | Browser-flow TTL                                        |
| `trellis_auth_connections` KV | Active physical-connection presence keyed by exact connection id                                                                                                                                                                                                     | Resolved maximum user-JWT lifetime + 60 s cleanup grace |

Portal verifiers and account-flow bearer secrets are stored by digest, not raw
value. OAuth state ids are public correlation ids; the separate OAuth cookie
secret supplies callback-CSRF continuity and does not authorize portal detail or
consent.

Browser flows are keyed by raw `flowId` because the flow identifier is
browser-visible and used to fetch auth-owned portal state. Device activation
records persist for the lifetime of the activated device unless revoked. Browser
login uses auth-owned global login portal records and route selectors. Device
activation routing remains deployment-owned authority state.

The complete server-owned `consent` value is immutable for the lifetime of the
browser flow. CAS state transitions may advance lifecycle/result fields but must
reject changes to the consent view, consent-view digest, machine proposal
digest, optional bundles, or capability definitions.

Provider chooser state returns only effective providers after selected portal
policy. `allowedFederatedProviders: null` allows all configured providers, `[]`
allows none, and a non-empty array allows only that configured subset.

### Browser Flow Record

```ts
{
  format: "trellis.auth-browser-flow.v1";
  flowId: string;
  state: "choose_provider" | "authenticated" | "approval_required" |
    "approval_denied" | "approved" | "consumed" | "expired";
  requestId: string;
  requestDigest: string;
  participantId: string;
  participantArtifactDigest: string;
  participantNeedsDigest: string;
  consent: ServerOwnedConsentProposal;
  sessionPublicKey: string;
  sessionNkey: string;
  portalId: string;
  redirectTarget: string | null;
  principalId: string | null;
  createdAt: number;
  expiresAt: number;
  version: number;
}
```

### Session Object

All principal kinds use the same durable session record: generated session id,
principal id/kind, exact participant artifact and needs digests, session public
key and key id, server-owned inbox prefix, created/last-seen/expiry/revocation
times, and optional deployment/instance binding. Authority and transport ACLs
are not copied into the session; issuance resolves current authority on every
credential refresh.

### Identity Authority

User/app, CLI, native, and device-user authority uses the same immutable
proposal and terminal-decision workflow as deployment authority. Acceptance
updates the current desired-authority projection and inserts its outbox record
in one transaction. The accepted record binds the stable principal, exact
participant artifact, needs digest, `GrantSet`, and expiry.

Deployment grant overrides, stored NATS subject ACLs, and contract-era
identity-grant objects are not part of the protocol. Capability groups are
administrative macros used only while resolving trusted-portal policy; expanded
capability keys are bounded by the immutable participant proposal, and group or
OIDC role objects never enter the resulting identity authority.

Trusted-portal policy is exact to `portalId + participantId`. After normal OIDC
signature, issuer, audience, nonce, and access-token-hash verification, each
provider's configured `role_claims` JSON Pointers extracts scalar or array role
strings from that same verified ID token. Exact provider + role pairs may select
provider-scoped mappings. Trusted autoapproval and ordinary consent commit
through the same identity-authority transaction, with separate portal-policy
provenance used for reconciliation. A semantic policy change revokes superseded
authorization contexts and disconnects connections using those exact context
digests while retaining their sessions for refresh. If the portal, provider
allowance, or grant override disappears, reconciliation revokes the authority
and atomically clears its provider-role provenance. Restoring configuration
alone cannot replay cached roles; a new verified login must supply fresh
provider evidence before authority can be accepted again.

### Users Projection

This account projection is Trellis-local and is updated by Trellis-managed
flows. `userId` is generated by Trellis and is not derived from provider
`origin`/`id` values. Local-user creation stores `username` as the subject of
the local identity, not as the account id.

Account linking adds provider identities to the same Trellis user account.
Multiple OIDC identities may be linked to one Trellis account. A Trellis account
may have at most one local username/password identity; an OIDC identity may link
to a local identity only when the target account does not already have a local
identity.

Local password-reset flows are bound to that existing local identity. The reset
flow record stores the target identity id and local username; portals may not
choose or change the username during reset completion.

Authorization is not stored on the user profile. First-admin bootstrap creates
and accepts authority for the exact built-in CLI participant; its mandatory
grants are derived from that artifact.

### Active Connections

```ts
{
  serverId: string;
  clientId: number;
  connectedAt: string;
}
```

Rules:

- key is `<sessionKey>.<scopeId>.<user_nkey>` where `scopeId` is `userId` for
  user sessions, the service principal for service runtime sessions, and
  `instanceId` for device runtime sessions
- disconnect cleanup is best-effort plus TTL-backed self-healing

## Event Authorization

The `trellis` service publishes `events.v1.Auth.*` as part of `trellis.auth@v1`.

Events:

- `events.v1.Auth.Connections.Opened`
- `events.v1.Auth.Connections.Closed`
- `events.v1.Auth.Sessions.Revoked`
- `events.v1.Auth.Connections.Kicked`
- `events.v1.Auth.DeviceUserAuthorities.Requested`
- `events.v1.Auth.DeviceUserAuthorities.ReviewRequested`
- `events.v1.Auth.DeviceUserAuthorities.Approved`
- `events.v1.Auth.DeviceUserAuthorities.Resolved`

Rules:

- services may subscribe only if the presented contract proposal fits service
  deployment authority, reconciliation has produced the needed materialized
  authority, and the contract declares the events in grouped `uses.required` or
  `uses.optional` entries that are active and authorized
- extra manual capability flags are not the contract boundary
- user sessions must never receive service-only capabilities

## Non-Goals

- defining HTTP endpoint and RPC request/response payloads
- defining TypeScript or Rust client library APIs
- deployment configuration, rate limiting, root-key rotation, or HA runbooks
- issuer private-key storage and deployment-specific context distribution
