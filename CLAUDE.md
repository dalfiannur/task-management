# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Sedjiwa Portal Task Management — a project/task management tool with a React SPA frontend and a Bun API backend. Part of the larger Sedjiwa Portal ecosystem (core portal, OIDC provider, task management).

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

No test framework is configured in either package.

## Architecture

### Frontend

**Stack:** React 19, React Router v7, Apollo Client, Zustand, Tailwind CSS + CSS Modules, shadcn/ui (Radix primitives).

**Auth:** OIDC via `react-oidc-context` / `oidc-client-ts`. Token extracted from OIDC provider, set on GraphQL client via `setAuthToken()`. Unauthenticated users redirect to `/callback` which triggers `signinRedirect()`.

**Data flow:** All server data flows through Apollo Client hooks in `src/hooks/` (use-tasks, use-projects, use-modules, use-labels, use-media, use-leads, use-users, etc.). Each hook file defines its own GraphQL operations inline using `gql` tagged templates.

**Three GraphQL endpoints** (configured in `src/lib/graphql-client.ts`):
- `graphqlClient` → `/api-tasks/graphql` (this backend, proxied in dev)
- `coreGraphClient` → `/api-core/graphql` (core portal, proxied in dev)
- `oidcGraphClient` → `VITE_OIDC_API_URL` (OIDC API, direct)

**Client state:** Zustand store in `src/stores/ui-store.ts` for UI-only state (sidebar, view mode).

**Path alias:** `@/*` → `./src/*`

**Route structure:** File-based in `src/pages/`. Key routes: `/dashboard`, `/projects`, `/projects/$projectId` (detail + modules + tasks), `/projects/$projectId/timeline` (Gantt), `/projects/$projectId/media`, `/projects/$projectId/pages`.

**Components:** `src/components/ui/` contains shadcn/ui primitives. Domain components in `src/components/{dashboard,layout,media,modules,projects,tasks,timeline,shared}/`.

### Frontend Conventions

#### Styling

- **CSS Modules only.** Every component uses `ComponentName.module.css` imported as `styles`. Never use inline Tailwind classes on domain components (Tailwind utility classes are only acceptable inside shadcn/ui primitives in `src/components/ui/`).
- Import pattern: `import styles from "./component-name.module.css";`
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
- For non-default GraphQL endpoints, pass `client` option: `{ client: coreClient }` or `{ client: oidcClient }`.

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
- **Plugins** (`src/plugins/`): Middleware (AuthPlugin extracts OIDC JWT)

**Path alias:** `~/*` → `./src/*`

**Key:** TypeScript decorators are required (`experimentalDecorators` + `emitDecoratorMetadata` + `reflect-metadata`).

**Entry point:** `src/index.ts` → `src/App.ts` (TasksAPI extends bunsane App, registers all services/plugins).

## External Dependencies

- **PostgreSQL** on localhost:5432 (db: `sedjiwa_tasks`)
- **S3-compatible storage** (RustFS) on localhost:9000 (bucket: `tasks-media`) for file uploads
- **OIDC provider** on localhost:4000 for authentication
- **Core Portal API** on localhost:3200 for leads/project data
