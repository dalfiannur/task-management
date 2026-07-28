# Standalone Users for Task Management — Design

**Date:** 2026-07-28
**Status:** Approved (pending spec review)

## Goal

Make Task Management self-contained for identity. Today it depends on the
Sedjiwa OIDC server for authentication (login redirect + JWKS verification) and
on the `@qyubit/sedjiwa-permissions` package for the token shape and permission
helpers, and it fetches the user directory from the Core Portal. This project
replaces all of that with a **local user system**: local users, phone + password
login, a locally-issued JWT, a local user directory, and admin user management.

### Non-goals (explicitly deferred)

- **Cross-service integrations** — the frontend still calls Core (leads,
  companies, divisions), Media (uploads), and Sales with what used to be the
  OIDC token. Those calls are **out of scope**; some of those features may stop
  working after this change and will be addressed separately.
- **Full RBAC** — no roles/permissions management UI. Authorization collapses to
  a single `isAdmin` flag (admin ⇒ `permissions: ["*"]`).

## Decisions (from brainstorming)

| Topic | Decision |
|---|---|
| Shape | Merge Users into Task Management; **no new service**. |
| Auth mechanism | **Phone number + password**, locally-issued **JWT** (HS256). |
| Feature scope | Auth + user directory + **admin user management** (no full RBAC). |
| Existing data | **Fresh start** for task data; **seed** an admin + a few members. |
| Separation boundary | **Users/auth only**; Core/Media/Sales left as-is for now. |
| Refactor approach | **B — full local refactor**: drop `@qyubit/sedjiwa-permissions`, rename `user.sub` → `user.id`, write a local auth/permissions module. |
| Registration | **Self-register → `pending` → admin approval**; login rejects non-`active`. |

## Architecture Overview

```
Frontend (React)                         Backend (Bun + bunsane)
─────────────────                        ───────────────────────
auth-store (localStorage)                AuthService  (register/login/me)
  → login(phone,password) ───────────▶   UserService  (directory + admin mgmt)
  ← { token, user }                      AuthPlugin.extractUser (verify local JWT)
  → Apollo header: Bearer <token> ───▶   context.user: AuthUser
                                         ~/auth/ module (types, jwt, guards, perms)
                                         User ECS (components + archetype)
```

No OIDC redirect, no remote JWKS, no Core Portal user lookup.

## Backend Design

### 1. Local auth/permissions module — `apps/backend/src/auth/`

Reimplements the small surface currently imported from
`@qyubit/sedjiwa-permissions` (verified: `hasPermission`, `requireUser`,
`requirePermission`, `AuthContext`, `Action`, `PermissionEntry`,
`PermissionManifest`, `TasksResources`, `CoreResources`, `TASKS_PERMISSIONS`).

- `types.ts`
  - `AuthUser = { id, phone, displayName, email?, avatarUrl?, isAdmin, permissions: string[] }`
  - `AuthContext = { user: AuthUser | null; request: Request }`
  - `Action` (const + open string type), `PermissionEntry`, `PermissionManifest`
- `permissions.ts` — `hasPermission(perms, resource, action)` (ported verbatim,
  incl. `*`, `:manage`, `_all`, parent-`manage` rules), `TasksResources`,
  `CoreResources`, `TASKS_PERMISSIONS` manifest.
- `guards.ts` — `requireUser(ctx)`, `requirePermission(ctx, resource, action)`,
  `requireAdmin(ctx)` (throw `GraphQLError` with `UNAUTHENTICATED` / `FORBIDDEN`).
- `jwt.ts` — `signToken(user): Promise<string>` and
  `verifyToken(token): Promise<AuthUser | null>` using **HS256** with
  `AUTH_JWT_SECRET` (via existing `jose`). Claims: `sub=id`, `name`, `phone`,
  `email`, `picture`, `permissions`, `exp`.

### 2. User domain (ECS) — ported/trimmed from OIDC

