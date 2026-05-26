---
title: Trellis TypeScript Contract Authoring
description: TypeScript contract authoring architecture centered on kind-specific helpers, uses, and derived contract views.
order: 20
---

# Design: Trellis TypeScript Contract Authoring

## Prerequisites

- [../core/trellis-patterns.md](./../core/trellis-patterns.md) - service and app
  boundaries
- [trellis-contracts-catalog.md](./trellis-contracts-catalog.md) - canonical
  manifest and `uses` semantics
- [../tooling/trellis-cli.md](./../tooling/trellis-cli.md) - source-first CLI
  boundary

## Context

The current TypeScript contract ergonomics are split across two separate
concepts:

- `defineContractSource(...)` is the local authoring helper for a contract
  manifest
- `mergeApis(...)` is the runtime helper used to assemble the `trellis` API
  surface from multiple SDK modules

That split has several problems:

- authors must understand and hand-write raw `uses.contract` ids and operation
  name strings for remote services
- imported SDK modules do not help type-check the `uses` section of the local
  contract source
- runtime callability is determined by a manually merged API list rather than by
  the contract definition itself
- a real remote RPC or event may exist in an SDK but still fail at runtime
  because it was omitted from the local merged API
- the contract is the permission blueprint for a participant, but the current
  TypeScript runtime surface is not derived from that blueprint

This is especially awkward because Trellis participants are broader than
long-running services. Apps, CLIs, browser clients, and other callers also
connect to Trellis and need a typed declaration of what they own and what they
use.

This document records TypeScript contract-authoring architecture: package
ownership, generated projections, `uses` enforcement, and how TypeScript helpers
must emit canonical manifests. It is not the TypeScript tutorial or API
reference. Ordinary usage examples and exact signatures belong in
`/guides/libraries/typescript` and `/api`.

## Design

Trellis adopts a contract-first TypeScript model.

Every TypeScript participant that connects to Trellis defines one contract
through a single high-level API. That contract becomes the source of truth for
both:

- the emitted `trellis.contract.v1` release artifact
- the TypeScript `trellis` runtime API surface available to that participant

### 1) Primary authoring API

TypeScript authoring uses kind-specific public helpers:

- `defineServiceContract(...)`
- `defineAppContract(...)`
- `defineAgentContract(...)`
- `defineDeviceContract(...)`

These helpers are the public TypeScript authoring surface. Docs and normal
authored contract modules should use the kind-specific helper that matches the
participant.

This public surface covers contract authoring, emitted artifacts, and derived
runtime API views. Supporting internals should extend these helpers rather than
introducing alternate authoring entrypoints.

### 2) Package boundary

The kind-specific contract authoring helpers are available from
`@qlever-llc/trellis` and are the normal authoring entrypoint for everyday
contract source modules.

`@qlever-llc/trellis/contracts` remains the advanced contract-system surface for
broader contract-model helpers and codegen-facing types.

Rules:

- `@qlever-llc/trellis` is the normal package for kind-specific contract
  authoring helpers and runtime client connection helpers
- `@qlever-llc/trellis/contracts` is the advanced package for broader
  contract-model helpers, canonicalization, and SDK/codegen-facing types
- normal contract source modules and runtime client code should prefer
  `@qlever-llc/trellis`; advanced contract-model imports should come from
  `@qlever-llc/trellis/contracts`
- specialized helper return values remain usable anywhere a generated SDK
  contract module or runtime contract object is expected
- `@qlever-llc/trellis/service/node` and `@qlever-llc/trellis/service/deno`
  consume contract objects for service runtime helpers
- generated API reference owns the precise package export inventory and helper
  signatures

### 3) SDK-driven `uses`

TypeScript authors do not hand-write remote dependency contract ids in normal
use.

Generated SDK modules expose a root-only package export. The root export
includes a contract module object named `sdk` that includes:

- stable contract identity, canonical manifest metadata, and manifest digest
- projected API metadata, including owned, used, and merged views
- a typed `use(...)` helper for declaring `uses`
- optional generated subsystem metadata such as state, jobs, and KV helpers

Authors import that stable export with a local alias that describes the
dependency and use the SDK-backed selector for the `uses.required` or
`uses.optional` entry. See `/guides/libraries/typescript` for complete examples.

Generated SDKs do not expose dependency-specific default-use helpers. All
caller-visible `uses` selections should be explicit in the authored contract.

The required user-facing contract metadata is:

- `displayName`
- `description`

Contracts that own capability-gated surfaces SHOULD also declare top-level
capability metadata. TypeScript authors write local capability keys in the
contract source; emission projects declared local keys to global capability keys
using `<contract id without @vN>::<local capability>`.

