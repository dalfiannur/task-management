import { MyTaskRow } from "@/features/dashboard";
import type { MyTaskItem } from "@/features/dashboard";

export function ReportTaskList({
  items,
  truncated,
  empty,
}: {
  items: MyTaskItem[];
  truncated: boolean;
  empty: string;
}) {
  if (items.length === 0) {
    return (
      <p className="rounded-xl bg-card p-6 text-center text-sm text-muted-foreground shadow-sm">
        {empty}
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <div className="overflow-hidden rounded-xl bg-card shadow-sm">
        {items.map((it) => (
          <MyTaskRow key={it.task.id} item={it} />
        ))}
      </div>
      {truncated && (
        <p className="text-xs text-muted-foreground">
          Showing the first {items.length}. The counts above are complete.
        </p>
      )}
    </div>
  );
}
