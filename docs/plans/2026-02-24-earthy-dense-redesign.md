# Earthy Dense UI Redesign — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Full aesthetic refresh — warm earth-tone palette, IBM Plex typography, max information density, compressed spacing — across all frontend pages and components.

**Architecture:** CSS-first approach. Phase 1 changes design tokens (colors, fonts, spacing, radius) which cascade globally. Phases 2-8 tighten individual components. No structural React changes in Phases 1-4; layout/component logic changes in Phases 5-8.

**Tech Stack:** CSS Modules, CSS custom properties, React 19, IBM Plex Sans/Mono (Google Fonts)

**Design doc:** `docs/plans/2026-02-24-earthy-dense-redesign-design.md`

---

### Task 1: Foundation — Design Tokens & Fonts

**Files:**
- Modify: `apps/frontend/src/styles/tokens.css`
- Modify: `apps/frontend/src/styles/status-colors.css`
- Modify: `apps/frontend/src/styles/reset.css`
- Modify: `apps/frontend/src/index.css`

**Step 1: Replace font imports in tokens.css**

In `tokens.css`, replace the Google Fonts import (line 1 of current file — note: the import is actually in tokens.css, not index.css):

Replace the `@import url(...)` line with:
```css
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400&display=swap');
```

**Step 2: Replace all `:root` CSS variables in tokens.css**

Replace the entire `:root` block with:
```css
:root {
  /* Colors - Light mode (warm stone palette) */
  --background: hsl(30 15% 97%);
  --foreground: hsl(25 10% 12%);
  --card: hsl(30 12% 99%);
  --card-foreground: hsl(25 10% 12%);
  --popover: hsl(30 12% 99%);
  --popover-foreground: hsl(25 10% 12%);
  --primary: hsl(225 45% 38%);
  --primary-foreground: hsl(0 0% 98%);
  --secondary: hsl(30 10% 93%);
  --secondary-foreground: hsl(25 10% 20%);
  --muted: hsl(30 10% 93%);
  --muted-foreground: hsl(25 8% 45%);
  --accent: hsl(30 12% 94%);
  --accent-foreground: hsl(25 10% 15%);
  --destructive: hsl(12 70% 50%);
  --destructive-foreground: hsl(0 0% 98%);
  --border: hsl(30 10% 87%);
  --input: hsl(30 10% 91%);
  --ring: hsl(225 45% 38%);
  --chart-1: hsl(12 70% 50%);
  --chart-2: hsl(155 45% 32%);
  --chart-3: hsl(225 45% 38%);
  --chart-4: hsl(38 90% 50%);
  --chart-5: hsl(280 40% 40%);

  /* Radius — sharper */
  --radius: 0.25rem;
  --radius-sm: 0.125rem;
  --radius-md: 0.1875rem;
  --radius-lg: 0.375rem;
  --radius-xl: 0.5rem;

  /* Typography */
  --font-sans: 'IBM Plex Sans', system-ui, sans-serif;
  --font-mono: 'IBM Plex Mono', ui-monospace, monospace;

  /* Spacing scale */
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
  --sidebar: hsl(25 12% 10%);
  --sidebar-foreground: hsl(30 10% 60%);
  --sidebar-primary: hsl(38 85% 55%);
  --sidebar-primary-foreground: hsl(25 12% 10%);
  --sidebar-accent: hsl(25 10% 15%);
  --sidebar-accent-foreground: hsl(0 0% 95%);
  --sidebar-border: hsl(25 10% 18%);
  --sidebar-ring: hsl(38 85% 55%);
}
```

**Step 3: Replace `.dark` block in tokens.css**

