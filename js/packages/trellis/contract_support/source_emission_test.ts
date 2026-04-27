import { assertEquals, assertNotEquals, assertThrows } from "@std/assert";
import { Type } from "typebox";

import {
  defineAppContract,
  defineError,
  defineServiceContract,
  digestContractManifest,
} from "./mod.ts";
import { unwrapSchema } from "./runtime.ts";

const EmptySchema = Type.Object({});
const StringSchema = Type.Object({ value: Type.String() });

const baseSchemas = {
  Empty: EmptySchema,
  StringValue: StringSchema,
} as const;

function schemaRef<
  TSchemas extends Record<string, unknown>,
  const TName extends keyof TSchemas & string,
>(
  schema: TName,
) {
  return { schema } as const;
}

Deno.test("kind-specific helpers preserve emitted manifest shape and digest", async () => {
  const auth = defineServiceContract(
    {
      schemas: baseSchemas,
    },
    () => ({
      id: "trellis.auth@v1",
      displayName: "Trellis Auth",
      description: "Expose auth RPCs and events for source emission tests.",
      exports: {
        schemas: ["StringValue"],
      },
      rpc: {
        "Auth.Me": {
          version: "v1",
          input: schemaRef<typeof baseSchemas, "Empty">("Empty"),
          output: schemaRef<typeof baseSchemas, "StringValue">("StringValue"),
          capabilities: { call: [] },
          errors: ["UnexpectedError"],
        },
      },
      events: {
        "Auth.Connect": {
          version: "v1",
          event: schemaRef<typeof baseSchemas, "StringValue">("StringValue"),
          capabilities: {
            publish: ["events:auth"],
            subscribe: ["events:auth"],
          },
        },
      },
    }),
  );

  const activity = defineServiceContract(
    { schemas: baseSchemas },
    () => ({
      id: "trellis.activity@v1",
      displayName: "Activity",
      description: "Expose activity APIs while depending on auth in tests.",
      uses: {
        auth: auth.use({
          rpc: { call: ["Auth.Me"] },
          events: { subscribe: ["Auth.Connect"] },
        }),
      },
      rpc: {
        "Activity.List": {
          version: "v1",
          input: schemaRef<typeof baseSchemas, "Empty">("Empty"),
          output: schemaRef<typeof baseSchemas, "StringValue">("StringValue"),
          capabilities: { call: ["activity.read"] },
          errors: ["UnexpectedError"],
        },
      },
      events: {
        "Activity.Recorded": {
          version: "v1",
          event: schemaRef<typeof baseSchemas, "StringValue">("StringValue"),
          capabilities: {
            publish: ["events:activity"],
            subscribe: ["events:activity"],
          },
        },
      },
    }),
  );

  assertEquals(activity.CONTRACT, {
    format: "trellis.contract.v1",
    id: "trellis.activity@v1",
    displayName: "Activity",
    description: "Expose activity APIs while depending on auth in tests.",
    kind: "service",
    schemas: {
      Empty: {
        properties: {},
        type: "object",
      },
      StringValue: {
        properties: { value: { type: "string" } },
        required: ["value"],
        type: "object",
      },
    },
    uses: {
      auth: {
        contract: "trellis.auth@v1",
        rpc: { call: ["Auth.Me"] },
        events: { subscribe: ["Auth.Connect"] },
      },
    },
    rpc: {
      "Activity.List": {
        version: "v1",
        subject: "rpc.v1.Activity.List",
        input: { schema: "Empty" },
        output: { schema: "StringValue" },
        capabilities: { call: ["activity.read"] },
        errors: [{ type: "UnexpectedError" }],
      },
    },
    events: {
      "Activity.Recorded": {
        version: "v1",
        subject: "events.v1.Activity.Recorded",
        event: { schema: "StringValue" },
        capabilities: {
          publish: ["events:activity"],
          subscribe: ["events:activity"],
        },
      },
    },
  });

  assertEquals(
    activity.API.owned.rpc["Activity.List"].subject,
    "rpc.v1.Activity.List",
  );
  assertEquals(activity.API.used.rpc["Auth.Me"].subject, "rpc.v1.Auth.Me");
  assertEquals(
    activity.API.used.events["Auth.Connect"].subject,
    "events.v1.Auth.Connect",
  );
  assertEquals(
    activity.API.trellis.rpc["Activity.List"].subject,
    "rpc.v1.Activity.List",
  );
  assertEquals(activity.API.trellis.rpc["Auth.Me"].subject, "rpc.v1.Auth.Me");
  assertEquals(
    activity.CONTRACT_DIGEST,
    digestContractManifest(activity.CONTRACT),
  );
  assertEquals(auth.CONTRACT.exports, {
    schemas: ["StringValue"],
  });
});

