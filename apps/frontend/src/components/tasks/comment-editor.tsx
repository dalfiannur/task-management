import {
  useState,
  useEffect,
  useRef,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from "react";
import { useEditor, EditorContent, ReactRenderer } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Mention } from "@tiptap/extension-mention";
import { Placeholder } from "@tiptap/extension-placeholder";
import type { SuggestionProps, SuggestionKeyDownProps } from "@tiptap/suggestion";
import { cn } from "@/lib/utils";
import { useUsers } from "@/hooks/use-users";
import type { User } from "@/types/task";

// --- Mention suggestion list component ---

interface MentionListProps {
  items: User[];
  command: (attrs: { id: string; label: string }) => void;
}

interface MentionListRef {
  onKeyDown: (props: SuggestionKeyDownProps) => boolean;
}

const MentionList = forwardRef<MentionListRef, MentionListProps>(
  ({ items, command }, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0);

    useEffect(() => {
      setSelectedIndex(0);
    }, [items]);

    const selectItem = useCallback(
      (index: number) => {
        const item = items[index];
        if (item) {
          command({ id: item.id, label: item.name });
        }
      },
      [items, command],
    );

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }: SuggestionKeyDownProps) => {
        if (event.key === "ArrowUp") {
          setSelectedIndex((i) => (i + items.length - 1) % items.length);
          return true;
        }
        if (event.key === "ArrowDown") {
          setSelectedIndex((i) => (i + 1) % items.length);
          return true;
        }
        if (event.key === "Enter") {
          selectItem(selectedIndex);
          return true;
        }
        return false;
      },
    }));

    if (items.length === 0) {
      return (
        <div className="rounded-lg border bg-popover p-2 shadow-md">
          <p className="text-xs text-muted-foreground">No users found</p>
        </div>
      );
    }

    return (
      <div className="rounded-lg border bg-popover shadow-md overflow-hidden max-h-48 overflow-y-auto">
        {items.map((item, index) => (
          <button
            key={item.id}
            type="button"
            className={cn(
              "flex items-center gap-2 w-full px-3 py-1.5 text-left text-xs transition-colors",
              index === selectedIndex
                ? "bg-accent text-accent-foreground"
                : "hover:bg-muted",
            )}
            onClick={() => selectItem(index)}
          >
            {item.avatarUrl ? (
              <img
                src={item.avatarUrl}
                alt=""
                className="size-5 rounded-full object-cover"
              />
            ) : (
              <div className="size-5 rounded-full bg-muted flex items-center justify-center text-[9px] font-medium">
                {item.name
                  .split(" ")
                  .map((w) => w[0])
                  .slice(0, 2)
                  .join("")
                  .toUpperCase()}
              </div>
            )}
            <span className="truncate">{item.name}</span>
          </button>
        ))}
      </div>
    );
  },
);
MentionList.displayName = "MentionList";

// --- Helper: extract mentioned user IDs from editor doc ---

function extractMentionIds(editor: ReturnType<typeof useEditor>): string[] {
  if (!editor) return [];
  const ids: string[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === "mention" && node.attrs.id) {
      ids.push(node.attrs.id as string);
    }
  });
  return [...new Set(ids)];
}

// --- Main CommentEditor ---

interface CommentEditorProps {
  onSubmit: (html: string, mentionedUserIds: string[]) => void;
  initialContent?: string;
  placeholder?: string;
}

