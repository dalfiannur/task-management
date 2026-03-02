# JWKS OIDC Token Verification — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the backend's raw JWT base64 decode with proper JWKS-based signature verification and claim validation using the `jose` library.

**Architecture:** The `AuthPlugin` will discover the JWKS endpoint from the OIDC provider's `.well-known/openid-configuration`, create a cached remote keyset via `jose.createRemoteJWKSet()`, and verify every incoming JWT with `jwtVerify()` (checking signature, iss, aud, exp, nbf). The context factory in `App.ts` will reject unauthenticated requests. Services that currently re-verify tokens will be refactored to use the already-verified `context.user`.

**Tech Stack:** `jose` (JWT/JWKS library), Bun runtime, bunsane framework

---

### Task 1: Install `jose` dependency

**Files:**
- Modify: `apps/backend/package.json`

**Step 1: Install jose**

```bash
cd apps/backend && bun add jose
```

**Step 2: Verify installation**

```bash
cd apps/backend && bun run -e "import { jwtVerify } from 'jose'; console.log('jose loaded OK')"
```

Expected: `jose loaded OK`

**Step 3: Commit**

```bash
git add apps/backend/package.json apps/backend/bun.lock
git commit -m "chore(backend): add jose dependency for JWKS token verification"
```

---

### Task 2: Add OIDC environment variables

**Files:**
- Modify: `apps/backend/.env`
- Modify: `apps/backend/.env.example`

**Step 1: Add env vars to `.env.example`**

Append after the `CORE_API_URL` line:

```
# OIDC token verification
OIDC_ISSUER_URL=http://localhost:4000
OIDC_AUDIENCE=8607c60d3a841de6d51e24cfffdf3e51
```

**Step 2: Add same values to `.env`**

Same content appended to the real `.env` file.

**Step 3: Commit**

```bash
git add apps/backend/.env.example
git commit -m "chore(backend): add OIDC_ISSUER_URL and OIDC_AUDIENCE env vars"
```

