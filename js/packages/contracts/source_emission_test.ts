import { assertEquals, assertThrows } from "@std/assert";
import { Type } from "typebox";

import { digestJson } from "./canonical.ts";
import { defineContract } from "./mod.ts";

const EmptySchema = Type.Object({}, { additionalProperties: false });
const StringSchema = Type.Object({ value: Type.String() }, { additionalProperties: false });

Deno.test("defineContract preserves emitted manifest shape and digest", async () => {
  const auth = defineContract({
    id: "trellis.auth@v1",
    displayName: "Trellis Auth",
    description: "Expose auth RPCs and events for source emission tests.",
    kind: "service",
    rpc: {
      "Auth.Me": {
        version: "v1",
        inputSchema: EmptySchema,
        outputSchema: StringSchema,
        capabilities: { call: [] },
        errors: ["UnexpectedError"],
      },
    },
    events: {
      "Auth.Connect": {
        version: "v1",
        eventSchema: StringSchema,
        capabilities: { publish: ["events:auth"], subscribe: ["events:auth"] },
      },
    },
  });

  const activity = defineContract({
    id: "trellis.activity@v1",
    displayName: "Activity",
    description: "Expose activity APIs while depending on auth in tests.",
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
        inputSchema: EmptySchema,
        outputSchema: StringSchema,
        capabilities: { call: ["activity.read"] },
        errors: ["UnexpectedError"],
      },
    },
    events: {
      "Activity.Recorded": {
        version: "v1",
        eventSchema: StringSchema,
        capabilities: { publish: ["events:activity"], subscribe: ["events:activity"] },
      },
    },
  });

  assertEquals(activity.CONTRACT, {
    format: "trellis.contract.v1",
    id: "trellis.activity@v1",
    displayName: "Activity",
    description: "Expose activity APIs while depending on auth in tests.",
    kind: "service",
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
        inputSchema: { additionalProperties: false, properties: {}, type: "object" },
        outputSchema: {
          additionalProperties: false,
          properties: { value: { type: "string" } },
          required: ["value"],
          type: "object",
        },
        capabilities: { call: ["activity.read"] },
        errors: [{ type: "UnexpectedError" }],
      },
    },
    events: {
      "Activity.Recorded": {
        version: "v1",
        subject: "events.v1.Activity.Recorded",
        eventSchema: {
          additionalProperties: false,
          properties: { value: { type: "string" } },
          required: ["value"],
          type: "object",
        },
        capabilities: {
          publish: ["events:activity"],
          subscribe: ["events:activity"],
        },
      },
    },
  });

  assertEquals(activity.API.owned.rpc["Activity.List"].subject, "rpc.v1.Activity.List");
  assertEquals(activity.API.used.rpc["Auth.Me"].subject, "rpc.v1.Auth.Me");
  assertEquals(activity.API.used.events["Auth.Connect"].subject, "events.v1.Auth.Connect");
  assertEquals(activity.API.trellis.rpc["Activity.List"].subject, "rpc.v1.Activity.List");
  assertEquals(activity.API.trellis.rpc["Auth.Me"].subject, "rpc.v1.Auth.Me");
  assertEquals(activity.CONTRACT_DIGEST, (await digestJson(activity.CONTRACT)).digest);
});

Deno.test("defineContract rejects duplicate logical keys across used and owned APIs", () => {
  const auth = defineContract({
    id: "trellis.auth@v1",
    displayName: "Trellis Auth",
    description: "Expose auth RPCs in duplicate-key tests.",
    kind: "service",
    rpc: {
      "Auth.Me": {
        version: "v1",
        inputSchema: EmptySchema,
        outputSchema: StringSchema,
      },
    },
  });

  assertThrows(
    () => defineContract({
      id: "duplicate@v1",
      displayName: "Duplicate",
      description: "Trigger duplicate logical RPC key validation.",
      kind: "service",
      uses: {
        auth: auth.use({ rpc: { call: ["Auth.Me"] } }),
      },
      rpc: {
        "Auth.Me": {
          version: "v1",
          inputSchema: EmptySchema,
          outputSchema: StringSchema,
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
    rpc: {
      "Auth.Me": {
        version: "v1",
        inputSchema: EmptySchema,
        outputSchema: StringSchema,
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
    () => defineContract({
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

Deno.test("locally defined contracts can be reused as dependencies", () => {
  const activity = defineContract({
    id: "trellis.activity@v1",
    displayName: "Activity",
    description: "Expose activity events for dependency reuse tests.",
    kind: "service",
    events: {
      "Activity.Recorded": {
        version: "v1",
        eventSchema: StringSchema,
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

  assertEquals(dashboard.CONTRACT.uses?.activity.contract, "trellis.activity@v1");
  assertEquals(dashboard.API.used.events["Activity.Recorded"].subject, "events.v1.Activity.Recorded");
  assertEquals(dashboard.API.trellis.events["Activity.Recorded"].subject, "events.v1.Activity.Recorded");
});