```css
.dark {
  --background: hsl(25 10% 8%);
  --foreground: hsl(30 10% 85%);
  --card: hsl(25 10% 10%);
  --card-foreground: hsl(30 10% 85%);
  --popover: hsl(25 10% 10%);
  --popover-foreground: hsl(30 10% 85%);
  --primary: hsl(225 45% 55%);
  --primary-foreground: hsl(0 0% 98%);
  --secondary: hsl(25 8% 15%);
  --secondary-foreground: hsl(30 10% 80%);
  --muted: hsl(25 8% 15%);
  --muted-foreground: hsl(30 8% 50%);
  --accent: hsl(25 8% 14%);
  --accent-foreground: hsl(30 10% 85%);
  --destructive: hsl(12 65% 55%);
  --destructive-foreground: hsl(0 0% 98%);
  --border: hsl(25 8% 18%);
  --input: hsl(25 8% 18%);
  --ring: hsl(225 45% 55%);
  --chart-1: hsl(12 65% 55%);
  --chart-2: hsl(155 40% 45%);
  --chart-3: hsl(225 45% 55%);
  --chart-4: hsl(38 80% 55%);
  --chart-5: hsl(280 45% 55%);
  --sidebar: hsl(25 10% 7%);
  --sidebar-foreground: hsl(30 8% 55%);
  --sidebar-primary: hsl(38 80% 50%);
  --sidebar-primary-foreground: hsl(0 0% 98%);
  --sidebar-accent: hsl(25 8% 12%);
  --sidebar-accent-foreground: hsl(30 10% 85%);
  --sidebar-border: hsl(25 8% 14%);
  --sidebar-ring: hsl(38 80% 50%);
}
```

**Step 4: Update status-colors.css with warm tones**

Replace all status/priority color values. Light mode statuses use warm-tinted HSL values. Dark mode statuses use rgba with warm tones. Priority colors get warmer. See design doc for exact values.

**Step 5: Update reset.css base font-size**

In `reset.css`, add `font-size: 13px;` to the `html` rule (sets body default to 13px). Change `line-height: 1.5` to `line-height: 1.4`.

**Step 6: Update index.css**

- Remove `.font-display` class (no more display font)
- Add `.font-mono { font-family: var(--font-mono); }` class
- Remove `--font-display` reference if any

**Step 7: Verify and commit**

Run: `cd apps/frontend && bun run tsc --noEmit`
Expected: No new type errors.

Run dev server briefly to verify colors/fonts load.

```bash
git add apps/frontend/src/styles/tokens.css apps/frontend/src/styles/status-colors.css apps/frontend/src/styles/reset.css apps/frontend/src/index.css
git commit -m "feat(ui): replace design tokens with warm earth-tone palette and IBM Plex fonts"
```

---

### Task 2: UI Primitives — Button, Input, Card, Badge, Dialog, Tabs, Select, Textarea

**Files:**
- Modify: `apps/frontend/src/components/ui/button.module.css`
- Modify: `apps/frontend/src/components/ui/input.module.css`
- Modify: `apps/frontend/src/components/ui/textarea.module.css`
- Modify: `apps/frontend/src/components/ui/card.module.css`
- Modify: `apps/frontend/src/components/ui/badge.module.css`
- Modify: `apps/frontend/src/components/ui/dialog.module.css`
- Modify: `apps/frontend/src/components/ui/tabs.module.css`
- Modify: `apps/frontend/src/components/ui/select.module.css`
- Modify: `apps/frontend/src/components/ui/tooltip.module.css`
- Modify: `apps/frontend/src/components/ui/popover.module.css`
- Modify: `apps/frontend/src/components/ui/dropdown-menu.module.css`
- Modify: `apps/frontend/src/components/ui/sheet.module.css`
- Modify: `apps/frontend/src/components/ui/alert-dialog.module.css`
- Modify: `apps/frontend/src/components/ui/separator.module.css`
- Modify: `apps/frontend/src/components/ui/avatar.module.css`
- Modify: `apps/frontend/src/components/ui/checkbox.module.css`
- Modify: `apps/frontend/src/components/ui/label.module.css`
- Modify: `apps/frontend/src/components/ui/toggle.module.css`
- Modify: `apps/frontend/src/components/ui/scroll-area.module.css`
- Modify: `apps/frontend/src/components/ui/skeleton.module.css`
- Modify: `apps/frontend/src/components/ui/sonner.module.css`
- Modify: `apps/frontend/src/components/ui/command.module.css`
- Modify: `apps/frontend/src/components/ui/calendar.module.css`
- Modify: `apps/frontend/src/components/ui/table.module.css`
- Modify: `apps/frontend/src/components/ui/breadcrumb.module.css`
- Modify: `apps/frontend/src/components/ui/rich-text-editor.module.css`

