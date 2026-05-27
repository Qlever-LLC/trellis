---
title: Device Activation
description: Preregistered device activation, portal routing, connect info, and first online activation flow.
order: 15
---

# Design: Device Activation

## Prerequisites

- [trellis-auth.md](./trellis-auth.md) - auth architecture and principal model
- [auth-api.md](./auth-api.md) - auth HTTP and RPC surfaces
- [auth-protocol.md](./auth-protocol.md) - proofs, connect payloads, and
  pre-auth wait rules
- [../contracts/trellis-contracts-catalog.md](./../contracts/trellis-contracts-catalog.md) -
  device lineage, presented contract, and implementation-offer rules

## Context

Trellis needs an activation flow for preregistered devices that:

- have their own durable identity
- may be offline during setup
- may have constrained input
- can send an outbound activation URL or QR payload to a phone or browser
- may later gain more product-specific business logic in the portal flow
- use normal Trellis runtime auth with the device identity key once they are
  online

This design makes `device` the primary architecture term for this activation
model.

Key decisions:

- `device` is the primary architecture term for this activation model
- activated devices are preregistered against deployment-owned device
  deployments
- the client does not choose a flow type or deployment during normal activation
- Trellis resolves the device instance, device deployment, and activation portal
  policy from preregistered records
- the built-in device activation portal is the Trellis-owned app contract
  `trellis.portal.activation@v1`
- the activation portal is still a browser web app; if it calls Trellis after
  login, it does so as the logged-in user rather than as a service
- devices present a contract at runtime; deployments validate the derived
  boundary against the deployment envelope
- device deployments do not carry a separate rollout-target digest field
- device review is a first-class optional gate controlled by `reviewMode`
- the provisioning/admin path may generate the device root secret locally, but
  Trellis stores only `publicIdentityKey` plus activation-only secret material
  rather than the root secret itself

## Design

### 1) Preregistered device instances are the primary path

Known device activation starts from a preregistered instance record.

The expected lifecycle is:

1. an admin or manufacturing/provisioning process provisions the device instance
   by `publicIdentityKey` and `activationKey`
2. that instance is attached to a device deployment
3. a user later activates the device through an authenticated portal flow
4. the activated device reconnects later by asking Trellis for current connect
   info

Unknown or self-registering devices may be added later as a separate extension.
They are not the primary v1 model.

### 2) Device identity is the durable principal

Each activated device is its own Trellis principal.

- the device later authenticates with its own identity key, not as the user who
  activated it
- the user identity and the device identity are intentionally separate
- any short confirmation code is only a local setup signal; it is never the
  device's online credential

Each device starts from one root secret:

```text
deviceRootSecret: 32 random bytes
```

The device derives purpose-specific keys with HKDF-SHA256:

```text
identitySeed  = HKDF-SHA256(ikm=deviceRootSecret, salt="", info="trellis/device-identity/v1", L=32)
activationKey = HKDF-SHA256(ikm=deviceRootSecret, salt="", info="trellis/device-activate/v1", L=32)
```

The durable public identity key is:

```text
identityPrivateKey = Ed25519Seed(identitySeed)
publicIdentityKey  = Ed25519Public(identityPrivateKey)
```

Rules:

- `identityPrivateKey` is the real online credential for activated devices
- `activationKey` is used only for QR MACs and optional offline confirmation
- Trellis may store `activationKey` for provisioning-time verification and
  confirmation-code derivation, but it does not need the device root secret or
  `identitySeed`
- if Trellis needs a stable instance id, it derives that id from
  `publicIdentityKey`
- clients do not pass a separate user-chosen instance identifier in the normal
  path

### 3) Device deployments define rollout and review policy

`DeviceDeployment` is a deployment-owned record used during activation and
online auth.

```json
{
  "deploymentId": "reader.default",
  "envelope": {
    "contracts": ["acme.reader@v1"],
    "capabilities": ["acme.reader::read"]
  },
  "contractHistory": [
    { "contractDigest": "<digest-v1>", "action": "expanded" },
    { "contractDigest": "<digest-v2>", "action": "expanded" }
  ],
  "reviewMode": "none",
  "disabled": false
}
```

