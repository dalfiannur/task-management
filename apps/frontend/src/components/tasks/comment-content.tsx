import { cn } from "@/lib/utils";

interface CommentContentProps {
  content: string;
  className?: string;
}

/**
 * Renders comment content, supporting both plain text (legacy) and HTML (new).
 * Detects HTML by checking for tags. Plain text is rendered with whitespace-pre-wrap.
 */
export function CommentContent({ content, className }: CommentContentProps) {
  const isHtml = /<[a-z][\s\S]*>/i.test(content);

  if (!isHtml) {
    return (
      <p
        className={cn(
          "text-xs text-foreground/80 whitespace-pre-wrap break-words",
          className,
        )}
      >
        {content}
      </p>
    );
  }

  return (
    <div
      className={cn(
        "text-xs text-foreground/80 break-words prose prose-sm max-w-none",
        // Mention styling
        "[&_[data-type=mention]]:text-primary [&_[data-type=mention]]:font-medium",
        "[&_.mention]:text-primary [&_.mention]:font-medium",
        className,
      )}
      dangerouslySetInnerHTML={{ __html: content }}
    />
  );
}
