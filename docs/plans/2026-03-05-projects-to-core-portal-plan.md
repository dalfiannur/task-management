# Projects to Core Portal — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make Core Portal the single source of truth for project master data, keeping only cross-references (coreRef, parentRef, moduleRef, leaderId) in the task-management backend.

**Architecture:** Frontend queries Core Portal directly for project lists and details. Task-management backend stores only local cross-references (parent hierarchy, module links). Mutations that affect project master data (status, close) go to Core Portal; mutations that affect cross-refs (module linking) stay on the local backend.

**Tech Stack:** React 19, Apollo Client, TypeScript, Bun/Bunsane backend

**Starting point:** Build on existing uncommitted changes that already removed most backend enrichment logic and started using `coreClient` for project queries.

---

### Task 1: Backend — Remove dead code

**Files:**
- Modify: `apps/backend/src/services/ProjectService.ts`

**Step 1: Remove dead functions and unused imports**

Remove the following dead code from `ProjectService.ts`:
- `computeResolvedStatus` function (lines 35-38) — no longer called
- `enrichEntity` function (lines 40-42) — empty body, no callers
- Unused imports: `fetchCoreProject`, `fetchCoreProjects`, `type CoreProject` from `~/lib/core-client`

The file should still import `createCoreProject` and `extractAuthToken` (used by createProject/createSubProject).

**Step 2: Verify backend compiles**

Run: `cd apps/backend && bun run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add apps/backend/
git commit -m "refactor: remove dead enrichment code from ProjectService"
```

---

### Task 2: Frontend — Rewrite types/project.ts

**Files:**
- Modify: `apps/frontend/src/types/project.ts`

**Step 1: Replace file contents**

Replace the entire file with:

```typescript
// Core Portal status values
export type CoreProjectStatus = "draft" | "active" | "completed" | "archived";
export type CoreWinStage = "inactive" | "pending" | "proposal" | "won" | "lost";

// Primary type — all project data comes from Core Portal
export interface CoreProject {
  id: string;
  code: string;
  name: { name: string; description?: string };
  status: CoreProjectStatus;
  winStage: CoreWinStage;
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

// Local cross-ref data from task-management backend (for module linking, sub-project hierarchy)
export interface LocalProjectRef {
  id: string;
  coreRef: { value: string };
  parentRef?: { parentProjectId: string };
  moduleRef?: { moduleId: string };
  projectLeaderId?: { value: string };
  linkedModule?: { id: string; name: string } | null;
}

export interface CreateProjectInput {
  name: string;
  clientId: string;
  description?: string;
  projectLeaderId?: string;
  ownerId?: string;
  divisionId?: string;
  value?: number;
  startDate?: string;
  endDate?: string;
}

export interface UpdateProjectInput {
  title?: string;
  description?: string;
  projectLeaderId?: string | null;
  status?: CoreProjectStatus;
}

export interface CreateSubProjectInput {
  parentProjectId: string;
  name: string;
  description?: string;
  projectLeaderId?: string;
  ownerId?: string;
  divisionId?: string;
  value?: number;
  startDate?: string;
  endDate?: string;
  moduleId?: string;
}

// Display status for UI badges/dots — derived from status + winStage
export type ProjectDisplayStatus = "draft" | "pending" | "proposal" | "active" | "completed" | "archived" | "lost";

export function getDisplayStatus(project: CoreProject): ProjectDisplayStatus {
  if (project.status === "completed") return "completed";
  if (project.status === "archived") return "archived";
  if (project.status === "draft") return "draft";
  // status === "active" — differentiate by winStage
  if (project.winStage === "pending") return "pending";
  if (project.winStage === "proposal") return "proposal";
  if (project.winStage === "lost") return "lost";
  return "active"; // winStage: won or inactive
}

export const PROJECT_STATUS_CONFIG: Record<
  ProjectDisplayStatus,
  { label: string; color: string }
> = {
  draft: { label: "Draft", color: "bg-slate-100 text-slate-700" },
  pending: { label: "Pending", color: "bg-gray-100 text-gray-700" },
  proposal: { label: "Proposal", color: "bg-amber-100 text-amber-700" },
  active: { label: "Active", color: "bg-blue-100 text-blue-700" },
  completed: { label: "Closed", color: "bg-purple-100 text-purple-700" },
  archived: { label: "Archived", color: "bg-red-100 text-red-700" },
  lost: { label: "Lost", color: "bg-red-100 text-red-700" },
};
```

