import { useState } from "react";
import { ListChecks, SearchX } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  TASK_STATUSES,
  TASK_STATUS_CONFIG,
  type TaskStatus,
} from "@/features/tasks";
import type { MyTasksView as ViewKey } from "../types";
import { useMyTasks } from "../api/hooks";
import { MyTaskRow } from "./my-task-row";

const VIEWS: { key: ViewKey; label: string }[] = [
  { key: "assigned", label: "Assigned to me" },
  { key: "created", label: "Created by me" },
  { key: "involving", label: "Involving me" },
];

const ALL = "all";

/** Tiap view kosong karena sebab yang berbeda, jadi copy-nya berbeda —
 *  headline menjelaskan APA yang akan muncul di sini, bukan "Kosong".
 *  CTA-nya sama untuk ketiganya karena jalan keluarnya memang sama: tugas
 *  lahir di dalam project, bukan di layar ini. */
const EMPTY_COPY: Record<ViewKey, { title: string; body: string; cta: string }> =
  {
    assigned: {
      title: "Nothing assigned to you",
      body: "Tasks other people assign to you land here, so you can work from one list instead of checking every project.",
      cta: "Browse projects",
    },
    created: {
      title: "You haven't created any tasks",
      body: "Tasks you open yourself collect here — handy for tracking what you asked for across projects.",
      cta: "Open a project",
    },
    involving: {
      title: "You're not on any tasks yet",
      body: "Anything you're assigned to, created, or commented on shows up here.",
      cta: "Browse projects",
    },
  };

export function MyTasksView() {
  const [view, setView] = useState<ViewKey>("assigned");
  const [status, setStatus] = useState<TaskStatus | typeof ALL>(ALL);

  const { items, total, isLoading } = useMyTasks(view, {
    status: status === ALL ? undefined : status,
  });

  const isEmpty = !isLoading && items.length === 0;
  const filtered = status !== ALL;
  // Filter status disembunyikan saat kosong KECUALI ia yang sedang menyaring —
  // empty-states.md §3. Toggle view tetap tampil: ia bukan filter yang perlu
  // dicabut, ia jalan keluar ke daftar lain.
  const showStatusFilter = !isEmpty || filtered;

  return (
    <div className="p-6">
      <h1 className="mb-6 text-2xl font-semibold">My tasks</h1>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-md border border-border p-1">
          {VIEWS.map((v) => (
            <button
              key={v.key}
              onClick={() => setView(v.key)}
              className={cn(
                "rounded-sm px-3 py-1 text-sm",
                "[transition:background-color_var(--duration-fast)_var(--ease-out),color_var(--duration-fast)_var(--ease-out)]",
                view === v.key
                  ? "bg-brand font-medium text-text-on-brand"
                  : "text-text-muted hover:text-text",
              )}
            >
              {v.label}
            </button>
          ))}
        </div>
        {showStatusFilter && (
          <Select
            value={status}
            onValueChange={(v) => setStatus(v as TaskStatus | typeof ALL)}
          >
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All statuses</SelectItem>
              {TASK_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {TASK_STATUS_CONFIG[s].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : isEmpty ? (
        // Dua sebab kosong, dua copy dan dua CTA — empty-states.md §4.
        filtered ? (
          <EmptyState
            variant="no-results"
            icon={SearchX}
            title={`No ${TASK_STATUS_CONFIG[status as TaskStatus].label.toLowerCase()} tasks here`}
            body="Nothing matches this status right now. Clear the filter to see everything in this view."
            action={{ label: "Clear filter", onClick: () => setStatus(ALL) }}
          />
        ) : (
          <EmptyState
            icon={ListChecks}
            title={EMPTY_COPY[view].title}
            body={EMPTY_COPY[view].body}
            action={{ label: EMPTY_COPY[view].cta, to: "/projects" }}
          />
        )
      ) : (
        <>
          <p className="mb-3 text-sm text-text-muted">{total} task(s)</p>
          <div className="overflow-hidden rounded-lg border border-border">
            {items.map((it) => (
              <MyTaskRow key={it.task.id} item={it} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
