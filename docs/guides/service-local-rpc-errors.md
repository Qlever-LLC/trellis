# Service-Local RPC Errors

Use this guide when a service needs domain-specific RPC failures such as
`NotFoundError`, `WorkspaceClosedError`, or `InvitationExpiredError`.

This is the preferred Trellis pattern when:

- the error is specific to one service or one service family
- the error should travel over RPC as a typed value
- callers should receive a real runtime error instance rather than a
  `RemoteError` wrapper

## Summary

Prefer `defineTrellisErrorClass(...)` for service-local RPC errors.

It generates a real `TrellisError` subclass with:

- a typed wire schema
- runtime reconstruction
- built-in `id`, `context`, and `traceId` handling
- a ready-to-use `defineError(...)` declaration on `.decl`

Then:

1. define the error class with `defineTrellisErrorClass(...)`
2. register the generated declaration from `MyErrorClass.decl` in the contract
   `errors` map
3. reference the local declaration from RPC `errors: [...]`, preferably through
   `ref.error(...)`
4. return the error instance from the handler with `err(...)`
5. handle it on the caller with `instanceof`

## Example

```ts
import Type from "typebox";
import {
  defineTrellisErrorClass,
  defineServiceContract,
  err,
} from "@qlever-llc/trellis";

export const NotFoundError = defineTrellisErrorClass({
  type: "NotFoundError",
  fields: {
    resource: Type.String(),
    resourceId: Type.String(),
  },
  message: ({ resource, resourceId }) => `${resource} ${resourceId} not found`,
});

const schemas = {
  GetWorkspaceInput: GetWorkspaceInputSchema,
  Workspace: WorkspaceSchema,
} as const;

const errors = {
  WorkspaceMissing: NotFoundError.decl,
} as const;

export const krishi = defineServiceContract(
  { schemas, errors },
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
          ref.error("WorkspaceMissing"),
          ref.error("ValidationError"),
          ref.error("UnexpectedError"),
        ],
      },
    },
  }),
);

export default krishi;

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
- `defineTrellisErrorClass(...)` is the preferred authoring path for new local
  service errors
- the generated class `type` is the wire `type`
- the generated or manual class `static schema` is the source of the emitted
  local error schema
- `defineServiceContract(...)` derives the local error schema entry
  automatically when it is not already present in the contract `schemas` map
- the `errors` map key is the local declaration name used by RPC `errors: [...]`
- the local declaration key does not need to match the wire `type`
- when this lives in a `contracts/*.ts` source file, the file should default
  export the defined contract module
- for new local service contract files, prefer
  `defineServiceContract({ schemas, errors }, (ref) => ({ ... }))`
- builtin Trellis RPC errors should also be referenced through `ref.error(...)`
  in builder-style contracts
- Trellis RPC error transport stays open on the wire, so do not default local
  error payload object schemas to `{ additionalProperties: false }`

Example:

```ts
errors: {
  WorkspaceMissing: NotFoundError.decl,
},
defineServiceContract({ schemas, errors }, (ref) => ({
  rpc: {
    "Workspace.Get": {
      // ...
      errors: [ref.error("WorkspaceMissing"), ref.error("UnexpectedError")],
    },
  },
}))
```

This emits a manifest error ref with wire type `NotFoundError`, while the local
contract still uses the friendlier declaration key `WorkspaceMissing`.

If the same schema is also needed for `ref.schema(...)` elsewhere in the
contract, keep exporting it through the local `schemas` map as usual.

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
- Using the manual subclass path when the generated factory would be enough
- Returning a domain-specific error from a handler without listing its local
  declaration in the RPC `errors: [...]`
- Using `RemoteError` checks for declared contract errors instead of
  `instanceof`

## Advanced Manual Path

Use a handwritten `class extends TrellisError` only when the generated factory is
too limiting, such as when the error needs custom prototype methods or unusual
reconstruction logic.

## Related Design Docs

- `design/contracts/contracts-typescript-api.md`
- `design/contracts/trellis-typescript-contract-authoring.md`
- `design/contracts/trellis-contracts-catalog.md`
- `design/core/type-system-patterns.md`
