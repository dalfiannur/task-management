# Dark Glassmorphism Theme — Design Spec

## Overview

Replace the current light theme with a dark glassmorphism theme app-wide, matching the Stitch design mockup ("Dashboard V2 - Refined", project `9411517811647657499`). This is a visual-only change — no layout, data, or component structure modifications.

## Decisions

- **Dark glassmorphism** matching the Stitch design aesthetic
- **App-wide** — every page, sidebar, all components
- **Theme only** — no dashboard layout or component arrangement changes
- **Replace entirely** — dark-only, no light theme toggle
- **Full glassmorphism** — backdrop blur, translucent surfaces, layered shadows on all surfaces
- **CSS Variables Override** approach — swap `:root` palette in `tokens.css`, add glass utility classes in `index.css`

## 1. Color Palette

Replace `:root` in `apps/frontend/src/styles/tokens.css` with the dark glassmorphism palette. Remove the `.dark` class variant entirely.

### Core Palette

| Variable | Current (Light) | New (Dark Glassmorphism) | Notes |
|----------|----------------|--------------------------|-------|
| `--background` | `hsl(35 25% 97%)` | `hsl(228 20% 7%)` | #0f1117 — near black with blue tint |
| `--foreground` | `hsl(20 15% 10%)` | `hsl(220 14% 90%)` | #e5e7eb — light gray text |
| `--card` | `hsl(36 20% 99%)` | `hsl(228 20% 10%)` | Slightly lighter than background |
| `--card-foreground` | `hsl(20 15% 10%)` | `hsl(220 14% 90%)` | Same as foreground |
| `--popover` | `hsl(36 20% 99%)` | `hsl(228 20% 10%)` | Same as card |
| `--popover-foreground` | `hsl(20 15% 10%)` | `hsl(220 14% 90%)` | Same as foreground |
| `--primary` | `hsl(225 60% 42%)` | `hsl(217 91% 60%)` | #3b82f6 — vibrant blue |
| `--primary-foreground` | `hsl(0 0% 98%)` | `hsl(0 0% 98%)` | White (unchanged) |
| `--secondary` | `hsl(35 18% 92%)` | `hsl(228 15% 15%)` | Dark surface |
| `--secondary-foreground` | `hsl(20 15% 15%)` | `hsl(220 14% 82%)` | Light text |
| `--muted` | `hsl(35 15% 92%)` | `hsl(228 12% 14%)` | Subtle dark surface |
| `--muted-foreground` | `hsl(20 10% 40%)` | `hsl(220 9% 56%)` | #8b8fa3 — subdued text |
| `--accent` | `hsl(35 20% 93%)` | `hsl(228 15% 13%)` | Hover/active surface |
| `--accent-foreground` | `hsl(20 15% 12%)` | `hsl(220 14% 90%)` | Light text |
| `--destructive` | `hsl(8 75% 52%)` | `hsl(0 84% 60%)` | Brighter red for dark bg |
| `--destructive-foreground` | `hsl(0 0% 98%)` | `hsl(0 0% 98%)` | White (unchanged) |
| `--border` | `hsl(30 15% 85%)` | `hsl(228 10% 18%)` | Subtle dark border |
| `--input` | `hsl(30 15% 88%)` | `hsl(228 10% 18%)` | Same as border |
| `--ring` | `hsl(225 60% 42%)` | `hsl(217 91% 60%)` | Matches primary |

### Sidebar Palette

| Variable | Current | New | Notes |
|----------|---------|-----|-------|
| `--sidebar` | `hsl(20 18% 11%)` | `hsl(235 25% 13%)` | #1a1b2e — dark navy |
| `--sidebar-foreground` | `hsl(30 12% 62%)` | `hsl(220 9% 56%)` | Subdued text |
| `--sidebar-primary` | `hsl(36 95% 52%)` | `hsl(217 91% 60%)` | Blue (was amber) |
| `--sidebar-primary-foreground` | `hsl(20 18% 11%)` | `hsl(0 0% 98%)` | White |
| `--sidebar-accent` | `hsl(20 14% 16%)` | `hsl(235 20% 17%)` | Hover state |
| `--sidebar-accent-foreground` | `hsl(35 10% 92%)` | `hsl(220 14% 90%)` | Light text |
| `--sidebar-border` | `hsl(20 12% 19%)` | `hsl(235 15% 18%)` | Subtle border |
| `--sidebar-ring` | `hsl(36 95% 52%)` | `hsl(217 91% 60%)` | Matches sidebar-primary |

### Chart/Accent Palette

| Variable | New Value | Color |
|----------|-----------|-------|
| `--chart-1` | `hsl(217 91% 60%)` | Blue — Total Tasks |
| `--chart-2` | `hsl(160 59% 38%)` | Emerald — Done |
| `--chart-3` | `hsl(38 92% 50%)` | Amber — In Progress |
| `--chart-4` | `hsl(258 90% 66%)` | Violet — Active Projects |
| `--chart-5` | `hsl(0 84% 60%)` | Red — Destructive |

### Radius

Keep current value: `--radius: 0.375rem`. No change.

### Font

Keep current: `--font-sans: 'Google Sans'`, `--font-mono: 'Google Sans Mono'`. No change.

## 2. Glass Effect System

### New CSS Variables (added to `:root` in `tokens.css`)

```css
--glass-bg: rgba(255, 255, 255, 0.04);
--glass-border: rgba(255, 255, 255, 0.08);
--glass-shadow: 0 4px 24px rgba(0, 0, 0, 0.2);
--glass-blur: 12px;
```

### Utility Classes (added to `index.css` in `@layer base`)