- `components/UserComponents.ts`
  - `PhoneComponent` — `value: string` (indexed, unique login identifier),
    `verified: boolean`
  - `PasswordComponent` — `hash: string`, `changedAt: Date`
  - `UserProfileComponent` — `displayName` (indexed), `avatarUrl`, `email`
  - `UserStatusComponent` — `value: "pending" | "active" | "suspended"`
    (indexed), `createdAt: Date`, `lastLoginAt: Date | null`
  - Tags: `UserTag`, `AdminTag`
- `archetypes/UserArcheType.ts` — fields `phone`, `profile`, `status`;
  `@ArcheTypeFunction isAdmin(entity)` → `entity.has(AdminTag)`.

### 3. Services (GraphQL, bunsane `@GraphQLOperation`)

**`AuthService`**
- `register(phone, password, displayName)` → creates a **`pending`** user
  (`Bun.password.hash`), returns the created user (no token — cannot log in until
  approved). Rejects duplicate phone.
- `login(phone, password)` → verify with `Bun.password.verify`; **reject if
  status ≠ `active`** (distinct errors for `pending` vs `suspended`); update
  `lastLoginAt`; return `{ token, user }`.
- `me` → current `AuthUser` from context (replaces the OIDC `me`).

**`UserService`**
- Directory (any authenticated user): `searchUsers(q)`, `getUser(id)` — output
  shape `{ id, info { displayName, email, avatarUrl } }` to stay
  drop-in-compatible with existing `use-users.ts` mappers.
- Admin (`requireAdmin`): `listUsers(status?)`, `createUser(...)` (created
  `active`), `updateUser`, `activateUser(id)` (approve pending),
  `suspendUser(id)`, `deleteUser(id)`, `resetPassword(id, newPassword)`,
  `setAdmin(id, isAdmin)` (add/remove `AdminTag`).

### 4. `AuthPlugin` rewrite

`extractUser(request)` → read `Bearer` token → `verifyToken` → return `AuthUser`
(no JWKS, no remote fetch, no OIDC issuer). `init()` logs local-auth mode.

### 5. Context factory (`App.ts`)

Unchanged shape: `setGraphQLContextFactory` returns `{ user: AuthUser|null,
request }`. Import `UserComponents`; register `AuthService` + `UserService`.

### 6. Identity refactor (approach B)

- Rename `user.sub` → `user.id` — **42 occurrences across 9 files**
  (`TaskService` 12, `ProjectService` 8, `CommentService` 8, `PageService` 5,
  `NotificationService` 4, `lib/auth-context.ts` 2, `utils/auth.ts` 1,
  `MembershipService` 1, `DashboardService` 1).
- Replace the 5 package imports (`lib/auth-context.ts`, `utils/auth.ts`,
  `plugins/AuthPlugin.ts`, `services/PermissionService.ts`,
  `services/MembershipService.ts`) with `~/auth/`.
- `PermissionService` serves `TASKS_PERMISSIONS` from the local module.
- Remove `@qyubit/sedjiwa-permissions` from `package.json`.

### 7. Replace `fetchUserIdsByPermission`

`ProjectService.approveProject` auto-adds members "with `tasks:projects:read_all`".
Local simplification: `listActiveUserIds()` (all `active` users) — matches the
original broad-read intent. Delete `lib/oidc-client.ts`.

### 8. Seed script — `scripts/seed-users.ts`

Idempotent (match by phone): 1 admin (`active`, `AdminTag`) + a few members
(`active`). Prints credentials. Run via `bun run scripts/seed-users.ts`.

### 9. Environment

- Add: `AUTH_JWT_SECRET` (required), `AUTH_JWT_EXPIRES_IN` (default `7d`).
- Remove/ignore: `OIDC_ISSUER`, `OIDC_JWKS_URL`, `OIDC_API_URL`.
- Update `.env.example` and deployment compose/nginx as needed.

