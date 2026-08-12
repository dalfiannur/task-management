import { DatePickerField } from "@/components/shared/date-picker-field";
import type { Task } from "@/features/tasks";

/** Tasks with no dates. Picking a date schedules them (start = due = pick). */
export function UnscheduledPanel({
  tasks,
  canEdit,
  onSchedule,
}: {
  tasks: Task[];
  canEdit: boolean;
  onSchedule: (taskId: string, date: Date) => void;
}) {
  if (tasks.length === 0) return null;
  return (
    <div className="rounded-xl bg-surface-raised p-4 shadow-2">
      <h3 className="mb-2 text-sm font-medium">
        Unscheduled{" "}
        <span className="text-num text-text-muted">({tasks.length})</span>
      </h3>
      <ul className="space-y-1">
        {tasks.map((t) => (
          <li
            key={t.id}
            className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 transition-colors [transition-duration:var(--duration-fast)] hover:bg-surface-hover"
          >
            <span className="truncate text-sm">{t.title}</span>
            {canEdit && (
              <DatePickerField
                value={undefined}
                onChange={(d) => d && onSchedule(t.id, d)}
                placeholder="Schedule"
              />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
