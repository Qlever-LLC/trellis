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
- activated devices
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

### 3) Identity binding differs by principal class

| Principal Class | Identity Source                            | Binding Mechanism                                                        |
| --------------- | ------------------------------------------ | ------------------------------------------------------------------------ |
| Users           | External IdP                               | Portal-mediated browser auth flow binds user identity to session key     |
| Installed devices | Trellis device install registry      | Admin install binds device public key to an exact digest and session key |
| Activated devices | Preregistered device instance registry | Activation binds device public identity key to a device principal    |

The identity source is pluggable. The core requirement is that Trellis can bind a stable identity to a session key before allowing authenticated access.

For activated devices, the public identity key is the durable principal identity. That identity is not allowed online until the preregistered device instance has been activated.

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

### 6) User identity is provisioned before contract approval

Successful external authentication provisions or refreshes the auth-local user
projection before any contract approval or bind step completes.

Rules:

- first successful external authentication MUST create the user projection if it
  does not already exist
- reprovisioning MUST preserve admin-managed user state such as `active` and
  explicitly granted capabilities
- deployment-wide instance grant policies MUST NOT be copied onto the user
  projection; they remain auth-owned dynamic policy
- contract approval gates delegated app/session access, not whether the user
  exists in auth-local state

### 7) User auth is approval-gated by exact contract digest

Trellis treats browser apps and other normal user-facing clients as
contract-bearing clients.

Rules:

- portal owns browser UX such as provider chooser and approval screens, but auth
  remains the protocol and state authority
- Trellis ships a built-in portal served by the Trellis HTTP server from static
  assets; it handles both login and generic device activation flows, and
  deployments may register custom portals to replace that behavior selectively
- a portal is a browser web app registered by deployment-owned portal records;
  it is never a service-authenticated principal
- a portal MAY also act later as a normal user-authenticated browser app, but
  any such authority is delegated from the logged-in user rather than from a
  service install record
- browser apps MAY attach opaque portal context to login initiation so custom portals can coordinate UX without introducing portal-specific app APIs
- the approval key is `user <-> contractDigest`, not merely
  `user <-> contractId`
- contract changes create a new digest and therefore require a fresh user
  decision
- normal reconnect keeps using the currently approved digest; when a caller's
  local digest changes, `rpc.Auth.RenewBindingToken` returns
  `contract_changed` and the caller must start the normal auth flow again with
  the full contract body
- auth MAY skip browser UX for a changed digest when the caller already has an
  active delegated session for the same contract lineage and the new contract's
  concrete publish subjects, subscribe subjects, and capabilities are each a
  strict subset of that current delegated envelope
- deployments MAY also configure instance grant policies keyed by contract
  lineage, with optional origin restrictions, that imply approval and effective
  capabilities dynamically
- when a matching instance grant policy is enabled, it overrides explicit user
  denial for that app lineage while the policy remains enabled
- approval scopes are derived from declared contract APIs; there is no separate
  scope DSL
- Trellis stores both `approved` and `denied` decisions
- if the user's capabilities no longer satisfy the delegated contract, the
  delegated session becomes invalid until re-approval
- if a policy change removes implied approval or implied capabilities, Trellis
  MUST revoke affected delegated sessions and require reconnect or re-auth
- inactive users MUST NOT complete bind even if they still have a stored
  approval record
- after any successful rebind or auto-approved contract change, callers MUST
  reconnect NATS before using the new rights because transport JWTs are issued
  per connection

### 8) Provider-capable devices are installed, not self-registering

Provider-capable devices are bound by installation through Trellis-admin flows.

Rules:

- the installed device public key is the device identity
- installation records the exact contract digest and any resource bindings
- the private device seed never crosses the network to Trellis auth
- key rotation is a separate explicit administrative operation

### 9) Auth remains unified after binding

After identity binding, users and devices share the same auth-callout-based NATS connection model.

Activated devices join that same runtime model after activation is complete. Before that point, device setup uses the dedicated handoff, activation, and pre-auth wait surfaces defined in [device-activation.md](./device-activation.md). Browser auth UX runs through portals selected by explicit login and device portal-selection state; callers do not choose portals directly in the normal path. A portal may later continue as a user-authenticated browser app for onboarding or activation work, but that remains user-delegated app authority rather than service authority.

The important distinction is that installed and activated devices differ in auth establishment, not in the basic runtime treatment after auth succeeds.

Conceptually:

```ts
type Session = UserSession | InstalledDeviceSession | ActivatedDeviceSession;

type ActivatedDeviceSession = {
  type: "device";
  instanceId: string;
  publicIdentityKey: string;
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

- users and devices all prove long-lived key ownership before receiving authenticated runtime access
- users and devices all receive transport permissions derived from current grants and active contracts
- activated devices do not use browser bind or binding tokens; they establish their session from activation state plus identity-key proof and exact digest presentation
- installed device resource permissions may be augmented from installed bindings
- higher-level runtimes should resolve bindings eagerly and expose typed
  resource handles rather than raw connect details

### 10) Auth is contract-driven

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
- devices may subscribe to auth events only when their contracts explicitly declare them in `uses`

### 11) Reply subjects and operation streams are part of the auth model

The auth model must protect reply subjects and support operation streaming
replies.

Rules:

- devices MUST validate reply subjects against the caller's inbox prefix
- operation `watch()` and streamed `wait()` responses are allowed as bounded
  multi-response replies to validated caller inbox subjects
- Trellis MUST NOT grant arbitrary inbox publish rights just to support
  operation streams

### 12) Trellis maintains auth-local state for fast authorization

The auth subsystem maintains Trellis-local state such as:

- sessions
- user projections
- installed device registry entries
- approval records
- portal records
- login portal selection records
- device portal selection records
- optional login/device default-portal deployment settings
- auth browser flow records
- device profiles
- device instances
- device activation handoffs
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
- [device-activation.md](./device-activation.md) - known-device activation,
  connect info, and activation flow
- [auth-typescript-api.md](./auth-typescript-api.md) - TypeScript browser and
  service auth helpers
- [auth-rust-api.md](./auth-rust-api.md) - Rust service and CLI auth helpers
- [auth-operations.md](./auth-operations.md) - deployment, HA, rate limits,
  rotation, and accepted operational risks
