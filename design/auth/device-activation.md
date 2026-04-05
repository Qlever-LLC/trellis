---
title: Device Activation
description: Device activation flow for shipped hardware, including offline confirmation and first online auth.
order: 15
---

# Design: Device Activation

## Prerequisites

This design assumes familiarity with:

- [trellis-auth.md](./trellis-auth.md) - session keys, auth callout, and runtime authentication
- [../core/storage-patterns.md](./../core/storage-patterns.md) - storage and service-boundary patterns
- [../contracts/trellis-contracts-catalog.md](./../contracts/trellis-contracts-catalog.md) - contract and policy installation boundaries

## Context

Trellis needs a first-class activation flow for shipped devices that:

- have their own durable identity
- may be offline during setup
- can display a QR code outbound to a phone
- cannot reliably receive large payloads back; the cloud-to-device return path must be a short typed code
- may start with no logged-in user on the phone, so account creation or login must happen inside the activation journey without losing device context
- use normal Trellis runtime auth once they have network access; the typed confirmation code is not the runtime credential

The activation flow must therefore separate:

- device registration and offline confirmation
- deployment-specific ownership or linkage recorded by an activation application or service
- normal runtime authentication performed later with the device's runtime private key

This design defines the Trellis-facing APIs and auth behavior needed for device activation.
It intentionally anticipates `trellis` CLI support for admin and activation flows. An aftermarket console UI can be written later against the same API surface without changing this spec. A deployment may use:

- a Trellis-hosted web flow
- a custom activation service
- future `trellis` CLI admin commands
- a future console UI

as long as those callers use the same Trellis-facing APIs described here.

## Design

Device activation is a separate lifecycle from normal online authentication. The device carries its own durable identity, the browser or console flow handles human interaction and activation completion, and the runtime key continues to be the only online credential the device uses once it is connected.

### Device principal boundary

Each device is its own Trellis principal.

- the device authenticates later with its own runtime key, not as the user who activated it
- a deployment-specific activation application or service may record user/device linkage, ownership, or enrollment metadata, but auth does not own those fields
- auth only stores the device principal identity, assigned `profileId`, and activation state needed to allow later runtime authentication

### Device key derivation

Each manufactured device starts from a single root secret. That root secret is never the online credential itself; instead, Trellis and the device derive purpose-specific child secrets from it so the runtime key and the activation challenge key stay separate.

Each manufactured device receives one root secret:

- `deviceRootSecret`: 32 random bytes

The device derives two child secrets with HKDF-SHA256:

```text
runtimeSeed   = HKDF-SHA256(ikm=deviceRootSecret, salt="", info="trellis/device-runtime/v1", L=32)
activationKey = HKDF-SHA256(ikm=deviceRootSecret, salt="", info="trellis/device-activate/v1", L=32)
```

Behavior:

- `runtimeSeed` is used only for runtime authentication
- `activationKey` is used only for QR authentication and the short confirmation code
- the cloud side reads `activationKey` from the AUTH account's NATS KV-backed secret store; auth MUST NOT require broad plaintext access to all device root secrets

The runtime keypair is:

```text
runtimePrivateKey = Ed25519Seed(runtimeSeed)
runtimePublicKey  = Ed25519Public(runtimePrivateKey)
```

### Device profiles

The device does not need the full server-side profile while it is offline. Instead, the offline flow only needs enough information to mark the device as locally activated. Trellis keeps the actual `profileId` server-side and applies it when the device first authenticates online.

`profileId` is server-side only.

- auth stores `profileId` and uses it for later online policy
- the short offline confirmation flow does not carry the full profile to the device
- the device enters a generic `registered_offline` state after successful confirmation

Each device profile is a server-side classification that determines the device's runtime policy and activation behavior.

- `profileId` selects the policy and auth state that belong to that device class
- activation records keep the server-side `profileId`
- auth uses `profileId` to decide which device behavior is allowed once the device is online

Profiles are also the natural place to map device firmware to service contracts.

- a profile may allow more than one contract digest in the same contract lineage so firmware rollouts can happen gradually
- each individual device still authenticates with one exact installed contract digest once it is online
- old and new firmware digests may therefore coexist under one profile during rollout as long as they remain compatible within the same contract lineage
- any resources or bindings needed by that firmware remain per-digest install data, even when multiple digests in the same lineage are allowed by one profile

`DeviceProfile` is a first-class server-side record.

```json
{
  "profileId": "drive.default",
  "deviceType": "drive",
  "contractId": "acme.drive@v1",
  "allowedDigests": [
    "<digest-v1>",
    "<digest-v2>"
  ],
  "preferredDigest": "<digest-v2>",
  "activationMode": "auto",
  "runtimeClass": "device",
  "disabled": false
}
```

