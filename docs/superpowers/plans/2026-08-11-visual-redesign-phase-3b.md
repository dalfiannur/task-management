# Visual Redesign — Phase 3b (Timeline) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the Timeline (Gantt) route into the design language, under the treatment the user selected: **soft container, industrial interior.**

**Architecture:** The chart lives in the same borderless 16px card with `--shadow-2` as every other surface in the app. *Inside* that card it keeps a real coordinate grid — hairline gridlines, heavier week boundaries, tinted module rows, mono date ticks. Nothing about the app's outer language changes; only the chart's interior gains structure.

**Tech Stack:** Vite · React 19 · Tailwind CSS v4 · TanStack Query

**Spec:** `docs/superpowers/specs/2026-08-11-visual-redesign-design.md` (§4.10, added by this phase)
**Prior plans:** `…-phase-0-1.md` · `…-phase-2.md` · `…-phase-3a.md` — all complete

---

## The decision this phase implements

Spec §7 flagged the Gantt as where soft-dominant density fights hardest, and §5 deferred its treatment. The user chose **soft container, industrial interior** over "fully soft, no gridlines" and "utilitarian tool surface".

The reasoning that decided it: a Gantt is a coordinate grid where reading a date off a bar *requires* vertical rules. Removing them trades the chart's function for consistency. Keeping the grid **inside** an otherwise-standard card gets both — every outer surface stays identical to the approved reference, and the one place where structure carries meaning gets structure.

## What this phase also fixes regardless of that decision

Found while surveying. All four are instances of patterns the redesign has been removing everywhere else:

| Problem | Where | Why it matters |
|---|---|---|
| Gridlines are `border-text/10` and `border-text/20` | `gantt-chart.tsx` | **Unmeasured alpha composites of `--text`.** Not tokens; never contrast-checked; behave unpredictably across themes. |
| Row fills are `bg-surface-sunken/40` | `gantt-chart.tsx` | Same — an alpha composite where a real token exists. |
| Zoom control is a hand-rolled segmented control | `gantt-chart.tsx` | The **third** variant of a control the app now renders one way. |
| Empty state is a dashed box | `gantt-chart.tsx` | A visual language the design does not otherwise use. |

## Testing reality

**No test framework, and none is to be added.** Four gates, as in every prior phase:

1. `node scripts/check-contrast.mjs` — exit 0
2. `grep` — no colour literal or `--glass-` in `components/ui/*.module.css`
3. `bun run tsc --noEmit`, `bun run lint`, `bunx vite build` — all exit 0
4. Human visual review at the gate, both themes

## Working-tree hygiene — applies to every task

**Never run `git restore`, `git checkout -- <path>`, `git reset`, `git clean`, or `git stash`.** A subagent previously ran one of these on an unrelated file and permanently destroyed uncommitted user work.

`git status` shows an untracked file under `apps/backend-rs/`. Expected and unrelated — **ignore it**. Stage only the paths named in each commit step. Never `git add -A`, `git add .`, or `git commit -a`.

**A dev server may be running on port 3001. Do not start, stop or restart any server.**

## File map

| Path | Change | Task |
|---|---|---|
| `features/timeline/components/gantt-chart.tsx` | container → card, gridlines → tokens, zoom → segmented control, empty state | 1, 2, 3 |
| `features/timeline/components/gantt-bar.tsx` | bar geometry | 4 |
| `features/timeline/components/unscheduled-panel.tsx` | panel → card, row treatment | 5 |

---

### Task 1: Chart container becomes a card, gridlines become tokens

This is the core of the chosen treatment.

**Files:** Modify `src/features/timeline/components/gantt-chart.tsx`

- [ ] **Step 1: Container becomes a clipping card**

Replace:

```tsx
        <div className="overflow-x-auto rounded-lg border">
```

with:

```tsx
        <div className="overflow-x-auto rounded-xl bg-surface-raised shadow-2">
```

16px radius, borderless, `--shadow-2` — identical to every other card in the app. `overflow-x-auto` already clips, so the grid cannot paint over the rounded corners.

- [ ] **Step 2: Name column divider**

Replace:

```tsx
            <div
              className="shrink-0 border-r"
              style={{ width: NAME_COL }}
            >
              <div style={{ height: HEADER_H }} className="border-b" />
```

with:

```tsx
            <div
              className="shrink-0 border-r border-border-subtle"
              style={{ width: NAME_COL }}
            >
              <div
                style={{ height: HEADER_H }}
                className="border-b border-border-subtle"
              />
```

