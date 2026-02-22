import { useAuth } from "react-oidc-context";
import {
  History,
  MessageSquare,
  Plus,
  ArrowRight,
  Loader2,
} from "lucide-react";
import { useComments } from "@/hooks/use-comments";
import { useActivities } from "@/hooks/use-activities";
import { useUsers } from "@/hooks/use-users";
import { useLabels } from "@/hooks/use-labels";
import {
  CommentItem,
  AddCommentForm,
  formatRelativeTime,
} from "./task-comments";
import {
  TASK_STATUS_CONFIG,
  TASK_PRIORITY_CONFIG,
  type TaskStatus,
  type TaskPriority,
} from "@/types/task";
import type { Activity, FieldChange } from "@/types/activity";

interface TaskActivityTimelineProps {
  taskId: string;
  projectId: string;
}

export function TaskActivityTimeline({
  taskId,
  projectId,
}: TaskActivityTimelineProps) {
  const auth = useAuth();
  const currentUserId = auth.user?.profile?.sub as string | undefined;
  const { data: comments = [], isLoading: commentsLoading } =
    useComments(taskId);
  const { data: activities = [], isLoading: activitiesLoading } =
    useActivities(taskId);
  const { data: users = [] } = useUsers();
  const { data: labels = [] } = useLabels(projectId);

  const sortedComments = [...comments].sort(
    (a, b) =>
      new Date(a.commentInfo.createdAt).getTime() -
      new Date(b.commentInfo.createdAt).getTime(),
  );

  const sortedActivities = [...activities].sort(
    (a, b) =>
      new Date(a.activityInfo.createdAt).getTime() -
      new Date(b.activityInfo.createdAt).getTime(),
  );

  return (
    <div className="space-y-6">
      {/* Comments Section */}
      <div className="space-y-3">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/50 flex items-center gap-1.5">
          <MessageSquare className="size-3.5" />
          Comments ({comments.length})
        </p>

        {commentsLoading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
            <Loader2 className="size-3.5 animate-spin" />
            Loading comments...
          </div>
        ) : sortedComments.length === 0 ? (
          <p className="text-xs text-muted-foreground/60 py-2">
            No comments yet
          </p>
        ) : (
          <div className="space-y-3">
            {sortedComments.map((comment) => (
              <CommentItem
                key={comment.id}
                comment={comment}
                isAuthor={comment.commentInfo.authorId === currentUserId}
                taskId={taskId}
                users={users}
              />
            ))}
          </div>
        )}

        <AddCommentForm taskId={taskId} />
      </div>

      {/* Activity Section */}
      <div className="space-y-3">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/50 flex items-center gap-1.5">
          <History className="size-3.5" />
          Activity ({activities.length})
        </p>

        {activitiesLoading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
            <Loader2 className="size-3.5 animate-spin" />
            Loading activity...
          </div>
        ) : sortedActivities.length === 0 ? (
          <p className="text-xs text-muted-foreground/60 py-2">
            No activity yet
          </p>
        ) : (
          <div className="space-y-3">
            {sortedActivities.map((activity) => (
              <ActivityItem
                key={activity.id}
                activity={activity}
                users={users}
                labels={labels}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ActivityItem({
  activity,
  users,
  labels,
}: {
  activity: Activity;
  users: Array<{ id: string; name: string }>;
  labels: Array<{ id: string; name: string; color: string }>;
}) {
  const { activityInfo } = activity;

  let changes: FieldChange[] = [];
  try {
    changes = JSON.parse(activityInfo.changes);
  } catch {
    changes = [];
  }

  if (activityInfo.action === "created") {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
        <Plus className="size-3.5 text-green-500 shrink-0" />
        <span>
          <span className="font-medium text-foreground">
            {activityInfo.actorName}
          </span>{" "}
          created this task
        </span>
        <span className="text-[11px] text-muted-foreground/60 ml-auto shrink-0">
          {formatRelativeTime(activityInfo.createdAt)}
        </span>
      </div>
    );
  }

  if (activityInfo.action === "deleted") {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
        <span className="size-3.5 text-red-500 shrink-0 text-center font-bold">
          &times;
        </span>
        <span>
          <span className="font-medium text-foreground">
            {activityInfo.actorName}
          </span>{" "}
          deleted this task
        </span>
        <span className="text-[11px] text-muted-foreground/60 ml-auto shrink-0">
          {formatRelativeTime(activityInfo.createdAt)}
        </span>
      </div>
    );
  }

  // "updated" action — one row per change
  return (
    <div className="space-y-1">
      {changes.map((change, i) => (
        <div
          key={i}
          className="flex items-center gap-2 text-xs text-muted-foreground py-1"
        >
          <ArrowRight className="size-3.5 text-blue-500 shrink-0" />
          <span>
            <span className="font-medium text-foreground">
              {activityInfo.actorName}
            </span>{" "}
            {formatFieldChange(change, users, labels)}
          </span>
          <span className="text-[11px] text-muted-foreground/60 ml-auto shrink-0">
            {formatRelativeTime(activityInfo.createdAt)}
          </span>
        </div>
      ))}
    </div>
  );
}

function formatFieldChange(
  change: FieldChange,
  users: Array<{ id: string; name: string }>,
  labels: Array<{ id: string; name: string; color: string }>,
): string {
  const { field, from, to } = change;

  switch (field) {
    case "status": {
      const fromLabel =
        TASK_STATUS_CONFIG[from as TaskStatus]?.label ?? from;
      const toLabel =
        TASK_STATUS_CONFIG[to as TaskStatus]?.label ?? to;
      return `changed status from ${fromLabel} to ${toLabel}`;
    }
    case "priority": {
      const fromLabel =
        TASK_PRIORITY_CONFIG[from as TaskPriority]?.label ?? from;
      const toLabel =
        TASK_PRIORITY_CONFIG[to as TaskPriority]?.label ?? to;
      return `changed priority from ${fromLabel} to ${toLabel}`;
    }
    case "title":
      return `changed title from "${from}" to "${to}"`;
    case "description":
      return "updated the description";
    case "startDate": {
      if (!from && to) return `set start date to ${formatDate(to)}`;
      if (from && !to) return `removed start date`;
      return `changed start date from ${formatDate(from)} to ${formatDate(to)}`;
    }
    case "dueDate": {
      if (!from && to) return `set due date to ${formatDate(to)}`;
      if (from && !to) return `removed due date`;
      return `changed due date from ${formatDate(from)} to ${formatDate(to)}`;
    }
    case "assigneeIds": {
      const oldIds = safeParseIds(from);
      const newIds = safeParseIds(to);
      const added = newIds.filter((id) => !oldIds.includes(id));
      const removed = oldIds.filter((id) => !newIds.includes(id));
      const parts: string[] = [];
      if (added.length > 0) {
        const names = added.map(
          (id) => users.find((u) => u.id === id)?.name ?? "someone",
        );
        parts.push(`assigned ${names.join(", ")}`);
      }
      if (removed.length > 0) {
        const names = removed.map(
          (id) => users.find((u) => u.id === id)?.name ?? "someone",
        );
        parts.push(`unassigned ${names.join(", ")}`);
      }
      return parts.join(" and ") || "changed assignees";
    }
    case "labelIds": {
      const oldIds = safeParseIds(from);
      const newIds = safeParseIds(to);
      const added = newIds.filter((id) => !oldIds.includes(id));
      const removed = oldIds.filter((id) => !newIds.includes(id));
      const parts: string[] = [];
      if (added.length > 0) {
        const names = added.map(
          (id) => labels.find((l) => l.id === id)?.name ?? "a label",
        );
        parts.push(`added label ${names.join(", ")}`);
      }
      if (removed.length > 0) {
        const names = removed.map(
          (id) => labels.find((l) => l.id === id)?.name ?? "a label",
        );
        parts.push(`removed label ${names.join(", ")}`);
      }
      return parts.join(" and ") || "changed labels";
    }
    default:
      return `changed ${field}`;
  }
}

function formatDate(iso: string): string {
  if (!iso) return "none";
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

function safeParseIds(json: string): string[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
