import { connectDenoService } from "@trellis/server";

import { getConfig } from "./config.ts";
import { activity } from "./contracts/trellis_activity.ts";

const config = getConfig();

export async function bootstrapAndConnectActivityService() {
  return await connectDenoService(activity, config.serviceName, {
    sessionKeySeed: config.sessionKeySeed,
    nats: {
      servers: config.nats.servers,
      sentinelCredsPath: config.nats.sentinelCredsPath,
    },
    server: {},
  });
}
