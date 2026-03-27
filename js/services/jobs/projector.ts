import type { TypedKV } from "@qlever-llc/trellis";
import { isErr } from "@qlever-llc/trellis-result";
import type { TrellisService } from "@qlever-llc/trellis-server";
import { Value } from "typebox/value";

import { reduceJobEvent } from "../../packages/jobs/projection.ts";
import { type JobEvent, JobEventSchema, type JobSchema } from "../../packages/jobs/types.ts";
import type { JobsOwnedApi, JobsTrellisApi } from "./contracts/trellis_jobs.ts";

type ProjectorRuntime = Pick<TrellisService<JobsOwnedApi, JobsTrellisApi>, "nc">;
type JobsProjectionStore = Pick<TypedKV<typeof JobSchema>, "get" | "put">;

export function startJobsProjection(
  service: ProjectorRuntime,
  jobsKV: JobsProjectionStore,
) {
  const sub = service.nc.subscribe("trellis.jobs.>");
  let stopping = false;

  const task = (async () => {
    try {
      for await (const message of sub) {
        let event: JobEvent;
        try {
          event = Value.Parse(JobEventSchema, JSON.parse(message.string())) as JobEvent;
        } catch {
          continue;
        }

        const key = `${event.service}.${event.jobType}.${event.jobId}`;
        const existing = (await jobsKV.get(key)).take();
        const current = isErr(existing) ? undefined : existing.value;
        const next = reduceJobEvent(current, event);
        if (!next) continue;

        await jobsKV.put(key, next);
      }
    } catch (error) {
      if (!stopping) {
        console.error("[jobs] projection loop stopped unexpectedly", error);
      }
    }
  })();

  return {
    async stop() {
      stopping = true;
      sub.unsubscribe();
      await task;
    },
  };
}
