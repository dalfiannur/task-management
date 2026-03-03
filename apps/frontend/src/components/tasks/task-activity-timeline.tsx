import { useMemo } from "react";
import { useAuth } from "react-oidc-context";
import { Loader2 } from "lucide-react";
import { useComments } from "@/hooks/use-comments";
import { useActivities } from "@/hooks/use-activities";
import { useUsers } from "@/hooks/use-users";
import { useLabels } from "@/hooks/use-labels";
import { resolveDisplayName } from "@/lib/utils";
import {
  CommentItem,
  formatRelativeTime,
} from "./task-comments";
import {
  TASK_STATUS_CONFIG,
  TASK_PRIORITY_CONFIG,
  type TaskStatus,
  type TaskPriority,
} from "@/types/task";
import type { Activity, FieldChange } from "@/types/activity";
import type { Comment } from "@/types/comment";
import styles from "./task-activity-timeline.module.css";

type TimelineEntry =
  | { kind: "comment"; timestamp: number; data: Comment }
  | { kind: "activity"; timestamp: number; data: Activity; changes: FieldChange[] };

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

  const timeline = useMemo<TimelineEntry[]>(() => {
    const entries: TimelineEntry[] = [];

    for (const comment of comments) {
      entries.push({
        kind: "comment",
        timestamp: new Date(comment.commentInfo.createdAt).getTime(),
        data: comment,
      });
    }

    for (const activity of activities) {
      let changes: FieldChange[] = [];
      try {
        changes = JSON.parse(activity.activityInfo.changes);
      } catch {
        changes = [];
      }
      entries.push({
        kind: "activity",
        timestamp: new Date(activity.activityInfo.createdAt).getTime(),
        data: activity,
        changes,
      });
    }

    entries.sort((a, b) => a.timestamp - b.timestamp);
    return entries;
  }, [comments, activities]);

  const isLoading = commentsLoading || activitiesLoading;

  if (isLoading) {
    return (
      <div className={styles.loadingRow}>
        <Loader2 className={styles.spinner} />
        Loading...
      </div>
    );
  }

  if (timeline.length === 0) {
    return (
      <p className={styles.emptyText}>No comments or activity yet</p>
    );
  }

  return (
    <div className={styles.timeline}>
      {timeline.map((entry) => {
        if (entry.kind === "comment") {
          return (
            <CommentItem
              key={`c-${entry.data.id}`}
              comment={entry.data}
              isAuthor={entry.data.commentInfo.authorId === currentUserId}
              taskId={taskId}
              users={users}
            />
          );
        }

        const { data: activity, changes } = entry;
        const { activityInfo } = activity;

        if (activityInfo.action === "created") {
          return (
            <ActivityEntry
              key={`a-${activity.id}`}
              color="green"
              actorId={activityInfo.actorId}
              actorName={activityInfo.actorName}
              users={users}
              time={activityInfo.createdAt}
              text="created this task"
            />
          );
        }

        if (activityInfo.action === "deleted") {
          return (
            <ActivityEntry
              key={`a-${activity.id}`}
              color="red"
              actorId={activityInfo.actorId}
              actorName={activityInfo.actorName}
              users={users}
              time={activityInfo.createdAt}
              text="deleted this task"
            />
          );
        }

        // "updated" — one row per change
        return changes.map((change, i) => (
          <ActivityEntry
            key={`a-${activity.id}-${i}`}
            color="muted"
            actorId={activityInfo.actorId}
            actorName={activityInfo.actorName}
            users={users}
            time={activityInfo.createdAt}
            text={formatFieldChange(change, users, labels)}
          />
        ));
      })}
    </div>
  );
}

function ActivityEntry({
  color,
  actorId,
  actorName,
  users,
  time,
  text,
}: {
  color: "green" | "red" | "muted";
  actorId: string;
  actorName: string;
  users: Array<{ id: string; name: string }>;
  time: string;
  text: string;
}) {
  const displayName = resolveDisplayName(actorId, actorName, users);

  return (
    <div className={styles.activityRow}>
      <span className={styles.activityDot} data-color={color} />
      <span className={styles.activityText}>
        <span className={styles.actorName}>{displayName}</span> {text}
      </span>
      <span className={styles.activityTime}>
        {formatRelativeTime(time)}
      </span>
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
