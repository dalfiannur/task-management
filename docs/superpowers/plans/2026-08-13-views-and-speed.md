# Views & Speed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Look at a project's tasks by any axis — status, person, priority, label, module — as a list or a board, filter them, act on many at once, and drive all of it from the keyboard.

**Architecture:** Group-by is the primitive; a board is group-by-status drawn as columns. All view state lives in the URL. Derived logic (parsing, grouping, filtering) lives in pure modules so it can be verified by reading, keeping `all-tasks-tab.tsx` a thin coordinator.

**Tech Stack:** React 19, TanStack Router/Query, connect-query, dnd-kit, Jotai, Tailwind, shadcn/ui.

**Spec:** `docs/superpowers/specs/2026-08-13-views-and-speed-design.md`

---

## Before you start

**This sub-project changes no backend code.** No proto, no RPC, no Rust, no migration. Everything here rearranges tasks that `ListTasks` already returns. If a step seems to need a backend change, stop and report it — the plan is wrong, not the codebase.

**Invoke the `ui-design` skill** before writing any component. Its trade-off gate cannot be satisfied by a subagent (there is no human in the loop to present options to); follow its design guidance, reuse existing tokens and idioms, and say plainly in your report that the gate was unmet rather than treating it as met.

**Gates.** No test framework exists on the frontend:

```bash
cd apps/frontend
bun run tsc --noEmit
bun run lint
bun run build
```

Two `react-hooks/exhaustive-deps` warnings are pre-existing and stay. Introduce no new lint errors. Never hand-edit `src/routeTree.gen.ts` or `src/lib/gen/*_pb.ts` — both are generated.

**Because there is no test framework, read what you are changing before you change it.** The last two sub-projects each shipped bugs past `tsc`, `lint`, `build` *and* two rounds of code review — a URL form that silently did nothing, a palette that could not be operated by keyboard, a delete that destroyed a subtree without confirmation, and a field threaded end to end but never rendered. Every one surfaced only when someone drove the app. Task 10 exists for that reason.

**The parsing trap, already paid for once.** TanStack Router parses search params with JSON semantics: `?assignee=310` arrives as a **number**, and a `typeof value === "string"` guard drops it silently. That is exactly why `?task=3688` did nothing in sub-project 1. `coerceSearchParam` exists in `src/lib/utils.ts`; Task 1 adds its list-valued companion. Every param goes through them.

## File structure

**New**

| File | Responsibility |
|---|---|
| `src/features/tasks/view-state.ts` | The `ViewState` type, URL parse/serialize. Pure, no hooks |
| `src/features/tasks/grouping.ts` | Filter + group a task list into ordered groups. Pure |
| `src/features/tasks/components/view-toolbar.tsx` | View toggle, group-by, filters |
| `src/features/tasks/components/task-board.tsx` | Columns, cards, drop targets |
| `src/features/tasks/components/bulk-bar.tsx` | Selection action bar |
| `src/features/search/commands.ts` | The palette's command list. Pure |

**Modified**

`src/lib/utils.ts` · `src/routes/_authed/projects/$projectId/all-tasks.tsx` · `src/features/tasks/components/{all-tasks-tab,module-section,task-row}.tsx` · `src/features/tasks/index.ts` · `src/features/search/components/search-overlay.tsx`

---

## Task 1: URL state

**Files:** `src/lib/utils.ts`, `src/features/tasks/view-state.ts` (create), `src/routes/_authed/projects/$projectId/all-tasks.tsx`

- [ ] **Step 1: Add the list coercion helper**

In `src/lib/utils.ts`, beside `coerceSearchParam`:

```typescript
/** List-valued search param. Accepts a comma string, a bare value, or an
 *  array, and always yields `string[]`.
 *
 *  The bare-number case is the one that matters: TanStack parses `?assignee=310`
 *  as a NUMBER, so a naive `typeof === "string"` check drops it and the filter
 *  silently does nothing. That exact bug shipped once already, as `?task=3688`.
 */
export function coerceSearchList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(coerceSearchParam).filter((v): v is string => !!v);
  }
  const one = coerceSearchParam(value);
  if (!one) return [];
  return one
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
```

- [ ] **Step 2: Write `view-state.ts`**