**Step 2: Do NOT type-check yet** — other files still reference old types, so there will be errors. We'll fix those in subsequent tasks.

**Step 3: Commit**

```bash
git add apps/frontend/src/types/project.ts
git commit -m "refactor: rewrite project types for Core Portal as source of truth"
```

---

### Task 3: Frontend — Update use-projects.ts hooks

**Files:**
- Modify: `apps/frontend/src/hooks/use-projects.ts`

**Step 1: Replace file contents**

Key changes:
- All queries use `coreClient`
- `GET_PROJECT` fetches full Core fields including `clientDetail`, `name.description`
- Remove `PROJECT_FIELDS` fragment (no longer needed for local backend queries)
- Keep `LIST_PROJECTS` as a local backend query only for `refetchQueries` (local entity cache invalidation)
- `useCloseProject` → calls Core `updateProject(status: "completed")` instead of removed `closeProject` mutation
- `useUpdateProject` handles both Core updates (status) and local updates (moduleId, leaderId)
- Sub-project queries: `useSubProjects` queries Core Portal `listProjects(parentId: X)`
- All hooks return `CoreProject` (not `Project`)

```typescript
import { useQuery, useMutation, gql, coreClient, client } from "@/lib/graphql-client";
import { createMutationHook, createVoidMutationHook, normalizeQueryResult } from "@/lib/hook-factories";
import type { CoreProject, CreateProjectInput, CreateSubProjectInput, LocalProjectRef } from "@/types/project";

// --- GraphQL: Core Portal queries ---

const CORE_PROJECT_FIELDS = gql`
  fragment CoreProjectFields on Project {
    id
    code
    winStage
    commercial
    status
    name {
      name
      description
    }
    ref {
      divisionId
      eventId
      parentId
      companyId
      clientId
      leaderId
    }
    clientDetail {
      name {
        name
        legalName
      }
    }
  }
`;

const LIST_CORE_PROJECTS = gql`
  ${CORE_PROJECT_FIELDS}
  query ListCoreProjects($input: listProjectsInput) {
    listProjects(input: $input) {
      ...CoreProjectFields
    }
  }
`;

const GET_CORE_PROJECT = gql`
  ${CORE_PROJECT_FIELDS}
  query GetCoreProject($input: getProjectInput!) {
    getProject(input: $input) {
      ...CoreProjectFields
    }
  }
`;

// --- GraphQL: Local backend queries ---

const LOCAL_PROJECT_FIELDS = gql`
  fragment LocalProjectFields on Project {
    id
    coreRef { value }
    projectLeaderId { value }
    parent { id }
    linkedModule { id name }
  }
`;

const LIST_LOCAL_PROJECTS = gql`
  ${LOCAL_PROJECT_FIELDS}
  query ListLocalProjects {
    listProjects {
      ...LocalProjectFields
    }
  }
`;

const GET_LOCAL_PROJECT = gql`
  ${LOCAL_PROJECT_FIELDS}
  query GetLocalProject($input: getProjectInput!) {
    getProject(input: $input) {
      ...LocalProjectFields
    }
  }
`;

// --- GraphQL: Mutations (local backend) ---

const APPROVE_PROJECT = gql`
  ${LOCAL_PROJECT_FIELDS}
  mutation ApproveProject($input: approveProjectInput!) {
    approveProject(input: $input) {
      ...LocalProjectFields
    }
  }
`;

const UPDATE_LOCAL_PROJECT = gql`
  ${LOCAL_PROJECT_FIELDS}
  mutation UpdateLocalProject($input: updateProjectInput!) {
    updateProject(input: $input) {
      ...LocalProjectFields
    }
  }
`;

const DELETE_PROJECT = gql`
  mutation DeleteProject($input: deleteProjectInput!) {
    deleteProject(input: $input)
  }
`;

const CREATE_PROJECT = gql`
  ${LOCAL_PROJECT_FIELDS}
  mutation CreateProject($input: createProjectInput!) {
    createProject(input: $input) {
      ...LocalProjectFields
    }
  }
`;

const CREATE_SUB_PROJECT = gql`
  ${LOCAL_PROJECT_FIELDS}
  mutation CreateSubProject($input: createSubProjectInput!) {
    createSubProject(input: $input) {
      ...LocalProjectFields
    }
  }
