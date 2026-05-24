---
title: Trellis Rust Contract Libraries
description: Rust package policy, contract SDK architecture, and participant-facade direction.
order: 30
---

# Design: Trellis Rust Contract Libraries

## Prerequisites

- [../core/trellis-patterns.md](./../core/trellis-patterns.md) - participant
  boundaries across services, apps, and tools
- [trellis-contracts-catalog.md](./trellis-contracts-catalog.md) - canonical
  manifest and `uses` semantics
- [../tooling/trellis-cli.md](./../tooling/trellis-cli.md) - source-first CLI
  and SDK generation boundary
- [trellis-typescript-contract-authoring.md](./trellis-typescript-contract-authoring.md) -
  same contract-first goal expressed for TypeScript

## Context

The original Rust library shape was transport-first rather than contract-first.
The current public package policy keeps the transport primitives behind the
`trellis` facade while generated SDKs and participant facades carry the
contract-shaped authoring model.

The underlying implementation still contains these layers:

- `trellis-contracts` owns canonical manifest loading, validation, and digest
  logic
- `trellis` exposes the public runtime facade, including Trellis-owned SDK
  modules under `trellis::sdk::{auth, core, health, jobs, state}`
- internal runtime crates expose generic request, publish, service routing,
  operation registration, and event publishing primitives used by the facade and
  generated code
- generated service/app-owned Rust SDK crates expose owned contract constants,
  types, descriptors, and typed client helpers for a single manifest
- Rust contract authoring helpers can build canonical manifests, including
  top-level state declarations, schema exports, events, resources, jobs, RPCs,
  operations, and contract-owned capability metadata

That is not yet enough to express the contract ergonomics we want.

The gaps are:

- local Rust participants do not get a runtime surface derived from their own
  contract `uses`
- generated Rust SDK crates describe what a remote contract owns, but not what a
  local app or service is allowed to use
- current client helpers still include hard-coded Trellis core operations
  instead of relying purely on generated contract SDKs
- current descriptor traits are too weak for full contract semantics such as
  templated event subjects and operation control subjects
- the current Rust shape does not provide an idiomatic equivalent of a local
  participant contract that defines both owned and used surfaces
- Rust device activation has protocol helpers and an activated-device runtime
  connect facade through `TrellisClient::connect_device(...)`, but generated
  device participant facades are still pending

Rust should solve the same architectural problem as TypeScript, but with
Rust-native ergonomics.

Rust should not mimic the flat string-keyed TypeScript `trellis` object exactly.
The idiomatic Rust surface should instead prefer generated modules, types, and
alias-based facades.

## Design

Trellis adopts a contract-driven Rust library model.

Every Rust participant that connects to Trellis uses a local participant
contract as its primary Trellis surface. That participant contract is derived
from the canonical manifest plus explicit dependency mappings to generated Rust
SDK crates.

The desired Rust user experience is:

- remote contract SDK crates describe what each contract owns
- a local generated participant facade describes what the current app or service
  owns and what it is allowed to use
- runtime connection helpers are driven by that participant facade rather than
  by manual descriptor juggling
- alias-based access such as `participant.core()` or `participant.auth()` is
  preferred over a flat merged method namespace

As in the TypeScript design, the local participant contract remains meaningful
beyond initial connection. It is the primary source for emitted manifest
identity, owned surface, allowed used surface, and contract-shaped runtime
access.

### 1) Manifest remains canonical

This document does not change the architectural contract boundary.

Rules:

- the generated `trellis.contract.v1` manifest remains the canonical runtime and
  tooling artifact
- required manifest metadata is the same as in the TypeScript contract design:
  `id`, `displayName`, and `description` are required top-level fields in the
  emitted canonical manifest
- generated Rust SDK crates and participant facades derive from manifests
- native Rust authoring helpers or macros MAY exist later, but they are
  implementation details around deterministic manifest emission
- Rust authoring helpers may accept local capability names and must emit the
  same global capability keys as TypeScript helpers for declared contract-owned
  capabilities
- Rust operation capability metadata supports the same `call`, `observe`, `cancel`,
  and `control` gates as canonical manifests and generated TypeScript API views.

### 2) Primary Rust usage model

The primary Rust model is not a generic transport client plus hand-managed
descriptor types.

The primary Rust model is:

- generated contract SDK crates for remote contracts
- generated local participant facades for apps, services, CLIs, and other Rust
  Trellis participants

Normal application and service code should primarily use the generated local
participant facade.

### 3) Package policy and crate responsibilities

The public, stable Cargo authoring packages are:

- `trellis` - curated runtime facade for Rust clients, services, devices, and
  apps, including Trellis-owned generated SDK modules under
  `trellis::sdk::{auth, core, health, jobs, state}`
- `trellis-contracts` - canonical manifest, catalog, digest, and contract
  metadata model, including capability metadata and global capability key
  helpers

