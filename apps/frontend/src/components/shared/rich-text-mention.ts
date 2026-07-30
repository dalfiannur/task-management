import Mention from "@tiptap/extension-mention";
import { ReactRenderer } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import type { SuggestionKeyDownProps, SuggestionProps } from "@tiptap/suggestion";
import type { MentionItem, MentionListRef } from "./mention-list";
import { MentionList } from "./mention-list";

/** Build a configured Mention extension whose suggestions come from `members`. */
export function buildMention(members: MentionItem[]) {
  return Mention.configure({
    HTMLAttributes: { "data-type": "mention" },
    renderHTML({ node }) {
      return [
        "span",
        { "data-type": "mention", "data-id": node.attrs.id },
        `@${node.attrs.label ?? node.attrs.id}`,
      ];
    },
    suggestion: {
      items: ({ query }: { query: string }) =>
        members
          .filter((m) => m.label.toLowerCase().includes(query.toLowerCase()))
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
          onStart: (props: SuggestionProps<MentionItem>) => {
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
          onUpdate: (props: SuggestionProps<MentionItem>) => {
            component?.updateProps(props);
            position(props.clientRect?.());
          },
          onKeyDown: (props: SuggestionKeyDownProps) => {
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
    if (node.type.name === "mention" && node.attrs.id) ids.add(String(node.attrs.id));
  });
  return [...ids];
}
