# Visual Redesign — Modern SaaS · Light · Industrial · Soft Card · Blue Accent

**Date:** 2026-08-11
**Scope:** `apps/frontend` — design tokens, `components/ui/` primitives, feature-component styling
**Not in scope:** navigation structure, information architecture, page composition, backend

---

## 1. Why

The frontend is mid-migration between two visual languages and is currently broken in
light mode. A prior pass rewrote `styles/tokens.css` into a blue-217 semantic token
system and converted ~20 CSS modules to it, but the older glassmorphism layer was never
fully removed. Three distinct failures survive in the tree:

1. **Dead token references** — 4 files: `card`, `input`, `select`, `textarea`. They
   reference `--glass-bg`, `--glass-border`, `--glass-blur`, `--glass-shadow`. None of
   these are defined anywhere. Cards render with no background.
2. **Hardcoded dark glass on floating surfaces** — 3 files, 4 blocks:
   `select.module.css`, `popover.module.css`, and `dropdown-menu.module.css` (two
   separate blocks) hardcode `background: hsl(228 20% 10% / 0.9)` with
   `rgba(255,255,255,0.1)` borders and `backdrop-filter: blur(20px)`, ignoring both the
   token layer and the active theme. Every select dropdown, popover, and dropdown menu
   renders as a dark translucent panel in light mode.
3. **Hardcoded shadow literals** — 5 files: `calendar`, `select`, `checkbox`, `toggle`,
   `tabs` each carry a literal `box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05)` instead of
   `--shadow-1`, so they will not follow the retuned shadow scale or the dark theme.

The three sets overlap. The union — the exact repair set — is **10 of the ~23 `ui/`
modules**, enumerated in Phase 0 (§5).

Repairing this is not cleanup performed alongside the redesign; for floating surfaces it
*is* the redesign.

## 2. Design direction

Selected through visual comparison in the brainstorming companion.

**Soft-dominant base**, with three industrial signals layered on:

| Decision | Value | How it was chosen |
|---|---|---|
| Card treatment | Soft-dominant — 16px radius, borderless, diffuse shadow, roomy rows | Picked over industrial-dominant and hybrid |
| Industrial signals kept | Mono tabular numerals · uppercase micro-labels · hairline structure | Multi-select from six candidates |
| Industrial signals rejected | Squared chips · denser rows · visible task IDs | Not selected |
| Page chrome | Tinted top bar, no border, cards do all the work | Picked over white bar and white header band |
| Theme | Light is default and the design target; dark stays first-class and maintained | Explicit choice |
| Accent | Blue, hue 217, already established in the token layer | From the brief |

### The governing rule

> **White means content. Tint means chrome. There is no third surface.**

Every downstream question ("should this be a card?", "does this need a border?") resolves
against this line. It is the direct consequence of the tinted-bar choice: with no rule
separating chrome from canvas, the *only* white in the application is a card, and that
consistency is what makes the absence of borders legible rather than accidental.

### Two consequences the chrome choice creates

Both are solved in this design rather than left open:

1. **The five project-detail tabs lose their anchoring band.** On a tinted canvas with
   no border they float unanchored. They become a segmented control — a pill group in a
   `--surface-sunken` track — which is self-anchoring and needs no rule.
2. **Nothing separates the top bar from content on scroll.** The bar is tint-on-tint at
   rest and gains `--shadow-1` only once the page is scrolled. The shadow replaces the
   border that was given up.

## 3. Token layer

### 3.1 Surfaces

Existing mappings are correct for this direction, with one change.

`--surface-sunken` is `grey-100` (94% L) on a `grey-50` canvas (97% L) — three points of
lightness. Adequate when its only job was an input fill; inadequate now that it also
backs the segmented-control track, where it must read as a distinct region on the canvas.

**Change:** darken `--surface-sunken` to `hsl(217 5% 91%)` in light.

Measured consequences, on a canvas of `grey-50` = `hsl(217 4% 97%)`:

