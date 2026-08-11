# Visual Redesign — Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring every remaining `components/ui/` primitive to the patterns locked by the approved Dashboard reference, and fix the defects recorded during Phase 1.

**Architecture:** Phase 1 established the reference: soft borderless cards on a tinted canvas, sunken form controls with `--border-strong` boundaries, `--border-subtle` hairlines inside raised surfaces, diffuse shadows, `.text-num` / `.text-label`, blue reserved for primary action and active state. This phase replicates those decisions across the ~18 primitives that were not touched, rebuilds the tab component as a segmented control, and clears four defects logged during Phase 1 review.

**Tech Stack:** Vite · React 19 · Tailwind CSS v4 (`@theme inline`) · CSS Modules · Radix UI · TanStack Router

**Spec:** `docs/superpowers/specs/2026-08-11-visual-redesign-design.md`
**Prior plan:** `docs/superpowers/plans/2026-08-11-visual-redesign-phase-0-1.md` (Phases 0–1, complete and approved)

---

## Scope

**In scope:** every module under `src/components/ui/` not already finished, plus `src/features/projects/components/project-tab-nav.tsx`.

That one feature component is included deliberately. Spec §4.5 makes the segmented control exist *for* the five-tab project detail route; shipping the primitive without its only consumer would leave the work unverifiable. It also carries a live bug (Task 7).

**Not in scope:** the Phase 3 feature sweep — `features/projects`, `features/tasks`, `features/timeline`, `features/members`, `features/media`, `features/pages`, `features/comments`, `features/labels`, `features/notifications`, and the auth forms. `project-tab-nav.tsx` is the single exception above.

**Already done, do not redo:** `card`, `button`, `input`, `textarea`, `select` (`.trigger` and `.content`), `popover` (`.content` fill/border/shadow), `dropdown-menu` (`.content`/`.subContent` fill/border/shadow, `.separator`), `badge` (already a pill), `activity-feed`.

**Audited and needing no change** — verified while writing this plan, do not open them looking for work:

| Module | Why it is already correct |
|---|---|
| `breadcrumb.module.css` | Uses only `--text` / `--text-muted`. No surface, border, radius or shadow to correct. |
| `tooltip.module.css` | Deliberately inverted (`--text` fill, `--surface` label). Radius stays 8px — see Task 1 Step 4. |
| `toggle.module.css` | Already `--surface-sunken` / `--surface-hover`. Radius stays 8px — see Task 1 Step 4. |
| `skeleton.module.css` | `--surface-hover` fill is correct; radius is contextual and overridden by callers. |

## Testing reality

**The frontend has no test framework and none is to be added.** Verification is four gates, identical to Phase 1:

1. `node scripts/check-contrast.mjs` — must exit 0. Extended in Task 3.
2. `grep` assertions — no colour literal or `--glass-` in `components/ui/*.module.css`.
3. `bun run tsc --noEmit`, `bun run lint`, `bunx vite build` — all exit 0.
4. Human visual review at the Phase 2 gate, both themes.

## Working-tree hygiene — applies to every task

**Never run `git restore`, `git checkout -- <path>`, `git reset`, `git clean`, or `git stash`.** During Phase 1 a subagent ran one of these on an unrelated file and permanently destroyed uncommitted user work.

`git status` shows an untracked file under `apps/backend-rs/` and may show modified files under `.claude/`. These are expected and unrelated — **ignore them**. Stage only the explicit paths named in each commit step. Never `git add -A`, `git add .`, or `git commit -a`.

## File map

| Path | Change | Task |
|---|---|---|
| `ui/dropdown-menu.module.css` | panel radius → `lg` | 1 |
| `ui/select.module.css` | `.content` radius → `lg` | 1 |
| `ui/popover.module.css` | `.content` radius → `lg` | 1 |
| `ui/calendar.module.css` | control radius → `lg` | 1 |
| `ui/sonner.tsx` | radius → `lg`, border → `--border-strong` | 1 |
| `ui/dialog.tsx`, `ui/alert-dialog.tsx` | `shadow-5` → `shadow-4` | 2 |
| `ui/checkbox.module.css` | form-control treatment; checked state keeps `--border-strong` | 3 |
| `ui/separator.module.css`, `ui/command.tsx` | dividers → `--border-subtle` | 4 |
| `ui/sheet.tsx` | overlay borders → `--border-strong` | 2 |
| `ui/scroll-area.module.css`, `ui/avatar.module.css` | thumb + rings → correct surface | 5 |
| `ui/tabs.module.css` | rebuild as segmented control | 6 |
| `features/projects/components/project-tab-nav.tsx` | adopt segmented control, fix active state | 7 |
| `ui/table.module.css` | `.text-label` header, `--border-subtle` rows | 8 |
| `ui/dropdown-menu.module.css`, `ui/select.module.css`, `ui/command.tsx` | item highlight — decision task | 9 |

