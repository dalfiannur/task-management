# Tiptap Rich-Text Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the three plain `<Textarea>` content surfaces (wiki pages, task descriptions, comments) with a shared Tiptap WYSIWYG editor that stores HTML, with inline `@`-mentions in comments and HTML sanitization on both save (Rust) and render (frontend).

**Architecture:** One shared `<RichTextEditor>` (Tiptap) + one shared `<RichTextContent>` (sanitized HTML renderer) on the frontend, reused by all three surfaces. StarterKit gives Markdown-style input rules; the Mention extension is enabled only for comments and extracts `mentionedUserIds` from the doc on submit (backend notification flow unchanged). Backend adds a `domain::sanitize::clean_html` (ammonia) helper applied at every content write site.

**Tech Stack:** React 19 + Tiptap (`@tiptap/react`, `starter-kit`, `extension-placeholder`, `extension-link`, `extension-mention`, `suggestion`), DOMPurify (frontend); Rust + `ammonia` (backend).

**Reference spec:** `docs/superpowers/specs/2026-07-30-tiptap-rich-text-editor-design.md`

**Note on frontend testing:** the frontend has no test framework (per CLAUDE.md). Frontend tasks are gated by `bun run tsc --noEmit`, `bun run lint`, and `bun run build` instead of unit tests. Backend tasks use `cargo test` TDD.

---

## File Structure

**Backend (`apps/backend-rs/`)**
- Create: `crates/domain/src/sanitize.rs` — `clean_html` helper + unit tests
- Modify: `crates/domain/src/lib.rs` — register `pub mod sanitize;`
- Modify: `crates/domain/Cargo.toml` — add `ammonia`
- Modify: `crates/transport/src/comments/comment_service.rs` — sanitize on create/update
- Modify: `crates/transport/src/pages/page_service.rs` — sanitize on create/update
- Modify: `crates/transport/src/work/task_service.rs` — sanitize `description`
- Modify: `crates/transport/src/work/module_service.rs` — sanitize `description`

**Frontend (`apps/frontend/`)**
- Modify: `package.json` — add Tiptap + DOMPurify deps
- Create: `src/components/shared/rich-text-content.tsx` — read-only sanitized renderer
- Create: `src/components/shared/rich-text-editor.tsx` — Tiptap editor + toolbar
- Create: `src/components/shared/mention-list.tsx` — `@`-suggestion dropdown
- Create: `src/components/shared/rich-text-mention.ts` — mention config + `extractMentionIds`
- Modify: `src/features/pages/components/page-editor.tsx` — Textarea → RichTextEditor
- Modify: `src/features/tasks/components/task-dialog.tsx` — Textarea → RichTextEditor
- Modify: `src/features/comments/components/comment-composer.tsx` — RichTextEditor + inline mentions, remove picker
- Modify: `src/features/comments/components/comment-thread.tsx` — raw text → RichTextContent

---

## Task 1: Backend — `clean_html` sanitizer

**Files:**
- Modify: `apps/backend-rs/crates/domain/Cargo.toml`
- Create: `apps/backend-rs/crates/domain/src/sanitize.rs`
- Modify: `apps/backend-rs/crates/domain/src/lib.rs`

- [ ] **Step 1: Add the ammonia dependency**

In `apps/backend-rs/crates/domain/Cargo.toml`, under `[dependencies]`, add:

```toml
ammonia = "4"
```

- [ ] **Step 2: Write `sanitize.rs` with failing tests**

Create `apps/backend-rs/crates/domain/src/sanitize.rs`:

```rust
//! HTML sanitization for user-authored rich-text content (Tiptap output).
//! Allowlist mirrors exactly what the frontend editor can emit.

use ammonia::Builder;
use std::collections::HashSet;

/// Sanitize an HTML fragment, keeping only the tags/attributes the rich-text
/// editor produces. Everything else (scripts, event handlers, unknown tags,
/// unsafe URL schemes) is stripped.
pub fn clean_html(input: &str) -> String {
    let tags: HashSet<&str> = [
        "h1", "h2", "h3", "p", "strong", "em", "s", "code", "pre", "blockquote",
        "ul", "ol", "li", "a", "br", "span",
    ]
    .into_iter()
    .collect();

    Builder::default()
        .tags(tags)
        .add_tag_attributes("a", &["href"])
        .add_tag_attributes("span", &["data-type", "data-id"])
        .link_rel(Some("noopener noreferrer nofollow"))
        .clean(input)
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_script_tags() {
        let out = clean_html("<p>hi</p><script>alert(1)</script>");
        assert!(!out.contains("script"));
        assert!(out.contains("<p>hi</p>"));
    }

    #[test]
    fn strips_event_handlers() {
        let out = clean_html(r#"<p onclick="steal()">x</p>"#);
        assert!(!out.contains("onclick"));
    }

    #[test]
    fn strips_javascript_urls() {
        let out = clean_html(r#"<a href="javascript:alert(1)">x</a>"#);
        assert!(!out.contains("javascript:"));
    }

    #[test]
    fn keeps_allowlisted_formatting() {
        let out = clean_html("<h1>T</h1><ul><li><strong>a</strong></li></ul>");
        assert!(out.contains("<h1>T</h1>"));
        assert!(out.contains("<strong>a</strong>"));
        assert!(out.contains("<li>"));
    }

    #[test]
    fn keeps_mention_span() {
        let out = clean_html(
            r#"<p><span data-type="mention" data-id="u1">@Ann</span></p>"#,
        );
        assert!(out.contains(r#"data-type="mention""#));
        assert!(out.contains(r#"data-id="u1""#));
    }
}
```

- [ ] **Step 3: Register the module**

In `apps/backend-rs/crates/domain/src/lib.rs`, add alongside the other `pub mod` lines:

```rust
pub mod sanitize;
```

- [ ] **Step 4: Run the tests — expect PASS**

Run: `cd apps/backend-rs && cargo test -p domain sanitize`
Expected: 5 tests pass (`strips_script_tags`, `strips_event_handlers`, `strips_javascript_urls`, `keeps_allowlisted_formatting`, `keeps_mention_span`).

- [ ] **Step 5: Commit**

```bash
git add apps/backend-rs/crates/domain/Cargo.toml apps/backend-rs/crates/domain/src/sanitize.rs apps/backend-rs/crates/domain/src/lib.rs apps/backend-rs/Cargo.lock
git commit -m "feat(backend-rs): add domain::sanitize::clean_html (ammonia)"
```

---

## Task 2: Backend — apply `clean_html` at all write sites

**Files:**
- Modify: `apps/backend-rs/crates/transport/src/comments/comment_service.rs`
- Modify: `apps/backend-rs/crates/transport/src/pages/page_service.rs`
- Modify: `apps/backend-rs/crates/transport/src/work/task_service.rs`
- Modify: `apps/backend-rs/crates/transport/src/work/module_service.rs`

- [ ] **Step 1: Sanitize comments**

In `comment_service.rs`, both `create_comment` and `update_comment` currently do:

```rust
    let content = r.content.trim();
    if !content_ok(content) {
        return Err(ConnectError::new_invalid_argument("content is required"));
    }
```

Change each to sanitize the trimmed content before it is stored. Replace the block with:

```rust
    let trimmed = r.content.trim();
    if !content_ok(trimmed) {
        return Err(ConnectError::new_invalid_argument("content is required"));
    }
    let content = domain::sanitize::clean_html(trimmed);
```

Then update the two struct literals that set `content: content.to_string()` to `content: content.clone()` (since `content` is now an owned `String`, not `&str`). If a later use of `content` needs `&str`, pass `&content`.

- [ ] **Step 2: Sanitize pages**

In `page_service.rs`, the create handler builds `content: r.content.unwrap_or_default()` (~line 91) and update builds `content: r.content.unwrap_or_else(|| p.content.clone())` (~line 133). Wrap each in the sanitizer:

Create handler:
```rust
                content: domain::sanitize::clean_html(&r.content.unwrap_or_default()),
```

Update handler:
```rust
        content: domain::sanitize::clean_html(
            &r.content.unwrap_or_else(|| p.content.clone()),
        ),
```

- [ ] **Step 3: Sanitize task descriptions**

In `task_service.rs`, the create handler sets `description: r.description.unwrap_or_default()` (~line 138). Wrap it:

```rust
                description: domain::sanitize::clean_html(
                    &r.description.unwrap_or_default(),
                ),
```

If the file also has an update handler that assigns `description`, apply the same `clean_html(&...)` wrap there.

- [ ] **Step 4: Sanitize module descriptions**

In `module_service.rs` (~line 124):

```rust
    let desc = r.description.map(|d| d.trim().to_string());
```

Change to sanitize when present:

```rust
    let desc = r
        .description
        .map(|d| domain::sanitize::clean_html(d.trim()));
```