```typescript
// The task tab's view state, encoded entirely in the URL: shareable,
// bookmarkable, and Back restores the previous arrangement. Pure — no hooks, no
// router imports — so it can be reasoned about without running anything.

import { coerceSearchList, coerceSearchParam } from "@/lib/utils";
import type { TaskStatus } from "./types";

export type ViewMode = "list" | "board";
export type GroupBy = "module" | "status" | "assignee" | "priority" | "label";

export const VIEW_MODES: ViewMode[] = ["list", "board"];
export const GROUP_BYS: GroupBy[] = [
  "module",
  "status",
  "assignee",
  "priority",
  "label",
];

/** List + group-by-module is today's view; it stays the default so existing
 *  behaviour survives as a preset rather than being replaced. */
export const DEFAULT_VIEW: ViewMode = "list";
export const DEFAULT_GROUP: GroupBy = "module";

export interface ViewState {
  view: ViewMode;
  group: GroupBy;
  status: TaskStatus[];
  assignee: string[];
  label: string[];
  module: string[];
  overdue: boolean;
}

function oneOf<T extends string>(value: unknown, allowed: T[], fallback: T): T {
  const s = coerceSearchParam(value);
  return (allowed as string[]).includes(s ?? "") ? (s as T) : fallback;
}

/** Parse raw search params into a fully-populated ViewState. Never throws;
 *  anything unrecognised falls back to the default. */
export function parseViewState(search: Record<string, unknown>): ViewState {
  return {
    view: oneOf(search.view, VIEW_MODES, DEFAULT_VIEW),
    group: oneOf(search.group, GROUP_BYS, DEFAULT_GROUP),
    status: coerceSearchList(search.status) as TaskStatus[],
    assignee: coerceSearchList(search.assignee),
    label: coerceSearchList(search.label),
    module: coerceSearchList(search.module),
    overdue: coerceSearchParam(search.overdue) === "1",
  };
}

/** Serialize back to search params, omitting defaults and empties so a plain
 *  view yields a clean URL rather than a wall of noise. */
export function toSearchParams(v: ViewState): Record<string, string | undefined> {
  const list = (xs: string[]) => (xs.length ? xs.join(",") : undefined);
  return {
    view: v.view === DEFAULT_VIEW ? undefined : v.view,
    group: v.group === DEFAULT_GROUP ? undefined : v.group,
    status: list(v.status),
    assignee: list(v.assignee),
    label: list(v.label),
    module: list(v.module),
    overdue: v.overdue ? "1" : undefined,
  };
}

export function hasActiveFilters(v: ViewState): boolean {
  return (
    v.status.length > 0 ||
    v.assignee.length > 0 ||
    v.label.length > 0 ||
    v.module.length > 0 ||
    v.overdue
  );
}
```

- [ ] **Step 3: Declare the params on the route**

`src/routes/_authed/projects/$projectId/all-tasks.tsx`:

```typescript
import { createFileRoute } from "@tanstack/react-router";
import { AllTasksTab } from "@/features/tasks";
import { parseViewState, toSearchParams } from "@/features/tasks/view-state";

// View state lives on this tab, not the layout route: `task`/`comment` are
// inherited from the layout because a deep-linked dialog can open over any tab,
// but grouping and filters only mean something here.
export const Route = createFileRoute("/_authed/projects/$projectId/all-tasks")({
  validateSearch: (search: Record<string, unknown>) =>
    toSearchParams(parseViewState(search)),
  component: AllTasks,
});

function AllTasks() {
  const { projectId } = Route.useParams();
  return <AllTasksTab projectId={projectId} />;
}
```

Round-tripping through `parseViewState` → `toSearchParams` is what normalises a
messy inbound URL (`?assignee=310` as a number, `?view=nonsense`) into a clean,
valid one.

**Check this yourself rather than assuming:** the layout route already declares
`task` and `comment`. Confirm that adding `validateSearch` here does not drop
them when both are present — TanStack merges parent and child search schemas, but
verify it with a URL carrying both before moving on, and say what you found.

- [ ] **Step 4: Gate**

`bun run tsc --noEmit && bun run lint` — clean. `AllTasksTab` does not consume the state yet; that is Task 4.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/lib/utils.ts apps/frontend/src/features/tasks/view-state.ts apps/frontend/src/routes/_authed/projects/\$projectId/all-tasks.tsx
git commit -m "feat(tasks): put the task view state in the URL"
```

---

## Task 2: Grouping

**Files:** `src/features/tasks/grouping.ts` (create)

- [ ] **Step 1: Write it**

```typescript
// Filter and group a project's tasks. Pure functions over the already-loaded
// list — nothing fetches, nothing is stored, so nothing can go stale.