The emitted manifest contains `trellis.jobs::admin.read` in both the top-level
`capabilities` map and the RPC capability list. Undeclared platform capabilities
such as `service` remain raw strings.

Operations that accept post-start caller input declare named signals in the
operation descriptor. Signal input schemas live in the local schema registry and
are referenced with the same `ref.schema(...)` pattern as operation input,
progress, and output schemas.

Rules:

- `signals` is an operation-local map of named post-start inputs.
- each signal requires an `input` schema reference from the local schema
  registry.
- signal schemas are reachable contract schemas and therefore participate in
  manifest emission, digest projection, validation, docs, and generated SDK
  aliases.
- `capabilities.control` is the coarse capability gate for signal submission;
  `capabilities.cancel` remains the coarse gate for cancellation only.
- TypeScript operation references expose universal `cancel()` and `signal(...)`
  helpers for ergonomic wrappers. Unsupported cancel or signal attempts are
  expected runtime failures returned through `Result` / `AsyncResult`, not
  omitted protocol semantics.

For locally authored TypeScript contract source files, whether a top-level
`contract.ts` or `contract.js` for a single contract or `contracts/*.ts` for a
multi-contract layout:

- the file MUST `default export` the contract helper return value
- Trellis source loading resolves the default export only for TypeScript
  contract files
- authors should use the kind-specific helper that matches the participant kind;
  exact overloads and setup examples belong in `/guides/libraries/typescript`
  and `/api`
- `schemas` and local `errors` act as local registries supplied to the contract
  builder for service contracts, while the callback body defines the emitted
  contract body including owned surfaces, resources, `uses`, and `exports`
- emitted manifest fields such as `exports` are authored in the callback body,
  not in the local registry argument
- app-, agent-, and device-style contracts may also take a `schemas` registry
  when they declare schema-backed owned surfaces such as top-level `state`
- schema and error references should use the public reference helpers so
  manifest emission can validate local declarations and built-in Trellis RPC
  errors
- `TransportError` is built into Trellis runtime call surfaces, but it is not a
  contract-authored RPC `errors: [...]` entry; it represents Trellis
  transport/runtime boundary failures rather than a handler-declared remote
  error
- authors should not hand-assemble a wrapper object that re-exports
  `CONTRACT_ID`, `CONTRACT`, `CONTRACT_DIGEST`, and `API` just to satisfy
  generator tooling
- generated SDK modules and locally defined contracts share this compatible
  contract-module shape, and a locally defined contract must be usable wherever
  generated SDK tooling expects a contract module
- generated SDK package exports are root-only; contract source should import the
  package root and should not depend on generated subpaths such as `./api`,
  `./types`, or `./contract`
- local `operations`, `rpc`, `events`, `state`, `errors`, and `resources` remain
  the source for emitted owned contract content
- local top-level `capabilities` metadata remains the source for emitted global
  capability metadata and approval copy
- a participant may omit owned `operations`, `rpc`, or `events`, and may omit
  `uses`
- the defined contract computes and exposes the manifest digest from the emitted
  canonical manifest

### 3a) Service-local RPC errors

TypeScript contract authoring also owns service-local transportable RPC errors.

Authors should normally create them through the public error helper and register
the generated error classes directly in the builder registry `errors` map. Full
syntax belongs in `/guides/libraries/typescript` and `/api`.

Rules:

- the `errors` map stays local to the contract rather than using a central
  global registry
- new local transportable errors should normally use `defineError(...)`
- each local transportable error still becomes a real runtime class, not a plain
  manifest object
- the generated class `type` is the wire `type`
- `defineServiceContract(...)` derives manifest-emitted local error schema refs
  from local error runtime metadata when the schema is not already present in
  the local `schemas` map
- authors may still include the error schema explicitly in `schemas` when they
  want a stable local schema key or to reference that schema elsewhere
- RPC `errors: [...]` entries should usually be authored through
  `ref.error(...)` so local declaration keys and built-in Trellis errors share
  one pattern
- `TransportError` should not be used as a service-local domain error; it is
  reserved for Trellis-native transport/runtime boundary failures, while
  `UnexpectedError` remains for true internal or otherwise unexpected conditions
- the emitted manifest remains plain JSON; Trellis attaches JS-only
  reconstruction metadata to the local contract object rather than serializing
  class constructors
- generated TypeScript SDKs follow the same class shape so external TS consumers
  also receive real error instances
- callers receive declared remote errors as reconstructed runtime instances of
  the declared class where the SDK or local contract has runtime metadata
