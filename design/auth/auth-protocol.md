---
title: Auth Protocol
description: Language-neutral auth protocol rules for proofs, connect tokens, auth callout, reply validation, and auth state.
order: 20
---

# Design: Auth Protocol

## Prerequisites

- [trellis-auth.md](./trellis-auth.md) - auth architecture and trust model
- [../contracts/trellis-contracts-catalog.md](./../contracts/trellis-contracts-catalog.md) - contract-driven permission derivation
- [../operations/trellis-operations.md](./../operations/trellis-operations.md) - operation watch and streaming reply semantics

## Scope

This document defines the language-neutral Trellis auth protocol.

It covers:

- cryptographic encodings and signatures
- NATS connect token shapes
- auth callout behavior
- RPC proof verification
- pre-auth device wait verification
- reply-subject validation and streaming reply rules
- internal auth state records required for protocol behavior

It does not define public HTTP and RPC endpoint schemas; those live in `auth-api.md` and, for the activated-device lifecycle, `device-activation.md`.

## Cryptographic Primitives

| Notation    | Definition                              |
| ----------- | --------------------------------------- |
| `hash(x)`   | SHA-256 digest of x                     |
| `sign(k,x)` | Ed25519 signature of x using key k      |
| Encoding    | base64url without padding (RFC 4648 section 5) |

Canonical byte encoding for signatures:

| Value type      | Encoding                                                                   |
| --------------- | -------------------------------------------------------------------------- |
| Strings         | UTF-8 bytes via `TextEncoder`                                              |
| Numbers (`iat`) | ASCII decimal string (e.g. `"1735689600"`)                                |
| Concatenation   | `sign(hash("prefix:" + value))` means UTF-8 bytes of literal concatenation |

All Trellis clients, including Rust CLIs and future non-TypeScript clients, must match this encoding exactly.

Identity encoding:

```ts
trellisId = base64url(SHA256(origin + ":" + id)).slice(0, 22);
```

The signed value is always the exact UTF-8 bytes as transmitted. No URL normalization is applied before signing.

## Connect Token Shapes

After identity binding, clients connect to NATS with sentinel credentials plus a Trellis `auth_token` JSON payload.

User connect or reconnect with binding token:

```ts
{
  v: 1,
  sessionKey: string,
  bindingToken: string,
  sig: string, // sign(hash("nats-connect:" + bindingToken))
}
```

Service connect or reconnect with timestamp:

```ts
{
  v: 1,
  sessionKey: string,
  iat: number,
  sig: string, // sign(hash("nats-connect:" + iat))
}
```

Rules:

- `v` is mandatory and unknown versions are rejected
- user clients should prefer `bindingToken`
- services typically use `iat` and therefore require NTP drift within 30 seconds
- services MAY use `bindingToken` if they obtained one through an identity binding flow

## Auth Callout Behavior

When NATS calls `$SYS.REQ.USER.AUTH`:

1. Require `Nats-Server-Xkey` and decrypt the payload
2. Extract `user_nkey` and `connect_opts.auth_token`
3. Parse `{ v, sessionKey, sig, bindingToken?, iat? }`
4. Resolve identity by priority: `bindingToken` first, then `iat`
5. Lookup grants from sessions or service registry
6. Load active contracts and derive publish/subscribe permissions
7. Issue a NATS JWT for the server-generated `user_nkey`
8. Update session liveness
9. Emit `events.v1.Auth.Connect` for user and service sessions

Detailed behavior:

