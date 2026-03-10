export { requireUser, requirePermission, type AuthContext } from '@qyubit/sedjiwa-permissions';
export { Action, type PermissionEntry } from '@qyubit/sedjiwa-permissions';
import { Action, type PermissionEntry } from '@qyubit/sedjiwa-permissions';
import { requireUser } from '@qyubit/sedjiwa-permissions';
import { GraphQLError } from 'graphql';
import type { AuthContext } from '@qyubit/sedjiwa-permissions';

export function requireAdmin(context: AuthContext) {
  const user = requireUser(context);
  if (!user.permissions?.includes("*")) {
    throw new GraphQLError("Admin access required", {
      extensions: { code: "FORBIDDEN" },
    });
  }
  return user;
}

export const TaskResources = {
  Tasks: "task_management:tasks",
  Projects: "task_management:projects",
} as const;

export const TASK_PERMISSIONS: PermissionEntry[] = [
  { resource: TaskResources.Tasks, action: Action.Create, description: "Create tasks" },
  { resource: TaskResources.Tasks, action: Action.Read, description: "Read task information" },
  { resource: TaskResources.Tasks, action: Action.Update, description: "Update tasks" },
  { resource: TaskResources.Tasks, action: Action.Delete, description: "Delete tasks" },
  { resource: TaskResources.Tasks, action: Action.Manage, description: "Full task management" },
  { resource: TaskResources.Projects, action: Action.Create, description: "Create projects" },
  { resource: TaskResources.Projects, action: Action.Read, description: "Read project information" },
  { resource: TaskResources.Projects, action: Action.Update, description: "Update projects" },
  { resource: TaskResources.Projects, action: Action.Delete, description: "Delete projects" },
  { resource: TaskResources.Projects, action: Action.Manage, description: "Full project management" },
];
