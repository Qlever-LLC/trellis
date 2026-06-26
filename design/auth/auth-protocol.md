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

Identity-derived account ids are no longer used for canonical users. User
accounts have generated `userId` values; provider identity ids may be derived
from provider and subject, but they are not account ids.

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
4. Derive permissions from current grants, the resolved principal's presented
   contract context, materialized authority, effective active dependencies, and
   materialized resource bindings, then issue a NATS JWT for the
   server-generated `user_nkey`.
5. Update session liveness and active-connection tracking.
6. Emit `events.v1.Auth.Connections.Opened` for user and service sessions.

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
- verify the presented contract fits the identity authority for that bound
  user/app context
- derive permissions and issue JWT
- update session liveness and active-connection tracking

CASE: SERVICE CONNECT / RECONNECT (`sessionKey + contractDigest + iat + sig`)
- reject if abs(now - iat) > 30s
- verify sig = sign(hash("nats-connect:" + iat + ":" + contractDigest))
- lookup the service instance keyed by `sessionKey`
- reject if the service instance is disabled or its deployment is missing/disabled
- reject if the presented contract proposal's requested needs are not accepted
  in deployment authority or have not converged into materialized authority
- reject with `contract_changed` if the presented contract proposal no longer
  fits accepted deployment authority; reconnects must not refresh an expired
  offer back into authority
- lookup or create the session keyed by `sessionKey` only after authority fit
  succeeds
- compute inboxPrefix
- derive permissions from the exact presented service contract, materialized
  authority, effective active dependencies, and materialized resource bindings,
  then issue JWT

CASE: DEVICE CONNECT / RECONNECT (`sessionKey + contractDigest + iat + sig`)
- reject if abs(now - iat) > 30s
- verify sig = sign(hash("nats-connect:" + iat + ":" + contractDigest))
- if sessionKey matches an installed device, follow the installed-device path instead
- otherwise resolve the device instance by public identity key
- require the presented contract proposal to fit the device deployment authority
  and materialized authority
- reject if the device is unknown, disabled, revoked, or its deployment is
  missing or disabled
- if an activation record exists, require it to be activated and not revoked;
  this produces user-delegated device authority
- if no activation record exists, require an admin/review-approved setup flow;
  this MUST NOT create or mutate a user activation record
- create or refresh a device session keyed by `sessionKey`
- preserve `activatedAt` from the activation record for user-delegated device
  authority; admin/review-approved sessions keep `activatedAt: null`
- compute inboxPrefix
- derive permissions from materialized device authority and issue JWT
- do not emit `events.v1.Auth.Connections.Opened` for device sessions
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

- current session grants and grant overrides
- presented contracts resolved against identity authority and identity grants
  for user sessions
- materialized authority for service/device sessions
- declared `operations`, `rpc`, `events`, and `uses`
- materialized resource bindings

Rules:

- inbox subscribe permission always includes `${inboxPrefix}.>`
- services receive only the resource-derived publish/subscribe permissions
  appropriate to their materialized resource bindings
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

## RPC Message Signing

Each authenticated RPC includes proof of session-key ownership. Contract digest
binding is established earlier during connect, bootstrap, or session creation;
per-request RPC proofs do not carry or sign `contractDigest`.

Proof input:

```ts
function buildProofInput(
  sessionKey: string,
  subject: string,
  payloadHash: Uint8Array,
  iat: number,
  requestId: string,
): Uint8Array {
  const enc = new TextEncoder();
  const sessionKeyBytes = enc.encode(sessionKey);
  const subjectBytes = enc.encode(subject);
  const iatBytes = enc.encode(String(iat));
  const requestIdBytes = enc.encode(requestId);

  const buf = new Uint8Array(
    4 + sessionKeyBytes.length + 4 + subjectBytes.length + 4 +
      payloadHash.length + 4 + iatBytes.length + 4 + requestIdBytes.length,
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
  offset += payloadHash.length;
  view.setUint32(offset, iatBytes.length);
  offset += 4;
  buf.set(iatBytes, offset);
  offset += iatBytes.length;
  view.setUint32(offset, requestIdBytes.length);
  offset += 4;
  buf.set(requestIdBytes, offset);

  return buf;
}

payloadHash = SHA256(payload);
proof = ed25519_sign(
  sessionKeyPrivate,
  SHA256(buildProofInput(sessionKey, subject, payloadHash, iat, requestId)),
);
```