**Step 1: Compact button.module.css**

Key changes to `.button` base:
- `gap: 0.375rem` (was 0.5rem)
- `font-size: 0.8125rem` (was 0.875rem — 13px)
- `line-height: 1.125rem` (was 1.25rem)
- Remove `box-shadow` from outline variant (flatter look)

Size changes:
- `[data-size="default"]`: height `1.75rem` (was 2.25rem), padding `0.375rem 0.75rem` (was 0.5rem 1rem)
- `[data-size="xs"]`: height `1.25rem` (was 1.5rem), padding `0 0.375rem`, font-size `0.6875rem` (11px)
- `[data-size="sm"]`: height `1.5rem` (was 2rem), padding `0 0.5rem`
- `[data-size="lg"]`: height `2rem` (was 2.5rem), padding `0 1rem`
- `[data-size="icon"]`: `1.75rem x 1.75rem` (was 2.25rem)
- `[data-size="icon-xs"]`: `1.25rem x 1.25rem` (was 1.5rem)
- `[data-size="icon-sm"]`: `1.5rem x 1.5rem` (was 2rem)
- `[data-size="icon-lg"]`: `2rem x 2rem` (was 2.5rem)

SVG default: `0.875rem` (was 1rem). xs SVG: `0.625rem` (was 0.75rem).

**Step 2: Compact input.module.css**

- `.input`: height `1.75rem` (was 2.25rem), padding `0.25rem 0.5rem` (was 0.25rem 0.75rem), font-size `0.8125rem` (was 1rem), remove box-shadow
- Remove the `@media (min-width: 768px)` font-size override (no longer needed, base is already 13px)
- Focus ring: `2px` instead of `3px`

**Step 3: Compact textarea.module.css**

Read file first, then: reduce padding, font-size to 0.8125rem, line-height 1.4.

**Step 4: Compact card.module.css**

- `.card`: gap `0.5rem` (was 1.5rem), padding-top/bottom `0.5rem` (was 1.5rem), border-radius `var(--radius-lg)` (was --radius-xl)
- `.header`: gap `0.25rem` (was 0.5rem), padding-left/right `0.5rem` (was 1.5rem)
- `.card:where(.borderB) > .header`: padding-bottom `0.5rem` (was 1.5rem)
- `.description`: font-size `0.75rem` (was 0.875rem)
- `.content`: padding-left/right `0.5rem` (was 1.5rem)
- `.footer`: padding-left/right `0.5rem` (was 1.5rem)
- `.card:where(.borderT) > .footer`: padding-top `0.5rem` (was 1.5rem)

**Step 5: Compact badge.module.css**

- `.badge`: padding `0.0625rem 0.375rem` (was 0.125rem 0.5rem), font-size `0.6875rem` (was 0.75rem), line-height `0.875rem`, border-radius `var(--radius-sm)` (was 9999px — less rounded), font-family `var(--font-mono)`, gap `0.1875rem` (was 0.25rem)
- SVG: `0.625rem` (was 0.75rem)
- Focus ring: `2px` (was 3px)

**Step 6: Compact dialog.module.css**

- `.content`: gap `0.75rem` (was 1rem), padding `1rem` (was 1.5rem), border-radius `var(--radius-lg)`
- `.closeButton`: top `0.75rem`, right `0.75rem`
- `.header`: gap `0.25rem` (was 0.5rem)
- `.title`: font-size `0.875rem` (was 1.125rem)
- `.description`: font-size `0.75rem` (was 0.875rem)

**Step 7: Compact all remaining UI CSS modules**

For each remaining file, read it, then apply consistent density rules:
- Reduce all padding by ~40% (e.g., 1.5rem → 0.875rem, 1rem → 0.5rem, 0.5rem → 0.25rem)
- Reduce font-sizes: 0.875rem → 0.8125rem, 0.75rem → 0.6875rem
- Reduce heights: 2rem items → 1.75rem, 1.75rem → 1.5rem
- Reduce gaps by ~30-40%
- Keep border-radius using new token values

**Step 8: Type-check and commit**

Run: `cd apps/frontend && bun run tsc --noEmit`

