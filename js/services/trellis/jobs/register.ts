import type { ServiceHandle } from "@qlever-llc/trellis/sdk/jobs";
import type { createJobsAdminHandlers } from "./rpc.ts";

type JobsAdminHandlers = ReturnType<typeof createJobsAdminHandlers>;
type JobsRpcRegistrar = {
  handle: {
    rpc: {
      jobs: Pick<
        ServiceHandle["rpc"]["jobs"],
        "health" | "list" | "get" | "cancel" | "listServices"
      >;
    };
  };
};

/** Registers the Jobs admin RPC subset implemented by the JS control-plane. */
export async function registerJobsAdmin(deps: {
  trellis: JobsRpcRegistrar;
  handlers: JobsAdminHandlers;
}): Promise<void> {
  await deps.trellis.handle.rpc.jobs.health(deps.handlers.health);
  await deps.trellis.handle.rpc.jobs.list(deps.handlers.list);
  await deps.trellis.handle.rpc.jobs.get(deps.handlers.get);
  await deps.trellis.handle.rpc.jobs.cancel(deps.handlers.cancel);
  await deps.trellis.handle.rpc.jobs.listServices(deps.handlers.listServices);
}
