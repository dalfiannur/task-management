# Earthy Dense UI Redesign

**Date:** 2026-02-24
**Goal:** Full aesthetic refresh with maximum information density (ClickUp-level), warm productivity aesthetic, and major UX improvements across all pages and components.

## Design Tokens

### Color Palette — Light Mode

```css
/* Base neutrals (warm stone) */
--background: hsl(30 15% 97%);        /* Warm off-white page bg */
--foreground: hsl(25 10% 12%);        /* Warm near-black text */
--card: hsl(30 12% 99%);              /* Card surfaces */
--muted: hsl(30 10% 93%);             /* Subtle backgrounds */
--muted-foreground: hsl(25 8% 45%);   /* Secondary text */
--border: hsl(30 10% 87%);            /* Warm gray borders */
--input: hsl(30 10% 91%);             /* Input borders */
--ring: hsl(225 45% 38%);             /* Focus ring */

/* Accent colors */
--primary: hsl(225 45% 38%);          /* Deep indigo */
--primary-foreground: hsl(0 0% 98%);
--secondary: hsl(30 10% 93%);         /* Warm muted */
--secondary-foreground: hsl(25 10% 20%);
--accent: hsl(30 12% 94%);            /* Warm accent bg */
--accent-foreground: hsl(25 10% 15%);
--destructive: hsl(12 70% 50%);       /* Terracotta */
--destructive-foreground: hsl(0 0% 98%);

/* Sidebar */
--sidebar: hsl(25 12% 10%);           /* Dark warm brown-black */
--sidebar-foreground: hsl(30 10% 60%);
--sidebar-primary: hsl(38 85% 55%);   /* Amber accent */
--sidebar-primary-foreground: hsl(25 12% 10%);
--sidebar-accent: hsl(25 10% 15%);
--sidebar-accent-foreground: hsl(0 0% 95%);
--sidebar-border: hsl(25 10% 18%);
--sidebar-ring: hsl(38 85% 55%);
```

### Color Palette — Dark Mode

```css
--background: hsl(25 10% 8%);
--foreground: hsl(30 10% 85%);
--card: hsl(25 10% 10%);
--muted: hsl(25 8% 15%);
--muted-foreground: hsl(30 8% 50%);
--border: hsl(25 8% 18%);
--input: hsl(25 8% 18%);
--ring: hsl(225 45% 55%);

--primary: hsl(225 45% 55%);
--primary-foreground: hsl(0 0% 98%);
--secondary: hsl(25 8% 15%);
--secondary-foreground: hsl(30 10% 80%);
--accent: hsl(25 8% 14%);
--accent-foreground: hsl(30 10% 85%);
--destructive: hsl(12 65% 55%);
--destructive-foreground: hsl(0 0% 98%);
```

### Status Colors (updated for warmth)

```css
.status-backlog:      hsl(30 8% 93%) bg / hsl(25 8% 35%) text
.status-todo:         hsl(225 40% 92%) bg / hsl(225 50% 40%) text
.status-in-progress:  hsl(38 80% 90%) bg / hsl(38 70% 35%) text
.status-in-review:    hsl(280 35% 92%) bg / hsl(280 40% 40%) text
.status-done:         hsl(155 35% 90%) bg / hsl(155 45% 30%) text
.status-cancelled:    hsl(12 55% 92%) bg / hsl(12 55% 40%) text
```

### Typography

**Fonts:**
- Body: `'IBM Plex Sans', system-ui, sans-serif` (replaces DM Sans)
- Mono: `'IBM Plex Mono', monospace` (for badges, labels, timestamps)
- No display font (Outfit removed)

**Scale:**
| Role | Size | Weight | Font |
|------|------|--------|------|
| Page title | 1.125rem (18px) | 600 | Sans |
| Section title | 0.8125rem (13px) | 600 | Sans |
| Body / default | 0.8125rem (13px) | 400 | Sans |
| Small / labels | 0.6875rem (11px) | 500 | Mono |
| Tiny / metadata | 0.625rem (10px) | 400 | Mono |

### Spacing

Base unit: 2px. Compressed from current.

| Token | Value |
|-------|-------|
| --space-1 | 2px |
| --space-2 | 4px |
| --space-3 | 6px |
| --space-4 | 8px |
| --space-5 | 10px |
| --space-6 | 12px |
| --space-8 | 16px |
| --space-10 | 20px |
| --space-12 | 24px |

**Key reductions:**
- Page padding: 24px -> 12px
- Card internal padding: 24px -> 8px
- Section gaps: 32px -> 12px
- Inter-element gaps: 20px -> 8px

### Border Radius

| Token | Value | Was |
|-------|-------|-----|
| --radius | 4px | 8px |
| --radius-sm | 2px | 4px |
| --radius-md | 3px | 6px |
| --radius-lg | 6px | 8px |
| --radius-xl | 8px | 12px |

---

## Layout Changes