Behavior:

- `profileId` is the stable identifier used by activation and auth records
- `contractId` identifies the service-contract lineage for that device class
- `allowedDigests` defines which firmware/service revisions are permitted to connect under that profile
- `preferredDigest` is the rollout target for newly activated devices or upgraded devices when deployment policy wants the latest allowed digest
- profile records are deployment data, not contract-manifest fields
- `activationMode` controls whether activation is automatic or requires an external approval step for that deployment
- `runtimeClass` is an explicit deployment-owned classification rather than a free-form policy blob

### Outbound QR payload

The QR is the outbound handoff from device to phone. It contains the device identity and the activation nonce, plus a MAC that lets the cloud verify the payload came from a known shipped device.

When the device starts activation it generates:

- `nonce`: 10 random bytes

The device then displays a QR payload containing:

```json
{
  "v": 1,
  "deviceId": "dev_...",
  "deviceType": "drive",
  "runtimePublicKey": "<base64url>",
  "nonce": "<base64url>",
  "qrMac": "<base64url>"
}
```

`qrMac` is computed as:

```text
qrMac = base64url(
  Trunc64(HMAC-SHA256(
    activationKey,
    "trellis-device-qr/v1" || deviceId || deviceType || runtimePublicKey || nonce
  ))
)
```

Behavior:

- `runtimePublicKey` in the QR MUST match the public key derived from the same device root secret during manufacturing
- the caller handling activation start MUST verify `qrMac` before creating any activation attempt
- the QR payload is outbound only; no large payload is ever sent back through the touchscreen

### Activation start flow

The browser entrypoint starts the activation journey without assuming the phone is already logged in. If the user needs to create an account or sign in, Trellis preserves the activation attempt and resumes it afterward.

The default browser entrypoint is:

```text
GET /auth/device/activate?payload=<base64url-json>
```

Decoded request DTO:

```json
{
  "v": 1,
  "deviceId": "dev_...",
  "deviceType": "drive",
  "runtimePublicKey": "<base64url>",
  "nonce": "<base64url>",
  "qrMac": "<base64url>"
}
```

Deployments may implement equivalent behavior in another service or UI, but they MUST preserve the same request semantics and resulting `ActivationAttempt` record.

This design defines two Trellis-facing layers:

- a default browser HTTP surface for account creation, login, and approval UX
- an authenticated activation RPC surface that future CLI or console callers can reuse

Behavior:

1. Decode the payload
2. Verify `v`
3. Verify the device is a known shipped device
4. Derive `activationKey` and verify `qrMac`
5. Verify the shipped `runtimePublicKey` matches the QR payload
6. Create an `ActivationAttempt`
7. If the user is not authenticated, redirect into the existing auth flow while preserving `attemptId`
8. If the user is authenticated, redirect to the continue page

Response behavior:

- if the caller is not authenticated, the server responds with an HTTP redirect into the existing auth flow
- if the caller is authenticated, the server responds with an HTTP redirect to `/auth/device/continue?attempt=<attemptId>`
- if the payload is invalid, the server responds with an auth/device activation error page or JSON error equivalent

`ActivationAttempt`:

```json
{
  "attemptId": "act_...",
  "deviceId": "dev_...",
  "deviceType": "drive",
  "runtimePublicKey": "<base64url>",
  "nonce": "<base64url>",
  "state": "awaiting_user_auth",
  "createdAt": "2026-04-04T20:15:00Z",
  "expiresAt": "2026-04-04T20:45:00Z"
}
```

Behavior:

- `ActivationAttempt` expires after 30 minutes on the server side
- `ActivationAttempt` exists to survive account creation, login, or an already-logged-in browser session
- the device does not enforce the 30-minute limit locally because it may have no reliable offline clock

HTTP error reason codes for activation start:

| Scenario | Reason code | Context |
| --- | --- | --- |
| `payload` query missing | `missing_activation_payload` | |
| Payload cannot be decoded | `invalid_activation_payload` | |
| Unsupported payload version | `invalid_activation_version` | `{ v }` |
| Device id missing in payload | `missing_device_id` | |
| Device type missing in payload | `missing_device_type` | |
| Runtime public key missing in payload | `missing_runtime_public_key` | |
| Nonce missing in payload | `missing_nonce` | |
| QR MAC missing in payload | `missing_qr_mac` | |
| Runtime public key malformed | `invalid_runtime_public_key` | `{ runtimePublicKey }` |
| Nonce malformed | `invalid_nonce` | |
| QR MAC malformed | `invalid_qr_mac` | |
| Device not in shipped registry | `unknown_device` | `{ deviceId }` |
| QR MAC does not verify | `invalid_qr_mac` | `{ deviceId }` |
| Device/runtime key mismatch | `device_key_mismatch` | `{ deviceId, runtimePublicKey }` |
| Device already revoked | `device_revoked` | `{ deviceId }` |

