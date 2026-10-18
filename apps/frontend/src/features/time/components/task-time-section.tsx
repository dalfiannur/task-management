import { useState } from "react";
import { format, parseISO } from "date-fns";
import { Play, Plus, Square, Trash2 } from "lucide-react";
import { Button, Input } from "sedjiwa-ui";
import { useAtomValue } from "jotai";
import { cn } from "@/lib/utils";
import { formatMinutes, parseEstimate } from "@/lib/duration";
import { currentUserAtom, isAdminAtom } from "@/features/auth";
import { useUserMap } from "@/features/users";
import {
  localToday,
  useDeleteTimeEntry,
  useLogTime,
  useRunningTimer,
  useStartTimer,
  useStopTimer,
  useTaskTimeEntries,
} from "../api/hooks";
import { Elapsed } from "./elapsed";

/**
 * Time on one task, in its dialog: logged vs estimate, the timer, a quick
 * "log time" form and the entries. Every member sees every entry; the author
 * (or an admin) deletes one.
 */
export function TaskTimeSection({
  taskId,
  estimateMinutes,
  loggedMinutes,
}: {
  taskId: string;
  estimateMinutes?: number;
  loggedMinutes: number;
}) {
  const me = useAtomValue(currentUserAtom);
  const isAdmin = useAtomValue(isAdminAtom);
  const userMap = useUserMap();
  const { entries } = useTaskTimeEntries(taskId);
  const { entry: running } = useRunningTimer();
  const start = useStartTimer();
  const stop = useStopTimer();
  const log = useLogTime();
  const del = useDeleteTimeEntry();
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const minutes = parseEstimate(amount);
  const runningHere = running?.taskId === taskId;
  const over = !!estimateMinutes && loggedMinutes > estimateMinutes;
  const pct = estimateMinutes ? Math.min(100, Math.round((loggedMinutes / estimateMinutes) * 100)) : 0;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!minutes) return;
    log.mutate(
      { taskId, minutes, date: localToday(), note: note.trim() || undefined },
      {
        onSuccess: () => {
          setAmount("");
          setNote("");
        },
      },
    );
  }

  return (
    <section className="space-y-3" aria-labelledby={`time-${taskId}`}>
      <div className="flex items-center justify-between gap-3">
        <h3 id={`time-${taskId}`} className="text-sm font-medium">
          Time
        </h3>
        {runningHere ? (
          <Button size="sm" variant="secondary" onClick={() => stop.mutate({})} disabled={stop.isPending}>
            <Square className="mr-1 h-3.5 w-3.5 fill-current" />
            Stop · <Elapsed startedAt={running?.startedAt} />
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            onClick={() => start.mutate({ taskId, date: localToday() })}
            disabled={start.isPending}
            title={running ? "Stops the timer running on another task" : undefined}
          >
            <Play className="mr-1 h-3.5 w-3.5" />
            Start timer
          </Button>
        )}
      </div>

      <div className="space-y-1">
        <p className="text-sm">
          <span className={cn("text-num font-medium", over && "text-destructive")}>
            {formatMinutes(loggedMinutes)}
          </span>
          <span className="text-muted-foreground">
            {estimateMinutes ? ` of ${formatMinutes(estimateMinutes)} estimated` : " logged"}
          </span>
        </p>
        {!!estimateMinutes && (
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
            aria-label="Logged against estimate"
            className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
          >
            <div
              className={cn("h-full rounded-full", over ? "bg-destructive" : "bg-primary")}
              style={{ width: `${pct}%` }}
            />
          </div>
        )}
      </div>

      <form onSubmit={submit} className="flex flex-wrap items-start gap-2">
        <Input.Root className="w-28" aria-invalid={(amount !== "" && !minutes) || undefined}>
          <Input.Field
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="e.g. 45m"
            aria-label="Time spent"
          />
        </Input.Root>
        <Input.Root className="min-w-40 flex-1">
          <Input.Field
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What did you work on? (optional)"
            aria-label="Note"
            maxLength={500}
          />
        </Input.Root>
        <Button type="submit" size="sm" disabled={!minutes || log.isPending}>
          <Plus className="mr-1 h-4 w-4" />
          Log
        </Button>
      </form>

      {entries.length > 0 && (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {entries.map((e) => {
            const mine = e.userId === me?.id || isAdmin;
            return (
              <li key={e.id} className="group flex items-center gap-3 px-3 py-2 text-sm">
                <span className="text-num w-14 shrink-0 font-medium">
                  {e.running ? <span className="text-destructive">running</span> : formatMinutes(e.minutes)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{e.note || <span className="text-muted-foreground">—</span>}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {userMap[e.userId]?.displayName ?? "Unknown"} · {format(parseISO(e.date), "d MMM yyyy")}
                  </span>
                </span>
                {mine && !e.running && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                    onClick={() => del.mutate({ id: e.id })}
                    aria-label="Delete time entry"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
