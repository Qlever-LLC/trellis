---
title: Trellis Rust Contract Libraries
description: Rust contract and participant-facade architecture for generated SDKs and alias-based runtime access.
order: 30
---

# Design: Trellis Rust Contract Libraries

## Prerequisites

- [../core/trellis-patterns.md](./../core/trellis-patterns.md) - participant boundaries across services, apps, and tools
- [trellis-contracts-catalog.md](./trellis-contracts-catalog.md) - canonical manifest and `uses` semantics
- [../tooling/trellis-cli.md](./../tooling/trellis-cli.md) - source-first CLI and SDK generation boundary
- [trellis-typescript-contract-authoring.md](./trellis-typescript-contract-authoring.md) - same contract-first goal expressed for TypeScript

## Context

The current Rust library direction is still transport-first rather than contract-first.

Today:

- `trellis-contracts` owns canonical manifest loading, validation, and digest logic
- `trellis-client` exposes generic request and publish helpers over descriptor traits
- `trellis-server` exposes a minimal router and event publisher
- generated Rust SDK crates expose owned contract constants, types, descriptors, and thin client/server helpers for a single manifest

That is not yet enough to express the contract ergonomics we want.

The gaps are:

- local Rust participants do not get a runtime surface derived from their own contract `uses`
- generated Rust SDK crates describe what a remote contract owns, but not what a local app or service is allowed to use
- current client helpers still include hard-coded Trellis core operations instead of relying purely on generated contract SDKs
- current descriptor traits are too weak for full contract semantics such as templated event subjects and raw subject spaces
- the current Rust shape does not provide an idiomatic equivalent of a local participant contract that defines both owned and used surfaces

Rust should solve the same architectural problem as TypeScript, but with Rust-native ergonomics.

Rust should not mimic the flat string-keyed TypeScript `trellis` object exactly. The idiomatic Rust surface should instead prefer generated modules, types, and alias-based facades.

## Design

Trellis adopts a contract-driven Rust library model.

Every Rust participant that connects to Trellis uses a local participant contract as
its primary Trellis surface. That participant contract is derived from the canonical
manifest plus explicit dependency mappings to generated Rust SDK crates.

The desired Rust user experience is:

- remote contract SDK crates describe what each contract owns
- a local generated participant facade describes what the current app or service owns and what it is allowed to use
- runtime connection helpers are driven by that participant facade rather than by manual descriptor juggling
- alias-based access such as `participant.core()` or `participant.auth()` is preferred over a flat merged method namespace

As in the TypeScript design, the local participant contract remains meaningful beyond
initial connection. It is the primary source for emitted manifest identity, owned
surface, allowed used surface, and contract-shaped runtime access.

### 1) Manifest remains canonical

This document does not change the architectural contract boundary.

Rules:

- the generated `trellis.contract.v1` manifest remains the canonical runtime and tooling artifact
- required manifest metadata is the same as in the TypeScript contract design: `id`, `displayName`, `description`, and `kind` are required top-level fields in the emitted canonical manifest
- generated Rust SDK crates and participant facades derive from manifests
- native Rust authoring helpers or macros MAY exist later, but they are implementation details around deterministic manifest emission

### 2) Primary Rust usage model

The primary Rust model is not a generic transport client plus hand-managed descriptor types.

The primary Rust model is:

- generated contract SDK crates for remote contracts
- generated local participant facades for apps, services, CLIs, and other Rust Trellis participants

Normal application and service code should primarily use the generated local participant facade.

### 3) Crate responsibilities

Rust crate boundaries are:

- `trellis-contracts` - canonical manifest, catalog, digest, and contract metadata model
- `trellis-client` - low-level outbound runtime primitives and typed descriptor traits used by generated code
- `trellis-server` - low-level inbound runtime primitives and typed descriptor traits used by generated code
- generated SDK crates - one crate per contract manifest, describing owned RPCs, events, subjects, types, and metadata for that contract
- generated participant facade crates or modules - local contract-aligned runtime surface for a specific participant

Rules:

- `trellis-contracts` remains the architectural contract crate, not the transport runtime crate
- `trellis-client` and `trellis-server` are stable generator targets, not the primary user authoring surface
- generated participant facades are the supported ergonomic entrypoint for normal Rust participant code

## Specification

### Public crate surfaces

The public Rust contract/runtime surface is split across:

- `trellis-contracts` for manifest, digest, and shared metadata types
- `trellis-client` for authenticated outbound runtime primitives
- `trellis-server` for authenticated inbound runtime primitives
- generated SDK crates for one contract's owned surface
- generated local participant facades for one participant's owned and used surface

