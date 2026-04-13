---
title: Trellis TypeScript Contract Authoring
description: TypeScript contract authoring architecture centered on defineContract, uses, and derived contract views.
order: 20
---

# Design: Trellis TypeScript Contract Authoring

## Prerequisites

- [../core/trellis-patterns.md](./../core/trellis-patterns.md) - service and app boundaries
- [trellis-contracts-catalog.md](./trellis-contracts-catalog.md) - canonical manifest and `uses` semantics
- [../tooling/trellis-cli.md](./../tooling/trellis-cli.md) - source-first CLI boundary

## Context

The current TypeScript contract ergonomics are split across two separate concepts:

- `defineContractSource(...)` is the local authoring helper for a contract manifest
- `mergeApis(...)` is the runtime helper used to assemble the `trellis` API surface from multiple SDK modules

That split has several problems:

- authors must understand and hand-write raw `uses.contract` ids and operation name strings for remote services
- imported SDK modules do not help type-check the `uses` section of the local contract source
- runtime callability is determined by a manually merged API list rather than by the contract definition itself
- a real remote RPC or event may exist in an SDK but still fail at runtime because it was omitted from the local merged API
- the contract is the permission blueprint for a participant, but the current TypeScript runtime surface is not derived from that blueprint

This is especially awkward because Trellis participants are broader than long-running services.
Apps, CLIs, browser clients, and other callers also connect to Trellis and need a
typed declaration of what they own and what they use.

## Design

Trellis adopts a contract-first TypeScript model.

Every TypeScript participant that connects to Trellis defines one contract through a
single high-level API. That contract becomes the source of truth for both:

- the emitted `trellis.contract.v1` release artifact
- the TypeScript `trellis` runtime API surface available to that participant

### 1) Primary authoring API

TypeScript authoring uses one primary public helper:

- `defineContract(...)`

This helper replaces the current public authoring split between:

- `defineContractSource(...)`
- `buildContractArtifacts(...)`
- `mergeApis(...)`

Those older helpers are not retained as supported public APIs. If the new model is
insufficient, the new model must be extended rather than requiring callers to fall
back to lower-level escape hatches.

### 2) Package boundary

The preferred contract authoring API is exposed from `@qlever-llc/trellis/contracts` so contract-source modules can stay independent from runtime bootstrap concerns.

`@qlever-llc/trellis` remains the canonical runtime package for connection helpers such as `TrellisClient.connect(...)`, auth helpers, and `Result`.

Rules:

- `@qlever-llc/trellis/contracts` is the preferred package for contract authoring and broader contract-model helpers, and its `defineContract(...)` return value remains usable anywhere a runtime contract is expected
- `@qlever-llc/trellis` is the canonical package for runtime client connection helpers
- `@qlever-llc/trellis/server/node` and `@qlever-llc/trellis/server/deno` consume contract objects for service runtime helpers

### 3) SDK-driven `uses`

TypeScript authors do not hand-write remote dependency contract ids in normal use.

Generated SDK modules export a contract module object that includes:

- contract metadata
- projected API metadata
- a typed `use(...)` helper for declaring `uses`

The required user-facing contract metadata is:

- `displayName`
- `description`

Example shape:

```ts
export const core = {
  CONTRACT_ID,
  CONTRACT,
  CONTRACT_DIGEST,
  API: {
    owned: API,
    used: { rpc: {}, events: {}, subjects: {} },
    trellis: API,
  },
  use(spec) { ... },
} as const;
```

The `use(...)` helper:

- fills in the target `contract` id automatically from the SDK
- restricts `rpc.call` to keys from that SDK's owned RPC surface
- restricts `events.publish` and `events.subscribe` to keys from that SDK's owned event surface
- restricts `subjects.publish` and `subjects.subscribe` to keys from that SDK's owned raw subject surface

This makes imported SDK modules the source of truth for remote dependency names in
TypeScript authoring.

Some SDKs may also expose convenience wrappers around `use(...)`. For example,
`@qlever-llc/trellis/sdk/auth` exposes `auth.useDefaults(...)`, which adds the
baseline user-session RPC declarations `Auth.Me`, `Auth.Logout`, and
`Auth.RenewBindingToken` before merging any additional requested auth surfaces.

### 4) TypeScript enforcement of declared permissions

The TypeScript type system must enforce both of these rules:

- a referenced remote operation, RPC, event, or subject must exist on the imported SDK module
- a participant may only invoke, call, publish, or subscribe to remote operations that are explicitly declared in its local contract `uses`

This makes two important guarantees in normal authoring: if an SDK does not expose `Auth.Nope`, then `auth.use({ events: { subscribe: ["Auth.Nope"] } })` is a type error, and if `Auth.Me` exists in the imported SDK but the local contract did not declare it in `uses` directly or through `auth.useDefaults(...)`, then `trellis.request("Auth.Me", ...)` is a type error for that participant.

No separate linting or external analysis tool is required for this workflow. The
contract object itself defines the allowed TypeScript runtime surface.

### 5) Derived runtime API surfaces

The contract definition produces three distinct projected API views:

- `API.owned` - the operations, RPCs, events, and subjects owned by the local participant and therefore mountable or publishable as owner behavior
- `API.used` - the subset of remote SDK APIs explicitly permitted by `uses`
- `API.trellis` - the merged runtime surface used for outbound `operation(...).start(...)`, `request`, `publish`, and `subscribe` operations