| | at `grey-100` (94%) | at `hsl(217 5% 91%)` |
|---|---|---|
| Track vs canvas | 1.07 | **1.15** |
| `--text` on it | 12.09 | 11.26 ✅ |
| `--text-muted` on it | 5.23 | **4.87** ✅ |
| `--text-subtle` on it | 4.48 | **4.18** ❌ |

Two things this measurement corrects:

1. **Darkening makes `--text-subtle` on sunken worse, not better.** An earlier draft of
   this spec claimed the change would relieve the existing ban on that pairing. It does
   the opposite — a darker background lowers contrast against dark text. The ban in
   `tokens.css` **stays and is tightened**: `--text-subtle` is forbidden on
   `--surface-sunken`, and the new measured value is 4.18, not the 4.50 currently
   recorded in the file.
2. **The 4.50 recorded in `tokens.css` today is itself wrong.** `grey-600` on `grey-100`
   measures 4.48 — already below the 4.5 threshold, not sitting exactly on it. The
   comment is corrected as part of this work.

`--text-muted` at 4.87 is what makes the sunken input fill in §4.4 viable, since
placeholder text uses that token. It has ~0.37 of headroom, so `--surface-sunken` must
not be darkened past ~90% without re-measuring.

The dark-theme mapping is re-measured in the same pass; it is not assumed to carry over.

**This forces one layer-1 change.** `--border-strong` is the input border, and inputs sit
on `--surface-sunken`. Darkening that surface drops the pairing from 3.14 to **2.93** —
below the 3:1 threshold. The existing comment on `--grey-500` records that 54% was
chosen precisely to avoid 2.93 on this pairing, tuned against a 94% sunken surface; it
does not survive the move to 91%.

`--grey-500` therefore goes 54% → **52%**, restoring 3.14:

| `--border-strong` on | light | dark |
|---|---|---|
| `--surface` | 3.61 | 3.59 |
| `--surface-sunken` | 3.14 | 4.21 |

This is the only layer-1 primitive this redesign touches. It ripples to both themes
because `.dark` maps `--border-strong` to the same primitive. The general rule it
illustrates is worth keeping: **`--surface-sunken` and `--grey-500` are coupled — darken
one and the other must follow.**

### 3.2 New token: `--border-subtle`

The token layer has `--border` (`grey-200`, input outlines) and `--border-strong`
(`grey-500`). Hairline dividers *inside* white cards need a third, lighter value —
`--border` at `grey-200` reads as a seam against `--surface-raised`.

```
--border-subtle: var(--grey-100);   /* light */
```

Dark mapping set by measurement. This token carries industrial signal #3 (hairline
structure) and is used for row dividers and in-card section rules only. It is never used
for input outlines or component boundaries.

### 3.3 Radius roles

The scale is unchanged (`4 / 8 / 12 / 16 / full`). Role assignments move softer:

| Element | Current | New |
|---|---|---|
| Cards, panels | `--radius-lg` (12) | `--radius-xl` (16) |
| Buttons, chips, badges | 8 | `--radius-full` |
| Inputs, selects, menus, popovers | 8 | `--radius-lg` (12) |
| Checkbox, small controls | `--radius-sm` (4) | unchanged |

Pills for buttons and chips follow from the soft-dominant choice and from squared chips
being explicitly rejected.

### 3.4 Shadows

`--shadow-1..5` are currently tight-radius Tailwind-style shadows. Soft Card requires
diffuse shadows with negative spread. Reference shape for the card role:

```
0 1px 3px hsl(217 40% 12% / .06), 0 8px 24px -8px hsl(217 40% 12% / .14)
```

The whole scale is retuned to this character. Hue and the dark-theme overrides follow the
existing conventions in `tokens.css`.

**Elevation roles:**

| Role | Token |
|---|---|
| Card at rest | `--shadow-2` |
| Interactive card, hover | `--shadow-3` |
| Top bar, scrolled only | `--shadow-1` |
| Dropdown · select · popover | `--shadow-3` |
| Dialog · sheet | `--shadow-4` |
| Toast | `--shadow-3` |
| Sunken controls (inputs, wells) | `--shadow-inset` (defined, currently unused) |

