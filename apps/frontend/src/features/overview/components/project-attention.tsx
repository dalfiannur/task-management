import { Link } from "@tanstack/react-router";
import { addDays, format } from "date-fns";
import { CheckCircle2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { EmptyState } from "@/components/shared/empty-state";
import { cn, getInitials } from "@/lib/utils";
import { dueGroup, dueLabel, type DueGroup } from "@/features/dashboard";
import { PriorityLabel, useModules, useTasks, type Task } from "@/features/tasks";
import { useUserMap } from "@/features/users";

const GROUPS: { key: DueGroup; label: string }[] = [
  { key: "overdue", label: "Overdue" },
  { key: "today", label: "Today" },
  { key: "tomorrow", label: "Tomorrow" },
  { key: "later", label: "This week" },
];

const isOpen = (t: Task) => t.status !== "done" && t.status !== "cancelled";
const due = (t: Task) => t.dueDate?.slice(0, 10);

/** Open tasks in this project that are overdue or due within `withinDays`,
 *  grouped by when they are due — the project-scoped twin of the dashboard's
 *  "Needs attention", in the same shape.
 *
 *  Built from `useTasks` (the whole project's list, the same cache the Tasks
 *  tab reads) rather than a new RPC: the filtering is a handful of string
 *  compares. A row opens the task dialog, which lives on the Tasks tab. */
export function ProjectAttention({
  projectId,
  withinDays = 7,
}: {
  projectId: string;
  withinDays?: number;
}) {
  const { tasks, isLoading, isError, error } = useTasks(projectId);
  const { modules } = useModules(projectId);

  if (isLoading) {
    return <Skeleton className="h-64 w-full rounded-xl shadow-2" />;
  }

  // An empty list after a failed fetch would read as "Nothing pressing" —
  // exactly the wrong reassurance.
  if (isError) {
    return (
      <div className="rounded-xl bg-surface-raised px-4 py-6 text-center text-sm text-danger shadow-2">
        {error?.message ?? "Couldn’t load this project’s tasks."}
      </div>
    );
  }

  const horizon = format(addDays(new Date(), withinDays), "yyyy-MM-dd");
  const items = tasks
    .filter((t) => isOpen(t) && due(t) && due(t)! <= horizon)
    .sort((a, b) => due(a)!.localeCompare(due(b)!) || a.order - b.order);

  if (items.length === 0) {
    return (
      <div className="rounded-xl bg-surface-raised shadow-2">
        <EmptyState
          variant="cleared"
          size="compact"
          icon={CheckCircle2}
          title="Nothing pressing"
          body={`No open task here is overdue or due in the next ${withinDays} days.`}
          action={{
            label: "Open Tasks",
            to: "/projects/$projectId/all-tasks",
            params: { projectId },
          }}
        />
      </div>
    );
  }

  const moduleName = new Map(modules.map((m) => [m.id, m.name]));
  const grouped = new Map<DueGroup, Task[]>();
  for (const t of items) {
    const g = dueGroup(due(t)!);
    grouped.set(g, [...(grouped.get(g) ?? []), t]);
  }

  return (
    <div className="overflow-hidden rounded-xl bg-surface-raised shadow-2">
      {GROUPS.filter((g) => grouped.has(g.key)).map((g) => {
        const rows = grouped.get(g.key)!;
        const late = g.key === "overdue";
        return (
          <section
            key={g.key}
            className="border-b border-border-subtle last:border-b-0"
          >
            {/* Plain concatenation: cn()'s tailwind-merge would drop
                `text-label` next to `text-danger`. */}
            <h3
              className={`text-label flex items-center gap-2 px-4 pb-1 pt-3${late ? " text-danger" : ""}`}
            >
              {g.label}
              <span className="text-num font-normal">{rows.length}</span>
            </h3>
            <ul>
              {rows.map((t) => (
                <AttentionRow
                  key={t.id}
                  projectId={projectId}
                  task={t}
                  moduleName={moduleName.get(t.moduleId)}
                  late={late}
                />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/** Faces shown per row before the rest collapse into "+N". */
const MAX_FACES = 2;

function AttentionRow({
  projectId,
  task,
  moduleName,
  late,
}: {
  projectId: string;
  task: Task;
  moduleName?: string;
  late: boolean;
}) {
  const userMap = useUserMap();
  const faces = task.assigneeIds.slice(0, MAX_FACES);
  const rest = task.assigneeIds.length - faces.length;

  return (
    <li>
      <Link
        to="/projects/$projectId/all-tasks"
        params={{ projectId }}
        search={{ task: task.id }}
        className="flex items-center gap-3 px-4 py-2.5 transition-colors [transition-duration:var(--duration-fast)] hover:bg-surface-hover"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm">{task.title}</span>
          {moduleName && (
            <span className="block truncate text-xs text-text-muted">
              {moduleName}
            </span>
          )}
        </span>

        {/* Fixed width so the priority and due columns line up whether a
            row has zero, one or two assignees. */}
        <span className="hidden w-14 shrink-0 items-center justify-end sm:flex">
          {faces.map((id) => {
            const u = userMap[id];
            const name = u?.displayName ?? id;
            return (
              <Avatar
                key={id}
                size="sm"
                className="-ml-1 ring-2 ring-surface-raised first:ml-0"
                title={name}
              >
                {u?.avatarUrl && <AvatarImage src={u.avatarUrl} alt="" />}
                <AvatarFallback aria-hidden="true">
                  {getInitials(name)}
                </AvatarFallback>
                <span className="sr-only">{name}</span>
              </Avatar>
            );
          })}
          {rest > 0 && (
            <span className="text-num ml-1 text-xs text-text-muted">+{rest}</span>
          )}
        </span>

        {/* PriorityLabel renders nothing for "none"; the fixed slot keeps
            the avatar column from sliding right on those rows. */}
        <span className="flex w-16 shrink-0 justify-end">
          <PriorityLabel priority={task.priority} />
        </span>
        <span
          className={cn(
            "text-num w-20 shrink-0 text-right text-xs",
            late ? "font-medium text-danger" : "text-text-muted",
          )}
          title={task.dueDate}
        >
          {dueLabel(due(task)!)}
        </span>
      </Link>
    </li>
  );
}