- undeclared or unknown remote error payloads remain forward-compatible and fall
  back to `RemoteError`

The `use(...)` helper:

- fills in the target `contract` id automatically from the SDK
- restricts `rpc.call` to keys from that SDK's owned RPC surface
- restricts `operations.call` to keys from that SDK's owned operation surface
- restricts `events.publish` and `events.subscribe` to keys from that SDK's
  owned event surface
- restricts `feeds.subscribe` to keys from that SDK's owned feed surface

This makes imported SDK modules the source of truth for remote dependency names
in TypeScript authoring.

Contracts must place SDK-backed uses either in `uses.required` or
`uses.optional`; aliases directly under `uses` are invalid and are not treated
as implied required uses. Required uses fail closed when their referenced
contract or surface is unknown. Optional uses are included in digest identity,
but missing optional contracts or surfaces are skipped and grant no transport
authority. If an alias appears in both groups, the required declaration wins.

Some Trellis-owned surfaces are derived from the participant kind or local
contract features. App, agent, and device contracts receive baseline auth RPCs
such as `Auth.Sessions.Me` and `Auth.Sessions.Logout` without authoring
boilerplate; service runtimes may also receive baseline auth surfaces such as
`Auth.Requests.Validate` without each service authoring a `uses` entry.
Contracts that need non-baseline auth surfaces still declare them with
`auth.use(...)`.

### 3b) Event consumer groups

TypeScript service contracts declare durable event processing with the top-level
`eventConsumers` map. The events in a group must reference events that the same
contract already subscribed to through `uses.required` or `uses.optional`.

Example:

```ts
const contract = defineServiceContract({ schemas }, () => ({
  id: "billing-projection@v1",
  displayName: "Billing Projection",
  description: "Projects billing events into workspace state.",
  uses: {
    required: {
      billing: billing.use({
        events: { subscribe: ["Billing.SubscriptionConfirmed"] },
      }),
    },
  },
  eventConsumers: {
    workspaceBilling: {
      events: [
        { use: "billing", event: "Billing.SubscriptionConfirmed" },
      ],
      replay: "new",
      ordering: "strict",
      concurrency: 1,
      ackWaitMs: 300_000,
      maxDeliver: 6,
      backoffMs: [5_000, 30_000, 120_000, 600_000, 1_800_000],
    },
  },
}));
```

Rules:

- `replay` defaults to `"new"`; use `"all"` only when a new deployment should
  project all retained historical events
- `ordering` defaults to `"strict"`, and strict ordering requires
  `concurrency: 1`
- group names are logical aliases; service code passes the alias as
  `opts.group`, while Trellis provisions the physical durable consumer name
- callers must not pass `durableName` for service event processing
- one event may appear in multiple groups when the service intentionally wants
  independent durable cursors and duplicate delivery
- docs metadata may describe the group for review UIs, but nested docs do not
  affect the digest projection

### 3c) Named contract state stores

TypeScript contract authoring declares public Trellis-managed state through the
top-level `state` map.

Rules:

- state stores are declared at top level under `state`
- each state store requires `kind: "value" | "map"`
- each state store requires `schema: ref.schema("...")`
- the referenced schema must exist in the local `schemas` registry
- each state store may declare `stateVersion`; omit it only when the default
  `"v1"` is sufficient
- keep `stateVersion` stable for additive compatible schema changes and bump it
  only when stored values require migration
- `acceptedVersions` declares older state versions and schemas that the runtime
  can surface for app/device-side migration
- the declared stores project to the runtime surface at `trellis.state.<store>`
- normal runtime callers do not declare or pass a public `scope`
- conditional writes use runtime `put(..., { expectedRevision })`, not a
  separate compare-and-set helper

State-specific runtime, migration, validation, and corruption-handling rules are
canonicalized in [../core/state-patterns.md](./../core/state-patterns.md). Exact
state helper signatures belong in the generated TypeScript API reference under
`/api`.

### 3d) Exported schemas and SDK type reuse

Service-owned data model types that cross a contract boundary should be declared
as named schemas and exported through `exports.schemas`.

Rules:

- browser apps, devices, and peer services should import server-owned model
  types from the generated SDK instead of redefining those shapes locally
- generated TypeScript SDKs export aliases for schemas listed in
  `exports.schemas`
- generated RPC, operation, event, and job types should reuse exported schema
  aliases when nested wire shapes match those exported schemas
- exact alias names and declaration forms belong in the generated TypeScript API
  reference under `/api`

### 4) TypeScript enforcement of declared permissions

The TypeScript type system must enforce both of these rules:

- a referenced remote operation, RPC, event, or feed must exist on the imported
  SDK module