`;

const LIST_LOCAL_SUB_PROJECTS = gql`
  ${LOCAL_PROJECT_FIELDS}
  query ListLocalSubProjects($input: listSubProjectsInput!) {
    listSubProjects(input: $input) {
      ...LocalProjectFields
    }
  }
`;

// --- Core Portal update mutation ---

const UPDATE_CORE_PROJECT = gql`
  ${CORE_PROJECT_FIELDS}
  mutation UpdateCoreProject($input: updateProjectInput!) {
    updateProject(input: $input) {
      ...CoreProjectFields
    }
  }
`;

// --- Hooks ---

export function useProjects(input?: { status?: string; parentId?: string }) {
  const result = useQuery<{ listProjects: CoreProject[] }>(LIST_CORE_PROJECTS, {
    client: coreClient,
    variables: input ? { input } : { input: { status: "active" } },
  });
  return normalizeQueryResult(result, (d) => d.listProjects);
}

export function useProject(id: string) {
  const result = useQuery<{ getProject: CoreProject | null }>(GET_CORE_PROJECT, {
    variables: { input: { id } },
    client: coreClient,
    skip: !id,
  });
  return normalizeQueryResult(result, (d) => d.getProject);
}

/** Fetch local cross-ref data (linkedModule, parentRef) from task-management backend. */
export function useLocalProject(id: string) {
  const result = useQuery<{ getProject: LocalProjectRef | null }>(GET_LOCAL_PROJECT, {
    variables: { input: { id } },
    skip: !id,
  });
  return normalizeQueryResult(result, (d) => d.getProject);
}

/** Fetch sub-project local refs from task-management backend. */
export function useLocalSubProjects(parentProjectId?: string) {
  const result = useQuery<{ listSubProjects: LocalProjectRef[] }>(LIST_LOCAL_SUB_PROJECTS, {
    variables: { input: { parentProjectId } },
    skip: !parentProjectId,
  });
  return normalizeQueryResult(result, (d) => d.listSubProjects);
}

/** Fetch sub-projects from Core Portal by parentId. */
export function useSubProjects(parentProjectId?: string) {
  const result = useQuery<{ listProjects: CoreProject[] }>(LIST_CORE_PROJECTS, {
    client: coreClient,
    variables: { input: { parentId: parentProjectId } },
    skip: !parentProjectId,
  });
  return normalizeQueryResult(result, (d) => d.listProjects);
}

export const useCreateProject = createMutationHook<
  CreateProjectInput,
  LocalProjectRef,
  LocalProjectRef
>({
  mutation: CREATE_PROJECT,
  responseKey: "createProject",
  refetchQueries: [LIST_LOCAL_PROJECTS, LIST_CORE_PROJECTS],
});

export const useApproveProject = createMutationHook<
  { id: string; description?: string },
  LocalProjectRef,
  LocalProjectRef
>({
  mutation: APPROVE_PROJECT,
  responseKey: "approveProject",
  mapVariables: (input) => ({
    input: { id: input.id, description: input.description },
  }),
  refetchQueries: [LIST_LOCAL_PROJECTS, LIST_CORE_PROJECTS],
});

/** Update local cross-refs (moduleId, leaderId) on task-management backend. */
export const useUpdateLocalProject = createMutationHook<
  { id: string; projectLeaderId?: string; moduleId?: string | null },
  LocalProjectRef,
  LocalProjectRef
>({
  mutation: UPDATE_LOCAL_PROJECT,
  responseKey: "updateProject",
  refetchQueries: [LIST_LOCAL_PROJECTS, GET_LOCAL_PROJECT],
});

/** Update project on Core Portal (status, winStage, etc.). */
export const useUpdateCoreProject = createMutationHook<
  { id: string; status?: string; winStage?: string; description?: string },
  CoreProject,
  CoreProject
>({
  mutation: UPDATE_CORE_PROJECT,
  responseKey: "updateProject",
  client: coreClient,
  refetchQueries: [LIST_CORE_PROJECTS, GET_CORE_PROJECT],
});

export const useDeleteProject = createVoidMutationHook<string>({
  mutation: DELETE_PROJECT,
  mapVariables: (id) => ({ input: { id } }),
  refetchQueries: [LIST_LOCAL_PROJECTS, LIST_CORE_PROJECTS],
});

export const useCreateSubProject = createMutationHook<
  CreateSubProjectInput,
  LocalProjectRef,
  LocalProjectRef
>({
  mutation: CREATE_SUB_PROJECT,
  responseKey: "createSubProject",
  refetchQueries: [LIST_LOCAL_SUB_PROJECTS, LIST_LOCAL_PROJECTS, LIST_CORE_PROJECTS],
});

export function getProjectDisplayName(project: CoreProject): string {
  return project.name?.name || "Untitled";
}
```

