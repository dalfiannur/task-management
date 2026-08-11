# Visual Redesign — Phases 0 & 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair the broken half-migrated styling in `apps/frontend`, then retune the design tokens and rebuild the Dashboard route as the reference implementation of the new visual language.

**Architecture:** Two phases. Phase 0 is mechanical repair — 10 CSS modules currently reference deleted `--glass-*` variables, hardcode a dark-glass panel, or hardcode a `box-shadow` literal; all are substituted for live tokens **at their current values**, so nothing changes visually except that light mode stops being broken. Phase 1 retunes the token values (surfaces, shadows, radius roles, a new `--border-subtle`, a `.text-num` utility) and rebuilds the Dashboard against them, so every token is judged on a rendered screen rather than in the abstract.

**Tech Stack:** Vite · React 19 · Tailwind CSS v4 (`@theme inline`) · CSS Modules · `next-themes` · TanStack Router/Query · Node 20+ (for the contrast script)

**Spec:** `docs/superpowers/specs/2026-08-11-visual-redesign-design.md`

---

## Scope of this plan

This plan covers **Phases 0 and 1 only** (spec §5). It ends at the Phase 1 taste checkpoint and produces working, reviewable software: a repaired app plus one route at production quality.

Phases 2–4 (remaining `ui/` primitives, the feature sweep, the consistency pass) are **deliberately not planned yet**. The spec gates them on the Phase 1 review, and their entire job is to replicate patterns that Phase 1 *locks*. Writing those tasks now would mean writing them against values that the review exists to change. They get their own plan once Phase 1 is approved.

**Spec requirements intentionally deferred, so they are not mistaken for gaps:**

| Spec § | Requirement | Deferred to | Why |
|---|---|---|---|
| §3.3 | Menus/popovers → `--radius-lg` | Phase 2 | Phase 0 fixes their *colour*; radius is part of their §4.1 treatment |
| §3.4 | Dialog/sheet → `--shadow-4` | Phase 2 | No dialog appears on the Dashboard |
| §4.2 | Interactive card hover → `--shadow-3` | Phase 3 | `Card` has no hover variant and no consumer needing one until project cards |
| §4.5 | Tabs → segmented control | Phase 2 | No tabs on the Dashboard |
| §4.6 | Badge/label chip pills | Phase 2 | `StatusBadge` renders on the Dashboard but is styled in Phase 2 |
| §4.7 | Table `.text-label` / `.text-num` | Phase 3 | No table on the Dashboard |

**Two scope traps in the Dashboard slice:**

- `src/components/shared/empty-state.tsx` needs **no change**. Despite spec §4.9 listing it, it is already fully token-driven — no colour literals, correct text tiers, primary CTA. Verify this rather than editing it.
- `src/features/dashboard/components/my-tasks-view.tsx` is **out of scope** despite living in the dashboard feature folder. It renders the `/my-tasks` route, not `/dashboard`. It belongs to Phase 3.

## Testing reality — read this before Task 1

**The frontend has no test framework configured.** There is no Vitest, no Jest, no Testing Library. Do not invent one; adding a test runner is not in this plan's scope.

Verification therefore uses four real gates, in this order of strength:

1. **`node scripts/check-contrast.mjs`** — a genuine automated test built in Task 7. It parses `tokens.css`, resolves `var()` indirection, converts HSL to WCAG relative luminance, and asserts every canonical token pairing in both themes. It has a real red state and a real green state.
2. **`grep` assertions** — the Phase 0 repairs have a precise machine-checkable definition of done: no colour literal and no `--glass-` reference survives in `components/ui/*.module.css`. Red before, green after.
3. **`bun run tsc --noEmit`, `bun run lint`, `bunx vite build`** — the project's documented gates. All three pass on the current tree, so any failure is something this work introduced.
4. **Human visual review** in the running app, both themes. This is the only gate for aesthetic questions and it is why Phase 1 stops at a checkpoint.

Where a task below says "run it and confirm it fails first", that is a real failing state, not ceremony.

## File map

**Created**
| Path | Responsibility |
|---|---|
| `apps/frontend/scripts/check-contrast.mjs` | Sole owner of contrast verification. Parses tokens, asserts canonical pairs both themes. No other file measures colour. |

**Modified — Phase 0 (repair only, no value changes)**
| Path | Change |
|---|---|
| `src/main.tsx` | `defaultTheme` `"dark"` → `"light"` |
| `src/components/ui/card.module.css` | dead `--glass-*` → live tokens |
| `src/components/ui/input.module.css` | dead `--glass-*` → live tokens |
| `src/components/ui/textarea.module.css` | dead `--glass-*` → live tokens |
| `src/components/ui/select.module.css` | dead `--glass-*`, dark-glass panel, shadow literal |
| `src/components/ui/popover.module.css` | dark-glass panel |
| `src/components/ui/dropdown-menu.module.css` | dark-glass panel ×2 (`.content`, `.subContent`) |
| `src/components/ui/calendar.module.css` | shadow literal |
| `src/components/ui/checkbox.module.css` | shadow literal |
| `src/components/ui/toggle.module.css` | shadow literal |
| `src/components/ui/tabs.module.css` | shadow literal |

**Modified — Phase 1 (retune + Dashboard slice)**
| Path | Change |
|---|---|
| `src/styles/tokens.css` | `--surface-sunken`, `--border-subtle`, `--shadow-1..5`, corrected contrast comments |
| `src/index.css` | `--color-border-subtle` mapping, `.text-num` utility |
| `src/components/ui/card.module.css` | borderless, `--radius-xl`, `--shadow-2` |
| `src/components/ui/button.tsx` | shadow only on `default` variant |
| `src/components/ui/input.module.css` | sunken fill, `--radius-lg`, `--shadow-inset` |
| `src/components/ui/textarea.module.css` | sunken fill, `--radius-lg`, `--shadow-inset` |
| `src/features/auth/components/app-shell.tsx` | tinted bar, no border, scroll shadow |
| `src/routes/_authed/dashboard.tsx` | page heading treatment |
| `src/features/dashboard/components/stat-cards.tsx` | `.text-label` + `.text-num` |
| `src/features/dashboard/components/my-task-row.tsx` | `--border-subtle` divider, `.text-num` date |
| `src/features/dashboard/components/upcoming-deadlines.tsx` | card container, empty state |

---

# PHASE 0 — Repair only

No token *values* change in this phase. Success means the app is correct, not redesigned.

---

### Task 1: Commit the in-flight baseline

The tree holds ~65 modified frontend files plus 2 untracked components from a previous, unfinished migration. They must be committed untouched before anything else, or the redesign diff becomes unreadable and unrevertable.

**Files:** no edits — this task only commits existing work.

- [ ] **Step 1: Confirm you are on the redesign branch**

```bash
cd /home/qyubit/Workspace/personal/task-management
git branch --show-current
```

Expected: `redesign/soft-card-blue`

If it prints anything else, stop and ask — do not create a branch, the spec commits already live on this one.

- [ ] **Step 2: Stage only the frontend work**

The backend file and the local settings file are unrelated in-flight changes and must NOT be included.

```bash
git add apps/frontend/
git status --short --untracked-files=no -- apps/frontend | wc -l
```

Expected: a count around 65 (exact number may differ slightly; it must be non-zero).

- [ ] **Step 3: Verify the excluded files are still unstaged**

```bash
git status --short -- apps/backend-rs .claude/settings.local.json
```

