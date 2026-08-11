# Visual Redesign — Phase 3c (Supporting Routes) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the redesign by applying the established patterns to the remaining feature routes.

**Architecture:** No new decisions. Every edit here is an instance of a pattern already locked by the Dashboard reference (Phase 1), the primitives (Phase 2), and the Projects/Tasks/Timeline sweeps (3a/3b). This is the last phase.

**Tech Stack:** Vite · React 19 · Tailwind CSS v4 · TanStack Router/Query · Radix UI

**Spec:** `docs/superpowers/specs/2026-08-11-visual-redesign-design.md`
**Prior plans:** `…-phase-0-1.md` · `…-phase-2.md` · `…-phase-3a.md` · `…-phase-3b.md` — all complete

---

## Scope

**In:** `features/members`, `features/media`, `features/pages`, `features/comments`, `features/labels`, `features/notifications`, and `features/dashboard/components/my-tasks-view.tsx` (which renders the `/my-tasks` route, not the Dashboard).

**Audited and needing no change** — verified while writing this plan, do not open them looking for work:

| File | Why |
|---|---|
| `auth/login-form.tsx` | No surface, border, radius or shadow utilities. Composes `Card` + `Input` + `Button`, all finished. |
| `auth/register-form.tsx` | Same. |
| `auth/app-shell.tsx` | Finished in Phase 1. |
| `comments/comment-composer.tsx` | Composes the rich-text editor and `Button`. |
| ~~`pages/page-editor.tsx`~~ | **This audit entry was wrong.** It has a bare `border-b` toolbar divider, fixed after the gate. |
| `members/add-member-dialog.tsx` | Composes `Dialog` + `Input` + `Button`. |

## The patterns being applied

All four are established. None is new.

1. **A container holding a list is a card** — `rounded-xl bg-surface-raised shadow-2`, `overflow-hidden` if the rows are square.
2. **`bg-surface-sunken/NN` is never right.** It is an unmeasured alpha composite. Hover is `bg-surface-hover`; a selected/tinted band is full `bg-surface-sunken`.
3. **`border` / `border-border` at feature level** is almost always `border-border-subtle` (divider inside a card) or `border-border-strong` (control or panel boundary).
4. **Every count, size and date takes `.text-num`.** Section headings take `.text-label`.

## Testing reality

**No test framework, and none is to be added.** The four gates, as in every prior phase.

## Working-tree hygiene — applies to every task

**Never run `git restore`, `git checkout -- <path>`, `git reset`, `git clean`, or `git stash`.** A subagent previously ran one of these on an unrelated file and permanently destroyed uncommitted user work.

`git status` shows an untracked file under `apps/backend-rs/`. Expected and unrelated — **ignore it**. Stage only the paths named in each commit step. Never `git add -A`, `git add .`, or `git commit -a`.

**A dev server is running on port 3001. Do not start, stop or restart any server.**

---

### Task 1: My-tasks view — the fourth segmented control

**File:** `src/features/dashboard/components/my-tasks-view.tsx`

This is the **fourth** hand-rolled variant of a control the app now renders one way. The others were unified in Phases 2, 3a and 3b.

- [ ] **Step 1: Filter group becomes the segmented control**

Replace:

```tsx
        <div className="inline-flex rounded-md border border-border p-1">
```

with:

```tsx
        <div className="inline-flex gap-1 rounded-full bg-surface-sunken p-[3px]">
```

and replace:

```tsx
                "rounded-sm px-3 py-1 text-sm",
                "[transition:background-color_var(--duration-fast)_var(--ease-out),color_var(--duration-fast)_var(--ease-out)]",
                view === v.key
                  ? "bg-brand font-medium text-text-on-brand"
                  : "text-text-muted hover:text-text",
```

with:

```tsx
                "rounded-full px-3 py-1 text-sm",
                "[transition:background-color_var(--duration-fast)_var(--ease-out),color_var(--duration-fast)_var(--ease-out)]",
                view === v.key
                  ? "bg-surface-raised font-medium text-text shadow-1"
                  : "text-text-muted hover:text-text",
```