### 3.5 Typography

Typefaces are unchanged: `Google Sans` and `Google Sans Mono`, imported from Google
Fonts in `tokens.css`. Both were verified to resolve and return real `@font-face` rules.

**Addition — `.text-num` utility** in `index.css`, alongside the existing `.text-label`:

```css
.text-num {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}
```

Applied to every stat, count, date, and duration. This is industrial signal #1; the mono
family is already in the token layer, so the signal costs one utility class.

`.text-label` already exists and already matches industrial signal #2 (12px / 600 /
uppercase / `.08em` / `--text-subtle`). It changes from occasional to systematic: every
stat label, column header, and field label uses it.

### 3.6 Accent discipline

Blue is reserved for:

- primary button fill
- active navigation item
- focus ring
- progress fill
- links
- selected state

Blue is **not** used for card headers, icons at rest, section dividers, or decoration.
One accent used sparingly is what separates "Blue Accent" from "blue everything".

## 4. Component treatments

### 4.1 Floating surfaces — full replacement

`select.module.css` · `popover.module.css` · `dropdown-menu.module.css` (both blocks).

The hardcoded dark-glass blocks are replaced entirely with: `--surface-overlay` fill,
**`--border-strong`** edge, `--radius-lg`, `--shadow-3`, no blur.

`backdrop-filter` is removed. It is the signature of the language being left, and it
costs a compositing layer per open menu. Verified during implementation that this drops
no needed stacking context: Radix's popper wrapper already supplies both a stacking
context and a containing block via `transform` + `zIndex`.

**The edge is `--border-strong`, not `--border`** — same reasoning as §4.4. `.dark` maps
`--border` and `--surface-overlay` both to `--grey-800`, so `--border` renders a panel
edge in exactly the panel's own colour (1.39 light / **1.00 dark**). `--border-strong`
gives 3.60 / 3.09. This matters more than it looks: in dark the panel's only other
separation is `--shadow-3`, whose offset is downward, so a panel opening upward
(`data-side="top"`) would have no top edge at all.

**Two known defects inside these panels, deferred to Phase 2** — recorded here with
measurements so they are not rediscovered:

1. **Menu item highlight is weak in light.** `.item:focus` fills with `--surface-hover`
   (`--grey-100`), which on a now-white panel measures **1.14:1** (dark 1.26:1). This is
   a *mouse-hover* weakness, not a keyboard-accessibility failure — Radix sets
   `tabindex="-1"` on items, which matches the global `:where([tabindex]):focus-visible`
   outline rule in `index.css`, so keyboard navigation still draws a 2px focus ring.
   Phase 2 should give the highlight real separation (`--brand-subtle` fill, or
   `--surface-sunken` plus a left accent bar).
2. **Dialog elevation contradicts §3.4.** The table below assigns `--shadow-4` to
   dialog and sheet. `sheet.tsx` complies; `dialog.tsx` and `alert-dialog.tsx` use
   `--shadow-5`. Ordering is still coherent today, so nothing looks wrong — but the
   divergence must be reconciled when the shadow scale is retuned, or the retuned scale
   inherits the inconsistency.

### 4.2 Card

Border removed entirely. `--surface-raised` fill, `--radius-xl`, `--shadow-2`.
Interactive cards (project cards) lift to `--shadow-3` on hover over `--duration-fast`
with `--ease-out`. Internal section dividers use `--border-subtle`, never `--border`.

### 4.3 Button

Already `rounded-full`, so pills require no change. One change: `shadow-1` currently
appears on `default`, `secondary`, `destructive`, and `outline`. It is kept only on
`default` (primary) and removed from the rest — when every button is lifted, none of them
are, and the primary action stops being the obvious target.

Sizes, hit-area handling, and focus-ring treatment are unchanged; they already satisfy
the accessibility rules documented in the file.

### 4.4 Inputs, textarea, select trigger

