import { useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import type { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Underline } from "@tiptap/extension-underline";
import { Link } from "@tiptap/extension-link";
import { Highlight } from "@tiptap/extension-highlight";
import { TextAlign } from "@tiptap/extension-text-align";
import { TaskList } from "@tiptap/extension-task-list";
import { TaskItem } from "@tiptap/extension-task-item";
import { Subscript } from "@tiptap/extension-subscript";
import { Superscript } from "@tiptap/extension-superscript";
import { Placeholder } from "@tiptap/extension-placeholder";
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  Code,
  Highlighter,
  Subscript as SubscriptIcon,
  Superscript as SuperscriptIcon,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  ListChecks,
  Quote,
  CodeXml,
  Minus,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Link as LinkIcon,
  Unlink,
  Undo2,
  Redo2,
} from "lucide-react";
import { Toggle } from "@/components/ui/toggle";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface RichTextEditorProps {
  content: string;
  onChange: (html: string) => void;
  placeholder?: string;
}

export function RichTextEditor({
  content,
  onChange,
  placeholder,
}: RichTextEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: "text-primary underline cursor-pointer",
        },
      }),
      Highlight,
      TextAlign.configure({
        types: ["heading", "paragraph"],
      }),
      TaskList,
      TaskItem.configure({
        nested: true,
      }),
      Subscript,
      Superscript,
      Placeholder.configure({
        placeholder,
      }),
    ],
    content,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
    editorProps: {
      attributes: {
        class:
          "prose prose-sm max-w-none min-h-[80px] px-3 py-2 focus:outline-none",
      },
    },
  });

  if (!editor) return null;

  return (
    <div className="rounded-md border border-input focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 ring-offset-background">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-0.5 border-b px-1 py-1">
        {/* History */}
        <ToolbarButton
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!editor.can().undo()}
          tooltip="Undo"
          icon={Undo2}
        />
        <ToolbarButton
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!editor.can().redo()}
          tooltip="Redo"
          icon={Redo2}
        />

        <ToolbarSeparator />

        {/* Text formatting */}
        <ToolbarToggle
          pressed={editor.isActive("bold")}
          onPressedChange={() => editor.chain().focus().toggleBold().run()}
          tooltip="Bold"
          icon={Bold}
        />
        <ToolbarToggle
          pressed={editor.isActive("italic")}
          onPressedChange={() => editor.chain().focus().toggleItalic().run()}
          tooltip="Italic"
          icon={Italic}
        />
        <ToolbarToggle
          pressed={editor.isActive("underline")}
          onPressedChange={() => editor.chain().focus().toggleUnderline().run()}
          tooltip="Underline"
          icon={UnderlineIcon}
        />
        <ToolbarToggle
          pressed={editor.isActive("strike")}
          onPressedChange={() => editor.chain().focus().toggleStrike().run()}
          tooltip="Strikethrough"
          icon={Strikethrough}
        />
        <ToolbarToggle
          pressed={editor.isActive("code")}
          onPressedChange={() => editor.chain().focus().toggleCode().run()}
          tooltip="Inline Code"
          icon={Code}
        />
        <ToolbarToggle
          pressed={editor.isActive("highlight")}
          onPressedChange={() => editor.chain().focus().toggleHighlight().run()}
          tooltip="Highlight"
          icon={Highlighter}
        />

        <ToolbarSeparator />

        {/* Subscript / Superscript */}
        <ToolbarToggle
          pressed={editor.isActive("subscript")}
          onPressedChange={() => editor.chain().focus().toggleSubscript().run()}
          tooltip="Subscript"
          icon={SubscriptIcon}
        />
        <ToolbarToggle
          pressed={editor.isActive("superscript")}
          onPressedChange={() =>
            editor.chain().focus().toggleSuperscript().run()
          }
          tooltip="Superscript"
          icon={SuperscriptIcon}
        />

        <ToolbarSeparator />

        {/* Headings */}
        <ToolbarToggle
          pressed={editor.isActive("heading", { level: 1 })}
          onPressedChange={() =>
            editor.chain().focus().toggleHeading({ level: 1 }).run()
          }
          tooltip="Heading 1"
          icon={Heading1}
        />
        <ToolbarToggle
          pressed={editor.isActive("heading", { level: 2 })}
          onPressedChange={() =>
            editor.chain().focus().toggleHeading({ level: 2 }).run()
          }
          tooltip="Heading 2"
          icon={Heading2}
        />
        <ToolbarToggle
          pressed={editor.isActive("heading", { level: 3 })}
          onPressedChange={() =>
            editor.chain().focus().toggleHeading({ level: 3 }).run()
          }
          tooltip="Heading 3"
          icon={Heading3}
        />

        <ToolbarSeparator />

        {/* Lists */}
        <ToolbarToggle
          pressed={editor.isActive("bulletList")}
          onPressedChange={() =>
            editor.chain().focus().toggleBulletList().run()
          }
          tooltip="Bullet List"
          icon={List}
        />
        <ToolbarToggle
          pressed={editor.isActive("orderedList")}
          onPressedChange={() =>
            editor.chain().focus().toggleOrderedList().run()
          }
          tooltip="Ordered List"
          icon={ListOrdered}
        />
        <ToolbarToggle
          pressed={editor.isActive("taskList")}
          onPressedChange={() =>
            editor.chain().focus().toggleTaskList().run()
          }
          tooltip="Task List"
          icon={ListChecks}
        />

        <ToolbarSeparator />

        {/* Block elements */}
        <ToolbarToggle
          pressed={editor.isActive("blockquote")}
          onPressedChange={() =>
            editor.chain().focus().toggleBlockquote().run()
          }
          tooltip="Blockquote"
          icon={Quote}
        />
        <ToolbarToggle
          pressed={editor.isActive("codeBlock")}
          onPressedChange={() =>
            editor.chain().focus().toggleCodeBlock().run()
          }
          tooltip="Code Block"
          icon={CodeXml}
        />
        <ToolbarButton
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
          tooltip="Horizontal Rule"
          icon={Minus}
        />

        <ToolbarSeparator />

        {/* Text alignment */}
        <ToolbarToggle
          pressed={editor.isActive({ textAlign: "left" })}
          onPressedChange={() =>
            editor.chain().focus().setTextAlign("left").run()
          }
          tooltip="Align Left"
          icon={AlignLeft}
        />
        <ToolbarToggle
          pressed={editor.isActive({ textAlign: "center" })}
          onPressedChange={() =>
            editor.chain().focus().setTextAlign("center").run()
          }
          tooltip="Align Center"
          icon={AlignCenter}
        />
        <ToolbarToggle
          pressed={editor.isActive({ textAlign: "right" })}
          onPressedChange={() =>
            editor.chain().focus().setTextAlign("right").run()
          }
          tooltip="Align Right"
          icon={AlignRight}
        />

        <ToolbarSeparator />

        {/* Link */}
        <LinkButton editor={editor} />
      </div>

      {/* Editor content */}
      <EditorContent
        editor={editor}
        className={cn(
          // Placeholder styles
          "[&_.tiptap_p.is-editor-empty:first-child::before]:text-muted-foreground/50",
          "[&_.tiptap_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)]",
          "[&_.tiptap_p.is-editor-empty:first-child::before]:float-left",
          "[&_.tiptap_p.is-editor-empty:first-child::before]:h-0",
          "[&_.tiptap_p.is-editor-empty:first-child::before]:pointer-events-none",
          // Task list styles
          "[&_.tiptap_ul[data-type=taskList]]:list-none",
          "[&_.tiptap_ul[data-type=taskList]]:pl-0",
          "[&_.tiptap_ul[data-type=taskList]_li]:flex",
          "[&_.tiptap_ul[data-type=taskList]_li]:items-start",
          "[&_.tiptap_ul[data-type=taskList]_li]:gap-2",
          "[&_.tiptap_ul[data-type=taskList]_li_label]:mt-0.5",
          "[&_.tiptap_ul[data-type=taskList]_li_div]:flex-1",
        )}
      />
    </div>
  );
}