Other low-level crates may exist in the repository as unpublished compatibility
or test packages, but they are not publishable packages and they are not the
public/stable authoring surface. Normal Rust code should import runtime behavior
through `trellis` and contract model types through `trellis-contracts`.

Rust crate boundaries are:

- `trellis` - public runtime facade and Trellis-owned SDK modules
- `trellis-contracts` - public contract model and manifest helpers
- old low-level package identities such as `trellis-client` and
  `trellis-service` - unpublished compatibility or test packages only; their
  public-package implementation lives in `trellis` modules
- generated SDK crates - one crate per service/app-owned contract manifest,
  describing owned RPCs, operations, events, types, and metadata for that
  contract, for example `trellis_sdk_orders_service` or
  `trellis-sdk-demo-service`
- generated participant facade crates or modules - local contract-aligned
  runtime surface for a specific participant

Rules:

- `trellis-contracts` remains the architectural contract crate, not the
  transport runtime crate
- `trellis-contracts` owns manifest and catalog models, canonicalization, digest
  helpers, manifest loading and validation, and shared contract metadata traits
  and types used by generated Rust crates; it does not own NATS transport
  connection behavior
- `trellis::client` owns authenticated outbound Trellis session/client
  primitives; generic operation, RPC, event, and derived runtime-subject client
  primitives; operation-native transfer execution helpers; and descriptor traits
  required by generated outbound code
- `trellis::service` owns authenticated service-side runtime primitives, handler
  registration for owned operations and RPCs, owned event publish helpers,
  operation control/reply and transfer subject helpers derived from owned
  surfaces, and descriptor traits required by generated inbound code
- low-level runtime crates such as `trellis-client`, `trellis-service`,
  `trellis-service-runtime`, `trellis-auth`, `trellis-auth-adapters`, and
  `trellis-jobs` are internal implementation/generator targets marked
  `publish = false`, not public authoring packages
- generated participant facades are the supported ergonomic entrypoint for
  normal Rust participant code
- Rustdoc owns the exact public item inventory for each crate

### 4) Generated SDK crate shape

Each generated SDK crate describes only the owned surface of one contract. It is
valid as dependency vocabulary for participant-facade generation, but it does
not represent another participant's local `uses` filtering.

Generated SDK crates must expose:

- stable contract identity and digest metadata
- access to the canonical contract manifest
- owned request, response, event, and message types
- owned operation input, progress, output, terminal, operation-ref, and signal
  payload aliases where the manifest declares those schemas
- owned operation, RPC, and event descriptors
- thin outbound client helper modules for the owned surface
- thin inbound server helper modules for the owned surface

Exact module names, re-exports, helper functions, structs, traits, and method
inventories belong in Rustdoc.

### 5) Shared metadata and participant facade shape

Every generated SDK crate and generated local participant facade exposes a
shared contract metadata view with contract id, digest, canonical manifest JSON,
and manifest access. When a local participant is used as a dependency of another
local participant, only its owned contract surface participates in dependency
selection.

Each local participant facade is generated from the local participant manifest
and explicit mappings from local `uses` aliases to Rust SDK crates or module
paths.

Rules:

- an owned-contract view exposes the participant's owned contract surface as
  reusable dependency vocabulary
- the owned facade exposes only the local participant's owned surface
- each `uses` alias becomes its own generated accessor and module namespace
- if a `uses` alias is absent from the local contract, no accessor for that
  alias exists
- if a remote operation, RPC, or event is not selected under a `uses` alias, no
  generated method for that surface exists under that alias
- if a dependency mapping points an alias to the wrong SDK crate, generation
  fails
- if the mapped SDK crate does not own the referenced API, generation fails
- exact facade structs, accessors, and module layouts belong in Rustdoc

### 6) Alias-based access and runtime behavior

Rust uses alias-based facades rather than a flat merged runtime namespace.

Rules:

- normal Rust code should not rely on a flat string-keyed runtime method
  namespace as the primary ergonomic surface
- alias names from the manifest become generated Rust module and accessor names
  after Rust identifier normalization
- the generated client facade is typed by the local participant contract
- used facades only expose operations, RPCs, and events declared in local `uses`
- the generated service facade exposes owned registration and publish helpers
  only for the local owned contract surface
- the generated service facade also exposes alias-based outbound used facades
  for cross-contract calls
- service-side registration APIs must not expose used remote operations as
  mountable handlers
- outbound runtimes must support typed operation requests, RPC requests, event
  publishing, event subscriptions, and operation reply/transfer helpers derived
  from contract surfaces

### 7) Descriptor and connection-helper semantics

Generated SDKs and participant facades rely on descriptor traits for operations,
RPCs, and events. Rustdoc owns the exact trait items; this document records the
semantic requirements.

Required descriptor semantics:

- operation descriptors expose logical key, invoke subject, derived control
  subject, input type, progress type if any, output type, declared signal input
  schemas, declared capability requirements, and enough metadata to drive typed
  operation helpers