`--surface-sunken` fill (replacing the dead `--glass-bg`), `--border-strong` boundary,
`--radius-lg`, `--shadow-inset`. Sunken controls against raised cards communicate
"editable" without a heavy outline. All three are treated identically — the select
trigger is a form control like the other two.

**The border is `--border-strong`, not `--border`.** `--border` is a *separator*; a form
control's edge is a **boundary**, which WCAG 1.4.11 holds to 3:1. Measured:

| Control border vs the card behind it | light | dark |
|---|---|---|
| `--border` | 1.39 ❌ | **1.00** ❌ |
| `--border-strong` | 3.86 ✅ | 4.57 ✅ |

The dark figure for `--border` is not a rounding artefact: `.dark` maps both `--border`
and `--surface-raised` to `--grey-800`, so a bordered control inside a card has a border
that is *exactly the same colour as the card*. Every form field in the app is affected.
`--border-strong` is also the token `tokens.css` already documents for this job — the
comment on `--grey-500` names it "batas komponen … (border input)".

**`--border-strong` must map to different primitives per theme.** Light needs a darker
value to hold against white; dark needs a *lighter* one to hold against `--grey-800`.
Mapping both to `--grey-500` cannot satisfy both: at the 52% required by §3.1 it measures
2.88 against a dark card. Dark therefore maps to `--grey-400` (4.57). This is the second
place in the system where a token deliberately inverts between themes, alongside
`--ring-media` and `--text-on-danger`.

### 4.5 Tabs → segmented control

Pill group in a `--surface-sunken` track at `--radius-full`. The active tab is a
`--surface-raised` pill carrying `--shadow-1`. Self-anchoring, so it needs neither border
nor band — this is what makes the tinted-bar chrome viable for the five-tab project
detail route.

### 4.6 Badge and label chip

Pill (`--radius-full`), `*-subtle` background with the matching `*-text` foreground.

### 4.7 Table

Header row uses `.text-label`. Every numeric and date cell uses `.text-num`. Row
separators use `--border-subtle`. This is where industrial signals #1–3 concentrate most
heavily and where the industrial read matters most.

### 4.8 Top bar

`--surface` (tint) fill, no border at rest. Gains `--shadow-1` on scroll.

### 4.9 Skeleton and empty states

`components/shared/empty-state.tsx` is new and untracked; it is designed into the
language from the start rather than retrofitted.

## 5. Phasing

Sequenced as a vertical slice first, then replication — chosen so a taste disagreement
costs one route rather than a completed sweep.

### Phase 0 — Commit baseline, then repair only

Phase 0 is deliberately minimal: it makes the app *correct*, not *redesigned*. No token
values change here. Its only job is that nothing references a dead variable or a colour
literal, so Phase 1 starts from a working light-mode app rather than a broken one.

**0a. Commit the baseline.** The in-flight frontend changes, unmodified — the ~65
modified files under `apps/frontend/` plus the untracked
`components/shared/empty-state.tsx` and `theme-toggle.tsx`. They are a coherent
half-migration; editing on top of them makes the redesign diff unreadable and
unrevertable. The unrelated in-flight files (`apps/backend-rs/.../seed_user.rs`,
`.claude/settings.local.json`) are left alone and are not part of this commit.

**0b. Flip the default theme.** `defaultTheme: "dark"` → `"light"` in `main.tsx`. This
belongs here rather than later: light is the theme the repair has to be verified in, and
verifying it while the app still boots dark would miss exactly the failures being fixed.

**0c. Repair all 10 affected modules** onto the token layer **as it exists today** —
`--surface-raised`, `--surface-overlay`, `--surface-sunken`, `--border`, `--shadow-1/2/3`,
`--radius-md/lg`. Straight substitution of dead references for live ones. The
`backdrop-filter` declarations are removed here, since they are tied to the dark-glass
blocks being replaced.