Deno.test("defineServiceContract emits explicit exported schema names without filtering local schemas", () => {
  const contract = defineServiceContract(
    {
      schemas: baseSchemas,
    },
    () => ({
      id: "exports.example@v1",
      displayName: "Exports Example",
      description: "Declare which schema registry entries are public.",
      exports: {
        schemas: ["StringValue"],
      },
      rpc: {
        "Exports.Read": {
          version: "v1",
          input: schemaRef<typeof baseSchemas, "Empty">("Empty"),
          output: schemaRef<typeof baseSchemas, "StringValue">("StringValue"),
        },
      },
    }),
  );

  assertEquals(contract.CONTRACT.exports, {
    schemas: ["StringValue"],
  });
  assertEquals(Object.keys(contract.CONTRACT.schemas ?? {}), [
    "Empty",
    "StringValue",
  ]);
});

Deno.test("contract helpers reject registry-side exports at runtime", () => {
  assertThrows(
    () =>
      defineServiceContract(
        JSON.parse('{"exports":{"schemas":["StringValue"]}}'),
        () => ({
          id: "exports.registry-service@v1",
          displayName: "Registry Exports Service",
          description: "Should reject registry-side exports.",
        }),
      ),
    Error,
    "contract exports must be declared in the callback body",
  );

  assertThrows(
    () =>
      defineAppContract(
        JSON.parse('{"exports":{"schemas":["StringValue"]}}'),
        () => ({
          id: "exports.registry-app@v1",
          displayName: "Registry Exports App",
          description: "Should reject registry-side exports.",
        }),
      ),
    Error,
    "contract exports must be declared in the callback body",
  );
});

Deno.test("defineServiceContract emits RPC error refs using declared wire types", () => {
  const NotFoundError = defineError({
    type: "NotFoundError",
    fields: {},
    message: "Not found",
  });

  const contract = defineServiceContract(
    {
      schemas: {
        Empty: EmptySchema,
      },
      errors: {
        NotFoundError,
      },
    },
    (ref) => ({
      id: "local-errors.example@v1",
      displayName: "Local Errors Example",
      description: "Verify RPC error refs emit declared error types.",
      rpc: {
        "Workspace.Get": {
          version: "v1",
          input: ref.schema("Empty"),
          output: ref.schema("Empty"),
          errors: [ref.error("NotFoundError"), ref.error("UnexpectedError")],
        },
      },
    }),
  );

  assertEquals(contract.CONTRACT.rpc?.["Workspace.Get"]?.errors, [
    { type: "NotFoundError" },
    { type: "UnexpectedError" },
  ]);
});

