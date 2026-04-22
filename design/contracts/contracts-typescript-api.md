---
title: Contracts TypeScript API
description: Public TypeScript surface for contract authoring, generated SDK modules, and contract-driven runtime helpers.
order: 40
---

# Design: Contracts TypeScript API

## Prerequisites

- [trellis-contracts-catalog.md](./trellis-contracts-catalog.md) - canonical
  manifest and permission model
- [trellis-typescript-contract-authoring.md](./trellis-typescript-contract-authoring.md) -
  TypeScript contract architecture and rationale
- [../core/type-system-patterns.md](./../core/type-system-patterns.md) - Result
  and error-model guidance

## Scope

This document defines the normative TypeScript public API surface for contract
authoring, generated SDK modules, and contract-driven runtime helpers.

It does not redefine the canonical manifest model or runtime permission
derivation.

## Design Rules

- specialized helpers such as `defineServiceContract(...)` and
  `defineAppContract(...)` are the primary TypeScript authoring entrypoints
- generated SDK modules and local contracts share one compatible contract-module
  shape
- local `uses` declarations are expressed through SDK-backed `use(...)` helpers
- public runtime helpers are contract-driven and typed from the local contract
- declared contract state stores project to `trellis.state` rather than to
  `API.trellis`
- service-owned resource helpers should prefer small handle-based APIs whose
  failable public methods return `Result`
- TypeScript is the compile-time enforcement layer for declared remote
  permissions

## Public Package Surface

`@qlever-llc/trellis` is the canonical everyday package for contract source
modules that only need the kind-specific helpers plus runtime-facing types.

`@qlever-llc/trellis/contracts` remains the advanced contract-system package for
broader contract-model helpers, canonicalization, and SDK/codegen-facing types.

It exports:

- `defineServiceContract(...)`
- `defineAppContract(...)`
- `defineAgentContract(...)`
- `defineDeviceContract(...)`
- `defineError(...)`
- contract-module and use-spec types needed by generated SDKs

The kind-specific contract helpers return contract objects with projected API
views and manifest metadata. The canonical public bootstrap helpers live in
`@qlever-llc/trellis` and `@qlever-llc/trellis/host*`.

Rules:

- normal contract source modules should prefer `@qlever-llc/trellis`
- runtime client helpers should prefer `@qlever-llc/trellis`
- advanced contract-model helpers should live on and be imported from
  `@qlever-llc/trellis/contracts`

## Canonical TypeScript Shape

```ts
type TrellisApiLike = {
  operations: Record<string, unknown>;
  rpc: Record<string, unknown>;
  events: Record<string, unknown>;
  subjects: Record<string, unknown>;
};

type EmptyApi = {
  operations: {};
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
  operations?: {
    call?: readonly (keyof TApi["operations"] & string)[];
  };
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
  operations?: { call?: readonly (keyof TApi["operations"] & string)[] };
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
};

type ContractRefBuilder = {
  schema(name: string): { schema: string };
  error(name: string): string;
};

type SerializableErrorData = {
  id: string;
  type: string;
  message: string;
  context?: Record<string, unknown>;
  traceId?: string;
} & Record<string, unknown>;

declare function defineServiceContract<
  TRegistry extends object,
  TBody extends object,
>(
  registry: TRegistry,
  build: (ref: ContractRefBuilder) => TBody,
): DefinedContract<any, any, any>;

declare function defineAppContract<
  TRegistry extends object,
  TBody extends object,
>(
  registry: TRegistry,
  build: (ref: ContractRefBuilder) => TBody,
): DefinedContract<any, any, any>;

declare function defineAppContract<TBody extends object>(
  build: () => TBody,
): DefinedContract<any, any, any>;

declare function defineAgentContract<
  TRegistry extends object,
  TBody extends object,
>(
  registry: TRegistry,
  build: (ref: ContractRefBuilder) => TBody,
): DefinedContract<any, any, any>;

declare function defineAgentContract<TBody extends object>(
  build: () => TBody,
): DefinedContract<any, any, any>;

declare function defineDeviceContract<
  TRegistry extends object,
  TBody extends object,
>(
  registry: TRegistry,
  build: (ref: ContractRefBuilder) => TBody,
): DefinedContract<any, any, any>;

declare function defineDeviceContract<TBody extends object>(
  build: () => TBody,
): DefinedContract<any, any, any>;

```

## Illustrative Usage

