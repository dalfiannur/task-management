# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Sedjiwa Portal Task Management — a project/task management tool with a React SPA frontend and a Bun API backend. Part of the larger Sedjiwa Portal ecosystem (core portal, task management). **Identity is self-contained**: the app has its own local users and phone+password auth and no longer depends on the Sedjiwa OIDC provider (see Auth below).

## Repository Structure

```
task-management/
├── apps/
│   ├── frontend/   # Vite + React 19 + React Router v7 + Apollo Client + CSS Modules
│   └── backend/    # Bun + Bunsane (custom ECS framework) + PostgreSQL
```

## Commands

### Frontend (`apps/frontend/`)
```bash
cd apps/frontend
bun run dev          # Dev server on :3001 (proxies /api-tasks/ → :3000, /api-core/ → :3200)
bun run build        # Production build (vite build && tsc)
bun run lint         # ESLint on src/**/*.{ts,tsx}
bun run tsc --noEmit # Type-check only
```

### Backend (`apps/backend/`)
```bash
cd apps/backend
bun run dev          # Dev server on :3000 with --watch
bun run build        # Bundle to dist/
bun run start        # Run production bundle
bun run lint         # ESLint on src/**/*.ts
```

Backend has `bun test` coverage for auth/user pure units (`apps/backend/src/**/*.test.ts`); the frontend has no test framework configured.

**Backend auth env:** `AUTH_JWT_SECRET` (required — signing key for the local JWT) and optional `AUTH_JWT_EXPIRES_IN` (default `7d`).

## Architecture

### Frontend

**Stack:** React 19, React Router v7, Apollo Client, Zustand, Tailwind CSS + CSS Modules, shadcn/ui (Radix primitives).

**Auth:** Local phone + password against this backend. `useAuthStore` (`src/stores/auth-store.ts`, Zustand + `persist`) holds `{ token, user, isAdmin }` in `localStorage`; on login/rehydrate it sets the JWT on the Apollo client via `setAuthToken()`. Routes are gated on the store's token in `src/router.tsx` (unauthenticated → `/login?redirect=…`); admin-only routes (e.g. `/admin/users`) gate on `isAdmin`. Pages: `login.tsx`, `register.tsx` (self-register → `pending` → admin approval), `admin-users.tsx`. `use-me.ts` reads the current user; `useIsAdmin`/`useHasPermission` read the store (admin ⇒ all permissions). No OIDC/`react-oidc-context`.

**Data flow:** All server data flows through Apollo Client hooks in `src/hooks/` (use-tasks, use-projects, use-modules, use-labels, use-media, use-leads, use-users, use-admin-users, etc.). Each hook file defines its own GraphQL operations inline using `gql` tagged templates. Every bunsane operation wraps its args in a single required `input` object arg named `<opName>Input` (e.g. `login(input: loginInput!)`); user/auth ops return a JSON scalar (the whole object, no subfield selection).

**GraphQL endpoints** (configured in `src/lib/graphql-client.ts`):
- `client` → `/api/tasks/graphql` (this backend — auth, users, tasks; proxied in dev)
- `coreClient` → `/api/core/graphql` (core portal, proxied in dev)
- `mediaClient` / `salesClient` → media & sales services (proxied in dev)

**Client state:** Zustand store in `src/stores/ui-store.ts` for UI-only state (sidebar, view mode).

**Path alias:** `@/*` → `./src/*`

**Route structure:** File-based in `src/pages/`. Key routes: `/dashboard`, `/projects`, `/projects/$projectId` (detail + modules + tasks), `/projects/$projectId/timeline` (Gantt), `/projects/$projectId/media`, `/projects/$projectId/pages`.

**Components:** `src/components/ui/` contains shadcn/ui primitives. Domain components in `src/components/{dashboard,layout,media,modules,projects,tasks,timeline,shared}/`.

### Frontend Conventions

#### Styling

- **Always use Tailwind CSS utility classes** for all new code — pages, domain components, and layouts. Do NOT create new CSS Module files.
- Use `cn()` helper from `@/lib/utils` to merge/conditional classes.
- **Existing CSS Modules** in pages/components may still exist but should be migrated to Tailwind when touched.
- CSS variables for theming: `var(--color-*)`, `var(--spacing-*)`, `var(--radius-*)`, etc.

#### Hook Patterns

All data hooks live in `src/hooks/`. Use the factory functions from `src/lib/hook-factories.ts`:

- **Mutation hooks** — use `createMutationHook<TInput, TRaw, TMapped>` for mutations that return data:
  ```typescript
  export const useCreateLabel = createMutationHook<
    { name: string; color: string; projectId: string },
    LabelResponse,
    Label
  >({
    mutation: CREATE_LABEL,
    responseKey: "createLabel",
    mapResponse: mapLabel,
  });
  ```
