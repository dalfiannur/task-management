# Visual Redesign — Phase 3a (Projects & Tasks) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the Projects and Tasks routes — the two highest-traffic surfaces in the app — to the design language locked by the approved Dashboard reference.

**Architecture:** Phases 0–2 fixed the token layer and every shared `ui/` primitive. What remains is feature-level composition: rows that still carry their own radius inside rounded cards, badges that are not yet pills, bare `border` utilities that should be `--border-subtle`, dates that should be `.text-num`, and one hover style that has been dead since the card went borderless.

**Tech Stack:** Vite · React 19 · Tailwind CSS v4 · TanStack Router/Query · dnd-kit · Radix UI

**Spec:** `docs/superpowers/specs/2026-08-11-visual-redesign-design.md`
**Prior plans:** `…-phase-0-1.md` (complete, approved) · `…-phase-2.md` (complete)

---

## Why Phase 3 is split

Spec §5 defines Phase 3 as a single route-by-route sweep. In practice that is 39 components across 10 domains, and they do not all need the same kind of work:

| Sub-phase | Scope | Character |
|---|---|---|
| **3a — this plan** | `features/projects`, `features/tasks` | Pattern application with exact known edits |
| **3b — Timeline** | `features/timeline` (Gantt) | **Needs a design decision first, not a plan.** See below. |
| **3c — Supporting routes** | members, media, pages, comments, labels, notifications, auth forms, `my-tasks-view` | Mechanical, same patterns as 3a |

**3b is deliberately not planned.** Spec §7 flags the Gantt chart as the place where soft-dominant density fights hardest, and §5 says its treatment should be "decided when reached rather than pre-specified". A Gantt is inherently dense and industrial; deciding whether it gets a locally tighter treatment — or whether the soft language bends around it — is a design call for the user, not something to invent inside an implementation plan. It gets its own brainstorm.

**3c is straightforward** once 3a lands, because 3a establishes the feature-level patterns that 3c replicates.

## Testing reality

**No test framework, and none is to be added.** Four gates, as in every prior phase:

1. `node scripts/check-contrast.mjs` — exit 0
2. `grep` — no colour literal or `--glass-` in `components/ui/*.module.css`
3. `bun run tsc --noEmit`, `bun run lint`, `bunx vite build` — all exit 0
4. Human visual review at the gate, both themes

## Working-tree hygiene — applies to every task

**Never run `git restore`, `git checkout -- <path>`, `git reset`, `git clean`, or `git stash`.** A subagent previously ran one of these on an unrelated file and permanently destroyed uncommitted user work.

`git status` shows an untracked file under `apps/backend-rs/`. It is expected and unrelated — **ignore it**. Stage only the paths named in each commit step. Never `git add -A`, `git add .`, or `git commit -a`.

## The four patterns this phase applies

Every edit below is an instance of one of these. They are stated once here so the reasoning is not repeated in each task.

1. **A row inside a card has no radius of its own.** Nested rounding produces a visible double curve at the corners. The container clips (`overflow-hidden`); rows are square and separated by `border-border-subtle`.
2. **Row padding is `px-4 py-3`,** matching the Dashboard reference, and hover is `bg-surface-hover` — not `bg-surface-sunken/40`, which is an un-measured alpha composite.
3. **Every date, count and duration takes `.text-num`.** This is industrial signal #1 and the reason `Google Sans Mono` is loaded at all.
4. **`border` and `border-border` are almost never right at feature level.** A divider inside a card is `border-border-subtle`; a control or panel boundary is `border-border-strong`.

## File map

| Path | Change | Task |
|---|---|---|
| `features/tasks/components/task-row.tsx` | row geometry, `.text-num` date | 1 |
| `features/tasks/components/task-badges.tsx` | badges become pills | 2 |
| `features/tasks/components/module-section.tsx` | card container, hairline header/footer, mono count | 3 |
| `features/tasks/components/task-dialog.tsx` | one stray divider → `--border-subtle` | 3 |
| `features/tasks/components/all-tasks-tab.tsx` | skeleton radius, empty state | 4 |
| `features/tasks/components/assignee-picker.tsx` | menu item radius, avatar ring surface | 5 |
| `features/projects/components/project-card.tsx` | dead hover → elevation, `.text-num` range | 6 |
| `features/projects/components/project-list.tsx` | filters → segmented control | 7 |
| `features/projects/components/project-detail-header.tsx` | drop the hard rule | 8 |

