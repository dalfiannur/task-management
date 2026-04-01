# Dark Glassmorphism Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the light theme with a dark glassmorphism theme app-wide, matching the Stitch design mockup.

**Architecture:** Swap CSS custom properties in `tokens.css` to a dark palette, add glass effect utility classes in `index.css`, then propagate glass styles to shadcn/ui CSS modules and fix hardcoded colors in domain component modules. Components using CSS modules get glass properties in their `.module.css` files; components using inline Tailwind get class replacements in their `.tsx` files.

**Tech Stack:** CSS custom properties, Tailwind CSS, CSS Modules, shadcn/ui

**Spec:** `docs/superpowers/specs/2026-04-01-dark-glassmorphism-theme-design.md`

---

### Task 1: Swap Color Palette in tokens.css

**Files:**
- Modify: `apps/frontend/src/styles/tokens.css`

- [ ] **Step 1: Replace `:root` variables with dark glassmorphism palette**

Replace the entire `:root` block in `apps/frontend/src/styles/tokens.css` with:

```css
@import url('https://fonts.googleapis.com/css2?family=Google+Sans:wght@300;400;500;600;700&family=Google+Sans+Mono:wght@400;500;600&display=swap');

:root {
  /* Colors - Dark glassmorphism */
  --background: hsl(228 20% 7%);
  --foreground: hsl(220 14% 90%);
  --card: hsl(228 20% 10%);
  --card-foreground: hsl(220 14% 90%);
  --popover: hsl(228 20% 10%);
  --popover-foreground: hsl(220 14% 90%);
  --primary: hsl(217 91% 60%);
  --primary-foreground: hsl(0 0% 98%);
  --secondary: hsl(228 15% 15%);
  --secondary-foreground: hsl(220 14% 82%);
  --muted: hsl(228 12% 14%);
  --muted-foreground: hsl(220 9% 56%);
  --accent: hsl(228 15% 13%);
  --accent-foreground: hsl(220 14% 90%);
  --destructive: hsl(0 84% 60%);
  --destructive-foreground: hsl(0 0% 98%);
  --border: hsl(228 10% 18%);
  --input: hsl(228 10% 18%);
  --ring: hsl(217 91% 60%);
  --chart-1: hsl(217 91% 60%);
  --chart-2: hsl(160 59% 38%);
  --chart-3: hsl(38 92% 50%);
  --chart-4: hsl(258 90% 66%);
  --chart-5: hsl(0 84% 60%);

  /* Radius — unchanged */
  --radius: 0.375rem;
  --radius-sm: calc(var(--radius) - 2px);
  --radius-md: calc(var(--radius) - 1px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);

  /* Typography — unchanged */
  --font-sans: 'Google Sans', system-ui, sans-serif;
  --font-mono: 'Google Sans Mono', ui-monospace, monospace;

  /* Spacing scale — unchanged */
  --space-1: 2px;
  --space-2: 4px;
  --space-3: 6px;
  --space-4: 8px;
  --space-5: 10px;
  --space-6: 12px;
  --space-8: 16px;
  --space-10: 20px;
  --space-12: 24px;

  /* Sidebar */
  --sidebar: hsl(235 25% 13%);
  --sidebar-foreground: hsl(220 9% 56%);
  --sidebar-primary: hsl(217 91% 60%);
  --sidebar-primary-foreground: hsl(0 0% 98%);
  --sidebar-accent: hsl(235 20% 17%);
  --sidebar-accent-foreground: hsl(220 14% 90%);
  --sidebar-border: hsl(235 15% 18%);
  --sidebar-ring: hsl(217 91% 60%);

  /* Glass effects */
  --glass-bg: rgba(255, 255, 255, 0.04);
  --glass-border: rgba(255, 255, 255, 0.08);
  --glass-shadow: 0 4px 24px rgba(0, 0, 0, 0.2);
  --glass-blur: 12px;
}
```

- [ ] **Step 2: Remove the `.dark` class variant**

Delete the entire `.dark { ... }` block (lines 63-96 in the current file). It is no longer needed since dark is the default.

- [ ] **Step 3: Verify the dev server starts without errors**

Run: `cd apps/frontend && bun run dev`

