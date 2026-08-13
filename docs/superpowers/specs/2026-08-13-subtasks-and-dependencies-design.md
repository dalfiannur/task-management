# Subtasks & Dependencies — Flow Design

**Date:** 2026-08-13
**Status:** approved, ready for planning

## Goal

Let a task be broken into smaller tasks, and let one task record that it waits
on another — then surface the schedule conflicts that result.

This is the second of four sub-projects. The first
([search & task permalink](2026-08-12-search-and-task-permalink-design.md))
shipped; it is why a subtask needs no new indexing, permalink, or comment
plumbing here — it inherits all of it by being a Task.

It also finally answers VISION §5, "melihat jadwal proyek secara utuh (timeline)
dan mengenali bentrok sebelum menjadi masalah." Today the Gantt draws bars but
knows nothing about ordering, so it cannot recognise a conflict of any kind.

## Scope

- A task may have subtasks, exactly one level deep.
- A task may record which tasks block it (finish-to-start).
- Dependency arrows and conflict marks on the timeline.
- A blocked badge in the task list and dialog.

Out of scope, deliberately:

- Critical path, slack, auto-rescheduling.
- Dependency types other than finish-to-start.
- Cross-project dependencies.
- Status or date rollup from children to parent.
- Nesting deeper than one level.
- Converting a task into a subtask by drag-and-drop on the timeline.

## Decision: a subtask is a full Task with a parent

Not a lightweight checklist item.

The deciding factor is what a subtask inherits for free. A Task already has
assignees, dates, labels, comments, media links, an activity trail, a
`?task=` permalink, and — since the previous sub-project — a search index
entry. A checklist item would have none of that, and the first time a team
needs to assign one item to someone or give it a due date, they hit the wall.

Rejected alternatives:

- **A checklist component on the parent** (text + done). Far cheaper and touches
  the Task model not at all, but it is a dead end the moment an item needs an
  owner or a deadline.
- **Both**, checklists for trivia and real subtasks for work. Closest to how
  teams actually behave, at the cost of two concepts to explain, two UIs, and a
  permanent "should this be a checklist or a subtask?" question at every use.

## Decision: exactly one level

A task may have subtasks; a subtask may not. Jira draws the line in the same
place.

This is not only a simplicity preference — it removes whole categories of work.
No cycle detection when re-parenting, no recursive progress rollup, no
cascading-delete depth, and timeline indentation that is always exactly two
levels. In an ECS-over-Postgres store where each hierarchy level is another
round trip, unbounded nesting would be felt on every query.

If a subtask turns out to need breaking down, that is a signal it should have
been a task of its own.

## Decision: dependencies warn, they do not block

An edge A → B means "A should finish before B starts." It never prevents a
status change and never moves a date.

Rejected alternatives:

- **Blocking status changes** — B cannot enter In progress or Done while A is
  open. Guarantees plan and reality agree, but teams will hit it on a busy day
  and the only escape is deleting the dependency, which destroys exactly the
  data the feature exists to collect.
- **Auto-rescheduling** — moving A pushes B and everything behind it. Feels
  magical when right, but one drag silently rewrites dates other people agreed
  to, and undo has to restore all of them. It is also by far the largest of the
  three.

## Consequence: no cycle detection is needed

A blocks B, B blocks A. Normally this demands a graph walk on every edge added.

Here it does not, and that falls directly out of the two decisions above.
Dependencies only warn, and conflicts are computed **per edge** — compare A's
dates to B's dates and stop. Nothing ever traverses a chain, so a cycle cannot
hang, recurse, or blow a stack. Both arrows render, both directions flag a
conflict, and the user sees for themselves that it is nonsense.

The one rejection that remains is a self-dependency, which is a single equality
check.

This is worth stating explicitly because a future change to either decision —
critical path (which walks the graph) or auto-rescheduling (which propagates) —
reintroduces the need for cycle detection. Whoever picks up sub-project 4 should
read this paragraph first.

## Model

Two new components, both shaped like the existing `TaskAssignees` /
`TaskLabels`:

```rust
/// A subtask's parent. Absent = top-level task.
#[derive(PgComponent, Debug, Clone)]
pub struct TaskParent {
    #[pg(index)]
    pub parent_id: String,
}

/// Finish-to-start dependencies: tasks that should finish before this one.
#[derive(PgComponent, Debug, Clone)]
pub struct TaskBlockedBy {
    pub task_ids: Vec<String>, // JSONB, same as TaskAssignees.user_ids
}
```

Both are registered in `domain::register_all` alongside the other task
components.

### Invariants, enforced in the handler

1. **One level.** If the proposed parent itself has a `TaskParent`, reject. This
   is the only check that keeps nesting flat, so it must run on both
   `CreateTask` (with `parent_id`) and `UpdateTask` (re-parenting).
2. **A subtask lives in its parent's module.** A subtask still carries
   `TaskModuleRef` — `read_task` returns `None` without it — but its value always
   equals the parent's. `CreateTask` derives it from the parent rather than
   trusting the request; `MoveTask` on a parent moves its children too.
3. **Dependencies stay inside one project.** A `blocked_by` id whose task
   resolves to a different project is rejected. This keeps the membership guard
   one layer deep, exactly as it is today.
4. **No self-dependency.** `blocked_by` may not contain the task's own id.