---

### Task 1: Floating surfaces and controls → `--radius-lg`

Spec §3.3 assigns 12px to "inputs, selects, menus, popovers". The panels were repaired in Phase 0 but kept their 8px radius, which was correct then — Phase 0 was repair-only — and is now the outstanding half of that work.

**Files:**
- Modify: `src/components/ui/dropdown-menu.module.css` (`.content`, `.subContent`)
- Modify: `src/components/ui/select.module.css` (`.content` only)
- Modify: `src/components/ui/popover.module.css` (`.content`)
- Modify: `src/components/ui/calendar.module.css` (`.dropdownRoot`)
- Modify: `src/components/ui/sonner.tsx`

- [ ] **Step 1: Panels**

In each of these four rules, change `border-radius: var(--radius-md);` to `border-radius: var(--radius-lg);`

- `dropdown-menu.module.css` → `.content`
- `dropdown-menu.module.css` → `.subContent`
- `select.module.css` → `.content`
- `popover.module.css` → `.content`

**Do NOT change `select.module.css` `.trigger`** — it is already `--radius-lg` from Phase 1.

- [ ] **Step 2: Calendar dropdown control**

In `calendar.module.css`, in the `.dropdownRoot` rule, change `border-radius: var(--radius-md);` to `border-radius: var(--radius-lg);`

- [ ] **Step 3: Toast**

In `sonner.tsx`, find:

```tsx
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
```

and replace with:

```tsx
          // Toast adalah permukaan mengambang seperti menu dan popover:
          // batasnya --border-strong, bukan --border. Di dark, --border dan
          // --surface-overlay dua-duanya grey-800 — batas yang tak terlihat.
          "--normal-border": "var(--border-strong)",
          "--border-radius": "var(--radius-lg)",
```

- [ ] **Step 4: Confirm the exceptions were left alone**

These deliberately keep `--radius-md` and must NOT be changed. Confirm by reading:

| File | Why it stays 8px |
|---|---|
| `tooltip.module.css` | A small transient label; 12px on a two-line tooltip reads bulbous |
| `skeleton.module.css` | Contextual — callers override it (`stat-cards.tsx` passes `rounded-xl`) |
| `toggle.module.css` | A toolbar control, not a standalone button; pills would break toggle groups |
| `tabs.module.css` | Rebuilt entirely in Task 6 |

Report that you checked these and changed none of them.

- [ ] **Step 5: Verify scope**

```bash
git diff --stat
```

Expected: `5 files changed, 6 insertions(+), 6 deletions(-)` (sonner contributes 2 changed lines plus 3 comment lines — so insertions may read 9; the deletions must be 6).

- [ ] **Step 6: Gates**

```bash
bun run tsc --noEmit && bun run lint && bunx vite build --logLevel error
```

Expected: all exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/components/ui/dropdown-menu.module.css src/components/ui/select.module.css src/components/ui/popover.module.css src/components/ui/calendar.module.css src/components/ui/sonner.tsx
git commit -m "feat(ui): floating surfaces and controls to 12px radius

Completes spec 3.3 for menus, popovers and the calendar control. Phase 0
repaired their colour but deliberately left radius alone as out of scope.

Toast border moves to --border-strong for the same reason the other
floating panels did: in dark, --border and --surface-overlay are both
grey-800."
```

---

### Task 2: Dialog and alert-dialog → `--shadow-4`

Spec §3.4 assigns `--shadow-4` to "Dialog · sheet". `sheet.tsx` complies; `dialog.tsx` and `alert-dialog.tsx` use `--shadow-5`. Ordering is coherent today so nothing looks wrong — but Phase 1 retuned the shadow scale, and leaving a spec/code divergence in place is how a scale silently drifts.

**Files:**
- Modify: `src/components/ui/dialog.tsx` (line ~71)
- Modify: `src/components/ui/alert-dialog.tsx` (line ~66)

- [ ] **Step 1: dialog.tsx**

Replace:

```tsx
            "bg-surface-overlay border border-border shadow-5 rounded-xl",
