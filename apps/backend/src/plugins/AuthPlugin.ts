import App from "bunsane/core/App";
import BasePlugin from "bunsane/plugins";
import * as jose from "jose";

const OIDC_ISSUER = process.env.OIDC_ISSUER || process.env.OIDC_ISSUER_URL || "http://localhost:4000";
const OIDC_JWKS_URL = process.env.OIDC_JWKS_URL || `${OIDC_ISSUER}/.well-known/jwks.json`;
const jwks = jose.createRemoteJWKSet(new URL(OIDC_JWKS_URL));

export class AuthPlugin extends BasePlugin {
  name = "AuthPlugin";
  version = "1.0.0";

  async init(_app: App) {
    console.log(`[AuthPlugin] OIDC issuer: ${OIDC_ISSUER}`);
    console.log(`[AuthPlugin] JWKS URL: ${OIDC_JWKS_URL}`);

    try {
      const res = await fetch(OIDC_JWKS_URL);
      const data = await res.json();
      console.log(`[AuthPlugin] JWKS reachable — ${(data as any).keys?.length ?? 0} key(s) found`);
    } catch (err) {
      console.error(`[AuthPlugin] JWKS NOT reachable at ${OIDC_JWKS_URL}:`, err);
    }
  }

  static async extractUser(
    request: Request,
  ): Promise<{ id: string; sub: string; email: string; name: string; picture?: string; role?: string; permissions: string[] } | null> {
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) return null;

    const token = authHeader.slice(7);
    try {
      const { payload } = await jose.jwtVerify(token, jwks, { issuer: OIDC_ISSUER });

      if (!payload.sub) return null;

      const email = typeof (payload as any).email === "string" ? (payload as any).email.trim() : "";
      const tokenName = typeof (payload as any).name === "string" ? (payload as any).name.trim() : "";
      const preferredUsername = typeof (payload as any).preferred_username === "string"
        ? (payload as any).preferred_username.trim()
        : "";
      const displayName = tokenName || email || preferredUsername || payload.sub;

      const role: string | undefined = (payload as any).role;
      let permissions: string[] = Array.isArray((payload as any).permissions) ? (payload as any).permissions : [];

      // Backward-compat: if role is "manager" and no permissions in JWT, grant wildcard
      if (role === "manager" && permissions.length === 0) {
        permissions = ["*"];
      }

      return {
        id: payload.sub,
        sub: payload.sub,
        email,
        name: displayName,
        picture: (payload as any).picture,
        role,
        permissions,
      };
    } catch (err) {
      console.warn("[AuthPlugin] Token verification failed:", (err as Error).message);
      return null;
    }
  }
}