Rules:

- `API.owned` derives only from the local contract's `operations`, `rpc`, `events`, and `subjects`
- `API.used` derives only from the remote SDK operations explicitly selected through `use(...)`
- `API.trellis` is the only general outbound runtime API surface
- server-side handler registration uses `API.owned`, not `API.trellis`

This preserves the distinction between what a participant owns and what it is merely
allowed to use.

### 6) Runtime connection helpers are contract-driven

TypeScript runtime helpers consume contract objects directly.

Examples:

```ts
import { TrellisClient } from "@qlever-llc/trellis";
import { TrellisService } from "@qlever-llc/trellis/server/deno";

const app = defineContract({ ... });
const client = await TrellisClient.connect({
  trellisUrl: "https://trellis.example.com",
  contract: app,
});

const serviceContract = defineContract({ ... });
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
- callers do not manually assemble runtime API arrays for normal usage
- locally authored contracts should normally export the `defineContract(...)` return value directly; do not wrap it in a handwritten default-export object that reassembles `CONTRACT_ID`, `CONTRACT`, `CONTRACT_DIGEST`, and `API`
- Trellis-specific bootstrap exceptions should stay in Trellis platform code and use lower-level runtime APIs directly rather than becoming general public service helpers

### 7) Scope of contracts beyond connect

Contracts matter beyond the initial connect phase.

In TypeScript they remain the source for:

- emitted manifest generation
- runtime operation, call, and subscribe typing
- owned handler and publisher typing
- `CONTRACT_ID` and digest metadata used for discovery and binding lookup

This document therefore treats the contract object as the primary participant definition,
not as a one-time connection option.

## Normative Surface Ownership

The exact TypeScript public signatures, contract-module types, and runtime helper examples live in [contracts-typescript-api.md](./contracts-typescript-api.md). That document is the canonical API spec.

This document only constrains the architectural direction behind that API:

- `defineContract(...)` remains the one supported public authoring entrypoint
- `@qlever-llc/trellis/contracts` exposes the preferred contract authoring helpers used by apps and services while returning contract objects with projected API views and manifest metadata
- `@qlever-llc/trellis` remains the runtime package for `TrellisClient.connect(...)`, auth helpers, and `Result`
- runtime connection helpers live in `@qlever-llc/trellis` and `@qlever-llc/trellis/server*`
- locally defined contracts and generated SDK modules share one compatible contract-module shape
- `uses` declarations remain SDK-backed and contract-driven rather than handwritten dependency objects in normal usage
- the participant runtime surface remains derived from `API.owned`, `API.used`, and `API.trellis`
- public documentation should lead with `TrellisClient.connect(...)`, `TrellisService.connect(...)`, and `TrellisDevice.connect(...)`
- emitted manifests remain canonical `trellis.contract.v1` artifacts; this design does not create a parallel manifest format
- generated SDK outputs still need the richer contract module shape with `CONTRACT`, `CONTRACT_ID`, `CONTRACT_DIGEST`, projected API views, and typed `use(...)` helpers

The replacement rule also remains the same: normal TypeScript user code should not need to use `defineContractSource(...)`, `buildContractArtifacts(...)`, or `mergeApis(...)` directly once this model is complete.

### User approval semantics

Contracts are also the user-facing identity and approval surface for user-facing clients.

Rules:

- `displayName` and `description` are what approval and session-management UIs show to the user
- browser apps send their contract manifest during login so auth can plan routing and approval; they are approved per-user and are not installed like services
- user approval is granted to a specific contract digest, not merely to a contract `id`
- if a client changes its contract and therefore changes its digest, it must be approved again
- `id` remains useful for lineage and code generation, but approval is bound to the exact concrete contract artifact identified by `CONTRACT_DIGEST`
- the canonical manifest and digest still belong to the release boundary, but normal app and service repos should generate or verify them inside `dev`, `build`, or CI tasks rather than teaching users a separate manual manifest step for routine usage

Expected type behavior:

- `service.requestOrThrow("Trellis.Catalog", {})` is valid because it is declared in `uses`
- `service.requestOrThrow("Auth.Me", {})` is a type error unless it is also declared in `uses` directly or through `auth.useDefaults(...)`
- `service.trellis.mount("Trellis.Catalog", ...)` is a type error because that RPC is used, not owned
- `auth.use({ rpc: { call: ["Trellis.Catalog"] } })` is a type error because that RPC is not part of `trellis.auth@v1`

### Migration and rollout

Implementation should proceed in this order:

1. add the new `defineContract(...)` and shared contract module types in the contract-model layer
2. expose that surface canonically from `@qlever-llc/trellis`
3. update TS SDK generation to emit the richer contract module shape with nested API views and typed `use(...)`
4. update runtime helpers to consume contract objects directly for client and service creation
5. migrate in-repo contracts and bootstrap code to the new model
6. remove the old public TypeScript authoring and manual API merge entrypoints

Rules:

- the new contract-first API must be fully capable before the old public APIs are removed
- migration should preserve the emitted manifest format and CLI contract workflow
- after migration, documentation and examples should use only the new contract-first surface

## References

- `design/contracts/trellis-contracts-catalog.md`
- `design/tooling/trellis-cli.md`