Deno.test("defineAppContract emits top-level named state declarations", async () => {
  const dashboardSchemas = {
    Preferences: Type.Object({ theme: Type.String() }),
    Draft: Type.Object({ title: Type.String() }),
  } as const;

  const dashboard = defineAppContract(
    { schemas: dashboardSchemas },
    (ref) => ({
      id: "trellis.dashboard@v1",
      displayName: "Dashboard",
      description: "Persist dashboard preferences and drafts.",
      state: {
        preferences: {
          kind: "value",
          schema: ref.schema("Preferences"),
        },
        drafts: {
          kind: "map",
          schema: ref.schema("Draft"),
        },
      },
    }),
  );

  assertEquals(dashboard.CONTRACT, {
    format: "trellis.contract.v1",
    id: "trellis.dashboard@v1",
    displayName: "Dashboard",
    description: "Persist dashboard preferences and drafts.",
    kind: "app",
    schemas: {
      Preferences: {
        properties: { theme: { type: "string" } },
        required: ["theme"],
        type: "object",
      },
      Draft: {
        properties: { title: { type: "string" } },
        required: ["title"],
        type: "object",
      },
    },
    state: {
      preferences: {
        kind: "value",
        schema: { schema: "Preferences" },
      },
      drafts: {
        kind: "map",
        schema: { schema: "Draft" },
      },
    },
    uses: {
      auth: {
        contract: "trellis.auth@v1",
        rpc: { call: ["Auth.Logout", "Auth.Me"] },
      },
      state: {
        contract: "trellis.state@v1",
        rpc: {
          call: ["State.Delete", "State.Get", "State.List", "State.Put"],
        },
      },
    },
  });

  assertEquals(dashboard.API.used.rpc["Auth.Me"].subject, "rpc.v1.Auth.Me");
  assertEquals(
    dashboard.API.used.rpc["Auth.Logout"].subject,
    "rpc.v1.Auth.Logout",
  );
  assertEquals(
    dashboard.API.used.rpc["State.Get"].subject,
    "rpc.v1.State.Get",
  );
  assertEquals(
    dashboard.API.trellis.rpc["State.Put"].subject,
    "rpc.v1.State.Put",
  );

  assertEquals(
    dashboard.CONTRACT_DIGEST,
    digestContractManifest(dashboard.CONTRACT),
  );
});

Deno.test("contract digest ignores display metadata, exports, and unused schemas", () => {
  const schemas = {
    Used: Type.Object({ value: Type.String() }),
    Unused: Type.Object({ label: Type.String() }),
  } as const;

  const first = defineServiceContract({ schemas }, (ref) => ({
    id: "digest.projection@v1",
    displayName: "Digest Projection",
    description: "First description.",
    exports: { schemas: ["Unused"] },
    rpc: {
      "Digest.Read": {
        version: "v1",
        input: ref.schema("Used"),
        output: ref.schema("Used"),
      },
    },
  }));

  const second = defineServiceContract({
    schemas: {
      Used: schemas.Used,
      Unused: Type.Object({ changed: Type.Boolean() }),
    },
  }, (ref) => ({
    id: "digest.projection@v1",
    displayName: "Renamed Digest Projection",
    description: "Second description.",
    exports: { schemas: ["Used", "Unused"] },
    rpc: {
      "Digest.Read": {
        version: "v1",
        input: ref.schema("Used"),
        output: ref.schema("Used"),
      },
    },
  }));

  assertNotEquals(first.CONTRACT.displayName, second.CONTRACT.displayName);
  assertNotEquals(first.CONTRACT.description, second.CONTRACT.description);
  assertNotEquals(first.CONTRACT.exports, second.CONTRACT.exports);
  assertNotEquals(
    first.CONTRACT.schemas?.Unused,
    second.CONTRACT.schemas?.Unused,
  );
  assertEquals(first.CONTRACT_DIGEST, second.CONTRACT_DIGEST);
});

