/** Maximum rows a production repository list page may return. */
export const MAX_STORAGE_LIST_LIMIT = 500;

/** Explicit bounded query for production repository collection listing. */
export type BoundedListQuery = {
  offset?: number;
  limit: number;
};

/** Counted bounded list page. */
export type ListPage<T> = {
  entries: T[];
  count: number;
  offset: number;
  limit: number;
  nextOffset?: number;
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

/** Builds a standard counted page response from validated query metadata. */
export function listPage<T>(
  entries: T[],
  count: number,
  query: BoundedListQuery,
): ListPage<T> {
  const { offset, limit } = boundedListQuery(query);
  return {
    entries,
    count,
    offset,
    limit,
    nextOffset: limit <= 0 || offset + limit >= count ? undefined : offset + limit,
  };
}
