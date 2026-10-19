// Time tracking RPC hooks (connect-query over TimeService). Every write also
// refreshes the task lists, whose `loggedMinutes` it changes, and the workload.

import { useMemo } from "react";
import { format } from "date-fns";
import { toast } from "sonner";
import { createConnectQueryKey, useMutation, useQuery } from "@connectrpc/connect-query";
import { TimeService, type TimeEntry as PbTimeEntry } from "@/lib/gen/time_pb";
import { TaskService } from "@/lib/gen/work_pb";
import { WorkloadService } from "@/lib/gen/workload_pb";
import { ActivityService } from "@/lib/gen/activity_pb";
import { formatMinutes } from "@/lib/duration";
import { queryClient } from "@/lib/query";
import type { TimeEntry } from "../types";

function mapEntry(e: PbTimeEntry): TimeEntry {
  return {
    id: e.id,
    taskId: e.taskId,
    projectId: e.projectId,
    userId: e.userId,
    date: e.date,
    startedAt: e.startedAt,
    endedAt: e.endedAt,
    minutes: e.minutes,
    note: e.note,
    running: e.running,
    taskTitle: e.taskTitle,
    taskNumber: e.taskNumber,
  };
}

/** The viewer's own calendar day — what an entry counts for. */
export function localToday(): string {
  return format(new Date(), "yyyy-MM-dd");
}

const refresh = () =>
  Promise.all([
    queryClient.invalidateQueries({
      queryKey: createConnectQueryKey({ schema: TimeService, cardinality: "finite" }),
    }),
    queryClient.invalidateQueries({
      queryKey: createConnectQueryKey({ schema: TaskService, cardinality: "finite" }),
    }),
    queryClient.invalidateQueries({
      queryKey: createConnectQueryKey({ schema: WorkloadService, cardinality: "finite" }),
    }),
    // Logged time shows up in the task's and the project's activity.
    queryClient.invalidateQueries({
      queryKey: createConnectQueryKey({ schema: ActivityService, cardinality: "finite" }),
    }),
  ]);

/** "Logged 1h 30m on #12". */
function toastLogged(e: { minutes: number; taskNumber: number } | undefined) {
  if (!e) return;
  toast.success(`Logged ${formatMinutes(e.minutes)}${e.taskNumber ? ` on #${e.taskNumber}` : ""}`);
}

const onError = (err: { message: string }) =>
  toast.error(err.message || "Time tracking failed");

export function useRunningTimer() {
  const result = useQuery(TimeService.method.getRunningTimer, {});
  const entry = useMemo(
    () => (result.data?.entry ? mapEntry(result.data.entry) : undefined),
    [result.data],
  );
  return { ...result, entry };
}

export function useTaskTimeEntries(taskId: string | undefined) {
  const result = useQuery(
    TimeService.method.listTimeEntries,
    { taskId },
    { enabled: !!taskId },
  );
  const entries = useMemo(() => (result.data?.entries ?? []).map(mapEntry), [result.data]);
  return { ...result, entries };
}

export function useStartTimer() {
  return useMutation(TimeService.method.startTimer, { onSuccess: refresh, onError });
}
export function useStopTimer() {
  return useMutation(TimeService.method.stopTimer, {
    onSuccess: (r) => {
      toastLogged(r.entry);
      return refresh();
    },
    onError,
  });
}
export function useLogTime() {
  return useMutation(TimeService.method.logTime, {
    onSuccess: (e) => {
      toastLogged(e);
      return refresh();
    },
    onError,
  });
}
export function useDeleteTimeEntry() {
  return useMutation(TimeService.method.deleteTimeEntry, { onSuccess: refresh, onError });
}
