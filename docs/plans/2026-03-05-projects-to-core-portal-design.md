# Design: Move Projects to Core Portal

**Date:** 2026-03-05
**Status:** Approved

## Problem

The task-management backend currently stores and enriches Project data — fetching master data from Core Portal at query time and merging it with local components (status, name, description, etc.). This creates:
- Duplicated state between Core Portal and task-management
- Complex enrichment logic that runs on every query
- Stale data when Core Portal updates aren't reflected
- Confusing dual-type system (`Project` vs `CoreProject`) on the frontend

## Decision

**Core Portal is the single source of truth for project master data.** The task-management backend only stores cross-references (coreRef, parentRef, moduleRef, leaderId).

## Architecture

### What Core Portal Owns

All project master data:
- `id`, `code`, `name`, `description`
- `status` (draft | active | completed | archived)
- `winStage` (inactive | pending | proposal | won | lost)
- `commercial`, `value`
- `ref` (clientId, companyId, divisionId, parentId, authorId, leaderId, eventId)
- `clientDetail`, `ownerDetail`, `divisionDetail`, etc.
- `dates` (startDate, endDate)

### What Task-Management Backend Keeps

Cross-references only:
- `ProjectTag` — entity marker
- `ProjectCoreRefComponent` — links to Core project ID
- `ProjectParentRefComponent` — sub-project hierarchy (local to task-management)
- `ProjectModuleRefComponent` — links sub-project to module
- `ProjectLeaderIdComponent` — cached leader ID (synced from Core)

### Frontend Type Changes

**Before:** Two overlapping types
```typescript
interface Project { id, coreRef, status, name, code, coreName, ... }  // mixed
interface CoreProject { id, name, ref, status, commercial, ... }       // partial
```

**After:** Clean separation
```typescript
// Primary type — used by most UI components
interface CoreProject {
  id: string;
  code: string;
  name: { name: string; description?: string };
  status: "draft" | "active" | "completed" | "archived";
  winStage: "inactive" | "pending" | "proposal" | "won" | "lost";
  commercial: boolean;
  value?: number;
  ref: {
    clientId?: string;
    companyId?: string;
    divisionId?: string;
    parentId?: string;
    authorId?: string;
    leaderId?: string;
    eventId?: string;
  };
  clientDetail?: { name: { name: string; legalName: string } };
  projectLeaderDetail?: { displayName: string };
  dates?: { startDate?: string; endDate?: string };
}

// Local cross-ref — used only for module-linking and membership ops
interface LocalProjectRef {
  id: string;
  coreRef: string;
  parentRef?: { parentProjectId: string };
  moduleRef?: { moduleId: string };
  linkedModule?: { id: string; name: string };
}
```

### Frontend Status Mapping

The old frontend `ProjectStatus` type used values like `on_going`, `prospect`, `closed`, `canceled`. Core Portal uses different values:

| Old (task-mgmt) | New (Core Portal) |
|-----------------|-------------------|
| `prospect` | `status: active, winStage: pending` |
| `on_going` | `status: active, winStage: won` |
| `closed` | `status: completed` |
| `canceled` | `status: archived` |

The `ProjectStatus` type and `PROJECT_STATUS_CONFIG` must be updated to use Core's values. Status filtering throughout the UI must be updated accordingly.

### Data Flow

| Operation | Source | Details |
|-----------|--------|---------|
| List projects (sidebar, projects page) | Core Portal | `listProjects` query |
| Project detail (name, code, status, client) | Core Portal | `getProject` query |
| Project members | Task-mgmt backend | `listProjectMembers` query |
| Module linking (sub-project to module) | Task-mgmt backend | `updateProject` mutation (moduleRef only) |
| Create project | Core Portal + task-mgmt | Core creates master, task-mgmt creates local ref |
| Update project status/close | Core Portal | `updateProject` mutation on Core |
| Approve lead | Core Portal | `updateProject` on Core (winStage: pending -> proposal) + task-mgmt creates local ref |
| Delete project | Task-mgmt (cascade) + Core | Delete local entities, then Core project |

