import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Granularity, PeriodWindow } from "../types";

/** Period navigation. Moving forward past the current period is not offered:
 *  a report about a period that has not happened is an empty page, not an
 *  answer. */
export function PeriodPicker({
  window,
  onGranularity,
  onOffset,
}: {
  window: PeriodWindow;
  onGranularity: (g: Granularity) => void;
  onOffset: (offset: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 print:hidden">
      <div className="flex items-center gap-1 rounded-lg bg-surface-sunken p-1">
        {(["weekly", "monthly"] as const).map((g) => (
          <button
            key={g}
            type="button"
            onClick={() => onGranularity(g)}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors [transition-duration:var(--duration-fast)]",
              window.granularity === g
                ? "bg-surface-raised text-text shadow-1"
                : "text-text-muted hover:text-text",
            )}
            aria-pressed={window.granularity === g}
          >
            {g === "weekly" ? "Weekly" : "Monthly"}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          className="hit-area"
          onClick={() => onOffset(window.offset - 1)}
          aria-label="Previous period"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-num min-w-48 text-center text-sm font-medium">
          {window.label}
          {window.isCurrent && (
            <span className="text-label ml-2 align-middle">in progress</span>
          )}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="hit-area"
          onClick={() => onOffset(Math.min(0, window.offset + 1))}
          disabled={window.offset >= 0}
          aria-label="Next period"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
