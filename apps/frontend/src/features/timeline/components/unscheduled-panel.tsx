import { useState } from "react";
import { CalendarOff, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { DatePickerField } from "@/components/shared/date-picker-field";
import { TASK_STATUS_CONFIG, type Task } from "@/features/tasks";

/** Tasks with no dates. Picking a date schedules them (start = due = pick). */
export function UnscheduledPanel({
  tasks,
  moduleNames,
  canEdit,
  onSchedule,
  onOpen,
}: {
  tasks: Task[];
  moduleNames: Record<string, string>;
  canEdit: boolean;
  onSchedule: (taskId: string, date: Date) => void;
  onOpen: (taskId: string) => void;
}) {
  const [open, setOpen] = useState(true);
  if (tasks.length === 0) return null;
  return (
    <section
      id="timeline-unscheduled"
      className="rounded-xl bg-surface-raised shadow-2"
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-3 text-left"
      >
        <ChevronRight
          aria-hidden="true"
          className={cn(
            "h-4 w-4 text-text-muted [transition:transform_var(--duration-fast)_var(--ease-out)]",
            open && "rotate-90",
          )}
        />
        <CalendarOff aria-hidden="true" className="h-4 w-4 text-text-muted" />
        <h3 className="text-sm font-medium">Unscheduled</h3>
        <span className="text-num rounded-full bg-surface-sunken px-2 text-xs text-text-muted">
          {tasks.length}
        </span>
        <span className="ml-auto hidden text-xs text-text-muted sm:inline">
          Pick a date to place a task on the timeline
        </span>
      </button>
      {open && (
        <ul className="border-t border-border-subtle px-2 py-2">
          {tasks.map((t) => (
            <li
              key={t.id}
              className="flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors [transition-duration:var(--duration-fast)] hover:bg-surface-hover"
            >
              <span
                aria-hidden="true"
                className={cn(
                  "h-2 w-2 shrink-0 rounded-full",
                  TASK_STATUS_CONFIG[t.status].dot,
                )}
              />
              <button
                type="button"
                onClick={() => onOpen(t.id)}
                className="min-w-0 truncate text-left text-sm hover:underline"
              >
                {t.title}
                <span className="sr-only">
                  {" "}
                  · {TASK_STATUS_CONFIG[t.status].label}
                </span>
              </button>
              <span className="hidden shrink-0 truncate text-xs text-text-muted sm:inline">
                {moduleNames[t.moduleId]}
              </span>
              {canEdit && (
                <div className="ml-auto shrink-0">
                  <DatePickerField
                    value={undefined}
                    onChange={(d) => d && onSchedule(t.id, d)}
                    placeholder="Schedule"
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
