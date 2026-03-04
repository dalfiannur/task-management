import { hasPermission } from "@qyubit/sedjiwa-permissions";

export type TaskAuthUser = {
  id: string;
  sub: string;
  email: string;
  name: string;
  picture?: string;
  role?: string;
  permissions: string[];
};

export type TaskAuthContext = {
  user: TaskAuthUser | null;
  request: Request;
};

export function requireAuth(context: { user?: TaskAuthUser | null }): TaskAuthUser {
  if (!context.user) throw new Error("Authentication required");
  const user = context.user;
  const id = user.id?.trim() || user.sub?.trim();
  if (!id) throw new Error("Authentication required");
  const name = user.name?.trim() || user.email?.trim() || user.sub?.trim() || id || "Unknown";
  return { ...user, id, name };
}

export function checkPermission(
  context: { user?: TaskAuthUser | null },
  resource: string,
  action: string,
): boolean {
  const user = requireAuth(context);
  return hasPermission(user.permissions, resource, action);
}

export const Resources = {
  Tasks: "task_management:tasks",
  Projects: "task_management:projects",
  Modules: "task_management:modules",
  Labels: "task_management:labels",
  Media: "task_management:media",
  Comments: "task_management:comments",
  Notifications: "task_management:notifications",
  Activities: "task_management:activities",
  Pages: "task_management:pages",
  Memberships: "task_management:memberships",
} as const;
