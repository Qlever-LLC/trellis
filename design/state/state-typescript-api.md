---
title: State TypeScript API
description: Public TypeScript contract and runtime surface for Trellis named state stores.
order: 10
---

# Design: State TypeScript API

## Prerequisites

- [../core/state-patterns.md](./../core/state-patterns.md) - named-store state
  model and subsystem rules
- [../contracts/trellis-contracts-catalog.md](./../contracts/trellis-contracts-catalog.md) -
  canonical top-level `state` manifest shape
- [../contracts/trellis-typescript-contract-authoring.md](./../contracts/trellis-typescript-contract-authoring.md) -
  TypeScript contract authoring helpers

## Scope

This document defines the normative TypeScript public API for contract-declared
state stores and the connected runtime state facade.

It documents the normal caller surface. Admin inspection RPCs are separate and
are not part of `trellis.state`.

## Design Rules

- contracts declare state at top level under `state`
- each store requires `kind` and `schema`
- normal callers use `trellis.state.<store>`
- normal callers do not pass a public `scope`
- conditional writes use `put(..., { expectedRevision })`
- map stores support `prefix(path)` and `list(...)`
- value stores do not expose `list(...)` or `prefix(...)`
- public methods return `Result` / `AsyncResult` for expected failures

## Contract Authoring Shape

```ts
const contract = defineAppContract(
  {
    schemas: {
      PreferencesV1: Type.Object({ theme: Type.String() }),
      Preferences: Type.Object({
        theme: Type.String(),
        compact: Type.Boolean(),
      }),
      Draft: Type.Object({ title: Type.String() }),
    },
  },
  (ref) => ({
    id: "acme.notes@v1",
    displayName: "Notes",
    description: "Notes app",
    state: {
      preferences: {
        kind: "value",
        schema: ref.schema("Preferences"),
        stateVersion: "preferences.v2",
        acceptedVersions: {
          "preferences.v1": ref.schema("PreferencesV1"),
        },
      },
      drafts: { kind: "map", schema: ref.schema("Draft") },
    },
  }),
);
```

Rules:

- store names are chosen by the contract author
- `kind` MUST be `value` or `map`
- `schema` MUST reference a contract schema
- `stateVersion` defaults to `"v1"` and should change only when persisted values
  need migration
- `acceptedVersions` maps older author-known state versions to schemas that are
  valid migration inputs
- the declared store metadata drives both emitted manifest content and the typed
  runtime facade

## Client Surface

