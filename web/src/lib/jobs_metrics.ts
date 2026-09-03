import { AsyncResult, BaseError, isErr } from "@qlever-llc/result";
import type {
  JobsMetricsInput,
  JobsMetricsOutput,
} from "@trellis/apis/trellis.jobs";

export type JobsMetrics = JobsMetricsOutput;

export type JobsMetricsPayload = {
  available: boolean;
  message?: string;
  metrics?: JobsMetricsOutput;
};

type JobsMetricsRpc = {
  metrics(
    input: JobsMetricsInput,
  ): AsyncResult<JobsMetricsOutput, BaseError>;
};

async function takeOrThrow<T>(result: AsyncResult<T, BaseError>): Promise<T> {
  const value = await result.take();
  if (isErr(value)) {
    throw value.error;
  }
  return value;
}

function normalizedMetricsUnavailable(error: unknown): string | null {
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
    return "Your current session is not approved for Jobs.Metrics. Sign out and sign back in to refresh permissions.";
  }

  const normalized = message.toLowerCase();
  if (
    normalized.includes("no responders") ||
    message.includes("No responders available for request") ||
    message.includes("references inactive contract") ||
    message.includes("not currently reachable")
  ) {
    return "Jobs metrics are not currently reachable.";
  }

  return null;
}

/** Loads jobs operational metrics through the typed Jobs.Metrics RPC boundary. */
export async function loadJobsMetrics(
  rpc: Pick<JobsMetricsRpc, "metrics">,
  input: JobsMetricsInput,
): Promise<JobsMetricsPayload> {
  try {
    const value = await takeOrThrow(rpc.metrics(input));
    return { available: true, metrics: value };
  } catch (error) {
    const message = normalizedMetricsUnavailable(error);
    if (message) {
      return { available: false, message };
    }
    throw error;
  }
}
