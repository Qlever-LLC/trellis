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
  contract-model helpers, and the specialized helper return values remain usable
  anywhere a runtime contract is expected
- `@qlever-llc/trellis/service/node` and `@qlever-llc/trellis/service/deno`
  consume contract objects for service runtime helpers

### 3) SDK-driven `uses`

TypeScript authors do not hand-write remote dependency contract ids in normal
use.

Generated SDK modules export a contract module object that includes:

- contract metadata
- projected API metadata
- a typed `use(...)` helper for declaring `uses`

The required user-facing contract metadata is:

- `displayName`
- `description`

Example shape:

```ts
const schemas = {
  CatalogRequest: CatalogRequestSchema,
  CatalogResponse: CatalogResponseSchema,
} as const;

export const core = defineServiceContract(
  { schemas },
  (ref) => ({
    id: "trellis.core@v1",
    displayName: "Trellis Core",
    description: "Expose Trellis-owned RPCs for platform SDK consumers.",
    rpc: {
      "Trellis.Catalog": {
        version: "v1",
        input: ref.schema("CatalogRequest"),
        output: ref.schema("CatalogResponse"),
      },
    },
  }),
);

export default core;
```

For locally authored TypeScript contract source files, whether a top-level
`contract.ts` or `contract.js` for a single contract or `contracts/*.ts` for a
multi-contract layout:

- the file MUST `default export` the contract helper return value
- Trellis source loading resolves the default export only for TypeScript
  contract files
- services should normally use
  `defineServiceContract({ schemas, errors }, (ref) => ({ ... }))`
- apps should normally use `defineAppContract({ schemas }, (ref) => ({ ... }))`
  when they declare schema-backed state, and
  `defineAppContract(() => ({ ... }))` otherwise
- user-delegated agents should normally use
  `defineAgentContract({ schemas }, (ref) => ({ ... }))` when they declare
  schema-backed state, and `defineAgentContract(() => ({ ... }))` otherwise
- devices should normally use
  `defineDeviceContract({ schemas }, (ref) => ({ ... }))` when they declare
  schema-backed state, and `defineDeviceContract(() => ({ ... }))` otherwise
- CLI and other long-lived user tooling should normally use
  `defineAgentContract({ schemas }, (ref) => ({ ... }))` when they declare
  schema-backed state, and `defineAgentContract(() => ({ ... }))` otherwise
- `schemas` and local `errors` act as registries supplied to the contract
  builder for service contracts, while the callback body defines the owned
  surfaces, resources, and `uses`
- app-, agent-, and device-style contracts may also take a `schemas` registry
  when they declare schema-backed owned surfaces such as top-level `state`
- schema refs should normally use `ref.schema("...")`
- RPC `errors: [...]` entries should normally use `ref.error("...")` for both
  local declarations and built-in Trellis RPC errors such as `UnexpectedError`,
  `ValidationError`, `AuthError`, and `TransferError`
- `TransportError` is built into Trellis runtime call surfaces, but it is not a
  contract-authored RPC `errors: [...]` entry; it represents Trellis
  transport/runtime boundary failures rather than a handler-declared remote
  error
- authors should not hand-assemble a wrapper object that re-exports
  `CONTRACT_ID`, `CONTRACT`, `CONTRACT_DIGEST`, and `API` just to satisfy
  generator tooling

### 3a) Service-local RPC errors

TypeScript contract authoring also owns service-local transportable RPC errors.

Authors should normally create them through `defineError(...)` and register the
generated error classes directly in the builder registry `errors` map.

Example shape:

```ts
export const NotFoundError = defineError({
  type: "NotFoundError",
  fields: {
    resource: Type.String(),
    resourceId: Type.String(),
  },
  message: ({ resource, resourceId }) => `${resource} ${resourceId} not found`,
});

const schemas = {
  GetWorkspaceInput: GetWorkspaceInputSchema,
  Workspace: WorkspaceSchema,
} as const;

const errors = {
  NotFoundError,
} as const;

export const krishi = defineServiceContract(
  { schemas, errors },
  (ref) => ({
    id: "dna-cloud.krishi@v1",
    displayName: "Krishi",
    description: "Krishi service",
    rpc: {
      "Workspace.Get": {
        version: "v1",
        input: ref.schema("GetWorkspaceInput"),
        output: ref.schema("Workspace"),
        errors: [
          ref.error("NotFoundError"),
          ref.error("ValidationError"),
          ref.error("UnexpectedError"),
        ],
      },
    },
  }),
);
```

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

