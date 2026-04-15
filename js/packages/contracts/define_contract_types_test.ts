import { Type } from "typebox";

import {
  defineAppContract,
  defineDeviceContract,
  type ContractSourceRpcMethod,
  defineContract,
  defineServiceContract,
} from "./mod.ts";

const EmptySchema = Type.Object({});
const StringSchema = Type.Object({ value: Type.String() });
const ProgressSchema = Type.Object({ step: Type.String() });

type Assert<T extends true> = T;
type Not<T extends boolean> = T extends true ? false : true;
type HasKey<T, K extends PropertyKey> = K extends keyof T ? true : false;
type HasMember<T, U> = U extends T ? true : false;
type HasSubject<T, TKey extends PropertyKey> = TKey extends keyof T ? true : false;

const authSchemas = {
  Empty: EmptySchema,
  StringValue: StringSchema,
} as const;

function schemaRef<TSchemas extends Record<string, unknown>, const TName extends keyof TSchemas & string>(
  schema: TName,
) {
  return { schema } as const;
}

const auth = defineContract(
  { schemas: authSchemas },
  () => ({
    id: "trellis.auth@v1",
    displayName: "Trellis Auth",
    description: "Expose Trellis auth RPCs and events for tests.",
    kind: "service",
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

const activity = defineContract(
  { schemas: activitySchemas },
  () => ({
    id: "trellis.activity@v1",
    displayName: "Activity",
    description: "Expose activity RPCs and subscribe to auth events for tests.",
    kind: "service",
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
type AuthUseRpcCall = NonNullable<NonNullable<AuthUseArg["rpc"]>["call"]>[number];
type _AuthUseDoesNotAcceptTrellisCatalog = Assert<Not<HasMember<AuthUseRpcCall, "Trellis.Catalog">>>;

const dashboard = defineContract(
  {},
  () => ({
    id: "trellis.dashboard@v1",
    displayName: "Dashboard",
    description: "Consume activity events in contract typing tests.",
    kind: "app",
    uses: {
      activity: activity.use({
        events: { subscribe: ["Activity.Recorded"] },
      }),
    },
  }),
);

dashboard.API.used.events["Activity.Recorded"].subject;

const billingSchemas = {
  Empty: EmptySchema,
  Progress: StringSchema,
  Result: StringSchema,
} as const;

const billing = defineContract(
  { schemas: billingSchemas },
  () => ({
    id: "trellis.billing@v1",
    displayName: "Billing",
    description: "Expose billing operations for contract typing tests.",
    kind: "service",
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

const payments = defineContract(
  { schemas: paymentsSchemas },
  () => ({
    id: "trellis.payments@v1",
    displayName: "Payments",
    description: "Consume billing operations for contract typing tests.",
    kind: "service",
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
type BillingUseOperationCall = NonNullable<NonNullable<BillingUseArg["operations"]>["call"]>[number];
type _BillingUseDoesNotAcceptWriteoff = Assert<Not<HasMember<BillingUseOperationCall, "Billing.Writeoff">>>;

const inlineSchemaContract = defineContract(
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
    kind: "service",
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
    resources: {
      jobs: {
        queues: {
          import: {
            payload: { schema: "Empty" },
            result: { schema: "Result" },
          },
        },
      },
    },
  }),
);

inlineSchemaContract.API.owned.rpc["Inline.Run"].subject;
inlineSchemaContract.API.owned.operations["Inline.Import"].subject;

const builderContract = defineServiceContract(
  {
    schemas: {
      Empty: EmptySchema,
      Result: StringSchema,
    },
    errors: {
      BuilderFailed: { type: "BuilderFailed" },
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

  defineContract(
    {
      schemas: {
        Empty: EmptySchema,
      },
    },
    () => ({
      id: "trellis.invalid-job-schema@v1",
      displayName: "Invalid Job Schema",
      description: "Should fail type checking.",
      kind: "service",
      resources: {
        jobs: {
          queues: {
            import: {
              // @ts-expect-error job queue schema refs must use local schema keys
              payload: { schema: "Missing" },
            },
          },
        },
      },
    }),
  );

  defineContract(
    {
      schemas: {
        Empty: EmptySchema,
      },
      errors: {
        BuilderFailed: { type: "BuilderFailed" },
      },
    },
    (ref) => ({
      id: "trellis.invalid-builder@v1",
      displayName: "Invalid Builder",
      description: "Should fail type checking.",
      kind: "service",
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

Deno.test("defineContract type coverage compiles", () => {});
