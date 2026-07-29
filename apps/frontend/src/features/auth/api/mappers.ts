import type { User as PbUser } from "@/lib/gen/users_pb";
import { UserStatus as PbUserStatus } from "@/lib/gen/users_pb";
import type { AppUser, UserStatus } from "../types";

function mapStatus(s: PbUserStatus): UserStatus {
  switch (s) {
    case PbUserStatus.PENDING:
      return "pending";
    case PbUserStatus.ACTIVE:
      return "active";
    case PbUserStatus.SUSPENDED:
      return "suspended";
    default:
      return "unknown";
  }
}

/** proto `User` → flat `AppUser`. */
export function mapUser(u: PbUser): AppUser {
  return {
    id: u.id,
    phone: u.phone,
    displayName: u.displayName,
    email: u.email,
    avatarUrl: u.avatarUrl,
    status: mapStatus(u.status),
    isAdmin: u.isAdmin,
    createdAt: u.createdAt,
    lastLoginAt: u.lastLoginAt,
  };
}