Deno.test("contract digest normalizes capability order and duplicates", () => {
  const first = defineServiceContract({ schemas: baseSchemas }, (ref) => ({
    id: "digest.capabilities@v1",
    displayName: "Digest Capabilities",
    description: "Verify capability normalization.",
    rpc: {
      "Digest.Read": {
        version: "v1",
        input: ref.schema("Empty"),
        output: ref.schema("StringValue"),
        capabilities: { call: ["b", "a", "a"] },
      },
    },
    events: {
      "Digest.Changed": {
        version: "v1",
        event: ref.schema("StringValue"),
        capabilities: {
          publish: ["events.write", "events.admin", "events.write"],
          subscribe: ["events.read", "events.audit", "events.read"],
        },
      },
    },
  }));

  const second = defineServiceContract({ schemas: baseSchemas }, (ref) => ({
    id: "digest.capabilities@v1",
    displayName: "Digest Capabilities",
    description: "Verify capability normalization.",
    rpc: {
      "Digest.Read": {
        version: "v1",
        input: ref.schema("Empty"),
        output: ref.schema("StringValue"),
        capabilities: { call: ["a", "b"] },
      },
    },
    events: {
      "Digest.Changed": {
        version: "v1",
        event: ref.schema("StringValue"),
        capabilities: {
          publish: ["events.admin", "events.write"],
          subscribe: ["events.audit", "events.read"],
        },
      },
    },
  }));

  assertEquals(first.CONTRACT.rpc?.["Digest.Read"]?.capabilities?.call, [
    "a",
    "b",
  ]);
  assertEquals(first.CONTRACT_DIGEST, second.CONTRACT_DIGEST);
});

Deno.test("contract digest normalizes uses logical-name order and duplicates", () => {
  const dependency = defineServiceContract(
    { schemas: baseSchemas },
    (ref) => ({
      id: "digest.dependency@v1",
      displayName: "Digest Dependency",
      description: "Expose dependency surfaces for use normalization.",
      rpc: {
        "Dependency.A": {
          version: "v1",
          input: ref.schema("Empty"),
          output: ref.schema("StringValue"),
        },
        "Dependency.B": {
          version: "v1",
          input: ref.schema("Empty"),
          output: ref.schema("StringValue"),
        },
      },
    }),
  );

  const first = defineServiceContract({}, () => ({
    id: "digest.uses@v1",
    displayName: "Digest Uses",
    description: "Verify uses normalization.",
    uses: {
      dependency: dependency.use({
        rpc: { call: ["Dependency.B", "Dependency.A", "Dependency.A"] },
      }),
    },
  }));

  const second = defineServiceContract({}, () => ({
    id: "digest.uses@v1",
    displayName: "Digest Uses",
    description: "Verify uses normalization.",
    uses: {
      dependency: dependency.use({
        rpc: { call: ["Dependency.A", "Dependency.B"] },
      }),
    },
  }));

  assertEquals(first.CONTRACT.uses?.dependency.rpc?.call, [
    "Dependency.A",
    "Dependency.B",
  ]);
  assertEquals(first.CONTRACT_DIGEST, second.CONTRACT_DIGEST);
});

Deno.test("contract digest normalizes RPC error order and duplicates", () => {
  const NotFoundError = defineError({
    type: "NotFoundError",
    fields: {},
    message: "Not found",
  });

  const registry = {
    schemas: { Empty: EmptySchema },
    errors: { NotFoundError },
  } as const;

  const first = defineServiceContract(registry, (ref) => ({
    id: "digest.errors@v1",
    displayName: "Digest Errors",
    description: "Verify RPC error normalization.",
    rpc: {
      "Digest.Read": {
        version: "v1",
        input: ref.schema("Empty"),
        output: ref.schema("Empty"),
        errors: [
          ref.error("UnexpectedError"),
          ref.error("NotFoundError"),
          ref.error("UnexpectedError"),
        ],
      },
    },
  }));

  const second = defineServiceContract(registry, (ref) => ({
    id: "digest.errors@v1",
    displayName: "Digest Errors",
    description: "Verify RPC error normalization.",
    rpc: {
      "Digest.Read": {
        version: "v1",
        input: ref.schema("Empty"),
        output: ref.schema("Empty"),
        errors: [ref.error("NotFoundError"), ref.error("UnexpectedError")],
      },
    },
  }));

  assertEquals(first.CONTRACT.rpc?.["Digest.Read"]?.errors, [
    { type: "NotFoundError" },
    { type: "UnexpectedError" },
  ]);
  assertEquals(first.CONTRACT_DIGEST, second.CONTRACT_DIGEST);
});

