# Contract State Stores

Use this guide when an app, device, portal, or CLI needs Trellis-managed
semi-durable state such as preferences, selections, or draft records.

## Summary

Declare named stores at the top level of the contract, then use them through the
connected runtime at `trellis.state.<store>`.

Use this surface for caller-owned Trellis-managed state. When a service owns
durable structured data for itself, declare schema-backed `resources.kv` and use
typed `service.kv.<alias>` from a `TrellisService.connect(...)` runtime.

- use `kind: "value"` for one value per caller
- use `kind: "map"` for many values keyed by string
- every store must reference a declared schema
- use `put(..., { expectedRevision })` for conditional writes
- use `prefix(path)` to narrow a map store to one subtree

## Example

```ts
import { Type } from "typebox";
import { TrellisClient, defineAppContract } from "@qlever-llc/trellis";

export const notes = defineAppContract(
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

const trellis = await TrellisClient.connect({
  trellisUrl: "https://trellis.example.com",
  contract: notes,
  name: "notes-app",
});

await trellis.state.preferences.put(
  { theme: "dark" },
  { expectedRevision: null },
).orThrow();

const drafts = trellis.state.drafts.prefix("inspection/active");
await drafts.put("open", { title: "Draft" }).orThrow();

const listed = await drafts.list({ limit: 10 }).orThrow();
console.log(listed.entries);
```

## How To Choose A Store Kind

### Value store

Use a value store when there should be exactly one value for the caller.

Examples:

- preferences
- selected site
- current workspace

Runtime shape:

```ts
await trellis.state.preferences.get();
await trellis.state.preferences.put({ theme: "light" });
await trellis.state.preferences.delete();
```

### Map store

Use a map store when the caller needs many values under independent keys.

Examples:

- drafts by id
- cached records
- per-document UI state

Runtime shape:

```ts
await trellis.state.drafts.get("open");
await trellis.state.drafts.put("open", { title: "Draft" });
await trellis.state.drafts.delete("open");
await trellis.state.drafts.list({ limit: 20 });
```

## Conditional Writes

Use `expectedRevision` when the write must be conditional.

- omit it for unconditional overwrite
- use `null` for create-if-absent
- use a revision string to update only if the current value still matches

Example:

```ts
const current = await trellis.state.preferences.get().orThrow();

if (current.found) {
  await trellis.state.preferences.put(
    { theme: "light" },
    { expectedRevision: current.entry.revision },
  ).orThrow();
}
```

## Prefixing Map Stores

`prefix(path)` is a convenience for working inside one subtree of a map store.

```ts
const activeDrafts = trellis.state.drafts.prefix("inspection/active");

await activeDrafts.put("open", { title: "Draft" }).orThrow();
await activeDrafts.get("open").orThrow();
await activeDrafts.list().orThrow();
```

This writes keys like `inspection/active/open` while keeping the typed map-store
API.

## Important Rules

- normal callers do not pass a public `scope`
- normal callers do not choose a raw contract-wide keyspace API
- admin inspection is separate from the normal runtime API
- state values must be valid JSON and must match the declared store schema

## Related Design Docs

- `design/core/state-patterns.md`
- `design/state/state-typescript-api.md`
- `design/contracts/trellis-contracts-catalog.md`
- `design/contracts/trellis-typescript-contract-authoring.md`
