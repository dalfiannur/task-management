# Views & Speed — Flow Design

**Date:** 2026-08-13
**Status:** approved, ready for planning

## Goal

Let a team look at the same work from whichever angle answers today's question —
by status, by person, by priority — and act on many tasks at once instead of one
dialog at a time.

Third of four sub-projects. The first shipped global search and task permalinks;
the second shipped subtasks and dependencies. This one adds no data: every
capability here is a different arrangement of tasks that are already loaded.

VISION §2 asks that a member can "melihat, memfilter, dan memperbarui status
pekerjaan secepat mengetik — tanpa ritual pengisian yang berlebihan." Today the
only arrangement is by module, the only filter is none, and every status change
costs a dialog.

## Scope

- A List/Board view toggle on the project's task tab.
- Group-by: module, status, assignee, priority, label.
- Filters: status, assignee, label, module, overdue — where **overdue** means
  `dueDate < today && status !== "done"`, the same rule the Overview tab already
  counts by, so the two never disagree.
- All of the above encoded in the URL.
- Multi-select with a bulk action bar for field changes.
- View and navigation commands in the existing `Cmd+K` overlay.

Out of scope, deliberately:

- Named saved views stored on the server.
- Bulk delete and bulk move-to-module.
- Data-mutating commands in the palette.
- Grouping on the Timeline tab.
- Custom columns; swimlanes (two-level grouping).

**This sub-project changes no backend code.** No proto, no RPC, no component, no
migration. If a task in the plan proposes one, the plan is wrong.

## Decision: group-by is the feature; the board is one way to draw it

Not "add a kanban board."

A board is group-by-status rendered as columns. Once grouping is the primitive,
the same machinery gives grouping by assignee, priority, or label for
approximately nothing, and the List view gets it too.

Consequence worth stating plainly: **module stops being the frame and becomes an
axis like any other.** List + group-by-module is exactly today's view, so
current behaviour survives as the default preset rather than being replaced.

Rejected alternatives:

- **A separate Board tab**, always status columns. Leaves the existing tab
  untouched and is the easiest to explain, but produces two places to look at the
  same work whose filters do not carry across, and group-by never gets built.
- **Columns = modules.** Consistent with the data model and useful for
  reorganising, but it is not what anyone means by a board: it never answers
  "what is being worked on right now."

## Decision: the URL holds all of it

```
/projects/12/all-tasks?view=board&group=assignee&status=todo,in_progress&assignee=310
```

Shareable, bookmarkable, and Back restores the previous arrangement — the same
property that made `?task=` worth building, applied to the whole view.

Rejected alternatives:

- **URL plus per-project memory** (localStorage). Returning to a project would
  feel like coming back to where you left it, at the cost that a bare URL means
  something different for every person — including when one of them shares it.
  That is a bad trade for a link people paste to each other.
- **Named saved views on the server.** The only option that makes a view
  shared property, and the only one needing a new entity, four RPCs, ownership
  and permission questions, and management UI. It is its own sub-project.

Selection state is deliberately **not** in the URL. Nobody wants to send someone
a link that arrives with four rows highlighted.

### The parsing trap, already paid for once

TanStack Router parses search params with JSON semantics. `?assignee=310` arrives
as a **number**, and a `typeof value === "string"` guard drops it silently — the
exact bug that shipped in sub-project 1, where `?task=3688` looked like it did
nothing at all.

`coerceSearchParam` in `src/lib/utils.ts` already exists for this and every
scalar param here must go through it. List-valued params need a companion,
`coerceSearchList`, accepting a comma string, a bare number, or an array, and
always yielding `string[]`. Do not hand-roll per-param parsing.

## Decision: field changes only in bulk

Status, assignee, priority, label, due date. No delete, no move.

The reason is new as of the previous sub-project: deleting a parent now deletes
its subtasks. A "delete 12 selected" could therefore destroy far more than the
twelve rows on screen, and a confirmation reading "12 selected → deletes 31
tasks" is not a number anyone can weigh mid-flow. Deletion stays one at a time,
where the count is still legible.

## Grouping semantics

One pure function turns a task list into ordered groups. Three axes are
single-valued and two are not, and that difference is not a detail:

| Axis | Cardinality | Effect |
|---|---|---|
| status, priority, module | single | Each task appears exactly once |
| assignee, label | **multi** | A task with two assignees appears in **both** columns |