**Audited and needing no change** — verified while writing this plan. These compose already-styled primitives and carry no surface, border, radius or shadow utilities of their own. Do not open them looking for work:

| File | Why |
|---|---|
| `projects/project-shell.tsx` | Layout only |
| `projects/tab-placeholder.tsx` | Layout only |
| `projects/project-status-badge.tsx` | Delegates entirely to the `Badge` primitive, finished in Phase 2 |
| `projects/create-project-dialog.tsx` | Composes `Dialog` + `Input` + `Button`, all finished |
| `projects/transfer-ownership-dialog.tsx` | Same |
| `tasks/module-dialog.tsx` | Same |
| `tasks/config.ts` | Colour pairings already token-based and measured |

`tasks/task-dialog.tsx` is the one near-exception: a single stray `border-t`, folded into Task 3.

---

### Task 1: Task row geometry and mono date

**Files:** Modify `src/features/tasks/components/task-row.tsx`

- [ ] **Step 1: Row geometry**

Replace:

```tsx
        "group flex items-center gap-2 rounded-md border-b px-2 py-2 last:border-b-0 hover:bg-surface-sunken/40",
```

with:

```tsx
        "group flex items-center gap-2 border-b border-border-subtle px-4 py-3 last:border-b-0",
        "transition-colors [transition-duration:var(--duration-fast)] hover:bg-surface-hover",
```

`rounded-md` is dropped — these rows sit inside a card that already provides the rounding. `bg-surface-sunken/40` becomes `bg-surface-hover`, which is the token that exists for this and is measured.

- [ ] **Step 2: Mono due date**

Replace:

```tsx
        {task.dueDate && (
          <span className="text-xs text-text-muted">{task.dueDate}</span>
        )}
```

with:

```tsx
        {task.dueDate && (
          <span className="text-num text-xs text-text-muted">
            {task.dueDate}
          </span>
        )}
```

- [ ] **Step 3: Gates**

```bash
bun run tsc --noEmit && bun run lint && bunx vite build --logLevel error
```

Expected: all exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/features/tasks/components/task-row.tsx
git commit -m "feat(tasks): task row adopts the reference row geometry

Loses its own radius — nested rounding inside a rounded card produces a
double curve at the corners. px-4 py-3 and --border-subtle hairlines match
the dashboard reference, and hover moves to --surface-hover instead of an
unmeasured alpha composite of --surface-sunken.

Due date takes .text-num."
```

---

### Task 2: Status and priority badges become pills

Spec §3.3 makes badges `--radius-full`; §4.6 confirms. `StatusBadge` is still `rounded-sm`.

**Files:** Modify `src/features/tasks/components/task-badges.tsx`

- [ ] **Step 1: Pill geometry**

Replace:

```tsx
        "inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs font-medium",
```

with:

```tsx
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium",
```

Horizontal padding grows from `1.5` to `2.5` because a pill needs more inset than a near-square chip for the text to sit optically centred.

- [ ] **Step 2: Leave `PriorityLabel` alone**

`PriorityLabel` renders bare text with no background, so it has no geometry to change. Confirm by reading that you did not touch it.

**Do not touch `src/features/tasks/config.ts`.** Its colour pairings are already token-based and measured — the comment at the top records that. Only the geometry in `task-badges.tsx` changes.

- [ ] **Step 3: Gates**

```bash
bun run tsc --noEmit && bun run lint && bunx vite build --logLevel error
```

Expected: all exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/features/tasks/components/task-badges.tsx
git commit -m "feat(tasks): status badges become pills

Spec 3.3/4.6 — badges are --radius-full. Padding grows to 2.5 so the label
sits optically centred in a pill rather than a near-square chip.

config.ts is untouched: its colour pairings are already measured."
```

---

### Task 3: Module section — card container with hairline structure

**Files:** Modify `src/features/tasks/components/module-section.tsx`

- [ ] **Step 1: Container becomes a card that clips its rows**

Replace:

```tsx
    <section className="rounded-lg border">
```

with:

```tsx
    <section className="overflow-hidden rounded-xl bg-surface-raised shadow-2">
```

