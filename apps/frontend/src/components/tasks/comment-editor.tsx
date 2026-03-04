import {
  useState,
  useEffect,
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
import { coreClient, gql } from "@/lib/graphql-client";
import styles from "./comment-editor.module.css";

const SEARCH_USERS = gql`
  query SearchUsersForMention($input: searchUsersInput!) {
    searchUsers(input: $input) {
      id
      info { displayName }
    }
  }
`;

// --- Mention suggestion list component ---

interface MentionItem {
  id: string;
  label: string;
}

interface MentionListProps {
  items: MentionItem[];
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
          command({ id: item.id, label: item.label });
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
        <div className={styles.mentionEmpty}>
          <p className={styles.mentionEmptyText}>No users found</p>
        </div>
      );
    }

    return (
      <div className={styles.mentionList}>
        {items.map((item, index) => (
          <button
            key={item.id}
            type="button"
            className={cn(
              styles.mentionItem,
              index === selectedIndex && styles.mentionItemSelected,
            )}
            onClick={() => selectItem(index)}
          >
            <div className={styles.mentionAvatarFallback}>
              {item.label
                .split(" ")
                .map((w) => w[0])
                .slice(0, 2)
                .join("")
                .toUpperCase()}
            </div>
            <span className={styles.mentionName}>{item.label}</span>
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

export interface CommentEditorHandle {
  submit: () => void;
}

interface CommentEditorProps {
  onSubmit: (html: string, mentionedUserIds: string[]) => void;
  initialContent?: string;
  placeholder?: string;
}

export const CommentEditor = forwardRef<CommentEditorHandle, CommentEditorProps>(function CommentEditor({
  onSubmit,
  initialContent = "",
  placeholder = "Write a comment... Use @ to mention someone",
}, ref) {
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
          items: async ({ query }: { query: string }) => {
            if (!query) return [];
            try {
              const { data } = await coreClient.query<{ searchUsers: Array<{ id: string; info: { displayName: string } }> }>({
                query: SEARCH_USERS,
                variables: { input: { q: query } },
              });
              return (data?.searchUsers ?? []).map((u) => ({
                id: u.id,
                label: u.info.displayName,
              }));
            } catch {
              return [];
            }
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
        class: styles.editorContent,
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

  useImperativeHandle(ref, () => ({
    submit: () => handleSubmit(),
  }), [handleSubmit]);

  if (!editor) return null;

  return (
    <div className={styles.editorWrapper}>
      <EditorContent editor={editor} />
    </div>
  );
});

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
          items: async ({ query }: { query: string }) => {
            if (!query) return [];
            try {
              const { data } = await coreClient.query<{ searchUsers: Array<{ id: string; info: { displayName: string } }> }>({
                query: SEARCH_USERS,
                variables: { input: { q: query } },
              });
              return (data?.searchUsers ?? []).map((u) => ({
                id: u.id,
                label: u.info.displayName,
              }));
            } catch {
              return [];
            }
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
        class: styles.editorContent,
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
    <div className={styles.editorWrapper}>
      <EditorContent editor={editor} />
    </div>
  );
}