Deno.test("contract digest changes for meaningful interface changes", () => {
  const first = defineServiceContract({ schemas: baseSchemas }, (ref) => ({
    id: "digest.meaningful@v1",
    displayName: "Digest Meaningful",
    description: "First interface.",
    rpc: {
      "Digest.Read": {
        version: "v1",
        input: ref.schema("Empty"),
        output: ref.schema("StringValue"),
      },
    },
  }));

  const second = defineServiceContract({ schemas: baseSchemas }, (ref) => ({
    id: "digest.meaningful@v1",
    displayName: "Digest Meaningful",
    description: "First interface.",
    rpc: {
      "Digest.Read": {
        version: "v1",
        input: ref.schema("Empty"),
        output: ref.schema("StringValue"),
        capabilities: { call: ["digest.read"] },
      },
    },
  }));

  assertNotEquals(first.CONTRACT_DIGEST, second.CONTRACT_DIGEST);
});

Deno.test("defineServiceContract derives local error schemas from defineError runtime metadata", () => {
  const NotFoundError = defineError({
    type: "NotFoundError",
    fields: {},
    message: "Not found",
  });

  const contract = defineServiceContract(
    {
      schemas: {
        Empty: EmptySchema,
      },
      errors: {
        NotFoundError,
      },
    },
    (ref) => ({
      id: "derived-local-errors.example@v1",
      displayName: "Derived Local Errors Example",
      description:
        "Verify local error schemas can be derived from defineError metadata.",
      rpc: {
        "Workspace.Get": {
          version: "v1",
          input: ref.schema("Empty"),
          output: ref.schema("Empty"),
          errors: [ref.error("NotFoundError"), ref.error("UnexpectedError")],
        },
      },
    }),
  );

  assertEquals(contract.CONTRACT.errors?.NotFoundError?.schema, {
    schema: "NotFoundErrorData",
  });
  assertEquals(
    contract.CONTRACT.schemas?.NotFoundErrorData,
    JSON.parse(JSON.stringify(NotFoundError.schema)),
  );
  assertEquals(
    unwrapSchema(
      contract.API.owned.rpc["Workspace.Get"].runtimeErrors?.[0]?.schema ?? {},
    ),
    JSON.parse(JSON.stringify(NotFoundError.schema)),
  );
});

Deno.test("defineServiceContract ignores non-error exports in a mixed errors barrel", () => {
  const NotFoundError = defineError({
    type: "NotFoundError",
    fields: {},
    message: "Not found",
  });

  const errors = {
    NotFoundError,
    NotFoundErrorDataSchema: NotFoundError.schema,
  } as const;

  const contract = defineServiceContract(
    {
      schemas: {
        Empty: EmptySchema,
      },
      errors,
    },
    (ref) => ({
      id: "mixed-local-errors.example@v1",
      displayName: "Mixed Local Errors Example",
      description:
        "Verify mixed error barrels can be passed directly to defineServiceContract.",
      rpc: {
        "Workspace.Get": {
          version: "v1",
          input: ref.schema("Empty"),
          output: ref.schema("Empty"),
          errors: [ref.error("NotFoundError"), ref.error("UnexpectedError")],
        },
      },
    }),
  );

  assertEquals(Object.keys(contract.CONTRACT.errors ?? {}), ["NotFoundError"]);
  assertEquals(contract.CONTRACT.errors?.NotFoundError?.type, "NotFoundError");
  assertEquals(contract.CONTRACT.errors?.NotFoundError?.schema, {
    schema: "NotFoundErrorData",
  });
});

