import { connectService as connectDenoService } from "@qlever-llc/trellis-server/deno";

import { trellisJobs } from "./contracts/trellis_jobs.ts";

export function getJobsServiceConfig() {
  return {
    serviceName: Deno.env.get("TRELLIS_JOBS_SERVICE_NAME") ?? "jobs",
    sessionKeySeed: Deno.env.get("TRELLIS_JOBS_SESSION_KEY_SEED") ?? "",
    nats: {
      servers: Deno.env.get("TRELLIS_NATS_SERVERS") ?? "localhost:4222",
      sentinelCredsPath: Deno.env.get("TRELLIS_NATS_SENTINEL_CREDS_PATH") ?? "",
    },
  };
}

export async function bootstrapAndConnectJobsService() {
  const config = getJobsServiceConfig();
  return await connectDenoService(trellisJobs, config.serviceName, {
    sessionKeySeed: config.sessionKeySeed,
    nats: {
      servers: config.nats.servers,
      sentinelCredsPath: config.nats.sentinelCredsPath,
    },
    server: {},
  });
}