Rules:

- `deploymentId` is the stable server-side identifier attached to the device
  instance and activation record
- `envelope` stores the authority boundary for the deployment
- each `contractId` identifies one contract lineage
- `contractHistory` records reviewed expansion and retraction history for the
  deployment; it is audit metadata, not authority
- activated devices present a contract; auth checks that the derived required
  boundary fits the deployment envelope
- unknown or envelope-incompatible presented contracts are rejected instead of
  falling back to another digest in the deployment
- `reviewMode: "required"` means portal completion creates or resumes a pending
  review rather than activating immediately
- there is no separate rollout-target digest field

### 4) Activated devices may not request resources for now

Activated devices are consumer-only for now.

Rules:

- activated-device contracts may use `rpc`, `operations`, `events.subscribe`,
  and `uses`
- activated-device contracts may not declare `resources`
- activated-device contracts may not rely on installed resource bindings

### 5) Portal resolution is handled by Trellis

The client does not pass `flowType`, `deploymentId`, or `portalId` in the normal
path.

Routing rules:

- app and CLI login flows resolve portal routing from auth-owned global login
  route selectors keyed by app identity, then fall back to the built-in Trellis
  login portal
- activated-device flows resolve portal routing from the device deployment
  envelope, then fall back to the built-in Trellis device portal

This is automatic resolution in the sense that callers do not choose the portal
explicitly. It is still explicit on the server side because Trellis relies on
auth-owned login route selectors, stored deployment-envelope metadata for device
flows, device-deployment records, and the built-in Trellis fallback.

### 6) Known-device activation uses one auth-owned operation

Known preregistered device activation uses one requester-visible auth-owned
operation: `Auth.DeviceUserAuthorities.Resolve`.

Happy path without review:

```mermaid
sequenceDiagram
    participant W as Device
    participant U as User Browser
    participant T as Trellis Auth
    participant P as Portal

    W->>T: POST /auth/devices/activate/requests
    T-->>W: Return activationUrl with flowId
    W->>U: Show activation URL or QR payload
    U->>P: Open /_trellis/portal/devices/activate?flowId=...
    U->>P: Authenticate and complete portal business logic
    P->>T: Activate known device instance
    T-->>W: Wait endpoint resolves with activated status
```

If portal-side business logic is long-running, the portal may still use its own
async workflow around that auth-owned operation. If the portal calls Trellis
during that work, it does so using a normal user-authenticated browser app
contract rather than service credentials or portal-specific contract machinery.

If `reviewMode` is `required`, the activation flow inserts an auth-owned
pending-review step:

- `Auth.DeviceUserAuthorities.Resolve` creates or resumes a review record
  instead of activating immediately
- auth emits `events.v1.Auth.DeviceUserAuthorities.ReviewRequested` for reviewer
  automation
- a service or privileged user with `trellis.auth::device.review` or `admin`
  decides the review through auth RPCs
- the built-in portal and custom portals observe review and completion through
  the operation's `progress`, `watch()`, and `wait()` semantics until it becomes
  `activated` or `rejected`

### 7) Device records

The flow uses four durable record families, one short-lived browser flow record,
and one auth-owned secret record.

`AuthBrowserFlow(kind="device_activation")` preserves QR context across login or
account creation.

```json
{
  "flowId": "01KS755ZXTHRWQEXM1VGAMM7BF",
  "kind": "device_activation",
  "deviceActivation": {
    "instanceId": "dev_...",
    "deploymentId": "reader.default",
    "publicIdentityKey": "<base64url>",
    "nonce": "<base64url>",
    "qrMac": "<base64url>"
  },
  "createdAt": "2026-04-05T12:00:00Z",
  "expiresAt": "2026-04-05T12:30:00Z"
}
```

`DeviceInstance` is the preregistered known device record.

