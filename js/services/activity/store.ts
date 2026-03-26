import { isErr, Result } from "@qlever-llc/trellis-result";
import type { TrellisService } from "@qlever-llc/trellis-server";
import type { TypedKV } from "@qlever-llc/trellis-trellis";
import type { ActivityOwnedApi, ActivityTrellisApi } from "./contracts/trellis_activity.ts";
import type { ActivityEntry } from "./schemas.ts";
import { ActivityEntrySchema } from "./schemas.ts";

export type ActivityStore = TypedKV<typeof ActivityEntrySchema>;

export async function openActivityStore(service: TrellisService<ActivityOwnedApi, ActivityTrellisApi>): Promise<ActivityStore> {
  const handle = service.kv.activity;
  if (!handle) {
    throw new Error("Missing `activity` KV binding.");
  }
  const result = await handle.open(ActivityEntrySchema);
  const value = result.take();
  if (isErr(value)) {
    throw value.error;
  }
  return value;
}

export async function putActivityEntry(activityKV: ActivityStore, entry: ActivityEntry) {
  const existing = (await activityKV.get(entry.id)).take();
  if (!isErr(existing)) {
    return Result.ok(existing.value);
  }

  const created = (await activityKV.create(entry.id, entry)).take();
  if (isErr(created)) {
    const current = (await activityKV.get(entry.id)).take();
    if (!isErr(current)) {
      return Result.ok(current.value);
    }

    return Result.err(created.error);
  }

  return Result.ok(entry);
}

export async function listActivityEntries(
  activityKV: ActivityStore,
  opts?: { limit?: number; kind?: ActivityEntry["kind"] },
) {
  const keys = (await activityKV.keys(">")).take();
  if (isErr(keys)) {
    return Result.err(keys.error);
  }

  const entries: ActivityEntry[] = [];
  for await (const key of keys) {
    const entry = (await activityKV.get(key)).take();
    if (isErr(entry)) continue;
    if (opts?.kind && entry.value.kind !== opts.kind) continue;
    entries.push(entry.value);
  }

  entries.sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
  return Result.ok(entries.slice(0, opts?.limit ?? 50));
}

export async function getActivityEntry(activityKV: ActivityStore, id: string) {
  const entry = (await activityKV.get(id)).take();
  if (isErr(entry)) {
    return Result.err(entry.error);
  }
  return Result.ok(entry.value);
}