```

with:

```tsx
            "bg-surface-overlay border border-border-strong shadow-4 rounded-xl",
```

- [ ] **Step 2: alert-dialog.tsx**

Replace the identical line:

```tsx
            "bg-surface-overlay border border-border shadow-5 rounded-xl",
```

with:

```tsx
            "bg-surface-overlay border border-border-strong shadow-4 rounded-xl",
```

The border also moves to `--border-strong`, for the same reason as every other floating surface: `.dark` maps `--border` and `--surface-overlay` both to `--grey-800`, so `border-border` on an overlay renders in the overlay's own colour.

- [ ] **Step 2b: Sheet borders**

`sheet.tsx` already uses `shadow-4` correctly, but carries the same border defect on all four sides. Replace each of these four lines:

```tsx
          "data-[side=right]:border-l data-[side=right]:border-border",
          "data-[side=left]:border-r data-[side=left]:border-border",
          "data-[side=top]:border-b data-[side=top]:border-border",
          "data-[side=bottom]:border-t data-[side=bottom]:border-border",
```

with:

```tsx
          "data-[side=right]:border-l data-[side=right]:border-border-strong",
          "data-[side=left]:border-r data-[side=left]:border-border-strong",
          "data-[side=top]:border-b data-[side=top]:border-border-strong",
          "data-[side=bottom]:border-t data-[side=bottom]:border-border-strong",
```

They are not adjacent in the file — each sits inside its own side-specific block. Change all four.

- [ ] **Step 3: Confirm `--shadow-5` is now unused by components**

```bash
grep -rn "shadow-5" src/
```

Expected: hits only in `src/styles/tokens.css` (the light and dark definitions) and `src/index.css` (the `@theme` mapping). **No hits under `src/components/` or `src/features/`.** `--shadow-5` staying defined with no consumer is correct — it is the top of the scale.

- [ ] **Step 4: Gates**

```bash
bun run tsc --noEmit && bun run lint && bunx vite build --logLevel error
```

Expected: all exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/dialog.tsx src/components/ui/alert-dialog.tsx src/components/ui/sheet.tsx
git commit -m "fix(ui): dialogs use --shadow-4, overlay borders use --border-strong

Spec 3.4 assigns --shadow-4 to dialog and sheet; sheet complied and the
two dialogs did not. Reconciled before the divergence outlives the memory
of it.

Border moves to --border-strong for the same reason as the other floating
surfaces: .dark maps --border and --surface-overlay both to grey-800."
```

---

### Task 3: Checkbox → form-control treatment

`checkbox.module.css` carries the **same defect Phase 1 fixed on inputs**: `border: 1px solid var(--border)` on a control that sits inside a card, which in dark renders the border in the card's exact colour (1.00:1). It also uses `box-shadow: var(--shadow-1)` — a raised shadow on a control that should read as sunken — and a `color-mix` fill instead of `--surface-sunken`.

**Resolved during planning — the checked state keeps `--border-strong`.** A checked checkbox is a `--brand` fill on a card, and that fill measures **6.61 light / 2.20 dark**. In dark the fill alone is not a discernible boundary, and a checkbox has no label inside it to fall back on. The fix is *not* to change `--brand` — that token is the primary button fill and altering it would repaint every primary action in the app. Instead the **border** carries the boundary and the fill carries the state:

| What identifies the control | light | dark |
|---|---|---|
| `--brand` fill vs card | 6.61 | **2.20** ❌ |
| `--border-strong` border vs card | 3.86 | **4.57** ✅ |

So the checked rule simply stops overriding `border-color`, inheriting `--border-strong` from the base rule. `--brand` on `--surface-raised` therefore stays a *reported* pairing in the contrast script, not an asserted one — the control is identified by a legible boundary, just not by its fill.

**Files:**
- Modify: `src/components/ui/checkbox.module.css`

- [ ] **Step 1: Apply the control treatment to the base rule**

Replace, in the `.checkbox` rule:

```css
  border-radius: 4px;
  border: 1px solid var(--border);
  box-shadow: var(--shadow-1);
```

with:

```css
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-strong);
  box-shadow: var(--shadow-inset);
```

Then replace, still in `.checkbox`:

```css
  background-color: color-mix(in srgb, var(--border) 30%, transparent);
```

