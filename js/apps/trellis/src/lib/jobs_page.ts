import { BaseError, isErr, type Result } from "@qlever-llc/trellis-result";
import { type Job, JobClient, type JobFilter, type ServiceInfo } from "../../../../packages/jobs/mod.ts";

type JobsClientLike = {
  request(method: string, input: unknown): Promise<Result<any, BaseError>>;
};

export async function loadJobsPageData(
  trellis: JobsClientLike,
  filter: JobFilter = {},
): Promise<{
  available: boolean;
  message?: string;
  services: ServiceInfo[];
  jobs: Job[];
}> {
  try {
    const client = new JobClient(trellis);
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
    const message = error instanceof BaseError
      ? String(error.getContext().causeMessage ?? error.message)
      : error instanceof Error
      ? error.message
      : String(error);
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