import type { Label } from "@/features/labels";
import type { Module, Task } from "./types";
import { TASK_PRIORITIES, TASK_STATUSES } from "./types";
import type { GroupBy, ViewState } from "./view-state";

export interface Group {
  /** Stable id used as the drop-target id and React key. */
  id: string;
  label: string;
  tasks: Task[];
  /** The value written to the grouped field when a card is dropped here.
   *  `null` clears it (the "Unassigned" / "No label" column). */
  value: string | null;
}

/** Same rule the Overview tab counts by, so the two never disagree. */
export function isOverdue(t: Task, today: string): boolean {
  return !!t.dueDate && t.dueDate < today && t.status !== "done";
}

export function applyFilters(tasks: Task[], v: ViewState, today: string): Task[] {
  return tasks.filter((t) => {
    if (v.status.length && !v.status.includes(t.status)) return false;
    if (v.module.length && !v.module.includes(t.moduleId)) return false;
    if (v.overdue && !isOverdue(t, today)) return false;
    if (v.assignee.length && !t.assigneeIds.some((a) => v.assignee.includes(a)))
      return false;
    if (v.label.length && !t.labelIds.some((l) => v.label.includes(l)))
      return false;
    return true;
  });
}

export interface GroupDomain {
  modules: Module[];
  labels: Label[];
  members: { id: string; name: string }[];
}

/**
 * Build the ordered groups for an axis.
 *
 * Every column in the axis's domain is emitted, **including empty ones**: on a
 * board an empty column is the drop target, so hiding it would make it
 * impossible to drag a task into an empty module or onto an unused label.
 *
 * `assignee` and `label` are multi-valued, so a task appears in every column it
 * belongs to. That is the honest rendering — the work really does sit with two
 * people — and it is why dropping onto one of those columns collapses the field
 * to a single value (see the drag handler, which confirms first).
 */
export function buildGroups(
  tasks: Task[],
  group: GroupBy,
  domain: GroupDomain,
): Group[] {
  const bucket = (id: string, label: string, value: string | null): Group => ({
    id,
    label,
    value,
    tasks: [],
  });

  let groups: Group[];
  let assign: (t: Task) => Group[];
  const byValue = new Map<string, Group>();

  switch (group) {
    case "status":
      groups = TASK_STATUSES.map((s) => bucket(`status:${s}`, s, s));
      break;
    case "priority":
      groups = TASK_PRIORITIES.map((p) => bucket(`priority:${p}`, p, p));
      break;
    case "module":
      groups = domain.modules.map((m) => bucket(`module:${m.id}`, m.name, m.id));
      break;
    case "assignee":
      groups = [
        ...domain.members.map((u) => bucket(`assignee:${u.id}`, u.name, u.id)),
        bucket("assignee:none", "Unassigned", null),
      ];
      break;
    case "label":
      groups = [
        ...domain.labels.map((l) => bucket(`label:${l.id}`, l.name, l.id)),
        bucket("label:none", "No label", null),
      ];
      break;
  }
  for (const g of groups) byValue.set(g.id, g);

  switch (group) {
    case "status":
      assign = (t) => [byValue.get(`status:${t.status}`)!].filter(Boolean);
      break;
    case "priority":
      assign = (t) => [byValue.get(`priority:${t.priority}`)!].filter(Boolean);
      break;
    case "module":
      assign = (t) => [byValue.get(`module:${t.moduleId}`)!].filter(Boolean);
      break;
    case "assignee":
      assign = (t) =>
        t.assigneeIds.length
          ? t.assigneeIds
              .map((a) => byValue.get(`assignee:${a}`))
              .filter((g): g is Group => !!g)
          : [byValue.get("assignee:none")!];
      break;
    case "label":
      assign = (t) =>
        t.labelIds.length
          ? t.labelIds
              .map((l) => byValue.get(`label:${l}`))
              .filter((g): g is Group => !!g)
          : [byValue.get("label:none")!];
      break;
  }

  for (const t of tasks) for (const g of assign(t)) g.tasks.push(t);
  for (const g of groups) g.tasks.sort((a, b) => a.order - b.order);
  return groups;
}

/** True when a drop on this axis discards information (multi-valued fields
 *  collapse to one), so the UI can confirm before writing. */