```bash
git add apps/frontend/src/components/ui/
git commit -m "feat(ui): compact all UI primitives — smaller buttons, inputs, cards, badges, dialogs"
```

---

### Task 3: Layout Shell — Header, Sidebar, App Layout

**Files:**
- Modify: `apps/frontend/src/components/layout/header.module.css`
- Modify: `apps/frontend/src/components/layout/header.tsx` (reduce new task button size attribute if hardcoded)
- Modify: `apps/frontend/src/components/layout/app-sidebar.module.css`
- Modify: `apps/frontend/src/components/layout/app-sidebar.tsx` (adjust avatar size, font-family for labels)
- Modify: `apps/frontend/src/components/layout/app-layout.module.css`
- Modify: `apps/frontend/src/components/ui/sidebar.module.css`

**Step 1: Compact header.module.css**

- `.header`: height `2.25rem` (was 3.5rem), gap `0.375rem` (was 0.5rem), padding `0.375rem 0.5rem` (was 0 1rem)
- `.searchForm`: max-width `20rem` (was 24rem)
- `.searchInput`: height `1.5rem` (was 2rem), font-size `0.75rem` (was 0.875rem), padding-left `1.75rem`, border-radius `var(--radius-md)` (was 9999px)
- `.searchIcon`: width/height `0.75rem` (was 0.875rem), left `0.5rem`
- `.actions`: gap `0.25rem` (was 0.5rem), margin-left `0.375rem`
- `.viewToggle`: border-radius `var(--radius-sm)`, padding `1px`
- `.viewBtn`: height `1.375rem` (was 1.75rem), padding `0 0.375rem` (was 0.5rem), font-size `0.6875rem`
- `.viewIcon`: width/height `0.75rem` (was 0.875rem)
- `.newTaskBtn`: height `1.5rem` (was 2rem), border-radius `var(--radius-sm)`
- `.newTaskIcon`: width/height `0.75rem` (was 1rem), margin-right `0.125rem`

**Step 2: Compact app-sidebar.module.css**

- `.headerArea`: padding `0.5rem 0.75rem` (was 1rem 1.25rem)
- `.logoBox`: width/height `1.5rem` (was 2rem)
- `.logoIcon`: width/height `0.75rem` (was 1rem)
- `.logoTitle`: font-size `0.75rem` (was 0.875rem), change `font-family: var(--font-sans)` (remove display font)
- `.logoSubtitle`: font-size `9px` (was 10px), font-family `var(--font-mono)`
- `.projectsLabel`: font-size `9px` (was 10px), font-family `var(--font-mono)`
- `.userInfo`: font-size `0.75rem` (was 0.875rem)
- `.userName`: font-weight `500` (was 600)
- `.userEmail`: font-size `0.6875rem` (was 0.75rem)
- `.avatarRoot`: width/height `1.5rem` (was 2rem)
- `.avatarFallbackEl`: font-size `0.625rem` (was 0.75rem)

**Step 3: Compact sidebar.module.css**

Set `--sidebar-width: 220px` in `.sidebarWrapper` or update the SidebarProvider default.

- `.sidebarHeader`/`.sidebarFooter`: padding `0.375rem` (was 0.5rem), gap `0.25rem`
- `.sidebarGroup`: padding `0.375rem` (was 0.5rem)
- `.sidebarGroupLabel`: height `1.5rem` (was 2rem), font-size `0.625rem` (was 0.75rem), font-family `var(--font-mono)`, text-transform `uppercase`, letter-spacing `0.08em`
- `.sidebarMenu`: gap `0.125rem` (was 0.25rem)
- `.sidebarMenuButton`: padding `0.25rem 0.5rem` (was 0.5rem), font-size `0.75rem` (was 0.875rem), gap `0.375rem`
- `.sidebarMenuButton[data-size="default"]`: height `1.75rem` (was 2rem)
- `.sidebarMenuButton[data-size="sm"]`: height `1.375rem` (was 1.75rem), font-size `0.6875rem`
- `.sidebarMenuButton[data-size="lg"]`: height `2.25rem` (was 3rem)
- `.sidebarMenuBadge`: height `1rem` (was 1.25rem), min-width `1rem`, font-size `0.625rem` (was 0.75rem), font-family `var(--font-mono)`
- `.sidebarContent`: gap `0.25rem` (was 0.5rem)
- `.sidebarMenuSub`: margin-left/right `0.5rem` (was 0.875rem), padding-left `0.375rem`, gap `0.125rem`
- `.sidebarMenuSubButton`: height `1.375rem` (was 1.75rem), font-size `0.6875rem`, gap `0.375rem`
- Collapsed icon mode: `.sidebarMenuButton` forced to `1.75rem` (was 2rem)

