import type { TrellisFor } from "@qlever-llc/trellis";
import type contract from "../../../contract.ts";

type ActivityInput = {
  kind: string;
  message: string;
  relatedSiteId?: string;
  relatedInspectionId?: string;
};

/** Publishes a compact activity event for demo workflows. */
export async function recordActivity(
  client: TrellisFor<typeof contract>,
  activity: ActivityInput,
): Promise<void> {
  const occurredAt = new Date().toISOString();
  await client.event.audit.recorded.publish({
    activityId: `activity-${crypto.randomUUID()}`,
    occurredAt,
    ...activity,
  }).orThrow();
}
