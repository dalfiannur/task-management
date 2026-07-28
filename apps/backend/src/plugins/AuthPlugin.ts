// apps/backend/src/plugins/AuthPlugin.ts
import App from "bunsane/core/App";
import BasePlugin from "bunsane/plugins";
import { verifyToken, type AuthUser } from "~/auth";

export class AuthPlugin extends BasePlugin {
  name = "AuthPlugin";
  version = "2.0.0";

  async init(_app: App) {
    console.log("[AuthPlugin] Local JWT auth enabled (issuer: task-management)");
    if (!process.env.AUTH_JWT_SECRET) {
      console.warn("[AuthPlugin] AUTH_JWT_SECRET is not set — using an insecure development secret");
    }
  }

  static async extractUser(request: Request): Promise<AuthUser | null> {
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) return null;
    return await verifyToken(authHeader.slice(7));
  }
}
