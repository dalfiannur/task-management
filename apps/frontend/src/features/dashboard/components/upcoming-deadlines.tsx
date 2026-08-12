import { Skeleton } from "@/components/ui/skeleton";
import { useUpcomingDeadlines } from "../api/hooks";
import { MyTaskRow } from "./my-task-row";

/** Tasks assigned to me due within N days. */
export function UpcomingDeadlines({ withinDays = 7 }: { withinDays?: number }) {
  const { items, isLoading } = useUpcomingDeadlines(withinDays);

  if (isLoading) {
    return <Skeleton className="h-24 w-full rounded-xl" />;
  }
  if (items.length === 0) {
    return (
      <p className="rounded-xl bg-surface-raised p-6 text-center text-sm text-text-muted shadow-2">
        Nothing due in the next {withinDays} days.
      </p>
    );
  }
  return (
    <div className="overflow-hidden rounded-xl bg-surface-raised shadow-2">
      {items.map((it) => (
        <MyTaskRow key={it.task.id} item={it} />
      ))}
    </div>
  );
}
