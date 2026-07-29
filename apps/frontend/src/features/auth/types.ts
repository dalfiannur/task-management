// Flat FE types for the auth domain — mapped from proto (`gen/users_pb`) so
// components never touch proto message shapes directly.

export type UserStatus = "pending" | "active" | "suspended" | "unknown";

/** A user as the app consumes it (directory entry or the signed-in principal). */
export interface AppUser {
  id: string;
  phone: string;
  displayName: string;
  email: string;
  avatarUrl: string;
  status: UserStatus;
  isAdmin: boolean;
  createdAt: string;
  lastLoginAt?: string;
}

/** Persisted session: the JWT plus the principal it was minted for. */
export interface Session {
  token: string | null;
  user: AppUser | null;
}

export const EMPTY_SESSION: Session = { token: null, user: null };
