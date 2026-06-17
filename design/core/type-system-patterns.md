---
title: Type System Patterns
description: Shared Trellis rules for schemas, validation, Result types, and error modeling.
order: 30
---

# Design: Type System Patterns

## Prerequisites

- [trellis-patterns.md](./trellis-patterns.md) - Trellis architecture and
  communication model
- [../contracts/trellis-contracts-catalog.md](./../contracts/trellis-contracts-catalog.md) -
  canonical contract model

## Scope

This document defines Trellis-wide patterns for schemas, validation, `Result`,
and error modeling.

## API Schema

Each service owns a local contract definition that emits the canonical
`trellis.contract.v1` artifact.

```ts
import { defineError, defineServiceContract } from "@qlever-llc/trellis";
import { sdk as core } from "@qlever-llc/trellis/sdk/core";

const schemas = {
  FindUser: FindUserSchema,
  User: UserSchema,
  PartnerChanged: PartnerEventSchema,
} as const;

const NotFoundError = defineError({
  type: "NotFoundError",
  fields: {},
  message: "Not found",
});

export const contract = defineServiceContract(
  {
    schemas,
    errors: {
      NotFoundError,
    },
  },
  (ref) => ({
    id: "graph@v1",
    displayName: "Graph Service",
    description: "Serve graph RPCs and publish partner change events.",
    uses: {
      required: {
        trellis: core.use({ rpc: { call: ["Trellis.Catalog"] } }),
      },
    },
    rpc: {
      "User.Find": {
        version: "v1",
        input: ref.schema("FindUser"),
        output: ref.schema("User"),
        errors: [ref.error("NotFoundError")],
        capabilities: { call: ["users.read"] },
      },
    },
    events: {
      "Partner.Changed": {
        version: "v1",
        params: ["/partner/id/origin", "/partner/id/id"],
        event: ref.schema("PartnerChanged"),
        capabilities: {
          publish: ["partners.write"],
          subscribe: ["partners.read"],
        },
      },
    },
  }),
);
```

Rules:

- the local contract source defines input/output types, allowed errors,
  capabilities, and cross-contract dependencies
- local contract source files should export the specialized helper result
  directly and should usually use top-level `schemas` and optional `errors`
  registries plus `ref.schema(...)` and `ref.error(...)` in the builder callback
- the emitted manifest is the canonical cross-language artifact
- for local TypeScript code, prefer exporting the defined contract object itself
  (`export default contract` or a named contract export) instead of manually
  rebuilding a parallel module-shaped object

## Schema Organization

Platform-wide schemas live in the Trellis platform repo only when they are
reused by Trellis-owned contracts or shared Trellis runtime libraries.
Service-specific and domain-specific schemas live with the owning service or
cloud package.

Typical platform layout:

```text
libs/trellis/models/
├── <domain>/
│   ├── models/
│   ├── rpc/
│   └── events/
└── index.ts
```

Naming:

```ts
export const UserSchema = Type.Object({
  id: Type.String(),
  active: Type.Boolean({ default: true }),
});

export type User = Static<typeof UserSchema>;
```

Rules:

- one schema per file, named after the type
- schema constants use `<Name>Schema`
- TypeScript types use `<Name>` without a suffix
- event schemas describe contract bodies only; Trellis runtime metadata such as
  event id/time stays outside the body in prepared-event metadata and transport
  headers
- simple RPC schemas may pair input and response in one file
- operation schemas typically split input, progress, and output
- service-specific schemas stay with the owning service

## List Pagination Schemas

Trellis list RPCs use clean-break, standard page shapes unless a design doc
explicitly excludes an endpoint from normal list semantics. Live offset
pagination is the default for ordinary list RPCs. Cursor pagination is available
for stable ID/keyset pages where callers should advance by an opaque cursor
rather than a live row offset.

### Offset Pagination

Request:

```ts
{
  offset?: number;
  limit: number;
}
```

Response:

```ts
{
  entries: T[];
  count: number;
  offset: number;
  limit: number;
  nextOffset?: number;
}
```

Rules:

- `limit` is required; `offset` is optional and defaults to `0`
- responses use `entries` for the returned page, not domain-specific array names
  such as `users`, `sessions`, or `reports`
- `count` is the current matching-row count after filters and before the page
  bound
