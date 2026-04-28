---
title: Auth Protocol
description: Language-neutral auth protocol rules for proofs, connect tokens, auth callout, reply validation, and auth state.
order: 20
---

# Design: Auth Protocol

## Prerequisites

- [trellis-auth.md](./trellis-auth.md) - auth architecture and trust model
- [../contracts/trellis-contracts-catalog.md](./../contracts/trellis-contracts-catalog.md) -
  contract-driven permission derivation
- [../operations/trellis-operations.md](./../operations/trellis-operations.md) -
  operation watch and streaming reply semantics

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

It does not define public HTTP and RPC endpoint schemas; those live in
`auth-api.md` and, for the activated-device lifecycle, `device-activation.md`.

## Cryptographic Primitives

| Notation    | Definition                                     |
| ----------- | ---------------------------------------------- |
| `hash(x)`   | SHA-256 digest of x                            |
| `sign(k,x)` | Ed25519 signature of x using key k             |
| Encoding    | base64url without padding (RFC 4648 section 5) |

Canonical byte encoding for signatures:

| Value type      | Encoding                                                                   |
| --------------- | -------------------------------------------------------------------------- |
| Strings         | UTF-8 bytes via `TextEncoder`                                              |
| Numbers (`iat`) | ASCII decimal string (e.g. `"1735689600"`)                                 |
| Concatenation   | `sign(hash("prefix:" + value))` means UTF-8 bytes of literal concatenation |

All Trellis clients, including Rust CLIs and future non-TypeScript clients, must
match this encoding exactly.

Identity encoding:

```ts
trellisId = base64url(SHA256(origin + ":" + id)).slice(0, 22);
```

The signed value is always the exact UTF-8 bytes as transmitted. No URL
normalization is applied before signing.

## Connect Token Shapes

After identity binding, clients connect to NATS with sentinel credentials plus a
Trellis `auth_token` JSON payload.

User/session-key runtime auth:

```ts
{
  v: 1,
  sessionKey: string,
  contractDigest: string,
  iat: number,
  sig: string, // sign(hash("nats-connect:" + iat + ":" + contractDigest))
}
```

Service/session-key runtime auth:

```ts
{
  v: 1,
  sessionKey: string,
  contractDigest: string,
  iat: number,
  sig: string, // sign(hash("nats-connect:" + iat + ":" + contractDigest))
}
```

Rules:

- `v` is mandatory and unknown versions are rejected
- user, device, and service runtimes MUST send `contractDigest`
- verifiers MUST reject signatures if the presented `contractDigest` differs
  from the digest used to produce the signature
- reconnect uses freshly generated `iat`-based proofs rather than renewable
  binding tokens
- clients with unstable local clocks SHOULD derive `iat` from server-relative
  time using bootstrap `serverNow`

## Auth Callout Behavior

When NATS calls `$SYS.REQ.USER.AUTH`:

1. Decode the encrypted request by requiring `Nats-Server-Xkey`, decrypting the
   payload, and extracting `user_nkey` plus `connect_opts.auth_token`.
2. Validate the connect token by parsing
   `{ v, sessionKey, sig, iat, contractDigest }`, checking token version and
   proof freshness, and verifying the signed proof against the presented digest.
3. Resolve the session and principal from the session key, presented proof
   shape, and explicit runtime repositories for users, services, or devices.
4. Derive permissions from current grants, the resolved principal's contract
   context, active service/device contracts, and installed bindings, then issue
   a NATS JWT for the server-generated `user_nkey`.
5. Update session liveness and active-connection tracking.
6. Emit `events.v1.Auth.Connect` for user and service sessions.

Expected auth failures in those stages return typed denials and reason codes,
such as `invalid_signature`, `iat_out_of_range`, or `service_disabled`. They
must not escape as generic exceptions in normal denial paths.

Detailed behavior:

```text
CASE: USER CONNECT / RECONNECT (`sessionKey + contractDigest + iat + sig`)
- reject if abs(now - iat) > 30s
- verify sig = sign(hash("nats-connect:" + iat + ":" + contractDigest))
- lookup the session keyed by `sessionKey`
- verify the bound session is still valid for the same app identity
- verify user active
- verify the presented `contractDigest` is a known approved app or agent digest
  for that bound user/app context
- derive permissions and issue JWT
- update session liveness and active-connection tracking

CASE: SERVICE CONNECT / RECONNECT (`sessionKey + contractDigest + iat + sig`)
- reject if abs(now - iat) > 30s
- verify sig = sign(hash("nats-connect:" + iat + ":" + contractDigest))
- lookup the service instance keyed by `sessionKey`
- reject if the service instance is disabled or its deployment is missing/disabled
- reject if the service instance has no current contract digest, if the presented
  digest differs from `service.currentContractDigest`, or if that current digest
  is no longer allowed by the deployment's matching applied-contract lineage
- lookup or create the session keyed by `sessionKey` only after the exact digest
  authorization succeeds
- compute inboxPrefix
- derive permissions from the exact current service contract state and issue JWT

CASE: ACTIVATED DEVICE CONNECT / RECONNECT (`sessionKey + contractDigest + iat + sig`)
- reject if abs(now - iat) > 30s
- verify sig = sign(hash("nats-connect:" + iat + ":" + contractDigest))
- if sessionKey matches an installed device, follow the installed-device path instead
- otherwise resolve the activated device instance by public identity key
- require the presented `contractDigest` to match an allowed digest on the device deployment
- reject if the device is unknown, revoked, or its deployment is missing or disabled
- create or refresh an activated-device session keyed by `sessionKey`
- record `activatedAt` on the first successful runtime auth
- compute inboxPrefix
- derive permissions from the active device deployment and issue JWT
- do not emit `events.v1.Auth.Connect` for activated-device sessions
```

## Server-Relative Time

Bootstrap and connect-info responses that expect `iat`-based runtime auth SHOULD
return `serverNow`.

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

- current session or service policy grants
- known approved app/agent contracts for user sessions
- the deployment's active service/device contracts
- declared `operations`, `rpc`, `events`, and `uses`
- installed resource bindings

Rules:

- inbox subscribe permission always includes `${inboxPrefix}.>`
- services receive only the resource-derived publish/subscribe permissions
  appropriate to their installed bindings
- operation-control publish permissions are derived only from operation
  `read`/`cancel` capabilities; `call` authorizes starting an operation but does
  not authorize publishing to its control subject
- auth-callout denial paths return explicit deny responses and MUST NOT mint a
  partially scoped user JWT when the active catalog, session, deployment, or
  resource state needed for permission derivation is unavailable
- unexpected auth-callout exceptions are logged with internal details but return
  a stable generic external error such as `internal_error`
