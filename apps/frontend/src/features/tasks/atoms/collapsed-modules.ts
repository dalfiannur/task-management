// Which module cards are collapsed, per project (Jotai + localStorage).
//
// Stores the *collapsed* ids rather than the expanded ones, so a module that
// didn't exist when the value was written defaults to open. A module created
// tomorrow shows up visible instead of being born hidden.

import { useCallback } from "react";
import { useAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";

const STORAGE_KEY = "sedjiwa.modules.collapsed";

/** projectId → ids of the modules collapsed in that project. */
export const collapsedModulesAtom = atomWithStorage<Record<string, string[]>>(
  STORAGE_KEY,
  {},
  undefined,
  // Read localStorage synchronously at init, the same reason `sessionAtom`
  // does: without it every module renders open on a fresh page load and then
  // snaps shut once an effect hydrates — a visible flash on exactly the
  // modules the user chose to hide.
  { getOnInit: true },
);

/** `[collapsed, setCollapsed]` for one module card. */
export function useModuleCollapsed(
  projectId: string,
  moduleId: string,
): readonly [boolean, (next: boolean) => void] {
  const [byProject, setByProject] = useAtom(collapsedModulesAtom);
  const collapsed = (byProject[projectId] ?? []).includes(moduleId);

  const setCollapsed = useCallback(
    (next: boolean) =>
      setByProject((prev) => {
        const current = prev[projectId] ?? [];
        if (next === current.includes(moduleId)) return prev;
        return {
          ...prev,
          [projectId]: next
            ? [...current, moduleId]
            : current.filter((id) => id !== moduleId),
        };
      }),
    [projectId, moduleId, setByProject],
  );

  return [collapsed, setCollapsed] as const;
}
