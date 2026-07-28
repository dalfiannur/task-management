// apps/backend/src/lib/auth-context.ts
export {
  hasPermission,
  requireUser as requireAuth,
  TasksResources,
  CoreResources,
  type AuthUser as TaskAuthUser,
  type AuthContext as TaskAuthContext,
} from "~/auth";

import { hasPermission, requireUser, type AuthContext } from "~/auth";

export function checkPermission(context: AuthContext, resource: string, action: string): boolean {
  const user = requireUser(context);
  return hasPermission(user.permissions ?? [], resource, action);
}
