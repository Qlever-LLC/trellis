import Type from "typebox";
import { ActivityRecordedEvent } from "./activity.ts";
import { EvidenceUploadedEvent } from "./evidence.ts";
import { ReportsPublishedEvent } from "./reports.ts";
import { SitesRefreshedEvent } from "./sites.ts";

export const ActivityLiveFeedRequest = Type.Object({});

export const ActivityLiveFeedEvent = Type.Union([
  Type.Object({
    name: Type.Literal("Activity.Recorded"),
    event: ActivityRecordedEvent,
  }),
  Type.Object({
    name: Type.Literal("Reports.Published"),
    event: ReportsPublishedEvent,
  }),
  Type.Object({
    name: Type.Literal("Evidence.Uploaded"),
    event: EvidenceUploadedEvent,
  }),
  Type.Object({
    name: Type.Literal("Sites.Refreshed"),
    event: SitesRefreshedEvent,
  }),
]);