with:

```css
  background-color: var(--surface-sunken);
```

The literal `4px` becomes `var(--radius-sm)` — same value, but the scale should be referenced rather than restated.

- [ ] **Step 2: Let the checked state inherit the border**

In the `.checkbox[data-state="checked"]` rule, **delete** this line entirely:

```css
  border-color: var(--brand);
```

Keep `background-color: var(--brand);` and `color: var(--text-on-brand);` exactly as they are.

This is the whole point of the task: with `border-color` no longer overridden, the checked control keeps its `--border-strong` boundary (4.57:1 in dark) while the brand fill communicates state. Overriding it to `--brand` would leave the control's only edge at 2.20:1 in dark.

Leave the `:focus-visible` and `[aria-invalid]` rules untouched.

- [ ] **Step 3: Verify the checked tick is still legible**

The tick is `--text-on-brand` on `--brand`, which the contrast script already asserts at 6.17 light / 4.72 dark. Confirm the script still passes:

```bash
node scripts/check-contrast.mjs
```

Expected: **exit 0**, `All measured pairings pass.` No new pairings are added by this task.

- [ ] **Step 4: Gates**

```bash
bunx vite build --logLevel error
```

Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/checkbox.module.css
git commit -m "fix(ui): checkbox gets the form-control treatment

Same --border defect the inputs had: in dark, --border and
--surface-raised are both grey-800, so a checkbox inside a card had an
invisible border. Now --border-strong, --surface-sunken fill and
--shadow-inset, matching input/textarea/select.

The checked state stops overriding border-color. A --brand fill on a card
measures 2.20:1 in dark, and a checkbox has no label inside it to identify
it — so the border carries the boundary and the fill carries the state.
Changing --brand instead would have repainted every primary button."
```

---

### Task 4: Dividers → `--border-subtle`

`--border-subtle` exists for "row dividers and in-card section rules" (spec §3.2). Three dividers still use `--border`, which reads as a seam on a raised surface and vanishes in dark.

**Files:**
- Modify: `src/components/ui/separator.module.css` (`.separator`)
- Modify: `src/components/ui/command.tsx` (two lines)

- [ ] **Step 1: Separator**

In `separator.module.css`, replace:

```css
  background-color: var(--border);
```

with:

```css
  background-color: var(--border-subtle);
```

`Separator` is used to divide content *inside* panels and cards, which is exactly `--border-subtle`'s job.

- [ ] **Step 2: Command dividers**

In `command.tsx`, replace:

```tsx
      className="flex h-8 items-center gap-1.5 border-b border-border px-3"
```

with:

```tsx
      className="flex h-8 items-center gap-1.5 border-b border-border-subtle px-3"
```

and replace:

```tsx
      className={cn("bg-border -mx-1 h-px", className)}
```

with:

```tsx
      className={cn("bg-border-subtle -mx-1 h-px", className)}
```

- [ ] **Step 3: Gates**

```bash
bun run tsc --noEmit && bun run lint && bunx vite build --logLevel error
```

Expected: all exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/separator.module.css src/components/ui/command.tsx
git commit -m "fix(ui): dividers use --border-subtle

Separator and the command palette's rules divide content inside panels,
which is exactly what --border-subtle exists for. --border reads as a seam
on a raised surface and disappears entirely in dark."
```

---

### Task 5: Scroll-area thumb and avatar rings

Two small surface-token corrections.

The scrollbar thumb uses `--border`. A thumb is an interactive control, and in dark `--border` is `--grey-800` against a `--grey-900` page — very nearly invisible.

The avatar overlap ring uses `--surface`, but avatars appear overwhelmingly inside cards (member lists, task rows, comment threads), where the surface behind them is `--surface-raised`. The ring is therefore drawing the page tint on top of a white card.

**Files:**
- Modify: `src/components/ui/scroll-area.module.css` (thumb rule, ~line 58)
- Modify: `src/components/ui/avatar.module.css` (three ring rules)

- [ ] **Step 1: Change the thumb colour**

Replace:

```css
  background-color: var(--border);
```

with:

```css
  background-color: var(--border-strong);
```

Only the rule that also contains `border-radius: 9999px;` — that is the thumb. Change nothing else in the file.

- [ ] **Step 2: Avatar rings**

`avatar.module.css` has **three** rules containing `box-shadow: 0 0 0 2px var(--surface);` — on the status badge, on `.group > [data-slot="avatar"]`, and on the group-overflow chip. Replace all three with:

```css
  box-shadow: 0 0 0 2px var(--surface-raised);
```

**Known exception, accept it:** the top bar renders an avatar directly on `--surface`, where this ring will now be marginally lighter than its background in light mode. The difference is 3% lightness across a 2px ring and is not perceptible; the card case is both far more common and far more visible. Record this rather than trying to make one ring serve both.

- [ ] **Step 3: Gates**

```bash
bunx vite build --logLevel error
```

Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/scroll-area.module.css src/components/ui/avatar.module.css
git commit -m "fix(ui): scrollbar thumb and avatar rings pick the right surface

A thumb is an interactive control, not a divider. On --border it sat at
grey-800 against a grey-900 page in dark — effectively invisible.

Avatar overlap rings ring against --surface-raised: avatars appear
overwhelmingly inside cards. The top bar renders one on --surface where
the ring is now marginally light, which is 3% lightness across 2px and
not perceptible."
```

---

### Task 6: Tabs → segmented control

Spec §4.5. The existing `default` variant is already close: a `--surface-sunken` track with a shadowed active trigger. What is missing is the pill geometry and a real raised fill on the active item — it currently uses `color-mix(in srgb, var(--border) 30%, transparent)`, which is a translucent grey rather than the white pill the spec calls for.

**Files:**
- Modify: `src/components/ui/tabs.module.css`

- [ ] **Step 1: Track becomes a pill**

In the `.tabsList` rule, replace:

```css
  border-radius: 0.5rem;
  padding: 3px;
```

with:

```css
  border-radius: var(--radius-full);
  padding: 3px;
```

- [ ] **Step 2: Trigger becomes a pill and loses its border**

In the `.tabsTrigger` rule, replace:

```css
  border-radius: var(--radius-md);
  border: 1px solid transparent;
```

with:

```css
  border-radius: var(--radius-full);
  border: none;
```

- [ ] **Step 3: Active trigger becomes a raised white pill**

Replace:

```css
.tabsTrigger[data-state="active"] {
  background-color: color-mix(in srgb, var(--border) 30%, transparent);
  color: var(--text);
  border-color: var(--border);
}
```

with:

```css
/* Pil putih terangkat di dalam track tenggelam — inilah yang membuat
   segmented control menambatkan dirinya sendiri, tanpa perlu garis atau
   pita di belakangnya (spec 4.5). */
.tabsTrigger[data-state="active"] {
  background-color: var(--surface-raised);
  color: var(--text);
}
```

The `border-color` line is dropped because Step 2 removed the border.

- [ ] **Step 4: Leave the `line` variant alone**

The `[data-variant="line"]` rules and the `::after` underline machinery are a *different* component shape used elsewhere. Do not change them. Confirm by reading that you left every `[data-variant="line"]` rule and every `::after` rule untouched.

- [ ] **Step 5: Gates**

```bash
bunx vite build --logLevel error
```

Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/components/ui/tabs.module.css
git commit -m "feat(ui): default tabs variant becomes a segmented control

Pill track, pill triggers, and a raised --surface-raised pill for the
active item in place of a translucent grey color-mix. Self-anchoring, so
it needs neither border nor band — which is what makes the tinted-bar
chrome viable for the project detail route.

The `line` variant is a different component shape and is untouched."
```

---

### Task 7: Project tab nav — adopt the segmented control and fix its invisible active state

**This component's active state does not render at all today.** Restyling it without fixing the cause would preserve the bug.

TanStack Router concatenates `className` with `activeProps.className` onto one element rather than replacing. When both set the same property with equal-specificity utilities, **CSS source order decides** — and Tailwind's order is not the author's order. Measured in the built bundle:

| Base class | byte | Active class | byte | Winner |
|---|---|---|---|---|
| `text-text-muted` | 26855 | `text-text` | 26826 | base — active text stays grey |
| `border-transparent` | 23513 | `border-brand` | 23143 | base — active underline never paints |

Both active declarations lose. The fix is `inactiveProps`, which the router applies mutually exclusively with `activeProps` (`link.js:117` — `isActive ? EMPTY : inactiveProps`), so the two never coexist and source order stops mattering.

**Files:**
- Modify: `src/features/projects/components/project-tab-nav.tsx`

The whole component is a single `<Link>` inside a `.map()`, so this is one edit, not five.

- [ ] **Step 1: Replace the returned JSX**

