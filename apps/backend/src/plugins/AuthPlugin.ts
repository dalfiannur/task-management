import App from "bunsane/core/App";
import BasePlugin from "bunsane/plugins";
import * as jose from "jose";
import type { SedjiwaTokenPayload } from "@qyubit/sedjiwa-permissions";

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

  static async extractUser(request: Request): Promise<SedjiwaTokenPayload | null> {
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) return null;

    const token = authHeader.slice(7);
    try {
      const { payload } = await jose.jwtVerify(token, jwks, { issuer: OIDC_ISSUER });
      if (!payload.sub) return null;
      return payload as unknown as SedjiwaTokenPayload;
    } catch (err) {
      console.warn("[AuthPlugin] Token verification failed:", (err as Error).message);
      return null;
    }
  }
}