- `nextOffset` is present only when another bounded request can ask for the next
  live offset
- this is live offset pagination, not snapshot or cursor pagination; concurrent
  inserts, updates, or deletes can change what appears at later offsets

Trellis provides reusable TypeBox and handler helpers for this shape:

- `PageRequestSchema`
- `PageResponseSchema(entry)`
- `normalizePageQuery(query, maxLimit?)`
- `buildPageResponse(entries, totalCount, query, maxLimit?)`

### Cursor Pagination

Use cursor pagination for stable ID/keyset pages where the service can produce a
next cursor from the last returned key or another stable opaque position. Cursor
pages do not expose total counts or live offsets.

Request:

```ts
{
  cursor?: string;
  limit?: number;
}
```

Response:

```ts
{
  items: T[];
  page: {
    nextCursor?: string;
  };
}
```

Rules:

- `limit` defaults to `100`
- the default maximum `limit` is `500`, though endpoints may choose a narrower
  or wider maximum when documented
- `cursor` is optional, but when present it must be a non-empty string
- responses use `items` for the returned page and `page.nextCursor` only when
  another page is available
- cursors are service-owned positions; callers should treat them as opaque

Trellis provides reusable TypeBox and handler helpers for this shape:

- `CursorQuerySchema`
- `CursorPageInfoSchema`
- `CursorPageSchema(item)`
- `normalizeCursorQuery(query, options?)`
- `buildCursorPage(items, nextCursor?)`

## Schema Validation

Use TypeBox and Zod for different strengths:

| Library | Use case                                       | Rationale                                    |
| ------- | ---------------------------------------------- | -------------------------------------------- |
| TypeBox | RPC schemas, event payloads, operation schemas | type inference and JSON Schema compatibility |
| Zod     | service config and ENV parsing                 | coercion, transforms, defaults               |

TypeBox example:

```ts
import { type Static, Type } from "@sinclair/typebox";

export const FindUserSchema = Type.Object({
  userId: TrellisIDSchema,
});
export type FindUserInput = Static<typeof FindUserSchema>;
```

Zod example:

```ts
import { z } from "zod";

const configSchema = z.object({
  ARANGO_URL: z.string().url(),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});
```

Rules:

- TypeBox for RPC, event, and operation wire schemas
- do not default wire payload object schemas to closed-object
  additional-property rejection
- same-lineage Trellis rollouts rely on older runtimes accepting newer payloads
  that add optional fields they do not know about yet
- in TypeBox, prefer omitting `additionalProperties` for wire payload objects
  unless the boundary is intentionally closed for a documented reason
- Zod for environment parsing and config loading
- use one validation library per use case instead of stacking multiple libraries
  on the same boundary

### Annotated Validation Metadata

Contract authors can attach UI-facing metadata to TypeBox schema nodes through
the `x-trellis-validation` JSON Schema vendor extension key. This metadata
surfaces in `SchemaValidationError` when a request fails pre-handler schema
validation.

The `withTrellisValidation(schema, extension)` helper from
`@qlever-llc/trellis/contracts` attaches the extension without breaking TypeBox
static inference:

```ts
import { withTrellisValidation } from "@qlever-llc/trellis/contracts";

const InputSchema = Type.Object({
  title: withTrellisValidation(Type.String({ minLength: 1 }), {
    label: "Title",
    issues: {
      minLength: {
        code: "documents.title.empty",
        message: "Enter a title.",
      },
    },
  }),
});
```

Rules:

- `x-trellis-validation` carries `label`, `note`, `uiPath`, and per-keyword
  issue hints (`code`, `message`, `note`, `label`, `i18nKey`, `severity`)
- the metadata is purely for UX and does not change validation behavior
- when all validation failures are annotated, Trellis returns
  `SchemaValidationError` instead of `ValidationError`
- any structural or unannotated failure downgrades the entire response to
  `ValidationError`

## Storage Identity

SQL-backed Trellis storage separates row identity from domain identity.

Rules:

- SQL tables use an app-generated ULID `id` primary key for row identity
- public IDs, external IDs, contract IDs, digests, session keys, and other
  domain identifiers remain separate semantic columns with their own constraints
- repository and service code should query by the semantic identifier that
  matches the operation rather than exposing row IDs as public API identifiers