Appearing in both is the honest rendering — the work genuinely sits with two
people. The cost lands on drag:

**Dropping a card into a column sets the grouped field to that column's value.**
For a multi-valued axis that means assignees collapse to exactly the one dropped
into, and the card vanishes from the other column. That is information loss, so
it gets a lightweight confirm — visible once, not a silent rewrite.

This is the single place the group-by generalisation strains. It is written down
rather than smoothed over.

**Every column in the axis's domain renders, including empty ones.** Every axis
here has a known domain: the four statuses, the five priorities, the project's
members, its labels, its modules. Hiding an empty column would be worse than
noise — it would remove the drop target, making it impossible to drag a task
into an empty module or onto a label nobody has used yet. An empty column is not
clutter; on a board it is the destination.

A trailing "Unassigned" / "No label" column collects tasks with an empty
multi-valued field, and is itself a valid drop target meaning "clear this
field".

## Drag semantics

| Grouping | Drop performs |
|---|---|
| module | `MoveTask` (existing) |
| status, priority | `UpdateTask` with the new scalar |
| assignee, label | `UpdateTask` replacing the list with one value, after confirm |

`dnd-kit` is already wired: `DndContext` in `all-tasks-tab.tsx`, `useDroppable`
for module drop zones, `useSortable` on rows. Board columns reuse the same
mechanics; no new drag library, no second interaction model.

## Subtasks under grouping

A subtask is a task with its own status, so under any axis other than module it
is its own card, carrying a small chip naming its parent. Indented hierarchy
stays only in List + group-by-module, where it means something.

## Bulk edit and the cost of zero backend

Selection is component state; the action bar appears when anything is selected.

There is no batch RPC and this sub-project adds none, so "apply to 12 tasks" is
**twelve sequential `UpdateTask` calls**, and some may fail. The result must be
reported as it happened — *"9 of 12 updated, 3 failed"* — with the failures left
selected so they can be retried. A blanket "Saved" toast over a partial write
would make people trust a change that did not happen.

This is the price of the zero-backend choice, accepted deliberately. Hiding it
would not be.

## Palette

A static command list merged into the existing `Cmd+K` overlay as one more row
source above search results. Commands are contextual: view controls appear only
on a project task tab.

Nothing mutates data, so a mis-fire on a fuzzy-matched list changes what you are
looking at, never what is stored.

The overlay already has the parts this needs: fixed group order, controlled
selection (so Enter reliably activates the highlighted row), and cmdk's own
filtering disabled. All three were built and debugged in sub-project 1; adding a
row source does not disturb them.

## File structure

`all-tasks-tab.tsx` is already 294 lines. Adding a board, a toolbar, filters and
selection to it would produce a file nobody can hold in their head.

| New file | Responsibility |
|---|---|
| `features/tasks/view-state.ts` | Read/write the URL params. Pure, no hooks |
| `features/tasks/grouping.ts` | Task list → ordered groups. Pure |
| `components/view-toolbar.tsx` | View toggle, group-by, filters |
| `components/task-board.tsx` | Columns, cards, drop targets |
| `components/bulk-bar.tsx` | Selection action bar |

`all-tasks-tab.tsx` shrinks to a coordinator: read the URL, group, render List or
Board. Derived logic stays pure and checkable by reading — the same shape that
made `task-graph.ts` work in the previous sub-project, where the conflict rules
could be verified without running anything.

## Verification

The frontend has no test framework, so the gates are `bun run tsc --noEmit`,
`bun run lint`, and `bun run build`.

That is not sufficient on its own and the record says so: the last two
sub-projects each shipped bugs past all three gates plus two rounds of code
review — a URL form that silently did nothing, a palette that could not be
operated by keyboard, a delete that destroyed a subtree with no confirmation, and
a search field threaded end to end but never rendered. Every one surfaced only
when someone drove the app.

So a browser pass is a numbered task, and it must cover at least:

- Each group-by axis renders, and switching axes preserves filters.
- A URL with `?assignee=310` (unquoted, single value) actually applies — the
  parsing trap, tested directly.
- Dragging in each axis writes the right field; dragging in group-by-assignee
  shows the confirm and drops the card from the other column.
- Bulk edit across a selection spanning two groups, including a forced partial
  failure to confirm the honest count is reported.
- Palette: open, run "Group by assignee", confirm the URL and view change, and
  confirm arrow keys still move the selection.
- List + group-by-module still looks and behaves exactly as it does today.
