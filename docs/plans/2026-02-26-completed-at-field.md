# Task Completed Date Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Track when a task is marked as "done" via a `completedAt` timestamp, auto-set by the server, displayed in task detail and on the Gantt timeline.

**Architecture:** Add `completedAt` string field to the existing TaskInfo component (backend). The server automatically stamps the current time when status changes to "done" and clears it when status changes away. Frontend displays it in the task detail panel and uses it to visually distinguish on-time vs late tasks on the Gantt timeline.

**Tech Stack:** Bunsane ECS (backend), React + Apollo Client + CSS Modules (frontend)

---

### Task 1: Add `completedAt` field to backend TaskInfo component

**Files:**
- Modify: `apps/backend/src/components/TaskInfo.ts:29-31`

**Step 1: Add the field**

Add `completedAt` after the existing `updatedAt` field:

```typescript
@CompData()
completedAt: string = "";
```

**Step 2: Verify backend compiles**

Run: `cd apps/backend && bun run build`
Expected: Success

**Step 3: Commit**

```bash
git add apps/backend/src/components/TaskInfo.ts
git commit -m "feat(backend): add completedAt field to TaskInfo component"
```

---

### Task 2: Auto-set `completedAt` in TaskService mutations

**Files:**
- Modify: `apps/backend/src/services/TaskService.ts:324-332` (updateTask)
- Modify: `apps/backend/src/services/TaskService.ts:215-228` (createTask)
- Modify: `apps/backend/src/services/TaskService.ts:505-506` (reorderTask)

**Step 1: Handle `completedAt` in `updateTask`**

In `updateTask`, after line 332 (`taskInfoUpdates.updatedAt = ...`), add logic to auto-set/clear `completedAt`:

```typescript
// Auto-set completedAt when status changes to "done", clear when it changes away
if (input.status !== undefined) {
  const oldStatus = oldTaskInfo?.status;
  if (input.status === "done" && oldStatus !== "done") {
    taskInfoUpdates.completedAt = new Date().toISOString();
  } else if (input.status !== "done" && oldStatus === "done") {
    taskInfoUpdates.completedAt = "";
  }
}
```

**Step 2: Handle `completedAt` in `createTask`**

In the `archetype.fill()` call in `createTask`, add `completedAt` to the taskInfo object:

```typescript
completedAt: input.status === "done" ? now : "",
```

**Step 3: Handle `completedAt` in `reorderTask`**

In `reorderTask`, after the existing status check (line 505-506), add:

```typescript
if (input.newStatus) {
  updates.status = input.newStatus;
  // Auto-set completedAt
  const oldTaskInfo = await entity.get(TaskInfo);
  if (input.newStatus === "done" && oldTaskInfo?.status !== "done") {
    updates.completedAt = new Date().toISOString();
  } else if (input.newStatus !== "done" && oldTaskInfo?.status === "done") {
    updates.completedAt = "";
  }
}
```

**Step 4: Verify backend compiles**

Run: `cd apps/backend && bun run build`
Expected: Success

**Step 5: Commit**

```bash
git add apps/backend/src/services/TaskService.ts
git commit -m "feat(backend): auto-set completedAt on task status changes"
```

---

### Task 3: Add `completedAt` to frontend data layer

**Files:**
- Modify: `apps/frontend/src/types/task.ts:16-31` (Task interface)
- Modify: `apps/frontend/src/hooks/use-tasks.ts:13-35` (TASK_FIELDS fragment)
- Modify: `apps/frontend/src/hooks/use-tasks.ts:99-119` (TaskResponse interface)
- Modify: `apps/frontend/src/hooks/use-tasks.ts:121-151` (mapTask function)

**Step 1: Add to Task type**

In `apps/frontend/src/types/task.ts`, add to the Task interface after `updatedAt`:

```typescript
completedAt?: string;
```

**Step 2: Add to GraphQL fragment**

In `apps/frontend/src/hooks/use-tasks.ts`, add `completedAt` to the `TASK_FIELDS` fragment inside `taskInfo`:

```graphql
completedAt
```

**Step 3: Add to TaskResponse interface**

In `TaskResponse.taskInfo`, add:

```typescript
completedAt: string;
```

**Step 4: Add to mapTask**

In the `mapTask` function's return object, add:

```typescript
completedAt: t.taskInfo.completedAt || undefined,
```

**Step 5: Type-check**