export function CommentEditor({
  onSubmit,
  initialContent = "",
  placeholder = "Write a comment... Use @ to mention someone",
}: CommentEditorProps) {
  const { data: users = [] } = useUsers();
  const usersRef = useRef<User[]>(users);
  useEffect(() => {
    usersRef.current = users;
  }, [users]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
        horizontalRule: false,
        blockquote: false,
      }),
      Placeholder.configure({ placeholder }),
      Mention.configure({
        HTMLAttributes: {
          class: "mention",
        },
        suggestion: {
          items: ({ query }: { query: string }) => {
            const q = query.toLowerCase();
            return usersRef.current
              .filter((u) => u.name.toLowerCase().includes(q))
              .slice(0, 8);
          },
          render: () => {
            let component: ReactRenderer<MentionListRef> | null = null;
            let popup: HTMLDivElement | null = null;

            return {
              onStart: (props: SuggestionProps) => {
                component = new ReactRenderer(MentionList, {
                  props,
                  editor: props.editor,
                });

                popup = document.createElement("div");
                popup.style.position = "absolute";
                popup.style.zIndex = "50";
                document.body.appendChild(popup);

                popup.appendChild(component.element);
                updatePosition(popup, props);
              },
              onUpdate: (props: SuggestionProps) => {
                component?.updateProps(props);
                if (popup) updatePosition(popup, props);
              },
              onKeyDown: (props: SuggestionKeyDownProps) => {
                if (props.event.key === "Escape") {
                  popup?.remove();
                  component?.destroy();
                  popup = null;
                  component = null;
                  return true;
                }
                return component?.ref?.onKeyDown(props) ?? false;
              },
              onExit: () => {
                popup?.remove();
                component?.destroy();
                popup = null;
                component = null;
              },
            };
          },
        },
      }),
    ],
    content: initialContent,
    editorProps: {
      attributes: {
        class: "prose prose-sm max-w-none min-h-[48px] px-3 py-2 focus:outline-none text-xs",
      },
      handleKeyDown: (_view, event) => {
        if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          handleSubmit();
          return true;
        }
        return false;
      },
    },
  });

  const handleSubmit = useCallback(() => {
    if (!editor) return;
    const html = editor.getHTML();
    // Check if content is empty (just empty paragraph tags)
    const text = editor.getText().trim();
    if (!text) return;

    const mentionedIds = extractMentionIds(editor);
    onSubmit(html, mentionedIds);
    editor.commands.clearContent();
  }, [editor, onSubmit]);

  if (!editor) return null;

  return (
    <div
      className={cn(
        "rounded-md border border-input focus-within:ring-1 focus-within:ring-ring/30 transition-colors",
        // Placeholder styles
        "[&_.tiptap_p.is-editor-empty:first-child::before]:text-muted-foreground/50",
        "[&_.tiptap_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)]",
        "[&_.tiptap_p.is-editor-empty:first-child::before]:float-left",
        "[&_.tiptap_p.is-editor-empty:first-child::before]:h-0",
        "[&_.tiptap_p.is-editor-empty:first-child::before]:pointer-events-none",
        // Mention styles
        "[&_.mention]:text-primary [&_.mention]:font-medium",
      )}
    >
      <EditorContent editor={editor} />
    </div>
  );
}

// --- Position helper ---

function updatePosition(popup: HTMLDivElement, props: SuggestionProps) {
  const { clientRect } = props;
  if (!clientRect?.()) return;

  const rect = clientRect()!;
  popup.style.left = `${rect.left + window.scrollX}px`;
  popup.style.top = `${rect.bottom + window.scrollY + 4}px`;
}

// --- Edit variant (pre-populated, different submit flow) ---

interface CommentEditEditorProps {
  initialContent: string;
  onSave: (html: string, mentionedUserIds: string[]) => void;
  onCancel: () => void;
}

export function CommentEditEditor({
  initialContent,
  onSave,
  onCancel,
}: CommentEditEditorProps) {
  const { data: users = [] } = useUsers();
  const usersRef = useRef<User[]>(users);
  useEffect(() => {
    usersRef.current = users;
  }, [users]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
        horizontalRule: false,
        blockquote: false,
      }),
      Mention.configure({
        HTMLAttributes: {
          class: "mention",
        },
        suggestion: {
          items: ({ query }: { query: string }) => {
            const q = query.toLowerCase();
            return usersRef.current
              .filter((u) => u.name.toLowerCase().includes(q))
              .slice(0, 8);
          },
          render: () => {
            let component: ReactRenderer<MentionListRef> | null = null;
            let popup: HTMLDivElement | null = null;

            return {
              onStart: (props: SuggestionProps) => {
                component = new ReactRenderer(MentionList, {
                  props,
                  editor: props.editor,
                });

                popup = document.createElement("div");
                popup.style.position = "absolute";
                popup.style.zIndex = "50";
                document.body.appendChild(popup);

                popup.appendChild(component.element);
                updatePosition(popup, props);
              },
              onUpdate: (props: SuggestionProps) => {
                component?.updateProps(props);
                if (popup) updatePosition(popup, props);
              },
              onKeyDown: (props: SuggestionKeyDownProps) => {
                if (props.event.key === "Escape") {
                  popup?.remove();
                  component?.destroy();
                  popup = null;
                  component = null;
                  return true;
                }
                return component?.ref?.onKeyDown(props) ?? false;
              },
              onExit: () => {
                popup?.remove();
                component?.destroy();
                popup = null;
                component = null;
              },
            };
          },
        },
      }),
    ],
    content: initialContent,
    editorProps: {
      attributes: {
        class: "prose prose-sm max-w-none min-h-[48px] px-3 py-2 focus:outline-none text-xs",
      },
      handleKeyDown: (_view, event) => {
        if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          handleSave();
          return true;
        }
        if (event.key === "Escape") {
          onCancel();
          return true;
        }
        return false;
      },
    },
  });

  const handleSave = useCallback(() => {
    if (!editor) return;
    const html = editor.getHTML();
    const text = editor.getText().trim();
    if (!text) {
      onCancel();
      return;
    }
    const mentionedIds = extractMentionIds(editor);
    onSave(html, mentionedIds);
  }, [editor, onSave, onCancel]);

  if (!editor) return null;

  return (
    <div
      className={cn(
        "rounded-md border border-input focus-within:ring-1 focus-within:ring-ring/30 transition-colors",
        "[&_.mention]:text-primary [&_.mention]:font-medium",
      )}
    >
      <EditorContent editor={editor} />
    </div>
  );
}