### Header
- Height: 56px -> 36px
- Padding: 1rem -> 6px 8px
- Search: max-width 20rem
- View toggle buttons: 24px square
- New Task button: 26px height, 11px font
- Breadcrumb: 11px font

### Sidebar
- Width: ~260px -> 220px
- Header: 32px height
- Project items: padding 4px 8px, 12px font
- Active indicator: 2px left amber border
- User avatar: 24px (was 32px)
- Section labels: 10px uppercase mono

### Content Area
- Padding: 24px -> 12px
- Page title: 18px semibold, inline with actions
- Filter-to-title gap: 4px
- Content grid/list gap: 8px

### Task Detail Dialog
- Max width: 1024px -> 960px
- Left panel padding: 24px -> 12px
- Right panel: 280px -> 240px
- Title: inline editable, 16px semibold
- Property rows: 24px tall, no dividers
- Activity timestamps: 11px mono

### Task Form Dialog
- Max width: reduced to 480px
- Single column, vertical stack
- Field gaps: 6px
- Properties: 2-col dropdown grid
- Create button: 26px height

### Dashboard
- Stat cards -> single inline metric strip (16px numbers, 11px labels)
- Recent tasks: dense rows (28px height)
- Active projects: compact rows with inline progress bars

---

## Component Changes

### Task Card (List View)
- No card wrapper, just rows with subtle bottom border
- 28px row height
- Priority: 4px colored dot
- Status: colored text in 10px mono
- Assignee: 18px avatar
- Labels: tiny colored dots (max 2 + overflow)
- Due date: 11px mono, terracotta when overdue

### Task Card (Board View)
- 6px padding, no shadow (border only)
- ~48px height for 2-line cards
- 4px gap between cards
- Column width: 220px
- Column header: 11px uppercase mono

### Module Section
- No card wrapper, collapsible header row
- Inline 3px progress bar in header
- 2px left colored border on expanded

### Property Row
- 24px row height
- Icon: 14px
- Label: 72px fixed width, 11px muted, right-aligned
- Value: 13px, clickable for inline edit

### Buttons
| Size | New height |
|------|-----------|
| xs | 20px |
| sm | 24px |
| default | 28px |
| lg | 32px |
- Horizontal padding: -25%
- Border-radius: 3px

### Inputs
- Height: 36px -> 28px
- Font: 13px
- Padding: 4px 8px

### Badges
- Inline (lists): colored text only, 10px mono
- Standalone (detail): 18px pill, 2px radius, 10px mono

### Sidebar Project Items
- 28px row height
- Amber left border for active
- Right-aligned task count (10px mono)
- No chevron

---

## UX Improvements

### Inline Editing
- Task title: click to edit in list/detail
- Properties: click value -> inline dropdown
- Description: click to expand editable textarea, auto-save on blur
- Module names: double-click to rename

### Keyboard Shortcuts
| Key | Action |
|-----|--------|
| N | New task |
| J/K | Navigate task list |
| Enter | Open selected task |
| Esc | Close dialog / deselect |
| 1-4 | Set priority |
| S | Cycle status |
| Cmd+K | Command palette |

### Better Scanning
- Priority: color-coded dots
- Overdue: terracotta date + row tint
- Status: left-to-right color progression in kanban
- Progress: thin inline bars everywhere

### Reduced Modals
- Task detail: right slide-over panel (320px) instead of centered modal
- Quick-create: inline row at top of task list
- Property edits: inline dropdowns only

### Contextual Actions
- Right-click context menu on task rows
- Bulk action bar on selection
- Drag to reorder within modules

---

## Files to Modify

**Total: ~229 files (104 CSS modules, 120 TSX, 5 global CSS)**

### Phase 1: Foundation (tokens + fonts)
- `src/styles/tokens.css` — all color, spacing, radius, typography tokens
- `src/styles/status-colors.css` — updated status/priority palette
- `src/styles/reset.css` — base font size adjustment
- `src/index.css` — font imports (IBM Plex Sans + Mono)

### Phase 2: UI Primitives
- 27 CSS modules in `src/components/ui/`
- Key TSX changes: button sizes, input heights, badge variants

### Phase 3: Layout Shell
- `src/components/layout/` — all 4 CSS + 4 TSX files
- `src/components/ui/sidebar.module.css` — sidebar width/density

### Phase 4: Dashboard
- 6 CSS + 6 TSX files in `src/components/dashboard/`
- `src/pages/dashboard.tsx` + `.module.css`

### Phase 5: Task Components
- 15 CSS + 15 TSX files in `src/components/tasks/`
- Task detail slide-over conversion
- Inline editing logic

### Phase 6: Project, Module, Shared Components
- 5+3+6 CSS files, corresponding TSX
- Module section collapse logic

### Phase 7: Pages
- 13 CSS + 13 TSX page files
- Page padding, title sizing, filter layout

### Phase 8: Timeline, Media, Misc
- 3+4 CSS files, corresponding TSX
- Gantt density, media grid compaction
