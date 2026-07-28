import { z } from 'zod';

// Shared listing primitives (sort + paging) for every admin list endpoint.
//
// Before this, each list was "fetch up to the 100-row cap, then filter and
// search in the browser over whatever came back" — which silently truncated
// past 100 rows and made filters lie about the rest. Sorting simply didn't
// exist. Putting sort/order in the query (and returning a real `total`) moves
// both to the database, where they can see every row.

export const SortOrder = z.enum(['asc', 'desc']);
export type SortOrder = z.infer<typeof SortOrder>;

/** Build a `sort`/`order` pair constrained to the columns a list may sort by. */
export function sortFields<const T extends readonly [string, ...string[]]>(fields: T, fallback: T[number]) {
  return {
    sort: z.enum(fields).default(fallback as never),
    order: SortOrder.default('desc'),
  };
}

/** Prisma `orderBy` from a validated sort/order pair. */
export function orderByOf<T extends string>(sort: T, order: SortOrder): Record<T, SortOrder> {
  return { [sort]: order } as Record<T, SortOrder>;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
  /** Rows matching the filters, ignoring paging — lets the UI show real counts. */
  total: number;
}