**Step 2: Commit**

```bash
git add apps/frontend/src/hooks/use-projects.ts
git commit -m "refactor: split project hooks into Core Portal and local backend queries"
```

---

### Task 4: Frontend — Update use-leads.ts

**Files:**
- Modify: `apps/frontend/src/hooks/use-leads.ts`

**Step 1: Remove mapping layer, return CoreProject directly**

The `mapCoreProject` function and `CoreProjectRaw` interface are dead code. The hook should return `CoreProject` directly.

Changes:
- Remove `CoreProjectRaw` interface
- Remove `mapCoreProject` function
- Import `CoreProject` from `@/types/project` (remove `Project`, `ProjectStatus`)
- `useNewLeads` returns `CoreProject[]` without mapping
- Update GraphQL query to include all needed `CoreProject` fields

```typescript
import { useQuery, gql, coreClient, salesClient, mediaClient } from "@/lib/graphql-client";
import { createMutationHook, normalizeQueryResult } from "@/lib/hook-factories";
import type { CoreProject } from "@/types/project";

const LIST_LEADS = gql`
  query ListLeadProjects {
    listProjects(input: {winStage: pending}) {
      id
      code
      status
      winStage
      commercial
      name {
        description
        name
      }
      ref {
        companyId
        leaderId
      }
    }
  }
`;

const APPROVE_LEAD = gql`
  mutation ApproveLeadProject($input: updateProjectInput!) {
    updateProject(input: $input) {
      id
      code
      status
      winStage
      name {
        description
        name
      }
    }
  }
`;

export function useNewLeads() {
  const result = useQuery<{ listProjects: CoreProject[] }>(LIST_LEADS, {
    client: coreClient,
  });
  return normalizeQueryResult(result, (d) => d.listProjects);
}

export const useApproveLead = createMutationHook<
  { id: string; winStage: string },
  CoreProject
>({
  mutation: APPROVE_LEAD,
  responseKey: "updateProject",
  client: coreClient,
  refetchQueries: [LIST_LEADS],
});

// --- Deal brief and media (unchanged) ---
// ... keep the rest of the file (GET_DEAL_BY_PROJECT_ID, DealBrief types, useDealBrief, useProjectMediaFiles) as-is
```

**Step 2: Commit**

```bash
git add apps/frontend/src/hooks/use-leads.ts
git commit -m "refactor: use-leads returns CoreProject directly, remove mapping layer"
```

---

### Task 5: Frontend — Update project-layout.tsx

**Files:**
- Modify: `apps/frontend/src/pages/project-layout.tsx`

**Step 1: Update imports and field references**

Changes:
- Import `getDisplayStatus`, `PROJECT_STATUS_CONFIG`, `type ProjectDisplayStatus` (not `ProjectStatus`)
- Import `useLocalProject`, `useUpdateLocalProject`, `useUpdateCoreProject` from hooks
- Use `useProject(projectId!)` for Core data, `useLocalProject(projectId!)` for local cross-refs
- Replace `project.status.value` → `project.status`
- Replace `project.clientName` → `project.clientDetail?.name.name`
- Replace `project.coreDescription` → `project.name?.description`
- Replace `project.code` (already direct)
- Update `showWin`: `project.winStage === "proposal"` (can win proposals)
- Update close condition: `project.winStage === "won"` (can close active won projects)
- Update `DOT_CLASS` keys to match `ProjectDisplayStatus` values
- Use `getDisplayStatus(project)` to derive status for badges and dots
- Replace `project.status === "on_going"` → `project.status === "active"` for close dialog guard
- Pass `useLocalProject` data for module linking dropdown (uses `localProject.linkedModule`)
- Use `useUpdateLocalProject` for module link changes, `useUpdateCoreProject` for status changes
- `project.parent?.id` → check `project.ref?.parentId` for "back to parent" link
- `project.projectLeaderId?.value` → `project.ref?.leaderId` for leader display