Note: Do NOT commit `.env` (it's gitignored).

---

### Task 3: Rewrite `AuthPlugin` with JWKS verification

**Files:**
- Modify: `apps/backend/src/plugins/AuthPlugin.ts`

**Step 1: Rewrite AuthPlugin**

Replace the entire file with:

```typescript
import App from "bunsane/core/App";
import BasePlugin from "bunsane/plugins";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { JWTPayload, KeyLike } from "jose";

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

      const { payload } = await jwtVerify(token, jwks as KeyLike | Uint8Array, verifyOptions);

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
```

Key changes:
- `init()` fetches `.well-known/openid-configuration`, extracts `jwks_uri`, creates `RemoteJWKSet`
- `extractUser()` uses `jwtVerify()` instead of raw base64 decode
- Validates signature + `iss`, `aud`, `exp`, `nbf` claims
- Module-level variables (`jwks`, `issuer`, `audience`) initialized once at startup

**Step 2: Verify it compiles**

```bash
cd apps/backend && bun run tsc --noEmit
```

Expected: No errors

**Step 3: Commit**

```bash
git add apps/backend/src/plugins/AuthPlugin.ts
git commit -m "feat(backend): implement JWKS-based JWT verification in AuthPlugin"
```

---

### Task 4: Reject unauthenticated requests in the context factory

**Files:**
- Modify: `apps/backend/src/App.ts`

**Step 1: Update the context factory to throw on missing/invalid auth**

In `App.ts`, replace the `setGraphQLContextFactory` callback. The new version throws an error instead of allowing `user: null`:

```typescript
    this.setGraphQLContextFactory(async (context: { request: Request }) => {
      const user = await AuthPlugin.extractUser(context.request);
      if (!user) {
        throw new Error("Authentication required");
      }

      try {
        const userService = new UserService();
        await userService.syncFromOIDC({
          sub: user.sub,
          email: user.email,
          name: user.name,
          picture: user.picture,
          role: user.role,
        });
      } catch (err) {
        console.error("[AuthPlugin] Failed to sync user from OIDC:", err);
      }

      return { user, request: context.request };
    });
```

**Step 2: Verify it compiles**

```bash
cd apps/backend && bun run tsc --noEmit
```

**Step 3: Commit**

```bash
git add apps/backend/src/App.ts
git commit -m "feat(backend): reject unauthenticated GraphQL requests at context factory"
```

---

### Task 5: Refactor services to use `context.user` instead of re-verifying JWT

Since auth is now enforced at the context factory, `context.user` is always present when a resolver runs. Services that call `AuthPlugin.extractUser(context.request)` are redundantly re-verifying the JWT. Refactor them to read from `context.user`.

**Files:**
- Modify: `apps/backend/src/services/PageService.ts` (line 11-16)
- Modify: `apps/backend/src/services/NotificationService.ts` (line 11-16)
- Modify: `apps/backend/src/services/CommentService.ts` (line 13-18)
- Modify: `apps/backend/src/services/UserService.ts` (line 31-37)
- Modify: `apps/backend/src/services/MembershipService.ts` (line 112-115)
- Modify: `apps/backend/src/services/TaskService.ts` (lines 254, 361, 482)
- Modify: `apps/backend/src/services/ProjectService.ts` (line 643)

**Step 1: Update `requireUser` helpers**

For `PageService.ts`, `NotificationService.ts`, and `CommentService.ts`, their `requireUser` function follows the same pattern. Replace with:

```typescript
function requireUser(context: { user?: { id: string; sub: string; email: string; name: string; picture?: string; role?: string } }) {
  if (!context.user) throw new Error("Authentication required");
  return context.user;
}
```

Remove the `AuthPlugin` import from these files if it's no longer used elsewhere.

**Step 2: Update `requireManager` in `UserService.ts`**

Replace to read from `context.user` instead of calling `AuthPlugin.extractUser`:

```typescript
export function requireManager(context: { user?: { id: string; sub: string; email: string; name: string; picture?: string; role?: string } }) {
  if (!context.user) throw new Error("Authentication required");
  return context.user;
}
```

**Step 3: Update `MembershipService.ts`**

In `requireMember`, replace `AuthPlugin.extractUser(context.request)` with `context.user`:

```typescript
private async requireMember(context: { user?: { ... } }, projectId: string) {
  if (!context.user) throw new Error("Authentication required");
  const user = context.user;
  // ... rest of the method stays the same
```

**Step 4: Update `TaskService.ts`**

Replace all 3 occurrences of `await AuthPlugin.extractUser(context.request)` with `context.user`. The null checks after these calls can remain as defense-in-depth.

**Step 5: Update `ProjectService.ts`**

Replace the `extractUser` helper method to read from context:

```typescript
private async extractUser(context: { user?: { ... } }) {
  return context.user ?? null;
}
```

Or inline `context.user` at call sites.

**Step 6: Remove unused `AuthPlugin` imports**

Remove `import { AuthPlugin } from "..."` from any service file that no longer calls it directly.

**Step 7: Verify it compiles**

```bash
cd apps/backend && bun run tsc --noEmit
```

**Step 8: Verify lint passes**

```bash
cd apps/backend && bun run lint
```

**Step 9: Commit**

```bash
git add apps/backend/src/services/
git commit -m "refactor(backend): use context.user instead of re-verifying JWT in services"
```

---

### Task 6: Manual smoke test

**Step 1: Start the backend**

```bash
cd apps/backend && bun run dev
```

**Step 2: Verify unauthenticated request is rejected**

```bash
curl -s -X POST http://localhost:3000/graphql \
  -H "Content-Type: application/json" \
  -d '{"query":"{ me { id } }"}' | head -c 200
```

Expected: Error response containing "Authentication required"

**Step 3: Verify valid token works**

Use the frontend login flow to get a valid token, then test with it.

**Step 4: Check startup logs**

Look for: `[AuthPlugin] Initialized with JWKS from <jwks_uri>`
