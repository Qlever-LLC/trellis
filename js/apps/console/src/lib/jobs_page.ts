import { AsyncResult, BaseError, isErr } from "@qlever-llc/result";
import {
  type JobsCancelOutput,
  type JobsDismissDLQOutput,
  type JobsGetOutput,
  type JobsListInput,
  type JobsListOutput,
  type JobsListServicesOutput,
  type JobsReplayDLQOutput,
  type JobsRetryOutput,
} from "@qlever-llc/trellis/sdk/jobs";

export type JobsPageData = {
  available: boolean;
  message?: string;
  services: JobsListServicesOutput["services"];
  jobs: JobsListOutput["jobs"];
  hasMore: boolean;
  nextCursor?: string;
};

export type JobsDetailData = {
  available: boolean;
  message?: string;
  job?: NonNullable<JobsGetOutput["job"]>;
};

type JobsPageRpc = {
  listServices(): AsyncResult<JobsListServicesOutput, BaseError>;
  listJobs(filter: JobsListInput): AsyncResult<JobsListOutput, BaseError>;
};

type JobsDetailRpc = {
  getJob(input: { id: string }): AsyncResult<JobsGetOutput, BaseError>;
};

type JobsActionRpc<TOutput> = {
  action(input: { id: string }): AsyncResult<TOutput, BaseError>;
};

function unavailableResult<T extends { available: false; message: string }>(
  result: T,
): T {
  return result;
}

function normalizedJobsUnavailable(error: unknown): string | null {
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
    return "Your current session is not approved for Jobs RPCs. Sign out and sign back in to refresh permissions.";
  }

  const normalizedMessage = message.toLowerCase();
  if (
    normalizedMessage.includes("no responders") ||
    message.includes("No responders available for request") ||
    message.includes("references inactive contract") ||
    message.includes("not currently reachable")
  ) {
    return "Jobs admin runtime is not currently reachable.";
  }

  return null;
}

async function takeOrThrow<T>(result: AsyncResult<T, BaseError>): Promise<T> {
  const value = await result.take();
  if (isErr(value)) {
    throw value.error;
  }
  return value;
}

/** Loads the Jobs list page data and normalizes unavailable Jobs runtime errors. */
export async function loadJobsPageData(
  rpc: JobsPageRpc,
  filter: JobsListInput = {},
): Promise<JobsPageData> {
  try {
    const servicesResponse = rpc.listServices();
    const jobsResponse = rpc.listJobs(filter);
    const [servicesValue, jobsValue] = await Promise.all([
      takeOrThrow(servicesResponse),
      takeOrThrow(jobsResponse),
    ]);

    return {
      available: true,
      services: servicesValue.services,
      jobs: jobsValue.jobs,
      hasMore: jobsValue.hasMore,
      nextCursor: jobsValue.nextCursor,
    };
  } catch (error) {
    const message = normalizedJobsUnavailable(error);
    if (message) {
      return {
        available: false,
        message,
        services: [],
        jobs: [],
        hasMore: false,
      };
    }
    throw error;
  }
}

/** Loads a single job by globally addressable job id. */
export async function loadJobDetailData(
  rpc: JobsDetailRpc,
  id: string,
): Promise<JobsDetailData> {
  try {
    const value = await takeOrThrow(rpc.getJob({ id }));
    return { available: true, job: value.job };
  } catch (error) {
    const message = normalizedJobsUnavailable(error);
    if (message) {
      return unavailableResult({ available: false, message });
    }
    throw error;
  }
}

/** Cancels a cancellable job by id. */
export async function cancelJob(
  rpc: JobsActionRpc<JobsCancelOutput>,
  id: string,
): Promise<JobsCancelOutput> {
  return takeOrThrow(rpc.action({ id }));
}

/** Retries a failed job by id. */
export async function retryJob(
  rpc: JobsActionRpc<JobsRetryOutput>,
  id: string,
): Promise<JobsRetryOutput> {
  return takeOrThrow(rpc.action({ id }));
}

/** Replays a dead-lettered job by id. */
export async function replayDlqJob(
  rpc: JobsActionRpc<JobsReplayDLQOutput>,
  id: string,
): Promise<JobsReplayDLQOutput> {
  return takeOrThrow(rpc.action({ id }));
}

/** Dismisses a dead-lettered job by id. */
export async function dismissDlqJob(
  rpc: JobsActionRpc<JobsDismissDLQOutput>,
  id: string,
): Promise<JobsDismissDLQOutput> {
  return takeOrThrow(rpc.action({ id }));
}