**Step 4: Update sidebar width in sidebar.tsx**

Look for `--sidebar-width` default value in the SidebarProvider component. Change from `16rem` (256px) or `--sidebar-width: 16rem` to `13.75rem` (220px). The constant may be in the TSX file or passed as a CSS variable.

**Step 5: Update header.tsx if needed**

Check if button sizes are hardcoded as props (e.g., `size="sm"`). May need to change to `size="xs"` for the New Task button. Also check breadcrumb font-size overrides.

**Step 6: Type-check and commit**

Run: `cd apps/frontend && bun run tsc --noEmit`

```bash
git add apps/frontend/src/components/layout/ apps/frontend/src/components/ui/sidebar.module.css
git commit -m "feat(ui): compact layout shell — shorter header, narrower sidebar, denser navigation"
```

---

### Task 4: Dashboard Page

**Files:**
- Modify: `apps/frontend/src/pages/dashboard.module.css`
- Modify: `apps/frontend/src/pages/dashboard.tsx`
- Modify: `apps/frontend/src/components/dashboard/stat-card.module.css`
- Modify: `apps/frontend/src/components/dashboard/stat-card.tsx`
- Modify: `apps/frontend/src/components/dashboard/task-distribution.module.css`
- Modify: `apps/frontend/src/components/dashboard/active-projects.module.css`
- Modify: `apps/frontend/src/components/dashboard/recent-tasks.module.css`
- Modify: `apps/frontend/src/components/dashboard/new-leads.module.css`
- Modify: `apps/frontend/src/components/dashboard/approve-lead-dialog.module.css`

**Step 1: Compact dashboard.module.css**

- `.page`: padding `var(--space-6)` (12px, was 1.5rem/24px)
- `.pageSpacing > * + *`: margin-top `var(--space-6)` (12px, was 2rem)
- `.headerTitle`: font-size `1.125rem` (was 1.875rem), font-weight `600` (was 700)
- `.headerSubtitle`: font-size `0.75rem` (was 0.875rem), margin-top `0.125rem`
- `.statsGrid`: gap `0.5rem` (was 1rem)
- `.contentGrid`: gap `0.75rem` (was 1.5rem)
- `.mainCol > * + *`: margin-top `0.75rem` (was 1.5rem)
- `.sideCol > * + *`: margin-top `0.75rem` (was 1.5rem)

**Step 2: Compact stat-card.module.css**

- `.card`: remove left border (border-left: none), padding: 0
- `.content`: padding `0.75rem` (was 1.25rem)
- `.textGroup`: gap `0.125rem` (was 0.375rem)
- `.title`: font-size `0.5625rem` (9px), font-family `var(--font-mono)`
- `.value`: font-size `1.5rem` (was 2.25rem), line-height `1.75rem`, font-weight `700`
- `.iconWrapper`: padding `0.375rem` (was 0.625rem), border-radius `var(--radius)`
- `.icon`: width/height `1rem` (was 1.25rem)

**Step 3: Compact all other dashboard component CSS**

Read each file, then reduce padding/gaps/font-sizes consistently:
- `task-distribution.module.css` — reduce padding/spacing
- `active-projects.module.css` — tighter project rows
- `recent-tasks.module.css` — denser task rows (target 28px height)
- `new-leads.module.css` — compact lead items
- `approve-lead-dialog.module.css` — tighter dialog content

**Step 4: Type-check and commit**

Run: `cd apps/frontend && bun run tsc --noEmit`

