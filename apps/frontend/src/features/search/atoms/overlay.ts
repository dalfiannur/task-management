// Search overlay UI state (Jotai). Feature-local — only promoted to `lib` if
// something outside this feature ever needs it.

import { atom } from "jotai";

/** Whether the Cmd+K overlay is open. */
export const searchOpenAtom = atom(false);

/**
 * The person a user picked from search results, refining subsequent search
 * to tasks assigned to them. There is no `/users/$id` route (building one is
 * out of scope for this feature), so selecting a person can't navigate
 * anywhere — instead it becomes a filter chip inside the overlay itself.
 */
export const searchPersonAtom = atom<{ id: string; name: string } | null>(
  null,
);