- [ ] **Step 2: Task list becomes a card**

Replace:

```tsx
          <div className="overflow-hidden rounded-lg border border-border">
```

with:

```tsx
          <div className="overflow-hidden rounded-xl bg-surface-raised shadow-2">
```

`MyTaskRow` already carries the reference row geometry from Phase 1, so it drops straight in.

- [ ] **Step 3: Count goes mono**

Replace:

```tsx
          <p className="mb-3 text-sm text-text-muted">{total} task(s)</p>
```

with:

```tsx
          <p className="mb-3 text-sm text-text-muted">
            <span className="text-num">{total}</span> task(s)
          </p>
```

Only the number is mono — wrapping the whole sentence would render "task(s)" in a monospace face.

- [ ] **Step 4: Gates**

```bash
bun run tsc --noEmit && bun run lint && bunx vite build --logLevel error
```

Expected: all exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/features/dashboard/components/my-tasks-view.tsx
git commit -m "feat(my-tasks): segmented control, card list, mono count

The fourth hand-rolled variant of the segmented control; the other three
were unified in phases 2, 3a and 3b. The task list becomes a card —
MyTaskRow already carries the reference row geometry.

Only the number takes .text-num, not the whole sentence."
```

---

### Task 2: Notification panel

**File:** `src/features/notifications/components/notification-bell.tsx`

- [ ] **Step 1: Panel header divider**

Replace:

```tsx
        <div className="flex items-center justify-between border-b px-3 py-2">
```

with:

```tsx
        <div className="flex items-center justify-between border-b border-border-subtle px-3 py-2">
```

- [ ] **Step 2: Items get hairlines and a real hover token**

Replace:

```tsx
                    "flex w-full items-start gap-2 border-b px-3 py-2.5 text-left last:border-b-0 hover:bg-surface-sunken/50",
```

with:

```tsx
                    "flex w-full items-start gap-2 border-b border-border-subtle px-3 py-2.5 text-left transition-colors [transition-duration:var(--duration-fast)] last:border-b-0 hover:bg-surface-hover",
```

- [ ] **Step 3: Gates**

```bash
bun run tsc --noEmit && bun run lint && bunx vite build --logLevel error
```

Expected: all exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/features/notifications/components/notification-bell.tsx
git commit -m "feat(notifications): panel dividers and hover use tokens

--border-subtle hairlines inside the popover, and --surface-hover in place
of a surface-sunken/50 alpha composite."
```

---

### Task 3: Media tab

**File:** `src/features/media/components/media-tab.tsx`

- [ ] **Step 1: Empty state becomes a card**

Replace:

```tsx
        <div className="rounded-lg border border-dashed p-12 text-center text-text-muted">
```

with:

```tsx
        <div className="rounded-xl bg-surface-raised p-12 text-center text-text-muted shadow-2">
```

- [ ] **Step 2: File tiles become cards**

Replace:

```tsx
                className="group flex items-center gap-3 rounded-lg border p-3"
```

with:

```tsx
                className="group flex items-center gap-3 rounded-xl bg-surface-raised p-3 shadow-2"
```

These are standalone tiles in a grid, not rows in a list, so each is its own card.

- [ ] **Step 3: Skeletons match the tiles**

Replace:

```tsx
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
```

with:

```tsx
            <Skeleton key={i} className="h-16 w-full rounded-xl shadow-2" />
```

- [ ] **Step 4: File size goes mono**

Replace:

```tsx
                  <p className="text-xs text-text-muted">
                    {formatBytes(f.size)}
                  </p>
```

with:

```tsx
                  <p className="text-num text-xs text-text-muted">
                    {formatBytes(f.size)}
                  </p>
```

- [ ] **Step 5: Gates**

