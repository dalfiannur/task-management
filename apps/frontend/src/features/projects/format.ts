// Display helpers for projects, shared by the card and the list row.

import { format, parseISO } from "date-fns";
import type { Project, ProjectTasks } from "./types";

/** Share of counted tasks that are done, 0–100; 0 for an empty project. */
export const donePct = (t: ProjectTasks) =>
  t.total > 0 ? Math.round((t.done / t.total) * 100) : 0;

const day = (iso: string) => format(parseISO(iso), "d MMM yyyy");

/** "3 Mar 2026 → 20 Jun 2026", or `null` when the project has no dates. */
export function dateRangeLabel(project: Project): string | null {
  const { startDate, endDate } = project;
  if (!startDate && !endDate) return null;
  return `${startDate ? day(startDate) : "…"} → ${endDate ? day(endDate) : "…"}`;
}