- schema names should make the distinction clear, for example `id` for row
  identity and `contract_id`, `trellis_id`, or `deployment_id` for domain
  identity

## Result Type

All Trellis public APIs and RPC handlers use `Result<T, E>`.

This keeps expected failures explicit as values rather than exceptions,
preserves composable transforms via `map`, `mapErr`, and `andThen`, and supports
predictable early-return and narrowing patterns.

Rules:

- expected failures use `Result`, not thrown exceptions
- language-specific implementations should preserve the same semantics even if
  the concrete type differs

## TypeScript Typing Policy

TypeScript code in Trellis should use the strongest typing the compiler can
support.

Rules:

- do not use `// @ts-nocheck`
- do not use `as unknown as ...`
- prefer generic constraints, helper functions, and type guards over casts
- use `// @ts-expect-error` only for a specific compiler limitation, with a
  short reason
- keep runtime validation and compile-time narrowing paired together
- if a public type must change to stay honest, prefer the stronger type even if
  it breaks consumers

## Error Handling

Trellis-shared errors come from Trellis packages. Service-specific errors may
extend the same base locally.

Built-in error roles:

- `TransportError` covers Trellis transport and runtime boundary failures such
  as malformed replies, unavailable routes, bind/bootstrap failures, and other
  Trellis-owned protocol or connection problems. It should carry human-facing
  Trellis-native `message`, `code`, and `hint` values.
- `SchemaValidationError` is returned before handler dispatch when every schema
  validation failure is annotated with `x-trellis-validation` metadata. It
  carries an `issues[]` array with stable, field-level UX information (path,
  keyword, code, message, label, note, severity, params). It is a Trellis
  runtime error, not a declared service error.
- `UnexpectedError` remains the bucket for true internal or otherwise unexpected
  conditions, usually by wrapping an unplanned cause.

```ts
export class AuthError extends TrellisError<AuthErrorData> {
  override readonly name = "AuthError" as const;
  readonly reason: AuthErrorData["reason"];

  constructor(options: ErrorOptions & { reason: AuthErrorData["reason"] }) {
    super(options);
    this.reason = options.reason;
  }

  override toSerializable(): AuthErrorData {
    return { type: this.name, message: this.message, reason: this.reason };
  }
}
```

Each error defines or derives:

- a unique discriminating wire `type`
- a serializable data schema through `static schema`
- runtime reconstruction logic
- wire conversion

RPC rule:

- declared RPC errors may be service-local `TrellisError` subclasses owned by
  the service contract
- new TypeScript service-local RPC errors should normally use `defineError(...)`
- generic TypeScript runtime helper typing for open serializable error payloads
  should use `SerializableErrorData`
- for TypeScript service contracts, local error `static schema` values may be
  derived into emitted contract schemas automatically from local error runtime
  metadata
- callers receive declared remote errors as reconstructed runtime instances of
  those classes
- callers may also receive `TransportError` from the Trellis runtime when the
  transport or runtime boundary fails before a declared remote error can be
  reconstructed
- `RemoteError` is a fallback for undeclared or unknown remote error payloads,
  not the preferred shape for declared contract errors

Operation rule:
- declared operation errors follow the same rules as declared RPC errors;
  local-or-builtin enforcement, wire open format, reconstructable class instances

Wire rule:

- the on-wire error envelope stays open
- shared runtimes must preserve unknown error payloads for diagnostics
- typed packages may narrow only the error types they actually know

### SchemaValidationError shape

Serialized shape:

```json
{
  "type": "SchemaValidationError",
  "message": "Schema validation failed.",
  "issues": [
    {
      "path": "/title",
      "schemaPath": "#/properties/title",
      "keyword": "minLength",
      "code": "documents.title.empty",
      "message": "Enter a title.",
      "label": "Title",
      "params": { "limit": 1 }
    }
  ]
}
```

Rules:

- `ValidationError` remains for structural failures (malformed JSON, wrong type,
  unannotated constraint failures, union/composition errors) — the handler does
  not run in either case
- `SchemaValidationError` is returned only when every TypeBox issue maps to a
  supported annotated keyword on the matching schema node
- callers receive the error as a reconstructed `SchemaValidationError` instance
  through the same built-in error machinery as `TransportError`
- the error is not a service-declared error and must not be listed in the
  contract's errors registry