## Frontend Design

### 1. Local auth store — `stores/auth-store.ts` (+ provider)

Zustand store persisted to `localStorage`: `{ token, user }`, actions
`login(phone, password)`, `register(phone, password, displayName)`, `logout()`.
On hydrate/login, call `setAuthToken(token)` for Apollo; on logout, clear and
redirect `/login`.

### 2. Pages

- `login.tsx` — phone + password form; on success store token, redirect
  `/dashboard`.
- `register.tsx` — phone + password + displayName; on success show
  "awaiting admin approval" state (no auto-login).
- `admin/users.tsx` — table of users with status; approve (pending), suspend,
  delete, reset password, toggle admin, create user. Admin-guarded route.
- Replace OIDC `callback.tsx` / `landing.tsx` / `logout.tsx` with local
  equivalents (landing → redirect to `/login` or `/dashboard`).

### 3. Wiring

- `main.tsx` — remove `react-oidc-context` `AuthProvider`; wrap with local
  provider (or none, since Zustand store is global).
- `router.tsx` — protected routes gate on `auth-store` token; add `/login`,
  `/register`, `/admin/users`; remove `/callback`.
- `use-me.ts` — query local `me` on the **tasks** endpoint (not `oidcClient`);
  `useIsAdmin` / `useHasPermission` decode the local token's `permissions`.
- `use-users.ts` — `searchUsers` / `getUser` on the **tasks** endpoint (remove
  `coreClient` usage).
- Delete `lib/oidc-config.ts`; remove `react-oidc-context` + `oidc-client-ts`
  from `package.json`.

## Data Flow

1. **Register** → `register` mutation → user created `pending` → UI shows
   "awaiting approval".
2. **Admin approves** → `activateUser` → status `active`.
3. **Login** → `login` mutation → `{ token, user }` → localStorage + Apollo
   header → all tasks GraphQL calls authenticated locally.
4. **Request** → `AuthPlugin.extractUser` verifies local JWT → `context.user`.

## Error Handling

- Invalid credentials → `GraphQLError` `UNAUTHENTICATED`.
- `pending` login → error "account awaiting approval"; `suspended` → "account
  suspended".
- Admin mutations → `requireAdmin` → `FORBIDDEN` for non-admins.
- Expired/invalid token → `extractUser` returns `null` → resolvers throw
  `UNAUTHENTICATED` → frontend error link redirects to `/login`.
- Duplicate phone on register/create → validation error.

## Testing

No test framework is configured. Plan:
- Add minimal `bun test` for pure units: `hasPermission`, `jwt` sign/verify
  round-trip, `Bun.password` hash/verify.
- Manual E2E: seed → register → admin approve → login → `me` → admin ops.

## File-Change Summary

**New (backend):** `src/auth/{types,permissions,guards,jwt}.ts`,
`src/components/UserComponents.ts`, `src/archetypes/UserArcheType.ts`,
`src/services/AuthService.ts`, `src/services/UserService.ts`,
`scripts/seed-users.ts`.
**Modified (backend):** `App.ts`, `plugins/AuthPlugin.ts`, `lib/auth-context.ts`,
`utils/auth.ts`, `services/PermissionService.ts`, `services/MembershipService.ts`,
`services/ProjectService.ts` (+ `user.sub`→`user.id` across Task/Comment/Page/
Notification/Dashboard services), `package.json`, `.env.example`.
**Deleted (backend):** `lib/oidc-client.ts`.
**New (frontend):** `stores/auth-store.ts`, `pages/login.tsx`,
`pages/register.tsx`, `pages/admin/users.tsx`.
**Modified (frontend):** `main.tsx`, `app.tsx`, `router.tsx`, `hooks/use-me.ts`,
`hooks/use-users.ts`, `pages/{callback,landing,logout}.tsx`, `package.json`.
**Deleted (frontend):** `lib/oidc-config.ts`.