export function dropIsLossy(group: GroupBy, task: Task): boolean {
  if (group === "assignee") return task.assigneeIds.length > 1;
  if (group === "label") return task.labelIds.length > 1;
  return false;
}
```

A task orphaned by a filtered-out module simply lands in no group and is not
rendered — correct, since the module filter is what removed it.

- [ ] **Step 2: Gate + commit**

```bash
bun run tsc --noEmit && bun run lint
git add apps/frontend/src/features/tasks/grouping.ts
git commit -m "feat(tasks): filter and group tasks by any axis"
```

---

## Task 3: The toolbar

**Files:** `src/features/tasks/components/view-toolbar.tsx` (create)

- [ ] **Step 1: Component contract**

```typescript
export function ViewToolbar({
  value,
  onChange,
  domain,
}: {
  value: ViewState;
  /** Receives the full next state; the caller writes it to the URL. */
  onChange: (next: ViewState) => void;
  domain: GroupDomain;
}) { … }
```

A List/Board segmented control, a group-by select, and filter controls for
status, assignee, label, module, and an overdue toggle. Show a "Clear" affordance
when `hasActiveFilters(value)`.

Reuse existing idioms — the status and priority pills already exist in
`task-badges.tsx`, and `LabelCombobox` / `AssigneePicker` establish how multi-select
looks in this app. Do not introduce a fourth selector style.

The toolbar is presentational: it never navigates. The caller owns the URL.

- [ ] **Step 2: Gate + commit**

```bash
bun run tsc --noEmit && bun run lint && bun run build
git add apps/frontend/src/features/tasks/components/view-toolbar.tsx
git commit -m "feat(tasks): add the view toolbar"
```

---

## Task 4: Wire the list to grouping, and thin the coordinator

**Files:** `src/features/tasks/components/all-tasks-tab.tsx`, `module-section.tsx`

This is the task where `all-tasks-tab.tsx` must get **smaller**, not larger.

- [ ] **Step 1: Read state from the URL**

```typescript
const search = useSearch({ from: "/_authed/projects/$projectId/all-tasks" });
const viewState = useMemo(() => parseViewState(search), [search]);

