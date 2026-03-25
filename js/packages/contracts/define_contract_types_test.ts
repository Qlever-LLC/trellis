import { Type } from "typebox";

import { defineContract } from "./mod.ts";

const EmptySchema = Type.Object({}, { additionalProperties: false });
const StringSchema = Type.Object({ value: Type.String() }, { additionalProperties: false });

const auth = defineContract({
  id: "trellis.auth@v1",
  displayName: "Trellis Auth",
  description: "Expose Trellis auth RPCs and events for tests.",
  kind: "service",
  rpc: {
    "Auth.Me": {
      version: "v1",
      inputSchema: EmptySchema,
      outputSchema: StringSchema,
    },
    "Auth.Logout": {
      version: "v1",
      inputSchema: EmptySchema,
      outputSchema: EmptySchema,
    },
  },
  events: {
    "Auth.Connect": {
      version: "v1",
      eventSchema: StringSchema,
    },
  },
});

const activity = defineContract({
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
      inputSchema: EmptySchema,
      outputSchema: StringSchema,
    },
  },
  events: {
    "Activity.Recorded": {
      version: "v1",
      eventSchema: StringSchema,
    },
  },
});

activity.API.owned.rpc["Activity.List"].subject;
activity.API.used.rpc["Auth.Me"].subject;
activity.API.used.events["Auth.Connect"].subject;
activity.API.trellis.rpc["Activity.List"].subject;
activity.API.trellis.rpc["Auth.Me"].subject;

// @ts-expect-error Auth.Logout is not declared in local uses.
activity.API.trellis.rpc["Auth.Logout"];

if (false) {
  // @ts-expect-error Trellis.Catalog is not part of trellis.auth@v1.
  auth.use({ rpc: { call: ["Trellis.Catalog"] } });
}

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

Deno.test("defineContract type coverage compiles", () => {});
