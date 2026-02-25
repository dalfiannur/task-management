import { cn } from "@/lib/utils";
import styles from "./comment-content.module.css";

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
          styles.plainText,
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
        `${styles.richText} prose`,
        className,
      )}
      dangerouslySetInnerHTML={{ __html: content }}
    />
  );
}