// --- Toolbar helpers ---

function ToolbarToggle({
  pressed,
  onPressedChange,
  tooltip,
  icon: Icon,
}: {
  pressed: boolean;
  onPressedChange: () => void;
  tooltip: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <Toggle
      size="sm"
      pressed={pressed}
      onPressedChange={onPressedChange}
      aria-label={tooltip}
      className="size-8 p-0"
    >
      <Icon className="size-4" />
    </Toggle>
  );
}

function ToolbarButton({
  onClick,
  disabled,
  tooltip,
  icon: Icon,
}: {
  onClick: () => void;
  disabled?: boolean;
  tooltip: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={tooltip}
      className={cn(
        "inline-flex items-center justify-center size-8 rounded-md text-sm font-medium transition-colors",
        "hover:bg-muted hover:text-muted-foreground",
        "disabled:pointer-events-none disabled:opacity-50",
      )}
    >
      <Icon className="size-4" />
    </button>
  );
}

function ToolbarSeparator() {
  return <div className="w-px h-6 bg-border mx-0.5" />;
}

// --- Link popover ---

function LinkButton({ editor }: { editor: Editor }) {
  const [linkUrl, setLinkUrl] = useState("");
  const [open, setOpen] = useState(false);

  const setLink = () => {
    if (!linkUrl) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
    } else {
      editor
        .chain()
        .focus()
        .extendMarkRange("link")
        .setLink({ href: linkUrl })
        .run();
    }
    setOpen(false);
    setLinkUrl("");
  };

  const handleOpen = (isOpen: boolean) => {
    if (isOpen) {
      const previousUrl = (editor.getAttributes("link").href as string) ?? "";
      setLinkUrl(previousUrl);
    }
    setOpen(isOpen);
  };

  return (
    <Popover open={open} onOpenChange={handleOpen}>
      <PopoverTrigger asChild>
        <Toggle
          size="sm"
          pressed={editor.isActive("link")}
          aria-label="Link"
          className="size-8 p-0"
        >
          <LinkIcon className="size-4" />
        </Toggle>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-3" align="start">
        <div className="flex gap-2">
          <Input
            placeholder="https://..."
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                setLink();
              }
            }}
            className="h-8 text-sm"
            autoFocus
          />
          <Button size="sm" className="h-8 px-3" onClick={setLink}>
            Set
          </Button>
          {editor.isActive("link") && (
            <Button
              size="sm"
              variant="ghost"
              className="h-8 px-2"
              onClick={() => {
                editor.chain().focus().unsetLink().run();
                setOpen(false);
              }}
            >
              <Unlink className="size-4" />
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
