import { Link } from "@tanstack/react-router";
import { Square } from "lucide-react";
import { Button } from "sedjiwa-ui";
import { useRunningTimer, useStopTimer } from "../api/hooks";
import { Elapsed } from "./elapsed";

/** The viewer's running timer, in the top bar on every page: what it is on,
 *  how long it has run, and a Stop. Nothing when no timer runs. */
export function RunningTimerChip() {
  const { entry } = useRunningTimer();
  const stop = useStopTimer();
  if (!entry) return null;
  const label = `${entry.taskNumber ? `#${entry.taskNumber} ` : ""}${entry.taskTitle || "Task"}`;
  return (
    <div
      role="status"
      aria-label="Timer running"
      className="flex max-w-[16rem] shrink-0 items-center gap-2 rounded-full border border-border bg-card py-0.5 pl-3 pr-0.5 text-sm"
    >
      <span aria-hidden="true" className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-destructive" />
      <Link
        to="/projects/$projectId/all-tasks"
        params={{ projectId: entry.projectId }}
        search={{ task: entry.taskId }}
        className="hidden min-w-0 truncate hover:underline md:inline"
        title={label}
      >
        {label}
      </Link>
      <Elapsed startedAt={entry.startedAt} />
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 rounded-full"
        onClick={() => stop.mutate({})}
        disabled={stop.isPending}
        aria-label={`Stop timer on ${label}`}
      >
        <Square className="h-3.5 w-3.5 fill-current" />
      </Button>
    </div>
  );
}