- RPC descriptors expose logical key, concrete subject, request type, response
  type, declared caller capabilities, and declared known errors
- event descriptors expose logical key, event type, subject template metadata,
  wildcard subscribe subject metadata, and enough logic to derive a concrete
  publish subject from an event value when the subject is templated
- generated server descriptors and authenticated routers must propagate the
  required caller capabilities for the matched RPC or operation-control action
  into `Auth.Requests.Validate`; the auth validator, not only local Rust
  routing, enforces those capabilities against the caller session

Generated participant facades expose contract-driven connection helpers through
the public `trellis` facade. The facade may delegate to low-level runtime
crates, but those crates are implementation details rather than normal authoring
packages.

Rules:

- helpers produce contract-shaped facades, not unfiltered transport clients
- helpers do not implicitly inject extra contract SDKs beyond those declared by
  the local participant
- service connection helpers retain the resource binding returned by
  authenticated service bootstrap and use it to construct typed KV, store, jobs,
  and transfer runtime handles
- bootstrapped service principals should not perform a second discovery pass via
  `Trellis.Catalog` or `Trellis.Bindings.Get` unless their contract explicitly
  declares and receives that Trellis-owned surface
- transfer execution should hang off transfer-capable operation refs rather than
  a standalone grant-transfer helper
- exact helper names and option types belong in Rustdoc

### 8) Manifest and generation rules

- generated Rust participant facades and SDK crates are derived from the
  existing `trellis.contract.v1` manifest format
- Rust authoring or generation layers must preserve canonical manifest
  requirements such as `displayName` and `description`
- local participant-facade generation requires explicit mapping from `uses`
  aliases to SDK crates or module paths
- generation fails if an alias mapping is missing or mismatched
- generation does not require local SDK mappings for runtime-owned baseline
  surfaces that already have native Rust runtime support, such as baseline
  `health` heartbeat publishing or generated state helpers for
  `trellis.state@v1`

## Normative Surface Ownership

This document constrains the architecture behind the Rust contract API. Exact
Rust public signatures, generated crate member inventories, participant facade
examples, helper names, option types, and runtime helper surfaces belong in
Rustdoc.

- the public Rust contract/runtime surface is presented through `trellis` and
  `trellis-contracts`; generated service/app-owned SDK crates and generated
  local participant facades are owner artifacts rather than Trellis platform
  authoring packages
- Trellis-owned generated SDK surfaces are exposed from the public facade under
  `trellis::sdk::{auth, core, health, jobs, state}` rather than as separate
  public SDK crates
- generated SDK crates describe only the owned surface of one contract and
  remain valid dependency vocabulary for participant-facade generation
- generated SDK crates and local participant facades share enough contract
  constants/functions metadata shape that generators and runtimes can treat them
  consistently
- local participant facades remain generated from the local manifest plus
  explicit alias-to-SDK mappings because manifest contract ids do not determine
  Cargo crate names
- generation tooling may discover built-in Trellis SDK crate paths for declared
  Trellis-owned aliases, but those mappings still follow the same explicit
  alias-to-SDK model in the generated facade
- alias-based facade access remains the primary ergonomic Rust surface; normal
  Rust code should not reconstruct a flat merged runtime namespace by hand
- compile-time filtering remains contract-driven: absent aliases and unselected
  remote APIs do not produce generated accessors or methods
- low-level runtime crates remain implementation/generator targets and advanced
  escape hatches rather than the primary user-facing ergonomic surface
- descriptor traits in those runtime crates must remain rich enough for
  operations, RPCs, events, operation control subjects, and transfer/runtime
  subjects derived from contract surfaces
- generated connection helpers still produce contract-shaped facades and must
  not inject extra SDKs beyond those declared by the local participant
- emitted manifests remain canonical `trellis.contract.v1` artifacts; Rust
  facade generation does not create a parallel manifest format

The replacement direction also remains the same: normal Rust participant code
should not primarily depend on hard-coded Trellis runtime helpers, manual
stitching of multiple SDK clients, or direct subject-string usage for
contract-owned APIs once participant facades are fully capable.

### Implementation Order

Implementation should proceed in this order:

1. strengthen the low-level runtime crates behind the public `trellis` facade so
   generated code can target operations, RPCs, and events reliably
2. enrich Rust SDK generation so each contract SDK crate exports the full
   owned-surface module shape
3. add participant-facade generation from local manifest plus alias-to-crate
   mappings
4. update first-party Rust code to participant-facade usage
5. remove or de-emphasize hard-coded runtime contract helpers from low-level
   runtime crates

Rules:

- the new participant-facade model must be capable before older convenience
  surfaces are removed
- manifest and CLI workflows remain unchanged while library ergonomics evolve
- docs should prefer participant-facade usage once the model exists

## References

- `design/contracts/trellis-contracts-catalog.md`
- `design/contracts/trellis-typescript-contract-authoring.md`
- `design/tooling/trellis-cli.md`