### Browser completion flow

Once the user is authenticated, the browser returns to the activation attempt and exchanges the attempt id for the short confirmation code. That code is the only thing that needs to be typed back onto the device.

If the phone user is not yet authenticated, Trellis reuses the existing browser auth flow.

- `GET /auth/device/activate` stores the `attemptId`
- the browser then enters the normal user auth journey: account creation, login, or provider redirect
- Trellis sets `redirectTo=/auth/device/continue?attempt=<attemptId>`
- after successful browser auth, Trellis returns to the continue page with the same `attemptId`

The continue page or other activation UI then calls:

```text
POST /auth/device/activate
```

Request body:

```json
{
  "attemptId": "act_..."
}
```

Response DTO:

```json
{
  "confirmationCode": "7K2M9QXD"
}
```

The user identity is taken from the authenticated browser session, not from the request body.

HTTP error reason codes for browser completion:

| Scenario | Reason code | Context |
| --- | --- | --- |
| Caller has no authenticated browser session | `session_not_found` | |
| `attemptId` missing | `missing_attempt_id` | |
| Activation attempt missing | `activation_attempt_not_found` | `{ attemptId }` |
| Activation attempt expired | `activation_attempt_expired` | `{ attemptId }` |
| Device not in shipped registry | `unknown_device` | `{ deviceId }` |
| Device already revoked | `device_revoked` | `{ deviceId }` |
| Auth RPC rejected approval | propagated `AuthError.reason` | `{ deviceId }` |

### Activation caller behavior

The browser endpoint is only the default completion path. Deployments may replace it with another Trellis-hosted service, a custom activation service, or future CLI/console flows as long as they call the same activation RPC.

`POST /auth/device/activate` is the default Trellis-hosted browser activation API for finishing an existing activation attempt after the user has authenticated. The caller may also be a deployment-specific activation service or UI. Future CLI and console callers are expected to use the RPC activation API in the next section rather than this browser-only endpoint.

The caller MUST:

1. Require an authenticated user context
2. Load the `ActivationAttempt`
3. Reject expired or missing attempts
4. Verify the device is a known shipped device
5. Resolve `profileId` from `deviceType`
6. Optionally record any deployment-specific business linkage between the authenticated user and the device outside auth
7. Call the auth RPC that stores auth-relevant activation state
8. Return the short confirmation code to the browser

Known shipped devices may be auto-activated by policy, but the workflow still goes through this API boundary so different callers can replace each other later.

### Activation RPC

The reusable Trellis-facing activation API stores the auth-relevant state for the device and returns the short confirmation code to the completion flow.

The stable Trellis-facing activation API is:

```text
rpc.Auth.ActivateDevice
```

This RPC is intended for any authenticated caller that wants to activate a device, including:

- the default Trellis-hosted browser flow
- deployment-specific activation services
- future `trellis` CLI activation commands
- future console UI activation flows

The RPC caller is responsible for obtaining and validating the activation attempt or equivalent device activation context before calling auth.

Request:

```json
{
  "deviceId": "dev_...",
  "runtimePublicKey": "<base64url>",
  "profileId": "drive.basic.v1"
}
```

Required headers:

```text
session-key: <callerSessionKey>
proof: <base64url(ed25519 signature)>
```

Response:

```json
{
  "success": true
}
```

Auth requirements:

1. The caller MUST already be Trellis-authenticated using the normal `session-key` and `proof` headers
2. The caller MUST be authorized by its installed or approved contract to invoke `rpc.Auth.ActivateDevice`
3. Auth does not distinguish whether that caller is a browser, CLI, console, or deployment-specific service; those caller types all use the same RPC surface
4. If a deployment requires "human user only" approval, that rule is enforced by the caller before invoking auth, not by this RPC itself
5. Auth MUST reject activation when the `deviceId` and `runtimePublicKey` pair does not match the shipped-device registry entry visible to auth
6. Auth MUST reject approval when the device is already `revoked`
7. Auth MUST allow idempotent replay when the existing record already has the same `deviceId`, `runtimePublicKey`, and `profileId`
8. Auth MUST reject conflicting replay when the same `deviceId` is already approved for a different `runtimePublicKey` or a different `profileId`

Auth persists only auth-relevant state:

```json
{
  "deviceId": "dev_...",
  "runtimePublicKey": "<base64url>",
  "profileId": "drive.basic.v1",
  "state": "approved_pending_first_auth",
  "approvedAt": "2026-04-04T20:18:00Z"
}
```