- [ ] **Step 3: Module rows use a real token**

There are **two** occurrences of `bg-surface-sunken/40` in this file — one on the name-column row, one on the grid row. Replace both with `bg-surface-sunken`.

First:

```tsx
                    r.kind === "module"
                      ? "bg-surface-sunken/40 font-medium"
                      : "text-text-muted",
```

becomes:

```tsx
                    r.kind === "module"
                      ? "bg-surface-sunken font-medium"
                      : "text-text-muted",
```

Second:

```tsx
                    "relative border-b",
                    r.kind === "module" && "bg-surface-sunken/40",
```

becomes:

```tsx
                    "relative border-b border-border-subtle",
                    r.kind === "module" && "bg-surface-sunken",
```

Note the second one also picks up the row's hairline. `--surface-sunken` at full opacity is the token that exists for a tinted band; the `/40` alpha composite was never measured against anything.

- [ ] **Step 4: Header ticks — mono labels, tokenised rules**

Replace:

```tsx
              <div
                className="relative border-b"
                style={{ height: HEADER_H }}
              >
                {ticks.map((t) => (
                  <div
                    key={t.offset}
                    className={cn(
                      "absolute top-0 flex h-full items-center border-l pl-1 text-xs text-text-muted",
                      t.major && "border-text/20",
                    )}
                    style={{ left: t.offset * pxPerDay }}
                  >
                    {t.label}
                  </div>
                ))}
              </div>
```

with:

```tsx
              <div
                className="relative border-b border-border-subtle"
                style={{ height: HEADER_H }}
              >
                {ticks.map((t) => (
                  <div
                    key={t.offset}
                    className={cn(
                      "text-num absolute top-0 flex h-full items-center border-l pl-1 text-xs text-text-muted",
                      // Batas minor vs mayor: dua tingkat, dua token — bukan
                      // dua nilai alpha dari --text yang tidak pernah diukur.
                      t.major ? "border-border" : "border-border-subtle",
                    )}
                    style={{ left: t.offset * pxPerDay }}
                  >
                    {t.label}
                  </div>
                ))}
              </div>
```

Date ticks take `.text-num` — they are dates, and this is the surface where digit alignment matters most.

- [ ] **Step 5: Vertical gridlines use a token**

Replace:

```tsx
                      <div
                        key={t.offset}
                        className="absolute top-0 h-full border-l border-text/10"
                        style={{ left: t.offset * pxPerDay }}
                      />
```

with:

```tsx
                      <div
                        key={t.offset}
                        className="absolute top-0 h-full border-l border-border"
                        style={{ left: t.offset * pxPerDay }}
                      />
```

These are the **major** gridlines (the code filters `t.major` before mapping), so they take `--border` — one step heavier than the row hairlines, which is what makes week boundaries readable.

- [ ] **Step 6: Gates**

```bash
bun run tsc --noEmit && bun run lint && bunx vite build --logLevel error
```

Expected: all exit 0.

- [ ] **Step 7: Confirm no alpha composites survive**

```bash
grep -n "border-text/\|surface-sunken/\|/40\|/10\|/20" src/features/timeline/components/gantt-chart.tsx
```

Expected: no output.

- [ ] **Step 8: Commit**

```bash
git add src/features/timeline/components/gantt-chart.tsx
git commit -m "feat(timeline): gantt becomes a soft card with a tokenised grid

The chosen treatment: soft container, industrial interior. The chart sits
in the same borderless 16px card with --shadow-2 as every other surface,
and keeps a real coordinate grid inside it — because a gantt is where
reading a date off a bar requires vertical rules.

Replaces four unmeasured alpha composites with tokens: gridlines were
border-text/10 and border-text/20, module rows were surface-sunken/40.
Minor rules are --border-subtle, major (week) rules are --border — two
steps of one scale rather than two alphas of --text.

Date ticks take .text-num."
```

---

### Task 2: Zoom control becomes the segmented control

The third hand-rolled variant of this control in the codebase. The other two were unified in Phases 2 and 3a.

**Files:** Modify `src/features/timeline/components/gantt-chart.tsx`

- [ ] **Step 1: Track and pill**

Replace:

```tsx
        <div className="inline-flex rounded-md border p-0.5">
          {ZOOMS.map((z) => (
            <button
              key={z}
              onClick={() => setZoom(z)}
              className={cn(
                "rounded-sm px-3 py-1 text-sm capitalize transition-colors",
                zoom === z
                  ? "bg-brand text-text-on-brand"
                  : "text-text-muted hover:text-text",
              )}
            >
              {z}
            </button>
          ))}
        </div>
```

with:

```tsx
        <div className="inline-flex gap-1 rounded-full bg-surface-sunken p-[3px]">
          {ZOOMS.map((z) => (
            <button
              key={z}
              onClick={() => setZoom(z)}
              className={cn(
                "rounded-full px-3 py-1 text-sm capitalize transition-colors",
                "[transition-duration:var(--duration-fast)]",
                zoom === z
                  ? "bg-surface-raised font-medium text-text shadow-1"
                  : "text-text-muted hover:text-text",
              )}
            >
              {z}
            </button>
          ))}
        </div>
```

- [ ] **Step 2: Section heading takes the label treatment**

Replace:

```tsx
        <h2 className="text-lg font-medium">Timeline</h2>
```

with:

```tsx
        <h2 className="text-label">Timeline</h2>
```

Matches the Dashboard, where section headings are labels above their content rather than competing with the page title.

- [ ] **Step 3: Gates**

```bash
bun run tsc --noEmit && bun run lint && bunx vite build --logLevel error
```

Expected: all exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/features/timeline/components/gantt-chart.tsx
git commit -m "feat(timeline): zoom control adopts the segmented control

The third hand-rolled variant of this control in the codebase; the other
two were unified in phases 2 and 3a. Sunken track, raised white active
pill. Section heading takes .text-label."
```

---

### Task 3: Empty state and skeletons

**Files:** Modify `src/features/timeline/components/gantt-chart.tsx`

- [ ] **Step 1: Empty state becomes a card**

Replace:

```tsx
        <div className="rounded-lg border border-dashed p-12 text-center text-text-muted">
```

with:

```tsx
        <div className="rounded-xl bg-surface-raised p-12 text-center text-text-muted shadow-2">
```

- [ ] **Step 2: Skeleton matches the card it stands in for**

Replace:

```tsx
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
```

with:

```tsx
        <Skeleton className="h-8 w-48 rounded-full" />
        <Skeleton className="h-64 w-full rounded-xl shadow-2" />
```

The first stands in for the segmented control (a pill), the second for the chart card.

- [ ] **Step 3: Gates**

```bash
bun run tsc --noEmit && bun run lint && bunx vite build --logLevel error
```

Expected: all exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/features/timeline/components/gantt-chart.tsx
git commit -m "feat(timeline): empty state and skeletons match the card

A dashed outline is a visual language this design does not use. Skeletons
take the shape of what they stand in for — a pill for the zoom control, a
card for the chart."
```

---

### Task 4: Gantt bar geometry

**Files:** Modify `src/features/timeline/components/gantt-bar.tsx`

- [ ] **Step 1: Bar becomes a pill**

Replace:

```tsx
        "absolute flex items-center rounded-sm px-2 text-xs",
```

with:

```tsx
        "absolute flex items-center rounded-full px-2.5 text-xs",
```

A bar is a filled chip of exactly the kind spec §3.3 makes a pill, and a pill reads as a *span* — which is what it represents.

- [ ] **Step 2: Resize handles follow the pill**

Replace:

```tsx
          className="absolute left-0 top-0 h-full w-1.5 cursor-ew-resize rounded-l-sm bg-current opacity-30"
```

with:

```tsx
          className="absolute left-0 top-0 h-full w-1.5 cursor-ew-resize rounded-l-full bg-current opacity-30"
```

and replace:

```tsx
          className="absolute right-0 top-0 h-full w-1.5 cursor-ew-resize rounded-r-sm bg-current opacity-30"
```

with:

```tsx
          className="absolute right-0 top-0 h-full w-1.5 cursor-ew-resize rounded-r-full bg-current opacity-30"
```

`bg-current opacity-30` is left alone deliberately: it derives from the bar's own foreground colour, so it adapts to both the brand-filled and done states without a second token, and it is decorative rather than an information-bearing boundary.

- [ ] **Step 3: Gates**

```bash
bun run tsc --noEmit && bun run lint && bunx vite build --logLevel error
```

Expected: all exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/features/timeline/components/gantt-bar.tsx
git commit -m "feat(timeline): gantt bars become pills