```bash
git add apps/frontend/src/pages/dashboard.module.css apps/frontend/src/pages/dashboard.tsx apps/frontend/src/components/dashboard/
git commit -m "feat(ui): compact dashboard — denser stats, tighter content grid"
```

---

### Task 5: Task Components

**Files:**
- Modify: `apps/frontend/src/components/tasks/task-card.module.css`
- Modify: `apps/frontend/src/components/tasks/task-list.module.css`
- Modify: `apps/frontend/src/components/tasks/task-board.module.css`
- Modify: `apps/frontend/src/components/tasks/task-board-column.module.css`
- Modify: `apps/frontend/src/components/tasks/task-detail.module.css`
- Modify: `apps/frontend/src/components/tasks/task-detail.tsx` (reduce panel width prop if needed)
- Modify: `apps/frontend/src/components/tasks/task-form.module.css`
- Modify: `apps/frontend/src/components/tasks/task-form.tsx` (reduce dialog width if hardcoded)
- Modify: `apps/frontend/src/components/tasks/task-filters.module.css`
- Modify: `apps/frontend/src/components/tasks/task-detail-fields.module.css`
- Modify: `apps/frontend/src/components/tasks/task-attachments.module.css`
- Modify: `apps/frontend/src/components/tasks/task-status-badge.module.css`
- Modify: `apps/frontend/src/components/tasks/task-priority-badge.module.css`
- Modify: `apps/frontend/src/components/tasks/task-activity-timeline.module.css`
- Modify: `apps/frontend/src/components/tasks/task-comments.module.css`
- Modify: `apps/frontend/src/components/tasks/comment-content.module.css`
- Modify: `apps/frontend/src/components/tasks/comment-editor.module.css`

**Step 1: Compact task-card.module.css**

- `.cardContent`: padding `0.5rem` (was 0.75rem)
- `.row`: gap `0.375rem` (was 0.5rem)
- `.title`: font-size `0.8125rem` (was 0.875rem), line-height `1.125rem`
- `.meta`: gap `0.375rem` (was 0.5rem), margin-top `0.25rem` (was 0.5rem)
- `.label`: padding `0.0625rem 0.25rem` (was 0.125rem 0.375rem), font-size `9px` (was 10px)
- `.labelDot`: width/height `0.25rem` (was 0.375rem)
- `.dragIcon`: width/height `0.75rem` (was 1rem)

**Step 2: Compact task-list.module.css, task-board.module.css, task-board-column.module.css**

Read each, then:
- Board column gap between cards: `0.25rem` (was likely 0.5rem+)
- Board column width: `220px` if hardcoded (was ~280px)
- Column header: font-size `0.6875rem`, uppercase, font-family `var(--font-mono)`
- List view gap: `0.25rem` between rows

**Step 3: Compact task-detail.module.css**

- `.dialogContent`: max-width `960px` (was 1024px)
- `.leftPanel`: padding `0.75rem` (was 1.5rem)
- `.headerMargin`: margin-bottom `0.75rem` (was 1.25rem)
- `.headerTitle`: font-size `0.6875rem` (was 0.75rem)
- `.leftContent > * + *`: margin-top `0.75rem` (was 1.25rem)
- `.rightPanel` (desktop): width `240px` (was 280px)
- `.propertiesHeader`: padding `0.5rem 0.75rem` (was 1rem 1.25rem)
- `.propertiesBody`: padding `0.5rem` (was 1rem)
- `.propertiesBody > * + *`: margin-top `0.125rem` (was 0.25rem)
- `.propertyRow`: min-height `28px` (was 32px), gap `0.375rem`
- `.propertyIcon`: width/height `0.75rem` (was 0.875rem)
- `.propertyLabelText`: font-size `0.6875rem` (was 0.75rem)
- `.timestampsSection`: padding `0 0.75rem 0.75rem` (was 1.25rem)
- `.timestampText`: font-size `0.625rem` (was 11px), font-family `var(--font-mono)`
- `.deleteButton`: height `1.5rem` (was 2rem), font-size `0.6875rem`
- `.divider` margins: `0.375rem` (was 0.75rem)

**Step 4: Compact task-form.module.css**