function setViewState(next: ViewState) {
  navigate({ to: ".", search: (prev) => ({ ...prev, ...toSearchParams(next) }) });
}
```

Use the **functional updater** form of `search`, as the existing `setTaskSearch`
does — it is what preserves `?task=` when the view changes, and what makes
omitting the callback from effect deps safe. There is a comment in this file
explaining that; do not break it.

- [ ] **Step 2: Group instead of bucketing by module**

Replace the `tasksByModule` memo with:

```typescript
const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
const visible = useMemo(
  () => applyFilters(tasks, viewState, today),
  [tasks, viewState, today],
);
const groups = useMemo(
  () => buildGroups(visible, viewState.group, domain),
  [visible, viewState.group, domain],
);
```

`domain` is `{ modules, labels, members }` assembled from the hooks already in
this component (`useModules`, `useLabelMap`/`useLabels`, `useProjectMembers` +
`useUserMap`). Memoize it, or `groups` recomputes every render.

- [ ] **Step 3: Render groups**

In List mode, render one `ModuleSection` per group. That component is currently
module-shaped — generalise it to take a `Group` plus a `canManage` flag, keeping
the module-only affordances (rename, reorder, delete, add-task) conditional on
`group === "module"`. A "Status: To do" section must not offer "Delete module".

Subtask indentation stays only under `group === "module"`; on other axes a
subtask is its own row with a chip naming its parent.

- [ ] **Step 4: Verify the existing view is unchanged**

Load the tab with no search params. It must look and behave exactly as before:
modules in order, subtasks indented with progress counts, drag to reorder and
move between modules, blocked badges. This is the regression that matters most —
today's view is the default preset, not a casualty.

- [ ] **Step 5: Gate + commit**

```bash
bun run tsc --noEmit && bun run lint && bun run build
git add apps/frontend/src/features/tasks
git commit -m "feat(tasks): drive the list from grouping and the URL"
```

---

## Task 5: The board

**Files:** `src/features/tasks/components/task-board.tsx` (create), `all-tasks-tab.tsx`

- [ ] **Step 1: Component contract**

```typescript
export function TaskBoard({
  groups,
  userMap,
  labelMap,
  blockedMap,
  progressOf,
  selected,
  onToggleSelect,
  onOpenTask,
}: {
  groups: Group[];
  userMap: Record<string, AppUser>;
  labelMap: Record<string, Label>;
  blockedMap: Record<string, boolean>;
  progressOf: (t: Task) => { done: number; total: number } | null;
  selected: Set<string>;
  onToggleSelect: (id: string, shiftKey: boolean) => void;
  onOpenTask: (id: string) => void;
}) { … }
```

Horizontally scrolling columns, each a `useDroppable` with the group's `id`, each
card a `useSortable` — the same dnd-kit primitives `module-section.tsx` and
`task-row.tsx` already use. The `DndContext` stays in `all-tasks-tab.tsx` so one
drag handler serves both views.

A card shows title, status pill, assignee avatars, labels, due date, the blocked
badge, the subtask progress count, and — when it is a subtask — a chip naming its
parent.

The column container must scroll horizontally without the page scrolling
sideways.

- [ ] **Step 2: Render it**

In `all-tasks-tab.tsx`, branch on `viewState.view` between the existing list and
`<TaskBoard>`. Both receive the same `groups`.

- [ ] **Step 3: Gate + commit**

```bash
bun run tsc --noEmit && bun run lint && bun run build
git add apps/frontend/src/features/tasks
git commit -m "feat(tasks): add the board view"
```

---

## Task 6: Drag writes the grouped field

**Files:** `src/features/tasks/components/all-tasks-tab.tsx`

- [ ] **Step 1: Generalise `onDragEnd`**

Today it assumes module semantics (`mod:` prefixed drop ids, `MoveTask`). Group
ids are now `status:todo`, `assignee:310`, `module:88`, `assignee:none`, and so
on. Resolve the target group by id, then:

| Grouping | Write |
|---|---|
| `module` | `MoveTask` — existing path, keep it exactly as it is |
| `status`, `priority` | `UpdateTask` with the scalar |
| `assignee` | `UpdateTask` `assigneeIds: { values: value ? [value] : [] }` |
| `label` | `UpdateTask` `labelIds: { values: value ? [value] : [] }` |

Dropping into the column a task already belongs to is a no-op — return early, as
the current handler does for an unchanged module.

- [ ] **Step 2: Confirm the lossy case**

When `dropIsLossy(group, task)` is true, ask before writing: dropping a
two-assignee card into one person's column will remove the other, and the card
will disappear from their column. Use `AlertDialog`, the same primitive as the
subtask-delete confirm — do not add a second confirm idiom.

Do not confirm when it is not lossy. A single-assignee card moving between
columns loses nothing, and a confirm on every drag would train people to dismiss
it.

- [ ] **Step 3: Gate + commit**

```bash
bun run tsc --noEmit && bun run lint && bun run build
git add apps/frontend/src/features/tasks
git commit -m "feat(tasks): dropping a card writes the grouped field"
```

---

## Task 7: Selection and bulk edit

**Files:** `src/features/tasks/components/bulk-bar.tsx` (create), `all-tasks-tab.tsx`, `task-row.tsx`

- [ ] **Step 1: Selection state**

`Set<string>` in `all-tasks-tab.tsx` — **not** in the URL. Shift-click extends
from the last clicked row within the rendered order. Clear it when the grouping
or filters change, since the rows underneath are no longer the ones that were
selected.

- [ ] **Step 2: The bar**

```typescript
export function BulkBar({
  count,
  members,
  labels,
  onApply,
  onClear,
}: {
  count: number;
  members: { id: string; name: string }[];
  labels: Label[];
  /** Resolves once every write has settled. */
  onApply: (patch: BulkPatch) => Promise<void>;
  onClear: () => void;
}) { … }