The `use(...)` helper:

- fills in the target `contract` id automatically from the SDK
- restricts `rpc.call` to keys from that SDK's owned RPC surface
- restricts `events.publish` and `events.subscribe` to keys from that SDK's
  owned event surface
- restricts `subjects.publish` and `subjects.subscribe` to keys from that SDK's
  owned raw subject surface

This makes imported SDK modules the source of truth for remote dependency names
in TypeScript authoring.

Some SDKs may also expose convenience wrappers around `use(...)`. For example,
`@qlever-llc/trellis-sdk` exposes `auth.useDefaults(...)`, which adds the
baseline user-session RPC declarations `Auth.Me` and `Auth.Logout` before
merging any additional requested auth surfaces.

### 3b) Named contract state stores

TypeScript contract authoring declares public Trellis-managed state through the
top-level `state` map.

Example:

```ts
const schemas = {
  Preferences: Type.Object({ theme: Type.String() }),
  Draft: Type.Object({ title: Type.String() }),
} as const;

export const notes = defineAppContract(
  { schemas },
  (ref) => ({
    id: "acme.notes@v1",
    displayName: "Notes",
    description: "Notes app",
    state: {
      preferences: { kind: "value", schema: ref.schema("Preferences") },
      drafts: { kind: "map", schema: ref.schema("Draft") },
    },
  }),
);
```

Rules:

- state stores are declared at top level under `state`
- each state store requires `kind: "value" | "map"`
- each state store requires `schema: ref.schema("...")`
- the referenced schema must exist in the local `schemas` registry
- the declared stores project to the runtime surface at `trellis.state.<store>`
- normal runtime callers do not declare or pass a public `scope`
- conditional writes use runtime `put(..., { expectedRevision })`, not a
  separate compare-and-set helper

### 4) TypeScript enforcement of declared permissions

The TypeScript type system must enforce both of these rules:

- a referenced remote operation, RPC, event, or subject must exist on the
  imported SDK module
- a participant may only invoke, call, publish, or subscribe to remote
  operations that are explicitly declared in its local contract `uses`

This makes two important guarantees in normal authoring: if an SDK does not
expose `Auth.Nope`, then `auth.use({ events: { subscribe: ["Auth.Nope"] } })` is
a type error, and if `Auth.Me` exists in the imported SDK but the local contract
did not declare it in `uses` directly or through `auth.useDefaults(...)`, then
`trellis.request("Auth.Me", ...)` is a type error for that participant.

No separate linting or external analysis tool is required for this workflow. The
contract object itself defines the allowed TypeScript runtime surface.

### 5) Derived runtime API surfaces

The contract definition produces three distinct projected API views:

- `API.owned` - the operations, RPCs, events, and subjects owned by the local
  participant and therefore mountable or publishable as owner behavior
- `API.used` - the subset of remote SDK APIs explicitly permitted by `uses`
- `API.trellis` - the merged runtime surface used for outbound
  `operation(...).input(...).start()`, `request`, `publish`, and `subscribe`
  operations

Rules:

- `API.owned` derives only from the local contract's `operations`, `rpc`,
  `events`, and `subjects`
- `API.used` derives only from the remote SDK operations explicitly selected
  through `use(...)`
- `API.trellis` is the only general outbound runtime API surface
- server-side handler registration uses `API.owned`, not `API.trellis`

This preserves the distinction between what a participant owns and what it is
merely allowed to use.

### 6) Runtime connection helpers are contract-driven

TypeScript runtime helpers consume contract objects directly.

Examples:

```ts
import { TrellisClient } from "@qlever-llc/trellis";
import { TrellisService } from "@qlever-llc/trellis/service/deno";

export const app = defineAppContract(() => ({ ...appBody }));
export default app;

const client = await TrellisClient.connect({
  trellisUrl: "https://trellis.example.com",
  contract: app,
});

export const serviceContract = defineServiceContract(
  serviceRegistry,
  (ref) => ({
    ...serviceBody,
  }),
);
export default serviceContract;

const service = await TrellisService.connect({
  trellisUrl: "https://trellis.example.com",
  contract: serviceContract,
  name: "activity",
  sessionKeySeed,
  server: {},
});
```

