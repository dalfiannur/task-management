// Projects feature barrel.

export type { Project, ProjectStatus } from "./types";
export { PROJECT_STATUSES, STATUS_LABEL } from "./types";
export {
  mapProject,
  statusFromProto,
  statusToProto,
  formatProjectDateRange,
} from "./api/mappers";
export {
  useProjects,
  useProject,
  useProjectMembers,
  useCreateProject,
  useSetProjectStatus,
  useTransferOwnership,
  useDeleteProject,
} from "./api/hooks";
export { ProjectList } from "./components/project-list";
export { ProjectShell } from "./components/project-shell";
export { ProjectStatusBadge } from "./components/project-status-badge";
export { CreateProjectDialog } from "./components/create-project-dialog";
export { TabPlaceholder } from "./components/tab-placeholder";