```text
CASE: USER INITIAL / RECONNECT (bindingToken)
- lookup hashed binding token with revision
- verify token maps to sessionKey
- verify sig = sign(hash("nats-connect:" + bindingToken))
- reject if `expiresAt <= now`
- lookup sessions by sessionKey prefix
- reject and revoke on multi-match corruption
- verify user active
- compute inboxPrefix
- derive permissions and issue JWT

CASE: SERVICE CONNECT / RECONNECT (iat)
- reject if abs(now - iat) > 30s
- verify sig = sign(hash("nats-connect:" + iat))
- lookup sessions by sessionKey prefix
- reject and revoke on multi-match corruption
- if existing session: verify service still active
- if no session: create service session from registry policy
- compute inboxPrefix
- derive permissions and issue JWT

CASE: ACTIVATED DEVICE CONNECT / RECONNECT (iat)
- reject if abs(now - iat) > 30s
- verify sig = sign(hash("nats-connect:" + iat))
- if sessionKey matches an installed device, follow the installed-device path instead
- otherwise resolve the activated device instance by public identity key
- require the presented `contractDigest` to match an allowed digest on the device profile
- reject if the device is unknown, revoked, or its profile is missing or disabled
- create or refresh an activated-device session keyed by `<sessionKey>.<instanceId>`
- record `activatedAt` on the first successful runtime auth
- compute inboxPrefix
- derive permissions from the active device profile and issue JWT
- do not emit `events.v1.Auth.Connect` for activated-device sessions
```

Auth callout payload field names use canonical snake_case names such as:

- `user_nkey`
- `server_id`
- `client_info`
- `connect_opts`

CamelCase aliases are not part of the Trellis protocol.

The auth-callout request and response MUST be XKey-encrypted. Plaintext auth-callout payloads are not supported.

## Permission Derivation

The auth callout derives permissions from:

- current session or service policy grants
- the deployment's active contracts
- declared `operations`, `rpc`, `events`, `subjects`, and `uses`
- installed resource bindings

Rules:

- inbox subscribe permission always includes `${inboxPrefix}.>`
- services receive only the resource-derived publish/subscribe permissions appropriate to their installed bindings
- operation streaming replies use `jwt.resp.max = OPERATION_RESPONSE_MAX`
- `OPERATION_RESPONSE_MAX` MUST be greater than `1` and SHOULD default to `65535`

## RPC Message Signing

Each authenticated RPC includes proof of session-key ownership.

Proof input:

```ts
function buildProofInput(
  sessionKey: string,
  subject: string,
  payloadHash: Uint8Array,
): Uint8Array {
  const enc = new TextEncoder();
  const sessionKeyBytes = enc.encode(sessionKey);
  const subjectBytes = enc.encode(subject);

  const buf = new Uint8Array(
    4 + sessionKeyBytes.length + 4 + subjectBytes.length + 4 + payloadHash.length,
  );
  const view = new DataView(buf.buffer);

  let offset = 0;
  view.setUint32(offset, sessionKeyBytes.length);
  offset += 4;
  buf.set(sessionKeyBytes, offset);
  offset += sessionKeyBytes.length;
  view.setUint32(offset, subjectBytes.length);
  offset += 4;
  buf.set(subjectBytes, offset);
  offset += subjectBytes.length;
  view.setUint32(offset, payloadHash.length);
  offset += 4;
  buf.set(payloadHash, offset);

  return buf;
}

payloadHash = SHA256(payload);
proof = ed25519_sign(sessionKeyPrivate, SHA256(buildProofInput(sessionKey, subject, payloadHash)));
```

Rules:

- receivers MUST compute `payloadHash` from the raw request body they actually received
- receivers MUST NOT trust a caller-supplied payload hash header
- length-prefixing is mandatory and prevents boundary attacks

Required message headers:

```text
session-key: <sessionKey>
proof: <base64url(ed25519 signature)>
```

Verification steps:

1. Extract `session-key`
2. Compute `payloadHash = SHA256(raw_request_body)`
3. Reconstruct proof input and verify signature using `session-key` as the public key
4. Call `rpc.Auth.ValidateRequest` for session lookup and capability checking

## Pre-Auth Device Wait Verification

Before an activated device is activated it cannot use normal authenticated RPCs, but an online device may still wait for activation completion by calling `POST /auth/devices/activate/wait`.

That endpoint uses an identity-key proof rather than a session-key proof.

Proof input:

```ts
function buildDeviceWaitProofInput(
  publicIdentityKey: string,
  nonce: string,
  iat: number,
): Uint8Array {
  const enc = new TextEncoder();
  const publicIdentityKeyBytes = enc.encode(publicIdentityKey);
  const nonceBytes = enc.encode(nonce);
  const iatBytes = enc.encode(String(iat));

  const buf = new Uint8Array(
    4 + publicIdentityKeyBytes.length +
    4 + nonceBytes.length +
    4 + iatBytes.length,
  );
  const view = new DataView(buf.buffer);

  let offset = 0;
  view.setUint32(offset, publicIdentityKeyBytes.length);
  offset += 4;
  buf.set(publicIdentityKeyBytes, offset);
  offset += publicIdentityKeyBytes.length;

  view.setUint32(offset, nonceBytes.length);
  offset += 4;
  buf.set(nonceBytes, offset);
  offset += nonceBytes.length;

  view.setUint32(offset, iatBytes.length);
  offset += 4;
  buf.set(iatBytes, offset);

  return buf;
}

sig = ed25519_sign(
  identityPrivateKey,
  SHA256(buildDeviceWaitProofInput(publicIdentityKey, nonce, iat)),
);
```

Rules:

- the endpoint MUST reject if `abs(now - iat) > 30s`
- the endpoint MUST verify `sig` using the supplied `publicIdentityKey`
- the endpoint MUST match the request against a pending or activated device handoff using `publicIdentityKey` and `nonce`
- the endpoint MUST NOT create a device session or issue transport credentials directly
- the endpoint is a bounded long poll for setup only; it is not a general pre-auth RPC mechanism

## Reply-Subject Validation

Services MUST validate that a reply subject matches the caller's inbox prefix.

```ts
if (!msg.reply?.startsWith(callerInboxPrefix + ".")) {
  throw new AuthError("Reply subject mismatch");
}
```

This prevents confused deputy attacks.

## Operation Streaming Replies

Unary RPCs use one reply. Operations may use multiple replies to the same validated caller inbox subject.

Rules:

- Trellis MUST permit bounded multi-response publishing to a reply subject that was supplied on an authenticated request and passed reply-subject validation
- this capability applies only to a reply subject derived from a request the service actually received
- it is not a general publish grant to arbitrary inbox subjects
- operation `watch()` and streamed `wait()` responses use this mechanism
- ordinary unary RPCs still respond once by convention even when the transport permission can support more than one response

## Error Codes

All auth errors use `AuthError` with a `reason` code.

| Scenario | Reason Code |
| --- | --- |
| SessionKey header missing | `missing_session_key` |
| Session not found | `session_not_found` |
| Session expired | `session_expired` |
| Invalid signature | `invalid_signature` |
| Invalid binding token | `invalid_binding_token` |
| SessionKey mismatch in OAuth | `oauth_session_key_mismatch` |
| Session already bound | `session_already_bound` |
| AuthToken already used | `authtoken_already_used` |
| Timestamp out of range | `iat_out_of_range` |
| User inactive | `user_inactive` |
| User not found | `user_not_found` |
| Unknown service | `unknown_service` |
| Service disabled | `service_disabled` |
| Unknown device | `unknown_device` |
| Device activation revoked | `device_activation_revoked` |
| Device profile not found | `device_profile_not_found` |
| Device profile disabled | `device_profile_disabled` |
| Service-only capability on user | `service_role_on_user` |
| Reply mismatch | `reply_subject_mismatch` |
| Missing capabilities | `insufficient_permissions` |
| Multiple sessions for key | `session_corrupted` |

Detailed errors are acceptable because callers only reach them after passing connection-level auth.

## Internal State Model

## Browser Flow Protocol

The portal-owned browser UX uses `flowId` as the browser-visible identifier and keeps `authToken` internal to the auth service. Trellis ships a built-in portal served by the Trellis HTTP server from static assets. That built-in portal handles both login and generic device activation flows. Deployments may register custom portals and assign them to login or device flows through deployment-owned selection records. Portals are web apps, not service-authenticated principals; if a portal later continues as a Trellis app after login, it does so under a normal user session.

Flow summary:

1. `GET /auth/login` validates the signed login-init request, stores the initiating contract and optional opaque app context on a browser flow record, resolves a login portal selection or default portal, and redirects to that portal entry URL with `flowId`.
2. `GET /auth/login/:provider` requires `flowId` and stores the provider choice in the same browser flow.
3. `GET /auth/callback/:provider` provisions or refreshes the auth-local user projection, stores the resulting `authToken` server-side against the browser flow, and redirects back to the portal with the same `flowId`.
4. `GET /auth/flow/:flowId` returns `PortalFlowState`.
5. `POST /auth/flow/:flowId/approval` records the approval decision in the auth-owned flow.
6. `POST /auth/flow/:flowId/bind` completes the browser bind from `{ sessionKey, sig }`.

Bind proof rules:

- login-init uses `sig = sign(hash("oauth-init:" + redirectTo + ":" + canonicalJson(context ?? null)))`
- browser `flowId` bind uses `sig = sign(hash("bind-flow:" + flowId))`
- `/auth/bind` remains the lower-level auth-token bind path used by current non-portal callers
- browser clients SHOULD treat `authToken` as internal auth-service state rather than a fragment-delivered public contract

Required KV buckets and logical contents:

| Bucket | Key Pattern | Value | TTL |
| --- | --- | --- | --- |
| `trellis_sessions` | `<sessionKey>.<trellisId>` | Session object | `SESSION_TIMEOUT` |
| `trellis_users` | `<trellisId>` | User projection provisioned on successful external auth | None |
| `trellis_oauth_states` | `hash(<state>)` | OAuth state mapping | 5 min |
| `trellis_pending_auth` | `hash(<authToken>)` | Pending authenticated bind | 5 min |
| `trellis_contract_approvals` | `<trellisId>.<contractDigest>` | Approval object | None |
| `trellis_browser_flows` | `<flowId>` | Browser flow record | 5 min |
| `trellis_portals` | `<portalId>` | Portal record | None |
| `trellis_portal_login_selections` | `contract.<contractId>` | Login portal selection record | None |
| `trellis_instance_grant_policies` | `<contractId>` | Deployment-wide instance grant policy | None |
| `trellis_portal_device_selections` | `profile.<profileId>` | Device portal selection record | None |
| `trellis_portal_defaults` | `login.default` / `device.default` | Optional deployment default custom portals | None |
| `trellis_device_profiles` | `<profileId>` | Device profile | None |
| `trellis_device_instances` | `instance.<instanceId>.identity.<publicIdentityKey>` | Preregistered device instance | None |
| `trellis_device_activation_handoffs` | `<handoffId>` | Device activation handoff | 30 min |
| `trellis_device_activations` | `instance.<instanceId>.identity.<publicIdentityKey>` | Device activation record | None |
| `trellis_binding_tokens` | `hash(<bindingToken>)` | Binding token record | bucket TTL + enforced `expiresAt` |
| `trellis_connections` | `<sessionKey>.<trellisId>.<user_nkey>` | Active connection record | 2h |
| `trellis_services` | `<sessionKey>` | Installed service policy | None |
| `trellis_contracts` | `<digest>` | Stored contract metadata | None |

Ephemeral tokens (`state`, `authToken`, `bindingToken`) are stored by `hash(token)` rather than raw token value.

Browser flows are keyed by raw `flowId` because the flow identifier is browser-visible and used to fetch auth-owned portal state.

Device activation handoffs are short-lived setup records. Device activation records persist for the lifetime of the activated device unless revoked. Login portal selections, device portal selections, and optional default-portal settings are deployment-owned routing records used by browser login and device activation.

### Browser Flow Record

```ts
{
  flowId: string;
  kind: "login";
  sessionKey: string;
  redirectTo?: string;
  context?: unknown;
  handoffId?: string;
  contract: Record<string, unknown>;
  provider?: string;
  authToken?: string;
  createdAt: Date;
  expiresAt: Date;
}
```

### Session Object