Expected: `apps/backend-rs/crates/app/src/bin/seed_user.rs` shows as untracked (`??`) and `.claude/settings.local.json` shows as modified (` M`) — neither staged. If either shows as staged (`M ` / `A `), run `git restore --staged <path>`.

- [ ] **Step 4: Commit**

```bash
git commit -m "chore(frontend): baseline in-flight token migration before redesign

Commits the partially-migrated state as-is so the redesign diff is legible.
This state is knowingly broken in light mode: 10 ui/ modules still reference
deleted --glass-* variables, hardcode a dark-glass panel, or hardcode a
box-shadow literal. Repaired in the following commits."
```

- [ ] **Step 5: Verify the tree is clean of frontend changes**

```bash
git status --short -- apps/frontend
```

Expected: no output.

---

### Task 2: Establish the Phase 0 red state

Before repairing anything, prove the failure is real and machine-detectable. This grep is the Phase 0 gate; it must fail now and pass at Task 6.

**Files:** none — verification only.

- [ ] **Step 1: Run the gate command and confirm it FAILS**

```bash
cd /home/qyubit/Workspace/personal/task-management/apps/frontend
grep -lE 'rgba\(|rgb\(|hsl\(|#[0-9a-fA-F]{3,6}|--glass' src/components/ui/*.module.css
```

Expected — exactly these 10 files, in some order:

```
src/components/ui/calendar.module.css
src/components/ui/card.module.css
src/components/ui/checkbox.module.css
src/components/ui/dropdown-menu.module.css
src/components/ui/input.module.css
src/components/ui/popover.module.css
src/components/ui/select.module.css
src/components/ui/tabs.module.css
src/components/ui/textarea.module.css
src/components/ui/toggle.module.css
```

If the list differs, the tree has drifted from the spec — stop and report before editing.

---

### Task 3: Flip the default theme to light

Light is the theme the repair must be verified in. Doing this first means Tasks 4–6 are checked in the theme that actually matters.

**Files:**
- Modify: `apps/frontend/src/main.tsx:30`

- [ ] **Step 1: Change the default theme**

Find this block in `src/main.tsx`:

```tsx
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem
      disableTransitionOnChange
    >
```

Replace `defaultTheme="dark"` with `defaultTheme="light"`:

```tsx
    <ThemeProvider
      attribute="class"
      defaultTheme="light"
      enableSystem
      disableTransitionOnChange
    >
```

Leave `attribute`, `enableSystem`, and `disableTransitionOnChange` exactly as they are.

- [ ] **Step 2: Verify the change and that nothing else moved**

```bash
git diff --stat src/main.tsx
```

Expected: `1 file changed, 1 insertion(+), 1 deletion(-)`

- [ ] **Step 3: Type-check**

```bash
bun run tsc --noEmit
```

Expected: no output, exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/main.tsx
git commit -m "feat(frontend): default to the light theme

Light is the design target; dark remains available via the toggle and
stays first-class. Flipped before the module repairs so those are
verified in light mode."
```

---

### Task 4: Repair dead `--glass-*` references

Four modules reference `--glass-bg`, `--glass-border`, `--glass-blur`, `--glass-shadow`. None are defined anywhere, so these elements currently render with no background at all.

Substitute live tokens **at current values** — this is not a redesign step.

**Files:**
- Modify: `apps/frontend/src/components/ui/card.module.css:1-14`
- Modify: `apps/frontend/src/components/ui/input.module.css:1-14`
- Modify: `apps/frontend/src/components/ui/textarea.module.css:1-14`
- Modify: `apps/frontend/src/components/ui/select.module.css:5-21`

- [ ] **Step 1: Repair `card.module.css`**

Replace the `.card` rule:

```css
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
  color: var(--text);
  box-shadow: var(--glass-shadow);
}
```

with:

```css
.card {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  border-radius: var(--radius-xl);
  border: 1px solid var(--border);
  padding-top: 1rem;
  padding-bottom: 1rem;
  background: var(--surface-raised);
  color: var(--text);
  box-shadow: var(--shadow-1);
}
```

Both `backdrop-filter` lines are deleted, not replaced. Leave every other rule in the file untouched.

- [ ] **Step 2: Repair `input.module.css`**

In the `.input` rule, change these two lines:

```css
  border: 1px solid var(--glass-border);
  background: var(--glass-bg);
```

to:

```css
  border: 1px solid var(--border);
  background: var(--surface-raised);
```

Leave the rest of `.input` (height, padding, transition, outline) and every other rule untouched.

- [ ] **Step 3: Repair `textarea.module.css`**

In the `.textarea` rule, change these two lines:

```css
  border: 1px solid var(--glass-border);
  background: var(--glass-bg);
```

to:

```css
  border: 1px solid var(--border);
  background: var(--surface-raised);
```

- [ ] **Step 4: Repair the `.trigger` rule in `select.module.css`**

Change these two lines:

```css
  border: 1px solid var(--glass-border);
  background: var(--glass-bg);
```

to:

```css
  border: 1px solid var(--border);
  background: var(--surface-raised);
```

The `box-shadow` literal on the next line is left alone — Task 6 handles it.

- [ ] **Step 5: Verify no `--glass-` reference survives**

```bash
grep -rn -- '--glass' src/
```

Expected: no output, exit code 1.

- [ ] **Step 6: Build**

```bash
bunx vite build --logLevel error
```

Expected: exit 0. (An `Unknown at rule: @import` warning is pre-existing and harmless.)

- [ ] **Step 7: Commit**

```bash
git add src/components/ui/card.module.css src/components/ui/input.module.css src/components/ui/textarea.module.css src/components/ui/select.module.css
git commit -m "fix(ui): replace dead --glass-* refs with live tokens

card, input, textarea and the select trigger referenced --glass-bg,
--glass-border, --glass-blur and --glass-shadow, none of which are
defined since the token rewrite — so they rendered with no background.
Substituted at current token values; no visual retuning here."
```

---

### Task 5: Replace the hardcoded dark-glass floating surfaces

Three modules hardcode a dark translucent panel that ignores both the token layer and the active theme, so every dropdown, popover and select menu renders dark in light mode.

There are **four** blocks: `select .content`, `popover .content`, `dropdown-menu .content`, `dropdown-menu .subContent`.

**Files:**
- Modify: `apps/frontend/src/components/ui/select.module.css` (`.content`)
- Modify: `apps/frontend/src/components/ui/popover.module.css` (`.content`)
- Modify: `apps/frontend/src/components/ui/dropdown-menu.module.css` (`.content`, `.subContent`)

- [ ] **Step 1: Repair `select.module.css` `.content`**

Within the `.content` rule, replace these five lines:

```css
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: hsl(228 20% 10% / 0.9);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  color: var(--text);
```

with:

```css
  border: 1px solid var(--border);
  background: var(--surface-overlay);
  color: var(--text);
```

Then, in the same rule, replace:

```css
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
```

with:

```css
  box-shadow: var(--shadow-3);
```

Leave `z-index`, `min-width`, `max-height`, `overflow-*`, `border-radius`, `transform-origin` and the animation declarations exactly as they are.

- [ ] **Step 2: Repair `popover.module.css` `.content`**

Replace these five lines:

```css
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: hsl(228 20% 10% / 0.9);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  color: var(--text);
```

with:

```css
  border: 1px solid var(--border);
  background: var(--surface-overlay);
  color: var(--text);
```

and replace:

```css
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
```

with:

```css
  box-shadow: var(--shadow-3);
