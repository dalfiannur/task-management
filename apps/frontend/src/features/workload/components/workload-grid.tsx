import { Fragment, useState } from "react";
import { Link } from "@tanstack/react-router";
import { format, parseISO } from "date-fns";
import { AlertTriangle, CalendarDays, ChevronRight } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage, Button } from "sedjiwa-ui";
import { formatMinutes } from "@/lib/duration";
import { cn, getInitials } from "@/lib/utils";
import { formatDays, type Workload, type WorkloadMember, type WorkloadTask } from "../types";

/** Planned vs capacity: over is red, nearly full amber. */
function tone(planned: number, capacity: number) {
  if (planned === 0) return "idle";
  if (planned > capacity) return "over";
  if (planned > capacity * 0.85) return "full";
  return "ok";
}

/** Stripes in the text colour, so the "other projects" segment reads as
 *  neutral and works in both themes. */
const STRIPES = {
  backgroundImage: "repeating-linear-gradient(45deg, currentColor 0 2px, transparent 2px 5px)",
};

function LoadCell({
  planned,
  other,
  capacity,
}: {
  planned: number;
  /** This person's load in projects outside this view. */
  other: number;
  capacity: number;
}) {
  // Load counts all of the person's work, so someone busy elsewhere does
  // not look free here.
  const load = planned + other;
  const t = tone(load, capacity);
  const scale = (m: number) => (capacity > 0 ? (m / capacity) * 100 : m > 0 ? 100 : 0);
  const plannedPct = Math.min(scale(planned), 100);
  const otherPct = Math.min(scale(other), 100 - plannedPct);
  return (
    <div
      className={cn(
        "flex min-w-[4.5rem] flex-col gap-1 rounded-md px-2 py-1.5",
        t === "over" && "bg-destructive-subtle",
        t === "full" && "bg-warning-subtle",
      )}
      title={other ? `Other projects: ${formatMinutes(other)}` : undefined}
    >
      <span
        className={cn(
          "text-num text-sm",
          t === "idle" && "text-muted-foreground",
          t === "over" && "font-medium text-destructive-subtle-text",
          t === "full" && "font-medium text-warning-subtle-text",
        )}
      >
        {planned ? formatMinutes(planned) : "–"}
        {other > 0 && (
          <span className="ml-1 text-xs font-normal text-muted-foreground">
            +{formatMinutes(other)}
            <span className="sr-only"> in other projects</span>
          </span>
        )}
      </span>
      <div className="flex h-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <div
          className={cn(
            "h-full",
            t === "over" ? "bg-destructive" : t === "full" ? "bg-warning" : "bg-primary",
          )}
          style={{ width: `${plannedPct}%` }}
        />
        {otherPct > 0 && (
          <div className="h-full text-muted-foreground/70" style={{ width: `${otherPct}%`, ...STRIPES }} />
        )}
      </div>
      <span className="text-num text-xs text-muted-foreground">
        of {formatMinutes(capacity)}
      </span>
    </div>
  );
}

function Plain({ minutes, other = 0, alert }: { minutes: number; other?: number; alert?: boolean }) {
  return (
    <span className="flex flex-col">
      <span
        className={cn(
          "text-num text-sm",
          !minutes && "text-muted-foreground",
          alert && minutes > 0 && "font-medium text-destructive",
        )}
      >
        {minutes ? formatMinutes(minutes) : "–"}
      </span>
      {other > 0 && (
        <span className="text-num text-xs text-muted-foreground">
          +{formatMinutes(other)} in other projects
        </span>
      )}
    </span>
  );
}

function when(t: WorkloadTask) {
  if (t.bucket === "unscheduled") return "No due date";
  const due = t.dueDate ? format(parseISO(t.dueDate.slice(0, 10)), "MMM d") : "";
  if (t.bucket === "overdue") return `Overdue · due ${due}`;
  const start = t.startDate ? format(parseISO(t.startDate.slice(0, 10)), "MMM d") : "";
  return start ? `${start} – ${due}` : `Due ${due}`;
}

