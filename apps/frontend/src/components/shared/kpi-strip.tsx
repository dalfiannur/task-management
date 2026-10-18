import { cn } from "@/lib/utils";

export interface KpiCell {
  label: string;
  value: number;
  hint?: string;
  alert?: boolean;
}

/** Headline counts as one hairline-divided strip — the dashboard and the
 *  project Overview both use it, so the two read as one language.
 *
 *  One card instead of four: the numbers are read together, so they share a
 *  surface. The dividers are the gap between cells showing the border colour
 *  underneath — they stay one pixel whether the grid is 2×2 or 1×4. Only a
 *  cell marked `alert` takes colour (aturan 4). */
export function KpiStrip({ cells }: { cells: KpiCell[] }) {
  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-border shadow-sm sm:grid-cols-4">
      {cells.map((c) => (
        <div key={c.label} className="bg-card px-5 py-4">
          {/* Not cn(): tailwind-merge reads `text-label` as a font-size and
              would drop it in favour of `text-destructive`. */}
          <dt className={c.alert ? "text-label text-destructive" : "text-label"}>
            {c.label}
          </dt>
          <dd className="mt-1 flex items-baseline gap-2">
            <span
              className={cn(
                "text-num text-2xl font-semibold",
                c.alert ? "text-destructive" : "text-foreground",
              )}
            >
              {c.value}
            </span>
            {c.hint && (
              <span className="text-num text-xs text-muted-foreground">{c.hint}</span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
