import { defineServiceContract } from "@qlever-llc/trellis/contracts";
import { HealthHeartbeatSchema } from "@qlever-llc/trellis/health";

const schemas = {
  HealthHeartbeat: HealthHeartbeatSchema,
} as const;

export const health = defineServiceContract(
  { schemas },
  (ref) => ({
    id: "trellis.health@v1",
    displayName: "Trellis Health",
    description:
      "Expose shared Trellis heartbeat events for service observability.",
    events: {
      "Health.Heartbeat": {
        version: "v1",
        event: ref.schema("HealthHeartbeat"),
      },
    },
  }),
);

export const CONTRACT_ID = health.CONTRACT_ID;
export const CONTRACT = health.CONTRACT;
export const CONTRACT_DIGEST = health.CONTRACT_DIGEST;
export const API: typeof health.API = health.API;
export const use: typeof health.use = health.use;
export default health;
