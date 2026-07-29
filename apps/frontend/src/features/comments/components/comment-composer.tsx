import { useState } from "react";
import { AtSign, Check, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { AppUser } from "@/features/auth";

/** Comment editor: content + a member mention multi-select (→ notifications).
 *  Inline @-autocomplete is deferred; mentions are chosen explicitly here. */
export function CommentComposer({
  memberIds,
  userMap,
  initialContent = "",
  initialMentions = [],
  submitLabel = "Comment",
  pending,
  onSubmit,
  onCancel,
}: {
  memberIds: string[];
  userMap: Record<string, AppUser>;
  initialContent?: string;
  initialMentions?: string[];
  submitLabel?: string;
  pending?: boolean;
  onSubmit: (content: string, mentionIds: string[]) => void;
  onCancel?: () => void;
}) {
  const [content, setContent] = useState(initialContent);
  const [mentions, setMentions] = useState<string[]>(initialMentions);

  function toggleMention(id: string) {
    setMentions((m) => (m.includes(id) ? m.filter((x) => x !== id) : [...m, id]));
  }

  function submit() {
    if (!content.trim()) return;
    onSubmit(content.trim(), mentions);
    setContent("");
    setMentions([]);
  }

  return (
    <div className="space-y-2">
      <Textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Write a comment… (⌘/Ctrl+Enter to send)"
        rows={3}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
      />
      <div className="flex items-center gap-2">
        <Popover>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" size="sm">
              <AtSign className="mr-1 h-4 w-4" />
              {mentions.length ? `${mentions.length} mentioned` : "Mention"}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-56 p-1" align="start">
            {memberIds.length === 0 ? (
              <p className="p-2 text-sm text-muted-foreground">No members.</p>
            ) : (
              <ul className="max-h-52 space-y-0.5 overflow-y-auto">
                {memberIds.map((id) => {
                  const name = userMap[id]?.displayName ?? id;
                  const on = mentions.includes(id);
                  return (
                    <li key={id}>
                      <button
                        type="button"
                        onClick={() => toggleMention(id)}
                        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted"
                      >
                        <span className="flex-1 truncate text-left">{name}</span>
                        <Check
                          className={cn(
                            "h-4 w-4",
                            on ? "opacity-100" : "opacity-0",
                          )}
                        />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </PopoverContent>
        </Popover>
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
          disabled={pending || !content.trim()}
        >
          <Send className="mr-1 h-4 w-4" />
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}
