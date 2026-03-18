export { requireUser, requirePermission, type AuthContext } from '@qyubit/sedjiwa-permissions';
export { Action, type PermissionEntry, TasksResources, TASKS_PERMISSIONS, CoreResources } from '@qyubit/sedjiwa-permissions';
import { Action, type PermissionEntry, TasksResources, TASKS_PERMISSIONS, CoreResources } from '@qyubit/sedjiwa-permissions';
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
