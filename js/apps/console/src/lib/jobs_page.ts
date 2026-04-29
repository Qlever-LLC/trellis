import { AsyncResult, BaseError, isErr } from "@qlever-llc/result";
import {
  type JobsListInput,
  type JobsListOutput,
  type JobsListServicesOutput,
} from "@qlever-llc/trellis/sdk/jobs";

type JobsPageRpc = {
  listServices(): AsyncResult<JobsListServicesOutput, BaseError>;
  listJobs(filter: JobsListInput): AsyncResult<JobsListOutput, BaseError>;
};

export async function loadJobsPageData(
  rpc: JobsPageRpc,
  filter: JobsListInput = {},
): Promise<{
  available: boolean;
  message?: string;
  services: JobsListServicesOutput["services"];
  jobs: JobsListOutput["jobs"];
}> {
  try {
    const [servicesResponse, jobsResponse] = await Promise.all([
      rpc.listServices(),
      rpc.listJobs(filter),
    ]);

    const servicesValue = servicesResponse.take();
    if (isErr(servicesValue)) {
      throw servicesValue.error;
    }

    const jobsValue = jobsResponse.take();
    if (isErr(jobsValue)) {
      throw jobsValue.error;
    }

    return {
      available: true,
      services: servicesValue.services,
      jobs: jobsValue.jobs,
    };
  } catch (error) {
    let message: string;
    if (error instanceof BaseError) {
      message = String(error.getContext().causeMessage ?? error.message);
    } else if (error instanceof Error) {
      message = error.message;
    } else {
      message = String(error);
    }
    if (
      message.includes("Permissions Violation") &&
      message.includes("rpc.v1.Jobs.")
    ) {
      return {
        available: false,
        message:
          "Your current session is not approved for Jobs RPCs. Sign out and sign back in to refresh permissions.",
        services: [],
        jobs: [],
      };
    }
    if (
      message.includes("No responders available for request") ||
      message.includes("references inactive contract") ||
      message.includes("not currently reachable")
    ) {
      return {
        available: false,
        message: "Jobs admin runtime is not currently reachable.",
        services: [],
        jobs: [],
      };
    }
    throw error;
  }
}
