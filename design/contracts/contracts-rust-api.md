---
title: Contracts Rust API
description: Public Rust surface for generated contract SDK crates, participant facades, and contract-driven runtime helpers.
order: 50
---

# Design: Contracts Rust API

## Prerequisites

- [trellis-contracts-catalog.md](./trellis-contracts-catalog.md) - canonical manifest and permission model
- [trellis-rust-contract-libraries.md](./trellis-rust-contract-libraries.md) - Rust contract architecture and rationale
- [../core/type-system-patterns.md](./../core/type-system-patterns.md) - shared type-system and error guidance

## Scope

This document defines the normative Rust public API surface for generated contract SDK crates, local participant facades, and contract-driven runtime helpers.

It does not redefine the canonical manifest model or runtime permission derivation.

## Design Rules

- generated participant facades are the supported ergonomic entrypoint for normal Rust participant code
- Rust uses alias-based contract facades rather than a flat merged runtime namespace
- generated SDK crates and local participant facades share a compatible contract metadata shape
- runtime crates provide lower-level primitives, but they are generator targets rather than the primary ergonomic surface

## Public Crate Surfaces

### `trellis-contracts`

Owns:

- manifest and catalog structs
- canonicalization and digest helpers
- manifest loading and validation
- shared contract metadata traits and types used by generated Rust crates

Does not own NATS transport connection behavior.

### `trellis-client`

Owns:

- authenticated outbound Trellis session/client primitives
- generic operation, RPC, event, and raw subject client primitives
- transfer-grant execution helpers for file upload/download runtime behavior
- descriptor traits required by generated outbound code

Does not own participant-specific alias filtering.

### `trellis-server`

Owns:

- authenticated service-side runtime primitives
- handler registration for owned operations and RPCs
- owned event publish helpers
- owned raw subject helpers
- descriptor traits required by generated inbound code

Does not own manifest parsing or contract selection logic.

## Generated SDK Crate Shape

Each generated SDK crate must export:

- `CONTRACT_ID`
- `CONTRACT_DIGEST`
- `CONTRACT_JSON`
- `contract_manifest()` or equivalent manifest access
- owned request, response, event, and message types
- owned operation, RPC, event, and raw subject descriptor types
- thin client helper modules for the owned outbound surface
- thin server helper modules for the owned inbound surface

Illustrative shape:

```rust
pub mod contract;
pub mod types;
pub mod operations;
pub mod rpc;
pub mod events;
pub mod subjects;
pub mod client;
pub mod server;

pub use contract::{contract_manifest, CONTRACT_DIGEST, CONTRACT_ID, CONTRACT_JSON};
```

Rules:

- a generated SDK crate describes only the owned surface of that contract
- it does not represent local `uses` filtering for another participant
- it is valid as a dependency vocabulary for participant-facade generation

## Shared Contract Module Trait

```rust
pub trait ContractModule {
    const CONTRACT_ID: &'static str;
    const CONTRACT_DIGEST: &'static str;

    fn contract_manifest() -> trellis_contracts::ContractManifest;
}
```

Rules:

- every generated SDK crate implements this shared metadata shape
- every generated local participant facade also exposes a contract-module-compatible owned view
- when a local participant is used as a dependency of another local participant, only its owned contract surface participates in dependency selection

## Local Participant Facade Shape

Each local participant facade is generated from:

- the local participant manifest
- explicit mappings from local `uses` aliases to Rust SDK crates

Illustrative shape:

```rust
pub mod contract;
pub mod connect;

include!(concat!(env!("OUT_DIR"), "/generated/src/facade.rs"));

pub struct OwnedContract;
pub struct Client { /* ... */ }
pub struct Service { /* ... */ }

impl ContractModule for OwnedContract { /* ... */ }

impl Client {
    pub fn owned(&self) -> owned::Client<'_>;
    pub fn core(&self) -> uses::core::Client<'_>;
    pub fn auth(&self) -> uses::auth::Client<'_>;
}

impl Service {
    pub fn owned(&self) -> owned::Service<'_>;
    pub fn core(&self) -> uses::core::Client<'_>;
    pub fn auth(&self) -> uses::auth::Client<'_>;
}
```

