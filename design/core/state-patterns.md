# State Patterns

`State` is the Trellis-managed API for semi-durable app state that should be available across app instances, CLIs, and devices through authenticated RPCs.

## Purpose

- provide cloud-backed app memory similar to localStorage or IndexedDB
- preserve state across app upgrades and across instances of the same app contract
- keep raw KV resources service-owned while exposing a public Trellis-managed API to apps and devices

`State` is not a replacement for service-owned `resources.kv`. Services that need internal KV projections or private state should continue to use `resources.kv` directly.

## Ownership And Boundary

- `State` is a Trellis-owned contract surface
- v1 is implemented by the `trellis` service
- v1 is backed internally by a Trellis-owned NATS KV bucket
- callers only interact with authenticated RPCs like `State.Get` or `State.Put`

This mirrors the existing `Files` boundary: the public API is contract-owned and the storage backing remains an implementation detail.

## Scopes

v1 supports two scopes:

- `userApp`: state for one authenticated user within one app contract namespace
- `deviceApp`: state for one authenticated device within one app contract namespace

`State` does not support cross-app shared namespaces in v1.

## Namespace Ownership

- persistence namespaces are keyed by `contractId`
- authorization is still derived from the authenticated approved artifact for the current session
- app upgrades must not lose state only because the contract digest changed

The persistence namespace should therefore be stable across versions of the same app contract while access still depends on an authenticated session that belongs to that app lineage.

## Public Data Model

- keys are opaque strings to Trellis
- values are JSON on the wire
- every stored entry returns a revision token
- callers may attach an optional TTL per entry

Public entry shape:

- `key`
- `value`
- `revision`
- `updatedAt`
- `expiresAt?`

## RPC Surface

Normal callers:

- `State.Get`
- `State.Put`
- `State.Delete`
- `State.CompareAndSet`
- `State.List`

Admin callers:

- `State.Admin.Get`
- `State.Admin.List`
- `State.Admin.Delete`

Normal callers do not provide `contractId`, `trellisId`, or device identity explicitly. The handler derives those from the authenticated session.

## Semantics

- `State.Get`: returns `found: false` for a missing or expired key
- `State.Put`: unconditional create or overwrite
- `State.Delete`: unconditional when `expectedRevision` is omitted; conditional when it is present
- `State.CompareAndSet`: write only if the current revision matches `expectedRevision`
- `expectedRevision: null` in `State.CompareAndSet` means create only if absent
- `State.List`: lexicographic by key and paginated with `offset` and `limit`

`State.List` returns full values in v1. `State` is meant for relatively small values, not large blobs.

## TTL

NATS KV TTL is bucket-level, not per-entry. v1 therefore implements TTL as application-managed expiry metadata:

- each entry may include `expiresAt`
- expired entries are treated as absent by `Get`, `List`, `Delete`, and `CompareAndSet`
- handlers may opportunistically delete expired entries when encountered

This keeps the public API simple while still allowing cache-like behavior for callers that want it.

## Limits

v1 enforces request-level limits such as:

- maximum key size
- maximum value size
- maximum list page size

Strict total per-namespace quota enforcement is out of scope for v1.

## Admin Model

- admins may inspect any `userApp` or `deviceApp` namespace
- admins may delete individual keys from any namespace
- admin APIs should target human-meaningful identities like `{ origin, id }` for users rather than raw internal Trellis ids

## Non-Goals

- cross-app shared namespaces
- watch or realtime subscriptions
- delete-all or delete-prefix APIs
- service use of `State` instead of `resources.kv`
- binary/blob transport semantics
- patch or merge helpers in the contract surface
- strict total namespace quotas in v1
