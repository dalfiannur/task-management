export { requireUser, requirePermission, type AuthContext } from '@qyubit/sedjiwa-permissions';
export { Action, type PermissionEntry } from '@qyubit/sedjiwa-permissions';
import { Action, type PermissionEntry } from '@qyubit/sedjiwa-permissions';
import { requireUser } from '@qyubit/sedjiwa-permissions';
import { GraphQLError } from 'graphql';
import { Query } from 'bunsane/query';
import { ProjectMembershipData } from '~/components/ProjectMembership';
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

export function isAdmin(user: { permissions?: string[] }): boolean {
  return user.permissions?.includes("*") ?? false;
}

/** Check if user is a member of the given project. Admins bypass. */
export async function checkProjectMember(
  user: { sub: string; permissions?: string[] },
  projectId: string,
): Promise<boolean> {
  if (isAdmin(user)) return true;

  const memberships = await new Query()
    .with(ProjectMembershipData, {
      filters: [
        Query.typedFilter(ProjectMembershipData, "projectId", "=", projectId),
        Query.typedFilter(ProjectMembershipData, "userId", "=", user.sub),
      ],
    })
    .exec();

  return memberships.length > 0;
}

export const TASK_PERMISSIONS: PermissionEntry[] = [
  { resource: TaskResources.Tasks, action: Action.Create, description: "Create tasks" },
  { resource: TaskResources.Tasks, action: Action.Read, description: "Read task information" },
  { resource: TaskResources.Tasks, action: Action.Update, description: "Update tasks" },
  { resource: TaskResources.Tasks, action: Action.Delete, description: "Delete tasks" },
  { resource: TaskResources.Tasks, action: Action.CreateAll, description: "Create all tasks" },
  { resource: TaskResources.Tasks, action: Action.ReadAll, description: "Read all tasks" },
  { resource: TaskResources.Tasks, action: Action.UpdateAll, description: "Update all tasks" },
  { resource: TaskResources.Tasks, action: Action.DeleteAll, description: "Delete all tasks" },
  { resource: TaskResources.Projects, action: Action.Create, description: "Create projects" },
  { resource: TaskResources.Projects, action: Action.Read, description: "Read project information" },
  { resource: TaskResources.Projects, action: Action.Update, description: "Update projects" },
  { resource: TaskResources.Projects, action: Action.Delete, description: "Delete projects" },
  { resource: TaskResources.Projects, action: Action.CreateAll, description: "Create all projects" },
  { resource: TaskResources.Projects, action: Action.ReadAll, description: "Read all projects" },
  { resource: TaskResources.Projects, action: Action.UpdateAll, description: "Update all projects" },
  { resource: TaskResources.Projects, action: Action.DeleteAll, description: "Delete all projects" },
];
