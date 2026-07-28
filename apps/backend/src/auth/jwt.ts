// apps/backend/src/auth/jwt.ts
import * as jose from "jose";
import type { AuthUser } from "./types";

const SECRET = new TextEncoder().encode(
  process.env.AUTH_JWT_SECRET ?? "dev-insecure-secret-change-me",
);
const EXPIRES_IN = process.env.AUTH_JWT_EXPIRES_IN ?? "7d";
const ISSUER = "task-management";

export async function signToken(user: AuthUser): Promise<string> {
  return await new jose.SignJWT({
    name: user.displayName,
    phone: user.phone,
    email: user.email ?? "",
    picture: user.avatarUrl ?? "",
    permissions: user.permissions,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(EXPIRES_IN)
    .sign(SECRET);
}

export async function verifyToken(token: string): Promise<AuthUser | null> {
  try {
    const { payload } = await jose.jwtVerify(token, SECRET, { issuer: ISSUER });
    if (!payload.sub) return null;
    const permissions = (payload.permissions as string[] | undefined) ?? [];
    return {
      id: payload.sub,
      phone: (payload.phone as string) ?? "",
      displayName: (payload.name as string) ?? "",
      email: (payload.email as string) || undefined,
      avatarUrl: (payload.picture as string) || undefined,
      isAdmin: permissions.includes("*"),
      permissions,
    };
  } catch {
    return null;
  }
}
