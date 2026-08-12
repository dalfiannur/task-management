import type { Project as PbProject } from "@/lib/gen/projects_pb";
import { ProjectStatus as PbStatus } from "@/lib/gen/projects_pb";
import type { Project, ProjectStatus } from "../types";

export function statusFromProto(s: PbStatus): ProjectStatus {
  switch (s) {
    case PbStatus.ACTIVE:
      return "active";
    case PbStatus.COMPLETED:
      return "completed";
    case PbStatus.ARCHIVED:
      return "archived";
    default:
      return "unspecified";
  }
}

export function statusToProto(s: ProjectStatus): PbStatus {
  switch (s) {
    case "active":
      return PbStatus.ACTIVE;
    case "completed":
      return PbStatus.COMPLETED;
    case "archived":
      return PbStatus.ARCHIVED;
    default:
      return PbStatus.UNSPECIFIED;
  }
}

/** proto `Project` → flat `Project`. */
export function mapProject(p: PbProject): Project {
  return {
    id: p.id,
    name: p.name,
    description: p.description ?? "",
    status: statusFromProto(p.status),
    ownerId: p.ownerId,
    startDate: p.startDate,
    endDate: p.endDate,
  };
}

/** "start → end" for a project's date range, or `null` when neither is set.
 *  Callers own their own empty-state fallback (a dash, "No dates set", …) —
 *  this only formats the range when there is one. */
export function formatProjectDateRange(project: Project): string | null {
  if (!project.startDate && !project.endDate) return null;
  return `${project.startDate ?? "…"} → ${project.endDate ?? "…"}`;
}