A bar is a filled chip, which spec 3.3 makes --radius-full — and a pill
reads as a span, which is what it represents. Resize handles follow.

bg-current opacity-30 on the handles is deliberately kept: it derives from
the bar's own foreground so it adapts to both the brand and done states,
and it is decorative rather than an information-bearing boundary."
```

---

### Task 5: Unscheduled panel

**Files:** Modify `src/features/timeline/components/unscheduled-panel.tsx`

- [ ] **Step 1: Panel becomes a card**

Replace:

```tsx
    <div className="rounded-lg border p-3">
```

with:

```tsx
    <div className="rounded-xl bg-surface-raised p-4 shadow-2">
```

- [ ] **Step 2: Count goes mono**

Replace:

```tsx
        <span className="text-text-muted">({tasks.length})</span>
```

with:

```tsx
        <span className="text-num text-text-muted">({tasks.length})</span>
```

- [ ] **Step 3: Rows adopt the reference treatment**

Replace:

```tsx
            className="flex items-center justify-between gap-2 rounded-sm px-2 py-1 hover:bg-surface-sunken/40"
```

with:

```tsx
            className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 transition-colors [transition-duration:var(--duration-fast)] hover:bg-surface-hover"
```

`bg-surface-sunken/40` is another unmeasured alpha; `--surface-hover` is the token for this. These rows are a short list inside a padded card rather than a full-bleed table, so they keep a radius — unlike the task rows, which sit flush against their card's edges.

- [ ] **Step 4: Gates**

```bash
bun run tsc --noEmit && bun run lint && bunx vite build --logLevel error
```

Expected: all exit 0.

- [ ] **Step 5: Confirm no alpha composites remain in the feature**

```bash
grep -rn "surface-sunken/\|border-text/" src/features/timeline/
```

Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/features/timeline/components/unscheduled-panel.tsx
git commit -m "feat(timeline): unscheduled panel becomes a card

Card container, mono count, and rows on --surface-hover instead of a
surface-sunken/40 alpha composite.

These rows keep a radius, unlike the task rows: they are a short list
inside a padded card rather than a full-bleed table flush to the edges."
```

---

### Task 6: Phase 3b gate

**STOP.** Ends with a human review. Do not start 3c.

- [ ] **Step 1: All automated gates**

```bash
node scripts/check-contrast.mjs && \
grep -lE 'rgba\(|rgb\(|hsl\(|#[0-9a-fA-F]{3,6}|--glass' src/components/ui/*.module.css; \
grep -rn "surface-sunken/\|border-text/" src/features/timeline/; \
bun run tsc --noEmit && bun run lint && bunx vite build --logLevel error
```

Expected: contrast exits 0 · both greps print **nothing** · tsc, lint, build all exit 0.

- [ ] **Step 2: Visual review, both themes**

On a project's Timeline tab:

- [ ] Chart sits in a borderless 16px card with a soft shadow, like every other surface
- [ ] **Vertical gridlines are visible** — week boundaries clearly heavier than day rules
- [ ] Module rows read as tinted bands
- [ ] Date ticks are mono with aligned digits
- [ ] Bars are pills; a done task's bar is muted rather than a second colour
- [ ] Zoom control matches the project tabs directly above it
- [ ] Unscheduled panel is a card
- [ ] All of the above holds in **dark** — pay attention to whether the gridlines survive there, since `--border` and `--border-subtle` both shift

- [ ] **Step 3: The judgement this phase exists to test**

The chosen treatment puts an industrial grid inside a soft shell. Report specifically: **does the chart read as part of the same application as the Tasks tab, or as a foreign object embedded in it?** That is the risk of option A and the reason this decision was deferred rather than assumed.

- [ ] **Step 4: Hand off**

Report gate output, anything from Steps 2–3 that did not match, and the Step 3 judgement.

---

## Notes for the implementer

**Tasks 1, 2 and 3 all edit `gantt-chart.tsx`.** They are separate commits deliberately — container/grid, control, and states are three different concerns. Do them in order and commit between.

**Do not touch `timeline-utils.ts`.** `ROW_HEIGHT` (36) and `PX_PER_DAY` are layout mathematics that the drag/resize logic depends on. Row density is not being changed in this phase; if the review says it should be, that is a follow-up with the geometry checked against `barGeometry`.

**Do not touch any other feature domain** — members, media, pages, comments, labels, notifications, auth and `my-tasks-view` are Phase 3c.

**If a contrast measurement fails, the token is wrong — not the test.**