Replace:

```tsx
    <nav className="flex gap-1 border-b px-6">
      {TABS.map((tab) => (
        <Link
          key={tab.to}
          to={tab.to}
          params={{ projectId }}
          className="border-b-2 border-transparent px-3 py-2 text-sm text-text-muted transition-colors hover:text-text"
          activeProps={{
            className: "border-brand text-text",
          }}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
```

with:

```tsx
    /* Segmented control (spec 4.5): track tenggelam, pil terangkat untuk yang
       aktif. `border-b` dilepas — kontrol ini menambatkan dirinya sendiri, dan
       garis di bawahnya justru mengembalikan tepi keras yang sengaja dibuang.

       Semua WARNA ada di activeProps/inactiveProps, tidak satu pun di
       className dasar. TanStack Router MENGGABUNGKAN className dengan
       activeProps.className, jadi dua utility berspesifisitas sama diadu oleh
       urutan sumber CSS — dan urutan itu milik Tailwind, bukan kita. Itulah
       sebabnya status aktif tab ini sebelumnya tidak terlihat sama sekali. */
    <nav className="mx-6 my-3 flex w-fit gap-1 rounded-full bg-surface-sunken p-[3px]">
      {TABS.map((tab) => (
        <Link
          key={tab.to}
          to={tab.to}
          params={{ projectId }}
          className="rounded-full px-3 py-1.5 text-sm font-medium transition-colors [transition-duration:var(--duration-fast)]"
          activeProps={{ className: "bg-surface-raised text-text shadow-1" }}
          inactiveProps={{ className: "text-text-muted hover:text-text" }}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
```

Note there is now **no colour utility of any kind** in the base `className` — no `text-`, no `bg-`, no `border-`. Leaving even one there recreates the collision.

- [ ] **Step 2: Verify no colour utility remains in a base className**

```bash
grep -n "className=" src/features/projects/components/project-tab-nav.tsx
```

Read the output. No base `className` on a `<Link>` may contain `text-`, `bg-`, or `border-` colour utilities. Colour belongs only in `activeProps` / `inactiveProps`.

- [ ] **Step 3: Gates**

```bash
bun run tsc --noEmit && bun run lint && bunx vite build --logLevel error
```

Expected: all exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/features/projects/components/project-tab-nav.tsx
git commit -m "fix(projects): tab nav becomes a segmented control with a visible active state

The active state did not render at all. TanStack Router concatenates
className with activeProps.className rather than replacing it, so at equal
specificity CSS source order decides — and text-text-muted (byte 26855)
beat text-text (26826) while border-transparent (23513) beat border-brand
(23143). Both active declarations lost.

Colour now lives only in activeProps/inactiveProps, which the router
applies mutually exclusively, so source order cannot decide the outcome.

Visually this is now the spec 4.5 segmented control: pill track, raised
white active pill, no rule beneath."
```

---

### Task 8: Table — label header and hairline rows

Spec §4.7. The table is where industrial signals #2 and #3 concentrate.

**Files:**
- Modify: `src/components/ui/table.module.css`

- [ ] **Step 1: Header cells adopt the label treatment**

Replace the `.head` rule:

```css
.head {
  color: var(--text);
  height: 2.5rem;
  padding: 0.5rem 0.75rem;
  text-align: left;
  vertical-align: middle;
  font-weight: 500;
  white-space: nowrap;
}
```

with:

```css
/* Perlakuan micro-label (sinyal industrial 2). Sengaja MENGGANDAKAN
   .text-label alih-alih memakainya: .text-label adalah utility untuk JSX,
   sedangkan header tabel ditata dari modul ini. Jangan @apply. */
