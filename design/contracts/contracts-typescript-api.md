---
title: Contracts TypeScript API
description: Public TypeScript surface for contract authoring, generated SDK modules, and contract-driven runtime helpers.
order: 40
---

# Design: Contracts TypeScript API

## Prerequisites

- [trellis-contracts-catalog.md](./trellis-contracts-catalog.md) - canonical manifest and permission model
- [trellis-typescript-contract-authoring.md](./trellis-typescript-contract-authoring.md) - TypeScript contract architecture and rationale
- [../core/type-system-patterns.md](./../core/type-system-patterns.md) - Result and error-model guidance

## Scope

This document defines the normative TypeScript public API surface for contract authoring, generated SDK modules, and contract-driven runtime helpers.

It does not redefine the canonical manifest model or runtime permission derivation.

## Design Rules

- `defineContract(...)` is the primary TypeScript authoring entrypoint
- generated SDK modules and local contracts share one compatible contract-module shape
- local `uses` declarations are expressed through SDK-backed `use(...)` helpers
- public runtime helpers are contract-driven and typed from the local contract
- TypeScript is the compile-time enforcement layer for declared remote permissions

## Public Package Surface

`@qlever-llc/trellis/contracts` is the preferred package for contract source modules and other contract-only authoring code.

`@qlever-llc/trellis` remains the canonical runtime package for client helpers, auth helpers, `Result`, and explicit core-runtime helpers such as `createCoreClient(...)`.

It exports:

- `defineContract(...)`
- contract-module and use-spec types needed by generated SDKs

Runtime connection helpers live in `@qlever-llc/trellis` and `@qlever-llc/trellis/server*`, not in `@qlever-llc/trellis/contracts` itself.

Rules:

- contract source modules should prefer `@qlever-llc/trellis/contracts`
- runtime client helpers should prefer `@qlever-llc/trellis`
- broader contract-model helpers may also be exposed from `@qlever-llc/trellis/contracts`

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
  createClient(...args: unknown[]): unknown;
  connectService(...args: unknown[]): Promise<unknown>;
};

declare function defineContract(...args: unknown[]): DefinedContract<any, any, any>;
```

## Illustrative Usage

```ts
import { defineContract } from "@qlever-llc/trellis/contracts";
import { auth } from "@qlever-llc/trellis/sdk/auth";
import { core } from "@qlever-llc/trellis/sdk/core";

export const activity = defineContract({
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
      inputSchema: ActivityImportRequestSchema,
      progressSchema: ActivityImportProgressSchema,
      outputSchema: ActivityImportResultSchema,
    },
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
```

## `defineContract(...)` Input Model

Rules:

- `id` remains the stable machine identity for the contract lineage
- `displayName` and `description` are required and are part of the canonical manifest
- local `operations`, `rpc`, `events`, `subjects`, `errors`, and `resources` remain the source for emitted owned contract content
- `uses` entries are expressed through SDK `use(...)` helpers rather than handwritten dependency objects in normal TypeScript code
- SDK-specific convenience helpers such as `auth.useDefaults(...)` are allowed when they still produce a normal `uses` declaration
- a participant MAY have no owned `operations`, `rpc`, `events`, or `subjects`
- a participant MAY have no `uses`
- the defined contract computes and exposes `CONTRACT_DIGEST` from the emitted canonical manifest

## Module Compatibility Rules

Generated SDK modules and locally defined contracts must share a compatible module shape.

Rules:

- generated SDK modules export an `SdkContractModule` shape
- a locally defined contract object MUST be usable anywhere an SDK contract module is expected
- a locally defined contract object therefore also exposes `CONTRACT_DIGEST` and typed `use(...)`
- local contracts additionally expose runtime connection helpers

## Derived API Views

`defineContract(...)` derives three projected API surfaces:

- `API.owned`
- `API.used`
- `API.trellis`

Rules:

- `API.owned` is projected from the local owned contract declarations only
- `API.used` is projected by selecting only the operations named in SDK-backed `uses`
- `API.trellis` is the merge of `API.used` and `API.owned`
- the merged surface is the only general outbound runtime namespace
- owned registration surfaces are derived from `API.owned`, not `API.trellis`

## Typing Rules

- a referenced remote operation, RPC, event, or subject must exist on the imported SDK module
- a participant may only invoke, call, publish, or subscribe to remote APIs explicitly declared in local `uses`
- omitted `uses` entries remove the corresponding generated runtime methods
- SDK-backed `use(...)` declarations are the source of compile-time allowed-API filtering

## Runtime Helper Behavior

Contract-driven runtime helpers include `createClient(contract, ...)` and `connectService(contract, ...)`.

For callers that intentionally want only the generated Trellis core API without a local contract, `@qlever-llc/trellis` also exposes `createCoreClient(...)` as an explicit opt-in helper.

Rules:

- returned runtimes are typed from the local contract's `API.trellis` and `API.owned`
- returned runtimes expose typed operation, request, publish, and subscribe helpers derived from the contract
- runtime helpers must not widen the callable surface beyond what the contract allows
- service-side helpers must not expose used remote APIs as mountable local handlers

## Validation And Manifest Behavior

Rules:

- TypeScript compile-time typing enforces declared remote usage shape
- runtime validation still enforces canonical manifest, auth, and subject ownership rules
- emitted manifests remain `trellis.contract.v1`
- TypeScript authoring is an implementation of the canonical contract architecture, not a parallel manifest format

## Generated SDK Requirements

Generated SDK outputs must include:

- `CONTRACT_ID`
- `CONTRACT_DIGEST`
- `CONTRACT`
- `API.owned`
- `API.used` as an empty API projection
- `API.trellis` equal to `API.owned`
- typed `use(...)`

Generated SDK outputs may continue to expose request, response, event, and schema types alongside the richer contract module surface.

## Non-Goals

- redefining the canonical manifest format
- defining Rust contract surfaces
- defining subsystem-specific APIs such as jobs or operations language surfaces