For the module link dropdown, the `localProject` provides `linkedModule`. Update the Select's value source:
```typescript
const { data: localProject } = useLocalProject(projectId!);
// ...
value={localProject?.linkedModule?.id ?? "__none__"}
onValueChange={(v) => {
  updateLocalProject.mutate({
    id: localProject!.id, // local entity ID
    moduleId: v === "__none__" ? null : v,
  });
}}
```

For the parent link:
```typescript
{project.ref?.parentId && (
  <Link to={`/projects/${project.ref.parentId}`} ...>
    Back to parent project
  </Link>
)}
```

For the WinProjectDialog and CloseProjectDialog, pass `CoreProject`:
```typescript
{showWin && (
  <WinProjectDialog project={project} ... />
)}
{project.status === "active" && project.winStage === "won" && (
  <CloseProjectDialog project={project} ... />
)}
```

**Step 2: Commit**

```bash
git add apps/frontend/src/pages/project-layout.tsx
git commit -m "refactor: project-layout uses Core Portal data directly"
```

---

### Task 6: Frontend — Update project-detail.tsx, project-my-tasks.tsx, project-sub-projects.tsx

**Files:**
- Modify: `apps/frontend/src/pages/project-detail.tsx`
- Modify: `apps/frontend/src/pages/project-my-tasks.tsx`
- Modify: `apps/frontend/src/pages/project-sub-projects.tsx`

**Step 1: project-detail.tsx**

Changes:
- Remove `ProjectStatus` import, import `type ProjectDisplayStatus, getDisplayStatus` from `@/types/project`
- `project.status.value === "on_going"` → `project.status === "active"` (lines 144, 191)
- `projectStatus={project.status.value}` → `projectStatus={getDisplayStatus(project)}` (line 175)
- Update `SortableModuleItem` prop type: `projectStatus: ProjectDisplayStatus`

**Step 2: project-my-tasks.tsx**

Changes:
- Import `getDisplayStatus` from `@/types/project`
- `projectStatus={project.status.value}` → `projectStatus={getDisplayStatus(project)}` (line 66)

**Step 3: project-sub-projects.tsx**

Changes:
- `project?.status.value === "on_going"` → `project?.status === "active"` (lines 25, 42)

**Step 4: Commit**

```bash
git add apps/frontend/src/pages/project-detail.tsx apps/frontend/src/pages/project-my-tasks.tsx apps/frontend/src/pages/project-sub-projects.tsx
git commit -m "refactor: update project pages to use Core status values"
```

---

### Task 7: Frontend — Update projects.tsx, dashboard.tsx, project-members.tsx

**Files:**
- Modify: `apps/frontend/src/pages/projects.tsx`
- Modify: `apps/frontend/src/pages/dashboard.tsx`
- Modify: `apps/frontend/src/pages/project-members.tsx`

**Step 1: projects.tsx**

Changes:
- Import `CoreProject` instead of `Project`
- `isInternalProject`: `!p.commercial` (line 24-26)
- `isCommercialProject`: `p.commercial` (line 28-30)
- Both functions take `CoreProject` parameter
- `p.status.value !== "pending"` → `p.winStage !== "pending"` (line 87) for filtering out leads
- `p.status.value !== "closed"` → `p.status !== "completed"` (line 96)
- `p.status.value === "closed"` → `p.status === "completed"` (lines 97, 105)
- `p.parent?.id` → `p.ref?.parentId` (line 87) for root project filter
- `approveProject` state type: `CoreProject | null`
- `ProjectCard` receives `CoreProject` (will be updated in Task 8)
- `project.parent` → `project.ref?.parentId` for parentName lookup

**Step 2: dashboard.tsx**

Changes:
- Remove `Project` import, keep `CoreProject`
- `p.status === "active"` (already correct on line 67 — the current uncommitted code)
- Verify filter logic works with Core status values

**Step 3: project-members.tsx**

Changes:
- `project?.projectLeaderId?.value` → `project?.ref?.leaderId` (line 64)

**Step 4: Commit**

```bash
git add apps/frontend/src/pages/projects.tsx apps/frontend/src/pages/dashboard.tsx apps/frontend/src/pages/project-members.tsx
git commit -m "refactor: update projects, dashboard, members pages for Core types"
```