- operation streaming replies use `jwt.resp.max = OPERATION_RESPONSE_MAX`
- `OPERATION_RESPONSE_MAX` MUST be greater than `1` and SHOULD default to
  `65535`

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
    4 + sessionKeyBytes.length + 4 + subjectBytes.length + 4 +
      payloadHash.length,
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
proof = ed25519_sign(
  sessionKeyPrivate,
  SHA256(buildProofInput(sessionKey, subject, payloadHash)),
);
```

Rules:

- receivers MUST compute `payloadHash` from the raw request body they actually
  received
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
3. Reconstruct proof input and verify signature using `session-key` as the
   public key
4. Call `rpc.Auth.ValidateRequest` for session lookup and capability checking

## Pre-Auth Device Wait Verification

Before an activated device is activated it cannot use normal authenticated RPCs,
but an online device may still wait for activation completion by calling
`POST /auth/devices/activate/wait`.

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
- the endpoint MUST match the request against a pending or activated
  device-activation flow using `publicIdentityKey` and `nonce`
- the endpoint MUST NOT create a device session or issue transport credentials
  directly
- the endpoint is a bounded long poll for setup only; it is not a general
  pre-auth RPC mechanism

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

All auth errors use `AuthError` with a `reason` code.

| Scenario                        | Reason Code                   |
| ------------------------------- | ----------------------------- |
| SessionKey header missing       | `missing_session_key`         |
| Session not found               | `session_not_found`           |
| Session expired                 | `session_expired`             |
| Invalid signature               | `invalid_signature`           |
| SessionKey mismatch in OAuth    | `oauth_session_key_mismatch`  |
| Session already bound           | `session_already_bound`       |
| AuthToken already used          | `authtoken_already_used`      |
| Timestamp out of range          | `iat_out_of_range`            |
| Approval required               | `approval_required`           |
| Contract changed                | `contract_changed`            |
| User inactive                   | `user_inactive`               |
| User not found                  | `user_not_found`              |
| Unknown service                 | `unknown_service`             |
| Service disabled                | `service_disabled`            |
| Unknown device                  | `unknown_device`              |
| Device activation revoked       | `device_activation_revoked`   |
| Device deployment not found     | `device_deployment_not_found` |
| Device deployment disabled      | `device_deployment_disabled`  |
| Service-only capability on user | `service_role_on_user`        |
| Reply mismatch                  | `reply_subject_mismatch`      |
| Missing capabilities            | `insufficient_permissions`    |

Detailed errors are acceptable because callers only reach them after passing
connection-level auth.

Browser clients treat `session_not_found` as an authentication-required state,
not as a page-local application error. A revoked browser session therefore
re-enters the normal login redirect flow so the app can preserve its current
return path and show sign-in UX. Non-browser clients may surface the same
`AuthError` directly.

## Internal State Model

## Browser Flow Protocol

The portal-owned browser login UX uses `flowId` as the browser-visible
identifier and keeps `authToken` internal to the Trellis runtime service.
Trellis ships a built-in portal served by the Trellis HTTP server from static
assets. Deployments may register custom portals and assign them to login or
device flows through deployment-owned selection records. Device activation uses
the same browser-visible `flowId` concept with `kind: "device_activation"` flow
records rather than a separate public identifier. Portals are web apps, not
service-authenticated principals; if a portal later continues as a Trellis app
after login, it does so under a normal user session.

Flow summary:

1. `POST /auth/requests` validates the signed login-init request, validates the
   initiating contract, and either returns `bound` immediately or creates a
   Trellis-owned browser flow plus a short `flowId`-based `loginUrl`.
2. `GET /auth/login/:provider` requires `flowId` and stores the provider choice
   in the same browser flow.
3. `GET /auth/callback/:provider` provisions or refreshes the auth-local user
   projection, stores the resulting `authToken` server-side against the browser
   flow, and redirects back to the portal with the same `flowId`.
4. `GET /auth/flow/:flowId` returns `PortalFlowState`.
5. `POST /auth/flow/:flowId/approval` records the approval decision in the
   Trellis-owned flow.
6. `POST /auth/flow/:flowId/bind` completes the browser bind from
   `{ sessionKey, sig }`.

When a caller's local contract digest changes, it starts the normal auth request
flow again with the current contract body. Clients MUST compute that digest from
the same normalized contract identity projection used by the catalog, not from
human-facing manifest metadata such as `displayName` or `description`. Auth may
bind immediately when the requested subjects and capabilities are a strict
subset of the caller's current delegated envelope for the same app identity and
contract lineage; otherwise it returns a normal browser flow.

Bind proof rules:

- login-init uses
  `sig = sign(hash("oauth-init:" + redirectTo + ":" + (provider ?? "") + ":" + canonicalJson(contract) + ":" + canonicalJson(context ?? null)))`
- browser `flowId` bind uses `sig = sign(hash("bind-flow:" + flowId))`
- browser clients SHOULD treat `authToken` as internal auth-service state rather
  than a fragment-delivered public contract

Runtime storage responsibilities:

| Storage                    | Logical contents                                                                                                              | TTL                                          |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| SQL                        | Users, sessions, approval decisions, grant policies, portals, service records, device records, and installed contract records | Durable, with session expiry from `lastAuth` |
| `trellis_oauth_states` KV  | OAuth state mapping keyed by `hash(state)`                                                                                    | 5 min                                        |
| `trellis_pending_auth` KV  | Pending authenticated bind keyed by `hash(authToken)`                                                                         | 5 min                                        |
| `trellis_browser_flows` KV | Browser flow record keyed by `flowId`, including `kind: "login"` and `kind: "device_activation"`                              | Browser-flow TTL                             |
| `trellis_connections` KV   | Active connection presence keyed by session, principal, and NATS user key                                                     | Connection TTL                               |

Ephemeral tokens (`state`, `authToken`) are stored by `hash(token)` rather than
raw token value.

Browser flows are keyed by raw `flowId` because the flow identifier is
browser-visible and used to fetch auth-owned portal state. Device activation
records persist for the lifetime of the activated device unless revoked. Login
portal selections, device portal selections, optional default-portal settings,
and portal profiles are deployment-owned SQL records used by browser login and
device activation.

### Browser Flow Record

```ts
{
  flowId: string;
  kind: "login" | "device_activation";
  sessionKey?: string;
  app?: {
    contractId: string;
    origin?: string;
  };
  redirectTo?: string;
  context?: unknown;
  contract?: Record<string, unknown>;
  deviceActivation?: {
    instanceId: string;
    deploymentId: string;
    publicIdentityKey: string;
    nonce: string;
    qrMac: string;
  };
  provider?: string;
  authToken?: string;
  createdAt: Date;
  expiresAt: Date;
}
```

### Session Object

```ts
UserSession | ServiceSession | ActivatedDeviceSession;

