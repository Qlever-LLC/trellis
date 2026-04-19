import { AsyncResult, BaseError, isErr } from "@qlever-llc/result";
import {
  type JobFilter,
  type JobSnapshot,
  type ServiceInfo,
} from "@qlever-llc/trellis";

type JobsAdminClientLike = {
  listServices(): AsyncResult<ServiceInfo[], BaseError>;
  list(filter?: JobFilter): AsyncResult<JobSnapshot<unknown, unknown>[], BaseError>;
};

type JobsClientLike = {
  jobs(): JobsAdminClientLike;
};

export async function loadJobsPageData(
  trellis: JobsClientLike,
  filter: JobFilter = {},
): Promise<{
  available: boolean;
  message?: string;
  services: ServiceInfo[];
  jobs: JobSnapshot<unknown, unknown>[];
}> {
  try {
    const client = trellis.jobs();
    const [servicesResponse, jobsResponse] = await Promise.all([
      client.listServices(),
      client.list(filter),
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
      services: servicesValue,
      jobs: jobsValue,
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
        message: "Jobs service is not installed or not currently reachable.",
        services: [],
        jobs: [],
      };
    }
    throw error;
  }
}
