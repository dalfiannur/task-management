import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
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
  /** "document": no frame, a sticky toolbar and body-size text — for a page
   *  that IS the document (wiki pages) rather than a field inside a form. */
  variant?: "field" | "document";
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
      className={cn("h-8 w-8", active && "bg-surface-sunken text-text")}
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
  variant = "field",
}: RichTextEditorProps) {
  const doc = variant === "document";
  const editor = useEditor({
    editable,
    // In v3, StarterKit bundles the Link extension, so register it through
    // StarterKit (registering @tiptap/extension-link separately would throw a
    // "Duplicate extension name 'link'" error).
    extensions: [
      StarterKit.configure({ link: { openOnClick: false } }),
      Placeholder.configure({ placeholder: placeholder ?? "Write…" }),
      ...extensions,
    ],
    content: value,
    // Avoid the React hydration/double-render warning in this CSR app.
    immediatelyRender: false,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    editorProps: {
      attributes: {
        class: cn(
          "prose max-w-none focus:outline-none",
          doc ? "min-h-[40vh] py-4 text-base" : "min-h-[6rem] px-3 py-2 text-sm",
        ),
      },
    },
  });

  // Re-sync when the caller replaces `value` externally (e.g. switching pages).
  useEffect(() => {
    if (editor && value !== editor.getHTML()) {
      // v3: the emitUpdate flag moved into an options object (was a boolean arg in v2).
      editor.commands.setContent(value, { emitUpdate: false });
    }
  }, [value, editor]);

  useEffect(() => {
    if (editor && onEditorReady) onEditorReady(editor);
  }, [editor, onEditorReady]);

  if (!editor) return null;

  return (
    <div className={cn(!doc && "rounded-md border", className)}>
      {editable && (
        <div
          className={cn(
            "flex flex-wrap items-center gap-0.5 p-1",
            doc
              ? "sticky top-0 z-10 -mx-1 border-b border-border-subtle bg-surface-raised"
              : "border-b",
          )}
        >
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