```bash
bun run tsc --noEmit && bun run lint && bunx vite build --logLevel error
```

Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/features/media/components/media-tab.tsx
git commit -m "feat(media): file tiles and empty state become cards

Tiles are standalone items in a grid rather than rows in a list, so each
is its own card. The dashed empty state goes, and file sizes take
.text-num."
```

---

### Task 4: List-item hover across pages and labels

Three files share one defect: `hover:bg-surface-sunken/50`, an unmeasured alpha composite where `--surface-hover` exists.

**Files:**
- Modify: `src/features/pages/components/pages-tab.tsx`
- Modify: `src/features/labels/components/label-combobox.tsx`
- Modify: `src/features/labels/components/manage-labels-dialog.tsx`

- [ ] **Step 1: Pages list**

Replace:

```tsx
                    "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm",
                    p.id === selectedId ? "bg-surface-sunken" : "hover:bg-surface-sunken/50",
```

with:

```tsx
                    "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm",
                    "transition-colors [transition-duration:var(--duration-fast)]",
                    p.id === selectedId
                      ? "bg-surface-sunken font-medium"
                      : "hover:bg-surface-hover",
```

The selected page keeps the full `--surface-sunken` tint and gains `font-medium`, so selection is not carried by colour alone.

- [ ] **Step 2: Label combobox items**

There are **two** occurrences in `label-combobox.tsx` of `rounded-sm px-2 py-1.5 text-sm` with a `hover:bg-surface-sunken`. Replace:

```tsx
                      className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-surface-sunken"
```

with:

```tsx
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors [transition-duration:var(--duration-fast)] hover:bg-surface-hover"
```

and replace:

```tsx
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-text-muted hover:bg-surface-sunken"
```

with:

```tsx
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-text-muted transition-colors [transition-duration:var(--duration-fast)] hover:bg-surface-hover"
```

- [ ] **Step 3: Label combobox footer divider**

Replace:

```tsx
          <div className="border-t pt-1">
```

with:

```tsx
          <div className="border-t border-border-subtle pt-1">
```

- [ ] **Step 4: Manage-labels rows and wells**

Replace:

```tsx
    <li className="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-surface-sunken/50">
```

with:

```tsx
    <li className="group flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors [transition-duration:var(--duration-fast)] hover:bg-surface-hover">
```

Then replace **both** occurrences of the bordered well:

```tsx
      <li className="space-y-2 rounded-md border p-2">
```

with:

```tsx
      <li className="space-y-2 rounded-lg bg-surface-sunken p-3">
```

and:

```tsx
        <div className="space-y-2 rounded-md border p-2">
```

with:

```tsx
        <div className="space-y-2 rounded-lg bg-surface-sunken p-3">
```

These are editing wells inside a dialog. A sunken fill is how this design marks an editable region; a border around it inside an already-bordered panel is the seam the redesign has been removing.

- [ ] **Step 5: Gates**

```bash
bun run tsc --noEmit && bun run lint && bunx vite build --logLevel error
```

Expected: all exit 0.

- [ ] **Step 6: Confirm no alpha composites remain anywhere in features**

```bash
grep -rn "surface-sunken/\|surface-hover/\|border-text/" src/features/
```

Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add src/features/pages/components/pages-tab.tsx src/features/labels/components/label-combobox.tsx src/features/labels/components/manage-labels-dialog.tsx
git commit -m "feat(pages,labels): list hovers and editing wells use tokens

Removes the last surface-sunken/NN alpha composites in the codebase.
Hover is --surface-hover; the selected page keeps a full --surface-sunken
tint plus font-medium so selection is not carried by colour alone.

Editing wells in the labels dialog become sunken fills rather than
bordered boxes inside an already-bordered panel."
```

---

### Task 5: Label chip becomes a pill

**File:** `src/features/labels/components/label-chip.tsx`

- [ ] **Step 1: Pill geometry**

Replace:

```tsx
    <span className="inline-flex items-center gap-1.5 rounded-sm bg-surface-sunken px-2 py-0.5 text-xs font-medium text-text">
```

