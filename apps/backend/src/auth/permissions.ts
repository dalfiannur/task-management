// apps/backend/src/auth/permissions.ts
import { Action, type PermissionEntry } from "./types";

export function hasPermission(userPermissions: string[], resource: string, action: string): boolean {
  if (userPermissions.includes("*")) return true;
  if (userPermissions.includes(`${resource}:${action}`)) return true;
  if (userPermissions.includes(`${resource}:manage`)) return true;
  if (userPermissions.includes(`${resource}:${action}_all`)) return true;

  const segments = resource.split(":");
  for (let i = segments.length - 1; i >= 1; i--) {
    const parent = segments.slice(0, i).join(":");
    if (userPermissions.includes(`${parent}:manage`)) return true;
  }
  return false;
}

export const TasksResources = {
  Projects: "tasks:projects",
  Modules: "tasks:modules",
  Tasks: "tasks:tasks",
  SubProjects: "tasks:subprojects",
} as const;

export const CoreResources = {
  Projects: "core:projects",
  Companies: "core:companies",
  Divisions: "core:divisions",
} as const;

export const TASKS_PERMISSIONS: PermissionEntry[] = [
  { resource: TasksResources.Projects, action: Action.Create, description: "Create self projects" },
  { resource: TasksResources.Projects, action: Action.Read, description: "Read self project information" },
  { resource: TasksResources.Projects, action: Action.Update, description: "Update self projects" },
  { resource: TasksResources.Projects, action: Action.Delete, description: "Delete self projects" },
  { resource: TasksResources.Projects, action: Action.ReadAll, description: "Read all project information" },
  { resource: TasksResources.Projects, action: Action.UpdateAll, description: "Update all projects" },
  { resource: TasksResources.Projects, action: Action.DeleteAll, description: "Delete all projects" },
  { resource: TasksResources.Modules, action: Action.Create, description: "Create self modules" },
  { resource: TasksResources.Modules, action: Action.Read, description: "Read self module information" },
  { resource: TasksResources.Modules, action: Action.Update, description: "Update self modules" },
  { resource: TasksResources.Modules, action: Action.Delete, description: "Delete self modules" },
  { resource: TasksResources.Modules, action: Action.Assign, description: "Assign self modules to users" },
  { resource: TasksResources.Modules, action: Action.ReadAll, description: "Read all module information" },
  { resource: TasksResources.Modules, action: Action.UpdateAll, description: "Update all modules" },
  { resource: TasksResources.Tasks, action: Action.Create, description: "Create self tasks" },
  { resource: TasksResources.Tasks, action: Action.Read, description: "Read self task information" },
  { resource: TasksResources.Tasks, action: Action.Update, description: "Update self tasks" },
  { resource: TasksResources.Tasks, action: Action.Delete, description: "Delete self tasks" },
  { resource: TasksResources.Tasks, action: Action.Assign, description: "Assign self tasks to users" },
  { resource: TasksResources.Tasks, action: Action.ReadAll, description: "Read all task information" },
  { resource: TasksResources.Tasks, action: Action.UpdateAll, description: "Update all tasks" },
  { resource: TasksResources.SubProjects, action: Action.Create, description: "Create subprojects" },
  { resource: TasksResources.SubProjects, action: Action.Read, description: "Read subproject information" },
  { resource: TasksResources.SubProjects, action: Action.Update, description: "Update subprojects" },
  { resource: TasksResources.SubProjects, action: Action.Delete, description: "Delete subprojects" },
];