```

Leave `width: 18rem;`, `padding`, `outline`, `transform-origin` and the animation untouched.

- [ ] **Step 3: Repair `dropdown-menu.module.css` `.content`**

In the `.content` rule (near line 12), replace these five lines:

```css
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: hsl(228 20% 10% / 0.9);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  color: var(--text);
```

with:

```css
  border: 1px solid var(--border);
  background: var(--surface-overlay);
  color: var(--text);
```

and replace:

```css
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
```

with:

```css
  box-shadow: var(--shadow-3);
```

- [ ] **Step 4: Repair `dropdown-menu.module.css` `.subContent`**

This is the block most easily missed — a second, separate copy of the same declarations near line 305, in the `.subContent` rule. Replace these five lines:

```css
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: hsl(228 20% 10% / 0.9);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  color: var(--text);
```

with:

```css
  border: 1px solid var(--border);
  background: var(--surface-overlay);
  color: var(--text);
```

and replace:

```css
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
```

with:

```css
  box-shadow: var(--shadow-3);
```

- [ ] **Step 5: Verify no dark-glass block survives**

```bash
grep -rn 'backdrop-filter\|hsl(228\|rgba(255, 255, 255\|rgba(0, 0, 0' src/components/ui/
```

Expected: no output, exit code 1.

- [ ] **Step 6: Build**

```bash
bunx vite build --logLevel error
```

Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/components/ui/select.module.css src/components/ui/popover.module.css src/components/ui/dropdown-menu.module.css
git commit -m "fix(ui): detach floating surfaces from hardcoded dark glass

select .content, popover .content and dropdown-menu .content/.subContent
hardcoded hsl(228 20% 10% / 0.9) with white borders and blur(20px),
ignoring the token layer and the theme — so every menu rendered as a dark
panel in light mode. Now --surface-overlay + --border + --shadow-3.

backdrop-filter is dropped rather than ported: it is the signature of the
language being retired and costs a compositing layer per open menu."
```

---

### Task 6: Replace hardcoded shadow literals

Five modules carry a literal `box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05)` instead of `--shadow-1`. Left in place they would silently ignore both the Phase 1 shadow retune and the dark theme.

**Files:**
- Modify: `apps/frontend/src/components/ui/calendar.module.css` (`.dropdownRoot`)
- Modify: `apps/frontend/src/components/ui/checkbox.module.css` (`.checkbox`)
- Modify: `apps/frontend/src/components/ui/toggle.module.css` (`.toggle[data-variant="outline"]`)
- Modify: `apps/frontend/src/components/ui/tabs.module.css` (active trigger, default variant)
- Modify: `apps/frontend/src/components/ui/select.module.css` (`.trigger`)

- [ ] **Step 1: Replace all five occurrences**

In each of the five files, replace every occurrence of:

```css
  box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05);
```

with:

```css
  box-shadow: var(--shadow-1);
```

The rules containing them are, for orientation:

- `calendar.module.css` → `.dropdownRoot`
- `checkbox.module.css` → `.checkbox`
- `toggle.module.css` → `.toggle[data-variant="outline"]`
- `tabs.module.css` → `.tabsList[data-variant="default"] .tabsTrigger[data-state="active"]`
- `select.module.css` → `.trigger`

- [ ] **Step 2: Verify none survive**

```bash
grep -rn 'rgb(0 0 0' src/components/ui/
```

Expected: no output, exit code 1.

- [ ] **Step 3: Run the Phase 0 gate — it must now PASS**

This is the same command that listed 10 files in Task 2.

```bash
grep -lE 'rgba\(|rgb\(|hsl\(|#[0-9a-fA-F]{3,6}|--glass' src/components/ui/*.module.css
```

Expected: **no output, exit code 1.** If any file is still listed, that file was missed — go back and fix it before continuing.

- [ ] **Step 4: Run all three project gates**

```bash
bun run tsc --noEmit && bun run lint && bunx vite build --logLevel error
```

Expected: all three exit 0.

- [ ] **Step 5: Visual confirmation in the running app**

```bash
bun run dev
```

Open `http://localhost:3001`, log in, and confirm in **light** mode:
- cards on the Dashboard have a visible white background (not transparent)
- opening any dropdown, the assignee picker, or a select shows a **light** panel, not a dark one
- toggling to dark mode via the theme switch still looks correct

Stop the dev server when done.

- [ ] **Step 6: Commit**

```bash
git add src/components/ui/
git commit -m "fix(ui): replace hardcoded box-shadow literals with --shadow-1

calendar, checkbox, toggle, tabs and the select trigger hardcoded
0 1px 2px 0 rgb(0 0 0 / 0.05), which would have ignored both the shadow
retune and the dark theme.

Completes phase 0: no colour literal and no --glass- reference remains in
components/ui/*.module.css."
```

---

# PHASE 1 — Retune tokens on a real screen

Token values change here, and they change **globally**. Routes other than the Dashboard will sit in a deliberately mixed state — new token values, old component styling — until Phases 2–3. That is expected. Only the Dashboard is judged at this phase's gate.

---

### Task 7: Build the contrast verification script

This is the plan's one genuine automated test. It must be written **before** the token changes so it can fail first.

**Files:**
- Create: `apps/frontend/scripts/check-contrast.mjs`

- [ ] **Step 1: Write the script**

Create `apps/frontend/scripts/check-contrast.mjs`:

```js
#!/usr/bin/env node
/**
 * Measures every canonical token pairing in styles/tokens.css against WCAG
 * thresholds, in BOTH :root and .dark. Exits non-zero on any failure.
 *
 * This is the only place colour is measured. Spec §6 requires that no value
 * be estimated; running this is what discharges that requirement.
 *
 *   node scripts/check-contrast.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(here, "../src/styles/tokens.css"), "utf8");

/** Pull `--name: value;` declarations out of one top-level block. */
function readBlock(selector) {
  const re = new RegExp(
    `^${selector.replace(".", "\\.")}\\s*\\{([\\s\\S]*?)^\\}`,
    "m",
  );
  const m = css.match(re);
  if (!m) throw new Error(`block not found in tokens.css: ${selector}`);
  const out = {};
  for (const [, k, v] of m[1].matchAll(/^\s*(--[\w-]+)\s*:\s*([^;]+);/gm)) {
    out[k] = v.trim();
  }
  return out;
}

// .dark only remaps layer 2, so it inherits every layer-1 primitive from :root.
const THEMES = {
  light: readBlock(":root"),
  dark: { ...readBlock(":root"), ...readBlock(".dark") },
};

/** Follow var(--x) chains to a literal value. */
function deref(name, scope, seen = new Set()) {
  let v = scope[name];
  if (v === undefined) throw new Error(`undefined token: ${name}`);
  while (v.startsWith("var(")) {
    const ref = v.slice(4, v.lastIndexOf(")")).trim();
    if (seen.has(ref)) throw new Error(`cyclic token reference at ${ref}`);
    seen.add(ref);
    v = scope[ref];
    if (v === undefined) throw new Error(`undefined token: ${ref} (via ${name})`);
  }
  return v;
}

/** Opaque hsl() -> linear [r,g,b] in 0..1. Throws on alpha or non-hsl. */
function toRgb(name, scope) {
  const v = deref(name, scope);
  const m = v.match(
    /^hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*(?:\/\s*([\d.]+))?\s*\)$/,
  );
  if (!m) throw new Error(`${name}: not a plain hsl() colour -> ${v}`);
  if (m[4] !== undefined) {
    throw new Error(`${name}: has alpha, cannot be measured standalone -> ${v}`);
  }
  const h = Number(m[1]);
  const s = Number(m[2]) / 100;
  const l = Number(m[3]) / 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

const luminance = (rgb) =>
  rgb
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    .reduce((acc, c, i) => acc + c * [0.2126, 0.7152, 0.0722][i], 0);

function ratio(fg, bg, scope) {
  const [hi, lo] = [luminance(toRgb(fg, scope)), luminance(toRgb(bg, scope))].sort(
    (a, b) => b - a,
  );
  return (hi + 0.05) / (lo + 0.05);
}

const TEXT = 4.5; // body text
const UI = 3.0; // focus rings, meaningful boundaries

/** [foreground, background, threshold] */
const PAIRS = [
  ["--text", "--surface", TEXT],
  ["--text", "--surface-raised", TEXT],
  ["--text", "--surface-sunken", TEXT],
  ["--text", "--surface-overlay", TEXT],
  ["--text", "--surface-hover", TEXT],
  ["--text-muted", "--surface", TEXT],
  ["--text-muted", "--surface-raised", TEXT],
  ["--text-muted", "--surface-sunken", TEXT],
  ["--text-muted", "--surface-overlay", TEXT],
  ["--text-subtle", "--surface", TEXT],
  ["--text-subtle", "--surface-raised", TEXT],
  ["--text-subtle", "--surface-overlay", TEXT],
  ["--text-on-brand", "--brand", TEXT],
  ["--text-on-brand", "--brand-hover", TEXT],
  ["--text-on-danger", "--danger", TEXT],
  ["--brand-text", "--surface", TEXT],
  ["--brand-text", "--surface-raised", TEXT],
  ["--danger", "--surface-raised", TEXT],
  ["--warning", "--surface-raised", TEXT],
  ["--success", "--surface-raised", TEXT],
  ["--focus", "--surface", UI],
  ["--focus", "--surface-raised", UI],
  ["--border-strong", "--surface", UI],
  ["--border-strong", "--surface-sunken", UI],
];

/**
 * Reported, never failed.
 *
 * --brand on --surface-raised measures 2.20:1 in dark — a blue primary button
 * sitting on a raised card has almost no boundary against it. That is NOT a
 * WCAG failure: 1.4.11 exempts a filled control that is identifiable by its
 * label, and --text-on-brand on --brand passes in both themes (6.17 light /
 * 4.72 dark). Asserting 3:1 here would force the brand hue to change to
 * satisfy a rule that does not apply.
 *
 * It is recorded because the weakness is real. If any design ever relies on
 * that edge rather than on the label — a brand-filled chip with no text, an
 * icon-only primary — this is the number to revisit first.
 */
const REPORTED = [["--brand", "--surface-raised"]];

/**
 * Documented exclusions — pairings the design forbids. Reported, never failed.
 * A ban exists precisely because these do NOT meet threshold.
 */
const FORBIDDEN = [
  ["--text-subtle", "--surface-sunken"],
  ["--text-subtle", "--surface-hover"],
];

/**
 * Tokens that must exist and resolve to an opaque colour, but carry no WCAG
 * minimum. --border-subtle is a decorative in-card hairline: WCAG sets no
 * threshold for it, and forcing 3:1 would make it not subtle.
 */
const MUST_EXIST = ["--border", "--border-subtle"];

let failures = 0;

for (const [theme, scope] of Object.entries(THEMES)) {
  console.log(`\n${theme.toUpperCase()}`);

  for (const name of MUST_EXIST) {
    try {
      toRgb(name, scope);
      console.log(`  ok    ${name} defined`);
    } catch (err) {
      console.log(`  FAIL  ${name} — ${err.message}`);
      failures++;
    }
  }

  for (const [fg, bg, min] of PAIRS) {
    let r;
    try {
      r = ratio(fg, bg, scope);
    } catch (err) {
      console.log(`  FAIL  ${fg} on ${bg} — ${err.message}`);
      failures++;
      continue;
    }
    const pass = r >= min;
    if (!pass) failures++;
    console.log(
      `  ${pass ? "ok  " : "FAIL"}  ${r.toFixed(2)} (min ${min})  ${fg} on ${bg}`,
    );
  }

  for (const [fg, bg] of FORBIDDEN) {
    try {
      console.log(
        `  note  ${ratio(fg, bg, scope).toFixed(2)}  ${fg} on ${bg} — FORBIDDEN by design`,
      );
    } catch (err) {
      console.log(`  note  ${fg} on ${bg} — ${err.message}`);
    }
  }

  for (const [fg, bg] of REPORTED) {
    try {
      console.log(
        `  note  ${ratio(fg, bg, scope).toFixed(2)}  ${fg} on ${bg} — recorded, no threshold`,
      );
    } catch (err) {
      console.log(`  note  ${fg} on ${bg} — ${err.message}`);
    }
  }
}

console.log(
  failures === 0
    ? "\nAll measured pairings pass.\n"
    : `\n${failures} failure(s).\n`,
);
process.exit(failures === 0 ? 0 : 1);
```

- [ ] **Step 2: Run it and confirm it FAILS**

```bash
cd /home/qyubit/Workspace/personal/task-management/apps/frontend
node scripts/check-contrast.mjs
```

Expected: **exit code 1** and **exactly 2 failures**, one under LIGHT and one under DARK:

```
  FAIL  --border-subtle — undefined token: --border-subtle
```

ending with:

```
2 failure(s).
```

That is the red state — `--border-subtle` does not exist yet. Task 8 creates it.

Every other pairing must read `ok`. **If any other pairing fails, stop and report it** — that would mean the existing palette has a contrast defect this plan did not account for, and the values in Task 8 would need revisiting.

Two `note` lines are expected and are not failures. In DARK, confirm you see:

```
  note  2.20  --brand on --surface-raised — recorded, no threshold
```

This one was found while validating the script and is worth understanding before you touch tokens: a blue primary button on a raised card has almost no boundary against it in dark mode. It is exempt rather than passing — see the comment above `REPORTED` in the script. Do not "fix" it by changing the brand hue.

- [ ] **Step 3: Commit**

```bash
git add scripts/check-contrast.mjs
git commit -m "test(frontend): add WCAG contrast verification for design tokens

Parses tokens.css, resolves var() chains, converts HSL to relative
luminance and asserts 25 canonical pairings in both themes. Documented
exclusions are reported rather than failed, since a ban exists precisely
because the pairing does not meet threshold.

Currently red: --border-subtle is asserted but not yet defined."
```

---

### Task 8: Retune surfaces and add `--border-subtle`

Turns Task 7 green. Two changes plus two corrections to comments that are factually wrong today.

**Files:**
- Modify: `apps/frontend/src/styles/tokens.css` (`:root` and `.dark` layer-2 blocks)
- Modify: `apps/frontend/src/index.css` (`@theme inline`)

- [ ] **Step 1: Darken `--surface-sunken` in `:root`**

In the light layer-2 block, replace:

```css
  --surface:         var(--grey-50);
  --surface-raised:  hsl(217 0% 100%);
  /* --text-subtle DILARANG di atas --surface-sunken di light: hanya 4.50:1
     di light dan 3.62:1 di dark. Hanya tier 1 & 2. */
  --surface-sunken:  var(--grey-100);
```

with:

```css
  --surface:         var(--grey-50);
  --surface-raised:  hsl(217 0% 100%);
  /* Sengaja LEBIH GELAP dari --grey-100. Ia kini juga menjadi track segmented
     control di atas --surface (97%); pada 94% jaraknya hanya 1.07:1 dan track
     itu hilang. Pada 91% jaraknya 1.15:1.
     BATAS BAWAH ~90%: --text-muted di atasnya 4.87:1, sisa margin 0.37 dari
     ambang 4.5. Menggelapkan lebih jauh menjatuhkan placeholder input.
     --text-subtle DILARANG di atas --surface-sunken: 4.18:1 di light (BUKAN
     4.50 seperti tercatat sebelumnya — grey-600 di atas grey-100 mengukur
     4.48, sudah di bawah ambang) dan 3.62:1 di dark. Hanya tier 1 & 2. */
  --surface-sunken:  hsl(217 5% 91%);
```

- [ ] **Step 2: Darken `--grey-500` to keep `--border-strong` legal**

Darkening `--surface-sunken` drops `--border-strong` on it from 3.14 to **2.93**, below the 3:1 threshold. `--border-strong` is the input border, and inputs sit on `--surface-sunken` — so this is a real regression, not a technicality.

The existing comment on `--grey-500` documents that 54% was chosen *specifically* to avoid 2.93 on this exact pairing. Darkening the surface without darkening the primitive walks straight back into the value the original author engineered around.

In the layer-1 grey ramp, replace:

```css
  /* 54%, bukan 56%: ia adalah --border-strong, batas komponen yang juga duduk
     di --surface-sunken (border input). Di 56% hanya 2.93:1 di sana. */
  --grey-500: hsl(217 8% 54%);
```

with:

```css
  /* 52%, bukan 54% atau 56%: ia adalah --border-strong, batas komponen yang
     juga duduk di --surface-sunken (border input). Setiap kali --surface-sunken
     digelapkan, angka ini harus ikut turun. Pada --surface-sunken 91%:
     56% → 2.6 · 54% → 2.93 · 52% → 3.14. Nilai 54% yang lama dipilih untuk
     --surface-sunken 94%; ia gagal pada 91%.
     52% lolos di KEDUA tema: light 3.61 di atas --surface / 3.14 di atas
     --surface-sunken, dark 3.59 / 4.21. */
  --grey-500: hsl(217 8% 52%);
```

This is the plan's only layer-1 change. It ripples to both themes because `.dark` maps `--border-strong` to the same primitive — which is why the replacement comment records the dark figures too.

- [ ] **Step 3: Add `--border-subtle` to the `:root` border group**

Replace:

```css
  --border:        var(--grey-200);
  --border-strong: var(--grey-500);
  --focus:         var(--brand-500);
```

with:

```css
  --border:        var(--grey-200);
  /* Hairline PEMISAH DI DALAM permukaan raised (baris tabel, sekat seksi).
     --border (grey-200) terlalu berat di atas --surface-raised dan terbaca
     sebagai jahitan. Dekoratif: WCAG tidak menetapkan ambang untuk ini, dan
     memaksa 3:1 membuatnya tidak lagi halus. TIDAK untuk outline input atau
     batas komponen — itu tetap --border. */
  --border-subtle: var(--grey-100);
  --border-strong: var(--grey-500);
  --focus:         var(--brand-500);
```

- [ ] **Step 4: Add the dark mappings**

In the `.dark` block, replace:

```css
  --border:        var(--grey-800);
  --border-strong: var(--grey-500);
```

with:

```css
  --border:        var(--grey-800);
  /* Di dark, pemisah halus justru LEBIH TERANG dari --border: di atas
     --surface-raised (grey-800) sebuah garis yang lebih gelap menghilang. */
  --border-subtle: var(--grey-700);
  --border-strong: var(--grey-500);
```

Leave `--surface-sunken: hsl(217 9% 13%);` in `.dark` unchanged — the dark canvas is already well separated from it.

- [ ] **Step 5: Expose the token to Tailwind**

In `src/index.css`, inside `@theme inline`, replace:

```css
  /* Batas & focus */
  --color-border: var(--border);
  --color-border-strong: var(--border-strong);
  --color-focus: var(--focus);
```

with:

```css
  /* Batas & focus */
  --color-border: var(--border);
  --color-border-subtle: var(--border-subtle);
  --color-border-strong: var(--border-strong);
  --color-focus: var(--focus);
```

- [ ] **Step 6: Run the contrast script — it must now PASS**

```bash
node scripts/check-contrast.mjs
```

Expected: **exit code 0** and `All measured pairings pass.`

These exact values were verified while writing this plan. Confirm each one appears:

| Theme | Line |
|---|---|
| both | `ok    --border-subtle defined` |
| LIGHT | `ok    4.87 (min 4.5)  --text-muted on --surface-sunken` |
| LIGHT | `ok    3.61 (min 3)  --border-strong on --surface` |
| LIGHT | `ok    3.14 (min 3)  --border-strong on --surface-sunken` |
| LIGHT | `note  4.18  --text-subtle on --surface-sunken — FORBIDDEN by design` |
| DARK | `ok    3.59 (min 3)  --border-strong on --surface` |
| DARK | `ok    4.21 (min 3)  --border-strong on --surface-sunken` |

Diagnosing a failure:

- `--text-muted on --surface-sunken` below 4.5 → `--surface-sunken` was darkened too far. Set it to `hsl(217 5% 91%)` exactly.
- `--border-strong on --surface-sunken` reads **2.93** → Step 2 was skipped. `--grey-500` is still at 54%.

- [ ] **Step 7: Build**

```bash
bunx vite build --logLevel error
```

Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add src/styles/tokens.css src/index.css scripts/check-contrast.mjs
git commit -m "feat(tokens): darken --surface-sunken, add --border-subtle

--surface-sunken now backs the segmented-control track as well as input
fills; at grey-100 it sat 1.07:1 from the canvas and vanished. Now
hsl(217 5% 91%) at 1.15:1, with ~90% as the floor --text-muted (4.87:1)
imposes.

--grey-500 follows it down, 54% -> 52%. The old value was tuned for a 94%
sunken surface; at 91% it put --border-strong (the input border) at 2.93:1,
exactly the figure its own comment says 54% existed to avoid. 52% restores
3.14 in light and holds 4.21 in dark.

--border-subtle is the in-card hairline divider; --border reads as a seam
on raised surfaces. It inverts in dark, where a subtler line must be
lighter than --border, not darker.

Corrects two wrong figures in the file: --text-subtle on --surface-sunken
measures 4.48 at grey-100 (not 4.50, i.e. already failing) and 4.18 at the
new value. The ban stays and tightens."
```

---

### Task 9: Retune the shadow scale

Current shadows are tight-radius. Soft Card needs diffuse shadows with negative spread.

**Files:**
- Modify: `apps/frontend/src/styles/tokens.css` (`:root` and `.dark` shadow groups)

- [ ] **Step 1: Replace the light shadow scale**

In `:root`, replace the `--shadow-1` through `--shadow-5` declarations with:

```css
  /* Diffuse + negative spread. Kunci tampilan Soft Card: bayangan lebar dan
     lembut, bukan bayangan ketat ala Tailwind. Dua lapis per token — satu
     hairline rapat untuk mendudukkan tepi, satu lebar untuk mengangkat. */
  --shadow-1: 0 1px 2px 0 hsl(217 40% 12% / .05),
              0 1px 3px 0 hsl(217 40% 12% / .08);
  --shadow-2: 0 1px 3px 0 hsl(217 40% 12% / .06),
              0 8px 24px -8px hsl(217 40% 12% / .14);
  --shadow-3: 0 2px 6px -1px hsl(217 40% 12% / .06),
              0 16px 32px -12px hsl(217 40% 12% / .18);
  --shadow-4: 0 4px 10px -2px hsl(217 40% 12% / .06),
              0 28px 48px -16px hsl(217 40% 12% / .22);
  --shadow-5: 0 32px 64px -16px hsl(217 40% 12% / .28);