Rules:

- the client or service `trellis` object is typed from `contract.API.trellis`
- server handler registration is typed from `contract.API.owned`
- `service.trellis.mount(...)` handlers should use the payload type that Trellis
  derives from the contract; docs and examples should not re-parse mounted RPC
  payloads just to recover types
- mounted RPC handlers may return either `Result` or `Promise<Result>`
- for locally owned contracts, author-facing code should normally define
  concrete handler-local aliases such as
  `type Args = RpcArgs<typeof myContract, "My.Method">` and
  `type Return = RpcResult<typeof myContract, "My.Method">`
- service-owned RPC handlers should normally use explicit function declarations
  with those aliases, for example
  `async function myHandler({ input, context }: Args): Promise<Return> { ... }`
- if a service needs a whole-handler alias for `service.trellis.mount(...)`, the
  service runtime package may still expose one, but docs and examples should
  prefer the explicit `Args` and `Return` form
- callers do not manually assemble runtime API arrays for normal usage
- locally authored contracts should normally export the helper result directly
  return value directly; do not wrap it in a handwritten default-export object
  that reassembles `CONTRACT_ID`, `CONTRACT`, `CONTRACT_DIGEST`, and `API`
- for TypeScript contract source files, that direct export should be the file's
  default export so prepare/generation can resolve it consistently
- single-contract examples should normally use a top-level `contract.ts`
- for contracts that own schemas or local errors, prefer top-level
  `const schemas = ...`, optional `const errors = ...`, and a
  `defineServiceContract({ schemas, errors }, (ref) => ({ ... }))` layout
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

The exact TypeScript public signatures, contract-module types, and runtime
helper examples live in
[contracts-typescript-api.md](./contracts-typescript-api.md). That document is
the canonical API spec.

This document only constrains the architectural direction behind that API:

- kind-specific helpers are the supported public authoring entrypoints for
  normal local contract modules
- `@qlever-llc/trellis/contracts` exposes the preferred contract authoring
  helpers used by apps and services while returning contract objects with
  projected API views and manifest metadata
- `@qlever-llc/trellis` remains the runtime package for
  `TrellisClient.connect(...)`, auth helpers, and `Result`
- runtime connection helpers live in `@qlever-llc/trellis` and
  `@qlever-llc/trellis/service*`
- locally defined contracts and generated SDK modules share one compatible
  contract-module shape
- `uses` declarations remain SDK-backed and contract-driven rather than
  handwritten dependency objects in normal usage
- the participant runtime surface remains derived from `API.owned`, `API.used`,
  and `API.trellis`
- generated TypeScript SDKs include consumer client facade types that apps and
  peer services can use as concrete editor-friendly views over the runtime
  client
- public documentation should lead with `TrellisClient.connect(...)`,
  `TrellisService.connect(...)`, and `TrellisDevice.connect(...)`; public
  service author guidance should not point at Trellis-internal bootstrap paths
- emitted manifests remain canonical `trellis.contract.v1` artifacts; this
  design does not create a parallel manifest format
- generated SDK outputs still need the richer contract module shape with
  `CONTRACT`, `CONTRACT_ID`, `CONTRACT_DIGEST`, projected API views, and typed
  `use(...)` helpers

The replacement rule also remains the same: normal TypeScript user code should
not need to use `defineContractSource(...)`, `buildContractArtifacts(...)`, or
`mergeApis(...)` directly once this model is complete.

### User approval semantics

Contracts are also the user-facing identity and approval surface for user-facing
clients.

Rules:

- `displayName` and `description` are what approval and session-management UIs
  show to the user
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

- `service.request("Trellis.Catalog", {})` is valid because it is declared in
  `uses`
- `service.request("Auth.Me", {})` is a type error unless it is also declared in
  `uses` directly or through `auth.useDefaults(...)`
- `service.trellis.mount("Trellis.Catalog", ...)` is a type error because that
  RPC is used, not owned
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
