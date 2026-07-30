import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { cn } from "@/lib/utils";

export interface MentionItem {
  id: string;
  /** Display name shown in the dropdown and inserted as the mention node's `label` attr. */
  label: string;
}

export interface MentionListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

/** Dropdown rendered inside the tiptap suggestion popup. `command` inserts the chosen mention node. */
export const MentionList = forwardRef<
  MentionListRef,
  { items: MentionItem[]; command: (item: MentionItem) => void }
>(function MentionList({ items, command }, ref) {
  const [selected, setSelected] = useState(0);
  useEffect(() => setSelected(0), [items]);
  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (items.length === 0) return false;
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
          {item.label}
        </button>
      ))}
    </div>
  );
});