Behavior:

- auth does not store `activatedBy`, `linkedUser`, or ownership metadata for this flow
- auth uses this record only to decide whether later runtime auth is allowed and which `profileId` to attach
- auth MUST require an authenticated caller for this RPC
- auth MAY emit the activation event directly from this RPC because the activation decision boundary lives here

Error response shape:

```json
{
  "error": {
    "code": "AuthError",
    "message": "device activation failed",
    "reason": "<reason-code>",
    "context": {}
  }
}
```

Activation RPC reason codes:

| Scenario | Reason code | Context |
| --- | --- | --- |
| Caller omitted `session-key` header | `missing_session_key` | |
| Caller omitted `proof` header | `missing_proof` | |
| Caller proof invalid | `invalid_signature` | `{ sessionKey }` |
| Caller not authenticated | `session_not_found` | `{ sessionKey }` |
| Caller contract lacks RPC permission | `insufficient_permissions` | `{ required: ["rpc.Auth.ActivateDevice"] }` |
| Device id missing from request | `missing_device_id` | |
| Runtime public key missing | `missing_runtime_public_key` | |
| Profile id missing | `missing_profile_id` | |
| Runtime public key malformed | `invalid_runtime_public_key` | `{ runtimePublicKey }` |
| Device not in shipped registry | `unknown_device` | `{ deviceId }` |
| Device/runtime key mismatch | `device_key_mismatch` | `{ deviceId, runtimePublicKey }` |
| Device activation record revoked | `device_revoked` | `{ deviceId }` |
| Device already approved with different profile | `device_profile_conflict` | `{ deviceId, existingProfileId, requestedProfileId }` |
| Device already approved with different runtime key | `device_identity_conflict` | `{ deviceId }` |

### Short confirmation code

The confirmation code is intentionally short because the device touchscreen is hard to use. It is not the runtime credential; it only tells the offline device that Trellis accepted this activation attempt.

After auth activation succeeds, the caller computes an 8-character Crockford Base32 confirmation code.

Computation:

```text
confirmTag = Trunc40(HMAC-SHA256(
  activationKey,
  "trellis-device-confirm/v1" || deviceId || nonce
))

confirmationCode = CrockfordBase32(confirmTag)
```

Behavior:

- the code length is exactly 8 characters
- the code alphabet is Crockford Base32 uppercase without separators
- the code does not include `profileId`; profile remains server-side only
- the code is not a runtime credential; it only confirms that the cloud approved this activation attempt for this physical device

`POST /auth/device/activate` returns:

```json
{
  "confirmationCode": "7K2M9QXD"
}
```

### Device local confirmation

The device verifies the typed code using the activation key derived from its own root secret. When the code matches, the device marks itself locally activated and can begin constrained offline behavior.

The user types the confirmation code into the device.

The device recomputes:

```text
expectedCode = CrockfordBase32(
  Trunc40(HMAC-SHA256(
    activationKey,
    "trellis-device-confirm/v1" || deviceId || nonce
  ))
)
```

If the entered code matches, the device transitions to:

```json
{
  "activationState": "registered_offline",
  "deviceId": "dev_...",
  "runtimePublicKey": "<base64url>",
  "nonce": "<base64url>"
}
```

Behavior:

- the device MUST rate-limit attempts
- after 5 failed entries the device MUST discard the nonce and require a new activation start
- the device stores only `registered_offline`; it does not know `profileId` yet

### Online authentication

Once the device has network access, it does not reuse the short confirmation code. It performs the same runtime-key proof flow as any other Trellis principal, and that first successful online auth is what completes activation on the server.

Online devices do not use the short code as an online credential.

Once a device has connectivity and wants to understand whether activation is complete, it uses normal Trellis runtime auth with `runtimePrivateKey`, exactly like a service principal.

The connect token shape is the existing `iat` flow:

```json
{
  "v": 1,
  "sessionKey": "<runtimePublicKey>",
  "iat": 1735689600,
  "sig": "<base64url-ed25519-signature>"
}
```

On first successful runtime auth:

1. Auth verifies the runtime signature as usual
2. Auth loads the device activation record by `runtimePublicKey`
3. If state is `approved_pending_first_auth`, auth allows the connection
4. Auth attaches `profileId` to the authenticated device principal
5. Auth transitions the record to `active_confirmed_online`
6. Auth emits an event

If no approved activation record exists, auth rejects the connect with `device_not_activated`.

If an activation record exists but is `revoked`, auth rejects the connect with `device_revoked`.

This means:

- offline devices use the typed code only to enter local offline mode
- online devices should simply attempt normal Trellis auth when they need to know whether activation is complete

### Events

Activation events are emitted from auth so other services can observe approval, first online confirmation, and revocation without carrying user-linkage metadata through auth itself.

Auth emits:

- `events.v1.Auth.DeviceActivationApproved`
- `events.v1.Auth.DeviceActivationOnlineConfirmed`
- `events.v1.Auth.DeviceActivationRevoked`

The deployment-specific caller may emit additional domain events for linkage or enrollment workflows, but those are outside auth.

Event payloads:

`events.v1.Auth.DeviceActivationApproved`

```json
{
  "deviceId": "dev_...",
  "runtimePublicKey": "<base64url>",
  "profileId": "drive.basic.v1",
  "approvedAt": "2026-04-04T20:18:00Z"
}
```

`events.v1.Auth.DeviceActivationOnlineConfirmed`

```json
{
  "deviceId": "dev_...",
  "runtimePublicKey": "<base64url>",
  "profileId": "drive.basic.v1",
  "confirmedAt": "2026-04-04T21:03:00Z",
  "userNkey": "UD3..."
}
```

`events.v1.Auth.DeviceActivationRevoked`

```json
{
  "deviceId": "dev_...",
  "runtimePublicKey": "<base64url>",
  "profileId": "drive.basic.v1",
  "revokedAt": "2026-04-05T09:00:00Z"
}
```

Behavior:

- event payloads do not include user-linkage or ownership fields
- `userNkey` on `DeviceActivationOnlineConfirmed` is the server-generated NATS connection identity for the first successful online auth that confirmed activation
- `DeviceActivationApproved` is emitted exactly when auth first creates or idempotently confirms the approval record
- `DeviceActivationOnlineConfirmed` is emitted only on the transition from `approved_pending_first_auth` to `active_confirmed_online`
- `DeviceActivationRevoked` is emitted when auth changes the activation record to `revoked`

### Device profile RPCs

Device profiles are deployment-owned configuration records. The supported admin surface is:

```text
rpc.Auth.CreateDeviceProfile
rpc.Auth.ListDeviceProfiles
rpc.Auth.GetDeviceProfile
rpc.Auth.DisableDeviceProfile
rpc.Auth.SetDeviceProfilePreferredDigest
rpc.Auth.AddDeviceProfileDigest
rpc.Auth.RemoveDeviceProfileDigest
```

These RPCs are intended for authenticated administrative callers such as `trellis` CLI commands and other callers using the same Trellis-facing API surface.

#### rpc.Auth.CreateDeviceProfile

Creates a new device profile. Once created, `profileId`, `deviceType`, and `contractId` are immutable.

Required headers:

```text
session-key: <callerSessionKey>
proof: <base64url(ed25519 signature)>
```

Request:

```json
{
  "profileId": "drive.default",
  "deviceType": "drive",
  "contractId": "acme.drive@v1",
  "allowedDigests": [
    "<digest-v1>",
    "<digest-v2>"
  ],
  "preferredDigest": "<digest-v2>",
  "activationMode": "auto",
  "runtimeClass": "device"
}
```

Response:

```json
{
  "profile": {
    "profileId": "drive.default",
    "deviceType": "drive",
    "contractId": "acme.drive@v1",
    "allowedDigests": ["<digest-v1>", "<digest-v2>"],
    "preferredDigest": "<digest-v2>",
    "activationMode": "auto",
    "runtimeClass": "device",
    "disabled": false
  }
}
```

Behavior:

- the caller MUST already be Trellis-authenticated
- the caller MUST be authorized by contract to invoke `rpc.Auth.CreateDeviceProfile`
- `profileId` MUST be unique within the deployment
- `contractId` MUST identify one existing contract lineage
- every digest in `allowedDigests` MUST belong to `contractId`
- `preferredDigest` MUST appear in `allowedDigests`
- create is idempotent only when the same full profile definition is replayed; conflicting replays MUST fail

Create reason codes:

| Scenario | Reason code | Context |
| --- | --- | --- |
| Caller omitted `session-key` header | `missing_session_key` | |
| Caller omitted `proof` header | `missing_proof` | |
| Caller proof invalid | `invalid_signature` | `{ sessionKey }` |
| Caller not authenticated | `session_not_found` | `{ sessionKey }` |
| Caller contract lacks RPC permission | `insufficient_permissions` | `{ required: ["rpc.Auth.CreateDeviceProfile"] }` |
| `profileId` missing | `missing_profile_id` | |
| `deviceType` missing | `missing_device_type` | |
| `contractId` missing | `missing_contract_id` | |
| `allowedDigests` missing or empty | `missing_allowed_digests` | |
| `preferredDigest` missing | `missing_preferred_digest` | |
| Profile already exists with different data | `device_profile_conflict` | `{ profileId }` |
| `contractId` unknown | `unknown_contract_id` | `{ contractId }` |
| One or more digests are not in the contract lineage | `device_profile_digest_mismatch` | `{ profileId, contractId }` |
| `preferredDigest` not in `allowedDigests` | `preferred_digest_not_allowed` | `{ profileId, preferredDigest }` |

