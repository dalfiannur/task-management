import { useState } from "react";
import { useAtomValue } from "jotai";
import { CalendarDays, Gauge } from "lucide-react";
import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from "sedjiwa-ui";
import { EmptyState } from "@/components/shared/empty-state";
import { currentUserAtom, isAdminAtom } from "@/features/auth";
import { useWorkload } from "../api/hooks";
import type { WorkloadMember } from "../types";
import { WorkCalendarDialog } from "./work-calendar-dialog";
import { WorkloadGrid } from "./workload-grid";

const ALL = "all";

/**
 * Cross-project workload: everyone in the viewer's projects, the remaining
 * effort of their estimated open tasks spread over the coming weeks against
 * their capacity.
 */
export function WorkloadPage() {
  const me = useAtomValue(currentUserAtom);
  const isAdmin = useAtomValue(isAdminAtom);
  const [projectId, setProjectId] = useState(ALL);
  const [globalOpen, setGlobalOpen] = useState(false);
  const [editing, setEditing] = useState<WorkloadMember | null>(null);
  const { workload, isLoading, isError, error } = useWorkload(
    projectId === ALL ? undefined : projectId,
  );
  // Keep the filter's options from the unfiltered scope so picking a project
  // does not shrink the list to itself.
  const { workload: all } = useWorkload();
  const projects = all?.projects ?? [];

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Workload</h1>
          <p className="text-sm text-muted-foreground">
            Remaining effort of estimated open tasks (estimate − time logged), spread
            evenly from start to due date over working days.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={projectId} onValueChange={setProjectId}>
            <SelectTrigger className="h-9 w-56" aria-label="Project">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All my projects</SelectItem>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => setGlobalOpen(true)}>
            <CalendarDays className="mr-1 h-4 w-4" />
            Working days
          </Button>
        </div>
      </div>

      {isError ? (
        <p className="text-sm text-destructive">{error?.message ?? "Failed to load the workload."}</p>
      ) : isLoading || !workload ? (
        <Skeleton className="h-64 w-full rounded-xl shadow-sm" />
      ) : workload.members.length === 0 ? (
        <EmptyState
          icon={Gauge}
          title="Workload shows up once projects have members"
          body="Join or create a project, then estimate and assign its tasks to see who has how much on their plate."
          action={{ label: "Go to projects", to: "/projects" }}
        />
      ) : (
        <>
          <WorkloadGrid
            workload={workload}
            showProject={projectId === ALL}
            canEditCalendar={(id) => isAdmin || id === me?.id}
            onEditCalendar={setEditing}
          />
          <p className="text-xs text-muted-foreground">
            Unestimated tasks are not counted. A parent's estimate is skipped when its
            subtasks have their own. Work in a project is planned on the days both the
            project and the person work.
          </p>
        </>
      )}

      <WorkCalendarDialog
        scope="global"
        title="Workspace working days"
        open={globalOpen}
        onOpenChange={setGlobalOpen}
      />
      <WorkCalendarDialog
        scope="user"
        id={editing?.userId}
        title={editing ? `${editing.userName}'s working days` : "Working days"}
        open={!!editing}
        onOpenChange={(o) => !o && setEditing(null)}
      />
    </div>
  );
}