Deno.test("defineServiceContract emits generated defineError classes", () => {
  const WorkspaceMissingError = defineError({
    type: "WorkspaceMissingError",
    fields: {
      resourceId: Type.String(),
    },
    message: ({ resourceId }) => `Workspace ${resourceId} not found`,
  });

  const errors = {
    WorkspaceMissingError,
    WorkspaceMissingErrorDataSchema: WorkspaceMissingError.schema,
  } as const;

  const contract = defineServiceContract(
    {
      schemas: {
        Empty: EmptySchema,
      },
      errors,
    },
    (ref) => ({
      id: "generated-local-errors.example@v1",
      displayName: "Generated Local Errors Example",
      description:
        "Verify generated defineError classes can be passed directly to defineServiceContract.",
      rpc: {
        "Workspace.Get": {
          version: "v1",
          input: ref.schema("Empty"),
          output: ref.schema("Empty"),
          errors: [
            ref.error("WorkspaceMissingError"),
            ref.error("UnexpectedError"),
          ],
        },
      },
    }),
  );

  assertEquals(
    contract.CONTRACT.errors?.WorkspaceMissingError?.type,
    "WorkspaceMissingError",
  );
  assertEquals(contract.CONTRACT.errors?.WorkspaceMissingError?.schema, {
    schema: "WorkspaceMissingErrorData",
  });
  assertEquals(
    unwrapSchema(
      contract.API.owned.rpc["Workspace.Get"].runtimeErrors?.[0]?.schema ?? {},
    ),
    JSON.parse(JSON.stringify(WorkspaceMissingError.schema)),
  );
});

Deno.test("defineServiceContract rejects duplicate logical keys across used and owned APIs", () => {
  const auth = defineServiceContract(
    { schemas: baseSchemas },
    () => ({
      id: "trellis.auth@v1",
      displayName: "Trellis Auth",
      description: "Expose auth RPCs in duplicate-key tests.",
      rpc: {
        "Auth.Me": {
          version: "v1",
          input: schemaRef<typeof baseSchemas, "Empty">("Empty"),
          output: schemaRef<typeof baseSchemas, "StringValue">("StringValue"),
        },
      },
    }),
  );

  assertThrows(
    () =>
      defineServiceContract(
        { schemas: baseSchemas },
        () => ({
          id: "duplicate@v1",
          displayName: "Duplicate",
          description: "Trigger duplicate logical RPC key validation.",
          uses: {
            auth: auth.use({ rpc: { call: ["Auth.Me"] } }),
          },
          rpc: {
            "Auth.Me": {
              version: "v1",
              input: schemaRef<typeof baseSchemas, "Empty">("Empty"),
              output: schemaRef<typeof baseSchemas, "StringValue">(
                "StringValue",
              ),
            },
          },
        }),
      ),
    Error,
    "Duplicate rpc key 'Auth.Me'",
  );
});

Deno.test("defineServiceContract validates use(...) provenance and selected keys at runtime", () => {
  const auth = defineServiceContract(
    { schemas: baseSchemas },
    () => ({
      id: "trellis.auth@v1",
      displayName: "Trellis Auth",
      description: "Expose auth RPCs in provenance tests.",
      rpc: {
        "Auth.Me": {
          version: "v1",
          input: schemaRef<typeof baseSchemas, "Empty">("Empty"),
          output: schemaRef<typeof baseSchemas, "StringValue">("StringValue"),
        },
      },
    }),
  );

  assertThrows(
    () => auth.use({ rpc: { call: JSON.parse('["Auth.Nope"]') } }),
    Error,
    "does not expose rpc key 'Auth.Nope'",
  );

  const forgedUse = structuredClone(auth.use({ rpc: { call: ["Auth.Me"] } }));

  assertThrows(
    () =>
      defineServiceContract({}, () => ({
        id: "forged@v1",
        displayName: "Forged",
        description: "Trigger forged use provenance validation.",
        uses: { auth: forgedUse },
      })),
    Error,
    "must be created with contractModule.use(...)",
  );
});

Deno.test("defineServiceContract emits KV resources with schema-backed defaults", () => {
  const kvSchemas = {
    Item: Type.Object({ value: Type.String() }),
  } as const;

  const contract = defineServiceContract(
    { schemas: kvSchemas },
    (ref) => ({
      id: "kv.example@v1",
      displayName: "KV Example",
      description: "Expose schema-backed KV resource declarations.",
      resources: {
        kv: {
          items: {
            purpose: "Persist typed items",
            schema: ref.schema("Item"),
          },
        },
      },
    }),
  );

  assertEquals(contract.CONTRACT.resources?.kv?.items, {
    purpose: "Persist typed items",
    schema: { schema: "Item" },
    required: true,
    history: 1,
    ttlMs: 0,
  });
});

