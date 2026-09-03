/** Per-target bulk-action execution shared by table pages. Selection state
 * itself stays on each page as a `Set<string>` in `$state`. */

export function toggleId(selected: Set<string>, id: string): void {
  if (selected.has(id)) selected.delete(id);
  else selected.add(id);
}

export function toggleAll(selected: Set<string>, ids: string[]): void {
  const allSelected = ids.length > 0 && ids.every((id) => selected.has(id));
  if (allSelected) {
    for (const id of ids) selected.delete(id);
  } else {
    for (const id of ids) selected.add(id);
  }
}

export type BulkOutcome<T> = {
  succeeded: number;
  failed: { target: T; reason: string }[];
};

/** Runs `action` for every target without stopping; the action must throw on
 * failure. Returns per-target outcomes so partial failures stay visible. */
export async function runBulk<T>(
  targets: T[],
  action: (target: T) => Promise<void>,
): Promise<BulkOutcome<T>> {
  const results = await Promise.allSettled(
    targets.map((target) => action(target)),
  );
  const failed: { target: T; reason: string }[] = [];
  let succeeded = 0;
  results.forEach((result, index) => {
    if (result.status === "fulfilled") succeeded += 1;
    else failed.push({ target: targets[index], reason: String(result.reason) });
  });
  return { succeeded, failed };
}

/** Builds the count-gated `expectedValue` for a bulk confirmation: batches
 * above the threshold require typing the exact count. */
export function bulkExpectedCount(
  count: number,
  threshold = 5,
): string | undefined {
  return count > threshold ? String(count) : undefined;
}

/** Lists the first few targets plus a remainder line for the modal details. */
export function bulkTargetDetails(names: string[], shown = 5): string {
  if (names.length <= shown) return names.join("\n");
  return `${names.slice(0, shown).join("\n")}\nand ${
    names.length - shown
  } more`;
}