```ts
type StateDeleteOptions = {
  expectedRevision?: string;
};

type StatePutOptions = {
  expectedRevision?: string | null;
  ttlMs?: number;
};

type StateListOptions = {
  offset?: number;
  limit?: number;
};

type StateMigrationRequiredEntry<TEntry> = {
  migrationRequired: true;
  entry: TEntry;
  stateVersion: string;
  currentStateVersion: string;
  writerContractDigest: string;
};

type ValueStateStoreClient<TValue> = {
  get(): AsyncResult<
    | { found: false }
    | {
      found: true;
      entry: {
        value: TValue;
        revision: string;
        updatedAt: string;
        expiresAt?: string;
      };
    }
    | StateMigrationRequiredEntry<{
      value: unknown;
      revision: string;
      updatedAt: string;
      expiresAt?: string;
    }>,
    BaseError
  >;
  put(
    value: TValue,
    opts?: StatePutOptions,
  ): AsyncResult<
    | {
      applied: true;
      entry: {
        value: TValue;
        revision: string;
        updatedAt: string;
        expiresAt?: string;
      };
    }
    | {
      applied: false;
      found: boolean;
      entry?:
        | {
          value: TValue;
          revision: string;
          updatedAt: string;
          expiresAt?: string;
        }
        | StateMigrationRequiredEntry<{
          value: unknown;
          revision: string;
          updatedAt: string;
          expiresAt?: string;
        }>;
    },
    BaseError
  >;
  delete(
    opts?: StateDeleteOptions,
  ): AsyncResult<{ deleted: boolean }, BaseError>;
};

type MapStateStoreClient<TValue> = {
  get(key: string): AsyncResult<
    | { found: false }
    | {
      found: true;
      entry: {
        key: string;
        value: TValue;
        revision: string;
        updatedAt: string;
        expiresAt?: string;
      };
    }
    | StateMigrationRequiredEntry<{
      key: string;
      value: unknown;
      revision: string;
      updatedAt: string;
      expiresAt?: string;
    }>,
    BaseError
  >;
  put(
    key: string,
    value: TValue,
    opts?: StatePutOptions,
  ): AsyncResult<
    | {
      applied: true;
      entry: {
        key: string;
        value: TValue;
        revision: string;
        updatedAt: string;
        expiresAt?: string;
      };
    }
    | {
      applied: false;
      found: boolean;
      entry?:
        | {
          key: string;
          value: TValue;
          revision: string;
          updatedAt: string;
          expiresAt?: string;
        }
        | StateMigrationRequiredEntry<{
          key: string;
          value: unknown;
          revision: string;
          updatedAt: string;
          expiresAt?: string;
        }>;
    },
    BaseError
  >;
  delete(
    key: string,
    opts?: StateDeleteOptions,
  ): AsyncResult<{ deleted: boolean }, BaseError>;
  list(opts?: StateListOptions): AsyncResult<{
    entries: Array<
      | {
        key: string;
        value: TValue;
        revision: string;
        updatedAt: string;
        expiresAt?: string;
      }
      | StateMigrationRequiredEntry<{
        key: string;
        value: unknown;
        revision: string;
        updatedAt: string;
        expiresAt?: string;
      }>
    >;
    count: number;
    offset: number;
    limit: number;
    next?: number;
    prev?: number;
  }, BaseError>;
  prefix(path: string): MapStateStoreClient<TValue>;
};
```

## Runtime Surface

Connected runtimes expose declared stores through `trellis.state`.

Example:

```ts
const preferences = await trellis.state.preferences.get().orThrow();

await trellis.state.preferences.put(
  { theme: "dark" },
  { expectedRevision: null },
).orThrow();

const drafts = trellis.state.drafts.prefix("inspection/active");
await drafts.put("open", { title: "Draft" }).orThrow();
const listed = await drafts.list({ limit: 10 }).orThrow();
```

## Semantics

### Value stores

- `get()` reads the store's single value
- `put(value, opts?)` creates or overwrites that single value
- `delete(opts?)` deletes that single value

### Map stores

- `get(key)` reads one key from the named store
- `put(key, value, opts?)` writes one key in the named store
- `delete(key, opts?)` deletes one key in the named store
- `list(opts?)` lists entries for the current store or prefixed view
- `prefix(path)` returns another typed map-store client rooted at that path

### State versioning

- compatible schema extensions keep the same `stateVersion` even though the
  contract digest changes
- incompatible persisted-state changes increment `stateVersion`
- older readable versions are declared in `acceptedVersions`
- reads, lists, and failed conditional puts may return `migrationRequired` with
  the old value, old state version, current state version, and internal writer
  digest
- stored entries must be stamped with `stateVersion` and internal
  `writerContractDigest`; unstamped pre-v1 entries are rejected instead of being
  treated as current or mapped to accepted-version migration metadata
- migration code runs in the app/device runtime and should write the migrated
  value back with `expectedRevision`

### Conditional write semantics

- omit `expectedRevision` for unconditional write
- use `expectedRevision: null` for create-if-absent
- use `expectedRevision: "<revision>"` for compare-with-current-revision write
- `delete(..., { expectedRevision })` deletes only when the current revision
  matches

## Validation Rules

- runtime helpers validate writes against the declared store schema before the
  request is sent
- runtime helpers validate reads against the declared store schema after the
  response is parsed
- migration-required responses validate the value against the declared older
  accepted-version schema rather than the current schema
- invalid state payloads surface as typed validation failures rather than as
  silently accepted values

## Non-Goals

- exposing a public normal-client `scope` parameter
- exposing a generic top-level key/value bag API as the primary surface
- merging admin inspection APIs into `trellis.state`
