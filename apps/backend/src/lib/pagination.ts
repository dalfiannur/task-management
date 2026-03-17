import type { Entity } from "bunsane/core/Entity";

export interface PageInfo {
  page: number;
  pageSize: number;
  hasNextPage: boolean;
}

export interface PaginatedResult<T> {
  items: T[];
  pageInfo: PageInfo;
}

/**
 * Apply N+1 heuristic: the query should have fetched `pageSize + 1` items.
 * If we got more than pageSize, there's a next page.
 */
export function paginateResults<T>(
  items: T[],
  page: number,
  pageSize: number,
): PaginatedResult<T> {
  const hasNextPage = items.length > pageSize;
  return {
    items: hasNextPage ? items.slice(0, pageSize) : items,
    pageInfo: { page, pageSize, hasNextPage },
  };
}

/**
 * Parse page/pageSize from input with defaults, returning the take value (pageSize + 1 for N+1 heuristic).
 */
export function parsePagination(input: { page?: number; pageSize?: number }, defaultPageSize: number) {
  const page = input.page ?? 1;
  const pageSize = input.pageSize ?? defaultPageSize;
  return {
    page,
    pageSize,
    take: pageSize + 1,
    offset: (page - 1) * pageSize,
  };
}
