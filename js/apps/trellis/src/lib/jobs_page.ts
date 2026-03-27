import type { Job, JobFilter, ServiceInfo } from "@qlever-llc/trellis-jobs";

type JobsClientLike = {
  requestOrThrow(method: string, input: unknown): Promise<unknown>;
};

export async function loadJobsPageData(
  trellis: JobsClientLike,
  filter: JobFilter = {},
): Promise<{ services: ServiceInfo[]; jobs: Job[] }> {
  const [servicesResponse, jobsResponse] = await Promise.all([
    trellis.requestOrThrow("Jobs.ListServices", {}) as Promise<{ services?: ServiceInfo[] }>,
    trellis.requestOrThrow("Jobs.List", filter) as Promise<{ jobs?: Job[] }>,
  ]);

  return {
    services: servicesResponse.services ?? [],
    jobs: jobsResponse.jobs ?? [],
  };
}
