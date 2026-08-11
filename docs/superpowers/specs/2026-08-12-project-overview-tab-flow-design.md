# Project Overview Tab — Flow Design

**Date:** 2026-08-12
**Status:** approved, ready for planning

## Goal

Add an **Overview** tab to the project detail shell: the landing view that answers
"where does this project stand right now" before the user drills into Tasks.
It becomes the first tab and the default landing route.

## Scope

- Task statistics for one project (total / in progress / done / overdue) — the
  four the tab renders, no `todo` bucket that nothing displays.
- Per-module progress (done / total per module).
- A project info panel (status, owner, date range, module / page / media / member counts).
- Recent project activity.

Out of scope: any write action. The tab is read-only; every mutation stays in
its own tab.

## Data sourcing decision

A new backend RPC aggregates the numbers, rather than the frontend deriving them
from `ListTasks` + `ListModules`.

Note the aggregation is **not** SQL. The Arke store loads records and filters in
memory (`load_all_tasks(store)` → filter), the same as `GetDashboardStats`. The
reason to choose a backend RPC here is therefore **one round-trip and one source
of truth for the counts**, not query efficiency. If a project ever grows large
enough that in-memory filtering hurts, the fix is inside the handler and no
client changes.

Rejected alternatives:

- **Client-side aggregation** from existing hooks. Zero backend change and the
  `ListTasks` cache is shared with the Tasks tab, but the same counting rules
  (cancelled excluded from totals, overdue = `due < today && status != done`)
  would then exist in two places — Rust and TypeScript — and could drift.
- **`getDashboardStats().perProject`.** Already exists but only carries
  `done/total`; no overdue or in-progress per project, and it loads every
  project to read one row.

## Backend contract

### Placement

`GetProjectOverview` goes on **`DashboardService`** (`proto/dashboard.proto`),
not `ProjectService`. `dashboard` is already the cross-domain read-aggregation
module and already imports `work` + `projects` records; putting the RPC on
`projects` would make the projects module pull in `work`, `pages`, and `media`.

Handler lives in a new file `crates/transport/src/dashboard/project_overview.rs`
and registers on the existing `DashboardServiceBuilder` in `dashboard_router`.

### Proto

```proto
rpc GetProjectOverview(GetProjectOverviewRequest) returns (ProjectOverview);

message GetProjectOverviewRequest { string project_id = 1; }

message ModuleProgress {
  string module_id = 1;
  string module_name = 2;
  uint32 done = 3;
  uint32 total = 4;
}

message ProjectOverview {
  uint32 total_tasks = 1;       // non-cancelled — same rule as GetDashboardStats
  uint32 in_progress_tasks = 2;
  uint32 done_tasks = 3;
  uint32 overdue_tasks = 4;     // due_date < today (UTC) && status != done
  repeated ModuleProgress per_module = 5;  // module order
  repeated string member_ids = 6;          // owner first, then the rest
  uint32 module_count = 7;
  uint32 page_count = 8;
  uint32 media_count = 9;       // ready media only
}
```

### Deliberately absent

- **`Project`.** The shell already calls `GetProject`; copying its fields here
  would create a second source for the same data. The info panel reads
  `useProject`, whose cache is already warm.
- **Activity list.** `ListProjectActivity` exists, is paginated, and
  `<ProjectActivity/>` is ready to use. Folding a paginated list into an
  aggregate message buys nothing.

`member_ids` does overlap `ListProjectMembers`, accepted deliberately: both call
the same `project_member_ids` helper, so there is still one implementation, and
without it the default tab would need a second round-trip — the thing choosing a
backend RPC was meant to avoid.

### Counting rules

Identical to `GetDashboardStats`, so the dashboard and the tab never disagree:

- Cancelled tasks are excluded from `total_tasks` and from every status bucket.
- `overdue` = `due_date < today (UTC)` and `status != done`.
- `per_module.total` counts non-cancelled tasks in that module; `done` counts
  `status == done`. Modules with no tasks appear as `0/0`.

### Authorization

Same gate as `GetProject`:

1. `require_auth` → `UNAUTHENTICATED`
2. project missing → `NOT_FOUND`
3. not admin and not a member → `PERMISSION_DENIED`

### Existing helpers used

`modules_for_project`, `tasks_for_modules`, `pages_for_project`,
`ready_media_for_project`, `project_member_ids`, `is_member`, `today()`.
No new persistence code.

### Tests

Added to `crates/transport/tests/dashboard_flow.rs`:

- non-member → `PERMISSION_DENIED`; unknown project id → `NOT_FOUND`
- counts correct across statuses, with a cancelled task excluded from the total
- an overdue task counted, a done-but-past-due task not counted
- empty project → all zeros, `per_module` empty
- `member_ids` starts with the owner

## Frontend

### New feature `src/features/overview/`

Peer of `timeline` / `members`, not a sub-folder of `projects`:

```
features/overview/
├── api/hooks.ts          # useProjectOverview(projectId), enabled: !!projectId
├── api/mappers.ts        # mapOverview: proto → flat
├── types.ts              # ProjectOverview, ModuleProgress
├── components/
│   ├── overview-tab.tsx
│   ├── project-info-card.tsx
│   └── module-progress-list.tsx
└── index.ts              # barrel
```

`useProjectOverview` follows the standard connect-query read pattern and returns
`{ ...result, overview }` with `overview` mapped to the flat FE type.

### Targeted improvement

`StatCard` is currently a local component inside
`features/dashboard/components/stat-cards.tsx`. Overview needs an identical
card, so it is promoted to `components/shared/stat-card.tsx` and dashboard
imports it from there — one definition instead of two that slowly diverge. Its
`alert` variant (the only fully-colored one, reserved for Overdue) is kept.

### Layout

Wrapped in the card container used by the Members / Pages tabs, `p-6`:

```
┌──────────────────────────────────────────────────────────┐
│ [Total 42] [In progress 8] [Done 30] [Overdue 3]         │
├────────────────────────────────┬─────────────────────────┤
│ Progress  ▓▓▓▓▓▓▓░░░ 71%       │ About                   │
│ Per module                     │ Status · Owner          │
│  Auth     ▓▓▓▓▓░ 8/10          │ 1 Jul → 30 Sep          │
│  Billing  ▓▓░░░░ 2/9           │ 6 modules · 4 pages ·   │
│                                │ 12 media                │
│                                │ Members ◍◍◍◍ +3         │
├────────────────────────────────┴─────────────────────────┤
│ Recent activity  → <ProjectActivity pageSize={10}/>      │
└──────────────────────────────────────────────────────────┘
```

Two columns from `lg` up, one column below.

Overall progress = `done_tasks / total_tasks`, shown as a percentage plus a bar.

The *About* panel is not a repeat of the detail header: the header answers "what
project is this" (name, description, owner, dates), About answers "how much is in
it" (status, counts, member faces). Status / owner / dates come from `useProject`
(warm cache from the shell); the counts and `member_ids` come from the overview
RPC; names and avatars resolve through `useUserMap`.

### Routing

- New `routes/_authed/projects/$projectId/overview.tsx` → `<OverviewTab projectId/>`
- `$projectId/index.tsx`: redirect target changes `all-tasks` → `overview`
- `project-tab-nav.tsx`: `{ to: "/projects/$projectId/overview", label: "Overview" }`
  inserted as the first entry; the other five keep their order

### Loading and empty states

- Loading: skeletons matching the card shapes they replace — same height,
  radius, and shadow — so nothing jumps when data lands (the pattern already used
  by the Pages tab).
- Project with no modules and no tasks: the shared `<EmptyState/>` pointing the
  user at the Tasks tab.
- `per_module` empty but tasks exist: hide the per-module block rather than
  render an empty bar.
- Query error: the same inline error treatment other tabs use; the shell's own
  access-denied state already covers the non-member case.

## Verification

- `cargo test -p transport` — new flow tests pass
- `cd apps/frontend && bun run tsc --noEmit`
- `cd apps/frontend && bun run lint`
- `cd apps/frontend && bun run build`
- `./node_modules/.bin/buf generate` run after the proto change, before the
  frontend work
