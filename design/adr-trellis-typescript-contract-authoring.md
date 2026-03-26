# ADR: Trellis TypeScript Contract Authoring

## Status

Proposed

## Prerequisites

- [adr-trellis-patterns.md](./adr-trellis-patterns.md) - service and app boundaries
- [adr-trellis-contracts-catalog.md](./adr-trellis-contracts-catalog.md) - canonical manifest and `uses` semantics
- [adr-trellis-cli.md](./adr-trellis-cli.md) - source-first CLI boundary

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

## Decision

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

The contract authoring API lives in `@qlever-llc/trellis-contracts` because contracts are an
architectural concept, not a transport-only client helper.

`@qlever-llc/trellis-contracts` is the high-level authoring API for contract modules.

Rules:

- `@qlever-llc/trellis-contracts` owns the contract authoring types and helpers
- `@qlever-llc/trellis-trellis` consumes contract objects for runtime client helpers
- `@qlever-llc/trellis-server/node` and `@qlever-llc/trellis-server/deno` consume contract objects for service runtime helpers

### 3) SDK-driven `uses`

TypeScript authors do not hand-write remote dependency contract ids in normal use.

Generated SDK modules export a contract module object that includes:

- contract metadata
- projected API metadata
- a typed `use(...)` helper for declaring `uses`

The required user-facing contract metadata is:

- `displayName`
- `description`
- `kind`

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

### 4) TypeScript enforcement of declared permissions

The TypeScript type system must enforce both of these rules:

- a referenced remote RPC, event, or subject must exist on the imported SDK module
- a participant may only call, publish, or subscribe to remote operations that are explicitly declared in its local contract `uses`

Consequences:

- if an SDK does not expose `Auth.Nope`, then `auth.use({ events: { subscribe: ["Auth.Nope"] } })` is a type error
- if `Auth.Me` exists in the imported SDK but the local contract did not declare it in `uses`, then `trellis.request("Auth.Me", ...)` is a type error for that participant

No separate linting or external analysis tool is required for this workflow. The
contract object itself defines the allowed TypeScript runtime surface.

### 5) Derived runtime API surfaces

The contract definition produces three distinct projected API views:

- `API.owned` - the RPCs, events, and subjects owned by the local participant and therefore mountable or publishable as owner behavior
- `API.used` - the subset of remote SDK APIs explicitly permitted by `uses`
- `API.trellis` - the merged runtime surface used for outbound `request`, `publish`, and `subscribe` operations

Rules:

- `API.owned` derives only from the local contract's `rpc`, `events`, and `subjects`
- `API.used` derives only from the remote SDK operations explicitly selected through `use(...)`
- `API.trellis` is the only general outbound runtime API surface
- server-side handler registration uses `API.owned`, not `API.trellis`

This preserves the distinction between what a participant owns and what it is merely
allowed to use.

### 6) Runtime connection helpers are contract-driven

TypeScript runtime helpers consume contract objects directly.

Examples:

```ts
const app = defineContract({ ... });
const client = createClient(app, nc, auth);

const serviceContract = defineContract({ ... });
const service = await connectService(serviceContract, "activity", opts);
```

Rules:

- the client or service `trellis` object is typed from `contract.API.trellis`
- server handler registration is typed from `contract.API.owned`
- callers do not manually assemble runtime API arrays for normal usage
- Trellis-specific bootstrap exceptions should stay in Trellis platform code and use lower-level runtime APIs directly rather than becoming general public service helpers

### 7) Scope of contracts beyond connect

Contracts matter beyond the initial connect phase.

In TypeScript they remain the source for:

- emitted manifest generation
- runtime call and subscribe typing
- owned handler and publisher typing
- `CONTRACT_ID` and digest metadata used for discovery and binding lookup

This ADR therefore treats the contract object as the primary participant definition,
not as a one-time connection option.

## Specification

### Public package exports

`@qlever-llc/trellis-contracts` is the normative home for the TypeScript contract authoring
API.

