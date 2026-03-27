import { isErr } from "@qlever-llc/trellis-result";
import { JobSchema, ServiceRegistrationSchema } from "../../packages/jobs/types.ts";
import { bootstrapAndConnectJobsService } from "./bootstrap.ts";
import { startJobsProjection } from "./projector.ts";
import { registerJobsRpcHandlers } from "./rpcs.ts";

function requireBinding<T>(value: T | undefined, message: string): T {
  if (!value) {
    throw new Error(message);
  }
  return value;
}

const service = await bootstrapAndConnectJobsService();

const jobsKVResult = (await requireBinding(service.kv.jobsState, "Missing `jobsState` KV binding handle.").open(JobSchema)).take();
if (isErr(jobsKVResult)) {
  throw new Error("Missing `jobsState` KV binding.");
}
const serviceInstancesKVResult = (await requireBinding(service.kv.serviceInstances, "Missing `serviceInstances` KV binding handle.").open(ServiceRegistrationSchema)).take();
if (isErr(serviceInstancesKVResult)) {
  throw new Error("Missing `serviceInstances` KV binding.");
}
const jobsKV = jobsKVResult;
const serviceInstancesKV = serviceInstancesKVResult;

await registerJobsRpcHandlers(service, {
  jobsKV,
  serviceInstancesKV,
});
const projector = startJobsProjection(service, jobsKV);

console.info("[jobs] service is running", {
  service: service.name,
  sessionKey: service.auth.sessionKey,
});

const shutdown = async () => {
  console.info("[jobs] shutting down");
  await projector.stop();
  await service.stop();
  Deno.exit(0);
};

Deno.addSignalListener("SIGINT", () => void shutdown());
Deno.addSignalListener("SIGTERM", () => void shutdown());

await new Promise<void>(() => {});
