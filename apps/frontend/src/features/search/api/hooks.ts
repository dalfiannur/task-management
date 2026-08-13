// Global search RPC hook (connect-query over SearchService). Debounces the
// raw query locally so keystrokes don't each fire a request.

import { useEffect, useMemo, useState } from "react";
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
  const belowMin = trimmed.length < MIN_QUERY;
  const result = useQuery(
    SearchService.method.search,
    { q: trimmed, assigneeIds },
    { enabled: !belowMin, retry: false },
  );
  // Memoized on `result.data` (not recomputed every render) so consumers can
  // key their own effects off `hits`' identity to detect an actual new
  // result set landing, as opposed to an unrelated re-render (e.g. moving
  // the palette's own selection) producing a `.map()`-fresh array every time.
  const hits: SearchHit[] = useMemo(
    () => (result.data?.results ?? []).map(mapSearchHit),
    [result.data],
  );
  // isFetching (not isLoading) so a refetch under a changing query still reads
  // as "searching" rather than showing stale results as settled.
  //
  // belowMin is derived from the DEBOUNCED query, same as `enabled` above —
  // not the caller's raw `q`. A caller gating its own "type more" message on
  // raw `q` would flip that message off the instant the threshold is
  // crossed, while `enabled` (and so `isSearching`) stays false until the
  // debounce settles a beat later — a window where nothing is loading and
  // nothing has results, easy to misread as "no results" for a query that
  // was never actually sent.
  return { ...result, hits, isSearching: result.isFetching, belowMin };
}