- `.dialogContent`: max-width `960px` (was 1024px)
- `.leftPanel`: padding `0.75rem` (was 1.5rem)
- `.headerMargin`: margin-bottom `0.75rem` (was 1.25rem)
- `.leftContent > * + *`: margin-top `0.75rem` (was 1.25rem)
- `.titleRow`: gap `0.5rem` (was 0.75rem)
- `.titleInput`: font-size `1rem` (was 1.25rem), font-weight `600` (was 700)
- `.footer`: margin-top `0.75rem` (was 1.5rem), padding-top `0.5rem` (was 1rem)
- `.rightPanel` (desktop): width `240px` (was 280px)
- `.propertiesHeader`: padding `0.5rem 0.75rem` (was 1rem 1.25rem)
- `.propertiesBody`: padding `0.5rem` (was 1rem)
- `.propertyRow`: min-height `28px` (was 32px)
- All dot classes, date triggers, assignee triggers: font-family `var(--font-mono)` where numeric/label

**Step 5: Compact task-filters.module.css**

Read and reduce: filter button heights, padding, gaps, font-sizes.

**Step 6: Compact task-status-badge.module.css and task-priority-badge.module.css**

Read each, then: reduce badge sizes, use `var(--font-mono)`, smaller text (0.625rem / 10px).

**Step 7: Compact task-activity-timeline.module.css, task-comments.module.css, comment-content.module.css, comment-editor.module.css**

Read each, then: reduce timeline item spacing, comment padding, editor height. Timestamps should use `var(--font-mono)` at 0.625rem.

**Step 8: Compact task-attachments.module.css, task-detail-fields.module.css**

Read and reduce.

**Step 9: Type-check and commit**

Run: `cd apps/frontend && bun run tsc --noEmit`

```bash
git add apps/frontend/src/components/tasks/
git commit -m "feat(ui): compact task components — denser cards, tighter detail/form dialogs"
```

---

### Task 6: Project, Module, Shared Components

**Files:**
- Modify: `apps/frontend/src/components/projects/project-card.module.css`
- Modify: `apps/frontend/src/components/projects/project-form.module.css`
- Modify: `apps/frontend/src/components/projects/project-members-dialog.module.css`
- Modify: `apps/frontend/src/components/projects/sub-project-form.module.css`
- Modify: `apps/frontend/src/components/projects/win-project-dialog.module.css`
- Modify: `apps/frontend/src/components/modules/module-card.module.css`
- Modify: `apps/frontend/src/components/modules/module-section.module.css`
- Modify: `apps/frontend/src/components/modules/module-form.module.css`
- Modify: `apps/frontend/src/components/shared/property-row.module.css`
- Modify: `apps/frontend/src/components/shared/user-combobox.module.css`
- Modify: `apps/frontend/src/components/shared/label-combobox.module.css`
- Modify: `apps/frontend/src/components/shared/date-picker-field.module.css`
- Modify: `apps/frontend/src/components/shared/company-combobox.module.css`
- Modify: `apps/frontend/src/components/shared/division-combobox.module.css`

**Step 1: Compact all project component CSS files**

Read each file, then apply density rules:
- Project card: reduce padding, title size, meta spacing
- Project form: tighter field gaps, smaller title input
- Members dialog, win-project, sub-project: tighter dialog padding, smaller controls

**Step 2: Compact all module component CSS files**

Read each file, then:
- Module card: reduce padding, gaps
- Module section: reduce header/content spacing, smaller section titles
- Module form: tighter dialog

**Step 3: Compact all shared component CSS files**

Read each, then:
- `property-row.module.css`: row height 24px, icon 14px → 0.75rem, label 11px, value 13px
- Combobox files: reduce trigger heights, dropdown item heights, font sizes
- Date picker: smaller trigger, tighter calendar

**Step 4: Type-check and commit**

Run: `cd apps/frontend && bun run tsc --noEmit`

```bash
git add apps/frontend/src/components/projects/ apps/frontend/src/components/modules/ apps/frontend/src/components/shared/
git commit -m "feat(ui): compact project, module, and shared components"
```

---

### Task 7: Pages