Rules:

- receivers MUST compute `payloadHash` from the raw request body they actually
  received
- receivers MUST NOT trust a caller-supplied payload hash header
- clients MUST send `iat` and `request-id` headers with every signed RPC request
- verifiers MUST include the corrected `iat` value and `requestId` in the proof
  input and reject proofs whose `iat` is outside the configured freshness window
- auth MUST reject replay of the same `requestId` for the same session while the
  replay cache entry is live
- receivers MUST verify the request against the stored authenticated
  session/principal state created at connect, bootstrap, or session binding time
- length-prefixing is mandatory and prevents boundary attacks

Required message headers:

```text
session-key: <sessionKey>
proof: <base64url(ed25519 signature)>
iat: <unix seconds, corrected to server-relative time when available>
request-id: <unique request id for this session>
```

Verification steps:

1. Extract `session-key`, `proof`, `iat`, and `request-id`
2. Compute `payloadHash = SHA256(raw_request_body)`
3. Reconstruct proof input and verify signature using `session-key` as the
   public key
4. Call `rpc.Auth.Requests.Validate` with `sessionKey`, `proof`, `subject`, raw
   `payloadHash`, `iat`, `requestId`, and required capabilities for session
   lookup, replay detection, stored contract/principal context, and capability
   checking

## Pre-Auth Device Wait Verification

Before an activated device is activated it cannot use normal authenticated RPCs,
but an online device may still wait for activation completion by calling
`POST /auth/devices/activate/wait`.

That endpoint uses an identity-key proof rather than a session-key proof.

Proof input:

```ts
function buildDeviceWaitProofInput(
  flowId: string,
  publicIdentityKey: string,
  nonce: string,
  iat: number,
  contractDigest: string,
): Uint8Array {
  const enc = new TextEncoder();
  const flowIdBytes = enc.encode(flowId);
  const publicIdentityKeyBytes = enc.encode(publicIdentityKey);
  const nonceBytes = enc.encode(nonce);
  const iatBytes = enc.encode(String(iat));
  const contractDigestBytes = enc.encode(contractDigest);

  const buf = new Uint8Array(
    4 + flowIdBytes.length +
      4 + publicIdentityKeyBytes.length +
      4 + nonceBytes.length +
      4 + iatBytes.length +
      4 + contractDigestBytes.length,
  );
  const view = new DataView(buf.buffer);

  let offset = 0;
  view.setUint32(offset, flowIdBytes.length);
  offset += 4;
  buf.set(flowIdBytes, offset);
  offset += flowIdBytes.length;

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
  offset += iatBytes.length;

  view.setUint32(offset, contractDigestBytes.length);
  offset += 4;
  buf.set(contractDigestBytes, offset);

  return buf;
}

sig = ed25519_sign(
  identityPrivateKey,
  SHA256(
    buildDeviceWaitProofInput(
      flowId,
      publicIdentityKey,
      nonce,
      iat,
      contractDigest,
    ),
  ),
);
```

Rules:

- the endpoint MUST reject if `abs(now - iat) > 30s`
- the endpoint MUST verify `sig` using the supplied `publicIdentityKey`
- the endpoint MUST include the signed `flowId` in the proof input and load the
  browser flow directly by that id
- the endpoint MUST include the exact `contractDigest` in the proof input
- the endpoint MUST match the direct flow lookup against `publicIdentityKey` and
  `nonce`; QR and MAC bearer semantics remain the intended protection for the
  browser-to-flow handoff
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

Detailed errors are acceptable because callers only reach them after passing
connection-level auth.

Browser clients treat `session_not_found` as an authentication-required state,
not as a page-local application error. Revoked browser sessions therefore
re-enter the normal login redirect flow so the app can preserve its current
return path and show sign-in UX. Non-browser clients may surface the same
`AuthError` directly.