Run: `cd apps/frontend && bun run tsc --noEmit`
Expected: Success

**Step 6: Commit**

```bash
git add apps/frontend/src/types/task.ts apps/frontend/src/hooks/use-tasks.ts
git commit -m "feat(frontend): add completedAt to task data layer"
```

---

### Task 4: Show `completedAt` in task detail panel

**Files:**
- Modify: `apps/frontend/src/components/tasks/task-detail.tsx:255-275` (timestamps section)

**Step 1: Add completed timestamp**

In the timestamps section (between the "Updated" timestamp and the AlertDialog), add a conditional "Completed" line when the task has `completedAt`:

```tsx
{task.completedAt && (
  <p className={styles.timestampText}>
    Completed{" "}
    {new Date(task.completedAt).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    })}
    {task.dueDate && (
      new Date(task.completedAt) <= new Date(task.dueDate)
        ? " · on time"
        : " · late"
    )}
  </p>
)}
```

**Step 2: Type-check**

Run: `cd apps/frontend && bun run tsc --noEmit`
Expected: Success

**Step 3: Commit**

```bash
git add apps/frontend/src/components/tasks/task-detail.tsx
git commit -m "feat(frontend): show completedAt in task detail panel"
```

---

### Task 5: Visual completion indicator on Gantt timeline

**Files:**
- Modify: `apps/frontend/src/components/timeline/gantt-timeline-grid.tsx:144-179` (task bar rendering)
- Modify: `apps/frontend/src/components/timeline/gantt-timeline-grid.module.css` (new styles)

**Step 1: Add completion indicator styles**

Add to `gantt-timeline-grid.module.css`:

```css
.taskBarDone {
  position: absolute;
  top: 0.375rem;
  height: 1.125rem;
  border-radius: calc(var(--radius) - 2px);
  cursor: default;
  transition: opacity 150ms;
  opacity: 0.85;
  background-image: repeating-linear-gradient(
    -45deg,
    transparent,
    transparent 3px,
    rgba(255, 255, 255, 0.15) 3px,
    rgba(255, 255, 255, 0.15) 6px
  );
}

.taskBarDone:hover {
  opacity: 0.68;
}

.taskBarLate {
  composes: taskBarDone;
  outline: 2px solid var(--destructive);
  outline-offset: -2px;
}

.tooltipStatus {
  font-size: 0.75rem;
  line-height: 1rem;
  font-family: var(--font-mono);
}

.tooltipOnTime {
  composes: tooltipStatus;
  color: #22c55e;
}

.tooltipLate {
  composes: tooltipStatus;
  color: var(--destructive);
}
```

**Step 2: Update task bar rendering**

In `gantt-timeline-grid.tsx`, update the task row rendering (around lines 144-179) to use different styles based on completion status:

```tsx
const bar = computeBarPosition(row.task, range.start);
const color = MODULE_COLORS[row.colorIndex % MODULE_COLORS.length];

const isDone = row.task.status === "done" && row.task.completedAt;
const isLate = isDone && row.task.dueDate &&
  new Date(row.task.completedAt!) > new Date(row.task.dueDate);

const barClassName = isLate
  ? styles.taskBarLate
  : isDone
    ? styles.taskBarDone
    : styles.taskBar;
```

Use `barClassName` instead of `styles.taskBar` in the JSX. Also add completion info to the tooltip:

```tsx
<TooltipContent>
  <p className={styles.tooltipTitle}>{row.task.title}</p>
  <p className={styles.tooltipDate}>
    {formatDateRange(row.task.startDate, row.task.dueDate)}
  </p>
  {isDone && (
    <p className={isLate ? styles.tooltipLate : styles.tooltipOnTime}>
      {isLate ? "Completed late" : "Completed on time"}
    </p>
  )}
</TooltipContent>
```

**Step 3: Type-check and lint**

Run: `cd apps/frontend && bun run tsc --noEmit && bun run lint`
Expected: Success

**Step 4: Commit**

```bash
git add apps/frontend/src/components/timeline/gantt-timeline-grid.tsx apps/frontend/src/components/timeline/gantt-timeline-grid.module.css
git commit -m "feat(frontend): add completion indicators on Gantt timeline"
```

---

### Task 6: Final verification

**Step 1: Full build check**

Run: `cd apps/backend && bun run build && cd ../frontend && bun run build`
Expected: Both succeed

**Step 2: Commit all (if any remaining changes)**

Squash or final commit if needed.
