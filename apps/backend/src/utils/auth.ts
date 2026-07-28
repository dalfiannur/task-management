// apps/backend/src/utils/auth.ts
export {
  requireUser,
  requirePermission,
  requireAdmin,
  hasPermission,
  Action,
  TasksResources,
  CoreResources,
  TASKS_PERMISSIONS,
  type AuthContext,
  type AuthUser,
  type PermissionEntry,
} from "~/auth";

import { type AuthUser } from "~/auth";
import { Query } from "bunsane/query";
import { ProjectMembershipData } from "~/components/ProjectMembership";

export function isAdmin(user: { isAdmin?: boolean; permissions?: string[] }): boolean {
  return user.isAdmin === true || (user.permissions?.includes("*") ?? false);
}

/** Check if user is a member of the given project. Admins bypass. */
export async function checkProjectMember(
  user: AuthUser,
  projectId: string,
): Promise<boolean> {
  if (isAdmin(user)) return true;
  const memberships = await new Query()
    .with(ProjectMembershipData, {
      filters: [
        Query.typedFilter(ProjectMembershipData, "projectId", "=", projectId),
        Query.typedFilter(ProjectMembershipData, "userId", "=", user.id),
      ],
    })
    .take(1)
    .exec();
  return memberships.length > 0;
}
