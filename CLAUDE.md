# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Sedjiwa Portal Task Management — a project/task management tool with a React SPA frontend and a Bun API backend. Part of the larger Sedjiwa Portal ecosystem (core portal, OIDC provider, task management).

## Repository Structure

```
task-management/
├── apps/
│   ├── frontend/   # Vite + React 19 + TanStack Router/Query + Tailwind CSS
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

No test framework is configured in either package.

## Architecture

### Frontend

**Stack:** React 19, TanStack Router v1 (file-based, auto code-splitting), TanStack Query v5, Zustand, Tailwind CSS, shadcn/ui (Radix primitives), graphql-request.

**Auth:** OIDC via `react-oidc-context` / `oidc-client-ts`. Token extracted from OIDC provider, set on GraphQL client via `setAuthToken()`. Unauthenticated users redirect to `/callback` which triggers `signinRedirect()`.

**Data flow:** All server data flows through TanStack Query hooks in `src/hooks/` (use-tasks, use-projects, use-modules, use-labels, use-media, use-leads, use-users). Each hook defines its own GraphQL operations inline using `gql` tagged templates and returns query/mutation hooks.

**Three GraphQL endpoints** (configured in `src/lib/graphql-client.ts`):
- `graphqlClient` → `/api-tasks/graphql` (this backend, proxied in dev)
- `coreGraphClient` → `/api-core/graphql` (core portal, proxied in dev)
- `oidcGraphClient` → `VITE_OIDC_API_URL` (OIDC API, direct)

**Client state:** Zustand store in `src/stores/ui-store.ts` for UI-only state (sidebar, view mode).

**Path alias:** `@/*` → `./src/*`

**Route structure:** File-based in `src/routes/`. `_authenticated.tsx` is a layout route that guards all child routes. Key routes: `/dashboard`, `/projects`, `/projects/$projectId` (detail + modules + tasks), `/projects/$projectId/timeline` (Gantt), `/projects/$projectId/media`.

**Components:** `src/components/ui/` contains shadcn/ui primitives. Domain components in `src/components/{dashboard,layout,media,modules,projects,tasks,timeline,shared}/`.

### Backend

**Stack:** Bun runtime, `bunsane` (custom in-house ECS framework), PostgreSQL.

**Framework pattern:** `bunsane` uses an Entity-Component-System architecture with decorator-driven GraphQL auto-generation:
- **Archetypes** (`src/archetypes/`): Define entity shapes via `@ArcheType` / `@ArcheTypeField` decorators
- **Components** (`src/components/`): Data containers via `@Component` / `@CompData` decorators (e.g., TaskInfo, TaskAssignment)
- **Services** (`src/services/`): Business logic via `@GraphQLOperation` decorator which auto-generates the GraphQL schema from Zod input schemas and archetype outputs
- **Plugins** (`src/plugins/`): Middleware (AuthPlugin extracts OIDC JWT)

**Path alias:** `~/*` → `./src/*`

**Key:** TypeScript decorators are required (`experimentalDecorators` + `emitDecoratorMetadata` + `reflect-metadata`).

**Entry point:** `src/index.ts` → `src/App.ts` (TasksAPI extends bunsane App, registers all services/plugins).

## External Dependencies

- **PostgreSQL** on localhost:5432 (db: `sedjiwa_tasks`)
- **S3-compatible storage** (RustFS) on localhost:9000 (bucket: `tasks-media`) for file uploads
- **OIDC provider** on localhost:4000 for authentication
- **Core Portal API** on localhost:3200 for leads/project data
