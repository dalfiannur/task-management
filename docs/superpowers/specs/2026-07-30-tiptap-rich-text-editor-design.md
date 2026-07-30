# Tiptap Rich-Text Editor — Design

**Date:** 2026-07-30
**Status:** Approved (pending spec review)

## Summary

Replace the three plain `<Textarea>` content surfaces (wiki pages, task
descriptions, comments) with a shared **Tiptap** WYSIWYG rich-text editor.
Content is stored as **HTML** (Tiptap's native format), not Markdown — though
StarterKit's input rules preserve the Markdown *feel* (`# `, `- `, `**bold**`,
` ``` ` all auto-format as you type). Comments gain inline `@`-mention
autocomplete. HTML is sanitized on the backend before persisting and again on
the frontend before rendering.

### Decisions locked in during brainstorming

- **Surfaces:** wiki pages, comments, task descriptions (all three).
- **Storage format:** HTML (switch from Markdown). Backend `content`/`description`
  fields are unchanged strings — only the content shape changes.
- **Sanitization:** defense-in-depth — sanitize on save (Rust) *and* on render (FE).
- **Mentions:** inline `@`-autocomplete (replaces the separate mention picker).
- **Existing data:** dummy/throwaway — no migration. Old Markdown rows may render
  as literal text; acceptable.

## Non-goals (YAGNI)

- No Markdown storage / `tiptap-markdown` round-trip.
- No migration of existing content.
- No collaborative/real-time editing, image paste-upload, tables, or slash menu
  (can come later; not in this scope).

## Architecture

### Frontend components

Two new shared files in `apps/frontend/src/components/shared/`, reused by all
three surfaces (follows the existing "cross-feature helpers" convention).

**`rich-text-editor.tsx`** — Tiptap editor wrapper (`useEditor` + `EditorContent`).

- Props:
  - `value: string` — HTML.
  - `onChange(html: string): void`.
  - `placeholder?: string`.
  - `editable?: boolean` (default `true`).
  - `mentionMembers?: { id: string; name: string }[]` — when provided, the
    Mention extension is enabled and fed by this list.
- Extensions:
  - `StarterKit` — headings, bold, italic, strike, code, code block, blockquote,
    bullet/ordered lists, plus the Markdown-style **input rules**.
  - `Placeholder` — reuses existing `.tiptap p.is-editor-empty` CSS in `index.css`.
  - `Link`.
  - `Mention` (+ `@tiptap/suggestion`) — conditional on `mentionMembers`.
- Minimal **fixed toolbar** (shadcn `Button`s): bold, italic, heading, bullet
  list, ordered list, link, code. Reflects active marks via `editor.isActive(...)`.
- Editor surface styled with the existing `.prose` class so editing and reading
  look identical.

**`rich-text-content.tsx`** — read-only renderer.

- `DOMPurify.sanitize(html)` → `dangerouslySetInnerHTML` inside a `.prose` div.
- Defense-in-depth layer on top of backend sanitization.

### Inline mentions (comments only)

- **Suggestion source:** the comment thread already has `memberIds` + `userMap`;
  map them to `{ id, name }` and pass as `mentionMembers`. The `@` popover is
  rendered with a shadcn popover/command list styled like the existing member
  picker.
- **Rendered form:** each mention is
  `<span data-type="mention" data-id="{userId}">@Name</span>` within the HTML.
- **Extracting `mentionedUserIds`:** on submit, walk the editor doc for `mention`
  nodes and collect their `data-id`s (deduped). Pass as `mentionedUserIds` to the
  create/update RPC — **the backend notification flow is untouched**
  (`filter_mentions` + notifier in `comment_service.rs` still works as-is).
- The separate mention `<Popover>` multi-select in `comment-composer.tsx` is removed.

### Backend sanitize-on-save

- Add the **`ammonia`** crate to the `domain` crate.
- New helper `domain::sanitize::clean_html(input: &str) -> String` with an
  allowlist matching Tiptap's output:
  - Tags: `h1, h2, h3, p, strong, em, s, code, pre, blockquote, ul, ol, li,
    a, br, span`.
  - `a` keeps `href` (safe schemes only); `span` keeps `data-type` and `data-id`
    (for mentions). Everything else stripped.
- Applied at every write site, right after the existing `trim()` / `content_ok`
  check, before persisting:
  - `crates/transport/src/comments/comment_service.rs` — `create_comment`, `update_comment`.
  - `crates/transport/src/pages/page_service.rs` — create + update (`content`).
  - `crates/transport/src/work/task_service.rs` — task `description`
    (and `work/module_service.rs` if module descriptions are editable).
- `content_ok` remains the non-empty gate; sanitize runs on the trimmed HTML.

### Wiring & dependencies

- Swap `<Textarea>` → `<RichTextEditor>` in:
  - `features/pages/components/page-editor.tsx`
  - `features/comments/components/comment-composer.tsx` (+ remove mention popover,
    add `mentionMembers`, extract `mentionedUserIds` on submit)
  - `features/tasks/components/task-dialog.tsx` (description field)
- Swap raw-text render → `<RichTextContent>` in
  `features/comments/components/comment-thread.tsx` (currently the
  `whitespace-pre-wrap` `<p>` at line ~146).
- **FE deps:** `@tiptap/react`, `@tiptap/starter-kit`,
  `@tiptap/extension-placeholder`, `@tiptap/extension-link`,
  `@tiptap/extension-mention`, `@tiptap/suggestion`, `dompurify`
  (+ `@types/dompurify`).
- **BE dep:** `ammonia` (in `domain` crate).

## Data flow

1. User types in `<RichTextEditor>` → Tiptap emits HTML → `onChange(html)` →
   local state.
2. On submit, comment surfaces also extract `mentionedUserIds` from mention nodes.
3. RPC sends `content`/`description` (HTML) [+ `mentionedUserIds` for comments].
4. Backend `trim` → `content_ok` gate → `clean_html` sanitize → persist.
   Comment notifier fires for filtered mentions (unchanged).
5. On read, `<RichTextContent>` runs `DOMPurify.sanitize` → renders in `.prose`.

## Error handling

- Empty / whitespace-only content rejected by existing `content_ok` (Tiptap empty
  doc serializes to `<p></p>` — the composer's `content.trim()`/emptiness guard
  must treat an empty Tiptap doc as empty; strip tags or check `editor.isEmpty`
  before enabling submit).
- Malicious HTML neutralized by `clean_html` (BE) and `DOMPurify` (FE).
- Non-member mentions filtered by existing `filter_mentions`.

## Testing / verification

- **Backend:** unit tests for `clean_html` — strips `<script>` and event handlers
  (`onerror=`), keeps allowlisted tags and mention `span[data-id]`. Existing
  `comment_flow.rs` integration test still passes.
- **Frontend gates (per CLAUDE.md):** `tsc --noEmit`, `bun run lint`, `vite build`.
- **Manual:** create/edit a page, a task description, and a comment with an
  `@`-mention; confirm the mention notification still fires and rendered HTML
  matches the editor.

## Open questions

- None blocking. Module-description sanitization included only if module
  descriptions are user-editable (confirm during implementation).