`overflow-hidden` is required so the square rows do not paint over the rounded corners.

- [ ] **Step 2: Header rule becomes a hairline, and the count goes mono**

Replace:

```tsx
      <header className="flex items-center gap-2 border-b px-3 py-2">
        <h3 className="font-medium">{module.name}</h3>
        <span className="text-xs text-text-muted">{tasks.length}</span>
```

with:

```tsx
      <header className="flex items-center gap-2 border-b border-border-subtle px-4 py-2">
        <h3 className="font-medium">{module.name}</h3>
        <span className="text-num text-xs text-text-muted">{tasks.length}</span>
```

`px-3` becomes `px-4` so the header lines up with the task rows below it, and the task count takes `.text-num`.

- [ ] **Step 3: Footer rule becomes a hairline**

Replace:

```tsx
      <form onSubmit={addTask} className="flex items-center gap-2 border-t px-3 py-2">
```

with:

```tsx
      <form
        onSubmit={addTask}
        className="flex items-center gap-2 border-t border-border-subtle px-4 py-2"
      >
```

- [ ] **Step 4: Empty-state padding matches the rows**

Replace:

```tsx
          <p className="px-2 py-3 text-sm text-text-muted">No tasks yet.</p>
```

with:

```tsx
          <p className="px-4 py-3 text-sm text-text-muted">No tasks yet.</p>
```

- [ ] **Step 5: Row container loses its padding**

Replace:

```tsx
      <div ref={setNodeRef} className="min-h-[0.5rem] px-2 py-1">
```

with:

```tsx
      <div ref={setNodeRef} className="min-h-[0.5rem]">
```

The rows now carry their own `px-4`, so the wrapper's padding would double-inset them and stop the hairlines reaching the card edge.

- [ ] **Step 6: Task dialog separator**

While in the tasks feature, fix the one stray rule in `src/features/tasks/components/task-dialog.tsx`. Replace:

```tsx
            <div className="my-2 border-t" />
```

with:

```tsx
            <div className="my-2 border-t border-border-subtle" />
```

This is a divider inside a dialog panel — `--border-subtle`'s exact job. It is the only styled line in that file.

- [ ] **Step 7: Gates**

```bash
bun run tsc --noEmit && bun run lint && bunx vite build --logLevel error
```

Expected: all exit 0.

- [ ] **Step 8: Commit**

```bash
git add src/features/tasks/components/module-section.tsx src/features/tasks/components/task-dialog.tsx
git commit -m "feat(tasks): module section becomes a clipping card

Card container with --border-subtle hairlines on the header and quick-add
rows. The row wrapper loses its padding because the rows now carry px-4
themselves — otherwise they double-inset and the hairlines stop reaching
the card edge."
```

---

### Task 4: All-tasks tab — skeletons and empty state

**Files:** Modify `src/features/tasks/components/all-tasks-tab.tsx`

- [ ] **Step 1: Skeleton radius matches the card**

Replace both occurrences:

```tsx
        <Skeleton className="h-24 w-full rounded-lg" />
        <Skeleton className="h-24 w-full rounded-lg" />
```

with:

```tsx
        <Skeleton className="h-24 w-full rounded-xl shadow-2" />
        <Skeleton className="h-24 w-full rounded-xl shadow-2" />
```

Cards are `--radius-xl` with `--shadow-2`; a skeleton standing in for one should match, or the layout visibly jumps when data arrives.

- [ ] **Step 2: Empty state stops being a dashed box**

Replace:

```tsx
        <div className="rounded-lg border border-dashed p-12 text-center text-text-muted">
```

with:

```tsx
        <div className="rounded-xl bg-surface-raised p-12 text-center text-text-muted shadow-2">
```

A dashed border is a different visual language from everything else in the app — the governing rule is that content sits on a white card, and an empty state is content.

- [ ] **Step 3: Gates**

```bash
bun run tsc --noEmit && bun run lint && bunx vite build --logLevel error
```

Expected: all exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/features/tasks/components/all-tasks-tab.tsx
git commit -m "feat(tasks): all-tasks skeletons and empty state match the card

Skeletons take the card's radius and elevation so the layout does not jump
when data arrives. The dashed-border empty state becomes a card — a dashed
outline is a visual language this design does not otherwise use."
```

---

### Task 5: Assignee picker — menu geometry and avatar ring

**Files:** Modify `src/features/tasks/components/assignee-picker.tsx`

- [ ] **Step 1: Menu item radius**

Replace:

```tsx
                    className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-surface-sunken"