#### rpc.Auth.ListDeviceProfiles

Lists device profiles.

Required headers:

```text
session-key: <callerSessionKey>
proof: <base64url(ed25519 signature)>
```

Request:

```json
{
  "deviceType": "drive",
  "contractId": "acme.drive@v1",
  "disabled": false
}
```

All request fields are optional exact-match filters.

Response:

```json
{
  "profiles": [
    {
      "profileId": "drive.default",
      "deviceType": "drive",
      "contractId": "acme.drive@v1",
      "allowedDigests": ["<digest-v1>", "<digest-v2>"],
      "preferredDigest": "<digest-v2>",
      "activationMode": "auto",
      "runtimeClass": "device",
      "disabled": false
    }
  ]
}
```

Behavior:

- the caller MUST already be Trellis-authenticated
- the caller MUST be authorized by contract to invoke `rpc.Auth.ListDeviceProfiles`

List profile reason codes:

| Scenario | Reason code | Context |
| --- | --- | --- |
| Caller omitted `session-key` header | `missing_session_key` | |
| Caller omitted `proof` header | `missing_proof` | |
| Caller proof invalid | `invalid_signature` | `{ sessionKey }` |
| Caller not authenticated | `session_not_found` | `{ sessionKey }` |
| Caller contract lacks RPC permission | `insufficient_permissions` | `{ required: ["rpc.Auth.ListDeviceProfiles"] }` |

#### rpc.Auth.GetDeviceProfile

Returns one device profile by `profileId`.

Required headers:

```text
session-key: <callerSessionKey>
proof: <base64url(ed25519 signature)>
```

Request:

```json
{
  "profileId": "drive.default"
}
```

Response:

```json
{
  "profile": {
    "profileId": "drive.default",
    "deviceType": "drive",
    "contractId": "acme.drive@v1",
    "allowedDigests": ["<digest-v1>", "<digest-v2>"],
    "preferredDigest": "<digest-v2>",
    "activationMode": "auto",
    "runtimeClass": "device",
    "disabled": false
  }
}
```

Behavior:

- the caller MUST already be Trellis-authenticated
- the caller MUST be authorized by contract to invoke `rpc.Auth.GetDeviceProfile`

Get profile reason codes:

| Scenario | Reason code | Context |
| --- | --- | --- |
| Caller omitted `session-key` header | `missing_session_key` | |
| Caller omitted `proof` header | `missing_proof` | |
| Caller proof invalid | `invalid_signature` | `{ sessionKey }` |
| Caller not authenticated | `session_not_found` | `{ sessionKey }` |
| Caller contract lacks RPC permission | `insufficient_permissions` | `{ required: ["rpc.Auth.GetDeviceProfile"] }` |
| `profileId` missing | `missing_profile_id` | |
| Profile not found | `device_profile_not_found` | `{ profileId }` |

#### rpc.Auth.DisableDeviceProfile

Disables a profile so it cannot be used for new activation or install.

Required headers:

```text
session-key: <callerSessionKey>
proof: <base64url(ed25519 signature)>
```

Request:

```json
{
  "profileId": "drive.default"
}
```

Response:

```json
{
  "success": true
}
```

Behavior:

- the caller MUST already be Trellis-authenticated
- the caller MUST be authorized by contract to invoke `rpc.Auth.DisableDeviceProfile`
- disable is idempotent
- disabled profiles MUST NOT be used for new device activation or new profile-driven install
- by default, devices authenticating online under a disabled profile MUST fail until reassigned or reactivated under a valid profile

Disable profile reason codes:

| Scenario | Reason code | Context |
| --- | --- | --- |
| Caller omitted `session-key` header | `missing_session_key` | |
| Caller omitted `proof` header | `missing_proof` | |
| Caller proof invalid | `invalid_signature` | `{ sessionKey }` |
| Caller not authenticated | `session_not_found` | `{ sessionKey }` |
| Caller contract lacks RPC permission | `insufficient_permissions` | `{ required: ["rpc.Auth.DisableDeviceProfile"] }` |
| `profileId` missing | `missing_profile_id` | |
| Profile not found | `device_profile_not_found` | `{ profileId }` |

