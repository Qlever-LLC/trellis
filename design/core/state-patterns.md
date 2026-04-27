# State Patterns

`State` is the Trellis-managed API for semi-durable contract-owned state that
should be available across authenticated app and device sessions.

## Purpose

- provide cloud-backed contract state similar to app-local preferences or drafts
- preserve state across upgrades within one contract lineage
- keep raw KV resources service-owned while exposing a Trellis-owned public
  state surface to normal callers

`State` is not a replacement for service-owned `resources.kv`. Services that
need private projections or internal checkpoints should continue to use
schema-backed `resources.kv` directly through `service.kv.<alias>` or injected
handler `trellis.kv.<alias>` stores.

## Contract Model

The public state model is a top-level contract `state` declaration.

Each declared store is named and schema-backed:

- the contract declares `state.<storeName>`
- each store requires `kind: "value" | "map"`
- each store requires `schema: { schema: "SchemaName" }`
- the referenced schema must exist in the contract's top-level `schemas` map

Example:

```ts
const contract = defineAppContract(
  {
    schemas: {
      Preferences: Type.Object({ theme: Type.String() }),
      Draft: Type.Object({ title: Type.String() }),
    },
  },
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

## Store Kinds

### `kind: "value"`

A value store holds one value for the authenticated caller and contract.

- no public key argument
- runtime helpers are `get()`, `put(value, opts?)`, and `delete(opts?)`

Typical use cases:

- preferences
- selected workspace
- last-viewed item

### `kind: "map"`

A map store holds many values under caller-provided keys for the authenticated
caller and contract.

- public key argument is required for `get`, `put`, and `delete`
- `list(...)` is available only on map stores
- `prefix(path)` creates a narrowed map-store view rooted at that path

Typical use cases:

- drafts
- per-document UI state
- cached records keyed by id

## Ownership And Boundary

- `State` is a Trellis-owned contract surface
- v1 is implemented by the `trellis` service
- backing storage is a Trellis-owned internal KV bucket
- normal callers use contract-declared stores, not raw buckets or raw subjects

This mirrors the `Files` boundary: the public API is contract-owned and the
storage backing remains an implementation detail.

## Normal Runtime Surface

The normal client/device runtime exposes declared stores at
`trellis.state.<store>`.

Example:

```ts
const preferences = await trellis.state.preferences.get();

const created = await trellis.state.preferences.put(
  { theme: "dark" },
  { expectedRevision: null },
);

const activeDrafts = trellis.state.drafts.prefix("inspection/active");
const listed = await activeDrafts.list({ limit: 20 });
```

Rules:

- the store name comes from the contract's top-level `state` map
- normal callers do not provide `contractId`, `scope`, user identity, or device
  identity
- the runtime derives the target namespace from the authenticated session and
  the contract id/lineage plus authenticated principal, so state follows
  compatible app or device upgrades within the same lineage
- the active `contractDigest` validates the declaration and schema used for the
  current request; it is not the durable state namespace component
- there is no public normal-client generic keyspace API and no public normal-
  client `scope` parameter

## Conditional Writes

Conditional writes use `put(..., { expectedRevision })`.

- omit `expectedRevision` for unconditional create-or-overwrite
- use `expectedRevision: null` for create-if-absent
- use `expectedRevision: "<revision>"` for update-if-current-revision-matches
- `delete(..., { expectedRevision })` supports delete-if-current-revision-
  matches

There is no separate normal-client compare-and-set API in the named-store model.

## Public Entry Model

State entries are JSON values plus Trellis-managed revision metadata.

Value-store entry shape:

- `value`
- `revision`
- `updatedAt`
- `expiresAt?`

Map-store entry shape:

- `key`
- `value`
- `revision`
- `updatedAt`
- `expiresAt?`

## Listing And Prefixing

`list(...)` applies only to map stores.

- results are lexicographic by key
- pagination uses `offset` and `limit`
- the current runtime default `limit` is `100`
- `prefix(path)` composes path prefixes on the client and keeps the same typed
  map-store API

Example:

```ts
const drafts = trellis.state.drafts.prefix("inspection/active");

await drafts.put("open", { title: "Draft" });
await drafts.get("open");
await drafts.list({ limit: 10 });
```

## Validation

- writes are validated against the declared store schema before the request is
  sent
- reads are validated against the declared store schema after the response is
  parsed
- state values must be valid JSON on the wire

## TTL

NATS KV TTL is bucket-level, not per-entry. v1 therefore implements TTL as
application-managed expiry metadata:

- `put(..., { ttlMs })` may attach expiry metadata to one entry
- expired entries are treated as absent by `get`, `list`, `put` conditional
  checks, and `delete`
- handlers may opportunistically delete expired entries when encountered

## Admin Inspection

Admin inspection is separate from the normal runtime API.

- normal callers use only `trellis.state.<store>`
- admin callers use dedicated `State.Admin.*` RPCs
- admin APIs still target an explicit namespace and may distinguish
  `scope: "userApp" | "deviceApp"`
- admin APIs are for inspection and mutation by administrators, not for normal
  app/device runtime access

## Non-Goals

- a public normal-client `scope` parameter
- a public normal-client generic key/value namespace as the primary API
- cross-contract shared namespaces
- watch or realtime subscriptions
- service use of `State` instead of `resources.kv`
- binary/blob transport semantics
- patch or merge helpers in the contract surface
- strict total namespace quotas in v1