- [ ] **Step 5: Build and test**

Run: `cd apps/backend-rs && cargo build && cargo test -p transport comment_flow`
Expected: build succeeds; the existing `comment_flow` integration test passes.

- [ ] **Step 6: Commit**

```bash
git add apps/backend-rs/crates/transport/src
git commit -m "feat(backend-rs): sanitize rich-text HTML on save (comments, pages, tasks, modules)"
```

---

## Task 3: Frontend — install dependencies

**Files:**
- Modify: `apps/frontend/package.json`

- [ ] **Step 1: Install packages**

Run:
```bash
cd apps/frontend && bun add @tiptap/react @tiptap/starter-kit @tiptap/extension-placeholder @tiptap/extension-link @tiptap/extension-mention @tiptap/suggestion dompurify && bun add -d @types/dompurify
```

- [ ] **Step 2: Verify install**

Run: `cd apps/frontend && bun run tsc --noEmit`
Expected: no new errors (tree still type-checks; new packages resolve).

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/package.json apps/frontend/bun.lock
git commit -m "chore(frontend): add tiptap + dompurify deps"
```

---

## Task 4: Frontend — `RichTextContent` renderer

**Files:**
- Create: `apps/frontend/src/components/shared/rich-text-content.tsx`
- Modify: `apps/frontend/src/features/comments/components/comment-thread.tsx`

- [ ] **Step 1: Create the renderer**

Create `apps/frontend/src/components/shared/rich-text-content.tsx`:

```tsx
import DOMPurify from "dompurify";
import { cn } from "@/lib/utils";

/** Read-only renderer for editor HTML. Sanitizes before injecting, and styles
 *  with `.prose`. Mention spans (data-type/data-id) are preserved. */
export function RichTextContent({
  html,
  className,
}: {
  html: string;
  className?: string;
}) {
  const clean = DOMPurify.sanitize(html, {
    ADD_ATTR: ["data-type", "data-id"],
  });
  return (
    <div
      className={cn("prose text-sm", className)}
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  );
}
```

- [ ] **Step 2: Use it in the comment thread**

In `comment-thread.tsx`, add the import near the top:

```tsx
import { RichTextContent } from "@/components/shared/rich-text-content";
```

Replace the raw-text render (currently around line 146):

```tsx
                    <p className="whitespace-pre-wrap text-sm">{c.content}</p>
```

with:

```tsx
                    <RichTextContent html={c.content} />
```

- [ ] **Step 3: Verify**

Run: `cd apps/frontend && bun run tsc --noEmit && bun run lint`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/components/shared/rich-text-content.tsx apps/frontend/src/features/comments/components/comment-thread.tsx
git commit -m "feat(frontend): sanitized RichTextContent renderer + use in comment thread"
```

---

## Task 5: Frontend — `RichTextEditor` base component (no mentions)

**Files:**
- Create: `apps/frontend/src/components/shared/rich-text-editor.tsx`

- [ ] **Step 1: Create the editor**

Create `apps/frontend/src/components/shared/rich-text-editor.tsx`:

```tsx
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Link from "@tiptap/extension-link";
import { useEffect } from "react";
import {
  Bold,
  Italic,
  Heading2,
  List,
  ListOrdered,
  Code,
  Link as LinkIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  editable?: boolean;
  className?: string;
  /** Extra Tiptap extensions (e.g. Mention). Kept stable by the caller. */
  extensions?: Parameters<typeof useEditor>[0]["extensions"];
  /** Give the caller the editor instance (e.g. to extract mentions on submit). */
  onEditorReady?: (editor: Editor) => void;
}

function ToolbarButton({
  active,
  onClick,
  label,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn("h-8 w-8", active && "bg-muted text-foreground")}
    >
      {children}
    </Button>
  );
}

export function RichTextEditor({
  value,
  onChange,
  placeholder,
  editable = true,
  className,
  extensions = [],
  onEditorReady,
}: RichTextEditorProps) {
  const editor = useEditor({
    editable,
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: false }),
      Placeholder.configure({ placeholder: placeholder ?? "Write…" }),
      ...extensions,
    ],
    content: value,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    editorProps: {
      attributes: {
        class: cn(
          "prose min-h-[6rem] max-w-none px-3 py-2 text-sm focus:outline-none",
        ),
      },
    },
  });

  // Re-sync when the caller replaces `value` externally (e.g. switching pages).
  useEffect(() => {
    if (editor && value !== editor.getHTML()) {
      editor.commands.setContent(value, false);
    }
  }, [value, editor]);

  useEffect(() => {
    if (editor && onEditorReady) onEditorReady(editor);
  }, [editor, onEditorReady]);

  if (!editor) return null;

  return (
    <div className={cn("rounded-md border", className)}>
      {editable && (
        <div className="flex flex-wrap items-center gap-0.5 border-b p-1">
          <ToolbarButton
            label="Bold"
            active={editor.isActive("bold")}
            onClick={() => editor.chain().focus().toggleBold().run()}
          >
            <Bold className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            label="Italic"
            active={editor.isActive("italic")}
            onClick={() => editor.chain().focus().toggleItalic().run()}
          >
            <Italic className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            label="Heading"
            active={editor.isActive("heading", { level: 2 })}
            onClick={() =>
              editor.chain().focus().toggleHeading({ level: 2 }).run()
            }
          >
            <Heading2 className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            label="Bullet list"
            active={editor.isActive("bulletList")}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
          >
            <List className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            label="Numbered list"
            active={editor.isActive("orderedList")}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
          >
            <ListOrdered className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            label="Code"
            active={editor.isActive("code")}
            onClick={() => editor.chain().focus().toggleCode().run()}
          >
            <Code className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            label="Link"
            active={editor.isActive("link")}
            onClick={() => {
              const prev = editor.getAttributes("link").href as
                | string
                | undefined;
              const url = window.prompt("Link URL", prev ?? "https://");
              if (url === null) return;
              if (url === "") {
                editor.chain().focus().unsetLink().run();
                return;
              }
              editor.chain().focus().setLink({ href: url }).run();
            }}
          >
            <LinkIcon className="h-4 w-4" />
          </ToolbarButton>
        </div>
      )}
      <EditorContent editor={editor} />
    </div>
  );
}
```

> Note: `window.prompt` is used for the link URL. This is the one intentional dialog; it does not block the browser-automation extension because it is a genuine user action, not something triggered during automated navigation.

- [ ] **Step 2: Verify**

Run: `cd apps/frontend && bun run tsc --noEmit && bun run lint`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/components/shared/rich-text-editor.tsx
git commit -m "feat(frontend): shared RichTextEditor (tiptap) with toolbar"
```

---

## Task 6: Frontend — wire pages + task descriptions

**Files:**
- Modify: `apps/frontend/src/features/pages/components/page-editor.tsx`
- Modify: `apps/frontend/src/features/tasks/components/task-dialog.tsx`

- [ ] **Step 1: Page editor**

In `page-editor.tsx`, replace the `Textarea` import:

```tsx
import { Textarea } from "@/components/ui/textarea";
```

with:

```tsx
import { RichTextEditor } from "@/components/shared/rich-text-editor";
```

Replace the `<Textarea …>` block (lines ~107-112) with:

```tsx
      <div className="flex-1 overflow-auto p-3">
        <RichTextEditor
          value={content}
          onChange={setContent}
          placeholder="Write the page…"
        />
      </div>
```

- [ ] **Step 2: Task dialog**

In `task-dialog.tsx`, replace the `Textarea` import with:

```tsx
import { RichTextEditor } from "@/components/shared/rich-text-editor";
```

Replace the description `<Textarea>` block (lines ~147-152) with:

```tsx
            <RichTextEditor
              value={description}
              onChange={setDescription}
              placeholder="Describe the task…"
            />
```

(Leave the surrounding `<Label htmlFor="description">` as-is; the label still describes the field.)

- [ ] **Step 3: Verify**

Run: `cd apps/frontend && bun run tsc --noEmit && bun run lint`
Expected: passes. If `Textarea` is now unused in either file, ESLint will flag it — remove the leftover import.

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/features/pages/components/page-editor.tsx apps/frontend/src/features/tasks/components/task-dialog.tsx
git commit -m "feat(frontend): rich-text editor for pages + task descriptions"
```

---

## Task 7: Frontend — mention extension + suggestion dropdown

**Files:**
- Create: `apps/frontend/src/components/shared/mention-list.tsx`
- Create: `apps/frontend/src/components/shared/rich-text-mention.ts`

- [ ] **Step 1: Create the suggestion dropdown component**

Create `apps/frontend/src/components/shared/mention-list.tsx`:

```tsx
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useState,
} from "react";
import { cn } from "@/lib/utils";

export interface MentionItem {
  id: string;
  name: string;
}

export interface MentionListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

/** Dropdown rendered inside the tiptap suggestion popup. `command` inserts the
 *  chosen mention node. */
export const MentionList = forwardRef<
  MentionListRef,
  { items: MentionItem[]; command: (item: MentionItem) => void }
>(function MentionList({ items, command }, ref) {
  const [selected, setSelected] = useState(0);

  useEffect(() => setSelected(0), [items]);

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (event.key === "ArrowUp") {
        setSelected((s) => (s + items.length - 1) % items.length);
        return true;
      }
      if (event.key === "ArrowDown") {
        setSelected((s) => (s + 1) % items.length);
        return true;
      }
      if (event.key === "Enter") {
        const item = items[selected];
        if (item) command(item);
        return true;
      }
      return false;
    },
  }));

  if (items.length === 0) {
    return (
      <div className="rounded-md border bg-popover p-2 text-sm text-muted-foreground shadow-md">
        No members
      </div>
    );
  }

  return (
    <div className="max-h-52 w-56 overflow-y-auto rounded-md border bg-popover p-1 shadow-md">
      {items.map((item, i) => (
        <button
          key={item.id}
          type="button"
          onClick={() => command(item)}
          className={cn(
            "flex w-full items-center rounded px-2 py-1.5 text-left text-sm hover:bg-muted",
            i === selected && "bg-muted",
          )}
        >
          {item.name}
        </button>
      ))}
    </div>
  );
});
```

- [ ] **Step 2: Create the mention config + extractor**

Create `apps/frontend/src/components/shared/rich-text-mention.ts`:

```ts
import Mention from "@tiptap/extension-mention";
import { ReactRenderer, type Editor } from "@tiptap/react";
import type { MentionItem, MentionListRef } from "./mention-list";
import { MentionList } from "./mention-list";

/** Build a configured Mention extension whose suggestions come from `members`.
 *  Uses a simple fixed-position popup (no external positioning lib). */
export function buildMention(members: MentionItem[]) {
  return Mention.configure({
    HTMLAttributes: { "data-type": "mention" },
    renderHTML({ options, node }) {
      return [
        "span",
        {
          "data-type": "mention",
          "data-id": node.attrs.id,
        },
        `@${node.attrs.label ?? node.attrs.id}`,
      ];
    },
    suggestion: {
      items: ({ query }: { query: string }) =>
        members
          .filter((m) =>
            m.name.toLowerCase().includes(query.toLowerCase()),
          )
          .slice(0, 8),
      render: () => {
        let component: ReactRenderer<MentionListRef> | null = null;
        let popup: HTMLDivElement | null = null;

        const position = (rect: DOMRect | null | undefined) => {
          if (!popup || !rect) return;
          popup.style.left = `${rect.left}px`;
          popup.style.top = `${rect.bottom + 4}px`;
        };

        return {
          onStart: (props: {
            editor: Editor;
            clientRect?: (() => DOMRect | null) | null;
            items: MentionItem[];
            command: (item: MentionItem) => void;
          }) => {
            component = new ReactRenderer(MentionList, {
              props,
              editor: props.editor,
            });
            popup = document.createElement("div");
            popup.style.position = "fixed";
            popup.style.zIndex = "50";
            popup.appendChild(component.element);
            document.body.appendChild(popup);
            position(props.clientRect?.());
          },
          onUpdate: (props: {
            clientRect?: (() => DOMRect | null) | null;
          }) => {
            component?.updateProps(props);
            position(props.clientRect?.());
          },
          onKeyDown: (props: { event: KeyboardEvent }) => {
            if (props.event.key === "Escape") return true;
            return component?.ref?.onKeyDown(props) ?? false;
          },
          onExit: () => {
            popup?.remove();
            popup = null;
            component?.destroy();
            component = null;
          },
        };
      },
    },
  });
}

/** Collect unique mentioned user ids from the editor doc. */
export function extractMentionIds(editor: Editor): string[] {
  const ids = new Set<string>();
  editor.state.doc.descendants((node) => {
    if (node.type.name === "mention" && node.attrs.id) {
      ids.add(String(node.attrs.id));
    }
  });
  return [...ids];
}
```

- [ ] **Step 3: Verify**

