/** Maximum rows a production repository list page may return. */
export const MAX_STORAGE_LIST_LIMIT = 500;

/** Explicit bounded query for production repository collection listing. */
export type BoundedListQuery = {
  offset?: number;
  limit: number;
};

/** Validates and normalizes a bounded list query. */
export function boundedListQuery(
  query: BoundedListQuery,
): Required<BoundedListQuery> {
  if (!Number.isInteger(query.limit) || query.limit < 0) {
    throw new RangeError("list limit must be a non-negative integer");
  }
  if (query.limit > MAX_STORAGE_LIST_LIMIT) {
    throw new RangeError(`list limit must be <= ${MAX_STORAGE_LIST_LIMIT}`);
  }
  const offset = query.offset ?? 0;
  if (!Number.isInteger(offset) || offset < 0) {
    throw new RangeError("list offset must be a non-negative integer");
  }
  return { offset, limit: query.limit };
}