#### rpc.Auth.SetDeviceProfilePreferredDigest

Sets the rollout target digest for a profile.

Required headers:

```text
session-key: <callerSessionKey>
proof: <base64url(ed25519 signature)>
```

Request:

```json
{
  "profileId": "drive.default",
  "preferredDigest": "<digest-v2>"
}
```

Response:

```json
{
  "profile": {
    "profileId": "drive.default",
    "preferredDigest": "<digest-v2>"
  }
}
```

Behavior:

- the caller MUST already be Trellis-authenticated
- the caller MUST be authorized by contract to invoke `rpc.Auth.SetDeviceProfilePreferredDigest`
- `preferredDigest` MUST already be present in `allowedDigests`

Preferred digest reason codes:

| Scenario | Reason code | Context |
| --- | --- | --- |
| Caller omitted `session-key` header | `missing_session_key` | |
| Caller omitted `proof` header | `missing_proof` | |
| Caller proof invalid | `invalid_signature` | `{ sessionKey }` |
| Caller not authenticated | `session_not_found` | `{ sessionKey }` |
| Caller contract lacks RPC permission | `insufficient_permissions` | `{ required: ["rpc.Auth.SetDeviceProfilePreferredDigest"] }` |
| `profileId` missing | `missing_profile_id` | |
| `preferredDigest` missing | `missing_preferred_digest` | |
| Profile not found | `device_profile_not_found` | `{ profileId }` |
| `preferredDigest` not in `allowedDigests` | `preferred_digest_not_allowed` | `{ profileId, preferredDigest }` |

#### rpc.Auth.AddDeviceProfileDigest

Adds one allowed digest to a profile.

Required headers:

```text
session-key: <callerSessionKey>
proof: <base64url(ed25519 signature)>
```

Request:

```json
{
  "profileId": "drive.default",
  "digest": "<digest-v2>"
}
```

Response:

```json
{
  "profile": {
    "profileId": "drive.default",
    "allowedDigests": ["<digest-v1>", "<digest-v2>"],
    "preferredDigest": "<digest-v2>"
  }
}
```

Behavior:

- the caller MUST already be Trellis-authenticated
- the caller MUST be authorized by contract to invoke `rpc.Auth.AddDeviceProfileDigest`
- the digest MUST belong to the profile's `contractId` lineage
- add is idempotent

Add digest reason codes:

| Scenario | Reason code | Context |
| --- | --- | --- |
| Caller omitted `session-key` header | `missing_session_key` | |
| Caller omitted `proof` header | `missing_proof` | |
| Caller proof invalid | `invalid_signature` | `{ sessionKey }` |
| Caller not authenticated | `session_not_found` | `{ sessionKey }` |
| Caller contract lacks RPC permission | `insufficient_permissions` | `{ required: ["rpc.Auth.AddDeviceProfileDigest"] }` |
| `profileId` missing | `missing_profile_id` | |
| `digest` missing | `missing_digest` | |
| Profile not found | `device_profile_not_found` | `{ profileId }` |
| Digest not in profile lineage | `device_profile_digest_mismatch` | `{ profileId, contractId, digest }` |

#### rpc.Auth.RemoveDeviceProfileDigest

Removes one allowed digest from a profile.

Required headers:

```text
session-key: <callerSessionKey>
proof: <base64url(ed25519 signature)>
```

Request:

```json
{
  "profileId": "drive.default",
  "digest": "<digest-v1>"
}
```

Response:

```json
{
  "profile": {
    "profileId": "drive.default",
    "allowedDigests": ["<digest-v2>"],
    "preferredDigest": "<digest-v2>"
  }
}
```

Behavior:

- the caller MUST already be Trellis-authenticated
- the caller MUST be authorized by contract to invoke `rpc.Auth.RemoveDeviceProfileDigest`
- the preferred digest MUST be changed before it can be removed
- remove is idempotent when the digest is already absent
- removing the final allowed digest MUST fail

Remove digest reason codes:

| Scenario | Reason code | Context |
| --- | --- | --- |
| Caller omitted `session-key` header | `missing_session_key` | |
| Caller omitted `proof` header | `missing_proof` | |
| Caller proof invalid | `invalid_signature` | `{ sessionKey }` |
| Caller not authenticated | `session_not_found` | `{ sessionKey }` |
| Caller contract lacks RPC permission | `insufficient_permissions` | `{ required: ["rpc.Auth.RemoveDeviceProfileDigest"] }` |
| `profileId` missing | `missing_profile_id` | |
| `digest` missing | `missing_digest` | |
| Profile not found | `device_profile_not_found` | `{ profileId }` |
| Attempt to remove preferred digest | `preferred_digest_removal_forbidden` | `{ profileId, digest }` |
| Attempt to remove final allowed digest | `final_allowed_digest_removal_forbidden` | `{ profileId }` |