- **Void mutation hooks** — use `createVoidMutationHook<TInput>` for delete/void mutations:
  ```typescript
  export const useDeleteLabel = createVoidMutationHook<string>({
    mutation: DELETE_LABEL,
    mapVariables: (id) => ({ input: { id } }),
  });
  ```
- **Query hooks** — write manually (queries vary too much), but normalize the return with `normalizeQueryResult`:
  ```typescript
  export function useLabels(projectId?: string) {
    const result = useQuery<{ listLabels: LabelResponse[] }>(LIST_LABELS, {
      variables: { input: { projectId } },
      skip: !projectId,
    });
    return normalizeQueryResult(result, (d) => d.listLabels.map(mapLabel));
  }
  ```
- All hooks return `isLoading` (not `isPending`). Apollo's `loading` field is mapped to `isLoading` in factories and `normalizeQueryResult`.
- For non-default GraphQL endpoints, pass `client` option: `{ client: coreClient }`, `{ client: mediaClient }`, etc.

#### Hook File Structure

Each hook file follows this order:
1. GraphQL fragment definitions
2. GraphQL operations (queries, mutations)
3. Response interfaces (the raw Bunsane archetype shape)
4. Mapper functions (`mapLabel`, `mapTask`, etc.) that convert Bunsane response → flat frontend type
5. Exported hooks (queries first, then mutations)

#### Shared Components

Before creating new components, check for existing shared utilities:

| Need | Use | Location |
|------|-----|----------|
| User initials from name | `getInitials(name)` | `src/lib/utils.ts` |
| Icon + label + value row | `<PropertyRow>` | `src/components/shared/property-row.tsx` |
| Date picker with calendar | `<DatePickerField>` | `src/components/shared/date-picker-field.tsx` |
| User selector (single) | `<UserCombobox>` | `src/components/shared/user-combobox.tsx` |
| Label selector | `<LabelCombobox>` | `src/components/shared/label-combobox.tsx` |
| Cmd/Ctrl+Enter submit | `useFormShortcut(open, selector, canSubmit)` | `src/hooks/use-form-shortcut.ts` |

#### Apollo Client Note

`ApolloClient` is **not generic** in this project's Apollo version. Use `ApolloClient` (not `ApolloClient<unknown>` or `ApolloClient<NormalizedCacheObject>`).

### Backend

**Stack:** Bun runtime, `bunsane` (custom in-house ECS framework), PostgreSQL.

**Framework pattern:** `bunsane` uses an Entity-Component-System architecture with decorator-driven GraphQL auto-generation:
- **Archetypes** (`src/archetypes/`): Define entity shapes via `@ArcheType` / `@ArcheTypeField` decorators
- **Components** (`src/components/`): Data containers via `@Component` / `@CompData` decorators (e.g., TaskInfo, TaskAssignment)
- **Services** (`src/services/`): Business logic via `@GraphQLOperation` decorator which auto-generates the GraphQL schema from Zod input schemas and archetype outputs
- **Plugins** (`src/plugins/`): Middleware. `AuthPlugin.extractUser` verifies the locally-issued JWT (HS256, `AUTH_JWT_SECRET`) and returns an `AuthUser` onto the GraphQL context — no OIDC/JWKS.

**Auth & Users:** `src/auth/` is a self-contained module (`types` `AuthUser`/`AuthContext`, `jwt` sign/verify, `permissions` `hasPermission` + `TasksResources`/`TASKS_PERMISSIONS`, `guards` `requireUser`/`requirePermission`/`requireAdmin`) that replaces the former `@qyubit/sedjiwa-permissions` package. User identity lives in `src/components/UserComponents.ts` (Phone/Password/Profile/Status + `UserTag`/`AdminTag`); `AuthService` (register/login/me) and `UserService` (directory + admin CRUD) expose the GraphQL API. The auth-user identity key is `user.id` (admins carry `permissions: ["*"]`). Seed local users with `bun scripts/seed-users.ts` (idempotent). Pure units have `bun test` coverage (`src/auth/*.test.ts`, `src/lib/user-serializer.test.ts`).

**Path alias:** `~/*` → `./src/*`

**Key:** TypeScript decorators are required (`experimentalDecorators` + `emitDecoratorMetadata` + `reflect-metadata`).

**Entry point:** `src/index.ts` → `src/App.ts` (TasksAPI extends bunsane App, registers all services/plugins).

## External Dependencies

- **PostgreSQL** on localhost:5432 (db: `sedjiwa_tasks`)
- **S3-compatible storage** (RustFS) on localhost:9000 (bucket: `tasks-media`) for file uploads
- **Core Portal API** on localhost:3200 for leads/project data

Authentication is handled **locally** (no external OIDC provider). Note: cross-service calls to Core/Media/Sales still send the local JWT, which those services do not yet verify — that integration is handled separately.