## Internal State Model

## Browser Flow Protocol

The portal-owned browser login UX uses `flowId` as the browser-visible
identifier and keeps `authToken` internal to the Trellis runtime service.
`flowId` values are ULIDs because they are identifiers, not bearer secrets;
`authToken` remains an auth-service generated bearer token and is stored only by
hash. Trellis-generated account ids use `usr_` plus a ULID, and auth-owned
review ids use their semantic prefix plus a ULID. Trellis ships a built-in
portal served by the Trellis HTTP server from static assets. Login portal
records and route selectors are global auth-owned routing config; the built-in
login portal record is visible, non-removable, and non-replaceable. Device
deployments may carry deployment-owned portal-route metadata for device flows.
Neither form is standalone portal authority. Device activation uses the same
browser-visible `flowId` concept with `kind: "device_activation"` flow records
rather than a separate public identifier. Portals are web apps, not
service-authenticated principals; if a portal later continues as a Trellis app
after login, it does so under a normal user session.

Flow summary:

1. `POST /auth/requests` validates the signed login-init request, validates the
   initiating contract, and either returns `bound` immediately or creates a
   Trellis-owned browser flow plus a short `flowId`-based `loginUrl`.
2. `GET /auth/login/:provider` requires `flowId` and stores the provider choice
   in the same browser flow. The provider must be allowed by the selected login
   portal policy. If the referenced login flow is expired but still carries an
   app `redirectTo`, auth redirects to that app URL without adding an auth error
   so the app can restart its current auth request.
3. `GET /auth/callback/:provider` provisions or refreshes the auth-local user
   projection, stores the resulting `authToken` server-side against the browser
   flow, and redirects back to the portal with the same `flowId`.
4. `GET /auth/flow/:flowId` returns `PortalFlowState`. For a known expired
   browser flow, the expired state may include `returnLocation` so portals can
   return to the originating app without showing a transient expiration screen;
   missing flows do not receive an invented return URL.
5. `POST /auth/flow/:flowId/approval` records an account-scoped durable identity
   grant when the user accepts, or ends the browser flow and redirects to the
   caller with `authError=approval_denied` when the user denies.
6. `POST /auth/flow/:flowId/bind` completes the browser bind from
   `{ sessionKey, sig }`.

When a caller's local contract digest changes, it starts the normal auth request
flow again with the current contract body. Clients MUST compute that digest from
the same normalized contract identity projection used by the catalog, not from
human-facing manifest metadata such as `displayName` or `description`. Auth may
bind immediately when the requested subjects and capabilities are a strict
subset of the caller's current identity authority for the same app identity and
contract lineage; otherwise it returns a normal browser flow.

Bind proof rules:

- login-init uses
  `sig = sign(hash("oauth-init:" + redirectTo + ":" + (provider ?? "") + ":" + canonicalJson(contract) + ":" + canonicalJson(context ?? null)))`
- browser `flowId` bind uses `sig = sign(hash("bind-flow:" + flowId))`
- browser clients SHOULD treat `authToken` as internal auth-service state rather
  than a fragment-delivered public contract

Runtime storage responsibilities:

| Storage                    | Logical contents                                                                                                                                                                                                                                                                                                          | TTL                                          |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| SQL                        | Users, sessions, identity grants, deployment grant overrides, service records, device records, deployment authority, materialized authority, auth-owned login portal records/settings/routes, deployment-owned device portal-route metadata, contract history, implementation offers, and hashed account-management flows | Durable, with session expiry from `lastAuth` |
| `trellis_oauth_states` KV  | OAuth state mapping keyed by `hash(state)`                                                                                                                                                                                                                                                                                | 5 min                                        |
| `trellis_pending_auth` KV  | Pending authenticated bind keyed by `hash(authToken)`                                                                                                                                                                                                                                                                     | 5 min                                        |
| `trellis_browser_flows` KV | Browser flow record keyed by `flowId`, including `kind: "login"` and `kind: "device_activation"`                                                                                                                                                                                                                          | Browser-flow TTL                             |
| `trellis_connections` KV   | Active connection presence keyed by session, principal, and NATS user key                                                                                                                                                                                                                                                 | Connection TTL                               |