**Files:**
- Modify: `apps/frontend/src/pages/project-detail.module.css`
- Modify: `apps/frontend/src/pages/project-layout.module.css`
- Modify: `apps/frontend/src/pages/projects.module.css`
- Modify: `apps/frontend/src/pages/project-sub-projects.module.css`
- Modify: `apps/frontend/src/pages/settings.module.css`
- Modify: `apps/frontend/src/pages/timeline.module.css`
- Modify: `apps/frontend/src/pages/media.module.css`
- Modify: `apps/frontend/src/pages/pages-list.module.css`
- Modify: `apps/frontend/src/pages/page-editor.module.css`
- Modify: `apps/frontend/src/pages/landing.module.css`
- Modify: `apps/frontend/src/pages/callback.module.css`
- Modify: `apps/frontend/src/pages/logout.module.css`

**Step 1: Compact project-detail.module.css**

- `.filtersRow`: padding `0.375rem 0.75rem` (was 1.5rem sides, 0.75rem top/bottom), gap `0.5rem` (was 0.75rem)
- `.searchInput`: height `1.5rem` (was 2rem), font-size `0.75rem`, width `180px` (was 220px)
- `.moduleList`: padding `0.75rem` (was 1.5rem)
- `.moduleList > * + *`: margin-top `0.5rem` (was 1rem)
- `.emptyState`: padding-top/bottom `3rem` (was 5rem), gap `0.5rem`
- `.emptyIcon`: width/height `1.5rem` (was 2rem)
- `.emptySubtitle`: font-size `0.75rem` (was 0.875rem)

**Step 2: Compact all other page CSS files**

Read each, then apply consistent page-level density:
- All `.page` classes: padding `0.75rem` (was 1.5rem typically)
- Page titles: font-size `1.125rem`, font-weight `600`
- Section spacing: reduce by ~40%
- Grid gaps: reduce by ~40%

For pages with minimal CSS (callback, logout, landing): slight tweaks only.

**Step 3: Type-check and commit**

Run: `cd apps/frontend && bun run tsc --noEmit`

```bash
git add apps/frontend/src/pages/
git commit -m "feat(ui): compact all pages — tighter padding, smaller titles, denser grids"
```

---

### Task 8: Timeline, Media, Notification Components

**Files:**
- Modify: `apps/frontend/src/components/timeline/gantt-chart.module.css`
- Modify: `apps/frontend/src/components/timeline/gantt-timeline-grid.module.css`
- Modify: `apps/frontend/src/components/timeline/gantt-task-panel.module.css`
- Modify: `apps/frontend/src/components/media/media-grid.module.css`
- Modify: `apps/frontend/src/components/media/media-table.module.css`
- Modify: `apps/frontend/src/components/media/media-upload-dialog.module.css`
- Modify: `apps/frontend/src/components/media/media-header.module.css`
- Modify: `apps/frontend/src/components/layout/notification-bell.module.css`

**Step 1: Compact timeline CSS files**

Read each, then:
- Gantt row heights: reduce by ~20%
- Task panel: tighter item spacing
- Grid: smaller date headers, tighter column widths
- Font-sizes: reduce to 11px for labels, 10px for dates

**Step 2: Compact media CSS files**

Read each, then:
- Media grid: smaller cards, tighter gap (0.5rem)
- Media table: smaller row heights (28px), smaller font
- Media header: compact controls
- Upload dialog: tighter padding

**Step 3: Compact notification-bell.module.css**

Read and reduce sizing.

**Step 4: Final type-check and lint**

Run: `cd apps/frontend && bun run tsc --noEmit && bun run lint`

```bash
git add apps/frontend/src/components/timeline/ apps/frontend/src/components/media/ apps/frontend/src/components/layout/notification-bell.module.css
git commit -m "feat(ui): compact timeline, media, and notification components"
```

---

## Execution Notes

- **Order matters**: Task 1 (tokens) must come first as all other CSS depends on the variables.
- **Tasks 2-8 can be parallelized** where subagents work on different file groups simultaneously.
- **No test framework** — verify via `tsc --noEmit` and visual inspection of dev server.
- **CSS-only changes** are safe — they don't change component behavior, just visual presentation.
- **TSX changes are minimal** — only where sizes are hardcoded as props or widths are constants in code.
- Each task is one commit. Total: 8 commits.
