---
title: Store Resource Patterns
description: Service-owned opaque blob-store resource shape, runtime semantics, and authorization boundaries.
order: 45
---

# Design: Store Resource Patterns

## Prerequisites

- [trellis-patterns.md](./trellis-patterns.md) - Trellis architecture and
  communication model
- [kv-resource-patterns.md](./kv-resource-patterns.md) - related service-owned
  resource patterns and naming guidance
- [../contracts/trellis-contracts-catalog.md](./../contracts/trellis-contracts-catalog.md) -
  canonical contract and binding model

## Context

Some services need a place to store large opaque values that do not fit well in
RPC payloads or typed KV entries.

Examples:

- temporary caller-sent files awaiting processing
- generated exports or reports before delivery
- intermediate binary artifacts produced between workflow steps
- service-local attachments that are not modeled as typed records

Today Trellis already has service-owned resources such as `kv` and first-class
`jobs`. `store` should follow the same ownership pattern while exposing a
blob-oriented runtime surface instead of a typed record API. Services do not
declare arbitrary stream resources in v1; subsystem streams are provisioned by
the owning runtime feature, such as jobs or operations.

## Scope

This document defines the `resources.store` resource shape, its service-owned
runtime semantics, and the TypeScript-facing API expectations.

Caller-visible file transfer is defined separately in
[files-transfer-patterns.md](./files-transfer-patterns.md).

## Design

### Definition

`resources.store` is a service-owned opaque blob store.

Rules:

- each store alias belongs to exactly one installed service contract
- only the owning service resolves the binding for a store alias
- the contract surface must not expose backend-native object-store terminology
  or management knobs
- values are opaque bytes plus small metadata, not typed JSON records
- services discover stores through normal resource bindings rather than through
  cloud-management credentials

`resources.store` is intended for service-local and service-owned binary data.
It is not a shared public data plane and it does not change the ownership rules
used by `kv`.

### Contract Shape

Example:

```ts
resources: {
  store: {
    uploads: {
      purpose: "Temporary uploaded files awaiting processing",
      required: true,
      ttlMs: 86_400_000,
      maxTotalBytes: 10 * 1024 * 1024 * 1024,
    },
  },
}
```

Rules:

- store aliases are logical names chosen by the service author
- aliases are stable API surface for the service runtime
- a store request declares:
  - `purpose`: required human-facing explanation of why the service needs the
    store
  - `required`: whether activation depends on successful provisioning; default
    `true`
  - `ttlMs`: optional desired retention in milliseconds; `0` or omitted means no
    automatic expiry requested
  - `maxTotalBytes`: optional desired total-store size limit in bytes; omit it
    when the store should not request a finite total-size limit
- contracts request logical stores; Trellis chooses the concrete physical store
  identity at service apply/install or upgrade time
- Trellis validates store declarations from the exact applied contract digest,
  but physical store identity is scoped to the deployment/profile and contract
  lineage rather than the digest so compatible service updates preserve objects
- required stores fail install or upgrade when Trellis cannot provision or bind
  them
- optional stores (`required: false`) may be omitted from bindings if
  provisioning fails or object-store support is unavailable
- when `maxTotalBytes` is omitted, Trellis reconciles the backing NATS object
  store to the unlimited `max_bytes` sentinel instead of preserving a stale
  finite limit from an older contract digest

### Binding Shape

Service bindings should expose effective installed limits rather than only
requested values.

Example binding payload:

```ts
type StoreResourceBinding = {
  name: string;
  ttlMs: number;
  maxTotalBytes?: number;
  maxObjectBytes?: number;
};
```

Rules:

- `name` is an opaque physical identifier chosen by Trellis
- bindings stay keyed by logical alias so service code remains stable across
  environments
- only successfully provisioned or bound store aliases appear in
  `bindings.store`
- bindings expose only the information the service runtime needs to use the
  resource safely
- bindings include `maxTotalBytes` only when the contract requested a finite
  total-store limit
- bindings include `maxObjectBytes` only when the contract requested a finite
  per-object limit that the runtime write path enforces
- bindings must not expose operator or platform management credentials

### Runtime API Expectations

The store runtime surface should mirror the KV runtime style as closely as store
semantics allow.

TypeScript expectations:

```ts
class StoreHandle {
  open(): AsyncResult<TypedStore, StoreError>;
  waitFor(
    key: string,
    opts?: StoreWaitOptions,
  ): AsyncResult<TypedStoreEntry, StoreError>;
}

class TypedStore {
  create(
    key: string,
    body: Uint8Array | ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>,
    opts?: { contentType?: string; metadata?: Record<string, string> },
  ): AsyncResult<void, StoreError>;

  put(
    key: string,
    body: Uint8Array | ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>,
    opts?: { contentType?: string; metadata?: Record<string, string> },
  ): AsyncResult<void, StoreError>;

  get(key: string): AsyncResult<TypedStoreEntry, StoreError>;
  waitFor(
    key: string,
    opts?: StoreWaitOptions,
  ): AsyncResult<TypedStoreEntry, StoreError>;
  delete(key: string): AsyncResult<void, StoreError>;
  list(prefix?: string): AsyncResult<AsyncIterable<StoreInfo>, StoreError>;
  status(): AsyncResult<StoreStatus, StoreError>;
}

type StoreWaitOptions = {
  timeoutMs?: number;
  pollIntervalMs?: number;
  signal?: AbortSignal;
};

class TypedStoreEntry {
  readonly key: string;
  readonly info: StoreInfo;

  stream(): AsyncResult<
    ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>,
    StoreError
  >;
  bytes(): AsyncResult<Uint8Array, StoreError>;
}
```

Rules:

- all failable public store APIs return `Result`, matching the broader Trellis
  TypeScript style
- `StoreHandle.open()` mirrors `KVHandle.open(...)` by resolving a higher-level
  typed runtime object from a binding
- `StoreHandle.waitFor(...)` is a convenience helper for the common
  service-runtime pattern of waiting for a staged object without manually
  opening the store and polling `get(...)`
- `create(...)` follows KV `create(...)` semantics and fails if the key already
  exists
- `put(...)` follows KV `put(...)` semantics and overwrites the current object
  for that key
- `get(...)` returns an entry object rather than only raw bytes so metadata is
  available without a second lookup
- `waitFor(...)` polls `get(...)` until the object appears, then returns the
  same `TypedStoreEntry` shape a direct `get(...)` would have returned
- `waitFor(...)` remains a store primitive rather than a policy helper: it does
  not read, stream, move, or delete bytes on the caller's behalf
- `list(prefix?)` is prefix-based in v1 and does not define pagination or watch
  semantics yet
- `stream()` is the primary body-access path for large values; `bytes()` is a
  convenience helper

### Object Metadata Model

Stores hold opaque bytes plus small metadata.

Example info shape:

```ts
type StoreInfo = {
  key: string;
  size: number;
  updatedAt: string;
  digest?: string;
  contentType?: string;
  metadata: Record<string, string>;
};
```

Rules:

- metadata is limited to string pairs in v1
- metadata should stay small and descriptive rather than becoming a secondary
  document database
- info surfaces should expose Trellis-level semantics such as `key`, `size`, and
  `updatedAt` rather than backend-specific chunk or object identifiers

### Key and Retention Rules

Rules:

- store keys are logical object keys within one store alias
- keys may be path-like and may include `/`
- keys are exact-match identifiers; prefix matching is only for `list(...)`
- `ttlMs` is optional in the contract, but installed bindings always expose the
  effective retention value
- deployments may clamp requested limits according to platform policy as long as
  the resulting binding reflects the effective installed limits

### Authorization

Stores follow the same service-owned authorization model as other resource
bindings.

Rules:

- installed store bindings may derive additional runtime permissions needed to
  use the backing implementation
- those permissions are scoped to the installed physical store binding, not to
  general cloud-management APIs
- store-derived permissions remain service-local to the owning installed
  contract binding
- a backing implementation may require both publish and subscribe permissions;
  the contract surface still remains backend-agnostic

### Non-Goals

This document does not define:

- direct client access to store bindings
- caller-visible send or receive transfer session protocols
- multi-owner or shared write access across services
- backend-specific features such as links, sealing, or chunk-size tuning
- a typed JSON value model; use `resources.kv` for that

### Relationship To Files Transfer

Trellis file transfer uses `store` as the canonical v1 backing storage.

That does not change the rules in this document:

- `resources.store` remains service-owned
- non-owner clients do not resolve store bindings
- file transfer authorization still begins with explicit contract-owned
  `Files.*` APIs from the owning service, such as send-transfer operations and
  receive-transfer RPCs
- the public abstraction is `Files`; `store` remains the service-owned backing
  capability
- receive transfer grants must not be treated as raw store delegation; they are
  scoped runtime grants for bytes exposed by the owning service
