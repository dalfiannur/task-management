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
  const [, setReady] = useState(false);
  const editorRef = useRef<Editor | null>(null);

  const members: MentionItem[] = useMemo(
    () =>
      memberIds.map((id) => ({
        id,
        label: userMap[id]?.displayName ?? id,
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
        onEditorReady={(e) => {
          editorRef.current = e;
          setReady(true);
        }}
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
