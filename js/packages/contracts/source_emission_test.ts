import { assertEquals, assertThrows } from "@std/assert";
import { Type } from "typebox";

import { digestJson } from "./canonical.ts";
import { defineContract } from "./mod.ts";

const EmptySchema = Type.Object({}, { additionalProperties: false });
const StringSchema = Type.Object({ value: Type.String() }, {
  additionalProperties: false,
});

const baseSchemas = {
  Empty: EmptySchema,
  StringValue: StringSchema,
} as const;

function schemaRef<TSchemas extends Record<string, unknown>, const TName extends keyof TSchemas & string>(
  schema: TName,
) {
  return { schema } as const;
}

Deno.test("defineContract preserves emitted manifest shape and digest", async () => {
  const auth = defineContract({
    id: "trellis.auth@v1",
    displayName: "Trellis Auth",
    description: "Expose auth RPCs and events for source emission tests.",
    kind: "service",
    schemas: baseSchemas,
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
        capabilities: { publish: ["events:auth"], subscribe: ["events:auth"] },
      },
    },
  });

  const activity = defineContract({
    id: "trellis.activity@v1",
    displayName: "Activity",
    description: "Expose activity APIs while depending on auth in tests.",
    kind: "service",
    schemas: baseSchemas,
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
  });

  assertEquals(activity.CONTRACT, {
    format: "trellis.contract.v1",
    id: "trellis.activity@v1",
    displayName: "Activity",
    description: "Expose activity APIs while depending on auth in tests.",
    kind: "service",
    schemas: {
      Empty: {
        additionalProperties: false,
        properties: {},
        type: "object",
      },
      StringValue: {
        additionalProperties: false,
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

Deno.test("defineContract rejects duplicate logical keys across used and owned APIs", () => {
  const auth = defineContract({
    id: "trellis.auth@v1",
    displayName: "Trellis Auth",
    description: "Expose auth RPCs in duplicate-key tests.",
    kind: "service",
    schemas: baseSchemas,
    rpc: {
      "Auth.Me": {
        version: "v1",
        input: schemaRef<typeof baseSchemas, "Empty">("Empty"),
        output: schemaRef<typeof baseSchemas, "StringValue">("StringValue"),
      },
    },
  });

  assertThrows(
    () =>
      defineContract({
        id: "duplicate@v1",
        displayName: "Duplicate",
        description: "Trigger duplicate logical RPC key validation.",
        kind: "service",
        schemas: baseSchemas,
        uses: {
          auth: auth.use({ rpc: { call: ["Auth.Me"] } }),
        },
        rpc: {
          "Auth.Me": {
            version: "v1",
            input: schemaRef<typeof baseSchemas, "Empty">("Empty"),
            output: schemaRef<typeof baseSchemas, "StringValue">("StringValue"),
          },
        },
      }),
    Error,
    "Duplicate rpc key 'Auth.Me'",
  );
});

Deno.test("defineContract validates use(...) provenance and selected keys at runtime", () => {
  const auth = defineContract({
    id: "trellis.auth@v1",
    displayName: "Trellis Auth",
    description: "Expose auth RPCs in provenance tests.",
    kind: "service",
    schemas: baseSchemas,
    rpc: {
      "Auth.Me": {
        version: "v1",
        input: schemaRef<typeof baseSchemas, "Empty">("Empty"),
        output: schemaRef<typeof baseSchemas, "StringValue">("StringValue"),
      },
    },
  });

  assertThrows(
    () => auth.use({ rpc: { call: ["Auth.Nope" as never] } }),
    Error,
    "does not expose rpc key 'Auth.Nope'",
  );

  const forgedUse = {
    contract: auth.CONTRACT_ID,
    rpc: { call: ["Auth.Me"] },
  } as unknown as ReturnType<typeof auth.use>;

  assertThrows(
    () =>
      defineContract({
        id: "forged@v1",
        displayName: "Forged",
        description: "Trigger forged use provenance validation.",
        kind: "service",
        uses: { auth: forgedUse },
      }),
    Error,
    "must be created with contractModule.use(...)",
  );
});

Deno.test("defineContract emits stream resources with defaults", () => {
  const contract = defineContract({
    id: "streams.example@v1",
    displayName: "Streams Example",
    description: "Expose stream resource declarations in emitted manifests.",
    kind: "service",
    resources: {
      streams: {
        activity: {
          purpose: "Persist activity events",
          subjects: ["events.v1.Activity.Recorded"],
        },
      },
    },
  });

  assertEquals(contract.CONTRACT.resources?.streams?.activity, {
    purpose: "Persist activity events",
    required: true,
    subjects: ["events.v1.Activity.Recorded"],
  });
});

Deno.test("locally defined contracts can be reused as dependencies", () => {
  const activity = defineContract({
    id: "trellis.activity@v1",
    displayName: "Activity",
    description: "Expose activity events for dependency reuse tests.",
    kind: "service",
    schemas: baseSchemas,
    events: {
      "Activity.Recorded": {
        version: "v1",
        event: schemaRef<typeof baseSchemas, "StringValue">("StringValue"),
      },
    },
  });

  const dashboard = defineContract({
    id: "trellis.dashboard@v1",
    displayName: "Dashboard",
    description: "Reuse locally defined contracts as dependencies in tests.",
    kind: "app",
    uses: {
      activity: activity.use({
        events: { subscribe: ["Activity.Recorded"] },
      }),
    },
  });

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

Deno.test("defineContract emits owned and used operations", () => {
  const billing = defineContract({
    id: "trellis.billing@v1",
    displayName: "Billing",
    description: "Expose billing operations for source emission tests.",
    kind: "service",
    schemas: baseSchemas,
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
  });

  const payments = defineContract({
    id: "trellis.payments@v1",
    displayName: "Payments",
    description: "Use billing operations in source emission tests.",
    kind: "service",
    schemas: baseSchemas,
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
  });

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

Deno.test("defineContract rejects duplicate logical keys across used and owned operations", () => {
  const billing = defineContract({
    id: "trellis.billing@v1",
    displayName: "Billing",
    description: "Expose billing operations in duplicate-key tests.",
    kind: "service",
    schemas: baseSchemas,
    operations: {
      "Billing.Refund": {
        version: "v1",
        input: schemaRef<typeof baseSchemas, "Empty">("Empty"),
      },
    },
  });

  assertThrows(
    () =>
      defineContract({
        id: "duplicate.operations@v1",
        displayName: "Duplicate Operations",
        description: "Trigger duplicate logical operation key validation.",
        kind: "service",
        schemas: baseSchemas,
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
    Error,
    "Duplicate operations key 'Billing.Refund'",
  );
});

Deno.test("defineContract validates operation use selections at runtime", () => {
  const billing = defineContract({
    id: "trellis.billing@v1",
    displayName: "Billing",
    description: "Expose billing operations in runtime validation tests.",
    kind: "service",
    schemas: baseSchemas,
    operations: {
      "Billing.Refund": {
        version: "v1",
        input: schemaRef<typeof baseSchemas, "Empty">("Empty"),
      },
    },
  });

  assertThrows(
    () => billing.use({ operations: { call: ["Billing.Writeoff" as never] } }),
    Error,
    "does not expose operations key 'Billing.Writeoff'",
  );
});
