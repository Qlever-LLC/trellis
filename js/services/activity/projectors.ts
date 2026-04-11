import { isErr, Result, ValidationError } from "@qlever-llc/trellis";
import type { BaseError } from "@qlever-llc/result";
import type { TrellisService } from "@qlever-llc/trellis/server";
import { Value } from "typebox/value";
import { ulid } from "ulid";
import {
  AuthConnectEventSchema,
} from "../../packages/trellis/models/auth/events/AuthConnect.ts";
import {
  AuthConnectionKickedEventSchema,
} from "../../packages/trellis/models/auth/events/AuthConnectionKicked.ts";
import {
  AuthDisconnectEventSchema,
} from "../../packages/trellis/models/auth/events/AuthDisconnect.ts";
import {
  AuthSessionRevokedEventSchema,
} from "../../packages/trellis/models/auth/events/AuthSessionRevoked.ts";

import type { ActivityOwnedApi, ActivityTrellisApi } from "./contracts/trellis_activity.ts";
import {
  ActivityGetRequestSchema,
  ActivityListRequestSchema,
  type ActivityEntry,
} from "./schemas.ts";
import {
  type ActivityStore,
  getActivityEntry,
  listActivityEntries,
  putActivityEntry,
} from "./store.ts";

function label(origin: string, id: string): string {
  return `${origin}.${id}`;
}

function normalizeActor(actor: string | undefined): string | undefined {
  return actor && actor.length > 0 ? actor : undefined;
}

function buildEntry(
  kind: ActivityEntry["kind"],
  payload: {
    header?: { id?: string; time?: Date | string };
    origin: string;
    id: string;
    sessionKey?: string;
    userNkey?: string;
    actor?: string;
    summary: string;
    metadata?: Record<string, unknown>;
  },
): ActivityEntry {
  return {
    id: payload.header?.id ?? ulid(),
    kind,
    occurredAt: typeof payload.header?.time === "string"
      ? payload.header.time
      : payload.header?.time?.toISOString() ?? new Date().toISOString(),
    principalOrigin: payload.origin,
    principalId: payload.id,
    principalLabel: label(payload.origin, payload.id),
    sessionKey: payload.sessionKey,
    userNkey: payload.userNkey,
    actor: normalizeActor(payload.actor),
    summary: payload.summary,
    metadata: payload.metadata,
  };
}

async function recordEntry(
  service: TrellisService<ActivityOwnedApi, ActivityTrellisApi>,
  activityKV: ActivityStore,
  entry: ActivityEntry,
): Promise<Result<void, BaseError>> {
  const stored = await putActivityEntry(activityKV, entry);
  const value = stored.take();
  if (isErr(value)) {
    console.error("[activity] failed to store activity entry", {
      error: value.error,
      entryId: entry.id,
    });
    return Result.err(value.error);
  }

  const published = await service.trellis.publish("Activity.Recorded", entry);
  const publishedValue = published.take();
  if (isErr(publishedValue)) {
    console.warn("[activity] failed to publish Activity.Recorded", {
      error: publishedValue.error,
      entryId: entry.id,
    });
  }

  return Result.ok(undefined);
}

export async function registerActivityProjection(
  service: TrellisService<ActivityOwnedApi, ActivityTrellisApi>,
  activityKV: ActivityStore,
) {
  const connectMounted = await service.trellis.event(
    "Auth.Connect",
    {},
    async (event) => {
      const parsedEvent = Value.Parse(AuthConnectEventSchema, event);
      return await recordEntry(
        service,
        activityKV,
        buildEntry("auth.connect", {
          ...parsedEvent,
          summary: `${label(parsedEvent.origin, parsedEvent.id)} connected to Trellis`,
        }),
      );
    },
  );
  const connectValue = connectMounted.take();
  if (isErr(connectValue)) throw connectValue.error;

  const disconnectMounted = await service.trellis.event(
    "Auth.Disconnect",
    {},
    async (event) => {
      const parsedEvent = Value.Parse(AuthDisconnectEventSchema, event);
      return await recordEntry(
        service,
        activityKV,
        buildEntry("auth.disconnect", {
          ...parsedEvent,
          summary: `${label(parsedEvent.origin, parsedEvent.id)} disconnected from Trellis`,
        }),
      );
    },
  );
  const disconnectValue = disconnectMounted.take();
  if (isErr(disconnectValue)) throw disconnectValue.error;

  const revokedMounted = await service.trellis.event(
    "Auth.SessionRevoked",
    {},
    async (event) => {
      const parsedEvent = Value.Parse(AuthSessionRevokedEventSchema, event);
      return await recordEntry(
        service,
        activityKV,
        buildEntry("auth.session_revoked", {
          ...parsedEvent,
          actor: parsedEvent.revokedBy,
          summary: `${label(parsedEvent.origin, parsedEvent.id)} session was revoked`,
          metadata: { revokedBy: parsedEvent.revokedBy },
        }),
      );
    },
  );
  const revokedValue = revokedMounted.take();
  if (isErr(revokedValue)) throw revokedValue.error;

  const kickedMounted = await service.trellis.event(
    "Auth.ConnectionKicked",
    {},
    async (event) => {
      const parsedEvent = Value.Parse(AuthConnectionKickedEventSchema, event);
      return await recordEntry(
        service,
        activityKV,
        buildEntry("auth.connection_kicked", {
          ...parsedEvent,
          actor: parsedEvent.kickedBy,
          summary: `${label(parsedEvent.origin, parsedEvent.id)} connection was kicked`,
          metadata: { kickedBy: parsedEvent.kickedBy },
        }),
      );
    },
  );
  const kickedValue = kickedMounted.take();
  if (isErr(kickedValue)) throw kickedValue.error;
}

export async function registerActivityRpcHandlers(
  service: TrellisService<ActivityOwnedApi, ActivityTrellisApi>,
  activityKV: ActivityStore,
) {
  await service.trellis.mount("Activity.List", async (req) => {
    const parsedReq = Value.Parse(ActivityListRequestSchema, req);
    const entries = await listActivityEntries(activityKV, {
      limit: parsedReq.limit,
      kind: parsedReq.kind,
    });
    const value = entries.take();
    if (isErr(value)) {
      return Result.err(value.error);
    }
    return Result.ok({ entries: value });
  });

  await service.trellis.mount("Activity.Get", async (req) => {
    const parsedReq = Value.Parse(ActivityGetRequestSchema, req);
    const entry = await getActivityEntry(activityKV, parsedReq.id);
    const value = entry.take();
    if (isErr(value)) {
      return Result.err(
        new ValidationError({
          errors: [{ path: "/id", message: "activity entry not found" }],
          cause: value.error,
        }),
      );
    }
    return Result.ok({ entry: value });
  });
}
