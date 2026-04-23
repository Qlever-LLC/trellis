import { Type } from "typebox";

import {
  type ContractSourceRpcMethod,
  defineAppContract,
  defineDeviceContract,
  defineError,
  defineServiceContract,
  type SerializableErrorData,
} from "./mod.ts";

const EmptySchema = Type.Object({});
const StringSchema = Type.Object({ value: Type.String() });
const ProgressSchema = Type.Object({ step: Type.String() });
const BuilderFailed = defineError({
  type: "BuilderFailed",
  fields: {},
  message: "Builder failed",
});

type Assert<T extends true> = T;
type Not<T extends boolean> = T extends true ? false : true;
type Extends<T, U> = T extends U ? true : false;
type HasKey<T, K extends PropertyKey> = K extends keyof T ? true : false;
type HasMember<T, U> = U extends T ? true : false;
type HasSubject<T, TKey extends PropertyKey> = TKey extends keyof T ? true
  : false;

type BuilderFailedData = Parameters<typeof BuilderFailed.fromSerializable>[0];
type _BuilderFailedDataExtendsSerializableErrorData = Assert<
  Extends<BuilderFailedData, SerializableErrorData>
>;

const authSchemas = {
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

const auth = defineServiceContract(
  { schemas: authSchemas },
  () => ({
    id: "trellis.auth@v1",
    displayName: "Trellis Auth",
    description: "Expose Trellis auth RPCs and events for tests.",
    rpc: {
      "Auth.Me": {
        version: "v1",
        input: schemaRef<typeof authSchemas, "Empty">("Empty"),
        output: schemaRef<typeof authSchemas, "StringValue">("StringValue"),
      },
      "Auth.Logout": {
        version: "v1",
        input: schemaRef<typeof authSchemas, "Empty">("Empty"),
        output: schemaRef<typeof authSchemas, "Empty">("Empty"),
      },
    },
    events: {
      "Auth.Connect": {
        version: "v1",
        event: schemaRef<typeof authSchemas, "StringValue">("StringValue"),
      },
    },
  }),
);

const activitySchemas = {
  Empty: EmptySchema,
  StringValue: StringSchema,
} as const;

const activity = defineServiceContract(
  { schemas: activitySchemas },
  () => ({
    id: "trellis.activity@v1",
    displayName: "Activity",
    description: "Expose activity RPCs and subscribe to auth events for tests.",
    uses: {
      auth: auth.use({
        rpc: { call: ["Auth.Me"] },
        events: { subscribe: ["Auth.Connect"] },
      }),
    },
    rpc: {
      "Activity.List": {
        version: "v1",
        input: schemaRef<typeof activitySchemas, "Empty">("Empty"),
        output: schemaRef<typeof activitySchemas, "StringValue">("StringValue"),
      },
    },
    events: {
      "Activity.Recorded": {
        version: "v1",
        event: schemaRef<typeof activitySchemas, "StringValue">("StringValue"),
      },
    },
  }),
);

activity.API.owned.rpc["Activity.List"].subject;
activity.API.used.rpc["Auth.Me"].subject;
activity.API.used.events["Auth.Connect"].subject;
activity.API.trellis.rpc["Activity.List"].subject;
activity.API.trellis.rpc["Auth.Me"].subject;

type AuthUseArg = Parameters<typeof auth.use>[0];
type AuthUseRpcCall = NonNullable<
  NonNullable<AuthUseArg["rpc"]>["call"]
>[number];
type _AuthUseDoesNotAcceptTrellisCatalog = Assert<
  Not<HasMember<AuthUseRpcCall, "Trellis.Catalog">>
>;

const dashboard = defineAppContract(() => ({
  id: "trellis.dashboard@v1",
  displayName: "Dashboard",
  description: "Consume activity events in contract typing tests.",
  uses: {
    activity: activity.use({
      events: { subscribe: ["Activity.Recorded"] },
    }),
  },
}));

dashboard.API.used.events["Activity.Recorded"].subject;

const preferencesSchemas = {
  Preferences: Type.Object({ theme: Type.String() }),
  Draft: Type.Object({ title: Type.String() }),
} as const;

const preferencesApp = defineAppContract(
  { schemas: preferencesSchemas },
  (ref) => ({
    id: "trellis.preferences@v1",
    displayName: "Preferences",
    description: "Declare named state stores for client contracts.",
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

preferencesApp.CONTRACT.state?.preferences.kind;
preferencesApp.CONTRACT.state?.preferences.schema.schema;
preferencesApp.CONTRACT.state?.drafts.kind;
preferencesApp.CONTRACT.state?.drafts.schema.schema;

if (false) {
  defineAppContract(
    { schemas: preferencesSchemas },
    (ref) => ({
      id: "trellis.invalid-state@v1",
      displayName: "Invalid State",
      description: "Should fail type checking.",
      state: {
        // @ts-expect-error top-level state declarations require kind
        prefs: {
          schema: ref.schema("Preferences"),
        },
        drafts: {
          // @ts-expect-error state kind is limited to value or map
          kind: "set",
          schema: ref.schema("Draft"),
        },
      },
    }),
  );
}

const billingSchemas = {
  Empty: EmptySchema,
  Progress: StringSchema,
  Result: StringSchema,
} as const;

const billing = defineServiceContract(
  { schemas: billingSchemas },
  () => ({
    id: "trellis.billing@v1",
    displayName: "Billing",
    description: "Expose billing operations for contract typing tests.",
    operations: {
      "Billing.Refund": {
        version: "v1",
        input: schemaRef<typeof billingSchemas, "Empty">("Empty"),
        progress: schemaRef<typeof billingSchemas, "Progress">("Progress"),
        output: schemaRef<typeof billingSchemas, "Result">("Result"),
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

const paymentsSchemas = {
  Empty: EmptySchema,
  Result: StringSchema,
} as const;

const payments = defineServiceContract(
  { schemas: paymentsSchemas },
  () => ({
    id: "trellis.payments@v1",
    displayName: "Payments",
    description: "Consume billing operations for contract typing tests.",
    uses: {
      billing: billing.use({
        operations: { call: ["Billing.Refund"] },
      }),
    },
    operations: {
      "Payments.Capture": {
        version: "v1",
        input: schemaRef<typeof paymentsSchemas, "Empty">("Empty"),
        output: schemaRef<typeof paymentsSchemas, "Result">("Result"),
      },
    },
  }),
);

payments.API.owned.operations["Payments.Capture"].subject;
payments.API.used.operations["Billing.Refund"].subject;
payments.API.trellis.operations["Payments.Capture"].subject;
payments.API.trellis.operations["Billing.Refund"].subject;

type _PaymentsDoesNotExposeBillingWriteoff = Assert<
  Not<HasKey<typeof payments.API.trellis.operations, "Billing.Writeoff">>
>;
type BillingUseArg = Parameters<typeof billing.use>[0];
type BillingUseOperationCall = NonNullable<
  NonNullable<BillingUseArg["operations"]>["call"]
>[number];
type _BillingUseDoesNotAcceptWriteoff = Assert<
  Not<HasMember<BillingUseOperationCall, "Billing.Writeoff">>
>;

const inlineSchemaContract = defineServiceContract(
  {
    schemas: {
      Empty: EmptySchema,
      Progress: ProgressSchema,
      Result: StringSchema,
    },
  },
  () => ({
    id: "trellis.inline-schemas@v1",
    displayName: "Inline Schemas",
    description: "Use inline schema refs without a local helper.",
    rpc: {
      "Inline.Run": {
        version: "v1",
        input: { schema: "Empty" },
        output: { schema: "Result" },
      },
    },
    operations: {
      "Inline.Import": {
        version: "v1",
        input: { schema: "Empty" },
        progress: { schema: "Progress" },
        output: { schema: "Result" },
      },
    },
    jobs: {
      import: {
        payload: { schema: "Empty" },
        result: { schema: "Result" },
      },
    },
  }),
);

inlineSchemaContract.CONTRACT.jobs?.import?.payload.schema;
inlineSchemaContract.API.owned.rpc["Inline.Run"].subject;
inlineSchemaContract.API.owned.operations["Inline.Import"].subject;

const topLevelJobsContract = defineServiceContract(
  {
    schemas: {
      Empty: EmptySchema,
      Result: StringSchema,
    },
  },
  () => ({
    id: "trellis.top-level-jobs@v1",
    displayName: "Top Level Jobs",
    description: "Ensure jobs are typed as a first-class contract surface.",
    jobs: {
      import: {
        payload: { schema: "Empty" },
        result: { schema: "Result" },
      },
      export: {
        payload: { schema: "Empty" },
      },
    },
  }),
);

topLevelJobsContract.CONTRACT.jobs?.import?.result?.schema;
topLevelJobsContract.CONTRACT.jobs?.export?.payload.schema;

if (false) {
  defineServiceContract(
    {
      schemas: {
        Empty: EmptySchema,
      },
    },
    () => ({
      id: "trellis.invalid-jobs-resource@v1",
      displayName: "Invalid Jobs Resource",
      description: "Should fail type checking.",
      resources: {
        // @ts-expect-error jobs are now a first-class top-level contract section
        jobs: {
          queues: {
            import: {
              payload: { schema: "Empty" },
            },
          },
        },
      },
    }),
  );

}

const transferSchemas = {
  UploadInput: Type.Object({
    key: Type.String(),
    contentType: Type.Optional(Type.String()),
  }),
} as const;

const transferContract = defineServiceContract(
  { schemas: transferSchemas },
  (ref) => ({
    id: "trellis.transfer@v1",
    displayName: "Transfer",
    description: "Exercise transfer-capable operation typing.",
    resources: {
      kv: {
        uploadsByKey: {
          purpose: "Track upload metadata",
          schema: ref.schema("UploadInput"),
        },
      },
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
        input: { schema: "UploadInput" },
        transfer: {
          store: "uploads",
          key: "/key",
          contentType: "/contentType",
          expiresInMs: 60_000,
        },
      },
    },
  }),
);

transferContract.API.owned.operations["Demo.Files.Upload"].transfer?.store;
transferContract.CONTRACT.resources?.kv?.uploadsByKey?.schema.schema;

const builderContract = defineServiceContract(
  {
    schemas: {
      Empty: EmptySchema,
      Result: StringSchema,
    },
    errors: {
      BuilderFailed,
    },
  },
  (ref) => ({
    id: "trellis.builder@v1",
    displayName: "Builder Contract",
    description: "Exercise the builder-style contract authoring API.",
    rpc: {
      "Builder.Run": {
        version: "v1",
        input: ref.schema("Empty"),
        output: ref.schema("Result"),
        errors: [ref.error("BuilderFailed"), ref.error("UnexpectedError")],
      },
    },
  }),
);

builderContract.API.owned.rpc["Builder.Run"].subject;

const appContract = defineAppContract(() => ({
  id: "trellis.builder-app@v1",
  displayName: "Builder App",
  description: "Exercise the app helper.",
  uses: {
    auth: auth.use({ rpc: { call: ["Auth.Me"] } }),
  },
}));

appContract.API.used.rpc["Auth.Me"].subject;

const deviceContract = defineDeviceContract(() => ({
  id: "trellis.builder-device@v1",
  displayName: "Builder Device",
  description: "Exercise the device helper.",
  uses: {
    auth: auth.use({ rpc: { call: ["Auth.Logout"] } }),
  },
}));

deviceContract.API.used.rpc["Auth.Logout"].subject;

if (false) {
  const invalidRpcSchemas = {
    Empty: EmptySchema,
    Result: StringSchema,
  } as const;

  const invalidRpcMethod: ContractSourceRpcMethod<
    keyof typeof invalidRpcSchemas & string
  > = {
    version: "v1",
    // @ts-expect-error rpc schema refs must use local schema keys
    input: { schema: "Missing" },
    output: { schema: "Result" },
  };

  invalidRpcMethod;

  defineServiceContract(
    {
      schemas: {
        Empty: EmptySchema,
      },
    },
    () => ({
      id: "trellis.invalid-job-schema@v1",
      displayName: "Invalid Job Schema",
      description: "Should fail type checking.",
      jobs: {
        import: {
          // @ts-expect-error job queue schema refs must use local schema keys
          payload: { schema: "Missing" },
        },
      },
    }),
  );

  defineServiceContract(
    {
      schemas: {
        Empty: EmptySchema,
      },
    },
    (ref) => ({
      id: "trellis.invalid-kv-schema@v1",
      displayName: "Invalid KV Schema",
      description: "Should fail type checking.",
      resources: {
        kv: {
          cache: {
            purpose: "Broken KV schema ref",
            // @ts-expect-error kv resource schema refs must use local schema keys
            schema: ref.schema("Missing"),
          },
        },
      },
    }),
  );

  defineServiceContract(
    {
      schemas: {
        Empty: EmptySchema,
      },
      errors: {
        BuilderFailed,
      },
    },
    (ref) => ({
      id: "trellis.invalid-builder@v1",
      displayName: "Invalid Builder",
      description: "Should fail type checking.",
      rpc: {
        "Builder.Run": {
          version: "v1",
          // @ts-expect-error builder schema refs must use local schema keys
          input: ref.schema("Missing"),
          output: ref.schema("Empty"),
          errors: [
            ref.error("BuilderFailed"),
            // @ts-expect-error builder error refs must use local or builtin error names
            ref.error("MissingError"),
          ],
        },
      },
    }),
  );

  defineAppContract(() => ({
    id: "trellis.invalid-app@v1",
    displayName: "Invalid App",
    description: "Should fail type checking.",
    // @ts-expect-error app contracts may not declare local schemas
    schemas: { Empty: EmptySchema },
  }));

  defineDeviceContract(() => ({
    id: "trellis.invalid-device@v1",
    displayName: "Invalid Device",
    description: "Should fail type checking.",
    // @ts-expect-error device contracts may not declare resources
    resources: {
      store: {
        uploads: {
          purpose: "not allowed",
        },
      },
    },
  }));
}

Deno.test("kind-specific contract helper type coverage compiles", () => {});
