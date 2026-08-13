import DOMPurify from "dompurify";
import { cn } from "@/lib/utils";

/**
 * Renders a `ts_headline` snippet. Postgres wraps the matched terms in `<b>`;
 * the surrounding text is user-authored (task titles, comment bodies, …), so
 * it's sanitized before injecting rather than trusted — same pattern as
 * `rich-text-content.tsx`, but scoped to the one tag `ts_headline` emits.
 */
export function Snippet({
  html,
  className,
}: {
  html: string;
  className?: string;
}) {
  const clean = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ["b"],
    ALLOWED_ATTR: [],
  });
  return (
    <span
      // group-data-[selected=true] repaints this to --brand-text when the
      // parent CommandItem is keyboard-selected (bg-brand-subtle) — plain
      // --text-muted there would be exactly the grey-on-color pairing
      // ui-design's rule 3 forbids. The nearest `.group` ancestor is the
      // CommandItem itself; see search-overlay.tsx.
      className={cn(
        "block truncate text-xs text-text-muted group-data-[selected=true]:text-brand-text",
        "[&_b]:font-semibold [&_b]:text-text",
        className,
      )}
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  );
}