Deno.test("defineServiceContract emits top-level jobs with defaults", () => {
  const contract = defineServiceContract({}, () => ({
    id: "jobs.example@v1",
    displayName: "Jobs Example",
    description: "Expose top-level jobs declarations in emitted manifests.",
    jobs: {
      refresh: {
        payload: { schema: "Empty" },
        result: { schema: "StringValue" },
      },
    },
  }));

  assertEquals(contract.CONTRACT.jobs?.refresh, {
    payload: { schema: "Empty" },
    result: { schema: "StringValue" },
  });
  assertEquals("jobs" in (contract.CONTRACT.resources ?? {}), false);
});

Deno.test("defineServiceContract emits store resources with defaults", () => {
  const contract = defineServiceContract({}, () => ({
    id: "store.example@v1",
    displayName: "Store Example",
    description: "Expose store resource declarations in emitted manifests.",
    resources: {
      store: {
        uploads: {
          purpose: "Temporary uploaded files awaiting processing",
          maxObjectBytes: 100 * 1024 * 1024,
        },
      },
    },
  }));

  assertEquals(contract.CONTRACT.resources?.store?.uploads, {
    purpose: "Temporary uploaded files awaiting processing",
    required: true,
    ttlMs: 0,
    maxObjectBytes: 100 * 1024 * 1024,
  });
});

Deno.test("locally defined contracts can be reused as dependencies", () => {
  const activity = defineServiceContract(
    { schemas: baseSchemas },
    () => ({
      id: "trellis.activity@v1",
      displayName: "Activity",
      description: "Expose activity events for dependency reuse tests.",
      events: {
        "Activity.Recorded": {
          version: "v1",
          event: schemaRef<typeof baseSchemas, "StringValue">("StringValue"),
        },
      },
    }),
  );

  const dashboard = defineAppContract(() => ({
    id: "trellis.dashboard@v1",
    displayName: "Dashboard",
    description: "Reuse locally defined contracts as dependencies in tests.",
    uses: {
      activity: activity.use({
        events: { subscribe: ["Activity.Recorded"] },
      }),
    },
  }));

  assertEquals(
    dashboard.CONTRACT.uses?.activity.contract,
    "trellis.activity@v1",
  );
  assertEquals(
    dashboard.API.used.events["Activity.Recorded"].subject,
    "events.v1.Activity.Recorded",
  );
  assertEquals(
    dashboard.API.trellis.events["Activity.Recorded"].subject,
    "events.v1.Activity.Recorded",
  );
});

Deno.test("defineServiceContract emits owned and used operations", () => {
  const billing = defineServiceContract(
    { schemas: baseSchemas },
    () => ({
      id: "trellis.billing@v1",
      displayName: "Billing",
      description: "Expose billing operations for source emission tests.",
      operations: {
        "Billing.Refund": {
          version: "v1",
          input: schemaRef<typeof baseSchemas, "Empty">("Empty"),
          progress: schemaRef<typeof baseSchemas, "StringValue">("StringValue"),
          output: schemaRef<typeof baseSchemas, "StringValue">("StringValue"),
          capabilities: {
            call: ["billing.refund"],
            read: ["billing.read"],
            cancel: ["billing.cancel"],
          },
          cancel: true,
        },
      },
    }),
  );

  const payments = defineServiceContract(
    { schemas: baseSchemas },
    () => ({
      id: "trellis.payments@v1",
      displayName: "Payments",
      description: "Use billing operations in source emission tests.",
      uses: {
        billing: billing.use({
          operations: { call: ["Billing.Refund"] },
        }),
      },
      operations: {
        "Payments.Capture": {
          version: "v1",
          input: schemaRef<typeof baseSchemas, "Empty">("Empty"),
          output: schemaRef<typeof baseSchemas, "StringValue">("StringValue"),
        },
      },
    }),
  );

  assertEquals(payments.CONTRACT.operations, {
    "Payments.Capture": {
      version: "v1",
      subject: "operations.v1.Payments.Capture",
      input: { schema: "Empty" },
      output: { schema: "StringValue" },
    },
  });
  assertEquals(payments.CONTRACT.uses?.billing, {
    contract: "trellis.billing@v1",
    operations: { call: ["Billing.Refund"] },
  });
  assertEquals(
    payments.API.owned.operations["Payments.Capture"].subject,
    "operations.v1.Payments.Capture",
  );
  assertEquals(
    payments.API.used.operations["Billing.Refund"].subject,
    "operations.v1.Billing.Refund",
  );
});

