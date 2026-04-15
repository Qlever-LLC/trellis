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
import {
  defineError,
  defineServiceContract,
  TrellisError,
} from "@qlever-llc/trellis/contracts";
import { core } from "@qlever-llc/trellis-sdk/core";

const schemas = {
  FindUser: FindUserSchema,
  User: UserSchema,
  NotFoundErrorData: NotFoundErrorDataSchema,
  PartnerChanged: PartnerEventSchema,
} as const;

class NotFoundError extends TrellisError<NotFoundErrorData> {
  static readonly schema = NotFoundErrorDataSchema;
  override readonly name = "NotFoundError" as const;

  static fromSerializable(data: NotFoundErrorData): NotFoundError {
    return new NotFoundError({ id: data.id, context: data.context });
  }

  constructor(
    options?: ErrorOptions & { id?: string; context?: Record<string, unknown> },
  ) {
    super("Not found", options);
  }

  override toSerializable(): NotFoundErrorData {
    return {
      ...this.baseSerializable(),
      type: this.name,
    };
  }
}

export const contract = defineServiceContract(
  {
    schemas,
    errors: {
      UserMissing: defineError(NotFoundError),
    },
  },
  (ref) => ({
    id: "graph@v1",
    displayName: "Graph Service",
    description: "Serve graph RPCs and publish partner change events.",
    uses: {
      trellis: core.use({ rpc: { call: ["Trellis.Catalog"] } }),
    },
    rpc: {
      "User.Find": {
        version: "v1",
        input: ref.schema("FindUser"),
        output: ref.schema("User"),
        errors: [ref.error("UserMissing")],
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
- events combine shared headers with payload where needed
- simple RPC schemas may pair input and response in one file
- operation schemas typically split input, progress, and output
- service-specific schemas stay with the owning service

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
- do not default wire payload object schemas to
  `{ additionalProperties: false }`
- same-lineage Trellis rollouts rely on older runtimes accepting newer payloads
  that add optional fields they do not know about yet
- in TypeBox, prefer omitting `additionalProperties` for wire payload objects
  unless the boundary is intentionally closed for a documented reason
- Zod for environment parsing and config loading
- use one validation library per use case instead of stacking multiple libraries
  on the same boundary

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

Each error defines:

- a unique discriminating `name`
- a serializable data schema through `static schema`
- `static fromSerializable(...)` for runtime reconstruction
- `toSerializable()` or equivalent wire conversion

RPC rule:

- declared RPC errors may be service-local `TrellisError` subclasses owned by
  the service contract
- callers receive declared remote errors as reconstructed runtime instances of
  those classes
- `RemoteError` is a fallback for undeclared or unknown remote error payloads,
  not the preferred shape for declared contract errors
- the error class `static schema` must also be declared in the contract
  `schemas` map so the canonical manifest can emit a normal schema ref

Wire rule:

- the on-wire error envelope stays open
- shared runtimes must preserve unknown error payloads for diagnostics
- typed packages may narrow only the error types they actually know