```json
{
  "instanceId": "dev_...",
  "publicIdentityKey": "<base64url>",
  "deploymentId": "reader.default",
  "metadata": {
    "name": "Front Desk Reader",
    "serialNumber": "SN-123",
    "modelNumber": "MX-10",
    "assetTag": "asset-42"
  },
  "state": "registered",
  "createdAt": "2026-04-05T11:00:00Z",
  "activatedAt": null,
  "revokedAt": null
}
```

Rules:

- `metadata` is optional operator-provided string metadata for CLI and console
  experiences
- Trellis understands `name`, `serialNumber`, and `modelNumber` for default
  admin display, but the map may also include deployment-specific opaque keys
- auth, activation, and connect-info decisions do not depend on this metadata
- device instances do not store authority; connect-info and runtime auth resolve
  the presented contract against the enabled device deployment envelope

`DeviceProvisioningSecret` is the auth-owned activation secret material keyed by
`instanceId`.

```json
{
  "instanceId": "dev_...",
  "activationKey": "<base64url>",
  "createdAt": "2026-04-05T11:00:00Z"
}
```

`DeviceActivationReview` tracks optional gated review.

```json
{
  "reviewId": "dar_01KS755ZXTHRWQEXM1VGAMM7BG",
  "flowId": "01KS755ZXTHRWQEXM1VGAMM7BF",
  "instanceId": "dev_...",
  "publicIdentityKey": "<base64url>",
  "deploymentId": "reader.default",
  "state": "pending",
  "requestedAt": "2026-04-05T12:03:00Z",
  "decidedAt": null,
  "reason": null
}
```

Device activation browser `flowId` values are ULIDs. Review ids use `dar_`
followed by a ULID.

`DeviceActivationRecord` is the final auth decision for that instance once
activation is granted. It also keeps the activating user identity when the
device was activated through a browser or review flow so `Auth.Sessions.Me` can
surface that user later.

```json
{
  "instanceId": "dev_...",
  "publicIdentityKey": "<base64url>",
  "deploymentId": "reader.default",
  "activatedBy": {
    "origin": "github",
    "id": "123"
  },
  "state": "activated",
  "activatedAt": "2026-04-05T12:08:00Z",
  "revokedAt": null
}
```

### 8) Outbound activation payload

The QR payload is the outbound setup payload from device to auth.

```json
{
  "v": 1,
  "publicIdentityKey": "<base64url>",
  "nonce": "<base64url>",
  "qrMac": "<base64url>"
}
```

Rules:

- Trellis derives `instanceId` from `publicIdentityKey`
- the payload does not need caller-provided type or instance identifiers
- the QR MAC prevents tampering between the device and the browser flow
- Trellis verifies `qrMac` using the stored `activationKey` before creating a
  short-lived `kind: "device_activation"` browser flow
- the returned browser flow id is the continuation handle for both portal UX and
  online device waiting; the QR payload remains a bearer setup artifact guarded
  by the MAC

### 9) Online wait and optional offline confirmation

Before a device is activated it cannot use normal authenticated RPCs, but an
online device may still wait for activation completion by calling the auth wait
endpoint with an identity-key proof.

Response model:

```ts
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
    reason?: string;
  };
```

Rules:

- online devices use the wait endpoint to learn that activation completed
- online wait requests include the `flowId` returned when the activation request
  was created; Trellis loads that browser flow directly and verifies it matches
  the signed device identity and nonce
- wait proof construction and verification are canonical only in
  [auth-protocol.md](./auth-protocol.md); this document intentionally does not
  duplicate the algorithm
- offline devices may receive a confirmation code from the portal flow out of
  band and verify it locally with `activationKey`
- when activation completes, Trellis derives the same confirmation code from the
  stored `activationKey` and may return or display it even for online flows
- local confirmation is separate from later online Trellis auth
- Deno's high-level `checkDeviceActivation(...)` helper treats both online wait
  completion and offline confirmation as internal transitions to later
  `activated` status; it does not attempt a runtime connection until the caller
  later invokes `TrellisDevice.connect(...)`

### 10) Connect info is server-provided

Activated devices need current runtime connect information from Trellis both:

- when a caller explicitly asks to connect after activation completes
- on later startups when activation is already complete and the device wants to
  reconnect directly

Recommended shared envelope:

```ts
type DeviceConnectInfo = {
  instanceId: string;
  deploymentId: string;
  contractId: string;
  contractDigest: string;
  transports: {
    native?: {
      natsServers: string[];
    };
    websocket?: {
      natsServers: string[];
    };
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
```

Rules:

- Trellis returns `natsServers` and sentinel credentials from deployment state
- connect info is served by `POST /auth/devices/connect-info` and the matching
  `Auth.Devices.ConnectInfo.Get` RPC wrapper, not by bootstrap-route state
  cached on the device
- devices should refresh connect info on startup rather than treating cached
  transport data as a permanent source of truth
- `auth.authority` distinguishes admin/review-approved setup authority from
  user-delegated authority added by activation
- reboot-safe storage should keep the root secret, not connect info, sentinel
  credentials, or hard-coded NATS topology; any Deno activation-state
  persistence stays internal to the Deno activation helper

### 11) Runtime auth presents a contract

Runtime auth happens after connect-info returns `ready`. Device runtime is gated
by registration, lifecycle state, and a presented contract boundary that fits
the enabled device deployment envelope. Activation is the user-delegated
authority path; admin review can grant setup authority, but neither path
replaces the runtime envelope check.

At connect time the device presents:

- identity-key proof
- exact `contractDigest`

Auth validates:

1. the known device instance by public identity key
2. lifecycle state allows runtime connection: either activation state is
   `activated`, or no activation exists and the instance is still `registered`
   under an admin/review-approved setup flow
3. the device deployment is present and enabled
4. the presented contract derives a required boundary that fits the device
   deployment envelope

This keeps validation explicit while separating envelope fit from implementation
offer liveness. Activation is not the runtime gate by itself: registration,
lifecycle state, and envelope fit remain mandatory. Admin/review-approved setup
sessions do not create or mutate activation records; activation remains the
separate step that adds user-delegated authority.

Lifecycle events are:

- `events.v1.Auth.DeviceUserAuthorities.Requested`
- `events.v1.Auth.DeviceUserAuthorities.ReviewRequested`
- `events.v1.Auth.DeviceUserAuthorities.Approved`
- `events.v1.Auth.DeviceUserAuthorities.Resolved`

## Client library boundary

Normal device, portal, and admin code SHOULD use Trellis client-library helpers
for the mechanical parts of device activation. Exact TypeScript declarations are
documented in the generated `/api` reference; exact Rust functions, structs, and
re-exports are documented in Rustdoc and generated SDK docs.

Rules:

- device-side helpers SHOULD derive the identity seed, public identity key, and
  activation key from the device root secret; applications persist only the
  device root secret directly
- activation helpers SHOULD build, encode, parse, and verify activation payloads
  and confirmation codes rather than forcing app code to reimplement byte
  layouts locally
- wait helpers own the polling loop for the auth wait endpoint and return once
  activation is ready
- if the wait endpoint returns `{ status: "rejected" }`, TypeScript wait helpers
  should throw rather than returning a rejected union branch to the caller; Rust
  helpers should surface the failure through their normal `Result` error path
- connect-info helpers own the identity-key proof/signature step and return the
  auth-owned ready/connect-info envelope
- portal and admin browser apps SHOULD prefer a typed device-activation client
  wrapper over manually spelling auth RPC method names and payload shapes
- authenticated portal-side activation starts the
  `Auth.DeviceUserAuthorities.Resolve` operation; review and completion are
  observed through operation progress and watch/wait semantics rather than a
  separate status-poll RPC
- the TypeScript device runtime connect helper is a pure runtime entrypoint; if
  Trellis says activation is still required it returns a transport error instead
  of starting activation on the caller's behalf
- the TypeScript device runtime connect helper accepts the root secret directly
  as bytes or a string form; storage, loading, generation, and rotation policy
  belong to the application
- the TypeScript device runtime connect helper accepts the same logger-or-false
  convention as service runtime helpers and should log distinct NATS lifecycle
  events for disconnect, reconnect attempts, reconnect success, stale
  connections, and connection errors
