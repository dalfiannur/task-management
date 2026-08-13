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
      className={cn(
        "block truncate text-xs text-text-muted [&_b]:font-semibold [&_b]:text-text",
        className,
      )}
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  );
}