function TaskList({ tasks, showProject }: { tasks: WorkloadTask[]; showProject: boolean }) {
  if (tasks.length === 0) {
    return <p className="px-4 py-3 text-sm text-muted-foreground">No estimated open tasks.</p>;
  }
  return (
    <ul className="divide-y divide-border">
      {tasks.map((t) => (
        <li key={t.taskId} className="flex items-center gap-3 px-4 py-2 text-sm">
          <Link
            to="/projects/$projectId/all-tasks"
            params={{ projectId: t.projectId }}
            search={{ task: t.taskId }}
            className="min-w-0 flex-1 truncate hover:underline"
          >
            <span className="text-num text-muted-foreground">#{t.number}</span> {t.title}
          </Link>
          {showProject && (
            <span className="hidden max-w-[12rem] truncate text-xs text-muted-foreground sm:block">
              {t.projectName}
            </span>
          )}
          {t.calendarConflict && (
            <AlertTriangle
              className="h-3.5 w-3.5 shrink-0 text-warning"
              aria-label="No working day shared with the project"
            />
          )}
          <span
            className={cn(
              "w-36 shrink-0 text-right text-xs",
              t.bucket === "overdue" ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {when(t)}
          </span>
          <span className="text-num w-16 shrink-0 text-right">{formatMinutes(t.remainingMinutes)}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * People × weeks: each cell is the remaining effort planned that week against
 * the person's capacity. A row opens to the tasks behind it.
 */
export function WorkloadGrid({
  workload,
  showProject,
  canEditCalendar,
  onEditCalendar,
}: {
  workload: Workload;
  showProject: boolean;
  canEditCalendar: (userId: string) => boolean;
  onEditCalendar: (member: WorkloadMember) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const cols = workload.weekStarts.length + 5;

  return (
    <div className="overflow-x-auto rounded-xl bg-card shadow-sm">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-border bg-muted/40 text-label">
            <th scope="col" className="sticky left-0 z-10 min-w-[14rem] bg-card px-4 py-2 font-normal">
              Member
            </th>
            <th scope="col" className="px-2 py-2 font-normal">Overdue</th>
            {workload.weekStarts.map((w, i) => (
              <th key={w} scope="col" className="px-2 py-2 font-normal whitespace-nowrap">
                {i === 0 ? "This week" : `Wk of ${format(parseISO(w), "MMM d")}`}
              </th>
            ))}
            <th scope="col" className="px-2 py-2 font-normal">Later</th>
            <th scope="col" className="px-2 py-2 font-normal whitespace-nowrap">No date</th>
            <th scope="col" className="px-4 py-2 text-right font-normal">Total</th>
          </tr>
        </thead>
        <tbody>
          {workload.members.map((m) => {
            const expanded = open === m.userId;
            return (
              <Fragment key={m.userId}>
                <tr className="border-b border-border align-middle">
                  <th scope="row" className="sticky left-0 z-10 bg-card px-4 py-2 font-normal">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        aria-expanded={expanded}
                        aria-label={`${expanded ? "Hide" : "Show"} ${m.userName}'s tasks`}
                        onClick={() => setOpen(expanded ? null : m.userId)}
                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      >
                        <ChevronRight
                          aria-hidden="true"
                          className={cn(
                            "h-4 w-4 shrink-0 text-muted-foreground [transition:transform_var(--duration-fast)_var(--ease-out)]",
                            expanded && "rotate-90",
                          )}
                        />
                        <Avatar size="sm">
                          {m.avatarUrl && <AvatarImage src={m.avatarUrl} />}
                          <AvatarFallback>{getInitials(m.userName)}</AvatarFallback>
                        </Avatar>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">{m.userName}</span>
                          <span className="text-num block truncate text-xs text-muted-foreground">
                            {formatMinutes(m.weeklyMinutes)}/wk · {formatDays(m.workingDays)}
                          </span>
                        </span>
                      </button>
                      {m.calendarConflict && (
                        <AlertTriangle
                          className="h-4 w-4 shrink-0 text-warning"
                          aria-label="Some tasks are in a project that shares no working day with this person; their own days are used"
                        />
                      )}
                      {canEditCalendar(m.userId) && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 shrink-0"
                          aria-label={`${m.userName}'s working days`}
                          onClick={() => onEditCalendar(m)}
                        >
                          <CalendarDays className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </th>
                  <td className="px-2 py-2">
                    <Plain minutes={m.overdueMinutes} other={m.otherOverdueMinutes} alert />
                  </td>
                  {m.weeks.map((w, i) => (
                    <td key={workload.weekStarts[i]} className="px-1 py-1.5">
                      <LoadCell planned={w.plannedMinutes} other={w.otherMinutes} capacity={w.capacityMinutes} />
                    </td>
                  ))}
                  <td className="px-2 py-2">
                    <Plain minutes={m.laterMinutes} other={m.otherLaterMinutes} />
                  </td>
                  <td className="px-2 py-2">
                    <Plain minutes={m.unscheduledMinutes} other={m.otherUnscheduledMinutes} />
                  </td>
                  <td className="px-4 py-2 text-right">
                    <span className="text-num text-sm font-medium">
                      {m.totalMinutes ? formatMinutes(m.totalMinutes) : "–"}
                    </span>
                  </td>
                </tr>
                {expanded && (
                  <tr className="border-b border-border bg-muted/20">
                    <td colSpan={cols} className="p-0">
                      <TaskList tasks={m.tasks} showProject={showProject} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
