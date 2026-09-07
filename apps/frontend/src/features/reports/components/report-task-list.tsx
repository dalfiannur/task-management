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
      <p className="rounded-xl bg-surface-raised p-6 text-center text-sm text-text-muted shadow-2">
        {empty}
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <div className="overflow-hidden rounded-xl bg-surface-raised shadow-2">
        {items.map((it) => (
          <MyTaskRow key={it.task.id} item={it} />
        ))}
      </div>
      {truncated && (
        <p className="text-xs text-text-muted">
          Showing the first {items.length}. The counts above are complete.
        </p>
      )}
    </div>
  );
}