- a participant may only invoke, call, publish, or subscribe to remote
  operations, events, and feeds that are explicitly declared in its local
  contract `uses`, except for Trellis-defined baseline surfaces automatically
  available to that participant kind

This makes two important guarantees in normal authoring: if an SDK does not
expose `Auth.Nope`, then `auth.use({ events: { subscribe: ["Auth.Nope"] } })` is
a type error, and if a non-baseline remote surface exists in an imported SDK but
the local contract did not declare it in `uses`, then the corresponding runtime
call is a type error for that participant.

No separate linting or external analysis tool is required for this workflow. The
contract object itself defines the allowed TypeScript runtime surface.

### 5) Derived runtime API surfaces

The contract definition produces three distinct projected API views:

- `API.owned` - the operations, RPCs, events, and feeds owned by the local
  participant and therefore mountable or publishable as owner behavior
- `API.used` - the subset of remote SDK APIs explicitly permitted by `uses`
- generated client and service facades - the concrete runtime surfaces derived
  from the merged owned and used API, exposed as `rpc`, `event`, `feed`, and
  `operation`

Rules:

- `API.owned` derives only from the local contract's `operations`, `rpc`,
  `events`, and `feeds`
- `API.used` derives only from the remote SDK operations explicitly selected
  through `use(...)`, plus Trellis-owned baseline surfaces that are derived from
  participant kind or local features
- contracts that declare top-level `state` receive baseline `State.*` RPCs in
  `API.used`, while normal application code uses `client.state.<store>`
- generated active facades are the only general outbound runtime API surface
- generated active facades are derived from the merge of `API.used` and
  `API.owned`
- server-side handler registration uses `service.handle` surfaces derived from
  `API.owned`, not the outbound active facade

This preserves the distinction between what a participant owns and what it is
merely allowed to use.

### 6) Runtime connection helpers are contract-driven

TypeScript runtime helpers consume contract objects directly. The design
requirement is that connection helpers receive the local participant contract
and return contract-derived active or provider facades; exact connection option
shapes and examples belong in `/guides/libraries/typescript` and `/api`.

Rules:

- connected clients and services expose generated active facades typed from the
  merged owned and used contract surface
- server handler registration is typed from `contract.API.owned`
- `service.handle.rpc.<group>.<leaf>(...)` handlers should use the payload type
  that Trellis derives from the contract; docs and examples should not re-parse
  mounted RPC payloads just to recover types
- mounted RPC handlers may return either `Result` or `Promise<Result>`
- returned runtimes expose typed `rpc`, `event`, `feed`, and `operation` helpers
  derived from the contract and must not widen the callable surface beyond what
  the contract allows
- service-side helpers must not expose used remote APIs as mountable local
  handlers
- request and operation helpers may fail with `TransportError` for Trellis
  transport/runtime boundary failures even when that error is not a
  contract-authored remote error; `UnexpectedError` remains for true internal or
  otherwise unexpected runtime conditions
- returned runtimes expose operation-native send transfer through the transfer
  builder flow and grant consumption through runtime transfer helpers
- contract descriptors declare transfer direction explicitly for operations that
  ingest caller bytes and RPCs that issue service-owned byte grants
- for locally owned contracts, author-facing code should normally define
  concrete handler-local aliases such as
  `type Args = RpcArgs<typeof myContract, "My.Method">` and
  `type Return = RpcResult<typeof myContract, "My.Method">`
- service-owned RPC handlers should normally use explicit function declarations
  with those aliases, for example
  `async function myHandler({ input, context }: Args): Promise<Return> { ... }`
- docs and examples should prefer explicit `Args` and `Return` aliases for
  handler signatures instead of handwritten request parsing
- callers do not manually assemble runtime API arrays for normal usage
- locally authored contracts should normally export the helper return value
  directly; do not wrap it in a handwritten default-export object that
  reassembles `CONTRACT_ID`, `CONTRACT`, `CONTRACT_DIGEST`, and `API`
- for TypeScript contract source files, that direct export should be the file's
  default export so prepare/generation can resolve it consistently
- single-contract examples should normally use a top-level `contract.ts`
- for contracts that own schemas or local errors, keep the local registries
  separate from the emitted contract body so generation can validate references
- keep the first `define*Contract(...)` argument limited to local authoring
  registries such as `schemas` and service-local `errors`; put emitted contract
  body fields such as `exports` inside the callback return object
- Trellis-specific bootstrap exceptions should stay in Trellis platform code and
  use lower-level runtime APIs directly rather than becoming general public
  service helpers

