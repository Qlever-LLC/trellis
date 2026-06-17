// Generated from ./generated/contracts/manifests/trellis.health@v1.json
import type { TrellisAPI } from "../../../contracts.ts";
import { schema } from "../../../contracts.ts";
import type * as Types from "./types.ts";
import { HealthHeartbeatSchema } from "./schemas.ts";

export const OWNED_API = {
  rpc: {},
  operations: {},
  events: {
    "Health.Heartbeat": {
      subject: "events.v1.Health.Heartbeat",
      event: schema<Types.HealthHeartbeatEvent>(HealthHeartbeatSchema),
      publishCapabilities: [] as const,
      subscribeCapabilities: [] as const,
    },
  },
  feeds: {},
  subjects: {},
} satisfies TrellisAPI;
