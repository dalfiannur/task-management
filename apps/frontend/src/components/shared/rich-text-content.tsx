import DOMPurify from "dompurify";
import { cn } from "@/lib/utils";

/** Read-only renderer for editor HTML. Sanitizes before injecting, and styles
 *  with `.prose`. Mention spans (data-type/data-id) are preserved. */
export function RichTextContent({
  html,
  className,
}: {
  html: string;
  className?: string;
}) {
  const clean = DOMPurify.sanitize(html, {
    ADD_ATTR: ["data-type", "data-id"],
  });
  return (
    <div
      className={cn("prose text-sm", className)}
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  );
}