type UserSession = {
  origin: string;
  id: string;
  type: "user";
  contractDigest: string;
  contractId: string;
  contractDisplayName: string;
  contractDescription: string;
  app?: {
    contractId: string;
    origin?: string;
  };
  approvalSource?: "stored_approval" | "admin_policy" | "portal_profile";
  delegatedCapabilities: string[];
  delegatedPublishSubjects: string[];
  delegatedSubscribeSubjects: string[];
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
  deploymentId: string;
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

- the durable session key is `sessionKey`
- user sessions bind user identity, explicit app identity, and the last
  delegated contract envelope together; reconnect re-evaluates current digest
  authorization for that app context
- activated-device sessions use the same `sessionKey` storage identity as user
  and service sessions; the device instance identity remains part of the stored
  session value

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

Portal profiles are projected into the same effective-policy matching path using
`source.kind = "portal_profile"` plus routed portal metadata:

```ts
{
  contractId: string;
  allowedOrigins?: string[];
  impliedCapabilities: string[];
  disabled: boolean;
  createdAt: string;
  updatedAt: string;
  source: {
    kind: "portal_profile";
    portalId: string;
    entryUrl: string;
  };
}
```

Rules:

- the key is the target `contractId` lineage
- matching enabled policies imply approval and additional effective capabilities
  dynamically; they do not mutate the user projection
- matching policy takes precedence over stored user denial while the policy is
  enabled
- optional `allowedOrigins` further restrict the policy to browser sessions that
  present that app origin; they are separate from the deployment redirect
  allowlist

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

### Active Connections

```ts
{
  serverId: string;
  clientId: number;
  connectedAt: string;
}
```

Rules:

- key is `<sessionKey>.<scopeId>.<user_nkey>` where `scopeId` is `trellisId` for
  user sessions, service or installed-device identity for installed runtime
  sessions, and `instanceId` for activated-device sessions
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

- services may subscribe only if their installed contract explicitly declares
  the events in `uses`
- extra manual capability flags are not the contract boundary
- user sessions must never receive service-only capabilities

## Non-Goals

- defining HTTP endpoint and RPC request/response payloads
- defining TypeScript or Rust client library APIs
- deployment configuration, rate limiting, key rotation, or HA runbooks
