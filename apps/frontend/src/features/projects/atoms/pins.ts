// Projects pinned to the sidebar (Jotai). A per-browser preference, not
// server state: ids only, in pin order. Names are read through `useProject`,
// so a rename shows up without re-pinning.

import { useCallback } from "react";
import { useAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";

export const pinnedProjectIdsAtom = atomWithStorage<string[]>(
  "sedjiwa.pinned-projects",
  [],
  undefined,
  { getOnInit: true },
);

export function usePinnedProjects() {
  const [ids, setIds] = useAtom(pinnedProjectIdsAtom);

  const isPinned = useCallback((id: string) => ids.includes(id), [ids]);
  const pin = useCallback(
    (id: string) => setIds((cur) => (cur.includes(id) ? cur : [...cur, id])),
    [setIds],
  );
  const unpin = useCallback(
    (id: string) => setIds((cur) => cur.filter((x) => x !== id)),
    [setIds],
  );
  const toggle = useCallback(
    (id: string) =>
      setIds((cur) =>
        cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id],
      ),
    [setIds],
  );

  return { ids, isPinned, pin, unpin, toggle };
}
