---
title: Trellis Auth
description: Trellis authentication and authorization architecture, including approvals, session keys, and service install identity.
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
- CLIs
- backend services
- devices
- NATS transport permissions
- application-layer request authorization

The model must avoid long-lived bearer tokens, must fit NATS auth callout, and
must preserve Trellis's contract-driven permission model.

## Design

### 1) Trellis uses a two-layer auth model

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

### 2) Prove session-key ownership before granting access

Users and services follow the same core model:

1. bind an identity to a session key
2. connect to NATS with sentinel credentials plus Trellis auth proof
3. receive a scoped NATS JWT from the Trellis auth callout

Rules:

- session-key proof alone is not enough for ordinary user clients
- contract-bearing clients must also present an approved contract digest
- permissions are always derived from active contracts plus current grants,
  never from hard-coded static ACLs

### 3) Identity binding differs by principal type

| Client Type | Identity Source                              | Binding Mechanism                                                    |
| ----------- | -------------------------------------------- | -------------------------------------------------------------------- |
| Users       | External IdP                                 | Portal-mediated browser auth flow binds user identity to session key |
| Services    | Trellis service registry                     | Admin install binds service public key to session key                |
| Devices     | Known-device registry plus activation review | Approved activation binds runtime public key to a device principal   |

The identity source is pluggable. The core requirement is that Trellis can bind
a stable identity to a session key before allowing authenticated access.

For devices, the runtime public key is the durable principal identity, but that
identity is not allowed online until an activation request has been reviewed.

### 4) Session keys are the long-lived application identity

Browser clients:

- use Ed25519 keys
- store them in IndexedDB via WebCrypto
- must keep them non-extractable

Server and service clients:

- use Ed25519 keys
- load the private seed from configuration such as `TRELLIS_SESSION_KEY_SEED`

Rules:

- the private session key seed is the real application credential
- the public session key is an identifier, not a secret credential
- session keys persist across reconnects and are rotated only deliberately

### 5) Sentinel credentials trigger auth callout; they grant no real access

Clients connect to NATS using sentinel credentials that exist only to trigger
the Trellis auth callout.

Rules:

- sentinel credentials have zero useful publish/subscribe permissions by
  themselves
- real connection permissions are issued only after the Trellis auth callout
  validates the auth token
- browser clients receive sentinel credentials only after bind succeeds
- services load sentinel credentials from deployment configuration

### 6) User auth is approval-gated by exact contract digest

Trellis treats browser apps and other normal user-facing clients as
contract-bearing clients.

Rules:

- portal owns browser UX such as provider chooser and approval screens, but auth
  remains the protocol and state authority
- the approval key is `user <-> contractDigest`, not merely
  `user <-> contractId`
- contract changes create a new digest and therefore require a fresh user
  decision
- approval scopes are derived from declared contract APIs; there is no separate
  scope DSL
- Trellis stores both `approved` and `denied` decisions
- if the user's capabilities no longer satisfy the delegated contract, the
  delegated session becomes invalid until re-approval

### 7) Services are installed, not self-registering

Service identity is bound by installation through Trellis-admin flows.

Rules:

- the service public key is the service identity
- installation records the service policy, contract digest, and resource
  bindings
- the private service seed never crosses the network to Trellis auth
- service key rotation is a separate explicit administrative operation

### 8) Auth remains unified after binding

After identity binding, users and services share the same auth-callout-based
NATS connection model.

Devices join that same runtime model after activation is approved. Before that
point, device setup uses the dedicated handoff, request, review, and pre-auth
wait surfaces defined in [device-activation.md](./device-activation.md). Generic
browser auth UX runs through the deployment portal binding, while
device-type-specific onboarding still resolves through explicit onboarding
handler bindings.

The important distinction is that devices differ in auth establishment, not in
post-auth runtime treatment. After successful online auth, Trellis should treat
devices as a third session kind alongside users and services.

Conceptually:

```ts
type Session = UserSession | ServiceSession | DeviceSession;

type DeviceSession = {
  type: "device";
  deviceId: string;
  deviceType: string;
  runtimePublicKey: string;
  profileId: string;
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

- users, services, and devices all prove long-lived key ownership before
  receiving authenticated runtime access
- users, services, and devices all receive transport permissions derived from
  current grants and active contracts
- devices do not use browser bind or binding tokens; they establish their
  session from activation state plus runtime-key proof
- service resource permissions may be augmented from installed bindings
- higher-level runtimes should resolve bindings eagerly and expose typed
  resource handles rather than raw bootstrap details

### 9) Auth is contract-driven

Authorization is derived from:

- the active contract set
- the caller's grants and approvals
- declared `operations`, `rpc`, `events`, `subjects`, and `uses`
- installed resource bindings

Rules:

- Trellis MUST derive permissions from contracts rather than from a parallel
  scope system
- operation, RPC, event, and subject access are all contract-level authorization
  concerns
- services may subscribe to auth events only when their installed contracts
  explicitly declare them in `uses`

### 10) Reply subjects and operation streams are part of the auth model

The auth model must protect reply subjects and support operation streaming
replies.

Rules:

- services MUST validate reply subjects against the caller's inbox prefix
- operation `watch()` and streamed `wait()` responses are allowed as bounded
  multi-response replies to validated caller inbox subjects
- Trellis MUST NOT grant arbitrary inbox publish rights just to support
  operation streams

### 11) Trellis maintains auth-local state for fast authorization

The auth subsystem maintains Trellis-local state such as:

- sessions
- user projections
- service registry entries
- approval records
- portal bindings
- auth browser flow records
- device onboarding handlers
- device profiles
- device activation handoffs
- device activation requests
- device activation records
- binding tokens
- active connection records

Rules:

- these records are part of Trellis auth's internal state model
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
- [device-activation.md](./device-activation.md) - device request, review,
  confirmation, and activation flow
- [auth-typescript-api.md](./auth-typescript-api.md) - TypeScript browser and
  service auth helpers
- [auth-rust-api.md](./auth-rust-api.md) - Rust service and CLI auth helpers
- [auth-operations.md](./auth-operations.md) - deployment, HA, rate limits,
  rotation, and accepted operational risks
