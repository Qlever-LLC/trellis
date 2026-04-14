import { Type } from "typebox";

import { defineContract } from "./mod.ts";

const EmptySchema = Type.Object({});
const StringSchema = Type.Object({ value: Type.String() });

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

const auth = defineContract({
  id: "trellis.auth@v1",
  displayName: "Trellis Auth",
  description: "Expose Trellis auth RPCs and events for tests.",
  kind: "service",
  schemas: authSchemas,
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
});

const activitySchemas = {
  Empty: EmptySchema,
  StringValue: StringSchema,
} as const;

const activity = defineContract({
  id: "trellis.activity@v1",
  displayName: "Activity",
  description: "Expose activity RPCs and subscribe to auth events for tests.",
  kind: "service",
  schemas: activitySchemas,
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
});

activity.API.owned.rpc["Activity.List"].subject;
activity.API.used.rpc["Auth.Me"].subject;
activity.API.used.events["Auth.Connect"].subject;
activity.API.trellis.rpc["Activity.List"].subject;
activity.API.trellis.rpc["Auth.Me"].subject;

type AuthUseArg = Parameters<typeof auth.use>[0];
type AuthUseRpcCall = NonNullable<NonNullable<AuthUseArg["rpc"]>["call"]>[number];
type _AuthUseDoesNotAcceptTrellisCatalog = Assert<Not<HasMember<AuthUseRpcCall, "Trellis.Catalog">>>;

const dashboard = defineContract({
  id: "trellis.dashboard@v1",
  displayName: "Dashboard",
  description: "Consume activity events in contract typing tests.",
  kind: "app",
  uses: {
    activity: activity.use({
      events: { subscribe: ["Activity.Recorded"] },
    }),
  },
});

dashboard.API.used.events["Activity.Recorded"].subject;

const billingSchemas = {
  Empty: EmptySchema,
  Progress: StringSchema,
  Result: StringSchema,
} as const;

const billing = defineContract({
  id: "trellis.billing@v1",
  displayName: "Billing",
  description: "Expose billing operations for contract typing tests.",
  kind: "service",
  schemas: billingSchemas,
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
});

const paymentsSchemas = {
  Empty: EmptySchema,
  Result: StringSchema,
} as const;

const payments = defineContract({
  id: "trellis.payments@v1",
  displayName: "Payments",
  description: "Consume billing operations for contract typing tests.",
  kind: "service",
  schemas: paymentsSchemas,
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
});

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

if (false) {
  // @ts-expect-error kind is required on contract sources
  defineContract({
    id: "trellis.missing-kind@v1",
    displayName: "Missing Kind",
    description: "Should fail type checking.",
  });
}

Deno.test("defineContract type coverage compiles", () => {});
