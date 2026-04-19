import { assertEquals, assertThrows } from "@std/assert";
import { Type } from "typebox";

import { digestJson } from "./canonical.ts";
import {
  defineAppContract,
  defineError,
  defineServiceContract,
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
    { schemas: baseSchemas },
    () => ({
      id: "trellis.auth@v1",
      displayName: "Trellis Auth",
      description: "Expose auth RPCs and events for source emission tests.",
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
    (await digestJson(activity.CONTRACT)).digest,
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

Deno.test("defineServiceContract emits stream resources with defaults", () => {
  const contract = defineServiceContract({}, () => ({
    id: "streams.example@v1",
    displayName: "Streams Example",
    description: "Expose stream resource declarations in emitted manifests.",
    resources: {
      streams: {
        activity: {
          purpose: "Persist activity events",
          subjects: ["events.v1.Activity.Recorded"],
        },
      },
    },
  }));

  assertEquals(contract.CONTRACT.resources?.streams?.activity, {
    purpose: "Persist activity events",
    required: true,
    subjects: ["events.v1.Activity.Recorded"],
  });
});

Deno.test("defineServiceContract preserves rich stream resource configuration", () => {
  const contract = defineServiceContract({}, () => ({
    id: "streams.rich@v1",
    displayName: "Rich Streams Example",
    description:
      "Expose advanced stream resource declarations in emitted manifests.",
    resources: {
      streams: {
        jobs: {
          purpose: "Store job events",
          retention: "limits",
          storage: "file",
          numReplicas: 3,
          maxAgeMs: 0,
          maxBytes: -1,
          maxMsgs: -1,
          discard: "old",
          subjects: ["trellis.jobs.>"],
        },
        jobsWork: {
          purpose: "Store sourced work messages",
          retention: "workqueue",
          storage: "file",
          numReplicas: 3,
          subjects: ["trellis.work.>"],
          sources: [{
            fromAlias: "jobs",
            filterSubject: "trellis.jobs.*.*.*.created",
            subjectTransformDest: "trellis.work.$1.$2",
          }],
        },
      },
    },
  }));

  assertEquals(contract.CONTRACT.resources?.streams?.jobs, {
    purpose: "Store job events",
    required: true,
    retention: "limits",
    storage: "file",
    numReplicas: 3,
    maxAgeMs: 0,
    maxBytes: -1,
    maxMsgs: -1,
    discard: "old",
    subjects: ["trellis.jobs.>"],
  });
  assertEquals(contract.CONTRACT.resources?.streams?.jobsWork, {
    purpose: "Store sourced work messages",
    required: true,
    retention: "workqueue",
    storage: "file",
    numReplicas: 3,
    subjects: ["trellis.work.>"],
    sources: [{
      fromAlias: "jobs",
      filterSubject: "trellis.jobs.*.*.*.created",
      subjectTransformDest: "trellis.work.$1.$2",
    }],
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
      description: "Expose transfer-capable operations for source emission tests.",
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
      store: "uploads",
      key: "/key",
      expiresInMs: 60_000,
    },
  });
  assertEquals(files.API.owned.operations["Demo.Files.Upload"].transfer, {
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