export interface BulkPatch {
  status?: TaskStatus;
  priority?: TaskPriority;
  assigneeIds?: string[];
  labelIds?: string[];
  dueDate?: string | null;
}
```

No delete and no move-to-module. Deleting a parent now takes its subtasks with
it, so a bulk delete could destroy far more than the selected rows.

- [ ] **Step 3: Apply honestly**

There is no batch RPC and this sub-project adds none, so applying to N tasks is N
sequential `UpdateTask` calls. Some can fail.

```typescript
async function applyBulk(patch: BulkPatch) {
  const ids = [...selected];
  const failed: string[] = [];
  for (const id of ids) {
    try {
      await update.mutateAsync({ id, ...toUpdateInput(patch) });
    } catch {
      failed.push(id);
    }
  }
  if (failed.length === 0) {
    toast.success(`${ids.length} task${ids.length === 1 ? "" : "s"} updated`);
    setSelected(new Set());
    return;
  }
  // Report what actually happened and keep the failures selected so they can be
  // retried. A blanket "Saved" over a partial write would make people trust a
  // change that did not happen.
  toast.error(
    `${ids.length - failed.length} of ${ids.length} updated, ${failed.length} failed`,
  );
  setSelected(new Set(failed));
}
```

`toUpdateInput` maps `BulkPatch` to the RPC's shape — remember `assigneeIds` and
`labelIds` are `StringList` wrappers (`{ values: [...] }`), and that an absent
wrapper means "unchanged" while an empty one means "clear". Only send the fields
the patch actually sets.

- [ ] **Step 4: Gate + commit**

```bash
bun run tsc --noEmit && bun run lint && bun run build
git add apps/frontend/src/features/tasks
git commit -m "feat(tasks): bulk edit a selection, reporting partial failures"
```

---

## Task 8: Palette commands

**Files:** `src/features/search/commands.ts` (create), `search-overlay.tsx`

- [ ] **Step 1: The command list**

```typescript
export interface Command {
  id: string;
  label: string;
  group: "View" | "Navigate";
  run: () => void;
}
```

A pure builder takes the current context (are we on a project task tab? which
project?) plus callbacks, and returns the applicable commands: switch to
List/Board, group by each axis, filter to mine, filter to overdue, clear filters,
and jump to each tab of the current project.

Nothing mutates data. A mis-fire changes what you are looking at, never what is
stored.

- [ ] **Step 2: Merge into the overlay**

Add commands as one more row source **above** search results.

Three things in that file were hard-won in sub-project 1 and must survive: the
fixed group order, the controlled `value`/`onValueChange` selection (without it
Enter does nothing after the query changes), and `shouldFilter={false}`. Since
cmdk's own filtering is off, **commands must be filtered by your own matching**
against the query — they will not filter themselves.

Include commands in `orderedValues` so arrow-key navigation crosses commands and
results as one list, and the first row is selected when the set changes.

- [ ] **Step 3: Gate + commit**

```bash
bun run tsc --noEmit && bun run lint && bun run build
git add apps/frontend/src/features/search
git commit -m "feat(search): add view and navigation commands to the palette"
```

---

## Task 9: Frontend gate

- [ ] **Step 1**

```bash
cd apps/frontend
bun run tsc --noEmit && bun run lint && bun run build
```

Clean, no new lint errors. Commit `routeTree.gen.ts` if the build changed it.

- [ ] **Step 2: Confirm the backend really was untouched**

```bash
git diff --name-only origin/main...HEAD -- apps/backend-rs | wc -l
```

Expected: `0`. A non-zero count means something in this sub-project reached for
the backend, which the spec forbids — stop and report it rather than committing.

---

## Task 10: Browser pass

The two previous sub-projects each shipped bugs past every automated gate and two
rounds of review. This task is why they were caught.

**You need a signed-in session. If you do not have one, stop and ask — do not type a password into a login form.**

- [ ] **Step 1: Start the app**

Backend on :3010, frontend on :3001. If a port is taken by someone else's
process, do not kill it — run yours elsewhere and point the dev server at it with
`VITE_TASKS_RS_BASE_URL`.

- [ ] **Step 2: Walk it**

1. Open the tab with no params. It looks and behaves exactly as before: modules in order, subtasks indented, progress counts, blocked badges, drag between modules.
2. Switch to Board. Status columns appear, including empty ones.
3. Group by assignee. Columns become people plus "Unassigned". A task with two assignees appears in both.
4. Drag that two-assignee card into one person's column. A confirm appears; accept, and it leaves the other column.
5. Drag a single-assignee card. No confirm.
6. Filter to overdue, switch List/Board — the filter survives the switch.
7. **Paste `?assignee=310` (unquoted, one value) into the address bar.** It must actually filter. This is the parsing trap that shipped once already.
8. Select rows spanning two groups, bulk-set a status, confirm the count in the toast.
9. Force a partial failure (a filter that includes a task you lack rights to, or stop the backend mid-apply) and confirm the message reports the real numbers and leaves failures selected.
10. `Cmd+K` → "Group by assignee" → the URL and view change. Arrow keys still move the selection; Enter still activates the highlighted row.
11. Open a task from the board; `?task=` still works and Back still closes it.

- [ ] **Step 3: Report**

Anything not behaving as described is a finding, not a nuisance. Report what you did and what happened.
