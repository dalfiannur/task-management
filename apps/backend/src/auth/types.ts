// apps/backend/src/auth/types.ts

export const Action = {
  Create: "create",
  Read: "read",
  Update: "update",
  Delete: "delete",
  Assign: "assign",
  CreateAll: "create_all",
  ReadAll: "read_all",
  UpdateAll: "update_all",
  DeleteAll: "delete_all",
  AssignAll: "assign_all",
} as const;

export type ActionName = (typeof Action)[keyof typeof Action] | (string & Record<never, never>);
export type Action = ActionName;

export interface PermissionEntry {
  resource: string;
  action: ActionName;
  description: string;
}

export interface PermissionManifest {
  app: string;
  version: string;
  permissions: PermissionEntry[];
}

export interface AuthUser {
  id: string;
  phone: string;
  displayName: string;
  email?: string;
  avatarUrl?: string;
  isAdmin: boolean;
  permissions: string[];
}

export interface AuthContext {
  user: AuthUser | null;
  request: Request;
}