### Device admin RPCs

The device lifecycle needs more than the initial activation exchange. Admin-facing callers can list active device activations or revoke them later, and future CLI or console tooling can reuse those RPCs directly.

Admin-oriented callers need lifecycle APIs beyond initial approval. Auth therefore also exposes:

```text
rpc.Auth.ListDeviceActivations
rpc.Auth.RevokeDeviceActivation
```

These RPCs are intended for authenticated administrative callers such as future `trellis` CLI commands, console UI flows, or deployment-specific admin services.

#### rpc.Auth.ListDeviceActivations

Lists auth-visible device activation records.

Required headers:

```text
session-key: <callerSessionKey>
proof: <base64url(ed25519 signature)>
```

Request:

```json
{
  "deviceId": "dev_...",
  "runtimePublicKey": "<base64url>",
  "state": "approved_pending_first_auth"
}
```

All request fields are optional exact-match filters.

Response:

```json
{
  "activations": [
    {
      "deviceId": "dev_...",
      "runtimePublicKey": "<base64url>",
      "profileId": "drive.basic.v1",
      "state": "approved_pending_first_auth",
      "approvedAt": "2026-04-04T20:18:00Z",
      "confirmedAt": null,
      "revokedAt": null
    }
  ]
}
```

Behavior:

- the caller MUST already be Trellis-authenticated
- the caller MUST be authorized by contract to invoke `rpc.Auth.ListDeviceActivations`
- auth returns only auth-visible activation records and does not include deployment-specific user linkage metadata

List reason codes:

| Scenario | Reason code | Context |
| --- | --- | --- |
| Caller omitted `session-key` header | `missing_session_key` | |
| Caller omitted `proof` header | `missing_proof` | |
| Caller proof invalid | `invalid_signature` | `{ sessionKey }` |
| Caller not authenticated | `session_not_found` | `{ sessionKey }` |
| Caller contract lacks RPC permission | `insufficient_permissions` | `{ required: ["rpc.Auth.ListDeviceActivations"] }` |
| Runtime public key malformed | `invalid_runtime_public_key` | `{ runtimePublicKey }` |
| Unknown filter state value | `invalid_activation_state` | `{ state }` |

#### rpc.Auth.RevokeDeviceActivation

Revokes a device activation record and prevents future online auth for that device until re-approved.

Required headers:

```text
session-key: <callerSessionKey>
proof: <base64url(ed25519 signature)>
```

Request:

```json
{
  "deviceId": "dev_..."
}
```

Response:

```json
{
  "success": true
}
```

Behavior:

- the caller MUST already be Trellis-authenticated
- the caller MUST be authorized by contract to invoke `rpc.Auth.RevokeDeviceActivation`
- auth MUST mark the device activation record `revoked`
- auth SHOULD kick active NATS connections for the matching `runtimePublicKey` so revocation takes effect immediately
- auth MUST emit `events.v1.Auth.DeviceActivationRevoked` on successful transition to `revoked`
- revoke is idempotent; revoking an already revoked device returns `{ success: true }`

Revoke reason codes:

| Scenario | Reason code | Context |
| --- | --- | --- |
| Caller omitted `session-key` header | `missing_session_key` | |
| Caller omitted `proof` header | `missing_proof` | |
| Caller proof invalid | `invalid_signature` | `{ sessionKey }` |
| Caller not authenticated | `session_not_found` | `{ sessionKey }` |
| Caller contract lacks RPC permission | `insufficient_permissions` | `{ required: ["rpc.Auth.RevokeDeviceActivation"] }` |
| Device id missing | `missing_device_id` | |
| Device activation record not found | `unknown_device` | `{ deviceId }` |

### State machines

The local device state, the server activation attempt, and the auth-side activation record each move through their own small state machine so the offline and online pieces stay independent.

Device local state:

- `new`
- `pending_activation`
- `registered_offline`
- `online_active`
- `revoked`

Activation attempt state:

- `awaiting_user_auth`
- `awaiting_approval`
- `approved`
- `expired`

Auth device activation state:

- `approved_pending_first_auth`
- `active_confirmed_online`
- `revoked`

### Security and operational notes

The short code is deliberately low-assurance compared with runtime auth. It is enough to unlock offline activation state, but it must never be treated as an online credential. The cloud-side manufacturing material must be tightly protected, and the server-side 30-minute attempt expiry is only enforced while the activation flow is still in the browser or service path.

The runtime key remains the real online credential, and the QR MAC prevents invented activation attempts for devices that were never shipped.