Ephemeral bearer tokens (`state`, `authToken`) are stored by `hash(token)`
rather than raw token value.

Browser flows are keyed by raw `flowId` because the flow identifier is
browser-visible and used to fetch auth-owned portal state. Device activation
records persist for the lifetime of the activated device unless revoked. Browser
login uses auth-owned global login portal records and route selectors. Device
activation routing remains deployment-owned authority state.

Provider chooser state returns only effective providers after selected portal
policy. `allowedFederatedProviders: null` allows all configured providers, `[]`
allows none, and a non-empty array allows only that configured subset.

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
  grantSource?: "stored_identity_grant" | "grant_override";
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
  delegated identity grant together; reconnect re-evaluates presented contract
  context against the effective identity authority for that app context
- activated-device sessions use the same `sessionKey` storage identity as user
  and service sessions; the device instance identity remains part of the stored
  session value

### Identity Grant Object

```ts
{
  userTrellisId: string;
  identity: {
    identityId: string;
    provider: string;
    subject: string;
  };
  identityAnchor:
    | { kind: "web"; contractId: string; origin: string }
    | { kind: "cli"; contractId: string; sessionPublicKey: string }
    | { kind: "native"; contractId: string; sessionPublicKey: string }
    | { kind: "device-user"; contractId: string; devicePublicKey: string };
  answer: "granted" | "denied";
  answeredAt: Date;
  updatedAt: Date;
  presentedContract: {
    contractDigest: string;
    contractId: string;
  };
  publishSubjects: string[];
  subscribeSubjects: string[];
}
```

Trellis stores identity grants when a durable user decision exists. Durable
identity grant records are keyed for reuse by Trellis `userTrellisId` plus the
app identity anchor. The identity that was active when the grant was created is
recorded as evidence only; it is not used to decide whether a later linked local
or OIDC identity on the same Trellis account may reuse the grant.

The presented contract digest is stored with identity grant history for audit
and repeat authority checks. It is not a manifest lookup fallback or active
implementation source; full manifests are resolved from built-in Trellis
contracts or the global `contracts` store. For one deployment and contract id,
runtime-active non-builtin implementation comes from accepted non-expired
service or device offers covered by materialized authority. Expired offers and
historical rows remain audit context, and reconnects must fail with
`contract_changed` rather than making an authority-incompatible digest active
again. The normal portal denial path does not create or update a stored denial
record; it is returned to the originating app as an `authError=approval_denied`
browser callback so a later sign-in attempt can present the permission prompt
again.

### Grant Override Object

```ts
type DeploymentAuthorityGrantOverride =
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

Rules:

- web overrides match exactly by `contractId` plus browser `origin`
- session-keyed overrides match exactly by `contractId` plus `sessionPublicKey`
- `grantKind: "capability"` grants one concrete capability and stores
  `capability`; `capabilityGroupKey` is `null`
- `grantKind: "capability-group"` grants one capability group reference and
  stores `capabilityGroupKey`; `capability` is `null`
- capability group references are resolved dynamically from the current group
  definition during authorization and portal identity-grant decisions
- matching enabled overrides may pre-authorize authority and capability
  decisions dynamically; they do not mutate the user projection
- matching overrides can satisfy identity-grant checks while they remain
  enabled, but they cannot create availability missing from deployment authority
  or materialized authority
- grant overrides do not support any identity shape beyond the two web and
  session-keyed rows above; other identities continue to use their normal
  identity-authority and activation flows

### Users Projection

```ts
{
  userId: string;
  active: boolean;
  capabilities: string[];
  capabilityGroups: string[];
  identities: Array<{
    identityId: string;
    provider: string;
    subject: string;
  }>;
}
```

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

It stores explicit per-user capability grants plus assigned dynamic
`capabilityGroups`. New admin-bootstrap accounts use this group assignment model
for the built-in `admin` grant, storing the `admin` group key rather than
copying the group's capabilities into direct grants. Deployment-wide implied app
grants remain as separate grant override records.

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
- deployment configuration, rate limiting, key rotation, or HA runbooks
