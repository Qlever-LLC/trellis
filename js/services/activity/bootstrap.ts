import { TrellisService } from "@qlever-llc/trellis/service/deno";

import { getConfig } from "./config.ts";
import { activity } from "./contracts/trellis_activity.ts";

const config = getConfig();

export async function bootstrapAndConnectActivityService() {
  return await TrellisService.connect({
    trellisUrl: config.trellisUrl,
    contract: activity,
    name: config.serviceName,
    sessionKeySeed: config.sessionKeySeed,
    server: {},
  });
}