```ts
import { TrellisClient } from "@qlever-llc/trellis";
import { defineServiceContract } from "@qlever-llc/trellis/contracts";
import { auth, core } from "@qlever-llc/trellis-sdk";

const schemas = {
  ActivityImportRequest: ActivityImportRequestSchema,
  ActivityImportProgress: ActivityImportProgressSchema,
  ActivityImportResult: ActivityImportResultSchema,
  ActivityListRequest: ActivityListRequestSchema,
  ActivityListResponse: ActivityListResponseSchema,
  ActivityChanged: ActivityChangedSchema,
} as const;

export const activity = defineServiceContract(
  { schemas },
  (ref) => ({
    id: "trellis.activity@v1",
    displayName: "Activity Service",
    description: "Serve activity RPCs and publish activity change events.",
    uses: {
      core: core.use({
        rpc: {
          call: ["Trellis.Catalog", "Trellis.Bindings.Get"],
        },
      }),
      auth: auth.useDefaults({
        events: {
          subscribe: ["Auth.Connect", "Auth.Disconnect"],
        },
      }),
    },
    operations: {
      "Activity.Import": {
        version: "v1",
        input: ref.schema("ActivityImportRequest"),
        progress: ref.schema("ActivityImportProgress"),
        output: ref.schema("ActivityImportResult"),
      },
    },
    rpc: {
      "Activity.List": {
        version: "v1",
        input: ref.schema("ActivityListRequest"),
        output: ref.schema("ActivityListResponse"),
      },
    },
    events: {
      "Activity.Changed": {
        version: "v1",
        event: ref.schema("ActivityChanged"),
      },
    },
  }),
);

export default activity;

const client = await TrellisClient.connect({
  trellisUrl: "https://trellis.example.com",
  contract: activity,
  name: "activity-agent",
});
```

## Contract Helper Inputs

Rules:

- `id` remains the stable machine identity for the contract lineage
- `displayName` and `description` are required and are part of the canonical
  manifest
- local service contract files should prefer
  `defineServiceContract({ schemas, errors }, (ref) => ({ ... }))`
- local app contract files should prefer
  `defineAppContract({ schemas }, (ref) => ({ ... }))` when they declare
  schema-backed state and `defineAppContract(() => ({ ... }))` otherwise
- local agent contract files should prefer
  `defineAgentContract({ schemas }, (ref) => ({ ... }))` when they declare
  schema-backed state and `defineAgentContract(() => ({ ... }))` otherwise
- local device contract files should prefer
  `defineDeviceContract({ schemas }, (ref) => ({ ... }))` when they declare
  schema-backed state and `defineDeviceContract(() => ({ ... }))` otherwise
- contract source examples should export the specialized helper result directly
  and use that object for `contract.API`, `contract.use(...)`, and runtime
  bootstrap
- local `operations`, `rpc`, `events`, `subjects`, `state`, `errors`, and
  `resources` remain the source for emitted owned contract content
- service contract modules declare reusable schemas in a top-level `schemas` map
  and should usually reference them through `ref.schema(...)`
- client-style contracts that declare top-level `state` should also use a local
  `schemas` registry and `ref.schema(...)`
- `uses` entries are expressed through SDK `use(...)` helpers rather than
  handwritten dependency objects in normal TypeScript code
- SDK-specific convenience helpers such as `auth.useDefaults(...)` are allowed
  when they still produce a normal `uses` declaration
- local transportable service RPC errors are declared through top-level `errors`
  entries created with `defineError(...)`
- RPC `errors: [...]` entries should usually use `ref.error(...)` for both local
  declarations and built-in Trellis RPC errors
- a participant MAY have no owned `operations`, `rpc`, `events`, or `subjects`
- a participant MAY have no `uses`
- the defined contract computes and exposes `CONTRACT_DIGEST` from the emitted
  canonical manifest

## Local RPC Errors

Transportable service-local RPC errors should normally be authored through the
generated class factory.

TypeScript authoring shape:

```ts
import {
  defineError,
  defineServiceContract,
} from "@qlever-llc/trellis";

export const NotFoundError = defineError({
  type: "NotFoundError",
  fields: {
    resource: Type.String(),
    resourceId: Type.String(),
  },
  message: ({ resource, resourceId }) => `${resource} ${resourceId} not found`,
});

export const krishi = defineServiceContract(
  {
    schemas: {
      GetWorkspaceInput: GetWorkspaceInputSchema,
      Workspace: WorkspaceSchema,
    },
    errors: {
      NotFoundError,
    },
  },
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

- `defineError(...)` is the preferred ergonomic path for new local service
  errors
- the generated class `type` is the on-wire error `type`
- `defineServiceContract(...)` may derive the emitted local error schema entry
  automatically from local error runtime metadata when the schema is not already
  present in the local `schemas` map
- authors may still include the error schema explicitly in the top-level
  `schemas` map when they want a stable local schema key or need to reference it
  elsewhere in the contract
- the `errors` map key is the error class export name used by RPC
  `errors: [...]`, so `ref.error(...)` should usually match the class name
- builder-style contract authoring should reference both local and built-in RPC
  errors through `ref.error(...)`
- callers receive declared remote errors as reconstructed runtime instances of
  the declared class
- undeclared or unknown remote error payloads still fall back to `RemoteError`

## Module Compatibility Rules

Generated SDK modules and locally defined contracts must share a compatible
module shape.

Rules:

- generated SDK modules export an `SdkContractModule` shape
- a locally defined contract object MUST be usable anywhere an SDK contract
  module is expected
- a locally defined contract object therefore also exposes `CONTRACT_DIGEST` and
  typed `use(...)`
- local contracts additionally expose runtime connection helpers

## Derived API Views

Contract helpers derive three projected API surfaces:

- `API.owned`
- `API.used`
- `API.trellis`

Rules:

- `API.owned` is projected from the local owned contract declarations only
- `API.used` is projected by selecting only the operations named in SDK-backed
  `uses`
- `API.trellis` is the merge of `API.used` and `API.owned`
- the merged surface is the only general outbound runtime namespace
- owned registration surfaces are derived from `API.owned`, not `API.trellis`

## Typing Rules

- a referenced remote operation, RPC, event, or subject must exist on the
  imported SDK module
- a participant may only invoke, call, publish, or subscribe to remote APIs
  explicitly declared in local `uses`
- omitted `uses` entries remove the corresponding generated runtime methods
- SDK-backed `use(...)` declarations are the source of compile-time allowed-API
  filtering

## Runtime Helper Behavior

Contract-driven runtime helpers include `TrellisClient.connect(...)`,
`TrellisService.connect(...)`, and `TrellisDevice.connect(...)`.

Declared state stores project into a separate runtime surface at
`trellis.state.<storeName>`.

That state surface is documented in `../state/state-typescript-api.md`.

Public TypeScript documentation should lead with `TrellisClient.connect(...)`,
`TrellisService.connect(...)`, and `TrellisDevice.connect(...)` rather than
lower-level runtime construction helpers.

Rules:

- returned runtimes are typed from the local contract's `API.trellis` and
  `API.owned`
- returned runtimes expose typed operation, request, publish, and subscribe
  helpers derived from the contract
- request and operation helpers may still fail with `TransportError` for
  Trellis transport/runtime boundary failures even when that error is not listed
  in the contract's declared remote `errors: [...]`
- `UnexpectedError` is reserved for true internal or otherwise unexpected
  runtime conditions rather than normal Trellis transport failures
- `service.trellis.mount(...)` handlers receive already-validated typed payloads
  and may return either `Result` or `Promise<Result>`
- server-side extracted RPC handler aliases should use the server package so the
  third parameter includes service-only helpers such as `kv`, `store`, and
  transfer-aware operation contexts without widening browser-safe root runtime
  types
- returned runtimes expose transfer through the transfer builder
  `operation(...).input(...).transfer(...).start()`, not through a standalone
  `trellis.transfer(...)` entrypoint
- runtime helpers must not widen the callable surface beyond what the contract
  allows
- service-side helpers must not expose used remote APIs as mountable local
  handlers

## Validation And Manifest Behavior

Rules:

- TypeScript compile-time typing enforces declared remote usage shape
- runtime validation still enforces canonical manifest, auth, and subject
  ownership rules
- emitted manifests remain `trellis.contract.v1`
- TypeScript authoring is an implementation of the canonical contract
  architecture, not a parallel manifest format

## Generated SDK Requirements

Generated SDK outputs must include:

- `CONTRACT_ID`
- `CONTRACT_DIGEST`
- `CONTRACT`
- `API.owned`
- `API.used` as an empty API projection
- `API.trellis` equal to `API.owned`
- typed `use(...)`

Generated SDK outputs may continue to expose request, response, event, and
schema types alongside the richer contract module surface.

## Non-Goals

- redefining the canonical manifest format
- defining Rust contract surfaces
- defining subsystem-specific APIs such as jobs or operations language surfaces