```

with:

```tsx
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors [transition-duration:var(--duration-fast)] hover:bg-surface-hover"
```

`rounded-lg` matches the menu panel it sits in, and `--surface-hover` is the hover token — `--surface-sunken` is a *fill* token for controls and wells, not a hover state.

- [ ] **Step 2: Avatar overflow ring picks the right surface**

Replace:

```tsx
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-surface-sunken text-xs ring-1 ring-surface">
```

with:

```tsx
        <span className="text-num flex h-5 w-5 items-center justify-center rounded-full bg-surface-sunken text-xs ring-1 ring-surface-raised">
```

Two changes: the ring separates overlapping avatars from the surface *behind* them, which inside a task row is `--surface-raised`, not the page tint — the same correction applied to `avatar.module.css` in Phase 2. And the overflow chip renders a count (`+3`), so it takes `.text-num`.

- [ ] **Step 3: Gates**

```bash
bun run tsc --noEmit && bun run lint && bunx vite build --logLevel error
```

Expected: all exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/features/tasks/components/assignee-picker.tsx
git commit -m "feat(tasks): assignee picker menu and avatar ring

Menu items take the panel's 12px radius and --surface-hover; --surface-sunken
is a control fill, not a hover state. The overflow ring rings against
--surface-raised, matching the avatar fix in phase 2, and its count takes
.text-num."
```

---

### Task 6: Project card — dead hover and mono date range

**Files:** Modify `src/features/projects/components/project-card.tsx`

- [ ] **Step 1: Replace the dead hover with elevation**

Replace:

```tsx
      <Card className="h-full transition-colors hover:border-brand/50">
```

with:

```tsx
      <Card className="h-full transition-shadow [transition-duration:var(--duration-fast)] [transition-timing-function:var(--ease-out)] hover:shadow-3">
```

**`hover:border-brand/50` has been a no-op since Phase 1**, which made `Card` borderless — there is no border left to colour. Spec §4.2 specifies `--shadow-3` for an interactive card on hover, and this is the app's only interactive card.

- [ ] **Step 2: Mono date range**

Replace:

```tsx
          {range && (
            <p className="text-xs text-text-muted">{range}</p>
          )}
```

with:

```tsx
          {range && <p className="text-num text-xs text-text-muted">{range}</p>}
```

- [ ] **Step 3: Gates**

```bash
bun run tsc --noEmit && bun run lint && bunx vite build --logLevel error
```

Expected: all exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/features/projects/components/project-card.tsx
git commit -m "fix(projects): project card hover lifts instead of colouring a border

hover:border-brand/50 has done nothing since the card became borderless in
phase 1. Spec 4.2 gives an interactive card --shadow-3 on hover, and this
is the app's only interactive card.

Date range takes .text-num."
```

---

### Task 7: Project filters become a segmented control

The filter group is hand-rolled: a bordered track with a `--brand`-filled active button. The app now has one segmented-control pattern — sunken track, raised pill — used by the `Tabs` primitive and the project tab nav. A third variant here reads as a different control doing the same job.

**Files:** Modify `src/features/projects/components/project-list.tsx`

- [ ] **Step 1: Track becomes sunken and pill-shaped**

Replace:

```tsx
          <div className="inline-flex rounded-md border border-border p-1">
```

with:

```tsx
          <div className="inline-flex gap-1 rounded-full bg-surface-sunken p-[3px]">
```

- [ ] **Step 2: Active filter becomes a raised pill**

Replace:

```tsx
                className={cn(
                  "rounded-sm px-3 py-1 text-sm",
                  "[transition:background-color_var(--duration-fast)_var(--ease-out),color_var(--duration-fast)_var(--ease-out)]",
                  filter === f.key
                    ? "bg-brand font-medium text-text-on-brand"
                    : "text-text-muted hover:text-text",
                )}
```

with:

```tsx
                className={cn(
                  "rounded-full px-3 py-1 text-sm",
                  "[transition:background-color_var(--duration-fast)_var(--ease-out),color_var(--duration-fast)_var(--ease-out)]",
                  filter === f.key
                    ? "bg-surface-raised font-medium text-text shadow-1"
                    : "text-text-muted hover:text-text",
                )}
