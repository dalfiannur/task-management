// Core Portal status values
export type CoreProjectStatus = "draft" | "active" | "completed" | "archived";
export type CoreWinStage = "inactive" | "pending" | "proposal" | "won" | "lost";

// Primary type — all project data comes from Core Portal
export interface CoreProject {
  id: string;
  code: string;
  name: { name: string; description?: string };
  status: CoreProjectStatus;
  winStage: CoreWinStage;
  commercial: boolean;
  value?: number;
  ref: {
    clientId?: string;
    companyId?: string;
    divisionId?: string;
    parentId?: string;
    authorId?: string;
    leaderId?: string;
    eventId?: string;
  };
  clientDetail?: { name: { name: string; legalName: string } };
  projectLeaderDetail?: { displayName: string };
  dates?: { startDate?: string; endDate?: string };
}

// Local cross-ref data from task-management backend (for module linking, sub-project hierarchy)
export interface LocalProjectRef {
  id: string;
  coreRef: { value: string };
  parentRef?: { parentProjectId: string };
  moduleRef?: { moduleId: string };
  projectLeaderId?: { value: string };
  linkedModule?: { id: string; name: string } | null;
}

export interface CreateProjectInput {
  name: string;
  clientId: string;
  description?: string;
  projectLeaderId?: string;
  ownerId?: string;
  divisionId?: string;
  value?: number;
  startDate?: string;
  endDate?: string;
}

export interface UpdateProjectInput {
  title?: string;
  description?: string;
  projectLeaderId?: string | null;
  status?: CoreProjectStatus;
}

export interface CreateSubProjectInput {
  parentProjectId: string;
  name: string;
  description?: string;
  projectLeaderId?: string;
  ownerId?: string;
  divisionId?: string;
  value?: number;
  startDate?: string;
  endDate?: string;
  moduleId?: string;
}

// Display status for UI badges/dots — derived from status + winStage
export type ProjectDisplayStatus = "draft" | "pending" | "proposal" | "won" | "active" | "completed" | "archived" | "lost";

export function getDisplayStatus(project: CoreProject): ProjectDisplayStatus {
  if (project.status === "completed") return "completed";
  if (project.status === "archived") return "archived";
  if (project.status === "draft") return "draft";
  // status === "active" — differentiate by winStage
  if (project.winStage === "pending") return "pending";
  if (project.winStage === "proposal") return "proposal";
  if (project.winStage === "lost") return "lost";
  if (project.winStage === "won" && !project.ref?.leaderId) return "won";
  return "active"; // winStage: won (with leader) or inactive
}

export const PROJECT_STATUS_CONFIG: Record<
  ProjectDisplayStatus,
  { label: string; color: string }
> = {
  draft: { label: "Draft", color: "bg-slate-100 text-slate-700" },
  pending: { label: "Pending", color: "bg-gray-100 text-gray-700" },
  proposal: { label: "Proposal", color: "bg-amber-100 text-amber-700" },
  won: { label: "Won", color: "bg-emerald-100 text-emerald-700" },
  active: { label: "Active", color: "bg-blue-100 text-blue-700" },
  completed: { label: "Closed", color: "bg-purple-100 text-purple-700" },
  archived: { label: "Archived", color: "bg-red-100 text-red-700" },
  lost: { label: "Lost", color: "bg-red-100 text-red-700" },
};