Run: `cd apps/frontend && bun run tsc --noEmit && bun run lint`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/components/shared/mention-list.tsx apps/frontend/src/components/shared/rich-text-mention.ts
git commit -m "feat(frontend): tiptap mention extension + suggestion dropdown"
```

---

## Task 8: Frontend — comment composer with inline mentions

**Files:**
- Modify: `apps/frontend/src/features/comments/components/comment-composer.tsx`

- [ ] **Step 1: Rewrite the composer**

Replace the entire contents of `comment-composer.tsx` with:

```tsx
import { useMemo, useRef, useState } from "react";
import { Send } from "lucide-react";
import type { Editor } from "@tiptap/react";
import { Button } from "@/components/ui/button";
import { RichTextEditor } from "@/components/shared/rich-text-editor";
import {
  buildMention,
  extractMentionIds,
} from "@/components/shared/rich-text-mention";
import type { MentionItem } from "@/components/shared/mention-list";
import type { AppUser } from "@/features/auth";

/** Comment editor: rich text with inline @-mention autocomplete. Mentions are
 *  extracted from the doc on submit and sent as `mentionIds` (→ notifications). */
export function CommentComposer({
  memberIds,
  userMap,
  initialContent = "",
  submitLabel = "Comment",
  pending,
  onSubmit,
  onCancel,
}: {
  memberIds: string[];
  userMap: Record<string, AppUser>;
  initialContent?: string;
  submitLabel?: string;
  pending?: boolean;
  onSubmit: (content: string, mentionIds: string[]) => void;
  onCancel?: () => void;
}) {
  const [content, setContent] = useState(initialContent);
  const editorRef = useRef<Editor | null>(null);

  const members: MentionItem[] = useMemo(
    () =>
      memberIds.map((id) => ({
        id,
        name: userMap[id]?.displayName ?? id,
      })),
    [memberIds, userMap],
  );

  // Rebuild the mention extension only when the member set changes.
  const extensions = useMemo(() => [buildMention(members)], [members]);

  const isEmpty = !editorRef.current || editorRef.current.isEmpty;

  function submit() {
    const editor = editorRef.current;
    if (!editor || editor.isEmpty) return;
    const html = editor.getHTML();
    const mentionIds = extractMentionIds(editor);
    onSubmit(html, mentionIds);
    editor.commands.clearContent(true);
    setContent("");
  }

  return (
    <div className="space-y-2">
      <RichTextEditor
        value={content}
        onChange={setContent}
        placeholder="Write a comment… (type @ to mention)"
        extensions={extensions}
        onEditorReady={(e) => (editorRef.current = e)}
      />
      <div className="flex items-center gap-2">
        <div className="flex-1" />
        {onCancel && (
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          onClick={submit}
          disabled={pending || isEmpty}
        >
          <Send className="mr-1 h-4 w-4" />
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}
```

> The old `initialMentions` prop is gone — mentions now live inside the content HTML. Editing a comment re-parses them from `initialContent` automatically.

- [ ] **Step 2: Fix the caller (edit path)**

`comment-thread.tsx` currently passes `initialMentions={c.mentionedUserIds}` to the edit-mode composer (~line 136). Remove that prop — the composer no longer accepts it. The `saveEdit(c, content, mentions)` callback still receives `mentions` from the composer's `onSubmit`, so its signature is unchanged.

- [ ] **Step 3: Verify**

Run: `cd apps/frontend && bun run tsc --noEmit && bun run lint`
Expected: passes. Fix any now-unused imports flagged by ESLint.

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/features/comments/components/comment-composer.tsx apps/frontend/src/features/comments/components/comment-thread.tsx
git commit -m "feat(frontend): inline @-mentions in comment composer"
```

---

## Task 9: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Backend gates**

Run: `cd apps/backend-rs && cargo build && cargo test`
Expected: build + all tests pass.

- [ ] **Step 2: Frontend gates**

Run: `cd apps/frontend && bun run tsc --noEmit && bun run lint && bun run build`
Expected: all three pass (per CLAUDE.md these are the frontend gates; `build` also regenerates `routeTree.gen.ts`).

- [ ] **Step 3: Manual smoke test**

Start the stack, then in the browser:
1. Open a wiki page → type `# Heading`, `- item`, `**bold**` → confirm live formatting → Save → reload → content persists and renders via `.prose`.
2. Open a task → edit description with formatting → save → reopen → persists.
3. On a task, add a comment → type `@` → pick a member from the dropdown → send. Confirm: (a) the comment renders with the mention styled, (b) the mentioned member receives a notification (existing notifier), (c) editing that comment reloads the mention intact.

- [ ] **Step 4: Commit any final fixes**

```bash
git add -A
git commit -m "chore(frontend): rich-text editor verification fixes"
```

(Skip if nothing changed.)
