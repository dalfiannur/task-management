import { useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
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

export function MyTasksView() {
  const [view, setView] = useState<ViewKey>("assigned");
  const [status, setStatus] = useState<TaskStatus | typeof ALL>(ALL);

  const { items, total, isLoading } = useMyTasks(view, {
    status: status === ALL ? undefined : status,
  });

  return (
    <div className="space-y-4 p-6">
      <h1 className="text-2xl font-semibold">My tasks</h1>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-md border p-0.5">
          {VIEWS.map((v) => (
            <button
              key={v.key}
              onClick={() => setView(v.key)}
              className={cn(
                "rounded px-3 py-1 text-sm transition-colors",
                view === v.key
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {v.label}
            </button>
          ))}
        </div>
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
      </div>

      {isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center text-muted-foreground">
          No tasks here.
        </div>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">{total} task(s)</p>
          <div className="rounded-lg border">
            {items.map((it) => (
              <MyTaskRow key={it.task.id} item={it} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
