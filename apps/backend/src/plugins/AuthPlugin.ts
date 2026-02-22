import App from "bunsane/core/App";
import BasePlugin from "bunsane/plugins";

export class AuthPlugin extends BasePlugin {
  name = "AuthPlugin";
  version = "1.0.0";

  async init(_app: App) {
    console.log("[AuthPlugin] Initialized");
  }

  /**
   * Extract user info from the Authorization header (OIDC Bearer token).
   * Decodes the JWT payload. In production, validate against the OIDC JWKS.
   */
  static async extractUser(
    request: Request,
  ): Promise<{ id: string; sub: string; email: string; name: string; picture?: string; role?: string } | null> {
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) return null;

    const token = authHeader.slice(7);
    try {
      const payload = JSON.parse(
        Buffer.from(token.split(".")[1]!, "base64url").toString(),
      );
      if (!payload.sub) return null;

      return {
        id: payload.sub,
        sub: payload.sub,
        email: payload.email ?? "",
        name: payload.name ?? payload.preferred_username ?? "",
        picture: payload.picture,
        role: payload.role,
      };
    } catch {
      return null;
    }
  }
}