```

Leave `--shadow-inset`, `--ring-media`, `--scrim` and `--scrim-strong` unchanged.

- [ ] **Step 2: Replace the dark shadow scale**

In `.dark`, replace `--shadow-1` through `--shadow-5` with:

```css
  --shadow-1: 0 1px 2px 0 hsl(0 0% 0% / .30), 0 1px 3px 0 hsl(0 0% 0% / .36);
  --shadow-2: 0 1px 3px 0 hsl(0 0% 0% / .32), 0 8px 24px -8px hsl(0 0% 0% / .48);
  --shadow-3: 0 2px 6px -1px hsl(0 0% 0% / .32), 0 16px 32px -12px hsl(0 0% 0% / .55);
  --shadow-4: 0 4px 10px -2px hsl(0 0% 0% / .34), 0 28px 48px -16px hsl(0 0% 0% / .60);
  --shadow-5: 0 32px 64px -16px hsl(0 0% 0% / .70);
```

Leave the `--shadow-inset` and `--ring-media` overrides in `.dark` unchanged.

- [ ] **Step 3: Confirm the contrast script still passes**

Shadows are alpha-composited and not measured, but the script also guards against a malformed edit to the file.

```bash
node scripts/check-contrast.mjs
```

Expected: exit 0.

- [ ] **Step 4: Build**

```bash
bunx vite build --logLevel error
```

Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/styles/tokens.css
git commit -m "feat(tokens): retune shadow scale for soft-card elevation

Two-layer diffuse shadows with negative spread replace the tight-radius
scale. Applies globally, so components outside the dashboard will look
different before phases 2-3 restyle them — expected and accepted."
```

---

### Task 10: Add the `.text-num` utility

Industrial signal #1. The mono family is already in the token layer, so this costs one class.

**Files:**
- Modify: `apps/frontend/src/index.css` (`@layer base`, next to `.text-label`)

- [ ] **Step 1: Add the utility**

In `src/index.css`, immediately after the closing brace of the `.text-label` rule inside `@layer base`, add:

```css
  /* Angka dan tanggal memakai mono bertabular supaya digit sejajar dalam
     kolom saat dibaca menurun. Dipakai di setiap statistik, hitungan,
     tanggal dan durasi. */
  .text-num {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }
```

- [ ] **Step 2: Verify it reaches the built CSS**

```bash
bunx vite build --logLevel error && grep -c 'text-num' dist/assets/index-*.css
```

Expected: build exits 0 and grep prints a count of at least `1`.

- [ ] **Step 3: Commit**

```bash
git add src/index.css
git commit -m "feat(styles): add .text-num tabular mono utility

Industrial signal 1 from the spec. Sits beside .text-label, which already
covers signal 2."
```

---

### Task 11: Card — soft, borderless, elevated

**Files:**
- Modify: `apps/frontend/src/components/ui/card.module.css` (`.card`)

- [ ] **Step 1: Apply the soft-card treatment**

Replace the `.card` rule (as repaired in Task 4) with:

```css
.card {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  border-radius: var(--radius-xl);
  border: none;
  padding-top: 1rem;
  padding-bottom: 1rem;
  background: var(--surface-raised);
  color: var(--text);
  box-shadow: var(--shadow-2);
}
```

The border is removed entirely, not lightened — under the governing rule, a white card on a tinted canvas separates by fill and elevation, and a border on top of that reads as noise.

- [ ] **Step 2: Move internal dividers to `--border-subtle`**

Still in `card.module.css`, the `.card:where(.borderB) > .header` and `.card:where(.borderT) > .footer` rules currently set only padding. Add the divider each implies, so the class name matches its behaviour:

```css
.card:where(.borderB) > .header {
  padding-bottom: 1rem;
  border-bottom: 1px solid var(--border-subtle);
}
```

```css
.card:where(.borderT) > .footer {
  padding-top: 1rem;
  border-top: 1px solid var(--border-subtle);
}
```

- [ ] **Step 3: Build**

```bash
bunx vite build --logLevel error
```

Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/card.module.css
git commit -m "feat(ui): soft borderless card

16px radius, --surface-raised fill, --shadow-2, no border. Internal
section dividers use --border-subtle."
```

---

### Task 12: Button — restrict elevation to the primary variant

Right now `shadow-1` sits on four of six variants. When every button is lifted, none of them are.

**Files:**
- Modify: `apps/frontend/src/components/ui/button.tsx:28-36`

- [ ] **Step 1: Remove `shadow-1` from the non-primary variants**

Replace the `variant` block:

```tsx
        default: "bg-brand text-text-on-brand shadow-1 hover:bg-brand-hover",
        secondary:
          "bg-surface-sunken text-text shadow-1 hover:bg-surface-hover",
        destructive:
          "bg-danger text-text-on-danger shadow-1 hover:bg-danger/90",
        outline:
          "border border-border bg-surface-raised text-text shadow-1 hover:bg-surface-hover",
        ghost: "text-text hover:bg-surface-hover",
        link: "text-brand-text underline underline-offset-4",
```

with:

```tsx
        // Hanya `default` yang terangkat. Kalau semua tombol punya bayangan,
        // tidak ada yang menonjol dan aksi utama kehilangan targetnya
        // (aturan 4).
        default: "bg-brand text-text-on-brand shadow-1 hover:bg-brand-hover",
        secondary: "bg-surface-sunken text-text hover:bg-surface-hover",
        destructive:
          "bg-danger text-text-on-danger hover:bg-danger/90",
        outline:
          "border border-border bg-surface-raised text-text hover:bg-surface-hover",
        ghost: "text-text hover:bg-surface-hover",
        link: "text-brand-text underline underline-offset-4",
```

Keep the existing comment above `default` about `--brand-hover` — it documents a measured pairing and is still true.

The base class list already contains `rounded-full`, so the pill treatment needs no change.

- [ ] **Step 2: Type-check and lint**

```bash
bun run tsc --noEmit && bun run lint
```

Expected: both exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/button.tsx
git commit -m "feat(ui): lift only the primary button

shadow-1 removed from secondary, destructive and outline so the blue
primary is the obvious target."
```

---

### Task 13: Inputs and textarea — sunken fill

Sunken controls against raised cards signal "editable" without a heavy outline.

**Files:**
- Modify: `apps/frontend/src/components/ui/input.module.css` (`.input`)
- Modify: `apps/frontend/src/components/ui/textarea.module.css` (`.textarea`)

- [ ] **Step 1: Update `.input`**

Replace these three lines in the `.input` rule:

```css
  border-radius: var(--radius-md);
  border: 1px solid var(--border);
  background: var(--surface-raised);
```

with:

```css
  border-radius: var(--radius-lg);
  border: 1px solid var(--border);
  background: var(--surface-sunken);
  box-shadow: var(--shadow-inset);
```

- [ ] **Step 2: Update `.textarea`**

In the `.textarea` rule, replace these three lines:

```css
  border-radius: var(--radius-md);
  border: 1px solid var(--border);
  background: var(--surface-raised);
```

with:

```css
  border-radius: var(--radius-lg);
  border: 1px solid var(--border);
  background: var(--surface-sunken);
  box-shadow: var(--shadow-inset);
```

- [ ] **Step 3: Confirm the focus ring still overrides the inset shadow**

Both files already declare, in their `:focus-visible` rule:

```css
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--focus) 50%, transparent);
```

Because it appears later in the file, it replaces `--shadow-inset` on focus. That is intended — the focus ring must not compete with an inset edge. **No change needed**; this step is a read-and-confirm.

- [ ] **Step 4: Verify placeholder contrast still holds**

Placeholders use `--text-muted`, now sitting on the darkened `--surface-sunken`.

```bash
node scripts/check-contrast.mjs
```

Expected: exit 0, and this line under LIGHT:

```
  ok    4.87 (min 4.5)  --text-muted on --surface-sunken
```

- [ ] **Step 5: Build**

```bash
bunx vite build --logLevel error
```

Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/components/ui/input.module.css src/components/ui/textarea.module.css
git commit -m "feat(ui): sunken input and textarea fills

--surface-sunken + --shadow-inset + 12px radius. Placeholder contrast on
the darkened sunken surface verified at 4.87:1."
```

---

### Task 14: App shell — tinted bar, no border, shadow on scroll

The chrome decision: the bar is tint-on-tint at rest and earns a shadow only once content is behind it.

**Files:**
- Modify: `apps/frontend/src/features/auth/components/app-shell.tsx`

- [ ] **Step 1: Add the scroll listener and apply the treatment**

Note this step also makes the header `sticky top-0 z-40`, which it is not today. That is a deliberate behaviour change, not incidental styling: a shadow that appears on scroll is meaningless on a header that scrolls away with the content.

Replace the whole component body. The imports at the top of the file gain `useEffect` and `useState` from React.

Add to the top of the file, above the existing `@tanstack/react-router` import:

```tsx
import { useEffect, useState } from "react";
```

Then replace the `AppShell` function:

```tsx
export function AppShell() {
  const user = useAtomValue(currentUserAtom);
  const logout = useLogout();
  const navigate = useNavigate();

  function onSignOut() {
    logout();
    navigate({ to: "/login" });
  }

  return (
    <div className="min-h-screen">
      <header className="flex h-14 items-center justify-between border-b px-4">
```

with:

```tsx
export function AppShell() {
  const user = useAtomValue(currentUserAtom);
  const logout = useLogout();
  const navigate = useNavigate();
  // Bar dan kanvas sama-sama --surface tanpa garis pemisah, jadi tidak ada
  // apa pun yang menandai batasnya saat konten lewat di bawahnya. Bayangan
  // ini menggantikan border yang sengaja dilepas.
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 0);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  function onSignOut() {
    logout();
    navigate({ to: "/login" });
  }

  return (
    <div className="min-h-screen bg-surface">
      <header
        className={cn(
          "sticky top-0 z-40 flex h-14 items-center justify-between bg-surface px-4",
          "transition-shadow [transition-duration:var(--duration-fast)] [transition-timing-function:var(--ease-out)]",
          scrolled && "shadow-1",
        )}
      >
```

- [ ] **Step 2: Import `cn`**

The component now uses `cn`. The file already imports `getInitials` from `@/lib/utils` — extend that import:

```tsx
import { getInitials } from "@/lib/utils";
```

becomes:

```tsx
import { cn, getInitials } from "@/lib/utils";
```

- [ ] **Step 3: Give the active nav link the brand treatment**

Each of the three `<Link>` elements currently uses `activeProps={{ className: "text-text" }}`. Blue marks the active item (spec §3.6). For all three links, replace:

```tsx
              activeProps={{ className: "text-text" }}
```

with:

```tsx
              activeProps={{ className: "bg-brand-subtle text-brand-text font-semibold" }}
```

and change each link's base class from:

```tsx
              className="rounded-sm px-2 py-1 text-text-muted transition-colors hover:text-text"
```

to:

```tsx
              className="rounded-full px-3 py-1 text-text-muted transition-colors hover:text-text"
```

Apply to all three (`/dashboard`, `/projects`, `/my-tasks`) — the classes are identical in each.

- [ ] **Step 4: Type-check and lint**

```bash
bun run tsc --noEmit && bun run lint
```

Expected: both exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/features/auth/components/app-shell.tsx
git commit -m "feat(shell): tinted top bar, shadow on scroll, blue active nav

The bar is tint-on-tint with no rule, so nothing marked its boundary once
content scrolled under it — --shadow-1 appears at scrollY > 0 to replace
the border that was dropped. Active nav gets the brand pill."
```

---

### Task 15: Dashboard stat cards

**Files:**
- Modify: `apps/frontend/src/features/dashboard/components/stat-cards.tsx`

- [ ] **Step 1: Apply `.text-label` and `.text-num` in `StatCard`**

Replace the inner `<div>` of `StatCard`:

```tsx
        <div>
          <div
            className={cn(
              "text-2xl font-semibold",
              alert ? "text-danger" : "text-text",
            )}
          >
            {value}
          </div>
          <div className="text-xs text-text-muted">{label}</div>
        </div>
```

with:

```tsx
        <div>
          <div
            className={cn(
              "text-num text-2xl font-semibold",
              alert ? "text-danger" : "text-text",
            )}
          >
            {value}
          </div>
          <div className="text-label">{label}</div>
        </div>
```

`.text-label` supplies its own size, weight, tracking and colour, so `text-xs text-text-muted` is dropped rather than kept alongside it.

- [ ] **Step 2: Update the per-project rows**

Replace the `<Link>` inside the per-project list:

```tsx
                    className="block rounded-md border p-3 hover:bg-surface-sunken/40"
```

with:

```tsx
                    className="block rounded-xl bg-surface-raised p-3 shadow-1 transition-shadow [transition-duration:var(--duration-fast)] hover:shadow-2"
```

and replace the counter:

```tsx
                      <span className="text-text-muted">
                        {p.done}/{p.total}
                      </span>
```

with:

```tsx
                      <span className="text-num text-text-muted">
                        {p.done}/{p.total}
                      </span>
```

- [ ] **Step 3: Match the loading skeleton to the new radius**

Cards are now `--radius-xl`. Replace:

```tsx
          <Skeleton key={i} className="h-20 w-full rounded-xl" />
```

with:

```tsx
          <Skeleton key={i} className="h-20 w-full rounded-xl shadow-2" />
```

- [ ] **Step 4: Type-check and lint**

```bash
bun run tsc --noEmit && bun run lint
```

Expected: both exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/features/dashboard/components/stat-cards.tsx
git commit -m "feat(dashboard): mono stat values, label treatment, soft project rows"
```

---

### Task 16: Task rows and upcoming deadlines

**Files:**
- Modify: `apps/frontend/src/features/dashboard/components/my-task-row.tsx`
- Modify: `apps/frontend/src/features/dashboard/components/upcoming-deadlines.tsx`

- [ ] **Step 1: Update the row divider and date in `my-task-row.tsx`**

Replace the `<Link>` className:

```tsx
      className="flex items-center gap-3 rounded-md border-b px-2 py-2 last:border-b-0 hover:bg-surface-sunken/40"
```

with:

```tsx
      className="flex items-center gap-3 border-b border-border-subtle px-4 py-3 transition-colors [transition-duration:var(--duration-fast)] last:border-b-0 hover:bg-surface-hover"
```

The radius is dropped — these rows sit inside a card that already provides the rounding, and a rounded row inside a rounded card produces a visible double curve at the corners.

Then replace the due date:

```tsx
      {task.dueDate && (
        <span className="text-xs text-text-muted">{task.dueDate}</span>
      )}
```

with:

```tsx
      {task.dueDate && (
        <span className="text-num text-xs text-text-muted">{task.dueDate}</span>
      )}
```

- [ ] **Step 2: Wrap the list in a card in `upcoming-deadlines.tsx`**

Replace:

```tsx
  return (
    <div className="rounded-lg border">
      {items.map((it) => (
        <MyTaskRow key={it.task.id} item={it} />
      ))}
    </div>
  );
```

with:

```tsx
  return (
    <div className="overflow-hidden rounded-xl bg-surface-raised shadow-2">
      {items.map((it) => (
        <MyTaskRow key={it.task.id} item={it} />
      ))}
    </div>
  );
```

`overflow-hidden` is required: the rows are square and would otherwise paint over the container's rounded corners.

- [ ] **Step 3: Match the empty and loading states**

Replace:

```tsx
  if (isLoading) {
    return <Skeleton className="h-24 w-full" />;
  }
  if (items.length === 0) {
    return (
      <p className="text-sm text-text-muted">
        Nothing due in the next {withinDays} days.
      </p>
    );
  }
```

with:

```tsx
  if (isLoading) {
    return <Skeleton className="h-24 w-full rounded-xl" />;
  }
  if (items.length === 0) {
    return (
      <p className="rounded-xl bg-surface-raised p-6 text-center text-sm text-text-muted shadow-2">
        Nothing due in the next {withinDays} days.
      </p>
    );
  }
```

- [ ] **Step 4: Type-check and lint**

```bash
bun run tsc --noEmit && bun run lint
```

Expected: both exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/features/dashboard/components/my-task-row.tsx src/features/dashboard/components/upcoming-deadlines.tsx
git commit -m "feat(dashboard): card-wrapped deadline list with hairline rows

Rows lose their own radius — nested rounding inside a rounded card
produces a double curve at the corners. Container clips instead."
```

---

### Task 17: Dashboard page headings

**Files:**
- Modify: `apps/frontend/src/routes/_authed/dashboard.tsx`

- [ ] **Step 1: Apply the heading treatment**

Replace the component body:

```tsx
    <div className="space-y-8 p-6">
      <h1 className="text-2xl font-semibold">Dashboard</h1>

      <StatCards />

      <div className="grid gap-8 lg:grid-cols-2">
        <section>
          <h2 className="mb-3 text-lg font-medium">Upcoming deadlines</h2>
          <UpcomingDeadlines withinDays={7} />
        </section>
        <section>
          <h2 className="mb-3 text-lg font-medium">Recent activity</h2>
          <RecentActivity />
        </section>
      </div>
    </div>
```

with:

```tsx
    <div className="mx-auto max-w-7xl space-y-8 p-6">
      <h1 className="text-2xl font-semibold">Dashboard</h1>

      <StatCards />

      <div className="grid gap-8 lg:grid-cols-2">
        <section>
          <h2 className="text-label mb-3">Upcoming deadlines</h2>
          <UpcomingDeadlines withinDays={7} />
        </section>
        <section>
          <h2 className="text-label mb-3">Recent activity</h2>
          <RecentActivity />
        </section>
      </div>
    </div>
```

Section headings move to `.text-label` so they read as labels above their content rather than competing with the page title. `max-w-7xl` stops cards stretching to absurd widths on wide monitors.

- [ ] **Step 2: Type-check and lint**

```bash
bun run tsc --noEmit && bun run lint
```

Expected: both exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/routes/_authed/dashboard.tsx
git commit -m "feat(dashboard): label-style section headings, max-width container"
```

---

### Task 18: Phase 1 gate — full verification and review checkpoint

**STOP HERE.** Do not begin Phase 2. This task ends with a human review.

**Files:** none — verification only.

- [ ] **Step 1: Run every automated gate**

```bash
cd /home/qyubit/Workspace/personal/task-management/apps/frontend
node scripts/check-contrast.mjs && \
grep -lE 'rgba\(|rgb\(|hsl\(|#[0-9a-fA-F]{3,6}|--glass' src/components/ui/*.module.css; \
bun run tsc --noEmit && bun run lint && bunx vite build --logLevel error
```

Expected:
- contrast script: exit 0, `All measured pairings pass.`
- grep: **no output** (any file listed is a regression)
- tsc, lint, build: all exit 0

- [ ] **Step 2: Start the dev server**

```bash
bun run dev
```

- [ ] **Step 3: Review the Dashboard in light mode**

At `http://localhost:3001/dashboard`, confirm:

- [ ] Page canvas is tinted; every card is white and floats on it
- [ ] Top bar is the same tint as the canvas with **no** line beneath it
- [ ] Scrolling makes a soft shadow appear under the top bar; scrolling back to top removes it
- [ ] Active nav item shows as a blue pill
- [ ] Stat values render in mono with aligned digits; stat labels are uppercase and tracked
- [ ] Deadline rows are separated by a hairline, not a heavy line, with no double curve at the card's corners
- [ ] Blue appears only on: primary button, active nav, focus rings, progress bars, links

- [ ] **Step 4: Review the Dashboard in dark mode**

Toggle the theme and confirm the same list holds, plus:

- [ ] Card shadows are still visible against the dark canvas
- [ ] Hairline dividers are still visible (they invert to a lighter grey in dark)

- [ ] **Step 5: Keyboard-only accessibility check**

Tab through the page and confirm every focused control shows a visible focus ring against the surface behind it, in both themes.

- [ ] **Step 6: Confirm the expected mixed state elsewhere**

Visit `/projects` and open a project. Those routes will look **inconsistent** — new token values, old component styling. Confirm they are inconsistent but not *broken*: no invisible text, no dark panel in light mode, no unreadable control. Anything actually broken is a regression from Phases 0–1 and must be fixed before the review.

- [ ] **Step 7: Stop the server and hand off for review**

Report to the user:
- output of the contrast script
- confirmation that all four automated gates passed
- anything from Steps 3–6 that did not match
- the specific open question from spec §7: **does the soft-dominant density hold up at real data volume, or do list rows need tightening from 13px toward 9px?**

Phase 2 begins only after the user approves.

---

## Notes for the implementer

**Do not "fix" other routes while passing through them.** Phases 2–3 handle those, against patterns this phase locks. Ad-hoc fixes now are exactly how the current inconsistency arose.

**Do not add a test framework.** Verification is the four gates described at the top.

**If a contrast measurement fails after a token edit**, the token is wrong — not the threshold. Change the value; do not loosen the assertion in `check-contrast.mjs`.

The one legitimate reason to move a pairing out of `PAIRS` is that **WCAG does not actually impose a threshold on it** — as with `--brand` on `--surface-raised`, where a filled control is identified by its label rather than its edge. That is a claim about the standard, and it belongs in a comment next to the exemption with the reasoning written out. "It fails and I need it to pass" is not that claim, and a pairing must never be moved for that reason.

**Comments in `tokens.css` are in Indonesian** and record *why* a value was chosen, usually a measurement. Match that language and keep recording reasons — a token comment that says what a value is rather than why it is that value has no purpose.