It exports the public contract-first surface:

- `defineContract(...)`
- the contract module and use-spec types needed by generated SDKs

`@qlever-llc/trellis-contracts` exports `defineContract(...)` and related public contract
types for convenience.

Runtime helpers live in the runtime packages, not in `@qlever-llc/trellis-contracts` itself.

Rules:

- new user-facing TypeScript contract authoring APIs are defined in `@qlever-llc/trellis-contracts`
- `@qlever-llc/trellis-trellis` must not introduce a second competing contract definition model
- documentation should prefer the owning package import path instead of convenience re-exports

### TypeScript API surface

The ADR should define the intended public TypeScript shape closely enough that
implementation work does not have to rediscover the architecture.

The expected public surface is:

- `defineContract(...)` as the primary authoring entrypoint
- generated SDK contract modules that export `CONTRACT`, `CONTRACT_ID`, `CONTRACT_DIGEST`, `API`, and `use(...)`
- contract-driven runtime helpers such as `createClient(contract, ...)` and `connectService(contract, ...)`

Canonical public shape:

```ts
type TrellisApiLike = {
  rpc: Record<string, unknown>;
  events: Record<string, unknown>;
  subjects: Record<string, unknown>;
};

type EmptyApi = {
  rpc: {};
  events: {};
  subjects: {};
};

type ContractApiViews<
  TOwnedApi extends TrellisApiLike,
  TUsedApi extends TrellisApiLike,
  TTrellisApi extends TrellisApiLike,
> = {
  owned: TOwnedApi;
  used: TUsedApi;
  trellis: TTrellisApi;
};

type UseSpec<TApi extends TrellisApiLike> = {
  rpc?: {
    call?: readonly (keyof TApi["rpc"] & string)[];
  };
  events?: {
    publish?: readonly (keyof TApi["events"] & string)[];
    subscribe?: readonly (keyof TApi["events"] & string)[];
  };
  subjects?: {
    publish?: readonly (keyof TApi["subjects"] & string)[];
    subscribe?: readonly (keyof TApi["subjects"] & string)[];
  };
};

type ContractDependencyUse<
  TContractId extends string,
  TApi extends TrellisApiLike,
> = {
  contract: TContractId;
  rpc?: { call?: readonly (keyof TApi["rpc"] & string)[] };
  events?: {
    publish?: readonly (keyof TApi["events"] & string)[];
    subscribe?: readonly (keyof TApi["events"] & string)[];
  };
  subjects?: {
    publish?: readonly (keyof TApi["subjects"] & string)[];
    subscribe?: readonly (keyof TApi["subjects"] & string)[];
  };
};

type SdkContractModule<
  TContractId extends string,
  TOwnedApi extends TrellisApiLike,
> = {
  CONTRACT_ID: TContractId;
  CONTRACT: unknown;
  CONTRACT_DIGEST: string;
  API: ContractApiViews<TOwnedApi, EmptyApi, TOwnedApi>;
  use(spec: UseSpec<TOwnedApi>): ContractDependencyUse<TContractId, TOwnedApi>;
};

type DefinedContract<
  TOwnedApi extends TrellisApiLike,
  TUsedApi extends TrellisApiLike,
  TTrellisApi extends TrellisApiLike,
> = {
  CONTRACT_ID: string;
  CONTRACT: unknown;
  CONTRACT_DIGEST: string;
  API: ContractApiViews<TOwnedApi, TUsedApi, TTrellisApi>;
  use(spec: UseSpec<TOwnedApi>): ContractDependencyUse<string, TOwnedApi>;
  createClient(...args: unknown[]): unknown;
  connectService(...args: unknown[]): Promise<unknown>;
};

declare function defineContract(...args: unknown[]): DefinedContract<any, any, any>;
```

Illustrative usage:

```ts
import { defineContract } from "@qlever-llc/trellis-contracts";
import { auth } from "@qlever-llc/trellis-sdk-auth";
import { core } from "@qlever-llc/trellis-sdk-core";

export const activity = defineContract({
  id: "trellis.activity@v1",
  displayName: "Activity Service",
  description: "Serve activity RPCs and publish activity change events.",
  kind: "service",
  uses: {
    core: core.use({
      rpc: {
        call: ["Trellis.Catalog", "Trellis.Bindings.Get"],
      },
    }),
    auth: auth.use({
      events: {
        subscribe: ["Auth.Connect", "Auth.Disconnect"],
      },
    }),
  },
  rpc: {
    "Activity.List": {
      version: "v1",
      inputSchema: ActivityListRequestSchema,
      outputSchema: ActivityListResponseSchema,
    },
  },
  events: {
    "Activity.Changed": {
      version: "v1",
      eventSchema: ActivityChangedSchema,
    },
  },
});

const service = await activity.connectService("activity", opts);
await service.trellis.request("Trellis.Catalog", {});
await service.trellis.mount("Activity.List", async (req) => Result.ok({ items: [] }));
```

### `defineContract(...)` input model

`defineContract(...)` accepts the local participant definition plus SDK-backed
dependency declarations under `uses`.

Rules:

- `id` remains the stable machine identity for the contract lineage
- `displayName`, `description`, and `kind` are required and are part of the canonical manifest
- local `rpc`, `events`, `subjects`, `errors`, and `resources` remain the source for emitted owned contract content
- `uses` entries are expressed through SDK `use(...)` helpers rather than hand-written dependency objects in normal TypeScript code
- a participant MAY have no owned `rpc`, `events`, or `subjects`
- a participant MAY have no `uses`
- the defined contract computes and exposes `CONTRACT_DIGEST` from the emitted canonical manifest

This supports services, apps, CLIs, browser clients, and other participants with
one model.

### Contract module shape

Generated SDK modules and locally defined contracts must share a compatible module
shape so they can participate in the same ecosystem.

Rules:

- generated SDK modules export an `SdkContractModule` shape
- a locally defined contract object MUST be usable anywhere an SDK contract module is expected
- a locally defined contract object therefore also exposes `CONTRACT_DIGEST` and typed `use(...)`
- local contracts additionally expose runtime connection helpers
- this shared shape allows one local contract to be used as a dependency of another local contract in the same repo without a special path

### Derived APIs

`defineContract(...)` derives three projected API surfaces:

- `API.owned`
- `API.used`
- `API.trellis`

Derivation rules:

- `API.owned` is projected from the local owned contract declarations only
- `API.used` is projected by selecting only the operations named in SDK-backed `uses`
- `API.trellis` is the merge of `API.used` and `API.owned`
- duplicate logical keys across merged used and owned APIs are rejected during contract definition
- if an operation exists in a dependency SDK but is not selected in `uses`, it is absent from `API.used` and absent from `API.trellis`

### Typing rules

The public TypeScript API must preserve these rules:

- `sdk.use(...)` only accepts operations that exist on that SDK module
- `defineContract(...)` derives `API.used` only from explicitly declared `uses`
- outbound `request`, `publish`, and subscription helpers are typed from `API.trellis`
- inbound handler registration is typed from `API.owned`
- local owned operations are available in `API.trellis` without repeating them under `uses`
- remote operations are not available in `API.trellis` unless explicitly declared in `uses`
- an operation declared under the wrong dependency SDK is a type error
- a dependency contract id is inferred from the SDK module rather than authored manually in normal TS usage

### Runtime helper behavior

Contract-driven runtime helpers must use the projected API surfaces directly.

Rules:

- `contract.createClient(...)` returns a client typed from `contract.API.trellis`
- `contract.connectService(...)` returns a service whose outbound `trellis` surface is typed from `contract.API.trellis`
- service-side handler registration methods such as `mount(...)` are typed from `contract.API.owned`
- callers do not pass manual API arrays into those helpers for normal usage
- runtime helpers do not implicitly inject extra API modules outside the contract-derived surface

