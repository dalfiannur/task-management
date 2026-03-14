import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface PaginationProps {
  currentPage: number;
  hasNextPage: boolean;
  onPageChange: (page: number) => void;
}

export function Pagination({ currentPage, hasNextPage, onPageChange }: PaginationProps) {
  const buttonClass = cn(
    "inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-sm font-medium transition-colors",
    "hover:bg-muted/50 hover:text-foreground",
    "disabled:pointer-events-none disabled:opacity-50",
  );

  return (
    <div className="flex items-center justify-center gap-3 pt-6">
      <button
        type="button"
        className={buttonClass}
        disabled={currentPage <= 1}
        onClick={() => onPageChange(currentPage - 1)}
      >
        <ChevronLeft className="size-4" />
        Previous
      </button>
      <span className="min-w-16 text-center text-sm font-medium text-muted-foreground">
        Page {currentPage}
      </span>
      <button
        type="button"
        className={buttonClass}
        disabled={!hasNextPage}
        onClick={() => onPageChange(currentPage + 1)}
      >
        Next
        <ChevronRight className="size-4" />
      </button>
    </div>
  );
}
