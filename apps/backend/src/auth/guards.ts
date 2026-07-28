// apps/backend/src/auth/guards.ts
import { GraphQLError } from "graphql";
import type { AuthContext, AuthUser } from "./types";
import { hasPermission } from "./permissions";

export function requireUser(context: AuthContext): AuthUser {
  if (!context.user) {
    throw new GraphQLError("Authentication required", { extensions: { code: "UNAUTHENTICATED" } });
  }
  return context.user;
}

export function requirePermission(context: AuthContext, resource: string, action: string): AuthUser {
  const user = requireUser(context);
  if (!hasPermission(user.permissions ?? [], resource, action)) {
    throw new GraphQLError(`Missing permission: ${resource}:${action}`, { extensions: { code: "FORBIDDEN" } });
  }
  return user;
}

export function requireAdmin(context: AuthContext): AuthUser {
  const user = requireUser(context);
  if (!user.isAdmin && !(user.permissions ?? []).includes("*")) {
    throw new GraphQLError("Admin access required", { extensions: { code: "FORBIDDEN" } });
  }
  return user;
}