Expected: Dev server starts. The app will look broken (wrong colors on some components) — that's expected. The background should be dark (#0f1117).

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/styles/tokens.css
git commit -m "feat(theme): replace light palette with dark glassmorphism colors"
```

---

### Task 2: Add Glass Utility Classes in index.css

**Files:**
- Modify: `apps/frontend/src/index.css`

- [ ] **Step 1: Add glass utility classes to the existing `@layer base` block**

Add the following at the end of the file, after the existing `@layer base` block for `.custom-scrollbar`:

```css
/* ============================================
   Glass effect utilities
   ============================================ */

@layer base {
  .glass-card {
    background: var(--glass-bg);
    backdrop-filter: blur(var(--glass-blur));
    -webkit-backdrop-filter: blur(var(--glass-blur));
    border: 1px solid var(--glass-border);
    box-shadow: var(--glass-shadow);
  }

  .glass-sidebar {
    background: var(--sidebar);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border-right: 1px solid var(--glass-border);
  }

  .glass-input {
    background: var(--glass-bg);
    border: 1px solid var(--glass-border);
  }

  .glass-popover {
    background: hsl(228 20% 10% / 0.9);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid rgba(255, 255, 255, 0.1);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  }
}
```

- [ ] **Step 2: Update prose mark highlight for dark backgrounds**

In the existing `.prose mark` rule in `index.css`, change:

```css
/* Old */
.prose mark {
  background-color: #fef08a;
  border-radius: 2px;
  padding: 0.0625rem 0.125rem;
}
```

to:

```css
/* New */
.prose mark {
  background-color: hsl(50 90% 60% / 0.3);
  border-radius: 2px;
  padding: 0.0625rem 0.125rem;
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/index.css
git commit -m "feat(theme): add glass utility classes and fix prose mark for dark bg"
```

---

### Task 3: Apply Glass to Card CSS Module

**Files:**
- Modify: `apps/frontend/src/components/ui/card.module.css`

- [ ] **Step 1: Update the `.card` class to use glass styling**

In `apps/frontend/src/components/ui/card.module.css`, replace the `.card` rule:

```css
/* Old */
.card {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  border-radius: var(--radius-xl);
  border: 1px solid var(--border);
  padding-top: 1rem;
  padding-bottom: 1rem;
  background-color: var(--card);
  color: var(--card-foreground);
  box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05);
}
```

with:

```css
/* New - glass card */
.card {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  border-radius: var(--radius-xl);
  border: 1px solid var(--glass-border);
  padding-top: 1rem;
  padding-bottom: 1rem;
  background: var(--glass-bg);
  backdrop-filter: blur(var(--glass-blur));
  -webkit-backdrop-filter: blur(var(--glass-blur));
  color: var(--card-foreground);
  box-shadow: var(--glass-shadow);
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/frontend/src/components/ui/card.module.css
git commit -m "feat(theme): apply glass effect to Card component"
```

---

### Task 4: Apply Glass to Popover, Dropdown, Select, and Tooltip CSS Modules

**Files:**
- Modify: `apps/frontend/src/components/ui/popover.module.css`
- Modify: `apps/frontend/src/components/ui/dropdown-menu.module.css`
- Modify: `apps/frontend/src/components/ui/select.module.css`
- Modify: `apps/frontend/src/components/ui/tooltip.module.css`

- [ ] **Step 1: Update popover.module.css `.content` to glass-popover style**

In `apps/frontend/src/components/ui/popover.module.css`, in the `.content` rule, replace these three properties:

```css
/* Old */
border: 1px solid var(--border);
background-color: var(--popover);
/* ... */
box-shadow:
  0 4px 6px -1px rgb(0 0 0 / 0.1),
  0 2px 4px -2px rgb(0 0 0 / 0.1);
```

with:

```css
/* New */
border: 1px solid rgba(255, 255, 255, 0.1);
background: hsl(228 20% 10% / 0.9);
backdrop-filter: blur(20px);
-webkit-backdrop-filter: blur(20px);
/* ... */
box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
```

The full `.content` rule should look like:

```css
.content {
  z-index: 50;
  width: 18rem;
  border-radius: var(--radius-md);
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: hsl(228 20% 10% / 0.9);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  color: var(--popover-foreground);
  padding: 0.75rem;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  outline: none;
  transform-origin: var(--radix-popover-content-transform-origin);
  animation: popoverIn 150ms cubic-bezier(0.16, 1, 0.3, 1);
}
```

- [ ] **Step 2: Update dropdown-menu.module.css `.content` and `.subContent` to glass-popover style**

In `apps/frontend/src/components/ui/dropdown-menu.module.css`, apply the same glass-popover treatment to `.content`:

```css
.content {
  z-index: 50;
  min-width: 8rem;
  max-height: var(--radix-dropdown-menu-content-available-height);
  overflow-x: hidden;
  overflow-y: auto;
  border-radius: var(--radius-md);
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: hsl(228 20% 10% / 0.9);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  color: var(--popover-foreground);
  padding: 0.25rem;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  transform-origin: var(--radix-dropdown-menu-content-transform-origin);
  animation: dropdownIn 150ms cubic-bezier(0.16, 1, 0.3, 1);
}
```

Apply the same to `.subContent`:

```css
.subContent {
  z-index: 50;
  min-width: 8rem;
  overflow: hidden;
  border-radius: var(--radius-md);
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: hsl(228 20% 10% / 0.9);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  color: var(--popover-foreground);
  padding: 0.25rem;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  transform-origin: var(--radix-dropdown-menu-content-transform-origin);
  animation: dropdownIn 150ms cubic-bezier(0.16, 1, 0.3, 1);
}
```

- [ ] **Step 3: Update select.module.css `.content` to glass-popover and `.trigger` to glass-input**

In `apps/frontend/src/components/ui/select.module.css`, update `.trigger` background:

```css
/* In .trigger, change: */
background-color: transparent;
/* to: */
background: var(--glass-bg);
border: 1px solid var(--glass-border);
```

Update `.content`:

```css
.content {
  position: relative;
  z-index: 50;
  min-width: 8rem;
  max-height: var(--radix-select-content-available-height);
  overflow-x: hidden;
  overflow-y: auto;
  border-radius: var(--radius-md);
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: hsl(228 20% 10% / 0.9);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  color: var(--popover-foreground);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  transform-origin: var(--radix-select-content-transform-origin);
  animation: selectIn 150ms cubic-bezier(0.16, 1, 0.3, 1);
}
```

Remove the `:global(.dark)` overrides at the end of the file (lines 290-299 — the `.dark .trigger` rules). Since dark is now the default, the glass-input style already covers this.

- [ ] **Step 4: Update tooltip.module.css for dark theme**

Tooltip uses inverted colors (`background: var(--foreground)`, `color: var(--background)`). On dark theme, this means a light tooltip on dark bg — which is fine. No change needed for tooltip.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/components/ui/popover.module.css \
       apps/frontend/src/components/ui/dropdown-menu.module.css \
       apps/frontend/src/components/ui/select.module.css
git commit -m "feat(theme): apply glass-popover to popover, dropdown, and select"
```

---

### Task 5: Apply Glass to Input and Textarea CSS Modules

**Files:**
- Modify: `apps/frontend/src/components/ui/input.module.css`
- Modify: `apps/frontend/src/components/ui/textarea.module.css`

- [ ] **Step 1: Update input.module.css**

In `apps/frontend/src/components/ui/input.module.css`, in the `.input` rule, change:

```css
background-color: transparent;
```

to:

```css
background: var(--glass-bg);
border: 1px solid var(--glass-border);
```

And remove the duplicate `border` line if one already exists (the existing rule has `border: 1px solid var(--input)` — replace it).

Remove the `:global(.dark)` overrides at the end of the file (lines 61-67). Since dark is now the default, the glass-input background already covers this.

- [ ] **Step 2: Update textarea.module.css**

In `apps/frontend/src/components/ui/textarea.module.css`, in the `.textarea` rule, change:

```css
background-color: transparent;
```

to:

```css
background: var(--glass-bg);
border: 1px solid var(--glass-border);
```

Remove the existing `border: 1px solid var(--input)` line (replace with the glass-border version above).

Remove the `:global(.dark)` overrides at the end of the file (lines 43-49).

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/components/ui/input.module.css \
       apps/frontend/src/components/ui/textarea.module.css
git commit -m "feat(theme): apply glass-input to Input and Textarea"
```

---

### Task 6: Fix Dialog and Sheet Hardcoded Colors

**Files:**
- Modify: `apps/frontend/src/components/ui/dialog.tsx`
- Modify: `apps/frontend/src/components/ui/sheet.tsx`

- [ ] **Step 1: Fix dialog.tsx overlay and content colors**

In `apps/frontend/src/components/ui/dialog.tsx`, in `DialogOverlay`, change:

```typescript
"fixed inset-0 z-50 bg-black/20 backdrop-blur-sm dark:bg-black/50",
```

to:

```typescript
"fixed inset-0 z-50 bg-black/50 backdrop-blur-sm",
```

In `DialogContent`, change:

```typescript
// Solid background + frosted border
"bg-white border border-black/[0.08] shadow-2xl rounded-2xl",
"dark:bg-gray-950 dark:border-white/[0.12] dark:shadow-black/80",
```

to:

```typescript
// Glass popover background
"bg-[hsl(228_20%_10%_/_0.9)] backdrop-blur-[20px] border border-white/[0.1] shadow-[0_8px_32px_rgba(0,0,0,0.4)] rounded-2xl",
```

- [ ] **Step 2: Fix sheet.tsx overlay and content colors**

In `apps/frontend/src/components/ui/sheet.tsx`, in `SheetOverlay`, change:

```typescript
"fixed inset-0 z-50 bg-black/20 backdrop-blur-sm dark:bg-black/50",
```

to:

```typescript
"fixed inset-0 z-50 bg-black/50 backdrop-blur-sm",
```

In `SheetContent`, change:

```typescript
// Solid background
"bg-white shadow-xl",
"dark:bg-gray-950 dark:shadow-black/60",
```

to:

```typescript
// Glass popover background
"bg-[hsl(228_20%_10%_/_0.9)] backdrop-blur-[20px] shadow-[0_8px_32px_rgba(0,0,0,0.4)]",
```

And for each side's border, change `border-black/[0.08]` and `dark:border-white/[0.12]` patterns to just `border-white/[0.1]`. For example:

```typescript
"data-[side=right]:border-l data-[side=right]:border-white/[0.1]",
```

Remove all `data-[side=*]:dark:border-white/[0.12]` classes since we no longer need dark variants.

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/components/ui/dialog.tsx \
       apps/frontend/src/components/ui/sheet.tsx
git commit -m "feat(theme): fix dialog and sheet hardcoded colors for dark glass theme"
```

---

### Task 7: Fix Dashboard Component CSS Modules

**Files:**
- Modify: `apps/frontend/src/components/dashboard/team-activity-feed.module.css`
- Modify: `apps/frontend/src/components/dashboard/active-projects.module.css`
- Modify: `apps/frontend/src/components/dashboard/new-leads.module.css`
- Modify: `apps/frontend/src/components/dashboard/upcoming-deadlines.module.css`

These files have hardcoded hex colors that are accent/semantic colors (green for created, blue for updated, red for deleted, amber for leads, etc.). These colors are fine on dark backgrounds — they're bright accents that will have good contrast. **However**, verify each file for any hardcoded background colors or text colors that assume a light background.

- [ ] **Step 1: Audit team-activity-feed.module.css**

Read `apps/frontend/src/components/dashboard/team-activity-feed.module.css`. The hardcoded colors (`#10b981`, `#3b82f6`, `#ef4444`) are icon accent colors — these are fine on dark backgrounds. Check for any `background: white` or light-assuming text colors. If found, replace with CSS variable equivalents.

- [ ] **Step 2: Audit active-projects.module.css**

Read `apps/frontend/src/components/dashboard/active-projects.module.css`. The hardcoded `#10b981` / `#059669` are project status icon colors — fine on dark. Check for light-assuming backgrounds.

- [ ] **Step 3: Audit new-leads.module.css**

Read `apps/frontend/src/components/dashboard/new-leads.module.css`. The `#fbbf24` is an amber accent stripe — fine on dark. Check for light-assuming backgrounds.

- [ ] **Step 4: Audit upcoming-deadlines.module.css**

Read `apps/frontend/src/components/dashboard/upcoming-deadlines.module.css`. The urgency dot colors (`#ef4444`, `#f97316`, `#eab308`) are fine on dark. Check for light-assuming backgrounds.

- [ ] **Step 5: Fix any issues found and commit**

```bash
git add apps/frontend/src/components/dashboard/
git commit -m "feat(theme): audit and fix dashboard CSS modules for dark theme"
```

---

### Task 8: Fix Rich Text Editor Highlight

**Files:**
- Modify: `apps/frontend/src/components/ui/rich-text-editor.module.css`

- [ ] **Step 1: Find and fix hardcoded highlight color**

Read `apps/frontend/src/components/ui/rich-text-editor.module.css`. Find any `#fef08a` (yellow highlight) and replace with `hsl(50 90% 60% / 0.3)` for dark-friendly highlighting.

- [ ] **Step 2: Commit**

```bash
git add apps/frontend/src/components/ui/rich-text-editor.module.css
git commit -m "feat(theme): fix rich text editor highlight color for dark bg"
```

---

### Task 9: Remove .dark Class References Across Codebase

**Files:**
- Potentially multiple files referencing `:global(.dark)` or `dark:` variant

- [ ] **Step 1: Search for `:global(.dark)` in CSS module files**

Run: `cd apps/frontend && grep -r ":global(.dark)" src/ --include="*.css" -l`

For each file found, the `:global(.dark)` rules should be evaluated:
- If the dark style should be the default → merge it into the base rule and delete the `.dark` override
- If the dark style is no longer relevant → delete it

We already handled `input.module.css`, `textarea.module.css`, and `select.module.css` in earlier tasks. This step catches any remaining files.

- [ ] **Step 2: Search for `dark:` prefix in Tailwind classes**

Run: `cd apps/frontend && grep -rn "dark:" src/ --include="*.tsx" -l`

For each file found, evaluate the `dark:` variant:
- If the `dark:` value is what we want as default → replace `dark:X` with just `X` and remove the light-mode equivalent
- If it's irrelevant → remove it

We already handled `dialog.tsx` and `sheet.tsx`. This catches any others.

- [ ] **Step 3: Remove `@custom-variant dark` from index.css if no more `dark:` usage**

In `apps/frontend/src/index.css`, if no more `dark:` Tailwind classes remain in the codebase, remove:

```css
@custom-variant dark (&:is(.dark *));
```

If some `dark:` usage remains, keep it.

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/
git commit -m "feat(theme): remove .dark class references, dark is now default"
```

---

### Task 10: Visual QA — Page-by-Page Walkthrough

**Files:** None (manual verification)

- [ ] **Step 1: Run type-check**

Run: `cd apps/frontend && bun run tsc --noEmit`

Expected: No new type errors (pre-existing errors from the spec are acceptable).

- [ ] **Step 2: Run lint**

Run: `cd apps/frontend && bun run lint`

Expected: No new lint errors.

- [ ] **Step 3: Start dev server and verify each route**

Run: `cd apps/frontend && bun run dev`

Open browser and check each route. For each, verify:
- Background is dark (#0f1117)
- Text is readable (light on dark)
- Cards have glass effect (translucent, subtle border glow)
- No white/light backgrounds bleeding through
- No invisible text (dark-on-dark)
- No hardcoded light-theme colors remaining

Routes to check:
1. `/dashboard` — stat cards, project progress bars, activity feed
2. `/my-tasks` — task list and board views
3. `/tasks-by-me` — same layout as my-tasks
4. `/projects` — project cards
5. `/projects/:id/all-tasks` — task detail panel, sidebar
6. `/projects/:id/timeline` — Gantt chart
7. `/projects/:id/media` — file manager
8. `/projects/:id/pages` — page editor
9. `/settings` — settings page
10. `/` (landing) — unauthenticated state
11. Dialogs — open any create/edit dialog, verify glass effect
12. Dropdowns — click any dropdown menu, verify glass popover
13. Sidebar — navigation, project tree, user menu

- [ ] **Step 4: Fix any visual issues found**

For each broken element:
1. Identify the file (component or CSS module)
2. Find the hardcoded color or missing glass property
3. Replace with CSS variable or glass utility
4. Verify the fix

- [ ] **Step 5: Final commit**

```bash
git add apps/frontend/src/
git commit -m "feat(theme): fix visual issues from QA walkthrough"
```