### Runtime and compile-time validation

Compile-time typing is required but is not sufficient on its own.

Implementations must also validate at runtime that:

- every `uses` entry came from a contract module helper compatible with the expected shape
- every selected operation exists on the referenced SDK module's API metadata
- duplicate logical RPC, event, or subject keys are rejected when deriving `API.trellis`

Runtime validation exists to preserve correctness when TypeScript types are erased or
when JavaScript consumers use the same APIs.

### Emitted manifest behavior

`defineContract(...)` still emits a normal `trellis.contract.v1` manifest.

Rules:

- the emitted manifest shape is unchanged by this ADR
- `uses` entries emitted into the manifest preserve the canonical JSON shape described in `adr-trellis-contracts-catalog.md`
- SDK-backed `use(...)` helpers are an authoring convenience, not a new manifest format

### Generated TS SDK requirements

TS SDK generation must emit a richer contract module than the current constants-plus-API surface.

Generated SDK outputs must include:

- `CONTRACT_ID`
- `CONTRACT_DIGEST`
- `CONTRACT`
- `API.owned`
- `API.used` as an empty API projection
- `API.trellis` equal to `API.owned`
- typed `use(...)`

Generated SDK outputs may continue to expose request, response, event, and schema
types as they do today.

### Replacement rule

When this model lands, normal TypeScript user code should not need to call any of
the following directly:

- `defineContractSource(...)`
- `buildContractArtifacts(...)`
- `mergeApis(...)`

Those become implementation details to delete or fully hide behind the new public
API, not parallel authoring paths.

### User approval semantics

Contracts are also the user-facing identity and approval surface for user-facing clients.

Rules:

- `displayName`, `description`, and `kind` are what approval and session-management UIs show to the user
- user approval is granted to a specific contract digest, not merely to a contract `id`
- if a client changes its contract and therefore changes its digest, it must be approved again
- `id` remains useful for lineage and code generation, but approval is bound to the exact concrete contract artifact identified by `CONTRACT_DIGEST`

Expected type behavior:

- `service.trellis.request("Trellis.Catalog", {})` is valid because it is declared in `uses`
- `service.trellis.request("Auth.Me", {})` is a type error unless it is also declared in `uses`
- `service.trellis.mount("Trellis.Catalog", ...)` is a type error because that RPC is used, not owned
- `auth.use({ rpc: { call: ["Trellis.Catalog"] } })` is a type error because that RPC is not part of `trellis.auth@v1`

### Migration and rollout

Implementation should proceed in this order:

1. add the new `defineContract(...)` and shared contract module types in `@qlever-llc/trellis-contracts`
2. re-export that surface from `@qlever-llc/trellis-trellis`
3. update TS SDK generation to emit the richer contract module shape with nested API views and typed `use(...)`
4. update runtime helpers to consume contract objects directly for client and service creation
5. migrate in-repo contracts and bootstrap code to the new model
6. remove the old public TypeScript authoring and manual API merge entrypoints

Rules:

- the new contract-first API must be fully capable before the old public APIs are removed
- migration should preserve the emitted manifest format and CLI contract workflow
- after migration, documentation and examples should use only the new contract-first surface

## Consequences

### Benefits

- one TypeScript authoring surface for manifests and runtime APIs
- imported SDKs become the typed dependency vocabulary for `uses`
- permission declarations and runtime callability stay aligned
- apps, CLIs, browser clients, and services all use the same participant model
- fewer runtime failures caused by forgetting to manually merge the right API modules
- clearer distinction between owned surfaces and used surfaces

### Trade-offs

- the TypeScript generic surface becomes more sophisticated
- TS SDK generation must emit richer helper objects than the current `API` and constants only surface
- migrating existing code will require changing bootstrap and contract authoring patterns

## References

- `design/adr-trellis-contracts-catalog.md`
- `design/adr-trellis-cli.md`
