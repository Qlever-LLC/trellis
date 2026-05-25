---
title: Files Transfer Patterns
description: Public contract-owned files APIs and operation-native transfer patterns over NATS.
order: 46
---

# Design: Files Transfer Patterns

## Prerequisites

- [trellis-patterns.md](./trellis-patterns.md) - Trellis architecture and
  communication model
- [store-resource-patterns.md](./store-resource-patterns.md) - service-owned
  blob-store resources
- [../contracts/trellis-contracts-catalog.md](./../contracts/trellis-contracts-catalog.md) -
  contract ownership and permission rules

## Context

Services often need to expose file-like behavior to apps and peer services
without exposing raw store bindings.

Examples:

- transfer an attachment into service-owned storage
- receive a generated export from a service-owned transfer endpoint
- inspect file metadata before deciding whether to fetch bytes
- delete a stored object through the owning service's business rules

`resources.store` solves service-owned blob persistence. It does not by itself
define a public API for callers.

`Files` is the public pattern that sits on top of service-owned `store`
resources.

## Scope

This document defines the public Trellis files pattern:

- which actions stay ordinary contract RPCs
- how byte transfer is modeled as one runtime concept with caller-facing
  directions
- how services back the public files surface with service-owned `store`
- how callers and providers receive per-chunk transfer progress

It does not define a global admin UI or cross-service shared raw store access.

## Design

### Ownership Model

Rules:

- the owning service keeps direct access to `service.store.<alias>`
- clients and peer services do not resolve raw store bindings
- public file behavior is exposed through the owning service's contract surface
- if another service needs file access, it uses the owning service's `Files.*`
  API rather than the raw store binding
- `Files` is the public interface to `store` in the same way that contract-owned
  operations are the public async workflow interface for service-private
  execution machinery

### Public Files API Split

There are three common categories of file behavior.

#### Metadata and control RPCs

File metadata and small control actions remain ordinary contract-owned JSON
RPCs.

Examples:

- `Documents.Files.List`
- `Documents.Files.Head`
- `Documents.Files.Delete`

Rules:

- these methods use normal Trellis RPC auth and capability checks
- they return JSON payloads and `Result`-modeled failures
- `list` is prefix plus standard page request oriented in v1 rather than an
  arbitrary metadata query language: callers send
  `{ offset?: number; limit:
  number }` plus file-domain filters such as
  `prefix`, and services return `{ entries, count, offset, limit, nextOffset? }`
- file listing is live offset pagination, not snapshot or cursor pagination;
  concurrent file writes or deletes can change what appears at later offsets

#### Send transfer operations

When the caller sends bytes to the service, file bytes use an operation-native
model:

1. a contract-owned operation accepts JSON input and declares
   `direction: "send"` transfer support
2. the caller configures the operation input and sends bytes through the
   higher-level `operation.<group>.<leaf>.input(input).transfer(body).start()`
   helper
3. callers do not start the same send-transfer operation first and attach bytes
   later
4. the provider awaits the runtime's durable transfer completion signal, such as
   TypeScript `transfer.completed()` or Rust
   `UploadTransferCompletion::completed()`, and continues with service-owned
   processing

Example:

- `Documents.Files.Upload`

Rules:

- send transfer is modeled as a capability of an operation; upload/file-ingest
  remains operation-native
- the operation contract declares the backing store alias and the input pointers
  used to derive transfer metadata such as `key` and `contentType`
- the actual byte movement still uses raw NATS chunk traffic rather than
  JSON/base64 RPC payloads
- the transfer protocol is Trellis-owned runtime machinery, not a
  service-specific public protocol surface
- callers observe transport progress through `watch()` transfer events or the
  higher-level fluent transfer builder callbacks, plus durable snapshot state
- providers observe the same transport progress through `transfer.updates()`

#### Receive transfer RPCs

When the caller receives bytes from the service, metadata and control remain a
contract-owned RPC and the RPC returns a receive transfer grant.

Example:

- `Documents.Files.Download`

Rules:

- the RPC declares `transfer: { direction: "receive" }`
- the RPC response contains a Trellis transfer grant, not raw store binding
  details
- callers consume the grant with `client.transfer(grant).stream()` for large
  bodies or `client.transfer(grant).bytes()` when buffering is appropriate
- service code decides whether and how the requested object maps to a
  service-owned store entry
- product-facing docs may still use words such as upload and download, but the
  platform API should prefer transfer, send, and receive language where possible

### Operation Transfer Declaration

Transfer-capable operations declare transfer support in the operation
descriptor.

Example:

```ts
operations: {
  "Documents.Files.Upload": {
    version: "v1",
    input: ref.schema("FilesUploadRequest"),
    progress: ref.schema("FilesUploadProgress"),
    output: ref.schema("FilesUploadResult"),
    transfer: {
      direction: "send",
      store: "uploads",
      key: "/key",
      contentType: "/contentType",
      expiresInMs: 60_000,
    },
    capabilities: {
      call: ["uploader"],
      observe: ["uploader"],
    },
  },
}
```

Rules:

- `transfer.store` names the owning service store resource alias used for
  staging
- `transfer.direction` is explicit; operation-native file ingest uses `"send"`
- `transfer.key` points into the validated operation input and resolves to the
  staged store key
- optional pointers such as `contentType` and `metadata` resolve from the same
  validated input payload
- contract validation should fail if the configured store alias does not exist
  or a configured input pointer does not exist in the input schema

RPCs that issue receive grants declare the receive direction explicitly:

```ts
rpc: {
  "Documents.Files.Download": {
    version: "v1",
    input: ref.schema("FilesDownloadRequest"),
    output: ref.schema("FilesDownloadResponse"),
    transfer: {
      direction: "receive",
    },
    capabilities: {
      call: ["reader"],
    },
  },
}
```

The response schema carries file metadata and the transfer grant. The service
still owns the raw store binding and any lookup, authorization, retention, or
audit policy behind the RPC.

### Runtime Helpers

#### TypeScript

Public runtime code uses:

```ts
const upload = await docs.operation("Documents.Files.Upload")
  .input({
    key: "incoming/report.pdf",
    contentType: "application/pdf",
  })
  .transfer(fileBytes)
  .onTransfer((event) => {
    console.log(event.transfer.transferredBytes);
  })
  .onProgress((event) => {
    console.log(event.progress.stage);
  })
  .start()
  .orThrow();

const completed = await upload.wait().orThrow();

const download = await docs.request("Documents.Files.Download", {
  key: "exports/report.pdf",
}).orThrow();
const stream = await client.transfer(download.transfer).stream().orThrow();
```

Rules:

- `@qlever-llc/trellis` exposes send transfer through
  `operation.<group>.<leaf>.input(...).transfer(...).start()`, not through
  `OperationRef.transfer(...)`
- `client.transfer(grant)` consumes service-issued transfer grants; receive
  grants expose `.stream()` and `.bytes()`, and send grants expose `.send(body)`
  where relevant
- the transfer builder accepts the same body forms as the old runtime helper:
  `Uint8Array`, `ArrayBuffer`, `ReadableStream<Uint8Array>`, and
  `AsyncIterable<Uint8Array>`
- metadata actions such as list/head/delete remain ordinary typed request calls
  on the contract client

#### Rust

Rust should mirror the same operation-native semantics:

```rust
let upload = documents.documents_files_upload().input(request).transfer(bytes).start().await?;
let completed = upload.wait().await?;
let terminal = completed.terminal;
```

Rules:

- Rust send-transfer execution should hang off typed operation refs; receive
  grants are downloaded through the root `TrellisClient::download_transfer(...)`
  helper after parsing the generated receive-transfer grant
- Rust should preserve the same chunk-progress semantics and Result-based
  failure model as TypeScript
- Rust service providers that expose send-transfer operations should await the
  provider-side upload completion primitive, such as
  `UploadTransferCompletion::completed()`, before treating bytes as durably
  available. The completion result is the Rust equivalent of TypeScript provider
  `transfer.completed()` and resolves only after the transfer endpoint has
  accepted EOF and written the object to the configured service-owned store, or
  with a transfer error if durable storage was not reached.

### Wire Behavior

Rules:

- byte transfer uses raw NATS messages, not JSON/base64 wrappers
- request signing still uses session-bound proof headers
- send transfer sends ordered chunk requests on a runtime-owned transfer subject
  and receives per-chunk acknowledgements
- receive transfer streams ordered chunks from a service-owned transfer endpoint
  to the caller; Rust callers use `download_transfer(...)` with the returned
  receive-transfer grant rather than resolving raw store bindings
- the runtime emits one transfer update per acknowledged chunk on both caller
  and provider sides
- chunk sequence and end-of-stream markers are runtime protocol details owned by
  Trellis

This mirrors the general style used by NATS object store: raw chunk payloads
plus separate metadata/control frames.

### Store Backing

Rules:

- canonical v1 file persistence lands in the owning service's `resources.store`
- services may use one or more store aliases as transfer staging backends
- services may later mirror or copy files to external systems, but `Files` does
  not depend on those backends
- `Files` does not imply shared raw store access across services
- receive grants expose bytes from a service-owned endpoint; they do not expose
  or delegate raw store bindings
- once transfer completes, service code works with the staged object through
  normal store APIs such as `get(...)`, `stream()`, `bytes()`, `waitFor(...)`,
  and `delete(...)`
- Trellis should make staged transferred objects easy for the owning service to
  access, but it does not impose post-transfer processing policy on the service
  author

### Transfer Plus Operations

For caller-visible file-processing workflows, the recommended pattern is:

1. a contract-owned operation declares transfer support
2. the caller starts the operation and begins watching it, either directly or
   through the fluent transfer builder
3. the caller sends bytes with `input(input).transfer(body).start()`
4. the provider awaits the runtime's durable transfer completion signal, such as
   TypeScript `transfer.completed()` or Rust
   `UploadTransferCompletion::completed()`, and updates business progress or
   enqueues follow-up work
5. the operation completes when the service-owned workflow completes

Rules:

- transfer success means `bytes stored`, not `workflow finished`
- a durable transfer completion signal means all chunks were accepted, EOF was
  received, and the configured service-owned store write completed; service code
  can then read the object through normal store APIs
- use runtime-owned transfer events or fluent transfer builder callbacks for
  progress bars and service-authored `progress(...)` calls for domain milestones
- use operations for caller-visible progress and final results
- use jobs for service-private execution, retries, and background processing
  after the bytes are stored

### Events

If the owning service exposes file lifecycle events, they should be
contract-owned `Files.*` events rather than raw store events.

Rules:

- public file events represent the service's contract view of file changes
- direct store writes performed by the service may still be normalized into
  public `Files.*` events
- the public abstraction stays `Files`, not backend-native store notifications

### Non-Goals

This document does not define:

- direct client resolution of `resources.store`
- HTTP send/receive transfer endpoints
- arbitrary query/filter semantics for file listing
- shared writable store bindings across services
- a global cross-service files admin query surface in v1