### Conflict rules

For an edge A → B, two forms, both derived at render time from data that
already exists. Neither introduces a stored field, so neither can go stale:

| Form | Condition | Surfaced as |
|---|---|---|
| Schedule | `B.start_date < A.due_date` | The bar for B is marked on the timeline |
| Status | B is `in_progress` or `done` while A is not `done` | A "blocked" badge on the task row and in the dialog |

If either date is absent, no schedule conflict is computed — nothing is guessed.

## Backend contract

### Proto

All additions to `work.proto`; no existing field changes shape or number.

```proto
message Task {
  // … fields 1–15 unchanged …
  optional string parent_id = 16;
  repeated string blocked_by_ids = 17;
}

message CreateTaskRequest {
  // … fields 1–9 unchanged …
  optional string parent_id = 10;
}

message UpdateTaskRequest {
  // … fields 1–9 unchanged …
  optional StringList blocked_by_ids = 10; // absent = unchanged; present (incl. empty) = replace
  optional StringList parent_id_set = 11;  // see below
}
```

`UpdateTaskRequest` re-parenting needs three states — leave alone, set a parent,
clear the parent — which a bare `optional string` cannot express, since absent
and "clear" collapse. Reuse the `StringList` wrapper already used for
`assignee_ids`: absent means unchanged, an empty list means detach to top level,
and a one-element list means set that parent. A second element is invalid
argument.

`ListTasks` keeps returning a flat list. The frontend already loads every task
in the project, so it builds both the hierarchy and the reverse dependency index
("what do I block") in memory, at no query cost. That is what makes storing
`TaskBlockedBy` in one direction sufficient.

### Deletion

- **Deleting a parent deletes its subtasks.** Consistent with `DeleteModule`,
  which already cascades to its tasks. The confirmation names the count:
  "Delete this task and its 3 subtasks?" This is the only destructive decision
  in this design.
- **Deleting a task strips it from every `blocked_by` that referenced it.**
  Otherwise `blocked_by` accumulates ids that resolve to nothing and cannot be
  rendered. This is a scan over the project's tasks, bounded by project size.
- Both paths must route through the existing
  `work::deindex_task_and_comments`, so cascaded subtasks leave the search index
  too. That helper exists because the same oversight was already fixed once for
  module deletion; do not add a second delete path that forgets it.

### Authorization

Unchanged. Everything resolves to the owning project through the module, and
`require_member` gates it. A subtask is a task; it has no separate permission.

## Frontend

### Task list

`ModuleSection` currently sorts tasks by `order`. It now groups by parent first,
rendering subtasks indented beneath theirs, and shows a `2/3` count on any row
that has children. The count is computed during render from the already-loaded
list — no new state, no possibility of drift.

A blocked task shows a badge. Clicking it opens the dialog's dependency section.

### Task dialog

Two new sections below the description:

- **Subtasks** — the list, with an inline quick-add that creates a task with
  `parent_id` prefilled. A subtask's own dialog shows a link back to its parent.
- **Blocked by** — a picker over the project's other tasks, reusing the
  `LabelCombobox` interaction pattern. It excludes the task itself and its own
  subtasks from the options.

### Timeline

`gantt-chart.tsx` is 320 lines and already owns rows, geometry, zoom, and drag.
Dependency arrows go in as a **separate SVG overlay layer** positioned over the
same grid, not woven into bar rendering — the geometry helpers in
`timeline-utils.ts` already expose what an arrow needs (`barGeometry`,
`ROW_HEIGHT`, `PX_PER_DAY`). Keeping it a distinct layer is what stops that file
from growing into something no one can hold in their head.

Subtasks render as indented rows beneath their parent. Conflicting bars are
marked.

## Search

Subtasks are indexed automatically — they are tasks, and the write-path indexer
already fires on `CreateTask`/`UpdateTask`. No new call sites.

One small addition: `task_doc` gains the parent id so a subtask result can show
its parent as context, the same way a comment result already carries `task_id`.
That means one column on `search_doc` and one field on `SearchResult`.

## Verification

Extend `crates/transport/tests/work_flow.rs`:

- A subtask is created with its parent's module even when the request names a
  different one.
- A subtask cannot become a parent (one-level invariant), on both create and
  update.
- Re-parenting: absent leaves it alone, empty detaches to top level, two
  elements is invalid argument.
- Moving a parent to another module moves its subtasks.
- Deleting a parent deletes its subtasks.
- Deleting a task removes it from other tasks' `blocked_by`.
- A cross-project `blocked_by` is rejected; a self-dependency is rejected.
- A dependency cycle is accepted and both edges read back — proving nothing
  traverses the graph.

Extend `crates/transport/tests/search_flow.rs`:

- A subtask is findable, and its result carries the parent id.
- Deleting a parent removes both its own and its subtasks' documents.

Frontend has no test framework, so the gates stay `bun run tsc --noEmit`,
`bun run lint`, and `bun run build`. Regenerate Connect clients with
`./node_modules/.bin/buf generate` after the proto change.

The previous sub-project ended with two bugs that only appeared when the app was
driven in a browser — a URL form that silently did nothing, and a palette that
could not be operated by keyboard. Plan for a browser pass here too: create a
parent with subtasks, add a dependency, and confirm the arrow and both conflict
forms actually render.
