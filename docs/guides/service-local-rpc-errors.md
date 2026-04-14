# Service-Local RPC Errors

Use this guide when a service needs domain-specific RPC failures such as
`NotFoundError`, `WorkspaceClosedError`, or `InvitationExpiredError`.

This is the preferred Trellis pattern when:

- the error is specific to one service or one service family
- the error should travel over RPC as a typed value
- callers should receive a real runtime error instance rather than a
  `RemoteError` wrapper

## Summary

Define service-local RPC errors as `TrellisError` subclasses with:

- `static schema`
- `static fromSerializable(...)`
- `toSerializable()`

Then:

1. add the error data schema to the contract `schemas` map
2. register the class in the contract `errors` map with
   `defineError(MyErrorClass)`
3. reference the local declaration from RPC `errors: [...]`
4. return the error instance from the handler with `err(...)`
5. handle it on the caller with `instanceof`

## Example

```ts
import Type, { type Static } from "typebox";
import {
  defineContract,
  defineError,
  err,
  TrellisError,
} from "@qlever-llc/trellis";

export const NotFoundErrorDataSchema = Type.Object({
  id: Type.String(),
  type: Type.Literal("NotFoundError"),
  message: Type.String(),
  resource: Type.String(),
  resourceId: Type.String(),
  context: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  traceId: Type.Optional(Type.String()),
});

export type NotFoundErrorData = Static<typeof NotFoundErrorDataSchema>;

export class NotFoundError extends TrellisError<NotFoundErrorData> {
  static readonly schema = NotFoundErrorDataSchema;
  override readonly name = "NotFoundError" as const;

  readonly resource: string;
  readonly resourceId: string;

  constructor(
    options: ErrorOptions & {
      resource: string;
      resourceId: string;
      context?: Record<string, unknown>;
      id?: string;
    },
  ) {
    const { resource, resourceId, ...base } = options;
    super(`${resource} not found`, base);
    this.resource = resource;
    this.resourceId = resourceId;
  }

  static fromSerializable(data: NotFoundErrorData): NotFoundError {
    return new NotFoundError({
      resource: data.resource,
      resourceId: data.resourceId,
      id: data.id,
      context: data.context,
    });
  }

  override toSerializable(): NotFoundErrorData {
    return {
      ...this.baseSerializable(),
      type: this.name,
      resource: this.resource,
      resourceId: this.resourceId,
    };
  }
}

export const krishi = defineContract({
  id: "dna-cloud.krishi@v1",
  displayName: "Krishi",
  description: "Krishi service",
  kind: "service",
  schemas: {
    NotFoundErrorData: NotFoundErrorDataSchema,
    GetWorkspaceInput: GetWorkspaceInputSchema,
    Workspace: WorkspaceSchema,
  },
  errors: {
    WorkspaceMissing: defineError(NotFoundError),
  },
  rpc: {
    "Workspace.Get": {
      version: "v1",
      input: { schema: "GetWorkspaceInput" },
      output: { schema: "Workspace" },
      errors: ["WorkspaceMissing", "ValidationError", "UnexpectedError"],
    },
  },
});

export const getWorkspace = async (input: GetWorkspaceInput) => {
  const workspace = await loadWorkspace(input.workspaceId);
  if (!workspace) {
    return err(
      new NotFoundError({
        resource: "Workspace",
        resourceId: input.workspaceId,
      }),
    );
  }

  return Result.ok(workspace);
};
```

Caller side:

```ts
const result = await trellis.request("Workspace.Get", { workspaceId });
const value = result.take();

if (isErr(value)) {
  if (value.error instanceof NotFoundError) {
    console.log(value.error.resource);
    console.log(value.error.resourceId);
  }
}
```

## Contract Rules

- `defineError(...)` takes the class, not duplicated `type` or `schema` values
- the class `name` is the wire `type`
- the class `static schema` must also appear in the contract `schemas` map
- the `errors` map key is the local declaration name used by RPC `errors: [...]`
- the local declaration key does not need to match the wire `type`
- Trellis RPC error transport stays open on the wire, so do not default local
  error payload object schemas to `{ additionalProperties: false }`

Example:

```ts
errors: {
  WorkspaceMissing: defineError(NotFoundError),
},
rpc: {
  "Workspace.Get": {
    // ...
    errors: ["WorkspaceMissing", "UnexpectedError"],
  },
}
```

This emits a manifest error ref with wire type `NotFoundError`, while the local
contract still uses the friendlier declaration key `WorkspaceMissing`.

## Generated SDK Behavior

Generated TypeScript SDKs follow the same shape:

- emitted local error classes extend `TrellisError`
- emitted classes include `static schema` when the manifest declares one
- emitted classes include `static fromSerializable(...)`
- RPC descriptors include the runtime metadata needed to reconstruct declared
  remote errors as real error instances

That means callers using generated TS SDKs can also write:

```ts
if (value.error instanceof NotFoundError) {
  // ...
}
```

## When To Use A Shared Built-In Error Instead

Keep using built-in Trellis errors when the failure is platform-wide or already
semantically covered:

- `AuthError`
- `ValidationError`
- `UnexpectedError`

Do not overload `ValidationError` just to get a typed transport error for domain
failures like:

- workspace not found
- invitation not found
- share rule not found

Those should be service-local errors.

## Common Mistakes

- Forgetting `static schema`
- Forgetting `static fromSerializable(...)`
- Defining the class schema but not adding it to the contract `schemas` map
- Returning a domain-specific error from a handler without listing its local
  declaration in the RPC `errors: [...]`
- Using `RemoteError` checks for declared contract errors instead of
  `instanceof`

## Related Design Docs

- `design/contracts/contracts-typescript-api.md`
- `design/contracts/trellis-typescript-contract-authoring.md`
- `design/contracts/trellis-contracts-catalog.md`
- `design/core/type-system-patterns.md`