with:

```tsx
    <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-sunken px-2.5 py-0.5 text-xs font-medium text-text">
```

Spec §3.3 and §4.6 make chips `--radius-full`. Padding grows to `2.5` for the same optical reason as the status badges in Phase 3a.

- [ ] **Step 2: Gates**

```bash
bun run tsc --noEmit && bun run lint && bunx vite build --logLevel error
```

Expected: all exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/features/labels/components/label-chip.tsx
git commit -m "feat(labels): label chips become pills

Spec 3.3/4.6 — chips are --radius-full, matching the status badges."
```

---

### Task 6: Section headings and counts

**Files:**
- Modify: `src/features/members/components/members-tab.tsx`
- Modify: `src/features/comments/components/comment-thread.tsx`

- [ ] **Step 1: Members heading**

Replace:

```tsx
        <h2 className="text-lg font-medium">
          Members <span className="text-text-muted">({members.length})</span>
        </h2>
```

with:

```tsx
        <h2 className="text-label">
          Members <span className="text-num">({members.length})</span>
        </h2>
```

`.text-label` supplies its own colour, so the nested `text-text-muted` is dropped.

- [ ] **Step 2: Members skeletons**

Replace:

```tsx
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
```

with:

```tsx
        <Skeleton className="h-12 w-full rounded-xl" />
        <Skeleton className="h-12 w-full rounded-xl" />
```

- [ ] **Step 3: Comments heading**

Replace:

```tsx
          <span className="text-text-muted">({comments.length})</span>
```

with:

```tsx
          <span className="text-num text-text-muted">({comments.length})</span>
```

Leave the surrounding `<h4 className="text-sm font-medium">` as it is — it sits inside a task dialog next to other `text-sm` labels, where a uppercase micro-label would be out of scale.

- [ ] **Step 4: Gates**

```bash
bun run tsc --noEmit && bun run lint && bunx vite build --logLevel error
```

Expected: all exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/features/members/components/members-tab.tsx src/features/comments/components/comment-thread.tsx
git commit -m "feat(members,comments): heading and count treatment

Members takes .text-label; both counts take .text-num. The comments
heading stays text-sm — it sits inside the task dialog beside other
text-sm labels, where a micro-label would be out of scale."
```

---

### Task 7: Phase 3c gate — the redesign is complete

**STOP.** Ends with a human review. This is the last phase.

- [ ] **Step 1: All automated gates**

```bash
node scripts/check-contrast.mjs && \
grep -lE 'rgba\(|rgb\(|hsl\(|#[0-9a-fA-F]{3,6}|--glass' src/components/ui/*.module.css; \
grep -rn "surface-sunken/\|surface-hover/\|border-text/" src/features/; \
bun run tsc --noEmit && bun run lint && bunx vite build --logLevel error
```

Expected: contrast exits 0 · both greps print **nothing** · tsc, lint, build all exit 0.

- [ ] **Step 2: Whole-app visual review, both themes**

Walk **every** route: Dashboard · My tasks · Projects · a project's Tasks, Timeline, Members, Media and Pages tabs · Login.

- [ ] Every segmented control looks identical — there should now be four of them behaving as one
- [ ] Every list container is a card; no dashed boxes anywhere
- [ ] Every count, size and date is mono with aligned digits
- [ ] Every chip and badge is a pill
- [ ] Nothing renders a hard rule between regions
- [ ] All of the above holds in **dark**

- [ ] **Step 3: The completeness question**

This is the final phase, so the review is no longer "is this route done" but **"does the application read as one design?"** Report anything that still looks like it belongs to a different app.

- [ ] **Step 4: Hand off**

Report gate output and the Step 3 judgement.

---

## Notes for the implementer

**No new patterns.** If something in these files seems to need a decision the plan does not make, stop and report rather than inventing one — every pattern this phase needs already exists.

**If a contrast measurement fails, the token is wrong — not the test.**