### 7) Scope of contracts beyond connect

Contracts matter beyond the initial connect phase.

In TypeScript they remain the source for:

- emitted manifest generation
- runtime operation, call, and subscribe typing
- owned handler and publisher typing
- `CONTRACT_ID` and digest metadata used for discovery and binding lookup

This document therefore treats the contract object as the primary participant
definition, not as a one-time connection option.

## Normative Surface Ownership

This document constrains the architectural direction behind the TypeScript
contract API. Exact public signatures, contract-module types, runtime helper
members, overloads, and generated inventories belong in the generated TypeScript
API reference under `/api`.

The architectural rules are:

- kind-specific helpers are the supported public authoring entrypoints for
  normal local contract modules
- `@qlever-llc/trellis` exposes the preferred contract authoring helpers used by
  apps and services while returning contract objects with projected API views
  and manifest metadata
- `@qlever-llc/trellis` also remains the runtime package for
  `TrellisClient.connect(...)`, auth helpers, and `Result`
- runtime connection helpers live in `@qlever-llc/trellis` and
  `@qlever-llc/trellis/service*`
- locally defined contracts and generated SDK modules share one compatible
  contract-module shape
- `uses` declarations remain SDK-backed and contract-driven rather than
  handwritten dependency objects in normal usage
- the participant runtime surface remains derived from `API.owned` and
  `API.used`, with generated active and provider facades as the public runtime
  entrypoints
- generated TypeScript SDKs include consumer client facade types that apps and
  peer services can use as concrete editor-friendly views over the runtime
  client
- public documentation should lead with `TrellisClient.connect(...)`,
  `TrellisService.connect(...)`, and `TrellisDevice.connect(...)`; public
  service author guidance should not point at Trellis-internal bootstrap paths
- emitted manifests remain canonical `trellis.contract.v1` artifacts; this
  design does not create a parallel manifest format
- TypeScript compile-time typing enforces declared remote usage shape, while
  runtime validation still enforces canonical manifest, auth, subject ownership,
  and dependency-resolution rules
- TypeScript authoring is an implementation of the canonical manifest
  architecture, not a parallel manifest format
- generated SDK outputs still need the richer contract module shape with
  `CONTRACT`, `CONTRACT_ID`, `CONTRACT_DIGEST`, projected API views, and typed
  `use(...)` helpers
- generated SDK outputs must include stable contract identity, canonical
  manifest metadata, derived API projections, typed dependency selection, and a
  concrete generated client facade for consumers
- generated client facades should expose explicit `rpc`, `operation`, `event`,
  `feed`, state, and common runtime members without requiring consumers to name
  deep contract-derived runtime aliases

The replacement rule also remains the same: normal TypeScript user code should
not need to use `defineContractSource(...)`, `buildContractArtifacts(...)`, or
`mergeApis(...)` directly once this model is complete.

### User approval semantics

Contracts are also the user-facing identity and approval surface for user-facing
clients.

Rules:

- `displayName` and `description` are what approval and session-management UIs
  show to the user
- top-level `capabilities` metadata is what approval UIs show for requested
  capability-level authority; raw global capability keys are technical detail
- browser apps send their contract manifest during login so auth can plan
  routing and approval; they are approved per-user and are not installed like
  services
- user approval is granted to a specific contract digest, not merely to a
  contract `id`
- if a client changes its contract and therefore changes its digest, it must be
  approved again
- `id` remains useful for lineage and code generation, but approval is bound to
  the exact concrete contract artifact identified by `CONTRACT_DIGEST`
- the canonical manifest and digest still belong to the release boundary, but
  normal app and service repos should generate or verify them inside `dev`,
  `build`, or CI tasks rather than teaching users a separate manual manifest
  step for routine usage

Expected type behavior:

- `service.rpc.trellis.catalog({})` is valid because it is declared in `uses`
- non-baseline auth RPCs remain type errors unless the service contract
  explicitly declares them in `uses`; baseline auth RPCs such as
  `Auth.Requests.Validate` may be generated or granted automatically by the
  service runtime
- `service.handle.rpc.trellis.catalog(...)` is a type error because that RPC is
  used, not owned
- `auth.use({ rpc: { call: ["Trellis.Catalog"] } })` is a type error because
  that RPC is not part of `trellis.auth@v1`

### Implementation notes

- TS SDK generation should emit the contract module shape with nested API views
  and typed `use(...)`
- runtime helpers should consume contract objects directly for client and
  service creation
- the emitted manifest format and agent contract workflow stay stable

## References

- `design/contracts/trellis-contracts-catalog.md`
- `design/tooling/trellis-cli.md`
