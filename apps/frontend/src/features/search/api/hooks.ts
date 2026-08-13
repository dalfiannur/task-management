// Global search RPC hook (connect-query over SearchService). Debounces the
// raw query locally so keystrokes don't each fire a request.

import { useEffect, useState } from "react";
import { useQuery } from "@connectrpc/connect-query";
import { SearchService } from "@/lib/gen/search_pb";
import type { SearchHit } from "../types";
import { mapSearchHit } from "./mappers";

/** Shortest query worth sending to the server. Below this, the overlay shows
 *  a prompt instead of firing a request. */
export const MIN_QUERY = 2;

/** Debounce a fast-changing value. Used to hold off searching until the user
 *  pauses typing. */
export function useDebounced<T>(value: T, ms = 200): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

export function useSearch(q: string, assigneeIds: string[] = []) {
  const debouncedQ = useDebounced(q);
  const trimmed = debouncedQ.trim();
  const result = useQuery(
    SearchService.method.search,
    { q: trimmed, assigneeIds },
    { enabled: trimmed.length >= MIN_QUERY, retry: false },
  );
  const hits: SearchHit[] = (result.data?.results ?? []).map(mapSearchHit);
  // isFetching (not isLoading) so a refetch under a changing query still reads
  // as "searching" rather than showing stale results as settled.
  return { ...result, hits, isSearching: result.isFetching };
}
