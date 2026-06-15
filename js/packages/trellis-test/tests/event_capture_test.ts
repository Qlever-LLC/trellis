import { assertRejects } from "@std/assert";
import { defineServiceContract } from "@qlever-llc/trellis";
import { Type } from "typebox";
import { startTrellisTestEventCapture } from "../src/event_capture.ts";

const duplicateEventContract = defineServiceContract(
  {
    schemas: {
      Changed: Type.Object({ id: Type.String() }),
    },
  },
  (ref) => ({
    id: "trellis.test.event-capture@v1",
    displayName: "Trellis Test Event Capture",
    description: "Verifies event capture validation.",
    events: {
      "Entity.Changed": {
        version: "v1",
        event: ref.schema("Changed"),
      },
    },
  }),
);

Deno.test("event capture rejects duplicate event names", async () => {
  await assertRejects(
    () =>
      startTrellisTestEventCapture({
        runtime: {
          contracts: {
            approve: async () => {
              throw new Error("duplicate validation should run before approve");
            },
          },
          connectClient: async () => {
            throw new Error("duplicate validation should run before connect");
          },
          waitFor: async () => {
            throw new Error("duplicate validation should not wait");
          },
        },
        options: {
          name: "duplicate-events",
          contract: duplicateEventContract,
          events: ["Entity.Changed", "Entity.Changed"],
        },
        onStop: () => undefined,
      }),
    Error,
    "Duplicate event name 'Entity.Changed' in Trellis event capture options",
  );
});