```ts
UserSession | ServiceSession | ActivatedDeviceSession

type UserSession = {
  origin: string;
  id: string;
  type: "user";
  contractDigest?: string;
  contractId?: string;
  contractDisplayName?: string;
  contractDescription?: string;
  appOrigin?: string;
  approvalSource?: "stored_approval" | "admin_policy";
  delegatedCapabilities?: string[];
  delegatedPublishSubjects?: string[];
  delegatedSubscribeSubjects?: string[];
  createdAt: Date;
  lastAuth: Date;
};

type ServiceSession = {
  origin: string;
  id: string;
  type: "service";
  createdAt: Date;
  lastAuth: Date;
};

type ActivatedDeviceSession = {
  type: "device";
  instanceId: string;
  publicIdentityKey: string;
  profileId: string;
  contractId: string;
  contractDigest: string;
  delegatedCapabilities: string[];
  delegatedPublishSubjects: string[];
  delegatedSubscribeSubjects: string[];
  createdAt: Date;
  lastAuth: Date;
  activatedAt: Date | null;
  revokedAt: Date | null;
};
```

Rules:

- the key is `<sessionKey>.<trellisId>`
- user delegated fields are present only for contract-bearing user sessions
- user delegated sessions MAY also record the browser app origin and approval
  source used at bind time so reconnect can re-evaluate dynamic policy
- activated-device sessions use the key `<sessionKey>.<instanceId>`
- if multiple sessions match a sessionKey prefix, Trellis MUST revoke them and return `session_corrupted`

### Contract Approval Object

```ts
{
  userTrellisId: string;
  origin: string;
  id: string;
  answer: "approved" | "denied";
  answeredAt: Date;
  updatedAt: Date;
  approval: {
    contractDigest: string;
    contractId: string;
    displayName: string;
    description: string;
    capabilities: string[];
  };
  publishSubjects: string[];
  subscribeSubjects: string[];
}
```

Trellis stores one approval record per `user <-> contractDigest` pair.

### Instance Grant Policy Object

```ts
{
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
}
```

Rules:

- the key is the target `contractId` lineage
- matching enabled policies imply approval and additional effective
  capabilities dynamically; they do not mutate the user projection
- matching policy takes precedence over stored user denial while the policy is
  enabled
- optional `allowedOrigins` further restrict the policy to browser sessions that
  present that app origin; they are separate from the deployment redirect allowlist

### Users Projection

```ts
{
  origin: string;
  id: string;
  active: boolean;
  capabilities: string[];
}
```

This projection is Trellis-local and is updated by Trellis-managed flows.

It stores explicit user state only. Deployment-wide implied app grants remain in
the separate instance grant policy bucket.

### Binding Tokens

```ts
{
  sessionKey: string;
  kind: "initial" | "renew";
  createdAt: string;
  expiresAt: string;
}
```

Rules:

- binding tokens are reusable until `expiresAt`
- validation rejects expired tokens and tokens that do not map to the claimed `sessionKey`

### Active Connections

```ts
{
  serverId: string;
  clientId: number;
  connectedAt: string;
}
```

Rules:

- key is `<sessionKey>.<scopeId>.<user_nkey>` where `scopeId` is `trellisId` for user and installed-device sessions and `instanceId` for activated-device sessions
- disconnect cleanup is best-effort plus TTL-backed self-healing

## Event Authorization

The `trellis` service publishes `events.v1.Auth.*` as part of `trellis.auth@v1`.

Events:

- `events.v1.Auth.Connect`
- `events.v1.Auth.Disconnect`
- `events.v1.Auth.SessionRevoked`
- `events.v1.Auth.ConnectionKicked`
- `events.v1.Auth.DeviceActivationRequested`
- `events.v1.Auth.DeviceActivationApproved`
- `events.v1.Auth.DeviceActivationRejected`
- `events.v1.Auth.DeviceActivated`
- `events.v1.Auth.DeviceActivationRevoked`

Rules:

- services may subscribe only if their installed contract explicitly declares the events in `uses`
- extra manual capability flags are not the contract boundary
- user sessions must never receive service-only capabilities

## Non-Goals

- defining HTTP endpoint and RPC request/response payloads
- defining TypeScript or Rust client library APIs
- deployment configuration, rate limiting, key rotation, or HA runbooks
