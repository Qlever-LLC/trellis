---
title: Files Transfer Patterns
description: Public contract-owned files API and transfer-grant-based binary upload/download patterns over NATS.
order: 46
---

# Design: Files Transfer Patterns

## Prerequisites

- [trellis-patterns.md](./trellis-patterns.md) - Trellis architecture and communication model
- [store-resource-patterns.md](./store-resource-patterns.md) - service-owned blob-store resources
- [../contracts/trellis-contracts-catalog.md](./../contracts/trellis-contracts-catalog.md) - contract ownership and permission rules

## Context

Services often need to expose file-like behavior to apps and peer services without exposing raw store bindings.

Examples:

- upload an attachment into service-owned storage
- download a generated export
- inspect file metadata before deciding whether to fetch bytes
- delete a stored object through the owning service's business rules

`resources.store` solves service-owned blob persistence. It does not by itself define a public API for callers.

`Files` is the public pattern that sits on top of service-owned `store` resources.

## Scope

This document defines the public Trellis files pattern:

- which actions stay ordinary contract RPCs
- which actions use transfer grants plus raw NATS chunk transport
- how `@qlever-llc/trellis` and `trellis-client` expose the transfer helper
- how services back the public files surface with service-owned `store`

It does not define a global admin UI or cross-service shared raw store access.

## Design

### Ownership Model

Rules:

- the owning service keeps direct access to `service.store.<alias>`
- clients and peer services do not resolve raw store bindings
- public file behavior is exposed through the owning service's contract surface
- if another service needs file access, it uses the owning service's `Files.*` API rather than the raw store binding
- `Files` is the public interface to `store` in the same way that contract-owned operations are the public async workflow interface for service-private execution machinery

### Public Files API Split

There are two categories of file behavior.

#### Metadata and control RPCs

File metadata and small control actions remain ordinary contract-owned JSON RPCs.

Examples:

- `Documents.Files.List`
- `Documents.Files.Head`
- `Documents.Files.Delete`

Rules:

- these methods use normal Trellis RPC auth and capability checks
- they return JSON payloads and `Result`-modeled failures
- they do not require a second transfer-grant step
- `list` is prefix/cursor/limit-oriented in v1 rather than arbitrary metadata query language

#### Binary upload and download

File bytes use a two-step model:

1. a contract-owned RPC initiates the transfer and returns a transfer grant
2. the client executes the raw byte transfer through the Trellis runtime helper

Examples:

- `Documents.Files.InitiateUpload`
- `Documents.Files.InitiateDownload`

Rules:

- upload/download initiation stays contract-owned and permissioned by the service
- the returned grant is plain data, not a behavior-owning object
- the actual byte transfer uses raw NATS chunk traffic rather than JSON/base64 RPC payloads
- the transfer protocol is Trellis-owned runtime machinery, not a service-specific public protocol surface

### Transfer Grants

Transfer grants are capability objects returned by service-owned initiation RPCs.

Rules:

- the canonical shared name is `TransferGrant`
- v1 uses concrete single-action grant variants:
  - `UploadTransferGrant`
  - `DownloadTransferGrant`
- grants carry enough information to execute one transfer session safely:
  - service name
  - session key
  - transfer id
  - transfer subject
  - expiry
  - chunk size
  - upload constraints or download file info as appropriate
- grants are session-bound and must not be accepted from a different authenticated session
- grants are plain serialized data returned by contract APIs; behavior is attached later by runtime helpers

### Runtime Helpers

#### TypeScript

Public runtime code uses:

```ts
const started = await docs.request("Documents.Files.InitiateUpload", {
  key: "incoming/report.pdf",
});

if (started.isErr()) {
  return started;
}

const uploaded = await trellis.transfer(started.value).put(bytes);
```

Rules:

- `@qlever-llc/trellis` exposes `trellis.transfer(grant)`
- `trellis.transfer(grant)` binds behavior to a transfer grant and returns a typed upload or download handle
- upload handles expose `put(...)`
- download handles expose `getBytes()`
- metadata actions such as list/head/delete remain ordinary typed request calls on the contract client

#### Rust

Rust mirrors the same semantics with Rust-native typing:

```rust
let grant = documents.files_initiate_upload(request).await?;
let uploaded = client.transfer(grant).put(bytes).await?;
```

Rules:

- `trellis-client` exposes `client.transfer(grant)`
- concrete grant types bind to concrete transfer handles
- upload/download helpers return normal Rust `Result`
- Rust may use `Stream`-style progress helpers later, but the core semantics match the TypeScript runtime

### Wire Behavior

Rules:

- byte transfer uses raw NATS messages, not JSON/base64 wrappers
- request signing still uses session-bound proof headers
- upload sends ordered chunk requests on a transfer subject and receives per-chunk acknowledgements
- download requests bytes once and receives ordered raw chunk messages on a reply inbox
- chunk sequence and end-of-stream markers are runtime protocol details owned by Trellis

This mirrors the general style used by NATS object store: raw chunk payloads plus separate metadata/control frames.

### Store Backing

Rules:

- canonical v1 file persistence lands in the owning service's `resources.store`
- `service.transfer` may use one or more store aliases as its backing storage
- services may later mirror or copy files to external systems, but `Files` does not depend on those backends
- `Files` does not imply shared raw store access across services

### Events

If the owning service exposes file lifecycle events, they should be contract-owned `Files.*` events rather than raw store events.

Rules:

- public file events represent the service's contract view of file changes
- direct store writes performed by the service may still be normalized into public `Files.*` events
- the public abstraction stays `Files`, not backend-native store notifications

### Non-Goals

This document does not define:

- direct client resolution of `resources.store`
- HTTP upload/download endpoints
- arbitrary query/filter semantics for file listing
- shared writable store bindings across services
- a global cross-service files admin query surface in v1