.head {
  color: var(--text-subtle);
  height: 2.5rem;
  padding: 0.5rem 0.75rem;
  text-align: left;
  vertical-align: middle;
  font-size: var(--text-xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  white-space: nowrap;
}
```

- [ ] **Step 2: Row and section separators**

There are exactly **three** `var(--border)` uses in this file. Change all three to `var(--border-subtle)`:

```css
.header tr {
  border-bottom: 1px solid var(--border-subtle);
}
```

```css
.footer {
  background-color: color-mix(in srgb, var(--surface-sunken) 50%, transparent);
  border-top: 1px solid var(--border-subtle);
  font-weight: 500;
}
```

```css
.row {
  border-bottom: 1px solid var(--border-subtle);
  transition: background-color 150ms ease;
}
```

Leave the `color-mix` fills on `.footer`, `.row:hover` and `.row[data-state="selected"]` exactly as they are — they are fills, not separators, and are correct.

- [ ] **Step 3: Gates**

```bash
bunx vite build --logLevel error
```

Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/table.module.css
git commit -m "feat(ui): table header label treatment, hairline rows

Industrial signals 2 and 3 concentrate here. Header cells take the
uppercase tracked micro-label styling; row separators move to
--border-subtle.

.text-label is duplicated rather than applied — it is a JSX utility and
this is a CSS module."
```

---

### Task 9: Menu item highlight — verify, then decide

Recorded in spec §4.1 as a deferred defect. `.item:focus` fills with `--surface-hover`, measuring **1.14:1** on a white panel (dark 1.26:1).

**This task begins with a measurement, not an edit.** The severity depends entirely on whether keyboard users get a focus ring, and that was reasoned about but never observed.

- [ ] **Step 1: Observe the actual keyboard focus treatment**

```bash
bun run dev
```

Open `http://localhost:3001`, log in, and open any dropdown menu (the theme switcher in the top bar is the easiest). Then:

1. Navigate between items using **arrow keys only** — do not use the mouse.
2. Observe whether the highlighted item shows a visible focus ring in addition to the faint fill.
3. Repeat in dark mode.

The global rule in `index.css` is `:where(a, button, input, select, textarea, summary, [tabindex]):focus-visible { outline: 2px solid var(--focus); … }`, and Radix sets `tabindex="-1"` on menu items — so the ring *should* apply. Whether the browser treats programmatic focus as `:focus-visible` is the open question, and it is only answerable by looking.

Stop the dev server when done.

- [ ] **Step 2: Report what you observed and STOP**

Report to the controller:
- Does a focus ring appear on arrow-key navigation? (light and dark)
- Is the highlighted item unambiguously identifiable without the mouse?

**Do not edit anything yet.** The two outcomes lead to different work:

- **Ring visible** → the 1.14:1 fill is a mouse-hover affordance only, which is conventional and acceptable. Close this item, record the observation in the spec, no code change.
- **No ring** → keyboard users cannot see which item is selected. That is a genuine WCAG 2.4.7 failure and needs a real highlight: `--brand-subtle` fill plus a 2px `--brand` left bar on `.item:focus`, applied in `dropdown-menu.module.css` (four rules), `select.module.css` (one rule) and `command.tsx` (`data-[selected=true]`).

The controller will tell you which path to take.

---

### Task 10: Phase 2 gate

**STOP.** This task ends with a human review. Do not begin Phase 3.

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

At `http://localhost:3001`, check:

- [ ] Project detail route — tabs render as a pill group in a sunken track, and **the active tab is visibly a raised white pill**
- [ ] Open a dropdown, a select, and the date picker popover — all light panels in light mode, 12px radius, visible edge
- [ ] Open a dialog (create task) — `--shadow-4`, visible border in both themes
- [ ] A checkbox, unchecked and checked, inside a card — border visible in **dark**
- [ ] A table — uppercase tracked headers, hairline row separators
- [ ] A toast, if one can be triggered — 12px radius, visible border
- [ ] Scrollbar thumb visible in dark

- [ ] **Step 3: Confirm the mixed state is shrinking, not growing**

Visit every route. Phase 3 feature components will still look unfinished — that is expected. Confirm nothing is *broken*: no invisible text, no dark panel in light mode, no unreadable control.

- [ ] **Step 4: Stop the server and hand off**

Report: gate outputs, anything from Steps 2–3 that did not match, and the Task 9 decision.

---

## Notes for the implementer

**Do not fix Phase 3 components in passing.** `project-tab-nav.tsx` is the single feature file in scope, and only for Tasks 7.

**If a contrast measurement fails, the token is wrong — not the test.** The one legitimate reason to move a pairing out of `PAIRS` is that WCAG genuinely imposes no threshold on it, and that claim belongs in a comment with its reasoning. "It fails and I need it to pass" is never that reason.

**Tasks 3 and 9 are designed to stop.** Task 3 Step 3 expects a failure; Task 9 Step 2 expects an observation. Both hand a decision back to the controller. Reporting a stop is success, not failure.

**Comments in CSS modules and `tokens.css` are in Indonesian** and record *why*, usually with a measurement. Match that convention.