The full normative Rust surface is defined in:

- [contracts-rust-api.md](./contracts-rust-api.md)

### Generated contract SDK crate shape

A generated Rust SDK crate for one manifest is the Rust equivalent of a remote contract module.

Rules:

- a generated SDK crate describes only the owned surface of that contract
- it does not represent local `uses` filtering for another participant
- it is valid as a dependency vocabulary for participant-facade generation

### Shared contract module trait

Generated contract SDK crates and local participant facades must share enough metadata shape that code generation and runtime helpers can treat them consistently.

Rules:

- every generated SDK crate implements this shared contract metadata shape
- every generated local participant facade also exposes a contract-module-compatible owned view
- when a local participant is used as a dependency of another local participant, only its owned contract surface participates in dependency selection

This matches the TypeScript rule that a local participant may be used as a dependency
vocabulary, but only through its owned surface rather than through its locally allowed
used dependencies.

### Local participant facade shape

A local participant facade is the Rust equivalent of the local contract-derived runtime surface.

It is generated from:

- the local participant manifest
- explicit mappings from local `uses` aliases to Rust SDK crates

The explicit mapping is required because manifest contract ids do not determine Cargo crate names.

The preferred generation target is a small checked-in participant crate shim plus build-time generated facade modules. In practice that means the crate may keep stable handwritten entrypoints such as `build.rs`, `src/lib.rs`, `src/connect.rs`, and `src/contract.rs`, while owned/used facade modules are regenerated into `OUT_DIR` and included by the shim.

Rules:

- `OwnedContract` or equivalent exposes the participant's owned contract surface as reusable dependency vocabulary
- `owned()` exposes only the local participant's owned surface
- each `uses` alias becomes its own generated accessor and module namespace
- if a `uses` alias is absent from the local contract, no accessor for that alias exists
- if a remote operation is not selected under a `uses` alias, no generated method for that operation exists under that alias
- build-time generated crates should keep the local manifest as checked-in source and regenerate alias/owned modules deterministically from that source

### Alias-based access is the idiomatic Rust surface

Rust uses alias-based facades rather than a flat merged runtime namespace.

The full alias-based facade shape and examples live in:

- [contracts-rust-api.md](./contracts-rust-api.md)

Rules:

- Rust code should not rely on a flat string-keyed runtime method namespace as the primary ergonomic surface
- alias-based access reflects the local contract `uses` structure directly
- alias names from the manifest become generated Rust module and accessor names after normal Rust identifier normalization

### Compile-time contract filtering

The generated local participant facade is the compile-time enforcement layer for allowed contract usage.

Rules:

- if a `uses` alias is not declared, there is no corresponding facade accessor
- if a remote RPC, event, or subject is not selected in the local manifest `uses`, there is no generated Rust method for it
- if a dependency mapping points an alias to the wrong SDK crate, generation fails
- if the mapped SDK crate does not own the referenced operation, generation fails
- if a local participant is used as a dependency mapping target, generation uses its owned contract-module-compatible view rather than any used alias facades

This is the Rust equivalent of TypeScript contract-driven allowed API typing.

### Runtime primitives remain lower-level building blocks

`trellis-client` and `trellis-server` still expose generic lower-level primitives because generated code needs stable runtime targets.

Rules:

- those runtime primitives are primarily generator targets and advanced escape hatches
- normal Rust app and service code should not need to manually combine multiple SDK crates to reconstruct local contract permissions
- hard-coded standard contract convenience methods in runtime crates are not the desired long-term ergonomic model

### Outbound client behavior

The Rust outbound runtime must support at least:

- typed operation requests
- typed RPC requests
- typed event publishing
- typed event subscriptions
- typed raw subject publishing
- typed raw subject subscriptions

The generated participant facade uses those primitives to expose contract-filtered alias-based clients.

Rules:

- `participant::Client` is typed by the local participant contract
- used facades only expose operations declared in local `uses`
- owned facades may expose outbound helpers for owned events and raw subjects where appropriate

### Service-side behavior

The Rust service runtime must support at least:

- owned operation handler registration
- owned RPC handler registration
- owned event publish helpers
- owned raw subject helpers
- outbound calls to used aliases through the same participant contract facade

Rules:

- `participant::Service` exposes owned registration and publish helpers only for the local owned contract surface
- `participant::Service` also exposes alias-based outbound used facades for cross-contract calls
- service-side registration APIs must not expose used remote operations as mountable handlers

### Descriptor trait requirements

The runtime descriptor traits in `trellis-client` and `trellis-server` must be rich enough to represent the contract model.

Required descriptor categories:

- `OperationDescriptor`
- `RpcDescriptor`
- `EventDescriptor`
- `SubjectDescriptor`

Required descriptor semantics:

- operation descriptors expose logical key, invoke subject, derived control subject, input type, progress type if any, output type, declared capability requirements, and enough metadata to drive typed `operation(...).start`, `get`, `wait`, `watch`, and `cancel` helpers
- RPC descriptors expose logical key, concrete subject, request type, response type, declared caller capabilities, and declared known errors
- event descriptors expose logical key, event type, subject template metadata, wildcard subscribe subject metadata, and enough logic to derive a concrete publish subject from an event value when the subject is templated
- subject descriptors expose logical key, subject or subject pattern, message type if any, and capability metadata

This document does not lock the exact Rust trait signatures, but it does require the runtime traits to be expressive enough for all v1 contract concepts, including first-class operations.

### Event and raw subject semantics

Rust runtime helpers must model the difference between domain events and raw subjects.

Rules:

- event publishing may require rendering a concrete subject from an event payload and subject template
- event subscription uses the wildcard authorization-compatible subject form where required
- raw subject helpers may legitimately work with wildcard subject spaces and may require an explicit concrete subject argument at publish time depending on the descriptor shape

### Participant generation inputs

Local participant-facade generation requires more than just the local manifest.

Required inputs are:

- the local manifest
- explicit mapping from each `uses` alias to a Rust SDK crate or module path that owns the referenced remote contract

Rules:

- generation fails if an alias mapping is missing
- generation fails if the mapped SDK crate contract id does not match the manifest `uses.*.contract` id
- generation fails if the local manifest references remote operations that the mapped SDK crate does not own

### Connection helpers

Generated participant facades expose contract-driven connection helpers rather than requiring each application to wire transport details by hand.

Rules:

- those helpers wrap stable `trellis-client` and `trellis-server` runtime primitives
- they produce contract-shaped facades, not unfiltered transport clients
- they do not implicitly inject extra contract SDKs beyond those declared by the local participant
- first-party participant crates may layer extra handwritten helpers, such as admin-session renewal, on top of the generic generated connection helpers

### Manifest behavior

This document does not change the emitted manifest model.

Rules:

- generated Rust participant facades and SDK crates are derived from the existing `trellis.contract.v1` manifest format
- Rust authoring or generation layers MUST preserve the canonical manifest requirement that `displayName`, `description`, and `kind` are present and participate in the emitted digest
- local `uses` filtering remains represented in the canonical manifest as normal `uses` entries
- Rust-specific facade generation is an implementation of the existing contract architecture, not a new contract format

### Replacement direction

The desired end state is that normal Rust participant code does not primarily work through:

- hard-coded runtime helpers for Trellis-owned contracts
- manually imported multiple SDK clients stitched together by the application
- direct subject-string usage for contract-owned RPCs and events

Those lower-level forms may continue to exist as internals or advanced primitives, but they are not the intended primary ergonomic surface.

### Migration and rollout

Implementation should proceed in this order:

1. strengthen `trellis-client` and `trellis-server` so they are stable generator targets for RPCs, events, and subjects
2. enrich Rust SDK generation so each contract SDK crate exports the full owned-surface module shape
3. add participant-facade generation from local manifest plus alias-to-crate mappings
4. migrate first-party Rust code to participant-facade usage
5. remove or de-emphasize hard-coded runtime contract helpers from `trellis-client`

Rules:

- the new participant-facade model must be capable before older convenience surfaces are removed
- manifest and CLI workflows remain unchanged while library ergonomics evolve
- docs should prefer participant-facade usage once the model exists

## Benefits

- Rust gets the same contract-first architecture as TypeScript without forcing a non-idiomatic flat API shape
- local participant code sees only the operations it owns or has explicitly declared in `uses`
- generated SDK crates remain reusable distribution units for remote contracts
- apps, services, and CLIs share one participant model in Rust
- runtime crates become cleaner generator targets instead of accumulating special-case helpers

## Trade-Offs

- Rust needs an additional participant-facade generation layer beyond single-manifest SDK generation
- event and raw subject support require richer runtime trait design than the current placeholders
- Cargo crate naming cannot be inferred from manifest ids, so participant generation requires explicit dependency mapping
- direct use of low-level runtime crates or remote SDK crates can still bypass the preferred ergonomic path unless conventions and packaging keep users on the participant facade

## References

- `design/contracts/trellis-contracts-catalog.md`
- `design/contracts/trellis-typescript-contract-authoring.md`
- `docs/plans/2026-03-19-rust-cli-contracts-and-sdks.md`