Deno.test("defineServiceContract emits transfer-capable operations", () => {
  const fileSchemas = {
    UploadInput: Type.Object({
      key: Type.String(),
    }),
  } as const;
  const files = defineServiceContract(
    { schemas: fileSchemas },
    () => ({
      id: "trellis.files@v1",
      displayName: "Files",
      description:
        "Expose transfer-capable operations for source emission tests.",
      resources: {
        store: {
          uploads: {
            purpose: "Temporary uploads",
            ttlMs: 60_000,
            maxObjectBytes: 1024,
          },
        },
      },
      operations: {
        "Demo.Files.Upload": {
          version: "v1",
          input: schemaRef<typeof fileSchemas, "UploadInput">("UploadInput"),
          transfer: {
            direction: "send",
            store: "uploads",
            key: "/key",
            expiresInMs: 60_000,
          },
        },
      },
    }),
  );

  assertEquals(files.CONTRACT.operations?.["Demo.Files.Upload"], {
    version: "v1",
    subject: "operations.v1.Demo.Files.Upload",
    input: { schema: "UploadInput" },
    transfer: {
      direction: "send",
      store: "uploads",
      key: "/key",
      expiresInMs: 60_000,
    },
  });
  assertEquals(files.API.owned.operations["Demo.Files.Upload"].transfer, {
    direction: "send",
    store: "uploads",
    key: "/key",
    expiresInMs: 60_000,
  });
});

Deno.test("defineServiceContract rejects duplicate logical keys across used and owned operations", () => {
  const billing = defineServiceContract(
    { schemas: baseSchemas },
    () => ({
      id: "trellis.billing@v1",
      displayName: "Billing",
      description: "Expose billing operations in duplicate-key tests.",
      operations: {
        "Billing.Refund": {
          version: "v1",
          input: schemaRef<typeof baseSchemas, "Empty">("Empty"),
        },
      },
    }),
  );

  assertThrows(
    () =>
      defineServiceContract(
        { schemas: baseSchemas },
        () => ({
          id: "duplicate.operations@v1",
          displayName: "Duplicate Operations",
          description: "Trigger duplicate logical operation key validation.",
          uses: {
            billing: billing.use({ operations: { call: ["Billing.Refund"] } }),
          },
          operations: {
            "Billing.Refund": {
              version: "v1",
              input: schemaRef<typeof baseSchemas, "Empty">("Empty"),
            },
          },
        }),
      ),
    Error,
    "Duplicate operations key 'Billing.Refund'",
  );
});

Deno.test("defineServiceContract validates operation use selections at runtime", () => {
  const billing = defineServiceContract(
    { schemas: baseSchemas },
    () => ({
      id: "trellis.billing@v1",
      displayName: "Billing",
      description: "Expose billing operations in runtime validation tests.",
      operations: {
        "Billing.Refund": {
          version: "v1",
          input: schemaRef<typeof baseSchemas, "Empty">("Empty"),
        },
      },
    }),
  );

  assertThrows(
    () =>
      billing.use({ operations: { call: JSON.parse('["Billing.Writeoff"]') } }),
    Error,
    "does not expose operations key 'Billing.Writeoff'",
  );
});