| Module | Dead `--glass-*` | Dark-glass panel | Shadow literal |
|---|:--:|:--:|:--:|
| `card` | ● | | |
| `input` | ● | | |
| `textarea` | ● | | |
| `select` | ● | ● | ● |
| `popover` | | ● | |
| `dropdown-menu` | | ● (×2) | |
| `calendar` | | | ● |
| `checkbox` | | | ● |
| `toggle` | | | ● |
| `tabs` | | | ● |

**Gate:** app renders coherently in light and dark with the *existing* look — no dark
dropdowns, no background-less cards — and
`grep -lE 'rgba\(|rgb\(|hsl\(|#[0-9a-fA-F]{3,6}|--glass' components/ui/*.module.css`
returns nothing. This gate is mechanical, not aesthetic; there is nothing to judge yet.

### Phase 1 — Retune the tokens on a real screen: Dashboard

The token work and the vertical slice are done together, so every token value is judged
on a rendered screen instead of in the abstract.

**1a. Token retuning** (§3.1–3.5): darken `--surface-sunken`, add `--border-subtle`,
reassign the radius roles, retune `--shadow-1..5`, add `.text-num`, and update the
`@theme inline` mappings in `index.css`. Contrast measurement for every added or changed
token, both themes (§6), happens here.

**1b. Dashboard slice:** app shell (tinted bar, scroll shadow), card, button, badge,
stat cards, `my-task-row`, `upcoming-deadlines`, `empty-state`. One route, production
quality, both themes.

**Accepted trade-off.** Retuning shadows and radius roles is global — it changes every
component in the app, not only the Dashboard. So at the Phase 1 gate the *other* routes
will be in a deliberately mixed state: new token values, old component styling. That is
expected and is what Phases 2–3 resolve. Only the Dashboard is judged at this gate.

**Gate — the taste checkpoint.** Reviewed running at `localhost:3001`, both themes.
Phase 2 does not begin until this is approved. If the tokens need another pass, it costs
one route, which is the entire reason for sequencing it this way.

### Phase 2 — Remaining `ui/` primitives

Every other module brought to the patterns locked in Phase 1: dialog, sheet, popover,
dropdown-menu, select, command, calendar, checkbox, toggle, tooltip, tabs (→ segmented
control), scroll-area, avatar, breadcrumb, separator, skeleton, sonner, alert-dialog.

Note the overlap with Phase 0: seven of these were already touched there. Phase 0 only
made them *reference live tokens*; Phase 2 gives them their §4 treatment. `tabs` is the
clearest case — repaired in Phase 0, rebuilt as a segmented control (§4.5) here.

### Phase 3 — Feature sweep

Route by route against the locked reference: projects → tasks → timeline → members →
media → pages → comments/activity/labels/notifications → auth forms.

Timeline carries the most risk. A Gantt chart is inherently dense and industrial and will
fight the soft language hardest; it may need locally tighter treatment, decided when
reached rather than pre-specified here.

### Phase 4 — Consistency pass

Full walk of every route in both themes, checking for drift from the Phase 1 reference.

## 6. Verification

**Per phase boundary:** `bun run tsc --noEmit`, `bun run lint`, `vite build`.

**Contrast:** every semantic token that is added or changed is measured against every
surface it can appear on, in both light and dark, to the 4.5:1 body / 3:1 non-text
thresholds already applied in `tokens.css`. The reasoning is recorded in the file's
comments, matching the existing convention. No value is estimated.

**Glass residue:** no `--glass-` reference and no color literal outside `var(--…)`
remains in `components/ui/*.module.css`.

**Visual:** reviewed in the running app at each phase gate, in both themes.

Implementation runs under the project's `ui-design` skill, which enforces this token
layer and Refactoring UI principles.

## 7. Known risk

The soft-dominant base explicitly trades density away, in an application whose primary
activity is scanning long task lists. Phase 1 is the first point where that trade is
visible at real data volume.

If the dashboard reads airy but thin, the cheapest correction is tightening list-row
padding from 13px toward 9px while leaving card radius, shadows, and page margins
untouched — this recovers scanning density without abandoning the soft direction. That
decision is made at the Phase 1 gate, on the real screen, not in advance.
