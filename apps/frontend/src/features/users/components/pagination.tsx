import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The page numbers to show, with `null` marking an elided run.
 *
 * Always keeps the first page, the last page, and a one-page window either side
 * of the current one; anything else collapses. The window is what makes the
 * width predictable — without it the control grows with the data and a hundred
 * pages would wrap onto three lines.
 *
 * Up to `MAX_INLINE` pages are shown whole: below that threshold every ellipsis
 * would hide fewer numbers than the ellipsis itself occupies.
 */
const MAX_INLINE = 7;

function pageItems(current: number, total: number): (number | null)[] {
  if (total <= MAX_INLINE) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const items: (number | null)[] = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  if (start > 2) items.push(null);
  for (let p = start; p <= end; p++) items.push(p);
  if (end < total - 1) items.push(null);
  items.push(total);
  return items;
}

/**
 * Numbered pagination. Renders nothing for a single page — a control whose only
 * option is the page you are already on is noise.
 *
 * Deliberately quiet: every button is `ghost` except the current page, so the
 * control never competes with the actions in the list above it (ui-design
 * rule 4). The current page is marked by weight and surface, not colour, so it
 * does not read as a primary action either.
 */
export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;

  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  return (
    <nav
      className="flex items-center justify-between gap-4 pt-2"
      aria-label="Pagination"
    >
      <p className="text-xs text-text-muted">
        <span className="text-num">
          {first}–{last}
        </span>{" "}
        of <span className="text-num">{total}</span>
      </p>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          aria-label="Previous page"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        {pageItems(page, totalPages).map((p, i) =>
          p === null ? (
            // Presentational: a screen reader announcing "ellipsis" between
            // page numbers adds nothing the numbers do not already say.
            <span
              key={`gap-${i}`}
              aria-hidden="true"
              className="px-1 text-xs text-text-subtle"
            >
              …
            </span>
          ) : (
            <Button
              key={p}
              type="button"
              variant="ghost"
              size="icon"
              className={cn(
                "text-num h-8 w-8",
                p === page && "bg-surface-sunken font-semibold text-text",
              )}
              onClick={() => onPageChange(p)}
              aria-label={`Page ${p}`}
              aria-current={p === page ? "page" : undefined}
            >
              {p}
            </Button>
          ),
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          aria-label="Next page"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </nav>
  );
}
