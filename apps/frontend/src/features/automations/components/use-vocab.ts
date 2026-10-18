import { useMemo } from "react";
import { useLabels } from "@/features/labels";
import { useProjectMembers } from "@/features/projects";
import { useModules, useStatuses } from "@/features/tasks";
import { useUserMap } from "@/features/users";
import type { Names } from "../describe";

type Option = { id: string; name: string };

/** A project's statuses, labels, modules and members, as picker options and
 *  as names for describing rules. */
export interface Vocab {
  statuses: Option[];
  labels: Option[];
  modules: Option[];
  members: Option[];
  names: Names;
}

export function useVocab(projectId: string): Vocab {
  const { statuses } = useStatuses(projectId);
  const { labels } = useLabels(projectId);
  const { modules } = useModules(projectId);
  const { memberIds } = useProjectMembers(projectId);
  const userMap = useUserMap();
  return useMemo(() => {
    const s = statuses.map((x) => ({ id: x.id, name: x.name }));
    const l = labels.map((x) => ({ id: x.id, name: x.name }));
    const m = modules.map((x) => ({ id: x.id, name: x.name }));
    const u = memberIds
      .map((id) => ({ id, name: userMap[id]?.displayName ?? "Unknown" }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const lookup = (opts: Option[], what: string) => (id: string) =>
      opts.find((o) => o.id === id)?.name ?? `(deleted ${what})`;
    return {
      statuses: s,
      labels: l,
      modules: m,
      members: u,
      names: {
        status: lookup(s, "status"),
        label: lookup(l, "label"),
        module: lookup(m, "module"),
        user: (id: string) => userMap[id]?.displayName ?? "someone",
      },
    };
  }, [statuses, labels, modules, memberIds, userMap]);
}
