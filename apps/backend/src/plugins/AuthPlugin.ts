import App from "bunsane/core/App";
import BasePlugin from "bunsane/plugins";
import { createRemoteJWKSet, jwtVerify } from "jose";

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
let issuer: string | null = null;
let audience: string | null = null;

export class AuthPlugin extends BasePlugin {
  name = "AuthPlugin";
  version = "1.0.0";

  async init(_app: App) {
    const issuerUrl = process.env.OIDC_ISSUER_URL;
    if (!issuerUrl) {
      throw new Error("[AuthPlugin] OIDC_ISSUER_URL environment variable is required");
    }

    audience = process.env.OIDC_AUDIENCE || null;
    issuer = issuerUrl;

    // Discover JWKS URI from OIDC well-known config
    const wellKnownUrl = `${issuerUrl.replace(/\/$/, "")}/.well-known/openid-configuration`;
    const res = await fetch(wellKnownUrl);
    if (!res.ok) {
      throw new Error(`[AuthPlugin] Failed to fetch OIDC config from ${wellKnownUrl}: ${res.status}`);
    }
    const config = (await res.json()) as { jwks_uri: string };
    if (!config.jwks_uri) {
      throw new Error(`[AuthPlugin] No jwks_uri in OIDC config from ${wellKnownUrl}`);
    }

    jwks = createRemoteJWKSet(new URL(config.jwks_uri));
    console.log(`[AuthPlugin] Initialized with JWKS from ${config.jwks_uri}`);
  }

  /**
   * Verify the JWT from the Authorization header against the OIDC provider's JWKS.
   * Returns the verified user claims or null if verification fails.
   */
  static async extractUser(
    request: Request,
  ): Promise<{ id: string; sub: string; email: string; name: string; picture?: string; role?: string } | null> {
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) return null;

    if (!jwks) {
      console.error("[AuthPlugin] JWKS not initialized — rejecting token");
      return null;
    }

    const token = authHeader.slice(7);
    try {
      const verifyOptions: { issuer?: string; audience?: string } = {};
      if (issuer) verifyOptions.issuer = issuer;
      if (audience) verifyOptions.audience = audience;

      const { payload } = await jwtVerify(token, jwks, verifyOptions);

      if (!payload.sub) return null;

      return {
        id: payload.sub,
        sub: payload.sub,
        email: (payload as any).email ?? "",
        name: (payload as any).name ?? (payload as any).preferred_username ?? "",
        picture: (payload as any).picture,
        role: (payload as any).role,
      };
    } catch (err) {
      console.warn("[AuthPlugin] Token verification failed:", (err as Error).message);
      return null;
    }
  }
}
