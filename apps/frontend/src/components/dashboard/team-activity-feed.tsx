import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useRecentActivities } from "@/hooks/use-activities";
import type { FieldChange } from "@/types/activity";
import { Plus, Pencil, Trash2, Activity } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import styles from "./team-activity-feed.module.css";

const ACTION_CONFIG = {
  created: { icon: Plus, style: styles.iconCreated, verb: "created" },
  updated: { icon: Pencil, style: styles.iconUpdated, verb: "updated" },
  deleted: { icon: Trash2, style: styles.iconDeleted, verb: "deleted" },
} as const;

function getChangeDescription(action: string, changesJson: string): string | null {
  if (action !== "updated") return null;
  try {
    const changes: FieldChange[] = JSON.parse(changesJson);
    const statusChange = changes.find((c) => c.field === "status");
    if (statusChange) {
      return `${statusChange.from} \u2192 ${statusChange.to}`;
    }
    if (changes.length === 1) {
      return `changed ${changes[0].field}`;
    }
    if (changes.length > 1) {
      return `changed ${changes.length} fields`;
    }
  } catch {
    // ignore parse errors
  }
  return null;
}

export function TeamActivityFeed() {
  const { data: activities, isLoading } = useRecentActivities(15);

  return (
    <Card>
      <CardHeader>
        <CardTitle className={styles.cardTitle}>Activity Feed</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className={styles.loadingText}>Loading activity...</p>
        ) : !activities || activities.length === 0 ? (
          <div className={styles.emptyState}>
            <Activity className={styles.emptyIcon} />
            <p className={styles.emptyText}>No recent activity</p>
          </div>
        ) : (
          <div className={styles.activityList}>
            {activities.map((activity) => {
              const info = activity.activityInfo;
              const config = ACTION_CONFIG[info.action] ?? ACTION_CONFIG.updated;
              const Icon = config.icon;
              const taskTitle = info.taskTitle || "a task";
              const changeDesc = getChangeDescription(info.action, info.changes);

              return (
                <div key={activity.id} className={styles.activityItem}>
                  <div className={`${styles.iconWrapper} ${config.style}`}>
                    <Icon className={styles.actionIcon} />
                  </div>
                  <div className={styles.activityContent}>
                    <div className={styles.activityText}>
                      <span className={styles.actorName}>{info.actorName}</span>{" "}
                      {config.verb}{" "}
                      <span className={styles.taskName}>&lsquo;{taskTitle}&rsquo;</span>
                    </div>
                    {changeDesc && (
                      <div className={styles.changeDetail}>{changeDesc}</div>
                    )}
                  </div>
                  <span className={styles.activityTime}>
                    {info.createdAt
                      ? formatDistanceToNow(new Date(info.createdAt), { addSuffix: true })
                      : ""}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