#### `.glass-card`
For cards, panels, stat boxes — the main glass surface.
```css
.glass-card {
  background: var(--glass-bg);
  backdrop-filter: blur(var(--glass-blur));
  -webkit-backdrop-filter: blur(var(--glass-blur));
  border: 1px solid var(--glass-border);
  box-shadow: var(--glass-shadow);
  border-radius: var(--radius-xl);
}
```

#### `.glass-sidebar`
For sidebar navigation — subtler than cards.
```css
.glass-sidebar {
  background: var(--sidebar);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border-right: 1px solid var(--glass-border);
}
```

#### `.glass-input`
For input fields, textareas, selects.
```css
.glass-input {
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
}
```

#### `.glass-popover`
For dropdowns, tooltips, dialogs — higher opacity for readability over content.
```css
.glass-popover {
  background: hsl(228 20% 10% / 0.9);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}
```

### Performance Rule

No glass-on-glass stacking. Cards sit on the solid `--background`, popovers sit on cards. Only one blur layer at a time.

## 3. Component Changes

### Tier 1: Auto-adapt (0 code changes)

These shadcn/ui components already reference CSS variables and auto-adapt when the palette changes:

Badge, Button, Label, Separator, Skeleton, Avatar, Breadcrumb, Tabs, Toggle, Checkbox, Calendar, Table, Progress bars, Sonner toasts.

### Tier 2: Add Glass Classes (~15 files)

| File | Class | Change |
|------|-------|--------|
| `components/ui/card.tsx` | `.glass-card` | Add to Card root element |
| `components/layout/app-sidebar.tsx` | `.glass-sidebar` | Add to Sidebar wrapper |
| `components/ui/input.tsx` | `.glass-input` | Add to Input root |
| `components/ui/textarea.tsx` | `.glass-input` | Add to Textarea root |
| `components/ui/select.tsx` | `.glass-input` / `.glass-popover` | Trigger gets glass-input, Content gets glass-popover |
| `components/ui/dropdown-menu.tsx` | `.glass-popover` | Add to DropdownMenuContent |
| `components/ui/popover.tsx` | `.glass-popover` | Add to PopoverContent |
| `components/ui/tooltip.tsx` | `.glass-popover` | Add to TooltipContent |
| `components/ui/dialog.tsx` | `.glass-popover` | Add to DialogContent |
| `components/ui/command.tsx` | `.glass-popover` | Add to Command root when used as dropdown |

All additions use `cn("glass-card", existingClasses)` pattern.

### Tier 3: CSS Module Audit (~20 files)

Audit each `.module.css` file for hardcoded light-theme colors. For each:

1. If the value can map to a CSS variable → replace with `var(--muted-foreground)` etc.
2. If the rule duplicates Tailwind → delete and add the Tailwind class in the component
3. If the file becomes empty → delete the module file and its import

Known files requiring audit:
- `stat-card.module.css`
- `team-activity-feed.module.css`
- `active-projects.module.css`
- `task-card.module.css`
- `task-board.module.css`
- `task-board-column.module.css`
- `task-list.module.css`
- `gantt-chart.module.css`
- `gantt-task-panel.module.css`
- `gantt-timeline-grid.module.css`
- `media-section.module.css`
- `media-header.module.css`
- `media-grid.module.css`
- `media-table.module.css`
- `folder-grid.module.css`
- `folder-card.module.css`
- `file-manager-*.module.css` (breadcrumb, toolbar, sidebar, content)
- `page-editor.module.css`
- `rich-text-editor.module.css`
- `module-card.module.css`

## 4. Edge Cases

### Prose / Rich Text
- `.prose mark` uses hardcoded `#fef08a`. Replace with `background-color: hsl(50 90% 60% / 0.3)` for dark-friendly highlight.

### Gantt Chart / Timeline
- Three CSS module files with likely hardcoded grid/bar colors. Audit inline styles in components as well — bar colors may be set programmatically.

### Landing & Callback Pages
- Render outside AuthenticatedLayout (no sidebar). The `body { background: var(--background) }` in `reset.css` ensures dark background. Verify `landing.module.css` and `callback.module.css` don't hardcode light backgrounds.

### Status Colors (`status-colors.css`)
- These are accent colors on dark backgrounds. Verify contrast ratios meet WCAG AA (4.5:1 for text, 3:1 for UI).

### Scrollbar Styling
- `.custom-scrollbar` uses `color-mix(in srgb, var(--foreground)...)` — auto-adapts. Verify thumb visibility.

## 5. What's NOT Changing

- **No layout changes** — component arrangement, grid structure, responsive breakpoints stay as-is
- **No font change** — keeping Google Sans / Google Sans Mono
- **No new components** — not adding top bar search/notifications from the Stitch design
- **No data/hook changes** — purely visual, no GraphQL or state modifications
- **No border-radius changes** — keeping current `--radius: 0.375rem`
- **No commented-out component re-enablement** — MyAssignedTasks, UpcomingDeadlines, RecentTasks stay hidden

## 6. Migration Order

1. `tokens.css` — palette swap + glass variables
2. `index.css` — glass utility classes
3. shadcn/ui primitives — glass classes on shared components
4. Layout — sidebar + header
5. CSS module audit — fix hardcoded colors
6. Visual QA — page-by-page walkthrough

## 7. Verification

After implementation, verify each major route:
- `/dashboard` — stat cards, project progress, activity feed
- `/my-tasks` — task list/board views
- `/tasks-by-me` — same as my-tasks
- `/projects` — project cards
- `/projects/:id/all-tasks` — task detail panels
- `/projects/:id/timeline` — Gantt chart
- `/projects/:id/media` — file manager
- `/projects/:id/pages` — page editor
- `/settings` — settings page
- `/` (landing) — unauthenticated page
- `/callback` — OIDC callback

Check for: invisible text, broken contrast, hardcoded light colors, missing glass effects, double blur layers.