---

### Task 8: Frontend — Update project-card.tsx, close-project-dialog.tsx, win-project-dialog.tsx

**Files:**
- Modify: `apps/frontend/src/components/projects/project-card.tsx`
- Modify: `apps/frontend/src/components/projects/close-project-dialog.tsx`
- Modify: `apps/frontend/src/components/projects/win-project-dialog.tsx`

**Step 1: project-card.tsx**

Changes:
- Import `CoreProject`, `getDisplayStatus`, `PROJECT_STATUS_CONFIG` from `@/types/project` (remove `Project`)
- Interface: `project: CoreProject`
- `project.projectLeaderId?.value` → `project.ref?.leaderId`
- `PROJECT_STATUS_CONFIG[project.status.value]` → `PROJECT_STATUS_CONFIG[getDisplayStatus(project)]`
- `project.code` already direct (OK)
- `project.description` → `project.name?.description`
- `project.linkedModule` → this comes from local data. For now, remove this badge from the card (or skip if the card is only used in contexts where local data isn't available). Alternatively, accept an optional `linkedModuleName` prop.
- `getProjectDisplayName(project)` already works with `CoreProject`

**Step 2: close-project-dialog.tsx**

Changes:
- Import `CoreProject` instead of `Project`
- Interface: `project: CoreProject`
- `project.coreRef?.value` → `project.id` (Core project ID is the ID itself)
- Replace `useCloseProject` with `useUpdateCoreProject`
- Mutation call: `updateCoreProject.mutate({ id: project.id, status: "completed" }, ...)`
- Remove `useCloseProject` import

**Step 3: win-project-dialog.tsx**

Changes:
- Import `CoreProject` instead of `Project`
- Interface: `project: CoreProject`
- `project.projectLeaderId?.value` → `project.ref?.leaderId`
- `project.description ?? ""` → `project.name?.description ?? ""`
- `project.coreRef?.value` → `project.id`
- `project.coreName` → `project.name?.name`
- Replace `useUpdateProject` with `useUpdateCoreProject` for the win action
- Mutation: `updateCoreProject.mutate({ id: project.id, winStage: "won" }, ...)` (instead of `status: "on_going"`)
- Also update local project leader if changed: `useUpdateLocalProject` for `projectLeaderId`

**Step 4: Commit**

```bash
git add apps/frontend/src/components/projects/
git commit -m "refactor: update project dialogs and card for Core Portal types"
```

---

### Task 9: Frontend — Update dashboard components

**Files:**
- Modify: `apps/frontend/src/components/dashboard/active-projects.tsx`
- Modify: `apps/frontend/src/components/dashboard/project-progress.tsx`
- Modify: `apps/frontend/src/components/dashboard/new-leads.tsx`
- Modify: `apps/frontend/src/components/dashboard/approve-lead-dialog.tsx`

**Step 1: active-projects.tsx**

Changes:
- Import `CoreProject` instead of `Project`
- Interface: `projects: CoreProject[]`
- ProjectItem: `project: CoreProject`
- Filter: `.filter((p) => p.status === "active" && p.winStage !== "pending")` (active + not leads)
- `project.coreName ?? "Untitled"` → `project.name?.name ?? "Untitled"`
- `project.projectLeaderId?.value` → `project.ref?.leaderId`

**Step 2: project-progress.tsx**

Changes:
- Remove `Project` import (already has `CoreProject`)
- `ProjectStat.project` type: `CoreProject` (line 17)
- `project.coreName ?? "Untitled"` → `project.name?.name ?? "Untitled"` (line 79)
- Filter already uses `p.status === "active"` (correct)

**Step 3: new-leads.tsx**

Changes:
- Import `CoreProject` instead of `Project`
- Interfaces: `projects: CoreProject[]`, state: `CoreProject | null`
- `project.code ?? project.id` → `project.code || project.id`
- `project.coreName ?? "Untitled"` → `project.name?.name ?? "Untitled"`
- `project.projectLeaderId?.value` → `project.ref?.leaderId`

**Step 4: approve-lead-dialog.tsx**

Changes:
- Import `CoreProject` instead of `Project`
- Interface: `project: CoreProject | null`
- `project?.companyId` → `project?.ref?.companyId`
- `project?.coreName` → `project?.name?.name`
- The `useApproveProject` call passes `project.id` — this is the Core project ID, used to create a local entity. The `approveProject` mutation on the local backend takes the Core project ID and creates a local entity + Proposal module.
- Keep `approveLead.mutateAsync` to update winStage on Core
- After both succeed, refetch queries

**Step 5: Commit**

```bash
git add apps/frontend/src/components/dashboard/
git commit -m "refactor: update dashboard components for Core Portal types"
```

---

### Task 10: Frontend — Update app-sidebar.tsx

**Files:**
- Modify: `apps/frontend/src/components/layout/app-sidebar.tsx`

**Step 1: Update types and status colors**

Changes:
- Import `CoreProject`, `type ProjectDisplayStatus`, `getDisplayStatus` instead of `ProjectStatus`
- Remove `Project` import
- `STATUS_DOT_COLORS` keyed by `ProjectDisplayStatus`:
  ```typescript
  const STATUS_DOT_COLORS: Record<ProjectDisplayStatus, string> = {
    draft: "dot-draft",
    pending: "dot-pending",
    proposal: "dot-proposal",
    active: "dot-active",
    completed: "dot-completed",
    archived: "dot-archived",
    lost: "dot-lost",
  };
  ```
- `ProjectItem`: uses `getDisplayStatus(project)` for dot color
- `LeadItem`: change `project: Project` → `project: CoreProject`
- `project.coreName` → `project.name?.name`
- State `approveProject`: `CoreProject | null`
- Root project filter already uses `!p.ref?.parentId` (correct)
- Internal/commercial filters already use `p.commercial` (correct)

**Step 2: Update sidebar CSS module**

May need to add CSS classes for new dot colors (`dot-proposal`, `dot-active`, etc.) if they don't exist.
Check `apps/frontend/src/components/layout/app-sidebar.module.css` for existing dot classes and add missing ones.

**Step 3: Commit**

```bash
git add apps/frontend/src/components/layout/
git commit -m "refactor: update sidebar for Core Portal project types"
```

---

### Task 11: Frontend — Update module-section.tsx projectStatus

**Files:**
- Modify: `apps/frontend/src/components/modules/module-section.tsx`

**Step 1: Update projectStatus type and checks**

Changes:
- Import `ProjectDisplayStatus` instead of `ProjectStatus`
- Prop type: `projectStatus?: ProjectDisplayStatus`
- The check `projectStatus === "prospect" || projectStatus === "win"` → `projectStatus === "proposal"` (in proposal stage, only Proposal module allows task creation)
- The condition becomes:
  ```typescript
  {!(projectStatus === "proposal" && module.name !== "Proposal") && (
    // show "New Task" button
  )}
  ```

**Step 2: Commit**

```bash
git add apps/frontend/src/components/modules/module-section.tsx
git commit -m "refactor: update ModuleSection to use ProjectDisplayStatus"
```

---

### Task 12: Verify — Type-check, lint, visual review

**Step 1: Type-check frontend**

Run: `cd apps/frontend && bun run tsc --noEmit`
Expected: No type errors (or only pre-existing ones unrelated to this change)

Fix any remaining type errors found.

**Step 2: Lint frontend**

Run: `cd apps/frontend && bun run lint`
Expected: No new lint errors

**Step 3: Build backend**

Run: `cd apps/backend && bun run build`
Expected: Build succeeds

**Step 4: Commit any remaining fixes**

```bash
git add -A
git commit -m "fix: resolve type errors from Core Portal migration"
```

---

## Notes

### Sub-project display challenge

Sub-projects exist in both Core Portal (as projects with `ref.parentId`) and the local backend (via `ProjectParentRefComponent`). The `useSubProjects` hook queries Core for sub-project master data. The `useLocalSubProjects` hook queries the local backend for cross-refs (linkedModule). Pages that need both (like sub-project cards with module badges) should use both hooks.

### Hook factory `client` option

Some `createMutationHook` calls pass `client: coreClient`. Verify `hook-factories.ts` supports the `client` option — if not, use `useMutation` directly with `{ client: coreClient }`.

### Refetch queries across clients

When a Core mutation succeeds, we may also need to refetch local queries (and vice versa). Apollo's `refetchQueries` only works within the same client by default. For cross-client refetching, use `client.refetchQueries()` in `onSuccess` callbacks.
