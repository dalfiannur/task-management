import type { Entity } from "bunsane/core/Entity";
import {
  PhoneComponent,
  UserProfileComponent,
  UserStatusComponent,
  AdminTag,
} from "~/components/UserComponents";
import type { AuthUser } from "~/auth";

export type UserJSON = {
  id: string;
  phone: string;
  displayName: string;
  email: string;
  avatarUrl: string;
  isAdmin: boolean;
  status: "pending" | "active" | "suspended";
  createdAt: string | null;
  lastLoginAt: string | null;
};

export async function hashPassword(plain: string): Promise<string> {
  return await Bun.password.hash(plain);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return await Bun.password.verify(plain, hash);
}

export async function serializeUser(entity: Entity): Promise<UserJSON> {
  const phone = await entity.get(PhoneComponent);
  const profile = await entity.get(UserProfileComponent);
  const status = await entity.get(UserStatusComponent);
  const isAdmin = await entity.has(AdminTag);
  return {
    id: entity.id,
    phone: phone?.value ?? "",
    displayName: profile?.displayName ?? "",
    email: profile?.email ?? "",
    avatarUrl: profile?.avatarUrl ?? "",
    isAdmin,
    status: (status?.value as UserJSON["status"]) ?? "active",
    createdAt: status?.createdAt ? new Date(status.createdAt).toISOString() : null,
    lastLoginAt: status?.lastLoginAt ? new Date(status.lastLoginAt).toISOString() : null,
  };
}

// Build the AuthUser (for JWT) from a serialized user.
export function toAuthUser(u: UserJSON): AuthUser {
  return {
    id: u.id,
    phone: u.phone,
    displayName: u.displayName,
    email: u.email || undefined,
    avatarUrl: u.avatarUrl || undefined,
    isAdmin: u.isAdmin,
    permissions: u.isAdmin ? ["*"] : [],
  };
}