- device runtime helpers SHOULD fetch current connect info on startup rather
  than persisting stale connect info across restarts
- when the connected device contract uses the shared `Health.Heartbeat` event,
  the TypeScript runtime connect helper publishes baseline heartbeats
  automatically and exposes the same callback-based `health` helper surface used
  by services for enriching those heartbeats
- Deno device runtimes MAY use the high-level device-user authority helper after
  registration when they need user-delegated authority; runtime connectivity
  itself is still controlled by lifecycle checks and deployment-envelope fit
- callers do not manage or persist serialized local activation state directly
- Deno file-backed activation persistence stays internal to that
  activation-status helper, with storage-location overrides when the runtime
  needs to control the storage location
- online approval waiting and offline confirmation actions resolve
  user-delegated authority; they do not enable device-owned runtime access
- Rust activated-device code SHOULD use the Rust helpers for deterministic
  identity derivation, activation payload and URL construction, wait-request
  signing, activation wait, connect-info retrieval, runtime connection, and
  confirmation-code verification rather than hand-written HKDF, HMAC,
  wait-proof, connect-info, or connection logic
- Rust callers may use lower-level generated SDK surfaces for authenticated
  portal-side activation until a small typed convenience wrapper is available,
  but those calls still follow the `Auth.DeviceUserAuthorities.Resolve`
  operation model
- the Rust device runtime helper should follow the same service-style connect
  pattern as the TypeScript device runtime helper and remain a thin wrapper over
  the public auth HTTP and RPC surfaces

Implementation status:

- TypeScript currently provides the full activated-device connection path
  through `checkDeviceActivation(...)` and `TrellisDevice.connect(...)`
- Rust currently has deterministic identity, activation payload, wait signing,
  wait polling, confirmation-code helpers, connect-info retrieval, and an
  activated-device runtime connect facade through
  `TrellisClient::connect_device(...)`
- generated Rust device/state participant facades are still pending, so Rust
  demos may use lower-level session or offline flows until those facades exist

### Minimal activated device example

```ts
import { isErr, TrellisDevice } from "@qlever-llc/trellis";
import { checkDeviceActivation } from "@qlever-llc/trellis/device/deno";
import { defineDeviceContract } from "@qlever-llc/trellis";

export const device = defineDeviceContract(() => ({
  id: "acme.demo-device@v1",
  displayName: "Demo Device",
  description: "A small activated device used for local Trellis demos.",
}));

export default device;

const authority = await checkDeviceActivation({
  trellisUrl,
  contract: device,
  rootSecret,
});

if (authority.status === "not_ready") {
  throw new Error(`Device user authority is not ready: ${authority.reason}`);
}

if (authority.status !== "activated") {
  console.info(authority.activationUrl);
  await authority.waitForOnlineApproval();
}

const trellis = await TrellisDevice.connect({
  trellisUrl,
  contract: device,
  rootSecret,
}).orThrow();

const me = await trellis.rpc.auth.sessionsMe({});
if (isErr(me)) throw me.error;
```

Rules:

- a normal activated-device participant may own no RPCs, operations, events, or
  resources at all; a small `uses`-only contract is valid
- requesting `Auth.Sessions.Me` from a device runtime is valid because device
  contracts receive baseline auth access automatically
- device-local UI and review flow handling belong around
  `checkDeviceActivation(...)`, not inside `connect()`
- demos and applications should check activation status first and then connect
  with a separate `TrellisDevice.connect(...)` call

Those helpers SHOULD own:

- deriving the identity seed, public identity key, and activation key from the
  device root secret
- building and parsing the activation payload
- signing wait requests and polling until activation resolves
- deriving and verifying the short confirmation code when used
- fetching and refreshing `DeviceConnectInfo`
- wrapping the low-level HTTP and RPC surfaces into small typed convenience
  methods

Application code SHOULD still own:

- secure storage of the device root secret
- device-local UX such as serving or rendering the activation URL / QR
- reviewer automation and decision policy when `reviewMode` is enabled
- portal-side business logic and optional review policy

The wire protocol remains public and stable as an escape hatch, but it is not
the preferred normal integration surface.