```

These are real `<button>` elements with a ternary, not TanStack `<Link>`s with `activeProps` — so the class-collision bug that affected the nav components does not apply here. The ternary produces exactly one branch's classes.

- [ ] **Step 3: Gates**

```bash
bun run tsc --noEmit && bun run lint && bunx vite build --logLevel error
```

Expected: all exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/features/projects/components/project-list.tsx
git commit -m "feat(projects): filters adopt the segmented control pattern

Sunken track, raised white active pill — matching the Tabs primitive and
the project tab nav. A brand-filled active button was a third variant of a
control the app already renders two other ways.

These are plain buttons with a ternary, so the activeProps class-collision
that affected the nav components does not apply."
```

---

### Task 8: Project detail header — drop the hard rule

**Files:** Modify `src/features/projects/components/project-detail-header.tsx`

- [ ] **Step 1: Remove the border**

Replace:

```tsx
    <div className="flex flex-wrap items-start justify-between gap-4 border-b px-6 py-4">
```

with:

```tsx
    <div className="flex flex-wrap items-start justify-between gap-4 px-6 py-4">
```

The chrome decision (spec §2) is that nothing separates regions with a rule — the tinted canvas and the segmented control below already do the separating. This `border-b` is the last hard edge on the project route, and it now sits directly above a segmented control that was specifically designed to need no band behind it.

- [ ] **Step 2: Mono date range**

Find the line rendering the date range:

```tsx
          {range && <span>· {range}</span>}
```

and replace with:

```tsx
          {range && <span className="text-num">· {range}</span>}
```

- [ ] **Step 3: Gates**

```bash
bun run tsc --noEmit && bun run lint && bunx vite build --logLevel error
```

Expected: all exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/features/projects/components/project-detail-header.tsx
git commit -m "feat(projects): detail header drops its rule

The last hard edge on the project route, sitting directly above a segmented
control designed to need no band behind it. Date range takes .text-num."
```

---

### Task 9: Phase 3a gate

**STOP.** Ends with a human review. Do not start 3b or 3c.

- [ ] **Step 1: All automated gates**

```bash
node scripts/check-contrast.mjs && \
grep -lE 'rgba\(|rgb\(|hsl\(|#[0-9a-fA-F]{3,6}|--glass' src/components/ui/*.module.css; \
bun run tsc --noEmit && bun run lint && bunx vite build --logLevel error
```

Expected: contrast exits 0 · grep prints **nothing** · tsc, lint, build all exit 0.

- [ ] **Step 2: Visual review, both themes**

```bash
bun run dev
```

At `http://localhost:3001`, on the Projects list and a project's Tasks tab:

- [ ] Project cards **lift on hover** (they previously did nothing)
- [ ] Filter row is a sunken track with a raised white active pill, matching the tab nav directly below it on the detail page
- [ ] Task rows are square inside a rounded card, separated by hairlines, with **no double curve** at the card's corners
- [ ] Status badges are pills
- [ ] Every due date and date range renders in mono with aligned digits
- [ ] No hard rule under the project detail header
- [ ] Hovering a task row tints it with `--surface-hover`, not a washed alpha
- [ ] All of the above holds in **dark**

- [ ] **Step 3: Confirm the remaining mixed state**

Visit Timeline, Members, Media, Pages. They are 3b/3c scope and will still look unfinished — confirm they are *unfinished*, not *broken*: no invisible text, no dark panel in light mode, no unreadable control.

- [ ] **Step 4: Stop the server and hand off**

Report gate output, anything from Steps 2–3 that did not match, and any judgement calls made.

---

## Notes for the implementer

**Do not touch `features/timeline/`.** It is 3b and needs a design decision that has not been made.

**Do not touch the other feature domains** — members, media, pages, comments, labels, notifications, auth, `my-tasks-view`. They are 3c.

**`features/tasks/config.ts` is finished.** Its status and priority colour pairings are already token-based and measured; the file's own comment records this. Only geometry changes in this phase.

**If a contrast measurement fails, the token is wrong — not the test.** Never adjust `check-contrast.mjs` to make something pass.

**Comments in this codebase are in Indonesian** where they record a design reason. Match that convention when adding one.