### Backend Changes

**Keep:**
- `ProjectTag`, `ProjectCoreRefComponent`, `ProjectParentRefComponent`, `ProjectModuleRefComponent`, `ProjectLeaderIdComponent`
- `listProjects` — returns local entities (for membership/module linkage)
- `getProject` — returns local entity
- `createProject` / `createSubProject` — creates Core project + local ref
- `approveProject` — creates local ref + initial module
- `updateProject` — only handles moduleRef and leaderId
- `deleteProject` — cascade deletes local entities

**Remove:**
- `ProjectNameComponent`, `ProjectDescriptionComponent`, `ProjectStatusComponent`
- `ProjectCodeComponent`, `ProjectCoreNameComponent`, `ProjectCoreDescriptionComponent`
- `ProjectClientNameComponent`, `ProjectClientLegalNameComponent`
- `ProjectWinStageComponent`, `ProjectResolvedStatusComponent`, `ProjectClosedAtComponent`
- `closeProject` mutation (moves to Core Portal)
- `updateProjectStatus` mutation (moves to Core Portal)
- `enrichEntity` function and all Core-fetching in list/get queries
- All enrichment archetype fields

**Slim `ProjectArcheType`:** Only coreRef, parentRef, moduleRef, leaderId, linkedModule relation.

### Frontend Changes

**Hooks (`use-projects.ts`):**
- `useProjects()` → queries Core Portal `listProjects`
- `useProject(id)` → queries Core Portal `getProject`
- `useSubProjects(parentId)` → queries Core Portal `listProjects(input: {parentId})`
- `useLocalProject(coreId)` → queries task-mgmt backend for cross-ref data (module link, etc.)
- `useCloseProject` → Core Portal `updateProject(status: completed)`
- `useUpdateProject` → split: status changes go to Core, moduleRef changes go to task-mgmt
- Remove `mapProject` and `ProjectRaw` — no more mapping needed for Core data

**Type updates (`types/project.ts`):**
- `ProjectStatus` → `"draft" | "active" | "completed" | "archived"`
- Update `PROJECT_STATUS_CONFIG` to match Core values
- Remove old `Project` interface fields that came from enrichment
- Add `CoreProject` as the primary type

**Component updates (all files referencing old field shapes):**
- `project.status.value` → `project.status`
- `project.name?.value` or `project.coreName` → `project.name.name`
- `project.coreDescription` → `project.name.description`
- `project.clientName` → `project.clientDetail?.name.name`
- `project.clientLegalName` → `project.clientDetail?.name.legalName`
- `project.code?.value` → `project.code`
- `project.winStage` stays but is now a direct field (not `{ value }` wrapped)
- `project.resolvedStatus` → derive from `status` + `winStage` if needed
- `project.parent?.id` → `project.ref.parentId`

**Affected components:**
- `project-layout.tsx` — status display, action menus, detail header
- `project-detail.tsx` — conditional new module button
- `projects.tsx` — filtering logic
- `project-card.tsx` — status badge, display name
- `project-my-tasks.tsx` — status check
- `project-sub-projects.tsx` — conditional create button
- `active-projects.tsx` — filtering active projects
- `project-progress.tsx` — status filtering
- `new-leads.tsx` — lead display
- `approve-lead-dialog.tsx` — approval flow
- `close-project-dialog.tsx` — close flow
- `win-project-dialog.tsx` — win/promote flow
- `app-sidebar.tsx` — project list, status dots
- `dashboard.tsx` — active project stats

### Leads Flow Update (`use-leads.ts`)

Currently `use-leads.ts` fetches projects with `winStage: pending` from Core and maps them to the old `Project` type. This should be updated to return `CoreProject` directly, removing the mapping layer.

## Out of Scope

- Adding `approveProject`/`closeProject` as dedicated Core Portal mutations (use `updateProject` instead)
- Migrating membership data to Core Portal
- Changing sub-project storage (remains local with `ProjectParentRefComponent`)
- Changes to sedjiwa-core codebase (frontend uses existing Core queries/mutations)
