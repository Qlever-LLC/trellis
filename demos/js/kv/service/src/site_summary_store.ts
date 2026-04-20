import { isErr, type TypedKV } from "@qlever-llc/trellis";
import type { TrellisService } from "@qlever-llc/trellis/host";
import type { SiteSummary } from "../../../shared/field_data.ts";
import contract, {
  SiteSummarySchema,
} from "../contracts/demo_inspection_kv_service.ts";

export type SiteSummaryStore = TypedKV<typeof SiteSummarySchema>;

export async function openSiteSummaryStore(
  service: TrellisService<
    typeof contract.API.owned,
    typeof contract.API.trellis
  >,
): Promise<SiteSummaryStore> {
  const handle = service.kv.siteSummaries;
  if (!handle) {
    throw new Error("Missing `siteSummaries` KV binding.");
  }

  const result = await handle.open(SiteSummarySchema).take();
  if (isErr(result)) {
    throw result.error;
  }

  return result;
}

export async function seedSiteSummaries(
  store: SiteSummaryStore,
  summaries: readonly SiteSummary[],
): Promise<void> {
  for (const summary of summaries) {
    const existing = await store.get(summary.siteId).take();
    if (!isErr(existing)) {
      continue;
    }

    const created = await store.create(summary.siteId, summary).take();
    if (!isErr(created)) {
      continue;
    }

    const current = await store.get(summary.siteId).take();
    if (isErr(current)) {
      throw created.error;
    }
  }
}

export async function listSiteSummaries(
  store: SiteSummaryStore,
): Promise<SiteSummary[]> {
  const keys = await store.keys(">").take();
  if (isErr(keys)) {
    throw keys.error;
  }

  const summaries: SiteSummary[] = [];
  for await (const key of keys) {
    const entry = await store.get(key).take();
    if (isErr(entry)) {
      continue;
    }

    summaries.push(entry.value);
  }

  summaries.sort((left, right) => left.siteName.localeCompare(right.siteName));
  return summaries;
}

export async function getSiteSummary(
  store: SiteSummaryStore,
  siteId: string,
): Promise<SiteSummary | undefined> {
  const entry = await store.get(siteId).take();
  if (isErr(entry)) {
    return undefined;
  }

  return entry.value;
}