Rules:

- `OwnedContract` or equivalent exposes the participant's owned contract surface as reusable dependency vocabulary
- `owned()` exposes only the local participant's owned surface
- each `uses` alias becomes its own generated accessor and module namespace
- if a `uses` alias is absent from the local contract, no accessor for that alias exists
- if a remote operation is not selected under a `uses` alias, no generated method for that operation exists under that alias

## Alias-Based Access

Rust uses alias-based facades rather than a flat merged runtime namespace.

Examples:

- `participant.core().trellis_catalog(...)`
- `participant.auth().auth_me(...)`
- `participant.owned().register_activity_list(...)`

Rules:

- Rust code should not rely on a flat string-keyed runtime method namespace as the primary ergonomic surface
- alias-based access reflects the local contract `uses` structure directly
- alias names from the manifest become generated Rust module and accessor names after Rust identifier normalization

## Compile-Time Filtering

Rules:

- if a `uses` alias is not declared, there is no corresponding facade accessor
- if a remote operation, RPC, event, or subject is not selected in the local manifest `uses`, there is no generated Rust method for it
- if a dependency mapping points an alias to the wrong SDK crate, generation fails
- if the mapped SDK crate does not own the referenced API, generation fails
- if a local participant is used as a dependency mapping target, generation uses its owned contract-module-compatible view rather than any used alias facades

## Outbound And Service-Side Behavior

The Rust outbound runtime must support at least:

- typed operation requests
- typed RPC requests
- typed event publishing
- typed event subscriptions
- typed raw subject publishing
- typed raw subject subscriptions

The Rust service runtime must support at least:

- owned operation handler registration
- owned RPC handler registration
- owned event publish helpers
- owned raw subject helpers
- outbound calls to used aliases through the same participant contract facade

Rules:

- `participant::Client` is typed by the local participant contract
- used facades only expose operations declared in local `uses`
- `participant::Service` exposes owned registration and publish helpers only for the local owned contract surface
- `participant::Service` also exposes alias-based outbound used facades for cross-contract calls
- service-side registration APIs must not expose used remote operations as mountable handlers

## Descriptor Traits

Required descriptor categories:

- `OperationDescriptor`
- `RpcDescriptor`
- `EventDescriptor`
- `SubjectDescriptor`

Required descriptor semantics:

- operation descriptors expose logical key, invoke subject, derived control subject, input type, progress type if any, output type, declared capability requirements, and enough metadata to drive typed operation helpers
- RPC descriptors expose logical key, concrete subject, request type, response type, declared caller capabilities, and declared known errors
- event descriptors expose logical key, event type, subject template metadata, wildcard subscribe subject metadata, and enough logic to derive a concrete publish subject from an event value when the subject is templated
- subject descriptors expose logical key, subject or subject pattern, message type if any, and capability metadata

## Connection Helpers

Generated participant facades expose contract-driven connection helpers.

Illustrative shape:

```rust
let client = activity_participant::connect_service(opts).await?;
let facade = client.facade();
```

Rules:

- those helpers wrap stable `trellis-client` and `trellis-server` runtime primitives
- they produce contract-shaped facades, not unfiltered transport clients
- they do not implicitly inject extra contract SDKs beyond those declared by the local participant
- transfer-grant execution remains a lower-level `trellis-client` helper such as `client.transfer(grant)` rather than a generated alias facade method

## Manifest And Generation Rules

- generated Rust participant facades and SDK crates are derived from the existing `trellis.contract.v1` manifest format
- Rust authoring or generation layers MUST preserve canonical manifest requirements such as `displayName` and `description`
- local participant-facade generation requires explicit mapping from `uses` aliases to SDK crates or module paths
- generation fails if an alias mapping is missing or mismatched

## Non-Goals

- redefining the canonical manifest format
- defining TypeScript contract surfaces
- defining subsystem-specific APIs such as jobs or operations language surfaces
